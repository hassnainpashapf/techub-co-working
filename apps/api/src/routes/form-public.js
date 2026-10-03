// Phase 47 Track 2/10: Public Form Rendering + Submissions — auth-free endpoints.
// Coordinator: server.js me staff wali /api/forms line (routes/forms.js) se PEHLE mount karein:
//   app.use('/api/forms', require('./routes/form-public')); // public, auth-free
// Paths: /public/:slug aur /public/:slug/submit — staff router ke paths se clash nahi.
// Schema dependency: CustomForm (fragments/forms.prisma) + FormSubmission (fragments/form-submissions.prisma).
// Track 9 integration: notifyEmails par submission alert — 'formSubmission' template track 9 jodega;
//   template missing ho to mailer.notify safe {sent:false} deta hai (koi crash nahi).
'use strict';

const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

// 10 submissions/min per IP
const submitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Bohat zyada requests. Thori dair baad koshish karein.',
});

function formsEnabled() {
  return !!(prisma && prisma.customForm && prisma.formSubmission && prisma.tenant);
}

const tenantSlugSchema = z.object({
  tenantSlug: z.string().min(1).max(100),
});

const submitSchema = z.object({
  answers: z.record(z.string(), z.any()),
  submitterName: z.string().max(120).optional().nullable(),
  submitterEmail: z.string().max(160).optional().nullable(),
  website: z.string().max(200).optional().nullable(), // honeypot
});

function isValidEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

async function resolveTenant(tenantSlug) {
  return prisma.tenant.findFirst({
    where: { slug: tenantSlug, isActive: true },
    select: { id: true, name: true, slug: true },
  });
}

async function getPublishedForm(tenantId, slug) {
  return prisma.customForm.findFirst({
    where: { tenantId, slug, isPublic: true, status: 'published' },
    select: {
      id: true,
      tenantId: true,
      title: true,
      description: true,
      fields: true,
      submitButtonText: true,
      successMessage: true,
      notifyEmails: true,
      autoCreateLead: true,
    },
  });
}

function normalizeFields(form) {
  const raw = form.fields;
  if (!Array.isArray(raw)) return [];
  return raw.filter((f) => f && typeof f === 'object' && f.id && f.type && f.label);
}

function ipHash(tenantId, ip) {
  const salt = process.env.IP_HASH_SALT || 'techub-forms-salt';
  return crypto.createHash('sha256').update(`${salt}:${tenantId}:${ip || 'unknown'}`).digest('hex');
}

// GET /api/forms/public/:slug?tenantSlug=abc — published public form (fields ke sath)
router.get('/public/:slug', async (req, res) => {
  const parsed = tenantSlugSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'tenantSlug required' });
  if (!formsEnabled()) return res.status(503).json({ error: 'forms schema not merged yet' });
  try {
    const tenant = await resolveTenant(parsed.data.tenantSlug);
    if (!tenant) return res.status(404).json({ error: 'tenant not found' });
    const form = await getPublishedForm(tenant.id, req.params.slug);
    if (!form) return res.status(404).json({ error: 'form not found' });
    res.json({
      tenant: { name: tenant.name, slug: tenant.slug },
      form: {
        id: form.id,
        slug: req.params.slug,
        title: form.title,
        description: form.description,
        fields: normalizeFields(form),
        submitButtonText: form.submitButtonText || 'Submit',
        successMessage: form.successMessage || 'Shukriya! Aapka response mil gaya.',
      },
    });
  } catch (err) {
    if (err && err.code === 'P2022') return res.status(503).json({ error: 'forms schema not merged yet' });
    res.status(500).json({ error: 'failed to load form' });
  }
});

// POST /api/forms/public/:slug/submit?tenantSlug=abc — submission (rate-limited, honeypot)
router.post('/public/:slug/submit', submitLimiter, async (req, res) => {
  const parsed = tenantSlugSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'tenantSlug required' });
  if (!formsEnabled()) return res.status(503).json({ error: 'forms schema not merged yet' });

  const body = submitSchema.safeParse(req.body || {});
  if (!body.success) return res.status(400).json({ error: 'ghalat data bheja gaya' });

  // Honeypot: bot ne bhara to silent success
  if (body.data.website) return res.json({ ok: true });

  try {
    const tenant = await resolveTenant(parsed.data.tenantSlug);
    if (!tenant) return res.status(404).json({ error: 'tenant not found' });
    const form = await getPublishedForm(tenant.id, req.params.slug);
    if (!form) return res.status(404).json({ error: 'form not found' });

    const fields = normalizeFields(form);
    let answers = body.data.answers || {};
    // Track 3: conditional-logic aware validation (hidden required fields skip)
    const { validateSubmission } = require('../lib/formLogic');
    const logicRes = validateSubmission({ fields }, answers);
    if (!logicRes.valid) {
      return res.status(422).json({
        error: 'validation failed',
        details: logicRes.errors.map((e) => (e && e.message) || String(e)),
      });
    }
    answers = logicRes.cleanedAnswers;

    // Track 4: file upload tokens verify karo (dataUrl direct uploads bhi theek)
    for (const f of fields.filter((f) => f.type === 'file')) {
      const raw = answers[f.id];
      if (raw === undefined || raw === null) continue;
      const items = Array.isArray(raw) ? raw : [raw];
      const resolved = [];
      for (const item of items) {
        const token = typeof item === 'string' ? item : (item && item.token);
        if (token) {
          const { verifyUploadToken } = require('./form-uploads');
          const v = verifyUploadToken(token);
          if (!v.ok) {
            return res.status(422).json({ error: 'validation failed', details: [`"${f.label}" ki file ghalat hai (${v.reason}).`] });
          }
          resolved.push({ name: v.payload.fn || 'file', size: v.payload.sz, mime: v.payload.mt, url: `/api/form-uploads/download?token=${token}` });
        } else {
          resolved.push(item);
        }
      }
      answers[f.id] = resolved;
    }

    const submitterName = (body.data.submitterName || '').trim() || null;
    const submitterEmail = (body.data.submitterEmail || '').trim() || null;
    if (submitterEmail && !isValidEmail(submitterEmail)) {
      return res.status(422).json({ error: 'validation failed', details: ['Sahi email likhein.'] });
    }

    // Member auto-link: email match ho to member se jor do
    let memberId = null;
    if (submitterEmail && prisma.member) {
      try {
        const member = await prisma.member.findFirst({
          where: { tenantId: tenant.id, email: submitterEmail, isActive: true },
          select: { id: true },
        });
        if (member) memberId = member.id;
      } catch { /* member model na ho to skip */ }
    }

    const submission = await prisma.formSubmission.create({
      data: {
        tenantId: tenant.id,
        formId: form.id,
        answers,
        submitterName,
        submitterEmail,
        memberId,
        ipHash: ipHash(tenant.id, req.ip || req.headers['x-forwarded-for']),
      },
      select: { id: true, createdAt: true },
    });

    // Track 9: submission notifications (staff emails + in-app + submitter confirmation)
    try {
      const { notifyOnSubmission } = require('../lib/formNotifications');
      notifyOnSubmission(
        { tenantId: tenant.id, title: form.title, notifyEmails: form.notifyEmails, successMessage: form.successMessage, fields },
        { id: submission.id, tenantId: tenant.id, answers, submitterName, submitterEmail }
      ).catch(() => {});
    } catch { /* notifications na hon to skip */ }

    // Track 7: auto-create CRM lead (form setting on ho to)
    try {
      const { maybeCreateLeadFromSubmission } = require('../lib/formLeadBridge');
      maybeCreateLeadFromSubmission({
        tenantId: tenant.id,
        form: { autoCreateLead: !!form.autoCreateLead, title: form.title },
        submission: { id: submission.id, answers, submitterName, submitterEmail },
      }).catch(() => {});
    } catch { /* bridge na chale to skip */ }

    res.json({
      ok: true,
      submissionId: submission.id,
      message: form.successMessage || 'Shukriya! Aapka response mil gaya.',
    });
  } catch (err) {
    if (err && err.code === 'P2022') return res.status(503).json({ error: 'forms schema not merged yet' });
    res.status(500).json({ error: 'submission failed' });
  }
});

module.exports = router;
