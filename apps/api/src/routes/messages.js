// Phase 40 Track 3: Internal Messaging (Chat) — staff ↔ member conversations,
// polling-based message threads with in-app + push notifications on new message.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { createNotification } = require('../lib/notify');

const router = express.Router();

function audit(req, action, entityId, newValue) {
  return writeAudit({
    tenantId: req.user.tenantId,
    actorId: req.user.sub,
    action,
    entity: 'Conversation',
    entityId,
    newValue: newValue || null,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
}

const createConvSchema = z.object({
  type: z.enum(['direct', 'group', 'support']).default('direct'),
  title: z.string().max(120).optional().nullable(),
  ticketId: z.string().optional().nullable(),
  participantUserIds: z.array(z.string()).max(50).default([]),
  participantMemberIds: z.array(z.string()).max(50).default([]),
});

const sendMsgSchema = z.object({
  body: z.string().min(1).max(4000),
  attachments: z.array(z.object({ name: z.string().max(200), url: z.string().max(2000), type: z.string().max(80).optional() })).max(5).optional().nullable(),
});

// Current user's identity as participant: userId + (linked) memberId.
async function myIdentities(tenantId, userId) {
  const member = await prisma.member.findFirst({
    where: { tenantId, user: { id: userId } },
    select: { id: true },
  });
  return { userId, memberId: member ? member.id : null };
}

function isParticipant(conversation, { userId, memberId }) {
  return conversation.participants.some(
    (p) => (p.userId && p.userId === userId) || (memberId && p.memberId && p.memberId === memberId)
  );
}

function senderIdentityOf({ userId, memberId }) {
  // sender ki "read identity": userId primary, warna memberId
  return { senderUserId: userId, senderMemberId: memberId };
}

function displayName(msg) {
  if (msg.senderUser) return msg.senderUser.name || msg.senderUser.email || 'User';
  if (msg.senderMember) return msg.senderMember.name || 'Member';
  return 'Unknown';
}

async function getConversation(tenantId, id) {
  return prisma.conversation.findFirst({
    where: { id, ...tenantFilter(tenantId) },
    include: {
      participants: {
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
          member: { select: { id: true, name: true } },
        },
      },
    },
  });
}

// Notify every participant except the sender (in-app + push via notify lib).
async function notifyParticipants({ tenantId, conversation, sender }) {
  for (const p of conversation.participants) {
    const isMe =
      (p.userId && sender.userId && p.userId === sender.userId) ||
      (p.memberId && sender.memberId && p.memberId === sender.memberId);
    if (isMe) continue;
    try {
      const snippet = (sender.body || '').slice(0, 80);
      await createNotification(prisma, {
        tenantId,
        userId: p.userId || null,
        // user-less member: member ke linked user ko notify karne ke liye memberId wala
        // path — notification model userId/role based hai, is liye member ke liye
        // role-based fallback: support type par staff ko.
        role: !p.userId && conversation.type === 'support' ? 'manager' : null,
        type: 'message.new',
        message: `💬 New message in "${conversation.title || 'chat'}" from ${sender.name}: ${snippet}`,
      });
    } catch {
      /* notify fail ho to message save ho chuka — non-fatal */
    }
  }
}

// ---------------------------------------------------------------------------
router.use(authenticate, requireTenantUser);

// GET /conversations — meri conversations (userId ya memberId se participant)
router.get('/conversations', async (req, res, next) => {
  try {
    if (!prisma.conversation) return res.status(503).json({ error: 'Messaging not enabled yet' });
    const me = await myIdentities(req.user.tenantId, req.user.sub);
    const convs = await prisma.conversation.findMany({
      where: {
        ...tenantFilter(req.user.tenantId),
        participants: {
          some: {
            OR: [{ userId: me.userId }, ...(me.memberId ? [{ memberId: me.memberId }] : [])],
          },
        },
      },
      include: {
        participants: {
          include: {
            user: { select: { id: true, name: true, role: true } },
            member: { select: { id: true, name: true } },
          },
        },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({
      conversations: convs.map((c) => {
        const last = c.messages[0];
        const readBy = last && Array.isArray(last.readBy) ? last.readBy : [];
        return {
          id: c.id,
          type: c.type,
          title: c.title,
          ticketId: c.ticketId,
          updatedAt: c.updatedAt,
          participants: c.participants.map((p) => ({
            userId: p.userId,
            memberId: p.memberId,
            name: p.user ? p.user.name : p.member ? p.member.name : 'Unknown',
            role: p.user ? p.user.role : 'member',
          })),
          lastMessage: last
            ? { body: last.body.slice(0, 120), createdAt: last.createdAt }
            : null,
          unread: last ? !(readBy.includes(me.userId) || (me.memberId && readBy.includes(me.memberId))) : false,
        };
      }),
    });
  } catch (e) {
    next(e);
  }
});

// POST /conversations — nayi conversation (member select kar ke)
router.post('/conversations', validateBody(createConvSchema), async (req, res, next) => {
  try {
    if (!prisma.conversation) return res.status(503).json({ error: 'Messaging not enabled yet' });
    const tenantId = req.user.tenantId;
    const { type, title, ticketId, participantUserIds, participantMemberIds } = req.body;
    const me = await myIdentities(tenantId, req.user.sub);

    // Participants tenant ke hon — cross-tenant injection rokho.
    const users = participantUserIds.length
      ? await prisma.user.findMany({ where: { id: { in: participantUserIds }, tenantId }, select: { id: true } })
      : [];
    const members = participantMemberIds.length
      ? await prisma.member.findMany({ where: { id: { in: participantMemberIds }, tenantId }, select: { id: true } })
      : [];

    const conv = await prisma.conversation.create({
      data: {
        tenantId,
        type,
        title: title || null,
        ticketId: ticketId || null,
        participants: {
          create: [
            { userId: me.userId, memberId: me.memberId },
            ...users.map((u) => ({ userId: u.id })),
            ...members.map((m) => ({ memberId: m.id })),
          ],
        },
      },
    });
    await audit(req, 'conversation.create', conv.id, { type, title: title || null });
    res.status(201).json({ id: conv.id });
  } catch (e) {
    next(e);
  }
});

// GET /conversations/:id/messages — thread (?after=timestamp for polling)
router.get('/conversations/:id/messages', async (req, res, next) => {
  try {
    if (!prisma.conversation) return res.status(503).json({ error: 'Messaging not enabled yet' });
    const conv = await getConversation(req.user.tenantId, req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    const me = await myIdentities(req.user.tenantId, req.user.sub);
    if (!isParticipant(conv, me)) return res.status(403).json({ error: 'Not a participant' });

    const after = req.query.after ? new Date(req.query.after) : null;
    const messages = await prisma.message.findMany({
      where: {
        conversationId: conv.id,
        ...(after && !isNaN(after) ? { createdAt: { gt: after } } : {}),
      },
      include: {
        senderUser: { select: { id: true, name: true, role: true } },
        senderMember: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });

    // Read receipts mark karo (batch me).
    const myKeys = [me.userId, ...(me.memberId ? [me.memberId] : [])];
    const markOps = messages
      .filter((m) => {
        const rb = Array.isArray(m.readBy) ? m.readBy : [];
        return !myKeys.some((k) => rb.includes(k));
      })
      .map((m) => {
        const rb = Array.isArray(m.readBy) ? m.readBy : [];
        return prisma.message.update({
          where: { id: m.id },
          data: { readBy: [...new Set([...rb, ...myKeys])] },
        });
      });
    if (markOps.length) await Promise.all(markOps);

    res.json({
      messages: messages.map((m) => ({
        id: m.id,
        body: m.body,
        attachments: m.attachments || null,
        createdAt: m.createdAt,
        senderName: displayName(m),
        senderRole: m.senderUser ? m.senderUser.role : 'member',
        mine: (m.senderUserId && m.senderUserId === me.userId) ||
          (m.senderMemberId && me.memberId && m.senderMemberId === me.memberId),
      })),
    });
  } catch (e) {
    next(e);
  }
});

// POST /conversations/:id/messages — bhejo (recipient ko in-app + push)
router.post('/conversations/:id/messages', validateBody(sendMsgSchema), async (req, res, next) => {
  try {
    if (!prisma.conversation) return res.status(503).json({ error: 'Messaging not enabled yet' });
    const conv = await getConversation(req.user.tenantId, req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    const me = await myIdentities(req.user.tenantId, req.user.sub);
    if (!isParticipant(conv, me)) return res.status(403).json({ error: 'Not a participant' });

    const sender = senderIdentityOf(me);
    const msg = await prisma.message.create({
      data: {
        conversationId: conv.id,
        senderUserId: sender.senderUserId,
        senderMemberId: sender.senderMemberId,
        body: req.body.body,
        attachments: req.body.attachments || null,
        readBy: [me.userId, ...(me.memberId ? [me.memberId] : [])],
      },
    });
    await prisma.conversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });

    const senderName =
      (await prisma.user.findUnique({ where: { id: me.userId }, select: { name: true } }))?.name || 'Someone';
    await notifyParticipants({
      tenantId: req.user.tenantId,
      conversation: conv,
      sender: { ...me, name: senderName, body: req.body.body },
    });

    await audit(req, 'message.send', msg.id, { conversationId: conv.id });
    // Phase 49 Track 8: auto-reply hook (best effort, fire-and-forget — sirf member-sent messages par)
    if (sender.senderMemberId && req.body.body) {
      try {
        const { maybeAutoReply } = require('../lib/autoReply');
        maybeAutoReply(req.user.tenantId, 'internal', req.body.body, {
          conversationKey: 'conv:' + conv.id,
          sendReply: async (replyBody) => {
            await prisma.message.create({
              data: {
                conversationId: conv.id,
                senderUserId: null,
                senderMemberId: null,
                body: replyBody,
                readBy: [],
              },
            }).catch(() => {});
          },
        }).catch(() => {});
      } catch {}
    }
    res.status(201).json({ id: msg.id });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
