// Phase 36 Track 5: Email Campaign Builder.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { sendEmail } = require('../lib/mailer');

const router = express.Router();

function modelsReady(res) {
  if (!(prisma.emailCampaign && prisma.emailUnsubscribe)) {
    res.status(503).json({ error: 'Campaigns not available yet (migration pending)' });
    return false;
  }
  return true;
}

// ---------- PUBLIC: unsubscribe (no auth) ----------
// Placed BEFORE the auth middleware so email links work without login.
router.get('/unsubscribe/:token', async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const row = await prisma.emailUnsubscribe.findUnique({
      where: { token: req.params.token },
    });
    if (!row) return res.status(404).json({ error: 'Invalid unsubscribe link' });
    res.json({ ok: true, email: row.email, message: 'You have been unsubscribed from marketing emails.' });
  } catch (err) {
    next(err);
  }
});

// ---------- PROTECTED ----------
router.use(authenticate, requireTenantUser);
const staffOnly = requireRole('ceo', 'admin', 'super_admin', 'manager');

const SEGMENT_TYPES = ['all', 'active', 'trial', 'on_hold', 'custom'];

const campaignSchema = z.object({
  name: z.string().min(1).max(200),
  subject: z.string().min(1).max(300),
  bodyHtml: z.string().min(1).max(200000),
  segment: z.object({
    type: z.enum(SEGMENT_TYPES),
    emails: z.array(z.string().email()).max(5000).optional().default([]),
  }),
  scheduledAt: z.string().datetime().optional().nullable(),
});

// Resolve recipient emails for a segment, excluding unsubscribed.
async function resolveRecipients(tenantId, segment) {
  const unsubs = await prisma.emailUnsubscribe.findMany({
    where: { tenantId },
    select: { email: true },
  });
  const unsubSet = new Set(unsubs.map((u) => u.email.toLowerCase()));

  let members = [];
  if (segment.type === 'custom') {
    const emails = [...new Set((segment.emails || []).map((e) => String(e).toLowerCase()))];
    members = emails.map((email) => ({ email, name: email.split('@')[0] }));
  } else {
    const where = { tenantId, email: { not: null } };
    if (segment.type !== 'all') where.status = segment.type;
    const rows = await prisma.member.findMany({
      where,
      select: { email: true, name: true },
      take: 10000,
    });
    members = rows.map((m) => ({ email: m.email.toLowerCase(), name: m.name }));
  }
  // Dedupe + drop unsubscribed
  const seen = new Set();
  return members.filter((m) => {
    if (!m.email || seen.has(m.email) || unsubSet.has(m.email)) return false;
    seen.add(m.email);
    return true;
  });
}

function unsubscribeBase(req) {
  return (process.env.FRONTEND_URL || req.get('origin') || 'https://techub-co-working.pages.dev').replace(/\/$/, '');
}

// GET /api/campaigns — list
router.get('/', staffOnly, async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const tf = tenantFilter(req);
    const rows = await prisma.emailCampaign.findMany({
      where: { ...tf },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ campaigns: rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/campaigns/:id — detail + stats
router.get('/:id', staffOnly, async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const tf = tenantFilter(req);
    const c = await prisma.emailCampaign.findFirst({ where: { id: req.params.id, ...tf } });
    if (!c) return res.status(404).json({ error: 'Campaign not found' });
    const unsubCount = await prisma.emailUnsubscribe.count({ where: { tenantId: tf.tenantId } });
    res.json({ campaign: c, stats: { recipients: c.recipientCount, sent: c.sentCount, unsubscribed: unsubCount } });
  } catch (err) {
    next(err);
  }
});

// POST /api/campaigns — create draft
router.post('/', staffOnly, validateBody(campaignSchema), async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const tf = tenantFilter(req);
    const c = await prisma.emailCampaign.create({
      data: {
        ...tf,
        name: req.body.name,
        subject: req.body.subject,
        bodyHtml: req.body.bodyHtml,
        segment: req.body.segment,
        scheduledAt: req.body.scheduledAt ? new Date(req.body.scheduledAt) : null,
        status: 'draft',
        createdById: req.user.sub || null,
      },
    });
    writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'campaign.created', entity: 'EmailCampaign', entityId: c.id });
    res.status(201).json({ campaign: c });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/campaigns/:id — edit draft only
router.patch('/:id', staffOnly, validateBody(campaignSchema.partial()), async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const tf = tenantFilter(req);
    const c = await prisma.emailCampaign.findFirst({ where: { id: req.params.id, ...tf } });
    if (!c) return res.status(404).json({ error: 'Campaign not found' });
    if (c.status !== 'draft') return res.status(400).json({ error: 'Only drafts can be edited' });
    const updated = await prisma.emailCampaign.update({
      where: { id: c.id },
      data: {
        ...(req.body.name !== undefined ? { name: req.body.name } : {}),
        ...(req.body.subject !== undefined ? { subject: req.body.subject } : {}),
        ...(req.body.bodyHtml !== undefined ? { bodyHtml: req.body.bodyHtml } : {}),
        ...(req.body.segment !== undefined ? { segment: req.body.segment } : {}),
        ...(req.body.scheduledAt !== undefined ? { scheduledAt: req.body.scheduledAt ? new Date(req.body.scheduledAt) : null } : {}),
      },
    });
    writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'campaign.updated', entity: 'EmailCampaign', entityId: c.id });
    res.json({ campaign: updated });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/campaigns/:id — draft/scheduled only
router.delete('/:id', staffOnly, async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const tf = tenantFilter(req);
    const c = await prisma.emailCampaign.findFirst({ where: { id: req.params.id, ...tf } });
    if (!c) return res.status(404).json({ error: 'Campaign not found' });
    if (!['draft', 'scheduled'].includes(c.status)) {
      return res.status(400).json({ error: 'Only drafts/scheduled campaigns can be deleted' });
    }
    await prisma.emailCampaign.delete({ where: { id: c.id } });
    writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'campaign.deleted', entity: 'EmailCampaign', entityId: c.id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/campaigns/:id/send — queue the send (now or scheduled)
router.post('/:id/send', staffOnly, async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const tf = tenantFilter(req);
    const c = await prisma.emailCampaign.findFirst({ where: { id: req.params.id, ...tf } });
    if (!c) return res.status(404).json({ error: 'Campaign not found' });
    if (!['draft', 'scheduled'].includes(c.status)) {
      return res.status(400).json({ error: 'Campaign already sent or sending' });
    }
    const recipients = await resolveRecipients(tf.tenantId, c.segment || { type: 'all' });
    if (!recipients.length) return res.status(400).json({ error: 'No recipients in this segment' });

    const jobs = require('../lib/jobs');
    const scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : (c.scheduledAt || null);
    const isFuture = scheduledAt && scheduledAt.getTime() > Date.now() + 60 * 1000;

    await jobs.enqueue(
      'campaign-send',
      {
        campaignId: c.id,
        tenantId: tf.tenantId,
        recipients,
        unsubscribeBase: unsubscribeBase(req),
      },
      { tenantId: tf.tenantId, runAt: isFuture ? scheduledAt : new Date() }
    );
    const updated = await prisma.emailCampaign.update({
      where: { id: c.id },
      data: {
        status: isFuture ? 'scheduled' : 'sending',
        scheduledAt: scheduledAt || null,
        recipientCount: recipients.length,
      },
    });
    writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'campaign.queued', entity: 'EmailCampaign', entityId: c.id, newValue: { recipients: recipients.length } });
    res.json({ campaign: updated, queued: recipients.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/campaigns/:id/test — send a test email to yourself
router.post('/:id/test', staffOnly, validateBody(z.object({ email: z.string().email().optional() })), async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const tf = tenantFilter(req);
    const c = await prisma.emailCampaign.findFirst({ where: { id: req.params.id, ...tf } });
    if (!c) return res.status(404).json({ error: 'Campaign not found' });
    const to = req.body.email || req.user.email;
    if (!to) return res.status(400).json({ error: 'No email address' });
    await sendEmail(tf.tenantId, {
      to,
      subject: `[TEST] ${c.subject}`,
      html: c.bodyHtml + `<br><br><hr><p style="font-size:12px;color:#888">Test email — not sent to members.</p>`,
    });
    res.json({ ok: true, to });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
