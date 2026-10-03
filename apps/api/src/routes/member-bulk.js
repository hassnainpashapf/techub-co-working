const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticateAny } = require('../middleware/apiKey');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { sendEmail } = require('../lib/mailer');
const { writeAudit } = require('../middleware/audit');
const auditAsync = (data) => writeAudit(data).catch(() => {});

const router = express.Router();
router.use(authenticateAny, requireTenantUser);

const BULK_ROLES = ['ceo', 'admin', 'manager', 'super_admin'];
const bulkWrite = requireRole(...BULK_ROLES);

const bulkActionSchema = z.object({
  memberIds: z.array(z.string().min(1)).min(1).max(500),
  action: z.enum(['suspend', 'activate', 'send_email', 'add_tag', 'export']),
  subject: z.string().max(200).optional(),
  body: z.string().max(5000).optional(),
  tag: z.string().min(1).max(40).regex(/^[a-zA-Z0-9 _-]+$/).optional(),
});

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function addTagToNotes(notes, tag) {
  const marker = `[tag:${tag}]`;
  const current = notes || '';
  if (current.includes(marker)) return current; // already tagged
  return current ? `${current}\n${marker}` : marker;
}

router.post('/', bulkWrite, validateBody(bulkActionSchema), async (req, res, next) => {
  try {
    const { memberIds, action, subject, body, tag } = req.body;
    const where = { id: { in: memberIds }, ...tenantFilter(req) };
    const done = [];
    const failed = [];

    if (action === 'suspend' || action === 'activate') {
      const status = action === 'suspend' ? 'on_hold' : 'active';
      const result = await prisma.member.updateMany({ where, data: { status } });
      done.push({ count: result.count });
    } else if (action === 'send_email') {
      if (!subject || !body) return res.status(400).json({ error: 'subject and body required' });
      const members = await prisma.member.findMany({ where, select: { id: true, name: true, email: true } });
      const BATCH = 25;
      for (let i = 0; i < members.length; i += BATCH) {
        const batch = members.slice(i, i + BATCH);
        const results = await Promise.allSettled(batch.map((m) => {
          if (!m.email) return Promise.reject(new Error('no email'));
          const html = `<p>Hi ${m.name},</p><p>${String(body).replace(/\n/g, '<br>')}</p>`;
          return sendEmail(req.user.tenantId, { to: m.email, subject, html });
        }));
        results.forEach((r, j) => {
          if (r.status === 'fulfilled') done.push({ id: batch[j].id });
          else failed.push({ id: batch[j].id, reason: r.reason?.message || 'send failed' });
        });
      }
    } else if (action === 'add_tag') {
      if (!tag) return res.status(400).json({ error: 'tag required' });
      const members = await prisma.member.findMany({ where, select: { id: true, notes: true } });
      const BATCH = 50;
      for (let i = 0; i < members.length; i += BATCH) {
        const batch = members.slice(i, i + BATCH);
        const results = await Promise.allSettled(batch.map((m) =>
          prisma.member.update({ where: { id: m.id }, data: { notes: addTagToNotes(m.notes, tag) } })
        ));
        results.forEach((r, j) => {
          if (r.status === 'fulfilled') done.push({ id: batch[j].id });
          else failed.push({ id: batch[j].id, reason: 'update failed' });
        });
      }
    } else if (action === 'export') {
      const members = await prisma.member.findMany({
        where,
        select: { id: true, name: true, email: true, phone: true, companyName: true, status: true, createdAt: true },
        orderBy: { name: 'asc' },
      });
      const header = ['id', 'name', 'email', 'phone', 'company', 'status', 'created_at'];
      const lines = [header.join(',')];
      for (const m of members) {
        lines.push([m.id, m.name, m.email || '', m.phone, m.companyName || '', m.status, m.createdAt ? m.createdAt.toISOString() : ''].map(csvCell).join(','));
      }
      auditAsync({ tenantId: req.user.tenantId, actorId: req.user.sub, action: 'member.bulk_export', entity: 'Member', newValue: { count: members.length }, ip: req.ip, userAgent: req.headers['user-agent'] });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="members-export-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send('\ufeff' + lines.join('\n'));
    }

    auditAsync({
      tenantId: req.user.tenantId,
      actorId: req.user.sub,
      action: `member.bulk_${action}`,
      entity: 'Member',
      newValue: { requested: memberIds.length, done: done.length, failed: failed.length, tag: tag || undefined },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.json({ done: done.length, failed });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
