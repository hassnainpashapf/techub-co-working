'use client';

// Phase 50 Track 10/10: Legal & Compliance Dashboard — alert cards + quick links.
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, Badge, Spinner, ErrorBanner, EmptyState, StatCard } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const QUICK_LINKS = [
  { label: '📄 Contract Templates', path: '/legal/templates', desc: 'Reusable legal templates' },
  { label: '📋 Policies', path: '/legal/policies', desc: 'Policy documents + acknowledgments' },
  { label: '✅ Compliance', path: '/legal/compliance', desc: 'Compliance checklist' },
  { label: '🚨 Incidents', path: '/legal/incidents', desc: 'Incident reports' },
];

function AlertRow({ title, items, renderItem }) {
  if (!items || !items.length) return null;
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Badge tone="red">{items.length}</Badge>
      </div>
      <div className="space-y-1.5">
        {items.map((it) => (
          <div key={it.id} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
            {renderItem(it)}
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString();
}

export default function LegalDashboardPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'super_admin', 'manager');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!allowed) return;
    (async () => {
      try {
        const d = await api.get('/legal-dashboard/stats');
        setData(d);
      } catch (e) {
        setErr(e?.message || 'Load failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [allowed]);

  if (!allowed) return <AccessDenied />;
  if (loading) return <div className="p-6"><Spinner /></div>;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="⚖️ Legal & Compliance" sub="Policies, compliance, documents, incidents — ek nazar me" />

      {err && <ErrorBanner message={err} />}

      {data?.missing?.length > 0 && (
        <ErrorBanner message={`Kuch modules abhi merge nahi hue: ${data.missing.join(', ')} — ye sections khali dikhen ge.`} />
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <StatCard title="Pending Acks" value={data?.pendingAcks?.count ?? '—'} />
        <StatCard title="Overdue Compliance" value={data?.overdueCompliance ?? '—'} tone="red" />
        <StatCard title="Docs Expiring (30d)" value={data?.expiringDocsCount ?? '—'} tone="amber" />
        <StatCard title="Open Incidents" value={data?.openIncidents ?? '—'} tone="red" />
        <StatCard title="Insurance Expiring" value={data?.expiringInsuranceCount ?? '—'} tone="amber" />
        <StatCard title="Non-compliant Vendors" value={data?.nonCompliantVendors ?? '—'} tone="amber" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <AlertRow
          title="⏳ Pending Policy Acknowledgments"
          items={data?.pendingAcks?.policies}
          renderItem={(p) => (<><span className="truncate">{p.title}</span><Badge tone="amber">Ack pending</Badge></>)}
        />
        <AlertRow
          title="📁 Expiring Documents (30 din)"
          items={data?.expiringDocs}
          renderItem={(d) => (<><span className="truncate">{d.title} <span className="text-xs text-slate-500">({d.category})</span></span><span className="text-xs text-amber-700 whitespace-nowrap">{fmtDate(d.expiresAt)}</span></>)}
        />
        <AlertRow
          title="🛡️ Expiring Insurance (60 din)"
          items={data?.expiringInsurance}
          renderItem={(i) => (<><span className="truncate">{i.provider} <span className="text-xs text-slate-500">({i.policyNumber})</span></span><span className="text-xs text-amber-700 whitespace-nowrap">{fmtDate(i.endDate)}</span></>)}
        />
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-gray-600">Quick Links</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_LINKS.map((q) => (
            <a key={q.path} href={q.path} className="block rounded-2xl border border-gray-200 bg-gray-50 p-4 transition hover:border-teal-200 hover:bg-gray-100">
              <div className="text-sm font-semibold">{q.label}</div>
              <div className="mt-1 text-xs text-gray-500">{q.desc}</div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
