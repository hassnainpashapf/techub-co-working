// Phase 30: Saved Filter Views — per-user saved filter presets per page.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const createSchema = z.object({
  page: z.string().min(1).max(50),
  name: z.string().min(1).max(80),
  filters: z.record(z.any()).default({}),
});

// GET /api/saved-views?page=members — my saved views for a page
router.get('/', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { page } = req.query;
    const where = { userId: req.user.sub, ...tf };
    if (page) where.page = String(page);
    const views = await prisma.savedView.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return res.json({ views });
  } catch (err) {
    return next(err);
  }
});

// POST /api/saved-views — save current filters as a named view
router.post('/', validateBody(createSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { page, name, filters } = req.body;
    const view = await prisma.savedView.upsert({
      where: { userId_page_name: { userId: req.user.sub, page, name } },
      update: { filters },
      create: { tenantId: tf.tenantId, userId: req.user.sub, page, name, filters },
    });
    return res.status(201).json({ view });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/saved-views/:id — only my own
router.delete('/:id', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.savedView.findFirst({
      where: { id: req.params.id, userId: req.user.sub, ...tf },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Saved view not found.' } });
    await prisma.savedView.delete({ where: { id: req.params.id } });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
