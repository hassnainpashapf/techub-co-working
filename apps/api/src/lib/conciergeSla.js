// Phase 55 Track 7: Concierge SLA Tracking
// Per-category SLA hours, slaStatus(request) -> on-time | at-risk | breached,
// breached hone par manager ko Notification.
// Koi migration nahi — ServiceRequest timestamps (createdAt/updatedAt/status) use hote hain.
// COORDINATOR: server.js me mount `app.use('/api/concierge-sla', require('./routes/concierge-sla'));`

const { getPrisma } = require('./prisma');

// Per-category SLA (ghante). category ConciergeService.category se aati hai:
// errand | food | transport | wellness | business | (default)
const SLA_HOURS = {
  errand: 4,
  food: 2,
  transport: 6,
  wellness: 24,
  business: 48,
  default: 24,
};

// At-risk threshold: SLA ka itna hissa guzar jaye to at-risk (80%)
const AT_RISK_RATIO = 0.8;

const ACTIVE_STATUSES = ['new', 'accepted', 'in_progress'];

function slaHoursFor(request) {
  const cat = request?.service?.category || request?.category || 'default';
  return SLA_HOURS[cat] || SLA_HOURS.default;
}

function elapsedHours(request, now = new Date()) {
  const start = request?.createdAt ? new Date(request.createdAt) : now;
  return (now - start) / 36e5;
}

/**
 * slaStatus(request) -> { status: 'on-time'|'at-risk'|'breached'|'na', slaHours, elapsedHours, dueAt }
 * - done/cancelled (ya SLA inactive) -> 'na'
 */
function slaStatus(request, now = new Date()) {
  if (!request || !ACTIVE_STATUSES.includes(request.status)) {
    return { status: 'na', slaHours: null, elapsedHours: 0, dueAt: null };
  }
  const slaHours = slaHoursFor(request);
  const elapsed = elapsedHours(request, now);
  const dueAt = new Date(new Date(request.createdAt || now).getTime() + slaHours * 36e5);
  if (elapsed > slaHours) return { status: 'breached', slaHours, elapsedHours: +elapsed.toFixed(2), dueAt };
  if (elapsed >= slaHours * AT_RISK_RATIO) return { status: 'at-risk', slaHours, elapsedHours: +elapsed.toFixed(2), dueAt };
  return { status: 'on-time', slaHours, elapsedHours: +elapsed.toFixed(2), dueAt };
}

/**
 * scanBreaches(tenantId) — active requests scan kare, breach par manager(s) ko
 * Notification bheje. Dedupe: same request ke liye pichle 24h me notification ho to dobara nahi.
 * Returns { checked, breached, notified }.
 */
async function scanBreaches(tenantId) {
  const prisma = getPrisma();
  if (!prisma.serviceRequest) return { checked: 0, breached: 0, notified: 0 };

  const requests = await prisma.serviceRequest.findMany({
    where: { tenantId, status: { in: ACTIVE_STATUSES } },
    include: { service: { select: { id: true, name: true, category: true } }, member: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });

  // Managers: ceo/admin/manager roles ke users
  let managers = [];
  try {
    managers = await prisma.user.findMany({
      where: { tenantId, role: { in: ['ceo', 'admin', 'manager', 'super_admin'] } },
      select: { id: true },
    });
  } catch { managers = []; }

  let breached = 0;
  let notified = 0;
  for (const r of requests) {
    const s = slaStatus(r);
    if (s.status !== 'breached') continue;
    breached++;

    // Dedupe: is request ke liye 24h me notification bheji to skip
    let dup = 0;
    try {
      dup = await prisma.notification.count({
        where: {
          tenantId,
          type: 'concierge_sla_breach',
          createdAt: { gte: new Date(Date.now() - 24 * 36e5) },
          data: { path: ['requestId'], equals: r.id },
        },
      });
    } catch { dup = 0; }
    if (dup > 0) continue;

    const title = `SLA breach: "${r.title}" (${r.service?.name || 'concierge request'})`;
    const body = `${r.member?.name || 'Member'} ki request SLA (${s.slaHours}h) breach kar gayi — ${s.elapsedHours}h guzar chuke.`;
    for (const m of managers) {
      try {
        await prisma.notification.create({
          data: {
            tenantId,
            userId: m.id,
            type: 'concierge_sla_breach',
            title,
            body,
            data: { requestId: r.id, slaHours: s.slaHours, elapsedHours: s.elapsedHours },
          },
        });
        notified++;
      } catch { /* notification fail-safe */ }
    }
  }
  return { checked: requests.length, breached, notified };
}

function ensureSlaScheduled() {
  // Coordinator server.js me daily scan wire kare:
  // const { scanBreaches } = require('./lib/conciergeSla');
  return { scanBreaches, slaStatus, SLA_HOURS };
}

module.exports = { slaStatus, scanBreaches, slaHoursFor, elapsedHours, SLA_HOURS, AT_RISK_RATIO, ensureSlaScheduled };
