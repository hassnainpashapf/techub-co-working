'use client';

// Phase 42 Track 3: Leave Management — meri leaves + balances + team approvals.
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, DataTable, Modal, Field, Spinner, EmptyState, ErrorBanner, Badge } from '../../../../components/ui';

const MANAGERS = ['ceo', 'admin', 'super_admin', 'manager'];
const TYPE_LABEL = { annual: '🏖️ Annual', sick: '🤒 Sick', casual: '☕ Casual', unpaid: '💸 Unpaid' };
const STATUS_TONE = { pending: 'amber', approved: 'green', rejected: 'red' };

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function LeavesPage() {
  const [me, setMe] = useState(null);
  const [leaves, setLeaves] = useState([]);
  const [balances, setBalances] = useState([]);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(false);
  const [rejecting, setRejecting] = useState(null);
  const [form, setForm] = useState({ type: 'annual', fromDate: '', toDate: '', reason: '' });
  const [rejectReason, setRejectReason] = useState('');
  const [saving, setSaving] = useState(false);

  const isManager = me && MANAGERS.includes(me.role);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [meRes, mineRes] = await Promise.all([api.get('/auth/me'), api.get('/leaves/mine')]);
      const user = meRes.data.user;
      setMe(user);
      setLeaves(mineRes.data.leaves || []);
      setBalances(mineRes.data.balances || []);
      if (MANAGERS.includes(user.role)) {
        const p = await api.get('/leaves/pending');
        setPending(p.data.leaves || []);
      }
    } catch (e) {
      setError(e?.response?.data?.error?.message || e?.response?.data?.error || 'load_failed');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function submitRequest(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/leaves/request', form);
      setModal(false);
      setForm({ type: 'annual', fromDate: '', toDate: '', reason: '' });
      await load();
    } catch (e) {
      setError(e?.response?.data?.error?.message || e?.response?.data?.error || 'request_failed');
    } finally {
      setSaving(false);
    }
  }

  async function decide(id, decision) {
    setSaving(true);
    try {
      if (decision === 'approve') await api.post(`/leaves/${id}/approve`);
      else await api.post(`/leaves/${id}/reject`, { reason: rejectReason || null });
      setRejecting(null);
      setRejectReason('');
      await load();
    } catch (e) {
      setError(e?.response?.data?.error?.message || e?.response?.data?.error || 'decision_failed');
    } finally {
      setSaving(false);
    }
  }

  const pendingCount = leaves.filter((l) => l.status === 'pending').length;

  if (loading) return <Spinner />;
  return (
    <div>
      <PageHeader
        title="Leaves"
        subtitle="Leave requests, balances aur approvals"
        action={<button className="btn btn-primary" onClick={() => setModal(true)}>+ Request Leave</button>}
      />
      {error && <ErrorBanner message={error} />}

      {/* Balances */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        {balances.length === 0 && (
          <div className="col-span-full"><EmptyState title="No balances yet" description="Linked employee record banne par yearly balances yahan dikhengi." /></div>
        )}
        {balances.map((b) => (
          <StatCard
            key={`${b.year}-${b.type}`}
            title={`${TYPE_LABEL[b.type] || b.type} · ${b.year}`}
            value={`${b.allocated - b.used} / ${b.allocated}`}
            subtitle="remaining / allocated"
          />
        ))}
      </div>

      {/* My requests */}
      <h2 className="text-lg font-semibold mb-3">My Requests</h2>
      {leaves.length === 0 ? (
        <EmptyState title="No leave requests" description="Abhi tak koi leave request nahi bheji." />
      ) : (
        <DataTable
          columns={[
            { key: 'type', label: 'Type', render: (l) => TYPE_LABEL[l.type] || l.type || '—' },
            { key: 'dates', label: 'Dates', render: (l) => `${fmtDate(l.fromDate)} → ${fmtDate(l.toDate)}` },
            { key: 'days', label: 'Days', render: (l) => l.days ?? '—' },
            { key: 'reason', label: 'Reason', render: (l) => l.reason || '—' },
            { key: 'status', label: 'Status', render: (l) => <Badge tone={STATUS_TONE[l.status] || 'slate'}>{l.status}</Badge> },
          ]}
          rows={leaves}
        />
      )}

      {/* Team approvals (managers) */}
      {isManager && (
        <div className="mt-3">
          <h2 className="text-lg font-semibold mb-3">Team Approvals {pending.length > 0 && <Badge tone="amber">{pending.length}</Badge>}</h2>
          {pending.length === 0 ? (
            <EmptyState title="Nothing pending" description="Koi pending leave request nahi hai." />
          ) : (
            <DataTable
              columns={[
                { key: 'user', label: 'Employee', render: (l) => l.user?.name || l.userId },
                { key: 'type', label: 'Type', render: (l) => TYPE_LABEL[l.type] || l.type || '—' },
                { key: 'dates', label: 'Dates', render: (l) => `${fmtDate(l.fromDate)} → ${fmtDate(l.toDate)} (${l.days ?? '?'}d)` },
                { key: 'reason', label: 'Reason', render: (l) => l.reason || '—' },
                {
                  key: 'actions', label: 'Actions',
                  render: (l) => (
                    <div className="flex gap-2">
                      <button className="btn btn-sm btn-success" disabled={saving} onClick={() => decide(l.id, 'approve')}>Approve</button>
                      <button className="btn btn-sm btn-danger" disabled={saving} onClick={() => setRejecting(l)}>Reject</button>
                    </div>
                  ),
                },
              ]}
              rows={pending}
            />
          )}
        </div>
      )}

      {/* Request modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="Request Leave">
        <form onSubmit={submitRequest}>
          <Field label="Leave type">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="input">
              {Object.entries(TYPE_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From"><input type="date" required value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value })} className="input" /></Field>
            <Field label="To"><input type="date" required value={form.toDate} onChange={(e) => setForm({ ...form, toDate: e.target.value })} className="input" /></Field>
          </div>
          <Field label="Reason"><textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="input" rows={3} /></Field>
          <button type="submit" disabled={saving} className="btn btn-primary w-full">{saving ? 'Sending…' : 'Send Request'}</button>
        </form>
      </Modal>

      {/* Reject modal */}
      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title="Reject Leave">
        <Field label="Reason (optional)">
          <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="input" rows={3} />
        </Field>
        <div className="flex gap-2 justify-end">
          <button className="btn" onClick={() => setRejecting(null)}>Cancel</button>
          <button className="btn btn-danger" disabled={saving} onClick={() => decide(rejecting.id, 'reject')}>Reject</button>
        </div>
      </Modal>
    </div>
  );
}
