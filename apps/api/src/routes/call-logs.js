// Phase 49 Track 5: Call Logging.
// Mount (server.js — coordinator): app.use('/api/call-logs', require('./routes/call-logs'));
// Sidebar link nahi — comms extend hai.
// Store: Track 1 ka CommMessage model (channel='voice'). Merge se pehle 503 guard — koi 500 nahi.
//
// Comms UI integration note (coordinator):
//   - Member detail ke "💬 Comms" tab me "📞 Log call" button → POST /api/call-logs
//     { memberId, direction: 'outbound'|'inbound', durationSec, outcome, notes }
//   - Click-to-call: member phone par `<a href="tel:+92...">` link — number sirf digits/+
//     rakhein: phone.replace(/[^+\d]/g, '')
//   - Call history: GET /api/call-logs/:memberId → list

const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser, requireRole } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF_ROLES = ['ceo', 'admin', 'super_admin', 'manager', 'receptionist', 'ops'];

function commModel(res) {
  if (!prisma.commMessage) {
    res.status(503).json({ ok: false, error: 'Call logging abhi available nahi — migration pending hai' });
    return null;
  }
  return prisma.commMessage;
}

const callSchema = z.object({
  memberId: z.string().min(1),
  direction: z.enum(['in', 'out', 'inbound', 'outbound']).default('out'),
  durationSec: z.number().int().min(0).max(86400).optional(),
  outcome: z.enum(['answered', 'no_answer', 'busy', 'voicemail', 'callback_requested', 'wrong_number']).default('answered'),
  notes: z.string().max(2000).optional(),
});

const OUTCOME_LABELS = {
  answered: 'Jawab diya',
  no_answer: 'Jawab nahi diya',
  busy: 'Busy tha',
  voicemail: 'Voicemail',
  callback_requested: 'Callback manga',
  wrong_number: 'Ghalat number',
};

function normDirection(d) {
  return d === 'outbound' ? 'out' : d === 'inbound' ? 'in' : d;
}

// POST /api/call-logs — call log karo → CommMessage (channel='voice')
router.post('/', requireRole(STAFF_ROLES), async (req, res) => {
  try {
    const cm = commModel(res);
    if (!cm) return;
    const tf = tenantFilter(req);
    const parsed = callSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: 'Ghalat data', details: parsed.error.issues });
    }
    const { memberId, direction, durationSec, outcome, notes } = parsed.data;

    const member = await prisma.member.findFirst({ where: { ...tf, id: memberId }, select: { id: true, name: true } });
    if (!member) return res.status(404).json({ ok: false, error: 'Member nahi mila' });

    const dir = normDirection(direction);
    const body = [
      `📞 ${dir === 'out' ? 'Outbound' : 'Inbound'} call — ${member.name}`,
      `Outcome: ${OUTCOME_LABELS[outcome] || outcome}`,
      durationSec != null ? `Duration: ${Math.floor(durationSec / 60)}m ${durationSec % 60}s` : null,
      notes ? `Notes: ${notes}` : null,
    ].filter(Boolean).join('\n');

    const log = await cm.create({
      data: {
        tenantId: tf.tenantId,
        channel: 'voice',
        direction: dir,
        memberId: member.id,
        userId: req.user.id,
        subject: `Call — ${OUTCOME_LABELS[outcome] || outcome}`,
        body,
        status: 'sent',
        sentAt: new Date(),
      },
    });

    await writeAudit(req, {
      action: 'call-log.create',
      entity: 'CommMessage',
      entityId: log.id,
      newValue: { memberId: member.id, direction: dir, outcome, durationSec: durationSec ?? null },
    }).catch(() => {});

    res.status(201).json({ ok: true, id: log.id });
  } catch (e) {
    console.error('[call-logs] create failed:', e.message);
    res.status(500).json({ ok: false, error: 'Call log save nahi ho saka' });
  }
});

// GET /api/call-logs/:memberId — member ki call history (nayi pehle)
router.get('/:memberId', requireRole(STAFF_ROLES), async (req, res) => {
  try {
    const cm = commModel(res);
    if (!cm) return;
    const tf = tenantFilter(req);
    const { memberId } = req.params;

    const member = await prisma.member.findFirst({ where: { ...tf, id: memberId }, select: { id: true, name: true, phone: true } });
    if (!member) return res.status(404).json({ ok: false, error: 'Member nahi mila' });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const [total, rows] = await Promise.all([
      cm.count({ where: { ...tf, memberId, channel: 'voice' } }),
      cm.findMany({
        where: { ...tf, memberId, channel: 'voice' },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: { id: true, direction: true, subject: true, body: true, status: true, createdAt: true, userId: true },
      }),
    ]);

    const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))];
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));

    res.json({
      ok: true,
      member: { id: member.id, name: member.name, phone: member.phone },
      items: rows.map((r) => ({ ...r, staffName: r.userId ? userMap[r.userId] || null : null })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (e) {
    console.error('[call-logs] history failed:', e.message);
    res.status(500).json({ ok: false, error: 'Call history load nahi ho saki' });
  }
});

module.exports = router;
