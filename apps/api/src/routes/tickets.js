const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { emitWebhook } = require('../lib/webhooks');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const WRITE_ROLES = ['ceo', 'admin', 'manager', 'receptionist', 'operations_manager'];
const write = requireRole(...WRITE_ROLES);

const CATEGORIES = ['maintenance', 'billing', 'it', 'housekeeping', 'security', 'general'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUSES = ['open', 'in_progress', 'on_hold', 'resolved', 'closed'];

const ticketSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  category: z.enum(CATEGORIES).default('general'),
  priority: z.enum(PRIORITIES).default('medium'),
  memberId: z.string().optional().nullable(),
  unitId: z.string().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
});
const ticketUpdateSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().optional().nullable(),
    category: z.enum(CATEGORIES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    status: z.enum(STATUSES).optional(),
    memberId: z.string().optional().nullable(),
    assignedToId: z.string().optional().nullable(),
    unitId: z.string().optional().nullable(),
    dueDate: z.coerce.date().optional().nullable(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });

const commentSchema = z.object({
  body: z.string().min(1),
  isInternal: z.boolean().default(false),
});

const includeTicket = {
  member: { select: { id: true, name: true } },
  reportedBy: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
  unit: { select: { id: true, code: true } },
  _count: { select: { comments: true } },
};

function ticketScope(req) {
  const where = { ...tenantFilter(req) };
  // Member portal: only own tickets (reported by them or linked to their member record).
  if (req.user.role === 'member') {
    where.OR = [
      { reportedById: req.user.id },
      ...(req.user.memberId ? [{ memberId: req.user.memberId }] : []),
    ];
  }
  return where;
}

// Next ticket number for tenant
async function nextTicketNumber(tenantId) {
  const last = await prisma.ticket.findFirst({
    where: { tenantId },
    orderBy: { ticketNumber: 'desc' },
    select: { ticketNumber: true },
  });
  return (last?.ticketNumber || 0) + 1;
}

// List tickets
router.get('/', async (req, res, next) => {
  try {
    const where = ticketScope(req);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.priority) where.priority = String(req.query.priority);
    if (req.query.category) where.category = String(req.query.category);
    if (req.query.assignedToId) where.assignedToId = String(req.query.assignedToId);
    if (req.query.search) {
      const s = String(req.query.search);
      where.OR = [
        ...(where.OR || []),
        { title: { contains: s, mode: 'insensitive' } },
      ];
    }
    const tickets = await prisma.ticket.findMany({
      where,
      include: includeTicket,
      orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    });
    res.json({ tickets });
  } catch (e) { next(e); }
});

// Stats for dashboard badges
router.get('/stats', async (req, res, next) => {
  try {
    const where = ticketScope(req);
    const [open, inProgress, urgent] = await Promise.all([
      prisma.ticket.count({ where: { ...where, status: 'open' } }),
      prisma.ticket.count({ where: { ...where, status: 'in_progress' } }),
      prisma.ticket.count({ where: { ...where, status: { in: ['open', 'in_progress'] }, priority: 'urgent' } }),
    ]);
    res.json({ stats: { open, inProgress, urgent } });
  } catch (e) { next(e); }
});

// Get one ticket with comments
router.get('/:id', async (req, res, next) => {
  try {
    const ticket = await prisma.ticket.findFirst({
      where: { id: req.params.id, ...ticketScope(req) },
      include: {
        ...includeTicket,
        comments: {
          include: { author: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    // Hide internal notes from members
    if (req.user.role === 'member') {
      ticket.comments = ticket.comments.filter((c) => !c.isInternal);
    }
    res.json({ ticket });
  } catch (e) { next(e); }
});

// Create ticket
router.post('/', validateBody(ticketSchema), async (req, res, next) => {
  try {
    const tenantId = req.user.tenantId;
    const ticketNumber = await nextTicketNumber(tenantId);
    const data = {
      ...req.body,
      tenantId,
      ticketNumber,
      reportedById: req.user.id,
    };
    // Auto-link member record if reporter is a member-portal user
    if (req.user.role === 'member' && req.user.memberId && !data.memberId) {
      data.memberId = req.user.memberId;
    }
    const ticket = await prisma.ticket.create({ data, include: includeTicket });
    await writeAudit(req, 'ticket.create', 'Ticket', ticket.id, null, { title: ticket.title });
    emitWebhook(req.user.tenantId, 'ticket.created', { id: ticket.id, title: ticket.title, priority: ticket.priority });
    // Slack integration (Phase 36) — urgent tickets only, fire-and-forget
    if (ticket.priority === 'urgent') {
      require('../lib/slack').notifyEvent(req.user.tenantId, 'ticket_urgent', { id: ticket.id, ticketNumber: ticket.ticketNumber, title: ticket.title }).catch(() => {});
    }
    res.status(201).json({ ticket });
  } catch (e) { next(e); }
});

// Update ticket
router.patch('/:id', write, validateBody(ticketUpdateSchema), async (req, res, next) => {
  try {
    const existing = await prisma.ticket.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Ticket not found' });

    const data = { ...req.body };
    if (data.status === 'resolved' && existing.status !== 'resolved') data.resolvedAt = new Date();
    if (data.status === 'closed' && existing.status !== 'closed') data.closedAt = new Date();

    const ticket = await prisma.ticket.update({
      where: { id: req.params.id },
      data,
      include: {
        ...includeTicket,
        member: { select: { id: true, name: true, email: true } },
      },
    });
    await writeAudit(req, 'ticket.update', 'Ticket', ticket.id, { status: existing.status }, { status: ticket.status });
    emitWebhook(req.user.tenantId, 'ticket.updated', { id: ticket.id, title: ticket.title, status: ticket.status, prevStatus: existing.status });
    // Email notification on status change (non-blocking)
    if (data.status && data.status !== existing.status && ticket.member?.email) {
      const { notify } = require('../lib/mailer');
      notify(req.user.tenantId, ticket.member.email, 'ticketUpdate', {
        memberName: ticket.member.name,
        ticketNo: ticket.ticketNumber || ticket.id.slice(-6),
        status: data.status.replace('_', ' '),
      }).catch(() => {});
    }
    res.json({ ticket });
  } catch (e) { next(e); }
});

// Add comment
router.post('/:id/comments', validateBody(commentSchema), async (req, res, next) => {
  try {
    const ticket = await prisma.ticket.findFirst({
      where: { id: req.params.id, ...ticketScope(req) },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    // Members cannot post internal notes
    const isInternal = req.user.role === 'member' ? false : req.body.isInternal;
    const comment = await prisma.ticketComment.create({
      data: {
        tenantId: req.user.tenantId,
        ticketId: ticket.id,
        authorId: req.user.id,
        body: req.body.body,
        isInternal,
      },
      include: { author: { select: { id: true, name: true } } },
    });
    res.status(201).json({ comment });
  } catch (e) { next(e); }
});

// Delete ticket
router.delete('/:id', write, async (req, res, next) => {
  try {
    const ticket = await prisma.ticket.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    await prisma.ticket.delete({ where: { id: req.params.id } });
    await writeAudit(req, 'ticket.delete', 'Ticket', req.params.id, { title: ticket.title }, null);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
