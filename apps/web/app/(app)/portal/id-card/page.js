'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, Badge } from '../../../../components/ui';

// Digital Member ID Card — branded card with QR for reception scan/verify.
export default function IdCardPage() {
  const [data, setData] = useState(null);
  const [brand, setBrand] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/member-id/card'),
      api.get('/white-label/public').catch(() => null),
    ])
      .then(([card, wl]) => {
        setData(card);
        if (wl?.branding) setBrand(wl.branding);
      })
      .catch((e) => setError(e.message || 'Could not load your ID card'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6"><Spinner /></div>;
  if (error) return <div className="p-6"><ErrorBanner message={error} onRetry={() => window.location.reload()} /></div>;

  const brandName = brand?.brandName || 'Techub Co-Working';
  const primary = brand?.primaryColor || '#0f766e';
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=10&data=${encodeURIComponent(data.qrPayload)}`;
  const fmt = (d) => (d ? new Date(d).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
  const statusTone = data.status === 'active' ? 'green' : data.status === 'on_hold' ? 'amber' : 'red';

  return (
    <div className="p-6 max-w-lg mx-auto">
      <PageHeader title="My ID Card" sub="Show this card at reception for instant check-in" />

      {/* Card */}
      <div
        className="mt-3 rounded-3xl overflow-hidden shadow-2xl border border-gray-200"
        style={{ background: `linear-gradient(135deg, #141428 0%, #0d0d1f 60%, ${primary}33 100%)` }}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-lg font-extrabold text-gray-900 tracking-wide">{brandName}</div>
              <div className="text-[11px] text-gray-500 uppercase tracking-[0.2em]">Member ID Card</div>
            </div>
            <Badge tone={statusTone}>{String(data.status).replace('_', ' ').toUpperCase()}</Badge>
          </div>

          <div className="flex items-center gap-3">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-extrabold text-gray-900 shrink-0"
              style={{ background: `linear-gradient(135deg, ${primary}, #0f766e)` }}
            >
              {data.name?.charAt(0)?.toUpperCase() || 'M'}
            </div>
            <div className="min-w-0">
              <div className="text-xl font-bold text-gray-900 truncate">{data.name}</div>
              <div className="text-xs text-gray-500 font-mono">ID {data.memberCode}</div>
              {data.companyName && <div className="text-xs text-gray-600 truncate">{data.companyName}</div>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
            <div className="rounded-xl bg-gray-100 border border-gray-200 p-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">Plan</div>
              <div className="text-gray-900 font-semibold truncate">{data.plan || '—'}</div>
            </div>
            <div className="rounded-xl bg-gray-100 border border-gray-200 p-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">Valid till</div>
              <div className="text-gray-900 font-semibold">{fmt(data.validTill)}</div>
            </div>
          </div>
        </div>

        {/* QR */}
        <div className="bg-white/95 px-6 py-4 flex flex-col items-center">
          {!imgFailed ? (
            <img
              src={qrUrl}
              alt="Member ID QR code"
              width={220}
              height={220}
              className="rounded-xl shadow-md"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <div className="w-full">
              <div className="text-xs text-amber-700 mb-2">QR image unavailable offline — reception can type this code:</div>
              <div className="bg-slate-100 border border-slate-300 rounded-lg p-3 text-[10px] text-slate-700 break-all font-mono max-h-36 overflow-auto">
                {data.qrPayload}
              </div>
            </div>
          )}
          <div className="text-[11px] text-slate-500 mt-3 text-center">
            Scan at reception or the attendance kiosk for instant check-in
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-500 mt-3 text-center">
        Keep this card private — it identifies you. Card refreshes automatically.
      </p>
    </div>
  );
}
