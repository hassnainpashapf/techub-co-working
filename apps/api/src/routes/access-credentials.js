// Phase 48 Track 2: Member Access Credentials.
// MOUNT (coordinator server.js me ADD karein):
//   app.use('/api/access-credentials', require('./routes/access-credentials'));
//
// Members extend — sidebar link nahi (member detail page me "🔑 Access" tab jorein):
//   GET /api/access-credentials?memberId=<id>  -> credentials (metadata, hash kabhi nahi)
//   POST /api/access-credentials/issue-pin { memberId, expiresAt? } -> { pin } (sirf ek dafa plain)
//
// Track 3 (entry validation) helper:
//   const { verifyCredential } = require('./access-credentials');
//   await verifyCredential(tenantId, memberId, 'pin', plainPin) -> { ok, reason }
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { hashPassword, comparePassword } = require('../lib/auth');

const router = express.Router();
router.use(authenticate, requireTenantUser);
const STAFF = ['manager', 'admin', 'ceo', 'super_admin'];
router.use(requireRole(...STAFF));

// 503 guard — fragment merge/migration se pehle endpoints safe fail hon.
function modelReady() {
  return prisma && typeof prisma.accessCredential?.findMany === 'function';
}
function guard(req, res, next) {
  if (!modelReady()) return res.status(503).json({ error: 'access-credentials migration pending' });
  next();
}
router.use(guard);

const TYPE = z.enum(['pin', 'rfid', 'mobile']);

async function tenantMember(req, memberId) {
  const tf = tenantFilter(req);
  return prisma.member.findFirst({ where: { id: memberId, ...tf } });
}

function publicCred(c) {
  return {
    id: c.id,
    memberId: c.memberId,
    type: c.type,
    isActive: c.isActive,
    expiresAt: c.expiresAt,
    lastUsedAt: c.lastUsedAt,
    createdAt: c.createdAt,
  };
}

// GET /?memberId= — member ki credentials (metadata only)
router.get('/', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const where = { ...tf };
    if (req.query.memberId) where.memberId = String(req.query.memberId);
    const rows = await prisma.accessCredential.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ credentials: rows.map(publicCred) });
  } catch (e) {
    res.status(500).json({ error: 'list failed' });
  }
});

// POST /issue-pin — naya 6-digit PIN (purana active PIN auto-revoke). PIN sirf is response me plain.
router.post('/issue-pin', async (req, res) => {
  try {
    const body = z.object({
      memberId: z.string().min(1),
      expiresAt: z.string().datetime().optional().nullable(),
    }).parse(req.body);
    const member = await tenantMember(req, body.memberId);
    if (!member) return res.status(404).json({ error: 'member not found' });

    const pin = String(Math.floor(100000 + Math.random() * 900000));
    const tf = tenantFilter(req);
    await prisma.accessCredential.updateMany({
      where: { ...tf, memberId: member.id, type: 'pin', isActive: true },
      data: { isActive: false },
    });
    const cred = await prisma.accessCredential.create({
      data: {
        ...tf,
        memberId: member.id,
        type: 'pin',
        valueHash: await hashPassword(pin),
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
    });
    await writeAudit(req, {
      action: 'access-credential.issue_pin',
      entity: 'access_credential',
      entityId: cred.id,
      newValue: { memberId: member.id, type: 'pin' }, // PIN hash/value kabhi audit me nahi
    });
    res.status(201).json({
      credential: publicCred(cred),
      pin,
      warning: 'PIN sirf ek dafa dikhaya jata hai — member ko abhi note karwa lein',
    });
  } catch (e) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'invalid input' });
    res.status(500).json({ error: 'issue failed' });
  }
});

// POST /assign — RFID card ya mobile token assign karein (value hash hoti hai)
router.post('/assign', async (req, res) => {
  try {
    const body = z.object({
      memberId: z.string().min(1),
      type: z.enum(['rfid', 'mobile']),
      value: z.string().min(3).max(128),
      expiresAt: z.string().datetime().optional().nullable(),
    }).parse(req.body);
    const member = await tenantMember(req, body.memberId);
    if (!member) return res.status(404).json({ error: 'member not found' });

    const tf = tenantFilter(req);
    const cred = await prisma.accessCredential.create({
      data: {
        ...tf,
        memberId: member.id,
        type: body.type,
        valueHash: await hashPassword(body.value),
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
    });
    await writeAudit(req, {
      action: 'access-credential.assign',
      entity: 'access_credential',
      entityId: cred.id,
      newValue: { memberId: member.id, type: body.type },
    });
    res.status(201).json({ credential: publicCred(cred) });
  } catch (e) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'invalid input' });
    res.status(500).json({ error: 'assign failed' });
  }
});

// PATCH /:id/revoke — credential band karein
router.patch('/:id/revoke', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const cred = await prisma.accessCredential.findFirst({ where: { id: req.params.id, ...tf } });
    if (!cred) return res.status(404).json({ error: 'credential not found' });
    const updated = await prisma.accessCredential.update({
      where: { id: cred.id },
      data: { isActive: false },
    });
    await writeAudit(req, {
      action: 'access-credential.revoke',
      entity: 'access_credential',
      entityId: cred.id,
      newValue: { memberId: cred.memberId, type: cred.type },
    });
    res.json({ credential: publicCred(updated) });
  } catch (e) {
    res.status(500).json({ error: 'revoke failed' });
  }
});

// POST /:id/rotate — purani revoke + nayi issue (PIN: random; rfid/mobile: body.value)
router.post('/:id/rotate', async (req, res) => {
  try {
    const body = z.object({ value: z.string().min(3).max(128).optional() }).parse(req.body || {});
    const tf = tenantFilter(req);
    const cred = await prisma.accessCredential.findFirst({ where: { id: req.params.id, ...tf } });
    if (!cred) return res.status(404).json({ error: 'credential not found' });

    let plain = null;
    if (cred.type === 'pin') {
      plain = String(Math.floor(100000 + Math.random() * 900000));
    } else {
      if (!body.value) return res.status(400).json({ error: 'value required for rfid/mobile' });
      plain = body.value;
    }
    await prisma.accessCredential.update({ where: { id: cred.id }, data: { isActive: false } });
    const fresh = await prisma.accessCredential.create({
      data: {
        tenantId: cred.tenantId,
        memberId: cred.memberId,
        type: cred.type,
        valueHash: await hashPassword(plain),
        expiresAt: cred.expiresAt,
      },
    });
    await writeAudit(req, {
      action: 'access-credential.rotate',
      entity: 'access_credential',
      entityId: fresh.id,
      newValue: { memberId: cred.memberId, type: cred.type },
    });
    const out = { credential: publicCred(fresh) };
    if (cred.type === 'pin') out.pin = plain;
    res.status(201).json(out);
  } catch (e) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'invalid input' });
    res.status(500).json({ error: 'rotate failed' });
  }
});

// Track 3 helper: entry point par PIN/token verify karein.
async function verifyCredential(tenantId, memberId, type, plain) {
  if (!modelReady()) return { ok: false, reason: 'not_migrated' };
  const creds = await prisma.accessCredential.findMany({
    where: { tenantId, memberId, type, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  for (const c of creds) {
    if (c.expiresAt && new Date(c.expiresAt) < new Date()) continue;
    const match = await comparePassword(plain, c.valueHash);
    if (match) {
      await prisma.accessCredential.update({ where: { id: c.id }, data: { lastUsedAt: new Date() } });
      return { ok: true, credentialId: c.id };
    }
  }
  return { ok: false, reason: creds.length ? 'invalid_or_expired' : 'no_credential' };
}

module.exports = router;
module.exports.verifyCredential = verifyCredential;
