// Phase 33 Track 10: Web Push notifications (VAPID).
// - VAPID keys env se: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (+ VAPID_SUBJECT optional).
// - Env me na hon to pehli dafa generate karke log me de deta hai
//   (operator unhe env me save kare taake restart par same rahen).
// - `web-push` package lazy-load hota hai taake missing dependency
//   par server crash na ho.

const prisma = require('./prisma');

let webpush = null;
let webpushLoadError = null;
function getWebPush() {
  if (webpush || webpushLoadError) return webpush;
  try {
    webpush = require('web-push');
  } catch (e) {
    webpushLoadError = e;
    console.warn('[push] web-push package missing — run `npm install web-push`. Push disabled.');
    return null;
  }
  return webpush;
}

let vapidConfigured = false;
function ensureVapid() {
  const wp = getWebPush();
  if (!wp) return false;
  if (vapidConfigured) return true;
  let publicKey = process.env.VAPID_PUBLIC_KEY;
  let privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    const generated = wp.generateVAPIDKeys();
    publicKey = generated.publicKey;
    privateKey = generated.privateKey;
    console.warn(
      '[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env me nahi mile — ' +
      'ephemeral keys generate ki gayin. Inhe env me save karo warna restart ' +
      'par purani subscriptions kaam nahi karengi:\n' +
      `VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}`
    );
  }
  wp.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@techub.co',
    publicKey,
    privateKey
  );
  // Cache taake /vapid-key hamesha wahi public key de jo configure hui
  ensureVapid.cachedPublicKey = publicKey;
  vapidConfigured = true;
  return true;
}

function getVapidPublicKey() {
  if (!ensureVapid()) return null;
  return ensureVapid.cachedPublicKey || process.env.VAPID_PUBLIC_KEY || null;
}

// Prisma model abhi migrate nahi hua ho to gracefully skip.
function pushModel() {
  return prisma.pushSubscription || null;
}

/**
 * Ek user ki tamam subscriptions par push bhejo.
 * 410/404 (expired) subscriptions auto-delete hoti hain.
 * Returns { attempted, sent, removed }.
 */
async function sendPushToUser(userId, { title, body, url = '/', tag = 'techub' } = {}) {
  const model = pushModel();
  if (!model) return { attempted: 0, sent: 0, removed: 0, skipped: 'no-model' };
  if (!ensureVapid()) return { attempted: 0, sent: 0, removed: 0, skipped: 'no-vapid' };
  const wp = getWebPush();
  if (!wp) return { attempted: 0, sent: 0, removed: 0, skipped: 'no-webpush' };

  const subs = await model.findMany({ where: { userId } });
  const payload = JSON.stringify({ title, body, url, tag });
  let sent = 0;
  let removed = 0;
  await Promise.all(subs.map(async (sub) => {
    try {
      await wp.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        payload,
        { TTL: 24 * 60 * 60 }
      );
      sent += 1;
    } catch (e) {
      if (e && (e.statusCode === 410 || e.statusCode === 404)) {
        await model.delete({ where: { id: sub.id } }).catch(() => {});
        removed += 1;
      } else {
        console.warn('[push] send failed:', e && e.message);
      }
    }
  }));
  return { attempted: subs.length, sent, removed };
}

// NotificationType (enum) -> preference event name mapping.
// Per-event push preference isi se check hoti hai (opt-out system:
// row na ho to enabled).
const TYPE_TO_EVENT = {
  rent_due: 'invoice.created',
  contract_expiry: 'announcement',
  task_assigned: 'ticket.updated',
  general: 'announcement',
};

/**
 * createNotification() ka hook — nayi in-app notification par
 * user ki push preference on ho to web push bhi bhejo.
 * Fire-and-forget: kabhi notification flow ko fail nahi hone deta.
 */
async function maybePushForNotification(notification) {
  try {
    const model = pushModel();
    if (!model || !notification) return;
    let userIds = [];
    if (notification.userId) {
      userIds = [notification.userId];
    } else if (notification.role) {
      const users = await prisma.user.findMany({
        where: {
          tenantId: notification.tenantId,
          role: notification.role,
          isActive: true,
        },
        select: { id: true },
      });
      userIds = users.map((u) => u.id);
    }
    if (!userIds.length) return;

    const { isChannelEnabled } = require('./preferences');
    const eventType = TYPE_TO_EVENT[notification.type] || 'announcement';
    const title = 'Techub Coworking';
    const body = String(notification.message || '').slice(0, 180);

    for (const userId of userIds) {
      try {
        const enabled = await isChannelEnabled(userId, eventType, 'push');
        if (!enabled) continue;
        await sendPushToUser(userId, { title, body, url: '/notifications' });
      } catch (e) {
        console.warn('[push] hook failed for user:', e && e.message);
      }
    }
  } catch (e) {
    console.warn('[push] maybePushForNotification:', e && e.message);
  }
}

module.exports = {
  getVapidPublicKey,
  sendPushToUser,
  maybePushForNotification,
};
