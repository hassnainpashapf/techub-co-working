const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { emitWebhook } = require('../lib/webhooks');
const { authenticateAny, requireScope } = require('../middleware/apiKey');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { checkLimit } = require('../lib/limits');
const { invalidateTenantCache } = require('../middleware/cache');
// Phase 28: audit coverage
const { writeAudit } = require('../middleware/audit');
const auditAsync = (data) => writeAudit(data).catch(() => {});

const router = express.Router();

router.use(authenticateAny, requireTenantUser);
router.use(invalidateTenantCache);

const WRITE_ROLES = ['ceo', 'admin', 'manager', 'receptionist', 'operations_manager'];
const write = requireRole(...WRITE_ROLES);

const MEMBER_STATUSES = ['active', 'trial', 'on_hold', 'exited'];

// ------------------------------------------------------------ bulk actions ---
// Phase 30: bulk member operations (ceo/admin/manager only)
const BULK_ROLES = ['ceo', 'admin', 'manager', 'super_admin'];
const bulkWrite = requireRole(...BULK_ROLES);

const bulkStatusSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  status: z.enum(['active', 'trial', 'on_hold']),
});

router.post('/bulk/status', bulkWrite, validateBody(bulkStatusSchema), async (req, res, next) => {
  try {
    const { ids, status } = req.body;
    const result = await prisma.member.updateMany({
      where: { id: { in: ids }, ...tenantFilter(req) },
      data: { status },
    });
    auditAsync({ tenantId: req.user.tenantId, actorId: req.user.sub, action: 'member.bulk_status', entity: 'Member', newValue: { count: result.count, status }, ip: req.ip, userAgent: req.headers['user-agent'] });
    return res.json({ updated: result.count });
  } catch (err) {
    return next(err);
  }
});

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
});

router.post('/bulk/delete', bulkWrite, validateBody(bulkDeleteSchema), async (req, res, next) => {
  try {
    const { ids } = req.body;
    // Soft delete: mark exited (hard delete nahi)
    const result = await prisma.member.updateMany({
      where: { id: { in: ids }, ...tenantFilter(req) },
      data: { status: 'exited' },
    });
    auditAsync({ tenantId: req.user.tenantId, actorId: req.user.sub, action: 'member.bulk_delete', entity: 'Member', newValue: { count: result.count }, ip: req.ip, userAgent: req.headers['user-agent'] });
    return res.json({ updated: result.count });
  } catch (err) {
    return next(err);
  }
});

const memberSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().min(1),
  cnic: z.string().optional().nullable(),
  companyName: z.string().optional().nullable(),
  companyId: z.string().optional().nullable(),
  emergencyContact: z.string().optional().nullable(),
  status: z.enum(MEMBER_STATUSES).default('active'),
  notes: z.string().optional().nullable(),
  creditLimit: z.number().nonnegative().optional().nullable(),
});
const memberUpdateSchema = memberSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });

// Phase 31: credit limit may only be set by finance-privileged roles.
const CREDIT_ROLES = ['ceo', 'admin', 'super_admin', 'finance_officer'];
function stripCreditLimit(user, data) {
  if (data.creditLimit !== undefined && !CREDIT_ROLES.includes(user.role)) {
    const { creditLimit: _omit, ...rest } = data;
    return rest;
  }
  return data;
}

// Resolve companyId (tenant-scoped) and sync companyName from the linked company.
async function resolveCompany(tenantId, data) {
  const out = { ...data };
  if (out.companyId) {
    const company = await prisma.company.findFirst({ where: { id: out.companyId, tenantId } });
    if (!company) {
      const err = new Error('Company not found');
      err.status = 400;
      throw err;
    }
    out.companyName = company.name;
  }
  return out;
}

function memberScope(req) {
  const where = { ...tenantFilter(req) };
  // The member portal can only ever see its own record.
  if (req.user.role === 'member') where.id = req.user.memberId;
  return where;
}

// Own member record (for member portal profile)
router.get('/me', async (req, res, next) => {
  try {
    if (!req.user.memberId) return res.status(404).json({ error: { message: 'No member record linked' } });
    const member = await prisma.member.findFirst({
      where: { id: req.user.memberId, ...tenantFilter(req) },
    });
    if (!member) return res.status(404).json({ error: { message: 'Member not found' } });
    return res.json({ member });
  } catch (err) {
    return next(err);
  }
});

router.get('/', requireScope('members:read'), async (req, res, next) => {
  try {
    const where = memberScope(req);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.search) {
      const s = String(req.query.search);
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s, mode: 'insensitive' } },
        { companyName: { contains: s, mode: 'insensitive' } },
      ];
    }
    const members = await prisma.member.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ members });
  } catch (err) {
    return next(err);
  }
});

router.post('/', write, validateBody(memberSchema), async (req, res, next) => {
  try {
    // Phase 22: enforce plan member limit
    const limit = await checkLimit(req.user.tenantId, 'members');
    if (!limit.allowed) {
      return res.status(402).json({
        error: { message: `Member limit reached (${limit.used}/${limit.limit}). Upgrade your plan to add more members.` },
      });
    }
    const data = await resolveCompany(req.user.tenantId, req.body);
    const member = await prisma.member.create({
      data: { ...tenantFilter(req), ...stripCreditLimit(req.user, data) },
    });
    emitWebhook(req.user.tenantId, 'member.created', { id: member.id, name: member.name, email: member.email });
    auditAsync({ tenantId: req.user.tenantId, actorId: req.user.sub, action: 'member.create', entity: 'Member', entityId: member.id, newValue: { name: member.name }, ip: req.ip, userAgent: req.headers['user-agent'] });
    return res.status(201).json({ member });
  } catch (err) {
    return next(err);
  }
});

router.get('/:id/timeline', async (req, res, next) => {
  try {
    if (req.user.role === 'member' && req.params.id !== req.user.memberId) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }
    const where = { id: req.params.id, ...tenantFilter(req) };
    const member = await prisma.member.findFirst({ where, include: { user: { select: { id: true } } } });
    if (!member) return res.status(404).json({ error: { message: 'Member not found' } });

    const mWhere = { memberId: member.id, ...tenantFilter(req) };
    const [
      contracts, invoices, bookings, tickets, visits, refunds, creditNotes, documents,
    ] = await Promise.all([
      prisma.contract.findMany({ where: mWhere, include: { unit: { select: { code: true } } }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.invoice.findMany({ where: mWhere, select: { id: true, number: true, createdAt: true, status: true, amount: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.booking.findMany({ where: mWhere, select: { id: true, createdAt: true, status: true, startAt: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.ticket.findMany({ where: mWhere, select: { id: true, createdAt: true, status: true, title: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.visitor.findMany({ where: { hostMemberId: member.id, ...tenantFilter(req) }, select: { id: true, createdAt: true, name: true, checkInAt: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.refund.findMany({ where: mWhere, select: { id: true, number: true, createdAt: true, status: true, amount: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.creditNote.findMany({ where: mWhere, select: { id: true, number: true, createdAt: true, status: true, amount: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.document.findMany({ where: mWhere, select: { id: true, createdAt: true, title: true, category: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);

    // Attendance is linked to the member's user account
    const attendance = member.user
      ? await prisma.attendanceRecord.findMany({
          where: { userId: member.user.id, ...tenantFilter(req) },
          select: { id: true, createdAt: true, date: true, checkIn: true },
          orderBy: { date: 'desc' }, take: 50,
        })
      : [];

    // Payments linked through member invoices
    const invoiceIds = invoices.map((i) => i.id);
    const payments = invoiceIds.length
      ? await prisma.payment.findMany({
          where: { invoiceId: { in: invoiceIds }, ...tenantFilter(req) },
          select: { id: true, createdAt: true, amount: true, method: true, receiptNo: true },
          orderBy: { createdAt: 'desc' }, take: 50,
        })
      : [];

    const events = [
      { type: 'joined', at: member.createdAt, title: 'Member joined', detail: member.name, icon: '👤', tone: 'blue' },
      ...contracts.map((c) => ({ type: 'contract', at: c.createdAt, title: `Contract ${c.status}`, detail: c.unit?.code || '', icon: '📄', tone: 'violet' })),
      ...invoices.map((i) => ({ type: 'invoice', at: i.createdAt, title: `Invoice ${i.number}`, detail: `Rs ${Number(i.amount).toLocaleString()} · ${i.status}`, icon: '🧾', tone: 'amber' })),
      ...payments.map((p) => ({ type: 'payment', at: p.createdAt, title: 'Payment received', detail: `Rs ${Number(p.amount).toLocaleString()} · ${p.method || ''}`, icon: '💰', tone: 'green' })),
      ...bookings.map((b) => ({ type: 'booking', at: b.createdAt, title: `Booking ${b.status}`, detail: b.startAt ? String(b.startAt).slice(0, 16).replace('T', ' ') : '', icon: '📅', tone: 'cyan' })),
      ...tickets.map((t) => ({ type: 'ticket', at: t.createdAt, title: 'Ticket raised', detail: `${t.title || ''} · ${t.status}`, icon: '🎫', tone: 'red' })),
      ...visits.map((v) => ({ type: 'visitor', at: v.checkInAt || v.createdAt, title: 'Hosted visitor', detail: v.name, icon: '🧑‍💼', tone: 'slate' })),
      ...attendance.map((a) => ({ type: 'attendance', at: a.checkIn || a.createdAt, title: 'Checked in', detail: a.date ? String(a.date).slice(0, 10) : '', icon: '✅', tone: 'green' })),
      ...refunds.map((r) => ({ type: 'refund', at: r.createdAt, title: `Refund ${r.status}`, detail: `${r.number} · Rs ${Number(r.amount).toLocaleString()}`, icon: '↩️', tone: 'orange' })),
      ...creditNotes.map((c) => ({ type: 'credit', at: c.createdAt, title: `Credit note ${c.status}`, detail: `${c.number} · Rs ${Number(c.amount).toLocaleString()}`, icon: '🎟️', tone: 'violet' })),
      ...documents.map((d) => ({ type: 'document', at: d.createdAt, title: 'Document added', detail: `${d.title} · ${d.category || ''}`, icon: '📎', tone: 'slate' })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 100);

    return res.json({ events });
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    if (req.user.role === 'member' && req.params.id !== req.user.memberId) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }
    const member = await prisma.member.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: {
        company: { select: { id: true, name: true, industry: true } },
        contracts: {
          include: { unit: { select: { id: true, code: true, type: true } } },
          orderBy: { createdAt: 'desc' },
        },
        invoices: {
          include: { _count: { select: { payments: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!member) return res.status(404).json({ error: { message: 'Member not found' } });
    const totals = {
      invoices: member.invoices.length,
      billed: member.invoices.reduce((s, i) => s + Number(i.amount), 0),
      paid: member.invoices.reduce((s, i) => s + Number(i.amountPaid), 0),
    };
    return res.json({ member, totals });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', write, validateBody(memberUpdateSchema), async (req, res, next) => {
  try {
    const existing = await prisma.member.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Member not found' } });
    const data = await resolveCompany(req.user.tenantId, req.body);
    const member = await prisma.member.update({ where: { id: existing.id }, data: stripCreditLimit(req.user, data) });
    auditAsync({ tenantId: req.user.tenantId, actorId: req.user.sub, action: 'member.update', entity: 'Member', entityId: member.id, ip: req.ip, userAgent: req.headers['user-agent'] });
    return res.json({ member });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', write, async (req, res, next) => {
  try {
    const existing = await prisma.member.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Member not found' } });
    const activeContracts = await prisma.contract.count({
      where: { memberId: existing.id, status: 'active' },
    });
    if (activeContracts > 0) {
      return res.status(400).json({
        error: { message: 'Cannot delete member: they have active contracts' },
      });
    }
    await prisma.member.delete({ where: { id: existing.id } });
    auditAsync({ tenantId: req.user.tenantId, actorId: req.user.sub, action: 'member.delete', entity: 'Member', entityId: existing.id, oldValue: { name: existing.name }, ip: req.ip, userAgent: req.headers['user-agent'] });
    return res.json({ deleted: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
