// Phase 30 Track 10: Public booking requests.
// Public endpoints: NO auth (rate-limited + validated). Staff endpoints: JWT + roles.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimit');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

// Spam protection: 5 requests per 10 minutes per IP.
const publicRequestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: 'Too many booking requests. Please try again later.',
});

// Resolve the public tenant: env slug, else first active tenant.
async function resolvePublicTenant() {
  const slug = process.env.PUBLIC_TENANT_SLUG;
  if (slug) {
    const t = await prisma.tenant.findFirst({ where: { slug, isActive: true } });
    if (t) return t;
  }
  return prisma.tenant.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
}

// ---------------------------------------------------------------------------
// PUBLIC (no auth)
// ---------------------------------------------------------------------------

// Public unit list — bookable (vacant) units, basic info only.
router.get('/units', rateLimit({ windowMs: 60000, max: 60 }), async (req, res, next) => {
  try {
    const tenant = await resolvePublicTenant();
    if (!tenant) return res.status(503).json({ error: { message: 'Booking is not available right now.' } });
    const units = await prisma.unit.findMany({
      where: { tenantId: tenant.id, status: 'vacant' },
      select: { id: true, code: true, type: true, capacity: true, monthlyPrice: true, amenities: true },
      orderBy: { code: 'asc' },
    });
    res.json({ tenant: { name: tenant.name, slug: tenant.slug }, units });
  } catch (e) { next(e); }
});

const requestSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().max(150),
  phone: z.string().min(7).max(20),
  unitId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'startTime must be HH:mm'),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'endTime must be HH:mm'),
  notes: z.string().max(1000).optional().nullable(),
}).refine((d) => d.endTime > d.startTime, { message: 'endTime must be after startTime' });

// Submit a public booking request.
router.post('/request', publicRequestLimiter, validateBody(requestSchema), async (req, res, next) => {
  try {
    const tenant = await resolvePublicTenant();
    if (!tenant) return res.status(503).json({ error: { message: 'Booking is not available right now.' } });
    const { name, email, phone, unitId, date, startTime, endTime, notes } = req.body;

    const unit = await prisma.unit.findFirst({ where: { id: unitId, tenantId: tenant.id } });
    if (!unit) return res.status(400).json({ error: { message: 'Selected space is not available.' } });

    const day = new Date(`${date}T00:00:00`);
    if (Number.isNaN(day.getTime()) || day < new Date(new Date().toDateString())) {
      return res.status(400).json({ error: { message: 'Date must be today or in the future.' } });
    }

    // Overlap check against confirmed bookings on that unit/day.
    const startAt = new Date(`${date}T${startTime}:00`);
    const endAt = new Date(`${date}T${endTime}:00`);
    const clash = await prisma.booking.findFirst({
      where: {
        tenantId: tenant.id,
        unitId,
        status: 'confirmed',
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true },
    });
    if (clash) {
      return res.status(409).json({ error: { message: 'This time slot is already booked. Please choose another.' } });
    }

    const request = await prisma.bookingRequest.create({
      data: {
        tenantId: tenant.id,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        unitId,
        date: day,
        startTime,
        endTime,
        notes: notes?.trim() || null,
        status: 'pending',
      },
      include: { unit: { select: { code: true, type: true } } },
    });

    // Notify staff (in-app, fire-and-forget)
    try {
      const staff = await prisma.user.findMany({
        where: { tenantId: tenant.id, isActive: true, role: { in: ['ceo', 'admin', 'manager', 'receptionist', 'super_admin'] } },
        select: { id: true },
      });
      await prisma.notification.createMany({
        data: staff.map((u) => ({
          tenantId: tenant.id,
          userId: u.id,
          type: 'general',
          message: `New booking request: ${request.name} requested ${request.unit.code} on ${date} ${startTime}–${endTime}.`,
        })),
      });
    } catch { /* notifications must not break the request */ }

    res.status(201).json({ ok: true, message: 'Request received! We will confirm shortly.' });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// STAFF (auth required)
// ---------------------------------------------------------------------------
const STAFF_ROLES = ['ceo', 'admin', 'super_admin', 'manager', 'receptionist', 'operations_manager'];
const staffOnly = [authenticate, requireTenantUser, requireRole(...STAFF_ROLES)];

// List booking requests (staff).
router.get('/requests', staffOnly, async (req, res, next) => {
  try {
    const { status } = req.query;
    const where = { tenantId: req.user.tenantId };
    if (status && ['pending', 'approved', 'rejected'].includes(status)) where.status = status;
    const requests = await prisma.bookingRequest.findMany({
      where,
      include: { unit: { select: { id: true, code: true, type: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ requests });
  } catch (e) { next(e); }
});

// Approve → find/create member + create confirmed booking.
router.post('/requests/:id/approve', staffOnly, async (req, res, next) => {
  try {
    const tenantId = req.user.tenantId;
    const br = await prisma.bookingRequest.findFirst({
      where: { id: req.params.id, tenantId },
      include: { unit: { select: { code: true } } },
    });
    if (!br) return res.status(404).json({ error: { message: 'Request not found' } });
    if (br.status !== 'pending') return res.status(400).json({ error: { message: `Request is already ${br.status}` } });

    const startAt = new Date(`${br.date.toISOString().slice(0, 10)}T${br.startTime}:00`);
    const endAt = new Date(`${br.date.toISOString().slice(0, 10)}T${br.endTime}:00`);
    const clash = await prisma.booking.findFirst({
      where: { tenantId, unitId: br.unitId, status: 'confirmed', startAt: { lt: endAt }, endAt: { gt: startAt } },
      select: { id: true },
    });
    if (clash) return res.status(409).json({ error: { message: 'Time slot was taken meanwhile. Reject or pick another slot.' } });

    // Find member by email, else create one.
    let member = await prisma.member.findFirst({ where: { tenantId, email: br.email } });
    if (!member) {
      member = await prisma.member.create({
        data: { tenantId, name: br.name, email: br.email, phone: br.phone, notes: 'Created from public booking request' },
      });
    }

    const booking = await prisma.booking.create({
      data: {
        tenantId,
        unitId: br.unitId,
        memberId: member.id,
        title: `Public request — ${br.name}`,
        startAt,
        endAt,
        status: 'confirmed',
        createdById: req.user.sub,
      },
    });
    await prisma.bookingRequest.update({ where: { id: br.id }, data: { status: 'approved' } });

    await writeAudit({
      tenantId, actorId: req.user.sub, action: 'booking_request.approved',
      entity: 'BookingRequest', entityId: br.id, ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});

    // Confirmation email to requester (queued, fire-and-forget)
    try {
      const { notify } = require('../lib/mailer');
      await notify(tenantId, br.email, 'bookingConfirmed', {
        memberName: br.name, unitCode: br.unit.code,
        date: br.date.toISOString().slice(0, 10), startTime: br.startTime,
      });
    } catch { /* ignore */ }

    res.json({ ok: true, booking: { id: booking.id }, member: { id: member.id, name: member.name } });
  } catch (e) { next(e); }
});

// Reject a request.
router.post('/requests/:id/reject', staffOnly, async (req, res, next) => {
  try {
    const tenantId = req.user.tenantId;
    const br = await prisma.bookingRequest.findFirst({ where: { id: req.params.id, tenantId } });
    if (!br) return res.status(404).json({ error: { message: 'Request not found' } });
    if (br.status !== 'pending') return res.status(400).json({ error: { message: `Request is already ${br.status}` } });
    await prisma.bookingRequest.update({ where: { id: br.id }, data: { status: 'rejected' } });
    await writeAudit({
      tenantId, actorId: req.user.sub, action: 'booking_request.rejected',
      entity: 'BookingRequest', entityId: br.id, ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
