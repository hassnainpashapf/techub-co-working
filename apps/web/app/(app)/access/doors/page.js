'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, DataTable, Modal, Field, Badge, Spinner, ErrorBanner } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const TYPES = [
  { value: 'entrance', label: 'Main Entrance' },
  { value: 'internal', label: 'Internal Door' },
  { value: 'exit', label: 'Exit' },
];

const emptyForm = { name: '', location: '', deviceId: '', type: 'internal', isActive: true };

function HardwareCard() {
  const [dk, setDk] = useState({ configured: false });
  const [wh, setWh] = useState({ configured: false });
  const [newKey, setNewKey] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const [a, b] = await Promise.all([api.get('/door-unlock/device-key'), api.get('/door-unlock/webhook')]);
      setDk(a); setWh(b);
    } catch {}
  };
  useEffect(() => { refresh(); }, []);

  const genKey = async () => {
    if (!window.confirm('Nayi device API key generate karein? Purani key kaam karna band kar degi.')) return;
    setBusy(true); setMsg(''); setNewKey('');
    try {
      const r = await api.post('/door-unlock/device-key', {});
      setNewKey(r.key || r.apiKey || '');
      setMsg('Nayi key ban gayi — isay abhi copy kar lein, dobara nahi dikhegi.');
      await refresh();
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };
  const revokeKey = async () => {
    if (!window.confirm('Device API key revoke karein?')) return;
    setBusy(true); setMsg('');
    try { await api.del('/door-unlock/device-key'); setNewKey(''); setMsg('Key revoke ho gayi.'); await refresh(); }
    catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };
  const saveWebhook = async () => {
    setBusy(true); setMsg('');
    try {
      await api.put('/door-unlock/webhook', { webhookUrl: webhookUrl.trim() || null });
      setWebhookUrl(''); setMsg('Webhook save ho gaya.'); await refresh();
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="text-sm font-bold text-gray-900">🔌 Hardware Integration</h3>
      <p className="mt-1 text-xs text-gray-500">Asal door controllers ke liye device API key aur unlock webhook.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-xs font-semibold text-gray-600">Device API Key {dk.configured ? <Badge tone="emerald">Configured</Badge> : <Badge tone="slate">Not set</Badge>}</div>
          {newKey && (
            <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-3">
              <div className="text-xs text-amber-800 break-all font-mono">{newKey}</div>
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <button onClick={genKey} disabled={busy} className="rounded-lg bg-[#0f766e] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0d6b63] disabled:opacity-50">
              {busy ? '…' : 'Generate Key'}
            </button>
            {dk.configured && (
              <button onClick={revokeKey} disabled={busy} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">
                Revoke
              </button>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold text-gray-600">Unlock Webhook {wh.configured ? <Badge tone="emerald">Configured</Badge> : <Badge tone="slate">Not set</Badge>}</div>
          <div className="mt-2 flex gap-2">
            <input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://device.local/unlock"
              className="flex-1 rounded-lg bg-white border border-gray-200 px-3 py-1.5 text-xs text-gray-900"
            />
            <button onClick={saveWebhook} disabled={busy} className="rounded-lg bg-[#0f766e] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0d6b63] disabled:opacity-50">
              Save
            </button>
          </div>
          <p className="mt-1 text-[11px] text-gray-500">Khali save karein to webhook remove ho jayega.</p>
        </div>
      </div>
      {msg && <p className="mt-3 text-xs text-teal-700">{msg}</p>}
    </div>
  );
}

export default function DoorsPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'super_admin', 'manager']);
  const [doors, setDoors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // { mode: 'add' | 'edit', door }
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const d = await api.get('/doors');
      setDoors(d.doors || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (allowed) load(); }, [allowed]);

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;

  const openAdd = () => { setForm(emptyForm); setModal({ mode: 'add' }); };
  const openEdit = (door) => {
    setForm({ name: door.name, location: door.location || '', deviceId: door.deviceId || '', type: door.type, isActive: door.isActive });
    setModal({ mode: 'edit', door });
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true); setError('');
    try {
      const payload = {
        name: form.name.trim(),
        location: form.location.trim() || null,
        deviceId: form.deviceId.trim() || null,
        type: form.type,
        isActive: form.isActive,
      };
      if (modal.mode === 'add') await api.post('/doors', payload);
      else await api.patch(`/doors/${modal.door.id}`, payload);
      setModal(null);
      await load();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const toggleActive = async (door) => {
    setError('');
    try {
      await api.patch(`/doors/${door.id}/active`, { isActive: !door.isActive });
      await load();
    } catch (err) { setError(err.message); }
  };

  const remove = async (door) => {
    if (!window.confirm(`Delete door "${door.name}"?`)) return;
    setError('');
    try {
      await api.del(`/doors/${door.id}`);
      await load();
    } catch (err) { setError(err.message); }
  };

  const columns = [
    { key: 'name', label: 'Door' },
    {
      key: 'type', label: 'Type',
      render: (d) => <Badge tone="blue">{(TYPES.find((t) => t.value === d.type) || {}).label || d.type}</Badge>,
    },
    { key: 'location', label: 'Location', render: (d) => d.location || <span className="text-gray-500">—</span> },
    { key: 'deviceId', label: 'Device ID', render: (d) => d.deviceId || <span className="text-gray-500">—</span> },
    {
      key: 'isActive', label: 'Status',
      render: (d) => d.isActive
        ? <Badge tone="emerald">Active</Badge>
        : <Badge tone="slate">Inactive</Badge>,
    },
    {
      key: 'actions', label: 'Actions',
      render: (d) => (
        <div className="flex items-center gap-2">
          <button onClick={() => toggleActive(d)} className="text-xs font-semibold text-amber-700 hover:text-amber-700">
            {d.isActive ? 'Deactivate' : 'Activate'}
          </button>
          <button onClick={() => openEdit(d)} className="text-xs font-semibold text-teal-700 hover:text-teal-700">Edit</button>
          <button onClick={() => remove(d)} className="text-xs font-semibold text-red-600 hover:text-red-700">Delete</button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6">
      <PageHeader
        title="Doors & Access Points"
        sub="Manage entry points, device IDs and door status"
        actions={(
          <button
            onClick={openAdd}
            className="rounded-lg bg-[#0f766e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0d6b63]"
          >
            + Add Door
          </button>
        )}
      />
      {error && <ErrorBanner message={error} />}
      <HardwareCard />
      <DataTable columns={columns} rows={doors} empty={{ title: 'No doors yet', hint: 'Add your first door or access point.' }} />

      {modal && (
        <Modal title={modal.mode === 'add' ? 'Add Door' : `Edit — ${modal.door.name}`} onClose={() => setModal(null)}>
          <form onSubmit={save} className="space-y-4">
            <Field label="Door name">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Main Entrance"
                className="w-full rounded-lg bg-white border border-gray-200 px-3 py-2 text-gray-900"
              />
            </Field>
            <Field label="Type">
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full rounded-lg bg-white border border-gray-200 px-3 py-2 text-gray-900"
              >
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Location (optional)">
              <input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="Ground floor, left corridor"
                className="w-full rounded-lg bg-white border border-gray-200 px-3 py-2 text-gray-900"
              />
            </Field>
            <Field label="Device ID (hardware integration, optional)">
              <input
                value={form.deviceId}
                onChange={(e) => setForm({ ...form, deviceId: e.target.value })}
                placeholder="e.g. ACS-CTRL-01"
                className="w-full rounded-lg bg-white border border-gray-200 px-3 py-2 text-gray-900"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="h-4 w-4 accent-[#0f766e]"
              />
              Active (door usable for access)
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setModal(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button
                type="submit" disabled={saving}
                className="rounded-lg bg-[#0f766e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0d6b63] disabled:opacity-50"
              >
                {saving ? 'Saving…' : modal.mode === 'add' ? 'Add Door' : 'Save Changes'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
