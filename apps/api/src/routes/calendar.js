// Phase 36 Track 2: Google Calendar Sync — routes.
// Mount (coordinator): app.use('/api/calendar', require('./routes/calendar'));
//
// REAL OAuth2 flow:
//   1. Frontend: GET /api/calendar/auth-url (JWT) → Google consent page par redirect.
//   2. Google: GET /api/calendar/callback?code=...&state=... (public) → token
//      exchange → CalendarConnection save → frontend settings page par redirect.
//   3. Booking create/cancel par auto-sync (connected users ke liye).
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');
const gcal = require('../lib/googleCalendar');

const router = express.Router();

// GET /api/calendar/auth-url — Google OAuth consent URL banao (JWT required)
router.get('/auth-url', authenticate, requireTenantUser, async (req, res, next) => {
  try {
    const { configured, clientId } = gcal.googleCfg();
    if (!configured) {
      return res.status(503).json({
        error: { message: 'Google Calendar is not configured. Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET on the server.' },
      });
    }
    if (!gcal.getGoogle()) {
      return res.status(503).json({
        error: { message: 'googleapis package is not installed on the server.' },
      });
    }
    const redirectUri = gcal.getRedirectUri(req);
    const url = gcal.buildAuthUrl({
      clientId,
      redirectUri,
      state: gcal.signState(req.user.sub),
    });
    return res.json({ url });
  } catch (err) {
    return next(err);
  }
});

// GET /api/calendar/callback — Google ka browser redirect (PUBLIC, no JWT).
// Signed `state` se user verify hota hai.
router.get('/callback', async (req, res, next) => {
  const frontend = (process.env.FRONTEND_URL || '').replace(/\/$/, '') || '/settings/calendar';
  const done = (ok, msg) => res.redirect(`${frontend}?gcal=${ok ? 'connected' : 'error'}${msg ? `&msg=${encodeURIComponent(msg)}` : ''}`);
  try {
    const { code, state, error } = req.query;
    if (error) return done(false, String(error));
    const userId = gcal.verifyState(state);
    if (!userId) return done(false, 'Invalid state — please try again.');
    if (!code) return done(false, 'Missing authorization code.');

    const redirectUri = gcal.getRedirectUri(req);
    const tokens = await gcal.exchangeCode({ code: String(code), redirectUri });

    const { encryptSecret } = require('../lib/crypto');
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, tenantId: true },
    });
    if (!user) return done(false, 'User not found.');

    // Google account ka email bhi le ao (display ke liye).
    let email = null;
    try {
      const google = gcal.getGoogle();
      const oauth2 = new google.auth.OAuth2();
      oauth2.setCredentials({ access_token: tokens.access_token });
      const oauth2api = google.oauth2({ version: 'v2', auth: oauth2 });
      const me = await oauth2api.userinfo.get();
      email = me.data.email || null;
    } catch {
      // Email optional hai — connection phir bhi save hogi.
    }

    await prisma.calendarConnection.upsert({
      where: { userId_provider: { userId, provider: 'google' } },
      create: {
        userId,
        provider: 'google',
        accessToken: tokens.access_token || null,
        refreshToken: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : '',
        expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scope: tokens.scope || gcal.SCOPES.join(' '),
        email,
      },
      update: {
        accessToken: tokens.access_token || null,
        // refresh_token sirf pehli consent par milta hai (prompt=consent se har dafa).
        ...(tokens.refresh_token ? { refreshToken: encryptSecret(tokens.refresh_token) } : {}),
        expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scope: tokens.scope || gcal.SCOPES.join(' '),
        email: email || undefined,
      },
    });

    writeAudit({
      tenantId: user.tenantId,
      actorId: userId,
      action: 'calendar.connect',
      entity: 'CalendarConnection',
      entityId: userId,
      newValue: { provider: 'google', email },
    }).catch(() => {});

    return done(true);
  } catch (err) {
    return done(false, err.message || 'Connection failed.');
  }
});

// GET /api/calendar/status — mera connection status (JWT)
router.get('/status', authenticate, requireTenantUser, async (req, res, next) => {
  try {
    let conn = null;
    try {
      conn = await prisma.calendarConnection.findUnique({
        where: { userId_provider: { userId: req.user.sub, provider: 'google' } },
        select: { email: true, createdAt: true, expiry: true },
      });
    } catch {
      return res.json({ connected: false, migrated: false });
    }
    return res.json({
      connected: Boolean(conn),
      migrated: true,
      email: conn?.email || null,
      connectedAt: conn?.createdAt || null,
    });
  } catch (err) {
    return next(err);
  }
});

// POST /api/calendar/sync-booking/:id — booking ko manually Google Calendar me bhejo
router.post('/sync-booking/:id', authenticate, requireTenantUser, async (req, res, next) => {
  try {
    const { tenantFilter } = require('../lib/tenant');
    const tf = tenantFilter(req);
    const booking = await prisma.booking.findFirst({
      where: { id: req.params.id, ...tf },
      include: {
        unit: { select: { code: true } },
        member: { select: { name: true } },
      },
    });
    if (!booking) return res.status(404).json({ error: { message: 'Booking not found' } });
    const eventId = await gcal.createEvent(req.user.sub, booking);
    await prisma.calendarSyncLog.create({
      data: { tenantId: tf.tenantId, bookingId: booking.id, userId: req.user.sub, eventId, status: 'synced' },
    }).catch(() => {});
    return res.status(201).json({ eventId });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: { message: err.message || 'Sync failed' } });
  }
});

// DELETE /api/calendar/disconnect — connection hatao
router.delete('/disconnect', authenticate, requireTenantUser, async (req, res, next) => {
  try {
    await prisma.calendarConnection.deleteMany({
      where: { userId: req.user.sub, provider: 'google' },
    }).catch(() => {});
    const { tenantFilter } = require('../lib/tenant');
    writeAudit({
      tenantId: tenantFilter(req).tenantId,
      actorId: req.user.sub,
      action: 'calendar.disconnect',
      entity: 'CalendarConnection',
      entityId: req.user.sub,
    }).catch(() => {});
    return res.json({ disconnected: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
