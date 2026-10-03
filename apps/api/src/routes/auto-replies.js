// Phase 49 Track 8/10: Auto-Replies — staff CRUD API.
// Mount (server.js — coordinator): app.use('/api/auto-replies', require('./routes/auto-replies'));
// Sidebar link nahi — comms extend hai (comms settings ya messaging page me jorein).

const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser, requireRole } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];

// Merge se pehle safe 503 (koi 500 crash nahi)
function guard(req, res) {
  if (!prisma.autoReply) {
    res.status(503).json({ ok: false, error: 'Auto-replies not migrated yet' });
    return false;
  }
  return true;
}

const ruleSchema = z.object({
  trigger: z.enum(['keyword', 'business_hours', 'off_hours']),
  keyword: z.string().min(1).max(80).optional().nullable(),
  channel: z.enum(['whatsapp', 'internal']),
  replyBody: z.string().min(1).max(2000),
  isActive: z.boolean().optional(),
}).superRefine((v, ctx) => {
  if (v.trigger === 'keyword' && !v.keyword) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'keyword required for keyword trigger', path: ['keyword'] });
  }
});

// GET /api/auto-replies — list (?channel=, ?active=1)
router.get('/', requireRole(...STAFF), async (req, res) => {
  try {
    if (!guard(req, res)) return;
    const tf = tenantFilter(req);
    const where = { ...tf };
    if (req.query.channel) where.channel = String(req.query.channel);
    if (req.query.active === '1') where.isActive = true;
    const items = await prisma.autoReply.findMany({ where, orderBy: { createdAt: 'asc' } });
    res.json({ ok: true, items, count: items.length });
  } catch (e) {
    console.error('[auto-replies] list failed:', e.message);
    res.status(500).json({ ok: false, error: 'Failed to load auto-replies' });
  }
});

// POST /api/auto-replies — naya rule
router.post('/', requireRole(...STAFF), validateBody(ruleSchema), async (req, res) => {
  try {
    if (!guard(req, res)) return;
    const tf = tenantFilter(req);
    const row = await prisma.autoReply.create({ data: { tenantId: tf.tenantId, ...req.body } });
    await writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'comms.auto_reply.create',
      entity: 'AutoReply', entityId: row.id, ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    res.status(201).json({ ok: true, item: row });
  } catch (e) {
    console.error('[auto-replies] create failed:', e.message);
    res.status(500).json({ ok: false, error: 'Failed to create auto-reply' });
  }
});

const ruleUpdateSchema = z.object({
  trigger: z.enum(['keyword', 'business_hours', 'off_hours']).optional(),
  keyword: z.string().min(1).max(80).optional().nullable(),
  channel: z.enum(['whatsapp', 'internal']).optional(),
  replyBody: z.string().min(1).max(2000).optional(),
  isActive: z.boolean().optional(),
});

// PATCH /api/auto-replies/:id — edit / on-off
router.patch('/:id', requireRole(...STAFF), validateBody(ruleUpdateSchema), async (req, res) => {
  try {
    if (!guard(req, res)) return;
    const tf = tenantFilter(req);
    const row = await prisma.autoReply.updateMany({ where: { id: req.params.id, ...tf }, data: req.body });
    if (!row.count) return res.status(404).json({ ok: false, error: 'Not found' });
    const item = await prisma.autoReply.findFirst({ where: { id: req.params.id, ...tf } });
    await writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'comms.auto_reply.update',
      entity: 'AutoReply', entityId: req.params.id, ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    res.json({ ok: true, item });
  } catch (e) {
    console.error('[auto-replies] update failed:', e.message);
    res.status(500).json({ ok: false, error: 'Failed to update auto-reply' });
  }
});

// DELETE /api/auto-replies/:id
router.delete('/:id', requireRole(...STAFF), async (req, res) => {
  try {
    if (!guard(req, res)) return;
    const tf = tenantFilter(req);
    const row = await prisma.autoReply.deleteMany({ where: { id: req.params.id, ...tf } });
    if (!row.count) return res.status(404).json({ ok: false, error: 'Not found' });
    await writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'comms.auto_reply.delete',
      entity: 'AutoReply', entityId: req.params.id, ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    res.json({ ok: true, deleted: true });
  } catch (e) {
    console.error('[auto-replies] delete failed:', e.message);
    res.status(500).json({ ok: false, error: 'Failed to delete auto-reply' });
  }
});

module.exports = router;
