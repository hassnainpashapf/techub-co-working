'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

export default function UnsubscribePage() {
  const { token } = useParams();
  const [state, setState] = useState('loading');
  const [email, setEmail] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const base = process.env.NEXT_PUBLIC_API_URL || '';
        const r = await fetch(`${base}/api/campaigns/unsubscribe/${token}`);
        const d = await r.json();
        if (r.ok) { setEmail(d.email || ''); setState('done'); }
        else setState('error');
      } catch { setState('error'); }
    })();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f4f5f7] px-4">
      <div className="card-premium w-full max-w-sm p-8 text-center">
        {state === 'loading' && <p className="text-gray-600">Processing…</p>}
        {state === 'done' && <>
          <h1 className="text-2xl font-extrabold text-gray-900 mb-2">Unsubscribed ✅</h1>
          <p className="text-sm text-gray-500">{email ? `${email} will` : 'You will'} no longer receive marketing emails.</p>
        </>}
        {state === 'error' && <>
          <h1 className="text-2xl font-extrabold text-gray-900 mb-2">Invalid link</h1>
          <p className="text-sm text-gray-500">This unsubscribe link is not valid or already used.</p>
        </>}
      </div>
    </div>
  );
}

