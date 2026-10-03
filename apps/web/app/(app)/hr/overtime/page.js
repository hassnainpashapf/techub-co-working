'use client';

// Phase 42 Track 4: Overtime Tracking — request form + my history + approvals inbox.
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, DataTable, Modal, Field, Spinner, EmptyState, ErrorBanner, Badge } from '../../../../components/ui';

const STATUS_TONE = { pending: 'amber', approved: 'green', rejected: 'red' };
const fmtMin = (m) => `${Math.floor(m / 60)}h ${m % 60}m`;

export default function OvertimePage() {
  const [mine, setMine] = useState([]);
  const [totals, setTotals] = useState({ pending: 0, approved: 0 });
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), minutes: 120, reason: '' });
  const [submitting, setSubmitting] = useState(false);
  const [isManager, setIsManager] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const m = await api('/overtime/mine');
      setMine(m.overtime || []); setTotals(m.totals || { pending: 0, approved: 0 });
      try {
        const p = await api('/overtime/pending');
        setPending(p.overtime || []); setIsManager(true);
      } catch { setIsManager(false); }
    } catch (e) { setError(e.message || 'Load failed'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.reason.trim() || !form.minutes) { setError('Reason aur minutes lazmi hain'); return; }
    setSubmitting(true); setError('');
    try {
      await api('/overtime/request', { method: 'POST', body: JSON.stringify({ date: form.date, minutes: Number(form.minutes), reason: form.reason }) });
      setModal(false);
      setForm({ date: new Date().toISOString().slice(0, 10), minutes: 120, reason: '' });
      load();
    } catch (e) { setError(e.message || 'Request failed'); }
    finally { setSubmitting(false); }
  };

  const decide = async (id, action) => {
    try {
      await api(`/overtime/${id}/${action}`, { method: 'POST' });
      load();
    } catch (e) { setError(e.message || 'Action failed'); }
  };

  const stats = [
    { label: '⏳ Pending (mine)', value: fmtMin(totals.pending) },
    { label: '✅ Approved (mine)', value: fmtMin(totals.approved) },
    { label: '📥 Pending approvals', value: pending.length },
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader title="⏱️ Overtime" subtitle="Overtime requests aur approvals" action={<button className="btn-primary" onClick={() => setModal(true)}>+ Request Overtime</button>} />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      {loading ? <Spinner /> : (
        <>
          <div className="grid grid-cols-3 gap-4 mb-6">
            {stats.map((s) => <StatCard key={s.label} label={s.label} value={s.value} />)}
          </div>

          {isManager && (
            <div className="mb-8">
              <h2 className="text-lg font-semibold mb-3">📥 Pending Approvals</h2>
              {pending.length === 0 ? <EmptyState title="Koi pending request nahi" /> : (
                <DataTable
                  columns={[
                    { key: 'employee', label: 'Employee', render: (r) => r.employee?.name || '—' },
                    { key: 'date', label: 'Date', render: (r) => new Date(r.date).toLocaleDateString() },
                    { key: 'minutes', label: 'Time', render: (r) => fmtMin(r.minutes) },
                    { key: 'reason', label: 'Reason', render: (r) => <span className="text-sm">{r.reason}</span> },
                    { key: 'actions', label: 'Actions', render: (r) => (
                      <div className="flex gap-2">
                        <button className="btn-sm btn-success" onClick={() => decide(r.id, 'approve')}>Approve</button>
                        <button className="btn-sm btn-danger" onClick={() => decide(r.id, 'reject')}>Reject</button>
                      </div>
                    ) },
                  ]}
                  rows={pending}
                />
              )}
            </div>
          )}

          <h2 className="text-lg font-semibold mb-3">📋 My Overtime History</h2>
          {mine.length === 0 ? <EmptyState title="Abhi tak koi overtime request nahi" /> : (
            <DataTable
              columns={[
                { key: 'date', label: 'Date', render: (r) => new Date(r.date).toLocaleDateString() },
                { key: 'minutes', label: 'Time', render: (r) => fmtMin(r.minutes) },
                { key: 'reason', label: 'Reason', render: (r) => <span className="text-sm">{r.reason}</span> },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] || 'slate'}>{r.status}</Badge> },
              ]}
              rows={mine}
            />
          )}
        </>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title="Request Overtime">
        <Field label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <Field label="Minutes (min 15)" type="number" min="15" max="720" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} />
        <Field label="Reason" textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Kyun overtime chahiye..." />
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-ghost" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn-primary" disabled={submitting} onClick={submit}>{submitting ? 'Sending...' : 'Submit Request'}</button>
        </div>
      </Modal>
    </div>
  );
}
