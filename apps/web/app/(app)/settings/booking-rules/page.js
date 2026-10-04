'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, Field } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const FIELDS = [
  { key: 'bookingBufferMinutes', label: 'Buffer between bookings (minutes)', hint: 'Minimum gap required before and after another booking on the same room.' },
  { key: 'bookingMaxHours', label: 'Max booking length (hours)', hint: 'A single booking cannot be longer than this.' },
  { key: 'bookingAdvanceDays', label: 'Max advance booking (days)', hint: 'Bookings cannot start more than this far in the future.' },
  { key: 'bookingMinNoticeMinutes', label: 'Minimum notice (minutes)', hint: 'Bookings must start at least this far from now.' },
];

export default function BookingRulesPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'super_admin']);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setError('');
    api.get('/booking-rules')
      .then((d) => setForm(d.settings || {}))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (allowed) load(); }, [allowed]);

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;

  const save = async () => {
    setSaving(true); setError(''); setSaved(false);
    try {
      const payload = {};
      for (const f of FIELDS) payload[f.key] = Number(form[f.key]);
      const d = await api.put('/booking-rules', payload);
      setForm(d.settings || {});
      setSaved(true);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <PageHeader title="Booking Rules" subtitle="Policy for meeting room bookings — applies to all rooms." />
      {error && <ErrorBanner message={error} />}
      {saved && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 mb-4">
          Booking rules saved.
        </div>
      )}
      <div className="card-premium p-6 max-w-2xl space-y-5">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <Field label={f.label}>
              <input
                type="number"
                className="input"
                value={form[f.key] ?? ''}
                min={0}
                step={f.key === 'bookingMaxHours' ? 0.5 : 1}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              />
            </Field>
            <p className="text-xs text-gray-500 -mt-2">{f.hint}</p>
          </div>
        ))}
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save rules'}
        </button>
      </div>
    </div>
  );
}
