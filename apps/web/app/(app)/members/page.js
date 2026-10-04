'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, getTokens, API_BASE } from '../../../lib/api';
import {
  PageHeader,
  DataTable,
  Badge,
  Modal,
  Field,
  Spinner,
  ErrorBanner,
} from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';
import SavedViews from '../../../components/SavedViews';
import { useAuth } from '../../../context/AuthContext';
import IntroductionsWidget from '../../../components/IntroductionsWidget'; // Phase 40 Track 9
import MemberAccessTab from '../../../components/MemberAccessTab'; // Phase 48 Track 2
import MemberCommsTab from '../../../components/MemberCommsTab'; // Phase 49 Track 2

const STATUS_TONE = { active: 'green', inactive: 'slate', suspended: 'red', pending: 'amber' };
const BULK_ROLES = ['ceo', 'admin', 'manager', 'super_admin'];

// Phase 32 Track 7: GDPR-style data export + anonymization controls.
function DataPrivacySection({ member, onChanged }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [showAnon, setShowAnon] = useState(false);
  const [confirmName, setConfirmName] = useState('');

  const staff = ['ceo', 'admin', 'super_admin'].includes(user?.role);
  const selfExport = user?.memberId && user.memberId === member.id;
  if (!staff && !selfExport) return null;

  async function handleExport() {
    setBusy(true); setMsg('');
    try {
      const { access } = getTokens();
      const res = await fetch(`${API_BASE}/data-export/member/${member.id}/export`, {
        method: 'POST',
        headers: access ? { Authorization: `Bearer ${access}` } : {},
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `member-data-${member.id}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      setMsg('Data exported as JSON.');
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  async function handleAnonymize() {
    if (confirmName.trim().toLowerCase() !== (member.name || '').trim().toLowerCase()) {
      setMsg('Type the member name exactly to confirm anonymization.');
      return;
    }
    setBusy(true); setMsg('');
    try {
      await api.post(`/data-export/member/${member.id}/anonymize`, { confirm: true });
      setShowAnon(false); setConfirmName('');
      setMsg('Member anonymized — login disabled.');
      if (onChanged) onChanged();
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[#141422] p-4 mt-6">
      <h3 className="font-semibold text-white mb-1">Data &amp; Privacy</h3>
      <p className="text-xs text-slate-400 mb-3">
        Export all member data as JSON (password hashes are never included). Anonymization replaces
        personal data with placeholders — financial records are kept for tax compliance.
      </p>
      {msg && <p className="text-xs text-amber-300 mb-3">{msg}</p>}
      <div className="flex flex-wrap gap-2">
        <button onClick={handleExport} disabled={busy}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-white/15 text-slate-200 hover:bg-white/10 disabled:opacity-50">
          {busy ? 'Working…' : 'Export Data (JSON)'}
        </button>
        {staff && (
          <button onClick={() => { setShowAnon(true); setMsg(''); }} disabled={busy}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-50">
            Anonymize (GDPR)
          </button>
        )}
      </div>
      {showAnon && (
        <Modal title="Anonymize member" onClose={() => { if (!busy) { setShowAnon(false); setConfirmName(''); } }}>
          <p className="text-sm text-slate-300 mb-2">
            This permanently replaces <span className="font-semibold text-white">{member.name}</span>'s personal
            data (name, email, phone, CNIC) with placeholders and <span className="text-red-300 font-medium">disables their login</span>.
            Invoices and payments are kept for tax compliance. This cannot be undone.
          </p>
          <Field label={`Type "${member.name}" to confirm`}>
            <input className="input" value={confirmName} onChange={(e) => setConfirmName(e.target.value)}
              placeholder="Member name" disabled={busy} />
          </Field>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => { setShowAnon(false); setConfirmName(''); }} disabled={busy}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-white/15 text-slate-300 hover:bg-white/10">
              Cancel
            </button>
            <button onClick={handleAnonymize} disabled={busy || !confirmName.trim()}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-600 hover:bg-red-500 text-white disabled:opacity-50">
              {busy ? 'Anonymizing…' : 'Anonymize permanently'}
            </button>
          </div>
          {msg && <p className="text-xs text-amber-300 mt-3">{msg}</p>}
        </Modal>
      )}
    </div>
  );
}

function MemberForm({ initial, onSave, saving }) {
  const { user } = useAuth();
  const canSetCredit = ['ceo', 'admin', 'super_admin', 'finance_officer'].includes(user?.role);
  const [form, setForm] = useState({
    name: initial?.name || '',
    phone: initial?.phone || '',
    email: initial?.email || '',
    cnic: initial?.cnic || '',
    companyName: initial?.companyName || '',
    companyId: initial?.companyId || '',
    emergencyContact: initial?.emergencyContact || '',
    dateOfBirth: initial?.dateOfBirth ? new Date(initial.dateOfBirth).toISOString().slice(0, 10) : '', // Phase 40: birthday automation
    status: initial?.status || 'active',
    notes: initial?.notes || '',
    creditLimit: initial?.creditLimit ?? '',
  });
  const [companies, setCompanies] = useState([]);

  useEffect(() => {
    api.get('/companies').then((d) => setCompanies(d.companies || [])).catch(() => {});
  }, []);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const payload = { ...form };
        // If a company is selected from dropdown, backend syncs companyName — drop free text
        if (payload.companyId) delete payload.companyName;
        else delete payload.companyId;
        // Normalize credit limit: empty => null (unlimited), otherwise number
        if (payload.creditLimit === '' || payload.creditLimit == null) payload.creditLimit = null;
        else payload.creditLimit = Number(payload.creditLimit);
        // Phase 40: empty DOB => null
        if (payload.dateOfBirth === '' || payload.dateOfBirth == null) payload.dateOfBirth = null;
        onSave(payload);
      }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Full name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label="Phone"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required placeholder="03xx-xxxxxxx" /></Field>
        <Field label="Email"><input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="CNIC"><input className="input" value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} placeholder="xxxxx-xxxxxxx-x" /></Field>
        <Field label="Company (linked)">
          <select className="input" value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
            <option value="">— Select company —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Company (free text)">
          <input
            className="input"
            value={form.companyName}
            onChange={(e) => setForm({ ...form, companyName: e.target.value })}
            placeholder="Used when no company selected"
            disabled={!!form.companyId}
          />
        </Field>
        <Field label="Emergency contact"><input className="input" value={form.emergencyContact} onChange={(e) => setForm({ ...form, emergencyContact: e.target.value })} /></Field>
        <Field label="Date of birth"><input type="date" className="input" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} /></Field>
        <Field label="Status">
          <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
            <option value="pending">Pending</option>
          </select>
        </Field>
        <Field label="Notes"><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        {canSetCredit && (
          <Field label="Credit limit (Rs)">
            <input
              type="number"
              min="0"
              className="input"
              value={form.creditLimit}
              onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
              placeholder="Empty = unlimited"
            />
          </Field>
        )}
      </div>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Save member'}</button>
    </form>
  );
}

function MemberTimeline({ memberId }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    api.get(`/members/${memberId}/timeline`)
      .then((d) => { if (!cancelled) setEvents(d.events || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [memberId]);
  if (loading) return <Spinner />;
  if (!events.length) return <p className="text-sm text-slate-400">No activity yet.</p>;
  return (
    <div className="relative pl-6">
      <div className="absolute left-2 top-1 bottom-1 w-px bg-white/10" />
      {events.map((e, i) => (
        <div key={i} className="relative pb-4">
          <div className="absolute -left-6 top-0 w-5 h-5 rounded-full bg-[#1a1a2c] border border-white/15 flex items-center justify-center text-[10px]">{e.icon}</div>
          <p className="text-sm text-white font-medium">{e.title}</p>
          {e.detail && <p className="text-xs text-slate-400">{e.detail}</p>}
          <p className="text-[11px] text-slate-500">{e.at ? new Date(e.at).toLocaleString() : ''}</p>
        </div>
      ))}
    </div>
  );
}

function MemberDetail({ member, onClose, onChanged }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState('overview');
  // Phase 36: e-signature request
  const [esignTarget, setEsignTarget] = useState(null);
  const [esignName, setEsignName] = useState('');
  const [esignEmail, setEsignEmail] = useState('');
  const [esignMsg, setEsignMsg] = useState('');
  const [esignBusy, setEsignBusy] = useState(false);

  // Phase 31: credit balance bar (computed from loaded invoices)
  function CreditBar({ m }) {
    const limit = m.creditLimit == null ? null : Number(m.creditLimit);
    const balance = (m.invoices || [])
      .filter((i) => ['unpaid', 'partial', 'overdue'].includes(i.status))
      .reduce((s, i) => s + Math.max(0, Number(i.amount || 0) - Number(i.amountPaid || 0)), 0);
    const exceeded = limit != null && balance > limit;
    const pct = limit ? Math.min(100, (balance / limit) * 100) : 0;
    return (
      <div className={`rounded-2xl border p-4 mb-5 ${exceeded ? 'border-red-500/40 bg-red-500/10' : 'border-white/[0.06] bg-[#141422]'}`}>
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-slate-300 font-medium">Credit</span>
          {exceeded && <span className="text-[11px] font-bold text-red-300 bg-red-500/20 px-2 py-0.5 rounded-full">LIMIT EXCEEDED</span>}
        </div>
        <div className="flex items-baseline gap-2 text-sm mb-2">
          <span className={exceeded ? 'text-red-300 font-bold' : 'text-white font-semibold'}>Rs {balance.toLocaleString()}</span>
          <span className="text-slate-500 text-xs">outstanding</span>
          <span className="text-slate-500 text-xs ml-auto">limit: {limit == null ? 'unlimited' : `Rs ${limit.toLocaleString()}`}</span>
        </div>
        {limit != null && (
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div className={`h-full rounded-full ${exceeded ? 'bg-red-500' : pct > 80 ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    );
  }
  // Phase 33: loyalty points card (balance + recent ledger + manual adjust)
  function LoyaltyCard({ memberId }) {
    const [data, setData] = useState(null);
    const [adj, setAdj] = useState({ points: '', reason: '' });
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    useEffect(() => {
      let cancelled = false;
      api.get(`/loyalty/members/${memberId}`)
        .then((d) => { if (!cancelled) setData(d); })
        .catch(() => {});
      return () => { cancelled = true; };
    }, [memberId]);
    if (!data) return null;
    async function adjust(e) {
      e.preventDefault();
      setMsg('');
      const pts = Math.floor(Number(adj.points));
      if (!pts || !adj.reason.trim()) { setMsg('Points and reason required.'); return; }
      setBusy(true);
      try {
        const r = await api.post(`/loyalty/members/${memberId}/adjust`, { points: pts, reason: adj.reason.trim() });
        setData((d) => ({ ...d, balance: r.balance, entries: [r.entry, ...(d.entries || [])] }));
        setAdj({ points: '', reason: '' });
      } catch (err) { setMsg(err.message || 'Adjust failed'); }
      finally { setBusy(false); }
    }
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-slate-300 font-medium">Loyalty Points</span>
          <span className="text-lg font-bold text-violet-300">{Number(data.balance || 0).toLocaleString()} pts</span>
        </div>
        {(data.entries || []).slice(0, 3).map((e) => (
          <div key={e.id} className="flex justify-between text-xs text-slate-400 py-1 border-t border-white/5">
            <span>{e.reason.replace(/_/g, ' ')}</span>
            <span className={e.points > 0 ? 'text-emerald-300' : 'text-red-300'}>{e.points > 0 ? `+${e.points}` : e.points}</span>
          </div>
        ))}
        <form onSubmit={adjust} className="flex gap-2 mt-3">
          <input type="number" className="input !py-1.5 text-xs w-24" placeholder="+/- pts" value={adj.points} onChange={(e) => setAdj({ ...adj, points: e.target.value })} />
          <input className="input !py-1.5 text-xs flex-1" placeholder="Reason" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} />
          <button className="btn-secondary !py-1.5 text-xs" disabled={busy}>{busy ? '…' : 'Adjust'}</button>
        </form>
        {msg && <p className="text-xs text-red-300 mt-2">{msg}</p>}
      </div>
    );
  }

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/members/${member.id}`)
      .then((d) => {
        if (!cancelled) setDetail(d.member || d);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [member.id]);

  const m = detail || member;
  const contracts = m.contracts || [];
  const invoices = m.invoices || [];

  return (
    <Modal title={m.name} onClose={onClose}>
      {loading ? (
        <Spinner />
      ) : (
        <div>
          {error && <ErrorBanner message={error} />}
          <div className="flex gap-2 mb-5">
            {['overview', 'timeline', 'access', 'comms'].map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border capitalize ${tab === t ? 'border-violet-400/60 bg-violet-500/20 text-violet-200' : 'border-white/10 text-slate-400 hover:bg-white/5'}`}>
                {t === 'access' ? '🔑 Access' : t === 'comms' ? '💬 Comms' : t}
              </button>
            ))}
          </div>
          {tab === 'access' ? (
            <MemberAccessTab memberId={m.id} />
          ) : tab === 'comms' ? (
            <MemberCommsTab memberId={m.id} memberPhone={m.phone} memberEmail={m.email} />
          ) : tab === 'timeline' ? (
            <MemberTimeline memberId={m.id} />
          ) : (
          <div>
          <CreditBar m={m} />
          <LoyaltyCard memberId={m.id} />
          <div className="grid grid-cols-2 gap-3 text-sm mb-5">
            <div><p className="text-xs text-slate-400">Phone</p><p className="font-medium">{m.phone || '—'}</p></div>
            <div><p className="text-xs text-slate-400">Email</p><p className="font-medium">{m.email || '—'}</p></div>
            <div><p className="text-xs text-slate-400">CNIC</p><p className="font-medium">{m.cnic || '—'}</p></div>
            <div><p className="text-xs text-slate-400">Company</p><p className="font-medium">{m.companyName || '—'}</p></div>
            <div><p className="text-xs text-slate-400">Emergency contact</p><p className="font-medium">{m.emergencyContact || '—'}</p></div>
            <div><p className="text-xs text-slate-400">Status</p><Badge tone={STATUS_TONE[m.status] || 'slate'}>{m.status || '—'}</Badge></div>
          </div>
          {m.notes && <p className="text-sm text-slate-400 bg-white/5 rounded-lg p-3 mb-5">{m.notes}</p>}

          <h3 className="font-semibold text-white mb-2">Contracts ({contracts.length})</h3>
          <DataTable
            columns={[
              { key: 'unit', label: 'Unit', render: (r) => r.unitCode || r.unit?.code || '—' },
              { key: 'start', label: 'Start', render: (r) => (r.startDate ? String(r.startDate).slice(0, 10) : '—') },
              { key: 'end', label: 'End', render: (r) => (r.endDate ? String(r.endDate).slice(0, 10) : '—') },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] || 'slate'}>{r.status || '—'}</Badge> },
              { key: 'esign', label: 'E-Sign', render: (r) => (
                <button
                  onClick={() => { setEsignTarget(r); setEsignName(m.name || ''); setEsignEmail(m.email || ''); setEsignMsg(''); }}
                  className="text-[11px] px-2 py-1 rounded-lg border border-violet-400/40 text-violet-200 hover:bg-violet-500/15">
                  ✍️ Request
                </button>
              ) },
            ]}
            rows={contracts}
            empty={{ title: 'No contracts' }}
          />
          {/* Phase 36: e-signature request modal */}
          {esignTarget && (
            <Modal title={`Request signature — ${esignTarget.unitCode || esignTarget.unit?.code || 'contract'}`} onClose={() => setEsignTarget(null)}>
              <form onSubmit={async (e) => {
                e.preventDefault();
                setEsignBusy(true); setEsignMsg('');
                try {
                  await api.post(`/esign/contracts/${esignTarget.id}/request`, { signerName: esignName.trim(), signerEmail: esignEmail.trim() });
                  setEsignMsg('✅ Signing link sent to ' + esignEmail.trim());
                } catch (err) { setEsignMsg('❌ ' + (err.message || 'Request failed')); }
                finally { setEsignBusy(false); }
              }}>
                <div className="space-y-3">
                  <Field label="Signer name">
                    <input className="input w-full" value={esignName} onChange={(e) => setEsignName(e.target.value)} required maxLength={120} />
                  </Field>
                  <Field label="Signer email">
                    <input type="email" className="input w-full" value={esignEmail} onChange={(e) => setEsignEmail(e.target.value)} required maxLength={160} />
                  </Field>
                  <p className="text-xs text-slate-500">The signer gets an email with a one-time link (valid 14 days). Their IP and timestamp are recorded on signing.</p>
                  {esignMsg && <p className="text-sm text-slate-300">{esignMsg}</p>}
                  <button type="submit" disabled={esignBusy} className="btn-primary w-full">{esignBusy ? 'Sending…' : 'Send signing link'}</button>
                </div>
              </form>
            </Modal>
          )}

          <h3 className="font-semibold text-white mb-2 mt-5">Invoices ({invoices.length})</h3>
          <DataTable
            columns={[
              { key: 'no', label: 'Invoice', render: (r) => r.number || r.id?.slice(0, 8) || '—' },
              { key: 'amount', label: 'Amount', render: (r) => `Rs ${Number(r.amount || 0).toLocaleString()}` },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] || 'slate'}>{r.status || '—'}</Badge> },
            ]}
            rows={invoices.slice(0, 5)}
            empty={{ title: 'No invoices' }}
          />
          <DataPrivacySection member={m} onChanged={onChanged} />
          </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function MembersPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'operations_manager', 'manager', 'receptionist');
  const { user } = useAuth();
  const canBulk = BULK_ROLES.includes(user?.role);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modal, setModal] = useState(null); // {mode:'add'|'edit', data} | {mode:'detail', data}
  const [saving, setSaving] = useState(false);
  // Phase 30: bulk selection
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Phase 38 Track 5: extended bulk actions
  const [bulkAction, setBulkAction] = useState('suspend');
  const [bulkModal, setBulkModal] = useState(null); // 'email' | 'tag'
  const [bulkSubject, setBulkSubject] = useState('');
  const [bulkBody, setBulkBody] = useState('');
  const [bulkTag, setBulkTag] = useState('');
  const [bulkResult, setBulkResult] = useState(null);
  // Phase 29 Track 4: expiring contracts
  const [expiring, setExpiring] = useState([]);
  const [renewTarget, setRenewTarget] = useState(null);
  const [renewDate, setRenewDate] = useState('');
  const [renewRent, setRenewRent] = useState('');
  const [renewing, setRenewing] = useState(false);

  const refresh = async () => {
    setError('');
    try {
      const d = await api.get('/members');
      setMembers(d.members || d || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 29 Track 4: load contracts expiring in the next 30 days
  useEffect(() => {
    api.get('/contract-renewals/expiring?days=30')
      .then((d) => setExpiring(d.items || []))
      .catch(() => setExpiring([]));
  }, []);

  async function handleRenew() {
    if (!renewTarget || !renewDate) return;
    setRenewing(true);
    try {
      const payload = { endDate: renewDate };
      if (renewRent !== '') payload.rentAmount = Number(renewRent);
      await api.post(`/contract-renewals/${renewTarget.id}/renew`, payload);
      setRenewTarget(null);
      setRenewDate('');
      setRenewRent('');
      const d = await api.get('/contract-renewals/expiring?days=30').catch(() => null);
      setExpiring(d?.items || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setRenewing(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return members.filter((m) => {
      const matchesQ =
        !q ||
        (m.name || '').toLowerCase().includes(q) ||
        (m.phone || '').toLowerCase().includes(q) ||
        (m.email || '').toLowerCase().includes(q) ||
        (m.companyName || '').toLowerCase().includes(q);
      const matchesS = statusFilter === 'all' || m.status === statusFilter;
      return matchesQ && matchesS;
    });
  }, [members, search, statusFilter]);

  async function handleSave(payload) {
    setSaving(true);
    try {
      if (modal.mode === 'add') await api.post('/members', payload);
      else await api.put(`/members/${modal.data.id}`, payload);
      setModal(null);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this member? This cannot be undone.')) return;
    try {
      await api.del(`/members/${id}`);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  // Phase 30: bulk actions
  const toggleSelect = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const toggleSelectAll = () => {
    setSelectedIds((prev) => (prev.length === filtered.length ? [] : filtered.map((m) => m.id)));
  };
  // Phase 38 Track 5: extended bulk actions (suspend/activate/email/tag/export)
  async function handleBulkDelete() {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Mark ${selectedIds.length} member(s) as exited?`)) return;
    setBulkBusy(true);
    try {
      await api.post('/members/bulk/delete', { ids: selectedIds });
      setSelectedIds([]);
      await refresh();
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBulkBusy(false);
    }
  }

  // Phase 38 Track 5: extended bulk actions (suspend/activate/email/tag/export)
  async function runBulkAction(payload) {
    setBulkBusy(true);
    setBulkResult(null);
    try {
      const d = await api.post('/member-bulk', payload);
      setBulkResult({ action: payload.action, done: d.done ?? 0, failed: d.failed || [] });
      setSelectedIds([]);
      setBulkModal(null);
      setBulkSubject('');
      setBulkBody('');
      setBulkTag('');
      setError('');
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBulkBusy(false);
    }
  }
  async function handleBulkGo() {
    if (selectedIds.length === 0) return;
    if (bulkAction === 'send_email') { setBulkModal('email'); return; }
    if (bulkAction === 'add_tag') { setBulkModal('tag'); return; }
    if (bulkAction === 'export') { return handleBulkExport(); }
    if (!window.confirm(`${bulkAction === 'suspend' ? 'Suspend (set on hold)' : 'Activate'} ${selectedIds.length} member(s)?`)) return;
    await runBulkAction({ memberIds: selectedIds, action: bulkAction });
  }
  async function handleBulkExport() {
    setBulkBusy(true);
    try {
      const { access } = getTokens();
      const res = await fetch(`${API_BASE}/member-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(access ? { Authorization: `Bearer ${access}` } : {}) },
        body: JSON.stringify({ memberIds: selectedIds, action: 'export' }),
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `members-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setSelectedIds([]);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBulkBusy(false);
    }
  }

  const selectColumn = canBulk
    ? [
        {
          key: '__select',
          label: <input type="checkbox" checked={filtered.length > 0 && selectedIds.length === filtered.length} onChange={toggleSelectAll} title="Select all" />,
          render: (r) => <input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => toggleSelect(r.id)} />,
        },
      ]
    : [];

  if (allowed === null) return <Spinner />;
  if (allowed === false) return <AccessDenied />;
  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Members"
        sub={`${members.length} members`}
        actions={
          <button className="btn-primary" onClick={() => setModal({ mode: 'add' })}>
            + Add member
          </button>
        }
      />
      <ErrorBanner message={error} onRetry={refresh} />
      <IntroductionsWidget /> {/* Phase 40 Track 9: pending member introductions */}

      {/* Phase 29 Track 4: contracts expiring soon */}
      {expiring.length > 0 && (
        <div className="card mb-4 border-amber-400/30">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">⏳</span>
            <h3 className="font-semibold text-white">Contracts expiring soon ({expiring.length})</h3>
            <Badge tone="amber">next 30 days</Badge>
          </div>
          <DataTable
            columns={[
              { key: 'member', label: 'Member', render: (r) => <span className="font-medium text-white">{r.member?.name || '—'}</span> },
              { key: 'unit', label: 'Unit', render: (r) => r.unit?.code || '—' },
              { key: 'end', label: 'Ends', render: (r) => (r.endDate ? String(r.endDate).slice(0, 10) : '—') },
              { key: 'left', label: 'Days left', render: (r) => <Badge tone={r.daysLeft <= 7 ? 'red' : r.daysLeft <= 14 ? 'amber' : 'slate'}>{r.daysLeft}</Badge> },
              {
                key: 'actions', label: '', render: (r) => (
                  <button className="btn-primary btn-sm" onClick={() => { setRenewTarget(r); setRenewDate(''); setRenewRent(''); }}>
                    Renew
                  </button>
                ),
              },
            ]}
            rows={expiring}
            empty={{ title: 'None' }}
          />
        </div>
      )}

      <div className="card mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          <input
            className="input max-w-xs"
            placeholder="Search name, phone, email, company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="input max-w-[180px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
            <option value="pending">Pending</option>
          </select>
          <SavedViews
            page="members"
            currentFilters={{ search, statusFilter }}
            onApply={(f) => {
              if (typeof f.search === 'string') setSearch(f.search);
              if (typeof f.statusFilter === 'string') setStatusFilter(f.statusFilter);
            }}
          />
        </div>
      </div>

      <div className="card">
        {/* Phase 38 Track 5: extended bulk actions bar */}
        {canBulk && selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 mb-4 p-3 rounded-xl bg-[#8b5cf6]/10 border border-[#8b5cf6]/30">
            <span className="text-sm font-semibold text-[#ddd6fe]">{selectedIds.length} selected</span>
            <select className="input max-w-[180px] !w-auto" value={bulkAction} onChange={(e) => setBulkAction(e.target.value)}>
              <option value="suspend">Suspend (on hold)</option>
              <option value="activate">Activate</option>
              <option value="send_email">Send email</option>
              <option value="add_tag">Add tag</option>
              <option value="export">Export CSV</option>
            </select>
            <button className="btn-primary btn-sm" onClick={handleBulkGo} disabled={bulkBusy}>
              {bulkBusy ? 'Working…' : 'Go'}
            </button>
            <button className="btn-danger btn-sm" onClick={handleBulkDelete} disabled={bulkBusy}>
              Mark exited
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setSelectedIds([])}>Clear</button>
          </div>
        )}
        {/* Phase 38 Track 5: bulk result summary */}
        {bulkResult && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-400/30 text-sm">
            <span className="text-emerald-200 font-medium">{bulkResult.done} done</span>
            {bulkResult.failed.length > 0 && (
              <span className="text-amber-200"> — {bulkResult.failed.length} failed ({bulkResult.failed.slice(0, 5).map((f) => f.reason || f.id).join(', ')}{bulkResult.failed.length > 5 ? '…' : ''})</span>
            )}
            <button className="ml-3 underline text-slate-300" onClick={() => setBulkResult(null)}>Dismiss</button>
          </div>
        )}
        <DataTable
          columns={[
            ...selectColumn,
            { key: 'name', label: 'Name', render: (r) => <span className="font-medium text-white">{r.name}</span> },
            { key: 'phone', label: 'Phone' },
            { key: 'company', label: 'Company', render: (r) => r.companyName || '—' },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] || 'slate'}>{r.status || '—'}</Badge> },
            {
              key: 'actions',
              label: 'Actions',
              render: (r) => (
                <div className="flex gap-2">
                  <button className="btn-secondary btn-sm" onClick={() => setModal({ mode: 'detail', data: r })}>View</button>
                  <button className="btn-secondary btn-sm" onClick={() => setModal({ mode: 'edit', data: r })}>Edit</button>
                  <button className="btn-danger btn-sm" onClick={() => handleDelete(r.id)}>Delete</button>
                </div>
              ),
            },
          ]}
          rows={filtered}
          empty={{ title: 'No members found', hint: 'Try a different search or add a new member.' }}
        />
      </div>

      {(modal?.mode === 'add' || modal?.mode === 'edit') && (
        <Modal title={modal.mode === 'add' ? 'Add member' : 'Edit member'} onClose={() => setModal(null)}>
          <MemberForm initial={modal.data} onSave={handleSave} saving={saving} />
        </Modal>
      )}
      {modal?.mode === 'detail' && (
        <MemberDetail member={modal.data} onClose={() => setModal(null)} onChanged={refresh} />
      )}

      {/* Phase 38 Track 5: bulk send-email modal */}
      {bulkModal === 'email' && (
        <Modal title={`Send email — ${selectedIds.length} member(s)`} onClose={() => setBulkModal(null)}>
          <Field label="Subject">
            <input className="input" value={bulkSubject} onChange={(e) => setBulkSubject(e.target.value)} placeholder="Important update" />
          </Field>
          <Field label="Message">
            <textarea className="input" rows={5} value={bulkBody} onChange={(e) => setBulkBody(e.target.value)} placeholder={'Hi everyone,\n\n…'} />
          </Field>
          <p className="text-xs text-slate-400 mb-4">Members without an email address are skipped automatically.</p>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setBulkModal(null)}>Cancel</button>
            <button
              className="btn-primary"
              disabled={bulkBusy || !bulkSubject.trim() || !bulkBody.trim()}
              onClick={() => runBulkAction({ memberIds: selectedIds, action: 'send_email', subject: bulkSubject.trim(), body: bulkBody })}
            >
              {bulkBusy ? 'Sending…' : 'Send emails'}
            </button>
          </div>
        </Modal>
      )}

      {/* Phase 38 Track 5: bulk add-tag modal */}
      {bulkModal === 'tag' && (
        <Modal title={`Add tag — ${selectedIds.length} member(s)`} onClose={() => setBulkModal(null)}>
          <Field label="Tag">
            <input className="input" value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} placeholder="vip" maxLength={40} />
          </Field>
          <p className="text-xs text-slate-400 mb-4">Tag is stored on the member's notes as [tag:name]. Duplicates are skipped.</p>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setBulkModal(null)}>Cancel</button>
            <button
              className="btn-primary"
              disabled={bulkBusy || !bulkTag.trim()}
              onClick={() => runBulkAction({ memberIds: selectedIds, action: 'add_tag', tag: bulkTag.trim().toLowerCase() })}
            >
              {bulkBusy ? 'Applying…' : 'Add tag'}
            </button>
          </div>
        </Modal>
      )}

      {/* Phase 29 Track 4: renew contract modal */}
      {renewTarget && (
        <Modal title={`Renew contract — ${renewTarget.member?.name || ''} (${renewTarget.unit?.code || ''})`} onClose={() => setRenewTarget(null)}>
          <p className="text-sm text-slate-400 mb-4">
            Current ends <b className="text-white">{String(renewTarget.endDate).slice(0, 10)}</b>. A new contract will start the next day; the old one will be marked expired.
          </p>
          <Field label="New end date">
            <input type="date" className="input" value={renewDate} onChange={(e) => setRenewDate(e.target.value)} required />
          </Field>
          <Field label="Rent amount (optional — keep current if empty)">
            <input type="number" min="0" step="0.01" className="input" value={renewRent} onChange={(e) => setRenewRent(e.target.value)} placeholder={String(renewTarget.rentAmount ?? '')} />
          </Field>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-secondary" onClick={() => setRenewTarget(null)}>Cancel</button>
            <button className="btn-primary" disabled={!renewDate || renewing} onClick={handleRenew}>
              {renewing ? 'Renewing…' : 'Renew contract'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
