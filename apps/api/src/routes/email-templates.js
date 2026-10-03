// Phase 30 Track 5: Email template editor — per-tenant custom templates.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { listBuiltinTemplates, renderCustom } = require('../lib/mailer');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const ADMIN_ROLES = ['ceo', 'admin', 'super_admin'];
const adminWrite = requireRole(...ADMIN_ROLES);

// List custom templates + available built-in keys
router.get('/', async (req, res, next) => {
  try {
    const templates = await prisma.emailTemplate.findMany({
      where: { ...tenantFilter(req) },
      select: { key: true, isActive: true, updatedAt: true },
      orderBy: { key: 'asc' },
    });
    res.json({ templates, builtins: listBuiltinTemplates() });
  } catch (e) { next(e); }
});

// Get one template — custom if saved, else the built-in default
router.get('/:key', async (req, res, next) => {
  try {
    const { key } = req.params;
    const builtins = listBuiltinTemplates();
    const builtin = builtins.find((b) => b.key === key);
    if (!builtin) return res.status(404).json({ error: { message: 'Unknown template key.' } });
    const custom = await prisma.emailTemplate.findUnique({
      where: { tenantId_key: { tenantId: req.user.tenantId, key } },
    });
    if (custom) {
      return res.json({ key, custom: true, isActive: custom.isActive, subject: custom.subject, htmlBody: custom.htmlBody, variables: builtin.variables });
    }
    // Built-in default rendered with empty data (sample preview values)
    const sample = {};
    for (const v of builtin.variables) sample[v] = `{{${v}}}`;
    const rendered = renderCustom({ subject: defaultSubject(key), htmlBody: defaultHtml(key) }, sample);
    res.json({ key, custom: false, isActive: true, subject: rendered.subject, htmlBody: rendered.htmlBody, variables: builtin.variables, note: 'Showing built-in default. Save to create a custom override.' });
  } catch (e) { next(e); }
});

const upsertSchema = z.object({
  subject: z.string().min(1).max(200),
  htmlBody: z.string().min(1).max(50000),
  isActive: z.boolean().optional(),
});

// Create/update a custom template
router.put('/:key', adminWrite, validateBody(upsertSchema), async (req, res, next) => {
  try {
    const { key } = req.params;
    const builtins = listBuiltinTemplates();
    if (!builtins.some((b) => b.key === key)) {
      return res.status(400).json({ error: { message: 'Unknown template key.' } });
    }
    const { subject, htmlBody, isActive = true } = req.body;
    const tpl = await prisma.emailTemplate.upsert({
      where: { tenantId_key: { tenantId: req.user.tenantId, key } },
      update: { subject, htmlBody, isActive },
      create: { tenantId: req.user.tenantId, key, subject, htmlBody, isActive },
    });
    await writeAudit({
      tenantId: req.user.tenantId, actorId: req.user.sub, action: 'email_template.saved',
      entity: 'EmailTemplate', entityId: tpl.id, newValue: { key },
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    res.json({ template: tpl });
  } catch (e) { next(e); }
});

// Reset to built-in default (deletes the custom override)
router.delete('/:key', adminWrite, async (req, res, next) => {
  try {
    const { key } = req.params;
    await prisma.emailTemplate.deleteMany({
      where: { ...tenantFilter(req), key },
    });
    await writeAudit({
      tenantId: req.user.tenantId, actorId: req.user.sub, action: 'email_template.reset',
      entity: 'EmailTemplate', newValue: { key },
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Built-in defaults expressed in {{variable}} form so the editor starts
// from something meaningful. These mirror lib/mailer's wrap() layout.
function defaultSubject(key) {
  const map = {
    invoiceCreated: 'New invoice {{number}} — Rs {{amount}}',
    bookingConfirmed: 'Booking confirmed — {{unitCode}}',
    ticketUpdate: 'Ticket #{{ticketNo}} — {{status}}',
    visitorCheckin: 'Visitor arrived — {{visitorName}}',
    paymentReceived: 'Payment received — Rs {{amount}}',
    emailVerification: 'Verify your email address',
    announcement: '📢 {{title}}',
  };
  return map[key] || key;
}

function defaultHtml(key) {
  const titles = {
    invoiceCreated: 'New Invoice',
    bookingConfirmed: 'Booking Confirmed',
    ticketUpdate: 'Ticket Update',
    visitorCheckin: 'Visitor Check-in',
    paymentReceived: 'Payment Received',
    emailVerification: 'Verify Your Email',
    announcement: 'Announcement',
  };
  const title = titles[key] || key;
  const body = {
    invoiceCreated: '<p>Hi {{memberName}},</p><p>A new invoice <b>{{number}}</b> for <b>Rs {{amount}}</b> has been issued, due <b>{{dueDate}}</b>.</p><p>Please pay at your earliest convenience.</p>',
    bookingConfirmed: '<p>Hi {{memberName}},</p><p>Your booking for <b>{{unitCode}}</b> on <b>{{date}}</b> at <b>{{startTime}}</b> is confirmed.</p>',
    ticketUpdate: '<p>Hi {{memberName}},</p><p>Your ticket <b>#{{ticketNo}}</b> status is now <b>{{status}}</b>.</p>',
    visitorCheckin: '<p>Hi {{hostName}},</p><p><b>{{visitorName}}</b> has checked in at reception and is waiting to meet you.</p>',
    paymentReceived: '<p>Hi {{memberName}},</p><p>We received your payment of <b>Rs {{amount}}</b> for invoice <b>{{invoiceNumber}}</b>. Thank you!</p>',
    emailVerification: '<p>Hi {{name}},</p><p>Please verify your email address by clicking the link below:</p><p><a href="{{verifyUrl}}" style="display:inline-block;padding:12px 24px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;">Verify Email</a></p><p>This link expires in 24 hours.</p>',
    announcement: '<p>Hi {{name}},</p><h3>{{title}}</h3><p>{{body}}</p>',
  }[key] || '<p>Hi {{memberName}},</p>';
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#0f0f1a;color:#e5e7eb;border-radius:12px;overflow:hidden"><div style="padding:20px 24px;background:linear-gradient(135deg,#7c3aed,#2563eb)"><h2 style="margin:0;color:#fff;font-size:18px">${title}</h2></div><div style="padding:24px">${body}</div><div style="padding:16px 24px;color:#6b7280;font-size:12px;border-top:1px solid #1f2937">This is an automated message from your coworking space.</div></div>`;
}

module.exports = router;
