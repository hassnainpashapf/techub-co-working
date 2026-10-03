// Phase 33 Track 6: Community Marketplace — member-to-member listings.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];
const staffOnly = requireRole(...STAFF);

const CATEGORIES = ['service', 'product', 'job'];
const STATUSES = ['active', 'pending', 'sold', 'expired'];

// Resolve the member record for the logged-in user (memberId from JWT, fallback to email).
async function myMember(req) {
  const tf = tenantFilter(req);
  if (req.user.memberId) {
    const m = await prisma.member.findFirst({ where: { id: req.user.memberId, ...tf } });
    if (m) return m;
  }
  if (req.user.email) {
    const m = await prisma.member.findFirst({ where: { email: req.user.email, ...tf } });
    if (m) return m;
  }
  return null;
}

function isStaff(req) {
  return STAFF.includes(req.user.role);
}

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'MarketplaceListing', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

const includeMember = { member: { select: { id: true, name: true, companyName: true } } };

// GET /api/marketplace — active listings + search + category filter (all tenant members)
router.get('/', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { q, category, mine } = req.query;
    const where = { ...tf, status: 'active' };
    if (category && CATEGORIES.includes(category)) where.category = category;
    if (q && q.trim()) {
      where.OR = [
        { title: { contains: q.trim(), mode: 'insensitive' } },
        { description: { contains: q.trim(), mode: 'insensitive' } },
      ];
    }
    if (mine === '1') {
      const member = await myMember(req);
      if (!member) return res.status(404).json({ error: { message: 'Member record not found.' } });
      where.memberId = member.id;
      delete where.status; // apni sab listings dekho (active + sold + expired)
    }
    const listings = await prisma.marketplaceListing.findMany({
      where, include: includeMember, orderBy: { createdAt: 'desc' }, take: 100,
    });
    return res.json({ listings });
  } catch (err) {
    return next(err);
  }
});

const createSchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().max(5000).optional().nullable(),
  category: z.enum(CATEGORIES).optional().default('service'),
  price: z.number().nonnegative().optional().nullable(),
  contactInfo: z.string().max(200).optional().nullable(),
});

// POST /api/marketplace — member posts a listing (auto-active)
router.post('/', validateBody(createSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member) return res.status(404).json({ error: { message: 'Member record not found.' } });
    const { title, description, category, price, contactInfo } = req.body;
    const listing = await prisma.marketplaceListing.create({
      data: {
        tenantId: tf.tenantId, memberId: member.id, title: title.trim(),
        description: description ? description.trim() : null,
        category, price: price ?? null,
        contactInfo: contactInfo ? contactInfo.trim() : null,
        status: 'active',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 din baad auto-expire
      },
      include: includeMember,
    });
    audit(req, tf, 'marketplace.create', listing.id, { title, category });
    return res.status(201).json({ listing });
  } catch (err) {
    return next(err);
  }
});

const patchSchema = z.object({
  title: z.string().min(3).max(120).optional(),
  description: z.string().max(5000).optional().nullable(),
  category: z.enum(CATEGORIES).optional(),
  price: z.number().nonnegative().optional().nullable(),
  contactInfo: z.string().max(200).optional().nullable(),
  status: z.enum(['active', 'sold']).optional(), // member sirf active/sold kar sakta hai
});

// PATCH /api/marketplace/:id — apni listing edit/close (ya staff kuch bhi)
router.patch('/:id', validateBody(patchSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const listing = await prisma.marketplaceListing.findFirst({ where: { id: req.params.id, ...tf } });
    if (!listing) return res.status(404).json({ error: { message: 'Listing not found.' } });
    const staff = isStaff(req);
    if (!staff) {
      const member = await myMember(req);
      if (!member || listing.memberId !== member.id) {
        return res.status(403).json({ error: { message: 'Sirf apni listing edit kar sakte hain.' } });
      }
    }
    const data = {};
    for (const k of ['title', 'description', 'category', 'price', 'contactInfo']) {
      if (req.body[k] !== undefined) data[k] = req.body[k];
    }
    if (req.body.status !== undefined) {
      if (staff) {
        if (!STATUSES.includes(req.body.status)) {
          return res.status(400).json({ error: { message: 'Invalid status.' } });
        }
        data.status = req.body.status;
      } else {
        data.status = req.body.status; // member: sirf active/sold (zod ne validate kar diya)
      }
    }
    if (data.title) data.title = data.title.trim();
    const updated = await prisma.marketplaceListing.update({
      where: { id: listing.id }, data, include: includeMember,
    });
    audit(req, tf, 'marketplace.update', listing.id, data);
    return res.json({ listing: updated });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/marketplace/:id — staff remove (inappropriate), ya apni listing delete
router.delete('/:id', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const listing = await prisma.marketplaceListing.findFirst({ where: { id: req.params.id, ...tf } });
    if (!listing) return res.status(404).json({ error: { message: 'Listing not found.' } });
    const staff = isStaff(req);
    if (!staff) {
      const member = await myMember(req);
      if (!member || listing.memberId !== member.id) {
        return res.status(403).json({ error: { message: 'Sirf apni listing delete kar sakte hain.' } });
      }
    }
    await prisma.marketplaceListing.delete({ where: { id: listing.id } });
    audit(req, tf, 'marketplace.delete', listing.id, { title: listing.title, byStaff: staff });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
