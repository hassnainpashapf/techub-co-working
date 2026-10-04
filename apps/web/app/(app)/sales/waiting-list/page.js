'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, EmptyState, StatCard } from '../../../../components/ui';

const STATUSES = [
  { key: 'waiting', label: 'Waiting', tone: 'blue' },
  { key: 'offered', label: 'Offered', tone: 'amber' },
  { key: 'converted', label: 'Converted', tone: 'green' },
  { key: 'expired', label: 'Expired', tone: 'slate' },
];

const toneFor = (s) => (STATUSES.find((x) => x.key === s) || {}).tone || 'slate';
const labelFor = (s) => (STATUSES.find((x) => x.key === s) || {}).label || s;

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function EntryForm({ initial, onSave, saving }) {
  const [f, setF] = useState({
    name: initial?.name || '',
    email: initial?.email || '',
    phone: initial?.phone || '',
    desiredType: initial?.desiredType || '',
    desiredDate: initial?.desiredDate ? initial.desiredDate.slice(0, 10) : '',
    notes: initial?.notes || '',
    priority: initial?.priority ?? 0,
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ ...f, priority: Number(f.priority) || 0 }); }}>
      <Field label="Name *"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required placeholder="Prospect name" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="0300-1234567" /></Field>
        <Field label="Email"><input type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="prospect@example.com" /></Field>
        <Field label="Desired Space Type"><input className="input" value={f.desiredType} onChange={(e) => setF({ ...f, desiredType: e.target.value })} placeholder="e.g. Private office" /></Field>
        <Field label="Desired Date"><input type="date" className="input [color-scheme:dark]" value={f.desiredDate} onChange={(e) => setF({ ...f, desiredDate: e.target.value })} /></Field>
        <Field label="Priority (0–100)"><input type="number" min="0" max="100" className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} /></Field>
      </div>
      <Field label="Notes"><textarea className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Notes…" /></Field>
      <button type="submit" className="btn-primary w-full" disabled={saving || !f.name.trim()}>{saving ? 'Saving…' : (initial ? 'Update Entry' : 'Add to Waiting List')}</button>
    </form>
  );
}

export default function WaitingListPage() {
  const [entries, setEntries] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(null);
  const [offerEntry, setOfferEntry] = useState(null);
  const [unitCode, setUnitCode] = useState('');
  const [convertEntry, setConvertEntry] = useState(null);
  const [convertPhone, setConvertPhone] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams();
      if (status) q.set('status', status);
      if (search) q.set('search', search);
      const d = await api.get(`/waiting-list?${q.toString()}`);
      setEntries(d.entries || []);
      setStats(d.stats || {});
    } catch (err) {
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [status]);
  useEffect(() => {
    const t = setTimeout(() => { if (!loading) load(); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function saveEntry(data, id) {
    setSaving(true);
    try {
      if (id) await api.patch(`/waiting-list/${id}`, data);
      else await api.post('/waiting-list', data);
      setShowAdd(false);
      setEditing(null);
      load();
    } catch (err) {
      alert(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function doOffer(entry) {
    setBusy(entry.id);
    try {
      await api.post(`/waiting-list/${entry.id}/offer`, { unitCode: unitCode || undefined });
      setOfferEntry(null);
      setUnitCode('');
      load();
    } catch (err) {
      alert(err.message || 'Offer failed');
    } finally {
      setBusy(null);
    }
  }

  async function doConvert(entry) {
    setBusy(entry.id);
    try {
      await api.post(`/waiting-list/${entry.id}/convert`, { phone: convertPhone || undefined });
      setConvertEntry(null);
      setConvertPhone('');
      load();
    } catch (err) {
      alert(err.message || 'Convert failed');
    } finally {
      setBusy(null);
    }
  }

  async function doExpire(entry) {
    if (!confirm(`Mark ${entry.name} as expired?`)) return;
    setBusy(entry.id);
    try {
      await api.post(`/waiting-list/${entry.id}/expire`);
      load();
    } catch (err) {
      alert(err.message || 'Failed');
    } finally {
      setBusy(null);
    }
  }

  async function doDelete(entry) {
    if (!confirm(`Delete ${entry.name} from the waiting list?`)) return;
    setBusy(entry.id);
    try {
      await api.del(`/waiting-list/${entry.id}`);
      load();
    } catch (err) {
      alert(err.message || 'Delete failed');
    } finally {
      setBusy(null);
    }
  }

  if (loading && entries.length === 0) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div>
      <PageHeader
        title="Waiting List"
        sub="Prospects waiting for a space — offer, then convert to members"
        actions={<button onClick={() => setShowAdd(true)} className="btn-primary">+ Add Entry</button>}
      />
      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        {STATUSES.map((s) => (
          <StatCard key={s.key} label={s.label} value={stats[s.key] || 0} accent={s.tone} />
        ))}
      </div>

      <div className="flex flex-wrap gap-3 mb-3">
        <input className="input max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name / phone / email…" />
        <select className="input max-w-[180px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      {entries.length === 0 ? (
        <EmptyState title="Waiting list is empty" hint="Add prospects who are waiting for a space to open up." />
      ) : (
        <div className="card-premium overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase tracking-wider border-b border-gray-200">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Wants</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Waiting Since</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-900">{e.name}</div>
                    {e.notes && <div className="text-xs text-slate-500 truncate max-w-[220px]">{e.notes}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">
                    {e.phone && <div>📞 {e.phone}</div>}
                    {e.email && <div className="truncate max-w-[200px]">✉️ {e.email}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">
                    {e.desiredType && <div>{e.desiredType}</div>}
                    {e.desiredDate && <div className="text-slate-500">from {fmtDate(e.desiredDate)}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold ${e.priority > 0 ? 'text-amber-700' : 'text-slate-500'}`}>{e.priority}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={toneFor(e.status)}>{labelFor(e.status)}</Badge>
                    {e.status === 'offered' && e.offeredAt && (
                      <div className="text-[11px] text-slate-500 mt-1">offered {fmtDate(e.offeredAt)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(e.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5 flex-wrap">
                      {(e.status === 'waiting' || e.status === 'expired') && (
                        <button onClick={() => setOfferEntry(e)} disabled={busy === e.id} className="text-xs text-white bg-[#0f766e]/80 hover:bg-[#0f766e] rounded-lg px-2.5 py-1.5">Offer</button>
                      )}
                      {e.status !== 'converted' && (
                        <button onClick={() => { setConvertEntry(e); setConvertPhone(e.phone || ''); }} disabled={busy === e.id} className="text-xs text-white bg-emerald-600/80 hover:bg-emerald-600 rounded-lg px-2.5 py-1.5">Convert</button>
                      )}
                      {(e.status === 'waiting' || e.status === 'offered') && (
                        <button onClick={() => doExpire(e)} disabled={busy === e.id} className="text-xs text-gray-600 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-100">Expire</button>
                      )}
                      <button onClick={() => setEditing(e)} className="text-xs text-gray-600 hover:text-gray-900 underline">Edit</button>
                      <button onClick={() => doDelete(e)} disabled={busy === e.id} className="text-xs text-red-700 hover:text-red-700 underline">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <Modal title="Add to Waiting List" onClose={() => setShowAdd(false)}>
          <EntryForm onSave={(d) => saveEntry(d)} saving={saving} />
        </Modal>
      )}
      {editing && (
        <Modal title="Edit Entry" onClose={() => setEditing(null)}>
          <EntryForm initial={editing} onSave={(d) => saveEntry(d, editing.id)} saving={saving} />
        </Modal>
      )}
      {offerEntry && (
        <Modal title={`Offer space to ${offerEntry.name}`} onClose={() => setOfferEntry(null)}>
          <p className="text-sm text-gray-500 mb-3">An email{offerEntry.phone ? ' + SMS' : ''} will be sent. They get <b className="text-gray-900">48 hours</b> to claim, then the offer lapses automatically.</p>
          <Field label="Unit code (optional)"><input className="input" value={unitCode} onChange={(e) => setUnitCode(e.target.value)} placeholder="e.g. PO-204" /></Field>
          <div className="flex justify-end gap-2">
            <button onClick={() => setOfferEntry(null)} className="btn-secondary">Cancel</button>
            <button onClick={() => doOffer(offerEntry)} disabled={busy === offerEntry.id} className="btn-primary">{busy === offerEntry.id ? 'Sending…' : 'Send Offer'}</button>
          </div>
        </Modal>
      )}
      {convertEntry && (
        <Modal title={`Convert ${convertEntry.name} to Member`} onClose={() => setConvertEntry(null)}>
          <p className="text-sm text-gray-500 mb-3">A member record will be created from this entry.</p>
          <Field label="Phone *"><input className="input" value={convertPhone} onChange={(e) => setConvertPhone(e.target.value)} required placeholder="0300-1234567" /></Field>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConvertEntry(null)} className="btn-secondary">Cancel</button>
            <button onClick={() => doConvert(convertEntry)} disabled={busy === convertEntry.id || !convertPhone.trim()} className="btn-primary">{busy === convertEntry.id ? 'Converting…' : 'Convert to Member'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
