// Phase 50 Track 6/10: Incident Reports — safety/security/theft/damage incidents.
// Coordinator ke liye:
//   Mount: app.use('/api/incidents', require('./routes/incidents'));
//   Sidebar link: Legal section me { label: 'Incident Reports', path: '/legal/incidents' } (roles: ceo/admin/super_admin/manager/ops)
//   Schema merge: fragments/incidents.prisma → schema.prisma + migration (fragment comments me).
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'manager', 'ops'));

// Model merge na hua ho to safe 503 (koi 500 nahi)
function incidentOr503(res) {
  if (!prisma.incident) {
    res.status(503).json({ error: 'Incident module abhi migrate nahi hua.' });
    return null;
  }
  return prisma.incident;
}

const CATEGORIES = ['safety', 'security', 'theft', 'damage', 'other'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const STATUSES = ['open', 'investigating', 'resolved', 'closed'];

// Status workflow — sirf jayez transitions
const TRANSITIONS = {
  open: ['investigating', 'closed'],
  investigating: ['resolved', 'open'],
  resolved: ['closed', 'open'],
  closed: [],
};

const createSchema = z.object({
  title: z.string().min(3).max(200),
  category: z.enum(CATEGORIES),
  severity: z.enum(SEVERITIES),
  description: z.string().min(10).max(5000),
  location: z.string().max(200).optional().nullable(),
  involvedMemberId: z.string().cuid().optional().nullable(),
  occurredAt: z.coerce.date().optional(),
  attachments: z.array(z.string().url()).max(10).optional().nullable(),
});

const updateSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  category: z.enum(CATEGORIES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  description: z.string().min(10).max(5000).optional(),
  location: z.string().max(200).optional().nullable(),
  involvedMemberId: z.string().cuid().optional().nullable(),
  occurredAt: z.coerce.date().optional(),
  attachments: z.array(z.string().url()).max(10).optional().nullable(),
  resolution: z.string().max(2000).optional().nullable(),
});

const incidentInclude = {
  involvedMember: { select: { id: true, name: true, email: true } },
};

function buildWhere(req) {
  const tf = tenantFilter(req);
  const where = { ...tf };
  if (req.query.status) {
    if (!STATUSES.includes(String(req.query.status))) throw new Error('Ghalat status filter.');
    where.status = String(req.query.status);
  }
  if (req.query.severity) {
    if (!SEVERITIES.includes(String(req.query.severity))) throw new Error('Ghalat severity filter.');
    where.severity = String(req.query.severity);
  }
  if (req.query.category) {
    if (!CATEGORIES.includes(String(req.query.category))) throw new Error('Ghalat category filter.');
    where.category = String(req.query.category);
  }
  if (req.query.memberId) where.involvedMemberId = String(req.query.memberId);
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;
  if (from || to) {
    where.occurredAt = {};
    if (from && !Number.isNaN(from)) where.occurredAt.gte = from;
    if (to && !Number.isNaN(to)) where.occurredAt.lte = to;
  }
  if (req.query.search) {
    const q = String(req.query.search);
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { location: { contains: q, mode: 'insensitive' } },
      { involvedMember: { name: { contains: q, mode: 'insensitive' } } },
    ];
  }
  return where;
}

// Critical incident par foran notification (ceo/admin) + optional email — fail-safe
async function alertCritical(tenantId, incident) {
  try {
    const msg = `🚨 Critical incident: ${incident.title} (${incident.category}) — ${incident.location || 'location nahi'}`;
    for (const role of ['ceo', 'admin']) {
      await prisma.notification.create({
        data: { tenantId, role, type: 'general', message: msg },
      }).catch(() => {});
    }
    const { sendEmail } = require('../lib/mailer');
    const admins = await prisma.user.findMany({
      where: { tenantId, role: { in: ['ceo', 'admin'] }, isActive: true, email: { not: null } },
      select: { email: true },
    }).catch(() => []);
    const to = [...new Set(admins.map((u) => u.email).filter(Boolean))];
    if (to.length && typeof sendEmail === 'function') {
      await sendEmail({
        tenantId,
        to,
        subject: `Critical incident: ${incident.title}`,
        template: 'incidentCritical',
        data: {
          title: incident.title,
          category: incident.category,
          severity: incident.severity,
          location: incident.location || '—',
          description: incident.description,
        },
      }).catch(() => {});
    }
  } catch {}
}

// GET /api/incidents — list (filters: status, severity, category, memberId, from, to, search, page, limit)
router.get('/', async (req, res, next) => {
  try {
    const INC = incidentOr503(res); if (!INC) return;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const where = buildWhere(req);
    const [total, items] = await Promise.all([
      INC.count({ where }),
      INC.findMany({
        where,
        include: incidentInclude,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    res.json({ total, page, pages: Math.ceil(total / limit), items });
  } catch (e) { next(e); }
});

// GET /api/incidents/summary — dashboard counters
router.get('/summary', async (req, res, next) => {
  try {
    const INC = incidentOr503(res); if (!INC) return;
    const tf = tenantFilter(req);
    const [open, critical, resolved30d] = await Promise.all([
      INC.count({ where: { ...tf, status: { in: ['open', 'investigating'] } } }),
      INC.count({ where: { ...tf, severity: 'critical', status: { in: ['open', 'investigating'] } } }),
      INC.count({ where: { ...tf, status: 'resolved', updatedAt: { gte: new Date(Date.now() - 30 * 864e5) } } }),
    ]);
    res.json({ open, critical, resolved30d });
  } catch (e) { next(e); }
});

// GET /api/incidents/:id — detail
router.get('/:id', async (req, res, next) => {
  try {
    const INC = incidentOr503(res); if (!INC) return;
    const tf = tenantFilter(req);
    const incident = await INC.findFirst({ where: { ...tf, id: req.params.id }, include: incidentInclude });
    if (!incident) return res.status(404).json({ error: 'Incident nahi mila.' });
    res.json(incident);
  } catch (e) { next(e); }
});

// POST /api/incidents — report (koi bhi staff)
router.post('/', async (req, res, next) => {
  try {
    const INC = incidentOr503(res); if (!INC) return;
    const tf = tenantFilter(req);
    const d = createSchema.parse(req.body);
    if (d.involvedMemberId) {
      const m = await prisma.member.findFirst({ where: { ...tf, id: d.involvedMemberId }, select: { id: true } });
      if (!m) return res.status(404).json({ error: 'Member nahi mila.' });
    }
    const reporter = req.user || {};
    const incident = await INC.create({
      data: {
        ...tf,
        title: d.title,
        category: d.category,
        severity: d.severity,
        description: d.description,
        location: d.location || null,
        reportedBy: reporter.id || reporter.userId || 'unknown',
        reportedByName: reporter.name || reporter.email || null,
        involvedMemberId: d.involvedMemberId || null,
        status: 'open',
        attachments: d.attachments || null,
        occurredAt: d.occurredAt || new Date(),
      },
      include: incidentInclude,
    });
    try {
      await writeAudit(req, {
        action: 'incident.report',
        entity: 'Incident',
        entityId: incident.id,
        newValue: { title: d.title, severity: d.severity, category: d.category },
      });
    } catch {}
    if (d.severity === 'critical') alertCritical(tf.tenantId, incident);
    res.status(201).json(incident);
  } catch (e) { next(e); }
});

// PATCH /api/incidents/:id — edit (open/investigating me)
router.patch('/:id', async (req, res, next) => {
  try {
    const INC = incidentOr503(res); if (!INC) return;
    const tf = tenantFilter(req);
    const d = updateSchema.parse(req.body);
    const existing = await INC.findFirst({ where: { ...tf, id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Incident nahi mila.' });
    if (['resolved', 'closed'].includes(existing.status) && (d.severity || d.category || d.title)) {
      return res.status(422).json({ error: 'Resolved/closed incident ki details nahi badal sakti (sirf reopen karein).' });
    }
    if (d.involvedMemberId) {
      const m = await prisma.member.findFirst({ where: { ...tf, id: d.involvedMemberId }, select: { id: true } });
      if (!m) return res.status(404).json({ error: 'Member nahi mila.' });
    }
    const wasCritical = existing.severity === 'critical';
    const incident = await INC.update({
      where: { id: existing.id },
      data: {
        ...(d.title !== undefined ? { title: d.title } : {}),
        ...(d.category !== undefined ? { category: d.category } : {}),
        ...(d.severity !== undefined ? { severity: d.severity } : {}),
        ...(d.description !== undefined ? { description: d.description } : {}),
        ...(d.location !== undefined ? { location: d.location } : {}),
        ...(d.involvedMemberId !== undefined ? { involvedMemberId: d.involvedMemberId } : {}),
        ...(d.occurredAt !== undefined ? { occurredAt: d.occurredAt } : {}),
        ...(d.attachments !== undefined ? { attachments: d.attachments } : {}),
        ...(d.resolution !== undefined ? { resolution: d.resolution } : {}),
      },
      include: incidentInclude,
    });
    try {
      await writeAudit(req, { action: 'incident.update', entity: 'Incident', entityId: incident.id, newValue: d });
    } catch {}
    if (!wasCritical && d.severity === 'critical') alertCritical(tf.tenantId, incident);
    res.json(incident);
  } catch (e) { next(e); }
});

// POST /api/incidents/:id/status — status workflow
router.post('/:id/status', async (req, res, next) => {
  try {
    const INC = incidentOr503(res); if (!INC) return;
    const tf = tenantFilter(req);
    const schema = z.object({
      status: z.enum(STATUSES),
      resolution: z.string().max(2000).optional().nullable(),
    });
    const d = schema.parse(req.body);
    const existing = await INC.findFirst({ where: { ...tf, id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Incident nahi mila.' });
    if (!TRANSITIONS[existing.status].includes(d.status)) {
      return res.status(422).json({ error: `Status ${existing.status} se ${d.status} par nahi ja sakta.` });
    }
    if (d.status === 'resolved' && !d.resolution && !existing.resolution) {
      return res.status(422).json({ error: 'Resolve karte waqt resolution note lazmi hai.' });
    }
    const incident = await INC.update({
      where: { id: existing.id },
      data: {
        status: d.status,
        ...(d.resolution !== undefined && d.resolution !== null ? { resolution: d.resolution } : {}),
      },
      include: incidentInclude,
    });
    try {
      await writeAudit(req, {
        action: 'incident.status',
        entity: 'Incident',
        entityId: incident.id,
        newValue: { from: existing.status, to: d.status },
      });
    } catch {}
    res.json(incident);
  } catch (e) { next(e); }
});

// DELETE /api/incidents/:id — sirf open wale (ceo/admin)
router.delete('/:id', async (req, res, next) => {
  try {
    const INC = incidentOr503(res); if (!INC) return;
    const tf = tenantFilter(req);
    const role = (req.user && req.user.role) || '';
    if (!['ceo', 'admin', 'super_admin'].includes(role)) {
      return res.status(403).json({ error: 'Incident hatane ki ijazat nahi.' });
    }
    const existing = await INC.findFirst({ where: { ...tf, id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Incident nahi mila.' });
    if (existing.status !== 'open') {
      return res.status(422).json({ error: 'Sirf open incidents hataye ja sakte hain.' });
    }
    await INC.delete({ where: { id: existing.id } });
    try {
      await writeAudit(req, { action: 'incident.delete', entity: 'Incident', entityId: existing.id });
    } catch {}
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
