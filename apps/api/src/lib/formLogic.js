// Phase 47 Track 3: Form conditional logic (showIf) — server-side engine.
// Field schema (Track 1 builder): fields Json me har field par optional:
//   showIf: { fieldId, operator: 'equals' | 'not_equals' | 'contains', value }
// - evaluateVisibility(fields, answers) → { [fieldId]: true/false }
// - validateSubmission(form, answers) → { valid, errors, visibleFields, cleanedAnswers }
// Chhupi (hidden) required fields SKIP hoti hain — server-side enforce hota hai.
//
// ── INTEGRATION NOTES (coordinator) ──────────────────────────────────────────
// 1) Track 1 — builder (apps/web/app/(app)/forms/[id]/page.js):
//    - Har field ke config panel me "Logic" tab jorein: source field ka select
//      (sirf us se pehle wale fields), operator select (equals / not_equals /
//      contains), value input.
//    - Save par field.showIf = { fieldId, operator, value } fields Json me rakhein.
//      Koi logic nahi → showIf mat bhejein (field hamesha visible).
//    - Builder preview me client-side mirror (CLIENT_SNIPPET, neeche) use karein.
// 2) Track 2 — public renderer (apps/web/app/f/[slug]/page.js):
//    - answers state ke onChange par evaluateVisibility dobara chalao; hidden
//      fields render mat karo aur submit se pehle unhe answers se hata do.
//    - Client-side mirror function CLIENT_SNIPPET me copy-paste ready hai.
// 3) Track 2 — submit route (apps/api/src/routes/form-public.js):
//    - POST /submit me zod basic checks ke BAAD validateSubmission(form, answers)
//      lazmi chalao; valid=false par 422 + errors array wapas bhejo.
// ─────────────────────────────────────────────────────────────────────────────

const OPERATORS = ['equals', 'not_equals', 'contains'];

function normalizeStr(v) {
  return String(v === undefined || v === null ? '' : v).trim().toLowerCase();
}

function isEmptyAnswer(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false; // number 0 / boolean false khaali nahi
}

// equals: string (case-insensitive, trim), number (numeric), array (koi element match)
function answersEqual(ans, val) {
  if (ans === undefined || ans === null) return false;
  if (Array.isArray(ans)) return ans.some((a) => answersEqual(a, val));
  if (typeof val === 'boolean' || typeof ans === 'boolean') {
    return normalizeStr(ans) === normalizeStr(val);
  }
  const an = Number(ans);
  const vn = Number(val);
  if (String(ans).trim() !== '' && String(val).trim() !== '' && !Number.isNaN(an) && !Number.isNaN(vn)) {
    return an === vn;
  }
  return normalizeStr(ans) === normalizeStr(val);
}

// contains: string me substring, array me kisi element me substring (case-insensitive)
function answersContains(ans, val) {
  const needle = normalizeStr(val);
  if (!needle) return false;
  if (ans === undefined || ans === null) return false;
  if (Array.isArray(ans)) return ans.some((a) => answersContains(a, val));
  return normalizeStr(ans).includes(needle);
}

function evalCondition(cond, answers) {
  if (!cond || !cond.fieldId) return true;
  const src = answers[cond.fieldId];
  switch (cond.operator) {
    case 'equals':
      return answersEqual(src, cond.value);
    case 'not_equals':
      return !answersEqual(src, cond.value);
    case 'contains':
      return answersContains(src, cond.value);
    default:
      return true; // unknown operator → fail-open, field dikhao (crash nahi)
  }
}

// Har field ke liye visible/hidden map. Chained deps (A→B→C) fixpoint se hal hoti
// hain; source field hidden ho to dependent bhi hidden; circular deps fail-open.
function evaluateVisibility(fields, answers) {
  const list = Array.isArray(fields) ? fields : [];
  const ans = answers && typeof answers === 'object' ? answers : {};
  const byId = new Map();
  for (const f of list) if (f && f.id) byId.set(f.id, f);
  const vis = {};
  for (const f of list) {
    if (!f || !f.id) continue;
    vis[f.id] = f.showIf ? null : true; // null = abhi decide nahi hua
  }
  let changed = true;
  let passes = 0;
  while (changed && passes < list.length + 1) {
    changed = false;
    passes += 1;
    for (const f of list) {
      if (!f || !f.id || !f.showIf) continue;
      const cond = f.showIf;
      if (byId.has(cond.fieldId) && vis[cond.fieldId] === false) {
        if (vis[f.id] !== false) { vis[f.id] = false; changed = true; }
        continue;
      }
      const v = !!evalCondition(cond, ans);
      if (vis[f.id] !== v) { vis[f.id] = v; changed = true; }
    }
  }
  for (const k of Object.keys(vis)) if (vis[k] === null) vis[k] = true;
  return vis;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s\-()]{5,25}$/;

function optionsOf(f) {
  return (f.options || []).map((o) => (typeof o === 'string' ? o : o && o.value));
}

function validateType(f, v) {
  const label = f.label || f.id;
  switch (f.type) {
    case 'email':
      return EMAIL_RE.test(String(v).trim()) ? null : `${label} me sahi email likhein`;
    case 'phone':
      return PHONE_RE.test(String(v).trim()) ? null : `${label} me sahi phone number likhein`;
    case 'number': {
      const s = String(v).trim();
      return s !== '' && Number.isFinite(Number(s)) ? null : `${label} me number likhein`;
    }
    case 'date': {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? `${label} me sahi tareekh likhein` : null;
    }
    case 'rating': {
      const n = Number(v);
      const min = f.min !== undefined ? f.min : 1;
      const max = f.max !== undefined ? f.max : 5;
      return Number.isFinite(n) && n >= min && n <= max
        ? null
        : `${label} ${min} se ${max} ke darmiyan ho`;
    }
    case 'select':
    case 'radio': {
      const opts = optionsOf(f);
      return opts.includes(v) ? null : `${label} me ghalat option hai`;
    }
    case 'multiselect': {
      if (!Array.isArray(v)) return `${label} me ghalat format hai`;
      const opts = optionsOf(f);
      return v.every((x) => opts.includes(x)) ? null : `${label} me ghalat options hain`;
    }
    case 'checkbox': {
      const opts = optionsOf(f);
      if (!opts.length) {
        // single checkbox (boolean)
        return v === true || v === false || v === 'true' || v === 'false'
          ? null
          : `${label} me ghalat value hai`;
      }
      if (!Array.isArray(v)) return `${label} me ghalat format hai`;
      return v.every((x) => opts.includes(x)) ? null : `${label} me ghalat options hain`;
    }
    case 'file': {
      if (typeof v === 'string' && v.trim()) return null;
      if (v && typeof v === 'object' && (v.url || v.name)) return null;
      return `${label} me file upload karein`;
    }
    default:
      return null; // text, textarea — koi extra check nahi
  }
}

// Server-side submission validation. Hidden fields: required bhi skip, type
// check bhi skip, cleanedAnswers se bahar (client ne bheja ho to ignore).
function validateSubmission(form, answers) {
  const fields = form && Array.isArray(form.fields) ? form.fields : [];
  const ans = answers && typeof answers === 'object' ? answers : {};
  const vis = evaluateVisibility(fields, ans);
  const errors = [];
  const cleanedAnswers = {};
  for (const f of fields) {
    if (!f || !f.id) continue;
    if (!vis[f.id]) continue; // hidden → skip
    const v = ans[f.id];
    const label = f.label || f.id;
    if (f.required && isEmptyAnswer(v)) {
      errors.push({ fieldId: f.id, message: `${label} lazmi hai` });
      continue;
    }
    if (isEmptyAnswer(v)) continue; // optional aur khaali → theek
    const err = validateType(f, v);
    if (err) errors.push({ fieldId: f.id, message: err });
    else cleanedAnswers[f.id] = v;
  }
  return {
    valid: errors.length === 0,
    errors,
    visibleFields: Object.keys(vis).filter((k) => vis[k]),
    cleanedAnswers,
  };
}

// ── Client-side mirror (Track 2 public renderer / Track 1 builder preview) ──
// Neeche wala snippet browser me copy-paste ready hai (koi node dependency nahi).
const CLIENT_SNIPPET = `
function formLogic_evaluateVisibility(fields, answers) {
  var list = Array.isArray(fields) ? fields : [];
  var ans = answers && typeof answers === 'object' ? answers : {};
  var norm = function (v) { return String(v === undefined || v === null ? '' : v).trim().toLowerCase(); };
  var eq = function (a, val) {
    if (a === undefined || a === null) return false;
    if (Array.isArray(a)) return a.some(function (x) { return eq(x, val); });
    if (typeof val === 'boolean' || typeof a === 'boolean') return norm(a) === norm(val);
    var an = Number(a), vn = Number(val);
    if (String(a).trim() !== '' && String(val).trim() !== '' && !isNaN(an) && !isNaN(vn)) return an === vn;
    return norm(a) === norm(val);
  };
  var has = function (a, val) {
    var needle = norm(val);
    if (!needle || a === undefined || a === null) return false;
    if (Array.isArray(a)) return a.some(function (x) { return has(x, val); });
    return norm(a).indexOf(needle) !== -1;
  };
  var cond = function (c) {
    if (!c || !c.fieldId) return true;
    var src = ans[c.fieldId];
    if (c.operator === 'equals') return eq(src, c.value);
    if (c.operator === 'not_equals') return !eq(src, c.value);
    if (c.operator === 'contains') return has(src, c.value);
    return true;
  };
  var vis = {};
  list.forEach(function (f) { if (f && f.id) vis[f.id] = f.showIf ? null : true; });
  var byId = {};
  list.forEach(function (f) { if (f && f.id) byId[f.id] = f; });
  var changed = true, passes = 0;
  while (changed && passes < list.length + 1) {
    changed = false; passes++;
    list.forEach(function (f) {
      if (!f || !f.id || !f.showIf) return;
      var c = f.showIf;
      if (byId[c.fieldId] && vis[c.fieldId] === false) {
        if (vis[f.id] !== false) { vis[f.id] = false; changed = true; }
        return;
      }
      var v = !!cond(c);
      if (vis[f.id] !== v) { vis[f.id] = v; changed = true; }
    });
  }
  Object.keys(vis).forEach(function (k) { if (vis[k] === null) vis[k] = true; });
  return vis;
}
`;

module.exports = {
  OPERATORS,
  evaluateVisibility,
  validateSubmission,
  CLIENT_SNIPPET,
};
