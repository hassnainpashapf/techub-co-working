// Phase 45 Track 10: Intelligence Dashboard — combined AI/insights overview.
// GET /overview: unread insights (track 4), recent anomalies (track 5),
// sentiment summary (track 6), pricing hints (track 8) — ek combined payload.
// Sare sections defensive hain: sibling tracks ke models merge na hue hon to
// wo section 0/empty deta hai, poora dashboard 503/500 nahi hota.
// Koi migration nahi — sirf existing/fragments models se compute hota hai.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'manager'));

// Model merge hua ya nahi (schema merge se pehle prisma.<model> undefined hota hai)
function m(name) {
  return prisma[name] || null;
}

const toNum = (d) => (d === null || d === undefined ? 0 : Number(d));

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

// --- Track 4: unread insights ---
async function getInsights(tenantId) {
  const IN = m('insight');
  const out = { available: !!IN, unreadCount: 0, items: [] };
  if (!IN) return out;
  try {
    out.unreadCount = await IN.count({ where: { tenantId, isRead: false } });
    out.items = await IN.findMany({
      where: { tenantId, isRead: false },
      orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
      take: 10,
      select: { id: true, type: true, title: true, body: true, severity: true, createdAt: true },
    });
    out.items.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
  } catch {
    out.available = false;
  }
  return out;
}

// --- Track 5: recent anomalies (model ya notification fallback) ---
async function getAnomalies(tenantId) {
  const out = { available: true, items: [] };
  const AA = m('anomalyAlert') || m('anomaly');
  const d30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  try {
    if (AA) {
      out.items = await AA.findMany({
        where: { tenantId, createdAt: { gte: d30 } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
    } else {
      // Fallback: anomaly detector (track 5) ne alerts Notification me banaye hon
      const NT = m('notification');
      if (!NT) {
        out.available = false;
        return out;
      }
      const rows = await NT.findMany({
        where: { tenantId, createdAt: { gte: d30 }, message: { contains: 'anomaly', mode: 'insensitive' } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, message: true, createdAt: true, isRead: true },
      });
      out.items = rows.map((r) => ({
        id: r.id,
        title: 'Anomaly alert',
        detail: r.message,
        severity: 'warning',
        createdAt: r.createdAt,
        isRead: r.isRead,
      }));
    }
  } catch {
    out.available = false;
  }
  return out;
}

// --- Track 6: sentiment summary ---
async function getSentiment(tenantId) {
  const out = { available: true, source: 'rating', positive: 0, neutral: 0, negative: 0, recent: [] };
  const FB = m('feedback');
  if (!FB) {
    out.available = false;
    return out;
  }
  try {
    // Pehle merged sentiment fields try karo
    try {
      const grouped = await FB.groupBy({
        by: ['sentiment'],
        where: { tenantId },
        _count: { id: true },
      });
      let hasReal = false;
      for (const g of grouped) {
        if (!g.sentiment) continue;
        hasReal = true;
        if (g.sentiment === 'positive') out.positive = g._count.id;
        else if (g.sentiment === 'negative') out.negative = g._count.id;
        else out.neutral += g._count.id;
      }
      if (hasReal) {
        out.source = 'sentiment';
        out.recent = await FB.findMany({
          where: { tenantId, sentiment: 'negative' },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, title: true, body: true, rating: true, sentimentScore: true, createdAt: true },
        });
        return out;
      }
    } catch {
      // sentiment column abhi merge nahi — rating fallback
    }
    // Fallback: rating buckets (1-2 negative, 3 neutral, 4-5 positive)
    const grouped = await FB.groupBy({
      by: ['rating'],
      where: { tenantId },
      _count: { id: true },
    });
    for (const g of grouped) {
      if (g.rating <= 2) out.negative += g._count.id;
      else if (g.rating === 3) out.neutral += g._count.id;
      else out.positive += g._count.id;
    }
    out.recent = await FB.findMany({
      where: { tenantId, rating: { lte: 2 } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, title: true, body: true, rating: true, createdAt: true },
    });
  } catch {
    out.available = false;
  }
  return out;
}

// --- Track 8: lightweight pricing hints (unit occupancy heuristic) ---
async function getPricing(tenantId) {
  const out = { available: true, count: 0, hints: [] };
  const UN = m('unit');
  const CT = m('contract');
  if (!UN || !CT) {
    out.available = false;
    return out;
  }
  try {
    const units = await UN.findMany({
      where: { tenantId },
      select: { id: true, code: true, type: true, status: true, monthlyPrice: true, updatedAt: true },
      take: 200,
    });
    if (!units.length) return out;
    const active = await CT.findMany({
      where: { tenantId, status: 'active' },
      select: { unitId: true },
    });
    const occupied = new Set(active.map((c) => c.unitId));
    const byType = {};
    for (const u of units) {
      const t = u.type || 'unit';
      byType[t] = byType[t] || { total: 0, occ: 0 };
      byType[t].total += 1;
      if (occupied.has(u.id)) byType[t].occ += 1;
    }
    const hints = [];
    for (const [t, s] of Object.entries(byType)) {
      const occ = s.total ? (s.occ / s.total) * 100 : 0;
      if (s.total >= 3 && occ >= 85) {
        hints.push({
          scope: 'type', ref: t,
          action: 'raise', pct: 7,
          reason: `${s.total} me se ${s.occ} booked (${Math.round(occ)}% occupancy) — demand zyada, price 5-10% barhao`,
        });
      } else if (s.total >= 3 && occ < 50) {
        hints.push({
          scope: 'type', ref: t,
          action: 'lower', pct: 8,
          reason: `Sirf ${Math.round(occ)}% occupancy — promo ya 5-10% cut se fill karo`,
        });
      }
    }
    // Lambi khali units
    const staleDays = 60;
    const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);
    const stale = units
      .filter((u) => !occupied.has(u.id) && u.updatedAt && new Date(u.updatedAt) < cutoff)
      .slice(0, 5);
    for (const u of stale) {
      hints.push({
        scope: 'unit', ref: u.code,
        action: 'promo',
        reason: `${staleDays}+ din se khali — limited-time offer lagao`,
      });
    }
    out.count = hints.length;
    out.hints = hints.slice(0, 12);
  } catch {
    out.available = false;
  }
  return out;
}

// GET /api/intelligence/overview — combined dashboard payload
router.get('/overview', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const tenantId = tf.tenantId;
    const [insights, anomalies, sentiment, pricing] = await Promise.all([
      getInsights(tenantId),
      getAnomalies(tenantId),
      getSentiment(tenantId),
      getPricing(tenantId),
    ]);
    res.json({
      ok: true,
      insights,
      anomalies,
      sentiment,
      pricing,
      modules: {
        insights: insights.available,
        anomalies: anomalies.available,
        sentiment: sentiment.available,
        pricing: pricing.available,
      },
    });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/intelligence/insights/:id/read — mark-read convenience
// (track 4 ke /api/insights/:id/read ka proxy; model merge na ho to 404)
router.patch('/insights/:id/read', async (req, res, next) => {
  try {
    const IN = m('insight');
    if (!IN) return res.status(404).json({ ok: false, error: 'Insights module abhi merge nahi hua' });
    const tf = tenantFilter(req);
    const row = await IN.findFirst({ where: { id: req.params.id, tenantId: tf.tenantId } });
    if (!row) return res.status(404).json({ ok: false, error: 'Insight nahi mila' });
    const updated = await IN.update({ where: { id: row.id }, data: { isRead: true } });
    res.json({ ok: true, insight: { id: updated.id, isRead: updated.isRead } });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
