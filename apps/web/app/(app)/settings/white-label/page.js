'use client';

import { useEffect, useState } from 'react';
import { api, apiUpload, API_BASE } from '../../../../lib/api';
import { PageHeader, Field, Spinner, ErrorBanner } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const COLORS = ['#7c3aed', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#8b5cf6'];

export default function WhiteLabelPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin']);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [f, setF] = useState({ brandName: '', primaryColor: '#7c3aed', supportEmail: '', customDomain: '', hidePoweredBy: false });
  const [slug, setSlug] = useState('');
  const [hasLogo, setHasLogo] = useState(false);
  const [logoTick, setLogoTick] = useState(0);

  const load = () => {
    setLoading(true);
    api.get('/white-label')
      .then((d) => {
        const w = d.whiteLabel || {};
        setF({
          brandName: w.brandName || '',
          primaryColor: w.primaryColor || '#7c3aed',
          supportEmail: w.supportEmail || '',
          customDomain: w.customDomain || '',
          hidePoweredBy: !!w.hidePoweredBy,
        });
        setSlug(w.slug || '');
        setHasLogo(!!w.hasLogo);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (allowed) load(); }, [allowed]);

  if (!allowed) return <AccessDenied />;

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setError(''); setMsg('');
    try {
      const d = await api.put('/white-label', { ...f, brandName: f.brandName || null, supportEmail: f.supportEmail || null, customDomain: f.customDomain || null });
      const w = d.whiteLabel || {};
      setF({
        brandName: w.brandName || '', primaryColor: w.primaryColor || '#7c3aed',
        supportEmail: w.supportEmail || '', customDomain: w.customDomain || '', hidePoweredBy: !!w.hidePoweredBy,
      });
      setMsg('White-label settings saved.');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const uploadLogo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setError('');
    try {
      const fd = new FormData();
      fd.append('logo', file);
      await apiUpload('/settings/branding/logo', fd);
      setHasLogo(true);
      setLogoTick((t) => t + 1);
      setMsg('Logo uploaded.');
    } catch (err) { setError(err.message); }
    finally { setUploading(false); e.target.value = ''; }
  };

  const removeLogo = async () => {
    if (!confirm('Remove logo?')) return;
    try {
      await api.del('/settings/branding/logo');
      setHasLogo(false);
      setLogoTick((t) => t + 1);
    } catch (err) { setError(err.message); }
  };

  const previewName = f.brandName || 'Your Brand';
  const logoSrc = hasLogo && slug ? `${API_BASE}/branding/${slug}/logo?t=${logoTick}` : null;

  return (
    <div className="max-w-3xl">
      <PageHeader title="White Label" subtitle="Apne brand ke naam, logo aur rang me app ko dhalo" />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      {msg && <div className="mb-4 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">{msg}</div>}
      {loading ? <Spinner /> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <form onSubmit={save} className="card-premium p-6 space-y-4">
            <Field label="Brand name">
              <input className="input" value={f.brandName} onChange={(e) => setF({ ...f, brandName: e.target.value })} placeholder="Techub Co-Working" maxLength={80} />
            </Field>
            <div>
              <label className="label">Primary color</label>
              <div className="flex items-center gap-2 flex-wrap">
                <input type="color" value={f.primaryColor} onChange={(e) => setF({ ...f, primaryColor: e.target.value })} className="h-10 w-14 rounded-lg bg-transparent cursor-pointer" />
                {COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => setF({ ...f, primaryColor: c })}
                    className={`h-8 w-8 rounded-full border-2 ${f.primaryColor === c ? 'border-white' : 'border-transparent'}`}
                    style={{ background: c }} aria-label={c} />
                ))}
              </div>
            </div>
            <Field label="Support email">
              <input type="email" className="input" value={f.supportEmail} onChange={(e) => setF({ ...f, supportEmail: e.target.value })} placeholder="support@example.com" />
            </Field>
            <Field label="Custom domain (optional)">
              <input className="input" value={f.customDomain} onChange={(e) => setF({ ...f, customDomain: e.target.value })} placeholder="app.example.com" />
            </Field>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={f.hidePoweredBy} onChange={(e) => setF({ ...f, hidePoweredBy: e.target.checked })} className="w-4 h-4 accent-violet-500" />
              <span className="text-sm text-slate-300">"Powered by" badge chhupao</span>
            </label>
            <div>
              <label className="label">Logo</label>
              {logoSrc ? (
                <div className="flex items-center gap-3">
                  <div className="h-16 w-16 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden">
                    <img src={logoSrc} alt="Logo" className="max-w-full max-h-full object-contain" />
                  </div>
                  <button type="button" onClick={removeLogo} className="btn-ghost btn-sm text-red-300">Remove</button>
                </div>
              ) : (
                <label className="btn-ghost btn-sm cursor-pointer inline-block">
                  {uploading ? 'Uploading…' : 'Upload logo'}
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={uploadLogo} disabled={uploading} />
                </label>
              )}
              {logoSrc && (
                <label className="btn-ghost btn-sm cursor-pointer inline-block ml-2 mt-2">
                  Change
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={uploadLogo} disabled={uploading} />
                </label>
              )}
            </div>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save white-label settings'}</button>
          </form>

          <div>
            <p className="label">Live preview</p>
            <div className="rounded-2xl border border-white/10 bg-[#0a0a14] p-6">
              <div className="text-center mb-5">
                {logoSrc ? (
                  <img src={logoSrc} alt={previewName} className="h-14 w-14 object-contain mx-auto mb-3 rounded-xl" />
                ) : (
                  <div className="inline-flex h-14 w-14 rounded-xl items-center justify-center text-2xl font-bold text-white mb-3" style={{ background: f.primaryColor }}>
                    {previewName.charAt(0).toUpperCase()}
                  </div>
                )}
                <h3 className="text-xl font-bold text-white">{previewName}</h3>
                <p className="text-slate-400 text-sm mt-1">Sign in to your workspace</p>
              </div>
              <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
                <div className="h-10 rounded-lg bg-white/5 border border-white/10" />
                <div className="h-10 rounded-lg bg-white/5 border border-white/10" />
                <button type="button" className="w-full h-10 rounded-lg text-white font-semibold" style={{ background: f.primaryColor }}>Sign in</button>
              </div>
              {!f.hidePoweredBy && (
                <p className="text-center text-xs text-slate-500 mt-4">Powered by CoworkOS</p>
              )}
              {f.supportEmail && (
                <p className="text-center text-xs text-slate-500 mt-2">Need help? {f.supportEmail}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
