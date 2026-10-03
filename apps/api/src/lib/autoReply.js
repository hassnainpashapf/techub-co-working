// Phase 49 Track 8/10: Auto-Replies engine.
// maybeAutoReply(tenantId, channel, incomingText, opts) — keyword match ya
// business-hours/off-hours rule par auto reply. Dedupe: ek conversation me
// 1 ghante me sirf ek auto-reply (audit_logs se).
//
// INTEGRATION NOTES (coordinator):
// 1) WhatsApp webhook (routes/whatsapp.js POST /webhook) me incoming ke baad:
//      const { maybeAutoReply } = require('../lib/autoReply');
//      const { sendWhatsapp } = require('../lib/whatsapp');
//      maybeAutoReply(tenantId, 'whatsapp', text, {
//        conversationKey: 'wa:' + from,
//        sendReply: (body) => sendWhatsapp(tenantId, from, body),
//      }).catch(() => {});
// 2) Internal messaging (routes/messages.js POST message) me member ke message ke baad:
//      maybeAutoReply(tenantId, 'internal', body, {
//        conversationKey: 'conv:' + conversationId,
//        sendReply: (replyBody) => <conversation me staff-bot message create>,
//      }).catch(() => {});
//    (internal send caller khud kare — yahan sirf matching + dedupe logic hai,
//     taake conversation model se coupling na ho.)

const prisma = require('./prisma');
const { writeAudit } = require('../middleware/audit');

const DEDUPE_ACTION = 'comms.auto_reply';
const DEDUPE_WINDOW_MS = 60 * 60 * 1000;

function modelReady() {
  return !!(prisma && prisma.autoReply);
}

// Tenant ke business hours: Setting 'general.business_hours' se, warna default.
// Shape: { days: [1..7] (Mon=1), start: "09:00", end: "18:00", timezone }
async function getBusinessHours(tenantId) {
  const fallback = { days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '18:00' };
  try {
    if (!prisma.setting) return { ...fallback, inHours: inHoursNow(fallback) };
    const row = await prisma.setting.findFirst({
      where: { tenantId, key: 'general.business_hours' },
      select: { value: true },
    });
    const cfg = row && row.value ? { ...fallback, ...row.value } : fallback;
    return { ...cfg, inHours: inHoursNow(cfg) };
  } catch {
    return { ...fallback, inHours: inHoursNow(fallback) };
  }
}

function inHoursNow(cfg) {
  try {
    const now = new Date();
    const day = now.getDay() === 0 ? 7 : now.getDay(); // ISO: Mon=1..Sun=7
    if (!Array.isArray(cfg.days) || !cfg.days.includes(day)) return false;
    const [sh, sm] = String(cfg.start || '09:00').split(':').map(Number);
    const [eh, em] = String(cfg.end || '18:00').split(':').map(Number);
    const mins = now.getHours() * 60 + now.getMinutes();
    const start = sh * 60 + (sm || 0);
    const end = eh * 60 + (em || 0);
    return end > start ? mins >= start && mins < end : mins >= start || mins < end;
  } catch {
    return true; // fail-open: rule trigger na rokay
  }
}

// Dedupe: isi conversationKey par pichhle 1 ghante me auto-reply ho chuki?
async function recentlyReplied(tenantId, conversationKey) {
  try {
    if (!prisma.auditLog) return false;
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
    const hit = await prisma.auditLog.findFirst({
      where: {
        tenantId,
        action: DEDUPE_ACTION,
        entityId: conversationKey,
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    return !!hit;
  } catch {
    return false;
  }
}

// maybeAutoReply(tenantId, channel, incomingText, opts)
// opts: { conversationKey (lazmi dedupe ke liye), sendReply: async (body) => any }
async function maybeAutoReply(tenantId, channel, incomingText, opts = {}) {
  const result = { matched: false, sent: false, ruleId: null, trigger: null };
  try {
    if (!tenantId || !channel || !modelReady()) return result;
    const { conversationKey, sendReply } = opts;
    const text = String(incomingText || '').toLowerCase().trim();
    if (!text) return result;

    const rules = await prisma.autoReply.findMany({
      where: { tenantId, channel, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!rules.length) return result;

    const hours = await getBusinessHours(tenantId);

    // Precedence: keyword > off_hours/business_hours
    let rule =
      rules.find((r) => r.trigger === 'keyword' && r.keyword && text.includes(r.keyword.toLowerCase().trim())) ||
      null;
    if (!rule) {
      rule =
        rules.find((r) => r.trigger === 'off_hours' && !hours.inHours) ||
        rules.find((r) => r.trigger === 'business_hours' && hours.inHours) ||
        null;
    }
    if (!rule) return result;

    result.matched = true;
    result.ruleId = rule.id;
    result.trigger = rule.trigger;

    if (conversationKey && (await recentlyReplied(tenantId, conversationKey))) {
      result.deduped = true;
      return result; // 1 ghante me ek hi auto-reply
    }

    if (typeof sendReply === 'function') {
      try {
        await sendReply(rule.replyBody);
        result.sent = true;
      } catch (e) {
        result.sendError = e.message;
      }
    }

    if (conversationKey && prisma.auditLog) {
      await writeAudit({
        tenantId,
        actorId: null, // system
        action: DEDUPE_ACTION,
        entity: 'AutoReply',
        entityId: conversationKey,
        newValue: { ruleId: rule.id, trigger: rule.trigger, channel, sent: result.sent },
      }).catch(() => {});
    }
    return result;
  } catch (e) {
    console.error('[autoReply] failed:', e.message);
    return { ...result, error: e.message };
  }
}

module.exports = { maybeAutoReply, getBusinessHours };
