// Phase 28: DB-backed background job queue (no Redis needed).
// Interface: enqueue(type, data, {tenantId, runAt, maxAttempts}),
//            registerHandler(type, fn), startWorker()
const prisma = require('./prisma');

const handlers = new Map();
let workerStarted = false;
let workerTimer = null;

function registerHandler(type, fn) {
  if (typeof fn !== 'function') throw new Error('Handler must be a function');
  handlers.set(type, fn);
}

async function enqueue(type, data, opts = {}) {
  const { tenantId = null, runAt = null, maxAttempts = 5 } = opts;
  const job = await prisma.job.create({
    data: {
      type,
      payload: data || {},
      tenantId,
      status: 'pending',
      attempts: 0,
      maxAttempts,
      runAt: runAt || new Date(),
    },
  });
  return job;
}

async function processOne(job) {
  const handler = handlers.get(job.type);
  if (!handler) {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: 'failed', lastError: `No handler registered for type "${job.type}"` },
    });
    return;
  }
  try {
    // Pass both .data and .payload aliases — different handlers read different shapes.
    await handler({ id: job.id, type: job.type, data: job.payload, payload: job.payload, attempts: job.attempts, tenantId: job.tenantId });
    await prisma.job.update({ where: { id: job.id }, data: { status: 'completed' } });
  } catch (err) {
    const attempts = job.attempts + 1;
    const exhausted = attempts >= job.maxAttempts;
    // Exponential backoff: 2^attempts minutes
    const backoffMs = Math.pow(2, Math.min(attempts, 8)) * 60 * 1000;
    await prisma.job.update({
      where: { id: job.id },
      data: {
        attempts,
        status: exhausted ? 'failed' : 'pending',
        lastError: String((err && err.message) || err).slice(0, 2000),
        runAt: exhausted ? job.runAt : new Date(Date.now() + backoffMs),
      },
    });
  }
}

async function poll() {
  try {
    const now = new Date();
    // Claim a small batch atomically: only take jobs still pending
    const due = await prisma.job.findMany({
      where: { status: 'pending', runAt: { lte: now } },
      orderBy: { runAt: 'asc' },
      take: 10,
    });
    for (const job of due) {
      // Atomic claim — if another worker grabbed it, skip
      const claimed = await prisma.job.updateMany({
        where: { id: job.id, status: 'pending' },
        data: { status: 'processing' },
      });
      if (claimed.count === 0) continue;
      await processOne({ ...job, status: 'processing' });
    }
  } catch (err) {
    // Table may not exist yet (migration pending) — back off quietly
    if (!/does not exist/i.test(String((err && err.message) || err))) {
      console.error('[jobs] poll error:', (err && err.message) || err);
    }
  }
}

function startWorker() {
  if (workerStarted) return;
  workerStarted = true;
  global.__jobWorkerStarted = true;
  // Delay first poll so the app boots cleanly
  setTimeout(poll, 8000);
  workerTimer = setInterval(poll, 5000);
  if (workerTimer.unref) workerTimer.unref();
  console.log('[jobs] background worker started (5s interval)');
}

module.exports = { enqueue, registerHandler, startWorker, jobModel: () => prisma.job, _handlers: handlers };
