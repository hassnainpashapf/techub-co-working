// Phase 40 Track 7: Member Newsletter Builder.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

function modelsReady(res) {
  if (!(prisma.newsletter && prisma.newsletterSend)) {
    res.status(503).json({ error: 'Newsletters not available yet (migration pending)' });
    return false;
  }
  return true;
}

// ---------- PROTECTED ----------
router.use(authenticate, requireTenantUser);
const staffOnly = requireRole('ceo', 'admin', 'super_admin', 'manager');

const SEGMENTS = ['all', 'active', 'new', 'events'];

const sectionSchema = z.object({
  id: z.string().max(50),
  type: z.enum(['heading', 'text', 'image', 'event']),
  heading: z.string().max(300).optional().default(''),
  text: z.string().max(20000).optional().default(''),
  imageUrl: z.string().url().max(2000).optional().default(''),
  imageAlt: z.string().max(200).optional().default(''),
  eventId: z.string().max(50).optional().default(''),
  eventTitle: z.string().max(300).optional().default(''),
});

const newsletterSchema = z.object({
  title: z.string().min(1).max(200),
  subject: z.string().min(1).max(300),
  sections: z.array(sectionSchema).max(50).default([]),
  segment: z.enum(SEGMENTS).default('all'),
});

// Render sections into HTML for email bodies.
function sectionsToHtml(sections) {
  const esc = (s) => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  let out = '';
  for (const s of sections || []) {
    if (s.type === 'heading') {
      out += `<h2 style="font-size:20px;margin:16px 0 8px">${esc(s.heading)}</h2>`;
    } else if (s.type === 'text') {
      const paras = esc(s.text).split(/\n{2,}/).map((p) => `<p style="line-height:1.6">${p.replace(/\n/g, '<br>')}</p>`).join('');
      out += paras;
    } else if (s.type === 'image' && s.imageUrl) {
      out += `<p><img src="${esc(s.imageUrl)}" alt="${esc(s.imageAlt)}" style="max-width:100%;border-radius:8px"></p>`;
    } else if (s.type === 'event') {
      out += `<div style="border:1px solid #ddd;border-radius:8px;padding:12px;margin:12px 0">` +
        `<strong>📅 Event:</strong> ${esc(s.eventTitle || s.eventId)}</div>`;
    }
  }
  return out;
}

// Resolve recipient members for a segment, honoring phase-36 unsubscribes.
async function resolveRecipients(tenantId, segment) {
  let unsubSet = new Set();
  if (prisma.emailUnsubscribe) {
    const unsubs = await prisma.emailUnsubscribe.findMany({
      where: { tenantId }, select: { email: true },
    });
    unsubSet = new Set(unsubs.map((u) => String(u.email).toLowerCase()));
  }

  const baseWhere = { tenantId, email: { not: null } };
  if (segment === 'active') baseWhere.status = 'active';
  if (segment === 'new') baseWhere.createdAt = { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) };

  let memberIds = null;
  if (segment === 'events') {
    // Members with an event RSVP in the last 90 days (guarded — events may not be migrated).
    try {
      if (prisma.eventRsvp) {
        const rsvps = await prisma.eventRsvp.findMany({
          where: { tenantId, createdAt: { gte: new Date(Date.now() - 90 * 24 * 3600 * 1000) } },
          select: { memberId: true },
          take: 10000,
        });
        memberIds = [...new Set(rsvps.map((r) => r.memberId).filter(Boolean))];
      }
    } catch { memberIds = []; }
    if (memberIds && !memberIds.length) return [];
  }

  const where = { ...baseWhere };
  if (memberIds) where.id = { in: memberIds };
  const rows = await prisma.member.findMany({
    where, select: { id: true, email: true, name: true }, take: 10000,
  });

  const seen = new Set();
  return rows
    .map((m) => ({ id: m.id, email: String(m.email || '').toLowerCase(), name: m.name }))
    .filter((m) => {
      if (!m.email || seen.has(m.email) || unsubSet.has(m.email)) return false;
      seen.add(m.email);
      return true;
    });
}

// GET /api/newsletters — list
router.get('/', staffOnly, async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const tf = tenantFilter(req);
    const rows = await prisma.newsletter.findMany({
      where: { ...tf },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ newsletters: rows });
  } catch (err) { next(err); }
});

// GET /api/newsletters/:id — detail + stats
router.get('/:id', staffOnly, async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const tf = tenantFilter(req);
    const n = await prisma.newsletter.findFirst({ where: { id: req.params.id, ...tf } });
    if (!n) return res.status(404).json({ error: 'Newsletter not found' });
    const sent = await prisma.newsletterSend.count({ where: { newsletterId: n.id } });
    let unsubscribed = 0;
    if (prisma.emailUnsubscribe) {
      unsubscribed = await prisma.emailUnsubscribe.count({ where: { tenantId: tf.tenantId } });
    }
    res.json({ newsletter: n, stats: { recipients: n.recipientCount, sent, unsubscribed } });
  } catch (err) { next(err); }
});

// POST /api/newsletters — create draft
router.post('/', staffOnly, validateBody(newsletterSchema), async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const tf = tenantFilter(req);
    const n = await prisma.newsletter.create({
      data: {
        ...tf,
        title: req.body.title,
        subject: req.body.subject,
        sections: req.body.sections || [],
        segment: req.body.segment || 'all',
        status: 'draft',
        createdById: req.user.sub || null,
      },
    });
    writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'newsletter.created', entity: 'Newsletter', entityId: n.id });
    res.status(201).json({ newsletter: n });
  } catch (err) { next(err); }
});

// PATCH /api/newsletters/:id — edit draft only
router.patch('/:id', staffOnly, validateBody(newsletterSchema.partial()), async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const tf = tenantFilter(req);
    const n = await prisma.newsletter.findFirst({ where: { id: req.params.id, ...tf } });
    if (!n) return res.status(404).json({ error: 'Newsletter not found' });
    if (n.status !== 'draft') return res.status(400).json({ error: 'Only drafts can be edited' });
    const updated = await prisma.newsletter.update({
      where: { id: n.id },
      data: {
        ...(req.body.title !== undefined ? { title: req.body.title } : {}),
        ...(req.body.subject !== undefined ? { subject: req.body.subject } : {}),
        ...(req.body.sections !== undefined ? { sections: req.body.sections } : {}),
        ...(req.body.segment !== undefined ? { segment: req.body.segment } : {}),
      },
    });
    writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'newsletter.updated', entity: 'Newsletter', entityId: n.id });
    res.json({ newsletter: updated });
  } catch (err) { next(err); }
});

// DELETE /api/newsletters/:id — draft/scheduled only
router.delete('/:id', staffOnly, async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const tf = tenantFilter(req);
    const n = await prisma.newsletter.findFirst({ where: { id: req.params.id, ...tf } });
    if (!n) return res.status(404).json({ error: 'Newsletter not found' });
    if (!['draft', 'scheduled'].includes(n.status)) {
      return res.status(400).json({ error: 'Only drafts/scheduled newsletters can be deleted' });
    }
    await prisma.newsletter.delete({ where: { id: n.id } });
    writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'newsletter.deleted', entity: 'Newsletter', entityId: n.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/newsletters/:id/send — send now (queues job)
router.post('/:id/send', staffOnly, async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const tf = tenantFilter(req);
    const n = await prisma.newsletter.findFirst({ where: { id: req.params.id, ...tf } });
    if (!n) return res.status(404).json({ error: 'Newsletter not found' });
    if (!['draft', 'scheduled'].includes(n.status)) {
      return res.status(400).json({ error: 'Newsletter already sent or sending' });
    }
    const recipients = await resolveRecipients(tf.tenantId, n.segment || 'all');
    if (!recipients.length) return res.status(400).json({ error: 'No recipients in this segment' });

    const jobs = require('../lib/jobs');
    await jobs.enqueue('newsletter-send', {
      newsletterId: n.id,
      tenantId: tf.tenantId,
      recipients,
    }, { tenantId: tf.tenantId, runAt: new Date() });

    const updated = await prisma.newsletter.update({
      where: { id: n.id },
      data: { status: 'sending', recipientCount: recipients.length, sentAt: new Date() },
    });
    writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'newsletter.sent', entity: 'Newsletter', entityId: n.id });
    res.json({ newsletter: updated, recipients: recipients.length });
  } catch (err) { next(err); }
});

// POST /api/newsletters/:id/schedule — schedule for later
router.post('/:id/schedule', staffOnly, validateBody(z.object({
  scheduledFor: z.string().datetime(),
})), async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const tf = tenantFilter(req);
    const n = await prisma.newsletter.findFirst({ where: { id: req.params.id, ...tf } });
    if (!n) return res.status(404).json({ error: 'Newsletter not found' });
    if (!['draft', 'scheduled'].includes(n.status)) {
      return res.status(400).json({ error: 'Only drafts/scheduled newsletters can be scheduled' });
    }
    const at = new Date(req.body.scheduledFor);
    if (at.getTime() <= Date.now()) return res.status(400).json({ error: 'scheduledFor must be in the future' });

    const recipients = await resolveRecipients(tf.tenantId, n.segment || 'all');
    if (!recipients.length) return res.status(400).json({ error: 'No recipients in this segment' });

    const jobs = require('../lib/jobs');
    await jobs.enqueue('newsletter-send', {
      newsletterId: n.id,
      tenantId: tf.tenantId,
      recipients,
    }, { tenantId: tf.tenantId, runAt: at });

    const updated = await prisma.newsletter.update({
      where: { id: n.id },
      data: { status: 'scheduled', scheduledFor: at, recipientCount: recipients.length },
    });
    writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'newsletter.scheduled', entity: 'Newsletter', entityId: n.id });
    res.json({ newsletter: updated, recipients: recipients.length });
  } catch (err) { next(err); }
});

// GET /api/newsletters/:id/stats — sent/open estimate
router.get('/:id/stats', staffOnly, async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const tf = tenantFilter(req);
    const n = await prisma.newsletter.findFirst({ where: { id: req.params.id, ...tf } });
    if (!n) return res.status(404).json({ error: 'Newsletter not found' });
    const sent = await prisma.newsletterSend.count({ where: { newsletterId: n.id } });
    let unsubscribed = 0;
    if (prisma.emailUnsubscribe) {
      unsubscribed = await prisma.emailUnsubscribe.count({ where: { tenantId: tf.tenantId } });
    }
    res.json({
      stats: {
        status: n.status,
        recipients: n.recipientCount,
        sent,
        queued: n.recipientCount - sent,
        unsubscribed,
        openRateEstimate: 'Not tracked (opens not collected — see newsletter detail for sends)',
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.sectionsToHtml = sectionsToHtml;
module.exports.resolveRecipients = resolveRecipients;
