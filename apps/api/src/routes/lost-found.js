// Phase 34 Track 9: Lost & Found — member + staff lost/found reporting.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { createNotification } = require('../lib/notify');

const router = express.Router();
router.use(authenticate, requireTenantUser);

// Schema merge se pehle 503 guard (jobs/backups wala pattern).
function noModel(res) {
  return res.status(503).json({ error: { message: 'Lost & Found schema not merged yet — LostFoundItem model unavailable.' } });
}
function modelGuard(req, res, next) {
  if (!prisma.lostFoundItem) return noModel(res);
  return next();
}
router.use(modelGuard);

const STAFF = ['ceo', 'admin', 'super_admin', 'manager', 'receptionist'];
const staffOnly = requireRole(...STAFF);

const TYPES = ['lost', 'found'];
const STATUSES = ['open', 'claimed', 'expired'];

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

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'LostFoundItem', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

// Simple keyword matcher: common significant words between two strings (>=4 chars).
function keywords(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4);
}

function matchScore(a, b) {
  const ka = new Set(keywords(a));
  const kb = new Set(keywords(b));
  let n = 0;
  for (const w of ka) if (kb.has(w)) n += 1;
  return n;
}

// Nayi "found" item par open "lost" reports walo ko match alert bhejo (fire-and-forget).
async function notifyLostMatches(tf, foundItem) {
  try {
    const lostItems = await prisma.lostFoundItem.findMany({
      where: { ...tf, type: 'lost', status: 'open' },
      include: { member: { include: { user: { select: { id: true } } } } },
      take: 200,
    });
    const hay = `${foundItem.title} ${foundItem.description || ''} ${foundItem.location || ''}`;
    for (const li of lostItems) {
      const needle = `${li.title} ${li.description || ''} ${li.location || ''}`;
      if (matchScore(hay, needle) >= 2) {
        // Reporter ko notify karo: member ka linked user, warna fallback.
        const userId = li.member?.user?.id || null;
        const msg = `Aap ki khoi hui cheez "${li.title}" se milti-julti item mili hai: "${foundItem.title}". Lost & Found me dekhein.`;
        if (userId) {
          await createNotification(prisma, { tenantId: tf.tenantId, userId, type: 'lostfound.match', message: msg }).catch(() => {});
        } else {
          // user link na mile to staff role ko notify karo taake wo manually inform kare
          await createNotification(prisma, { tenantId: tf.tenantId, role: 'receptionist', type: 'lostfound.match', message: `Lost item "${li.title}" ka possible match: "${foundItem.title}".` }).catch(() => {});
        }
      }
    }
  } catch (e) { /* match alert kabhi report flow nahi rokta */ }
}

const includeReporter = {
  member: { select: { id: true, name: true, companyName: true } },
};

// GET /api/lost-found — open items + search (member + staff)
router.get('/', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { q, type, status } = req.query;
    const where = { ...tf };
    if (type && TYPES.includes(type)) where.type = type;
    if (status && STATUSES.includes(status)) where.status = status;
    else where.status = 'open'; // default: sirf open
    if (q && q.trim()) {
      where.OR = [
        { title: { contains: q.trim(), mode: 'insensitive' } },
        { description: { contains: q.trim(), mode: 'insensitive' } },
        { location: { contains: q.trim(), mode: 'insensitive' } },
      ];
    }
    const items = await prisma.lostFoundItem.findMany({
      where, include: includeReporter, orderBy: { createdAt: 'desc' }, take: 100,
    });
    return res.json({ items });
  } catch (err) {
    return next(err);
  }
});

const createSchema = z.object({
  type: z.enum(TYPES),
  title: z.string().min(3).max(120),
  description: z.string().max(5000).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  imageUrl: z.string().max(1000).optional().nullable(),
});

// POST /api/lost-found — lost/found report (member bhi)
router.post('/', validateBody(createSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    const { type, title, description, location, imageUrl } = req.body;
    const item = await prisma.lostFoundItem.create({
      data: {
        tenantId: tf.tenantId, type, title: title.trim(),
        description: description ? description.trim() : null,
        location: location ? location.trim() : null,
        imageUrl: imageUrl ? imageUrl.trim() : null,
        status: 'open',
        memberId: member ? member.id : null,
        reportedBy: req.user.sub,
      },
      include: includeReporter,
    });
    audit(req, tf, 'lostfound.report', item.id, { type, title });
    if (type === 'found') notifyLostMatches(tf, item); // fire-and-forget
    return res.status(201).json({ item });
  } catch (err) {
    return next(err);
  }
});

const claimSchema = z.object({
  claimedBy: z.string().min(1).max(120), // member name ya member id
  note: z.string().max(500).optional().nullable(),
});

// POST /api/lost-found/:id/claim — staff verify karke claimed mark kare
router.post('/:id/claim', staffOnly, validateBody(claimSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const item = await prisma.lostFoundItem.findFirst({ where: { id: req.params.id, ...tf } });
    if (!item) return res.status(404).json({ error: { message: 'Item not found.' } });
    if (item.status !== 'open') {
      return res.status(400).json({ error: { message: `Item already ${item.status}.` } });
    }
    const updated = await prisma.lostFoundItem.update({
      where: { id: item.id },
      data: { status: 'claimed', claimedBy: req.body.claimedBy.trim(), claimedAt: new Date() },
      include: includeReporter,
    });
    audit(req, tf, 'lostfound.claim', item.id, { claimedBy: req.body.claimedBy, note: req.body.note });
    return res.json({ item: updated });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/lost-found/:id — staff remove (galat/duplicate report)
router.delete('/:id', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const item = await prisma.lostFoundItem.findFirst({ where: { id: req.params.id, ...tf } });
    if (!item) return res.status(404).json({ error: { message: 'Item not found.' } });
    await prisma.lostFoundItem.delete({ where: { id: item.id } });
    audit(req, tf, 'lostfound.delete', item.id, { title: item.title, type: item.type });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
