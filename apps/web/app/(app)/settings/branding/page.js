'use client';

import { useEffect, useState } from 'react';
import { api, apiUpload, API_BASE } from '../../../../lib/api';
import { PageHeader, Field, Spinner, ErrorBanner } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const COLORS = ['#0f766e', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#0f766e'];

export default function BrandingPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin']);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [f, setF] = useState({ name: '', tagline: '', primaryColor: '#0f766e', email: '', phone: '', address: '' });
  const [hasLogo, setHasLogo] = useState(false);
  const [logoTick, setLogoTick] = useState(0);
  const [slug, setSlug] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/settings/branding')
      .then((d) => {
        const b = d.branding || {};
        setF({
          name: b.name || '',
          tagline: b.tagline || '',
          primaryColor: b.primaryColor || '#0f766e',
          email: b.email || '',
          phone: b.phone || '',
          address: b.address || '',
        });
        setHasLogo(!!b.hasLogo);
        setSlug(b.slug || '');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (allowed) load(); }, [allowed]);

  if (!allowed) return <AccessDenied />;

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.put('/settings/branding', f);
      setMsg('Branding saved! 🎨');
      setTimeout(() => setMsg(''), 3000);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const uploadLogo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('logo', file);
      await apiUpload('/settings/branding/logo', fd);
      setHasLogo(true);
      setLogoTick((t) => t + 1);
      setMsg('Logo uploaded! 🎨');
      setTimeout(() => setMsg(''), 3000);
    } catch (err) { setError(err.message); }
    finally { setUploading(false); e.target.value = ''; }
  };

  const removeLogo = async () => {
    if (!confirm('Remove logo?')) return;
    try { await api.del('/settings/branding/logo'); setHasLogo(false); setLogoTick((t) => t + 1); }
    catch (err) { setError(err.message); }
  };

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  return (
    <div>
      <PageHeader title="Branding" subtitle="Your organization's identity" />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      {msg && <div className="mb-4 bg-green-500/10 border border-green-500/30 text-green-300 text-sm rounded-xl px-4 py-3">{msg}</div>}
      {loading ? <Spinner /> : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="card-premium p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Logo</h3>
            <div className="w-32 h-32 rounded-2xl bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden mb-4">
              {hasLogo && slug ? (
                <img src={`${API_BASE}/branding/${slug}/logo?t=${logoTick}`} alt="Logo" className="max-w-full max-h-full object-contain" />
              ) : (
                <span className="text-4xl">🏢</span>
              )}
            </div>
            <label className="btn-secondary inline-block cursor-pointer text-sm">
              {uploading ? 'Uploading…' : 'Upload Logo'}
              <input type="file" className="hidden" accept=".png,.jpg,.jpeg,.webp,.svg" onChange={uploadLogo} disabled={uploading} />
            </label>
            {hasLogo && <button onClick={removeLogo} className="ml-2 text-xs text-red-700 hover:text-red-700">Remove</button>}
            <p className="text-[11px] text-slate-500 mt-2">PNG, JPG, WebP or SVG — max 5MB</p>
          </div>
          <div className="card-premium p-6 lg:col-span-2">
            <h3 className="font-semibold text-gray-900 mb-4">Organization Details</h3>
            <form onSubmit={save}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                <Field label="Organization name"><input className="input" value={f.name} onChange={set('name')} /></Field>
                <Field label="Tagline"><input className="input" value={f.tagline} onChange={set('tagline')} placeholder="e.g. Work. Connect. Grow." /></Field>
                <Field label="Email"><input type="email" className="input" value={f.email} onChange={set('email')} /></Field>
                <Field label="Phone"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
              </div>
              <Field label="Address"><input className="input" value={f.address} onChange={set('address')} /></Field>
              <Field label="Primary color">
                <div className="flex items-center gap-2 flex-wrap">
                  {COLORS.map((c) => (
                    <button key={c} type="button" onClick={() => setF({ ...f, primaryColor: c })}
                      className={`w-9 h-9 rounded-full border-2 transition-transform ${f.primaryColor === c ? 'border-white scale-110' : 'border-transparent'}`}
                      style={{ background: c }} title={c} />
                  ))}
                  <input type="color" value={f.primaryColor} onChange={set('primaryColor')} className="w-9 h-9 rounded-full cursor-pointer bg-transparent" />
                  <span className="text-xs text-gray-500 font-mono">{f.primaryColor}</span>
                </div>
              </Field>
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Branding'}</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
