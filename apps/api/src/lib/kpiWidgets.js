// Phase 35 Track 7: Custom KPI Dashboard — widget registry.
// Har widget ka compute(tenantId) -> { value, unit?, extra? } ya null (fail par).
// Widgets existing models par bane hain — KpiDashboard merge se independent kaam karte hain.

const prisma = require('./prisma');

const num = (v) => Number(v) || 0;

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function dayBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { start, end };
}

async function computeOccupancy(tenantId) {
  const [total, occupied] = await Promise.all([
    prisma.unit.count({ where: { tenantId } }),
    prisma.unit.count({ where: { tenantId, status: 'occupied' } }),
  ]);
  const pct = total > 0 ? Math.round((occupied / total) * 100) : 0;
  return { value: pct, unit: '%', extra: { total, occupied } };
}

async function computeRevenueMtd(tenantId) {
  const rows = await prisma.payment.findMany({
    where: { tenantId, paidAt: { gte: monthStart() } },
    select: { amount: true },
  });
  const total = rows.reduce((s, r) => s + num(r.amount), 0);
  return { value: Math.round(total), unit: 'Rs', extra: { count: rows.length } };
}

async function computeOutstandingAr(tenantId) {
  const rows = await prisma.invoice.findMany({
    where: { tenantId, status: { in: ['unpaid', 'partial', 'overdue'] } },
    select: { amount: true, amountPaid: true },
  });
  const total = rows.reduce((s, r) => s + (num(r.amount) - num(r.amountPaid)), 0);
  return { value: Math.round(total), unit: 'Rs', extra: { count: rows.length } };
}

async function computeActiveMembers(tenantId) {
  const count = await prisma.member.count({ where: { tenantId, status: 'active' } });
  return { value: count, unit: '' };
}

async function computeBookingsToday(tenantId) {
  const { start, end } = dayBounds();
  const count = await prisma.booking.count({
    where: { tenantId, status: 'confirmed', startAt: { gte: start, lte: end } },
  });
  return { value: count, unit: '' };
}

async function computeTicketsOpen(tenantId) {
  const count = await prisma.ticket.count({
    where: { tenantId, status: { in: ['open', 'in_progress', 'on_hold'] } },
  });
  return { value: count, unit: '' };
}

async function computeNpsScore(tenantId) {
  // Sab NPS-type surveys ke responses (score 0..10).
  const rows = await prisma.surveyResponse.findMany({
    where: { survey: { tenantId, type: 'nps' }, score: { not: null } },
    select: { score: true },
  });
  const scores = rows.map((r) => r.score).filter((s) => s >= 0 && s <= 10);
  if (!scores.length) return { value: null, unit: '', extra: { responses: 0 } };
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  const nps = Math.round(((promoters - detractors) / scores.length) * 100);
  return { value: nps, unit: '', extra: { responses: scores.length, promoters, detractors } };
}

async function computeChurnRisk(tenantId) {
  // Active members jinke koi bhi open invoice par outstanding balance hai.
  const debtors = await prisma.invoice.groupBy({
    by: ['memberId'],
    where: {
      tenantId,
      status: { in: ['unpaid', 'partial', 'overdue'] },
      member: { status: 'active' },
    },
    _sum: { amount: true, amountPaid: true },
  });
  const atRisk = debtors.filter((d) => num(d._sum.amount) - num(d._sum.amountPaid) > 0).length;
  return { value: atRisk, unit: '' };
}

const WIDGETS = [
  { id: 'occupancy', label: 'Occupancy', description: 'Occupied units ka %', compute: computeOccupancy },
  { id: 'revenue_mtd', label: 'Revenue (MTD)', description: 'Is mahine ki payments', compute: computeRevenueMtd },
  { id: 'outstanding_ar', label: 'Outstanding AR', description: 'Wusool-baqi raqam', compute: computeOutstandingAr },
  { id: 'active_members', label: 'Active Members', description: 'Active members ki tadad', compute: computeActiveMembers },
  { id: 'bookings_today', label: 'Bookings Today', description: 'Aaj ki confirmed bookings', compute: computeBookingsToday },
  { id: 'tickets_open', label: 'Open Tickets', description: 'Khuli complaints', compute: computeTicketsOpen },
  { id: 'nps_score', label: 'NPS Score', description: 'Net Promoter Score', compute: computeNpsScore },
  { id: 'churn_risk_count', label: 'Churn Risk', description: 'Baqi-raqam wale active members', compute: computeChurnRisk },
];

const WIDGET_MAP = Object.fromEntries(WIDGETS.map((w) => [w.id, w]));

function getWidgetList() {
  return WIDGETS.map(({ id, label, description }) => ({ id, label, description }));
}

function isValidWidgetId(id) {
  return Object.prototype.hasOwnProperty.call(WIDGET_MAP, id);
}

// Har widget safe compute: ek widget fail ho to null (dashboard nahi tootega).
async function computeWidget(tenantId, id) {
  const w = WIDGET_MAP[id];
  if (!w) return { id, label: id, value: null, unit: '', error: 'unknown_widget' };
  try {
    const res = await w.compute(tenantId);
    return { id, label: w.label, value: res.value, unit: res.unit, extra: res.extra || {} };
  } catch (err) {
    return { id, label: w.label, value: null, unit: '', error: 'compute_failed' };
  }
}

async function computeWidgets(tenantId, ids) {
  const list = (ids || []).filter(isValidWidgetId);
  return Promise.all(list.map((id) => computeWidget(tenantId, id)));
}

module.exports = {
  WIDGETS,
  getWidgetList,
  isValidWidgetId,
  computeWidget,
  computeWidgets,
};
