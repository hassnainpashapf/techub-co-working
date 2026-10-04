'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner } from '../../../../components/ui';
import PushToggle from './PushToggle';

function Toggle({ on, onChange, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`w-11 h-6 rounded-full relative transition-colors ${on ? 'bg-teal-600' : 'bg-slate-600/60'} ${disabled ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
      aria-pressed={on}
    >
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

export default function NotificationPreferencesPage() {
  const [matrix, setMatrix] = useState(null);
  const [events, setEvents] = useState([]);
  const [channels, setChannels] = useState([]);
  const [eventLabels, setEventLabels] = useState({});
  const [channelLabels, setChannelLabels] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState({});

  useEffect(() => {
    api.get('/notification-preferences')
      .then((d) => {
        setMatrix(d.matrix || {});
        setEvents(d.events || []);
        setChannels(d.channels || []);
        setEventLabels(d.eventLabels || {});
        setChannelLabels(d.channelLabels || {});
      })
      .catch((e) => setError(e.message || 'Failed to load preferences'))
      .finally(() => setLoading(false));
  }, []);

  const toggle = async (eventType, channel, enabled) => {
    const key = `${eventType}:${channel}`;
    setSaving((s) => ({ ...s, [key]: true }));
    try {
      await api.put('/notification-preferences', { eventType, channel, enabled });
      setMatrix((m) => ({ ...m, [eventType]: { ...m[eventType], [channel]: enabled } }));
    } catch (e) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving((s) => ({ ...s, [key]: false }));
    }
  };

  if (loading) return <div className="p-8 flex justify-center"><Spinner /></div>;

  return (
    <div>
      <PageHeader title="Notification Preferences" subtitle="Choose which notifications you get on each channel. Anything off here stays on by default." />
      {error && <ErrorBanner message={error} />}
      <PushToggle />
      <div className="card-premium p-6 overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase">
              <th className="pb-3 pr-4">Event</th>
              {channels.map((c) => (
                <th key={c} className="pb-3 px-3 text-center">{channelLabels[c] || c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <tr key={ev} className="border-t border-gray-200">
                <td className="py-3 pr-4 text-gray-800 font-medium">{eventLabels[ev] || ev}</td>
                {channels.map((ch) => {
                  const key = `${ev}:${ch}`;
                  return (
                    <td key={ch} className="py-3 px-3 text-center">
                      <Toggle
                        on={!!(matrix?.[ev]?.[ch])}
                        disabled={!!saving[key]}
                        onChange={(v) => toggle(ev, ch, v)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
