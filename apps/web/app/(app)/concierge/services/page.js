'use client';

// Phase 55 Track 1/10: Concierge Service Catalog management (staff).
// NOTE: ServiceProvider model + CRUD Track 3 (service-providers.prisma / routes/service-providers.js) ke hain.
// Yahan sirf ConciergeService manage hota hai; provider picker /api/service-providers?active=1 se aata hai.
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, EmptyState, StatCard, Badge, Modal, Field } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const CATEGORIES = ['errand', 'food', 'transport', 'wellness', 'business'];

function catTone(c) {
  return { errand: 'blue', food: 'amber', transport: 'violet', wellness: 'green', business: 'pink' }[c] || 'blue';
}

export default function ConciergeServicesPage() {
  const allowed = useRequireRoles('ceo', 'admin', 'super_admin', 'manager');
  const [services, setServices] = useState([]);
  const [counts, setCounts] = useState([]);
  const [providers, setProviders] = useState([]);
  const [catF, setCatF] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [svcOpen, setSvcOpen] = useState(null); // null | 'new' | service

  const load = async () => {
    try {
      setLoading(true); setErr('');
      const [s, p] = await Promise.all([
        api.get('/api/concierge-services'),
        api.get('/api/service-providers?active=1'),
      ]);
      setServices(s.services || []);
      setCounts(s.counts || []);
      setProviders(p.providers || []);
    } catch (e) {
      setErr(e.message || 'Load nahi ho saka');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;

  const filtered = services.filter((s) => {
    if (catF && s.category !== catF) return false;
    if (q && !s.name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const active = services.filter((s) => s.isActive).length;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="🛎️ Concierge Services" subtitle="Service catalog manage karein (providers Track 3 page se)" />

      {err && <ErrorBanner message={err} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Services" value={services.length} />
        <StatCard label="Active" value={active} tone="green" />
        <StatCard label="Providers" value={providers.length} tone="blue" />
        <StatCard label="Categories" value={CATEGORIES.length} tone="violet" />
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search services..."
          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-200 w-56" />
        <select value={catF} onChange={(e) => setCatF(e.target.value)}
          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-200">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="flex-1" />
        <button onClick={() => setSvcOpen('new')}
          className="px-4 py-2 rounded-lg bg-[#7c3aed] hover:bg-[#8b5cf6] text-white text-sm font-medium">+ Nayi Service</button>
      </div>

      {filtered.length === 0 ? <EmptyState title="Koi service nahi" /> : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((s) => (
            <div key={s.id} className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold text-slate-100">{s.name}</div>
                <Badge tone={s.isActive ? 'green' : 'red'}>{s.isActive ? 'Active' : 'Off'}</Badge>
              </div>
              <Badge tone={catTone(s.category)}>{s.category}</Badge>
              {s.description && <div className="text-sm text-slate-400 line-clamp-2">{s.description}</div>}
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-300 font-medium">{s.basePrice != null ? `PKR ${s.basePrice}` : 'Price on request'}</span>
                <span className="text-slate-500 text-xs">{s.provider?.name || 'No provider'}</span>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setSvcOpen(s)} className="text-xs px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-slate-200">Edit</button>
                <button onClick={async () => {
                  if (!confirm(`${s.isActive ? 'Deactivate' : 'Activate'} karna hai?`)) return;
                  try { await api.patch(`/api/concierge-services/${s.id}`, { isActive: !s.isActive }); load(); }
                  catch (e) { setErr(e.message || 'Update nahi ho saka'); }
                }} className="text-xs px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-slate-200">
                  {s.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {svcOpen && (
        <ServiceModal service={svcOpen === 'new' ? null : svcOpen} providers={providers}
          onClose={() => setSvcOpen(null)} onSaved={() => { setSvcOpen(null); load(); }} onError={setErr} />
      )}
    </div>
  );
}

function ServiceModal({ service, providers, onClose, onSaved, onError }) {
  const [form, setForm] = useState({
    name: service?.name || '',
    category: service?.category || 'errand',
    description: service?.description || '',
    basePrice: service?.basePrice ?? '',
    providerId: service?.providerId || '',
  });
  const save = async () => {
    try {
      const body = {
        ...form,
        basePrice: form.basePrice === '' ? null : Number(form.basePrice),
        providerId: form.providerId || null,
        description: form.description || null,
      };
      if (service) await api.patch(`/api/concierge-services/${service.id}`, body);
      else await api.post('/api/concierge-services', body);
      onSaved();
    } catch (e) { onError(e.message || 'Save nahi ho saka'); }
  };
  return (
    <Modal onClose={onClose} title={service ? 'Service Edit karein' : 'Nayi Service'}>
      <div className="space-y-3">
        <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-200" /></Field>
        <Field label="Category">
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-200">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Description"><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-200" /></Field>
        <Field label="Base price (PKR, khali = on request)"><input type="number" min="0" value={form.basePrice} onChange={(e) => setForm({ ...form, basePrice: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-200" /></Field>
        <Field label="Provider">
          <select value={form.providerId} onChange={(e) => setForm({ ...form, providerId: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-200">
            <option value="">No provider</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-white/10 text-sm text-slate-200">Cancel</button>
          <button onClick={save} className="px-4 py-2 rounded-lg bg-[#7c3aed] hover:bg-[#8b5cf6] text-white text-sm font-medium">Save</button>
        </div>
      </div>
    </Modal>
  );
}
