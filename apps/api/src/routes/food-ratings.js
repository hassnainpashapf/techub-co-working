// Phase 43 Track 7: Food Item Ratings.
// Mount: /api/menu par (menu.js ke sath Express multi-router) — coordinator:
//   app.use('/api/menu', require('./routes/food-ratings').router);
// server.js / Sidebar.js nahi chhue.
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

function ratingsEnabled() {
  return !!(prisma && prisma.foodRating && prisma.menuItem);
}
function guard503(req, res, next) {
  if (!ratingsEnabled()) return res.status(503).json({ error: 'Food ratings schema pending migration' });
  next();
}
router.use(guard503);

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'FoodRating', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

async function resolveMember(req, tf) {
  if (!req.user.memberId) return null;
  return prisma.member.findFirst({ where: { id: req.user.memberId, ...tf } });
}

// Aggregate: itemIds ke liye {avg, count} map (coordinator menu list me join kar sakta hai)
async function getItemRatingSummary(tenantId, itemIds) {
  const rows = await prisma.foodRating.groupBy({
    by: ['menuItemId'],
    where: { tenantId, menuItemId: { in: itemIds } },
    _avg: { score: true },
    _count: { score: true },
  });
  const map = {};
  for (const r of rows) {
    map[r.menuItemId] = { avg: Math.round((r._avg.score || 0) * 10) / 10, count: r._count.score };
  }
  return map;
}
module.exports.getItemRatingSummary = getItemRatingSummary;

// POST /api/menu/items/:id/rate — member item rate kare (upsert: dobara = update)
router.post(
  '/items/:id/rate',
  validateBody(z.object({ score: z.number().int().min(1).max(5), comment: z.string().max(500).optional() })),
  async (req, res) => {
    try {
      const tf = tenantFilter(req);
      const member = await resolveMember(req, tf);
      if (!member) return res.status(403).json({ error: 'Member account required to rate items' });
      const item = await prisma.menuItem.findFirst({ where: { id: req.params.id, ...tf } });
      if (!item) return res.status(404).json({ error: 'Menu item not found' });

      const rating = await prisma.foodRating.upsert({
        where: { menuItemId_memberId: { menuItemId: item.id, memberId: member.id } },
        update: { score: req.body.score, comment: req.body.comment ?? null, ratedAt: new Date() },
        create: {
          tenantId: tf.tenantId, menuItemId: item.id, memberId: member.id,
          score: req.body.score, comment: req.body.comment ?? null,
        },
      });
      audit(req, tf, 'food_rating.rate', rating.id, { itemId: item.id, score: rating.score });
      res.json({ ok: true, rating });
    } catch (e) {
      console.error('food-rating rate failed', e);
      res.status(500).json({ error: 'Rating save failed' });
    }
  }
);

// GET /api/menu/items/:id/ratings — avg + count + recent ratings + meri rating
router.get('/items/:id/ratings', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const item = await prisma.menuItem.findFirst({ where: { id: req.params.id, ...tf } });
    if (!item) return res.status(404).json({ error: 'Menu item not found' });

    const agg = await prisma.foodRating.aggregate({
      where: { tenantId: tf.tenantId, menuItemId: item.id },
      _avg: { score: true }, _count: { score: true },
    });
    const dist = await prisma.foodRating.groupBy({
      by: ['score'], where: { tenantId: tf.tenantId, menuItemId: item.id }, _count: { score: true },
    });
    const ratings = await prisma.foodRating.findMany({
      where: { tenantId: tf.tenantId, menuItemId: item.id },
      include: { member: { select: { id: true, name: true } } },
      orderBy: { ratedAt: 'desc' }, take: 20,
    });
    let myRating = null;
    if (req.user.memberId) {
      myRating = await prisma.foodRating.findUnique({
        where: { menuItemId_memberId: { menuItemId: item.id, memberId: req.user.memberId } },
      });
    }
    res.json({
      avg: agg._avg.score ? Math.round(agg._avg.score * 10) / 10 : 0,
      count: agg._count.score,
      distribution: dist.map(d => ({ score: d.score, count: d._count.score })),
      ratings: ratings.map(r => ({ id: r.id, score: r.score, comment: r.comment, ratedAt: r.ratedAt, memberName: r.member?.name })),
      myRating,
    });
  } catch (e) {
    console.error('food-rating ratings failed', e);
    res.status(500).json({ error: 'Failed to load ratings' });
  }
});

// GET /api/menu/top-rated — top rated items (frontend "Top rated" sort ke liye)
router.get('/top-rated', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10) || 10, 1), 50);
    const rows = await prisma.foodRating.groupBy({
      by: ['menuItemId'],
      where: { tenantId: tf.tenantId },
      _avg: { score: true }, _count: { score: true },
      orderBy: { _avg: { score: 'desc' } },
      take: limit,
    });
    const items = await prisma.menuItem.findMany({
      where: { id: { in: rows.map(r => r.menuItemId) }, ...tf },
      include: { category: { select: { id: true, name: true } } },
    });
    const byId = Object.fromEntries(items.map(i => [i.id, i]));
    res.json(rows.map(r => ({
      ...(byId[r.menuItemId] || { id: r.menuItemId }),
      avgRating: Math.round((r._avg.score || 0) * 10) / 10,
      ratingCount: r._count.score,
    })).filter(i => byId[i.id]));
  } catch (e) {
    console.error('food-rating top-rated failed', e);
    res.status(500).json({ error: 'Failed to load top rated items' });
  }
});

// GET /api/menu/mine/pending-ratings — delivered orders jin ke items abhi rate nahi hue (rating prompt ke liye)
// FoodOrder model (Track 2) merge na ho to [] — guarded.
router.get('/mine/pending-ratings', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    if (!prisma.foodOrder) return res.json({ pending: [] });
    const member = await resolveMember(req, tf);
    if (!member) return res.json({ pending: [] });

    const orders = await prisma.foodOrder.findMany({
      where: { tenantId: tf.tenantId, memberId: member.id, status: 'delivered' },
      orderBy: { deliveredAt: 'desc' }, take: 10,
    });
    const myRatings = await prisma.foodRating.findMany({
      where: { tenantId: tf.tenantId, memberId: member.id },
      select: { menuItemId: true },
    });
    const rated = new Set(myRatings.map(r => r.menuItemId));
    const seen = new Set();
    const pending = [];
    for (const o of orders) {
      const items = Array.isArray(o.items) ? o.items : [];
      for (const it of items) {
        const id = it.menuItemId || it.id;
        if (id && !rated.has(id) && !seen.has(id)) {
          seen.add(id);
          pending.push({ menuItemId: id, name: it.name, orderId: o.id, deliveredAt: o.deliveredAt });
        }
      }
    }
    res.json({ pending: pending.slice(0, 20) });
  } catch (e) {
    console.error('food-rating pending failed', e);
    res.status(500).json({ error: 'Failed to load pending ratings' });
  }
});

module.exports.getItemRatingSummary = getItemRatingSummary;

module.exports.router = router;
