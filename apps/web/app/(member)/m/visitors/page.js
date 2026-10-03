'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { Spinner, ErrorBanner, Badge, Modal, Field } from '../../../../components/ui';

const PURPOSES = [
  { v: 'meeting', l: 'Meeting' },
  { v: 'tour', l: 'Space Tour' },
  { v: 'interview', l: 'Interview' },
  { v: 'delivery', l: 'Delivery' },
  { v: 'other', l: 'Other' },
];
const purposeLabel = (v) => PURPOSES.find((p) => p.v === v)?.l || v;
const tone = (s) => ({ pending: 'blue', 'checked-in': 'green', expired: 'slate', cancelled: 'red' }[s] || 'slate');

export default function MemberVisitors() {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ visitorName: '', visitorEmail: '', visitorPhone: '', expectedAt: '', purpose: 'meeting', notes: '' });

  const load = () => {
    setLoading(true);
    api.get('/visitor-invites/mine')
      .then((d) => setInvites(d.invites || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/visitor-invites', {
        ...form,
        expectedAt: new Date(form.expectedAt).toISOString(),
      });
      setShowForm(false);
      setForm({ visitorName: '', visitorEmail: '', visitorPhone: '', expectedAt: '', purpose: 'meeting', notes: '' });
      load();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const cancel = async (id) => {
    if (!confirm('Cancel this visitor invite?')) return;
    try {
      await api.post(`/visitor-invites/${id}/cancel`);
      load();
    } catch (e) { setError(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold text-white">My Visitors</h1>
        <button className="btn-primary text-sm" onClick={() => setShowForm(true)}>+ Invite Visitor</button>
      </div>
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      {loading ? <Spinner /> : invites.length === 0 ? (
        <div className="card-premium p-8 text-center text-sm text-slate-400">No visitor invites yet. Invite someone and they'll get a check-in code.</div>
      ) : (
        <div className="grid gap-3">
          {invites.map((i) => (
            <div key={i.id} className="card-premium p-4 flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-white">{i.visitorName}</div>
                <div className="text-xs text-slate-400">
                  {new Date(i.expectedAt).toLocaleString()} · {purposeLabel(i.purpose)} · Code{' '}
                  <span className="font-mono font-bold text-violet-300 tracking-widest">{i.code}</span>
                </div>
                {i.notes && <div className="text-xs text-slate-500 mt-1">{i.notes}</div>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge tone={tone(i.status)}>{i.status}</Badge>
                {i.status === 'pending' && (
                  <button className="btn-secondary text-xs px-3 py-1" onClick={() => cancel(i.id)}>Cancel</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {showForm && (
        <Modal title="Invite Visitor" onClose={() => setShowForm(false)}>
          <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <Field label="Visitor name"><input className="input" value={form.visitorName} onChange={(e) => setForm({ ...form, visitorName: e.target.value })} required /></Field>
            <Field label="Expected at"><input type="datetime-local" className="input" value={form.expectedAt} onChange={(e) => setForm({ ...form, expectedAt: e.target.value })} required /></Field>
            <Field label="Email (gets the code)"><input type="email" className="input" value={form.visitorEmail} onChange={(e) => setForm({ ...form, visitorEmail: e.target.value })} placeholder="optional" /></Field>
            <Field label="Phone (SMS code)"><input className="input" value={form.visitorPhone} onChange={(e) => setForm({ ...form, visitorPhone: e.target.value })} placeholder="optional" /></Field>
            <Field label="Purpose">
              <select className="input" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })}>
                {PURPOSES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
              </select>
            </Field>
            <div className="sm:col-span-2"><Field label="Notes"><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
            <div className="sm:col-span-2"><button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Sending…' : 'Send Invite'}</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
