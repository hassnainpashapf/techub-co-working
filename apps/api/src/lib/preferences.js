// Phase 27 Track 4: Notification preference helpers (opt-out system).
// NOTE: NotificationPreference model abhi schema.prisma me merge nahi hua
// (coordinator fragments merge karega) — tab tak ye code runtime par
// is model ko use nahi karega. Syntax node --check se verified hai.

const prisma = require('./prisma');
const { NOTIFICATION_EVENTS, NOTIFICATION_CHANNELS } = require('./notificationEvents');

/**
 * Kya user ne is eventType+channel ko enabled rakha hai?
 * Preference row nahi hai to default TRUE (opt-out system).
 */
async function isChannelEnabled(userId, eventType, channel) {
  if (!NOTIFICATION_EVENTS.includes(eventType)) return false;
  if (!NOTIFICATION_CHANNELS.includes(channel)) return false;
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId_eventType_channel: { userId, eventType, channel } },
    select: { enabled: true },
  });
  return pref ? pref.enabled : true;
}

/**
 * User ka poora events × channels matrix:
 * { 'booking.confirmed': { email: true, sms: false, ... }, ... }
 * Jo row nahi hai wo default true.
 */
async function getUserPreferences(userId) {
  const rows = await prisma.notificationPreference.findMany({
    where: { userId },
    select: { eventType: true, channel: true, enabled: true },
  });
  const matrix = {};
  for (const ev of NOTIFICATION_EVENTS) {
    matrix[ev] = {};
    for (const ch of NOTIFICATION_CHANNELS) matrix[ev][ch] = true;
  }
  for (const r of rows) {
    if (matrix[r.eventType] && r.channel in matrix[r.eventType]) {
      matrix[r.eventType][r.channel] = r.enabled;
    }
  }
  return matrix;
}

module.exports = { isChannelEnabled, getUserPreferences };
