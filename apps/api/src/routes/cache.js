// Phase 28 Track 5: Cache observability + manual control (ceo/admin only).
const express = require('express');

const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');
const { cache } = require('../lib/cache');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin'));

// Cache stats (process-local)
router.get('/stats', async (req, res, next) => {
  try {
    res.json({ stats: cache.stats() });
  } catch (e) { next(e); }
});

// Clear the entire in-memory cache
router.delete('/', async (req, res, next) => {
  try {
    const before = cache.stats().size;
    cache.clear();
    await writeAudit(req, 'cache.cleared', 'Cache', null, { entries: before }, null).catch(() => {});
    res.json({ ok: true, cleared: before });
  } catch (e) { next(e); }
});

module.exports = router;
