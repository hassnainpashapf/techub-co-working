'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import {
  PageHeader,
  Badge,
  Modal,
  Field,
  Spinner,
  ErrorBanner,
} from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const WRITE_ROLES = ['ceo', 'admin', 'manager', 'receptionist', 'operations_manager'];

const CYCLE_LABELS = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
const UNIT_TYPE_LABELS = {
  hot_desk: 'Hot Desk',
  dedicated_desk: 'Dedicated Desk',
  cabin: 'Cabin',
  meeting_room: 'Meeting Room',
  phone_booth: 'Phone Booth',
};

function PlanForm({ initial, onSave, saving }) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    description: initial?.description || '',
    price: initial?.price || '',
    billingCycle: initial?.billingCycle || 'monthly',
    unitType: initial?.unitType || '',
    features: (initial?.features || []).join('\n'),
    isActive: initial?.isActive ?? true,
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          name: form.name,
          description: form.description || null,
          price: Number(form.price),
          billingCycle: form.billingCycle,
          unitType: form.unitType || null,
          features: form.features.split('\n').map((s) => s.trim()).filter(Boolean),
          isActive: form.isActive,
        });
      }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Plan name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Hot Desk — Monthly" /></Field>
        <Field label="Price (Rs)"><input type="number" min="1" className="input" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required /></Field>
        <Field label="Billing cycle">
          <select className="input" value={form.billingCycle} onChange={(e) => setForm({ ...form, billingCycle: e.target.value })}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
          </select>
        </Field>
        <Field label="Unit type">
          <select className="input" value={form.unitType} onChange={(e) => setForm({ ...form, unitType: e.target.value })}>
            <option value="">Any</option>
            {Object.entries(UNIT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2"><Field label="Description"><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field></div>
        <div className="sm:col-span-2"><Field label="Features (one per line)"><textarea className="input" rows={4} value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} placeholder={'High-speed WiFi\n24/7 access'} /></Field></div>
        <Field label="Status">
          <select className="input" value={form.isActive ? 'true' : 'false'} onChange={(e) => setForm({ ...form, isActive: e.target.value === 'true' })}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </Field>
      </div>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Save plan'}</button>
    </form>
  );
}

export default function PlansPage() {
  const { allowed, user } = useRequireRoles(['ceo', 'admin', 'manager', 'receptionist', 'operations_manager', 'finance_manager', 'member']);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const canWrite = user && WRITE_ROLES.includes(user.role);

  const load = () => {
    setLoading(true);
    api.get('/membership-plans')
      .then((d) => setPlans(d.plans || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (allowed) load(); }, [allowed]);

  if (!allowed) return <AccessDenied />;

  const handleSave = async (data) => {
    setSaving(true);
    try {
      if (editing) await api.patch(`/membership-plans/${editing.id}`, data);
      else await api.post('/membership-plans', data);
      setShowModal(false);
      setEditing(null);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (plan) => {
    if (!confirm(`Delete plan "${plan.name}"?`)) return;
    try {
      await api.del(`/membership-plans/${plan.id}`);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const fmt = (n) => `Rs ${Number(n).toLocaleString()}`;

  return (
    <div>
      <PageHeader
        title="Membership Plans"
        subtitle="Pricing plans members can subscribe to"
        action={canWrite ? <button className="btn-primary" onClick={() => { setEditing(null); setShowModal(true); }}>+ New Plan</button> : null}
      />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      {loading ? <Spinner /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4 gap-5">
          {plans.map((plan) => (
            <div key={plan.id} className="card-premium p-6 relative">
              {!plan.isActive && <div className="absolute top-4 right-4"><Badge tone="slate">Inactive</Badge></div>}
              <div className="text-sm text-slate-400">{CYCLE_LABELS[plan.billingCycle] || plan.billingCycle}{plan.unitType ? ` · ${UNIT_TYPE_LABELS[plan.unitType]}` : ''}</div>
              <h3 className="text-xl font-bold text-white mt-1">{plan.name}</h3>
              {plan.description && <p className="text-sm text-slate-300 mt-1">{plan.description}</p>}
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-extrabold text-white">{fmt(plan.price)}</span>
                <span className="text-sm text-slate-400">/{plan.billingCycle === 'monthly' ? 'mo' : plan.billingCycle === 'yearly' ? 'yr' : 'qtr'}</span>
              </div>
              {plan.features?.length > 0 && (
                <ul className="mt-4 space-y-1.5">
                  {plan.features.map((f, i) => (
                    <li key={i} className="text-sm text-slate-200 flex items-start gap-2">
                      <span className="text-emerald-400 mt-0.5">✓</span>{f}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between">
                <span className="text-xs text-slate-400">{plan._count?.contracts || 0} active contracts</span>
                {canWrite && (
                  <div className="flex gap-2">
                    <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => { setEditing(plan); setShowModal(true); }}>Edit</button>
                    <button className="btn-danger text-xs px-3 py-1.5" onClick={() => handleDelete(plan)}>Delete</button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {plans.length === 0 && (
            <div className="col-span-full card p-10 text-center text-slate-400">No plans yet. Create your first membership plan.</div>
          )}
        </div>
      )}
      {showModal && (
        <Modal title={editing ? 'Edit Plan' : 'New Plan'} onClose={() => { setShowModal(false); setEditing(null); }}>
          <PlanForm initial={editing} onSave={handleSave} saving={saving} />
        </Modal>
      )}
    </div>
  );
}
