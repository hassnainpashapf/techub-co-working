'use client';

import { useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Field, Spinner, ErrorBanner, Badge } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const SCAN_ROLES = ['receptionist', 'manager', 'operations_manager', 'admin', 'ceo', 'super_admin'];

function fmtTime(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function QrScanPage() {
  const { allowed, loading: roleLoading } = useRequireRoles(SCAN_ROLES);
  const [mode, setMode] = useState('checkin'); // checkin | verify
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [verified, setVerified] = useState(null);

  if (roleLoading) return <div className="p-6"><Spinner /></div>;
  if (!allowed) return <AccessDenied />;

  async function submit(e) {
    e.preventDefault();
    setError('');
    setResult(null);
    setVerified(null);
    const t = token.trim();
    if (!t) return setError('Paste or type the member QR code first.');
    setBusy(true);
    try {
      if (mode === 'verify') {
        const r = await api.post('/member-id/verify', { qrPayload: t });
        setVerified(r.member);
      } else {
        const r = await api.post('/member-qr/scan', { token: t });
        setResult(r);
      }
    } catch (err) {
      setError(err.message || (mode === 'verify' ? 'Verification failed' : 'Check-in failed'));
    } finally {
      setBusy(false);
    }
  }

  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

  return (
    <div className="p-6 max-w-xl mx-auto">
      <PageHeader title="Scan Member QR" sub={mode === 'verify' ? "Verify a member's ID card" : 'Paste the member\'s QR code to check them in'} />
      <div className="flex gap-2 mt-4">
        {[
          { id: 'checkin', label: 'Check in' },
          { id: 'verify', label: 'Verify ID' },
        ].map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => { setMode(m.id); setResult(null); setVerified(null); setError(''); }}
            className={mode === m.id ? 'btn-primary text-xs px-4 py-1.5' : 'btn-secondary text-xs px-4 py-1.5'}
          >
            {m.label}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="card-premium p-6 mt-4">
        <Field label="QR code">
          <textarea
            className="input font-mono text-xs"
            rows={4}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste the QR token here…"
          />
        </Field>
        {error && <div className="mt-3"><ErrorBanner message={error} /></div>}
        <button type="submit" className="btn-primary w-full mt-4" disabled={busy}>
          {busy ? 'Working…' : mode === 'verify' ? 'Verify member' : 'Check in'}
        </button>
        {result && (
          <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Badge tone={result.alreadyCheckedIn ? 'amber' : 'green'}>
                {result.alreadyCheckedIn ? 'Already checked in' : 'Checked in'}
              </Badge>
            </div>
            <div className="text-lg font-bold text-gray-900">{result.member?.name}</div>
            <div className="text-sm text-gray-600 mt-1">
              {result.alreadyCheckedIn ? 'Checked in at' : 'Check-in time'}: {fmtTime(result.checkedInAt)}
            </div>
          </div>
        )}
        {verified && (
          <div className="mt-4 rounded-xl border border-[#0f766e]/30 bg-[#0f766e]/10 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge tone="blue">Identity verified</Badge>
              <Badge tone={verified.status === 'active' ? 'green' : 'amber'}>
                {String(verified.status).replace('_', ' ').toUpperCase()}
              </Badge>
            </div>
            <div className="text-lg font-bold text-gray-900">{verified.name}</div>
            <div className="text-xs text-gray-500 font-mono mt-0.5">ID {verified.memberCode}</div>
            <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
              <div><div className="text-[10px] uppercase text-gray-500">Plan</div><div className="text-gray-900">{verified.plan || '—'}</div></div>
              <div><div className="text-[10px] uppercase text-gray-500">Valid till</div><div className="text-gray-900">{fmtDate(verified.validTill)}</div></div>
              <div><div className="text-[10px] uppercase text-gray-500">Phone</div><div className="text-gray-900">{verified.phone || '—'}</div></div>
              <div><div className="text-[10px] uppercase text-gray-500">Company</div><div className="text-gray-900">{verified.companyName || '—'}</div></div>
            </div>
          </div>
        )}
      </form>
      <button
        type="button"
        onClick={() => { setToken(''); setResult(null); setVerified(null); setError(''); }}
        className="btn-secondary w-full mt-3"
      >
        Clear
      </button>
    </div>
  );
}
