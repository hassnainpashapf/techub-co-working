'use client';

// Phase 35 Track 9: Tenant onboarding wizard (super_admin only).
// 3 steps: 1) Tenant info  2) Admin user  3) Review & seed → success screen.
import { useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, Field, Badge } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const PLANS = [
  { slug: 'starter', name: 'Starter' },
  { slug: 'growth', name: 'Growth' },
  { slug: 'enterprise', name: 'Enterprise' },
];

function slugify(s) {
  return (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const STEPS = ['Tenant info', 'Admin user', 'Review & create'];

export default function OnboardingPage() {
  const { allowed } = useRequireRoles(['super_admin']);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ name: '', slug: '', plan: 'starter', adminName: '', adminEmail: '', seedDemo: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [seeded, setSeeded] = useState(null);
  const [copied, setCopied] = useState(false);

  if (!allowed) return <AccessDenied />;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const next = () => { setError(''); setStep((s) => Math.min(s + 1, 2)); };
  const back = () => { setError(''); setStep((s) => Math.max(s - 1, 0)); };

  const validStep = () => {
    if (step === 0) return form.name.trim() && /^[a-z0-9-]+$/.test(form.slug);
    if (step === 1) return form.adminName.trim() && /.+@.+\..+/.test(form.adminEmail);
    return true;
  };

  const create = async () => {
    setBusy(true); setError(''); setCopied(false);
    try {
      const d = await api.post('/onboarding/create-tenant', {
        name: form.name.trim(),
        slug: form.slug.trim(),
        plan: form.plan,
        adminName: form.adminName.trim(),
        adminEmail: form.adminEmail.trim(),
      });
      setResult(d);
      if (form.seedDemo) {
        try {
          const s = await api.post('/onboarding/seed-demo', { tenantId: d.tenant.id });
          setSeeded(s);
        } catch (e) {
          setSeeded({ seeded: false, error: e.message });
        }
      }
    } catch (e) {
      setError(e.message || 'Tenant banane me masla hua.');
    } finally {
      setBusy(false);
    }
  };

  const copyPw = async () => {
    try {
      await navigator.clipboard.writeText(result.tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  // ---- success screen (temp password shown ONCE) ----
  if (result) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <PageHeader title="🎉 Tenant tayyar hai" sub={`${result.tenant.name} onboard ho gaya`} />
        <div className="card-premium p-6 mt-4">
          <div className="grid grid-cols-2 gap-3 text-sm mb-4">
            <div><span className="text-slate-400">Tenant:</span> <b className="text-white">{result.tenant.name}</b></div>
            <div><span className="text-slate-400">Slug:</span> <b className="text-white">{result.tenant.slug}</b></div>
            <div><span className="text-slate-400">Admin:</span> <b className="text-white">{result.admin.name}</b></div>
            <div><span className="text-slate-400">Email:</span> <b className="text-white">{result.admin.email}</b></div>
            <div><span className="text-slate-400">Plan:</span> <Badge tone="blue">{result.subscription.plan} (trial)</Badge></div>
            <div><span className="text-slate-400">Trial ends:</span> <b className="text-white">{new Date(result.subscription.trialEndsAt).toLocaleDateString()}</b></div>
          </div>
          <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-4 mb-4">
            <p className="text-xs text-amber-200/80 mb-1">⚠️ Temporary password — sirf ek dafa dikhega. Copy kar ke admin ko de dein:</p>
            <div className="flex items-center gap-3">
              <code className="text-2xl font-mono font-bold text-white tracking-wider">{result.tempPassword}</code>
              <button onClick={copyPw} className="btn-secondary btn-sm">{copied ? '✓ Copied' : 'Copy'}</button>
            </div>
          </div>
          {seeded && (
            <div className={`text-sm rounded-xl p-3 mb-4 ${seeded.seeded ? 'bg-emerald-500/10 border border-emerald-400/30 text-emerald-200' : 'bg-red-500/10 border border-red-400/30 text-red-200'}`}>
              {seeded.seeded
                ? `✓ Demo data seed ho gaya: ${seeded.units} units, ${seeded.members} members.`
                : `Demo seed nahi ho saka: ${seeded.error || 'unknown error'}`}
            </div>
          )}
          <p className="text-xs text-slate-400">Welcome email admin ko bhej di gayi hai (temp password ke sath). Pehle login par password change lazmi hoga.</p>
          <button
            onClick={() => { setResult(null); setSeeded(null); setStep(0); setForm({ name: '', slug: '', plan: 'starter', adminName: '', adminEmail: '', seedDemo: true }); }}
            className="btn-primary mt-4"
          >
            + Ek aur tenant onboard karo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <PageHeader title="Tenant Onboarding" sub="Naya workspace 3 steps me tayyar karo" />

      {/* stepper */}
      <div className="flex items-center gap-2 mt-6 mb-6">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2 flex-1">
            <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold ${i <= step ? 'bg-[#7c3aed] text-white' : 'bg-slate-700 text-slate-400'}`}>{i + 1}</div>
            <span className={`text-sm ${i <= step ? 'text-white font-semibold' : 'text-slate-500'}`}>{label}</span>
            {i < STEPS.length - 1 && <div className="flex-1 h-px bg-slate-700 mx-1" />}
          </div>
        ))}
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="card-premium p-6">
        {step === 0 && (
          <div className="space-y-4">
            <Field label="Tenant ka naam">
              <input className="input" value={form.name} onChange={(e) => { set('name', e.target.value); if (!form.slugTouched) set('slug', slugify(e.target.value)); }} placeholder="e.g. Techub Gulberg" />
            </Field>
            <Field label="Slug (URL me ayega)">
              <input className="input font-mono" value={form.slug} onChange={(e) => { set('slug', slugify(e.target.value)); set('slugTouched', true); }} placeholder="techub-gulberg" />
            </Field>
            <Field label="Plan (14-din trial)">
              <div className="grid grid-cols-3 gap-2">
                {PLANS.map((p) => (
                  <button key={p.slug} type="button" onClick={() => set('plan', p.slug)}
                    className={`rounded-xl border p-3 text-sm font-semibold ${form.plan === p.slug ? 'border-[#8b5cf6] bg-[#8b5cf6]/15 text-white' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                    {p.name}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <Field label="Admin ka naam">
              <input className="input" value={form.adminName} onChange={(e) => set('adminName', e.target.value)} placeholder="e.g. Ahmed Khan" />
            </Field>
            <Field label="Admin ka email">
              <input className="input" type="email" value={form.adminEmail} onChange={(e) => set('adminEmail', e.target.value)} placeholder="admin@company.com" />
            </Field>
            <p className="text-xs text-slate-400">🔑 Temporary password khud-bakhud banega aur yahin ek dafa dikhega + email me jayega. Pehle login par change lazmi hoga.</p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-800/60 p-4 text-sm space-y-1.5">
              <p><span className="text-slate-400">Tenant:</span> <b className="text-white">{form.name}</b> <span className="text-slate-500 font-mono">({form.slug})</span></p>
              <p><span className="text-slate-400">Plan:</span> <b className="text-white capitalize">{form.plan}</b> — 14 din trial</p>
              <p><span className="text-slate-400">Admin:</span> <b className="text-white">{form.adminName}</b> ({form.adminEmail})</p>
            </div>
            <label className="flex items-center gap-3 text-sm text-slate-200 cursor-pointer">
              <input type="checkbox" checked={form.seedDemo} onChange={(e) => set('seedDemo', e.target.checked)} className="h-4 w-4 accent-blue-600" />
              Demo data seed karo (6 units + 5 members)
            </label>
            <div className="text-xs text-slate-400 space-y-1">
              <p>✓ Default building ("Main Building") banegi</p>
              <p>✓ Trial subscription activate hogi</p>
              <p>✓ Welcome email temp password ke sath jayegi</p>
            </div>
          </div>
        )}

        <div className="flex justify-between mt-6">
          <button onClick={back} disabled={step === 0 || busy} className="btn-secondary disabled:opacity-40">← Peeche</button>
          {step < 2 ? (
            <button onClick={next} disabled={!validStep()} className="btn-primary disabled:opacity-40">Agla →</button>
          ) : (
            <button onClick={create} disabled={busy} className="btn-primary disabled:opacity-40">
              {busy ? <span className="inline-flex items-center gap-2"><Spinner size="sm" /> Bana raha hoon…</span> : '🚀 Tenant banao'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
