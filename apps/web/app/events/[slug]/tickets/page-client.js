'use client';

// Phase 44 Track 3: Public ticket checkout — "/events/[slug]/tickets".
// No login. Steps: ticket select → buyer form → confirm → QR display.
// Event detail Track 1 ke endpoint se: GET /api/events/public/:slug?tenantSlug=abc
// (ticketTypes Track 2 extend karega; na mile to graceful empty).
// Purchase: POST /api/event-tickets/purchase (mount path NOTE: "/api/event-tickets",
// "/api/tickets" support-tickets ka hai).
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL || '';

export default function EventTicketsPage() {
  const { slug } = useParams();
  const search = useSearchParams();
  const tenantSlug = search.get('tenant') || '';

  const [step, setStep] = useState(1); // 1 tickets | 2 buyer | 3 done
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState({}); // ticketTypeId -> qty
  const [form, setForm] = useState({ name: '', email: '', phone: '', website: '' });
  const [state, setState] = useState('idle'); // idle | sending | error
  const [error, setError] = useState('');
  const [tickets, setTickets] = useState([]);

  useEffect(() => {
    if (!slug || !tenantSlug) { setLoading(false); return; }
    (async () => {
      try {
        const r = await fetch(`${API}/api/events/public/${encodeURIComponent(slug)}?tenantSlug=${encodeURIComponent(tenantSlug)}`);
        const d = await r.json();
        if (r.ok && d.event) setEvent(d.event);
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, [slug, tenantSlug]);

  const types = (event?.ticketTypes || []).filter((t) => t.isActive !== false);
  const totalQty = Object.values(sel).reduce((a, b) => a + b, 0);
  const totalPrice = types.reduce((a, t) => a + (Number(t.price) || 0) * (sel[t.id] || 0), 0);

  const chQty = (id, d) => setSel((s) => {
    const cur = s[id] || 0;
    const t = types.find((x) => x.id === id);
    const max = Math.min(t?.perOrderLimit || 10, (t?.quantity ?? 0) - (t?.soldCount ?? 0));
    const next = Math.max(0, Math.min(max, cur + d));
    return { ...s, [id]: next };
  });

  async function purchase() {
    setState('sending'); setError('');
    try {
      const items = Object.entries(sel).filter(([, q]) => q > 0);
      if (!items.length) throw new Error('Please select at least one ticket.');
      if (!form.name.trim()) throw new Error('Please enter your name.');
      if (!form.email.trim()) throw new Error('Please enter your email.');
      const results = [];
      for (const [ticketTypeId, qty] of items) {
        const r = await fetch(`${API}/api/event-tickets/purchase`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantSlug, eventId: event.id, ticketTypeId, qty,
            buyerName: form.name.trim(), buyerEmail: form.email.trim(),
            buyerPhone: form.phone.trim() || null, website: form.website,
          }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Purchase failed');
        results.push(...(d.tickets || []));
      }
      setTickets(results);
      setStep(3);
    } catch (e) {
      setError(e.message || 'Purchase failed');
    } finally {
      setState('idle');
    }
  }

  if (loading) return <Page><p style={muted}>Loading…</p></Page>;
  if (!tenantSlug) return <Page><p style={muted}>Please open this page from the event page link.</p></Page>;
  if (!event) return <Page><p style={muted}>Event not found.</p></Page>;

  return (
    <Page>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 4px' }}>{event.title}</h1>
      <p style={{ ...muted, marginBottom: 24 }}>
        {event.startsAt ? new Date(event.startsAt).toLocaleString() : ''}{event.location ? ` · ${event.location}` : ''}
      </p>

      {step === 1 && (
        <>
          {types.length === 0 && <p style={muted}>Tickets are not on sale yet for this event.</p>}
          {types.map((t) => {
            const remaining = Math.max(0, (t.quantity ?? 0) - (t.soldCount ?? 0));
            const soldOut = remaining <= 0;
            return (
              <div key={t.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{t.name}</div>
                    <div style={muted}>Rs {Number(t.price || 0).toLocaleString()} · {soldOut ? 'Sold out' : `${remaining} left`}</div>
                  </div>
                  {!soldOut && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <button style={btn} onClick={() => chQty(t.id, -1)}>−</button>
                      <span style={{ minWidth: 24, textAlign: 'center', fontWeight: 700 }}>{sel[t.id] || 0}</span>
                      <button style={btn} onClick={() => chQty(t.id, 1)}>+</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {totalQty > 0 && (
            <button style={primary} onClick={() => setStep(2)}>
              Continue — {totalQty} ticket{totalQty > 1 ? 's' : ''} · Rs {totalPrice.toLocaleString()}
            </button>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <button style={back} onClick={() => setStep(1)}>← Back to tickets</button>
          <div style={card}>
            <div style={field}><label style={lbl}>Full name *</label>
              <input style={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div style={field}><label style={lbl}>Email *</label>
              <input style={inp} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div style={field}><label style={lbl}>Phone</label>
              <input style={inp} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <input type="text" name="website" style={{ display: 'none' }} tabIndex={-1} autoComplete="off"
              value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
          </div>
          {error && <p style={{ color: '#f87171' }}>{error}</p>}
          <button style={primary} disabled={state === 'sending'} onClick={purchase}>
            {state === 'sending' ? 'Processing…' : `Confirm — Rs ${totalPrice.toLocaleString()}`}
          </button>
        </>
      )}

      {step === 3 && (
        <>
          <div style={{ ...card, borderColor: '#34d399', textAlign: 'center' }}>
            <div style={{ fontSize: 40 }}>🎟️</div>
            <h2 style={{ margin: '8px 0' }}>You're in!</h2>
            <p style={muted}>Tickets sent to {form.email}. Show the QR at entry.</p>
          </div>
          {tickets.map((t) => (
            <div key={t.id} style={{ ...card, textAlign: 'center' }}>
              <div style={{ fontWeight: 700 }}>{t.ticketType}</div>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(t.code)}`}
                width={200} height={200} alt="Ticket QR" style={{ margin: '12px 0', borderRadius: 8 }} />
              <div style={{ ...muted, fontSize: 12, wordBreak: 'break-all' }}>{t.code.slice(0, 24)}…</div>
            </div>
          ))}
        </>
      )}
    </Page>
  );
}

function Page({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: '#0f0f1a', color: '#e5e7eb', padding: '32px 16px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>{children}</div>
    </div>
  );
}

const card = { background: '#171724', border: '1px solid #2a2a3d', borderRadius: 12, padding: 16, marginBottom: 12 };
const muted = { color: '#9ca3af', fontSize: 14 };
const btn = { width: 34, height: 34, borderRadius: 8, border: '1px solid #3b3b52', background: '#1e1e2e', color: '#fff', fontSize: 18, cursor: 'pointer' };
const primary = { width: '100%', padding: '14px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#0f766e,#4f46e5)', color: '#fff', fontWeight: 700, fontSize: 16, cursor: 'pointer', marginTop: 8 };
const back = { background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', marginBottom: 12 };
const field = { marginBottom: 12 };
const lbl = { display: 'block', fontSize: 13, color: '#9ca3af', marginBottom: 6 };
const inp = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #3b3b52', background: '#101018', color: '#fff', boxSizing: 'border-box' };

