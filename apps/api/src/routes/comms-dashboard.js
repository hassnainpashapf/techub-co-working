// Phase 49 Track 10/10: Comms Analytics Dashboard — stats for the comms hub.
// Coordinator ke liye:
//   Mount: app.use('/api/comms-dashboard', require('./routes/comms-dashboard'));
//   Sidebar link: { label: 'Communication Hub', path: '/comms' } — roles: ceo/admin/super_admin/manager
//   Schema merge: tracks 1-9 ke models (CommMessage + inbox delta fields + SmsCampaign).
//   Har section defensive hai — model/column merge na ho to wo section null, poora endpoint 200 rehta hai.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'manager'));

function d30Ago() {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}

// Check karta hai ke comm_messages table me inbox delta columns (isResolved waghera) hain ya nahi.
async function hasInboxColumns() {
  try {
    const rows = await prisma.$queryRaw`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'comm_messages' AND column_name IN ('is_resolved', 'assigned_to_id')`;
    const names = rows.map((r) => r.column_name);
    return { isResolved: names.includes('is_resolved'), assignedToId: names.includes('assigned_to_id') };
  } catch { return { isResolved: false, assignedToId: false }; }
}

// GET /api/comms-dashboard/stats
router.get('/stats', async (req, res) => {
  const tf = tenantFilter(req);
  const since = d30Ago();
  const out = { migrated: {}, missing: [], periodDays: 30 };

  if (!prisma.commMessage) {
    out.missing.push('commMessage');
    out.byChannel = [];
    out.deliveryRate = null;
    out.avgResponseMin = null;
    out.unresolvedInbox = null;
    out.topMembers = [];
    return res.json({ ok: true, stats: out });
  }

  try {
    out.migrated.commMessage = true;

    // 1. Messages by channel (30d)
    let byChannel = [];
    try {
      const grouped = await prisma.commMessage.groupBy({
        by: ['channel'],
        where: { ...tf, createdAt: { gte: since } },
        _count: { channel: true },
      });
      byChannel = grouped
        .map((g) => ({ channel: g.channel, count: g._count.channel }))
        .sort((a, b) => b.count - a.count);
    } catch { byChannel = []; }
    out.byChannel = byChannel;
    out.totalMessages = byChannel.reduce((s, r) => s + r.count, 0);

    // 2. Delivery rate (outgoing: sent+delivered+read / total attempted)
    try {
      const [deliveredish, failed, total] = await Promise.all([
        prisma.commMessage.count({ where: { ...tf, direction: 'out', createdAt: { gte: since }, status: { in: ['sent', 'delivered', 'read'] } } }),
        prisma.commMessage.count({ where: { ...tf, direction: 'out', createdAt: { gte: since }, status: 'failed' } }),
        prisma.commMessage.count({ where: { ...tf, direction: 'out', createdAt: { gte: since } } }),
      ]);
      out.deliveryRate = total > 0 ? Math.round((deliveredish / total) * 1000) / 10 : null;
      out.failedCount = failed;
    } catch { out.deliveryRate = null; out.failedCount = null; }

    // 3. Avg response time: incoming -> pehla outgoing reply (same member, 7 din window), minutes me
    try {
      const incoming = await prisma.commMessage.findMany({
        where: { ...tf, direction: 'in', createdAt: { gte: since }, memberId: { not: null } },
        select: { id: true, memberId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      const diffs = [];
      for (const msg of incoming) {
        const reply = await prisma.commMessage.findFirst({
          where: { ...tf, direction: 'out', memberId: msg.memberId, createdAt: { gt: msg.createdAt, lte: new Date(msg.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000) } },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        });
        if (reply) diffs.push((reply.createdAt.getTime() - msg.createdAt.getTime()) / 60000);
      }
      out.avgResponseMin = diffs.length > 0 ? Math.round((diffs.reduce((s, d) => s + d, 0) / diffs.length) * 10) / 10 : null;
      out.respondedConversations = diffs.length;
    } catch { out.avgResponseMin = null; out.respondedConversations = null; }

    // 4. Unresolved inbox count (track 9 ka isResolved column agar merge hua ho)
    try {
      const cols = await hasInboxColumns();
      if (cols.isResolved) {
        const rows = await prisma.$queryRaw`
          SELECT COUNT(*)::int AS c FROM comm_messages
          WHERE tenant_id = ${tf.tenantId} AND direction = 'in'
            AND created_at >= ${since} AND is_resolved = false`;
        out.unresolvedInbox = rows[0] ? rows[0].c : 0;
      } else {
        out.unresolvedInbox = null;
        out.missing.push('commMessage.isResolved');
      }
    } catch { out.unresolvedInbox = null; }

    // 5. Top active members (sab se zyada messages, 30d)
    try {
      const grouped = await prisma.commMessage.groupBy({
        by: ['memberId'],
        where: { ...tf, createdAt: { gte: since }, memberId: { not: null } },
        _count: { memberId: true },
        orderBy: { _count: { memberId: 'desc' } },
        take: 8,
      });
      const ids = grouped.map((g) => g.memberId);
      const members = ids.length
        ? await prisma.member.findMany({ where: { ...tf, id: { in: ids } }, select: { id: true, name: true, email: true } })
        : [];
      const byId = Object.fromEntries(members.map((m) => [m.id, m]));
      out.topMembers = grouped.map((g) => ({
        memberId: g.memberId,
        name: byId[g.memberId] ? byId[g.memberId].name : '—',
        email: byId[g.memberId] ? byId[g.memberId].email : null,
        count: g._count.memberId,
      }));
    } catch { out.topMembers = []; }

    // 6. SMS campaigns summary (track 4 — optional, guarded)
    if (prisma.smsCampaign) {
      try {
        const [total, sending] = await Promise.all([
          prisma.smsCampaign.count({ where: { ...tf } }),
          prisma.smsCampaign.count({ where: { ...tf, status: 'sending' } }),
        ]);
        out.smsCampaigns = { total, sending };
      } catch { out.smsCampaigns = null; }
    } else { out.missing.push('smsCampaign'); out.smsCampaigns = null; }
  } catch (e) {
    out.error = 'stats_partial';
  }

  return res.json({ ok: true, stats: out });
});

module.exports = router;
