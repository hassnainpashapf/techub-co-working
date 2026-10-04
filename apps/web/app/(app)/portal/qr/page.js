'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner } from '../../../../components/ui';

// Member's personal QR code for fast check-in at reception.
// Rendered via a free QR image API; if it fails (offline), the raw token is shown.
export default function MyQrPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    api.get('/member-qr/me')
      .then((d) => setData(d))
      .catch((e) => setError(e.message || 'Could not load your QR code'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6"><Spinner /></div>;
  if (error) return <div className="p-6"><ErrorBanner message={error} onRetry={() => window.location.reload()} /></div>;

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=10&data=${encodeURIComponent(data.token)}`;

  return (
    <div className="p-6 max-w-lg mx-auto">
      <PageHeader title="My QR Code" sub="Show this at reception for instant check-in" />
      <div className="card-premium p-8 mt-4 flex flex-col items-center text-center">
        <div className="text-lg font-bold text-gray-900 mb-1">{data.member?.name}</div>
        <div className="text-xs text-gray-500 mb-6">
          Valid until {new Date(data.expiresAt).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
        {!imgFailed ? (
          <img
            src={qrUrl}
            alt="My check-in QR code"
            width={260}
            height={260}
            className="rounded-xl bg-white p-2 shadow-lg"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="w-full">
            <div className="text-xs text-amber-700 mb-2">QR image unavailable offline — reception can type this code:</div>
            <div className="bg-white border border-gray-200 rounded-lg p-3 text-[11px] text-gray-600 break-all font-mono max-h-40 overflow-auto">
              {data.token}
            </div>
          </div>
        )}
        <p className="text-xs text-slate-500 mt-6">Keep this code private — it identifies you for attendance.</p>
      </div>
    </div>
  );
}
