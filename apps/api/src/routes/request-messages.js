// Phase 55 Track 4/10: Request Chat/Thread — concierge service requests par member<->staff chat.
// Coordinator ke liye:
//   Mount: app.use('/api/request-messages', require('./routes/request-messages'));
//   Sidebar link nahi — requests detail page extend hai.
//   Schema merge: fragments/request-messages.prisma + ServiceRequest { messages RequestMessage[] }
//     (ServiceRequest model Track 2 service-requests.prisma se aata hai — PEHLE merge karein.)
//   Request detail integration (Track 2: service-requests page):
//     Chat panel request detail me joro — GET /api/request-messages/:requestId se thread,
//     POST /api/request-messages/:requestId { message } se bhejein. Polling (10s) ya send ke baad refetch.
// Endpoints (sab me tenantFilter lazmi):
//   GET  /:requestId        — thread (member: sirf apni request; staff: tenant ki koi bhi)
//   POST /:requestId        — message bhejo; doosri taraf ko in-app notify
//   DELETE /:id            — staff: message delete
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
const STAFF = ['ceo', 'admin', 'super_admin', 'manager', 'receptionist', 'operations_manager'];

function M(res) {
  if (!prisma.requestMessage) {
    res.status(503).json({ error: 'Request chat module abhi migrate nahi hua.' });
    return null;
  }
  return prisma.requestMessage;
}

function SR(res) {
  if (!prisma.serviceRequest) {
    res.status(503).json({ error: 'Service requests module abhi migrate nahi hua.' });
    return null;
  }
  return prisma.serviceRequest;
}

// Request verify: member sirf apni request, staff koi bhi tenant request
async function loadRequest(req, res, requestId) {
  const S = SR(res); if (!S) return null;
  const tf = tenantFilter(req);
  const where = { ...tf, id: requestId };
  if (!STAFF.includes(req.user.role) && req.user.memberId) {
    where.memberId = req.user.memberId;
  }
  const sr = await S.findFirst({
    where,
    include: {
      member: { include: { user: { select: { id: true } } } },
      assignee: { select: { id: true, name: true } },
    },
  });
  if (!sr) { res.status(404).json({ error: 'Request nahi mili.' }); return null; }
  return sr;
}

const msgSchema = z.object({
  message: z.string().min(1).max(4000),
});

const senderSelect = { id: true, name: true, role: true };

router.use(authenticate, requireTenantUser);

// ---------- Thread ----------
router.get('/:requestId', async (req, res, next) => {
  try {
    const RM = M(res); if (!RM) return;
    const sr = await loadRequest(req, res, req.params.requestId);
    if (!sr) return;
    const msgs = await RM.findMany({
      where: { ...tenantFilter(req), requestId: sr.id },
      orderBy: { createdAt: 'asc' },
      include: { sender: { select: senderSelect } },
    });
    res.json({ requestId: sr.id, messages: msgs });
  } catch (e) { next(e); }
});

// ---------- Message bhejo ----------
router.post('/:requestId', async (req, res, next) => {
  try {
    const RM = M(res); if (!RM) return;
    const sr = await loadRequest(req, res, req.params.requestId);
    if (!sr) return;
    const { message } = msgSchema.parse(req.body);
    const tf = tenantFilter(req);
    const created = await RM.create({
      data: { ...tf, requestId: sr.id, senderId: req.user.id, message },
      include: { sender: { select: senderSelect } },
    });

    // Notify doosri taraf: member ne bheja -> assignee + staff; staff ne bheja -> member
    const isStaffSender = STAFF.includes(req.user.role);
    try {
      if (isStaffSender) {
        const memberUserId = sr.member?.user?.id;
        if (memberUserId && memberUserId !== req.user.id) {
          await prisma.notification.create({
            data: {
              tenantId: tf.tenantId, userId: memberUserId, type: 'general',
              message: `Concierge: "${sr.title}" par staff ka jawab — "${message.slice(0, 120)}"`,
            },
          });
        }
      } else {
        if (sr.assignee?.id && sr.assignee.id !== req.user.id) {
          await prisma.notification.create({
            data: {
              tenantId: tf.tenantId, userId: sr.assignee.id, type: 'task_assigned',
              message: `Concierge: "${sr.title}" par member ka naya message — "${message.slice(0, 120)}"`,
            },
          });
        }
        // Assignee na ho to sab staff ko role notification
        if (!sr.assignee) {
          await prisma.notification.create({
            data: {
              tenantId: tf.tenantId, role: 'receptionist', type: 'task_assigned',
              message: `Concierge: "${sr.title}" (nayi request) par member ka message — "${message.slice(0, 120)}"`,
            },
          });
        }
      }
    } catch { /* notify fail hua to message bacha rehta hai */ }

    await writeAudit({
      tenantId: tf.tenantId, actorId: req.user.id,
      action: 'concierge.message_sent', entity: 'RequestMessage', entityId: created.id,
    });
    res.status(201).json({ message: created });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(422).json({ error: 'Ghalat input.', details: e.errors });
    next(e);
  }
});

// ---------- Staff: message delete ----------
router.delete('/:id', requireRole(...STAFF), async (req, res, next) => {
  try {
    const RM = M(res); if (!RM) return;
    const tf = tenantFilter(req);
    const msg = await RM.findFirst({ where: { ...tf, id: req.params.id } });
    if (!msg) return res.status(404).json({ error: 'Message nahi mila.' });
    await RM.delete({ where: { id: msg.id } });
    await writeAudit({
      tenantId: tf.tenantId, actorId: req.user.id,
      action: 'concierge.message_deleted', entity: 'RequestMessage', entityId: msg.id,
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
