// Phase 48 Track 4/10: Access check engine — kya member is waqt is door se andar aa sakta hai?
// canEnter(tenantId, memberId, doorId, at?) -> { allowed, reason, schedule? }
// reason codes (denied): member_not_found | member_inactive | door_not_found | door_inactive |
//   credential_not_configured | credential_expired | no_credential | outside_schedule | not_configured
// reason (allowed): ok

const prisma = require('./prisma');

function schedulesEnabled() {
  return !!(prisma && prisma.accessSchedule);
}

function isoDay(date) {
  // ISO 1=Mon ... 7=Sun
  const d = date.getDay(); // 0=Sun..6=Sat
  return d === 0 ? 7 : d;
}

function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function timeInWindow(startMin, endMin, nowMin) {
  if (endMin > startMin) return nowMin >= startMin && nowMin < endMin;
  // overnight window, e.g. 20:00-06:00
  return nowMin >= startMin || nowMin < endMin;
}

function scheduleMatches(schedule, date) {
  const days = Array.isArray(schedule.daysOfWeek) ? schedule.daysOfWeek : [];
  if (!days.includes(isoDay(date))) return false;
  const s = toMinutes(schedule.startTime);
  const e = toMinutes(schedule.endTime);
  if (s === null || e === null) return false;
  return timeInWindow(s, e, date.getHours() * 60 + date.getMinutes());
}

async function canEnter(tenantId, memberId, doorId, at) {
  const when = at instanceof Date ? at : new Date(at || Date.now());
  if (!schedulesEnabled()) return { allowed: false, reason: 'not_configured' };
  try {
    // 1. Member
    const member = await prisma.member.findFirst({
      where: { id: memberId, tenantId },
      select: { id: true, status: true },
    });
    if (!member) return { allowed: false, reason: 'member_not_found' };
    if (!['active', 'trial'].includes(member.status)) return { allowed: false, reason: 'member_inactive' };

    // 2. Door
    const door = await prisma.door.findFirst({
      where: { id: doorId, tenantId },
      select: { id: true, isActive: true },
    });
    if (!door) return { allowed: false, reason: 'door_not_found' };
    if (door.isActive === false) return { allowed: false, reason: 'door_inactive' };

    // 3. Credential (Track 2 ka model merge na ho to honest deny)
    if (!prisma.accessCredential) return { allowed: false, reason: 'credential_not_configured' };
    const cred = await prisma.accessCredential.findFirst({
      where: { tenantId, memberId, isActive: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true, expiresAt: true },
    });
    if (!cred) return { allowed: false, reason: 'no_credential' };
    if (cred.expiresAt && new Date(cred.expiresAt) < when) return { allowed: false, reason: 'credential_expired' };

    // 4. Schedule — sab se specific pehle: member+door > member > door > global
    const schedules = await prisma.accessSchedule.findMany({
      where: { tenantId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    const candidates = schedules.filter(
      (s) =>
        (s.memberId === null || s.memberId === memberId) &&
        (s.doorId === null || s.doorId === doorId)
    );
    if (candidates.length === 0) {
      // Koi schedule hi nahi bana — default deny (safe). Staff manual entry log kar sakta hai.
      return { allowed: false, reason: 'outside_schedule' };
    }
    // specificity sort: member+door(3) > member(2) > door(1) > global(0)
    const specificity = (s) => (s.memberId ? 2 : 0) + (s.doorId ? 1 : 0);
    const sorted = [...candidates].sort((a, b) => specificity(b) - specificity(a));
    const matched = sorted.find((s) => scheduleMatches(s, when));
    if (!matched) return { allowed: false, reason: 'outside_schedule' };
    return { allowed: true, reason: 'ok', scheduleId: matched.id };
  } catch (err) {
    return { allowed: false, reason: 'check_failed' };
  }
}

module.exports = { canEnter, schedulesEnabled, scheduleMatches, isoDay };
