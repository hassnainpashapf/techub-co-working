'use client';

// Phase 53 Track 5/10: Member Academy Portal — course detail + lesson player.
// Mount path: /portal/academy/[courseId] (courseId = course slug).
// Backend:
//   GET  /api/courses/member/:slug                     — course + lessons (enrolled → full content)
//   GET  /api/enrollments/me/:courseId                 — enrollment + lessonProgress map
//   POST /api/enrollments/enroll { courseId }          — enroll
//   POST /api/enrollments/me/lessons/:lessonId/done    — mark done/undone
//   GET  /api/quizzes/my/quiz/:lessonId               — quiz (lesson type quiz)
//   POST /api/quizzes/attempts { quizId, answers }     — quiz submit (auto-grade)

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, EmptyState, Badge } from '../../../../../components/ui';

const TYPE_LABEL = { video: 'Video', text: 'Text', file: 'File', quiz: 'Quiz' };
const TYPE_TONE = { video: 'blue', text: 'slate', file: 'amber', quiz: 'green' };

function toEmbedUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube.com/embed/${v}`;
    }
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.split('/').filter(Boolean)[0];
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    if (u.hostname.includes('vimeo.com')) {
      const id = u.pathname.split('/').filter(Boolean)[0];
      if (id) return `https://player.vimeo.com/video/${id}`;
    }
  } catch { /* ignore */ }
  return null;
}

function QuizPlayer({ lessonId, onPass }) {
  const [quiz, setQuiz] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    setResult(null);
    setAnswers({});
    api.get(`/quizzes/my/quiz/${lessonId}`)
      .then(({ data }) => { if (alive) setQuiz(data); })
      .catch((e) => { if (alive) setError(e?.response?.data?.error || 'Quiz load nahi ho saka.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [lessonId]);

  if (loading) return <div className="p-6"><Spinner /></div>;
  if (error) return <div className="p-6"><ErrorBanner message={error} /></div>;
  if (!quiz) return null;

  const qs = quiz.questions || [];
  const submit = async () => {
    if (Object.keys(answers).length < qs.length) {
      setError('Sab sawalon ke jawab select karo.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const { data } = await api.post('/quizzes/attempts', {
        quizId: quiz.id,
        answers: qs.map((q) => ({ questionId: q.id, selectedIndex: answers[q.id] })),
      });
      const att = data.attempt || data;
      setResult(att);
      if (att.passed && onPass) onPass();
    } catch (e) {
      setError(e?.response?.data?.error || 'Submit nahi ho saka.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-gray-900 font-bold text-lg">{quiz.title || 'Quiz'}</h3>
        <div className="flex gap-2">
          <Badge tone="slate">Pass: {quiz.passingPct ?? 60}%</Badge>
          {quiz.bestScore != null ? <Badge tone="blue">Best: {quiz.bestScore}%</Badge> : null}
          {quiz.remainingAttempts != null ? <Badge tone="amber">{quiz.remainingAttempts} attempts left</Badge> : null}
        </div>
      </div>
      {result ? (
        <div className={`mt-4 rounded-xl border p-4 ${result.passed ? 'border-green-500/40 bg-green-500/10' : 'border-red-500/40 bg-red-50'}`}>
          <div className="text-gray-900 font-bold">{result.passed ? '🎉 Quiz pass!' : 'Quiz pass nahi hua'}</div>
          <div className="text-sm text-gray-600 mt-1">Score: {result.score}%</div>
          {!result.passed && quiz.remainingAttempts > 0 ? (
            <button onClick={() => { setResult(null); setAnswers({}); }} className="mt-3 px-4 py-2 rounded-xl text-sm font-semibold border border-gray-300 text-gray-900 hover:bg-gray-100">
              Dobara try karo
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          {qs.map((q, i) => (
            <div key={q.id} className="rounded-xl border border-gray-200 bg-gray-100 p-4">
              <div className="text-gray-900 font-medium">{i + 1}. {q.text}</div>
              <div className="mt-2 space-y-1.5">
                {(q.options || []).map((opt, oi) => (
                  <label key={oi} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer border ${answers[q.id] === oi ? 'border-[#0f766e] bg-[#0f766e]/15 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-100'}`}>
                    <input
                      type="radio"
                      name={`q-${q.id}`}
                      checked={answers[q.id] === oi}
                      onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                      className="accent-[#0f766e]"
                    />
                    {opt}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {error ? <div className="mt-2"><ErrorBanner message={error} /></div> : null}
          <button
            onClick={submit}
            disabled={submitting || (quiz.remainingAttempts != null && quiz.remainingAttempts <= 0)}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-gray-900 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit answers'}
          </button>
        </div>
      )}
      {quiz.myAttempts?.length > 0 ? (
        <div className="mt-6">
          <div className="text-gray-500 text-xs uppercase tracking-wider mb-2">Past attempts</div>
          <div className="flex flex-wrap gap-2">
            {quiz.myAttempts.slice(0, 5).map((a) => (
              <Badge key={a.id} tone={a.passed ? 'green' : 'red'}>{a.score}%</Badge>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LessonPlayer({ lesson, onPass, enrolled }) {
  if (lesson.type === 'quiz') return <QuizPlayer lessonId={lesson.id} onPass={onPass} />;
  if (lesson.type === 'video') {
    const embed = toEmbedUrl(lesson.contentUrl);
    return (
      <div className="p-6">
        {embed ? (
          <div className="aspect-video rounded-xl overflow-hidden border border-gray-200 bg-black">
            <iframe src={embed} className="w-full h-full" allowFullScreen title={lesson.title} />
          </div>
        ) : lesson.contentUrl ? (
          <video src={lesson.contentUrl} controls className="w-full rounded-xl border border-gray-200 bg-black" />
        ) : (
          <EmptyState title="Video available nahi" hint="Is lesson ka video link abhi add nahi hua." />
        )}
        {lesson.body ? <p className="mt-4 text-sm text-gray-600 whitespace-pre-wrap">{lesson.body}</p> : null}
      </div>
    );
  }
  if (lesson.type === 'file') {
    return (
      <div className="p-6 text-center">
        <div className="text-5xl">📎</div>
        <div className="mt-3 text-gray-900 font-semibold">{lesson.title}</div>
        {lesson.body ? <p className="mt-2 text-sm text-gray-500">{lesson.body}</p> : null}
        {enrolled && lesson.contentUrl ? (
          <a
            href={lesson.contentUrl}
            download
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-block px-5 py-2.5 rounded-xl text-sm font-semibold text-gray-900 bg-gradient-to-r from-[#0f766e] to-teal-700"
          >
            ⬇ Download file
          </a>
        ) : (
          <div className="mt-4 text-sm text-gray-500">File download ke liye course me enroll hona zaroori hai.</div>
        )}
      </div>
    );
  }
  // text
  return (
    <div className="p-6">
      {lesson.body ? (
        <div className="text-gray-800 leading-relaxed whitespace-pre-wrap">{lesson.body}</div>
      ) : (
        <EmptyState title="Content khali hai" hint="Is lesson ka text abhi add nahi hua." />
      )}
    </div>
  );
}

export default function AcademyDetailPage() {
  const { courseId: slug } = useParams();
  const [course, setCourse] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [enrolled, setEnrolled] = useState(false);
  const [enrollment, setEnrollment] = useState(null);
  const [progressMap, setProgressMap] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [acting, setActing] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/courses/member/${slug}`);
      setCourse(data.course);
      setLessons(data.lessons || []);
      setEnrolled(!!data.enrolled);
      setActiveId((data.lessons || [])[0]?.id || null);
      if (data.enrolled && data.course?.id) {
        try {
          const { data: prog } = await api.get(`/enrollments/me/${data.course.id}`);
          setEnrollment(prog.enrollment);
          const pm = {};
          for (const p of prog.enrollment.lessonProgress || []) pm[p.lessonId] = p.isDone;
          setProgressMap(pm);
        } catch { /* progress optional */ }
      }
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Course load nahi ho saka.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (slug) load(); }, [slug]);

  const activeLesson = useMemo(() => lessons.find((l) => l.id === activeId) || null, [lessons, activeId]);
  const activeIndex = useMemo(() => lessons.findIndex((l) => l.id === activeId), [lessons, activeId]);
  const doneCount = lessons.filter((l) => progressMap[l.id]).length;

  const enroll = async () => {
    setActing(true);
    setError('');
    try {
      await api.post('/enrollments/enroll', { courseId: course.id });
      await load();
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Enroll nahi ho saka.');
    } finally {
      setActing(false);
    }
  };

  const markDone = async (done) => {
    if (!activeLesson) return;
    setActing(true);
    try {
      const { data } = await api.post(`/enrollments/me/lessons/${activeLesson.id}/done`, { done });
      setEnrollment((en) => (en ? { ...en, progressPct: data.enrollment.progressPct, status: data.enrollment.status } : en));
      setProgressMap((m) => ({ ...m, [activeLesson.id]: done }));
      if (done && activeIndex < lessons.length - 1) {
        setActiveId(lessons[activeIndex + 1].id);
      }
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Progress save nahi ho saki.');
    } finally {
      setActing(false);
    }
  };

  if (loading) return <div className="p-6"><Spinner /></div>;
  if (error && !course) return <div className="p-6"><ErrorBanner message={error} onRetry={load} /></div>;
  if (!course) return <div className="p-6"><EmptyState title="Course nahi mila" /></div>;

  const completed = enrollment?.status === 'completed' || (enrollment?.progressPct || 0) >= 100;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <Link href="/portal/academy" className="text-sm text-teal-700 hover:text-teal-700">← Back to Academy</Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">{course.title}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="blue">{course.category || 'general'}</Badge>
            <Badge tone="slate">{course.level || 'beginner'}</Badge>
            <Badge tone="green">{lessons.length} lessons</Badge>
            {course.durationMin ? <Badge tone="amber">{course.durationMin} min</Badge> : null}
          </div>
          {course.description ? <p className="mt-3 text-sm text-gray-600 max-w-3xl">{course.description}</p> : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          {enrolled ? (
            <>
              <Badge tone={completed ? 'green' : 'blue'}>{completed ? 'Completed 🎓' : `${enrollment?.progressPct || 0}% complete`}</Badge>
              <span className="text-xs text-gray-500">{doneCount}/{lessons.length} lessons done</span>
            </>
          ) : (
            <button
              onClick={enroll}
              disabled={acting}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-gray-900 bg-gradient-to-r from-[#0f766e] to-teal-700 hover:from-[#0f766e] hover:to-teal-600 disabled:opacity-50"
            >
              {acting ? 'Enrolling…' : 'Enroll now — start learning'}
            </button>
          )}
        </div>
      </div>

      {error ? <div className="mt-4"><ErrorBanner message={error} onRetry={load} /></div> : null}

      {completed ? (
        <div className="mt-4 rounded-2xl border border-green-500/40 bg-green-500/10 p-4 text-green-200 text-sm font-semibold">
          🎓 Mubarak! Aap ne ye course mukammal kar liya hai.
        </div>
      ) : null}

      <div className="mt-6 grid gap-5 lg:grid-cols-[280px_1fr]">
        {/* Lesson list */}
        <div className="rounded-2xl border border-gray-200 bg-white p-3 self-start lg:sticky lg:top-4 max-h-[70vh] overflow-y-auto">
          <div className="px-2 py-1 text-xs uppercase tracking-wider text-gray-500">Lessons</div>
          {lessons.map((l, i) => {
            const isActive = l.id === activeId;
            const isDone = !!progressMap[l.id];
            const locked = !enrolled && !l.isFree;
            return (
              <button
                key={l.id}
                onClick={() => setActiveId(l.id)}
                className={`w-full text-left px-3 py-2.5 rounded-xl mt-1 flex items-center gap-2 text-sm transition ${isActive ? 'bg-[#0f766e]/20 border border-[#0f766e]/50 text-white' : 'border border-transparent text-gray-600 hover:bg-gray-100'}`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${isDone ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
                  {isDone ? '✓' : i + 1}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{l.title}</span>
                  <span className="flex items-center gap-1.5 mt-0.5">
                    <Badge tone={TYPE_TONE[l.type] || 'slate'}>{TYPE_LABEL[l.type] || l.type}</Badge>
                    {l.isFree ? <span className="text-[10px] text-emerald-400">FREE</span> : null}
                    {locked ? <span className="text-[10px] text-amber-400">🔒</span> : null}
                  </span>
                </span>
              </button>
            );
          })}
          {lessons.length === 0 ? <div className="p-3"><EmptyState title="Koi lesson nahi" hint="Is course me abhi lessons add nahi hui." /></div> : null}
        </div>

        {/* Player */}
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden min-h-[400px]">
          {activeLesson ? (
            <>
              <div className="px-6 pt-5 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-gray-900 font-bold text-lg">{activeLesson.title}</h2>
                {activeLesson.durationMin ? <span className="text-xs text-gray-500">{activeLesson.durationMin} min</span> : null}
              </div>
              <LessonPlayer lesson={activeLesson} enrolled={enrolled} onPass={() => markDone(true)} />
              <div className="px-6 pb-6 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4">
                <div className="flex gap-2">
                  <button
                    onClick={() => activeIndex > 0 && setActiveId(lessons[activeIndex - 1].id)}
                    disabled={activeIndex <= 0}
                    className="px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 text-gray-800 hover:bg-gray-100 disabled:opacity-40"
                  >
                    ← Previous
                  </button>
                  <button
                    onClick={() => activeIndex < lessons.length - 1 && setActiveId(lessons[activeIndex + 1].id)}
                    disabled={activeIndex >= lessons.length - 1}
                    className="px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 text-gray-800 hover:bg-gray-100 disabled:opacity-40"
                  >
                    Next →
                  </button>
                </div>
                {enrolled ? (
                  progressMap[activeLesson.id] ? (
                    <button
                      onClick={() => markDone(false)}
                      disabled={acting}
                      className="px-4 py-2 rounded-xl text-sm font-semibold border border-amber-500/50 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                    >
                      Mark not done
                    </button>
                  ) : (
                    <button
                      onClick={() => markDone(true)}
                      disabled={acting}
                      className="px-5 py-2 rounded-xl text-sm font-semibold text-gray-900 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:opacity-50"
                    >
                      ✓ Mark as done
                    </button>
                  )
                ) : (
                  <span className="text-xs text-gray-500">Progress save karne ke liye enroll karein.</span>
                )}
              </div>
            </>
          ) : (
            <div className="p-6"><EmptyState title="Lesson select karo" hint="Left side se koi lesson choose karo." /></div>
          )}
        </div>
      </div>
    </div>
  );
}

