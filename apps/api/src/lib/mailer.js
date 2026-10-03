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

// White-label brand lookup (cached 5 min): whiteLabel.brandName setting,
// fallback to tenant name, then CoworkOS.
const brandCache = new Map();
async function getTenantBrand(tenantId) {
  if (!tenantId) return { brandName: 'CoworkOS', supportEmail: null };
  const cached = brandCache.get(tenantId);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.brand;
  const brand = { brandName: 'CoworkOS', supportEmail: null };
  try {
    const rows = await prisma.setting.findMany({
      where: { tenantId, key: { in: ['whiteLabel.brandName', 'whiteLabel.supportEmail'] } },
    });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    if (map['whiteLabel.brandName']) brand.brandName = map['whiteLabel.brandName'];
    if (map['whiteLabel.supportEmail']) brand.supportEmail = map['whiteLabel.supportEmail'];
    if (!map['whiteLabel.brandName']) {
      const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
      if (t?.name) brand.brandName = t.name;
    }
  } catch { /* ignore — default brand */ }
  brandCache.set(tenantId, { at: Date.now(), brand });
  if (brandCache.size > 500) brandCache.delete(brandCache.keys().next().value);
  return brand;
}

// Direct SMTP send — used by the queue worker and as a fallback when the
// queue is unavailable. Never enqueues (no recursion).
async function sendEmailDirect(tenantId, { to, subject, html, text, attachments }) {
  if (!to) return { sent: false, reason: 'no-recipient' };
  const entry = await getTransporter(tenantId);
  if (!entry) return { sent: false, reason: 'email-disabled' };
  const { transporter, settings } = entry;
  const brand = await getTenantBrand(tenantId);
  const from = settings.fromEmail
    ? `"${settings.fromName || brand.brandName}" <${settings.fromEmail}>`
    : settings.username;
  try {
    await transporter.sendMail({ from, to, subject, html, text: text || html?.replace(/<[^>]+>/g, ''), ...(attachments ? { attachments: normalizeAttachments(attachments) } : {}) });
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
// Attachments may carry Buffer content; the job queue JSON-serializes the
// payload, so normalize to base64 (nodemailer accepts encoding:'base64').
function normalizeAttachments(attachments) {
  if (!attachments) return undefined;
  return attachments.map((a) => {
    if (a && a.content && Buffer.isBuffer(a.content)) {
      return { ...a, content: a.content.toString('base64'), encoding: 'base64' };
    }
    return a;
  });
}

async function sendEmail(tenantId, { to, subject, html, text, attachments }) {
  if (!to) return { sent: false, reason: 'no-recipient' };
  const atts = normalizeAttachments(attachments);
  if (inEmailHandler) return sendEmailDirect(tenantId, { to, subject, html, text, attachments: atts });
  if (isRateLimited(to)) return { sent: false, reason: 'rate-limited' };
  const jobs = getJobs();
  if (jobs) {
    try {
      await jobs.enqueue('email', { to, subject, html, text, ...(atts ? { attachments: atts } : {}) }, { tenantId });
      return { queued: true };
    } catch (err) {
      console.error('[mailer] enqueue failed, sending directly:', err.message);
    }
  }
  return sendEmailDirect(tenantId, { to, subject, html, text, attachments: atts });
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
  // Phase 39 Track 7: welcome email on lead → member conversion.
  memberWelcome: ({ memberName, planName, unitCode }) => ({
    subject: `Welcome aboard${planName ? ` — ${planName}` : ''}! 🎉`,
    html: wrap('Welcome to Your Coworking Space', `<p>Hi ${memberName || 'there'},</p><p>Your membership is now <b>active</b> — welcome to the community! 🎉</p>${planName ? `<p>Plan: <b>${planName}</b></p>` : ''}${unitCode ? `<p>Your space: <b>${unitCode}</b></p>` : ''}<p>We can't wait to see you around. Reach out anytime if you need anything.</p><p>Warm regards,<br/>Your coworking team</p>`),
  }),
  // Phase 40 Track 1: birthday & anniversary celebration emails.
  birthday: ({ memberName }) => ({
    subject: `Happy Birthday, ${memberName || 'friend'}! 🎂`,
    html: wrap('Happy Birthday!', `<p>Hi ${memberName || 'there'},</p><p>🎂 <b>Happy Birthday!</b> Wishing you a wonderful day and an amazing year ahead.</p><p>As a little gift, we've added <b>50 loyalty points</b> to your account. Enjoy! 🎁</p><p>Warm regards,<br/>Your coworking community</p>`),
  }),
  anniversary: ({ memberName, years }) => ({
    subject: `Happy ${years || ''} Anniversary! 🎉`,
    html: wrap('Community Anniversary', `<p>Hi ${memberName || 'there'},</p><p>🎉 Congratulations on completing <b>${years || 'another'} year${Number(years) === 1 ? '' : 's'}</b> with our community!</p><p>Thank you for being part of this journey. We've added <b>100 loyalty points</b> as a token of appreciation. 🙏</p><p>Warm regards,<br/>Your coworking community</p>`),
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
  // Phase 44 Track 8: ticket purchase confirmation with QR entry code.
  eventTicket: ({ buyerName, eventTitle, eventWhen, eventLocation, ticketCode, ticketType, price }) => ({
    subject: `🎟️ Your ticket — ${eventTitle}`,
    html: wrap('Event Ticket', `<p>Hi ${buyerName || 'there'},</p><p>Your booking for <b>${eventTitle}</b>${ticketType ? ` (${ticketType})` : ''} is confirmed${price ? ` — <b>Rs ${Number(price).toLocaleString()}</b>` : ''}.</p><p>📅 ${eventWhen || ''}<br/>📍 ${eventLocation || ''}</p><p>Show this entry code at the gate:</p><p style="font-size:26px;font-weight:800;letter-spacing:6px;">${ticketCode || ''}</p><p style="color:#6b7280;font-size:13px">Please arrive 15 minutes early. See you there!</p>`),
  }),
  // Phase 44 Track 8: post-event thank-you + feedback survey invite.
  eventThanks: ({ buyerName, eventTitle, feedbackUrl }) => ({
    subject: `Thank you for joining — ${eventTitle} 🙏`,
    html: wrap('Thank You', `<p>Hi ${buyerName || 'there'},</p><p>Thank you for attending <b>${eventTitle}</b>! We hope you had a great time.</p><p>We'd love your feedback — it helps us make future events even better.</p>${feedbackUrl ? `<p><a href="${feedbackUrl}" style="display:inline-block;padding:12px 24px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;">Share Feedback</a></p>` : ''}<p style="color:#6b7280;font-size:13px">See you at the next one!</p>`),
  }),
  mailReceived: ({ memberName, itemType, sender, trackingNumber, receivedAt }) => ({
    subject: `📦 You have mail — ${itemType === 'letter' ? 'letter' : 'package'} received`,
    html: wrap('Mail Received', `<p>Hi ${memberName || 'there'},</p><p>A <b>${itemType === 'letter' ? 'letter' : 'package'}</b>${sender ? ` from <b>${sender}</b>` : ''} has arrived for you at reception${receivedAt ? ` (${receivedAt})` : ''}.</p>${trackingNumber ? `<p>Tracking: <b>${trackingNumber}</b></p>` : ''}<p>Please collect it at your convenience.</p>`),
  }),
  mailReminder: ({ memberName, itemType, sender, trackingNumber, receivedAt, daysWaiting }) => ({
    subject: `⏰ Reminder: uncollected ${itemType === 'letter' ? 'letter' : 'package'} (${daysWaiting} days)`,
    html: wrap('Mail Pickup Reminder', `<p>Hi ${memberName || 'there'},</p><p>This is a friendly reminder that your <b>${itemType === 'letter' ? 'letter' : 'package'}</b>${sender ? ` from <b>${sender}</b>` : ''} received <b>${receivedAt || ''}</b> (${daysWaiting} day${daysWaiting === 1 ? '' : 's'} ago) is still waiting at reception.</p>${trackingNumber ? `<p>Tracking: <b>${trackingNumber}</b></p>` : ''}<p>Please collect it soon.</p>`),
  }),
  contractSignatureRequest: ({ signerName, memberName, unitCode, signUrl, expiresAt }) => ({
    subject: `✍️ Please sign your contract${unitCode ? ` — ${unitCode}` : ''}`,
    html: wrap('Contract Signature Request', `<p>Hi ${signerName || 'there'},</p><p>Your coworking contract${memberName ? ` for <b>${memberName}</b>` : ''}${unitCode ? ` (unit <b>${unitCode}</b>)` : ''} is ready for signature.</p><p><a href="${signUrl}" style="display:inline-block;padding:12px 24px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;">Review &amp; Sign</a></p><p style="color:#6b7280;font-size:13px">This link expires on <b>${expiresAt || ''}</b> and can only be used once. Your IP address and timestamp will be recorded with your signature.</p>`),
  }),
  shiftReminder: ({ name, shiftWhen, startTime, endTime, shiftRole }) => ({
    subject: `⏰ Shift reminder — ${startTime} today`,
    html: wrap('Shift Reminder', `<p>Hi ${name || 'there'},</p><p>This is a reminder that <b>${shiftRole || 'your shift'}</b> starts in about <b>2 hours</b>:</p><p>📅 ${shiftWhen || ''}<br/>🕐 ${startTime || ''} – ${endTime || ''}</p><p>Please be on time!</p>`),
  }),
  wifiVoucher: ({ memberName, code, durationHours, maxDevices }) => ({
    subject: '📶 Your WiFi voucher code',
    html: wrap('WiFi Voucher', `<p>Hi ${memberName || 'there'},</p><p>Here is your WiFi access voucher:</p><p style="font-size:28px;font-weight:800;letter-spacing:6px;">${code}</p><p>Valid for <b>${durationHours || '24'} hours</b> on up to <b>${maxDevices || '2'} devices</b>.</p><p style="color:#6b7280;font-size:13px">Show this code at reception if you need help connecting.</p>`),
  }),
  maintenanceUrgent: ({ name, title, priority, location, reporter, createdAt }) => ({
    subject: `🚨 Urgent maintenance request: ${title}`,
    html: wrap('Urgent Maintenance Request', `<p>Hi ${name || 'there'},</p><p>An <b style="color:#dc2626">URGENT</b> maintenance request needs attention:</p><p><b>${title}</b><br/>Priority: <b>${priority || 'urgent'}</b><br/>${location ? `Location: <b>${location}</b><br/>` : ''}Reported by: ${reporter || 'a member'}<br/>${createdAt ? `Reported at: ${createdAt}` : ''}</p><p>Please assign it to the ops team as soon as possible.</p>`),
  }),
  assetOverdue: ({ name, count, list }) => ({
    subject: `📦 ${count} overdue asset checkout${count === 1 ? '' : 's'}`,
    html: wrap('Overdue Assets', `<p>Hi ${name || 'Admin'},</p><p>The following asset checkout(s) are past their due date:</p><pre style="background:#f3f4f6;padding:12px;border-radius:8px;white-space:pre-wrap">${list || 'n/a'}</pre><p>Please follow up on the Assets page.</p>`),
  }),
  tenantWelcome: ({ adminName, tenantName, loginUrl, email, tempPassword }) => ({
    subject: `🎉 Welcome to ${tenantName || 'CoworkOS'} — your admin account is ready`,
    html: wrap('Welcome aboard', `<p>Hi ${adminName || 'there'},</p><p>Your workspace <b>${tenantName || ''}</b> is ready. Sign in with these one-time credentials and set a new password right away:</p><p>🔗 <a href="${loginUrl || '#'}">${loginUrl || 'login page'}</a><br/>📧 Email: <b>${email || ''}</b><br/>🔑 Temporary password: <b style="font-size:18px;letter-spacing:1px">${tempPassword || ''}</b></p><p style="color:#b91c1c"><b>Note:</b> you will be asked to change this password on your first login. Do not share it.</p>`),
  }),
  retentionOffer: ({ memberName, customMessage }) => ({
    subject: 'We value you — a special offer just for you',
    html: wrap('We Value You', `<p>Hi ${memberName || 'there'},</p><p>We've noticed you haven't been around as much lately, and we wanted to reach out personally — your membership matters to us.</p>${customMessage ? `<p style="background:#f3f4f6;padding:12px;border-radius:8px;white-space:pre-wrap">${customMessage}</p>` : ''}<p>We'd love to hear how we can make your experience better. Just reply to this email and our team will take care of the rest.</p><p>Warm regards,<br/>Your coworking team</p>`),
  }),
  // Phase 38 Track 2: lifecycle automation built-ins.
  trialEnding: ({ memberName, trialEndsAt }) => ({
    subject: '⏳ Your trial ends soon — keep your space',
    html: wrap('Trial Ending Soon', `<p>Hi ${memberName || 'there'},</p><p>Your trial ends on <b>${trialEndsAt || 'soon'}</b>. We'd love to keep you around — upgrade to a full membership to keep your space, your bookings and your perks.</p><p>Just reply to this email and our team will set everything up for you.</p><p>Warm regards,<br/>Your coworking team</p>`),
  }),
  contractExpiring: ({ memberName, unitCode, endDate, rentAmount }) => ({
    subject: `📄 Your contract${unitCode ? ` (${unitCode})` : ''} expires on ${endDate || 'soon'}`,
    html: wrap('Contract Expiring', `<p>Hi ${memberName || 'there'},</p><p>Your contract${unitCode ? ` for <b>${unitCode}</b>` : ''} expires on <b>${endDate || 'soon'}</b>${rentAmount ? ` (current rent Rs ${Number(rentAmount).toLocaleString()})` : ''}.</p><p>Renew now to avoid any interruption — reply to this email and we'll prepare your renewal.</p><p>Warm regards,<br/>Your coworking team</p>`),
  }),
  // Phase 38 Track 10: Smart Reminders Engine built-ins.
  invoiceReminder: ({ memberName, invoiceNumber, amount, dueDate }) => ({
    subject: `💰 Reminder: invoice ${invoiceNumber} due ${dueDate}`,
    html: wrap('Payment Reminder', `<p>Hi ${memberName || 'there'},</p><p>This is a friendly reminder that invoice <b>${invoiceNumber}</b> of <b>${amount}</b> is due on <b>${dueDate}</b>.</p><p>Please pay at your earliest convenience to avoid any interruption.</p><p>Warm regards,<br/>Your coworking team</p>`),
  }),
  contractReminder: ({ memberName, unitCode, endDate }) => ({
    subject: `📄 Reminder: contract${unitCode ? ` (${unitCode})` : ''} ends ${endDate}`,
    html: wrap('Contract Reminder', `<p>Hi ${memberName || 'there'},</p><p>Just a reminder that your contract${unitCode ? ` for <b>${unitCode}</b>` : ''} ends on <b>${endDate}</b>.</p><p>Reply to this email if you'd like to renew or discuss options.</p><p>Warm regards,<br/>Your coworking team</p>`),
  }),
  bookingReminder: ({ memberName, title, unitCode, startAt }) => ({
    subject: `📅 Reminder: "${title}" ${startAt}`,
    html: wrap('Booking Reminder', `<p>Hi ${memberName || 'there'},</p><p>Just a reminder about your upcoming booking:</p><p><b>${title}</b><br/>${unitCode ? `📍 ${unitCode}<br/>` : ''}📅 ${startAt}</p><p>See you soon!</p>`),
  }),
  maintenanceReminder: ({ name, title, location, daysOpen }) => ({
    subject: `🔧 Reminder: "${title}" open for ${daysOpen} days`,
    html: wrap('Maintenance Reminder', `<p>Hi ${name || 'there'},</p><p>The maintenance request <b>"${title}"</b>${location ? ` at <b>${location}</b>` : ''} has been open for <b>${daysOpen} days</b>.</p><p>Please take action or assign it to the ops team.</p>`),
  }),
  documentReminder: ({ memberName, title, expiresAt }) => ({
    subject: `🗂️ Reminder: "${title}" expires ${expiresAt}`,
    html: wrap('Document Expiry Reminder', `<p>Hi ${memberName || 'there'},</p><p>Your document <b>"${title}"</b> expires on <b>${expiresAt}</b>.</p><p>Please renew it and upload the new copy to avoid any issues.</p><p>Warm regards,<br/>Your coworking team</p>`),
  }),
  // Phase 45 Track 9: daily manager digest.
  managerDigest: ({ name, dateLine, summaryHtml }) => ({
    subject: `📊 Daily digest — ${dateLine}`,
    html: wrap('Daily Manager Digest', `<p>Hi ${name || 'there'},</p>${summaryHtml || ''}`),
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
  const rendered = tpl(data);
  // White-label: brand the email footer with the tenant's brand name.
  if (rendered && rendered.html) {
    try {
      const brand = await getTenantBrand(tenantId);
      rendered.html = rendered.html.replace(
        'This is an automated message from your coworking space.',
        `This is an automated message from ${brand.brandName}.`
      );
    } catch { /* keep default footer */ }
  }
  return sendEmail(tenantId, { to, ...rendered });
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
      attachments: p.attachments,
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
  memberWelcome: ['memberName', 'planName', 'unitCode'],
  birthday: ['memberName'],
  anniversary: ['memberName', 'years'],
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
  eventTicket: ['buyerName', 'eventTitle', 'eventWhen', 'eventLocation', 'ticketCode', 'ticketType', 'price'],
  eventThanks: ['buyerName', 'eventTitle', 'feedbackUrl'],
  mailReceived: ['memberName', 'itemType', 'sender', 'trackingNumber', 'receivedAt'],
  mailReminder: ['memberName', 'itemType', 'sender', 'trackingNumber', 'receivedAt', 'daysWaiting'],
  contractSignatureRequest: ['signerName', 'memberName', 'unitCode', 'signUrl', 'expiresAt'],
  shiftReminder: ['name', 'shiftWhen', 'startTime', 'endTime', 'shiftRole'],
  wifiVoucher: ['memberName', 'code', 'durationHours', 'maxDevices'],
  maintenanceUrgent: ['name', 'title', 'priority', 'location', 'reporter', 'createdAt'],
  assetOverdue: ['name', 'count', 'list'],
  tenantWelcome: ['adminName', 'tenantName', 'loginUrl', 'email', 'tempPassword'],
  retentionOffer: ['memberName', 'customMessage'],
  trialEnding: ['memberName', 'trialEndsAt'],
  contractExpiring: ['memberName', 'unitCode', 'endDate', 'rentAmount'],
  invoiceReminder: ['memberName', 'invoiceNumber', 'amount', 'dueDate'],
  contractReminder: ['memberName', 'unitCode', 'endDate'],
  bookingReminder: ['memberName', 'title', 'unitCode', 'startAt'],
  maintenanceReminder: ['name', 'title', 'location', 'daysOpen'],
  documentReminder: ['memberName', 'title', 'expiresAt'],
  managerDigest: ['name', 'dateLine', 'summaryHtml'],
};

function listBuiltinTemplates() {
  return Object.keys(templates).map((key) => ({ key, variables: TEMPLATE_VARS[key] || [] }));
}

module.exports = { sendEmail, sendEmailDirect, notify, invalidateTransporter, getTransporter, listBuiltinTemplates, renderCustom, getTenantBrand };
