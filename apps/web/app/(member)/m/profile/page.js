'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { useAuth } from '../../../../context/AuthContext';
import { Spinner, ErrorBanner } from '../../../../components/ui';

export default function MemberProfile() {
  const { user } = useAuth();
  const [member, setMember] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/members/me')
      .then((d) => setMember(d.member || d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold text-white">My Profile</h1>
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      {loading ? <Spinner /> : (
        <div className="card-premium p-5 space-y-3">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-violet-500/20 border border-violet-400/40 flex items-center justify-center text-2xl font-bold text-violet-200">
              {(member?.name || user?.name || '?')[0].toUpperCase()}
            </div>
            <div>
              <div className="text-lg font-bold text-white">{member?.name || user?.name}</div>
              <div className="text-sm text-slate-400">{user?.email}</div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm pt-2">
            {[
              ['Phone', member?.phone],
              ['Company', member?.companyName],
              ['CNIC', member?.cnic],
              ['Emergency contact', member?.emergencyContact],
              ['Status', member?.status],
              ['Member since', member?.createdAt?.slice(0, 10)],
            ].map(([l, v]) => (
              <div key={l} className="p-3 rounded-lg bg-white/[0.03] border border-white/10">
                <div className="text-xs text-slate-400">{l}</div>
                <div className="text-white font-medium">{v || '—'}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 pt-2">To update your profile, please contact reception.</p>
        </div>
      )}
    </div>
  );
}
