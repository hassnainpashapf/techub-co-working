// Phase 48 Track 6: Door unlock + hardware webhook.
// MOUNT (coordinator server.js me ADD karein — additive):
//   app.use('/api/door-unlock', require('./routes/door-unlock'));
// NOTE: Door (Track 1), AccessLog (Track 3), AccessCredential (Track 2) ke fragments
// merge/migration se pehle tamam endpoints 503 dete hain (koi 500 crash nahi).
// Device API keys: tenant Setting me `doors.deviceKeyHash` (sha256, plain kabhi store nahi).
// Hardware webhook URL: Setting `doors.webhookUrl` (AES-256-GCM encrypted).
// Integration note (coordinator): doors page ya settings me "Device API key" (generate)
// aur "Hardware webhook URL" ke fields jorein — endpoints neeche ready hain.
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const bcrypt = require('bcryptjs');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimit');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { safePost } = require('../lib/safeFetch');
const { encryptSecret, decryptSecret } = require('../lib/crypto');

const router = express.Router();

// ---- 503 guards (parallel tracks merge se pehle safe fail) ----
function modelsReady() {
  return (
    prisma &&
    typeof prisma.door?.findFirst === 'function' &&
    typeof prisma.accessLog?.create === 'function'
  );
}
function guard(req, res, next) {
  if (!modelsReady()) {
    return res.status(503).json({ error: 'access-control migration pending' });
  }
  next();
}

// ---- Track 4 ka accessCheck agar merge ho gaya ho to wahi, warna fallback ----
let track4Check = null;
try {
  track4Check = require('../lib/accessCheck').canEnter;
} catch (_e) {
  track4Check = null; // Track 4 abhi merge nahi hua — fallback use hoga
}
async function checkAccess(tenantId, memberId, doorId, at) {
  if (track4Check) return track4Check(tenantId, memberId, doorId, at);
  const member = await prisma.member.findFirst({ where: { id: memberId, tenantId } });
  if (!member) return { allowed: false, reason: 'member-not-found' };
  if (member.status && member.status !== 'active') {
    return { allowed: false, reason: 'member-inactive' };
  }
  return { allowed: true };
}

// ---- Device API key helpers (Setting-based) ----
const DEVICE_KEY_SETTING = 'doors.deviceKeyHash';
const WEBHOOK_SETTING = 'doors.webhookUrl';

function hashDeviceKey(plain) {
  return crypto.createHash('sha256').update(String(plain)).digest('hex');
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
async function getDeviceKeyHash(tenantId) {
  const row = await prisma.setting.findUnique({
    where: { tenantId_key: { tenantId, key: DEVICE_KEY_SETTING } },
  });
  return row ? row.value : null;
}
async function getWebhookUrl(tenantId) {
  const row = await prisma.setting.findUnique({
    where: { tenantId_key: { tenantId, key: WEBHOOK_SETTING } },
  });
  if (!row) return null;
  try {
    return decryptSecret(row.value) || null;
  } catch {
    return null;
  }
}

// ================= STAFF: manual unlock request =================
const STAFF_ROLES = ['receptionist', 'ops', 'operations_manager', 'manager', 'admin', 'ceo', 'super_admin'];
const staffOnly = [authenticate, requireTenantUser, requireRole(...STAFF_ROLES)];

const unlockSchema = z.object({
  doorId: z.string().min(1),
  memberId: z.string().min(1).optional().nullable(),
  credentialType: z.enum(['pin', 'rfid', 'mobile', 'manual']).default('manual'),
  direction: z.enum(['in', 'out']).default('in'),
  note: z.string().max(200).optional().nullable(),
});

// POST /api/door-unlock/request — staff darwaza khole (member check + log + hardware webhook)
router.post(
  '/request',
  guard,
  ...staffOnly,
  rateLimit({ windowMs: 60000, max: 60, keyBy: 'user' }),
  validateBody(unlockSchema),
  async (req, res, next) => {
    try {
      const tf = tenantFilter(req);
      const { doorId, memberId, credentialType, direction, note } = req.body;

      const door = await prisma.door.findFirst({ where: { id: doorId, ...tf } });
      if (!door) return res.status(404).json({ error: 'Door not found' });
      if (!door.isActive) return res.status(409).json({ error: 'Door is disabled' });

      // Member diya ho to access check (schedule/credential/member status)
      if (memberId) {
        const chk = await checkAccess(tf.tenantId, memberId, doorId, new Date());
        if (!chk.allowed) {
          await prisma.accessLog.create({
            data: {
              tenantId: tf.tenantId,
              doorId,
              memberId,
              credentialType,
              direction,
              result: 'denied',
              reason: chk.reason || 'access-denied',
            },
          });
          return res.status(403).json({ granted: false, reason: chk.reason || 'access-denied' });
        }
      }

      // Access log — granted (manual staff unlock)
      await prisma.accessLog.create({
        data: {
          tenantId: tf.tenantId,
          doorId,
          memberId: memberId || null,
          credentialType,
          direction,
          result: 'granted',
          reason: note ? `staff-unlock: ${note}` : 'staff-unlock',
        },
      });

      // Hardware webhook (agar configured ho) — fail-safe, unlock kabhi nahi rukta
      let hardware = 'not-configured';
      const webhookUrl = await getWebhookUrl(tf.tenantId);
      if (webhookUrl && door.deviceId) {
        try {
          const r = await safePost(webhookUrl, {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'unlock',
              deviceId: door.deviceId,
              doorId: door.id,
              requestedBy: req.user.sub,
              at: new Date().toISOString(),
            }),
            timeoutMs: 8000,
          });
          hardware = r.ok && r.status >= 200 && r.status < 300 ? 'sent' : 'failed';
        } catch {
          hardware = 'failed';
        }
      } else if (webhookUrl && !door.deviceId) {
        hardware = 'no-device';
      }

      writeAudit({
        tenantId: tf.tenantId,
        actorId: req.user.sub,
        action: 'door.unlock',
        entity: 'Door',
        entityId: door.id,
        newValue: { memberId: memberId || null, hardware },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return res.json({ granted: true, doorId: door.id, hardware });
    } catch (e) {
      return next(e);
    }
  }
);

// ================= DEVICE: hardware entry event (API key auth, no JWT) =================
const hwEventSchema = z.object({
  doorId: z.string().min(1),
  credentialType: z.enum(['pin', 'rfid', 'mobile']),
  credential: z.string().min(1).max(128),
  direction: z.enum(['in', 'out']).default('in'),
});

// POST /api/door-unlock/hardware-event — asal device se entry event
router.post(
  '/hardware-event',
  guard,
  rateLimit({ windowMs: 60000, max: 120, keyBy: 'ip' }),
  validateBody(hwEventSchema),
  async (req, res, next) => {
    try {
      const { doorId, credentialType, credential, direction } = req.body;
      const presented = String(req.headers['x-device-key'] || '').trim();
      if (!presented) return res.status(401).json({ granted: false, reason: 'missing-device-key' });

      const door = await prisma.door.findFirst({ where: { id: doorId } });
      if (!door || !door.isActive) {
        return res.status(404).json({ granted: false, reason: 'door-not-found' });
      }
      const tenantId = door.tenantId;

      const storedHash = await getDeviceKeyHash(tenantId);
      if (!storedHash || !safeEqual(hashDeviceKey(presented), storedHash)) {
        return res.status(401).json({ granted: false, reason: 'invalid-device-key' });
      }

      // Credential verify — active credentials par bcrypt compare
      let matched = null;
      if (typeof prisma.accessCredential?.findMany === 'function') {
        const creds = await prisma.accessCredential.findMany({
          where: { tenantId, type: credentialType, isActive: true },
          select: { id: true, memberId: true, valueHash: true, expiresAt: true },
        });
        for (const c of creds) {
          if (c.expiresAt && c.expiresAt < new Date()) continue;
          let ok = false;
          try {
            ok = await bcrypt.compare(credential, c.valueHash);
          } catch {
            ok = false;
          }
          if (ok) {
            matched = c;
            break;
          }
        }
      }

      if (!matched) {
        await prisma.accessLog.create({
          data: {
            tenantId,
            doorId,
            memberId: null,
            credentialType,
            direction,
            result: 'denied',
            reason: 'unknown-credential',
          },
        });
        return res.status(403).json({ granted: false, reason: 'unknown-credential' });
      }

      const chk = await checkAccess(tenantId, matched.memberId, doorId, new Date());
      if (!chk.allowed) {
        await prisma.accessLog.create({
          data: {
            tenantId,
            doorId,
            memberId: matched.memberId,
            credentialType,
            direction,
            result: 'denied',
            reason: chk.reason || 'access-denied',
          },
        });
        return res.status(403).json({ granted: false, reason: chk.reason || 'access-denied' });
      }

      await prisma.accessLog.create({
        data: {
          tenantId,
          doorId,
          memberId: matched.memberId,
          credentialType,
          direction,
          result: 'granted',
          reason: 'hardware-event',
        },
      });
      try {
        await prisma.accessCredential.update({
          where: { id: matched.id },
          data: { lastUsedAt: new Date() },
        });
      } catch {
        /* non-fatal */
      }

      const member = await prisma.member.findFirst({
        where: { id: matched.memberId, tenantId },
        select: { id: true, name: true },
      });
      return res.json({ granted: true, member });
    } catch (e) {
      return next(e);
    }
  }
);

// ================= DEVICE KEY management (staff) =================
// POST /api/door-unlock/device-key — nayi device API key generate karo (plain sirf ek dafa milti hai)
router.post(
  '/device-key',
  guard,
  ...staffOnly,
  requireRole('ceo', 'admin', 'super_admin'),
  rateLimit({ windowMs: 60000, max: 10, keyBy: 'user' }),
  async (req, res, next) => {
    try {
      const tf = tenantFilter(req);
      const plain = `tdk_${crypto.randomBytes(32).toString('hex')}`;
      await prisma.setting.upsert({
        where: { tenantId_key: { tenantId: tf.tenantId, key: DEVICE_KEY_SETTING } },
        update: { value: hashDeviceKey(plain) },
        create: { tenantId: tf.tenantId, key: DEVICE_KEY_SETTING, value: hashDeviceKey(plain) },
      });
      writeAudit({
        tenantId: tf.tenantId,
        actorId: req.user.sub,
        action: 'door.device-key.rotate',
        entity: 'Setting',
        entityId: DEVICE_KEY_SETTING,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return res.json({ apiKey: plain, warning: 'Isko mehfooz rakhein — dobara nahi dikhegi.' });
    } catch (e) {
      return next(e);
    }
  }
);

// GET /api/door-unlock/device-key — key configured hai ya nahi
router.get('/device-key', guard, ...staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const hash = await getDeviceKeyHash(tf.tenantId);
    return res.json({ configured: !!hash });
  } catch (e) {
    return next(e);
  }
});

// DELETE /api/door-unlock/device-key — key revoke karo
router.delete(
  '/device-key',
  guard,
  ...staffOnly,
  requireRole('ceo', 'admin', 'super_admin'),
  async (req, res, next) => {
    try {
      const tf = tenantFilter(req);
      await prisma.setting.deleteMany({
        where: { tenantId: tf.tenantId, key: DEVICE_KEY_SETTING },
      });
      writeAudit({
        tenantId: tf.tenantId,
        actorId: req.user.sub,
        action: 'door.device-key.revoke',
        entity: 'Setting',
        entityId: DEVICE_KEY_SETTING,
        ip: req.ip,
      });
      return res.json({ revoked: true });
    } catch (e) {
      return next(e);
    }
  }
);

// ================= HARDWARE WEBHOOK config (staff) =================
const webhookSchema = z.object({
  webhookUrl: z.string().url().max(2000).nullable().optional(),
});

// GET /api/door-unlock/webhook — status (masked)
router.get('/webhook', guard, ...staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const url = await getWebhookUrl(tf.tenantId);
    return res.json({ configured: !!url, masked: url ? '••••••••' : null });
  } catch (e) {
    return next(e);
  }
});

// PUT /api/door-unlock/webhook — webhook URL set/remove karo
router.put(
  '/webhook',
  guard,
  ...staffOnly,
  requireRole('ceo', 'admin', 'super_admin'),
  validateBody(webhookSchema),
  async (req, res, next) => {
    try {
      const tf = tenantFilter(req);
      const { webhookUrl } = req.body;
      if (!webhookUrl) {
        await prisma.setting.deleteMany({ where: { tenantId: tf.tenantId, key: WEBHOOK_SETTING } });
      } else {
        await prisma.setting.upsert({
          where: { tenantId_key: { tenantId: tf.tenantId, key: WEBHOOK_SETTING } },
          update: { value: encryptSecret(webhookUrl) },
          create: { tenantId: tf.tenantId, key: WEBHOOK_SETTING, value: encryptSecret(webhookUrl) },
        });
      }
      writeAudit({
        tenantId: tf.tenantId,
        actorId: req.user.sub,
        action: 'door.webhook.config',
        entity: 'Setting',
        entityId: WEBHOOK_SETTING,
        newValue: { configured: !!webhookUrl },
        ip: req.ip,
      });
      return res.json({ configured: !!webhookUrl });
    } catch (e) {
      return next(e);
    }
  }
);

module.exports = router;
