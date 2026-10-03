// Phase 45: Feedback Sentiment Scoring — overview API.
//
// Mount (coordinator, server.js me — additive):
//   app.use('/api/sentiment', require('./routes/sentiment'));
// Sidebar link: nahi — feedback section extend hai (feedback page me "Sentiment" tab).
//
// Schema dependency: `Feedback.sentiment` / `Feedback.sentimentScore`
// (fragment: apps/api/prisma/fragments/sentiment.prisma) — merge se pehle 503 guard.
//
// INTEGRATION NOTE — feedback.js (coordinator kare, owner: phase 38 feedback track):
//   POST /api/feedback (create) aur PATCH status/update ke baad fire-and-forget:
//     const { analyzeSentiment } = require('../lib/sentiment');
//     analyzeSentiment(body, { refine: false, tenantId: tf.tenantId }).then(({ score, sentiment }) => {
//       prisma.feedback.update({ where: { id: fb.id }, data: { sentiment, sentimentScore: score } }).catch(() => {});
//     }).catch(() => {});
//   Purane unscored feedback ke liye backfill: GET /api/sentiment/backfill (neeche) ek dafa chalana.

const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { analyzeSentiment } = require('../lib/sentiment');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];
const staffOnly = requireRole(...STAFF);

// Schema merge hui ya nahi — safe guard (koi 500 crash nahi)
function schemaReady() {
  try {
    return !!(prisma.feedback && prisma.feedback.fields && prisma.feedback.fields.sentiment !== undefined);
  } catch {
    return false;
  }
}

// Fallback: agar columns abhi merge nahi hue, to fields ko select se bahar rakho
function sentimentSelect() {
  return schemaReady() ? { sentiment: true, sentimentScore: true } : {};
}

// GET /api/sentiment/overview — distribution + 30d trend + top negative (action needed)
router.get('/overview', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const [all, recent] = await Promise.all([
      prisma.feedback.findMany({
        where: { ...tf },
        select: { id: true, category: true, rating: true, status: true, createdAt: true, ...sentimentSelect() },
      }),
      prisma.feedback.findMany({
        where: { ...tf, createdAt: { gte: since } },
        select: { id: true, createdAt: true, ...sentimentSelect() },
      }),
    ]);

    const ready = schemaReady();
    const dist = { positive: 0, neutral: 0, negative: 0, unscored: 0 };
    for (const f of all) {
      if (!ready || !f.sentiment) dist.unscored++;
      else dist[f.sentiment] = (dist[f.sentiment] || 0) + 1;
    }

    // 30-day trend: har din positive vs negative count
    const trend = {};
    for (const f of recent) {
      const day = f.createdAt.toISOString().slice(0, 10);
      if (!trend[day]) trend[day] = { day, positive: 0, negative: 0, neutral: 0 };
      if (ready && f.sentiment && trend[day][f.sentiment] !== undefined) trend[day][f.sentiment]++;
    }
    const trendArr = Object.values(trend).sort((a, b) => a.day.localeCompare(b.day));

    // Top negative feedbacks jinko action chahiye (new/reviewed, sab se negative pehle)
    let needsAction = [];
    if (ready) {
      needsAction = await prisma.feedback.findMany({
        where: { ...tf, sentiment: 'negative', status: { in: ['new', 'reviewed'] } },
        orderBy: [{ sentimentScore: 'asc' }, { createdAt: 'desc' }],
        take: 10,
        select: {
          id: true, title: true, body: true, category: true, rating: true,
          status: true, createdAt: true, sentiment: true, sentimentScore: true,
          member: { select: { id: true, fullName: true, company: true } },
        },
      });
      // body ko preview tak trim karo (PII-safe listing)
      needsAction = needsAction.map((f) => ({
        ...f,
        body: String(f.body || '').slice(0, 280),
      }));
    }

    const scored = all.length - dist.unscored;
    const avgScore = ready && scored
      ? Math.round((all.reduce((s, f) => s + (f.sentimentScore || 0), 0) / scored) * 100) / 100
      : null;

    res.json({
      schemaReady: ready,
      total: all.length,
      distribution: dist,
      avgScore,
      trend: trendArr,
      needsAction,
    });
  } catch (err) { next(err); }
});

// POST /api/sentiment/backfill — purane unscored feedback ko score karo (ek dafa, staff)
router.post('/backfill', staffOnly, async (req, res, next) => {
  try {
    if (!schemaReady()) {
      return res.status(503).json({ error: { message: 'Sentiment columns not merged yet.' } });
    }
    const tf = tenantFilter(req);
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    const pending = await prisma.feedback.findMany({
      where: { ...tf, sentiment: null },
      take: limit,
      select: { id: true, title: true, body: true },
    });
    let scored = 0;
    for (const f of pending) {
      const { score, sentiment } = await analyzeSentiment(`${f.title || ''} ${f.body || ''}`, { refine: false });
      await prisma.feedback.update({
        where: { id: f.id },
        data: { sentiment, sentimentScore: score },
      }).catch(() => {});
      scored++;
    }
    res.json({ ok: true, scored, remaining: pending.length >= limit });
  } catch (err) { next(err); }
});

module.exports = router;
