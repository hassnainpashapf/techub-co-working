'use client';

// Phase 44: Event detail ticketing tabs (Tickets / Agenda / Sponsors / Analytics).
// Modal me khulta hai — har event card par "Tickets" button se.
import { useEffect, useState } from 'react';
import { api, apiDownloadUrl } from '../lib/api';
import { Badge, Spinner, EmptyState, Field, ErrorBanner } from './ui';

const TABS = ['Tickets', 'Agenda', 'Sponsors', 'Analytics'];

function fmt(d) { try { return d ? new Date(d).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; } catch { return d; } }

function Section({ title, hint, children, action }) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-bold text-gray-900">{title}</h4>
        {action}
      </div>
      {hint && <p className="text-xs text-gray-500 mb-2">{hint}</p>}
      {children}
    </div>
  );
}

// ---------------- Ticket types tab ----------------
function TicketsTab({ eventId }) {
  const [types, setTypes] = useState(null);
  const [err, setErr] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [f, setF] = useState({ name: '', price: '', quantity: '', saleStart: '', saleEnd: '', perOrderLimit: '' });
  const load = () => { setTypes(null); api.get(`/ticket-types?eventId=${eventId}`).then((d) => setTypes(d.ticketTypes || [])).catch((e) => setErr(e.message)); };
  useEffect(load, [eventId]);
  const save = async (e) => {
    e.preventDefault();
    try {
      await api.post('/ticket-types', {
        eventId, name: f.name, price: Number(f.price) || 0, quantity: Number(f.quantity) || 0,
        saleStart: f.saleStart ? new Date(f.saleStart).toISOString() : null,
        saleEnd: f.saleEnd ? new Date(f.saleEnd).toISOString() : null,
        perOrderLimit: f.perOrderLimit ? Number(f.perOrderLimit) : null,
      });
      setShowForm(false); setF({ name: '', price: '', quantity: '', saleStart: '', saleEnd: '', perOrderLimit: '' }); load();
    } catch (e2) { setErr(e2.message); }
  };
  const toggle = async (t) => { try { await api.patch(`/ticket-types/${t.id}/active`, { isActive: !t.isActive }); load(); } catch (e) { setErr(e.message); } };
  const remove = async (id) => { if (!confirm('Delete this ticket type?')) return; try { await api.delete(`/ticket-types/${id}`); load(); } catch (e) { setErr(e.message); } };
  return (
    <Section title="Ticket types" hint="Sale pricing and limits per event." action={<button className="btn-primary text-sm" onClick={() => setShowForm(!showForm)}>+ Type</button>}>
      {err && <ErrorBanner message={err} />}
      {showForm && (
        <form onSubmit={save} className="grid grid-cols-2 gap-3 mb-4 p-3 rounded-xl bg-gray-100">
          <Field label="Name *"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={80} placeholder="Early Bird" /></Field>
          <Field label="Price (Rs) *"><input type="number" min={0} step="0.01" className="input" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} required /></Field>
          <Field label="Quantity *"><input type="number" min={1} className="input" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} required /></Field>
          <Field label="Per-order limit"><input type="number" min={1} className="input" value={f.perOrderLimit} onChange={(e) => setF({ ...f, perOrderLimit: e.target.value })} placeholder="optional" /></Field>
          <Field label="Sale start"><input type="datetime-local" className="input" value={f.saleStart} onChange={(e) => setF({ ...f, saleStart: e.target.value })} /></Field>
          <Field label="Sale end"><input type="datetime-local" className="input" value={f.saleEnd} onChange={(e) => setF({ ...f, saleEnd: e.target.value })} /></Field>
          <div className="col-span-2"><button className="btn-primary w-full" type="submit">Save ticket type</button></div>
        </form>
      )}
      {!types ? <Spinner /> : types.length === 0 ? <EmptyState title="No ticket types" hint="Add one to start selling tickets." /> : (
        <div className="space-y-2">
          {types.map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-xl bg-gray-100 px-3 py-2">
              <div>
                <p className="text-sm font-semibold text-gray-900">{t.name} <Badge tone={t.isActive ? 'green' : 'slate'}>{t.isActive ? 'active' : 'paused'}</Badge></p>
                <p className="text-xs text-gray-500">Rs {t.price} · {t.soldCount}/{t.quantity} sold</p>
              </div>
              <div className="flex gap-2">
                <button className="btn-secondary text-xs" onClick={() => toggle(t)}>{t.isActive ? 'Pause' : 'Activate'}</button>
                <button className="text-xs text-red-300 hover:text-red-200" onClick={() => remove(t.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ---------------- Agenda tab ----------------
function AgendaTab({ eventId }) {
  const [speakers, setSpeakers] = useState(null);
  const [sessions, setSessions] = useState(null);
  const [err, setErr] = useState('');
  const [spF, setSpF] = useState({ name: '', title: '', company: '' });
  const [ssF, setSsF] = useState({ title: '', speakerId: '', startTime: '', endTime: '', location: '' });
  const [showSp, setShowSp] = useState(false);
  const [showSs, setShowSs] = useState(false);
  const load = () => {
    api.get(`/event-agenda/speakers?eventId=${eventId}`).then((d) => setSpeakers(d.speakers || [])).catch((e) => setErr(e.message));
    api.get(`/event-agenda/sessions?eventId=${eventId}`).then((d) => setSessions(d.sessions || [])).catch((e) => setErr(e.message));
  };
  useEffect(load, [eventId]);
  const saveSpeaker = async (e) => { e.preventDefault(); try { await api.post('/event-agenda/speakers', { eventId, ...spF }); setShowSp(false); setSpF({ name: '', title: '', company: '' }); load(); } catch (e2) { setErr(e2.message); } };
  const saveSession = async (e) => { e.preventDefault(); try { await api.post('/event-agenda/sessions', { eventId, title: ssF.title, speakerId: ssF.speakerId || null, startTime: new Date(ssF.startTime).toISOString(), endTime: new Date(ssF.endTime).toISOString(), location: ssF.location || null }); setShowSs(false); setSsF({ title: '', speakerId: '', startTime: '', endTime: '', location: '' }); load(); } catch (e2) { setErr(e2.message); } };
  const del = async (url) => { if (!confirm('Delete?')) return; try { await api.delete(url); load(); } catch (e) { setErr(e.message); } };
  return (
    <>
      {err && <ErrorBanner message={err} />}
      <Section title="Speakers" action={<button className="btn-primary text-sm" onClick={() => setShowSp(!showSp)}>+ Speaker</button>}>
        {showSp && (
          <form onSubmit={saveSpeaker} className="grid grid-cols-3 gap-2 mb-3 p-3 rounded-xl bg-gray-100">
            <Field label="Name *"><input className="input" value={spF.name} onChange={(e) => setSpF({ ...spF, name: e.target.value })} required /></Field>
            <Field label="Title"><input className="input" value={spF.title} onChange={(e) => setSpF({ ...spF, title: e.target.value })} /></Field>
            <Field label="Company"><input className="input" value={spF.company} onChange={(e) => setSpF({ ...spF, company: e.target.value })} /></Field>
            <div className="col-span-3"><button className="btn-primary w-full" type="submit">Save speaker</button></div>
          </form>
        )}
        {!speakers ? <Spinner /> : speakers.length === 0 ? <EmptyState title="No speakers" /> : (
          <div className="space-y-2">
            {speakers.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-xl bg-gray-100 px-3 py-2">
                <div><p className="text-sm font-semibold text-gray-900">{s.name}</p><p className="text-xs text-gray-500">{[s.title, s.company].filter(Boolean).join(' @ ')}</p></div>
                <button className="text-xs text-red-300 hover:text-red-200" onClick={() => del(`/event-agenda/speakers/${s.id}`)}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section title="Sessions" action={<button className="btn-primary text-sm" onClick={() => setShowSs(!showSs)}>+ Session</button>}>
        {showSs && (
          <form onSubmit={saveSession} className="grid grid-cols-2 gap-2 mb-3 p-3 rounded-xl bg-gray-100">
            <div className="col-span-2"><Field label="Title *"><input className="input" value={ssF.title} onChange={(e) => setSsF({ ...ssF, title: e.target.value })} required /></Field></div>
            <Field label="Speaker"><select className="input" value={ssF.speakerId} onChange={(e) => setSsF({ ...ssF, speakerId: e.target.value })}><option value="">—</option>{(speakers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Location"><input className="input" value={ssF.location} onChange={(e) => setSsF({ ...ssF, location: e.target.value })} /></Field>
            <Field label="Start *"><input type="datetime-local" className="input" value={ssF.startTime} onChange={(e) => setSsF({ ...ssF, startTime: e.target.value })} required /></Field>
            <Field label="End *"><input type="datetime-local" className="input" value={ssF.endTime} onChange={(e) => setSsF({ ...ssF, endTime: e.target.value })} required /></Field>
            <div className="col-span-2"><button className="btn-primary w-full" type="submit">Save session</button></div>
          </form>
        )}
        {!sessions ? <Spinner /> : sessions.length === 0 ? <EmptyState title="No sessions" /> : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-xl bg-gray-100 px-3 py-2">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{s.title}</p>
                  <p className="text-xs text-gray-500">{fmt(s.startTime)} → {fmt(s.endTime)}{s.speaker ? ` · 🎤 ${s.speaker.name}` : ''}{s.location ? ` · 📍 ${s.location}` : ''}</p>
                </div>
                <button className="text-xs text-red-300 hover:text-red-200" onClick={() => del(`/event-agenda/sessions/${s.id}`)}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

// ---------------- Sponsors tab ----------------
function SponsorsTab({ eventId }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ name: '', tier: 'silver', website: '', amount: '' });
  const [show, setShow] = useState(false);
  const load = () => { setRows(null); api.get(`/sponsors?eventId=${eventId}`).then((d) => setRows(d.sponsors || [])).catch((e) => setErr(e.message)); };
  useEffect(load, [eventId]);
  const save = async (e) => { e.preventDefault(); try { await api.post('/sponsors', { eventId, name: f.name, tier: f.tier, website: f.website || null, amount: f.amount ? Number(f.amount) : null }); setShow(false); setF({ name: '', tier: 'silver', website: '', amount: '' }); load(); } catch (e2) { setErr(e2.message); } };
  const toggle = async (s) => { try { await api.patch(`/sponsors/${s.id}/toggle`, {}); load(); } catch (e) { setErr(e.message); } };
  const del = async (id) => { if (!confirm('Delete sponsor?')) return; try { await api.delete(`/sponsors/${id}`); load(); } catch (e) { setErr(e.message); } };
  return (
    <Section title="Sponsors" hint="Platinum / gold / silver tiers." action={<button className="btn-primary text-sm" onClick={() => setShow(!show)}>+ Sponsor</button>}>
      {err && <ErrorBanner message={err} />}
      {show && (
        <form onSubmit={save} className="grid grid-cols-2 gap-2 mb-3 p-3 rounded-xl bg-gray-100">
          <Field label="Name *"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
          <Field label="Tier"><select className="input" value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value })}><option value="platinum">Platinum</option><option value="gold">Gold</option><option value="silver">Silver</option></select></Field>
          <Field label="Website"><input className="input" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://…" /></Field>
          <Field label="Amount (Rs)"><input type="number" min={0} className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <div className="col-span-2"><button className="btn-primary w-full" type="submit">Save sponsor</button></div>
        </form>
      )}
      {!rows ? <Spinner /> : rows.length === 0 ? <EmptyState title="No sponsors" /> : (
        <div className="space-y-2">
          {rows.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-xl bg-gray-100 px-3 py-2">
              <div><p className="text-sm font-semibold text-gray-900">{s.name} <Badge tone={s.tier === 'platinum' ? 'amber' : s.tier === 'gold' ? 'blue' : 'slate'}>{s.tier}</Badge></p><p className="text-xs text-gray-500">{s.amount ? `Rs ${s.amount} · ` : ''}{s.isActive ? 'active' : 'inactive'}</p></div>
              <div className="flex gap-2">
                <button className="btn-secondary text-xs" onClick={() => toggle(s)}>{s.isActive ? 'Hide' : 'Show'}</button>
                <button className="text-xs text-red-300 hover:text-red-200" onClick={() => del(s.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ---------------- Analytics tab ----------------
function AnalyticsTab({ eventId }) {
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api.get(`/event-analytics/${eventId}`).then(setStats).catch((e) => setErr(e.message));
  }, [eventId]);
  const exportCsv = () => { window.open(apiDownloadUrl(`/event-analytics/${eventId}/attendees.csv`), '_blank'); };
  if (err) return <ErrorBanner message={err} />;
  if (!stats) return <Spinner />;
  return (
    <Section title="Analytics" action={<button className="btn-secondary text-sm" onClick={exportCsv}>⬇ attendees.csv</button>}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[['🎟️ Sold', stats.ticketsSold ?? 0], ['💰 Revenue', `Rs ${stats.revenue ?? 0}`], ['✅ Scanned in', stats.scannedIn ?? 0], ['↩️ Refunded', stats.refunded ?? 0]].map(([l, v]) => (
          <div key={l} className="rounded-xl bg-gray-100 p-3"><p className="text-xs text-gray-500">{l}</p><p className="text-lg font-bold text-gray-900">{v}</p></div>
        ))}
      </div>
      {stats.byType && stats.byType.length > 0 && (
        <div className="mt-4">
          <h4 className="font-bold text-gray-900 mb-2 text-sm">Sales by ticket type</h4>
          {stats.byType.map((b) => (
            <div key={b.name} className="flex items-center justify-between rounded-xl bg-gray-100 px-3 py-2 mb-1">
              <span className="text-sm text-gray-900">{b.name}</span>
              <span className="text-xs text-gray-500">{b.sold} sold · Rs {b.revenue}</span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

export default function EventTicketingTabs({ eventId }) {
  const [tab, setTab] = useState('Tickets');
  return (
    <div>
      <div className="flex gap-2 mb-4 border-b border-gray-200 pb-2">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`text-sm px-3 py-1.5 rounded-full ${tab === t ? 'bg-teal-700 text-white font-semibold' : 'text-gray-500 hover:text-gray-900'}`}>{t}</button>
        ))}
      </div>
      {tab === 'Tickets' && <TicketsTab eventId={eventId} />}
      {tab === 'Agenda' && <AgendaTab eventId={eventId} />}
      {tab === 'Sponsors' && <SponsorsTab eventId={eventId} />}
      {tab === 'Analytics' && <AnalyticsTab eventId={eventId} />}
    </div>
  );
}
