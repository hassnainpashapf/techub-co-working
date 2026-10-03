// Phase 23: Companies — organizations that members belong to.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const WRITE_ROLES = ['ceo', 'admin', 'super_admin', 'manager'];
const canWrite = requireRole(...WRITE_ROLES);

const companySchema = z.object({
  name: z.string().min(1),
  industry: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

// List companies (search + isActive filter), with member counts
router.get('/', async (req, res, next) => {
  try {
    const where = { ...tenantFilter(req) };
    if (req.query.search) {
      where.OR = [
        { name: { contains: req.query.search, mode: 'insensitive' } },
        { industry: { contains: req.query.search, mode: 'insensitive' } },
      ];
    }
    if (req.query.isActive !== undefined && req.query.isActive !== '') {
      where.isActive = req.query.isActive === 'true';
    }
    const companies = await prisma.company.findMany({
      where,
      include: { _count: { select: { members: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ companies });
  } catch (e) { next(e); }
});

// Create company
router.post('/', canWrite, validateBody(companySchema), async (req, res, next) => {
  try {
    const company = await prisma.company.create({
      data: { ...req.body, tenantId: req.user.tenantId },
    });
    await writeAudit(req, 'company.create', 'Company', company.id, null, { name: company.name });
    res.status(201).json({ company });
  } catch (e) {
    if (e.code === 'P2002') {
      return res.status(409).json({ error: 'A company with this name already exists.' });
    }
    next(e);
  }
});

// Get company detail with members list
router.get('/:id', async (req, res, next) => {
  try {
    const company = await prisma.company.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: {
        members: {
          where: { status: 'active' },
          select: { id: true, name: true, phone: true, email: true, status: true },
          orderBy: { name: 'asc' },
        },
        _count: { select: { members: true } },
      },
    });
    if (!company) return res.status(404).json({ error: 'Company not found' });
    res.json({ company });
  } catch (e) { next(e); }
});

// Update company
router.patch('/:id', canWrite, validateBody(companySchema.partial()), async (req, res, next) => {
  try {
    const existing = await prisma.company.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!existing) return res.status(404).json({ error: 'Company not found' });
    const company = await prisma.company.update({
      where: { id: req.params.id },
      data: req.body,
      include: { _count: { select: { members: true } } },
    });
    // Sync companyName on linked members if name changed
    if (req.body.name && req.body.name !== existing.name) {
      await prisma.member.updateMany({
        where: { companyId: req.params.id },
        data: { companyName: req.body.name },
      });
    }
    await writeAudit(req, 'company.update', 'Company', company.id, null, { name: company.name });
    res.json({ company });
  } catch (e) {
    if (e.code === 'P2002') {
      return res.status(409).json({ error: 'A company with this name already exists.' });
    }
    next(e);
  }
});

// Delete company — unlink members (set companyId null)
router.delete('/:id', canWrite, async (req, res, next) => {
  try {
    const existing = await prisma.company.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: { _count: { select: { members: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Company not found' });
    await prisma.member.updateMany({
      where: { companyId: req.params.id },
      data: { companyId: null },
    });
    await prisma.company.delete({ where: { id: req.params.id } });
    await writeAudit(req, 'company.delete', 'Company', req.params.id, { name: existing.name, unlinkedMembers: existing._count.members }, null);
    res.json({ ok: true, unlinkedMembers: existing._count.members });
  } catch (e) { next(e); }
});

module.exports = router;
