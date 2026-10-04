'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Spinner, ErrorBanner, EmptyState } from '../../../../components/ui';
import { ScoreBadge } from '../../../../components/ScoreBadge';

const COLUMNS = [
  { key: 'new', label: 'New', tone: 'blue' },
  { key: 'contacted', label: 'Contacted', tone: 'amber' },
  { key: 'visit', label: 'Visit', tone: 'purple' },
  { key: 'booked', label: 'Booked (Won)', tone: 'green' },
  { key: 'lost', label: 'Lost', tone: 'red' },
];

const NEXT = { new: 'contacted', contacted: 'visit', visit: 'booked' };

function fmtMoney(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? `Rs ${n.toLocaleString()}` : '—';
}

function daysIn(d) {
  return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000));
}

export default function SalesPipelinePage() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(null);
  const [moving, setMoving] = useState(null);
  const [sortByScore, setSortByScore] = useState(false);
  const dragId = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/api/leads');
      setLeads(res.leads || []);
    } catch (e) {
      setError(e.message || 'Leads load nahi ho saken');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const moveLead = useCallback(async (id, stage) => {
    setMoving(id);
    try {
      const res = await api.patch(`/api/leads/${id}`, { stage });
      const updated = res.lead || {};
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...updated } : l)));
    } catch (e) {
      setError(e.message || 'Stage update nahi ho saka');
    } finally {
      setMoving(null);
      dragId.current = null;
      setDragOver(null);
    }
  }, []);

  const onDrop = (e, stage) => {
    e.preventDefault();
    const id = dragId.current;
    if (id) {
      const lead = leads.find((l) => l.id === id);
      if (lead && lead.stage !== stage) moveLead(id, stage);
    }
    dragId.current = null;
    setDragOver(null);
  };

  const grouped = {};
  for (const c of COLUMNS) {
    const list = leads.filter((l) => l.stage === c.key);
    grouped[c.key] = sortByScore ? [...list].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)) : list;
  }

  return (
    <div className="space-y-3">
      <PageHeader
        title="Sales Pipeline"
        sub="Leads ko stages me drag kar ke aagay barhayein"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSortByScore((s) => !s)}
              title="Score ke hisab se sort"
              className={`btn-ghost ${sortByScore ? '!bg-[#0f766e]/20 !text-teal-700' : ''}`}
            >
              {sortByScore ? '★ Score sort ON' : '☆ Score sort'}
            </button>
            <button onClick={load} className="btn-ghost">↻ Refresh</button>
          </div>
        }
      />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4 -mx-1 px-1 snap-x">
          {COLUMNS.map((col) => (
            <div
              key={col.key}
              onDragOver={(e) => { e.preventDefault(); setDragOver(col.key); }}
              onDragLeave={() => setDragOver((d) => (d === col.key ? null : d))}
              onDrop={(e) => onDrop(e, col.key)}
              className={`shrink-0 w-[290px] snap-start rounded-2xl border p-3 transition-colors ${
                dragOver === col.key ? 'border-[#0f766e] bg-[#0f766e]/10' : 'border-gray-200 bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-between px-1 pb-2">
                <span className="font-semibold text-gray-800">{col.label}</span>
                <Badge tone={col.tone}>{grouped[col.key].length}</Badge>
              </div>
              <div className="space-y-2 min-h-[120px]">
                {grouped[col.key].length === 0 && (
                  <div className="text-xs text-slate-500 text-center py-4">Koi lead nahi</div>
                )}
                {grouped[col.key].map((lead) => (
                  <div
                    key={lead.id}
                    draggable
                    onDragStart={() => { dragId.current = lead.id; }}
                    onDragEnd={() => { dragId.current = null; setDragOver(null); }}
                    className="rounded-xl border border-gray-200 bg-gradient-to-b from-white/[0.07] to-white/[0.03] p-3 cursor-grab active:cursor-grabbing hover:border-[#0f766e]/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{lead.name}</p>
                        {lead.company && <p className="text-xs text-gray-500 truncate">{lead.company}</p>}
                      </div>
                      {lead.score != null && lead.score !== '' && (
                        <ScoreBadge leadId={lead.id} score={lead.score} grade={lead.grade} />
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-emerald-700">{fmtMoney(lead.budget)}</span>
                      <span className="text-slate-500">{daysIn(lead.createdAt)}d in pipeline</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[11px] text-slate-500 truncate">
                        {lead.assignee?.name || lead.assignedTo ? (lead.assignee?.name || 'Assigned') : 'Unassigned'}
                      </span>
                      {NEXT[lead.stage] && (
                        <button
                          disabled={moving === lead.id}
                          onClick={() => moveLead(lead.id, NEXT[lead.stage])}
                          title="Next stage"
                          className="text-[11px] px-2 py-1 rounded-lg bg-[#0f766e]/15 text-teal-700 hover:bg-[#0f766e]/30 disabled:opacity-50"
                        >
                          {moving === lead.id ? '…' : `→ ${COLUMNS.find((c) => c.key === NEXT[lead.stage])?.label}`}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {!loading && leads.length === 0 && !error && (
        <EmptyState title="Koi leads nahi" hint="Pehli lead add karein taake pipeline yahan nazar aaye." />
      )}
    </div>
  );
}
