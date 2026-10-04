'use client';

// Phase 49 Track 4: Communication Hub — Bulk SMS Campaigns.
// Backend: /api/sms-campaigns (CRUD + preview + send + progress via sentCount/failCount).
// Mount: app.use('/api/sms-campaigns', require('./routes/sms-campaigns')) (pehle se mounted).
// Sidebar: Comms section me { label: 'SMS Campaigns', path: '/comms/sms' } (roles: ceo/admin/manager).

import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Spinner, EmptyState, ErrorBanner, Modal, Field } from '../../../../components/ui';

const SEGMENTS = [
  { v: 'all_active', l: '👥 Sab active members' },
  { v: 'overdue', l: '⚠️ Overdue dues wale' },
  { v: 'trial', l: '🆕 Trial members' },
];

function counter(text) {
  const chars = [...(text || '')].length;
  const gsm = /^[\x00-\x7F]*$/.test(text || '');
  const per = gsm ? (chars <= 160 ? 160 : 153) : chars <= 70 ? 70 : 67;
  return { chars, segments: Math.max(1, Math.ceil(chars / per)), encoding: gsm ? 'GSM-7' : 'Unicode' };
}

const statusTone = { draft: 'default', sending: 'info', sent: 'success', failed: 'danger' };

export default function CommsSmsPage() {
  const [items, setItems] = useState([]);
  const [provider, setProvider] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [segment, setSegment] = useState('all_active');
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewId, setPreviewId] = useState(null);
  // Send progress: campaignId -> total recipients (send response se). Polling har 3s jab koi 'sending' ho.
  const [totals, setTotals] = useState({});
  const pollRef = useRef(null);

  const load = async (silent) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const [list, prov] = await Promise.all([
        api.get('/sms-campaigns'),
        api.get('/sms-campaigns/provider-status').catch(() => null),
      ]);
      setItems(list.items || []);
      setProvider(prov);
    } catch (e) { if (!silent) setError(e.message); }
    finally { if (!silent) setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // Live progress polling: jab tak koi campaign 'sending' me hai.
  useEffect(() => {
    const anySending = items.some((it) => it.status === 'sending');
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (anySending) {
      pollRef.current = setInterval(() => load(true), 3000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [items]);

  const openCreate = () => {
    setEditing(null); setName(''); setMessage(''); setSegment('all_active'); setShowModal(true);
  };

  const openEdit = (it) => {
    setEditing(it); setName(it.name); setMessage(it.message);
    setSegment(it.segment?.type || 'all_active'); setShowModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/sms-campaigns/${editing.id}`, { name, message, segment: { type: segment } });
      } else {
        await api.post('/sms-campaigns', { name, message, segment: { type: segment } });
      }
      setShowModal(false); setEditing(null); setName(''); setMessage(''); setSegment('all_active');
      load();
    } catch (e2) { setError(e2.message); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!confirm('Ye draft campaign delete karni hai?')) return;
    try { await api.del(`/sms-campaigns/${id}`); load(); }
    catch (e) { setError(e.message); }
  };

  const showPreview = async (id) => {
    try {
      const p = await api.get(`/sms-campaigns/${id}/preview`);
      setPreview(p); setPreviewId(id);
      setTotals((t) => ({ ...t, [id]: p.recipientCount }));
    } catch (e) { setError(e.message); }
  };

  const send = async (id) => {
    if (!confirm('Campaign bhejni hai? Tamam recipients ko SMS jayega.')) return;
    setSendingId(id);
    try {
      const r = await api.post(`/sms-campaigns/${id}/send`);
      setTotals((t) => ({ ...t, [id]: r.recipientCount }));
      load(true);
    } catch (e) { setError(e.message); }
    finally { setSendingId(null); }
  };

  const c = counter(message);

  const progressBar = (it) => {
    if (it.status !== 'sending') return null;
    const done = (it.sentCount || 0) + (it.failCount || 0);
    const total = totals[it.id];
    const pct = total ? Math.min(100, Math.round((done / total) * 100)) : null;
    return (
      <div className="mt-3">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>📤 Bhej rahe hain… {done}{total ? ` / ${total}` : ''}</span>
          <span>{pct !== null ? `${pct}%` : 'live'}</span>
        </div>
        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${pct !== null ? 'bg-[#0f766e]' : 'bg-[#0f766e] animate-pulse'}`}
            style={{ width: pct !== null ? `${pct}%` : '40%' }}
          />
        </div>
        {it.failCount > 0 && <div className="text-xs text-red-700 mt-1">⚠️ {it.failCount} failed</div>}
      </div>
    );
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader title="📱 SMS Campaigns" subtitle="Communication Hub — members ko bulk SMS" action={
        <button className="btn-primary" onClick={openCreate}>+ New Campaign</button>
      } />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}

      {provider && !provider.configured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mb-4 text-sm text-amber-700">
          ⚠️ <b>Console mode:</b> {provider.message}
        </div>
      )}
      {provider && provider.configured && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 mb-4 text-sm text-emerald-700">
          ✅ Twilio connected — real SMS delivery active.
        </div>
      )}

      {items.length === 0 ? <EmptyState title="Koi campaign nahi" hint="Pehli SMS campaign banao" /> : (
        <div className="grid gap-3">
          {items.map((it) => (
            <div key={it.id} className="card-premium p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900">{it.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {new Date(it.createdAt).toLocaleString()} · {SEGMENTS.find((s) => s.v === it.segment?.type)?.l || it.segment?.type}
                  </div>
                  <div className="text-sm text-gray-600 mt-2 max-w-xl line-clamp-2">{it.message}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    ✅ {it.sentCount || 0} sent
                    {it.failCount > 0 && <span className="text-red-700"> · ❌ {it.failCount} failed</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={statusTone[it.status] || 'default'}>{it.status}</Badge>
                  {it.status === 'draft' && (
                    <>
                      <button className="btn-ghost btn-sm" onClick={() => showPreview(it.id)}>Preview</button>
                      <button className="btn-ghost btn-sm" onClick={() => openEdit(it)}>Edit</button>
                      <button className="btn-ghost btn-sm" onClick={() => remove(it.id)}>Delete</button>
                      <button className="btn-primary btn-sm" disabled={sendingId === it.id} onClick={() => send(it.id)}>
                        {sendingId === it.id ? 'Sending…' : 'Send'}
                      </button>
                    </>
                  )}
                </div>
              </div>
              {progressBar(it)}
              {previewId === it.id && preview && (
                <div className="mt-3 text-sm text-gray-600 border-t border-gray-200 pt-3">
                  📩 <b>{preview.recipientCount}</b> recipients · {preview.counter.chars} chars · {preview.counter.segments} segment(s) ({preview.counter.encoding})
                  {preview.sample?.length > 0 && (
                    <div className="text-xs text-slate-500 mt-1">
                      Sample: {preview.sample.map((s) => `${s.name} (${s.phone})`).join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal title={editing ? 'Edit Campaign' : 'New SMS Campaign'} onClose={() => setShowModal(false)}>
          <form onSubmit={save}>
            <Field label="Campaign name">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="Eid offer" />
            </Field>
            <Field label="Audience segment">
              <select className="input" value={segment} onChange={(e) => setSegment(e.target.value)}>
                {SEGMENTS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
              </select>
            </Field>
            <Field label={`Message — ${c.chars} chars · ${c.segments} segment${c.segments > 1 ? 's' : ''} (${c.encoding})`}>
              <textarea className="input" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} required maxLength={1000} placeholder="Assalam o Alaikum! ..." />
            </Field>
            <div className="text-xs text-slate-500 mb-3">
              💡 Tip: Urdu/Roman Urdu me likho — Unicode mode me 70 chars = 1 segment.
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : (editing ? 'Update' : 'Save Draft')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
