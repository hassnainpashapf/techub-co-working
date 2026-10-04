'use client';

// Phase 54 Track 1/10: Member Success — Onboarding Journeys UI.
// Staff: journeys list + assign + task tracking; templates builder.
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, EmptyState, StatCard, Badge, Modal, Field } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

function Bar({ pct }) {
  return (
    <div className="h-2 rounded-full bg-gray-100 overflow-hidden min-w-[80px]">
      <div className="h-full rounded-full bg-gradient-to-r from-[#0f766e] to-teal-600 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

function statusTone(s) {
  return s === 'completed' ? 'green' : s === 'stalled' ? 'red' : 'blue';
}

export default function OnboardingJourneysPage() {
  const allowed = useRequireRoles('ceo', 'admin', 'super_admin', 'manager', 'reception');
  const [tab, setTab] = useState('journeys');
  const [journeys, setJourneys] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [members, setMembers] = useState([]);
  const [statusF, setStatusF] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null); // journey id for detail
  const [detail, setDetail] = useState(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [tmplOpen, setTmplOpen] = useState(null); // null | 'new' | template

  const load = async () => {
    try {
      setLoading(true);
      setErr('');
      const [j, t, m] = await Promise.all([
        api.get('/api/member-journeys/journeys' + (statusF ? `?status=${statusF}` : '')),
        api.get('/api/member-journeys/templates'),
        api.get('/api/members?status=active'),
      ]);
      setJourneys(j.journeys || []);
      setTemplates(t.templates || []);
      setMembers(m.members || []);
    } catch (e) {
      setErr(e.message || 'Load nahi ho saka');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (allowed) load(); }, [allowed, statusF]); // eslint-disable-line

  const loadDetail = async (id) => {
    try {
      const r = await api.get(`/api/member-journeys/journeys/${id}`);
      setDetail(r.journey || null);
      setOpen(id);
    } catch (e) {
      setErr(e.message);
    }
  };

  const toggleTask = async (stageIndex, taskIndex, done) => {
    try {
      const r = await api.post(`/api/member-journeys/journeys/${open}/tasks`, { stageIndex, taskIndex, done });
      setDetail((d) => ({ ...d, ...r.journey, stages: d.stages, progress: r.journey?.progress }));
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const setStatus = async (id, status) => {
    try {
      await api.patch(`/api/member-journeys/journeys/${id}`, { status });
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const assign = async (memberId, templateId) => {
    try {
      await api.post('/api/member-journeys/journeys', { memberId, templateId: templateId || undefined });
      setAssignOpen(false);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const autoStart = async () => {
    try {
      const r = await api.post('/api/member-journeys/journeys/auto-start');
      alert(`${r.started || 0} journeys start ho gayin`);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  if (!allowed) return <AccessDenied />;
  if (loading && !journeys.length) return <Spinner />;

  const counts = { active: 0, completed: 0, stalled: 0 };
  journeys.forEach((j) => { if (counts[j.status] !== undefined) counts[j.status]++; });

  return (
    <div className="space-y-3">
      <PageHeader
        title="Onboarding Journeys"
        sub="Naye members ke onboarding checklists — stages, tasks aur progress"
        actions={
          <div className="flex gap-2">
            <button onClick={autoStart} className="px-4 py-2 rounded-xl bg-gray-100 text-gray-900 text-sm hover:bg-white/20">⚡ Auto-start</button>
            <button onClick={() => setAssignOpen(true)} className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#0f766e] to-teal-700 text-gray-900 text-sm font-semibold hover:shadow-[0_0_20px_rgba(15,118,110,0.5)]">+ Journey Assign</button>
          </div>
        }
      />
      {err && <ErrorBanner message={err} />}

      <div className="flex gap-2">
        {['journeys', 'templates'].map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-xl text-sm font-medium ${tab === t ? 'bg-gradient-to-r from-[#0f766e] to-teal-700 text-gray-900' : 'bg-gray-100 text-gray-600 hover:bg-gray-100'}`}>
            {t === 'journeys' ? '🚀 Journeys' : '📋 Templates'}
          </button>
        ))}
      </div>

      {tab === 'journeys' && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Active" value={counts.active} icon="🚀" accent="blue" />
            <StatCard label="Completed" value={counts.completed} icon="✅" accent="green" />
            <StatCard label="Stalled" value={counts.stalled} icon="⏸️" accent="red" />
          </div>

          <div className="flex gap-2">
            {['', 'active', 'completed', 'stalled'].map((s) => (
              <button key={s} onClick={() => setStatusF(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${statusF === s ? 'bg-[#0f766e] text-white' : 'bg-gray-100 text-gray-600'}`}>
                {s || 'Sab'}
              </button>
            ))}
          </div>

          {!journeys.length ? <EmptyState title="Koi journey nahi" hint="Pehle template banayein, phir member ko assign karein" /> : (
            <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className="px-4 py-3">Member</th>
                    <th className="px-4 py-3">Template</th>
                    <th className="px-4 py-3">Progress</th>
                    <th className="px-4 py-3">Stage</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {journeys.map((j) => (
                    <tr key={j.id} className="border-b border-gray-200 hover:bg-gray-100">
                      <td className="px-4 py-3 text-gray-900 font-medium">{j.member?.name || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{j.templateName || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Bar pct={j.progress?.pct || 0} />
                          <span className="text-gray-600 text-xs">{j.progress?.pct || 0}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{(j.currentStage ?? 0) + 1}</td>
                      <td className="px-4 py-3"><Badge tone={statusTone(j.status)}>{j.status}</Badge></td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button onClick={() => (open === j.id ? setOpen(null) : loadDetail(j.id))} className="text-teal-700 hover:underline text-xs">Tasks</button>
                          {j.status !== 'completed' && <button onClick={() => setStatus(j.id, 'completed')} className="text-green-400 hover:underline text-xs">Complete</button>}
                          {j.status === 'active' && <button onClick={() => setStatus(j.id, 'stalled')} className="text-red-400 hover:underline text-xs">Stall</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {open && detail && (
            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <div className="flex justify-between items-center mb-3">
                <div className="text-gray-900 font-semibold">📋 {detail.member?.name} — {detail.templateName}</div>
                <button onClick={() => setOpen(null)} className="text-gray-500 hover:text-gray-900">✕</button>
              </div>
              {(detail.stages || []).map((st, si) => (
                <div key={si} className="mb-3 rounded-xl bg-gray-100 p-4">
                  <div className="text-gray-900 font-medium mb-2">Stage {si + 1}: {st.title} <span className="text-xs text-gray-500">(day {st.dayOffset})</span></div>
                  {(st.tasks || []).map((t, ti) => {
                    const done = !!(detail.stageTasks?.[si]?.[ti]);
                    return (
                      <label key={ti} className="flex items-center gap-3 py-1.5 cursor-pointer">
                        <input type="checkbox" checked={done} onChange={(e) => toggleTask(si, ti, e.target.checked)}
                          className="w-4 h-4 rounded accent-blue-600" />
                        <span className={`text-sm ${done ? 'text-slate-500 line-through' : 'text-gray-800'}`}>{t}</span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'templates' && (
        <>
          <div className="flex justify-end">
            <button onClick={() => setTmplOpen('new')} className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#0f766e] to-teal-700 text-gray-900 text-sm font-semibold">+ Naya Template</button>
          </div>
          {!templates.length ? <EmptyState title="Koi template nahi" hint="Naya template banayein — stages + tasks define karein" /> : (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
              {templates.map((t) => (
                <div key={t.id} className="rounded-2xl border border-gray-200 bg-white p-5">
                  <div className="flex items-start justify-between">
                    <div className="text-gray-900 font-semibold">{t.name}</div>
                    {t.isDefault && <Badge tone="green">Default</Badge>}
                  </div>
                  <div className="mt-2 text-sm text-gray-600">{t.stages?.length || 0} stages · {t._count?.journeys || 0} journeys</div>
                  <div className="mt-1 text-xs text-gray-500 line-clamp-2">{(t.stages || []).map((s) => s.title).join(' → ')}</div>
                  <div className="mt-3 flex gap-3">
                    <button onClick={() => setTmplOpen(t)} className="text-teal-700 hover:underline text-xs">Edit</button>
                    <button onClick={async () => { if (confirm('Delete karein?')) { await api.del(`/api/member-journeys/templates/${t.id}`); load(); } }} className="text-red-400 hover:underline text-xs">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {assignOpen && <AssignModal members={members} templates={templates} onClose={() => setAssignOpen(false)} onSave={assign} />}
      {tmplOpen && <TemplateModal tmpl={tmplOpen === 'new' ? null : tmplOpen} onClose={() => { setTmplOpen(null); load(); }} />}
    </div>
  );
}

function AssignModal({ members, templates, onClose, onSave }) {
  const [memberId, setMemberId] = useState('');
  const [templateId, setTemplateId] = useState('');
  return (
    <Modal title="Journey Assign Karein" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Member">
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className="w-full rounded-xl bg-gray-100 border border-gray-200 px-3 py-2 text-gray-900">
            <option value="">— Select —</option>
            {members.map((m) => <option key={m.id} value={m.id} className="bg-white">{m.name}</option>)}
          </select>
        </Field>
        <Field label="Template (khali = default)">
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="w-full rounded-xl bg-gray-100 border border-gray-200 px-3 py-2 text-gray-900">
            <option value="">— Default —</option>
            {templates.map((t) => <option key={t.id} value={t.id} className="bg-white">{t.name}</option>)}
          </select>
        </Field>
        <button disabled={!memberId} onClick={() => onSave(memberId, templateId)}
          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#0f766e] to-teal-700 text-gray-900 font-semibold disabled:opacity-40">Start Journey</button>
      </div>
    </Modal>
  );
}

function TemplateModal({ tmpl, onClose }) {
  const [name, setName] = useState(tmpl?.name || '');
  const [isDefault, setIsDefault] = useState(!!tmpl?.isDefault);
  const [stages, setStages] = useState(
    tmpl?.stages?.map((s) => ({ title: s.title, dayOffset: s.dayOffset || 0, tasks: (s.tasks || []).join('\n') })) || [{ title: 'Welcome', dayOffset: 0, tasks: 'Office tour\nWiFi setup' }]
  );

  const save = async () => {
    const payload = {
      name,
      isDefault,
      stages: stages.map((s) => ({
        title: s.title, dayOffset: Number(s.dayOffset) || 0,
        tasks: s.tasks.split('\n').map((x) => x.trim()).filter(Boolean),
      })),
    };
    if (!payload.name || !payload.stages.length) return alert('Name aur kam az kam 1 stage lazmi hai');
    try {
      if (tmpl) await api.put(`/api/member-journeys/templates/${tmpl.id}`, payload);
      else await api.post('/api/member-journeys/templates', payload);
      onClose();
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <Modal title={tmpl ? 'Template Edit' : 'Naya Template'} onClose={onClose}>
      <div className="space-y-3 max-h-[70vh] overflow-y-auto">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl bg-gray-100 border border-gray-200 px-3 py-2 text-gray-900" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="accent-blue-600" /> Default template
        </label>
        {stages.map((s, i) => (
          <div key={i} className="rounded-xl bg-gray-100 p-4 space-y-2">
            <div className="flex gap-2">
              <input value={s.title} onChange={(e) => setStages(stages.map((x, xi) => xi === i ? { ...x, title: e.target.value } : x))}
                placeholder="Stage title" className="flex-1 rounded-xl bg-gray-100 border border-gray-200 px-3 py-2 text-gray-900 text-sm" />
              <input type="number" value={s.dayOffset} min={0} onChange={(e) => setStages(stages.map((x, xi) => xi === i ? { ...x, dayOffset: e.target.value } : x))}
                title="Day offset" className="w-20 rounded-xl bg-gray-100 border border-gray-200 px-3 py-2 text-gray-900 text-sm" />
              <button onClick={() => setStages(stages.filter((_, xi) => xi !== i))} className="text-red-400 px-2">✕</button>
            </div>
            <textarea value={s.tasks} rows={3} onChange={(e) => setStages(stages.map((x, xi) => xi === i ? { ...x, tasks: e.target.value } : x))}
              placeholder="Tasks — har line par ek (e.g. Office tour)" className="w-full rounded-xl bg-gray-100 border border-gray-200 px-3 py-2 text-gray-900 text-sm" />
          </div>
        ))}
        <button onClick={() => setStages([...stages, { title: '', dayOffset: 0, tasks: '' }])} className="text-teal-700 text-sm hover:underline">+ Stage add karein</button>
        <button onClick={save} className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#0f766e] to-teal-700 text-gray-900 font-semibold">Save Template</button>
      </div>
    </Modal>
  );
}
