const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const rideSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  date: z.string().min(1), // YYYY-MM-DD
  time: z.string().min(1), // HH:MM
  seats: z.number().int().min(1).max(8),
  car: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
});

// List rides (open + own), with requester info
router.get('/', async (req, res, next) => {
  try {
    const where = { ...tenantFilter(req), status: { in: ['open', 'full'] } };
    if (req.query.mine === '1') where.driverUserId = req.user.sub || req.user.id;
    const rides = await prisma.ride.findMany({
      where,
      include: {
        requests: {
          where: { status: 'accepted' },
          select: { id: true, requesterName: true, requesterUserId: true, createdAt: true },
        },
      },
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
      take: 100,
    });
    const myId = req.user.sub || req.user.id;
    const shaped = rides.map((r) => ({
      id: r.id,
      driver: r.driverName,
      driverUserId: r.driverUserId,
      from: r.from,
      to: r.to,
      date: String(r.date).slice(0, 10),
      time: r.time,
      seats: r.seatsLeft,
      seatsTotal: r.seatsTotal,
      car: r.car,
      phone: r.phone,
      status: r.status,
      mine: r.driverUserId === myId,
      requested: r.requests.some((q) => q.requesterUserId === myId),
      passengers: r.requests.map((q) => q.requesterName),
    }));
    res.json({ rides: shaped });
  } catch (e) { next(e); }
});

// Offer a ride
router.post('/', validateBody(rideSchema), async (req, res, next) => {
  try {
    const myId = req.user.sub || req.user.id;
    const ride = await prisma.ride.create({
      data: {
        tenantId: req.user.tenantId,
        driverUserId: myId,
        driverName: req.user.name || req.user.email?.split('@')[0] || 'Member',
        from: req.body.from,
        to: req.body.to,
        date: new Date(req.body.date),
        time: req.body.time,
        seatsTotal: req.body.seats,
        seatsLeft: req.body.seats,
        car: req.body.car || null,
        phone: req.body.phone || null,
      },
    });
    await writeAudit(req, 'ride.create', 'Ride', ride.id, null, { from: ride.from, to: ride.to });
    res.status(201).json({ ride });
  } catch (e) { next(e); }
});

// Request a seat
router.post('/:id/request', async (req, res, next) => {
  try {
    const myId = req.user.sub || req.user.id;
    const ride = await prisma.ride.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!ride) return res.status(404).json({ error: 'Ride not found' });
    if (ride.status !== 'open' || ride.seatsLeft <= 0) {
      return res.status(400).json({ error: 'No seats available' });
    }
    if (ride.driverUserId === myId) {
      return res.status(400).json({ error: 'You cannot request your own ride' });
    }
    const existing = await prisma.rideRequest.findFirst({
      where: { rideId: ride.id, requesterUserId: myId, status: 'accepted' },
    });
    if (existing) return res.status(400).json({ error: 'Already requested' });

    const [updated] = await prisma.$transaction([
      prisma.ride.update({
        where: { id: ride.id },
        data: {
          seatsLeft: { decrement: 1 },
          status: ride.seatsLeft - 1 <= 0 ? 'full' : 'open',
        },
      }),
      prisma.rideRequest.create({
        data: {
          tenantId: req.user.tenantId,
          rideId: ride.id,
          requesterUserId: myId,
          requesterName: req.user.name || req.user.email?.split('@')[0] || 'Member',
        },
      }),
    ]);
    await writeAudit(req, 'ride.request', 'Ride', ride.id, null, { seatsLeft: updated.seatsLeft });
    res.json({ ok: true, seatsLeft: updated.seatsLeft });
  } catch (e) { next(e); }
});

// Cancel own request
router.delete('/:id/request', async (req, res, next) => {
  try {
    const myId = req.user.sub || req.user.id;
    const existing = await prisma.rideRequest.findFirst({
      where: { rideId: req.params.id, requesterUserId: myId, status: 'accepted' },
    });
    if (!existing) return res.status(404).json({ error: 'Request not found' });
    await prisma.$transaction([
      prisma.rideRequest.update({ where: { id: existing.id }, data: { status: 'cancelled' } }),
      prisma.ride.update({
        where: { id: req.params.id },
        data: { seatsLeft: { increment: 1 }, status: 'open' },
      }),
    ]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Cancel own ride (driver or admin)
router.delete('/:id', async (req, res, next) => {
  try {
    const myId = req.user.sub || req.user.id;
    const ride = await prisma.ride.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!ride) return res.status(404).json({ error: 'Ride not found' });
    const isAdmin = ['ceo', 'admin', 'super_admin'].includes(req.user.role);
    if (ride.driverUserId !== myId && !isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await prisma.ride.update({ where: { id: ride.id }, data: { status: 'cancelled' } });
    await writeAudit(req, 'ride.cancel', 'Ride', ride.id, { status: ride.status }, { status: 'cancelled' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
