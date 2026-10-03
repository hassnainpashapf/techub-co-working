// Phase 33 Track 5: Member Directory (opt-in) — privacy-safe networking directory.
// Only members who opted in are visible. Contact details (email/phone) are
// NEVER returned — directory cards show name, company, bio and tags only.
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

// Safe projection — contact PII is never selected.
const DIRECTORY_SELECT = {
  id: true,
  name: true,
  companyName: true,
  directoryBio: true,
  directoryTags: true,
  company: { select: { id: true, name: true } },
};

const myProfileSchema = z.object({
  directoryOptIn: z.boolean(),
  directoryBio: z.string().max(500).nullable().optional(),
  directoryTags: z.array(z.string().max(40)).max(10).optional().default([]),
});

// ---------------------------------------------------------------------------
// GET /api/directory — browse opt-in members (?q= search, ?tag= filter)
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const q = (req.query.q || '').toString().trim();
    const tag = (req.query.tag || '').toString().trim();

    const where = {
      ...tf,
      directoryOptIn: true,
      status: 'active',
    };
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { companyName: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (tag) {
      where.directoryTags = { has: tag };
    }

    const members = await prisma.member.findMany({
      where,
      select: DIRECTORY_SELECT,
      orderBy: { name: 'asc' },
      take: 200,
    });

    // Distinct tags for the filter UI (opt-in members only).
    const tagRows = await prisma.member.findMany({
      where: { ...tf, directoryOptIn: true, status: 'active' },
      select: { directoryTags: true },
    });
    const allTags = [...new Set(tagRows.flatMap((m) => m.directoryTags || []))].sort();

    res.json({ members, tags: allTags });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/directory/my-profile — member's own directory settings
// ---------------------------------------------------------------------------
router.get('/my-profile', async (req, res, next) => {
  try {
    const memberId = req.user.memberId;
    if (!memberId) {
      return res.status(403).json({ error: 'Only members can manage a directory profile' });
    }
    const tf = tenantFilter(req);
    const member = await prisma.member.findFirst({
      where: { id: memberId, ...tf },
      select: { id: true, directoryOptIn: true, directoryBio: true, directoryTags: true },
    });
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }
    res.json({ profile: member });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/directory/my-profile — member updates own directory presence
// ---------------------------------------------------------------------------
router.put('/my-profile', validateBody(myProfileSchema), async (req, res, next) => {
  try {
    const memberId = req.user.memberId;
    if (!memberId) {
      return res.status(403).json({ error: 'Only members can manage a directory profile' });
    }
    const tf = tenantFilter(req);
    const member = await prisma.member.findFirst({ where: { id: memberId, ...tf } });
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const tags = (req.body.directoryTags || [])
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 10);

    const updated = await prisma.member.update({
      where: { id: member.id },
      data: {
        directoryOptIn: req.body.directoryOptIn,
        directoryBio: req.body.directoryBio?.trim() || null,
        directoryTags: tags,
      },
      select: { id: true, directoryOptIn: true, directoryBio: true, directoryTags: true },
    });

    writeAudit({
      tenantId: tf.tenantId,
      actorId: req.user.sub,
      action: 'directory.profile_updated',
      entity: 'Member',
      entityId: member.id,
      newValue: { optIn: updated.directoryOptIn },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    }).catch(() => {});

    res.json({ profile: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
