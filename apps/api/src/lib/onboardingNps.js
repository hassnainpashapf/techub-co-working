// Phase 54 Track 6/10: 30-Day Feedback Auto-NPS.
// Members jo exactly 30 din pehle join hue (24h window: 30–31 days) aur abhi
// feedback nahi diya → email me HMAC token wala survey link.
// Stateless token (certificates.js wala pattern): dedupe ke liye koi alag
// table nahi chahiye — 24h window har member ko sirf ek dafa qualify karti hai.
//
// Wiring (coordinator, server.js additive):
//   require('./lib/onboardingNps');
//   require('./lib/onboardingNps').ensureOnboardingNpsScheduled();
// Route: /api/onboarding-feedback (yehi phase ki routes file).
const crypto = require('crypto');
const prisma = require('./prisma');
const { sendEmail } = require('./mailer');

const NPS_VERSION = 1;
const DAY = 24 * 60 * 60 * 1000;

function secret() {
  return process.env.JWT_ACCESS_SECRET || '';
}

function getJobs() {
  try { return require('./jobs'); } catch { return null; }
}

function b64urlEncode(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

// Stateless survey token: { v, tenantId, memberId } + HMAC-SHA256 signature.
function signNpsToken({ tenantId, memberId }) {
  const payload = { v: NPS_VERSION, tenantId, memberId };
  const body = b64urlEncode(payload);
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

// Asal tasdeeq: HMAC verify + payload shape. DB check (member tenant me)
// route layer karta hai.
function verifyNpsToken(token) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'missing' };
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad-signature' };
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.v !== NPS_VERSION) return { ok: false, reason: 'bad-version' };
  return { ok: true, payload };
}

function hasModel(name) {
  try { return typeof prisma?.[name]?.findFirst === 'function'; } catch { return false; }
}
function npsEnabled() {
  return hasModel('onboardingFeedback') && hasModel('member');
}

/**
 * runOnboardingNps() — daily job.
 * Qualifying members: createdAt 30–31 days ago, status active, email maujood,
 * aur OnboardingFeedback me entry nahi. Email me public survey link.
 */
async function runOnboardingNps({ limit = 500 } = {}) {
  if (!npsEnabled()) {
    console.log('[onboarding-nps] schema pending migration — skip');
    return { ok: false, skipped: true };
  }
  const now = Date.now();
  const from = new Date(now - 31 * DAY);
  const to = new Date(now - 30 * DAY);

  const members = await prisma.member.findMany({
    where: {
      createdAt: { gte: from, lt: to },
      status: 'active',
      email: { not: null },
    },
    select: {
      id: true,
      tenantId: true,
      name: true,
      email: true,
      tenant: { select: { name: true } },
    },
    take: limit,
  });

  const web = process.env.FRONTEND_URL || 'https://techub-co-working.pages.dev';
  let sent = 0;
  let skipped = 0;

  for (const m of members) {
    if (!m.email) { skipped++; continue; }
    const existing = await prisma.onboardingFeedback.findUnique({
      where: { tenantId_memberId: { tenantId: m.tenantId, memberId: m.id } },
    }).catch(() => null);
    if (existing) { skipped++; continue; }

    const token = signNpsToken({ tenantId: m.tenantId, memberId: m.id });
    const link = `${web}/survey/onboarding/${encodeURIComponent(token)}`;
    const org = m.tenant?.name || 'Techub';
    const firstName = String(m.name || '').split(' ')[0] || 'Member';

    try {
      await sendEmail(m.tenantId, {
        to: m.email,
        subject: `Aapke pehle 30 din — ${org} ko rate karein`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
            <h2 style="color:#1e1b4b">Assalam-o-Alaikum ${firstName}! 🎉</h2>
            <p>Aapko <b>${org}</b> join kiye 30 din ho gaye hain — mubarak!</p>
            <p>Kya aap 1 minute nikal kar apna tajurba share karein ge? Aapki raye se hum behtar ho sakte hain:</p>
            <p><a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">📝 Feedback Dein (1 min)</a></p>
            <p style="color:#64748b;font-size:13px">0–10 ki scale par aap humein kitna recommend karein ge?</p>
            <p style="color:#94a3b8;font-size:12px">Ye link sirf aapke liye hai — mehfooz rakhein.</p>
          </div>`,
        text: `Assalam-o-Alaikum ${firstName}! Aapko ${org} join kiye 30 din ho gaye. Apna feedback yahan dein: ${link}`,
      });
      sent++;
    } catch (e) {
      console.error('[onboarding-nps] email failed for', m.id, e.message);
      skipped++;
    }
  }

  // Kal phir run ho (daily chain).
  try {
    const jobs = getJobs();
    if (jobs) await jobs.enqueue('onboarding-nps-send', {}, { runAt: new Date(Date.now() + DAY) });
  } catch { /* ignore */ }

  return { ok: true, sent, skipped };
}

// Auto-register with job queue.
(function register() {
  try {
    const jobs = getJobs();
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('onboarding-nps-send', runOnboardingNps);
    }
  } catch { /* jobs module not present */ }
})();

// Boot par ensure karo ke daily run scheduled hai.
async function ensureOnboardingNpsScheduled() {
  try {
    const jobs = getJobs();
    if (!jobs) return;
    const pending = await prisma.job.count({
      where: { type: 'onboarding-nps-send', status: 'pending' },
    }).catch(() => 1);
    if (pending === 0) {
      await jobs.enqueue('onboarding-nps-send', {}, { runAt: new Date(Date.now() + DAY) });
    }
  } catch (e) {
    console.error('[onboarding-nps] ensure schedule failed:', e.message);
  }
}

module.exports = { signNpsToken, verifyNpsToken, runOnboardingNps, ensureOnboardingNpsScheduled };
