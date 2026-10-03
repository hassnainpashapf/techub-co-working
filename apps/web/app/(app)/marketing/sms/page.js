'use client';

import { useEffect, useState } from 'react';
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

export default function SmsCampaignsPage() {
  const [items, setItems] = useState([]);
  const [provider, setProvider] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [segment, setSegment] = useState('all_active');
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewId, setPreviewId] = useState(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [list, prov] = await Promise.all([
        api.get('/sms-campaigns'),
        api.get('/sms-campaigns/provider-status').catch(() => null),
      ]);
      setItems(list.items || []);
      setProvider(prov);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/sms-campaigns', { name, message, segment: { type: segment } });
      setShowModal(false); setName(''); setMessage(''); setSegment('all_active');
      load();
    } catch (e2) { setError(e2.message); }
    finally { setSaving(false); }
  };

  const showPreview = async (id) => {
    try {
      const p = await api.get(`/sms-campaigns/${id}/preview`);
      setPreview(p); setPreviewId(id);
    } catch (e) { setError(e.message); }
  };

  const send = async (id) => {
    if (!confirm('Campaign bhejni hai? Recipients ko SMS jayega.')) return;
    setSendingId(id);
    try {
      const r = await api.post(`/sms-campaigns/${id}/send`);
      alert(`Bhejna shuru — ${r.recipientCount} recipients (${r.provider === 'twilio' ? 'Twilio' : 'console mode'})`);
      load();
    } catch (e) { setError(e.message); }
    finally { setSendingId(null); }
  };

  const c = counter(message);
  const statusBadge = (s) => {
    const map = { draft: 'default', sending: 'info', sent: 'success', failed: 'danger' };
    return <Badge tone={map[s] || 'default'}>{s}</Badge>;
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader title="📱 SMS Campaigns" subtitle="Members ko bulk SMS bhejo" action={
        <button className="btn-primary" onClick={() => setShowModal(true)}>+ New Campaign</button>
      } />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}

      {provider && !provider.configured && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 mb-4 text-sm text-amber-200">
          ⚠️ <b>Console mode:</b> {provider.message}
        </div>
      )}
      {provider && provider.configured && (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 mb-4 text-sm text-emerald-200">
          ✅ Twilio connected — real SMS delivery active.
        </div>
      )}

      {items.length === 0 ? <EmptyState title="Koi campaign nahi" hint="Pehli SMS campaign banao" /> : (
        <div className="grid gap-3">
          {items.map((it) => (
            <div key={it.id} className="card-premium p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-semibold text-white">{it.name}</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {new Date(it.createdAt).toLocaleString()} · {it.sentCount} sent
                    {it.failCount > 0 && <span className="text-red-300"> · {it.failCount} failed</span>}
                  </div>
                  <div className="text-sm text-slate-300 mt-2 max-w-xl">{it.message}</div>
                </div>
                <div className="flex items-center gap-2">
                  {statusBadge(it.status)}
                  {it.status === 'draft' && (
                    <>
                      <button className="btn-ghost btn-sm" onClick={() => showPreview(it.id)}>Preview</button>
                      <button className="btn-primary btn-sm" disabled={sendingId === it.id} onClick={() => send(it.id)}>
                        {sendingId === it.id ? 'Sending…' : 'Send'}
                      </button>
                    </>
                  )}
                </div>
              </div>
              {previewId === it.id && preview && (
                <div className="mt-3 text-sm text-slate-300 border-t border-white/10 pt-3">
                  📩 <b>{preview.recipientCount}</b> recipients · {preview.counter.chars} chars · {preview.counter.segments} segment(s) ({preview.counter.encoding})
                  {preview.sample?.length > 0 && (
                    <div className="text-xs text-slate-500 mt-1">
                      Sample: {preview.sample.map((s) => s.name).join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal title="New SMS Campaign" onClose={() => setShowModal(false)}>
          <form onSubmit={create}>
            <Field label="Campaign name">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="Eid offer" />
            </Field>
            <Field label="Segment">
              <select className="input" value={segment} onChange={(e) => setSegment(e.target.value)}>
                {SEGMENTS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
              </select>
            </Field>
            <Field label={`Message — ${c.chars} chars · ${c.segments} segment${c.segments > 1 ? 's' : ''} (${c.encoding})`}>
              <textarea className="input" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} required maxLength={1000} placeholder="Assalam o Alaikum! ..." />
            </Field>
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Draft'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
