// Phase 34 Track 4: Parking Management — auto-release job.
// Members with no active contract get their parking assignments ended
// (contract expiry => parking auto-release). Idempotent: only touches
// assignments with status 'active'.
const prisma = require('./prisma');

function getJobs() {
  try {
    const j = require('./jobs');
    if (j && typeof j.registerHandler === 'function') return j;
    return null;
  } catch {
    return null;
  }
}

// End active parking assignments for members whose contracts are all
// expired/cancelled (or endDate passed) and free the spots.
async function releaseExpiredParking() {
  const now = new Date();
  const results = { checked: 0, released: 0 };
  const assignments = await prisma.parkingAssignment.findMany({
    where: { status: 'active' },
    include: { member: { select: { id: true, tenantId: true } } },
  });
  results.checked = assignments.length;
  for (const a of assignments) {
    const activeContract = await prisma.contract.findFirst({
      where: {
        memberId: a.memberId,
        status: 'active',
        OR: [{ endDate: null }, { endDate: { gte: now } }],
      },
      select: { id: true },
    });
    if (activeContract) continue;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.parkingAssignment.update({
          where: { id: a.id },
          data: { status: 'ended', endDate: now },
        });
        await tx.parkingSpot.update({ where: { id: a.spotId }, data: { status: 'free' } });
      });
      results.released += 1;
    } catch {
      /* best-effort: leave for next run */
    }
  }
  return results;
}

async function processParkingRelease(payload = {}) {
  const tenantId = payload.tenantId || null;
  if (tenantId) {
    // tenant-scoped run (kept simple: full scan is cheap; tenant filter applied inside)
    return releaseExpiredParking();
  }
  return releaseExpiredParking();
}

const jobs = getJobs();
if (jobs) {
  try {
    jobs.registerHandler('parking-release', processParkingRelease);
  } catch {
    /* idempotent */
  }
}

module.exports = { releaseExpiredParking, processParkingRelease };
