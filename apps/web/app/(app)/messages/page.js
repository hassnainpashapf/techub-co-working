'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, Badge, Spinner, EmptyState, ErrorBanner } from '../../../components/ui';

export default function MessagesPage() {
  const [convs, setConvs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [members, setMembers] = useState([]);
  const [newSel, setNewSel] = useState({ type: 'direct', memberIds: [], title: '' });
  const boxRef = useRef(null);
  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  const loadConvs = async () => {
    try {
      const r = await api.get('/api/messages/conversations');
      setConvs(r.data.conversations || []);
    } catch (e) { /* list fail = empty state */ }
  };

  const loadMessages = async (id, after) => {
    const r = await api.get(`/api/messages/conversations/${id}/messages${after ? `?after=${encodeURIComponent(after)}` : ''}`);
    const list = r.data.messages || [];
    if (after) setMessages((prev) => [...prev, ...list]);
    else setMessages(list);
    return list;
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
    try { await loadMessages(id); } catch (e) { setError(e?.response?.data?.error || 'Load failed'); }
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
      await loadMessages(activeId);
    } catch (e) { setError(e?.response?.data?.error || 'Send failed'); }
    finally { setSending(false); }
  };

  const loadMembers = async () => {
    try {
      const r = await api.get('/api/members?status=active&limit=200');
      setMembers(r.data.members || r.data || []);
    } catch {}
  };

  const createConv = async () => {
    if (!newSel.memberIds.length) return;
    setError('');
    try {
      const r = await api.post('/api/messages/conversations', {
        type: newSel.type,
        title: newSel.title || null,
        participantMemberIds: newSel.memberIds,
      });
      setShowNew(false);
      setNewSel({ type: 'direct', memberIds: [], title: '' });
      await loadConvs();
      openConv(r.data.id);
    } catch (e) { setError(e?.response?.data?.error || 'Create failed'); }
  };

  const active = convs.find((c) => c.id === activeId);

  if (loading) return <div className="p-6"><Spinner /></div>;

  return (
    <div className="p-4 md:p-6">
      <PageHeader title="Messages" subtitle="Staff ↔ member chat" actions={
        <button className="btn-primary" onClick={() => { setShowNew(true); loadMembers(); }}>+ New chat</button>
      } />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      <div className="grid md:grid-cols-3 gap-3 mt-3" style={{ minHeight: 520 }}>
        <div className="card-premium p-3 overflow-y-auto" style={{ maxHeight: 620 }}>
          {convs.length === 0 && <EmptyState title="No conversations" hint="Start a new chat with a member." />}
          {convs.map((c) => (
            <button key={c.id} onClick={() => openConv(c.id)}
              className={`w-full text-left p-3 rounded-xl mb-2 border transition ${c.id === activeId ? 'bg-[#0f766e]/15 border-[#0f766e]/40' : 'bg-gray-100 border-gray-200 hover:border-[#0f766e]/30'}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-900 truncate">
                  {c.title || c.participants.map((p) => p.name).slice(0, 3).join(', ') || 'Chat'}
                </span>
                {c.unread && <span className="w-2.5 h-2.5 rounded-full bg-[#0f766e]" />}
              </div>
              <p className="text-xs text-gray-500 truncate mt-1">{c.lastMessage?.body || 'No messages yet'}</p>
              <div className="flex items-center gap-1 mt-1.5">
                <Badge color="slate">{c.type}</Badge>
                {c.participants.slice(0, 3).map((p, i) => (
                  <span key={i} className="text-[11px] text-slate-500">{p.name}</span>
                ))}
              </div>
            </button>
          ))}
        </div>
        <div className="md:col-span-2 card-premium flex flex-col" style={{ minHeight: 520 }}>
          {!activeId ? (
            <div className="flex-1 flex items-center justify-center"><EmptyState title="Select a conversation" hint="Left se koi chat kholo." /></div>
          ) : (
            <>
              <div className="p-3 border-b border-gray-200">
                <p className="text-gray-900 font-semibold">{active?.title || active?.participants.map((p) => p.name).join(', ')}</p>
                <p className="text-xs text-gray-500">{active?.type} • {active?.participants.length} participants</p>
              </div>
              <div ref={boxRef} className="flex-1 overflow-y-auto p-4 space-y-2" style={{ maxHeight: 420 }}>
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-2xl px-3 py-2 ${m.mine ? 'bg-[#0f766e] text-white' : 'bg-gray-100 text-gray-900'}`}>
                      {!m.mine && <p className="text-[11px] text-gray-500 mb-0.5">{m.senderName} • {m.senderRole}</p>}
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
      {showNew && (
        <div className="fixed inset-0 bg-gray-900/50 flex items-center justify-center z-50 p-4">
          <div className="card-premium p-5 w-full max-w-md">
            <h3 className="text-gray-900 font-bold mb-3">New chat</h3>
            <label className="text-xs text-gray-500">Title (optional)</label>
            <input className="input w-full mb-3" value={newSel.title} onChange={(e) => setNewSel({ ...newSel, title: e.target.value })} placeholder="e.g. Rent reminder" />
            <label className="text-xs text-gray-500">Type</label>
            <select className="input w-full mb-3" value={newSel.type} onChange={(e) => setNewSel({ ...newSel, type: e.target.value })}>
              <option value="direct">Direct</option>
              <option value="group">Group</option>
              <option value="support">Support</option>
            </select>
            <label className="text-xs text-gray-500">Members (select)</label>
            <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2 mb-3">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm text-gray-800 py-1">
                  <input type="checkbox" checked={newSel.memberIds.includes(m.id)}
                    onChange={(e) => setNewSel({
                      ...newSel,
                      memberIds: e.target.checked ? [...newSel.memberIds, m.id] : newSel.memberIds.filter((x) => x !== m.id),
                    })} />
                  {m.name} <span className="text-xs text-slate-500">{m.companyName}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-ghost" onClick={() => setShowNew(false)}>Cancel</button>
              <button className="btn-primary" onClick={createConv} disabled={!newSel.memberIds.length}>Start chat</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
