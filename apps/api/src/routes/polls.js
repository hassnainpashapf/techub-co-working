// Phase 40 Track 4: Community Polls — member voting + staff management.
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

const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];
const staffOnly = requireRole(...STAFF);

const STATUSES = ['draft', 'open', 'closed'];

function missingSchema(req, res, next) {
  if (typeof prisma.poll === 'undefined') {
    return res.status(503).json({ error: { message: 'Polls schema not merged yet. Deploy pending.' } });
  }
  next();
}

// Resolve the member record for the logged-in user.
async function myMember(req) {
  const tf = tenantFilter(req);
  if (req.user.memberId) {
    const m = await prisma.member.findFirst({ where: { id: req.user.memberId, ...tf } });
    if (m) return m;
  }
  if (req.user.email) {
    const m = await prisma.member.findFirst({ where: { email: req.user.email, ...tf } });
    if (m) return m;
  }
  return null;
}

function normOptions(options) {
  if (!Array.isArray(options)) return [];
  return options
    .map((o, i) => ({
      id: String((o && o.id) || `o${i + 1}`),
      text: String((o && o.text) || '').trim(),
    }))
    .filter((o) => o.text.length > 0)
    .slice(0, 10);
}

// Auto-close polls whose closesAt has passed.
async function touchPoll(poll) {
  if (poll.status === 'open' && poll.closesAt && new Date(poll.closesAt) < new Date()) {
    return prisma.poll.update({ where: { id: poll.id }, data: { status: 'closed' } });
  }
  return poll;
}

function tallyResults(poll, votes) {
  const options = Array.isArray(poll.options) ? poll.options : [];
  const counts = Object.fromEntries(options.map((o) => [o.id, 0]));
  for (const v of votes) {
    if (counts[v.optionId] === undefined) counts[v.optionId] = 0;
    counts[v.optionId] += 1;
  }
  const total = votes.length;
  const breakdown = options.map((o) => ({
    optionId: o.id,
    text: o.text,
    votes: counts[o.id] || 0,
    // Percentages only revealed after close (while open, counts only).
    ...(poll.status === 'closed' ? { percent: total > 0 ? Math.round(((counts[o.id] || 0) / total) * 1000) / 10 : 0 } : {}),
  }));
  return { totalVotes: total, breakdown };
}

function decorate(poll, memberId, votes) {
  const mine = memberId ? votes.find((v) => v.memberId === memberId) : null;
  return {
    id: poll.id,
    question: poll.question,
    options: poll.options,
    status: poll.status,
    closesAt: poll.closesAt,
    createdAt: poll.createdAt,
    totalVotes: votes.length,
    myVote: mine ? { optionId: mine.optionId, votedAt: mine.votedAt } : null,
  };
}

// GET /api/polls — visible polls (staff: all, members: open + recently closed)
router.get('/', missingSchema, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const isStaff = STAFF.includes(req.user.role);
    const member = await myMember(req);
    const polls = await prisma.poll.findMany({
      where: { ...tf, ...(isStaff ? {} : { status: { in: ['open', 'closed'] } }) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const out = [];
    for (let p of polls) {
      p = await touchPoll(p);
      const votes = await prisma.pollVote.findMany({ where: { pollId: p.id, ...tf } });
      out.push({ ...decorate(p, member ? member.id : null, votes), ...(isStaff ? {} : tallyResults(p, votes)) });
    }
    res.json({ polls: out });
  } catch (e) { next(e); }
});

// GET /api/polls/:id/results — bar breakdown (percentages only when closed)
router.get('/:id/results', missingSchema, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    let poll = await prisma.poll.findFirst({ where: { id: req.params.id, ...tf } });
    if (!poll) return res.status(404).json({ error: { message: 'Poll not found.' } });
    poll = await touchPoll(poll);
    const votes = await prisma.pollVote.findMany({ where: { pollId: poll.id, ...tf } });
    res.json({ pollId: poll.id, question: poll.question, status: poll.status, ...tallyResults(poll, votes) });
  } catch (e) { next(e); }
});

const optionSchema = z.object({ id: z.string().max(20).optional(), text: z.string().min(1).max(200) });
const createSchema = z.object({
  question: z.string().min(3).max(500),
  options: z.array(optionSchema).min(2).max(10),
  closesAt: z.string().datetime().optional().nullable(),
  openNow: z.boolean().optional().default(false),
});

// POST /api/polls — staff creates a poll (draft by default)
router.post('/', missingSchema, staffOnly, validateBody(createSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const options = normOptions(req.body.options);
    if (options.length < 2) return res.status(400).json({ error: { message: 'At least 2 options are required.' } });
    const poll = await prisma.poll.create({
      data: {
        tenantId: tf.tenantId,
        question: req.body.question.trim(),
        options,
        status: req.body.openNow ? 'open' : 'draft',
        closesAt: req.body.closesAt ? new Date(req.body.closesAt) : null,
        createdBy: req.user.sub,
      },
    });
    writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'poll.create', entity: 'poll', entityId: poll.id });
    res.status(201).json({ poll });
  } catch (e) { next(e); }
});

// POST /api/polls/:id/open — staff opens a draft poll
router.post('/:id/open', missingSchema, staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const poll = await prisma.poll.findFirst({ where: { id: req.params.id, ...tf } });
    if (!poll) return res.status(404).json({ error: { message: 'Poll not found.' } });
    if (poll.status === 'closed') return res.status(400).json({ error: { message: 'Closed polls cannot be reopened.' } });
    const updated = await prisma.poll.update({ where: { id: poll.id }, data: { status: 'open' } });
    writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'poll.open', entity: 'poll', entityId: poll.id });
    res.json({ poll: updated });
  } catch (e) { next(e); }
});

// POST /api/polls/:id/close — staff closes an open poll
router.post('/:id/close', missingSchema, staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const poll = await prisma.poll.findFirst({ where: { id: req.params.id, ...tf } });
    if (!poll) return res.status(404).json({ error: { message: 'Poll not found.' } });
    const updated = await prisma.poll.update({ where: { id: poll.id }, data: { status: 'closed' } });
    writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'poll.close', entity: 'poll', entityId: poll.id });
    res.json({ poll: updated });
  } catch (e) { next(e); }
});

// DELETE /api/polls/:id — staff deletes a poll (votes cascade)
router.delete('/:id', missingSchema, staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const poll = await prisma.poll.findFirst({ where: { id: req.params.id, ...tf } });
    if (!poll) return res.status(404).json({ error: { message: 'Poll not found.' } });
    await prisma.poll.delete({ where: { id: poll.id } });
    writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'poll.delete', entity: 'poll', entityId: poll.id });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

const voteSchema = z.object({ optionId: z.string().min(1).max(20) });

// POST /api/polls/:id/vote — member votes (one vote per poll; re-voting changes the option)
router.post('/:id/vote', missingSchema, validateBody(voteSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member) return res.status(404).json({ error: { message: 'Member record not found.' } });
    let poll = await prisma.poll.findFirst({ where: { id: req.params.id, ...tf } });
    if (!poll) return res.status(404).json({ error: { message: 'Poll not found.' } });
    poll = await touchPoll(poll);
    if (poll.status !== 'open') return res.status(400).json({ error: { message: 'This poll is not open for voting.' } });
    const options = Array.isArray(poll.options) ? poll.options : [];
    if (!options.some((o) => o.id === req.body.optionId)) {
      return res.status(400).json({ error: { message: 'Invalid option.' } });
    }
    const vote = await prisma.pollVote.upsert({
      where: { pollId_memberId: { pollId: poll.id, memberId: member.id } },
      update: { optionId: req.body.optionId, votedAt: new Date() },
      create: { tenantId: tf.tenantId, pollId: poll.id, memberId: member.id, optionId: req.body.optionId },
    });
    const votes = await prisma.pollVote.findMany({ where: { pollId: poll.id, ...tf } });
    res.json({ vote: { optionId: vote.optionId }, ...decorate(poll, member.id, votes) });
  } catch (e) { next(e); }
});

module.exports = router;
