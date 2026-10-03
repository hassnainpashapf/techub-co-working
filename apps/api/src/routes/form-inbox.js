// Phase 47 Track 8/10: Submission Inbox & Workflow — staff inbox for form submissions.
// Coordinator ke liye:
//   Mount: app.use('/api/form-inbox', require('./routes/form-inbox'));
//   Sidebar link nahi — forms extend hai (form detail page me "Responses" tab).
//   Schema merge: fragments/form-submissions.prisma (Track 2) + fragments/form-inbox.prisma
//   (Track 8 DELTA: status, assignedToId, notes) → schema.prisma; migration SQL dono fragments me.
//   Frontend integration (coordinator): apps/web/app/(app)/forms/[id]/page.js me "Responses" tab
//   jore → GET /api/form-inbox?formId=<id> se list, PATCH /:id se status/assign/notes,
//   DELETE /:id se spam hatana, GET /:id se answers detail.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'manager', 'receptionist'));

// Model merge na hua ho to safe 503 (koi 500 nahi)
function inboxOr503(res) {
  if (!prisma.formSubmission) {
    res.status(503).json({ error: 'Forms module abhi migrate nahi hua.' });
    return null;
  }
  return prisma.formSubmission;
}

const STATUSES = ['new', 'reviewed', 'actioned', 'spam'];

const updateSchema = z.object({
  status: z.enum(STATUSES).optional(),
  assignedToId: z.string().cuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

// GET /api/form-inbox — submissions (filters: formId, status, search, page)
router.get('/', async (req, res, next) => {
  try {
    const FS = inboxOr503(res); if (!FS) return;
    const tf = tenantFilter(req);
    const where = { ...tf };
    if (req.query.formId) where.formId = String(req.query.formId);
    if (req.query.status) {
      if (!STATUSES.includes(String(req.query.status))) {
        return res.status(400).json({ error: 'Ghalat status filter.' });
      }
      where.status = String(req.query.status);
    }
    if (req.query.assignedToId) where.assignedToId = String(req.query.assignedToId);
    if (req.query.search) {
      const q = String(req.query.search);
      where.OR = [
        { submitterName: { contains: q, mode: 'insensitive' } },
        { submitterEmail: { contains: q, mode: 'insensitive' } },
      ];
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const [total, submissions] = await Promise.all([
      FS.count({ where }),
      FS.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          form: { select: { id: true, title: true, slug: true } },
          assignedTo: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);
    // Inbox list me poora answers payload nahi bhejte — sirf preview
    const rows = submissions.map((s) => ({
      id: s.id,
      formId: s.formId,
      form: s.form,
      status: s.status,
      submitterName: s.submitterName,
      submitterEmail: s.submitterEmail,
      memberId: s.memberId,
      assignedTo: s.assignedTo,
      notes: s.notes,
      answerCount: s.answers && typeof s.answers === 'object' ? Object.keys(s.answers).length : 0,
      createdAt: s.createdAt,
    }));
    res.json({ submissions: rows, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (e) { next(e); }
});

// GET /api/form-inbox/summary — inbox counters (form filter optional)
router.get('/summary', async (req, res, next) => {
  try {
    const FS = inboxOr503(res); if (!FS) return;
    const tf = tenantFilter(req);
    const where = { ...tf };
    if (req.query.formId) where.formId = String(req.query.formId);
    const groups = await FS.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });
    const summary = { new: 0, reviewed: 0, actioned: 0, spam: 0, total: 0 };
    for (const g of groups) {
      if (STATUSES.includes(g.status)) summary[g.status] = g._count._all;
      summary.total += g._count._all;
    }
    res.json({ summary });
  } catch (e) { next(e); }
});

// GET /api/form-inbox/:id — ek submission ka full detail (answers samet)
router.get('/:id', async (req, res, next) => {
  try {
    const FS = inboxOr503(res); if (!FS) return;
    const tf = tenantFilter(req);
    const submission = await FS.findFirst({
      where: { id: req.params.id, ...tf },
      include: {
        form: { select: { id: true, title: true, slug: true, fields: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    });
    if (!submission) return res.status(404).json({ error: 'Submission nahi mili.' });
    res.json({ submission });
  } catch (e) { next(e); }
});

// PATCH /api/form-inbox/:id — status / assign / notes update
router.patch('/:id', async (req, res, next) => {
  try {
    const FS = inboxOr503(res); if (!FS) return;
    const tf = tenantFilter(req);
    const data = updateSchema.parse(req.body);
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Kuch update karne ko nahi diya.' });
    }
    const existing = await FS.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'Submission nahi mili.' });
    // assignedToId diya ho to user isi tenant ka hona chahiye
    if (data.assignedToId) {
      const user = await prisma.user.findFirst({
        where: { id: data.assignedToId, tenantId: tf.tenantId },
        select: { id: true },
      });
      if (!user) return res.status(422).json({ error: 'Assign karne wala user is tenant ka nahi.' });
    }
    const updated = await FS.update({
      where: { id: existing.id },
      data,
      include: {
        form: { select: { id: true, title: true, slug: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    });
    try {
      await writeAudit({
        tenantId: tf.tenantId,
        actorId: req.user.id,
        action: 'form.submission.update',
        entity: 'FormSubmission',
        entityId: existing.id,
        oldValue: { status: existing.status, assignedToId: existing.assignedToId },
        newValue: { status: updated.status, assignedToId: updated.assignedToId },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch {}
    res.json({ submission: updated });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: 'Validation fail', details: e.errors });
    next(e);
  }
});

// DELETE /api/form-inbox/:id — spam/ghalat submission hatana
router.delete('/:id', async (req, res, next) => {
  try {
    const FS = inboxOr503(res); if (!FS) return;
    const tf = tenantFilter(req);
    const existing = await FS.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'Submission nahi mili.' });
    await FS.delete({ where: { id: existing.id } });
    try {
      await writeAudit({
        tenantId: tf.tenantId,
        actorId: req.user.id,
        action: 'form.submission.delete',
        entity: 'FormSubmission',
        entityId: existing.id,
        oldValue: { formId: existing.formId, submitterEmail: existing.submitterEmail },
        newValue: null,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch {}
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
