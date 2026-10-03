// Phase 35 Track 9: Tenant onboarding wizard (super_admin).
// One-call tenant provisioning: tenant + admin user (temp password) +
// default building + trial SaaS subscription + welcome email.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { hashPassword, comparePassword } = require('../lib/auth');
const { validatePassword } = require('../lib/password');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { writeAudit } = require('../middleware/audit');
const { notify } = require('../lib/mailer');
const {
  generateTempPassword,
  flagPasswordChange,
  clearPasswordChange,
} = require('../lib/onboarding');

const router = express.Router();

const WEB_URL = process.env.WEB_URL || 'https://techub-co-working.pages.dev';
const TRIAL_DAYS = 14;

const createTenantSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/, 'Slug me sirf a-z, 0-9 aur - allowed hai'),
  adminName: z.string().min(1).max(120),
  adminEmail: z.string().email(),
  plan: z.enum(['starter', 'growth', 'enterprise']).default('starter'),
});

const seedDemoSchema = z.object({
  tenantId: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

// POST /onboarding/create-tenant — super_admin only.
// Creates tenant + admin user (one-time temp password) + default building +
// trial subscription, flags forced password change, sends welcome email.
router.post(
  '/create-tenant',
  authenticate,
  requireRole('super_admin'),
  validateBody(createTenantSchema),
  async (req, res, next) => {
    try {
      const { name, slug, adminName, adminEmail, plan } = req.body;
      const email = String(adminEmail).toLowerCase().trim();

      const [slugTaken, emailTaken, platformPlan] = await Promise.all([
        prisma.tenant.findUnique({ where: { slug } }),
        prisma.user.findUnique({ where: { email } }),
        prisma.platformPlan.findUnique({ where: { slug: plan } }),
      ]);
      if (slugTaken) {
        return res.status(409).json({ error: { message: 'Ye slug pehle se istemal me hai.' } });
      }
      if (emailTaken) {
        return res.status(409).json({ error: { message: 'Ye admin email pehle se istemal me hai.' } });
      }
      if (!platformPlan) {
        return res.status(400).json({ error: { message: 'Ghalat plan muntakhib kiya.' } });
      }

      const tempPassword = generateTempPassword();
      const passwordHash = await hashPassword(tempPassword);
      const now = new Date();
      const trialEnds = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

      const result = await prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({ data: { name, slug, plan } });
        const admin = await tx.user.create({
          data: {
            tenantId: tenant.id,
            name: adminName,
            email,
            passwordHash,
            role: 'admin',
            isActive: true,
          },
        });
        const building = await tx.building.create({
          data: { tenantId: tenant.id, name: 'Main Building', isActive: true },
        });
        const subscription = await tx.tenantSubscription.create({
          data: {
            tenantId: tenant.id,
            planId: platformPlan.id,
            status: 'trialing',
            trialEndsAt: trialEnds,
            currentPeriodStart: now,
            currentPeriodEnd: trialEnds,
          },
        });
        return { tenant, admin, building, subscription };
      });

      // Force password change on first login (Setting flag — no migration).
      await flagPasswordChange(result.tenant.id, result.admin.id);

      // Welcome email with the one-time temp password (fire-and-forget).
      notify(result.tenant.id, email, 'tenantWelcome', {
        adminName,
        tenantName: name,
        loginUrl: WEB_URL,
        email,
        tempPassword,
      }).catch(() => {});

      await writeAudit({
        tenantId: null,
        actorId: req.user.id,
        action: 'tenant.onboarded',
        entity: 'Tenant',
        entityId: result.tenant.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return res.status(201).json({
        tenant: { id: result.tenant.id, name: result.tenant.name, slug: result.tenant.slug, plan },
        admin: { id: result.admin.id, name: result.admin.name, email: result.admin.email },
        building: { id: result.building.id, name: result.building.name },
        subscription: {
          plan: platformPlan.name,
          status: 'trialing',
          trialEndsAt: result.subscription.trialEndsAt,
        },
        // ONE-TIME: show in the wizard success screen, never stored/returned again.
        tempPassword,
      });
    } catch (err) {
      if (err && err.code === 'P2002') {
        return res.status(409).json({ error: { message: 'Slug ya email pehle se istemal me hai.' } });
      }
      return next(err);
    }
  }
);

// POST /onboarding/seed-demo — super_admin only.
// Seeds a small demo dataset (units + members) for a fresh tenant.
router.post(
  '/seed-demo',
  authenticate,
  requireRole('super_admin'),
  validateBody(seedDemoSchema),
  async (req, res, next) => {
    try {
      const { tenantId } = req.body;
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) {
        return res.status(404).json({ error: { message: 'Tenant nahi mila.' } });
      }
      const existingUnits = await prisma.unit.count({ where: { tenantId } });
      if (existingUnits > 0) {
        return res
          .status(409)
          .json({ error: { message: 'Is tenant me pehle se data hai — dobara seed nahi hoga.' } });
      }

      let building = await prisma.building.findFirst({ where: { tenantId } });
      if (!building) {
        building = await prisma.building.create({
          data: { tenantId, name: 'Main Building', isActive: true },
        });
      }
      const floor = await prisma.floor.create({
        data: { tenantId, buildingId: building.id, name: 'Ground Floor', level: 0 },
      });
      const zone = await prisma.zone.create({
        data: { tenantId, floorId: floor.id, name: 'Zone A' },
      });

      const unitDefs = [
        { code: 'HD-01', type: 'hot_desk', price: 8000, capacity: 1 },
        { code: 'HD-02', type: 'hot_desk', price: 8000, capacity: 1 },
        { code: 'DD-01', type: 'dedicated_desk', price: 15000, capacity: 1 },
        { code: 'CB-01', type: 'cabin', price: 35000, capacity: 4 },
        { code: 'MR-01', type: 'meeting_room', price: 2000, capacity: 8 },
        { code: 'PB-01', type: 'phone_booth', price: 1000, capacity: 1 },
      ];
      for (const u of unitDefs) {
        await prisma.unit.create({
          data: {
            tenantId,
            zoneId: zone.id,
            code: u.code,
            type: u.type,
            status: 'vacant',
            monthlyPrice: u.price,
            capacity: u.capacity,
          },
        });
      }

      const memberDefs = [
        { name: 'Demo Member 1', phone: '03000000001' },
        { name: 'Demo Member 2', phone: '03000000002' },
        { name: 'Demo Member 3', phone: '03000000003' },
        { name: 'Demo Member 4', phone: '03000000004' },
        { name: 'Demo Member 5', phone: '03000000005' },
      ];
      for (const m of memberDefs) {
        await prisma.member.create({
          data: {
            tenantId,
            name: m.name,
            email: `${m.name.toLowerCase().replace(/\s+/g, '')}@${tenant.slug}.example.com`,
            phone: m.phone,
            status: 'active',
          },
        });
      }

      await writeAudit({
        tenantId: null,
        actorId: req.user.id,
        action: 'tenant.demo_seeded',
        entity: 'Tenant',
        entityId: tenant.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return res.status(201).json({
        seeded: true,
        units: unitDefs.length,
        members: memberDefs.length,
        building: building.name,
      });
    } catch (err) {
      return next(err);
    }
  }
);

// POST /onboarding/change-password — any authenticated user.
// Verifies current password, enforces policy, clears the force-change flag.
router.post(
  '/change-password',
  authenticate,
  validateBody(changePasswordSchema),
  async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!user || !user.isActive) {
        return res.status(404).json({ error: { message: 'User nahi mila.' } });
      }
      const ok = await comparePassword(currentPassword, user.passwordHash);
      if (!ok) {
        return res.status(401).json({ error: { message: 'Maujooda password ghalat hai.' } });
      }
      const check = validatePassword(newPassword);
      if (!check.valid) {
        return res.status(400).json({ error: { message: check.errors.join(' ') } });
      }
      const sameAsOld = await comparePassword(newPassword, user.passwordHash);
      if (sameAsOld) {
        return res.status(400).json({ error: { message: 'Naya password purane jaisa nahi ho sakta.' } });
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(newPassword) },
      });
      await clearPasswordChange(user.tenantId, user.id);
      await writeAudit({
        tenantId: user.tenantId,
        actorId: user.id,
        action: 'auth.password_changed',
        entity: 'User',
        entityId: user.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return res.json({ ok: true });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
