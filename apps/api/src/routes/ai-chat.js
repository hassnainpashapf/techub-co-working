// Phase 45 Track 2: AI Member Chat Assistant — POST /api/ai/chat
// Member auth. LLM-first (Track 1 ../lib/aiProvider) with a rule-based
// fallback engine that answers from REAL tenant data (bookings, invoices,
// contract, wifi vouchers, support tickets). Rate limit: 30 msgs/day/member.
// Conversation logging is PII-safe (intent + length only, no raw message text).

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
// Track 1 integration — lazily required; missing lib = rule-based engine only
// ---------------------------------------------------------------------------
function getAiClientSafe(tenantId) {
  try {
    const { getAiClient } = require('../lib/aiProvider');
    return Promise.resolve(getAiClient(tenantId)).catch(() => null);
  } catch (_e) {
    return Promise.resolve(null);
  }
}

// ---------------------------------------------------------------------------
// Member resolution (portal.js myMember pattern)
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

// ---------------------------------------------------------------------------
// Suggested question chips (GET /suggestions)
// ---------------------------------------------------------------------------
const SUGGESTIONS = [
  'Meri upcoming bookings kya hain?',
  'Mere baqaya bills kitne hain?',
  'Mera plan kab khatam ho raha hai?',
  'Mera WiFi voucher code kya hai?',
  'Meri support tickets ka status?',
];

router.get('/suggestions', async (req, res) => {
  res.json({ suggestions: SUGGESTIONS });
});

// ---------------------------------------------------------------------------
// Rule-based engine — intents with REAL DB answers (Roman Urdu replies)
// ---------------------------------------------------------------------------
const fmtMoney = (v) => `Rs ${Number(v || 0).toLocaleString('en-PK')}`;
const fmtDate = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const fmtDateTime = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

function detectIntent(text) {
  const t = ` ${text.toLowerCase()} `;
  if (/(salam|assalam|hello|hi\b|hey|aoa|good\s*(morning|evening|afternoon))/.test(t)) return 'greeting';
  if (/(booking|bookings|reserve|reservation|meri\s*booking|room\s*book)/.test(t) && !/(book\s*(a|kar|new)|nayi\s*booking|naya\s*room)/.test(t))
    return 'bookings';
  if (/(invoice|bill|bills|payment|payments|dues|due|baqaya|pesa|paise|amount|paisay|fees|udhaar)/.test(t)) return 'invoices';
  if (/(contract|plan|membership|package|subscription|member\s*ship)/.test(t)) return 'contract';
  if (/(wifi|wi-fi|wi fi|internet|voucher|password)/.test(t)) return 'wifi';
  if (/(ticket|complaint|shikayat|support|issue|masla|problem|help)/.test(t)) return 'tickets';
  if (/(book|reserve).*(room|meeting|space)|nayi\s*booking|naya\s*room|room\s*chahiye/.test(t)) return 'book_room';
  if (/(hour|timing|time|khul|khol|kab|open|close|band)/.test(t)) return 'hours';
  if (/(thank|shukriya|shukria|great|acha|awesome|nice)/.test(t)) return 'thanks';
  return 'fallback';
}

async function answerRuleBased(intent, ctx) {
  const { tf, member, firstName } = ctx;

  switch (intent) {
    case 'greeting':
      return `Assalam-o-Alaikum${firstName ? ` ${firstName}` : ''}! Main aap ka Techub assistant hoon. Neeche diye gaye sawalon me se koi poochein, ya apni booking, bill ya plan ke bare me likhein.`;

    case 'bookings': {
      if (!member) return 'Aap ka member record nahi mila — bookings dekhne ke liye member account se login karein.';
      const now = new Date();
      const bookings = await prisma.booking.findMany({
        where: { memberId: member.id, startAt: { gte: now }, status: { not: 'cancelled' }, ...tf },
        include: { unit: { select: { code: true, type: true } } },
        orderBy: { startAt: 'asc' },
        take: 5,
      });
      if (!bookings.length)
        return 'Aap ki koi upcoming booking nahi hai. Portal → Bookings se nayi booking kar sakte hain.';
      const lines = bookings.map(
        (b, i) => `${i + 1}. ${b.unit?.code || 'Unit'} — ${fmtDateTime(b.startAt)}`
      );
      return `Aap ki ${bookings.length} upcoming booking${bookings.length > 1 ? 's' : ''}:\n${lines.join('\n')}`;
    }

    case 'invoices': {
      if (!member) return 'Aap ka member record nahi mila — bills dekhne ke liye member account se login karein.';
      const invoices = await prisma.invoice.findMany({
        where: { memberId: member.id, status: { in: ['unpaid', 'partial', 'overdue'] }, ...tf },
        orderBy: { dueDate: 'asc' },
        take: 5,
      });
      if (!invoices.length)
        return 'Mubarak ho! Aap ka koi baqaya bill nahi hai — sab clear hai.';
      const total = invoices.reduce((s, i) => s + (Number(i.amount) - Number(i.amountPaid)), 0);
      const lines = invoices.map(
        (i, k) => `${k + 1}. ${i.number} — ${fmtMoney(Number(i.amount) - Number(i.amountPaid))} (due ${fmtDate(i.dueDate)})`
      );
      return `Kul baqaya: ${fmtMoney(total)} (${invoices.length} invoice${invoices.length > 1 ? 's' : ''}):\n${lines.join('\n')}\n\nPortal → Invoices se pay kar sakte hain.`;
    }

    case 'contract': {
      if (!member) return 'Aap ka member record nahi mila.';
      const contract = await prisma.contract.findFirst({
        where: { memberId: member.id, status: 'active', ...tf },
        include: { plan: { select: { name: true } }, unit: { select: { code: true, type: true } } },
        orderBy: { startDate: 'desc' },
      });
      if (!contract) return 'Aap ka koi active plan/contract nahi hai. Naya plan lene ke liye reception se rabta karein.';
      return `Aap ka active plan: ${contract.plan?.name || 'Custom plan'}${contract.unit ? ` (${contract.unit.code})` : ''}\nShuru: ${fmtDate(contract.startDate)}${contract.endDate ? ` | Khatam: ${fmtDate(contract.endDate)}` : ''}`;
    }

    case 'wifi': {
      if (!member) return 'Aap ka member record nahi mila.';
      const voucher = await prisma.wifiVoucher.findFirst({
        where: { memberId: member.id, status: 'active', ...tf },
        orderBy: { createdAt: 'desc' },
      });
      if (!voucher)
        return 'Aap ke paas koi active WiFi voucher nahi hai. Reception se naya voucher le sakte hain.';
      return `Aap ka WiFi voucher code: ${voucher.code}${voucher.expiresAt ? `\nExpiry: ${fmtDateTime(voucher.expiresAt)}` : ''}`;
    }

    case 'tickets': {
      if (!member) return 'Aap ka member record nahi mila.';
      const tickets = await prisma.ticket.findMany({
        where: { memberId: member.id, status: { in: ['open', 'in_progress', 'pending'] }, ...tf },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      if (!tickets.length)
        return 'Aap ki koi open support ticket nahi hai. Nayi ticket Portal → Support se bana sakte hain.';
      const lines = tickets.map((t, i) => `${i + 1}. ${t.subject || t.title || 'Ticket'} — ${t.status}`);
      return `Aap ki ${tickets.length} open ticket${tickets.length > 1 ? 's' : ''}:\n${lines.join('\n')}`;
    }

    case 'book_room':
      return 'Nayi booking ke liye Portal → Bookings me jayein, date aur time select karein. Agar koi specific room chahiye to reception se bhi confirm kar sakte hain.';

    case 'hours':
      return 'Timings har location ke hisab se hotay hain — exact hours ke liye reception se rabta karein ya announcements check karein.';

    case 'thanks':
      return 'Khush aamdeed! Aur kuch poochna ho to hazir hoon.';

    default:
      return 'Samajh nahi aaya. Ye try karein:\n• Meri upcoming bookings kya hain?\n• Mere baqaya bills kitne hain?\n• Mera WiFi voucher code kya hai?';
  }
}

// ---------------------------------------------------------------------------
// POST / — chat message
// ---------------------------------------------------------------------------
const chatSchema = z.object({
  message: z.string().trim().min(1).max(500),
});

router.post('/', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: 'Message 1–500 characters ka hona chahiye.' } });
    }
    const { message } = parsed.data;

    // Rate limit: 30 messages / day / user (auditLog doubles as the log)
    const actorId = req.user.sub || req.user.id;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const used = await prisma.auditLog.count({
      where: { tenantId: req.user.tenantId, actorId: String(actorId), action: 'ai-chat.message', createdAt: { gte: startOfDay } },
    });
    if (used >= 30) {
      return res.status(429).json({ error: { message: 'Aaj ki chat limit (30) khatam ho gayi hai. Kal dobara try karein.' } });
    }

    const member = await myMember(req);
    const firstName = member?.name ? member.name.split(' ')[0] : null;
    const intent = detectIntent(message);

    let reply = null;
    let engine = 'rule';

    // LLM-first: Track 1 provider available ho to use karo
    const ai = await getAiClientSafe(req.user.tenantId);
    if (ai && ai.available) {
      try {
        const contextLines = [
          `Tenant user: ${req.user.email || req.user.role || 'user'}`,
          member ? `Member: ${member.name} (status: ${member.status})` : 'No member record linked.',
        ];
        const systemPrompt =
          "You are Techub's member support assistant. Answer in Roman Urdu (Urdu written in Latin script), short and friendly. " +
          'Only answer from the provided context; if you do not know something, say so and suggest contacting reception. ' +
          `Context:\n${contextLines.join('\n')}`;
        const r = await ai.chat([{ role: 'user', content: message }], { system: systemPrompt, maxTokens: 800 });
        if (r && r.text) {
          reply = r.text;
          engine = 'llm';
        }
      } catch (_e) {
        reply = null; // LLM fail → rule-based fallback
      }
    }

    if (!reply) {
      reply = await answerRuleBased(intent, { tf, member, firstName });
      engine = 'rule';
    }

    // PII-safe conversation log: intent + length + engine only (no raw text)
    writeAudit({
      tenantId: req.user.tenantId,
      actorId: String(actorId),
      action: 'ai-chat.message',
      entity: 'AiChat',
      entityId: member ? member.id : null,
      newValue: { intent, engine, messageLen: message.length },
      ip: req.ip || req.headers['x-forwarded-for'] || null,
      userAgent: req.headers['user-agent'] || null,
    });

    res.json({ reply, engine, intent, suggestions: SUGGESTIONS.slice(0, 3) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
