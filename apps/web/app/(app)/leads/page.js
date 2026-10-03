'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner } from '../../../components/ui';

const STAGES = [
  { key: 'new', label: 'New', tone: 'blue' },
  { key: 'contacted', label: 'Contacted', tone: 'amber' },
  { key: 'visit', label: 'Visit', tone: 'violet' },
  { key: 'booked', label: 'Booked', tone: 'green' },
  { key: 'won', label: 'Won', tone: 'green' },
  { key: 'lost', label: 'Lost', tone: 'slate' },
];
const SOURCES = ['walkin', 'website', 'referral', 'social', 'other'];

function LeadForm({ initial, onSave, saving }) {
  const [f, setF] = useState({
    name: initial?.name || '',
    email: initial?.email || '',
    phone: initial?.phone || '',
    company: initial?.company || '',
    source: initial?.source || 'walkin',
    interest: initial?.interest || '',
    budget: initial?.budget ?? '',
    stage: initial?.stage || 'new',
    notes: initial?.notes || '',
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ ...f, budget: f.budget === '' ? null : Number(f.budget) }); }}>
      <Field label="Name *"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required placeholder="Lead name" /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Phone"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="0300-1234567" /></Field>
        <Field label="Email"><input type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="lead@example.com" /></Field>
        <Field label="Company"><input className="input" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} placeholder="Company" /></Field>
        <Field label="Source">
          <select className="input" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Interest"><input className="input" value={f.interest} onChange={(e) => setF({ ...f, interest: e.target.value })} placeholder="e.g. Private office" /></Field>
        <Field label="Budget"><input type="number" min="0" className="input" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} placeholder="Rs" /></Field>
      </div>
      <Field label="Notes"><textarea className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Notes…" /></Field>
      <button type="submit" className="btn-primary w-full" disabled={saving || !f.name.trim()}>{saving ? 'Saving…' : (initial ? 'Update Lead' : 'Add Lead')}</button>
    </form>
  );
}

function LeadCard({ lead, onMove, onEdit, onConvert, onDelete }) {
  return (
    <div className="card-premium p-3 mb-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-white text-sm truncate">{lead.name}</div>
          {lead.company && <div className="text-xs text-slate-400 truncate">{lead.company}</div>}
        </div>
        {lead.convertedMemberId && <Badge tone="green">Member</Badge>}
      </div>
      <div className="mt-1.5 space-y-0.5 text-xs text-slate-400">
        {lead.phone && <div>📞 {lead.phone}</div>}
        {lead.email && <div className="truncate">✉️ {lead.email}</div>}
        {lead.budget != null && <div>💰 Rs {Number(lead.budget).toLocaleString()}</div>}
        {lead.interest && <div>🎯 {lead.interest}</div>}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <select
          className="input !py-1 !px-2 !text-xs flex-1 min-w-[90px]"
          value={lead.stage}
          onChange={(e) => onMove(lead, e.target.value)}
          title="Move stage"
        >
          {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <button onClick={() => onEdit(lead)} className="btn-secondary !py-1 !px-2 !text-xs">Edit</button>
        {!lead.convertedMemberId && lead.stage !== 'lost' && (
          <button onClick={() => onConvert(lead)} className="btn-primary !py-1 !px-2 !text-xs" title="Convert to member">Convert to member</button>
        )}
        <button onClick={() => onDelete(lead)} className="!py-1 !px-2 !text-xs text-red-400 hover:text-red-300">✕</button>
      </div>
    </div>
  );
}

// Phase 39 Track 7: convert-to-member modal (plan, unit, start date) + success with member link.
function ConvertModal({ lead, onClose, onDone }) {
  const [plans, setPlans] = useState([]);
  const [units, setUnits] = useState([]);
  const [f, setF] = useState({
    planId: '',
    unitId: '',
    startDate: new Date().toISOString().slice(0, 10),
    rentAmount: lead?.budget != null ? String(lead.budget) : '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    Promise.all([api.get('/membership-plans?isActive=true'), api.get('/spaces/units?status=vacant')])
      .then(([p, u]) => {
        setPlans(p.plans || []);
        setUnits((u.units || []).filter((x) => x.type !== 'meeting_room'));
      })
      .catch((e) => setError(e.message));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = {
        planId: f.planId || null,
        unitId: f.unitId || null,
        startDate: f.startDate || undefined,
        rentAmount: f.rentAmount === '' ? null : Number(f.rentAmount),
      };
      const data = await api.post(`/leads/${lead.id}/convert`, body);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!lead} onClose={onClose} title={`Convert to member — ${lead?.name || ''}`}>
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      {result ? (
        <div className="text-center py-4">
          <div className="text-4xl mb-3">🎉</div>
          <div className="text-white font-semibold text-lg">"{result.member.name}" is now a member!</div>
          {result.contract && (
            <div className="text-sm text-slate-400 mt-2">Contract created — {result.contract.unitId ? `unit ${result.contract.unitId}` : ''} from {new Date(result.contract.startDate).toLocaleDateString()}</div>
          )}
          <a href="/members" className="btn-primary inline-block mt-4" onClick={() => { onClose(); onDone(); }}>
            View member →
          </a>
        </div>
      ) : (
        <form onSubmit={submit}>
          <Field label="Membership plan (optional)">
            <select className="input" value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>
              <option value="">No plan</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — Rs {Number(p.price).toLocaleString()}</option>)}
            </select>
          </Field>
          <Field label="Unit (optional — creates contract)">
            <select className="input" value={f.unitId} onChange={(e) => {
              const u = units.find((x) => x.id === e.target.value);
              setF({ ...f, unitId: e.target.value, rentAmount: u ? String(Number(u.monthlyPrice)) : f.rentAmount });
            }}>
              <option value="">No unit / contract</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.code} — Rs {Number(u.monthlyPrice).toLocaleString()}/mo</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Start date">
              <input type="date" className="input" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
            </Field>
            <Field label="Rent amount (Rs)">
              <input type="number" min="0" className="input" value={f.rentAmount} onChange={(e) => setF({ ...f, rentAmount: e.target.value })} placeholder="0" />
            </Field>
          </div>
          {!lead?.phone && <div className="text-xs text-amber-400 mb-3">⚠️ Lead has no phone — add one first (phone is required for members).</div>}
          <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Converting…' : 'Convert to member'}</button>
        </form>
      )}
    </Modal>
  );
}

export default function LeadsPage() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // 'create' | lead-obj | null
  const [convertLead, setConvertLead] = useState(null); // lead being converted
  const [saving, setSaving] = useState(false);

  const load = async (q = '') => {
    setLoading(true);
    setError('');
    try {
      const params = q ? `?search=${encodeURIComponent(q)}` : '';
      const data = await api.get(`/leads${params}`);
      setLeads(data.leads || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async (payload) => {
    setSaving(true);
    try {
      if (modal === 'create') {
        await api.post('/leads', payload);
      } else {
        await api.patch(`/leads/${modal.id}`, payload);
      }
      setModal(null);
      load(search);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const move = async (lead, stage) => {
    if (stage === lead.stage) return;
    try {
      await api.patch(`/leads/${lead.id}`, { stage });
      load(search);
    } catch (err) {
      setError(err.message);
    }
  };

  const convert = async (lead) => {
    setConvertLead(lead);
  };

  const del = async (lead) => {
    if (!confirm(`Delete lead "${lead.name}"?`)) return;
    try {
      await api.delete(`/leads/${lead.id}`);
      load(search);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <PageHeader
        title="Leads"
        subtitle="Sales pipeline — drag leads through stages"
        action={<button onClick={() => setModal('create')} className="btn-primary">+ Add Lead</button>}
      />
      <div className="mb-4 max-w-sm">
        <input
          className="input"
          placeholder="Search name, company, phone, email…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') load(search); }}
        />
      </div>
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      {loading ? <Spinner /> : (
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
          {STAGES.map((st) => {
            const items = leads.filter((l) => l.stage === st.key);
            return (
              <div key={st.key} className="rounded-xl bg-[#0d0d1a] border border-white/5 p-3 min-h-[200px]">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-white">{st.label}</span>
                  <Badge tone={st.tone}>{items.length}</Badge>
                </div>
                {items.map((lead) => (
                  <LeadCard key={lead.id} lead={lead} onMove={move} onEdit={setModal} onConvert={convert} onDelete={del} />
                ))}
                {items.length === 0 && <div className="text-xs text-slate-600 text-center py-6">No leads</div>}
              </div>
            );
          })}
        </div>
      )}
      <Modal open={!!modal} onClose={() => setModal(null)} title={modal === 'create' ? 'Add Lead' : 'Edit Lead'}>
        {modal && <LeadForm initial={modal === 'create' ? null : modal} onSave={save} saving={saving} />}
      </Modal>
      {convertLead && (
        <ConvertModal
          lead={convertLead}
          onClose={() => setConvertLead(null)}
          onDone={() => load(search)}
        />
      )}
    </div>
  );
}
