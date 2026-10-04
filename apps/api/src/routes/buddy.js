// Phase 54 Track 4/10: Buddy/Mentor Program — newcomers ko experienced buddy members assign.
// Coordinator ke liye:
//   Mount: app.use('/api/buddy', require('./routes/buddy'));
//   Sidebar link nahi — success/onboarding section extend hai
//   Onboarding page integration (Track 1: apps/web/app/(app)/success/onboarding/page.js):
//     journey detail me "🤝 Buddy" section joro —
//       GET /api/buddy?newcomerId=<memberId> se pair lao (agar hai to buddy card: naam, email, assignedAt, notes);
//       nahi hai to "Suggest buddy" → GET /api/buddy/suggest?newcomerId=<memberId> se top candidates,
//       phir POST /api/buddy { newcomerId, buddyId } se assign karo.
// Endpoints:
//   Staff (ceo/admin/super_admin/manager):
//     GET /api/buddy[?status=active&newcomerId=&buddyId=] — pairs list
//     GET /api/buddy/suggest?newcomerId=<id> — top engaged members (auto-assign suggestion)
//     POST /api/buddy { newcomerId, buddyId, notes? } — assign
//     PATCH /api/buddy/:id { status?, notes? } — complete / notes edit
//     DELETE /api/buddy/:id — unassign (remove)
//   Member (ya staff):
//     GET /api/buddy/me/buddy — mera buddy (newcomer view)
//     GET /api/buddy/me/newcomers — jin members ka main buddy hoon (buddy view)
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];

function BP(res) {
  if (!prisma.buddyPair) {
    res.status(503).json({ error: 'Buddy module abhi migrate nahi hua.' });
    return null;
  }
  return prisma.buddyPair;
}

const assignSchema = z.object({
  newcomerId: z.string().min(1).max(64),
  buddyId: z.string().min(1).max(64),
  notes: z.string().max(2000).optional().nullable(),
});
const patchSchema = z.object({
  status: z.enum(['active', 'completed']).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

const includeBoth = {
  newcomer: { select: { id: true, name: true, email: true, phone: true } },
  buddy: { select: { id: true, name: true, email: true, phone: true } },
};

router.use(authenticate, requireTenantUser);

// ---------- Member endpoints (apne aap ke liye) ----------
router.get('/me/buddy', async (req, res, next) => {
  try {
    const B = BP(res); if (!B) return;
    const memberId = req.user.memberId;
    if (!memberId) return res.status(403).json({ error: 'Member account required.' });
    const tf = tenantFilter(req);
    const pair = await B.findFirst({
      where: { ...tf, newcomerId: memberId, status: 'active' },
      include: includeBoth,
    });
    res.json({ pair });
  } catch (e) { next(e); }
});

router.get('/me/newcomers', async (req, res, next) => {
  try {
    const B = BP(res); if (!B) return;
    const memberId = req.user.memberId;
    if (!memberId) return res.status(403).json({ error: 'Member account required.' });
    const tf = tenantFilter(req);
    const pairs = await B.findMany({
      where: { ...tf, buddyId: memberId, status: 'active' },
      include: includeBoth,
      orderBy: { assignedAt: 'desc' },
    });
    res.json({ pairs });
  } catch (e) { next(e); }
});

// ---------- Staff endpoints ----------
router.get('/suggest', requireRole(...STAFF), async (req, res, next) => {
  try {
    const B = BP(res); if (!B) return;
    const tf = tenantFilter(req);
    const { newcomerId } = req.query;
    if (!newcomerId) return res.status(422).json({ error: 'newcomerId zaroori hai.' });
    const newcomer = await prisma.member.findFirst({ where: { id: String(newcomerId), ...tf } });
    if (!newcomer) return res.status(404).json({ error: 'Newcomer member nahi mila.' });

    // Already-buddying members ko exclude karo (4+ active newcomers wale overloaded)
    const activePairs = await B.findMany({
      where: { ...tf, status: 'active' },
      select: { buddyId: true, newcomerId: true },
    });
    const load = {};
    for (const p of activePairs) load[p.buddyId] = (load[p.buddyId] || 0) + 1;
    const busyBuddies = new Set(Object.keys(load).filter((id) => load[id] >= 4));

    // Health score ho to use karo (Track 2 defensive), warna recent bookings + attendance
    let scored = [];
    try {
      if (prisma.memberHealth) {
        const rows = await prisma.memberHealth.findMany({
          where: { tenantId: tf.tenantId },
          orderBy: { score: 'desc' },
          take: 30,
          include: { member: { select: { id: true, name: true, email: true, status: true } } },
        });
        scored = rows
          .filter((r) => r.member && r.member.id !== newcomer.id && r.member.status === 'active')
          .map((r) => ({ member: r.member, score: r.score, factors: r.factors }));
      }
    } catch { scored = []; }

    let candidates;
    if (scored.length) {
      candidates = scored.filter((c) => !busyBuddies.has(c.member.id)).slice(0, 5);
    } else {
      // Fallback: pichle 60 din ki bookings + attendance activity
      const since = new Date(Date.now() - 60 * 24 * 3600 * 1000);
      const members = await prisma.member.findMany({
        where: { ...tf, status: 'active', id: { not: newcomer.id } },
        select: { id: true, name: true, email: true, status: true },
        take: 50,
      });
      const ids = members.map((m) => m.id);
      const [bookings, attendance] = await Promise.all([
        prisma.booking.groupBy({ by: ['memberId'], where: { tenantId: tf.tenantId, memberId: { in: ids }, createdAt: { gte: since } }, _count: { id: true } }).catch(() => []),
        prisma.attendance.groupBy({ by: ['memberId'], where: { tenantId: tf.tenantId, memberId: { in: ids }, createdAt: { gte: since } }, _count: { id: true } }).catch(() => []),
      ]);
      const activity = {};
      for (const b of bookings || []) activity[b.memberId] = (activity[b.memberId] || 0) + (b._count.id || 0);
      for (const a of attendance || []) activity[a.memberId] = (activity[a.memberId] || 0) + (a._count.id || 0) * 0.5;
      candidates = members
        .filter((m) => !busyBuddies.has(m.id))
        .map((m) => ({ member: m, score: Math.round((activity[m.id] || 0) * 10), factors: { activity60d: activity[m.id] || 0 } }))
        .sort((x, y) => y.score - x.score)
        .slice(0, 5);
    }
    res.json({ suggestions: candidates });
  } catch (e) { next(e); }
});

router.get('/', requireRole(...STAFF), async (req, res, next) => {
  try {
    const B = BP(res); if (!B) return;
    const tf = tenantFilter(req);
    const where = { ...tf };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.newcomerId) where.newcomerId = String(req.query.newcomerId);
    if (req.query.buddyId) where.buddyId = String(req.query.buddyId);
    const pairs = await B.findMany({ where, include: includeBoth, orderBy: { assignedAt: 'desc' }, take: 200 });
    res.json({ pairs });
  } catch (e) { next(e); }
});

router.post('/', requireRole(...STAFF), async (req, res, next) => {
  try {
    const B = BP(res); if (!B) return;
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) return res.status(422).json({ error: 'Invalid input', details: parsed.error.flatten() });
    const { newcomerId, buddyId, notes } = parsed.data;
    if (newcomerId === buddyId) return res.status(422).json({ error: 'Newcomer aur buddy ek hi member nahi ho sakta.' });
    const tf = tenantFilter(req);
    const [newcomer, buddy] = await Promise.all([
      prisma.member.findFirst({ where: { id: newcomerId, ...tf } }),
      prisma.member.findFirst({ where: { id: buddyId, ...tf } }),
    ]);
    if (!newcomer) return res.status(404).json({ error: 'Newcomer member nahi mila.' });
    if (!buddy) return res.status(404).json({ error: 'Buddy member nahi mila.' });
    const existing = await B.findFirst({ where: { ...tf, newcomerId, status: 'active' } });
    if (existing) return res.status(409).json({ error: 'Is newcomer ka pehle se active buddy hai.' });
    const pair = await B.create({
      data: { tenantId: tf.tenantId, newcomerId, buddyId, notes: notes || null, status: 'active' },
      include: includeBoth,
    });
    try { await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'buddy.assign', entity: 'BuddyPair', entityId: pair.id, newValue: { newcomerId, buddyId } }); } catch {}
    res.status(201).json({ pair });
  } catch (e) {
    if (e && e.code === 'P2002') return res.status(409).json({ error: 'Ye jodi pehle se maujood hai.' });
    next(e);
  }
});

router.patch('/:id', requireRole(...STAFF), async (req, res, next) => {
  try {
    const B = BP(res); if (!B) return;
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(422).json({ error: 'Invalid input', details: parsed.error.flatten() });
    const tf = tenantFilter(req);
    const pair = await B.findFirst({ where: { id: req.params.id, ...tf } });
    if (!pair) return res.status(404).json({ error: 'Pair nahi mila.' });
    const data = {};
    if (parsed.data.status !== undefined) data.status = parsed.data.status;
    if (parsed.data.notes !== undefined) data.notes = parsed.data.notes || null;
    const updated = await B.update({ where: { id: pair.id }, data, include: includeBoth });
    try { await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'buddy.update', entity: 'BuddyPair', entityId: pair.id, oldValue: { status: pair.status }, newValue: data }); } catch {}
    res.json({ pair: updated });
  } catch (e) { next(e); }
});

router.delete('/:id', requireRole(...STAFF), async (req, res, next) => {
  try {
    const B = BP(res); if (!B) return;
    const tf = tenantFilter(req);
    const pair = await B.findFirst({ where: { id: req.params.id, ...tf } });
    if (!pair) return res.status(404).json({ error: 'Pair nahi mila.' });
    await B.delete({ where: { id: pair.id } });
    try { await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'buddy.unassign', entity: 'BuddyPair', entityId: pair.id, oldValue: { newcomerId: pair.newcomerId, buddyId: pair.buddyId } }); } catch {}
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
