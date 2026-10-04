'use client';

// Phase 53 Track 8/10: Learning Paths — ordered course sequences + member progress.
// Integration note: member academy portal (Track 5) ke home/landing se is section ka
// link dein — route: /academy/paths. Track 2 ke CourseEnrollment.status === 'completed'
// se progress compute hoti hai (API: GET /api/learning-paths?progress=1).
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, EmptyState, Badge, Modal, Field } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';
import { useAuth } from '../../../../context/AuthContext';

const ALL_ROLES = [
  'ceo', 'admin', 'super_admin', 'operations_manager', 'manager',
  'finance_officer', 'receptionist', 'office_boy', 'member',
];
const STAFF_ROLE_SET = new Set(['ceo', 'admin', 'super_admin', 'operations_manager', 'manager']);

const emptyForm = { title: '', description: '', courseIds: [], isPublished: false };

function ProgressBar({ pct }) {
  return (
    <div className="h-2 w-full rounded-full bg-slate-700/60 overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-r from-[#0f766e] to-teal-600 transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function LearningPathsPage() {
  const allowed = useRequireRoles(...ALL_ROLES);
  const { user } = useAuth();
  const isStaff = !!user && STAFF_ROLE_SET.has(user.role);
  const [paths, setPaths] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState({});

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const q = isStaff ? '' : '?progress=1';
      const data = await api.get(`/api/learning-paths${q}`);
      setPaths(Array.isArray(data) ? data : []);
      if (isStaff) {
        try {
          const cs = await api.get('/api/courses');
          setCourses(Array.isArray(cs) ? cs : cs.courses || []);
        } catch (_) { /* courses track merge se pehle 404 ho sakta hai */ }
      }
    } catch (e) {
      setErr(e.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (allowed) load(); }, [allowed]); // eslint-disable-line

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;

  const openCreate = () => { setEditing(null); setForm(emptyForm); setShowForm(true); };
  const openEdit = (p) => {
    setEditing(p);
    setForm({ title: p.title, description: p.description || '', courseIds: p.courseIds || [], isPublished: !!p.isPublished });
    setShowForm(true);
  };

  const toggleCourse = (id) => {
    setForm((f) => ({
      ...f,
      courseIds: f.courseIds.includes(id) ? f.courseIds.filter((c) => c !== id) : [...f.courseIds, id],
    }));
  };

  const save = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      if (editing) await api.patch(`/api/learning-paths/${editing.id}`, form);
      else await api.post('/api/learning-paths', form);
      setShowForm(false);
      await load();
    } catch (e) {
      setErr(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p) => {
    if (!confirm(`Delete learning path "${p.title}"?`)) return;
    try {
      await api.del(`/api/learning-paths/${p.id}`);
      await load();
    } catch (e) { setErr(e.message || 'Delete failed'); }
  };

  const toggleExpanded = (id) => setExpanded((s) => ({ ...s, [id]: !s[id] }));

  return (
    <div>
      <PageHeader
        title="Learning Paths"
        sub={isStaff ? 'Ordered course sequences — curate, publish, track' : 'Guided course journeys — follow step by step'}
        actions={isStaff ? (
          <button onClick={openCreate} className="rounded-lg bg-[#0f766e] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f766e]">
            + New Path
          </button>
        ) : null}
      />
      {err && <ErrorBanner message={err} onRetry={load} />}
      {paths.length === 0 ? (
        <EmptyState title="No learning paths yet" hint={isStaff ? 'Create a path and add courses in order.' : 'Check back soon — paths will appear here.'} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {paths.map((p) => {
            const open = !!expanded[p.id];
            const courseList = p.courses || [];
            return (
              <div key={p.id} className="rounded-xl border border-gray-200/60 bg-white p-5 shadow-lg">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{p.title}</h3>
                    {p.description && <p className="mt-1 text-sm text-gray-600">{p.description}</p>}
                  </div>
                  {isStaff ? (
                    <Badge tone={p.isPublished ? 'green' : 'slate'}>{p.isPublished ? 'Published' : 'Draft'}</Badge>
                  ) : (
                    <Badge tone="blue">{p.completedCourses ?? 0}/{p.totalCourses ?? 0} done</Badge>
                  )}
                </div>
                {!isStaff && typeof p.progressPct === 'number' && (
                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex-1"><ProgressBar pct={p.progressPct} /></div>
                    <span className="text-xs font-medium text-gray-600">{p.progressPct}%</span>
                  </div>
                )}
                <button
                  onClick={() => toggleExpanded(p.id)}
                  className="mt-3 text-sm font-medium text-teal-700 hover:text-teal-700"
                >
                  {open ? 'Hide courses ▴' : `Show courses (${courseList.length}) ▾`}
                </button>
                {open && (
                  <ol className="mt-2 space-y-2">
                    {courseList.map((c, i) => (
                      <li key={c.id || i} className="flex items-center gap-3 rounded-lg bg-gray-100/50 px-3 py-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-gray-800">{i + 1}</span>
                        <span className="flex-1 text-sm text-gray-800">{c.title || c.id}</span>
                        {!isStaff && c.completed && <span className="text-green-400">✓</span>}
                      </li>
                    ))}
                    {courseList.length === 0 && <li className="text-sm text-gray-500">No courses in this path.</li>}
                  </ol>
                )}
                {isStaff && (
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => openEdit(p)} className="rounded-lg bg-[#0f766e] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0f766e]">Edit</button>
                    <button onClick={() => remove(p)} className="rounded-lg bg-red-50 border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100">Delete</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {showForm && (
        <Modal title={editing ? 'Edit Learning Path' : 'New Learning Path'} onClose={() => setShowForm(false)}>
          <div className="space-y-4">
            <Field label="Title">
              <input
                className="w-full rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-gray-900"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>
            <Field label="Description">
              <textarea
                className="w-full rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-gray-900"
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Field>
            <Field label="Courses (in order — click to toggle)">
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">
                {courses.map((c) => {
                  const idx = form.courseIds.indexOf(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCourse(c.id)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${idx >= 0 ? 'bg-[#0f766e]/30 text-blue-100' : 'text-gray-600 hover:bg-gray-100'}`}
                    >
                      <span className="text-xs text-gray-500">{idx >= 0 ? `#${idx + 1}` : '—'}</span>
                      <span className="flex-1">{c.title}</span>
                      {idx >= 0 && <span className="text-teal-700">✓</span>}
                    </button>
                  );
                })}
                {courses.length === 0 && <p className="p-2 text-sm text-gray-500">No courses found — create courses first.</p>}
              </div>
            </Field>
            <label className="flex items-center gap-2 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={form.isPublished}
                onChange={(e) => setForm({ ...form, isPublished: e.target.checked })}
              />
              Published (visible to members)
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-[#0f766e] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f766e] disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
