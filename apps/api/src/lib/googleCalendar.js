// Phase 36 Track 2: Google Calendar Sync — OAuth2 + Calendar API helper.
//
// ENV REQUIRED:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   GOOGLE_CALENDAR_REDIRECT_URI  (absolute callback URL, e.g.
//     https://techub-api.150.230.52.29.sslip.io/api/calendar/callback)
//   — fallback: request se derive hota hai (routes/calendar.js me).
//
// DEPLOY NOTE (coordinator): `npm install googleapis` backend container me
// lazmi hai. Package missing ho to ye module gracefully degrade karta hai —
// sync calls fail nahi karte, bas skip + log hota hai.
//
// SECURITY:
//   - refreshToken (long-lived) AES-256-GCM encrypted store hota hai
//     (lib/crypto.js, TOTP_ENCRYPTION_KEY reuse).
//   - accessToken short-lived (~1h) — plaintext theek hai.
//   - Scope sirf calendar.events hai (events create/edit/delete), poora
//     calendar read nahi — least privilege.
const crypto = require('crypto');

const prisma = require('./prisma');

const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

function googleCfg() {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

// Lazy load — googleapis missing ho to server crash nahi hota.
let _google = null;
let _googleLoadError = null;
function getGoogle() {
  if (_google || _googleLoadError) return _google;
  try {
    _google = require('googleapis').google;
    return _google;
  } catch (err) {
    _googleLoadError = err;
    console.warn('[googleCalendar] googleapis package missing — run `npm install googleapis`. Sync disabled.');
    return null;
  }
}

function getRedirectUri(req) {
  if ((process.env.GOOGLE_CALENDAR_REDIRECT_URI || '').trim()) {
    return process.env.GOOGLE_CALENDAR_REDIRECT_URI.trim();
  }
  // Fallback: request se derive karo (reverse proxy ke peeche sahi host ke liye).
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}/api/calendar/callback`;
}

// OAuth state: userId + HMAC signature (tamper-proof). Callback bina JWT ke
// ata hai (browser redirect), is liye state se user verify hota hai.
function signState(userId) {
  const secret = process.env.JWT_ACCESS_SECRET || 'dev-secret';
  const sig = crypto.createHmac('sha256', secret).update(String(userId)).digest('hex');
  return Buffer.from(`${userId}.${sig}`).toString('base64url');
}

function verifyState(state) {
  try {
    const raw = Buffer.from(String(state), 'base64url').toString('utf8');
    const idx = raw.lastIndexOf('.');
    if (idx < 0) return null;
    const userId = raw.slice(0, idx);
    const sig = raw.slice(idx + 1);
    const secret = process.env.JWT_ACCESS_SECRET || 'dev-secret';
    const expected = crypto.createHmac('sha256', secret).update(userId).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return userId;
  } catch {
    return null;
  }
}

function buildAuthUrl({ clientId, redirectUri, state }) {
  const google = getGoogle();
  if (!google) throw Object.assign(new Error('googleapis not installed'), { status: 503 });
  const oauth2 = new google.auth.OAuth2(clientId, process.env.GOOGLE_CLIENT_SECRET, redirectUri);
  return oauth2.generateAuthUrl({
    access_type: 'offline', // refresh_token chahiye
    prompt: 'consent', // har dafa refresh_token mile
    scope: SCOPES,
    state,
  });
}

async function exchangeCode({ code, redirectUri }) {
  const { clientId, clientSecret } = googleCfg();
  const google = getGoogle();
  if (!google) throw Object.assign(new Error('googleapis not installed'), { status: 503 });
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const { tokens } = await oauth2.getToken(code);
  return tokens; // { access_token, refresh_token?, expiry_date, scope }
}

// Valid (non-expired) OAuth2 client — zaroorat par refresh karta hai.
async function getAuthedClient(userId) {
  const { clientId, clientSecret, configured } = googleCfg();
  if (!configured) throw Object.assign(new Error('Google OAuth not configured'), { status: 503 });
  const google = getGoogle();
  if (!google) throw Object.assign(new Error('googleapis not installed'), { status: 503 });

  let conn;
  try {
    conn = await prisma.calendarConnection.findUnique({
      where: { userId_provider: { userId, provider: 'google' } },
    });
  } catch {
    // Schema merge se pehle — table nahi hai.
    throw Object.assign(new Error('Calendar sync schema not migrated yet'), { status: 503 });
  }
  if (!conn) throw Object.assign(new Error('Google Calendar not connected'), { status: 404 });

  const { decryptSecret, ENCRYPTED_PREFIX } = require('./crypto');
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  const refreshToken = conn.refreshToken.startsWith(ENCRYPTED_PREFIX)
    ? decryptSecret(conn.refreshToken)
    : conn.refreshToken; // legacy plaintext (pehli dafa auto-migrate neeche)

  oauth2.setCredentials({
    access_token: conn.accessToken || undefined,
    refresh_token: refreshToken,
    expiry_date: conn.expiry ? conn.expiry.getTime() : undefined,
  });

  // Expired (ya expiring in 60s) → refresh.
  const expiring = !conn.expiry || conn.expiry.getTime() - Date.now() < 60_000;
  if (expiring) {
    try {
      const { credentials } = await oauth2.refreshAccessToken();
      const { encryptSecret } = require('./crypto');
      await prisma.calendarConnection.update({
        where: { id: conn.id },
        data: {
          accessToken: credentials.access_token || conn.accessToken,
          refreshToken: credentials.refresh_token
            ? encryptSecret(credentials.refresh_token)
            : conn.refreshToken.startsWith(ENCRYPTED_PREFIX)
              ? conn.refreshToken
              : encryptSecret(refreshToken), // legacy plaintext → encrypt karke save
          expiry: credentials.expiry_date ? new Date(credentials.expiry_date) : conn.expiry,
        },
      });
      oauth2.setCredentials({
        access_token: credentials.access_token,
        refresh_token: credentials.refresh_token || refreshToken,
        expiry_date: credentials.expiry_date,
      });
    } catch (err) {
      // Refresh fail = user ne access revoke kiya. Connection ko stale mark karo.
      await prisma.calendarConnection.delete({ where: { id: conn.id } }).catch(() => {});
      throw Object.assign(new Error('Google authorization expired — please reconnect'), { status: 401 });
    }
  }
  return { oauth2, google };
}

function bookingToEvent(booking) {
  return {
    summary: booking.title || `Booking — ${booking.unit?.code || 'Unit'}`,
    description:
      `CoworkOS booking\n` +
      `Unit: ${booking.unit?.code || ''}\n` +
      `Member: ${booking.member?.name || ''}\n` +
      `Booking ID: ${booking.id}`,
    location: booking.unit?.code || undefined,
    start: { dateTime: new Date(booking.startAt).toISOString() },
    end: { dateTime: new Date(booking.endAt).toISOString() },
  };
}

async function createEvent(userId, booking) {
  const { oauth2, google } = await getAuthedClient(userId);
  const calendar = google.calendar({ version: 'v3', auth: oauth2 });
  const { data } = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: bookingToEvent(booking),
  });
  return data.id;
}

async function updateEvent(userId, eventId, booking) {
  const { oauth2, google } = await getAuthedClient(userId);
  const calendar = google.calendar({ version: 'v3', auth: oauth2 });
  await calendar.events.patch({
    calendarId: 'primary',
    eventId,
    requestBody: bookingToEvent(booking),
  });
}

async function deleteEvent(userId, eventId) {
  const { oauth2, google } = await getAuthedClient(userId);
  const calendar = google.calendar({ version: 'v3', auth: oauth2 });
  try {
    await calendar.events.delete({ calendarId: 'primary', eventId });
  } catch (err) {
    // Pehle se deleted (410) → theek hai, dobara fail nahi karna.
    if (err && (err.code === 404 || err.code === 410)) return;
    throw err;
  }
}

// Booking create/cancel/update par fire-and-forget sync.
// Kabhi throw nahi karta — booking flow kabhi nahi tootega.
async function syncBookingCreated(tenantId, booking, userId) {
  try {
    const eventId = await createEvent(userId, booking);
    await prisma.calendarSyncLog.create({
      data: { tenantId, bookingId: booking.id, userId, eventId, status: 'synced' },
    }).catch(() => {});
  } catch (err) {
    await prisma.calendarSyncLog.create({
      data: { tenantId, bookingId: booking.id, userId, status: 'failed', error: String(err.message || err).slice(0, 500) },
    }).catch(() => {});
  }
}

async function syncBookingCancelled(tenantId, bookingId, userId) {
  try {
    const log = await prisma.calendarSyncLog.findFirst({
      where: { bookingId, userId, status: { in: ['synced', 'updated'] } },
      orderBy: { syncedAt: 'desc' },
    }).catch(() => null);
    if (log && log.eventId) {
      await deleteEvent(userId, log.eventId);
      await prisma.calendarSyncLog.create({
        data: { tenantId, bookingId, userId, eventId: log.eventId, status: 'deleted' },
      }).catch(() => {});
    }
  } catch {
    // Silent — cancel flow kabhi nahi tootega.
  }
}

module.exports = {
  SCOPES,
  googleCfg,
  getGoogle,
  getRedirectUri,
  signState,
  verifyState,
  buildAuthUrl,
  exchangeCode,
  getAuthedClient,
  createEvent,
  updateEvent,
  deleteEvent,
  syncBookingCreated,
  syncBookingCancelled,
};
