// Phase 38 Track 2: Member Lifecycle Automation routes.
// Mount: /api/lifecycle (server.js) — coordinator adds the mount.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { listBuiltinTemplates } = require('../lib/mailer');
const {
  TRIGGERS,
  TRIGGER_KEYS,
  processRule,
  seedDefaults,
  audienceCounts,
  schemaReady,
} = require('../lib/lifecycleEngine');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const ADMIN_ROLES = ['ceo', 'admin', 'super_admin'];
const adminWrite = requireRole(...ADMIN_ROLES);

// Human labels for the template picker dropdown.
const TEMPLATE_LABELS = {
  trialEnding: 'Trial ending',
  contractExpiring: 'Contract expiring',
  retentionOffer: 'Retention / win-back offer',
  invoiceOverdue: 'Invoice overdue reminder',
};

function prettify(key) {
  return String(key).replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

// 503 guard until the coordinator merges the lifecycle schema fragment.
router.use((req, res, next) => {
  if (!schemaReady()) {
    return res.status(503).json({ error: 'Lifecycle automation schema not merged yet. Ask the coordinator to apply the migration.' });
  }
  next();
});

const ruleSchema = z.object({
  trigger: z.enum(TRIGGER_KEYS),
  action: z.enum(['email', 'sms']).default('email'),
  templateKey: z.string().max(80).nullable().optional(),
  message: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

const rulePatchSchema = ruleSchema.partial().omit({ trigger: true });

function audit(req, action, trigger) {
  return writeAudit({
    tenantId: req.user.tenantId, actorId: req.user.sub, action,
    entity: 'LifecycleRule', newValue: { trigger },
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

// GET /rules — all 4 triggers with rule state + live audience counts
router.get('/rules', adminWrite, async (req, res, next) => {
  try {
    const tenantId = req.user.tenantId;
    const [rules, counts] = await Promise.all([
      prisma.lifecycleRule.findMany({ where: { ...tenantFilter(req) }, orderBy: { createdAt: 'asc' } }),
      audienceCounts(tenantId),
    ]);
    const byTrigger = Object.fromEntries(rules.map((r) => [r.trigger, r]));
    res.json({
      triggers: TRIGGER_KEYS.map((key) => ({
        ...TRIGGERS[key],
        rule: byTrigger[key] || null,
        audience: counts[key] || 0,
      })),
    });
  } catch (e) { next(e); }
});

// POST /rules — create/update a rule for a trigger
router.post('/rules', adminWrite, validateBody(ruleSchema), async (req, res, next) => {
  try {
    const { trigger, action, templateKey, message, isActive } = req.body;
    const rule = await prisma.lifecycleRule.upsert({
      where: { tenantId_trigger: { tenantId: req.user.tenantId, trigger } },
      update: {
        action,
        templateKey: templateKey ?? null,
        message: message ?? null,
        isActive: isActive !== undefined ? isActive : true,
      },
      create: {
        tenantId: req.user.tenantId,
        trigger,
        action,
        templateKey: templateKey ?? null,
        message: message ?? null,
        isActive: isActive !== undefined ? isActive : true,
      },
    });
    await audit(req, 'lifecycle.rule.upsert', trigger);
    res.status(201).json({ rule });
  } catch (e) { next(e); }
});

// PATCH /rules/:id — toggle / change action / template / message
router.patch('/rules/:id', adminWrite, validateBody(rulePatchSchema), async (req, res, next) => {
  try {
    const data = req.body;
    const rule = await prisma.lifecycleRule.update({
      where: { id: req.params.id },
      data: {
        ...(data.action !== undefined ? { action: data.action } : {}),
        ...(data.templateKey !== undefined ? { templateKey: data.templateKey || null } : {}),
        ...(data.message !== undefined ? { message: data.message || null } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    });
    if (rule.tenantId !== req.user.tenantId) return res.status(404).json({ error: 'Rule not found' });
    await audit(req, 'lifecycle.rule.update', rule.trigger);
    res.json({ rule });
  } catch (e) {
    if (e && e.code === 'P2025') return res.status(404).json({ error: 'Rule not found' });
    next(e);
  }
});

// DELETE /rules/:id
router.delete('/rules/:id', adminWrite, async (req, res, next) => {
  try {
    const rule = await prisma.lifecycleRule.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    await prisma.lifecycleRule.delete({ where: { id: rule.id } });
    await audit(req, 'lifecycle.rule.delete', rule.trigger);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /rules/seed-defaults — create the 4 default email rules where missing
router.post('/rules/seed-defaults', adminWrite, async (req, res, next) => {
  try {
    const created = await seedDefaults(req.user.tenantId);
    await audit(req, 'lifecycle.rules.seed', 'all');
    res.status(201).json({ created: created.length, triggers: created.map((r) => r.trigger) });
  } catch (e) { next(e); }
});

// POST /rules/:id/run — run one rule right now
router.post('/rules/:id/run', adminWrite, async (req, res, next) => {
  try {
    const rule = await prisma.lifecycleRule.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    const result = await processRule(req.user.tenantId, rule);
    await audit(req, 'lifecycle.rule.run', rule.trigger);
    res.json({ evaluated: result.evaluated, sent: result.sent, skipped: result.skipped });
  } catch (e) { next(e); }
});

// GET /templates — built-in + tenant custom templates for the picker
router.get('/templates', adminWrite, async (req, res, next) => {
  try {
    const builtin = listBuiltinTemplates().map((t) => ({
      key: t.key,
      label: TEMPLATE_LABELS[t.key] || prettify(t.key),
      variables: t.variables || [],
      builtin: true,
    }));
    let custom = [];
    try {
      custom = await prisma.emailTemplate.findMany({
        where: { ...tenantFilter(req) },
        select: { key: true, subject: true },
        orderBy: { key: 'asc' },
      });
    } catch { /* table may not exist yet */ }
    res.json({
      templates: [
        ...builtin.map((b) => ({ ...b, custom: false })),
        ...custom.map((c) => ({ key: c.key, label: `${c.key} (custom)`, builtin: false, custom: true })),
      ],
    });
  } catch (e) { next(e); }
});

// GET /runs — recent lifecycle sends
router.get('/runs', adminWrite, async (req, res, next) => {
  try {
    const runs = await prisma.lifecycleRun.findMany({
      where: { ...tenantFilter(req) },
      include: {
        member: { select: { id: true, name: true, email: true } },
        rule: { select: { trigger: true, action: true } },
      },
      orderBy: { sentAt: 'desc' },
      take: 200,
    });
    res.json({
      runs: runs.map((r) => ({
        id: r.id,
        sentAt: r.sentAt,
        trigger: r.rule?.trigger || '',
        triggerLabel: (r.rule?.trigger && TRIGGERS[r.rule.trigger]?.label) || r.rule?.trigger || '',
        channel: r.channel,
        sent: r.sent,
        error: r.error || null,
        memberName: r.member?.name || '',
        memberEmail: r.member?.email || '',
      })),
    });
  } catch (e) { next(e); }
});

module.exports = router;
