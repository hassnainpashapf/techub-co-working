// Phase 49 Track 2: Member 360° Comms Timeline — unified communication history per member.
// Mount: app.use('/api/comms-timeline', require('./routes/comms-timeline'));
// Sidebar link nahi — member detail page me "💬 Comms" tab jorein:
//   GET /api/comms-timeline/:memberId → items (channel badges ke sath), newest first.
// Frontend note: har item me `badge: { label, tone }` hai — channel chip isi se render karein.
//   tones: internal=blue, email=violet, sms=amber, whatsapp=green, notification=slate, voice=rose, note=gray
//
// Sources (sab tenant-scoped, koi migration nahi):
//   1. CommMessage (Track 1 — merge na ho to section skip, koi 500 nahi)
//   2. Phase 40 internal messaging: Conversation → ConversationParticipant(memberId) → Message
//   3. Email/SMS/WhatsApp history: Job table (type email|sms|whatsapp, payload.to = member email/phone)
//   4. In-app notifications: member ke linked users (User.memberId) par
const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser, requireRole } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();

const STAFF = ['ceo', 'admin', 'super_admin', 'manager', 'receptionist', 'ops'];

router.use(authenticate, requireTenantUser);

const BADGES = {
  internal: { label: 'Chat', tone: 'blue' },
  email: { label: 'Email', tone: 'violet' },
  sms: { label: 'SMS', tone: 'amber' },
  whatsapp: { label: 'WhatsApp', tone: 'green' },
  notification: { label: 'Notice', tone: 'slate' },
  voice: { label: 'Call', tone: 'rose' },
  note: { label: 'Note', tone: 'gray' },
};

function stripHtml(s) {
  if (!s) return '';
  return String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function snippet(s, n = 160) {
  const t = stripHtml(s);
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}
function hasModel(name) {
  try { return !!prisma[name]; } catch { return false; }
}

router.get(
  '/:memberId',
  requireRole(...STAFF),
  async (req, res, next) => {
    try {
      const tf = tenantFilter(req);
      const { memberId } = req.params;
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);

      const member = await prisma.member.findFirst({
        where: { id: memberId, ...tf },
        select: { id: true, name: true, email: true, phone: true },
      });
      if (!member) return res.status(404).json({ error: 'Member not found' });

      const items = [];
      const skipped = [];

      // 1) Unified hub messages (Track 1 — CommMessage)
      if (hasModel('commMessage')) {
        try {
          const rows = await prisma.commMessage.findMany({
            where: { memberId, ...tf },
            orderBy: { createdAt: 'desc' },
            take: limit,
          });
          for (const r of rows) {
            items.push({
              id: `hub-${r.id}`,
              channel: r.channel || 'note',
              badge: BADGES[r.channel] || BADGES.note,
              direction: r.direction || 'out',
              subject: r.subject || null,
              body: snippet(r.body),
              status: r.status || 'sent',
              from: r.direction === 'in' ? member.name : 'Staff',
              at: r.createdAt,
              meta: { scheduledFor: r.scheduledFor || null, externalId: r.externalId || null },
            });
          }
        } catch (e) { skipped.push('hub'); }
      } else {
        skipped.push('hub');
      }

      // 2) Phase 40 internal messaging (conversations jahan member participant hai)
      if (hasModel('message') && hasModel('conversationParticipant')) {
        try {
          const parts = await prisma.conversationParticipant.findMany({
            where: { memberId },
            select: { conversationId: true },
          });
          const convIds = parts.map((p) => p.conversationId);
          if (convIds.length) {
            const msgs = await prisma.message.findMany({
              where: { conversationId: { in: convIds } },
              include: {
                senderUser: { select: { name: true } },
                senderMember: { select: { name: true } },
                conversation: { select: { title: true, type: true, tenantId: true } },
              },
              orderBy: { createdAt: 'desc' },
              take: limit,
            });
            for (const m of msgs) {
              if (m.conversation?.tenantId && m.conversation.tenantId !== req.user.tenantId) continue;
              const mine = m.senderMemberId === memberId;
              items.push({
                id: `chat-${m.id}`,
                channel: 'internal',
                badge: BADGES.internal,
                direction: mine ? 'out' : 'in',
                subject: m.conversation?.title || (m.conversation?.type === 'support' ? 'Support chat' : 'Chat'),
                body: snippet(m.body),
                status: 'delivered',
                from: mine ? member.name : (m.senderUser?.name || m.senderMember?.name || 'Staff'),
                at: m.createdAt,
                meta: { conversationId: m.conversationId },
              });
            }
          }
        } catch (e) { skipped.push('chat'); }
      }

      // 3) Email / SMS / WhatsApp history (Job queue — payload.to se match)
      if (hasModel('job')) {
        try {
          const jobs = await prisma.job.findMany({
            where: { ...tf, type: { in: ['email', 'sms', 'whatsapp'] } },
            orderBy: { createdAt: 'desc' },
            take: 300,
          });
          const email = (member.email || '').toLowerCase();
          const phone = (member.phone || '').replace(/\D/g, '');
          for (const j of jobs) {
            const p = j.payload || {};
            const to = String(p.to || '').toLowerCase();
            const toDigits = to.replace(/\D/g, '');
            const match =
              (j.type === 'email' && email && to === email) ||
              (j.type !== 'email' && phone && toDigits && (toDigits === phone || toDigits.endsWith(phone) || phone.endsWith(toDigits)));
            if (!match) continue;
            items.push({
              id: `job-${j.id}`,
              channel: j.type,
              badge: BADGES[j.type] || BADGES.note,
              direction: 'out',
              subject: p.subject || null,
              body: snippet(p.text || p.html || p.body || p.message || ''),
              status: j.status === 'completed' ? 'sent' : j.status,
              from: 'System',
              at: j.createdAt,
              meta: { lastError: j.lastError || null, attempts: j.attempts },
            });
            if (items.length > 400) break;
          }
        } catch (e) { skipped.push('jobs'); }
      }

      // 4) In-app notifications (member ke linked users par)
      if (hasModel('notification') && hasModel('user')) {
        try {
          const users = await prisma.user.findMany({
            where: { memberId, ...tf },
            select: { id: true },
          });
          const uids = users.map((u) => u.id);
          if (uids.length) {
            const notifs = await prisma.notification.findMany({
              where: { ...tf, userId: { in: uids } },
              orderBy: { createdAt: 'desc' },
              take: limit,
            });
            for (const n of notifs) {
              items.push({
                id: `notif-${n.id}`,
                channel: 'notification',
                badge: BADGES.notification,
                direction: 'in',
                subject: n.type ? String(n.type).replace(/_/g, ' ') : 'Notification',
                body: snippet(n.message),
                status: n.isRead ? 'read' : 'delivered',
                from: 'System',
                at: n.createdAt,
                meta: null,
              });
            }
          }
        } catch (e) { skipped.push('notifications'); }
      }

      items.sort((a, b) => new Date(b.at) - new Date(a.at));
      const sliced = items.slice(0, 200);

      res.json({
        member: { id: member.id, name: member.name, email: member.email, phone: member.phone },
        total: sliced.length,
        partial: skipped.length > 0,
        skipped,
        items: sliced,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
