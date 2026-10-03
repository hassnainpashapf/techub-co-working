// Phase 48 Track 8/10: Member Portal — My Access (GET /api/my-access, POST /api/my-access/request-pass)
// Member auth. Dependencies: Track 2 (AccessCredential), Track 3 (AccessLog), Track 4 (AccessSchedule),
// Track 1 (Door), Track 5 (DayPass). Koi bhi model merge na ho to wo section gracefully
// empty/null milta hai — poora endpoint 500 nahi hota. POST /request-pass ko DayPass model chahiye
// (merge na ho to 503).
//
// Coordinator:
// - Mount: app.use('/api/my-access', require('./routes/my-access'));  (member-auth portal routes ke sath)
// - Sidebar link: NAHI — portal page hai (/portal/access)
// - DayPass note: Track 5 ka model; status String hai is liye 'pending' value yahan use ki hai.
//   Agar Track 5 ne status ko enum banaya ho to 'pending' us me add karein.
// - Server.js/Sidebar.js is track me nahi chhue.

const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);

// ---------------------------------------------------------------------------
// Model guards (Phase 48 fragments abhi merge nahi hue — graceful degrade)
// ---------------------------------------------------------------------------
function has(model) {
  return !!(prisma && typeof prisma[model]?.findMany === 'function');
}
const ready = {
  credential: () => has('accessCredential'),
  schedule: () => has('accessSchedule'),
  log: () => has('accessLog'),
  dayPass: () => has('dayPass'),
};

// ---------------------------------------------------------------------------
// Member resolution (ai-chat.js myMember pattern)
// ---------------------------------------------------------------------------
async function myMember(req) {
  const tf = tenantFilter(req);
  if (req.user.memberId) {
    const m = await prisma.member.findFirst({ where: { id: req.user.memberId, ...tf } });
    if (m) return m;
  }
  if (req.user.email) {
    const m = await prisma.member.findFirst({ where: { email: req.user.email, ...tf } });
    if (m) return m;
  }
  return null;
}

const DAY_LABEL = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };

function scheduleLabel(s) {
  const days = Array.isArray(s.daysOfWeek) ? s.daysOfWeek : [];
  const dayStr = days.length === 7 ? 'Rozana' : days.map((d) => DAY_LABEL[d] || d).join(', ');
  return `${dayStr} · ${s.startTime}–${s.endTime}`;
}

// ---------------------------------------------------------------------------
// GET /api/my-access — meri credentials, schedules, recent entries
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member) return res.status(404).json({ error: 'member_not_found' });

    const out = { member: { id: member.id, name: member.name, status: member.status }, pendingMigration: [] };

    // 1) Active credentials — PIN/token KABHI plain nahi (sirf type + metadata)
    if (ready.credential()) {
      try {
        const creds = await prisma.accessCredential.findMany({
          where: { memberId: member.id, isActive: true, ...tf },
          orderBy: { createdAt: 'desc' },
        });
        out.credentials = creds.map((c) => ({
          id: c.id,
          type: c.type, // pin | rfid | mobile
          masked: c.type === 'pin' ? '••••••' : '••••',
          lastUsedAt: c.lastUsedAt,
          expiresAt: c.expiresAt,
          createdAt: c.createdAt,
        }));
      } catch (_e) {
        out.credentials = [];
      }
    } else {
      out.credentials = [];
      out.pendingMigration.push('access_credential');
    }

    // 2) Meri schedules: member-specific + default (memberId null)
    if (ready.schedule()) {
      try {
        const schedules = await prisma.accessSchedule.findMany({
          where: { tenantId: tf.tenantId, isActive: true, OR: [{ memberId: member.id }, { memberId: null }] },
          include: { door: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        });
        out.schedules = schedules.map((s) => ({
          id: s.id,
          label: scheduleLabel(s),
          door: s.door ? s.door.name : 'Tamam doors',
          scope: s.memberId ? 'personal' : 'default',
        }));
      } catch (_e) {
        out.schedules = [];
      }
    } else {
      out.schedules = [];
      out.pendingMigration.push('access_schedule');
    }

    // 3) Meri recent entries (pichhle 30 din)
    if (ready.log()) {
      try {
        const since = new Date();
        since.setDate(since.getDate() - 30);
        const logs = await prisma.accessLog.findMany({
          where: { memberId: member.id, createdAt: { gte: since }, ...tf },
          include: { door: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 50,
        });
        out.entries = logs.map((l) => ({
          id: l.id,
          door: l.door ? l.door.name : '—',
          direction: l.direction,
          result: l.result,
          credentialType: l.credentialType,
          at: l.createdAt,
        }));
      } catch (_e) {
        out.entries = [];
      }
    } else {
      out.entries = [];
      out.pendingMigration.push('access_log');
    }

    // 4) Meri day-pass requests (pending/active)
    if (ready.dayPass()) {
      try {
        const passes = await prisma.dayPass.findMany({
          where: { hostMemberId: member.id, status: { in: ['pending', 'active'] }, ...tf },
          orderBy: { createdAt: 'desc' },
          take: 20,
        });
        out.myPassRequests = passes.map((p) => ({
          id: p.id,
          visitorName: p.visitorName,
          status: p.status,
          validFrom: p.validFrom,
          validUntil: p.validUntil,
          createdAt: p.createdAt,
        }));
      } catch (_e) {
        out.myPassRequests = [];
      }
    } else {
      out.myPassRequests = [];
      out.pendingMigration.push('day_pass');
    }

    res.json(out);
  } catch (err) {
    res.status(500).json({ error: 'server_error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/my-access/request-pass — visitor day pass request (host = me)
// → reception approval queue (status 'pending')
// ---------------------------------------------------------------------------
const requestPassSchema = z.object({
  visitorName: z.string().min(2).max(120),
  visitorPhone: z.string().max(30).optional().nullable(),
  validFrom: z.string().datetime().optional(), // ISO; default: ab se
  validUntil: z.string().datetime(),
  notes: z.string().max(500).optional().nullable(),
});

router.post('/request-pass', async (req, res) => {
  try {
    if (!ready.dayPass()) {
      return res.status(503).json({ error: 'day_pass_migration_pending' });
    }
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member) return res.status(404).json({ error: 'member_not_found' });

    const body = requestPassSchema.parse(req.body);
    const now = new Date();
    const validFrom = body.validFrom ? new Date(body.validFrom) : now;
    const validUntil = new Date(body.validUntil);
    if (validUntil <= validFrom) {
      return res.status(422).json({ error: 'valid_until_must_be_after_from' });
    }
    // Max 7 din ka pass
    if (validUntil - validFrom > 7 * 24 * 3600 * 1000) {
      return res.status(422).json({ error: 'pass_too_long_max_7_days' });
    }

    // Dedupe: isi visitor ke liye pehle se pending/active request ho to dobara nahi
    const existing = await prisma.dayPass.findFirst({
      where: {
        tenantId: tf.tenantId,
        hostMemberId: member.id,
        visitorName: body.visitorName,
        status: { in: ['pending', 'active'] },
      },
    });
    if (existing) {
      return res.status(409).json({ error: 'duplicate_request', passId: existing.id });
    }

    const pass = await prisma.dayPass.create({
      data: {
        tenantId: tf.tenantId,
        visitorName: body.visitorName,
        visitorPhone: body.visitorPhone || null,
        hostMemberId: member.id,
        // code: Track 5 approve kare to QR generate kare — request par pending, code baad me
        code: `PENDING-${Date.now().toString(36)}-${member.id.slice(0, 6)}`,
        validFrom,
        validUntil,
        status: 'pending',
        notes: body.notes || null,
        createdBy: req.user.sub || req.user.id || null,
      },
    });

    // Reception approval queue: receptionist/ops/manager ko in-app notification
    try {
      const msg = `🎫 Day-pass request: ${body.visitorName} (host: ${member.name}) — approve karein`;
      for (const role of ['receptionist', 'ops', 'manager']) {
        await prisma.notification
          .create({ data: { tenantId: tf.tenantId, role, type: 'day_pass_request', message: msg } })
          .catch(() => {});
      }
    } catch { /* notification model issue = fail-safe */ }

    writeAudit(req, { action: 'daypass.request', entity: 'DayPass', entityId: pass.id }).catch(() => {});

    res.status(201).json({
      id: pass.id,
      status: pass.status,
      visitorName: pass.visitorName,
      validFrom: pass.validFrom,
      validUntil: pass.validUntil,
      message: 'Request reception ko bhej di gayi — approval par QR pass milega.',
    });
  } catch (err) {
    if (err?.name === 'ZodError') {
      return res.status(422).json({ error: 'validation', details: err.errors });
    }
    if (err?.code === 'P2022') {
      return res.status(503).json({ error: 'day_pass_migration_pending' });
    }
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
