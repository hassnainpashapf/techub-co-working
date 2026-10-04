'use client';

// Phase 47 Track 2/10: Public form renderer — "/f/[slug]?tenant=<tenantSlug>".
// No login needed. File fields: base64 data URLs (max 3 files, 5MB each) answers me.
// Submits to POST /api/forms/public/:slug/submit?tenantSlug=...
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

const API = () => process.env.NEXT_PUBLIC_API_URL || '';

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Track 3: client-side mirror of server conditional-logic engine (formLogic.js CLIENT_SNIPPET)
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

function FieldInput({ field, value, onChange, error, uploadInfo }) {
  const common = 'w-full rounded-xl bg-gray-100 border border-gray-200 px-4 py-3 text-gray-900 placeholder-gray-400 outline-none focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/20 transition';
  const errCls = error ? 'border-red-400/60' : '';
  const opts = Array.isArray(field.options) ? field.options : [];

  switch (field.type) {
    case 'textarea':
      return <textarea className={`${common} ${errCls}`} rows={4} placeholder={field.placeholder || ''} value={value || ''} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <input type="number" className={`${common} ${errCls}`} placeholder={field.placeholder || ''} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'email':
      return <input type="email" className={`${common} ${errCls}`} placeholder={field.placeholder || 'email@example.com'} value={value || ''} onChange={(e) => onChange(e.target.value)} />;
    case 'phone':
      return <input type="tel" className={`${common} ${errCls}`} placeholder={field.placeholder || '+92 300 1234567'} value={value || ''} onChange={(e) => onChange(e.target.value)} />;
    case 'date':
      return <input type="date" className={`${common} ${errCls}`} value={value || ''} onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return (
        <select className={`${common} ${errCls} [&>option]:bg-white`} value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Chunain —</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case 'radio':
      return (
        <div className="space-y-2">
          {opts.map((o) => (
            <label key={o} className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition ${value === o ? 'border-indigo-400/60 bg-indigo-500/10' : 'border-gray-200 bg-gray-100 hover:border-gray-300'}`}>
              <input type="radio" name={field.id} checked={value === o} onChange={() => onChange(o)} className="accent-indigo-500" />
              <span className="text-gray-800">{o}</span>
            </label>
          ))}
        </div>
      );
    case 'multiselect':
    case 'checkbox': {
      const arr = Array.isArray(value) ? value : [];
      const toggle = (o) => onChange(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o]);
      return (
        <div className="space-y-2">
          {opts.map((o) => (
            <label key={o} className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition ${arr.includes(o) ? 'border-indigo-400/60 bg-indigo-500/10' : 'border-gray-200 bg-gray-100 hover:border-gray-300'}`}>
              <input type="checkbox" checked={arr.includes(o)} onChange={() => toggle(o)} className="accent-indigo-500" />
              <span className="text-gray-800">{o}</span>
            </label>
          ))}
        </div>
      );
    }
    case 'rating': {
      const n = Number(value) || 0;
      return (
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((s) => (
            <button key={s} type="button" onClick={() => onChange(s)}
              className={`text-3xl transition ${s <= n ? 'text-amber-400' : 'text-gray-500 hover:text-gray-500'}`} aria-label={`${s} star`}>★</button>
          ))}
        </div>
      );
    }
    case 'file': {
      const files = Array.isArray(value) ? value : [];
      return (
        <div>
          <label className="block cursor-pointer rounded-xl border border-dashed border-gray-300 bg-gray-100 px-4 py-6 text-center text-gray-600 hover:border-indigo-400/60 transition">
            <input type="file" multiple className="hidden" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
              onChange={async (e) => {
                const picked = Array.from(e.target.files || []).slice(0, 3);
                const conv = [];
                for (const f of picked) {
                  if (f.size > 10 * 1024 * 1024) continue;
                  // Track 4: pehle /api/form-uploads par upload karo (signed token),
                  // fail ho to dataUrl fallback (server dono accept karta hai)
                  try {
                    const fd = new FormData();
                    fd.append('file', f);
                    fd.append('slug', uploadInfo?.slug || '');
                    fd.append('fieldId', field.id);
                    const r = await fetch(`${API()}/api/form-uploads`, { method: 'POST', body: fd });
                    const d = await r.json().catch(() => ({}));
                    if (r.ok && d.token) {
                      conv.push({ token: d.token, name: d.fileName || f.name, size: d.size, mime: d.mimetype });
                      continue;
                    }
                  } catch {}
                  if (f.size > 5 * 1024 * 1024) continue;
                  conv.push({ name: f.name, size: f.size, mime: f.type, dataUrl: await fileToDataUrl(f) });
                }
                onChange(conv);
                e.target.value = '';
              }} />
            <span className="text-sm">📎 File chunein (max 3, har ek 10MB tak)</span>
          </label>
          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map((f, i) => (
                <li key={i} className="flex items-center justify-between rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600">
                  <span>📄 {f.name}</span>
                  <button type="button" className="text-red-400 hover:text-red-700" onClick={() => onChange(files.filter((_, j) => j !== i))}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    }
    default:
      return <input type="text" className={`${common} ${errCls}`} placeholder={field.placeholder || ''} value={value || ''} onChange={(e) => onChange(e.target.value)} />;
  }
}

export default function PublicFormPage() {
  const { slug } = useParams();
  const search = useSearchParams();
  const tenantSlug = search.get('tenant') || '';
  const [state, setState] = useState('loading'); // loading | ready | done | notfound | error
  const [form, setForm] = useState(null);
  const [tenantName, setTenantName] = useState('');
  const [answers, setAnswers] = useState({});
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [submitError, setSubmitError] = useState('');
  const honeypot = useRef('');

  useEffect(() => {
    if (!slug || !tenantSlug) { setState('notfound'); return; }
    (async () => {
      try {
        const r = await fetch(`${API()}/api/forms/public/${encodeURIComponent(slug)}?tenantSlug=${encodeURIComponent(tenantSlug)}`);
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.form) {
          setForm(d.form);
          setTenantName(d.tenant?.name || '');
          setState('ready');
        } else {
          setState(r.status === 503 ? 'error' : 'notfound');
        }
      } catch { setState('error'); }
    })();
  }, [slug, tenantSlug]);

  const setVal = (id, v) => {
    setAnswers((a) => ({ ...a, [id]: v }));
    setErrors((e) => { const n = { ...e }; delete n[id]; return n; });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (submitting || !form) return;
    // Track 3: hidden fields ki validation skip — sirf visible required fields check
    const vis = formLogic_evaluateVisibility(form.fields, answers);
    const clean = {};
    for (const f of form.fields || []) {
      if (vis[f.id] === false) continue;
      clean[f.id] = answers[f.id];
    }
    const errs = {};
    for (const f of form.fields || []) {
      if (vis[f.id] === false) continue;
      const v = clean[f.id];
      const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
      if (f.required && empty) errs[f.id] = `"${f.label}" zaroori hai.`;
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      const first = document.querySelector('[data-field-error="1"]');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      const r = await fetch(`${API()}/api/forms/public/${encodeURIComponent(slug)}/submit?tenantSlug=${encodeURIComponent(tenantSlug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: clean, website: honeypot.current }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) {
        setSuccessMsg(d.message || form.successMessage);
        setState('done');
      } else if (r.status === 422 && d.details) {
        setSubmitError(d.details.join(' '));
      } else if (r.status === 429) {
        setSubmitError('Bohat zyada requests. Thori dair baad koshish karein.');
      } else {
        setSubmitError('Submission nahi ho saki. Dobara koshish karein.');
      }
    } catch {
      setSubmitError('Network error. Dobara koshish karein.');
    } finally {
      setSubmitting(false);
    }
  };

  if (state === 'loading') {
    return <div className="min-h-screen flex items-center justify-center bg-[#f4f5f7] text-gray-600">⏳ Form load ho raha hai…</div>;
  }
  if (state === 'notfound') {
    return <div className="min-h-screen flex items-center justify-center bg-[#f4f5f7]"><div className="text-center"><div className="text-5xl mb-3">📝</div><p className="text-gray-600">Form nahi mila.</p></div></div>;
  }
  if (state === 'error') {
    return <div className="min-h-screen flex items-center justify-center bg-[#f4f5f7] text-gray-600">⚠️ Filhal form available nahi. Baad me koshish karein.</div>;
  }
  if (state === 'done') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f4f5f7] p-6">
        <div className="max-w-md w-full rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-2xl">
          <div className="text-6xl mb-4">✅</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Ho gaya!</h1>
          <p className="text-gray-600">{successMsg || 'Shukriya! Aapka response mil gaya.'}</p>
          {tenantName && <p className="mt-4 text-xs text-slate-500">— {tenantName}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f5f7] py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-2xl">
          {tenantName && <p className="text-xs uppercase tracking-widest text-indigo-300/80 mb-2">{tenantName}</p>}
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{form.title}</h1>
          {form.description && <p className="text-gray-500 mb-6 whitespace-pre-line">{form.description}</p>}
          <form onSubmit={submit} className="space-y-5">
            {/* honeypot */}
            <input type="text" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true"
              onChange={(e) => { honeypot.current = e.target.value; }} />
            {(form.fields || []).map((f) => {
              const visible = formLogic_evaluateVisibility(form.fields, answers)[f.id] !== false;
              if (!visible) return null;
              return (
                <div key={f.id} data-field-error={errors[f.id] ? '1' : undefined}>
                  <label className="block text-sm font-medium text-gray-800 mb-1.5">
                    {f.label} {f.required && <span className="text-red-400">*</span>}
                  </label>
                  <FieldInput field={f} value={answers[f.id]} onChange={(v) => setVal(f.id, v)} error={errors[f.id]} uploadInfo={{ slug }} />
                  {errors[f.id] && <p className="mt-1 text-xs text-red-400">{errors[f.id]}</p>}
                </div>
              );
            })}
            {submitError && <p className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{submitError}</p>}
            <button type="submit" disabled={submitting}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-[#0f766e] px-6 py-3.5 font-semibold text-gray-900 shadow-lg shadow-indigo-500/25 hover:from-indigo-500 hover:to-[#0f766e] disabled:opacity-50 transition">
              {submitting ? '⏳ Bhej rahe hain…' : (form.submitButtonText || 'Submit')}
            </button>
          </form>
        </div>
        {tenantName && <p className="mt-4 text-center text-xs text-gray-500">Powered by {tenantName}</p>}
      </div>
    </div>
  );
}

