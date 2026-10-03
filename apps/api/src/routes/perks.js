// Phase 40 Track 2: Member Perks & Benefits Catalog.
// Staff CRUD + member claim/list. Mount: /api/perks (coordinator).
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
const isStaff = (req) => STAFF.includes(req.user.role);

const CATEGORIES = ['food', 'fitness', 'tech', 'travel', 'other'];

function perksEnabled() {
  return !!(prisma && prisma.perk && prisma.perkClaim);
}
function guard503(req, res, next) {
  if (!perksEnabled()) return res.status(503).json({ error: 'Perks schema pending migration' });
  next();
}
router.use(guard503);

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'Perk', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

// Logged-in user ka member record (memberId from JWT, fallback email).
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

const perkSchema = z.object({
  partnerName: z.string().min(1).max(120),
  title: z.string().min(1).max(160),
  description: z.string().max(2000).optional().nullable(),
  discountText: z.string().min(1).max(80),
  category: z.enum(CATEGORIES).default('other'),
  code: z.string().max(120).optional().nullable(),
  expiryDate: z.string().datetime().optional().nullable(),
  isActive: z.boolean().default(true),
});

// GET /api/perks — active perks (members: sirf active + non-expired; staff: ?all=1 se sab)
router.get('/', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { q, category, all } = req.query;
    const where = { ...tf };
    if (!(isStaff(req) && all === '1')) {
      where.isActive = true;
      where.OR = [{ expiryDate: null }, { expiryDate: { gte: new Date() } }];
    }
    if (category && CATEGORIES.includes(category)) where.category = category;
    if (q && q.trim()) {
      where.AND = [{
        OR: [
          { title: { contains: q.trim(), mode: 'insensitive' } },
          { partnerName: { contains: q.trim(), mode: 'insensitive' } },
        ],
      }];
    }
    const perks = await prisma.perk.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { claims: true } } },
    });

    // Member ke liye: claim state + code sirf claimed par
    let claimedIds = new Set();
    if (!isStaff(req)) {
      const m = await myMember(req);
      if (m) {
        const claims = await prisma.perkClaim.findMany({
          where: { ...tf, memberId: m.id }, select: { perkId: true },
        });
        claimedIds = new Set(claims.map((c) => c.perkId));
      }
    }

    res.json({
      perks: perks.map((p) => ({
        id: p.id, partnerName: p.partnerName, title: p.title,
        description: p.description, discountText: p.discountText,
        category: p.category, expiryDate: p.expiryDate,
        isActive: p.isActive, claimsCount: p._count.claims,
        claimed: claimedIds.has(p.id),
        // Redeem code sirf staff ya jis ne claim kiya usay
        code: isStaff(req) ? p.code : undefined,
      })),
    });
  } catch (e) { next(e); }
});

// POST /api/perks — staff: naya perk
router.post('/', staffOnly, validateBody(perkSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const perk = await prisma.perk.create({
      data: {
        tenantId: tf.tenantId,
        partnerName: req.body.partnerName,
        title: req.body.title,
        description: req.body.description || null,
        discountText: req.body.discountText,
        category: req.body.category || 'other',
        code: req.body.code || null,
        expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : null,
        isActive: req.body.isActive !== false,
      },
    });
    audit(req, tf, 'perk.create', perk.id, { title: perk.title });
    res.status(201).json({ perk });
  } catch (e) { next(e); }
});

// PUT /api/perks/:id — staff: edit
router.put('/:id', staffOnly, validateBody(perkSchema.partial()), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.perk.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'Perk not found' });
    const perk = await prisma.perk.update({
      where: { id: existing.id },
      data: {
        ...(req.body.partnerName !== undefined && { partnerName: req.body.partnerName }),
        ...(req.body.title !== undefined && { title: req.body.title }),
        ...(req.body.description !== undefined && { description: req.body.description }),
        ...(req.body.discountText !== undefined && { discountText: req.body.discountText }),
        ...(req.body.category !== undefined && { category: req.body.category }),
        ...(req.body.code !== undefined && { code: req.body.code || null }),
        ...(req.body.expiryDate !== undefined && { expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : null }),
        ...(req.body.isActive !== undefined && { isActive: req.body.isActive }),
      },
    });
    audit(req, tf, 'perk.update', perk.id, { title: perk.title });
    res.json({ perk });
  } catch (e) { next(e); }
});

// DELETE /api/perks/:id — staff: delete (claims cascade)
router.delete('/:id', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.perk.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'Perk not found' });
    await prisma.perk.delete({ where: { id: existing.id } });
    audit(req, tf, 'perk.delete', existing.id, { title: existing.title });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/perks/:id/claim — member: perk claim karo (1 member = 1 claim)
router.post('/:id/claim', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const perk = await prisma.perk.findFirst({ where: { id: req.params.id, ...tf } });
    if (!perk || !perk.isActive) return res.status(404).json({ error: 'Perk not available' });
    if (perk.expiryDate && new Date(perk.expiryDate) < new Date()) {
      return res.status(410).json({ error: 'Perk expired' });
    }
    const member = await myMember(req);
    if (!member) return res.status(403).json({ error: 'Member profile required to claim' });

    const existing = await prisma.perkClaim.findUnique({
      where: { perkId_memberId: { perkId: perk.id, memberId: member.id } },
    });
    if (existing) {
      // Pehle se claimed — code dobara dikhao
      return res.json({ ok: true, already: true, code: perk.code });
    }

    await prisma.perkClaim.create({
      data: { tenantId: tf.tenantId, perkId: perk.id, memberId: member.id },
    });
    audit(req, tf, 'perk.claim', perk.id, { memberId: member.id });
    res.status(201).json({ ok: true, code: perk.code });
  } catch (e) { next(e); }
});

module.exports = router;
