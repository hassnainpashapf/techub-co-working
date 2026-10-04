'use client';

// Phase 53 Track 10/10: Academy Dashboard — stats, popular courses, quick links.
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, EmptyState, StatCard, Badge } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

function star(n) {
  if (!n) return '—';
  return '⭐ ' + Number(n).toFixed(1);
}

export default function AcademyDashboardPage() {
  const allowed = useRequireRoles('ceo', 'admin', 'super_admin', 'manager');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!allowed) return;
    (async () => {
      try {
        setLoading(true);
        const s = await api.get('/api/academy-dashboard/stats');
        setData(s.data || {});
      } catch (e) {
        setErr(e?.response?.data?.error || e.message || 'Dashboard load nahi ho saka');
      } finally {
        setLoading(false);
      }
    })();
  }, [allowed]);

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;

  const stats = data?.stats || {};
  const popular = data?.popularCourses || [];

  return (
    <div className="space-y-3">
      <PageHeader title="Academy Dashboard" subtitle="Courses, enrollments, completions aur workshops ka overview" />

      {err && <ErrorBanner message={err} />}

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard title="Published Courses" value={stats.publishedCourses ?? '—'} icon="📚" />
        <StatCard title="Active Enrollments" value={stats.activeEnrollments ?? '—'} icon="🎓" />
        <StatCard title="Completions (30d)" value={stats.completions30d ?? '—'} icon="✅" />
        <StatCard title="Avg Rating" value={star(stats.avgRating)} icon="⭐" />
        <StatCard title="Certificates Issued" value={stats.certificatesIssued ?? '—'} icon="🏅" />
        <StatCard title="Upcoming Workshops" value={stats.upcomingWorkshops ?? '—'} icon="🎥" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-gray-900">🔥 Popular Courses</h3>
            <a href="/academy/courses" className="btn btn-secondary btn-sm">All Courses</a>
          </div>
          {!popular.length && <EmptyState title="Abhi koi enrollment data nahi" hint="Courses publish hon aur enrollments banain to yahan dikhengi" />}
          <div className="space-y-3">
            {popular.map((c, i) => (
              <a key={c.id} href="/academy/courses" className="flex items-center gap-3 p-3 rounded-xl bg-gray-100 hover:bg-gray-100 transition border border-gray-200">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#0f766e] to-teal-600 flex items-center justify-center font-bold text-gray-900 text-sm shrink-0">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 truncate">{c.title}</div>
                  <div className="text-xs text-gray-500">
                    {c.category || 'general'}{c.level ? ` • ${c.level}` : ''}
                  </div>
                </div>
                <Badge tone="blue">{c.enrollments} enrollments</Badge>
              </a>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">⚡ Quick Links</h3>
          <div className="grid grid-cols-2 gap-3">
            <a href="/academy/courses" className="p-4 rounded-xl bg-gray-100 hover:bg-gray-100 transition border border-gray-200 hover:border-[#0f766e]/40">
              <div className="text-2xl mb-1">📚</div>
              <div className="font-medium text-gray-900 text-sm">Course Catalog</div>
              <div className="text-xs text-gray-500">Courses + lessons manage karein</div>
            </a>
            <a href="/academy/enrollments" className="p-4 rounded-xl bg-gray-100 hover:bg-gray-100 transition border border-gray-200 hover:border-[#0f766e]/40">
              <div className="text-2xl mb-1">🎓</div>
              <div className="font-medium text-gray-900 text-sm">Enrollments</div>
              <div className="text-xs text-gray-500">Progress aur completions</div>
            </a>
            <a href="/academy/quizzes" className="p-4 rounded-xl bg-gray-100 hover:bg-gray-100 transition border border-gray-200 hover:border-[#0f766e]/40">
              <div className="text-2xl mb-1">📝</div>
              <div className="font-medium text-gray-900 text-sm">Quizzes</div>
              <div className="text-xs text-gray-500">Assessments manage karein</div>
            </a>
            <a href="/academy/workshops" className="p-4 rounded-xl bg-gray-100 hover:bg-gray-100 transition border border-gray-200 hover:border-[#0f766e]/40">
              <div className="text-2xl mb-1">🎥</div>
              <div className="font-medium text-gray-900 text-sm">Live Workshops</div>
              <div className="text-xs text-gray-500">Sessions schedule karein</div>
            </a>
            <a href="/academy/certificates" className="p-4 rounded-xl bg-gray-100 hover:bg-gray-100 transition border border-gray-200 hover:border-[#0f766e]/40">
              <div className="text-2xl mb-1">🏅</div>
              <div className="font-medium text-gray-900 text-sm">Certificates</div>
              <div className="text-xs text-gray-500">Issued certificates</div>
            </a>
            <a href="/academy/paths" className="p-4 rounded-xl bg-gray-100 hover:bg-gray-100 transition border border-gray-200 hover:border-[#0f766e]/40">
              <div className="text-2xl mb-1">🛤️</div>
              <div className="font-medium text-gray-900 text-sm">Learning Paths</div>
              <div className="text-xs text-gray-500">Curated learning journeys</div>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
