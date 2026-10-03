// Phase 39 Track 2: Public lead capture — no-auth endpoints.
// Mount at /api/leads BEFORE ./routes/leads.js (jo top par authenticate lagata
// hai), taake /public/* kabhi auth middleware me na phanse.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { validateBody } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimit');
const { createNotification } = require('../lib/notify');
const { sendEmail } = require('../lib/mailer');

const router = express.Router();

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Public branding for the lead-capture page — tenant resolved by slug.
// (white-label /public sirf default tenant deta hai, yahan slug-specific.)
router.get('/public/branding', async (req, res, next) => {
  try {
    const tenantSlug = String(req.query.tenantSlug || '');
    if (!tenantSlug) return res.status(400).json({ error: 'tenantSlug required' });
    const tenant = await prisma.tenant.findFirst({
      where: { slug: tenantSlug, isActive: true },
      select: { id: true, name: true, slug: true, primaryColor: true, logoPath: true },
    });
    if (!tenant) return res.status(404).json({ error: 'Space not found' });
    const rows = await prisma.setting.findMany({
      where: { tenantId: tenant.id, key: { in: ['whiteLabel.brandName', 'whiteLabel.supportEmail'] } },
    });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return res.json({
      branding: {
        brandName: map['whiteLabel.brandName'] || tenant.name || 'CoworkOS',
        logoUrl: tenant.logoPath ? `/api/branding/${tenant.slug}/logo` : null,
        primaryColor: tenant.primaryColor || '#7c3aed',
        supportEmail: map['whiteLabel.supportEmail'] || null,
      },
    });
  } catch (err) { return next(err); }
});

// ---------------------------------------------------------------------------
// Public: submit a lead (no auth — rate-limited + honeypot spam guard).
const leadLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: 'Too many requests. Please try again later.' });

const publicLeadSchema = z.object({
  tenantSlug: z.string().min(1),
  name: z.string().min(1).max(120),
  email: z.string().email().max(160).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  company: z.string().max(120).optional().nullable(),
  interest: z.string().max(80).optional().nullable(), // unit type of interest
  budget: z.number().nonnegative().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(), // visitor ka message
  website: z.string().max(200).optional().nullable(), // honeypot — must stay empty
});

router.post('/public', leadLimiter, validateBody(publicLeadSchema), async (req, res, next) => {
  try {
    if (!prisma.lead) return res.status(503).json({ error: 'Leads not enabled yet' });
    // Honeypot: bot ne bhara to fake success (spam lead DB me nahi jata).
    if (req.body.website) return res.status(201).json({ ok: true });
    const { tenantSlug, interest, notes, ...rest } = req.body;
    if (!rest.email && !rest.phone) return res.status(400).json({ error: 'Email or phone is required' });
    const tenant = await prisma.tenant.findFirst({
      where: { slug: tenantSlug, isActive: true },
      select: { id: true, name: true },
    });
    if (!tenant) return res.status(404).json({ error: 'Space not found' });
    const lead = await prisma.lead.create({
      data: {
        ...rest,
        tenantId: tenant.id,
        source: 'website',
        stage: 'new',
        interest: interest || null,
        notes: notes || null,
      },
    });
    // Sales team ko in-app + email notify — fire-and-forget, kabhi fail nahi hone deta.
    (async () => {
      try {
        await createNotification(prisma, {
          tenantId: tenant.id,
          role: 'admin',
          type: 'lead.new',
          message: `New website lead: ${rest.name}${rest.company ? ` (${rest.company})` : ''} — interested in ${interest || 'a space'}.`,
        });
        const staff = await prisma.user.findMany({
          where: { tenantId: tenant.id, role: { in: ['ceo', 'admin', 'manager'] }, isActive: true },
          select: { email: true },
          take: 10,
        });
        const tos = [...new Set(staff.map((u) => u.email).filter(Boolean))];
        if (tos.length) {
          await sendEmail(tenant.id, {
            to: tos,
            subject: `New website lead: ${rest.name} — ${tenant.name}`,
            html:
              `<p><b>${esc(rest.name)}</b>${rest.company ? ` (${esc(rest.company)})` : ''} ne website se contact kiya.</p>` +
              `<p>Email: ${esc(rest.email) || '—'}<br>Phone: ${esc(rest.phone) || '—'}<br>Interested in: ${esc(interest) || '—'}<br>Budget: ${rest.budget != null ? esc(rest.budget) : '—'}</p>` +
              (notes ? `<p>Message: ${esc(notes)}</p>` : '') +
              `<p>Lead sales pipeline me <b>New</b> stage par add ho gaya hai.</p>`,
          });
        }
      } catch (e) { console.error('[lead-public] notify failed:', e.message); }
    })();
    return res.status(201).json({ ok: true, id: lead.id });
  } catch (err) { return next(err); }
});

module.exports = router;
