// Phase 27 Track 5: Announcements / Broadcast — admin sends announcements
// to members/staff via in-app notifications + email (+ sms/whatsapp hooks).
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

const SENDER_ROLES = ['ceo', 'admin', 'manager', 'super_admin'];
const senderOnly = requireRole(...SENDER_ROLES);
const DELETE_ROLES = ['ceo', 'admin', 'super_admin'];

const AUDIENCES = ['all', 'members', 'staff'];
const CHANNELS = ['inapp', 'email', 'sms', 'whatsapp'];

const announcementSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  audience: z.enum(AUDIENCES).default('all'),
  channels: z.array(z.enum(CHANNELS)).min(1).default(['inapp']),
});

// Resolve recipient users for an audience within the tenant
async function resolveRecipients(tenantId, audience) {
  const where = { tenantId, isActive: true };
  if (audience === 'members') where.role = 'member';
  if (audience === 'staff') where.role = { not: 'member' };
  return prisma.user.findMany({
    where,
    select: { id: true, email: true, name: true },
  });
}

// List announcements
router.get('/', senderOnly, async (req, res, next) => {
  try {
    const list = await prisma.announcement.findMany({
      where: { ...tenantFilter(req) },
      include: { sender: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ announcements: list });
  } catch (e) { next(e); }
});

// Create + broadcast announcement
router.post('/', senderOnly, validateBody(announcementSchema), async (req, res, next) => {
  try {
    const { title, body, audience, channels } = req.body;
    const tenantId = req.user.tenantId;

    const recipients = await resolveRecipients(tenantId, audience);

    const announcement = await prisma.announcement.create({
      data: {
        tenantId,
        title,
        body,
        audience,
        channels,
        sentBy: req.user.sub,
        sentAt: channels.includes('inapp') ? new Date() : null,
      },
    });

    // In-app notifications for every recipient
    if (channels.includes('inapp') && recipients.length) {
      await prisma.notification.createMany({
        data: recipients.map((r) => ({
          tenantId,
          userId: r.id,
          type: 'general',
          message: `📢 ${title} — ${body.slice(0, 140)}${body.length > 140 ? '…' : ''}`,
        })),
      });
    }

    // Email channel (best-effort — announcement still counts as sent on failure)
    let emailed = 0;
    if (channels.includes('email') && recipients.length) {
      const { notify } = require('../lib/mailer');
      for (const r of recipients) {
        if (!r.email) continue;
        try {
          const result = await notify(tenantId, r.email, 'announcement', { title, body, name: r.name });
          if (result && (result.sent || result.queued)) emailed += 1;
        } catch { /* ignore per-recipient failures */ }
      }
    }

    // SMS / WhatsApp hooks — delegate to track 1/2 modules if present
    // (no credentials configured yet; kept as extension points)
    // if (channels.includes('sms')) { /* smsQueue.enqueue(...) */ }
    // if (channels.includes('whatsapp')) { /* whatsappQueue.enqueue(...) */ }

    await writeAudit(req, 'announcement.sent', 'Announcement', announcement.id, null, {
      title, audience, channels, recipients: recipients.length, emailed,
    });

    res.status(201).json({ announcement, recipients: recipients.length, emailed });
  } catch (e) { next(e); }
});

// Delete announcement
router.delete('/:id', requireRole(...DELETE_ROLES), async (req, res, next) => {
  try {
    const existing = await prisma.announcement.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Announcement not found' });
    await prisma.announcement.delete({ where: { id: req.params.id } });
    await writeAudit(req, 'announcement.deleted', 'Announcement', req.params.id, { title: existing.title }, null);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
