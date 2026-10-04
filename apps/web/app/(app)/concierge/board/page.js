'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Spinner, ErrorBanner, EmptyState } from '../../../../components/ui';

const COLUMNS = [
  { key: 'new', label: 'New', tone: 'blue' },
  { key: 'accepted', label: 'Accepted', tone: 'amber' },
  { key: 'in_progress', label: 'In Progress', tone: 'purple' },
  { key: 'done', label: 'Done', tone: 'green' },
];

// Track 7 SLA map (per-category SLA hours) — duplicate of lib/conciergeSla.js taake
// board bina extra endpoint ke badges dikha sake.
const SLA_HOURS = { errand: 4, food: 2, transport: 6, wellness: 24, business: 48, default: 24 };
const SLA_ACTIVE = ['new', 'accepted', 'in_progress'];

function slaInfo(req) {
  if (!req || !SLA_ACTIVE.includes(req.status)) return { status: 'na' };
  const cat = req.service?.category || req.category || 'default';
  const hours = SLA_HOURS[cat] || SLA_HOURS.default;
  const elapsed = (Date.now() - new Date(req.createdAt).getTime()) / 36e5;
  const dueAt = new Date(new Date(req.createdAt).getTime() + hours * 36e5);
  if (elapsed > hours) return { status: 'breached', dueAt };
  if (elapsed >= hours * 0.8) return { status: 'at-risk', dueAt };
  return { status: 'on-time', dueAt };
}

const SLA_BADGE = {
  'on-time': <Badge tone="green">⏱ SLA on-time</Badge>,
  'at-risk': <Badge tone="amber">⚠ SLA at-risk</Badge>,
  breached: <Badge tone="red">🚨 SLA breached</Badge>,
};

const PRI_TONE = { low: 'slate', normal: 'blue', high: 'amber', urgent: 'red' };

function fmtPrice(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? `Rs ${n.toLocaleString()}` : '—';
}

export default function ConciergeBoardPage() {
  const [requests, setRequests] = useState([]);
  const [counts, setCounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(null);
  const [moving, setMoving] = useState(null);
  const [assignReq, setAssignReq] = useState(null);
  const [staffList, setStaffList] = useState([]);
  const [assignee, setAssignee] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [fPriority, setFPriority] = useState('all');
  const [fCategory, setFCategory] = useState('all');
  const [fSla, setFSla] = useState('all');
  const dragId = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/api/service-requests');
      setRequests(res.requests || []);
      setCounts(res.counts || []);
    } catch (e) {
      setError(e.message || 'Requests load nahi ho saken');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const moveRequest = useCallback(async (id, status) => {
    setMoving(id);
    try {
      const res = await api.post(`/api/service-requests/${id}/status`, { status });
      setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: res.status || status } : r)));
    } catch (e) {
      setError(e.message || 'Status update nahi ho saka');
    } finally {
      setMoving(null);
      dragId.current = null;
      setDragOver(null);
    }
  }, []);

  const onDrop = (e, status) => {
    e.preventDefault();
    const id = dragId.current;
    if (id) {
      const r = requests.find((x) => x.id === id);
      if (r && r.status !== status) moveRequest(id, status);
    }
    dragId.current = null;
    setDragOver(null);
  };

  const openAssign = async (req) => {
    setAssignReq(req);
    setAssignee(req.assignedTo || '');
    if (staffList.length === 0) {
      try {
        const res = await api.get('/api/users');
        setStaffList((res.users || []).filter((u) => ['ceo', 'admin', 'super_admin', 'manager', 'reception'].includes(u.role)));
      } catch { /* ignore */ }
    }
  };

  const doAssign = async () => {
    if (!assignReq) return;
    setAssigning(true);
    try {
      await api.patch(`/api/service-requests/${assignReq.id}`, { assignedTo: assignee || null });
      setRequests((prev) => prev.map((r) =>
        r.id === assignReq.id
          ? { ...r, assignedTo: assignee || null, assignee: staffList.find((u) => u.id === assignee) || null }
          : r
      ));
      setAssignReq(null);
    } catch (e) {
      setError(e.message || 'Assign nahi ho saka');
    } finally {
      setAssigning(false);
    }
  };

  const categories = useMemo(() => {
    const s = new Set();
    for (const r of requests) if (r.service?.category) s.add(r.service.category);
    return [...s].sort();
  }, [requests]);

  const filtered = useMemo(() => requests.filter((r) => {
    if (fPriority !== 'all' && r.priority !== fPriority) return false;
    if (fCategory !== 'all' && r.service?.category !== fCategory) return false;
    if (fSla !== 'all' && slaInfo(r).status !== fSla) return false;
    return true;
  }), [requests, fPriority, fCategory, fSla]);

  const grouped = {};
  for (const c of COLUMNS) {
    grouped[c.key] = filtered.filter((r) => r.status === c.key && r.status !== 'cancelled');
  }
  const cancelledCount = filtered.filter((r) => r.status === 'cancelled').length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Concierge Board"
        sub="Service requests ko drag kar ke aagay barhayein"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <select value={fPriority} onChange={(e) => setFPriority(e.target.value)} className="input !py-1.5 !px-2 text-xs">
              <option value="all">Sab priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
            <select value={fCategory} onChange={(e) => setFCategory(e.target.value)} className="input !py-1.5 !px-2 text-xs">
              <option value="all">Sab categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={fSla} onChange={(e) => setFSla(e.target.value)} className="input !py-1.5 !px-2 text-xs">
              <option value="all">Sab SLA</option>
              <option value="breached">Breached</option>
              <option value="at-risk">At-risk</option>
              <option value="on-time">On-time</option>
            </select>
            <button onClick={load} className="btn-ghost">↻ Refresh</button>
          </div>
        }
      />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {cancelledCount > 0 && (
        <p className="text-xs text-slate-500">⚪ {cancelledCount} cancelled request(s) board se chhupa di gayi hain</p>
      )}
      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4 -mx-1 px-1 snap-x">
          {COLUMNS.map((col) => (
            <div
              key={col.key}
              onDragOver={(e) => { e.preventDefault(); setDragOver(col.key); }}
              onDragLeave={() => setDragOver((d) => (d === col.key ? null : d))}
              onDrop={(e) => onDrop(e, col.key)}
              className={`shrink-0 w-[300px] snap-start rounded-2xl border p-3 transition-colors ${
                dragOver === col.key ? 'border-[#0f766e] bg-[#0f766e]/10' : 'border-gray-200 bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-between px-1 pb-2">
                <span className="font-semibold text-gray-800">{col.label}</span>
                <Badge tone={col.tone}>{grouped[col.key].length}</Badge>
              </div>
              <div className="space-y-2 min-h-[120px]">
                {grouped[col.key].length === 0 && (
                  <div className="text-xs text-slate-500 text-center py-6">Koi request nahi</div>
                )}
                {grouped[col.key].map((r) => {
                  const sla = slaInfo(r);
                  return (
                    <div
                      key={r.id}
                      draggable
                      onDragStart={() => { dragId.current = r.id; }}
                      onDragEnd={() => { dragId.current = null; setDragOver(null); }}
                      className="rounded-xl border border-gray-200 bg-gradient-to-b from-white/[0.07] to-white/[0.03] p-3 cursor-grab active:cursor-grabbing hover:border-[#0f766e]/40 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-gray-900 truncate">{r.title}</p>
                        <Badge tone={PRI_TONE[r.priority] || 'blue'}>{r.priority || 'normal'}</Badge>
                      </div>
                      <p className="text-xs text-gray-500 truncate mt-0.5">
                        {r.member?.name || 'Member'} {r.service?.name ? `• ${r.service.name}` : ''}
                      </p>
                      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                        {sla.status !== 'na' && SLA_BADGE[sla.status]}
                        {sla.status !== 'na' && sla.dueAt && (
                          <span className="text-[10px] text-slate-500">
                            due {new Date(sla.dueAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="text-emerald-300">{fmtPrice(r.price)}</span>
                        <button
                          onClick={() => openAssign(r)}
                          className="text-[11px] px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-100 truncate max-w-[130px]"
                          title="Assign karein"
                        >
                          👤 {r.assignee?.name || 'Assign'}
                        </button>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[11px] text-slate-500">
                          {new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </span>
                        <button
                          disabled={moving === r.id}
                          onClick={() => moveRequest(r.id, COLUMNS[COLUMNS.findIndex((c) => c.key === r.status) + 1]?.key || 'done')}
                          className="text-[11px] px-2 py-1 rounded-lg bg-[#0f766e]/15 text-teal-700 hover:bg-[#0f766e]/30 disabled:opacity-50"
                        >
                          {moving === r.id ? '…' : '→ Next'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {!loading && filtered.length === 0 && !error && (
        <EmptyState title="Koi requests nahi" hint="Members concierge portal se request karenge to wo yahan nazar aayengi." />
      )}

      {assignReq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4" onClick={() => setAssignReq(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900 mb-1">Assign request</h3>
            <p className="text-xs text-gray-500 mb-4 truncate">{assignReq.title}</p>
            <label className="text-xs text-gray-500">Staff member</label>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="input w-full mt-1">
              <option value="">Unassigned</option>
              {staffList.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
            </select>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setAssignReq(null)} className="btn-ghost">Cancel</button>
              <button onClick={doAssign} disabled={assigning} className="btn-primary disabled:opacity-50">
                {assigning ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
