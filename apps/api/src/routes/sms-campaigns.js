// Phase 36 Track 9: SMS Campaigns API.
// Mount: app.use('/api/sms-campaigns', require('./routes/sms-campaigns'));

const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { twilioConfigured } = require('../lib/sms');
const { resolveRecipients, smsSegments } = require('../lib/smsCampaigns');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('ceo', 'admin', 'super_admin', 'manager'));

function notMigrated(res) {
  return res.status(503).json({ error: { message: 'SMS campaigns not migrated yet' } });
}

const segmentSchema = z.object({
  type: z.enum(['all_active', 'overdue', 'trial']).default('all_active'),
});

const createSchema = z.object({
  name: z.string().min(2).max(120),
  message: z.string().min(1).max(1000),
  segment: segmentSchema.default({ type: 'all_active' }),
});

// Provider status — Twilio creds hain ya console fallback?
router.get('/provider-status', (req, res) => {
  const configured = twilioConfigured();
  res.json({
    provider: configured ? 'twilio' : 'console',
    configured,
    message: configured
      ? 'Twilio configured — real SMS delivery active.'
      : 'Twilio creds missing — console fallback mode. Real delivery ke liye TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM set karein.',
  });
});

router.get('/', async (req, res, next) => {
  try {
    if (!prisma.smsCampaign) return notMigrated(res);
    const tf = tenantFilter(req);
    const items = await prisma.smsCampaign.findMany({
      where: tf,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ items });
  } catch (e) { next(e); }
});

router.post('/', validateBody(createSchema), async (req, res, next) => {
  try {
    if (!prisma.smsCampaign) return notMigrated(res);
    const tf = tenantFilter(req);
    const seg = smsSegments(req.body.message);
    const item = await prisma.smsCampaign.create({
      data: {
        ...tf,
        name: req.body.name,
        message: req.body.message,
        segment: req.body.segment,
        createdBy: req.user.sub,
      },
    });
    res.status(201).json({ item, counter: seg });
  } catch (e) { next(e); }
});

// Character/segment counter helper.
router.post('/count', validateBody(z.object({ message: z.string().max(1000) })), (req, res) => {
  res.json(smsSegments(req.body.message));
});

// Preview: recipient count + segment breakdown (bhejne se pehle).
router.get('/:id/preview', async (req, res, next) => {
  try {
    if (!prisma.smsCampaign) return notMigrated(res);
    const tf = tenantFilter(req);
    const item = await prisma.smsCampaign.findFirst({ where: { id: req.params.id, ...tf } });
    if (!item) return res.status(404).json({ error: { message: 'Campaign not found' } });
    const recipients = await resolveRecipients(tf.tenantId, item.segment || {});
    res.json({
      recipientCount: recipients.length,
      counter: smsSegments(item.message),
      sample: recipients.slice(0, 5).map((r) => ({ name: r.name, phone: r.phone })),
    });
  } catch (e) { next(e); }
});

router.patch('/:id', validateBody(createSchema.partial()), async (req, res, next) => {
  try {
    if (!prisma.smsCampaign) return notMigrated(res);
    const tf = tenantFilter(req);
    const existing = await prisma.smsCampaign.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: { message: 'Campaign not found' } });
    if (existing.status !== 'draft') {
      return res.status(409).json({ error: { message: 'Sirf draft campaigns edit ho sakti hain' } });
    }
    const item = await prisma.smsCampaign.update({
      where: { id: req.params.id },
      data: { ...req.body },
    });
    res.json({ item });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (!prisma.smsCampaign) return notMigrated(res);
    const tf = tenantFilter(req);
    const existing = await prisma.smsCampaign.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: { message: 'Campaign not found' } });
    if (existing.status !== 'draft') {
      return res.status(409).json({ error: { message: 'Sirf draft campaigns delete ho sakti hain' } });
    }
    await prisma.smsCampaign.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Send: background job me enqueue karo (foran return).
router.post('/:id/send', async (req, res, next) => {
  try {
    if (!prisma.smsCampaign) return notMigrated(res);
    const tf = tenantFilter(req);
    const item = await prisma.smsCampaign.findFirst({ where: { id: req.params.id, ...tf } });
    if (!item) return res.status(404).json({ error: { message: 'Campaign not found' } });
    if (item.status !== 'draft') {
      return res.status(409).json({ error: { message: 'Campaign pehle se bhej di gayi hai' } });
    }
    const recipients = await resolveRecipients(tf.tenantId, item.segment || {});
    if (!recipients.length) {
      return res.status(400).json({ error: { message: 'Is segment me koi recipient nahi mila' } });
    }
    await prisma.smsCampaign.update({
      where: { id: item.id },
      data: { status: 'sending' },
    });
    try {
      const jobs = require('../lib/jobs');
      await jobs.enqueue('sms-campaign', { campaignId: item.id }, { tenantId: tf.tenantId });
    } catch (e) {
      // Job queue na ho to direct process (fallback)
      const { processSmsCampaign } = require('../lib/smsCampaigns');
      processSmsCampaign({ campaignId: item.id }).catch(() => {});
    }
    res.json({
      ok: true,
      status: 'sending',
      recipientCount: recipients.length,
      provider: twilioConfigured() ? 'twilio' : 'console',
    });
  } catch (e) { next(e); }
});

module.exports = router;
