// Phase 48 Track 3/10: Access Logs — staff access log viewer, CSV export, manual entry.
// Coordinator ke liye:
//   Mount: app.use('/api/access-logs', require('./routes/access-logs'));
//   Sidebar link nahi — access section extend hai (doors page me "Logs" tab / access dashboard).
//   Schema merge: fragments/access-logs.prisma → schema.prisma + migration (fragment comments me).
//   Dependency: Track 1 ka Door model (doors.prisma) PEHLE merge hona chahiye (503 guard usi par hai).
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'manager', 'receptionist', 'ops'));

// Model merge na hua ho to safe 503 (koi 500 nahi)
function logOr503(res) {
  if (!prisma.accessLog) {
    res.status(503).json({ error: 'Access module abhi migrate nahi hua.' });
    return null;
  }
  return prisma.accessLog;
}

const RESULTS = ['granted', 'denied'];
const DIRECTIONS = ['in', 'out'];

const manualSchema = z.object({
  doorId: z.string().cuid(),
  memberId: z.string().cuid().optional().nullable(),
  direction: z.enum(DIRECTIONS),
  result: z.enum(RESULTS).default('granted'),
  reason: z.string().max(500).optional().nullable(),
  credentialType: z.string().max(20).default('manual'),
});

function buildWhere(req) {
  const tf = tenantFilter(req);
  const where = { ...tf };
  if (req.query.doorId) where.doorId = String(req.query.doorId);
  if (req.query.memberId) where.memberId = String(req.query.memberId);
  if (req.query.result) {
    if (!RESULTS.includes(String(req.query.result))) throw new Error('Ghalat result filter.');
    where.result = String(req.query.result);
  }
  if (req.query.direction) {
    if (!DIRECTIONS.includes(String(req.query.direction))) throw new Error('Ghalat direction filter.');
    where.direction = String(req.query.direction);
  }
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;
  if (from || to) {
    where.createdAt = {};
    if (from && !Number.isNaN(from)) where.createdAt.gte = from;
    if (to && !Number.isNaN(to)) where.createdAt.lte = to;
  }
  if (req.query.search) {
    const q = String(req.query.search);
    where.OR = [
      { member: { name: { contains: q, mode: 'insensitive' } } },
      { member: { email: { contains: q, mode: 'insensitive' } } },
      { door: { name: { contains: q, mode: 'insensitive' } } },
      { reason: { contains: q, mode: 'insensitive' } },
    ];
  }
  return where;
}

const logInclude = {
  door: { select: { id: true, name: true, location: true } },
  member: { select: { id: true, name: true, email: true } },
};

// GET /api/access-logs — logs (filters: doorId, memberId, result, direction, from, to, search, page, limit)
router.get('/', async (req, res, next) => {
  try {
    const AL = logOr503(res); if (!AL) return;
    let where;
    try { where = buildWhere(req); } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const [total, logs] = await Promise.all([
      AL.count({ where }),
      AL.findMany({
        where,
        include: logInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    res.json({ logs, total, page, pages: Math.ceil(total / limit) });
  } catch (e) { next(e); }
});

function escCsv(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /api/access-logs/export.csv — CSV export (same filters)
router.get('/export.csv', async (req, res, next) => {
  try {
    const AL = logOr503(res); if (!AL) return;
    let where;
    try { where = buildWhere(req); } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const logs = await AL.findMany({
      where,
      include: logInclude,
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    const header = ['Time', 'Door', 'Member', 'Email', 'Direction', 'Result', 'Credential', 'Reason'];
    const rows = [header];
    for (const l of logs) {
      rows.push([
        l.createdAt ? new Date(l.createdAt).toISOString() : '',
        (l.door && l.door.name) || '',
        (l.member && l.member.name) || '',
        (l.member && l.member.email) || '',
        l.direction || '',
        l.result || '',
        l.credentialType || '',
        l.reason || '',
      ]);
    }
    const csv = '\uFEFF' + rows.map((r) => r.map(escCsv).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="access-logs.csv"');
    res.send(csv);
  } catch (e) { next(e); }
});

// POST /api/access-logs/manual — reception manual entry (door + direction)
router.post('/manual', async (req, res, next) => {
  try {
    const AL = logOr503(res); if (!AL) return;
    const tf = tenantFilter(req);
    const parsed = manualSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Ghalat data.', detail: parsed.error.issues });
    }
    const d = parsed.data;
    // Door tenant-scoped check
    const door = prisma.door
      ? await prisma.door.findFirst({ where: { id: d.doorId, ...tf } })
      : null;
    if (!door) return res.status(404).json({ error: 'Door nahi mila.' });
    if (d.memberId) {
      const member = await prisma.member.findFirst({ where: { id: d.memberId, ...tf } });
      if (!member) return res.status(404).json({ error: 'Member nahi mila.' });
    }
    const log = await AL.create({
      data: {
        tenantId: tf.tenantId,
        doorId: d.doorId,
        memberId: d.memberId || null,
        direction: d.direction,
        result: d.result,
        reason: d.reason || null,
        credentialType: d.credentialType,
        createdById: req.user && req.user.id ? req.user.id : null,
      },
      include: logInclude,
    });
    try {
      await writeAudit(req, {
        action: 'access-log.manual_entry',
        entity: 'AccessLog',
        entityId: log.id,
        newValue: { doorId: d.doorId, memberId: d.memberId, direction: d.direction, result: d.result },
      });
    } catch {}
    res.status(201).json({ log });
  } catch (e) { next(e); }
});

module.exports = router;

// Phase 48: manual anomaly scan trigger (ceo/admin)
router.post('/scan', requireRole('ceo', 'admin'), async (req, res, next) => {
  try {
    const { scanAllTenants } = require('../lib/accessAnomalies');
    const result = await scanAllTenants();
    res.json({ ok: true, result: result || null });
  } catch (e) { next(e); }
});
