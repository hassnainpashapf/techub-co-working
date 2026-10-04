'use client';

// Phase 52 Track 2 — Report builder: entity select → column picker → filters → sorts → live preview → save.
// Tabs: Builder | Pivot | Chart | Exports | Alerts | Schedule.
// Backend:
//   GET  /api/custom-reports/meta/:entity — { entity: { fields, relations } }
//   POST /api/custom-reports/adhoc/run    — unsaved preview { def }
//   POST /api/custom-reports/:id/run      — saved run (adhoc { def } override bhi)
//   GET/PATCH/DELETE /api/custom-reports/:id
//   POST /api/report-pivot/:id/pivot      — { rowField, colField, valueField?, agg }
//   POST /api/report-charts/:id           — { xField, yField?, type }
//   GET  /api/report-exports/:id/csv|xlsx|pdf (download, apiDownload se)
//   GET/POST/PATCH/DELETE /api/report-alerts (+ POST /:id/check)
//   GET/POST/PATCH/DELETE /api/report-schedules (+ POST /:id/send-now)

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { api, apiDownload } from '../../../../../lib/api';
import { PageHeader, Badge, Field, Spinner, ErrorBanner, DataTable, Modal, EmptyState } from '../../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../../components/Protected';

const ENTITIES = {
  members: 'Members', invoices: 'Invoices', bookings: 'Bookings', payments: 'Payments',
  contracts: 'Contracts', expenses: 'Expenses', tickets: 'Event Tickets', vendors: 'Vendors', leads: 'Leads',
};
// Fallback field sets agar meta endpoint se pehle page load ho
const FALLBACK_FIELDS = {
  members: [['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['company', 'Company'], ['status', 'Status'], ['createdAt', 'Joined']],
  invoices: [['number', 'Number'], ['total', 'Total'], ['status', 'Status'], ['dueDate', 'Due date'], ['createdAt', 'Created']],
  bookings: [['title', 'Title'], ['startAt', 'Start'], ['endAt', 'End'], ['status', 'Status']],
  payments: [['amount', 'Amount'], ['method', 'Method'], ['status', 'Status'], ['createdAt', 'Date']],
  contracts: [['rentAmount', 'Rent'], ['status', 'Status'], ['startDate', 'Start'], ['endDate', 'End']],
  expenses: [['amount', 'Amount'], ['category', 'Category'], ['status', 'Status'], ['spentAt', 'Date']],
  tickets: [['buyerName', 'Buyer'], ['buyerEmail', 'Email'], ['status', 'Status'], ['purchasedAt', 'Purchased']],
  vendors: [['name', 'Name'], ['company', 'Company'], ['email', 'Email'], ['status', 'Status']],
  leads: [['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['stage', 'Stage'], ['score', 'Score']],
};
const OPS = [
  { value: 'equals', label: 'Barabar (=)' }, { value: 'not_equals', label: 'Barabar nahi' },
  { value: 'contains', label: 'Contains' }, { value: 'gt', label: '> Greater' }, { value: 'lt', label: '< Less' },
  { value: 'gte', label: '>= ' }, { value: 'lte', label: '<= ' },
  { value: 'empty', label: 'Khali hai' }, { value: 'not_empty', label: 'Khali nahi' },
];
const ROLES = ['ceo', 'admin', 'super_admin', 'manager'];
const SHARE_ROLES = ['ceo', 'admin', 'manager', 'finance_officer', 'receptionist', 'ops', 'office_boy', 'member'];
const TABS = [
  { id: 'build', label: '🛠️ Builder' },
  { id: 'pivot', label: '📊 Pivot' },
  { id: 'chart', label: '📈 Chart' },
  { id: 'export', label: '⬇️ Export' },
  { id: 'alerts', label: '🔔 Alerts' },
  { id: 'schedule', label: '📅 Schedule' },
];

const emptyFilter = () => ({ field: '', op: 'equals', value: '' });
const emptySort = () => ({ field: '', dir: 'desc' });

// ---- Simple SVG chart renderers ----
function BarSvg({ points }) {
  const w = 640, h = 260, pad = 30;
  const max = Math.max(...points.map((p) => p.value), 1);
  const bw = Math.min(46, (w - pad * 2) / Math.max(points.length, 1) - 8);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-64">
      {points.map((p, i) => {
        const bh = ((h - pad * 2 - 20) * p.value) / max;
        const x = pad + i * ((w - pad * 2) / points.length) + ((w - pad * 2) / points.length - bw) / 2;
        return (
          <g key={i}>
            <rect x={x} y={h - pad - bh} width={bw} height={bh} rx={4} className="fill-blue-500/80" />
            <text x={x + bw / 2} y={h - pad + 14} fontSize={10} textAnchor="middle" className="fill-slate-400">
              {String(p.label).slice(0, 10)}
            </text>
            <text x={x + bw / 2} y={h - pad - bh - 6} fontSize={10} textAnchor="middle" className="fill-slate-200">{p.value}</text>
          </g>
        );
      })}
    </svg>
  );
}
function LineSvg({ points }) {
  const w = 640, h = 260, pad = 36;
  const max = Math.max(...points.map((p) => p.value), 1);
  const min = Math.min(...points.map((p) => p.value), 0);
  const X = (i) => pad + (i * (w - pad * 2)) / Math.max(points.length - 1, 1);
  const Y = (v) => h - pad - ((v - min) * (h - pad * 2 - 10)) / Math.max(max - min, 1);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(i)},${Y(p.value)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-64">
      <path d={d} fill="none" strokeWidth={2.5} className="stroke-blue-400" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={X(i)} cy={Y(p.value)} r={3.5} className="fill-blue-400" />
          {i % Math.ceil(points.length / 8) === 0 && (
            <text x={X(i)} y={h - 12} fontSize={10} textAnchor="middle" className="fill-slate-400">{String(p.label).slice(0, 10)}</text>
          )}
        </g>
      ))}
    </svg>
  );
}
function PieSvg({ points }) {
  const total = points.reduce((s, p) => s + p.value, 0) || 1;
  const colors = ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#22d3ee', '#f472b6', '#a3e635', '#fb923c', '#94a3b8', '#e879f9', '#2dd4bf', '#64748b'];
  let ang = 0;
  const cx = 130, cy = 130, r = 110;
  const slices = points.map((p, i) => {
    const frac = p.value / total;
    const a0 = ang, a1 = ang + frac * Math.PI * 2;
    ang = a1;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const large = frac > 0.5 ? 1 : 0;
    return { p, i, d: `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z`, color: colors[i % colors.length] };
  });
  return (
    <div className="flex flex-wrap gap-6 items-center">
      <svg viewBox="0 0 260 260" className="w-64 h-64">
        {slices.map((s) => <path key={s.i} d={s.d} fill={s.color} opacity={0.85} />)}
      </svg>
      <div className="space-y-1 text-sm">
        {slices.map((s) => (
          <div key={s.i} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm" style={{ background: s.color }} />
            <span className="text-slate-300">{String(s.p.label).slice(0, 24)}</span>
            <span className="text-slate-500">{s.p.value} ({((s.p.value / total) * 100).toFixed(1)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ReportBuilder() {
  const ok = useRequireRoles(...ROLES);
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id;
  const isNew = id === 'new';

  const [tab, setTab] = useState('build');
  const [name, setName] = useState(searchParams.get('name') || 'Nayi Report');
  const [entity, setEntity] = useState(searchParams.get('entity') || 'members');
  const [fields, setFields] = useState([]);
  const [columns, setColumns] = useState([]);
  const [filters, setFilters] = useState([]);
  const [sorts, setSorts] = useState([]);
  const [isPublic, setIsPublic] = useState(false);
  const [sharedRoles, setSharedRoles] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [savedId, setSavedId] = useState(isNew ? null : id);
  const timer = useRef(null);

  // Saved report load
  useEffect(() => {
    if (!ok || isNew) { setLoading(false); return; }
    (async () => {
      try {
        const d = await api.get(`/api/custom-reports/${id}`);
        const r = d.report || d;
        setName(r.name || 'Report');
        setEntity(r.entity || 'members');
        setColumns((r.columns || []).map((c) => (typeof c === 'string' ? c : c.field)));
        setFilters(r.filters || []);
        setSorts(r.sorts || []);
        setIsPublic(!!r.isPublic);
        setSharedRoles(Array.isArray(r.sharedWithRoles) ? r.sharedWithRoles : []);
      } catch (e) { setErr(e.message || 'Load failed'); }
      finally { setLoading(false); }
    })();
  }, [ok, id]);

  // Meta fields load (entity change par) — backend /meta/:entity: { entity: { fields, relations } }
  useEffect(() => {
    if (!ok) return;
    let alive = true;
    (async () => {
      let flds = null;
      try {
        const d = await api.get(`/api/custom-reports/meta/${entity}`);
        const e = d.entity || d;
        const base = (e.fields || []).map((f) => [f.field, f.label || f.field]);
        const rel = (e.relations || []).flatMap((r) =>
          (r.fields || []).map((f) => [f.field, `${r.label || r.relation}: ${f.field}`])
        );
        if (base.length || rel.length) flds = [...base, ...rel];
      } catch { /* fallback below */ }
      if (alive) {
        const final = (flds && flds.length) ? flds : (FALLBACK_FIELDS[entity] || []);
        setFields(final);
        setColumns((prev) => prev.filter((c) => final.some(([v]) => v === c)));
      }
    })();
    return () => { alive = false; };
  }, [entity, ok]);

  const def = useMemo(() => ({
    entity,
    columns: columns.map((c) => ({ field: c })),
    filters: filters.filter((f) => f.field),
    sorts: sorts.filter((s) => s.field),
  }), [entity, columns, filters, sorts]);

  // Live preview (debounced)
  useEffect(() => {
    if (!ok || columns.length === 0) { setPreview(null); return; }
    clearTimeout(timer.current);
    setPreviewLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const path = isNew ? '/api/custom-reports/adhoc/run' : `/api/custom-reports/${id}/run`;
        const d = await api.post(path, { def });
        setPreview(d);
      } catch (e) { setPreview({ error: e.message }); }
      finally { setPreviewLoading(false); }
    }, 700);
    return () => clearTimeout(timer.current);
  }, [def, ok, isNew, id]);

  if (!ok) return <AccessDenied />;
  if (loading) return <Spinner />;

  const toggleCol = (f) => setColumns((prev) => (prev.includes(f) ? prev.filter((c) => c !== f) : [...prev, f]));
  const toggleRole = (r) => setSharedRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  const save = async () => {
    if (!name.trim()) { setErr('Report ka naam likho'); return; }
    if (columns.length === 0) { setErr('Kam az kam 1 column select karo'); return; }
    setSaving(true); setErr('');
    try {
      const body = { name, ...def, isPublic, sharedWithRoles: sharedRoles.length ? sharedRoles : null };
      const r = isNew ? await api.post('/api/custom-reports', body) : await api.patch(`/api/custom-reports/${id}`, body);
      const newId = r.id || r.report?.id || id;
      setSavedId(newId);
      if (isNew) router.replace(`/reports/builder/${newId}`);
      else setErr('');
    } catch (e) { setErr(e.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  const previewCols = (preview?.columns || def.columns).map((c) => ({ key: c.field, label: c.label || c.field }));
  const effId = savedId || id;
  const locked = isNew; // pivot/chart/export/alerts/schedule sirf saved report par

  return (
    <div className="space-y-4">
      <PageHeader title={`🛠️ ${isNew ? 'Nayi Report' : name}`} sub="Entity chuno, columns tick karo, filters lagao — preview neeche live"
        actions={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => router.push('/reports/builder')}>Back</button>
            <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : '💾 Save Report'}</button>
          </div>
        } />
      {err && <ErrorBanner message={err} />}

      <div className="flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`btn-sm ${tab === t.id ? 'btn-primary' : 'btn-secondary'} ${locked && t.id !== 'build' ? 'opacity-50' : ''}`}>
            {t.label}
          </button>
        ))}
        {locked && <span className="text-xs text-slate-400 self-center ml-1">Pivot/Chart/Export/Alerts/Schedule ke liye pehle Save karo</span>}
      </div>

      {tab === 'build' && <BuilderTab />}
      {tab === 'pivot' && (locked ? <LockedHint /> : <PivotTab id={effId} columns={def.columns} />)}
      {tab === 'chart' && (locked ? <LockedHint /> : <ChartTab id={effId} columns={def.columns} />)}
      {tab === 'export' && (locked ? <LockedHint /> : <ExportTab id={effId} name={name} />)}
      {tab === 'alerts' && (locked ? <LockedHint /> : <AlertsTab id={effId} columns={def.columns} />)}
      {tab === 'schedule' && (locked ? <LockedHint /> : <ScheduleTab id={effId} />)}
    </div>
  );

  function LockedHint() {
    return <div className="card p-6 text-center text-slate-400 text-sm">Pehle report Save karo, phir ye feature khulega.</div>;
  }

  function BuilderTab() {
    return (
      <>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Report name *"><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} /></Field>
              <Field label="Entity *">
                <select className="input" value={entity} onChange={(e) => { setEntity(e.target.value); setColumns([]); }} disabled={!isNew}>
                  {Object.entries(ENTITIES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
            </div>
            <Field label={`Columns (${columns.length})`}>
              <div className="flex flex-wrap gap-2 max-h-44 overflow-auto p-1">
                {fields.map(([v, l]) => (
                  <label key={v} className={`badge cursor-pointer ${columns.includes(v) ? 'badge-blue' : 'badge-slate'}`}>
                    <input type="checkbox" className="mr-1" checked={columns.includes(v)} onChange={() => toggleCol(v)} />
                    {l}
                  </label>
                ))}
              </div>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
              Sab staff ke liye public
            </label>
            <Field label="In roles ke sath share karo">
              <div className="flex flex-wrap gap-2">
                {SHARE_ROLES.map((r) => (
                  <label key={r} className={`badge cursor-pointer ${sharedRoles.includes(r) ? 'badge-blue' : 'badge-slate'}`}>
                    <input type="checkbox" className="mr-1" checked={sharedRoles.includes(r)} onChange={() => toggleRole(r)} />
                    {r}
                  </label>
                ))}
              </div>
            </Field>
          </div>

          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Filters</h3>
              <button className="btn-sm" onClick={() => setFilters([...filters, emptyFilter()])}>+ Add</button>
            </div>
            {filters.map((f, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <select className="input col-span-5" value={f.field} onChange={(e) => { const n = [...filters]; n[i].field = e.target.value; setFilters(n); }}>
                  <option value="">— field —</option>
                  {fields.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <select className="input col-span-3" value={f.op} onChange={(e) => { const n = [...filters]; n[i].op = e.target.value; setFilters(n); }}>
                  {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input className="input col-span-3" value={f.value} placeholder="value" onChange={(e) => { const n = [...filters]; n[i].value = e.target.value; setFilters(n); }} disabled={f.op === 'empty' || f.op === 'not_empty'} />
                <button className="btn-sm btn-danger col-span-1" onClick={() => setFilters(filters.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <div className="flex items-center justify-between pt-2">
              <h3 className="font-semibold">Sorting</h3>
              <button className="btn-sm" onClick={() => setSorts([...sorts, emptySort()])}>+ Add</button>
            </div>
            {sorts.map((s, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <select className="input col-span-7" value={s.field} onChange={(e) => { const n = [...sorts]; n[i].field = e.target.value; setSorts(n); }}>
                  <option value="">— field —</option>
                  {fields.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <select className="input col-span-4" value={s.dir} onChange={(e) => { const n = [...sorts]; n[i].dir = e.target.value; setSorts(n); }}>
                  <option value="asc">↑ Asc</option><option value="desc">↓ Desc</option>
                </select>
                <button className="btn-sm btn-danger col-span-1" onClick={() => setSorts(sorts.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">👁️ Live Preview {previewLoading && <Spinner size="sm" />}</h3>
            {preview?.total != null && <Badge>{preview.total} rows</Badge>}
          </div>
          {preview?.error ? <ErrorBanner message={preview.error} /> :
            preview?.rows ? <DataTable columns={previewCols} rows={preview.rows} empty="Koi row nahi" /> :
            <p className="text-sm text-slate-400">Columns select karte hi preview yahan aayega</p>}
        </div>
      </>
    );
  }
}

function PivotTab({ id, columns }) {
  const opts = columns.map((c) => c.field);
  const [rowField, setRowField] = useState(opts[0] || '');
  const [colField, setColField] = useState(opts[1] || '');
  const [valueField, setValueField] = useState('');
  const [agg, setAgg] = useState('count');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const run = async () => {
    if (!rowField || !colField) { setErr('Row aur Column field chuno'); return; }
    setLoading(true); setErr('');
    try {
      const d = await api.post(`/api/report-pivot/${id}/pivot`, {
        rowField, colField, ...(valueField ? { valueField } : {}), agg,
      });
      setResult(d);
    } catch (e) { setErr(e.message || 'Pivot failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="card p-4 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Field label="Row field"><select className="input" value={rowField} onChange={(e) => setRowField(e.target.value)}>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select></Field>
        <Field label="Column field"><select className="input" value={colField} onChange={(e) => setColField(e.target.value)}>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select></Field>
        <Field label="Value field (optional)"><select className="input" value={valueField} onChange={(e) => setValueField(e.target.value)}><option value="">— count —</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select></Field>
        <Field label="Aggregate"><select className="input" value={agg} onChange={(e) => setAgg(e.target.value)}><option value="sum">Sum</option><option value="count">Count</option><option value="avg">Avg</option></select></Field>
        <div className="flex items-end"><button className="btn-primary w-full" onClick={run} disabled={loading}>{loading ? '…' : '📊 Pivot chalao'}</button></div>
      </div>
      {err && <ErrorBanner message={err} />}
      {result && (
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead><tr>
              <th className="p-2 text-left text-slate-400">{result.rowField}</th>
              {(result.cols || []).map((c) => <th key={c} className="p-2 text-right text-slate-400">{String(c).slice(0, 18)}</th>)}
              <th className="p-2 text-right text-slate-200">Total</th>
            </tr></thead>
            <tbody>
              {(result.rows || []).map((r, i) => (
                <tr key={i} className="border-t border-slate-700/50">
                  <td className="p-2 text-slate-200">{String(r.label).slice(0, 30)}</td>
                  {(result.cols || []).map((c) => <td key={c} className="p-2 text-right text-slate-300">{r.cells?.[c] ?? 0}</td>)}
                  <td className="p-2 text-right font-semibold text-slate-100">{r.total}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t border-slate-600">
              <td className="p-2 font-semibold text-slate-200">Total</td>
              {(result.cols || []).map((c) => <td key={c} className="p-2 text-right font-semibold text-slate-100">{result.colTotals?.[c] ?? 0}</td>)}
              <td className="p-2 text-right font-bold text-blue-300">{result.grandTotal}</td>
            </tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function ChartTab({ id, columns }) {
  const opts = columns.map((c) => c.field);
  const [xField, setXField] = useState(opts[0] || '');
  const [yField, setYField] = useState('');
  const [type, setType] = useState('bar');
  const [chart, setChart] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const run = async () => {
    if (!xField) { setErr('X field chuno'); return; }
    setLoading(true); setErr('');
    try {
      const d = await api.post(`/api/report-charts/${id}`, { xField, yField: yField || null, type });
      setChart(d.chart || d);
    } catch (e) { setErr(e.message || 'Chart failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="card p-4 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Field label="X field (group by)"><select className="input" value={xField} onChange={(e) => setXField(e.target.value)}>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select></Field>
        <Field label="Y field (optional → count)"><select className="input" value={yField} onChange={(e) => setYField(e.target.value)}><option value="">— count —</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select></Field>
        <Field label="Type"><select className="input" value={type} onChange={(e) => setType(e.target.value)}><option value="bar">Bar</option><option value="line">Line</option><option value="pie">Pie</option></select></Field>
        <div className="flex items-end"><button className="btn-primary w-full" onClick={run} disabled={loading}>{loading ? '…' : '📈 Chart banao'}</button></div>
      </div>
      {err && <ErrorBanner message={err} />}
      {chart?.points?.length > 0 ? (
        <div>
          <p className="text-xs text-slate-400 mb-2">Aggregation: {chart.aggregation} · Total: {chart.total}{chart.truncated ? ' · (top categories)' : ''}</p>
          {chart.type === 'bar' && <BarSvg points={chart.points} />}
          {chart.type === 'line' && <LineSvg points={chart.points} />}
          {chart.type === 'pie' && <PieSvg points={chart.points} />}
        </div>
      ) : chart ? <EmptyState title="Koi data nahi" hint="X field badlo ya report me rows lao" /> : null}
    </div>
  );
}

function ExportTab({ id, name }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const slug = (name || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'report';
  const dl = async (fmt) => {
    setBusy(fmt); setErr('');
    try {
      await apiDownload(`/api/report-exports/${id}/${fmt}`, `${slug}.${fmt === 'xlsx' ? 'xlsx' : fmt}`);
    } catch (e) { setErr(e.message || 'Download failed'); }
    finally { setBusy(''); }
  };
  return (
    <div className="card p-4 space-y-3">
      <h3 className="font-semibold">⬇️ Export</h3>
      <p className="text-sm text-slate-400">Poori report (5000 rows tak) download karo:</p>
      {err && <ErrorBanner message={err} />}
      <div className="flex gap-2 flex-wrap">
        <button className="btn-primary" onClick={() => dl('csv')} disabled={!!busy}>{busy === 'csv' ? '…' : '📄 CSV'}</button>
        <button className="btn-primary" onClick={() => dl('xlsx')} disabled={!!busy}>{busy === 'xlsx' ? '…' : '📊 XLSX'}</button>
        <button className="btn-primary" onClick={() => dl('pdf')} disabled={!!busy}>{busy === 'pdf' ? '…' : '🧾 PDF'}</button>
      </div>
    </div>
  );
}

function AlertsTab({ id, columns }) {
  const opts = columns.map((c) => c.field);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ metricField: opts[0] || '', aggregate: 'sum', operator: 'gt', threshold: '', checkFrequency: 'daily' });

  const load = async () => {
    setLoading(true);
    try {
      const d = await api.get('/api/report-alerts');
      setItems((d.items || []).filter((a) => a.reportId === id));
    } catch (e) { setErr(e.message || 'Load failed'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await api.post('/api/report-alerts', { reportId: id, ...form, threshold: Number(form.threshold) });
      setForm({ metricField: opts[0] || '', aggregate: 'sum', operator: 'gt', threshold: '', checkFrequency: 'daily' });
      load();
    } catch (ex) { setErr(ex.message || 'Create failed'); }
  };
  const toggle = async (a) => { try { await api.patch(`/api/report-alerts/${a.id}`, { isActive: !a.isActive }); load(); } catch (e) { setErr(e.message); } };
  const checkNow = async (a) => { try { const d = await api.post(`/api/report-alerts/${a.id}/check`); setErr(''); alert(`Value: ${d.value} · Triggered: ${d.triggered ? 'YES' : 'no'}`); load(); } catch (e) { setErr(e.message); } };
  const del = async (a) => { if (!confirm('Alert delete karein?')) return; try { await api.del(`/api/report-alerts/${a.id}`); load(); } catch (e) { setErr(e.message); } };

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <h3 className="font-semibold mb-2">🔔 KPI Alerts</h3>
        {err && <ErrorBanner message={err} />}
        {loading ? <Spinner /> : items.length === 0 ? <EmptyState title="Koi alert nahi" hint="Neeche form se pehla alert banao" /> : (
          <DataTable
            columns={[
              { key: 'metricField', label: 'Metric' },
              { key: 'aggregate', label: 'Agg' },
              { key: 'operator', label: 'Op', render: (a) => (a.operator === 'gt' ? '>' : a.operator === 'lt' ? '<' : '=') },
              { key: 'threshold', label: 'Threshold' },
              { key: 'lastValue', label: 'Last value', render: (a) => (a.lastValue ?? '—') },
              { key: 'lastTriggeredAt', label: 'Last hit', render: (a) => (a.lastTriggeredAt ? new Date(a.lastTriggeredAt).toLocaleString() : '—') },
              { key: 'isActive', label: 'Active', render: (a) => <Badge tone={a.isActive ? 'green' : 'slate'}>{a.isActive ? 'ON' : 'OFF'}</Badge> },
              { key: 'actions', label: 'Actions', render: (a) => (
                <div className="flex gap-1 flex-wrap">
                  <button className="btn-sm" onClick={() => checkNow(a)}>Check now</button>
                  <button className="btn-sm" onClick={() => toggle(a)}>{a.isActive ? 'Pause' : 'Resume'}</button>
                  <button className="btn-sm btn-danger" onClick={() => del(a)}>✕</button>
                </div>
              ) },
            ]}
            rows={items}
          />
        )}
      </div>
      <div className="card p-4">
        <h3 className="font-semibold mb-2">+ Naya Alert</h3>
        <form onSubmit={create} className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <Field label="Metric field"><select className="input" value={form.metricField} onChange={(e) => setForm({ ...form, metricField: e.target.value })}>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select></Field>
          <Field label="Aggregate"><select className="input" value={form.aggregate} onChange={(e) => setForm({ ...form, aggregate: e.target.value })}><option value="sum">Sum</option><option value="count">Count</option><option value="avg">Avg</option></select></Field>
          <Field label="Operator"><select className="input" value={form.operator} onChange={(e) => setForm({ ...form, operator: e.target.value })}><option value="gt">&gt; Greater</option><option value="lt">&lt; Less</option><option value="eq">= Equal</option></select></Field>
          <Field label="Threshold *"><input className="input" type="number" step="any" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} required /></Field>
          <Field label="Frequency"><select className="input" value={form.checkFrequency} onChange={(e) => setForm({ ...form, checkFrequency: e.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></Field>
          <div className="flex items-end"><button className="btn-primary w-full" type="submit">Create</button></div>
        </form>
      </div>
    </div>
  );
}

function ScheduleTab({ id }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ frequency: 'weekly', dayOfWeek: 1, dayOfMonth: 1, recipients: '', format: 'pdf' });

  const load = async () => {
    setLoading(true);
    try {
      const d = await api.get('/api/report-schedules');
      setItems((d.schedules || []).filter((s) => s.reportId === id));
    } catch (e) { setErr(e.message || 'Load failed'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    setErr('');
    const recipients = form.recipients.split(',').map((x) => x.trim()).filter(Boolean);
    if (!recipients.length) { setErr('Kam az kam 1 email likho'); return; }
    try {
      await api.post('/api/report-schedules', {
        reportId: id, frequency: form.frequency,
        ...(form.frequency === 'weekly' ? { dayOfWeek: Number(form.dayOfWeek) } : {}),
        ...(form.frequency === 'monthly' ? { dayOfMonth: Number(form.dayOfMonth) } : {}),
        recipients, format: form.format,
      });
      setForm({ frequency: 'weekly', dayOfWeek: 1, dayOfMonth: 1, recipients: '', format: 'pdf' });
      load();
    } catch (ex) { setErr(ex.message || 'Create failed'); }
  };
  const toggle = async (s) => { try { await api.patch(`/api/report-schedules/${s.id}`, { isActive: !s.isActive }); load(); } catch (e) { setErr(e.message); } };
  const sendNow = async (s) => { try { const d = await api.post(`/api/report-schedules/${s.id}/send-now`); alert(d.ok ? 'Bhej diya ✓' : (d.error || 'Failed')); load(); } catch (e) { setErr(e.message); } };
  const del = async (s) => { if (!confirm('Schedule delete karein?')) return; try { await api.del(`/api/report-schedules/${s.id}`); load(); } catch (e) { setErr(e.message); } };

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <h3 className="font-semibold mb-2">📅 Scheduled Delivery</h3>
        {err && <ErrorBanner message={err} />}
        {loading ? <Spinner /> : items.length === 0 ? <EmptyState title="Koi schedule nahi" hint="Neeche form se auto-email schedule banao" /> : (
          <DataTable
            columns={[
              { key: 'frequency', label: 'Frequency' },
              { key: 'when', label: 'When', render: (s) => (s.frequency === 'weekly' ? `Day ${s.dayOfWeek}` : s.frequency === 'monthly' ? `Day ${s.dayOfMonth}` : 'Daily') },
              { key: 'recipients', label: 'Recipients', render: (s) => (s.recipients || []).join(', ').slice(0, 40) },
              { key: 'format', label: 'Format' },
              { key: 'lastSentAt', label: 'Last sent', render: (s) => (s.lastSentAt ? new Date(s.lastSentAt).toLocaleString() : '—') },
              { key: 'isActive', label: 'Active', render: (s) => <Badge tone={s.isActive ? 'green' : 'slate'}>{s.isActive ? 'ON' : 'OFF'}</Badge> },
              { key: 'actions', label: 'Actions', render: (s) => (
                <div className="flex gap-1 flex-wrap">
                  <button className="btn-sm" onClick={() => sendNow(s)}>Send now</button>
                  <button className="btn-sm" onClick={() => toggle(s)}>{s.isActive ? 'Pause' : 'Resume'}</button>
                  <button className="btn-sm btn-danger" onClick={() => del(s)}>✕</button>
                </div>
              ) },
            ]}
            rows={items}
          />
        )}
      </div>
      <div className="card p-4">
        <h3 className="font-semibold mb-2">+ Naya Schedule</h3>
        <form onSubmit={create} className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <Field label="Frequency"><select className="input" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></Field>
          {form.frequency === 'weekly' && (
            <Field label="Day of week"><select className="input" value={form.dayOfWeek} onChange={(e) => setForm({ ...form, dayOfWeek: e.target.value })}>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => <option key={i} value={i}>{d}</option>)}</select></Field>
          )}
          {form.frequency === 'monthly' && (
            <Field label="Day of month"><input className="input" type="number" min={1} max={28} value={form.dayOfMonth} onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value })} /></Field>
          )}
          <div className="md:col-span-2"><Field label="Recipients (comma emails) *"><input className="input" value={form.recipients} onChange={(e) => setForm({ ...form, recipients: e.target.value })} placeholder="a@x.com, b@x.com" /></Field></div>
          <Field label="Format"><select className="input" value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}><option value="pdf">PDF</option><option value="csv">CSV</option></select></Field>
          <div className="flex items-end"><button className="btn-primary w-full" type="submit">Create</button></div>
        </form>
      </div>
    </div>
  );
}

