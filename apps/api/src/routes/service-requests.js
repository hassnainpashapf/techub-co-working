// Phase 55 Track 2: Service Requests (concierge orders)
// MOUNT: app.use('/api/service-requests', require('./routes/service-requests'));
// server.js / Sidebar.js nahi chhue — concierge section extend hai.
//
// PORTAL INTEGRATION NOTE (coordinator / Track jisko portal page mile):
//   apps/web/app/(app)/portal/concierge/page.js banana:
//   - member: catalog (GET /api/concierge-services) → Request button → POST /api/service-requests
//   - my requests: GET /api/service-requests/me (status badges, cancel button)
//   - detail: GET /api/service-requests/me/:id
// Staff page: GET / (filters) → assign/price/status actions.
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

const STAFF = ['ceo', 'admin', 'super_admin', 'manager', 'reception'];
const STATUSES = ['new', 'accepted', 'in_progress', 'done', 'cancelled'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

function schemaLive() {
  return !!(prisma && prisma.serviceRequest);
}
function guard503(req, res, next) {
  if (!schemaLive()) return res.status(503).json({ error: 'Service requests schema pending migration' });
  next();
}
router.use(guard503);

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'ServiceRequest', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

async function myMember(req, tf) {
  if (!req.user.memberId) return null;
  return prisma.member.findFirst({ where: { id: req.user.memberId, ...tf } });
}

// POST / — member service request banaye
router.post(
  '/',
  validateBody(z.object({
    serviceId: z.string().min(1).optional(),
    title: z.string().min(3).max(120),
    details: z.string().max(2000).optional(),
    priority: z.enum(PRIORITIES).optional(),
  })),
  async (req, res) => {
    const tf = tenantFilter(req);
    const member = await myMember(req, tf);
    if (!member) return res.status(403).json({ error: 'Member profile required' });
    const { serviceId, title, details, priority } = req.body;
    if (serviceId && prisma.conciergeService) {
      const svc = await prisma.conciergeService.findFirst({ where: { id: serviceId, ...tf } });
      if (!svc || svc.isActive === false) return res.status(422).json({ error: 'Service not available' });
    }
    const reqst = await prisma.serviceRequest.create({
      data: {
        tenantId: tf.tenantId, memberId: member.id,
        serviceId: serviceId || null, title, details: details || null,
        priority: priority || 'normal',
      },
    });
    audit(req, tf, 'service-request.created', reqst.id, { title });
    res.status(201).json({ id: reqst.id, status: reqst.status });
  }
);

// GET /me — member apni requests
router.get('/me', async (req, res) => {
  const tf = tenantFilter(req);
  const member = await myMember(req, tf);
  if (!member) return res.status(403).json({ error: 'Member profile required' });
  const { status } = req.query;
  const where = { tenantId: tf.tenantId, memberId: member.id };
  if (STATUSES.includes(status)) where.status = status;
  const rows = await prisma.serviceRequest.findMany({
    where,
    include: { service: prisma.conciergeService ? { select: { id: true, name: true, category: true } } : undefined },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ requests: rows });
});

// GET /me/:id — member apni request detail
router.get('/me/:id', async (req, res) => {
  const tf = tenantFilter(req);
  const member = await myMember(req, tf);
  if (!member) return res.status(403).json({ error: 'Member profile required' });
  const row = await prisma.serviceRequest.findFirst({
    where: { id: req.params.id, tenantId: tf.tenantId, memberId: member.id },
    include: { service: prisma.conciergeService ? true : undefined },
  });
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ request: row });
});

// POST /me/:id/cancel — member apni new request cancel kare
router.post('/me/:id/cancel', async (req, res) => {
  const tf = tenantFilter(req);
  const member = await myMember(req, tf);
  if (!member) return res.status(403).json({ error: 'Member profile required' });
  const row = await prisma.serviceRequest.findFirst({
    where: { id: req.params.id, tenantId: tf.tenantId, memberId: member.id },
  });
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'new') return res.status(409).json({ error: 'Only new requests can be cancelled' });
  const updated = await prisma.serviceRequest.update({
    where: { id: row.id }, data: { status: 'cancelled' },
  });
  audit(req, tf, 'service-request.cancelled', row.id, { by: member.id });
  res.json({ id: updated.id, status: updated.status });
});

// GET / — staff: sab requests (filters)
router.get('/', requireRole(...STAFF), async (req, res) => {
  const tf = tenantFilter(req);
  const { status, priority, memberId } = req.query;
  const where = { tenantId: tf.tenantId };
  if (STATUSES.includes(status)) where.status = status;
  if (PRIORITIES.includes(priority)) where.priority = priority;
  if (memberId) where.memberId = String(memberId);
  const [rows, counts] = await Promise.all([
    prisma.serviceRequest.findMany({
      where,
      include: {
        member: { select: { id: true, name: true, email: true } },
        service: prisma.conciergeService ? { select: { id: true, name: true, category: true } } : undefined,
        assignee: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    prisma.serviceRequest.groupBy({ by: ['status'], where: { tenantId: tf.tenantId }, _count: { status: true } }),
  ]);
  res.json({ requests: rows, counts });
});

// GET /:id — staff detail
router.get('/:id', requireRole(...STAFF), async (req, res) => {
  const tf = tenantFilter(req);
  const row = await prisma.serviceRequest.findFirst({
    where: { id: req.params.id, tenantId: tf.tenantId },
    include: {
      member: { select: { id: true, name: true, email: true } },
      service: prisma.conciergeService ? true : undefined,
      assignee: { select: { id: true, name: true, email: true } },
    },
  });
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ request: row });
});

// PATCH /:id — staff: assign / price / priority
router.patch(
  '/:id',
  requireRole(...STAFF),
  validateBody(z.object({
    assignedTo: z.string().min(1).nullable().optional(),
    price: z.number().nonnegative().nullable().optional(),
    priority: z.enum(PRIORITIES).optional(),
  })),
  async (req, res) => {
    const tf = tenantFilter(req);
    const row = await prisma.serviceRequest.findFirst({
      where: { id: req.params.id, tenantId: tf.tenantId },
    });
    if (!row) return res.status(404).json({ error: 'Not found' });
    const data = {};
    if (req.body.priority !== undefined) data.priority = req.body.priority;
    if (req.body.price !== undefined) data.price = req.body.price;
    if (req.body.assignedTo !== undefined) {
      if (req.body.assignedTo) {
        const staff = await prisma.user.findFirst({ where: { id: req.body.assignedTo, tenantId: tf.tenantId } });
        if (!staff) return res.status(422).json({ error: 'Staff user not found' });
        data.assignedTo = staff.id;
      } else data.assignedTo = null;
    }
    const updated = await prisma.serviceRequest.update({ where: { id: row.id }, data });
    audit(req, tf, 'service-request.updated', row.id, data);
    res.json({ id: updated.id, status: updated.status });
  }
);

// POST /:id/status — staff: status change
router.post(
  '/:id/status',
  requireRole(...STAFF),
  validateBody(z.object({ status: z.enum(STATUSES) })),
  async (req, res) => {
    const tf = tenantFilter(req);
    const row = await prisma.serviceRequest.findFirst({
      where: { id: req.params.id, tenantId: tf.tenantId },
    });
    if (!row) return res.status(404).json({ error: 'Not found' });
    const { status } = req.body;
    const data = { status };
    if (status === 'done' && !row.completedAt) data.completedAt = new Date();
    const updated = await prisma.serviceRequest.update({ where: { id: row.id }, data });
    audit(req, tf, `service-request.${status}`, row.id, { status });
    res.json({ id: updated.id, status: updated.status });
  }
);

module.exports = router;
