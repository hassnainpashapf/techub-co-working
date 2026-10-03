// Phase 47 Track 7: Membership Application → Lead bridge.
// Form submission par (agar form.autoCreateLead true ho) CRM me Lead auto-create karta hai.
// server.js nahi chherta — wiring coordinator kare (neeche WIRING note dekho).
//
// WIRING (coordinator — routes/form-public.js ke submit handler me, submission create ke BAAD):
//   const { maybeCreateLeadFromSubmission } = require('../lib/formLeadBridge');
//   maybeCreateLeadFromSubmission({ tenantId: form.tenantId, form, submission }).catch(() => {});
// (fire-and-forget — lead fail ho to submission phir bhi save rahe)

const prisma = require('./prisma');
const { writeAudit } = require('../middleware/audit');

function safeComputeScore(lead) {
  try {
    const { computeLeadScore } = require('./leadScoring');
    const { score } = computeLeadScore(lead) || {};
    if (Number.isInteger(score)) return Math.max(0, Math.min(100, score));
  } catch (_) { /* scoring optional hai — lead phir bhi bane ga */ }
  return 0;
}

function val(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

// fields: [{id, type, label}], answers: {fieldId: value}
function findFieldValue(fields, answers, test) {
  for (const f of fields) {
    if (test(f)) {
      const v = val(answers && answers[f.id]);
      if (v) return { value: v, field: f };
    }
  }
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function mapAnswersToLead(fields, answers) {
  const emailHit = findFieldValue(fields, answers, (f) =>
    f.type === 'email' || /e-?mail/i.test(f.label || ''));
  const phoneHit = findFieldValue(fields, answers, (f) =>
    f.type === 'phone' || /phone|mobile|tel|whatsapp|فون|نمبر/i.test(f.label || ''));
  const nameHit = findFieldValue(fields, answers, (f) =>
    (f.type === 'text' || !f.type) && /name|naam|نام|full/i.test(f.label || ''))
    || findFieldValue(fields, answers, (f) => (f.type === 'text' || !f.type) && f.required);
  const companyHit = findFieldValue(fields, answers, (f) =>
    /compan|organization|org\b|business/i.test(f.label || ''));
  const interestHit = findFieldValue(fields, answers, (f) =>
    ['select', 'radio', 'multiselect'].includes(f.type) &&
    /plan|interest|package|membership|desk|office/i.test(f.label || ''));

  let email = emailHit ? emailHit.value : null;
  if (email && !EMAIL_RE.test(email)) email = null; // galat email → null, lead phir bhi bane ga

  return {
    name: nameHit ? nameHit.value : null,
    email,
    phone: phoneHit ? phoneHit.value : null,
    company: companyHit ? companyHit.value : null,
    interest: interestHit ? interestHit.value : null,
  };
}

/**
 * @returns {Promise<null | {created:true, leadId} | {skipped:'duplicate', leadId}>}
 */
async function maybeCreateLeadFromSubmission({ tenantId, form, submission }) {
  try {
    // Coordinator ne autoCreateLead column merge na kiya ho to undefined → skip (koi crash nahi)
    if (!tenantId || !form || form.autoCreateLead !== true || !submission) return null;

    const fields = Array.isArray(form.fields) ? form.fields : [];
    const mapped = mapAnswersToLead(fields, submission.answers || {});
    const name = mapped.name || mapped.email || mapped.phone;
    if (!name) return null; // pehchanne layak kuch nahi — lead nahi ban sakta

    // Dedupe: isi email/phone se pichhle 24 ghante me lead ban chuka ho to dobara nahi
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const or = [];
    if (mapped.email) or.push({ email: mapped.email });
    if (mapped.phone) or.push({ phone: mapped.phone });
    if (or.length) {
      const dup = await prisma.lead.findFirst({
        where: { tenantId, OR: or, createdAt: { gte: since } },
        select: { id: true },
      });
      if (dup) return { skipped: 'duplicate', leadId: dup.id };
    }

    const lead = await prisma.lead.create({
      data: {
        tenantId,
        name,
        email: mapped.email,
        phone: mapped.phone,
        company: mapped.company,
        source: 'website',
        interest: mapped.interest,
        stage: 'new',
        score: 0,
        notes: `Form "${form.title}" se auto-create (submission ${submission.id}).`,
      },
    });

    // Lead score (phase 39) — best effort
    const score = safeComputeScore(lead);
    if (score > 0) {
      await prisma.lead.update({ where: { id: lead.id }, data: { score } }).catch(() => {});
    }

    await writeAudit({
      tenantId,
      actorId: null, // system job
      action: 'lead.auto_create_from_form',
      entity: 'Lead',
      entityId: lead.id,
      newValue: { formId: form.id, submissionId: submission.id, score },
    }).catch(() => {});

    return { created: true, leadId: lead.id };
  } catch (_) {
    return null; // bridge kabhi submit flow nahi giraye ga
  }
}

module.exports = { maybeCreateLeadFromSubmission, mapAnswersToLead };
