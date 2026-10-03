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
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  if (roleLoading) return <div className="p-6"><Spinner /></div>;
  if (!allowed) return <AccessDenied />;

  async function submit(e) {
    e.preventDefault();
    setError('');
    setResult(null);
    const t = token.trim();
    if (!t) return setError('Paste or type the member QR code first.');
    setBusy(true);
    try {
      const r = await api.post('/member-qr/scan', { token: t });
      setResult(r);
    } catch (err) {
      setError(err.message || 'Check-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 max-w-xl mx-auto">
      <PageHeader title="Scan Member QR" sub="Paste the member's QR code to check them in" />
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
          {busy ? 'Checking in…' : 'Check in'}
        </button>
        {result && (
          <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Badge tone={result.alreadyCheckedIn ? 'amber' : 'green'}>
                {result.alreadyCheckedIn ? 'Already checked in' : 'Checked in'}
              </Badge>
            </div>
            <div className="text-lg font-bold text-white">{result.member?.name}</div>
            <div className="text-sm text-slate-300 mt-1">
              {result.alreadyCheckedIn ? 'Checked in at' : 'Check-in time'}: {fmtTime(result.checkedInAt)}
            </div>
          </div>
        )}
      </form>
      <button
        type="button"
        onClick={() => { setToken(''); setResult(null); setError(''); }}
        className="btn-secondary w-full mt-3"
      >
        Clear
      </button>
    </div>
  );
}
