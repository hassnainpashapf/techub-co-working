'use client';

// Phase 52 Track 2 — Saved custom reports list + Template Gallery (Track 7).
// Backend endpoints (routes/custom-reports.js + routes/report-templates.js):
//   GET    /api/custom-reports        — list (tenant-scoped, reportAccess filtered)
//   GET    /api/report-templates      — { templates: [...] }
//   POST   /api/report-templates/:key/clone — { id } → builder me kholo

import { useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, EmptyState, DataTable } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const ENTITIES = {
  members: 'Members', invoices: 'Invoices', bookings: 'Bookings', payments: 'Payments',
  contracts: 'Contracts', expenses: 'Expenses', tickets: 'Event Tickets', vendors: 'Vendors', leads: 'Leads',
};
const ROLES = ['ceo', 'admin', 'super_admin', 'manager'];

function CreateModal({ onClose }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [entity, setEntity] = useState('members');
  const go = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    router.push(`/reports/builder/new?name=${encodeURIComponent(name.trim())}&entity=${entity}`);
  };
  return (
    <Modal title="Nayi report" onClose={onClose}>
      <form onSubmit={go} className="space-y-3">
        <Field label="Report name *"><input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} /></Field>
        <Field label="Entity *">
          <select className="input" value={entity} onChange={(e) => setEntity(e.target.value)}>
            {Object.entries(ENTITIES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <button className="btn-primary" type="submit">Builder kholo</button>
      </form>
    </Modal>
  );
}

function TemplateGallery() {
  const router = useRouter();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cloning, setCloning] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const d = await api.get('/api/report-templates');
        setTemplates(d.templates || []);
      } catch (e) { setErr(e.message || 'Load failed'); }
      finally { setLoading(false); }
    })();
  }, []);

  const clone = async (t) => {
    setCloning(t.key); setErr('');
    try {
      const d = await api.post(`/api/report-templates/${t.key}/clone`, {});
      router.push(`/reports/builder/${d.id || d.report?.id}`);
    } catch (e) { setErr(e.message || 'Clone failed'); }
    finally { setCloning(''); }
  };

  return (
    <div className="card p-4 mt-3">
      <h3 className="font-semibold mb-1">📚 Template Gallery</h3>
      <p className="text-sm text-gray-500 mb-3">Ready-made report definitions — ek click me clone karo aur customize karo</p>
      {err && <ErrorBanner message={err} />}
      {loading ? <Spinner /> : templates.length === 0 ? (
        <EmptyState title="Koi template nahi" hint="Backend migration ke baad templates yahan aayenge" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {templates.map((t) => (
            <div key={t.key} className="p-3 rounded-xl border border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-gray-900">{t.title || t.name}</span>
                <Badge>{ENTITIES[t.entity] || t.entity}</Badge>
              </div>
              <p className="text-xs text-gray-500 mb-2">{t.description || `${t.columnCount ?? (t.columns || []).length} columns`}</p>
              <button className="btn-sm btn-primary" onClick={() => clone(t)} disabled={!!cloning}>
                {cloning === t.key ? 'Cloning…' : '⧉ Clone'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReportsBuilderList() {
  const ok = useRequireRoles(...ROLES);
  const router = useRouter();
  const searchParams = useSearchParams();
  const galleryRef = useRef(null);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const d = await api.get('/api/custom-reports');
      setReports(d.reports || d.items || d || []);
    } catch (e) { setErr(e.message || 'Load failed'); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (ok) load(); }, [ok]);
  useEffect(() => {
    if (searchParams.get('tab') === 'templates' && galleryRef.current) {
      galleryRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [searchParams]);
  if (!ok) return <AccessDenied />;

  const del = async (id) => {
    if (!confirm('Delete this report?')) return;
    try { await api.del(`/api/custom-reports/${id}`); load(); } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <PageHeader title="📊 Report Builder" sub="Apni marzi ki reports banao — columns, filters aur sorting ke sath"
        actions={<button className="btn-primary" onClick={() => setShowCreate(true)}>+ Nayi Report</button>} />
      {err && <ErrorBanner message={err} onRetry={load} />}
      {loading ? <Spinner /> : reports.length === 0 ? (
        <EmptyState title="Koi report nahi" hint="Nayi Report dabaa kar pehli report banao ya neeche template clone karo" />
      ) : (
        <DataTable
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'entity', label: 'Entity', render: (r) => <Badge>{ENTITIES[r.entity] || r.entity}</Badge> },
            { key: 'isPublic', label: 'Visibility', render: (r) => <Badge tone={r.isPublic ? 'green' : 'slate'}>{r.isPublic ? 'Public' : 'Private'}</Badge> },
            { key: 'updatedAt', label: 'Updated', render: (r) => r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : '—' },
            { key: 'actions', label: 'Actions', render: (r) => (
              <div className="flex gap-2">
                <button className="btn-sm" onClick={() => router.push(`/reports/builder/${r.id}`)}>Open</button>
                <button className="btn-sm btn-danger" onClick={() => del(r.id)}>Delete</button>
              </div>
            ) },
          ]}
          rows={reports}
        />
      )}
      <div ref={galleryRef}>
        <TemplateGallery />
      </div>
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
