// Phase 34: Maintenance Requests — member-facing fault reports.
// NOTE: `/api/maintenance` (MaintenanceOrder work orders) pehle se hai,
// is liye ye router `/api/maintenance-requests` par mount hoga.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { createNotification } = require('../lib/notify');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'super_admin', 'manager', 'operations_manager', 'office_boy'];
const staffOnly = requireRole(...STAFF);

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

// Resolve the member record for the logged-in user.
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

const includeRequest = {
  member: { select: { id: true, name: true } },
  reportedBy: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
  unit: { select: { id: true, code: true } },
};

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  unitId: z.string().optional().nullable(),
  priority: z.enum(PRIORITIES).default('medium'),
});

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  unitId: z.string().optional().nullable(),
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(STATUSES).optional(),
  assignedToId: z.string().optional().nullable(),
}).refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });

// Urgent request par ops team ko email + in-app alert (fire-and-forget).
async function alertOpsTeam(tenantId, reqRow) {
  try {
    const mailer = require('./mailer');
    const staff = await prisma.user.findMany({
      where: { tenantId, role: { in: ['ceo', 'admin', 'super_admin', 'operations_manager'] }, email: { not: null } },
      select: { id: true, email: true, name: true },
    });
    for (const s of staff) {
      if (!s.email) continue;
      mailer.notify(tenantId, s.email, 'maintenanceUrgent', {
        name: s.name,
        title: reqRow.title,
        priority: reqRow.priority,
        location: reqRow.location,
        reporter: reqRow.reportedBy?.name || reqRow.member?.name || 'a member',
        createdAt: reqRow.createdAt ? new Date(reqRow.createdAt).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }) : '',
      }).catch(() => {});
      createNotification(prisma, {
        tenantId,
        userId: s.id,
        type: 'maintenance_urgent',
        message: `🚨 Urgent maintenance request: "${reqRow.title}"${reqRow.location ? ` — ${reqRow.location}` : ''}`,
      }).catch(() => {});
    }
  } catch {
    /* kabhi request create fail nahi hone dena */
  }
}

// GET /api/maintenance-requests — staff list (?status= ?priority= ?search=)
router.get('/', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const where = { ...tf };
    if (req.query.status) where.status = req.query.status;
    if (req.query.priority) where.priority = req.query.priority;
    if (req.query.search) {
      where.OR = [
        { title: { contains: req.query.search, mode: 'insensitive' } },
        { description: { contains: req.query.search, mode: 'insensitive' } },
        { location: { contains: req.query.search, mode: 'insensitive' } },
      ];
    }
    const rows = await prisma.maintenanceRequest.findMany({
      where,
      include: includeRequest,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return res.json({ requests: rows });
  } catch (err) {
    return next(err);
  }
});

// GET /api/maintenance-requests/mine — member ki apni requests
router.get('/mine', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member && !STAFF.includes(req.user.role)) {
      return res.status(404).json({ error: { message: 'No member profile found.' } });
    }
    const where = { ...tf, reportedById: req.user.sub };
    const rows = await prisma.maintenanceRequest.findMany({
      where,
      include: includeRequest,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return res.json({ requests: rows });
  } catch (err) {
    return next(err);
  }
});

// POST /api/maintenance-requests — member bhi report kar sakta hai
router.post('/', validateBody(createSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (req.body.unitId) {
      const unit = await prisma.unit.findFirst({ where: { id: req.body.unitId, ...tf } });
      if (!unit) return res.status(400).json({ error: { message: 'Unit not found.' } });
    }
    const row = await prisma.maintenanceRequest.create({
      data: {
        tenantId: tf.tenantId,
        title: req.body.title,
        description: req.body.description || null,
        location: req.body.location || null,
        unitId: req.body.unitId || null,
        priority: req.body.priority || 'medium',
        status: 'open',
        memberId: member ? member.id : null,
        reportedById: req.user.sub,
      },
      include: includeRequest,
    });
    writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'maintenance_request.create',
      entity: 'MaintenanceRequest', entityId: row.id, newValue: { title: row.title, priority: row.priority },
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    if (row.priority === 'urgent') alertOpsTeam(tf.tenantId, row);
    return res.status(201).json({ request: row });
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/maintenance-requests/:id — status/priority/assign (staff)
router.patch('/:id', staffOnly, validateBody(updateSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const row = await prisma.maintenanceRequest.findFirst({ where: { id: req.params.id, ...tf } });
    if (!row) return res.status(404).json({ error: { message: 'Request not found.' } });
    const data = { ...req.body };
    if (data.status === 'resolved' || data.status === 'closed') data.resolvedAt = new Date();
    else if (data.status) data.resolvedAt = null;
    const updated = await prisma.maintenanceRequest.update({
      where: { id: row.id },
      data,
      include: includeRequest,
    });
    writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'maintenance_request.update',
      entity: 'MaintenanceRequest', entityId: row.id, newValue: data,
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    // Reporter ko status change ki notification.
    if (data.status && data.status !== row.status) {
      createNotification(prisma, {
        tenantId: tf.tenantId,
        userId: row.reportedById,
        type: 'maintenance_status',
        message: `Your maintenance request "${row.title}" is now ${data.status.replace('_', ' ')}.`,
      }).catch(() => {});
    }
    return res.json({ request: updated });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
