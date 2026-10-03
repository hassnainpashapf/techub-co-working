// Phase 40 Track 9: Member Introductions — staff API.
// Mount: /api/intros (coordinator server.js me — additive).
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { introsEnabled, matchIntroductions } = require('../lib/introMatcher');
const { sendEmail } = require('../lib/mailer');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];
router.use(requireRole(...STAFF));

function guard503(req, res, next) {
  if (!introsEnabled()) return res.status(503).json({ error: 'Intros schema pending migration' });
  next();
}
router.use(guard503);

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'MemberIntro', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

function withMembers(intro) {
  return intro;
}

// GET /api/intros/pending — suggested intros (staff inbox)
router.get('/pending', async (req, res) => {
  const tf = tenantFilter(req);
  const rows = await prisma.memberIntro.findMany({
    where: { ...tf, status: 'suggested' },
    include: {
      newMember: { select: { id: true, name: true, email: true, companyName: true, directoryTags: true } },
      suggestedMember: { select: { id: true, name: true, email: true, companyName: true, directoryTags: true } },
    },
    orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });
  res.json(rows.map(withMembers));
});

// GET /api/intros — sab (status filter optional)
router.get('/', async (req, res) => {
  const tf = tenantFilter(req);
  const where = { ...tf };
  if (req.query.status) where.status = String(req.query.status);
  const rows = await prisma.memberIntro.findMany({
    where,
    include: {
      newMember: { select: { id: true, name: true, email: true, companyName: true } },
      suggestedMember: { select: { id: true, name: true, email: true, companyName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json(rows);
});

// POST /api/intros/rescan/:memberId — kisi member ke liye dobara match karo
router.post('/rescan/:memberId', async (req, res) => {
  const tf = tenantFilter(req);
  const created = await matchIntroductions(tf.tenantId, req.params.memberId);
  audit(req, tf, 'intro.rescan', req.params.memberId, { created: created.length });
  res.json({ created });
});

// POST /api/intros/:id/introduce — dono ko email intro bhejo, status → introduced
router.post('/:id/introduce', async (req, res) => {
  const tf = tenantFilter(req);
  const intro = await prisma.memberIntro.findFirst({
    where: { id: req.params.id, ...tf },
    include: { newMember: true, suggestedMember: true },
  });
  if (!intro) return res.status(404).json({ error: 'Not found' });
  if (intro.status !== 'suggested') return res.status(400).json({ error: 'Already actioned' });

  const updated = await prisma.memberIntro.update({
    where: { id: intro.id },
    data: { status: 'introduced' },
  });

  // Dono ko email — fire-and-forget, email fail ho to intro fail nahi hoti.
  const a = intro.newMember, b = intro.suggestedMember;
  const pairs = [
    { to: a.email, other: b },
    { to: b.email, other: a },
  ];
  for (const p of pairs) {
    if (!p.to) continue;
    const html = `
      <p>Hi ${esc(nameOf(a))},</p>
      <p>Aap ki profile <b>${esc(nameOf(p.other))}</b> se match hoti hai — ${esc(intro.reason)}.</p>
      <p><b>${esc(nameOf(p.other))}</b>${p.other.companyName ? ` (${esc(p.other.companyName)})` : ''} se connect karein:</p>
      <ul><li>Email: ${esc(p.other.email || '—')}</li></ul>
      <p>Happy networking! 👋</p>`;
    sendEmail(tf.tenantId, {
      to: p.to,
      subject: `Introduction: ${nameOf(a)} ↔ ${nameOf(p.other)}`,
      html,
    }).catch(() => {});
  }

  audit(req, tf, 'intro.introduce', intro.id, { status: 'introduced' });
  res.json(updated);
});

// POST /api/intros/:id/dismiss
router.post('/:id/dismiss', async (req, res) => {
  const tf = tenantFilter(req);
  const intro = await prisma.memberIntro.findFirst({ where: { id: req.params.id, ...tf } });
  if (!intro) return res.status(404).json({ error: 'Not found' });
  if (intro.status !== 'suggested') return res.status(400).json({ error: 'Already actioned' });
  const updated = await prisma.memberIntro.update({
    where: { id: intro.id },
    data: { status: 'dismissed' },
  });
  audit(req, tf, 'intro.dismiss', intro.id, { status: 'dismissed' });
  res.json(updated);
});

function nameOf(m) { return m?.name || 'Member'; }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = router;
