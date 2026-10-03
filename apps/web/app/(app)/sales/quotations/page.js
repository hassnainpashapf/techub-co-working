'use client';

// Phase 39 Track 4: Quotations for Leads — list + builder (line items, totals,
// validity) + send/accept/reject actions.
import { useEffect, useMemo, useState } from 'react';
import { api, apiDownload } from '../../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, EmptyState, StatCard, DataTable } from '../../../../components/ui';

const STATUSES = [
  { key: 'draft', label: 'Draft', tone: 'slate' },
  { key: 'sent', label: 'Sent', tone: 'blue' },
  { key: 'accepted', label: 'Accepted', tone: 'green' },
  { key: 'rejected', label: 'Rejected', tone: 'red' },
  { key: 'expired', label: 'Expired', tone: 'amber' },
];
const toneFor = (s) => (STATUSES.find((x) => x.key === s) || {}).tone || 'slate';

const fmtMoney = (n) => `Rs ${Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`;
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const totalOf = (items) => items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);

function BuilderForm({ leads, initial, onSave, saving }) {
  const [f, setF] = useState({
    leadId: initial?.leadId || '',
    validTill: initial?.validTill ? String(initial.validTill).slice(0, 10) : new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10),
    notes: initial?.notes || '',
  });
  const [items, setItems] = useState(initial?.items?.length ? initial.items : [{ desc: '', qty: 1, price: 0 }]);

  const setItem = (i, patch) => setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const addItem = () => setItems([...items, { desc: '', qty: 1, price: 0 }]);
  const removeItem = (i) => setItems(items.filter((_, j) => j !== i));

  const valid = f.leadId && items.length > 0 && items.every((it) => it.desc.trim() && Number(it.qty) > 0);

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      onSave({ ...f, items: items.map((it) => ({ desc: it.desc.trim(), qty: Number(it.qty), price: Number(it.price) })) });
    }}>
      <Field label="Lead *">
        <select className="input" value={f.leadId} onChange={(e) => setF({ ...f, leadId: e.target.value })} required>
          <option value="">Select lead…</option>
          {leads.map((l) => <option key={l.id} value={l.id}>{l.name}{l.company ? ` — ${l.company}` : ''}</option>)}
        </select>
      </Field>
      <Field label="Valid Till *"><input type="date" className="input [color-scheme:dark]" value={f.validTill} onChange={(e) => setF({ ...f, validTill: e.target.value })} required /></Field>

      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">Line Items *</span>
        <button type="button" className="btn-ghost text-xs" onClick={addItem}>+ Add item</button>
      </div>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_70px_110px_30px] gap-2 items-center">
            <input className="input" value={it.desc} onChange={(e) => setItem(i, { desc: e.target.value })} placeholder="Description (e.g. Dedicated desk — 1 month)" required />
            <input type="number" min="0.01" step="any" className="input" value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} placeholder="Qty" />
            <input type="number" min="0" step="any" className="input" value={it.price} onChange={(e) => setItem(i, { price: e.target.value })} placeholder="Price" />
            <button type="button" className="btn-ghost text-red-400" onClick={() => removeItem(i)} disabled={items.length === 1} title="Remove">✕</button>
          </div>
        ))}
      </div>
      <div className="mt-3 text-right text-lg font-bold">Total: {fmtMoney(totalOf(items))}</div>

      <Field label="Notes"><textarea className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Optional notes…" /></Field>
      <button type="submit" className="btn-primary w-full" disabled={saving || !valid}>{saving ? 'Saving…' : (initial ? 'Update Quotation' : 'Create Quotation')}</button>
    </form>
  );
}

export default function QuotationsPage() {
  const [quotations, setQuotations] = useState([]);
  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [qd, sd, ld] = await Promise.all([
        api.get('/quotations'),
        api.get('/quotations/stats').catch(() => ({})),
        api.get('/leads').catch(() => ({ leads: [] })),
      ]);
      setQuotations(qd.quotations || []);
      setStats(sd);
      setLeads(ld.leads || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(
    () => (status ? quotations.filter((q) => q.status === status) : quotations),
    [quotations, status]
  );

  const save = async (payload) => {
    setSaving(true);
    try {
      if (editing) await api.patch(`/quotations/${editing.id}`, payload);
      else await api.post('/quotations', payload);
      setShowAdd(false); setEditing(null);
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const act = async (q, action) => {
    if (!window.confirm(`Quotation ${q.number} ${action}?`)) return;
    setBusy(q.id);
    try {
      await api.post(`/quotations/${q.id}/${action}`);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  };

  const counts = stats?.counts || {};

  return (
    <div>
      <PageHeader
        title="Quotations"
        sub="Create and send branded price quotations to leads"
        actions={<button className="btn-primary" onClick={() => setShowAdd(true)}>+ New Quotation</button>}
      />
      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatCard label="Draft" value={counts.draft || 0} accent="slate" />
        <StatCard label="Sent" value={counts.sent || 0} accent="blue" />
        <StatCard label="Accepted" value={counts.accepted || 0} accent="green" />
        <StatCard label="Expired" value={counts.expired || 0} accent="amber" />
        <StatCard label="Open Value (sent)" value={fmtMoney(stats?.openValue)} accent="violet" sub={stats?.pastDue ? `${stats.pastDue} past validity` : ''} />
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        <button className={`btn-pill ${!status ? 'active' : ''}`} onClick={() => setStatus('')}>All</button>
        {STATUSES.map((s) => (
          <button key={s.key} className={`btn-pill ${status === s.key ? 'active' : ''}`} onClick={() => setStatus(s.key)}>{s.label}</button>
        ))}
      </div>

      {loading ? <Spinner /> : filtered.length === 0 ? (
        <EmptyState title="No quotations yet" hint="Create a quotation for a lead to get started." />
      ) : (
        <DataTable
          columns={['Number', 'Lead', 'Items', 'Total', 'Valid Till', 'Status', 'Actions']}
          rows={filtered.map((q) => [
            <span key="n" className="font-mono font-semibold">{q.number}</span>,
            <span key="l">{q.lead?.name || '—'}<span className="block text-xs opacity-60">{q.lead?.company || q.lead?.email || ''}</span></span>,
            <span key="i">{Array.isArray(q.items) ? q.items.length : 0}</span>,
            <span key="t" className="font-semibold">{fmtMoney(q.total)}</span>,
            <span key="v">{fmtDate(q.validTill)}</span>,
            <span key="s"><Badge tone={toneFor(q.status)}>{q.status}</Badge></span>,
            <span key="a" className="flex gap-1 flex-wrap">
              <button className="btn-ghost text-xs" onClick={() => apiDownload(`/quotations/${q.id}/pdf`, `${q.number}.pdf`)}>PDF</button>
              {q.status === 'draft' && (
                <>
                  <button className="btn-ghost text-xs" onClick={() => setEditing(q)}>Edit</button>
                  <button className="btn-ghost text-xs text-blue-400" disabled={busy === q.id} onClick={() => act(q, 'send')}>{busy === q.id ? '…' : 'Send'}</button>
                </>
              )}
              {(q.status === 'draft' || q.status === 'sent') && (
                <>
                  <button className="btn-ghost text-xs text-green-400" disabled={busy === q.id} onClick={() => act(q, 'accept')}>Accept</button>
                  <button className="btn-ghost text-xs text-red-400" disabled={busy === q.id} onClick={() => act(q, 'reject')}>Reject</button>
                </>
              )}
            </span>,
          ])}
          empty="No quotations"
        />
      )}

      {showAdd && (
        <Modal title="New Quotation" onClose={() => setShowAdd(false)}>
          <BuilderForm leads={leads} onSave={save} saving={saving} />
        </Modal>
      )}
      {editing && (
        <Modal title={`Edit ${editing.number}`} onClose={() => setEditing(null)}>
          <BuilderForm leads={leads} initial={editing} onSave={save} saving={saving} />
        </Modal>
      )}
    </div>
  );
}
