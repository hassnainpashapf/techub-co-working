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
  'from-[#0f766e]/30 to-teal-600/30',
  'from-emerald-500/30 to-teal-500/30',
  'from-amber-500/30 to-orange-500/30',
  'from-rose-500/30 to-pink-500/30',
  'from-cyan-500/30 to-[#0f766e]/30',
];

function MemberCard({ member, index }) {
  const grad = AVATAR_GRADIENTS[index % AVATAR_GRADIENTS.length];
  const company = member.company?.name || member.companyName;
  return (
    <div className="card-premium p-5 hover:border-[#0f766e]/30 transition-colors">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${grad} border border-gray-200 flex items-center justify-center text-gray-900 font-bold`}>
          {initials(member.name)}
        </div>
        <div className="min-w-0">
          <p className="text-gray-900 font-semibold truncate">{member.name}</p>
          {company && <p className="text-gray-500 text-sm truncate">{company}</p>}
        </div>
      </div>
      {member.directoryBio && (
        <p className="text-gray-600 text-sm mb-3 line-clamp-3">{member.directoryBio}</p>
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

      <div className="flex flex-col sm:flex-row gap-3 mb-3">
        <input
          className="input sm:max-w-sm"
          placeholder="Search name or company…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            onClick={() => setActiveTag('')}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              !activeTag
                ? 'bg-[#0f766e]/20 border-[#0f766e]/40 text-teal-700'
                : 'border-gray-200 text-gray-500 hover:text-gray-900'
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
                  ? 'bg-[#0f766e]/20 border-[#0f766e]/40 text-teal-700'
                  : 'border-gray-200 text-gray-500 hover:text-gray-900'
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
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {members.map((m, i) => (
            <MemberCard key={m.id} member={m} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
