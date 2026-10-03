// Central mailer: per-tenant SMTP settings, graceful no-op when disabled.
// Phase 28 Track 3: sends go through the DB job queue (lib/jobs.js) so API
// responses never block on SMTP. Falls back to direct send when the queue is
// unavailable (e.g. jobs schema fragment not merged yet).
const nodemailer = require('nodemailer');
const prisma = require('./prisma');

const transporters = new Map();

// Lazy job-queue handle (Track 1). Guarded so the mailer keeps working even
// if lib/jobs.js is absent or its API differs.
//
// Loop protection: the worker's email handler must send DIRECTLY, never via
// the public sendEmail() (which enqueues). To make this bulletproof across
// tracks, we wrap jobs.registerHandler once: any handler registered for
// 'email' runs with inEmailHandler=true, and sendEmail() short-circuits to
// direct SMTP while the flag is set. So even if another module registers an
// email handler that calls sendEmail(), no infinite enqueue loop can form.
let inEmailHandler = false;

function getJobs() {
  try {
    const j = require('./jobs');
    if (j && typeof j.enqueue === 'function' && typeof j.registerHandler === 'function') {
      if (!j.__mailerLoopGuard) {
        j.__mailerLoopGuard = true;
        const origRegister = j.registerHandler;
        j.registerHandler = (type, fn) => {
          if (type === 'email' && typeof fn === 'function') {
            const wrapped = async (jobOrPayload) => {
              inEmailHandler = true;
              try {
                return await fn(jobOrPayload);
              } finally {
                inEmailHandler = false;
              }
            };
            return origRegister(type, wrapped);
          }
          return origRegister(type, fn);
        };
      }
      return j;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function getTransporter(tenantId) {
  if (transporters.has(tenantId)) return transporters.get(tenantId);
  const settings = await prisma.emailSetting.findUnique({ where: { tenantId } });
  if (!settings || !settings.enabled || !settings.host) return null;
  const t = nodemailer.createTransport({
    host: settings.host,
    port: settings.port || 587,
    secure: !!settings.secure,
    auth: settings.username ? { user: settings.username, pass: settings.password || '' } : undefined,
  });
  transporters.set(tenantId, { transporter: t, settings });
  return { transporter: t, settings };
}

function invalidateTransporter(tenantId) {
  transporters.delete(tenantId);
}

// Direct SMTP send — used by the queue worker and as a fallback when the
// queue is unavailable. Never enqueues (no recursion).
async function sendEmailDirect(tenantId, { to, subject, html, text }) {
  if (!to) return { sent: false, reason: 'no-recipient' };
  const entry = await getTransporter(tenantId);
  if (!entry) return { sent: false, reason: 'email-disabled' };
  const { transporter, settings } = entry;
  const from = settings.fromEmail
    ? `"${settings.fromName || 'CoworkOS'}" <${settings.fromEmail}>`
    : settings.username;
  try {
    await transporter.sendMail({ from, to, subject, html, text: text || html?.replace(/<[^>]+>/g, '') });
    return { sent: true };
  } catch (err) {
    console.error('[mailer] send failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

// Rate safety: max 5 emails per minute per recipient (in-memory, per process).
const rateBuckets = new Map();
function isRateLimited(to) {
  const key = String(to || '').toLowerCase();
  if (!key) return false;
  const now = Date.now();
  const recent = (rateBuckets.get(key) || []).filter((t) => now - t < 60000);
  if (recent.length >= 5) return true;
  recent.push(now);
  rateBuckets.set(key, recent);
  if (rateBuckets.size > 5000) {
    const first = rateBuckets.keys().next();
    if (!first.done) rateBuckets.delete(first.value);
  }
  return false;
}

// Public send: enqueue a background job and return immediately.
// Falls back to direct SMTP when the queue is unavailable.
// If called from inside the email worker itself (loop guard), sends directly.
async function sendEmail(tenantId, { to, subject, html, text }) {
  if (!to) return { sent: false, reason: 'no-recipient' };
  if (inEmailHandler) return sendEmailDirect(tenantId, { to, subject, html, text });
  if (isRateLimited(to)) return { sent: false, reason: 'rate-limited' };
  const jobs = getJobs();
  if (jobs) {
    try {
      await jobs.enqueue('email', { to, subject, html, text }, { tenantId });
      return { queued: true };
    } catch (err) {
      console.error('[mailer] enqueue failed, sending directly:', err.message);
    }
  }
  return sendEmailDirect(tenantId, { to, subject, html, text });
}

function wrap(title, body) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#0f0f1a;color:#e5e7eb;border-radius:12px;overflow:hidden">
    <div style="padding:20px 24px;background:linear-gradient(135deg,#7c3aed,#2563eb)"><h2 style="margin:0;color:#fff;font-size:18px">${title}</h2></div>
    <div style="padding:24px">${body}</div>
    <div style="padding:16px 24px;color:#6b7280;font-size:12px;border-top:1px solid #1f2937">This is an automated message from your coworking space.</div>
  </div>`;
}

const templates = {
  invoiceCreated: ({ memberName, number, amount, dueDate }) => ({
    subject: `New invoice ${number} — Rs ${Number(amount).toLocaleString()}`,
    html: wrap('New Invoice', `<p>Hi ${memberName || 'there'},</p><p>A new invoice <b>${number}</b> for <b>Rs ${Number(amount).toLocaleString()}</b> has been issued${dueDate ? `, due <b>${dueDate}</b>` : ''}.</p><p>Please pay at your earliest convenience.</p>`),
  }),
  bookingConfirmed: ({ memberName, unitCode, date, startTime }) => ({
    subject: `Booking confirmed — ${unitCode}`,
    html: wrap('Booking Confirmed', `<p>Hi ${memberName || 'there'},</p><p>Your booking for <b>${unitCode}</b> on <b>${date}</b> at <b>${startTime}</b> is confirmed.</p>`),
  }),
  ticketUpdate: ({ memberName, ticketNo, status }) => ({
    subject: `Ticket #${ticketNo} — ${status}`,
    html: wrap('Ticket Update', `<p>Hi ${memberName || 'there'},</p><p>Your ticket <b>#${ticketNo}</b> status is now <b>${status}</b>.</p>`),
  }),
  visitorCheckin: ({ hostName, visitorName }) => ({
    subject: `Visitor arrived — ${visitorName}`,
    html: wrap('Visitor Check-in', `<p>Hi ${hostName || 'there'},</p><p><b>${visitorName}</b> has checked in at reception and is waiting to meet you.</p>`),
  }),
  visitorInvite: ({ visitorName, hostName, code, expectedAt }) => ({
    subject: `You're expected — check-in code ${code}`,
    html: wrap('Visitor Invitation', `<p>Hi ${visitorName || 'there'},</p><p><b>${hostName || 'Your host'}</b> has pre-registered your visit${expectedAt ? ` on <b>${expectedAt}</b>` : ''}.</p><p>Show this code at reception:</p><p style="font-size:28px;font-weight:800;letter-spacing:6px;">${code}</p>`),
  }),
  paymentReceived: ({ memberName, amount, invoiceNumber }) => ({
    subject: `Payment received — Rs ${Number(amount).toLocaleString()}`,
    html: wrap('Payment Received', `<p>Hi ${memberName || 'there'},</p><p>We received your payment of <b>Rs ${Number(amount).toLocaleString()}</b>${invoiceNumber ? ` for invoice <b>${invoiceNumber}</b>` : ''}. Thank you!</p>`),
  }),
  emailVerification: ({ name, verifyUrl }) => ({
    subject: 'Verify your email address',
    html: wrap('Verify Your Email', `<p>Hi ${name || 'there'},</p><p>Please verify your email address by clicking the link below:</p><p><a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;">Verify Email</a></p><p>This link expires in 24 hours.</p>`),
  }),
  passwordReset: ({ name, resetUrl }) => ({
    subject: 'Reset your password',
    html: wrap('Reset Your Password', `<p>Hi ${name || 'there'},</p><p>We received a request to reset your password. Click the button below to choose a new one:</p><p><a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;">Reset Password</a></p><p>This link expires in <b>1 hour</b> and can only be used once. If you didn't request this, you can safely ignore this email.</p>`),
  }),
  referralInvite: ({ name, referrerName, joinUrl, rewardNote }) => ({
    subject: `${referrerName || 'A friend'} invited you to join us`,
    html: wrap('You Are Invited', `<p>Hi ${name || 'there'},</p><p><b>${referrerName || 'A friend'}</b> thinks you'd love our coworking space and invited you to join.</p><p><a href="${joinUrl}" style="display:inline-block;padding:12px 24px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;">Accept Invitation</a></p>${rewardNote ? `<p style="color:#6b7280;font-size:13px">${rewardNote}</p>` : ''}<p style="color:#6b7280;font-size:13px">If you didn't expect this invitation, you can safely ignore this email.</p>`),
  }),
  announcement: ({ title, body, name }) => ({
    subject: `📢 ${title}`,
    html: wrap('Announcement', `<p>Hi ${name || 'there'},</p><h3 style="margin:0 0 8px">${title}</h3><p style="white-space:pre-wrap">${body}</p>`),
  }),
  invoiceOverdue: ({ memberName, number, amount, dueDate, daysOverdue, level }) => {
    const lvl = Number(level) || 1;
    const titles = { 1: 'Payment Reminder', 2: 'Overdue Payment — Action Required', 3: 'Final Notice — Overdue Payment' };
    const intros = {
      1: `This is a friendly reminder that invoice <b>${number}</b> for <b>Rs ${Number(amount).toLocaleString()}</b> was due on <b>${dueDate}</b> (${daysOverdue} day${daysOverdue === 1 ? '' : 's'} ago).`,
      2: `Invoice <b>${number}</b> for <b>Rs ${Number(amount).toLocaleString()}</b> is now <b>${daysOverdue} days overdue</b> (was due <b>${dueDate}</b>). Please arrange payment at the earliest.`,
      3: `This is a <b>final notice</b>: invoice <b>${number}</b> for <b>Rs ${Number(amount).toLocaleString()}</b> is <b>${daysOverdue} days overdue</b> (due <b>${dueDate}</b>). Please pay immediately to avoid service interruption.`,
    };
    return {
      subject: `${titles[lvl] || titles[1]} — ${number}`,
      html: wrap(titles[lvl] || titles[1], `<p>Hi ${memberName || 'there'},</p><p>${intros[lvl] || intros[1]}</p><p>If you have already paid, please ignore this message.</p>`),
    };
  },
  systemHealthAlert: ({ name, issues }) => ({
    subject: '⚠️ System health alert',
    html: wrap('System Health Alert', `<p>Hi ${name || 'Admin'},</p><p>The system health check detected the following issue(s):</p><pre style="background:#f3f4f6;padding:12px;border-radius:8px;white-space:pre-wrap">${issues || 'n/a'}</pre><p>Please check the System Health page for details.</p>`),
  }),
  eventReminder: ({ memberName, eventTitle, eventWhen, eventLocation }) => ({
    subject: `🎉 Reminder: ${eventTitle} tomorrow`,
    html: wrap('Event Reminder', `<p>Hi ${memberName || 'there'},</p><p>Just a reminder that <b>${eventTitle}</b> is happening <b>tomorrow</b>:</p><p>📅 ${eventWhen || ''}<br/>📍 ${eventLocation || ''}</p><p>We look forward to seeing you!</p>`),
  }),
};

async function notify(tenantId, to, templateName, data) {
  // Phase 30: custom tenant templates override built-ins (graceful fallback).
  try {
    if (prisma.emailTemplate && tenantId) {
      const custom = await prisma.emailTemplate.findUnique({
        where: { tenantId_key: { tenantId, key: templateName } },
      });
      if (custom && custom.isActive) {
        return sendEmail(tenantId, { to, ...renderCustom(custom, data || {}) });
      }
    }
  } catch {
    /* fall through to built-in template (model/table may not exist yet) */
  }
  const tpl = templates[templateName];
  if (!tpl) return { sent: false, reason: 'unknown-template' };
  return sendEmail(tenantId, { to, ...tpl(data) });
}

// Mustache-style {{variable}} replace against the notify() data object.
function renderCustom(custom, data) {
  const fill = (s) =>
    String(s || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
      const v = k.split('.').reduce((o, p) => (o == null ? o : o[p]), data);
      return v == null ? '' : String(v);
    });
  return { subject: fill(custom.subject), html: fill(custom.htmlBody) };
}

// Register the background email handler (idempotent — handlers keyed by type).
// Accepts either the raw payload or the full job row (jobs.js passes the job).
(function registerEmailHandler() {
  const jobs = getJobs();
  if (!jobs) return;
  jobs.registerHandler('email', async (jobOrPayload) => {
    const p = (jobOrPayload && jobOrPayload.payload) || jobOrPayload || {};
    if (!p.tenantId || !p.to) throw new Error('email job needs {tenantId, to, subject, html}');
    const result = await sendEmailDirect(p.tenantId, {
      to: p.to,
      subject: p.subject || '',
      html: p.html || '',
      text: p.text,
    });
    // Permanent failures — don't burn retries on them.
    if (!result.sent && (result.reason === 'email-disabled' || result.reason === 'no-recipient')) {
      console.log(`[mailer] not retrying (${result.reason}) for ${p.to}`);
      return result;
    }
    if (!result.sent) throw new Error(result.reason || 'smtp send failed');
    return result;
  });
})();

// Built-in template keys + their variable names (for the template-editor UI).
const TEMPLATE_VARS = {
  invoiceCreated: ['memberName', 'number', 'amount', 'dueDate'],
  bookingConfirmed: ['memberName', 'unitCode', 'date', 'startTime'],
  ticketUpdate: ['memberName', 'ticketNo', 'status'],
  visitorCheckin: ['hostName', 'visitorName'],
  visitorInvite: ['visitorName', 'hostName', 'code', 'expectedAt'],
  paymentReceived: ['memberName', 'amount', 'invoiceNumber'],
  emailVerification: ['name', 'verifyUrl'],
  passwordReset: ['name', 'resetUrl'],
  referralInvite: ['name', 'referrerName', 'joinUrl', 'rewardNote'],
  announcement: ['title', 'body', 'name'],
  invoiceOverdue: ['memberName', 'number', 'amount', 'dueDate', 'daysOverdue', 'level'],
  systemHealthAlert: ['name', 'issues'],
  eventReminder: ['memberName', 'eventTitle', 'eventWhen', 'eventLocation'],
};

function listBuiltinTemplates() {
  return Object.keys(templates).map((key) => ({ key, variables: TEMPLATE_VARS[key] || [] }));
}

module.exports = { sendEmail, sendEmailDirect, notify, invalidateTransporter, getTransporter, listBuiltinTemplates, renderCustom };
