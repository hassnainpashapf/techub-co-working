// Notification helpers.
//
// sendMessage() is a PROVIDER INTERFACE: to send real WhatsApp/SMS, plug in a
// provider by setting WHATSAPP_PROVIDER (e.g. "twilio", "meta-cloud") and
// extending the branch below with the provider's SDK/API call. Until a
// provider is configured we log to console so nothing is silently dropped.
//
// createNotification() persists an in-app notification row (visible to a
// specific user and/or everyone with a given role).

const prisma = require('./prisma');

async function sendMessage({ to, channel, message }) {
  const provider = process.env.WHATSAPP_PROVIDER;
  if (provider) {
    // TODO (provider interface): replace with real SDK call, e.g.
    //   await twilioClient.messages.create({ to, from: ..., body: message })
    // Keep the return contract: { sent, provider, reason? }.
    console.log(`[provider:${provider}] would send to=${to} channel=${channel}`);
    return { sent: false, provider, reason: 'not-configured' };
  }
  console.log(`[notify:${channel}] to=${to} msg=${message}`);
  return { sent: true, provider: 'console' };
}

// txOrPrisma can be the Prisma client or an active transaction client.
// { tenantId, userId?, role?, type, message }
async function createNotification(txOrPrisma, { tenantId, userId = null, role = null, type, message }) {
  const db = txOrPrisma || prisma;
  return db.notification.create({
    data: {
      tenantId,
      userId,
      role,
      type,
      message,
    },
  });
}

module.exports = { sendMessage, createNotification };
