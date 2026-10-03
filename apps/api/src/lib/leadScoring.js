// Lead scoring — simple, explainable heuristic (koi ML nahi).
// Har signal ke points documented hain; GET /api/leads/:id/score breakdown deta hai.
// Relations (tours, quotations, activities) agar lead object par maujood hon to
// use hoti hain, warna gracefully skip — is liye ye lib schema merge se pehle
// bhi kaam karti hai.

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

// Actual Lead stages (schema.prisma): new | contacted | visit | booked | lost
const STAGE_MULTIPLIER = {
  new: 1.0,
  contacted: 1.2,
  visit: 1.5,
  booked: 1.8,
  lost: 0.5,
};

function gradeFor(score) {
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

function lastActivityAt(lead) {
  // Prefer explicit activity relations when present (Track 1/3/5 models),
  // otherwise fall back to updatedAt as the last-touch proxy.
  const times = [];
  if (Array.isArray(lead.activities)) {
    for (const a of lead.activities) {
      const t = a.createdAt || a.sentAt || a.dueAt;
      if (t) times.push(new Date(t).getTime());
    }
  }
  if (Array.isArray(lead.followups)) {
    for (const f of lead.followups) {
      if (f.updatedAt) times.push(new Date(f.updatedAt).getTime());
    }
  }
  if (lead.lastContactAt) times.push(new Date(lead.lastContactAt).getTime());
  if (lead.updatedAt) times.push(new Date(lead.updatedAt).getTime());
  if (lead.createdAt) times.push(new Date(lead.createdAt).getTime());
  return times.length ? new Date(Math.max(...times)) : null;
}

function hasCompletedTour(lead) {
  if (!Array.isArray(lead.tours)) return false;
  return lead.tours.some((t) => ['completed', 'done'].includes(String(t.status || '').toLowerCase()));
}

function hasSentQuotation(lead) {
  if (!Array.isArray(lead.quotations)) return false;
  return lead.quotations.some((q) =>
    ['sent', 'accepted', 'approved'].includes(String(q.status || '').toLowerCase())
  );
}

/**
 * computeLeadScore(lead) -> { score, grade, breakdown }
 * score: 0..100 integer, grade: A|B|C|D
 * breakdown: [{ label, points }] — har signal ka contribution (explainable)
 */
function computeLeadScore(lead) {
  const breakdown = [];
  let raw = 0;

  const add = (label, points) => {
    if (!points) return;
    raw += points;
    breakdown.push({ label, points });
  };

  // --- Contact completeness ---
  if (lead.email) add('Email maujood hai', 20);
  if (lead.phone) add('Phone maujood hai', 15);
  if (lead.company) add('Company maujood hai', 10);

  // --- Intent signals ---
  if (lead.budget !== null && lead.budget !== undefined && Number(lead.budget) > 0) {
    add('Budget bataya gaya', 15);
  }
  if (lead.source === 'referral') add('Referral source', 10);
  else if (lead.source === 'website') add('Website source', 5);

  // --- Engagement (relations optional — merge ke baad auto-active) ---
  if (hasCompletedTour(lead)) add('Tour complete hui', 20);
  if (hasSentQuotation(lead)) add('Quotation bheji gayi', 10);

  // --- Recency penalty ---
  const last = lastActivityAt(lead);
  if (last && Date.now() - last.getTime() > FOURTEEN_DAYS_MS) {
    add('14 din se koi activity nahi', -30);
  }

  // --- Stage multiplier (actual schema stages) ---
  const mult = STAGE_MULTIPLIER[lead.stage] ?? 1.0;
  if (mult !== 1.0) {
    breakdown.push({ label: `Stage "${lead.stage}" multiplier ×${mult}`, points: 0, multiplier: mult });
  }

  let score = Math.round(raw * mult);
  score = Math.max(0, Math.min(100, score));

  return { score, grade: gradeFor(score), breakdown };
}

module.exports = { computeLeadScore, gradeFor, STAGE_MULTIPLIER };
