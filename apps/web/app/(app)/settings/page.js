'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import {
  PageHeader,
  DataTable,
  Field,
  Spinner,
  ErrorBanner,
} from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

export default function SettingsPage() {
  const { allowed } = useRequireRoles('ceo', 'admin');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState([]);
  const [form, setForm] = useState({ key: '', value: '' });
  const [saving, setSaving] = useState(false);
  const [editingKey, setEditingKey] = useState(null);

  const refresh = async () => {
    setError('');
    try {
      const d = await api.get('/settings');
      const list = d.settings || d || [];
      setSettings(Array.isArray(list) ? list : Object.entries(list).map(([key, value]) => ({ key, value })));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.put(`/settings/${encodeURIComponent(form.key)}`, { value: form.value });
      setForm({ key: '', value: '' });
      setEditingKey(null);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(row) {
    setForm({ key: row.key, value: String(row.value ?? '') });
    setEditingKey(row.key);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (allowed === null) return <Spinner />;
  if (allowed === false) return <AccessDenied />;
  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader title="Settings" sub="Tenant configuration key-values" />
      <ErrorBanner message={error} onRetry={refresh} />

      <div className="card mb-4">
        <h2 className="font-semibold text-white mb-3">{editingKey ? `Edit: ${editingKey}` : 'Add / update setting'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <Field label="Key">
              <input
                className="input"
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
                required
                disabled={!!editingKey}
                placeholder="e.g. rent_due_day"
              />
            </Field>
            <Field label="Value">
              <input
                className="input"
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
                required
                placeholder="e.g. 5"
              />
            </Field>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save setting'}</button>
            {editingKey && (
              <button type="button" className="btn-secondary" onClick={() => { setEditingKey(null); setForm({ key: '', value: '' }); }}>
                Cancel edit
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="card">
        <h2 className="font-semibold text-white mb-3">Current settings ({settings.length})</h2>
        <DataTable
          columns={[
            { key: 'key', label: 'Key', render: (r) => <span className="font-mono text-sm">{r.key}</span> },
            { key: 'value', label: 'Value', render: (r) => String(r.value ?? '—') },
            {
              key: 'actions',
              label: 'Actions',
              render: (r) => <button className="btn-secondary btn-sm" onClick={() => startEdit(r)}>Edit</button>,
            },
          ]}
          rows={settings}
          empty={{ title: 'No settings', hint: 'Add a setting above.' }}
        />
      </div>
    </div>
  );
}
