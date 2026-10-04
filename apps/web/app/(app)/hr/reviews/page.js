'use client';

// Phase 42 Track 5: Performance Reviews — review list + rating form + history timeline.
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, DataTable, Modal, Field, Spinner, EmptyState, ErrorBanner, Badge } from '../../../../components/ui';

const CRITERIA = [
  { key: 'punctuality', label: 'Waqt ki pabandi' },
  { key: 'quality', label: 'Kaam ka standard' },
  { key: 'teamwork', label: 'Teamwork' },
];
const STATUS_TONE = { draft: 'slate', submitted: 'blue', acknowledged: 'green' };

function Stars({ value, onChange, readOnly }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={readOnly}
          onClick={() => onChange && onChange(n)}
          className={`text-xl leading-none ${n <= (value || 0) ? 'text-amber-400' : 'text-gray-500'} ${readOnly ? '' : 'hover:scale-125 transition-transform'}`}
          aria-label={`${n} stars`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

const emptyForm = { employeeId: '', period: '', ratings: {}, strengths: '', improvements: '', goals: '' };

export default function ReviewsPage() {
  const [reviews, setReviews] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('all');
  const [modal, setModal] = useState(null); // null | 'add' | review
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState(null);
  const [histEmp, setHistEmp] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [rv, em] = await Promise.all([
        api.get('/reviews'),
        api.get('/employees?status=active').catch(() => ({ employees: [] })),
      ]);
      setReviews(rv.reviews || []);
      setEmployees(em.employees || []);
      if (!form.period && rv.periods) setForm((f) => ({ ...f, period: rv.periods }));
    } catch (e) {
      setError(e.message || 'Reviews load nahi ho sake');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const filtered = reviews.filter((r) => status === 'all' || r.status === status);

  async function loadHistory(employeeId) {
    setHistEmp(employeeId);
    if (!employeeId) { setHistory(null); return; }
    const data = await api.get(`/reviews/history/${employeeId}`).catch(() => ({ history: [] }));
    setHistory(data.history || []);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      if (modal === 'add') {
        await api.post('/reviews', { ...form });
      } else {
        await api.patch(`/reviews/${modal.id}`, {
          ratings: form.ratings, strengths: form.strengths,
          improvements: form.improvements, goals: form.goals,
        });
      }
      setModal(null);
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(err.message || 'Save nahi ho saka');
    } finally {
      setSaving(false);
    }
  }

  async function doAction(id, action) {
    try {
      await api.post(`/reviews/${id}/${action}`, {});
      setModal(null);
      await load();
    } catch (e) {
      setError(e.message || 'Action nahi ho saka');
    }
  }

  async function remove(id) {
    if (!confirm('Draft review delete kar dein?')) return;
    try {
      await api.delete(`/reviews/${id}`);
      await load();
    } catch (e) {
      setError(e.message || 'Delete nahi ho saka');
    }
  }

  function openEdit(r) {
    setForm({
      employeeId: r.employeeId, period: r.period,
      ratings: r.ratings || {}, strengths: r.strengths || '',
      improvements: r.improvements || '', goals: r.goals || '',
    });
    setModal(r);
  }

  const overall = (r) => {
    if (r.overall != null) return Number(r.overall).toFixed(1);
    const vals = CRITERIA.map((c) => Number((r.ratings || {})[c.key])).filter((v) => v >= 1 && v <= 5);
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '—';
  };
  const empName = (id) => (employees.find((e) => e.id === id) || {}).name || '—';
  const counts = {
    total: reviews.length,
    submitted: reviews.filter((r) => r.status === 'submitted').length,
    acknowledged: reviews.filter((r) => r.status === 'acknowledged').length,
    draft: reviews.filter((r) => r.status === 'draft').length,
  };

  return (
    <div>
      <PageHeader title="Performance Reviews" subtitle="Employees ki quarterly performance reviews" />
      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Reviews" value={counts.total} />
        <StatCard label="Draft" value={counts.draft} />
        <StatCard label="Submitted" value={counts.submitted} />
        <StatCard label="Acknowledged" value={counts.acknowledged} />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        {['all', 'draft', 'submitted', 'acknowledged'].map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={`px-4 py-1.5 rounded-full text-sm ${status === s ? 'bg-[#0f766e] text-white' : 'bg-gray-100 text-gray-600'}`}>
            {s === 'all' ? 'Sab' : s}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <select value={histEmp} onChange={(e) => loadHistory(e.target.value)}
            className="bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800">
            <option value="">History — employee chunein</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <button onClick={() => { setForm({ ...emptyForm, period: form.period }); setModal('add'); }}
            className="px-4 py-2 rounded-lg bg-[#0f766e] hover:bg-[#0f766e] text-white text-sm font-medium">
            + New Review
          </button>
        </div>
      </div>

      {history && (
        <div className="mb-6 bg-white/60 border border-gray-200 rounded-xl p-4">
          <h3 className="font-semibold text-gray-900 mb-3">{empName(histEmp)} — Review History</h3>
          {history.length === 0 ? <EmptyState title="Koi review nahi" /> : (
            <div className="space-y-3">
              {history.map((h) => (
                <div key={h.id} className="flex items-center gap-4 bg-gray-100/60 rounded-lg p-3">
                  <div className="text-sm font-semibold text-teal-700 w-24">{h.period}</div>
                  <Stars value={Math.round(Number(h.overall) || 0)} readOnly />
                  <div className="text-sm text-gray-600">{h.overall != null ? Number(h.overall).toFixed(1) + ' / 5' : ''}</div>
                  <Badge tone={STATUS_TONE[h.status] || 'slate'}>{h.status}</Badge>
                  <div className="ml-auto text-xs text-slate-500">{h.submittedAt ? new Date(h.submittedAt).toLocaleDateString() : '—'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? <Spinner /> : filtered.length === 0 ? <EmptyState title="Koi review nahi mila" /> : (
        <DataTable
          columns={['Employee', 'Period', 'Overall', 'Status', 'Reviewer', 'Actions']}
          rows={filtered.map((r) => [
            empName(r.employeeId),
            r.period,
            <span key="o" className="font-semibold text-amber-700">{overall(r)} / 5</span>,
            <Badge key="s" tone={STATUS_TONE[r.status] || 'slate'}>{r.status}</Badge>,
            r.reviewer?.name || '—',
            <div key="a" className="flex gap-2">
              {r.status === 'draft' && (
                <>
                  <button onClick={() => openEdit(r)} className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600">Edit</button>
                  <button onClick={() => doAction(r.id, 'submit')} className="text-xs px-2 py-1 rounded bg-[#0f766e] hover:bg-[#0f766e] text-white">Submit</button>
                  <button onClick={() => remove(r.id)} className="text-xs px-2 py-1 rounded bg-red-900/60 hover:bg-red-800 text-red-700">Delete</button>
                </>
              )}
              {r.status === 'submitted' && (
                <button onClick={() => doAction(r.id, 'acknowledge')} className="text-xs px-2 py-1 rounded bg-green-700 hover:bg-green-600 text-white">Acknowledge</button>
              )}
            </div>,
          ])}
        />
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal === 'add' ? 'New Performance Review' : 'Edit Review (Draft)'}>
        <form onSubmit={save} className="space-y-4">
          <Field label="Employee">
            <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
              required={modal === 'add'} disabled={modal !== 'add'}
              className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800">
              <option value="">Chunein…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name} — {e.designation}</option>)}
            </select>
          </Field>
          <Field label="Period">
            <input value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}
              pattern="\d{4}-Q[1-4]" placeholder="2026-Q3" required disabled={modal !== 'add'}
              className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800" />
          </Field>
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-600">Ratings</div>
            {CRITERIA.map((c) => (
              <div key={c.key} className="flex items-center justify-between">
                <span className="text-sm text-gray-600">{c.label}</span>
                <Stars value={form.ratings[c.key] || 0}
                  onChange={(n) => setForm({ ...form, ratings: { ...form.ratings, [c.key]: n } })} />
              </div>
            ))}
          </div>
          <Field label="Strengths"><textarea value={form.strengths} onChange={(e) => setForm({ ...form, strengths: e.target.value })} rows={2} className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800" /></Field>
          <Field label="Improvements"><textarea value={form.improvements} onChange={(e) => setForm({ ...form, improvements: e.target.value })} rows={2} className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800" /></Field>
          <Field label="Aglay period ke goals"><textarea value={form.goals} onChange={(e) => setForm({ ...form, goals: e.target.value })} rows={2} className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800" /></Field>
          <button type="submit" disabled={saving}
            className="w-full py-2.5 rounded-lg bg-[#0f766e] hover:bg-[#0f766e] text-white font-medium disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Review'}
          </button>
        </form>
      </Modal>
    </div>
  );
}
