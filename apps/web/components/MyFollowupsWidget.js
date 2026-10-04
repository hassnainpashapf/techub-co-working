'use client';

// Phase 39 Track 5: "My follow-ups" widget — current user ke aaj ke due + overdue.
// Coordinator integration (dashboard ya sidebar area me):
//   import MyFollowupsWidget from '../../components/MyFollowupsWidget';
//   <MyFollowupsWidget />

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Spinner, EmptyState, Badge } from './ui';

const TYPES = [
  { key: 'call', label: '📞 Call', tone: 'blue' },
  { key: 'email', label: '✉️ Email', tone: 'violet' },
  { key: 'whatsapp', label: '💬 WhatsApp', tone: 'green' },
  { key: 'tour', label: '🏢 Tour', tone: 'amber' },
];
const toneFor = (t) => (TYPES.find((x) => x.key === t) || {}).tone || 'slate';
const labelFor = (t) => (TYPES.find((x) => x.key === t) || {}).label || t;

export default function MyFollowupsWidget() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/lead-followups/due')
      .then((d) => setRows(d.followups || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  return (
    <div className="card p-4">
      <h3 className="font-semibold text-sm mb-3">
        📋 My Follow-ups {rows.length > 0 && <Badge tone={rows.some((r) => r.overdue) ? 'red' : 'blue'}>{rows.length}</Badge>}
      </h3>
      {rows.length === 0 && <EmptyState title="Aaj koi follow-up due nahi 🎉" />}
      <div className="space-y-2">
        {rows.map((r) => (
          <a key={r.id} href="/sales/leads" className="block rounded-lg border border-gray-200 p-2.5 hover:border-blue-500/40 transition text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{r.lead?.name}</span>
              <Badge tone={r.overdue ? 'red' : toneFor(r.type)}>{r.overdue ? 'OVERDUE' : labelFor(r.type)}</Badge>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {new Date(r.dueAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {r.lead?.phone ? ` • ☎ ${r.lead.phone}` : ''}
            </p>
            {r.note && <p className="text-xs text-slate-500 mt-1 truncate">{r.note}</p>}
          </a>
        ))}
      </div>
    </div>
  );
}
