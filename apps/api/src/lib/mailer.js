// Central mailer: per-tenant SMTP settings, graceful no-op when disabled.
const nodemailer = require('nodemailer');
const prisma = require('./prisma');

const transporters = new Map();

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

async function sendEmail(tenantId, { to, subject, html, text }) {
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
  paymentReceived: ({ memberName, amount, invoiceNumber }) => ({
    subject: `Payment received — Rs ${Number(amount).toLocaleString()}`,
    html: wrap('Payment Received', `<p>Hi ${memberName || 'there'},</p><p>We received your payment of <b>Rs ${Number(amount).toLocaleString()}</b>${invoiceNumber ? ` for invoice <b>${invoiceNumber}</b>` : ''}. Thank you!</p>`),
  }),
};

async function notify(tenantId, to, templateName, data) {
  const tpl = templates[templateName];
  if (!tpl) return { sent: false, reason: 'unknown-template' };
  return sendEmail(tenantId, { to, ...tpl(data) });
}

module.exports = { sendEmail, notify, invalidateTransporter, getTransporter };
