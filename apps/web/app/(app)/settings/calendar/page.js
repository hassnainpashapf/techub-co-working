'use client';

// Phase 36 Track 2: Google Calendar Sync — settings page.
// "Connect Google Calendar" button → OAuth consent → auto-sync bookings.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, Badge } from '../../../../components/ui';

export default function CalendarSettingsPage() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    api.get('/calendar/status')
      .then((d) => setStatus(d))
      .catch((e) => setError(e.message || 'Failed to load status'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const gcal = searchParams.get('gcal');
    if (gcal === 'connected') setNotice('Google Calendar connected successfully.');
    else if (gcal === 'error') setNotice(`Connection failed: ${searchParams.get('msg') || 'unknown error'}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      const d = await api.get('/calendar/auth-url');
      window.location.href = d.url; // Google consent page
    } catch (e) {
      setError(e.message || 'Could not start Google OAuth');
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!confirm('Disconnect Google Calendar? Synced events will stay in Google Calendar.')) return;
    setBusy(true);
    try {
      await api.del('/calendar/disconnect');
      setNotice('Disconnected.');
      load();
    } catch (e) {
      setError(e.message || 'Disconnect failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl">
      <PageHeader title="Google Calendar" sub="Apni bookings khud-bakhud Google Calendar me sync karo" />
      {loading && <Spinner />}
      {error && <ErrorBanner message={error} onRetry={load} />}
      {notice && (
        <div className="mb-4 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
          {notice}
        </div>
      )}
      {!loading && !error && status && (
        <div className="card-premium p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#0f766e] to-emerald-500 flex items-center justify-center text-xl">
                📅
              </div>
              <div>
                <div className="font-bold text-gray-900">Google Calendar</div>
                <div className="text-xs text-gray-500">
                  {status.connected ? `Connected as ${status.email || 'your Google account'}` : 'Not connected'}
                </div>
              </div>
            </div>
            <Badge tone={status.connected ? 'green' : 'slate'}>
              {status.connected ? 'Connected' : 'Disconnected'}
            </Badge>
          </div>
          {!status.migrated && (
            <p className="text-sm text-amber-300 mb-4">
              Calendar tables abhi database me nahi hain (migration pending).
            </p>
          )}
          <p className="text-sm text-gray-500 mb-5">
            Connect karne ke baad har nayi booking aapke Google Calendar me event ban jayegi,
            aur cancel par event delete ho jayega. Sirf <code className="text-gray-600">calendar.events</code> scope
            use hota hai — aapka poora calendar parha nahi jata.
          </p>
          {status.connected ? (
            <button onClick={disconnect} disabled={busy} className="btn-ghost text-red-300">
              {busy ? 'Working…' : 'Disconnect'}
            </button>
          ) : (
            <button onClick={connect} disabled={busy} className="btn-primary">
              {busy ? 'Opening Google…' : '🔗 Connect Google Calendar'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
