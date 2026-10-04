'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, EmptyState, Badge } from '../../../../components/ui';

// Member Academy Portal — meri courses (progress) + catalog browse + enroll.
const CATEGORIES = ['', 'general', 'soft-skills', 'tech', 'business', 'wellness'];
const LEVELS = ['', 'beginner', 'intermediate', 'advanced'];

function ProgressBar({ pct }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <div className="h-2 rounded-full bg-white/10 overflow-hidden">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${p}%`, background: 'linear-gradient(90deg,#3b82f6,#8b5cf6)' }}
      />
    </div>
  );
}

function CourseCard({ course, enrolled, completed, slugMap, onEnroll, enrolling }) {
  const slug = slugMap[course.id];
  const price = course.price != null ? `PKR ${Number(course.price).toLocaleString()}` : 'Free';
  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-[#16162b] to-[#0e0e1c] p-5 hover:border-blue-500/40 transition-shadow hover:shadow-[0_0_24px_rgba(59,130,246,0.25)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-white font-semibold">{course.title}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge tone="blue">{course.category || 'general'}</Badge>
            <Badge tone="slate">{course.level || 'beginner'}</Badge>
            <Badge tone="green">{price}</Badge>
          </div>
        </div>
        {completed ? <Badge tone="green">Completed</Badge> : enrolled ? <Badge tone="blue">Enrolled</Badge> : null}
      </div>
      {course.description ? (
        <p className="mt-3 text-sm text-slate-300 line-clamp-2">{course.description}</p>
      ) : null}
      <div className="mt-3 text-xs text-slate-400">
        {course.lessonCount ?? ''} lessons
        {course.durationMin ? ` · ${course.durationMin} min` : ''}
      </div>
      <div className="mt-4 flex items-center gap-2">
        {slug ? (
          <Link
            href={`/portal/academy/${slug}`}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500"
          >
            {enrolled ? 'Continue' : 'View course'}
          </Link>
        ) : null}
        {!enrolled && !completed ? (
          <button
            onClick={() => onEnroll(course.id)}
            disabled={enrolling === course.id}
            className="px-4 py-2 rounded-xl text-sm font-semibold border border-blue-500/50 text-blue-300 hover:bg-blue-500/10 disabled:opacity-50"
          >
            {enrolling === course.id ? 'Enrolling…' : 'Enroll now'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function AcademyPortalPage() {
  const [catalog, setCatalog] = useState([]);
  const [mine, setMine] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [level, setLevel] = useState('');
  const [enrolling, setEnrolling] = useState(null);

  const slugMap = useMemo(() => {
    const m = {};
    for (const c of catalog) if (c.slug) m[c.id] = c.slug;
    return m;
  }, [catalog]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [{ data: pub }, { data: my }] = await Promise.all([
        api.get('/courses/public'),
        api.get('/enrollments/me').catch(() => ({ data: { enrollments: [] } })),
      ]);
      setCatalog(pub.courses || []);
      setMine(my.enrollments || []);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Academy load nahi ho saki.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => catalog.filter((c) => {
    const q = search.trim().toLowerCase();
    if (q && !(c.title || '').toLowerCase().includes(q) && !(c.description || '').toLowerCase().includes(q)) return false;
    if (category && c.category !== category) return false;
    if (level && c.level !== level) return false;
    return true;
  }), [catalog, search, category, level]);

  const enrolledIds = useMemo(() => new Set(mine.map((e) => e.courseId)), [mine]);
  const completedIds = useMemo(
    () => new Set(mine.filter((e) => e.status === 'completed' || e.progressPct >= 100).map((e) => e.courseId)),
    [mine]
  );
  const inProgress = mine.filter((e) => e.status === 'active' && (e.progressPct || 0) < 100);
  const done = mine.filter((e) => e.status === 'completed' || (e.progressPct || 0) >= 100);

  const enroll = async (courseId) => {
    setEnrolling(courseId);
    setError('');
    try {
      await api.post('/enrollments/enroll', { courseId });
      const { data } = await api.get('/enrollments/me');
      setMine(data.enrollments || []);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Enroll nahi ho saka.');
    } finally {
      setEnrolling(null);
    }
  };

  if (loading) return <div className="p-6"><Spinner /></div>;
  if (error && catalog.length === 0 && mine.length === 0) {
    return <div className="p-6"><ErrorBanner message={error} onRetry={load} /></div>;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader title="Academy" sub="Courses seekho, progress track karo, certificates hasil karo" />

      {error ? <div className="mt-4"><ErrorBanner message={error} onRetry={load} /></div> : null}

      {/* Continue learning */}
      {inProgress.length > 0 ? (
        <div className="mt-6">
          <h2 className="text-white font-bold text-lg">Continue learning</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {inProgress.map((e) => {
              const slug = slugMap[e.courseId];
              return (
                <div key={e.id} className="rounded-2xl border border-blue-500/30 bg-gradient-to-b from-[#181834] to-[#101020] p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-white font-semibold">{e.course?.title || 'Course'}</div>
                    <span className="text-xs text-blue-300 font-semibold">{e.progressPct || 0}%</span>
                  </div>
                  <div className="mt-3"><ProgressBar pct={e.progressPct} /></div>
                  {slug ? (
                    <Link href={`/portal/academy/${slug}`} className="mt-4 inline-block px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-violet-600">
                      Continue →
                    </Link>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Completed */}
      {done.length > 0 ? (
        <div className="mt-8">
          <h2 className="text-white font-bold text-lg">Completed</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {done.map((e) => (
              <Badge key={e.id} tone="green">{e.course?.title || 'Course'}</Badge>
            ))}
          </div>
        </div>
      ) : null}

      {/* Catalog */}
      <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-white font-bold text-lg">Course catalog</h2>
        <div className="flex flex-wrap gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search courses…"
            className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500/60"
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white [&>option]:bg-slate-900">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c || 'All categories'}</option>)}
          </select>
          <select value={level} onChange={(e) => setLevel(e.target.value)} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white [&>option]:bg-slate-900">
            {LEVELS.map((l) => <option key={l} value={l}>{l || 'All levels'}</option>)}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-4"><EmptyState title="Koi course nahi mila" hint="Search ya filters badal kar dobara try karo." /></div>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <CourseCard
              key={c.id}
              course={c}
              enrolled={enrolledIds.has(c.id)}
              completed={completedIds.has(c.id)}
              slugMap={slugMap}
              onEnroll={enroll}
              enrolling={enrolling}
            />
          ))}
        </div>
      )}
    </div>
  );
}
