'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, DataTable } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;
const TONES = { pending: 'amber', approved: 'blue', rejected: 'red', processed: 'green' };

function RefundForm({ members, onSave, saving }) {
  const [f, setF] = useState({ memberId: '', amount: '', reason: '' });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ memberId: f.memberId, amount: Number(f.amount), reason: f.reason || null }); }}>
      <Field label="Member">
        <select className="input" value={f.memberId} onChange={(e) => setF({ ...f, memberId: e.target.value })} required>
          <option value="">Select member…</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </Field>
      <Field label="Amount (Rs)"><input type="number" min="1" className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required /></Field>
      <Field label="Reason"><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Double-charged for October" /></Field>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Submitting…' : 'Request Refund'}</button>
    </form>
  );
}

export default function RefundsPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'finance_officer']);
  const [refunds, setRefunds] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    const q = statusFilter ? `?status=${statusFilter}` : '';
    Promise.all([api.get(`/refunds${q}`), api.get('/members')])
      .then(([r, m]) => { setRefunds(r.refunds || []); setMembers(m.members || []); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (allowed) load(); }, [allowed, statusFilter]);

  if (!allowed) return <AccessDenied />;

  const request = async (data) => {
    setSaving(true);
    try { await api.post('/refunds', data); setShowForm(false); load(); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const act = async (id, action) => {
    try { await api.post(`/refunds/${id}/${action}`); load(); }
    catch (e) { setError(e.message); }
  };

  const columns = [
    { key: 'number', label: 'Number', render: (r) => <span className="font-mono text-sm text-slate-300">{r.number}</span> },
    { key: 'member', label: 'Member', render: (r) => <span className="text-sm text-white">{r.member?.name}</span> },
    { key: 'amount', label: 'Amount', render: (r) => <span className="text-white font-medium">{money(r.amount)}</span> },
    { key: 'status', label: 'Status', render: (r) => <Badge tone={TONES[r.status]}>{r.status}</Badge> },
    { key: 'reason', label: 'Reason', render: (r) => <span className="text-xs text-slate-400">{r.reason || '—'}</span> },
    {
      key: 'action', label: '', render: (r) => (
        <div className="flex gap-1">
          {r.status === 'pending' && (<>
            <button className="btn-secondary text-xs px-2 py-1" onClick={() => act(r.id, 'approve')}>Approve</button>
            <button className="text-xs px-2 py-1 text-red-300 hover:text-red-200" onClick={() => act(r.id, 'reject')}>Reject</button>
          </>)}
          {r.status === 'approved' && <button className="btn-secondary text-xs px-2 py-1" onClick={() => act(r.id, 'process')}>Mark Processed</button>}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Refunds"
        subtitle="Refund requests & processing"
        action={<button className="btn-primary" onClick={() => setShowForm(true)}>+ Request Refund</button>}
      />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      <div className="flex gap-2 mb-4">
        {[{ v: '', l: 'All' }, ...Object.keys(TONES).map((s) => ({ v: s, l: s[0].toUpperCase() + s.slice(1) }))].map((s) => (
          <button key={s.v} onClick={() => setStatusFilter(s.v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border capitalize ${statusFilter === s.v ? 'border-violet-400/60 bg-violet-500/20 text-violet-200' : 'border-white/10 text-slate-400 hover:bg-white/5'}`}>
            {s.l}
          </button>
        ))}
      </div>
      {loading ? <Spinner /> : <DataTable columns={columns} rows={refunds} emptyText="No refunds." />}
      {showForm && <Modal title="Request Refund" onClose={() => setShowForm(false)}><RefundForm members={members} onSave={request} saving={saving} /></Modal>}
    </div>
  );
}
