'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import {
  PageHeader,
  StatCard,
  Spinner,
  ErrorBanner,
  EmptyState,
} from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

function fmtValue(w) {
  if (w.value === null || w.value === undefined) return '—';
  const v = Number(w.value);
  if (w.unit === 'Rs') return `Rs ${v.toLocaleString()}`;
  if (w.unit === '%') return `${v}%`;
  return `${v}`;
}

function extraLine(w) {
  const e = w.extra || {};
  switch (w.id) {
    case 'occupancy':
      return `${e.occupied || 0} / ${e.total || 0} units occupied`;
    case 'revenue_mtd':
      return `${e.count || 0} payments this month`;
    case 'outstanding_ar':
      return `${e.count || 0} open invoices`;
    case 'nps_score':
      return e.responses ? `${e.responses} responses (${e.promoters || 0} promoters)` : 'No responses yet';
    default:
      return '';
  }
}

export default function KpiDashboardsPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'super_admin', 'finance_officer', 'manager');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dashboards, setDashboards] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [available, setAvailable] = useState([]);
  const [data, setData] = useState(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [name, setName] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [addWidget, setAddWidget] = useState('');
  const [renaming, setRenaming] = useState(false);

  const selected = dashboards.find((d) => d.id === selectedId) || null;

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [d, w] = await Promise.all([api.get('/kpi-dashboards'), api.get('/kpi-dashboards/widgets')]);
      setDashboards(d.dashboards || []);
      setAvailable(w.widgets || []);
      if (!selectedId && (d.dashboards || []).length) setSelectedId(d.dashboards[0].id);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadData(id) {
    if (!id) return;
    setDataLoading(true);
    try {
      const d = await api.get(`/kpi-dashboards/${id}/data`);
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setDataLoading(false);
    }
  }

  useEffect(() => {
    if (allowed) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  useEffect(() => {
    if (selectedId) loadData(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  if (!allowed) return <AccessDenied />;

  async function saveLayout(dashId, layout) {
    try {
      const d = await api.patch(`/kpi-dashboards/${dashId}`, { layout });
      setDashboards((prev) => prev.map((x) => (x.id === dashId ? { ...x, layout: d.dashboard.layout } : x)));
      loadData(dashId);
    } catch (e) {
      setError(e.message);
    }
  }

  async function createDashboard() {
    if (!name.trim()) return;
    try {
      const d = await api.post('/kpi-dashboards', { name: name.trim(), layout: [] });
      setDashboards((prev) => [d.dashboard, ...prev]);
      setSelectedId(d.dashboard.id);
      setName('');
      setShowNew(false);
    } catch (e) {
      setError(e.message);
    }
  }

  async function deleteDashboard() {
    if (!selected || !confirm(`Delete dashboard "${selected.name}"?`)) return;
    try {
      await api.delete(`/kpi-dashboards/${selected.id}`);
      const rest = dashboards.filter((d) => d.id !== selected.id);
      setDashboards(rest);
      setSelectedId(rest.length ? rest[0].id : null);
      setData(null);
    } catch (e) {
      setError(e.message);
    }
  }

  async function renameDashboard() {
    if (!selected || !name.trim()) return;
    try {
      const d = await api.patch(`/kpi-dashboards/${selected.id}`, { name: name.trim() });
      setDashboards((prev) => prev.map((x) => (x.id === selected.id ? { ...x, name: d.dashboard.name } : x)));
      setName('');
      setRenaming(false);
    } catch (e) {
      setError(e.message);
    }
  }

  function move(id, dir) {
    if (!selected) return;
    const l = [...(selected.layout || [])];
    const i = l.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    saveLayout(selected.id, l);
  }

  function removeWidget(id) {
    if (!selected) return;
    saveLayout(selected.id, (selected.layout || []).filter((x) => x !== id));
  }

  function handleAddWidget() {
    if (!selected || !addWidget) return;
    if ((selected.layout || []).includes(addWidget)) return;
    saveLayout(selected.id, [...(selected.layout || []), addWidget]);
    setAddWidget('');
  }

  const usedIds = new Set(selected?.layout || []);
  const pickable = available.filter((w) => !usedIds.has(w.id));

  return (
    <div>
      <PageHeader
        title="Custom KPI Dashboards"
        sub="Apne KPIs chunein — har dashboard apne widgets ke sath"
        actions={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => selectedId && loadData(selectedId)} disabled={!selectedId}>
              ↻ Refresh
            </button>
            <button className="btn-primary" onClick={() => { setShowNew(true); setName(''); }}>
              + New Dashboard
            </button>
          </div>
        }
      />
      {error && <ErrorBanner message={error} />}

      {loading ? (
        <Spinner />
      ) : (
        <>
          {/* Dashboard selector */}
          <div className="flex flex-wrap gap-2 mb-6">
            {dashboards.map((d) => (
              <button
                key={d.id}
                onClick={() => setSelectedId(d.id)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold border transition ${
                  d.id === selectedId
                    ? 'bg-[#0f766e]/20 border-[#0f766e]/40 text-teal-700'
                    : 'bg-gray-100 border-gray-200 text-gray-600 hover:bg-gray-100'
                }`}
              >
                {d.name}
              </button>
            ))}
            {!dashboards.length && <EmptyState title="Koi dashboard nahi" hint="Upar + New Dashboard se banayein" />}
          </div>

          {showNew && (
            <div className="card-premium p-4 mb-6 flex gap-2 items-center max-w-md">
              <input
                className="input flex-1"
                placeholder="Dashboard ka naam"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createDashboard()}
                autoFocus
              />
              <button className="btn-primary" onClick={createDashboard}>Create</button>
              <button className="btn-secondary" onClick={() => setShowNew(false)}>Cancel</button>
            </div>
          )}

          {selected && (
            <>
              {/* Builder toolbar */}
              <div className="card-premium p-4 mb-6">
                <div className="flex flex-wrap items-center gap-2">
                  {renaming ? (
                    <>
                      <input
                        className="input"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && renameDashboard()}
                        autoFocus
                      />
                      <button className="btn-primary" onClick={renameDashboard}>Save</button>
                      <button className="btn-secondary" onClick={() => setRenaming(false)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <span className="text-gray-900 font-bold mr-2">{selected.name}</span>
                      <button className="btn-secondary" onClick={() => { setRenaming(true); setName(selected.name); }}>
                        ✏ Rename
                      </button>
                      <button className="btn-secondary text-red-700" onClick={deleteDashboard}>
                        🗑 Delete
                      </button>
                    </>
                  )}
                  <div className="flex gap-2 ml-auto">
                    <select className="input" value={addWidget} onChange={(e) => setAddWidget(e.target.value)}>
                      <option value="">+ Add widget…</option>
                      {pickable.map((w) => (
                        <option key={w.id} value={w.id}>{w.label} — {w.description}</option>
                      ))}
                    </select>
                    <button className="btn-primary" onClick={handleAddWidget} disabled={!addWidget}>Add</button>
                  </div>
                </div>
              </div>

              {/* Widget grid */}
              {dataLoading ? (
                <Spinner />
              ) : data && data.widgets.length ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {data.widgets.map((w) => (
                    <div key={w.id} className="relative">
                      <StatCard
                        label={w.label}
                        value={w.error ? '—' : fmtValue(w)}
                        sub={w.error ? 'compute failed' : extraLine(w)}
                        accent={w.id === 'outstanding_ar' || w.id === 'churn_risk_count' ? 'red' : w.id === 'nps_score' ? 'amber' : 'blue'}
                      />
                      <div className="absolute top-2 right-2 flex gap-1">
                        <button
                          className="w-6 h-6 rounded bg-gray-100 text-xs text-gray-600 hover:bg-white/20"
                          onClick={() => move(w.id, -1)}
                          title="Move left"
                        >←</button>
                        <button
                          className="w-6 h-6 rounded bg-gray-100 text-xs text-gray-600 hover:bg-white/20"
                          onClick={() => move(w.id, 1)}
                          title="Move right"
                        >→</button>
                        <button
                          className="w-6 h-6 rounded bg-gray-100 text-xs text-red-700 hover:bg-white/20"
                          onClick={() => removeWidget(w.id)}
                          title="Remove"
                        >✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="Koi widget nahi" hint="Upar se widgets add karein" />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
