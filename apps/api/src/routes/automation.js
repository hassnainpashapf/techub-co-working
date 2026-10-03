// Phase 38 Track 6: Task Automation Rules — CRUD + test-run API.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { TRIGGERS, evaluateAutomation, previewActions } = require('../lib/automationEngine');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const ADMIN_ROLES = ['ceo', 'admin', 'super_admin'];
const adminWrite = requireRole(...ADMIN_ROLES);

const actionSchema = z.object({
  type: z.enum(['create_task', 'send_email', 'notify_slack', 'assign_ticket']),
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  assigneeId: z.string().optional(),
  createdById: z.string().optional(),
  dueInDays: z.number().int().min(0).max(365).optional(),
  to: z.string().max(200).optional(), // member | staff | <email>
  subject: z.string().max(200).optional(),
  body: z.string().max(10000).optional(),
  text: z.string().max(2000).optional(),
});

const ruleSchema = z.object({
  name: z.string().min(1).max(100),
  trigger: z.enum(TRIGGERS),
  conditions: z.record(z.string(), z.any()).optional().default({}),
  actions: z.array(actionSchema).min(1).max(10),
  isActive: z.boolean().optional().default(true),
});

function missingSchema(req, res, next) {
  if (typeof prisma.automationRule === 'undefined') {
    return res.status(503).json({ error: { message: 'Automation schema not merged yet. Deploy pending.' } });
  }
  next();
}

// List rules
router.get('/', missingSchema, async (req, res, next) => {
  try {
    const rules = await prisma.automationRule.findMany({
      where: { ...tenantFilter(req) },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ rules, triggers: TRIGGERS });
  } catch (e) { next(e); }
});

// Create rule
router.post('/', adminWrite, missingSchema, validateBody(ruleSchema), async (req, res, next) => {
  try {
    const rule = await prisma.automationRule.create({
      data: { ...req.body, tenantId: req.user.tenantId },
    });
    await writeAudit({
      tenantId: req.user.tenantId, actorId: req.user.sub, action: 'automation_rule.create',
      entity: 'AutomationRule', entityId: rule.id, newValue: { name: rule.name, trigger: rule.trigger },
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    res.status(201).json({ rule });
  } catch (e) { next(e); }
});

// Update rule
router.patch('/:id', adminWrite, missingSchema, validateBody(ruleSchema.partial()), async (req, res, next) => {
  try {
    const existing = await prisma.automationRule.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!existing) return res.status(404).json({ error: { message: 'Rule not found' } });
    const rule = await prisma.automationRule.update({ where: { id: existing.id }, data: req.body });
    await writeAudit({
      tenantId: req.user.tenantId, actorId: req.user.sub, action: 'automation_rule.update',
      entity: 'AutomationRule', entityId: rule.id,
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    res.json({ rule });
  } catch (e) { next(e); }
});

// Delete rule
router.delete('/:id', adminWrite, missingSchema, async (req, res, next) => {
  try {
    const existing = await prisma.automationRule.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!existing) return res.status(404).json({ error: { message: 'Rule not found' } });
    await prisma.automationRule.delete({ where: { id: existing.id } });
    await writeAudit({
      tenantId: req.user.tenantId, actorId: req.user.sub, action: 'automation_rule.delete',
      entity: 'AutomationRule', entityId: existing.id,
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Dry-run: preview what a rule would do with sample context (executes nothing)
router.post('/:id/test', adminWrite, missingSchema, async (req, res, next) => {
  try {
    const rule = await prisma.automationRule.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!rule) return res.status(404).json({ error: { message: 'Rule not found' } });
    const sampleCtx = {
      memberName: 'Sample Member', memberEmail: 'member@example.com', memberPhone: '0300-1234567',
      invoiceNumber: 'INV-0001', amount: 15000, balance: 15000, daysOverdue: 10,
      ticketNumber: 'T-101', title: 'AC not working', category: 'maintenance', priority: 'urgent',
      unitCode: 'MR-01', unitType: 'meeting_room', daysLeft: 30, daysInactive: 20,
      ...(req.body?.context || {}),
    };
    const matched = require('../lib/automationEngine').conditionsMatch(rule.trigger, rule.conditions, sampleCtx);
    const result = await evaluateAutomation(req.user.tenantId, rule.trigger, sampleCtx, { dryRun: true });
    const fired = result.results.find((r) => r.ruleId === rule.id);
    res.json({
      rule: { id: rule.id, name: rule.name, trigger: rule.trigger },
      conditionsMatched: matched,
      actions: fired ? previewActions(rule, sampleCtx) : [],
      note: 'Dry run — kuch execute nahi hua.',
    });
  } catch (e) { next(e); }
});

// Recent runs (last 20)
router.get('/runs', missingSchema, async (req, res, next) => {
  try {
    const runs = await prisma.automationRun.findMany({
      where: { ...tenantFilter(req) },
      include: { rule: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    res.json({ runs });
  } catch (e) { next(e); }
});

// Manually trigger the member-inactive scan (admin only)
router.post('/scan-inactive', adminWrite, missingSchema, async (req, res, next) => {
  try {
    const { scanInactiveMembers } = require('../lib/automationEngine');
    await scanInactiveMembers();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
