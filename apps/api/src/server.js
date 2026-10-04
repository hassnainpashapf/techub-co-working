// All business dates are UTC calendar days — pin TZ before anything else.
process.env.TZ = 'UTC';
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { securityHeaders } = require('./middleware/security');

const app = express();

// Phase 28: security headers first, before everything else
app.use(securityHeaders);

// Phase 28: tightened CORS — WEB_URL + *.pages.dev in production, open in dev
const WEB_URL = process.env.WEB_URL || 'https://techub-co-working.pages.dev';
const corsOptions = {
  origin: (origin, cb) => {
    if (process.env.NODE_ENV !== 'production') return cb(null, true);
    if (!origin) return cb(null, true); // same-origin / server-to-server
    if (origin === WEB_URL || origin.endsWith('.pages.dev')) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
};
app.use(cors(corsOptions));
app.use(morgan('dev'));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/auth', require('./routes/auth-extended'));
app.use('/api/audit-logs', require('./routes/audit-logs'));
app.use('/api/tenants', require('./routes/tenants'));
app.use('/api/users', require('./routes/users'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/spaces', require('./routes/spaces'));
app.use('/api/buildings', require('./routes/buildings'));
app.use('/api/members', require('./routes/members'));
app.use('/api/companies', require('./routes/companies'));
app.use('/api/contracts', require('./routes/contracts'));
app.use('/api/membership-plans', require('./routes/membership-plans'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/finance', require('./routes/finance'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/visitors', require('./routes/visitors'));
app.use('/api/maintenance', require('./routes/maintenance'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/email-settings', require('./routes/email-settings'));
app.use('/api/refunds', require('./routes/refunds'));
app.use('/api/rides', require('./routes/rides'));
app.use('/api/webhooks', require('./routes/webhooks'));
app.use('/api/api-keys', require('./routes/api-keys'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/notification-preferences', require('./routes/notification-preferences'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/whatsapp', require('./routes/whatsapp'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/portal', require('./routes/portal'));
app.use('/api/sms', require('./routes/sms'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/cache', require('./routes/cache'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/storage', require('./routes/storage'));
app.use('/api/recurring-bookings', require('./routes/recurring-bookings'));
app.use('/api/leads', require('./routes/lead-public')); // public, auth-free — PEHLE mount
app.use('/api/leads', require('./routes/leads'));
app.use('/api/leads', require('./routes/lead-lost')); // /lost-analysis, /:id/lost
app.use('/api/tours', require('./routes/tours'));
app.use('/api/quotations', require('./routes/quotations'));
app.use('/api/lead-followups', require('./routes/lead-followups'));
app.use('/api/lead-import', require('./routes/lead-import'));
require('./lib/quotationExpiry'); // 'quotation-expiry'
require('./lib/leadFollowupDigest'); // 'lead-followup-digest'
require('./lib/tourReminders'); // 'tour-reminders'
// Phase 40: member engagement pack (additive)
app.use('/api/celebrations', require('./routes/celebrations'));
app.use('/api/perks', require('./routes/perks'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/polls', require('./routes/polls'));
app.use('/api/badges', require('./routes/badges'));
// Phase 44: events & ticketing pro pack (additive)
// events-public AUTH-FREE hai — is liye /api/events ke auth routes se PEHLE mount karein.
app.use('/api/events', require('./routes/events-public'));
app.use('/api/ticket-types', require('./routes/ticket-types'));
app.use('/api/event-tickets', require('./routes/event-tickets'));
app.use('/api/tickets', require('./routes/ticket-refunds')); // multi-router, support-tickets ke sath
app.use('/api/ticket-scan', require('./routes/ticket-scan'));
app.use('/api/sponsors', require('./routes/sponsors'));
app.use('/api/event-agenda', require('./routes/event-agenda').router);
app.use('/api/event-agenda', require('./routes/event-agenda').publicRouter);
app.use('/api/event-analytics', require('./routes/event-analytics'));
app.use('/api/events-dashboard', require('./routes/events-dashboard'));
app.use('/api/events', require('./routes/event-checkins').router); // events.js ke baad
// Phase 47: custom forms & surveys builder pack (additive)
// form-public AUTH-FREE hai — /api/forms ke auth routes se PEHLE mount karein.
app.use('/api/forms', require('./routes/form-public'));
app.use('/api/forms', require('./routes/forms'));
app.use('/api/form-uploads', require('./routes/form-uploads'));
app.use('/api/form-analytics', require('./routes/form-analytics'));
app.use('/api/form-templates', require('./routes/form-templates'));
app.use('/api/form-inbox', require('./routes/form-inbox'));
app.use('/api/forms-dashboard', require('./routes/forms-dashboard'));
app.use('/api/newsletters', require('./routes/newsletters'));
app.use('/api/intros', require('./routes/intros'));
app.use('/api/milestones', require('./routes/milestones'));
app.use('/api/engagement', require('./routes/engagement'));
require('./lib/celebrations'); // 'celebrations' (self-schedule via ensure)
// Phase 41: vendor & procurement pack (additive)
app.use('/api/vendors', require('./routes/vendors'));
app.use('/api/purchase-orders', require('./routes/purchase-orders'));
app.use('/api/goods-receipts', require('./routes/goods-receipts'));
app.use('/api/vendor-bills', require('./routes/vendor-bills'));
app.use('/api/vendor-payments', require('./routes/vendor-payments'));
app.use('/api/vendor-contracts', require('./routes/vendor-contracts'));
app.use('/api/procurement', require('./routes/procurement-dashboard'));
app.use('/api/inventory/reorder-alerts', require('./routes/reorder-alerts'));
require('./lib/vendorContractExpiry'); // 'vendor-contract-expiry' (self-schedule via ensure)
require('./lib/reorderAlerts'); // 'reorder-alerts' (self-schedule via ensure)
// Phase 42: HR & Payroll Pro Pack (additive) — /api/employee-onboarding is distinct from Phase 35's /api/onboarding
app.use('/api/employees', require('./routes/employees'));
app.use('/api/staff-attendance', require('./routes/staff-attendance'));
app.use('/api/leaves', require('./routes/leaves'));
app.use('/api/overtime', require('./routes/overtime'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/advances', require('./routes/advances'));
app.use('/api/employee-onboarding', require('./routes/employee-onboarding'));
app.use('/api/exits', require('./routes/exits'));
app.use('/api/hr-documents', require('./routes/hr-documents'));
app.use('/api/hr', require('./routes/hr-dashboard'));
require('./lib/reviewReminders'); // 'review-reminders' (self-schedule via ensure)
require('./lib/milestones'); // 'milestones' (self-schedule via ensure)
require('./lib/badges'); // 'badges-run' auto-register on require
require('./lib/newsletterJob'); // 'newsletter-send' auto-register on require
// Phase 43: Cafeteria & F&B Pack (additive)
app.use('/api/menu', require('./routes/menu'));
app.use('/api/menu', require('./routes/food-ratings').router);
app.use('/api/food-orders', require('./routes/food-orders'));
app.use('/api/food-orders', require('./routes/food-payments'));
app.use('/api/kitchen', require('./routes/kitchen'));
app.use('/api/delivery-zones', require('./routes/delivery-zones'));
app.use('/api/meal-plans', require('./routes/meal-plans'));
app.use('/api/cafe-staff', require('./routes/cafe-staff'));
app.use('/api/food-waste', require('./routes/food-waste'));
app.use('/api/cafe', require('./routes/cafe-dashboard'));
app.use('/api/contract-renewals', require('./routes/contract-renewals'));
app.use('/api/member-qr', require('./routes/member-qr'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/activity', require('./routes/activity'));
app.use('/api/search', require('./routes/search'));
app.use('/api/import', require('./routes/import'));
app.use('/api/print', require('./routes/print'));
app.use('/api/email-templates', require('./routes/email-templates'));
app.use('/api/saved-views', require('./routes/saved-views'));
app.use('/api/public', require('./routes/public-bookings'));
require('./lib/renewalAlerts');
// Phase 31: recurring-invoice job auto-registers on require; dunning auto-registers via its route.
require('./lib/recurringInvoiceJob');
app.use('/api/payroll', require('./routes/payroll'));
app.use('/api/recurring-invoices', require('./routes/recurring-invoices'));
app.use('/api/dunning', require('./routes/dunning'));
app.use('/api/tax-reports', require('./routes/tax-reports'));
app.use('/api/gateways', require('./routes/gateways'));
app.use('/api/petty-cash', require('./routes/petty-cash'));
app.use('/api/budgets', require('./routes/budgets'));
app.use('/api/ar-aging', require('./routes/ar-aging'));
// Phase 32: security & reliability
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/login-security', require('./routes/login-security'));
app.use('/api/audit-retention', require('./routes/audit-retention'));
app.use('/api/backups', require('./routes/backups'));
app.use('/api/health', require('./routes/health'));
app.use('/api/data-export', require('./routes/data-export'));
// Phase 33: community & engagement
app.use('/api/events', require('./routes/events'));
app.use('/api/referrals', require('./routes/referrals'));
app.use('/api/loyalty', require('./routes/loyalty'));
app.use('/api/marketplace', require('./routes/marketplace'));
app.use('/api/surveys', require('./routes/surveys'));
app.use('/api/visitor-invites', require('./routes/visitor-invites'));
app.use('/api/push', require('./routes/push'));
app.use('/api/directory', require('./routes/directory'));
app.use('/api/displays', require('./routes/displays'));
// Phase 34: facility operations
app.use('/api/shifts', require('./routes/shifts'));
app.use('/api/assets', require('./routes/assets'));
app.use('/api/maintenance-requests', require('./routes/maintenance-requests'));
app.use('/api/parking', require('./routes/parking'));
app.use('/api/mail', require('./routes/mail'));
app.use('/api/printing', require('./routes/printing'));
app.use('/api/wifi', require('./routes/wifi'));
app.use('/api/lost-found', require('./routes/lost-found'));
app.use('/api/housekeeping', require('./routes/housekeeping'));
app.use('/api/booking-rules', require('./routes/booking-rules'));

// Phase 35: Investor & Analytics Pack
app.use('/api/location-compare', require('./routes/location-compare'));
app.use('/api/pnl', require('./routes/pnl'));
app.use('/api/forecast', require('./routes/forecast'));
app.use('/api/projections', require('./routes/projections'));
app.use('/api/churn', require('./routes/churn'));
app.use('/api/expense-trends', require('./routes/expense-trends'));
app.use('/api/kpi-dashboards', require('./routes/kpi-dashboards'));
app.use('/api/white-label', require('./routes/white-label'));
app.use('/api/onboarding', require('./routes/onboarding'));
app.use('/api/admin/tenants', require('./routes/admin-tenants'));
// Phase 36: Integrations & API Pack
app.use('/api/docs', require('./routes/docs'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/slack', require('./routes/slack'));
app.use('/api/esign', require('./routes/esign'));
app.use('/api/campaigns', require('./routes/campaigns'));
app.use('/api/sms-campaigns', require('./routes/sms-campaigns'));
app.use('/api/api-usage', require('./routes/api-usage'));
app.use('/api/accounting-export', require('./routes/accounting-export'));
app.use('/api/ical', require('./routes/ical'));
require('./lib/campaignJob'); // 'campaign-send'
require('./lib/smsCampaigns'); // 'sms-campaign'
require('./lib/apiUsageCleanup'); // 'api-usage-cleanup'
// Phase 38: Automation & Growth Pack
app.use('/api/scheduled-reports', require('./routes/scheduled-reports'));
app.use('/api/lifecycle', require('./routes/lifecycle'));
app.use('/api/automation', require('./routes/automation'));
app.use('/api/reminders', require('./routes/reminders'));
app.use('/api/waiting-list', require('./routes/waiting-list'));
app.use('/api/member-import', require('./routes/member-import'));
app.use('/api/member-bulk', require('./routes/member-bulk'));
require('./lib/scheduledReports'); // 'scheduled-report-send'
require('./lib/lifecycleEngine'); // 'lifecycle-run'
require('./lib/automationEngine'); // 'automation-inactive-scan'
require('./lib/docExpiryJob'); // 'doc-expiry'
require('./lib/waitingListExpiry'); // 'waiting-list-expiry'
require('./lib/reminders'); // 'reminders'
try {
  const { enqueue } = require('./lib/jobs');
  const prisma = require('./lib/prisma');
  const PHASE38_DAILY = ['lifecycle-run', 'automation-inactive-scan', 'waiting-list-expiry', 'reminders']; // doc-expiry self-schedules via ensureDocExpiryScheduled()
  const schedulePhase38Jobs = async () => {
    try {
      require('./lib/scheduledReports').ensureScheduledReportsScheduled();
      require('./lib/docExpiryJob').ensureDocExpiryScheduled();
      for (const type of PHASE38_DAILY) {
        const pending = await prisma.job.count({ where: { type, status: 'pending' } }).catch(() => 1);
        if (!pending) await enqueue(type, {}, { runAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }).catch(() => {});
      }
    } catch (e) { console.error('[phase38] daily schedule failed:', e.message); }
  };
  schedulePhase38Jobs();
  setInterval(schedulePhase38Jobs, 24 * 60 * 60 * 1000).unref();
} catch (e) { console.error('[phase38] scheduler init failed:', e.message); }

// Phase 39: CRM jobs (additive) — quotation expiry + lead followup digest (daily), tour reminders (hourly)
try {
  const { enqueue } = require('./lib/jobs');
  const prisma39 = require('./lib/prisma');
  const schedulePhase39Jobs = async () => {
    try {
      require('./lib/quotationExpiry').ensureQuotationExpiryScheduled();
      require('./lib/leadFollowupDigest').ensureLeadFollowupDigestScheduled();
      const pendingT = await prisma39.job.count({ where: { type: 'tour-reminders', status: 'pending' } }).catch(() => 1);
      if (!pendingT) await enqueue('tour-reminders', {}, { runAt: new Date(Date.now() + 60 * 60 * 1000) }).catch(() => {});
    } catch (e) { console.error('[phase39] schedule failed:', e.message); }
  };
  schedulePhase39Jobs();
  setInterval(schedulePhase39Jobs, 60 * 60 * 1000).unref();
} catch (e) { console.error('[phase39] scheduler init failed:', e.message); }

// Phase 40: member engagement jobs (additive) — celebrations + milestones (daily self-schedule), badges-run (daily)
try {
  const { enqueue } = require('./lib/jobs');
  const prisma40 = require('./lib/prisma');
  const schedulePhase40Jobs = async () => {
    try {
      require('./lib/celebrations').ensureCelebrationsScheduled();
      require('./lib/milestones').ensureMilestonesScheduled();
      const pendingB = await prisma40.job.count({ where: { type: 'badges-run', status: 'pending' } }).catch(() => 1);
      if (!pendingB) await enqueue('badges-run', {}, { runAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }).catch(() => {});
    } catch (e) { console.error('[phase40] schedule failed:', e.message); }
  };
  schedulePhase40Jobs();
  setInterval(schedulePhase40Jobs, 24 * 60 * 60 * 1000).unref();
} catch (e) { console.error('[phase40] scheduler init failed:', e.message); }

// Phase 41: procurement jobs (additive) — vendor contract expiry + reorder alerts (daily self-schedule)
try {
  require('./lib/vendorContractExpiry').ensureVendorContractExpiryScheduled();
  require('./lib/reorderAlerts').ensureReorderAlertsScheduled();
} catch (e) { console.error('[phase41] scheduler init failed:', e.message); }
// Phase 42: review reminders (daily self-schedule)
try {
  require('./lib/reviewReminders').ensureReviewRemindersScheduled();
} catch (e) { console.error('[phase42] scheduler init failed:', e.message); }
// Phase 44: event ticket emails (additive) — confirmation/reminder/thanks daily job
try {
  require('./lib/eventEmails').ensureEventEmailsScheduled();
} catch (e) { console.error('[phase44] event emails schedule failed:', e.message); }
// Phase 45: AI & Intelligence Pack (additive) — route mounts
app.use('/api/ai-settings', require('./routes/ai-settings'));
app.use('/api/ai/chat', require('./routes/ai-chat'));
app.use('/api/smart-search', require('./routes/smart-search'));
app.use('/api/insights', require('./routes/insights'));
app.use('/api/anomalies', require('./routes/anomalies'));
app.use('/api/sentiment', require('./routes/sentiment'));
app.use('/api/smart-pricing', require('./routes/smart-pricing'));
app.use('/api/intelligence', require('./routes/intelligence'));
// Phase 45: AI jobs (additive) — weekly insights, anomaly scan, churn auto-actions, manager digest
try {
  require('./lib/insightEngine').ensureInsightsScheduled();
  require('./lib/anomalyDetector').ensureAnomalyScheduled();
  require('./lib/churnActions').ensureChurnActionsScheduled();
  require('./lib/managerDigest').ensureDigestScheduled();
} catch (e) { console.error('[phase45] AI jobs schedule failed:', e.message); }
// Phase 46: Multi-Currency & International Pack (additive) — route mounts
app.use('/api/currency-settings', require('./routes/currency-settings'));
app.use('/api/fx-rates', require('./routes/fx-rates'));
app.use('/api/fx-gainloss', require('./routes/fx-gainloss'));
app.use('/api/currency-reports', require('./routes/currency-reports'));
app.use('/api/member-statements', require('./routes/member-statements'));
app.use('/api/currency-dashboard', require('./routes/currency-dashboard'));
// Phase 46: FX jobs (additive) — daily auto rate refresh + FX alerts
try {
  require('./lib/fx').ensureFxScheduled();
  require('./lib/fxAlerts').ensureFxAlertsScheduled();
} catch (e) { console.error('[phase46] FX jobs schedule failed:', e.message); }
// Phase 48: Smart Access & Entry Pack (additive) — route mounts
app.use('/api/doors', require('./routes/doors'));
app.use('/api/access-credentials', require('./routes/access-credentials'));
app.use('/api/access-schedules', require('./routes/access-schedules'));
app.use('/api/access-logs', require('./routes/access-logs'));
app.use('/api/day-passes', require('./routes/day-passes'));
app.use('/api/door-unlock', require('./routes/door-unlock'));
app.use('/api/my-access', require('./routes/my-access'));
app.use('/api/access-dashboard', require('./routes/access-dashboard'));
// Phase 48: access anomaly scan job (additive)
try {
  require('./lib/accessAnomalies').ensureAccessAnomaliesScheduled();
} catch (e) { console.error('[phase48] access anomalies schedule failed:', e.message); }
// Phase 49: Unified Communication Hub Pack (additive) — route mounts
app.use('/api/comms', require('./routes/comms'));
app.use('/api/comms-timeline', require('./routes/comms-timeline'));
app.use('/api/call-logs', require('./routes/call-logs'));
app.use('/api/comms-templates', require('./routes/comms-templates'));
app.use('/api/auto-replies', require('./routes/auto-replies'));
app.use('/api/inbox', require('./routes/inbox'));
app.use('/api/comms-dashboard', require('./routes/comms-dashboard'));
// Phase 49: scheduled comms job (additive)
try {
  require('./lib/scheduledComms').ensureScheduledCommsJob();
} catch (e) { console.error('[phase49] scheduled comms job failed:', e.message); }
// Phase 50: Legal & Compliance Pack (additive) — route mounts
app.use('/api/legal-templates', require('./routes/legal-templates'));
app.use('/api/policies', require('./routes/policies'));
app.use('/api/compliance', require('./routes/compliance'));
app.use('/api/legal-vault', require('./routes/legal-vault'));
app.use('/api/incidents', require('./routes/incidents'));
app.use('/api/insurance', require('./routes/insurance'));
app.use('/api/retention', require('./routes/retention'));
app.use('/api/vendor-compliance', require('./routes/vendor-compliance'));
app.use('/api/legal-dashboard', require('./routes/legal-dashboard'));
// Phase 51: Utility & Sustainability Pack (additive)
app.use('/api/meters', require('./routes/meters'));
app.use('/api/meter-readings', require('./routes/meter-readings'));
app.use('/api/utility-billing', require('./routes/utility-billing'));
app.use('/api/utility-analytics', require('./routes/utility-analytics'));
app.use('/api/cost-allocation', require('./routes/cost-allocation'));
app.use('/api/my-usage', require('./routes/my-usage'));
app.use('/api/sustainability', require('./routes/sustainability'));
app.use('/api/green-initiatives', require('./routes/green-initiatives'));
app.use('/api/utilities-dashboard', require('./routes/utilities-dashboard'));
try {
  require('./lib/utilityAlerts').ensureUtilityAlertsScheduled();
} catch (e) { console.error('[phase51] utility alerts schedule failed:', e.message); }
// Phase 52: Custom Report Builder Pack (additive)
app.use('/api/custom-reports', require('./routes/custom-reports'));
app.use('/api/report-charts', require('./routes/report-charts'));
app.use('/api/report-exports', require('./routes/report-exports'));
app.use('/api/report-schedules', require('./routes/report-schedules'));
app.use('/api/report-pivot', require('./routes/report-pivot'));
app.use('/api/report-templates', require('./routes/report-templates'));
app.use('/api/report-alerts', require('./routes/report-alerts'));
app.use('/api/reports-hub', require('./routes/reports-hub'));
// Phase 53: Learning & Academy Pack
app.use('/api/courses', require('./routes/courses'));
app.use('/api/enrollments', require('./routes/enrollments'));
app.use('/api/quizzes', require('./routes/quizzes'));
app.use('/api/certificates', require('./routes/certificates'));
app.use('/api/workshops', require('./routes/workshops'));
app.use('/api/course-ratings', require('./routes/course-ratings').router || require('./routes/course-ratings'));
app.use('/api/learning-paths', require('./routes/learning-paths'));
app.use('/api/instructor', require('./routes/instructor'));
app.use('/api/academy-dashboard', require('./routes/academy-dashboard'));
try {
  require('./lib/reportScheduler').ensureReportScheduler();
} catch (e) { console.error('[phase52] report scheduler schedule failed:', e.message); }
try {
  require('./lib/reportAlerts').ensureReportAlertsScheduled();
} catch (e) { console.error('[phase52] report alerts schedule failed:', e.message); }
// Phase 50: legal jobs (additive)
try {
  require('./lib/legalVaultExpiry').ensureLegalVaultExpiryScheduled();
} catch (e) { console.error('[phase50] legal vault expiry schedule failed:', e.message); }
try {
  require('./routes/insurance').ensureInsuranceScheduled();
} catch (e) { console.error('[phase50] insurance reminders schedule failed:', e.message); }
try {
  require('./routes/compliance').ensureComplianceScheduled();
} catch (e) { console.error('[phase50] compliance schedule failed:', e.message); }
try {
  const { enqueue } = require('./lib/jobs');
  const scheduleApiUsageCleanup = async () => {
    try {
      const pending = await require('./lib/prisma').job.count({ where: { type: 'api-usage-cleanup', status: 'pending' } }).catch(() => 1);
      if (!pending) await enqueue('api-usage-cleanup', {}, { runAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }).catch(() => {});
    } catch (e) { console.error('[phase36] api-usage-cleanup schedule failed:', e.message); }
  };
  scheduleApiUsageCleanup();
  setInterval(scheduleApiUsageCleanup, 24 * 60 * 60 * 1000).unref();
} catch (e) { console.error('[phase36] scheduler init failed:', e.message); }
require('./lib/healthCheck');
require('./lib/healthCheck').startHealthScheduler();
// Phase 37: Mobile & Portal Pack
app.use('/api/member-id', require('./routes/member-id'));
require('./lib/auditRetention'); // auto-registers 'audit-retention' job handler
require('./lib/backup').registerBackupJob();
require('./lib/backup').ensureBackupScheduled();
// Phase 33: community jobs (auto-register handlers) + daily schedule
require('./lib/eventReminderJob');
require('./lib/marketplaceExpiry');
require('./lib/npsScheduler');
try {
  const { enqueue } = require('./lib/jobs');
  const prisma = require('./lib/prisma');
  const scheduleCommunityJobs = async () => {
    try {
      const pending = await prisma.job.count({
        where: { type: { in: ['event-reminder', 'marketplace-expiry', 'nps-scheduler'] }, status: 'pending' },
      }).catch(() => 1);
      if (!pending) {
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
        for (const type of ['event-reminder', 'marketplace-expiry', 'nps-scheduler']) {
          await enqueue(type, {}, { runAt: tomorrow }).catch(() => {});
        }
      }
    } catch (e) { console.error('[phase33] schedule failed:', e.message); }
  };
  scheduleCommunityJobs();
  setInterval(scheduleCommunityJobs, 24 * 60 * 60 * 1000).unref();
} catch (e) { console.error('[phase33] scheduler init failed:', e.message); }

// Phase 34: facility jobs (auto-register handlers) + schedules
require('./lib/shiftReminderJob'); // 'shift-reminder'
require('./lib/assetAlerts'); // 'asset-overdue'
require('./lib/parkingRelease'); // 'parking-release'
require('./lib/mailReminderJob'); // 'mail-reminder'
require('./lib/printingReset'); // 'printing-reset'
require('./lib/lostFoundExpiry'); // 'lostfound-expiry'
try {
  const { enqueue } = require('./lib/jobs');
  const prisma = require('./lib/prisma');
  const FACILITY_DAILY = ['asset-overdue', 'parking-release', 'mail-reminder', 'lostfound-expiry'];
  const scheduleFacilityJobs = async () => {
    try {
      for (const type of FACILITY_DAILY) {
        const pending = await prisma.job.count({ where: { type, status: 'pending' } }).catch(() => 1);
        if (!pending) await enqueue(type, {}, { runAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }).catch(() => {});
      }
    } catch (e) { console.error('[phase34] daily schedule failed:', e.message); }
  };
  const scheduleShiftReminders = async () => {
    try {
      const { enqueue: enq } = require('./lib/jobs');
      await enq('shift-reminder', {}).catch(() => {});
    } catch (e) { console.error('[phase34] shift-reminder enqueue failed:', e.message); }
  };
  const schedulePrintingReset = async () => {
    try {
      const { enqueue: enq } = require('./lib/jobs');
      const pending = await prisma.job.count({ where: { type: 'printing-reset', status: 'pending' } }).catch(() => 1);
      if (!pending) await enq('printing-reset', {}).catch(() => {});
    } catch (e) { console.error('[phase34] printing-reset enqueue failed:', e.message); }
  };
  scheduleFacilityJobs();
  scheduleShiftReminders();
  setInterval(scheduleFacilityJobs, 24 * 60 * 60 * 1000).unref();
  setInterval(scheduleShiftReminders, 30 * 60 * 1000).unref();
  setInterval(schedulePrintingReset, 6 * 60 * 60 * 1000).unref();
} catch (e) { console.error('[phase34] scheduler init failed:', e.message); }

// Public tenant branding (for login page) — lookup by slug, no auth
app.get('/api/branding/:slug', async (req, res, next) => {
  try {
    const prisma = require('./lib/prisma');
    const tenant = await prisma.tenant.findUnique({
      where: { slug: req.params.slug },
      select: { name: true, tagline: true, primaryColor: true, logoPath: true },
    });
    if (!tenant) return res.status(404).json({ error: 'Not found' });
    res.json({ branding: { name: tenant.name, tagline: tenant.tagline, primaryColor: tenant.primaryColor, hasLogo: !!tenant.logoPath } });
  } catch (e) { next(e); }
});

app.get('/api/branding/:slug/logo', async (req, res, next) => {
  try {
    const prisma = require('./lib/prisma');
    const { readStream, fileExists } = require('./lib/storage');
    const tenant = await prisma.tenant.findUnique({
      where: { slug: req.params.slug },
      select: { logoPath: true },
    });
    if (!tenant?.logoPath || !fileExists(tenant.logoPath)) return res.status(404).json({ error: 'No logo' });
    const ext = tenant.logoPath.split('.').pop().toLowerCase();
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' }[ext] || 'image/png';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    readStream(tenant.logoPath).pipe(res);
  } catch (e) { next(e); }
});

// 404 for unknown API paths
app.use((req, res) => {
  res.status(404).json({ error: { message: 'Not found' } });
});

// Central error handler: zod is handled by validateBody upstream; here we
// normalize everything else. Stack traces only leak in non-production.
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  const body = { error: { message: err.message || 'Internal server error' } };
  if (process.env.NODE_ENV !== 'production' && err.stack) {
    body.error.stack = err.stack;
  }
  res.status(status).json(body);
});

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`coworking-saas API ready on http://localhost:${PORT}`);
  // Phase 28: start DB-backed job queue worker (once per process)
  try { require('./lib/jobs').startWorker(); } catch (e) { console.error('[jobs] failed to start worker:', e.message); }
});
