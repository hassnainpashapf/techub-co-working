'use client';

// Phase 53 Track 1/10: Course Catalog — course list + course builder (lessons + reorder).
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, EmptyState, Badge, Modal, Field } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const LEVEL_TONES = { beginner: 'green', intermediate: 'amber', advanced: 'red' };
const LEVEL_LABELS = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
const TYPE_ICONS = { video: '🎬', text: '📝', file: '📎', quiz: '❓' };
const TYPE_LABELS = { video: 'Video', text: 'Text', file: 'File', quiz: 'Quiz' };
const STAFF_ROLES = ['ceo', 'admin', 'super_admin', 'manager'];

const emptyCourse = { title: '', description: '', category: 'general', level: 'beginner', price: '', durationMin: '', thumbnailUrl: '' };
const emptyLesson = { title: '', type: 'text', contentUrl: '', body: '', durationMin: '', isFree: false };

export default function CoursesPage() {
  const allowed = useRequireRoles(...STAFF_ROLES);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [courseForm, setCourseForm] = useState(emptyCourse);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(null); // builder course (with lessons)
  const [lessons, setLessons] = useState([]);
  const [showLesson, setShowLesson] = useState(false);
  const [lessonForm, setLessonForm] = useState(emptyLesson);
  const [editingLesson, setEditingLesson] = useState(null);
  const [savingLesson, setSavingLesson] = useState(false);
  const [builderLoading, setBuilderLoading] = useState(false);

  const load = async () => {
    try {
      setLoading(true); setErr('');
      const q = new URLSearchParams();
      if (levelFilter) q.set('level', levelFilter);
      if (search.trim()) q.set('search', search.trim());
      const d = await api.get(`/courses${q.toString() ? `?${q}` : ''}`);
      setCourses(d.courses || []);
    } catch (e) { setErr(e.message || 'Courses load nahi ho sake'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (allowed) load(); }, [allowed]); // eslint-disable-line

  const openBuilder = async (id) => {
    try {
      setBuilderLoading(true); setErr('');
      const d = await api.get(`/courses/${id}`);
      setSelected(d.course);
      setLessons((d.course.lessons || []).slice().sort((a, b) => a.sortOrder - b.sortOrder));
    } catch (e) { setErr(e.message || 'Course nahi khula'); }
    finally { setBuilderLoading(false); }
  };

  const handleCreate = async () => {
    if (!courseForm.title.trim()) { setErr('Title lazmi hai'); return; }
    try {
      setSaving(true);
      const payload = {
        title: courseForm.title.trim(),
        description: courseForm.description.trim() || null,
        category: courseForm.category || 'general',
        level: courseForm.level || 'beginner',
        price: courseForm.price === '' ? null : Number(courseForm.price),
        durationMin: courseForm.durationMin === '' ? null : Number(courseForm.durationMin),
        thumbnailUrl: courseForm.thumbnailUrl.trim() || null,
      };
      const d = await api.post('/courses', payload);
      setShowCreate(false); setCourseForm(emptyCourse);
      load(); openBuilder(d.course.id);
    } catch (e) { setErr(e.message || 'Course nahi bana'); }
    finally { setSaving(false); }
  };

  const handlePublish = async (id, isPublished) => {
    try { await api.patch(`/courses/${id}/publish`, { isPublished }); load(); if (selected?.id === id) setSelected({ ...selected, isPublished }); }
    catch (e) { setErr(e.message || 'Status change nahi ho saka'); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Ye course delete karna hai? Saari lessons bhi mit jayengi.')) return;
    try { await api.del(`/courses/${id}`); if (selected?.id === id) { setSelected(null); setLessons([]); } load(); }
    catch (e) { setErr(e.message || 'Delete nahi ho saka'); }
  };

  const openLessonModal = (lesson = null) => {
    setEditingLesson(lesson);
    setLessonForm(lesson ? {
      title: lesson.title || '',
      type: lesson.type || 'text',
      contentUrl: lesson.contentUrl || '',
      body: lesson.body || '',
      durationMin: lesson.durationMin ?? '',
      isFree: !!lesson.isFree,
    } : { ...emptyLesson });
    setShowLesson(true);
  };

  const handleSaveLesson = async () => {
    if (!lessonForm.title.trim()) { setErr('Lesson ka title lazmi hai'); return; }
    try {
      setSavingLesson(true);
      const payload = {
        title: lessonForm.title.trim(),
        type: lessonForm.type,
        contentUrl: lessonForm.contentUrl.trim() || null,
        body: lessonForm.body.trim() || null,
        durationMin: lessonForm.durationMin === '' ? null : Number(lessonForm.durationMin),
        isFree: !!lessonForm.isFree,
      };
      if (editingLesson) {
        await api.put(`/courses/lessons/${editingLesson.id}`, payload);
      } else {
        await api.post(`/courses/${selected.id}/lessons`, payload);
      }
      setShowLesson(false); setEditingLesson(null); setLessonForm({ ...emptyLesson });
      openBuilder(selected.id); load();
    } catch (e) { setErr(e.message || 'Lesson save nahi ho saka'); }
    finally { setSavingLesson(false); }
  };

  const handleDeleteLesson = async (id) => {
    if (!confirm('Ye lesson delete karna hai?')) return;
    try { await api.del(`/courses/lessons/${id}`); openBuilder(selected.id); load(); }
    catch (e) { setErr(e.message || 'Lesson delete nahi ho saka'); }
  };

  const moveLesson = async (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= lessons.length) return;
    const next = lessons.slice();
    const [moved] = next.splice(idx, 1);
    next.splice(j, 0, moved);
    const order = next.map((l, i) => ({ id: l.id, sortOrder: i }));
    setLessons(next.map((l, i) => ({ ...l, sortOrder: i })));
    try {
      await api.put(`/courses/${selected.id}/reorder`, { items: order });
    } catch (e) { setErr(e.message || 'Order save nahi ho saka'); openBuilder(selected.id); }
  };

  if (!allowed) return <AccessDenied />;

  return (
    <div>
      <PageHeader
        title="Academy — Courses"
        sub="Courses banao, lessons joro aur order set karo"
        actions={
          <div className="flex items-center gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} placeholder="Search..." className="input-premium w-40" />
            <select value={levelFilter} onChange={(e) => { setLevelFilter(e.target.value); }} className="input-premium">
              <option value="">Sab levels</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
            <button onClick={load} className="btn-secondary text-xs">🔍</button>
            <button onClick={() => setShowCreate(true)} className="btn-primary">+ Naya Course</button>
          </div>
        }
      />
      {err && <ErrorBanner message={err} onRetry={() => { setErr(''); load(); }} />}

      {selected ? (
        <div>
          <button onClick={() => { setSelected(null); setLessons([]); }} className="btn-secondary text-xs mb-3">← Sab courses</button>
          {builderLoading ? <Spinner /> : (
            <div className="grid lg:grid-cols-3 gap-4">
              <div className="card p-5">
                <h3 className="font-semibold text-gray-900 mb-3">Course Details</h3>
                <div className="space-y-2 text-sm">
                  <div><div className="text-gray-500 text-xs">Title</div><div className="text-gray-900 font-medium">{selected.title}</div></div>
                  <div><div className="text-gray-500 text-xs">Slug</div><div className="text-gray-600">/{selected.slug}</div></div>
                  <div className="flex gap-2">
                    <Badge tone={LEVEL_TONES[selected.level] || 'slate'}>{LEVEL_LABELS[selected.level] || selected.level}</Badge>
                    <Badge tone={selected.isPublished ? 'green' : 'amber'}>{selected.isPublished ? 'Published' : 'Draft'}</Badge>
                    {selected.price != null && <Badge tone="blue">PKR {selected.price}</Badge>}
                  </div>
                  <p className="text-gray-500 text-xs">{selected.description || '—'}</p>
                  <div className="text-xs text-gray-500">{lessons.length} lessons {selected.durationMin ? `• ~${selected.durationMin} min` : ''}</div>
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                  {selected.isPublished ? (
                    <button onClick={() => handlePublish(selected.id, false)} className="btn-secondary text-xs">⏸ Unpublish</button>
                  ) : (
                    <button onClick={() => handlePublish(selected.id, true)} className="btn-secondary text-xs text-green-300">🚀 Publish</button>
                  )}
                  <button onClick={() => handleDelete(selected.id)} className="btn-secondary text-xs text-red-300">🗑 Delete</button>
                </div>
              </div>
              <div className="lg:col-span-2 card p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">Lessons ({lessons.length})</h3>
                  <button onClick={() => openLessonModal()} className="btn-primary text-xs">+ Lesson joro</button>
                </div>
                {lessons.length === 0 ? (
                  <EmptyState title="Koi lesson nahi" hint="Pehli lesson joro — video, text, file ya quiz." />
                ) : (
                  <div className="space-y-2">
                    {lessons.map((l, i) => (
                      <div key={l.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-100 border border-gray-200">
                        <div className="flex flex-col gap-1">
                          <button onClick={() => moveLesson(i, -1)} disabled={i === 0} className="text-gray-500 hover:text-gray-900 disabled:opacity-30 text-sm">▲</button>
                          <button onClick={() => moveLesson(i, 1)} disabled={i === lessons.length - 1} className="text-gray-500 hover:text-gray-900 disabled:opacity-30 text-sm">▼</button>
                        </div>
                        <div className="text-xl">{TYPE_ICONS[l.type] || '📝'}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-gray-900 text-sm font-medium truncate">{l.title}</div>
                          <div className="text-xs text-gray-500">{TYPE_LABELS[l.type] || l.type}{l.durationMin ? ` • ${l.durationMin} min` : ''}{l.isFree ? ' • 🆓 Free preview' : ''}</div>
                        </div>
                        <button onClick={() => openLessonModal(l)} className="btn-secondary text-xs">✏️</button>
                        <button onClick={() => handleDeleteLesson(l.id)} className="btn-secondary text-xs text-red-300">🗑</button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-slate-500 mt-3">▲▼ buttons se order badlo — save automatically ho jata hai.</p>
              </div>
            </div>
          )}
        </div>
      ) : loading ? <Spinner /> : courses.length === 0 ? (
        <EmptyState title="Koi course nahi" hint="Naya Course banao — staff training, member onboarding, workshops, kuch bhi." />
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {courses.map((c) => (
            <div key={c.id} className="card p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-gray-900 truncate">{c.title}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">/{c.slug} • {c.category} • {c.lessonCount || 0} lessons</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge tone={c.isPublished ? 'green' : 'amber'}>{c.isPublished ? 'Published' : 'Draft'}</Badge>
                  <Badge tone={LEVEL_TONES[c.level] || 'slate'}>{LEVEL_LABELS[c.level] || c.level}</Badge>
                </div>
              </div>
              <p className="text-sm text-gray-500 mt-2 line-clamp-2">{c.description || '—'}</p>
              <div className="flex flex-wrap gap-2 mt-4">
                <button onClick={() => openBuilder(c.id)} className="btn-secondary text-xs">✏️ Builder</button>
                {c.isPublished ? (
                  <button onClick={() => handlePublish(c.id, false)} className="btn-secondary text-xs">⏸ Unpublish</button>
                ) : (
                  <button onClick={() => handlePublish(c.id, true)} className="btn-secondary text-xs text-green-300">🚀 Publish</button>
                )}
                <button onClick={() => handleDelete(c.id)} className="btn-secondary text-xs text-red-300">🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="Naya Course" onClose={() => setShowCreate(false)}>
          <div className="space-y-3">
            <Field label="Title"><input value={courseForm.title} onChange={(e) => setCourseForm({ ...courseForm, title: e.target.value })} placeholder="Startup Basics" className="input-premium w-full" /></Field>
            <Field label="Description"><textarea value={courseForm.description} onChange={(e) => setCourseForm({ ...courseForm, description: e.target.value })} rows={3} className="input-premium w-full" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <select value={courseForm.category} onChange={(e) => setCourseForm({ ...courseForm, category: e.target.value })} className="input-premium w-full">
                  <option value="general">General</option>
                  <option value="soft-skills">Soft Skills</option>
                  <option value="tech">Tech</option>
                  <option value="business">Business</option>
                  <option value="wellness">Wellness</option>
                </select>
              </Field>
              <Field label="Level">
                <select value={courseForm.level} onChange={(e) => setCourseForm({ ...courseForm, level: e.target.value })} className="input-premium w-full">
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Price (PKR, khali = free)"><input type="number" min="0" value={courseForm.price} onChange={(e) => setCourseForm({ ...courseForm, price: e.target.value })} className="input-premium w-full" /></Field>
              <Field label="Duration (min)"><input type="number" min="0" value={courseForm.durationMin} onChange={(e) => setCourseForm({ ...courseForm, durationMin: e.target.value })} className="input-premium w-full" /></Field>
            </div>
            <Field label="Thumbnail URL"><input value={courseForm.thumbnailUrl} onChange={(e) => setCourseForm({ ...courseForm, thumbnailUrl: e.target.value })} placeholder="https://..." className="input-premium w-full" /></Field>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleCreate} disabled={saving} className="btn-primary">{saving ? 'Ban raha...' : 'Banao'}</button>
            </div>
          </div>
        </Modal>
      )}

      {showLesson && selected && (
        <Modal title={editingLesson ? 'Lesson Edit karo' : 'Nayi Lesson'} onClose={() => setShowLesson(false)}>
          <div className="space-y-3">
            <Field label="Title"><input value={lessonForm.title} onChange={(e) => setLessonForm({ ...lessonForm, title: e.target.value })} placeholder="Intro to Coworking" className="input-premium w-full" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <select value={lessonForm.type} onChange={(e) => setLessonForm({ ...lessonForm, type: e.target.value })} className="input-premium w-full">
                  <option value="text">📝 Text</option>
                  <option value="video">🎬 Video</option>
                  <option value="file">📎 File</option>
                  <option value="quiz">❓ Quiz</option>
                </select>
              </Field>
              <Field label="Duration (min)"><input type="number" min="0" value={lessonForm.durationMin} onChange={(e) => setLessonForm({ ...lessonForm, durationMin: e.target.value })} className="input-premium w-full" /></Field>
            </div>
            {lessonForm.type === 'text' ? (
              <Field label="Content"><textarea value={lessonForm.body} onChange={(e) => setLessonForm({ ...lessonForm, body: e.target.value })} rows={5} className="input-premium w-full" placeholder="Lesson ka text..." /></Field>
            ) : (
              <Field label="Content URL"><input value={lessonForm.contentUrl} onChange={(e) => setLessonForm({ ...lessonForm, contentUrl: e.target.value })} placeholder="https://... (video/file link)" className="input-premium w-full" /></Field>
            )}
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={lessonForm.isFree} onChange={(e) => setLessonForm({ ...lessonForm, isFree: e.target.checked })} />
              Free preview (bina enroll dekha ja sakta hai)
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowLesson(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleSaveLesson} disabled={savingLesson} className="btn-primary">{savingLesson ? 'Save ho raha...' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
