// Phase 50 Track 2/10: Policy Documents + Acknowledgments.
// Mount: app.use('/api/policies', require('./routes/policies'));
// Staff (ceo/admin/super_admin/manager): CRUD + acks list + remind.
// Member (koi bhi tenant user): GET /pending, POST /:id/ack.
// Portal integration: apps/web/app/(app)/portal/page.js me banner jorein —
//   GET /api/policies/pending se pending list, click par /portal/policies (coordinator).

const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];
const staffOnly = requireRole(...STAFF);

function policiesEnabled() {
  return !!(prisma && prisma.policy && prisma.policyAck);
}
function guard503(req, res, next) {
  if (!policiesEnabled()) return res.status(503).json({ error: 'Policies schema pending migration' });
  next();
}
router.use(guard503);

// Member resolution (portal.js myMember pattern)
async function myMember(req) {
  const tf = tenantFilter(req);
  if (req.user.memberId) {
    const m = await prisma.member.findFirst({ where: { id: req.user.memberId, ...tf } });
    if (m) return m;
  }
  if (req.user.email) {
    const m = await prisma.member.findFirst({ where: { email: req.user.email, ...tf } });
    if (m) return m;
  }
  return null;
}

const CATEGORIES = ['general', 'house-rules', 'safety', 'privacy', 'hr', 'finance', 'it'];

const policySchema = z.object({
  title: z.string().min(2).max(200),
  category: z.enum(CATEGORIES).optional().default('general'),
  fileUrl: z.string().url().nullable().optional(),
  body: z.string().max(100000).nullable().optional(),
  effectiveDate: z.string().datetime().nullable().optional(),
  requiresAck: z.boolean().optional().default(true),
  reAckOnUpdate: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
});

// ---- GET / : staff — sab policies + ack progress ----
router.get('/', staffOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const policies = await prisma.policy.findMany({ where: { ...tf }, orderBy: { createdAt: 'desc' } });
    const members = await prisma.member.findMany({ where: { ...tf }, select: { id: true } });
    const totalMembers = members.length;
    const acks = await prisma.policyAck.groupBy({
      by: ['policyId'],
      where: { ...tf, memberId: { not: null } },
      _count: { policyId: true },
    });
    const ackCount = Object.fromEntries(acks.map((a) => [a.policyId, a._count.policyId]));
    res.json({
      policies: policies.map((p) => ({
        ...p,
        acked: ackCount[p.id] || 0,
        totalMembers,
        pending: Math.max(0, totalMembers - (ackCount[p.id] || 0)),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load policies' });
  }
});

// ---- GET /pending : member — meri pending policies ----
router.get('/pending', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    const policies = await prisma.policy.findMany({
      where: { ...tf, isActive: true, requiresAck: true },
      orderBy: { updatedAt: 'desc' },
    });
    const acks = await prisma.policyAck.findMany({
      where: {
        ...tf,
        ...(member ? { memberId: member.id } : { userId: req.user.id }),
      },
      select: { policyId: true, ackedAt: true },
    });
    const ackByPolicy = Object.fromEntries(acks.map((a) => [a.policyId, a.ackedAt]));
    const pending = policies.filter((p) => {
      const ackedAt = ackByPolicy[p.id];
      if (!ackedAt) return true;
      if (p.reAckOnUpdate && new Date(ackedAt) < new Date(p.updatedAt)) return true;
      return false;
    });
    res.json({ pending, count: pending.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load pending policies' });
  }
});

// ---- GET /:id/acks : staff — kis ne ack kiya ----
router.get('/:id/acks', staffOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const policy = await prisma.policy.findFirst({ where: { id: req.params.id, ...tf } });
    if (!policy) return res.status(404).json({ error: 'Policy nahi mili' });
    const acks = await prisma.policyAck.findMany({
      where: { policyId: policy.id, ...tf },
      include: {
        member: { select: { id: true, name: true, email: true } },
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { ackedAt: 'desc' },
    });
    res.json({ policy: { id: policy.id, title: policy.title, version: policy.version }, acks });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load acks' });
  }
});

// ---- POST / : staff — nayi policy ----
router.post('/', staffOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const data = policySchema.parse(req.body);
    const policy = await prisma.policy.create({
      data: {
        ...tf,
        title: data.title,
        category: data.category,
        fileUrl: data.fileUrl || null,
        body: data.body || null,
        effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null,
        requiresAck: data.requiresAck,
        reAckOnUpdate: data.reAckOnUpdate,
        isActive: data.isActive,
      },
    });
    await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'policy.create', entity: 'Policy', entityId: policy.id, newValue: { title: policy.title } });
    res.status(201).json({ policy });
  } catch (err) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', details: err.errors });
    res.status(500).json({ error: 'Failed to create policy' });
  }
});

// ---- PATCH /:id : staff — edit (bumpVersion=true par version barhta hai) ----
router.patch('/:id', staffOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const policy = await prisma.policy.findFirst({ where: { id: req.params.id, ...tf } });
    if (!policy) return res.status(404).json({ error: 'Policy nahi mili' });
    const data = policySchema.partial().parse(req.body);
    const bump = req.body.bumpVersion === true;
    const update = {};
    for (const k of ['title', 'category', 'fileUrl', 'body', 'requiresAck', 'reAckOnUpdate', 'isActive']) {
      if (data[k] !== undefined) update[k] = data[k];
    }
    if (data.effectiveDate !== undefined) update.effectiveDate = data.effectiveDate ? new Date(data.effectiveDate) : null;
    if (bump) update.version = { increment: 1 };
    const updated = await prisma.policy.update({ where: { id: policy.id }, data: update });
    await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'policy.update', entity: 'Policy', entityId: policy.id, newValue: { title: updated.title, version: updated.version } });
    res.json({ policy: updated });
  } catch (err) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', details: err.errors });
    res.status(500).json({ error: 'Failed to update policy' });
  }
});

// ---- DELETE /:id : staff ----
router.delete('/:id', staffOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const policy = await prisma.policy.findFirst({ where: { id: req.params.id, ...tf } });
    if (!policy) return res.status(404).json({ error: 'Policy nahi mili' });
    await prisma.policy.delete({ where: { id: policy.id } });
    await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'policy.delete', entity: 'Policy', entityId: policy.id, oldValue: { title: policy.title } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete policy' });
  }
});

// ---- POST /:id/ack : member — policy parh li ----
router.post('/:id/ack', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const policy = await prisma.policy.findFirst({ where: { id: req.params.id, ...tf, isActive: true } });
    if (!policy) return res.status(404).json({ error: 'Policy nahi mili' });
    const member = await myMember(req);
    const key = member ? { policyId_memberId: { policyId: policy.id, memberId: member.id } }
                       : { policyId_userId: { policyId: policy.id, userId: req.user.id } };
    const existing = await prisma.policyAck.findUnique({ where: key });
    // Pehle se ack aur re-ack lazmi nahi → idempotent 200
    if (existing && !(policy.reAckOnUpdate && new Date(existing.ackedAt) < new Date(policy.updatedAt))) {
      return res.json({ acked: true, already: true });
    }
    const ipHash = req.ip ? crypto.createHash('sha256').update('policyack:' + req.ip).digest('hex').slice(0, 32) : null;
    if (existing) {
      const updated = await prisma.policyAck.update({ where: key, data: { ackedAt: new Date(), ipHash } });
      return res.json({ acked: true, ack: updated });
    }
    const ack = await prisma.policyAck.create({
      data: {
        ...tf,
        policyId: policy.id,
        memberId: member ? member.id : null,
        userId: member ? null : req.user.id,
        ipHash,
      },
    });
    await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'policy.ack', entity: 'PolicyAck', entityId: ack.id, newValue: { policyId: policy.id } });
    res.status(201).json({ acked: true, ack });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record acknowledgment' });
  }
});

// ---- POST /:id/remind : staff — pending members ko in-app reminder ----
router.post('/:id/remind', staffOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const policy = await prisma.policy.findFirst({ where: { id: req.params.id, ...tf } });
    if (!policy) return res.status(404).json({ error: 'Policy nahi mili' });
    const { createNotification } = require('../lib/notify');
    const members = await prisma.member.findMany({ where: { ...tf }, select: { id: true, name: true } });
    const acked = await prisma.policyAck.findMany({
      where: { policyId: policy.id, ...tf, memberId: { not: null } },
      select: { memberId: true },
    });
    const ackedIds = new Set(acked.map((a) => a.memberId));
    const pending = members.filter((m) => !ackedIds.has(m.id));
    // Member ke linked users ko notification
    const users = await prisma.user.findMany({
      where: { ...tf, memberId: { in: pending.map((m) => m.id) } },
      select: { id: true },
    });
    let sent = 0;
    for (const u of users) {
      try {
        await createNotification(prisma, {
          tenantId: tf.tenantId,
          userId: u.id,
          type: 'policy_reminder',
          message: `📋 "${policy.title}" policy parh kar acknowledge karein (v${policy.version}).`,
        });
        sent++;
      } catch {}
    }
    await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'policy.remind', entity: 'Policy', entityId: policy.id, newValue: { pending: pending.length, notified: sent } });
    res.json({ pending: pending.length, notified: sent });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send reminders' });
  }
});

module.exports = router;
