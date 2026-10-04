'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, DataTable } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const PURPOSES = [
  { v: 'meeting', l: 'Meeting' },
  { v: 'tour', l: 'Space Tour' },
  { v: 'interview', l: 'Interview' },
  { v: 'delivery', l: 'Delivery' },
  { v: 'other', l: 'Other' },
];
const purposeLabel = (v) => PURPOSES.find((p) => p.v === v)?.l || v;

function CheckInForm({ onSave, saving }) {
  const [form, setForm] = useState({ name: '', phone: '', cnic: '', purpose: 'meeting', hostName: '', badgeNo: '', notes: '' });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Full name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label="Phone"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="03xx-xxxxxxx" /></Field>
        <Field label="CNIC"><input className="input" value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} placeholder="xxxxx-xxxxxxx-x" /></Field>
        <Field label="Purpose">
          <select className="input" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })}>
            {PURPOSES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
          </select>
        </Field>
        <Field label="Host (who to meet)"><input className="input" value={form.hostName} onChange={(e) => setForm({ ...form, hostName: e.target.value })} placeholder="Member/staff name" /></Field>
        <Field label="Badge no"><input className="input" value={form.badgeNo} onChange={(e) => setForm({ ...form, badgeNo: e.target.value })} placeholder="V-001" /></Field>
        <div className="sm:col-span-2"><Field label="Notes"><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
      </div>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Checking in…' : 'Check In'}</button>
    </form>
  );
}

export default function VisitorsPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'manager', 'receptionist', 'operations_manager']);
  const [visitors, setVisitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('today');
  const [tab, setTab] = useState('walkin');
  const [invites, setInvites] = useState([]);
  const [codeSearch, setCodeSearch] = useState('');

  const loadInvites = (q) => {
    const s = q !== undefined ? q : codeSearch;
    api.get(`/visitor-invites?upcoming=true${s ? `&search=${encodeURIComponent(s)}` : ''}`)
      .then((d) => setInvites(d.invites || []))
      .catch((e) => setError(e.message));
  };
  useEffect(() => { if (allowed && tab === 'prereg') loadInvites(''); }, [allowed, tab]);

  const fastCheckIn = async (code) => {
    try {
      await api.post(`/visitor-invites/checkin/${code}`, {});
      loadInvites('');
      setCodeSearch('');
    } catch (e) { setError(e.message); }
  };

  const load = () => {
    setLoading(true);
    const q = filter === 'inside' ? '?inside=true' : filter === 'today' ? '?today=true' : '';
    api.get(`/visitors${q}`)
      .then((d) => setVisitors(d.visitors || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (allowed) load(); }, [allowed, filter]);

  if (!allowed) return <AccessDenied />;

  const checkIn = async (data) => {
    setSaving(true);
    try {
      await api.post('/visitors/check-in', data);
      setShowForm(false);
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const checkOut = async (id) => {
    try {
      await api.post(`/visitors/${id}/check-out`);
      load();
    } catch (e) { setError(e.message); }
  };

  const inside = visitors.filter((v) => !v.checkOutAt).length;

  const columns = [
    { key: 'name', label: 'Visitor', render: (v) => <div><div className="font-medium text-gray-900">{v.name}</div><div className="text-xs text-gray-500">{v.phone || ''}</div></div> },
    { key: 'purpose', label: 'Purpose', render: (v) => <span className="text-sm text-gray-600">{purposeLabel(v.purpose)}</span> },
    { key: 'host', label: 'Host', render: (v) => <span className="text-sm text-gray-600">{v.hostMember?.name || v.hostName || '—'}</span> },
    { key: 'badge', label: 'Badge', render: (v) => <span className="font-mono text-sm text-gray-600">{v.badgeNo || '—'}</span> },
    { key: 'in', label: 'Check-in', render: (v) => <span className="text-xs text-gray-500">{new Date(v.checkInAt).toLocaleTimeString()}</span> },
    { key: 'status', label: 'Status', render: (v) => v.checkOutAt ? <Badge tone="slate">Out</Badge> : <Badge tone="green">Inside</Badge> },
    {
      key: 'action', label: '', render: (v) => !v.checkOutAt ? (
        <button className="btn-secondary text-xs px-3 py-1" onClick={() => checkOut(v.id)}>Check Out</button>
      ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Visitors"
        subtitle={`${inside} visitor${inside === 1 ? '' : 's'} currently inside`}
        action={<button className="btn-primary" onClick={() => setShowForm(true)}>+ Check In</button>}
      />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      <div className="flex gap-2 mb-3 flex-wrap items-center">
        {[['walkin', 'Walk-in'], ['prereg', 'Pre-registered']].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${tab === v ? 'border-teal-500/60 bg-teal-600/20 text-violet-700' : 'border-gray-200 text-gray-500 hover:bg-gray-100'}`}>
            {l}
          </button>
        ))}
        {tab === 'prereg' && (
          <div className="flex gap-2 ml-2">
            <input className="input !w-44" placeholder="Search name or code…" value={codeSearch}
              onChange={(e) => { setCodeSearch(e.target.value); loadInvites(e.target.value); }} />
          </div>
        )}
      </div>
      {tab === 'walkin' ? (<>
      <div className="flex gap-2 mb-3">
        {[['today', 'Today'], ['inside', 'Inside Now'], ['all', 'All']].map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${filter === v ? 'border-teal-500/60 bg-teal-600/20 text-violet-700' : 'border-gray-200 text-gray-500 hover:bg-gray-100'}`}>
            {l}
          </button>
        ))}
      </div>
      {loading ? <Spinner /> : <DataTable columns={columns} rows={visitors} emptyText="No visitors." />}
      </>) : (
      <div className="grid gap-3">
        {invites.length === 0 ? (
          <div className="card-premium p-5 text-center text-sm text-gray-500">No pending pre-registrations.</div>
        ) : invites.map((i) => (
          <div key={i.id} className="card-premium p-4 flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-gray-900">{i.visitorName}</div>
              <div className="text-xs text-gray-500">
                Host: {i.member?.name || '—'} · {new Date(i.expectedAt).toLocaleString()} · {purposeLabel(i.purpose)} ·{' '}
                Code <span className="font-mono font-bold text-teal-700 tracking-widest">{i.code}</span>
              </div>
            </div>
            <button className="btn-primary text-xs px-4 py-1.5 shrink-0" onClick={() => fastCheckIn(i.code)}>Check In</button>
          </div>
        ))}
      </div>
      )}
      {showForm && (
        <Modal title="Visitor Check-In" onClose={() => setShowForm(false)}>
          <CheckInForm onSave={checkIn} saving={saving} />
        </Modal>
      )}
    </div>
  );
}
