'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, EmptyState, StatCard } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function mondayStr(offsetWeeks = 0) {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff + offsetWeeks * 7);
  return d.toISOString().slice(0, 10);
}

function fmtDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return { dow: DOW[d.getUTCDay()], num: d.getUTCDate(), month: d.toLocaleString('en', { month: 'short' }), today: dateStr === new Date().toISOString().slice(0, 10) };
}

function ShiftForm({ staff, initial, onSave, saving }) {
  const [f, setF] = useState({
    userId: initial?.userId || (staff[0]?.id || ''),
    date: initial?.date || '',
    startTime: initial?.startTime || '09:00',
    endTime: initial?.endTime || '17:00',
    role: initial?.role || '',
    notes: initial?.notes || '',
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ ...f, role: f.role || null, notes: f.notes || null }); }}>
      <Field label="Staff *">
        <select className="input" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })} required>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
        </select>
      </Field>
      <Field label="Date *"><input type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start *"><input type="time" className="input" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} required /></Field>
        <Field label="End *"><input type="time" className="input" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} required /></Field>
      </div>
      <Field label="Role label"><input className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="e.g. reception, cleaning" /></Field>
      <Field label="Notes"><textarea className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Assign shift'}</button>
    </form>
  );
}

function TemplateForm({ staff, onSave, saving }) {
  const [f, setF] = useState({ userId: staff[0]?.id || '', dayOfWeek: 1, startTime: '09:00', endTime: '17:00', role: '' });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ ...f, role: f.role || null }); }}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Staff *">
          <select className="input" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })} required>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Day of week *">
          <select className="input" value={f.dayOfWeek} onChange={(e) => setF({ ...f, dayOfWeek: Number(e.target.value) })}>
            {DOW_LONG.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start *"><input type="time" className="input" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} required /></Field>
        <Field label="End *"><input type="time" className="input" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} required /></Field>
      </div>
      <Field label="Role label"><input className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="e.g. reception" /></Field>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Save template'}</button>
    </form>
  );
}

export default function ShiftsPage() {
  const { allowed, loading: roleLoading } = useRequireRoles('ceo', 'admin', 'super_admin', 'manager');
  const [tab, setTab] = useState('week');
  const [weekOffset, setWeekOffset] = useState(0);
  const [data, setData] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formInit, setFormInit] = useState(null);
  const [showTpl, setShowTpl] = useState(false);
  const [saving, setSaving] = useState(false);
  const [genMsg, setGenMsg] = useState('');

  const load = (offset = weekOffset) => {
    setLoading(true); setError('');
    const week = mondayStr(offset);
    Promise.all([api.get(`/shifts?week=${week}`), api.get('/shifts/templates')])
      .then(([w, t]) => { setData(w); setTemplates(t.templates || []); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (allowed) load(0); }, [allowed]);

  const changeWeek = (off) => { setWeekOffset(off); load(off); };

  const save = async (payload) => {
    setSaving(true);
    try {
      await api.post('/shifts', payload);
      setShowForm(false); setFormInit(null); load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!confirm('Delete this shift?')) return;
    try { await api.delete(`/shifts/${id}`); load(); } catch (e) { setError(e.message); }
  };

  const generate = async () => {
    if (!confirm('Auto-generate this week\'s shifts from templates? Existing shifts are kept.')) return;
    try {
      const d = await api.post('/shifts/generate', { weekStart: data.weekStart });
      setGenMsg(`Generated ${d.created} shift(s), skipped ${d.skipped} (already assigned).`);
      load();
    } catch (e) { setError(e.message); }
  };

  const saveTpl = async (payload) => {
    setSaving(true);
    try { await api.post('/shifts/templates', payload); setShowTpl(false); load(); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const removeTpl = async (id) => {
    if (!confirm('Delete this template?')) return;
    try { await api.delete(`/shifts/templates/${id}`); load(); } catch (e) { setError(e.message); }
  };

  if (roleLoading) return <Spinner />;
  if (!allowed) return <AccessDenied />;

  const shifts = data?.shifts || [];
  const staff = data?.staff || [];
  const days = data?.days || [];
  const shiftsByCell = {};
  for (const s of shifts) {
    const d = new Date(s.date).toISOString().slice(0, 10);
    shiftsByCell[`${s.userId}|${d}`] = s;
  }
  const totalHours = shifts.reduce((sum, s) => {
    const [h1, m1] = s.startTime.split(':').map(Number);
    const [h2, m2] = s.endTime.split(':').map(Number);
    return sum + Math.max(0, (h2 * 60 + m2 - h1 * 60 - m1) / 60);
  }, 0);

  return (
    <div>
      <PageHeader title="Staff Shifts" sub="Weekly shift scheduling for your team" actions={
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setTab(tab === 'week' ? 'templates' : 'week')}>
            {tab === 'week' ? '📋 Templates' : '📅 Weekly view'}
          </button>
          {tab === 'week' && <>
            <button className="btn-secondary" onClick={generate}>⚡ Generate from templates</button>
            <button className="btn-primary" onClick={() => { setFormInit(null); setShowForm(true); }}>+ Assign shift</button>
          </>}
          {tab === 'templates' && <button className="btn-primary" onClick={() => setShowTpl(true)}>+ New template</button>}
        </div>
      } />
      {error && <ErrorBanner message={error} onRetry={() => { setError(''); load(); }} />}
      {genMsg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 mb-4">{genMsg}</div>}

      {tab === 'week' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
            <StatCard label="Shifts this week" value={shifts.length} accent="blue" icon="🗓️" />
            <StatCard label="Staff scheduled" value={new Set(shifts.map((s) => s.userId)).size} accent="purple" icon="👥" />
            <StatCard label="Total hours" value={Math.round(totalHours)} accent="green" icon="⏱️" />
          </div>
          <div className="flex items-center gap-3 mb-4">
            <button className="btn-secondary" onClick={() => changeWeek(weekOffset - 1)}>← Prev</button>
            <button className="btn-secondary" onClick={() => changeWeek(0)}>Today</button>
            <button className="btn-secondary" onClick={() => changeWeek(weekOffset + 1)}>Next →</button>
            <span className="text-sm text-gray-600 font-semibold">Week of {days[0] || '—'}</span>
          </div>
          {loading ? <Spinner /> : staff.length === 0 ? (
            <EmptyState title="No active staff found" hint="Add staff users first, then assign shifts." />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-gray-200">
              <table className="w-full text-sm min-w-[800px]">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="text-left p-3 text-gray-600 font-semibold sticky left-0 bg-white">Staff</th>
                    {days.map((d) => {
                      const f = fmtDay(d);
                      return (
                        <th key={d} className={`p-3 text-center font-semibold ${f.today ? 'text-teal-700' : 'text-gray-600'}`}>
                          {f.dow}<br /><span className="text-lg">{f.num}</span> <span className="text-xs font-normal">{f.month}</span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {staff.map((s) => (
                    <tr key={s.id} className="border-t border-gray-200 hover:bg-gray-50">
                      <td className="p-3 sticky left-0 bg-white">
                        <div className="font-semibold text-gray-900">{s.name}</div>
                        <div className="text-xs text-gray-500">{s.role}</div>
                      </td>
                      {days.map((d) => {
                        const sh = shiftsByCell[`${s.id}|${d}`];
                        return (
                          <td key={d} className="p-2 text-center align-top min-w-[110px]">
                            {sh ? (
                              <div className="rounded-xl bg-[#0f766e]/10 border border-[#0f766e]/30 p-2 text-left group relative">
                                <div className="font-bold text-teal-700 text-xs">{sh.startTime}–{sh.endTime}</div>
                                {sh.role && <Badge tone="blue">{sh.role}</Badge>}
                                {sh.notes && <div className="text-[11px] text-gray-500 mt-1 truncate" title={sh.notes}>{sh.notes}</div>}
                                <button className="absolute top-1 right-1 text-red-700 opacity-0 group-hover:opacity-100 text-xs" onClick={() => remove(sh.id)} title="Delete">✕</button>
                              </div>
                            ) : (
                              <button
                                className="w-full rounded-xl border border-dashed border-gray-200 p-3 text-slate-500 hover:border-[#0f766e]/40 hover:text-teal-700 text-xs"
                                onClick={() => { setFormInit({ userId: s.id, date: d }); setShowForm(true); }}
                              >+ Add</button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'templates' && (
        loading ? <Spinner /> : templates.length === 0 ? (
          <EmptyState title="No templates yet" hint="Create weekly templates to auto-generate shifts every week." />
        ) : (
          <div className="rounded-2xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-100 text-left">
                <th className="p-3 text-gray-600">Staff</th><th className="p-3 text-gray-600">Day</th>
                <th className="p-3 text-gray-600">Time</th><th className="p-3 text-gray-600">Role</th><th className="p-3" />
              </tr></thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-t border-gray-200">
                    <td className="p-3 text-gray-900 font-semibold">{t.user?.name}</td>
                    <td className="p-3 text-gray-600">{DOW_LONG[t.dayOfWeek]}</td>
                    <td className="p-3 text-gray-600">{t.startTime}–{t.endTime}</td>
                    <td className="p-3">{t.role ? <Badge tone="blue">{t.role}</Badge> : <span className="text-slate-500">—</span>}</td>
                    <td className="p-3 text-right"><button className="text-red-700 text-xs" onClick={() => removeTpl(t.id)}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {showForm && (
        <Modal title="Assign shift" onClose={() => { setShowForm(false); setFormInit(null); }}>
          <ShiftForm staff={staff} initial={formInit} onSave={save} saving={saving} />
        </Modal>
      )}
      {showTpl && (
        <Modal title="New shift template" onClose={() => setShowTpl(false)}>
          <TemplateForm staff={staff} onSave={saveTpl} saving={saving} />
        </Modal>
      )}
    </div>
  );
}
