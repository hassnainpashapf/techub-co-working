'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, apiDownload } from '../../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, EmptyState, Badge, Modal, Field } from '../../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../../components/Protected';

const STATUS_TONES = { new: 'blue', reviewed: 'amber', actioned: 'green', spam: 'red' };
const STATUS_LABELS = { new: 'New', reviewed: 'Reviewed', actioned: 'Actioned', spam: 'Spam' };

function formatAnswer(v) {
  if (v === undefined || v === null || v === '') return '—';
  if (Array.isArray(v)) {
    return v.map((x) => (x && typeof x === 'object' ? (x.name || x.url || 'file') : String(x))).join(', ');
  }
  if (typeof v === 'object') return v.name || v.url || JSON.stringify(v).slice(0, 120);
  return String(v).slice(0, 300);
}

export default function FormResponsesPage() {
  const allowed = useRequireRoles('ceo', 'admin', 'super_admin', 'manager');
  const { id } = useParams();
  const [tab, setTab] = useState('responses');
  const [form, setForm] = useState(null);
  // responses
  const [subs, setSubs] = useState([]);
  const [summary, setSummary] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [detail, setDetail] = useState(null);
  const [users, setUsers] = useState([]);
  const [dStatus, setDStatus] = useState('');
  const [dAssign, setDAssign] = useState('');
  const [dNotes, setDNotes] = useState('');
  // analytics
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const loadForm = async () => {
    const d = await api.get(`/forms/${id}`);
    setForm(d.form);
  };

  const loadResponses = async () => {
    const q = new URLSearchParams({ formId: id, page: String(page), limit: '20' });
    if (statusFilter) q.set('status', statusFilter);
    if (search.trim()) q.set('search', search.trim());
    const d = await api.get(`/form-inbox?${q}`);
    setSubs(d.submissions || []); setPages(d.pages || 1);
    const s = await api.get(`/form-inbox/summary?formId=${id}`);
    setSummary(s.summary);
  };

  const loadAnalytics = async () => {
    const d = await api.get(`/form-analytics/${id}`);
    setAnalytics(d);
  };

  const loadAll = async () => {
    try {
      setLoading(true); setErr('');
      await loadForm();
      if (tab === 'responses') await loadResponses();
      else await loadAnalytics();
    } catch (e) { setErr(e.message || 'Load nahi ho saka'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (allowed) loadAll(); }, [allowed, id, tab, page, statusFilter]);

  useEffect(() => {
    if (!allowed) return;
    api.get('/users').then((d) => setUsers(d.users || [])).catch(() => {});
  }, [allowed]);

  const openDetail = async (sid) => {
    try {
      const d = await api.get(`/form-inbox/${sid}`);
      setDetail(d.submission);
      setDStatus(d.submission.status || 'new');
      setDAssign(d.submission.assignedToId || '');
      setDNotes(d.submission.notes || '');
    } catch (e) { setErr(e.message || 'Detail nahi khul saka'); }
  };

  const saveDetail = async () => {
    try {
      await api.patch(`/form-inbox/${detail.id}`, {
        status: dStatus,
        assignedToId: dAssign || null,
        notes: dNotes,
      });
      setDetail(null); loadResponses();
    } catch (e) { setErr(e.message || 'Update nahi ho saka'); }
  };

  const deleteSub = async (sid) => {
    if (!confirm('Ye submission delete karna hai?')) return;
    try { await api.del(`/form-inbox/${sid}`); setDetail(null); loadResponses(); }
    catch (e) { setErr(e.message || 'Delete nahi ho saka'); }
  };

  const exportCsv = () => {
    apiDownload(`/form-analytics/${id}/export.csv`, `form-submissions-${form?.slug || id}.csv`);
  };

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;

  const fields = detail?.form?.fields || [];

  return (
    <div>
      <PageHeader
        title={form?.title ? `📥 ${form.title}` : 'Responses'}
        sub={`/${form?.slug || ''} • ${form?.status || ''}`}
        actions={
          <div className="flex gap-2">
            <Link href="/forms" className="btn-secondary">← Forms</Link>
            <Link href={`/forms/${id}`} className="btn-secondary">✏️ Builder</Link>
          </div>
        }
      />
      {err && <ErrorBanner message={err} onRetry={() => setErr('')} />}

      <div className="flex gap-2 mb-4">
        {['responses', 'analytics'].map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setPage(1); }}
            className={tab === t ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
          >
            {t === 'responses' ? '📥 Responses' : '📊 Analytics'}
          </button>
        ))}
        {tab === 'analytics' && (
          <button onClick={exportCsv} className="btn-secondary text-sm ml-auto">⬇ Export CSV</button>
        )}
      </div>

      {tab === 'responses' && (
        <div>
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              {['new', 'reviewed', 'actioned', 'spam', 'total'].map((s) => (
                <div key={s} className="card p-3 text-center cursor-pointer" onClick={() => { setStatusFilter(s === 'total' ? '' : s); setPage(1); }}>
                  <div className="text-2xl font-bold text-white">{summary[s] || 0}</div>
                  <div className="text-xs text-slate-400">{STATUS_LABELS[s] || 'Total'}</div>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 mb-3">
            <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadResponses()} placeholder="Naam/email se search..." className="input-premium flex-1" />
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="input-premium">
              <option value="">Sab status</option>
              <option value="new">New</option>
              <option value="reviewed">Reviewed</option>
              <option value="actioned">Actioned</option>
              <option value="spam">Spam</option>
            </select>
            <button onClick={() => { setPage(1); loadResponses(); }} className="btn-secondary">🔍</button>
          </div>
          {subs.length === 0 ? (
            <EmptyState title="Koi response nahi" hint="Public form ka link share karein." />
          ) : (
            <div className="space-y-2">
              {subs.map((s) => (
                <div key={s.id} onClick={() => openDetail(s.id)} className="card p-4 cursor-pointer hover:border-blue-500/40">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-white">{s.submitterName || s.submitterEmail || 'Anonymous'}</p>
                      <p className="text-xs text-slate-400">{s.submitterEmail || '—'} • {s.answerCount} answers • {new Date(s.createdAt).toLocaleString('en-PK')}</p>
                      {s.assignedTo && <p className="text-xs text-blue-300 mt-0.5">👤 {s.assignedTo.name}</p>}
                    </div>
                    <Badge tone={STATUS_TONES[s.status] || 'slate'}>{STATUS_LABELS[s.status] || s.status}</Badge>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="btn-secondary text-sm">← Prev</button>
                <span className="text-xs text-slate-400">Page {page} / {pages}</span>
                <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="btn-secondary text-sm">Next →</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'analytics' && analytics && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="card p-4 text-center">
              <div className="text-2xl font-bold text-white">{analytics.totals?.submissions || 0}</div>
              <div className="text-xs text-slate-400">Total Responses</div>
            </div>
          </div>
          {(analytics.fieldStats || []).map((fs) => (
            <div key={fs.fieldId} className="card p-4">
              <h4 className="font-semibold text-white text-sm mb-2">{fs.label} <span className="text-xs text-slate-500">({fs.responses} responses)</span></h4>
              {fs.optionCounts && (
                <div className="space-y-1">
                  {Object.entries(fs.optionCounts).sort((a, b) => b[1] - a[1]).map(([opt, c]) => (
                    <div key={opt} className="flex items-center gap-2 text-sm">
                      <span className="text-slate-300 flex-1 truncate">{opt}</span>
                      <div className="w-40 bg-white/10 rounded-full h-2"><div className="bg-blue-500 h-2 rounded-full" style={{ width: `${(c / fs.responses) * 100}%` }} /></div>
                      <span className="text-slate-400 text-xs w-8 text-right">{c}</span>
                    </div>
                  ))}
                </div>
              )}
              {fs.avg !== undefined && (
                <p className="text-sm text-slate-300">Avg: <span className="font-bold text-amber-300">{fs.avg}</span>{fs.min !== undefined && fs.min !== null && <span className="text-slate-500"> (min {fs.min}, max {fs.max})</span>}</p>
              )}
              {fs.distribution && (
                <div className="flex gap-2 mt-1">
                  {Object.entries(fs.distribution).sort().map(([star, c]) => (
                    <span key={star} className="text-xs bg-white/5 px-2 py-1 rounded text-amber-300">★{star}: {c}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {(!analytics.fieldStats || analytics.fieldStats.length === 0) && (
            <EmptyState title="Koi data nahi" hint="Responses aane par analytics yahan dikhega." />
          )}
        </div>
      )}

      {detail && (
        <Modal title={detail.submitterName || detail.submitterEmail || 'Submission'} onClose={() => setDetail(null)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="text-slate-400">Email</div><div className="text-white">{detail.submitterEmail || '—'}</div>
              <div className="text-slate-400">Date</div><div className="text-white">{new Date(detail.createdAt).toLocaleString('en-PK')}</div>
            </div>
            <div className="border-t border-white/10 pt-3 space-y-2">
              {fields.map((f) => (
                <div key={f.id} className="grid grid-cols-3 gap-2 text-sm">
                  <div className="text-slate-400">{f.label}</div>
                  <div className="text-white col-span-2 break-words">{formatAnswer(detail.answers?.[f.id])}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Status">
                <select value={dStatus} onChange={(e) => setDStatus(e.target.value)} className="input-premium w-full">
                  <option value="new">New</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="actioned">Actioned</option>
                  <option value="spam">Spam</option>
                </select>
              </Field>
              <Field label="Assign to">
                <select value={dAssign} onChange={(e) => setDAssign(e.target.value)} className="input-premium w-full">
                  <option value="">— None —</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
                </select>
              </Field>
            </div>
            <Field label="Notes">
              <textarea value={dNotes} onChange={(e) => setDNotes(e.target.value)} rows={2} className="input-premium w-full" />
            </Field>
            <div className="flex justify-between gap-2">
              <button onClick={() => deleteSub(detail.id)} className="btn-secondary text-red-300">🗑 Delete</button>
              <div className="flex gap-2">
                <button onClick={() => setDetail(null)} className="btn-secondary">Cancel</button>
                <button onClick={saveDetail} className="btn-primary">💾 Save</button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

