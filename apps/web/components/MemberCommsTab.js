// Phase 49: member comms tab (timeline + log call + quick send) for member detail modal.
'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Badge, Spinner, ErrorBanner, Field, Modal } from './ui';

const CHANNEL_TONE = { chat: 'blue', email: 'violet', sms: 'amber', whatsapp: 'green', voice: 'slate', notice: 'slate', internal: 'blue', note: 'slate' };

export default function MemberCommsTab({ memberId, memberPhone, memberEmail }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showSend, setShowSend] = useState(false);
  const [showCall, setShowCall] = useState(false);
  const [channel, setChannel] = useState('internal');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [callOutcome, setCallOutcome] = useState('Jawab diya');
  const [callNotes, setCallNotes] = useState('');
  const [callDur, setCallDur] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const r = await api.get(`/comms-timeline/${memberId}`);
      setItems(r.items || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [memberId]);

  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api.post('/comms/send', { channel, memberId, body: body.trim() });
      setBody(''); setShowSend(false); await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const logCall = async () => {
    setBusy(true);
    try {
      await api.post('/call-logs', {
        memberId,
        direction: 'out',
        outcome: callOutcome,
        notes: callNotes || null,
        durationSec: callDur ? parseInt(callDur, 10) : null,
      });
      setCallNotes(''); setCallDur(''); setShowCall(false); await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const tel = memberPhone ? `tel:${String(memberPhone).replace(/[^+\d]/g, '')}` : null;

  return (
    <div>
      {error && <ErrorBanner message={error} />}
      <div className="flex gap-2 mb-3">
        <button onClick={() => setShowSend(true)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-teal-600/20 border border-teal-500/40 text-violet-700 hover:bg-teal-600/30">✉️ Message bhejein</button>
        <button onClick={() => setShowCall(true)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/20 border border-blue-400/40 text-blue-700 hover:bg-blue-500/30">📞 Log call</button>
        {tel && <a href={tel} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/20 border border-emerald-400/40 text-emerald-700 hover:bg-emerald-500/30">📱 Call karein</a>}
      </div>

      {loading ? <Spinner /> : items.length === 0 ? (
        <p className="text-sm text-gray-500">Abhi koi communication record nahi.</p>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {items.map((it, i) => (
            <div key={i} className="bg-gray-100 rounded-lg p-3 text-sm">
              <div className="flex items-center gap-2 mb-1">
                <Badge tone={CHANNEL_TONE[it.badge?.tone] ? it.badge.tone : CHANNEL_TONE[it.channel] || 'slate'}>{it.badge?.label || it.channel}</Badge>
                <span className="text-xs text-slate-500">{it.direction === 'in' ? '⬅ incoming' : '➡ outgoing'}</span>
                <span className="text-xs text-slate-500 ml-auto">{it.createdAt ? new Date(it.createdAt).toLocaleString() : ''}</span>
              </div>
              {it.subject && <p className="font-medium text-gray-800">{it.subject}</p>}
              <p className="text-gray-600 whitespace-pre-wrap">{it.snippet || it.body}</p>
            </div>
          ))}
        </div>
      )}

      {showSend && (
        <Modal title="Message bhejein" onClose={() => setShowSend(false)}>
          <div className="space-y-3">
            <Field label="Channel">
              <select value={channel} onChange={(e) => setChannel(e.target.value)} className="input-premium">
                <option value="internal">In-app</option>
                <option value="email">Email{memberEmail ? ` (${memberEmail})` : ''}</option>
                <option value="sms">SMS{memberPhone ? ` (${memberPhone})` : ''}</option>
                <option value="whatsapp">WhatsApp{memberPhone ? ` (${memberPhone})` : ''}</option>
              </select>
            </Field>
            <Field label="Message">
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="input-premium" placeholder="Message likhein..." />
            </Field>
            <button disabled={busy || !body.trim()} onClick={send} className="btn-primary w-full">Bhejein</button>
          </div>
        </Modal>
      )}

      {showCall && (
        <Modal title="Call log karein" onClose={() => setShowCall(false)}>
          <div className="space-y-3">
            <Field label="Outcome">
              <select value={callOutcome} onChange={(e) => setCallOutcome(e.target.value)} className="input-premium">
                {['Jawab diya', 'Busy tha', 'Callback manga', 'Number band tha', 'Ghalat number'].map((o) => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Duration (seconds)">
              <input type="number" value={callDur} onChange={(e) => setCallDur(e.target.value)} className="input-premium" placeholder="120" />
            </Field>
            <Field label="Notes">
              <textarea value={callNotes} onChange={(e) => setCallNotes(e.target.value)} rows={3} className="input-premium" placeholder="Call ki tafseel..." />
            </Field>
            <button disabled={busy} onClick={logCall} className="btn-primary w-full">Save karein</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
