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

const WRITE_ROLES = ['ceo', 'admin', 'manager', 'receptionist', 'operations_manager'];
const write = requireRole(...WRITE_ROLES);

const PURPOSES = ['meeting', 'tour', 'interview', 'delivery', 'other'];

const visitorSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  cnic: z.string().optional().nullable(),
  purpose: z.enum(PURPOSES).default('meeting'),
  hostMemberId: z.string().optional().nullable(),
  hostName: z.string().optional().nullable(),
  badgeNo: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const includeVisitor = {
  hostMember: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
};

// List visitors (today's by default)
router.get('/', async (req, res, next) => {
  try {
    const where = { ...tenantFilter(req) };
    if (req.query.date) {
      const d = new Date(String(req.query.date));
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      where.checkInAt = { gte: d, lt: next };
    } else if (req.query.today === 'true') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      where.checkInAt = { gte: start };
    }
    if (req.query.inside === 'true') where.checkOutAt = null;
    if (req.query.search) {
      where.name = { contains: String(req.query.search), mode: 'insensitive' };
    }
    const visitors = await prisma.visitor.findMany({
      where,
      include: includeVisitor,
      orderBy: { checkInAt: 'desc' },
    });
    res.json({ visitors });
  } catch (e) { next(e); }
});

// Check-in
router.post('/check-in', write, validateBody(visitorSchema), async (req, res, next) => {
  try {
    const visitor = await prisma.visitor.create({
      data: { ...req.body, tenantId: req.user.tenantId, createdById: req.user.id },
      include: {
        ...includeVisitor,
        hostMember: { select: { id: true, name: true, email: true } },
      },
    });
    await writeAudit(req, 'visitor.checkin', 'Visitor', visitor.id, null, { name: visitor.name });
    // Notify host member by email (non-blocking)
    if (visitor.hostMember?.email) {
      const { notify } = require('../lib/mailer');
      notify(req.user.tenantId, visitor.hostMember.email, 'visitorCheckin', {
        hostName: visitor.hostMember.name,
        visitorName: visitor.name,
      }).catch(() => {});
    }
    res.status(201).json({ visitor });
  } catch (e) { next(e); }
});

// Check-out
router.post('/:id/check-out', write, async (req, res, next) => {
  try {
    const existing = await prisma.visitor.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Visitor not found' });
    if (existing.checkOutAt) return res.status(400).json({ error: 'Already checked out' });
    const visitor = await prisma.visitor.update({
      where: { id: req.params.id },
      data: { checkOutAt: new Date() },
      include: includeVisitor,
    });
    await writeAudit(req, 'visitor.checkout', 'Visitor', visitor.id, null, { name: visitor.name });
    res.json({ visitor });
  } catch (e) { next(e); }
});

// Delete record
router.delete('/:id', write, async (req, res, next) => {
  try {
    const visitor = await prisma.visitor.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!visitor) return res.status(404).json({ error: 'Visitor not found' });
    await prisma.visitor.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
