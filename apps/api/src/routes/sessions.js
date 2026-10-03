// Phase 32 Track 5: Session Manager — apni login sessions dekho / revoke karo.
// Mount (coordinator): app.use('/api/sessions', require('./routes/sessions'));
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { writeAudit } = require('../middleware/audit');
const { touchSession, revokeSession, revokeAllExcept } = require('../lib/userSessions');

const router = express.Router();
router.use(authenticate);

// GET /api/sessions — meri active (non-revoked) sessions; current wali marked
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const currentSid = req.user.sid || null;
    if (currentSid) touchSession(currentSid); // fire-and-forget jaisa (throttled)
    const sessions = await prisma.userSession.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastActiveAt: 'desc' },
      select: {
        id: true,
        ipAddress: true,
        deviceName: true,
        lastActiveAt: true,
        createdAt: true,
      },
    });
    return res.json({
      sessions: sessions.map((s) => ({ ...s, current: currentSid === s.id })),
      currentSid,
    });
  } catch (err) {
    return next(err);
  }
});

// POST /api/sessions/revoke-all — "log out all devices" (current除外)
router.post('/revoke-all', async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const currentSid = req.user.sid || null;
    const count = await revokeAllExcept(userId, currentSid);
    await writeAudit({
      tenantId: req.user.tenantId || null,
      actorId: userId,
      action: 'auth.sessions_revoke_all',
      entity: 'User',
      entityId: userId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.json({ ok: true, revoked: count });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/sessions/:id — ek session revoke; current wali par loggedOut=true (frontend logout karega)
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const currentSid = req.user.sid || null;
    const ok = await revokeSession(userId, req.params.id);
    if (!ok) {
      return res.status(404).json({ error: { message: 'Session not found' } });
    }
    const isCurrent = currentSid === req.params.id;
    await writeAudit({
      tenantId: req.user.tenantId || null,
      actorId: userId,
      action: 'auth.session_revoke',
      entity: 'UserSession',
      entityId: req.params.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.json({ ok: true, loggedOut: isCurrent });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
