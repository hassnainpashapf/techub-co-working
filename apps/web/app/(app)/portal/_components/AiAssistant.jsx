'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../lib/api';

// Phase 45 Track 2: floating AI chat assistant widget for the member portal.
// Wire into apps/web/app/(app)/portal/page.js: <AiAssistant />
// Backend: GET/POST /api/ai/chat (mount path — coordinator wires server.js).
export default function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: 'Assalam-o-Alaikum! Main aap ka Techub assistant hoon. Booking, bill, plan ya WiFi — kuch bhi poochein.',
    },
  ]);
  const [chips, setChips] = useState([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    api
      .get('/ai/chat/suggestions')
      .then((d) => setChips(d.suggestions || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing, open]);

  async function send(text) {
    const msg = (text ?? input).trim();
    if (!msg || typing) return;
    setError('');
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: msg }]);
    setTyping(true);
    try {
      const d = await api.post('/ai/chat', { message: msg });
      setMessages((m) => [...m, { role: 'assistant', text: d.reply || 'Kuch ghalat ho gaya — dobara try karein.' }]);
      if (d.suggestions?.length) setChips(d.suggestions);
    } catch (e) {
      setError(e?.message || 'Bhejne me masla hua.');
    } finally {
      setTyping(false);
    }
  }

  return (
    <>
      {/* Floating bubble */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="AI assistant"
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 shadow-lg shadow-blue-500/30 hover:shadow-blue-400/50 hover:scale-105 transition-all flex items-center justify-center text-2xl"
      >
        {open ? '✕' : '🤖'}
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-[340px] max-w-[calc(100vw-3rem)] h-[480px] max-h-[70vh] rounded-2xl overflow-hidden flex flex-col border border-white/10 bg-[#14141f]/95 backdrop-blur-xl shadow-2xl shadow-black/50">
          {/* Header */}
          <div className="px-4 py-3 bg-gradient-to-r from-blue-600/40 to-violet-600/40 border-b border-white/10">
            <div className="font-semibold text-white text-sm">Techub Assistant</div>
            <div className="text-xs text-slate-400">Booking • Bill • Plan • WiFi</div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm whitespace-pre-line leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-md'
                      : 'bg-white/10 text-slate-100 rounded-bl-md'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {typing && (
              <div className="flex justify-start">
                <div className="bg-white/10 px-4 py-2.5 rounded-2xl rounded-bl-md flex gap-1">
                  <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Suggestion chips */}
          {chips.length > 0 && !typing && (
            <div className="px-3 pb-2 flex gap-1.5 overflow-x-auto">
              {chips.slice(0, 3).map((c, i) => (
                <button
                  key={i}
                  onClick={() => send(c)}
                  className="shrink-0 text-xs px-2.5 py-1.5 rounded-full border border-blue-400/30 text-blue-700 hover:bg-blue-500/20 transition-colors"
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {error && <div className="px-3 pb-1 text-xs text-red-700">{error}</div>}

          {/* Input */}
          <div className="p-3 border-t border-white/10 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="Apna sawal likhein…"
              maxLength={500}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-blue-400/50"
            />
            <button
              onClick={() => send()}
              disabled={typing || !input.trim()}
              className="px-3.5 py-2 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 text-white text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              ➤
            </button>
          </div>
        </div>
      )}
    </>
  );
}
