'use client';

// Phase 33 Track 5: Member Directory (opt-in) — privacy-safe networking directory.
// Only opt-in members are shown; no contact details are ever displayed.
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Spinner, EmptyState, ErrorBanner } from '../../../../components/ui';

function initials(name) {
  return (name || '?')
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const AVATAR_GRADIENTS = [
  'from-blue-500/30 to-violet-500/30',
  'from-emerald-500/30 to-teal-500/30',
  'from-amber-500/30 to-orange-500/30',
  'from-rose-500/30 to-pink-500/30',
  'from-cyan-500/30 to-blue-500/30',
];

function MemberCard({ member, index }) {
  const grad = AVATAR_GRADIENTS[index % AVATAR_GRADIENTS.length];
  const company = member.company?.name || member.companyName;
  return (
    <div className="card-premium p-5 hover:border-blue-400/30 transition-colors">
      <div className="flex items-center gap-4 mb-3">
        <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${grad} border border-white/10 flex items-center justify-center text-white font-bold`}>
          {initials(member.name)}
        </div>
        <div className="min-w-0">
          <p className="text-white font-semibold truncate">{member.name}</p>
          {company && <p className="text-slate-400 text-sm truncate">{company}</p>}
        </div>
      </div>
      {member.directoryBio && (
        <p className="text-slate-300 text-sm mb-3 line-clamp-3">{member.directoryBio}</p>
      )}
      {(member.directoryTags || []).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {member.directoryTags.map((t) => (
            <Badge key={t} tone="blue">{t}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DirectoryPage() {
  const [members, setMembers] = useState([]);
  const [tags, setTags] = useState([]);
  const [q, setQ] = useState('');
  const [activeTag, setActiveTag] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = (search = q, tag = activeTag) => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (search.trim()) params.set('q', search.trim());
    if (tag) params.set('tag', tag);
    api.get(`/directory?${params.toString()}`)
      .then((d) => {
        setMembers(d.members || []);
        setTags(d.tags || []);
      })
      .catch((err) => setError(err.message || 'Failed to load directory'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load('', ''); }, []);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => load(q, activeTag), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, activeTag]);

  return (
    <div>
      <PageHeader
        title="Member Directory 🤝"
        sub="Connect with fellow members. Only members who opted in are listed — no contact details are shared."
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          className="input sm:max-w-sm"
          placeholder="Search name or company…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setActiveTag('')}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              !activeTag
                ? 'bg-blue-500/20 border-blue-400/40 text-blue-200'
                : 'border-white/10 text-slate-400 hover:text-white'
            }`}
          >
            All
          </button>
          {tags.map((t) => (
            <button
              key={t}
              onClick={() => setActiveTag(activeTag === t ? '' : t)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                activeTag === t
                  ? 'bg-blue-500/20 border-blue-400/40 text-blue-200'
                  : 'border-white/10 text-slate-400 hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : error ? (
        <ErrorBanner message={error} onRetry={() => load()} />
      ) : members.length === 0 ? (
        <EmptyState title="No members found" hint="Try a different search — or be the first to opt in from your portal profile." />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {members.map((m, i) => (
            <MemberCard key={m.id} member={m} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
