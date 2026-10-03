// Phase 49 Track 9/10: Team Inbox & Assignment — staff team inbox for comms.
// Coordinator ke liye:
//   Mount: app.use('/api/inbox', require('./routes/inbox'));
//   Sidebar link: { label: 'Team Inbox', path: '/comms/inbox' } (roles: ceo/admin/super_admin/manager/receptionist)
//   Schema merge: fragments/comms.prisma (Track 1: CommMessage) + fragments/inbox.prisma
//   (Track 9 DELTA: assignedToId, isResolved, resolvedAt) → schema.prisma; migration SQL dono fragments me.
//   Reply action Track 1 ke lib/comms.js (sendViaChannel) ko lazily reuse karta hai —
//   merge na hua ho to fallback seedha CommMessage create karta hai (koi crash nahi).
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'manager', 'receptionist'));

// Model merge na hua ho to safe 503 (koi 500 nahi)
function commOr503(res) {
  if (!prisma.commMessage) {
    res.status(503).json({ error: 'Comms module abhi migrate nahi hua.' });
    return null;
  }
  return prisma.commMessage;
}

// Delta fields (Track 9) merge na hue hon to raw-mode fallback
async function hasInboxCols() {
  try {
    await prisma.$queryRaw`SELECT "is_resolved" FROM "comm_messages" LIMIT 0`;
    return true;
  } catch { return false; }
}

const CHANNEL_LABELS = { internal: 'Internal', email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp', voice: 'Call', note: 'Note' };

// GET / — conversations: incoming (direction=in) grouped by member + unassigned filter
// Query: assigned=me|unassigned|<userId>, resolved=true|false, channel=, search=, page, limit
router.get('/', async (req, res) => {
  try {
    const comm = commOr503(res); if (!comm) return;
    const tf = tenantFilter(req);
    const { assigned, resolved, channel, search, page = '1', limit = '20' } = req.query;
    const cols = await hasInboxCols();

    const where = { ...tf, direction: 'in' };
    if (channel) where.channel = String(channel);
    if (resolved === 'true') where.isResolved = true;
    else if (resolved === 'false') where.isResolved = false;
    if (assigned === 'unassigned') where.assignedToId = null;
    else if (assigned === 'me') where.assignedToId = req.user.id;
    else if (assigned) where.assignedToId = String(assigned);
    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { body: { contains: q, mode: 'insensitive' } },
        { member: { name: { contains: q, mode: 'insensitive' } } },
        { member: { email: { contains: q, mode: 'insensitive' } } },
      ];
    }

    // Conversations ko member-wise group karo (latest message per member)
    const latest = await comm.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        member: { select: { id: true, name: true, email: true, phone: true } },
        ...(cols ? { assignedTo: { select: { id: true, name: true } } } : {}),
      },
      take: 500,
    });

    const convos = new Map();
    for (const m of latest) {
      const key = m.memberId || `ext:${m.to || 'unknown'}`;
      if (!convos.has(key)) {
        convos.set(key, {
          key,
          memberId: m.memberId,
          member: m.member,
          external: m.memberId ? null : (m.to || 'Unknown'),
          lastMessage: { id: m.id, channel: m.channel, body: m.body.slice(0, 140), createdAt: m.createdAt },
          lastAt: m.createdAt,
          assignedTo: cols ? m.assignedTo : null,
          isResolved: cols ? !!m.isResolved : false,
          unread: 0,
        });
      }
    }

    // Har conversation ke unread count (status != 'read', direction=in)
    const keys = [...convos.keys()];
    const memberIds = keys.filter((k) => !k.startsWith('ext:'));
    if (memberIds.length) {
      const unreadRows = await comm.groupBy({
        by: ['memberId'],
        where: { ...tf, direction: 'in', status: { not: 'read' }, memberId: { in: memberIds } },
        _count: { id: true },
      });
      for (const r of unreadRows) {
        const c = convos.get(r.memberId);
        if (c) c.unread = r._count.id;
      }
    }

    let list = [...convos.values()].sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
    const pg = Math.max(1, parseInt(page, 10) || 1);
    const lim = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const total = list.length;
    list = list.slice((pg - 1) * lim, pg * lim);

    res.json({ conversations: list, total, page: pg, pages: Math.max(1, Math.ceil(total / lim)), channelLabels: CHANNEL_LABELS });
  } catch (e) {
    res.status(500).json({ error: 'Inbox load nahi ho saka.' });
  }
});

// GET /summary — counters
router.get('/summary', async (req, res) => {
  try {
    const comm = commOr503(res); if (!comm) return;
    const tf = tenantFilter(req);
    const cols = await hasInboxCols();
    const [unread, unassigned, resolvedToday] = await Promise.all([
      comm.count({ where: { ...tf, direction: 'in', status: { not: 'read' } } }),
      cols ? comm.count({ where: { ...tf, direction: 'in', assignedToId: null, isResolved: false } }) : 0,
      cols ? comm.count({ where: { ...tf, isResolved: true, resolvedAt: { gte: new Date(Date.now() - 864e5) } } }) : 0,
    ]);
    res.json({ summary: { unread, unassigned, resolvedToday } });
  } catch (e) {
    res.status(500).json({ error: 'Summary load nahi ho saka.' });
  }
});

// GET /thread/:memberId — member ki poori thread (in + out)
router.get('/thread/:memberId', async (req, res) => {
  try {
    const comm = commOr503(res); if (!comm) return;
    const tf = tenantFilter(req);
    const cols = await hasInboxCols();
    const messages = await comm.findMany({
      where: { ...tf, memberId: req.params.memberId },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { id: true, name: true } },
        ...(cols ? { assignedTo: { select: { id: true, name: true } } } : {}),
      },
      take: 200,
    });
    // Thread kholne par incoming ko 'read' mark karo
    await comm.updateMany({
      where: { ...tf, memberId: req.params.memberId, direction: 'in', status: { not: 'read' } },
      data: { status: 'read' },
    });
    res.json({ messages });
  } catch (e) {
    res.status(500).json({ error: 'Thread load nahi ho saka.' });
  }
});

// PATCH /:id — assign / resolve / reopen
router.patch('/:id', async (req, res) => {
  try {
    const comm = commOr503(res); if (!comm) return;
    const cols = await hasInboxCols();
    if (!cols) return res.status(503).json({ error: 'Inbox fields abhi migrate nahi hue.' });
    const tf = tenantFilter(req);
    const schema = z.object({
      assignedToId: z.string().nullable().optional(),
      isResolved: z.boolean().optional(),
    });
    const { assignedToId, isResolved } = schema.parse(req.body || {});
    const msg = await comm.findFirst({ where: { ...tf, id: req.params.id } });
    if (!msg) return res.status(404).json({ error: 'Message nahi mila.' });
    if (assignedToId) {
      const u = await prisma.user.findFirst({ where: { id: assignedToId, tenantId: tf.tenantId } });
      if (!u) return res.status(422).json({ error: 'User isi tenant ka hona chahiye.' });
    }
    const data = {};
    if (assignedToId !== undefined) data.assignedToId = assignedToId;
    if (isResolved !== undefined) { data.isResolved = isResolved; data.resolvedAt = isResolved ? new Date() : null; }
    const updated = await comm.update({ where: { id: msg.id }, data });
    await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'inbox.update', entity: 'CommMessage', entityId: msg.id, newValue: data });
    res.json({ message: updated });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: 'Ghalat input.' });
    res.status(500).json({ error: 'Update nahi ho saka.' });
  }
});

// POST /reply — thread me reply (Track 1 sendViaChannel reuse, fallback direct create)
router.post('/reply', async (req, res) => {
  try {
    const comm = commOr503(res); if (!comm) return;
    const tf = tenantFilter(req);
    const schema = z.object({
      memberId: z.string().min(1),
      channel: z.enum(['internal', 'email', 'sms', 'whatsapp']),
      body: z.string().min(1).max(5000),
      subject: z.string().max(200).optional(),
    });
    const { memberId, channel, body, subject } = schema.parse(req.body || {});
    const member = await prisma.member.findFirst({ where: { ...tf, id: memberId } });
    if (!member) return res.status(404).json({ error: 'Member nahi mila.' });

    let sent = { sent: false, reason: 'queued' };
    try {
      // Track 1 ka sender lazily — merge na hua ho to fallback
      const commsLib = require('../lib/comms');
      if (commsLib && typeof commsLib.sendViaChannel === 'function') {
        sent = await commsLib.sendViaChannel({ tenantId: tf.tenantId, channel, member, body, subject, userId: req.user.id });
      } else {
        throw new Error('no-sender');
      }
    } catch {
      sent = await comm.create({
        data: {
          tenantId: tf.tenantId, channel, direction: 'out', memberId: member.id,
          userId: req.user.id, subject: subject || null, body,
          status: 'queued', provider: 'manual',
        },
      }).then((m) => ({ sent: false, reason: 'queued', messageId: m.id }));
    }

    await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'inbox.reply', entity: 'CommMessage', entityId: memberId, newValue: { channel } });
    res.json({ ok: true, result: sent });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: 'Ghalat input.' });
    res.status(500).json({ error: 'Reply nahi bheja ja saka.' });
  }
});

module.exports = router;
