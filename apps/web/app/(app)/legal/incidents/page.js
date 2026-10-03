'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, DataTable, Modal, Field, Badge, Spinner, ErrorBanner, StatCard, EmptyState } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const CATEGORIES = [
  { value: 'safety', label: 'Safety' },
  { value: 'security', label: 'Security' },
  { value: 'theft', label: 'Theft' },
  { value: 'damage', label: 'Damage' },
  { value: 'other', label: 'Other' },
];
const SEVERITIES = [
  { value: 'low', label: 'Low', tone: 'slate' },
  { value: 'medium', label: 'Medium', tone: 'blue' },
  { value: 'high', label: 'High', tone: 'amber' },
  { value: 'critical', label: 'Critical', tone: 'red' },
];
const STATUSES = [
  { value: 'open', label: 'Open', tone: 'blue' },
  { value: 'investigating', label: 'Investigating', tone: 'amber' },
  { value: 'resolved', label: 'Resolved', tone: 'green' },
  { value: 'closed', label: 'Closed', tone: 'slate' },
];
const NEXT = { open: ['investigating', 'closed'], investigating: ['resolved', 'open'], resolved: ['closed', 'open'], closed: [] };

const toneOf = (list, v) => (list.find((x) => x.value === v) || {}).tone || 'slate';
const labelOf = (list, v) => (list.find((x) => x.value === v) || {}).label || v;
const fmt = (d) => { try { return new Date(d).toLocaleString(); } catch { return '—'; } };

const emptyForm = { title: '', category: 'safety', severity: 'medium', description: '', location: '', involvedMemberId: '', occurredAt: '' };

export default function IncidentsPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'super_admin', 'manager', 'ops']);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ open: 0, critical: 0, resolved30d: 0 });
  const [filters, setFilters] = useState({ status: '', severity: '', category: '', search: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // {mode:'add'} | {mode:'detail', incident}
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [memberQ, setMemberQ] = useState('');
  const [memberOpts, setMemberOpts] = useState([]);
  const [resolution, setResolution] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ limit: 50 });
      if (filters.status) qs.set('status', filters.status);
      if (filters.severity) qs.set('severity', filters.severity);
      if (filters.category) qs.set('category', filters.category);
      if (filters.search) qs.set('search', filters.search);
      const [list, sum] = await Promise.all([api.get('/incidents?' + qs), api.get('/incidents/summary')]);
      setItems(list.items || []);
      setSummary(sum || {});
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (allowed) load(); }, [allowed]);
  useEffect(() => {
    if (!allowed) return;
    const t = setTimeout(load, 400);
    return () => clearTimeout(t);
  }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!allowed) return <AccessDenied />;

  const searchMembers = async (q) => {
    setMemberQ(q);
    if (q.trim().length < 2) { setMemberOpts([]); return; }
    try {
      const d = await api.get('/members?search=' + encodeURIComponent(q) + '&limit=10');
      setMemberOpts(d.members || d.items || []);
    } catch {}
  };

  const submitReport = async () => {
    setSaving(true); setMsg('');
    try {
      const payload = {
        title: form.title.trim(),
        category: form.category,
        severity: form.severity,
        description: form.description.trim(),
        location: form.location.trim() || null,
        involvedMemberId: form.involvedMemberId || null,
        occurredAt: form.occurredAt ? new Date(form.occurredAt).toISOString() : undefined,
      };
      await api.post('/incidents', payload);
      setModal(null); setForm(emptyForm); setMemberQ(''); setMemberOpts([]);
      await load();
    } catch (e) { setMsg(e.message); }
    finally { setSaving(false); }
  };

  const openDetail = async (id) => {
    try {
      const d = await api.get('/incidents/' + id);
      setResolution(d.resolution || '');
      setModal({ mode: 'detail', incident: d });
    } catch (e) { setMsg(e.message); }
  };

  const changeStatus = async (status) => {
    if (!modal?.incident) return;
    setSaving(true); setMsg('');
    try {
      const body = { status };
      if (status === 'resolved') body.resolution = resolution.trim();
      const d = await api.post(`/incidents/${modal.incident.id}/status`, body);
      setModal({ mode: 'detail', incident: d });
      await load();
    } catch (e) { setMsg(e.message); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!modal?.incident) return;
    if (!window.confirm('Ye incident hata dein? Sirf open incidents hataye ja sakte hain.')) return;
    try { await api.del('/incidents/' + modal.incident.id); setModal(null); await load(); }
    catch (e) { setMsg(e.message); }
  };

  const rows = items.map((i) => ({
    id: i.id,
    title: i.title,
    category: <Badge tone="slate">{labelOf(CATEGORIES, i.category)}</Badge>,
    severity: <Badge tone={toneOf(SEVERITIES, i.severity)}>{labelOf(SEVERITIES, i.severity)}</Badge>,
    status: <Badge tone={toneOf(STATUSES, i.status)}>{labelOf(STATUSES, i.status)}</Badge>,
    occurred: fmt(i.occurredAt),
  }));

  return (
    <div>
      <PageHeader
        title="🚨 Incident Reports"
        sub="Safety, security, theft aur damage incidents — report, investigate aur resolve karein."
        actions={<button onClick={() => { setForm(emptyForm); setModal({ mode: 'add' }); }} className="rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white">+ Report Incident</button>}
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <StatCard label="Open / Investigating" value={summary.open || 0} accent="blue" icon="📂" />
        <StatCard label="Critical (open)" value={summary.critical || 0} accent="red" icon="🚨" />
        <StatCard label="Resolved (30d)" value={summary.resolved30d || 0} accent="green" icon="✅" />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="rounded-lg bg-[#12121f] border border-white/10 px-3 py-2 text-sm text-white">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={filters.severity} onChange={(e) => setFilters({ ...filters, severity: e.target.value })} className="rounded-lg bg-[#12121f] border border-white/10 px-3 py-2 text-sm text-white">
          <option value="">All severities</option>
          {SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} className="rounded-lg bg-[#12121f] border border-white/10 px-3 py-2 text-sm text-white">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Search title, location…" className="rounded-lg bg-[#12121f] border border-white/10 px-3 py-2 text-sm text-white" />
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {loading ? <Spinner /> : items.length === 0 ? (
        <EmptyState title="Koi incident nahi" hint="Abhi tak koi incident report nahi hua." />
      ) : (
        <DataTable
          columns={[
            { key: 'title', label: 'Title' },
            { key: 'category', label: 'Category' },
            { key: 'severity', label: 'Severity' },
            { key: 'status', label: 'Status' },
            { key: 'occurred', label: 'Occurred' },
            { key: 'action', label: '', render: (r) => (<button onClick={() => openDetail(r.id)} className="rounded-lg border border-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/5">View</button>) },
          ]}
          rows={rows}
        />
      )}

      {modal?.mode === 'add' && (
        <Modal title="Report Incident" onClose={() => setModal(null)}>
          {msg && <p className="mb-3 text-xs text-rose-300">{msg}</p>}
          <div className="grid gap-3">
            <Field label="Title"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Meeting room AC leak" className="w-full rounded-lg bg-[#12121f] border border-white/10 px-3 py-2 text-white" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category"><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full rounded-lg bg-[#12121f] border border-white/10 px-3 py-2 text-white">{CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field>
              <Field label="Severity"><select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} className="w-full rounded-lg bg-[#12121f] border border-white/10 px-3 py-2 text-white">{SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Location (optional)"><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Floor 2, corridor" className="w-full rounded-lg bg-[#12121f] border border-white/10 px-3 py-2 text-white" /></Field>
              <Field label="Occurred at"><input type="datetime-local" value={form.occurredAt} onChange={(e) => setForm({ ...form, occurredAt: e.target.value })} className="w-full rounded-lg bg-[#12121f] border border-white/10 px-3 py-2 text-white" /></Field>
            </div>
            <Field label="Description"><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={4} placeholder="Kya hua, kab, kaise…" className="w-full rounded-lg bg-[#12121f] border border-white/10 px-3 py-2 text-white" /></Field>
            <Field label="Involved member (optional)">
              <input value={memberQ} onChange={(e) => searchMembers(e.target.value)} placeholder="Member search karein…" className="w-full rounded-lg bg-[#12121f] border border-white/10 px-3 py-2 text-white" />
              {memberOpts.length > 0 && (
                <div className="mt-1 max-h-32 overflow-auto rounded-lg border border-white/10 bg-[#12121f]">
                  {memberOpts.map((m) => (
                    <button key={m.id} onClick={() => { setForm({ ...form, involvedMemberId: m.id }); setMemberQ(m.name); setMemberOpts([]); }} className="block w-full px-3 py-1.5 text-left text-xs text-white hover:bg-white/5">{m.name} <span className="text-white/40">{m.email || ''}</span></button>
                  ))}
                </div>
              )}
              {form.involvedMemberId && <p className="mt-1 text-xs text-emerald-300">✓ Member linked {memberQ && <button onClick={() => { setForm({ ...form, involvedMemberId: '' }); setMemberQ(''); }} className="underline">remove</button>}</p>}
            </Field>
            {form.severity === 'critical' && <p className="text-xs text-amber-300">⚠️ Critical incident par CEO/Admin ko foran notification jayegi.</p>}
            <button onClick={submitReport} disabled={saving || !form.title.trim() || form.description.trim().length < 10} className="rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? '…' : 'Submit Report'}</button>
          </div>
        </Modal>
      )}

      {modal?.mode === 'detail' && modal.incident && (
        <Modal title={modal.incident.title} onClose={() => setModal(null)}>
          {msg && <p className="mb-3 text-xs text-rose-300">{msg}</p>}
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge tone={toneOf(SEVERITIES, modal.incident.severity)}>{labelOf(SEVERITIES, modal.incident.severity)}</Badge>
            <Badge tone={toneOf(STATUSES, modal.incident.status)}>{labelOf(STATUSES, modal.incident.status)}</Badge>
            <Badge tone="slate">{labelOf(CATEGORIES, modal.incident.category)}</Badge>
          </div>
          <div className="grid gap-2 text-sm text-white/70">
            <div><span className="text-white/40">Location:</span> {modal.incident.location || '—'}</div>
            <div><span className="text-white/40">Occurred:</span> {fmt(modal.incident.occurredAt)}</div>
            <div><span className="text-white/40">Reported by:</span> {modal.incident.reportedByName || '—'}</div>
            <div><span className="text-white/40">Member:</span> {modal.incident.involvedMember?.name || '—'}</div>
          </div>
          <p className="mt-4 whitespace-pre-wrap rounded-lg border border-white/10 bg-[#12121f] p-3 text-sm text-white">{modal.incident.description}</p>
          {modal.incident.resolution && (
            <div className="mt-3"><div className="text-xs font-semibold text-emerald-300">Resolution</div><p className="mt-1 whitespace-pre-wrap text-sm text-white/70">{modal.incident.resolution}</p></div>
          )}
          <div className="mt-4">
            <div className="text-xs font-semibold text-white/60">Status workflow</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {NEXT[modal.incident.status].map((s) => (
                <button key={s} onClick={() => changeStatus(s)} disabled={saving} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/5 disabled:opacity-50">→ {labelOf(STATUSES, s)}</button>
              ))}
              {modal.incident.status === 'open' && (
                <button onClick={remove} disabled={saving} className="rounded-lg border border-rose-500/30 px-3 py-1.5 text-xs font-semibold text-rose-300 disabled:opacity-50">Delete</button>
              )}
            </div>
            {NEXT[modal.incident.status].includes('resolved') && (
              <Field label="Resolution note (resolved ke liye lazmi)"><textarea value={resolution} onChange={(e) => setResolution(e.target.value)} rows={2} className="w-full rounded-lg bg-[#12121f] border border-white/10 px-3 py-2 text-white" /></Field>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
