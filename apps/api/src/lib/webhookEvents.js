// Central webhook event catalog — the single source of truth for every event
// CoworkOS can emit. Each entry: { name, description, samplePayload }.
//
// lib/webhooks.js derives WEBHOOK_EVENTS from this catalog and only delivers
// events listed here. routes/webhooks.js exposes the catalog at GET /events
// and the test console (POST /:id/test {event}) sends the sample payload.

const WEBHOOK_EVENT_CATALOG = [
  {
    name: 'member.created',
    description: 'Fired when a new member profile is created.',
    samplePayload: { id: 'mem_1a2b3c', name: 'Ali Raza', email: 'ali@example.com', companyName: 'Acme Ltd' },
  },
  {
    name: 'member.updated',
    description: 'Fired when a member profile is updated (status, plan, or details change).',
    samplePayload: { id: 'mem_1a2b3c', name: 'Ali Raza', changes: ['status'], status: 'active' },
  },
  {
    name: 'booking.created',
    description: 'Fired when a booking is created (staff dashboard or member portal).',
    samplePayload: {
      id: 'bk_9f3ka2m1', title: 'Team standup', unitCode: 'MR-01',
      startAt: '2026-10-05T09:00:00.000Z', endAt: '2026-10-05T10:00:00.000Z',
      memberId: 'mem_1a2b3c', memberName: 'Ali Raza', status: 'confirmed',
    },
  },
  {
    name: 'booking.cancelled',
    description: 'Fired when a booking is cancelled.',
    samplePayload: { id: 'bk_9f3ka2m1', title: 'Team standup', cancelledBy: 'member', reason: 'Rescheduled' },
  },
  {
    name: 'booking.confirmed',
    description: 'Fired when a pending/public booking request is approved by staff.',
    samplePayload: { id: 'bk_9f3ka2m1', title: 'Client demo', unitCode: 'MR-02', approvedBy: 'staff' },
  },
  {
    name: 'booking.checked_in',
    description: 'Fired when a member checks in to their booking (portal or reception).',
    samplePayload: { bookingId: 'bk_9f3ka2m1', memberId: 'mem_1a2b3c', checkedInAt: '2026-10-05T09:02:00.000Z' },
  },
  {
    name: 'invoice.created',
    description: 'Fired when an invoice is created (manual, recurring billing, or overage).',
    samplePayload: {
      id: 'inv_7h2kd9p4', number: 'INV-202610-0042', memberId: 'mem_1a2b3c',
      amount: '45000.00', dueDate: '2026-10-15', invoiceType: 'standard',
    },
  },
  {
    name: 'invoice.paid',
    description: 'Fired when an invoice is fully paid.',
    samplePayload: { id: 'inv_7h2kd9p4', number: 'INV-202610-0042', memberId: 'mem_1a2b3c', amount: '45000.00' },
  },
  {
    name: 'invoice.overdue',
    description: 'Fired by the dunning job when an invoice becomes overdue.',
    samplePayload: { id: 'inv_7h2kd9p4', number: 'INV-202610-0042', memberId: 'mem_1a2b3c', amount: '45000.00', daysOverdue: 5, level: 1 },
  },
  {
    name: 'payment.received',
    description: 'Fired when a payment is recorded against an invoice.',
    samplePayload: { id: 'pay_3m8xk2q7', amount: '45000.00', method: 'bank_transfer', invoiceNumber: 'INV-202610-0042' },
  },
  {
    name: 'payment.failed',
    description: 'Fired when an online gateway payment fails or expires.',
    samplePayload: { id: 'op_5t2nq8w1', gateway: 'jazzcash', amount: '45000.00', status: 'failed', reason: 'Insufficient funds' },
  },
  {
    name: 'refund.processed',
    description: 'Fired when a refund is approved and processed.',
    samplePayload: { id: 'ref_2k9md4x6', invoiceNumber: 'INV-202610-0042', amount: '15000.00', method: 'bank_transfer' },
  },
  {
    name: 'ticket.created',
    description: 'Fired when a support ticket/complaint is created.',
    samplePayload: { id: 'tkt_4j7hs2k9', title: 'AC not working', priority: 'high', memberId: 'mem_1a2b3c' },
  },
  {
    name: 'ticket.updated',
    description: 'Fired when a ticket status changes.',
    samplePayload: { id: 'tkt_4j7hs2k9', title: 'AC not working', status: 'in_progress', prevStatus: 'open' },
  },
  {
    name: 'visitor.checkin',
    description: 'Fired when a walk-in visitor checks in at reception.',
    samplePayload: { id: 'vis_8d2kf5m3', name: 'Sara Ahmed', host: 'Ali Raza', purpose: 'meeting' },
  },
  {
    name: 'visitor.invite_created',
    description: 'Fired when a member pre-registers a visitor (invite code issued).',
    samplePayload: { inviteId: 'vi_6h3kd9p2', code: 'X7K2P9', visitorName: 'Sara Ahmed', expectedAt: '2026-10-06T11:00:00.000Z' },
  },
  {
    name: 'visitor.checked_in',
    description: 'Fired when a pre-registered visitor checks in with their invite code.',
    samplePayload: { visitorId: 'vis_8d2kf5m3', inviteId: 'vi_6h3kd9p2', code: 'X7K2P9' },
  },
  {
    name: 'contract.created',
    description: 'Fired when a new membership contract is created.',
    samplePayload: { id: 'ctr_2m9xk4q8', memberId: 'mem_1a2b3c', unitId: 'unt_5h2kd9p1', startDate: '2026-10-01', endDate: '2027-09-30' },
  },
  {
    name: 'contract.expiring',
    description: 'Fired by the renewal job when a contract is about to expire.',
    samplePayload: { id: 'ctr_2m9xk4q8', memberId: 'mem_1a2b3c', endDate: '2026-11-15', daysLeft: 30 },
  },
  {
    name: 'contract.renewed',
    description: 'Fired when a contract renewal is confirmed.',
    samplePayload: { id: 'ctr_9p4md7k2', memberId: 'mem_1a2b3c', newEndDate: '2027-11-15' },
  },
  {
    name: 'mail.received',
    description: 'Fired when reception logs a letter/package for a member.',
    samplePayload: { itemId: 'mail_3k8hd2m5', memberId: 'mem_1a2b3c', type: 'package', sender: 'Daraz', trackingNumber: 'DX123456' },
  },
  {
    name: 'mail.collected',
    description: 'Fired when a member collects their mail/package.',
    samplePayload: { itemId: 'mail_3k8hd2m5', memberId: 'mem_1a2b3c', collectedBy: 'Ali Raza' },
  },
  {
    name: 'announcement.created',
    description: 'Fired when staff publish a new announcement.',
    samplePayload: { id: 'ann_7d3kf9p2', title: 'Maintenance on Sunday', audience: 'members', pinned: true },
  },
  {
    name: 'webhook.test',
    description: 'Test event sent from the webhook console — verifies URL, signing, and connectivity.',
    samplePayload: { test: true, message: 'Test event from CoworkOS', at: '2026-10-04T00:00:00.000Z' },
  },
];

const WEBHOOK_EVENTS = WEBHOOK_EVENT_CATALOG.map((e) => e.name);

function isKnownEvent(name) {
  return WEBHOOK_EVENTS.includes(name);
}

function getEventDef(name) {
  return WEBHOOK_EVENT_CATALOG.find((e) => e.name === name) || null;
}

function samplePayloadFor(name) {
  const def = getEventDef(name);
  return def ? def.samplePayload : null;
}

module.exports = {
  WEBHOOK_EVENT_CATALOG,
  WEBHOOK_EVENTS,
  isKnownEvent,
  getEventDef,
  samplePayloadFor,
};
