// Phase 47 Track 10/10: Forms Dashboard — aggregate stats for the forms module.
// Sab sections defensive hain: parallel tracks (1/2/8) ke models merge na hue hon
// to wo section 0/empty deta hai, poora dashboard 503/500 nahi hota.
// Koi migration nahi — sirf fragments models (CustomForm, FormSubmission) se compute hota hai.
// Status column (track 8 delta) merge na ho to new-inbox count gracefully null hota hai.
//
// Coordinator ke liye (server.js mat chhua):
//   Mount: app.use('/api/forms-dashboard', require('./routes/forms-dashboard'));
// Sidebar link: naya nahi — forms list page extend hoti hai.
//   Integration note: apps/web/app/(app)/forms/page.js (track 1) ke top me stats header
//   jorein jo GET /api/forms-dashboard/stats call kare (neeche sample snippet).
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

// GET /api/forms-dashboard/stats — forms module ke key numbers.
router.get('/stats', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const tenantId = tf.tenantId;
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const stats = {
      totalForms: 0,
      publishedForms: 0,
      draftForms: 0,
      submissions30d: 0,
      newInbox: null, // track 8 ka status column merge na ho to null
      topForms: [],
    };
    const modules = {};

    // --- Forms (track 1 ka model) ---
    const F = m('customForm');
    if (F) {
      modules.forms = true;
      const [total, published, drafts] = await Promise.all([
        F.count({ where: { tenantId } }),
        F.count({ where: { tenantId, status: 'published' } }),
        F.count({ where: { tenantId, status: 'draft' } }),
      ]);
      stats.totalForms = total;
      stats.publishedForms = published;
      stats.draftForms = drafts;
    }

    // --- Submissions (track 2 ka model) ---
    const S = m('formSubmission');
    if (S) {
      modules.submissions = true;
      stats.submissions30d = await S.count({
        where: { tenantId, createdAt: { gte: d30 } },
      });

      // New/unreviewed inbox — track 8 ka status column merge na ho to null (graceful)
      try {
        stats.newInbox = await S.count({
          where: { tenantId, status: 'new' },
        });
        modules.inboxStatus = true;
      } catch (e) {
        // Column abhi merge nahi hui (P2022) — null rakho, poora endpoint nahi girna chahiye
        stats.newInbox = null;
      }

      // Top forms by submissions (all time, top 5)
      const grouped = await S.groupBy({
        by: ['formId'],
        where: { tenantId },
        _count: { formId: true },
        orderBy: { _count: { formId: 'desc' } },
        take: 5,
      });
      if (grouped.length && F) {
        const ids = grouped.map((g) => g.formId);
        const forms = await F.findMany({
          where: { tenantId, id: { in: ids } },
          select: { id: true, title: true, slug: true, status: true },
        });
        const byId = Object.fromEntries(forms.map((f) => [f.id, f]));
        stats.topForms = grouped.map((g) => ({
          formId: g.formId,
          title: byId[g.formId] ? byId[g.formId].title : '—',
          slug: byId[g.formId] ? byId[g.formId].slug : null,
          status: byId[g.formId] ? byId[g.formId].status : null,
          submissions: g._count.formId,
        }));
      }
    }

    res.json({ stats, modules });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

/*
=== FRONTEND INTEGRATION NOTE (coordinator kare) ===
Track 1 ki forms list page: apps/web/app/(app)/forms/page.js
Us ke top me stats header jorein — sample:

  const [stats, setStats] = useState(null);
  useEffect(() => {
    api.get('/forms-dashboard/stats').then((r) => setStats(r.data.stats)).catch(() => {});
  }, []);

Stats header (dark premium theme, track 1 ke page ke style me):
  - Total Forms: stats.totalForms
  - Published: stats.publishedForms
  - Submissions (30d): stats.submissions30d
  - New inbox: stats.newInbox (null ho to chip chhupao ya "—" dikhao)
  - Top forms list: stats.topForms → title + submissions count + status badge
*/
