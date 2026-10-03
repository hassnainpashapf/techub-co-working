// Phase 32 Track 7: GDPR-style member data export + anonymization.
// - POST /member/:id/export    -> full member data as JSON download
//   (ceo/admin/super_admin, or the member themself). Never includes password hashes.
// - POST /member/:id/anonymize -> ceo/admin/super_admin + explicit confirm.
//   Replaces PII with placeholders; financial records (invoices/payments) are KEPT
//   for tax compliance, but they link to the anonymized member only. Linked login
//   is deactivated so the anonymized user can no longer sign in.
const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF_ROLES = ['ceo', 'admin', 'super_admin'];

async function loadMember(req, id) {
  return prisma.member.findFirst({
    where: { id, ...tenantFilter(req) },
    include: { user: { select: { id: true, email: true } } },
  });
}

function canExport(req, member) {
  if (!member) return false;
  if (STAFF_ROLES.includes(req.user.role)) return true;
  return Boolean(req.user.memberId) && req.user.memberId === member.id;
}

// ---------------------------------------------------------------------------
// Export: full member data as JSON download (password hashes never included)
// ---------------------------------------------------------------------------
router.post('/member/:id/export', async (req, res, next) => {
  try {
    const member = await loadMember(req, req.params.id);
    if (!member || !canExport(req, member)) {
      return res.status(member ? 403 : 404).json({ error: member ? 'Forbidden' : 'Member not found' });
    }
    const tf = tenantFilter(req);
    const memberId = member.id;

    const [
      profile,
      linkedUser,
      contracts,
      invoices,
      bookings,
      tickets,
      documents,
      feedback,
    ] = await Promise.all([
      prisma.member.findFirst({ where: { id: memberId, ...tf } }),
      member.user
        ? prisma.user.findFirst({
            where: { id: member.user.id, ...tf },
            select: {
              id: true, name: true, email: true, phone: true, role: true,
              isActive: true, emailVerifiedAt: true, totpEnabled: true,
              createdAt: true, updatedAt: true,
            }, // passwordHash / totpSecret / tokens are never exported
          })
        : null,
      prisma.contract.findMany({ where: { memberId, ...tf }, orderBy: { createdAt: 'desc' } }),
      prisma.invoice.findMany({
        where: { memberId, ...tf },
        include: { payments: true, creditNotes: true, refunds: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.booking.findMany({ where: { memberId, ...tf }, orderBy: { createdAt: 'desc' } }),
      prisma.ticket.findMany({
        where: { memberId, ...tf },
        include: { comments: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.document.findMany({
        where: { memberId, ...tf },
        select: { id: true, fileName: true, fileType: true, fileSize: true, category: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.feedback.findMany({ where: { memberId, ...tf }, orderBy: { createdAt: 'desc' } }),
    ]);

    // Attendance lives on the linked User row.
    const attendance = member.user
      ? await prisma.attendanceRecord.findMany({
          where: { userId: member.user.id, ...tf },
          orderBy: { date: 'desc' },
          take: 500,
        })
      : [];

    const exportData = {
      exportedAt: new Date().toISOString(),
      tenantId: tf.tenantId,
      profile,
      linkedUser,
      contracts,
      invoices,
      bookings,
      tickets,
      documents, // metadata list only (no file bytes)
      feedback,
      attendance,
    };

    writeAudit({
      tenantId: tf.tenantId,
      actorId: req.user.sub,
      action: 'member.data_export',
      entity: 'Member',
      entityId: memberId,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    }).catch(() => {});

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="member-data-${memberId}.json"`.replace(/"/g, '')
    );
    res.send(JSON.stringify(exportData, null, 2));
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Anonymize: GDPR-style right-to-erasure. PII replaced, financial records kept.
// ---------------------------------------------------------------------------
const anonymizeSchema = z.object({
  confirm: z.literal(true, { errorMap: () => ({ message: 'Explicit confirm:true is required' }) }),
});

router.post('/member/:id/anonymize', validateBody(anonymizeSchema), async (req, res, next) => {
  try {
    if (!STAFF_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const tf = tenantFilter(req);
    const member = await loadMember(req, req.params.id);
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const anonEmail = `deleted_${member.id}@example.com`;
    const oldPii = { name: member.name, email: member.email, phone: member.phone, cnic: member.cnic };

    await prisma.$transaction(async (tx) => {
      // 1. Member record: strip PII, keep the row (invoices/contracts stay valid for tax).
      await tx.member.update({
        where: { id: member.id },
        data: {
          name: 'Deleted User',
          email: anonEmail,
          phone: '0000000000',
          cnic: null,
          companyName: null,
          companyId: null,
          emergencyContact: null,
          notes: null,
          creditLimit: null,
          status: 'inactive',
        },
      });

      // 2. Linked login: anonymize + deactivate so it can never sign in again.
      if (member.user) {
        await tx.user.update({
          where: { id: member.user.id },
          data: {
            name: 'Deleted User',
            email: `deleted_user_${member.user.id}@example.com`,
            phone: null,
            passwordHash: `deleted:${crypto.randomBytes(32).toString('hex')}`,
            isActive: false,
            totpSecret: null,
            totpEnabled: false,
          },
        });
        // 3. Kill sessions + one-time tokens.
        await tx.session.deleteMany({ where: { userId: member.user.id } });
        await tx.passwordReset.deleteMany({ where: { userId: member.user.id } });
        await tx.emailVerification.deleteMany({ where: { userId: member.user.id } });
      }
    });

    writeAudit({
      tenantId: tf.tenantId,
      actorId: req.user.sub,
      action: 'member.anonymize',
      entity: 'Member',
      entityId: member.id,
      oldValue: oldPii,
      newValue: { name: 'Deleted User', email: anonEmail },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    }).catch(() => {});

    res.json({ ok: true, memberId: member.id, anonymizedEmail: anonEmail });
  } catch (e) { next(e); }
});

module.exports = router;
