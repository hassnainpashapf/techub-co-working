// Phase 38 Track 3: Built-in email templates expressed in {{mustache}} form.
// Used by the template editor (GET /:key default view), POST /preview,
// POST /:key/test and POST /seed. Mirrors lib/mailer's wrap() layout and
// the builtin content so seeded defaults behave exactly like built-ins.
const { listBuiltinTemplates } = require('./mailer');

function wrapEmail(title, body) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#0f0f1a;color:#e5e7eb;border-radius:12px;overflow:hidden"><div style="padding:20px 24px;background:linear-gradient(135deg,#7c3aed,#2563eb)"><h2 style="margin:0;color:#fff;font-size:18px">${title}</h2></div><div style="padding:24px">${body}</div><div style="padding:16px 24px;color:#6b7280;font-size:12px;border-top:1px solid #1f2937">This is an automated message from your coworking space.</div></div>`;
}

// Inner body (without the wrap shell) per template key.
const BODIES = {
  invoiceCreated: { title: 'New Invoice', subject: 'New invoice {{number}} — Rs {{amount}}', body: '<p>Hi {{memberName}},</p><p>A new invoice <b>{{number}}</b> for <b>Rs {{amount}}</b> has been issued, due <b>{{dueDate}}</b>.</p><p>Please pay at your earliest convenience.</p>' },
  bookingConfirmed: { title: 'Booking Confirmed', subject: 'Booking confirmed — {{unitCode}}', body: '<p>Hi {{memberName}},</p><p>Your booking for <b>{{unitCode}}</b> on <b>{{date}}</b> at <b>{{startTime}}</b> is confirmed.</p>' },
  ticketUpdate: { title: 'Ticket Update', subject: 'Ticket #{{ticketNo}} — {{status}}', body: '<p>Hi {{memberName}},</p><p>Your ticket <b>#{{ticketNo}}</b> status is now <b>{{status}}</b>.</p>' },
  visitorCheckin: { title: 'Visitor Check-in', subject: 'Visitor arrived — {{visitorName}}', body: '<p>Hi {{hostName}},</p><p><b>{{visitorName}}</b> has checked in at reception and is waiting to meet you.</p>' },
  visitorInvite: { title: 'Visitor Invitation', subject: "You're expected — check-in code {{code}}", body: '<p>Hi {{visitorName}},</p><p><b>{{hostName}}</b> has pre-registered your visit on <b>{{expectedAt}}</b>.</p><p>Show this code at reception:</p><p style="font-size:28px;font-weight:800;letter-spacing:6px;">{{code}}</p>' },
  paymentReceived: { title: 'Payment Received', subject: 'Payment received — Rs {{amount}}', body: '<p>Hi {{memberName}},</p><p>We received your payment of <b>Rs {{amount}}</b> for invoice <b>{{invoiceNumber}}</b>. Thank you!</p>' },
  emailVerification: { title: 'Verify Your Email', subject: 'Verify your email address', body: '<p>Hi {{name}},</p><p>Please verify your email address by clicking the link below:</p><p><a href="{{verifyUrl}}" style="display:inline-block;padding:12px 24px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;">Verify Email</a></p><p>This link expires in 24 hours.</p>' },
  passwordReset: { title: 'Reset Your Password', subject: 'Reset your password', body: '<p>Hi {{name}},</p><p>We received a request to reset your password. Click the button below to choose a new one:</p><p><a href="{{resetUrl}}" style="display:inline-block;padding:12px 24px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;">Reset Password</a></p><p>This link expires in <b>1 hour</b> and can only be used once. If you didn\'t request this, you can safely ignore this email.</p>' },
  referralInvite: { title: 'You Are Invited', subject: '{{referrerName}} invited you to join us', body: '<p>Hi {{name}},</p><p><b>{{referrerName}}</b> thinks you\'d love our coworking space and invited you to join.</p><p><a href="{{joinUrl}}" style="display:inline-block;padding:12px 24px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;">Accept Invitation</a></p><p style="color:#6b7280;font-size:13px">{{rewardNote}}</p>' },
  announcement: { title: 'Announcement', subject: '📢 {{title}}', body: '<p>Hi {{name}},</p><h3>{{title}}</h3><p>{{body}}</p>' },
  invoiceOverdue: { title: 'Payment Reminder', subject: 'Payment reminder — {{number}}', body: '<p>Hi {{memberName}},</p><p>Invoice <b>{{number}}</b> for <b>Rs {{amount}}</b> was due on <b>{{dueDate}}</b> ({{daysOverdue}} days ago). Please arrange payment at the earliest to avoid service interruption.</p>' },
  systemHealthAlert: { title: 'System Health Alert', subject: '⚠️ System health alert', body: '<p>Hi {{name}},</p><p>The system health check detected the following issue(s):</p><pre style="background:#f3f4f6;padding:12px;border-radius:8px;white-space:pre-wrap">{{issues}}</pre><p>Please check the System Health page for details.</p>' },
  eventReminder: { title: 'Event Reminder', subject: '🎉 Reminder: {{eventTitle}} tomorrow', body: '<p>Hi {{memberName}},</p><p>Just a reminder that <b>{{eventTitle}}</b> is happening <b>tomorrow</b>:</p><p>📅 {{eventWhen}}<br/>📍 {{eventLocation}}</p><p>We look forward to seeing you!</p>' },
  mailReceived: { title: 'Mail Received', subject: '📦 You have mail — package received', body: '<p>Hi {{memberName}},</p><p>A <b>{{itemType}}</b> from <b>{{sender}}</b> has arrived for you at reception ({{receivedAt}}).</p><p>Tracking: <b>{{trackingNumber}}</b></p><p>Please collect it at your convenience.</p>' },
  mailReminder: { title: 'Mail Pickup Reminder', subject: '⏰ Reminder: uncollected mail ({{daysWaiting}} days)', body: '<p>Hi {{memberName}},</p><p>This is a friendly reminder that your <b>{{itemType}}</b> from <b>{{sender}}</b> received <b>{{receivedAt}}</b> ({{daysWaiting}} days ago) is still waiting at reception.</p><p>Tracking: <b>{{trackingNumber}}</b></p><p>Please collect it soon.</p>' },
  contractSignatureRequest: { title: 'Contract Signature Request', subject: '✍️ Please sign your contract — {{unitCode}}', body: '<p>Hi {{signerName}},</p><p>Your coworking contract for <b>{{memberName}}</b> (unit <b>{{unitCode}}</b>) is ready for signature.</p><p><a href="{{signUrl}}" style="display:inline-block;padding:12px 24px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;">Review &amp; Sign</a></p><p style="color:#6b7280;font-size:13px">This link expires on <b>{{expiresAt}}</b> and can only be used once. Your IP address and timestamp will be recorded with your signature.</p>' },
  shiftReminder: { title: 'Shift Reminder', subject: '⏰ Shift reminder — {{startTime}} today', body: '<p>Hi {{name}},</p><p>This is a reminder that <b>{{shiftRole}}</b> starts in about <b>2 hours</b>:</p><p>📅 {{shiftWhen}}<br/>🕐 {{startTime}} – {{endTime}}</p><p>Please be on time!</p>' },
  wifiVoucher: { title: 'WiFi Voucher', subject: '📶 Your WiFi voucher code', body: '<p>Hi {{memberName}},</p><p>Here is your WiFi access voucher:</p><p style="font-size:28px;font-weight:800;letter-spacing:6px;">{{code}}</p><p>Valid for <b>{{durationHours}} hours</b> on up to <b>{{maxDevices}} devices</b>.</p><p style="color:#6b7280;font-size:13px">Show this code at reception if you need help connecting.</p>' },
  maintenanceUrgent: { title: 'Urgent Maintenance Request', subject: '🚨 Urgent maintenance request: {{title}}', body: '<p>Hi {{name}},</p><p>An <b style="color:#dc2626">URGENT</b> maintenance request needs attention:</p><p><b>{{title}}</b><br/>Priority: <b>{{priority}}</b><br/>Location: <b>{{location}}</b><br/>Reported by: {{reporter}}<br/>Reported at: {{createdAt}}</p><p>Please assign it to the ops team as soon as possible.</p>' },
  assetOverdue: { title: 'Overdue Assets', subject: '📦 {{count}} overdue asset checkouts', body: '<p>Hi {{name}},</p><p>The following asset checkout(s) are past their due date:</p><pre style="background:#f3f4f6;padding:12px;border-radius:8px;white-space:pre-wrap">{{list}}</pre><p>Please follow up on the Assets page.</p>' },
  tenantWelcome: { title: 'Welcome aboard', subject: '🎉 Welcome to {{tenantName}} — your admin account is ready', body: '<p>Hi {{adminName}},</p><p>Your workspace <b>{{tenantName}}</b> is ready. Sign in with these one-time credentials and set a new password right away:</p><p>🔗 <a href="{{loginUrl}}">{{loginUrl}}</a><br/>📧 Email: <b>{{email}}</b><br/>🔑 Temporary password: <b style="font-size:18px;letter-spacing:1px">{{tempPassword}}</b></p><p style="color:#b91c1c"><b>Note:</b> you will be asked to change this password on your first login. Do not share it.</p>' },
  retentionOffer: { title: 'We Value You', subject: 'We value you — a special offer just for you', body: '<p>Hi {{memberName}},</p><p>We\'ve noticed you haven\'t been around as much lately, and we wanted to reach out personally — your membership matters to us.</p><p style="background:#f3f4f6;padding:12px;border-radius:8px;white-space:pre-wrap">{{customMessage}}</p><p>We\'d love to hear how we can make your experience better. Just reply to this email and our team will take care of the rest.</p><p>Warm regards,<br/>Your coworking team</p>' },
  trialEnding: { title: 'Trial Ending Soon', subject: '⏳ Your trial ends soon — keep your space', body: '<p>Hi {{memberName}},</p><p>Your trial ends on <b>{{trialEndsAt}}</b>. We\'d love to keep you around — upgrade to a full membership to keep your space, your bookings and your perks.</p><p>Just reply to this email and our team will set everything up for you.</p><p>Warm regards,<br/>Your coworking team</p>' },
  contractExpiring: { title: 'Contract Expiring', subject: '📄 Your contract ({{unitCode}}) expires on {{endDate}}', body: '<p>Hi {{memberName}},</p><p>Your contract for <b>{{unitCode}}</b> expires on <b>{{endDate}}</b> (current rent Rs {{rentAmount}}).</p><p>Renew now to avoid any interruption — reply to this email and we\'ll prepare your renewal.</p><p>Warm regards,<br/>Your coworking team</p>' },
  invoiceReminder: { title: 'Payment Reminder', subject: '💰 Reminder: invoice {{invoiceNumber}} due {{dueDate}}', body: '<p>Hi {{memberName}},</p><p>This is a friendly reminder that invoice <b>{{invoiceNumber}}</b> of <b>{{amount}}</b> is due on <b>{{dueDate}}</b>.</p><p>Please pay at your earliest convenience to avoid any interruption.</p><p>Warm regards,<br/>Your coworking team</p>' },
  contractReminder: { title: 'Contract Reminder', subject: '📄 Reminder: contract ({{unitCode}}) ends {{endDate}}', body: '<p>Hi {{memberName}},</p><p>Just a reminder that your contract for <b>{{unitCode}}</b> ends on <b>{{endDate}}</b>.</p><p>Reply to this email if you\'d like to renew or discuss options.</p><p>Warm regards,<br/>Your coworking team</p>' },
  bookingReminder: { title: 'Booking Reminder', subject: '📅 Reminder: "{{title}}" {{startAt}}', body: '<p>Hi {{memberName}},</p><p>Just a reminder about your upcoming booking:</p><p><b>{{title}}</b><br/>📍 {{unitCode}}<br/>📅 {{startAt}}</p><p>See you soon!</p>' },
  maintenanceReminder: { title: 'Maintenance Reminder', subject: '🔧 Reminder: "{{title}}" open for {{daysOpen}} days', body: '<p>Hi {{name}},</p><p>The maintenance request <b>"{{title}}"</b> at <b>{{location}}</b> has been open for <b>{{daysOpen}} days</b>.</p><p>Please take action or assign it to the ops team.</p>' },
  documentReminder: { title: 'Document Expiry Reminder', subject: '🗂️ Reminder: "{{title}}" expires {{expiresAt}}', body: '<p>Hi {{memberName}},</p><p>Your document <b>"{{title}}"</b> expires on <b>{{expiresAt}}</b>.</p><p>Please renew it and upload the new copy to avoid any issues.</p><p>Warm regards,<br/>Your coworking team</p>' },
};

// Full default template (subject + wrapped htmlBody + variables) for a key.
function getDefaultTemplate(key) {
  const def = BODIES[key];
  if (!def) return null;
  const builtin = (listBuiltinTemplates() || []).find((b) => b.key === key);
  return {
    key,
    subject: def.subject,
    htmlBody: wrapEmail(def.title, def.body),
    variables: builtin ? builtin.variables : [],
    custom: false,
    isActive: true,
  };
}

// Sample values for preview / test sends.
function sampleDataFor(variables) {
  const samples = {
    memberName: 'Ali Raza', name: 'Ali Raza', hostName: 'Sara Khan', visitorName: 'Bilal Ahmed',
    signerName: 'Ali Raza', adminName: 'Sara Khan', tenantName: 'Techub',
    number: 'INV-2026-0142', ticketNo: '1024', status: 'In Progress', code: 'A7K2Q9',
    unitCode: 'MR-01', date: '2026-10-10', startTime: '10:00 AM', endTime: '06:00 PM',
    amount: '25,000', dueDate: '2026-10-15', daysOverdue: '6', level: '1', invoiceNumber: 'INV-2026-0142',
    verifyUrl: 'https://app.example.com/verify/abc123', resetUrl: 'https://app.example.com/reset/abc123',
    joinUrl: 'https://app.example.com/join/xyz', rewardNote: 'You both get Rs 2,000 credit when they join.',
    referrerName: 'Sara Khan', title: 'Weekend Networking Night', body: 'Join us this Saturday for drinks and demos.',
    issues: 'Disk usage at 87% on the app server.', eventTitle: 'Founder Meetup', eventWhen: 'Oct 11, 6:00 PM', eventLocation: 'Main Hall',
    itemType: 'package', sender: 'Daraz.pk', trackingNumber: 'TRK-889900', receivedAt: '2026-10-02', daysWaiting: '3',
    signUrl: 'https://app.example.com/sign/token123', expiresAt: '2026-10-17',
    shiftWhen: 'Today', shiftRole: 'Reception', durationHours: '24', maxDevices: '2',
    priority: 'urgent', location: 'Meeting Room 2', reporter: 'Ali Raza', createdAt: '2026-10-03 09:15',
    count: '2', list: 'Projector (due Oct 1)\nHDMI cable (due Oct 2)',
    loginUrl: 'https://app.example.com/login', email: 'admin@example.com', tempPassword: 'Tmp#4821',
    customMessage: 'Enjoy 20% off your next month — on us.',
  };
  const out = {};
  for (const v of variables || []) out[v] = samples[v] !== undefined ? samples[v] : `[${v}]`;
  return out;
}

module.exports = { getDefaultTemplate, sampleDataFor, wrapEmail };
