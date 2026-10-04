'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;

function Bar({ pct }) {
  const p = pct == null ? 0 : Math.min(pct, 100);
  const over = pct != null && pct > 100;
  return (
    <div className="h-2 rounded-full bg-white/5 overflow-hidden w-full">
      <div
        className={`h-full rounded-full ${over ? 'bg-red-500' : 'bg-emerald-500'}`}
        style={{ width: `${p}%` }}
      />
    </div>
  );
}

export default function BudgetsPage() {
  const { allowed, loading: roleLoading } = useRequireRoles(['ceo', 'admin', 'super_admin', 'finance_officer']);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async (m) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get(`/budgets?month=${m}`);
      setRows(data.rows || []);
      setTotals(data.totals || null);
      setDraft(Object.fromEntries((data.rows || []).map((r) => [r.category, r.budgeted || ''])));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (allowed) load(month); }, [allowed, month]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const items = rows.map((r) => ({
        category: r.category,
        amount: Number(draft[r.category] || 0),
      }));
      await api.put('/budgets', { month, items });
      await load(month);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (roleLoading) return <div className="text-slate-400 p-6">Loading…</div>;
  if (!allowed) return <AccessDenied />;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-white">Budgets</h1>
          <p className="text-sm text-slate-400">Budget vs actual per expense category</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month"
            className="input"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Budgets'}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5">{error}</div>}

      {totals && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Total Budgeted', value: money(totals.budgeted), tone: 'text-[#c4b5fd]' },
            { label: 'Total Actual', value: money(totals.actual), tone: 'text-amber-300' },
            { label: 'Variance', value: money(totals.variance), tone: totals.variance >= 0 ? 'text-emerald-300' : 'text-red-300' },
          ].map((s) => (
            <div key={s.label} className="card-premium p-4">
              <div className="text-xs text-slate-400 mb-1">{s.label}</div>
              <div className={`text-xl font-extrabold ${s.tone}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="card-premium overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b border-white/10">
              <th className="px-4 py-3 font-semibold">Category</th>
              <th className="px-4 py-3 font-semibold w-40">Budgeted</th>
              <th className="px-4 py-3 font-semibold">Actual</th>
              <th className="px-4 py-3 font-semibold w-48">Usage</th>
              <th className="px-4 py-3 font-semibold text-right">Variance</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Loading…</td></tr>
            ) : rows.map((r) => (
              <tr key={r.category} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-slate-200 font-medium capitalize">{r.category.replace(/_/g, ' ')}</td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    min="0"
                    className="input !py-1.5 w-36"
                    value={draft[r.category] ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [r.category]: e.target.value }))}
                  />
                </td>
                <td className="px-4 py-3 text-slate-300">{money(r.actual)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1"><Bar pct={r.pct} /></div>
                    <span className={`text-xs font-semibold w-12 text-right ${r.pct != null && r.pct > 100 ? 'text-red-300' : 'text-slate-400'}`}>
                      {r.pct == null ? '—' : `${r.pct}%`}
                    </span>
                  </div>
                </td>
                <td className={`px-4 py-3 text-right font-semibold ${r.variance >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                  {r.variance >= 0 ? '+' : ''}{money(r.variance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500 mt-3">Variance = budgeted − actual. Green = under budget, red = over budget. Actuals exclude rejected expenses.</p>
    </div>
  );
}
