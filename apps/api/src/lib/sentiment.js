// Phase 45: Feedback sentiment scoring.
// scoreSentiment(text) -> { score: -1..1, sentiment: 'positive'|'neutral'|'negative' }
// Rule-based lexicon (English + Roman Urdu) — bina LLM key ke bhi kaam karta hai.
// LLM (Track 1 aiProvider) available ho to refineSentiment() score ko polish karta hai.

// --- Positive lexicon ---
const POSITIVE = [
  // English
  'excellent', 'amazing', 'awesome', 'great', 'good', 'best', 'love', 'loved', 'perfect',
  'wonderful', 'fantastic', 'clean', 'helpful', 'friendly', 'fast', 'quick', 'efficient',
  'comfortable', 'professional', 'smooth', 'easy', 'nice', 'beautiful', 'impressive',
  'satisfied', 'happy', 'pleased', 'recommend', 'thanks', 'thank', 'appreciate', 'brilliant',
  'superb', 'outstanding', 'reliable', 'prompt', 'courteous', 'polite', 'warm', 'welcoming',
  // Roman Urdu
  'acha', 'achha', 'bohat acha', 'bahut acha', 'zabardast', 'khoobsurat', 'shandar',
  'behtareen', 'umda', 'khush', 'mutmain', 'shukriya', 'meherbani', 'badhiya', 'lazeez',
  'saaf', 'safai', 'jaldi', 'tez', 'aram', 'sukoon', 'mazedar', 'pasand', 'dil khush',
];

// --- Negative lexicon ---
const NEGATIVE = [
  // English
  'bad', 'terrible', 'awful', 'horrible', 'worst', 'hate', 'hated', 'poor', 'slow',
  'dirty', 'unhelpful', 'rude', 'unprofessional', 'broken', 'stuck', 'late', 'delay',
  'delayed', 'expensive', 'overpriced', 'disappointed', 'frustrated', 'angry', 'upset',
  'complaint', 'issue', 'problem', 'bug', 'error', 'failed', 'fail', 'missing', 'lost',
  'noisy', 'crowded', 'uncomfortable', 'smell', 'smelly', 'cold', 'hot', 'dark',
  'unsafe', 'ignored', 'never', 'waste', 'pathetic', 'disgusting', 'useless',
  // Roman Urdu
  'ganda', 'gandi', 'bura', 'buri', 'bekar', 'bekaar', 'kharab', 'slow', 'der',
  'mehnga', 'mehngi', 'shikayat', 'pareshan', 'pareshani', 'takleef', 'mushkil',
  'gussa', 'naraz', 'mayus', 'dukhi', 'ghatiya', 'bakwas', 'fazool', 'na khush',
  'na mutmain', 'susti', 'gandagi', 'shor', 'tung', 'bheed', 'masla', 'masail',
  'khata', 'ghalti',
];

// Negation words — agla sentiment word ulta ho jata hai ("not good", "acha nahi")
const NEGATIONS = new Set([
  'not', "n't", 'no', 'never', 'nahi', 'nhi', 'na', 'mat', 'bilkul nahi', 'koi',
]);

// Intensifiers — score ka weight barhate hain
const INTENSIFIERS = new Set([
  'very', 'really', 'extremely', 'too', 'bohat', 'bahut', 'bht', 'bhot', 'bohut',
  'intehai', 'zaroor', 'bilkul',
]);

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z\u0600-\u06FF\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Rule-based sentiment scoring. Returns { score, sentiment }.
 * score: -1 (fully negative) .. 1 (fully positive). |score| < 0.25 => neutral.
 */
function scoreSentiment(text) {
  const norm = normalize(text);
  if (!norm) return { score: 0, sentiment: 'neutral' };

  const words = norm.split(' ');
  let pos = 0;
  let neg = 0;

  const posSet = new Set(POSITIVE);
  const negSet = new Set(NEGATIVE);

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    // two-word phrases ("bohat acha", "dil khush") bhi match karo
    const bigram = i + 1 < words.length ? `${w} ${words[i + 1]}` : null;

    let hit = 0; // +1 positive, -1 negative
    let span = 1;
    if (bigram && (posSet.has(bigram) || negSet.has(bigram))) {
      hit = posSet.has(bigram) ? 1 : -1;
      span = 2;
    } else if (posSet.has(w)) {
      hit = 1;
    } else if (negSet.has(w)) {
      hit = -1;
    }

    if (hit !== 0) {
      // negation check: hit ke aas-paas (±2 words) negation ho to flip
      // (English: "not good" — pehle; Roman Urdu: "acha nahi" — baad me)
      let flipped = false;
      for (let j = Math.max(0, i - 2); j < Math.min(words.length, i + 3); j++) {
        if (j !== i && NEGATIONS.has(words[j])) { flipped = true; break; }
      }
      // intensifier check: aas-paas intensifier ho to weight x1.5
      let weight = 1;
      for (let j = Math.max(0, i - 2); j < Math.min(words.length, i + 3); j++) {
        if (j !== i && INTENSIFIERS.has(words[j])) { weight = 1.5; break; }
      }
      const signed = (flipped ? -hit : hit) * weight;
      if (signed > 0) pos += signed; else neg += -signed;
      i += span - 1;
    }
  }

  const total = pos + neg;
  if (total === 0) return { score: 0, sentiment: 'neutral' };

  // Length-normalized score: -1..1
  const raw = (pos - neg) / Math.max(total, 3);
  const score = Math.max(-1, Math.min(1, Math.round(raw * 100) / 100));
  const sentiment = score >= 0.25 ? 'positive' : score <= -0.25 ? 'negative' : 'neutral';
  return { score, sentiment };
}

/**
 * LLM refine (optional). Track 1 ka aiProvider available ho to score polish karta hai,
 * warna rule-based result wapas. Kabhi crash nahi karta.
 */
async function refineSentiment(tenantId, text, base) {
  try {
    const { getAiClient } = require('./aiProvider');
    const client = await getAiClient(tenantId);
    if (!client || !client.available) return base;
    const res = await client.chat([
      { role: 'system', content: 'Classify the sentiment of this coworking-space member feedback as exactly one word: positive, neutral, or negative. Reply with only that word.' },
      { role: 'user', content: String(text || '').slice(0, 1000) },
    ], { maxTokens: 10 });
    const word = String(res && res.text || '').toLowerCase();
    const sentiment = word.includes('posit') ? 'positive' : word.includes('negat') ? 'negative' : 'neutral';
    // LLM label ko rule score ke sath blend karo: label jeet-ta hai, magnitude rule se
    const mag = Math.max(0.4, Math.abs(base.score));
    const score = sentiment === 'positive' ? mag : sentiment === 'negative' ? -mag : 0;
    return { score: Math.round(score * 100) / 100, sentiment, refined: true };
  } catch {
    return base;
  }
}

/**
 * Convenience: text ka sentiment nikalo (rule-based turant, LLM refine optional).
 * options: { refine: boolean, tenantId }
 */
async function analyzeSentiment(text, options = {}) {
  const base = scoreSentiment(text);
  if (options.refine && options.tenantId) {
    return refineSentiment(options.tenantId, text, base);
  }
  return base;
}

module.exports = { scoreSentiment, refineSentiment, analyzeSentiment };
