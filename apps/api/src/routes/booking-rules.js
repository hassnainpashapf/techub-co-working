// Booking rules settings — per-tenant booking policy configuration.
// Mount: app.use('/api/booking-rules', require('./routes/booking-rules'));
// Roles: ceo / admin / super_admin.

const express = require('express');
const { z } = require('zod');

const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const {
  DEFAULTS,
  LIMITS,
  getBookingRuleSettings,
  setBookingRuleSettings,
} = require('../lib/bookingRules');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin'));

const rulesSchema = z.object({
  bookingBufferMinutes: z.number().min(LIMITS.bookingBufferMinutes.min).max(LIMITS.bookingBufferMinutes.max).optional(),
  bookingMaxHours: z.number().min(LIMITS.bookingMaxHours.min).max(LIMITS.bookingMaxHours.max).optional(),
  bookingAdvanceDays: z.number().min(LIMITS.bookingAdvanceDays.min).max(LIMITS.bookingAdvanceDays.max).optional(),
  bookingMinNoticeMinutes: z.number().min(LIMITS.bookingMinNoticeMinutes.min).max(LIMITS.bookingMinNoticeMinutes.max).optional(),
});

// Public-for-staff read of current rules (used by the booking modal hint).
router.get('/', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const settings = await getBookingRuleSettings(tf.tenantId);
    return res.json({ settings, defaults: DEFAULTS, limits: LIMITS });
  } catch (err) {
    return next(err);
  }
});

router.put('/', validateBody(rulesSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const updated = await setBookingRuleSettings(tf.tenantId, req.body);
    writeAudit({
      tenantId: tf.tenantId,
      actorId: req.user.sub,
      action: 'booking_rules.update',
      entity: 'Setting',
      newValue: updated,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    const settings = await getBookingRuleSettings(tf.tenantId);
    return res.json({ settings });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
