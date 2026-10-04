'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Spinner, EmptyState, ErrorBanner } from '../../../../components/ui';

export default function PortalMessagesPage() {
  const [convs, setConvs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const boxRef = useRef(null);
  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  const loadConvs = async () => {
    try {
      const r = await api.get('/api/messages/conversations');
      setConvs(r.data.conversations || []);
    } catch {}
  };

  useEffect(() => {
    (async () => { setLoading(true); await loadConvs(); setLoading(false); })();
    const t = setInterval(loadConvs, 15000);
    return () => clearInterval(t);
  }, []);

  // 2-second polling sirf khuli hui conversation par.
  useEffect(() => {
    if (!activeId) return;
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      try {
        const list = await api.get(
          `/api/messages/conversations/${activeRef.current}/messages${messages.length ? `?after=${encodeURIComponent(messages[messages.length - 1].createdAt)}` : ''}`
        ).then((r) => r.data.messages || []);
        if (alive && list.length) setMessages((prev) => [...prev, ...list]);
      } catch {}
    };
    const t = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [activeId, messages.length]);

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [messages]);

  const openConv = async (id) => {
    setActiveId(id);
    setMessages([]);
    try {
      const r = await api.get(`/api/messages/conversations/${id}/messages`);
      setMessages(r.data.messages || []);
    } catch (e) { setError(e?.response?.data?.error || 'Load failed'); }
    loadConvs();
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || !activeId || sending) return;
    setSending(true);
    setError('');
    try {
      await api.post(`/api/messages/conversations/${activeId}/messages`, { body });
      setDraft('');
      const r = await api.get(`/api/messages/conversations/${activeId}/messages`);
      setMessages(r.data.messages || []);
    } catch (e) { setError(e?.response?.data?.error || 'Send failed'); }
    finally { setSending(false); }
  };

  const active = convs.find((c) => c.id === activeId);

  if (loading) return <div className="p-6"><Spinner /></div>;

  return (
    <div className="p-4 md:p-6">
      <PageHeader title="Messages" subtitle="Chat with our team" />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      <div className="grid md:grid-cols-3 gap-3 mt-3" style={{ minHeight: 500 }}>
        <div className="card-premium p-3 overflow-y-auto" style={{ maxHeight: 600 }}>
          {convs.length === 0 && <EmptyState title="No messages yet" hint="Hamari team se chat yahan dikhegi." />}
          {convs.map((c) => (
            <button key={c.id} onClick={() => openConv(c.id)}
              className={`w-full text-left p-3 rounded-xl mb-2 border transition ${c.id === activeId ? 'bg-[#0f766e]/15 border-[#0f766e]/40' : 'bg-gray-100 border-gray-200 hover:border-[#0f766e]/30'}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-900 truncate">
                  {c.title || 'Team chat'}
                </span>
                {c.unread && <span className="w-2.5 h-2.5 rounded-full bg-[#0f766e]" />}
              </div>
              <p className="text-xs text-gray-500 truncate mt-1">{c.lastMessage?.body || 'No messages yet'}</p>
              <div className="mt-1.5"><Badge color="slate">{c.type}</Badge></div>
            </button>
          ))}
        </div>
        <div className="md:col-span-2 card-premium flex flex-col" style={{ minHeight: 500 }}>
          {!activeId ? (
            <div className="flex-1 flex items-center justify-center"><EmptyState title="Select a conversation" hint="Left se koi chat kholo." /></div>
          ) : (
            <>
              <div className="p-3 border-b border-gray-200">
                <p className="text-gray-900 font-semibold">{active?.title || 'Team chat'}</p>
                <p className="text-xs text-gray-500">{active?.participants.map((p) => p.name).join(', ')}</p>
              </div>
              <div ref={boxRef} className="flex-1 overflow-y-auto p-4 space-y-2" style={{ maxHeight: 400 }}>
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-2xl px-3 py-2 ${m.mine ? 'bg-[#0f766e] text-white' : 'bg-gray-100 text-gray-900'}`}>
                      {!m.mine && <p className="text-[11px] text-gray-500 mb-0.5">{m.senderName}</p>}
                      <p className="text-sm whitespace-pre-wrap">{m.body}</p>
                      <p className="text-[10px] opacity-60 mt-1">{new Date(m.createdAt).toLocaleTimeString()}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-3 border-t border-gray-200 flex gap-2">
                <input value={draft} onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send()}
                  placeholder="Type a message…" className="input flex-1" />
                <button className="btn-primary" onClick={send} disabled={sending || !draft.trim()}>
                  {sending ? '…' : 'Send'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
