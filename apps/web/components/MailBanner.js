'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

// Banner shown on the member portal when the member has uncollected mail/packages.
export default function MailBanner() {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    api.get('/mail/mine').then((d) => setPending(d.pending || 0)).catch(() => {});
  }, []);
  if (!pending) return null;
  return (
    <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-center gap-3">
      <span className="text-2xl">📦</span>
      <p className="text-sm text-amber-700">
        <b>You have {pending} uncollected {pending === 1 ? 'item' : 'items'}</b> waiting at reception. Please pick {pending === 1 ? 'it' : 'them'} up soon.
      </p>
    </div>
  );
}
