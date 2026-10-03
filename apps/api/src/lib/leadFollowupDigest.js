// Phase 39 Track 5: Overdue follow-up digest.
// Daily job 'lead-followup-digest': overdue follow-ups ka per-user email digest
// + in-app notification (dashboard alert). Coordinator:
//   require('./lib/leadFollowupDigest');                    // auto-register handler
//   require('./lib/leadFollowupDigest').ensureLeadFollowupDigestScheduled();
// ya 'lead-followup-digest' ko daily PHASE job list me add karo.
const prisma = require('./prisma');
const { sendEmail } = require('./mailer');
const { createNotification } = require('./notify');

const SALES_ROLES = ['ceo', 'admin', 'manager'];

function getJobs() {
  try {
    const j = require('./jobs');
    if (j && typeof j.registerHandler === 'function') return j;
    return null;
  } catch { return null; }
}

const escapeHtml = (s) =>
  String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

async function processLeadFollowupDigest() {
  if (!prisma.leadFollowup) return { skipped: 'not-enabled' };
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const overdue = await prisma.leadFollowup.findMany({
    where: { status: 'pending', dueAt: { lt: startOfToday } },
    select: {
      id: true, tenantId: true, dueAt: true, type: true, note: true, assignedTo: true,
      lead: { select: { id: true, name: true, phone: true, email: true, stage: true } },
      assignee: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ dueAt: 'asc' }],
  });
  if (!overdue.length) return { checked: 0, notified: 0 };

  // Group: tenantId -> assigneeId (or '__unassigned__') -> rows
  const byTenant = new Map();
  for (const f of overdue) {
    if (!byTenant.has(f.tenantId)) byTenant.set(f.tenantId, new Map());
    const g = byTenant.get(f.tenantId);
    const key = f.assignedTo || '__unassigned__';
    if (!g.has(key)) g.set(key, []);
    g.get(key).push(f);
  }

  let notified = 0;
  for (const [tenantId, groups] of byTenant) {
    const usersById = new Map();
    const assigneeIds = [...groups.keys()].filter((k) => k !== '__unassigned__');
    if (assigneeIds.length) {
      const users = await prisma.user.findMany({
        where: { id: { in: assigneeIds }, tenantId },
        select: { id: true, name: true, email: true },
      });
      for (const u of users) usersById.set(u.id, u);
    }
    for (const [key, rows] of groups) {
      const daysOverdue = (r) => Math.max(1, Math.floor((now - new Date(r.dueAt)) / 86400000));
      const listHtml = rows
        .map((r) => `<li><strong>${escapeHtml(r.lead.name)}</strong> — ${escapeHtml(r.type)} — due ${new Date(r.dueAt).toLocaleDateString()} (${daysOverdue(r)}d overdue)${r.note ? ` — ${escapeHtml(r.note)}` : ''}${r.lead.phone ? ` — ☎ ${escapeHtml(r.lead.phone)}` : ''}</li>`)
        .join('');
      if (key === '__unassigned__') {
        // Unassigned overdue: dashboard alert for sales staff roles.
        const msg = `[followup-digest] ${rows.length} unassigned overdue follow-up${rows.length > 1 ? 's' : ''}: ${rows.map((r) => `${r.lead.name} (${r.type}, due ${new Date(r.dueAt).toLocaleDateString()})`).join(', ')}`;
        for (const role of SALES_ROLES) {
          await createNotification(prisma, {
            tenantId, role, type: 'followup_overdue', message: msg,
          }).catch(() => {});
        }
        notified += rows.length;
        continue;
      }
      const user = usersById.get(key);
      if (!user) continue;
      const subject = `Follow-up digest: ${rows.length} overdue lead follow-up${rows.length > 1 ? 's' : ''}`;
      const msg = `[followup-digest] ${rows.length} overdue follow-up${rows.length > 1 ? 's' : ''}: ${rows.map((r) => `${r.lead.name} (${r.type})`).join(', ')}`;
      // Dashboard alert: in-app notification for the assigned user.
      await createNotification(prisma, {
        tenantId, userId: user.id, type: 'followup_overdue', message: msg,
      }).catch(() => {});
      // Daily digest email.
      if (user.email) {
        await sendEmail(tenantId, {
          to: user.email,
          subject,
          html: `<p>Assalam-o-Alaikum ${escapeHtml(user.name || '')},</p><p>Aap ke <strong>${rows.length}</strong> lead follow-up(s) overdue hain:</p><ul>${listHtml}</ul><p>Please aj in se contact karein.</p>`,
          text: `Aap ke ${rows.length} lead follow-up(s) overdue hain:\n` +
            rows.map((r) => `- ${r.lead.name} — ${r.type} — due ${new Date(r.dueAt).toLocaleDateString()}${r.lead.phone ? ` — ${r.lead.phone}` : ''}`).join('\n'),
        }).catch(() => {});
      }
      notified += rows.length;
    }
  }
  return { checked: overdue.length, notified };
}

async function ensureLeadFollowupDigestScheduled() {
  const jobs = getJobs();
  if (!jobs) return;
  try {
    const { enqueue } = jobs;
    const pending = await prisma.job.count({
      where: { type: 'lead-followup-digest', status: 'pending' },
    }).catch(() => 1);
    if (!pending) {
      await enqueue('lead-followup-digest', {}, { runAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }).catch(() => {});
    }
  } catch (e) { console.error('[lead-followups] daily schedule failed:', e.message); }
}

// Stage-change auto-suggest: naya follow-up sirf tab jab similar pending na ho.
// Coordinator hook (routes/leads.js PATCH /:id me):
//   const { suggestFollowupForStage } = require('../lib/leadFollowupDigest');
//   if (req.body.stage && req.body.stage !== existing.stage) {
//     suggestFollowupForStage(req.user.tenantId, lead, existing.stage, lead.stage, req.user.sub);
//   }
const STAGE_SUGGESTIONS = {
  contacted: { days: 2, type: 'call', note: 'Stage: contacted — 2 din baad follow-up call.' },
  visit: { days: 1, type: 'whatsapp', note: 'Stage: visit — agle din WhatsApp par feedback poochho.' },
};

async function suggestFollowupForStage(tenantId, lead, oldStage, newStage, actorId) {
  try {
    if (!prisma.leadFollowup) return null;
    if (newStage === 'booked' || newStage === 'lost') return null; // follow-up ki zaroorat nahi
    const sug = STAGE_SUGGESTIONS[newStage];
    const days = sug ? sug.days : 3;
    const type = sug ? sug.type : 'call';
    // Dedupe: is lead ke liye similar pending follow-up already na ho.
    const similar = await prisma.leadFollowup.findFirst({
      where: { tenantId, leadId: lead.id, status: 'pending', type },
      select: { id: true },
    });
    if (similar) return null;
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + days);
    return prisma.leadFollowup.create({
      data: {
        tenantId,
        leadId: lead.id,
        dueAt,
        type,
        note: sug ? sug.note : `Stage ${oldStage} → ${newStage}: ${days} din baad follow-up call.`,
        assignedTo: lead.assignedTo || actorId || null,
      },
    });
  } catch { return null; }
}

const jobs = getJobs();
if (jobs) {
  try { jobs.registerHandler('lead-followup-digest', processLeadFollowupDigest); } catch {}
}

module.exports = { processLeadFollowupDigest, ensureLeadFollowupDigestScheduled, suggestFollowupForStage };
