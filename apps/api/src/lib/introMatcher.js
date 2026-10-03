// Phase 40 Track 9: Member Introductions — rule-based new-member matcher.
// Koi AI/ML nahi: industry, company, directory tags aur bio keywords par
// explainable scoring. Naya member create hone par `onNewMember` fire-and-forget
// call hota hai (coordinator members route me hook kare).

const prisma = require('./prisma');
const { createNotification } = require('./notify');

function introsEnabled() {
  return !!(prisma && prisma.memberIntro);
}

// Bio/tags ko normalized keyword set me todo — chhote stopwords nikalo.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'our', 'you', 'your', 'are', 'was', 'has',
  'have', 'this', 'that', 'from', 'into', 'over', 'under', 'about', 'also',
  'aur', 'ka', 'ki', 'ke', 'se', 'me', 'par', 'ko', 'hai', 'kya', 'nahi',
  'to', 'a', 'an', 'of', 'in', 'on', 'at', 'is', 'it', 'as', 'by', 'we',
]);

function keywords(text) {
  if (!text) return new Set();
  const words = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return new Set(words);
}

// Scoring rules (explainable):
//   +30 same company.industry (exact, normalized)
//   +25 same companyName (exact, normalized)
//   +15 per shared directoryTag (max 45)
//   +3 per shared bio keyword (max 24)
//   +10 dono directoryOptIn (community me visible hon to milna zyada useful)
function scorePair(newM, cand) {
  let score = 0;
  const reasons = [];

  const indA = (newM.company?.industry || '').trim().toLowerCase();
  const indB = (cand.company?.industry || '').trim().toLowerCase();
  if (indA && indA === indB) {
    score += 30;
    reasons.push(`same industry: ${newM.company.industry.trim()}`);
  }

  const coA = (newM.companyName || newM.company?.name || '').trim().toLowerCase();
  const coB = (cand.companyName || cand.company?.name || '').trim().toLowerCase();
  if (coA && coA === coB) {
    score += 25;
    reasons.push(`same company: ${(newM.companyName || newM.company?.name).trim()}`);
  }

  const tagsA = new Set((newM.directoryTags || []).map((t) => String(t).toLowerCase().trim()));
  const tagsB = new Set((cand.directoryTags || []).map((t) => String(t).toLowerCase().trim()));
  const sharedTags = [...tagsA].filter((t) => t && tagsB.has(t)).slice(0, 3);
  if (sharedTags.length) {
    score += Math.min(45, 15 * sharedTags.length);
    reasons.push(`shared interests: ${sharedTags.join(', ')}`);
  }

  const kwA = keywords(newM.directoryBio);
  const kwB = keywords(cand.directoryBio);
  const sharedKw = [...kwA].filter((w) => kwB.has(w)).slice(0, 8);
  if (sharedKw.length) {
    score += Math.min(24, 3 * sharedKw.length);
    if (!sharedTags.length) reasons.push(`similar profile: ${sharedKw.slice(0, 4).join(', ')}`);
  }

  if (newM.directoryOptIn && cand.directoryOptIn) {
    score += 10;
    reasons.push('both visible in member directory');
  }

  return { score: Math.min(100, score), reasons };
}

/**
 * matchIntroductions(tenantId, memberId)
 * Naye member ke liye top-3 match suggestions nikalta hai, MemberIntro rows
 * banata hai (dedupe via unique pair), aur staff ko notification bhejta hai.
 * Returns: created intros (with suggested member summary).
 */
async function matchIntroductions(tenantId, memberId) {
  if (!introsEnabled()) return [];
  const tx = prisma;

  const newM = await tx.member.findFirst({
    where: { id: memberId, tenantId },
    include: { company: true },
  });
  if (!newM) return [];

  const candidates = await tx.member.findMany({
    where: {
      tenantId,
      status: 'active',
      id: { not: memberId },
      createdAt: { lt: newM.createdAt }, // sirf purane members suggest hon
    },
    include: { company: true },
    take: 200, // bada tenant bhi safe rahe
  });

  const existing = await tx.memberIntro.findMany({
    where: { tenantId, newMemberId: memberId },
    select: { suggestedMemberId: true },
  });
  const seen = new Set(existing.map((e) => e.suggestedMemberId));

  const scored = candidates
    .filter((c) => !seen.has(c.id))
    .map((c) => {
      const { score, reasons } = scorePair(newM, c);
      return { candidate: c, score, reasons };
    })
    .filter((s) => s.score >= 15) // sirf meaningful matches
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const created = [];
  for (const s of scored) {
    try {
      const row = await tx.memberIntro.create({
        data: {
          tenantId,
          newMemberId: memberId,
          suggestedMemberId: s.candidate.id,
          reason: s.reasons.join(' · ') || 'profile match',
          score: s.score,
          status: 'suggested',
        },
      });
      created.push({
        ...row,
        suggestedMember: { id: s.candidate.id, name: s.candidate.name, companyName: s.candidate.companyName },
      });
    } catch {
      // unique race — skip
    }
  }

  if (created.length) {
    const msg = `${newM.name} ke liye ${created.length} intro suggestion${created.length > 1 ? 's' : ''} ready: ${created.map((c) => c.suggestedMember.name).join(', ')}`;
    // Role-based notifications exact-match hain — har staff role ko alag bhejdo.
    for (const role of ['manager', 'admin', 'ceo', 'super_admin']) {
      try {
        await createNotification(tx, { tenantId, role, type: 'intro.suggested', message: msg });
      } catch { /* notification optional */ }
    }
  }

  return created;
}

// Fire-and-forget hook: members route se member create ke baad call karo.
// Kabhi throw nahi karta — background kaam kabhi member creation ko fail na kare.
function onNewMember(tenantId, memberId) {
  setImmediate(() => {
    matchIntroductions(tenantId, memberId).catch(() => {});
  });
}

module.exports = { matchIntroductions, onNewMember, scorePair, introsEnabled };
