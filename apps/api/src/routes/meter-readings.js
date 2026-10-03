// Phase 51 Track 2: Meter readings — manual readings + consumption compute.
// Mount: app.use('/api/meter-readings', require('./routes/meter-readings')); → server.js
// Sidebar link nahi — meters extend hai.
// Coordinator schema merge: UtilityMeter (Track 1) + MeterReading fragments merge hone chahiyein.
//
// Frontend integration (meter detail page — Track 1 owns apps/web/app/(app)/utilities/meters/page.js):
//   - "Readings" tab: POST /api/meter-readings {meterId, reading, readAt?, photoUrl?} — entry form
//   - GET /api/meter-readings?meterId=<id> — history table (reading, consumption, readAt, readBy)
//   - GET /api/meter-readings?meterId=<id>&consumption=1 — har row me `consumption` (current - previous)
//   - Duplicate guard: response me `duplicateWarning: true` aaye to amber banner dikhayein (same meter, same day)

const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser, requireRole } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);

function notMigrated(res) {
  return res.status(503).json({ error: 'Meter module abhi merge nahi hua (migration pending).' });
}

const readingSchema = z.object({
  meterId: z.string().min(1),
  reading: z.number().min(0),
  readAt: z.string().datetime().optional(),
  photoUrl: z.string().url().max(2000).optional().nullable(),
});

// GET / — history per meter (filters + consumption compute)
router.get('/', requireRole('ceo', 'admin', 'super_admin', 'manager', 'receptionist', 'ops'), async (req, res) => {
  if (!prisma.meterReading) return notMigrated(res);
  const tf = tenantFilter(req);
  try {
    const { meterId, from, to, page = '1', limit = '50', consumption } = req.query;
    const where = { ...tf };
    if (meterId) where.meterId = String(meterId);
    if (from || to) {
      where.readAt = {};
      if (from) where.readAt.gte = new Date(String(from));
      if (to) where.readAt.lte = new Date(String(to));
    }
    const pg = Math.max(1, parseInt(page, 10) || 1);
    const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const [total, rows] = await Promise.all([
      prisma.meterReading.count({ where }),
      prisma.meterReading.findMany({
        where,
        orderBy: { readAt: 'desc' },
        skip: (pg - 1) * lim,
        take: lim,
        include: { meter: { select: { id: true, name: true, type: true } } },
      }),
    ]);

    let items = rows.map((r) => ({
      id: r.id,
      meterId: r.meterId,
      meter: r.meter,
      reading: Number(r.reading),
      readAt: r.readAt,
      readById: r.readById,
      photoUrl: r.photoUrl,
      createdAt: r.createdAt,
      consumption: null,
    }));

    if (consumption && items.length) {
      // Pehli row ke liye previous reading (page ke bahar) bhi chahiye
      const first = items[0];
      const prev = await prisma.meterReading.findFirst({
        where: { ...tf, meterId: first.meterId, readAt: { lt: first.readAt } },
        orderBy: { readAt: 'desc' },
        select: { reading: true },
      });
      let prevVal = prev ? Number(prev.reading) : null;
      // desc order me: consumption = is row ka reading - us se purani row ka reading
      const asc = [...items].reverse();
      let runPrev = prevVal;
      const consMap = {};
      for (const r of asc) {
        consMap[r.id] = runPrev == null ? null : Math.max(0, Number((r.reading - runPrev).toFixed(2)));
        runPrev = r.reading;
      }
      items = items.map((r) => ({ ...r, consumption: consMap[r.id] }));
    }

    res.json({ items, total, page: pg, pages: Math.ceil(total / lim) });
  } catch (e) {
    if (e.code === 'P2022') return notMigrated(res);
    throw e;
  }
});

// POST / — nayi reading (rollback guard + duplicate-day warning)
router.post('/', requireRole('ceo', 'admin', 'super_admin', 'manager', 'receptionist', 'ops'), async (req, res) => {
  if (!prisma.meterReading || !prisma.utilityMeter) return notMigrated(res);
  const tf = tenantFilter(req);
  try {
    const body = readingSchema.parse(req.body);
    const meter = await prisma.utilityMeter.findFirst({ where: { ...tf, id: body.meterId } });
    if (!meter) return res.status(404).json({ error: 'Meter nahi mila.' });
    if (meter.isActive === false) return res.status(422).json({ error: 'Meter inactive hai.' });

    const readAt = body.readAt ? new Date(body.readAt) : new Date();

    // Sab se recent reading (is readAt se pehle)
    const prev = await prisma.meterReading.findFirst({
      where: { ...tf, meterId: body.meterId, readAt: { lte: readAt } },
      orderBy: { readAt: 'desc' },
    });
    if (prev && Number(body.reading) < Number(prev.reading)) {
      return res.status(422).json({
        error: `Reading pichhli reading (${Number(prev.reading)}) se kam hai — meter rollback ya ghalat entry.`,
        previousReading: Number(prev.reading),
      });
    }

    // Duplicate guard: same meter, same calendar day
    const dayStart = new Date(readAt);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const sameDay = await prisma.meterReading.count({
      where: { ...tf, meterId: body.meterId, readAt: { gte: dayStart, lt: dayEnd } },
    });

    const row = await prisma.meterReading.create({
      data: {
        tenantId: tf.tenantId,
        meterId: body.meterId,
        reading: body.reading,
        readAt,
        readById: req.user.id || null,
        photoUrl: body.photoUrl || null,
      },
    });

    writeAudit({
      tenantId: tf.tenantId,
      actorId: req.user.id,
      action: 'meter.reading.create',
      entity: 'MeterReading',
      entityId: row.id,
      newValue: { meterId: body.meterId, reading: body.reading },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    }).catch(() => {});

    res.status(201).json({
      id: row.id,
      reading: Number(row.reading),
      readAt: row.readAt,
      consumption: prev ? Math.max(0, Number((Number(body.reading) - Number(prev.reading)).toFixed(2))) : null,
      duplicateWarning: sameDay > 0,
    });

    // Phase 51: abnormal consumption check (fire-and-forget)
    try { require('../lib/utilityAlerts').maybeCheckReading({ tenantId: tf.tenantId, meterId: body.meterId }).catch(() => {}); } catch {}
  } catch (e) {
    if (e.code === 'P2022') return notMigrated(res);
    if (e.name === 'ZodError') return res.status(400).json({ error: 'Ghalat input.', details: e.errors });
    throw e;
  }
});

// DELETE /:id — ghalat reading hatana
router.delete('/:id', requireRole('ceo', 'admin', 'super_admin', 'manager'), async (req, res) => {
  if (!prisma.meterReading) return notMigrated(res);
  const tf = tenantFilter(req);
  try {
    const row = await prisma.meterReading.findFirst({ where: { ...tf, id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Reading nahi mili.' });
    await prisma.meterReading.delete({ where: { id: row.id } });
    writeAudit({
      tenantId: tf.tenantId,
      actorId: req.user.id,
      action: 'meter.reading.delete',
      entity: 'MeterReading',
      entityId: row.id,
      oldValue: { meterId: row.meterId, reading: Number(row.reading) },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    }).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'P2022') return notMigrated(res);
    throw e;
  }
});

module.exports = router;
