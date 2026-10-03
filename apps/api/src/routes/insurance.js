// Phase 50 Track 7: Insurance Tracking
// Mount: app.use('/api/insurance', require('./routes/insurance'));
// Sidebar link nahi — Legal section extend hai (coordinator jore).
// Coordinator: server.js me require('./routes/insurance').ensureInsuranceScheduled() wiring.
//
// Integration note (Track 4 — Legal Vault): policy par documentUrl set ho to
// syncInsuranceToVault() LegalDocument row banata/update karta hai (guarded —
// vault merge na ho to skip). Coordinator ko kuch nahi karna.

const express = require('express');
const { z } = require('zod');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser, requireRole } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const prisma = require('../lib/prisma');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole(['ceo', 'admin', 'super_admin', 'manager']));

const TYPES = ['property', 'liability', 'health', 'equipment'];
const FREQ = ['monthly', 'quarterly', 'yearly'];
const STATUS = ['active', 'expired', 'cancelled'];

function migrated() { return !!(prisma && prisma.insurancePolicy); }
const guard = (req, res, next) => migrated() ? next() : res.status(503).json({ ok: false, error: 'Insurance abhi migrate nahi hua' });

const schema = z.object({
  provider: z.string().min(2).max(200),
  policyNumber: z.string().min(1).max(100),
  type: z.enum(TYPES),
  coverageAmount: z.number().nonnegative(),
  premiumAmount: z.number().nonnegative(),
  premiumFrequency: z.enum(FREQ).default('yearly'),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  documentUrl: z.string().url().max(500).optional().nullable(),
  status: z.enum(STATUS).optional(),
});

// Legal vault auto-link (Track 4) — vault merge na ho to silently skip.
async function syncInsuranceToVault(tenantId, policy) {
  try {
    if (!prisma.legalDocument || !policy.documentUrl) return;
    const title = `Insurance — ${policy.provider} (${policy.policyNumber})`;
    const existing = await prisma.legalDocument.findFirst({
      where: { tenantId, category: 'insurance', title },
    });
    const data = { documentUrl: policy.documentUrl, expiresAt: policy.endDate };
    if (existing) {
      await prisma.legalDocument.update({ where: { id: existing.id }, data });
    } else {
      await prisma.legalDocument.create({
        data: { tenantId, title, category: 'insurance', fileUrl: policy.documentUrl, expiresAt: policy.endDate, reminderDays: 30, status: 'active' },
      });
    }
  } catch { /* vault optional */ }
}

async function flagExpired(tf) {
  return prisma.insurancePolicy.updateMany({
    where: { ...tf, status: 'active', endDate: { lt: new Date() } },
    data: { status: 'expired' },
  });
}

router.get('/', guard, async (req, res) => {
  const tf = tenantFilter(req);
  const { status, type, search } = req.query;
  await flagExpired(tf);
  const where = { ...tf };
  if (status && STATUS.includes(status)) where.status = status;
  if (type && TYPES.includes(type)) where.type = type;
  if (search) {
    where.OR = [
      { provider: { contains: search, mode: 'insensitive' } },
      { policyNumber: { contains: search, mode: 'insensitive' } },
    ];
  }
  const items = await prisma.insurancePolicy.findMany({ where, orderBy: { endDate: 'asc' } });
  res.json({ ok: true, items });
});

router.get('/summary', guard, async (req, res) => {
  const tf = tenantFilter(req);
  await flagExpired(tf);
  const counts = await prisma.insurancePolicy.groupBy({ by: ['status'], where: tf, _count: true });
  const expiringSoon = await prisma.insurancePolicy.count({
    where: { ...tf, status: 'active', endDate: { gte: new Date(), lte: new Date(Date.now() + 60 * 864e5) } },
  });
  const totalPremium = await prisma.insurancePolicy.aggregate({
    where: { ...tf, status: 'active' }, _sum: { premiumAmount: true },
  });
  res.json({ ok: true, counts, expiringSoon, totalActivePremium: totalPremium._sum.premiumAmount || 0 });
});

router.get('/:id', guard, async (req, res) => {
  const tf = tenantFilter(req);
  const item = await prisma.insurancePolicy.findFirst({ where: { ...tf, id: req.params.id } });
  if (!item) return res.status(404).json({ ok: false, error: 'Nahi mila' });
  res.json({ ok: true, item });
});

router.post('/', guard, async (req, res) => {
  const tf = tenantFilter(req);
  const p = schema.parse(req.body);
  if (new Date(p.endDate) <= new Date(p.startDate)) {
    return res.status(422).json({ ok: false, error: 'End date start date se baad honi chahiye' });
  }
  const item = await prisma.insurancePolicy.create({
    data: {
      ...tf,
      ...p,
      startDate: new Date(p.startDate),
      endDate: new Date(p.endDate),
      status: p.status || 'active',
    },
  });
  await syncInsuranceToVault(tf.tenantId, item);
  await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'insurance.create', entity: 'InsurancePolicy', entityId: item.id, newValue: { provider: item.provider, policyNumber: item.policyNumber } }).catch(() => {});
  res.status(201).json({ ok: true, item });
});

router.patch('/:id', guard, async (req, res) => {
  const tf = tenantFilter(req);
  const cur = await prisma.insurancePolicy.findFirst({ where: { ...tf, id: req.params.id } });
  if (!cur) return res.status(404).json({ ok: false, error: 'Nahi mila' });
  const p = schema.partial().parse(req.body);
  const data = { ...p };
  if (p.startDate !== undefined) data.startDate = p.startDate ? new Date(p.startDate) : null;
  if (p.endDate !== undefined) {
    data.endDate = p.endDate ? new Date(p.endDate) : null;
    data.lastReminderKey = null; // endDate badla -> reminder cycle reset
  }
  if (data.endDate && data.startDate && data.endDate <= data.startDate) {
    return res.status(422).json({ ok: false, error: 'End date start date se baad honi chahiye' });
  }
  const item = await prisma.insurancePolicy.update({ where: { id: cur.id }, data });
  await syncInsuranceToVault(tf.tenantId, item);
  await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'insurance.update', entity: 'InsurancePolicy', entityId: item.id }).catch(() => {});
  res.json({ ok: true, item });
});

router.post('/:id/renew', guard, async (req, res) => {
  const tf = tenantFilter(req);
  const cur = await prisma.insurancePolicy.findFirst({ where: { ...tf, id: req.params.id } });
  if (!cur) return res.status(404).json({ ok: false, error: 'Nahi mila' });
  const { newEndDate, newPremiumAmount } = z.object({
    newEndDate: z.string().datetime(),
    newPremiumAmount: z.number().nonnegative().optional(),
  }).parse(req.body || {});
  const item = await prisma.insurancePolicy.update({
    where: { id: cur.id },
    data: {
      endDate: new Date(newEndDate),
      status: 'active',
      lastReminderKey: null,
      ...(newPremiumAmount !== undefined ? { premiumAmount: newPremiumAmount } : {}),
    },
  });
  await syncInsuranceToVault(tf.tenantId, item);
  await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'insurance.renew', entity: 'InsurancePolicy', entityId: item.id }).catch(() => {});
  res.json({ ok: true, item });
});

router.delete('/:id', guard, async (req, res) => {
  const tf = tenantFilter(req);
  const cur = await prisma.insurancePolicy.findFirst({ where: { ...tf, id: req.params.id } });
  if (!cur) return res.status(404).json({ ok: false, error: 'Nahi mila' });
  await prisma.insurancePolicy.delete({ where: { id: cur.id } });
  await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'insurance.delete', entity: 'InsurancePolicy', entityId: cur.id }).catch(() => {});
  res.json({ ok: true });
});

// Renewal reminders (60/30/7 din) + expiry alerts — daily job.
// Coordinator wiring: server.js me require('./routes/insurance').ensureInsuranceScheduled()
const REMIND_DAYS = [60, 30, 7];

function daysLeftOf(d) { return Math.ceil((new Date(d).getTime() - Date.now()) / 864e5); }

async function sendRenewalReminders() {
  if (!migrated()) return { skipped: 'not_migrated' };
  let sent = 0;
  const tenants = await prisma.insurancePolicy.findMany({
    where: { status: 'active', endDate: { lte: new Date(Date.now() + 61 * 864e5) } },
    select: { tenantId: true },
    distinct: ['tenantId'],
  }).catch(() => []);
  for (const { tenantId } of tenants) {
    const policies = await prisma.insurancePolicy.findMany({
      where: { tenantId, status: 'active' },
    }).catch(() => []);
    for (const p of policies) {
      const days = daysLeftOf(p.endDate);
      if (days < 0) {
        await flagExpired({ tenantId });
        const key = `${p.endDate.toISOString()}:expired`;
        if (p.lastReminderKey === key) continue;
        await notifyRenewal(tenantId, p, days, true);
        await prisma.insurancePolicy.update({ where: { id: p.id }, data: { lastReminderKey: key } }).catch(() => {});
        sent++;
        continue;
      }
      const hit = REMIND_DAYS.find((d) => days === d);
      if (hit === undefined) continue;
      const key = `${p.endDate.toISOString()}:${hit}`;
      if (p.lastReminderKey === key) continue; // dedupe
      await notifyRenewal(tenantId, p, days, false);
      await prisma.insurancePolicy.update({ where: { id: p.id }, data: { lastReminderKey: key } }).catch(() => {});
      sent++;
    }
  }
  return { sent };
}

async function notifyRenewal(tenantId, p, days, expired) {
  const title = expired
    ? `Insurance policy EXPIRED: ${p.provider} (${p.policyNumber})`
    : `Insurance renewal: ${p.provider} (${p.policyNumber}) — ${days} din baqi`;
  const key = `[insurance-reminder:${p.id}:${p.endDate.toISOString()}:${expired ? 'expired' : days}]`;
  const dup = await prisma.notification.count({ where: { tenantId, message: { startsWith: key } } }).catch(() => 1);
  if (dup > 0) return;
  const fullMsg = `${key} ${title}`;
  for (const role of ['ceo', 'admin', 'manager']) {
    await prisma.notification.create({ data: { tenantId, role, type: 'general', message: fullMsg } }).catch(() => {});
  }
  try {
    const { sendEmail } = require('./mailer');
    const admins = await prisma.user.findMany({
      where: { tenantId, role: { in: ['ceo', 'admin'] }, isActive: true, email: { not: null } },
      select: { email: true },
    }).catch(() => []);
    const to = [...new Set(admins.map((u) => u.email).filter(Boolean))];
    if (to.length && typeof sendEmail === 'function') {
      await sendEmail({
        tenantId,
        to,
        subject: expired ? `⚠️ ${title}` : `🔔 ${title}`,
        html: `<p>${title}</p><p>Type: ${p.type} · Coverage: ${p.coverageAmount} · End: ${new Date(p.endDate).toLocaleDateString()}</p>`,
      }).catch(() => {});
    }
  } catch { /* email optional */ }
}

let _sched = false;
function ensureInsuranceScheduled() {
  if (_sched) return;
  _sched = true;
  setTimeout(async () => { try { await sendRenewalReminders(); } catch {} ensureInsuranceScheduled(); }, 24 * 3600 * 1000);
}

module.exports = router;
module.exports.ensureInsuranceScheduled = ensureInsuranceScheduled;
module.exports.sendRenewalReminders = sendRenewalReminders;
