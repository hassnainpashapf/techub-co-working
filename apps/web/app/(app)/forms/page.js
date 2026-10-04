'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, EmptyState, Badge, Modal, Field } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const STATUS_TONES = { draft: 'amber', published: 'green', archived: 'slate' };
const STATUS_LABELS = { draft: 'Draft', published: 'Published', archived: 'Archived' };

export default function FormsListPage() {
  const allowed = useRequireRoles('ceo', 'admin', 'super_admin', 'manager');
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState(null);

  const load = async () => {
    try {
      setLoading(true); setErr('');
      const d = await api.get(`/forms${statusFilter ? `?status=${statusFilter}` : ''}`);
      setForms(d.forms || []);
      try { const s = await api.get('/forms-dashboard/stats'); setStats(s.stats || s); } catch {}
    } catch (e) { setErr(e.message || 'Forms load nahi ho sake'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (allowed) load(); }, [allowed, statusFilter]);

  const handleCreate = async () => {
    if (!title.trim()) { setErr('Title lazmi hai'); return; }
    try {
      setSaving(true);
      const d = await api.post('/forms', { title: title.trim(), slug: slug.trim() || title.trim() });
      setShowCreate(false); setTitle(''); setSlug('');
      window.location = `/forms/${d.form.id}`;
    } catch (e) { setErr(e.message || 'Form nahi bana'); }
    finally { setSaving(false); }
  };

  const handlePublish = async (id, status) => {
    try { await api.patch(`/forms/${id}/publish`, { status }); load(); }
    catch (e) { setErr(e.message || 'Status change nahi ho saka'); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Ye form delete karna hai? Submissions bhi mit jayengi.')) return;
    try { await api.del(`/forms/${id}`); load(); }
    catch (e) { setErr(e.message || 'Delete nahi ho saka'); }
  };

  if (!allowed) return <AccessDenied />;

  return (
    <div>
      <PageHeader
        title="Forms & Surveys"
        sub="Custom forms banao, publish karo aur responses jama karo"
        actions={
          <div className="flex items-center gap-2">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-premium">
              <option value="">Sab</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
            <button onClick={() => setShowCreate(true)} className="btn-primary">+ Naya Form</button>
          </div>
        }
      />
      {err && <ErrorBanner message={err} onRetry={() => { setErr(''); load(); }} />}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div className="card p-4 text-center"><div className="text-2xl font-bold text-gray-900">{stats.totalForms ?? '—'}</div><div className="text-xs text-gray-500">Total Forms</div></div>
          <div className="card p-4 text-center"><div className="text-2xl font-bold text-green-300">{stats.publishedForms ?? '—'}</div><div className="text-xs text-gray-500">Published</div></div>
          <div className="card p-4 text-center"><div className="text-2xl font-bold text-teal-700">{stats.submissions30d ?? '—'}</div><div className="text-xs text-gray-500">Responses (30d)</div></div>
          <div className="card p-4 text-center"><div className="text-2xl font-bold text-amber-700">{stats.newInbox ?? '—'}</div><div className="text-xs text-gray-500">New Inbox</div></div>
        </div>
      )}
      {loading ? <Spinner /> : forms.length === 0 ? (
        <EmptyState title="Koi form nahi" hint="Naya Form banao — membership application, survey, feedback, kuch bhi." />
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {forms.map((f) => (
            <div key={f.id} className="card p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-gray-900">{f.title}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">/{f.slug} • {(f.fields || []).length} fields • {f.submissionCount || 0} responses</p>
                </div>
                <Badge tone={STATUS_TONES[f.status] || 'slate'}>{STATUS_LABELS[f.status] || f.status}</Badge>
              </div>
              <p className="text-sm text-gray-500 mt-2 line-clamp-2">{f.description || '—'}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <Link href={`/forms/${f.id}`} className="btn-secondary text-xs">✏️ Builder</Link>
                <Link href={`/forms/${f.id}/responses`} className="btn-secondary text-xs">📥 Responses</Link>
                {f.status !== 'published' ? (
                  <button onClick={() => handlePublish(f.id, 'published')} className="btn-secondary text-xs text-green-300">🚀 Publish</button>
                ) : (
                  <button onClick={() => handlePublish(f.id, 'draft')} className="btn-secondary text-xs">⏸ Unpublish</button>
                )}
                <button onClick={() => handleDelete(f.id)} className="btn-secondary text-xs text-red-700">🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="Naya Form" onClose={() => setShowCreate(false)}>
          <div className="space-y-3">
            <Field label="Title">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Membership Application" className="input-premium w-full" />
            </Field>
            <Field label="Slug (optional)">
              <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="membership-application" className="input-premium w-full" />
            </Field>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleCreate} disabled={saving} className="btn-primary">{saving ? '...' : 'Banao aur Builder kholo'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
