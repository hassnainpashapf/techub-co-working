'use client';

import { useEffect, useState, useRef } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, EmptyState, Badge, Field } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const CHANNEL_TONES = { internal: 'violet', email: 'blue', sms: 'amber', whatsapp: 'green', voice: 'rose', note: 'slate' };
const CHANNEL_LABELS = { internal: 'Internal', email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp', voice: 'Call', note: 'Note' };

function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'abhi';
  if (s < 3600) return `${Math.floor(s / 60)}m pehle`;
  if (s < 86400) return `${Math.floor(s / 3600)}h pehle`;
  return new Date(d).toLocaleDateString();
}

export default function TeamInboxPage() {
  const allowed = useRequireRoles('ceo', 'admin', 'super_admin', 'manager', 'receptionist');
  const [convos, setConvos] = useState([]);
  const [summary, setSummary] = useState(null);
  const [users, setUsers] = useState([]);
  const [filter, setFilter] = useState('open'); // open | unassigned | me | resolved
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState(null); // selected conversation
  const [thread, setThread] = useState([]);
  const [reply, setReply] = useState('');
  const [replyChannel, setReplyChannel] = useState('internal');
  const [assignTo, setAssignTo] = useState('');
  const [templates, setTemplates] = useState([]);
  const [scheduleAt, setScheduleAt] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const threadEnd = useRef(null);

  const loadConvos = async () => {
    const q = new URLSearchParams();
    if (filter === 'unassigned') q.set('assigned', 'unassigned');
    else if (filter === 'me') q.set('assigned', 'me');
    else if (filter === 'resolved') q.set('resolved', 'true');
    else q.set('resolved', 'false');
    if (search.trim()) q.set('search', search.trim());
    const d = await api.get(`/inbox?${q}`);
    setConvos(d.conversations || []);
    const s = await api.get('/inbox/summary');
    setSummary(s.summary);
  };

  const loadThread = async (c) => {
    if (!c.memberId) return;
    const d = await api.get(`/inbox/thread/${c.memberId}`);
    setThread(d.messages || []);
    setAssignTo(c.assignedTo?.id || '');
    setTimeout(() => threadEnd.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  useEffect(() => {
    if (!allowed) return;
    (async () => {
      try {
        setLoading(true); setErr('');
        await loadConvos();
        const u = await api.get('/users').catch(() => ({ users: [] }));
        setUsers(u.users || []);
        const t = await api.get('/comms-templates?active=1').catch(() => ({ templates: [] }));
        setTemplates(t.templates || []);
      } catch (e) { setErr(e.message || 'Inbox load nahi ho saka'); }
      finally { setLoading(false); }
    })();
  }, [allowed, filter]);

  useEffect(() => { if (sel) loadThread(sel); }, [sel?.key]);

  const pick = (c) => { setSel(c); setThread([]); };

  const doAssign = async () => {
    if (!sel?.lastMessage) return;
    await api.patch(`/inbox/${sel.lastMessage.id}`, { assignedToId: assignTo || null });
    const updated = { ...sel, assignedTo: users.find((u) => u.id === assignTo) || null };
    setSel(updated); loadConvos();
  };

  const doResolve = async (resolved) => {
    if (!sel?.lastMessage) return;
    await api.patch(`/inbox/${sel.lastMessage.id}`, { isResolved: resolved });
    setSel({ ...sel, isResolved: resolved });
    loadConvos();
  };

  const applyTemplate = async (id) => {
    if (!id) return;
    try {
      const t = await api.get(`/comms-templates/${id}`);
      const preview = await api.post(`/comms-templates/${id}/preview`, {
        sample: { name: sel?.memberName || 'Member' },
      }).catch(() => null);
      setReply(preview?.rendered || t.template?.body || '');
      if (t.template?.channel && t.template.channel !== 'any') setReplyChannel(t.template.channel);
    } catch {}
  };

  const doReply = async () => {
    if (!sel?.memberId || !reply.trim() || sending) return;
    setSending(true);
    try {
      if (scheduleAt) {
        // Schedule send (Track 7)
        await api.post('/comms/schedule', {
          channel: replyChannel, memberIds: [sel.memberId], body: reply.trim(),
          scheduledFor: new Date(scheduleAt).toISOString(),
        });
      } else {
        await api.post('/inbox/reply', { memberId: sel.memberId, channel: replyChannel, body: reply.trim() });
      }
      setReply(''); setScheduleAt('');
      await loadThread(sel); loadConvos();
    } catch (e) { setErr(e.message || 'Reply nahi gaya'); }
    finally { setSending(false); }
  };

  if (!allowed) return <AccessDenied />;
  if (loading) return <div className="p-8"><Spinner /></div>;

  return (
    <div className="p-6">
      <PageHeader
        title="📥 Team Inbox"
        sub={summary ? `${summary.unread} unread • ${summary.unassigned} unassigned` : 'Tamam channels ki conversations ek jaga'}
        actions={
          <div className="flex gap-2">
            {[['open', 'Open'], ['unassigned', 'Unassigned'], ['me', 'Meri'], ['resolved', 'Resolved']].map(([v, l]) => (
              <button key={v} onClick={() => setFilter(v)}
                className={`px-3 py-1.5 rounded-lg text-sm ${filter === v ? 'bg-[#0f766e] text-white' : 'bg-gray-100 text-gray-600'}`}>{l}</button>
            ))}
          </div>
        }
      />
      {err && <ErrorBanner message={err} />}

      <div className="mb-4 max-w-md">
        <Field label="Search">
          <input className="input-premium" placeholder="Naam, email ya message..." value={search}
            onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadConvos()} />
        </Field>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[calc(100vh-320px)] min-h-[480px]">
        {/* Conversation list */}
        <div className="rounded-2xl border border-gray-200 bg-gray-50 overflow-y-auto">
          {convos.length === 0 && <EmptyState title="Koi conversation nahi" />}
          {convos.map((c) => (
            <button key={c.key} onClick={() => pick(c)}
              className={`w-full text-left p-4 border-b border-gray-200 hover:bg-gray-100 ${sel?.key === c.key ? 'bg-[#0f766e]/10 border-l-2 border-l-blue-500' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium text-gray-900 truncate">{c.member?.name || c.external || 'Unknown'}</div>
                {c.unread > 0 && <span className="text-xs bg-[#0f766e] text-white rounded-full px-2 py-0.5">{c.unread}</span>}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Badge tone={CHANNEL_TONES[c.lastMessage.channel] || 'slate'}>{CHANNEL_LABELS[c.lastMessage.channel] || c.lastMessage.channel}</Badge>
                {c.assignedTo && <span className="text-xs text-amber-300">👤 {c.assignedTo.name}</span>}
                {c.isResolved && <Badge tone="green">Resolved</Badge>}
                <span className="text-xs text-slate-500 ml-auto">{timeAgo(c.lastAt)}</span>
              </div>
              <div className="text-sm text-gray-500 truncate mt-1">{c.lastMessage.body}</div>
            </button>
          ))}
        </div>

        {/* Thread */}
        <div className="lg:col-span-2 rounded-2xl border border-gray-200 bg-gray-50 flex flex-col overflow-hidden">
          {!sel ? (
            <div className="flex-1 flex items-center justify-center text-slate-500">Conversation select karein</div>
          ) : (
            <>
              <div className="p-4 border-b border-gray-200 flex items-center gap-3 flex-wrap">
                <div className="font-semibold text-gray-900">{sel.member?.name || sel.external}</div>
                <div className="text-xs text-gray-500">{sel.member?.email} {sel.member?.phone && `• ${sel.member.phone}`}</div>
                <div className="ml-auto flex items-center gap-2">
                  <select className="input-premium !w-auto text-sm" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                    <option value="">Assign...</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                  <button onClick={doAssign} className="px-3 py-1.5 rounded-lg bg-gray-100 text-sm">Assign</button>
                  {sel.isResolved
                    ? <button onClick={() => doResolve(false)} className="px-3 py-1.5 rounded-lg bg-amber-600/20 text-amber-300 text-sm">Reopen</button>
                    : <button onClick={() => doResolve(true)} className="px-3 py-1.5 rounded-lg bg-green-600/20 text-green-300 text-sm">✓ Resolve</button>}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {thread.map((m) => (
                  <div key={m.id} className={`max-w-[80%] rounded-xl p-3 ${m.direction === 'in' ? 'bg-gray-100 mr-auto' : 'bg-[#0f766e]/20 ml-auto'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge tone={CHANNEL_TONES[m.channel] || 'slate'}>{CHANNEL_LABELS[m.channel] || m.channel}</Badge>
                      <span className="text-xs text-slate-500">{m.direction === 'in' ? (sel.member?.name || 'Visitor') : (m.user?.name || 'Staff')} • {timeAgo(m.createdAt)}</span>
                    </div>
                    {m.subject && <div className="text-sm font-medium text-gray-800">{m.subject}</div>}
                    <div className="text-sm text-gray-800 whitespace-pre-wrap">{m.body}</div>
                    {m.status === 'failed' && <div className="text-xs text-red-400 mt-1">⚠ Bheja nahi ja saka</div>}
                  </div>
                ))}
                <div ref={threadEnd} />
              </div>

              <div className="p-4 border-t border-gray-200">
                <div className="flex gap-2 mb-2">
                  <select className="input-premium !w-auto text-sm" value={replyChannel} onChange={(e) => setReplyChannel(e.target.value)}>
                    <option value="internal">Internal</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="sms">SMS</option>
                    <option value="email">Email</option>
                  </select>
                  <select className="input-premium !w-auto text-sm" defaultValue="" onChange={(e) => { applyTemplate(e.target.value); e.target.value = ''; }}>
                    <option value="">📋 Template...</option>
                    {templates.filter((t) => t.channel === 'any' || t.channel === replyChannel).map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <input className="input-premium flex-1" placeholder="Reply likhein..."
                    value={reply} onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && doReply()} />
                  <button onClick={doReply} disabled={sending || !reply.trim()}
                    className="px-4 py-2 rounded-lg bg-[#0f766e] text-white text-sm disabled:opacity-50">
                    {sending ? '...' : scheduleAt ? '📅 Schedule' : 'Bhejein'}
                  </button>
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="text-xs text-slate-500">📅 Schedule send:</label>
                  <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)}
                    className="input-premium !w-auto text-xs" />
                  {scheduleAt && <button onClick={() => setScheduleAt('')} className="text-xs text-gray-500 hover:text-gray-800">✕</button>}
                </div>
                <div className="text-xs text-slate-500">WhatsApp/SMS ke liye credentials configure hona lazmi hai, warna message queue me rahega.</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
