// Phase 34 Track 6: Printing Credits API.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'manager', 'operations_manager', 'finance_officer', 'receptionist', 'super_admin'];

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function getSettingNum(tenantId, key, def) {
  try {
    const row = await prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key } } });
    const v = parseFloat(row && row.value);
    return Number.isFinite(v) && v >= 0 ? v : def;
  } catch {
    return def;
  }
}

// Get-or-create this month's quota row for a member (lazy monthly reset).
async function getOrCreateCredit(tenantId, memberId, month) {
  let credit = await prisma.printCredit.findUnique({
    where: { memberId_month: { memberId, month } },
  });
  if (!credit) {
    const quota = Math.floor(await getSettingNum(tenantId, 'printQuotaDefault', 100));
    credit = await prisma.printCredit.create({
      data: { tenantId, memberId, month, includedPages: quota, usedPages: 0 },
    });
  }
  return credit;
}

function resolveMemberId(req) {
  if (req.user.role === 'member') {
    if (!req.user.memberId) {
      const e = new Error('No member linked to this account');
      e.status = 400;
      throw e;
    }
    return req.user.memberId;
  }
  const id = req.query.memberId || req.body.memberId;
  if (!id) {
    const e = new Error('memberId is required');
    e.status = 400;
    throw e;
  }
  return String(id);
}

// Balance — member apna, staff ?memberId=
router.get('/balance', async (req, res, next) => {
  try {
    const month = req.query.month ? String(req.query.month) : currentMonth();
    const memberId = resolveMemberId(req);
    const credit = await getOrCreateCredit(req.user.tenantId, memberId, month);
    const remaining = Math.max(0, credit.includedPages - credit.usedPages);
    res.json({
      memberId,
      month,
      included: credit.includedPages,
      used: credit.usedPages,
      remaining,
      overage: Math.max(0, credit.usedPages - credit.includedPages),
    });
  } catch (e) { next(e); }
});

// History — member apni, staff ?memberId=
router.get('/history', async (req, res, next) => {
  try {
    const memberId = resolveMemberId(req);
    const entries = await prisma.printJob.findMany({
      where: { ...tenantFilter(req), memberId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ memberId, entries });
  } catch (e) { next(e); }
});

// Staff: all credits for a month (quota overview).
router.get('/', requireRole(...STAFF), async (req, res, next) => {
  try {
    const month = req.query.month ? String(req.query.month) : currentMonth();
    const credits = await prisma.printCredit.findMany({
      where: { ...tenantFilter(req), month },
      include: { member: { select: { id: true, name: true, companyName: true } } },
      orderBy: { usedPages: 'desc' },
    });
    res.json({
      month,
      rows: credits.map((c) => ({
        memberId: c.memberId,
        memberName: c.member?.name || '—',
        companyName: c.member?.companyName || null,
        included: c.includedPages,
        used: c.usedPages,
        remaining: Math.max(0, c.includedPages - c.usedPages),
      })),
    });
  } catch (e) { next(e); }
});

const logSchema = z.object({
  memberId: z.string().min(1),
  pages: z.number().int().positive().max(10000),
  note: z.string().max(500).optional().nullable(),
});

// Log a print job — staff/reception. Overage auto-billed as an invoice.
router.post('/log', requireRole(...STAFF), validateBody(logSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { memberId, pages, note } = req.body;

    const member = await prisma.member.findFirst({ where: { id: memberId, ...tf } });
    if (!member) return res.status(404).json({ error: { message: 'Member not found' } });

    const month = currentMonth();
    const credit = await getOrCreateCredit(tf.tenantId, memberId, month);

    const remaining = Math.max(0, credit.includedPages - credit.usedPages);
    const covered = Math.min(pages, remaining);
    const overagePages = pages - covered;

    let invoice = null;
    let overageCost = null;
    if (overagePages > 0) {
      const rate = await getSettingNum(tf.tenantId, 'printRatePerPage', 5);
      overageCost = Math.round(overagePages * rate * 100) / 100;

      // Real invoice for the overage (INV-YYYYMM- series, billing.js wala pattern).
      const now = new Date();
      const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
      const countForMonth = await prisma.invoice.count({
        where: { tenantId: tf.tenantId, number: { startsWith: `INV-${yyyymm}-` } },
      });
      const seq = String(countForMonth + 1).padStart(4, '0');
      const dueDate = new Date(now);
      dueDate.setDate(dueDate.getDate() + 7);
      invoice = await prisma.invoice.create({
        data: {
          tenantId: tf.tenantId,
          memberId: member.id,
          number: `INV-${yyyymm}-${seq}`,
          periodStart: now,
          periodEnd: now,
          dueDate,
          amount: overageCost,
          status: 'unpaid',
          invoiceType: 'standard',
          notes: `Printing overage — ${overagePages} pages @ Rs ${rate}/page (${month})`,
        },
      });
    }

    const updated = await prisma.printCredit.update({
      where: { id: credit.id },
      data: { usedPages: { increment: pages } },
    });

    const job = await prisma.printJob.create({
      data: {
        tenantId: tf.tenantId,
        memberId: member.id,
        pages,
        cost: overageCost,
        loggedBy: req.user.sub,
        note: note || null,
      },
    });

    writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'printing.logged',
      entity: 'PrintJob', entityId: job.id,
      newValue: { memberId: member.id, pages, overagePages, invoice: invoice?.number || null },
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});

    res.status(201).json({
      job,
      balance: {
        included: updated.includedPages,
        used: updated.usedPages,
        remaining: Math.max(0, updated.includedPages - updated.usedPages),
      },
      overage: overagePages > 0 ? { pages: overagePages, cost: overageCost, invoice } : null,
    });
  } catch (e) { next(e); }
});

const allocateSchema = z.object({
  memberId: z.string().min(1),
  includedPages: z.number().int().min(0).max(100000),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

// Set/adjust a member's monthly quota.
router.post('/allocate', requireRole(...STAFF), validateBody(allocateSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { memberId, includedPages, month } = req.body;
    const m = month || currentMonth();

    const member = await prisma.member.findFirst({ where: { id: memberId, ...tf } });
    if (!member) return res.status(404).json({ error: { message: 'Member not found' } });

    const credit = await prisma.printCredit.upsert({
      where: { memberId_month: { memberId, month: m } },
      update: { includedPages },
      create: { tenantId: tf.tenantId, memberId, month: m, includedPages, usedPages: 0 },
    });

    writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'printing.quota_allocated',
      entity: 'PrintCredit', entityId: credit.id,
      newValue: { memberId, month: m, includedPages },
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});

    res.json({ credit });
  } catch (e) { next(e); }
});

module.exports = router;
