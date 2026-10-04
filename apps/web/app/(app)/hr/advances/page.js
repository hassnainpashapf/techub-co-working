'use client';

// Phase 42 Track 6: Salary Advances & Loans — request + schedule + approvals.
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, DataTable, Modal, Field, Spinner, EmptyState, ErrorBanner, Badge } from '../../../../components/ui';

const STATUS_COLOR = { pending: 'amber', approved: 'blue', rejected: 'red', deducting: 'violet', closed: 'green' };
const STATUS_LABEL = { pending: '⏳ Pending', approved: '✅ Approved', rejected: '❌ Rejected', deducting: '💸 Deducting', closed: '✔️ Closed' };

const fmt = (n) => 'Rs ' + Number(n || 0).toLocaleString('en-PK');

export default function AdvancesPage() {
  const [tab, setTab] = useState('mine'); // mine | approvals | all
  const [advances, setAdvances] = useState([]);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // null | 'request' | detail
  const [form, setForm] = useState({ amount: '', type: 'advance', installments: 1, reason: '' });
  const [decideNote, setDecideNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true); setError('');
    try {
      const [mine, pend] = await Promise.all([
        api.get('/advances/mine').catch(() => ({ advances: [] })),
        tab === 'approvals' ? api.get('/advances/pending').catch(() => ({ advances: [] })) : Promise.resolve(null),
        tab === 'all' ? api.get('/advances').catch(() => ({ advances: [] })) : Promise.resolve(null),
      ]);
      setAdvances(mine.advances || []);
      if (pend) setPending(pend.advances || []);
      const allData = tab === 'all' ? await api.get('/advances').catch(() => ({ advances: [] })) : null;
      if (allData) setPending(allData.advances || []);
    } catch (e) {
      setError(e.message || 'Advances load nahi ho sake');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [tab]);

  async function submitRequest(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/advances/request', {
        amount: Number(form.amount),
        type: form.type,
        installments: form.type === 'advance' ? 1 : Number(form.installments) || 1,
        reason: form.reason || null,
      });
      setModal(null);
      setForm({ amount: '', type: 'advance', installments: 1, reason: '' });
      load();
    } catch (e) { setError(e.message || 'Request submit nahi hui'); }
    finally { setSaving(false); }
  }

  async function decide(id, action) {
    setSaving(true);
    try {
      await api.post(`/advances/${id}/${action}`, { note: decideNote || null });
      setDecideNote(''); setModal(null); load();
    } catch (e) { setError(e.message || 'Action fail ho gaya'); }
    finally { setSaving(false); }
  }

  const list = tab === 'mine' ? advances : pending;
  const stats = {
    mine: advances.length,
    pending: advances.filter((a) => a.status === 'pending').length,
    deducting: advances.reduce((s, a) => s + (a.status === 'deducting' ? Number(a.amount) - Number(a.deductedSoFar) : 0), 0),
    closed: advances.filter((a) => a.status === 'closed').length,
  };

  const columns = [
    { key: 'employee', label: 'Employee', render: (a) => a.employee?.name || '—' },
    { key: 'type', label: 'Type', render: (a) => a.type === 'loan' ? '🏦 Loan' : '💵 Advance' },
    { key: 'amount', label: 'Amount', render: (a) => fmt(a.amount) },
    { key: 'installments', label: 'Installments', render: (a) => `${a.installments} × ${fmt(a.installmentAmount)}` },
    {
      key: 'progress', label: 'Deducted', render: (a) => {
        const pct = Number(a.amount) > 0 ? Math.round((Number(a.deductedSoFar) / Number(a.amount)) * 100) : 0;
        return (
          <div className="min-w-[120px]">
            <div className="h-2 rounded bg-white/10 overflow-hidden">
              <div className="h-full rounded bg-gradient-to-r from-violet-500 to-[#8b5cf6]" style={{ width: pct + '%' }} />
            </div>
            <div className="text-xs text-slate-400 mt-1">{fmt(a.deductedSoFar)} / {fmt(a.amount)} ({pct}%)</div>
          </div>
        );
      }
    },
    { key: 'status', label: 'Status', render: (a) => <Badge tone={STATUS_COLOR[a.status] || 'slate'}>{STATUS_LABEL[a.status] || a.status}</Badge> },
    { key: 'requestedAt', label: 'Requested', render: (a) => new Date(a.requestedAt).toLocaleDateString() },
    {
      key: 'actions', label: '', render: (a) => (
        <button onClick={() => { setDecideNote(''); setModal(a); }}
          className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-slate-200 border border-white/10">
          View
        </button>
      )
    },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Advances & Loans"
        subtitle="Salary advance aur loan requests — payroll se auto-deduct"
        action={
          <button onClick={() => setModal('request')}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-[#7c3aed] text-white text-sm font-medium shadow-lg shadow-violet-500/30">
            + New Request
          </button>
        }
      />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}

      <div className="flex gap-2 mt-4 mb-6">
        {[['mine', '📋 My Requests'], ['approvals', '⏳ Pending Approvals'], ['all', '📊 All']].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${tab === v ? 'bg-[#7c3aed] text-white shadow-lg shadow-blue-500/30' : 'bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10'}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'mine' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="My Requests" value={stats.mine} />
          <StatCard label="Pending" value={stats.pending} />
          <StatCard label="Deducting Balance" value={fmt(stats.deducting)} />
          <StatCard label="Closed" value={stats.closed} />
        </div>
      )}

      {loading ? <Spinner /> : list.length === 0
        ? <EmptyState title="Koi request nahi" hint="Nayi request banane ke liye + New Request dabao." />
        : <DataTable columns={columns} rows={list} rowKey="id" />}

      {/* Request modal */}
      {modal === 'request' && (
        <Modal title="New Advance / Loan Request" onClose={() => setModal(null)}>
          <form onSubmit={submitRequest} className="space-y-4">
            <Field label="Amount (Rs)">
              <input type="number" min="1" required value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white" placeholder="e.g. 50000" />
            </Field>
            <Field label="Type">
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, installments: 1 })}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white">
                <option value="advance">💵 Salary Advance (1 month)</option>
                <option value="loan">🏦 Loan (installments)</option>
              </select>
            </Field>
            {form.type === 'loan' && (
              <Field label="Installments (months)">
                <input type="number" min="2" max="36" value={form.installments}
                  onChange={(e) => setForm({ ...form, installments: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white" />
              </Field>
            )}
            <Field label="Reason">
              <textarea value={form.reason} rows={3}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white" placeholder="Kyun chahiye?" />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModal(null)} className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-sm">Cancel</button>
              <button disabled={saving} className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-[#7c3aed] text-white text-sm font-medium">
                {saving ? 'Submitting…' : 'Submit Request'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Detail modal */}
      {modal && modal !== 'request' && (
        <Modal title={`Request — ${modal.employee?.name || ''}`} onClose={() => setModal(null)}>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-slate-400">Type</span><span className="text-white">{modal.type === 'loan' ? '🏦 Loan' : '💵 Advance'}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Amount</span><span className="text-white font-semibold">{fmt(modal.amount)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Schedule</span><span className="text-white">{modal.installments} × {fmt(modal.installmentAmount)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Deducted so far</span><span className="text-white">{fmt(modal.deductedSoFar)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Remaining</span><span className="text-white font-semibold">{fmt(Number(modal.amount) - Number(modal.deductedSoFar))}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Status</span><Badge tone={STATUS_COLOR[modal.status]}>{STATUS_LABEL[modal.status]}</Badge></div>
            {modal.reason && <div><span className="text-slate-400">Reason:</span><p className="text-slate-200 mt-1">{modal.reason}</p></div>}
            {modal.decideNote && <div><span className="text-slate-400">Decision note:</span><p className="text-slate-200 mt-1">{modal.decideNote}</p></div>}
            {(modal.deductions || []).length > 0 && (
              <div>
                <div className="text-slate-400 mb-2">Deduction history</div>
                <div className="space-y-1">
                  {modal.deductions.map((d) => (
                    <div key={d.id} className="flex justify-between bg-white/5 rounded-lg px-3 py-2">
                      <span className="text-slate-300">{new Date(d.deductedAt).toLocaleDateString()}</span>
                      <span className="text-white">{fmt(d.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {modal.status === 'pending' && tab !== 'mine' && (
              <div className="pt-2">
                <Field label="Decision note (optional)">
                  <textarea value={decideNote} rows={2} onChange={(e) => setDecideNote(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white" />
                </Field>
                <div className="flex justify-end gap-2 mt-2">
                  <button disabled={saving} onClick={() => decide(modal.id, 'reject')}
                    className="px-4 py-2 rounded-lg bg-red-600/20 border border-red-500/30 text-red-300 text-sm">Reject</button>
                  <button disabled={saving} onClick={() => decide(modal.id, 'approve')}
                    className="px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-green-600 text-white text-sm font-medium">Approve</button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
