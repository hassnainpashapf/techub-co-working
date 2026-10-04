'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, DataTable, Badge, Modal, Field } from '../../../../components/ui';

const CATS = { fire: '🔥 Fire', safety: '🦺 Safety', license: '📜 License', tax: '💰 Tax', data: '🔐 Data' };
const TONES = { pending: 'amber', overdue: 'red', done: 'green' };

export default function CompliancePage() {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ title: '', category: 'safety', dueDate: '', frequency: 'once', description: '' });
  const [filter, setFilter] = useState('all');

  const load = async () => {
    const [r, s] = await Promise.all([api.get('/compliance'), api.get('/compliance/summary')]);
    setItems(r.items || []);
    setSummary(s);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.title.trim()) return;
    await api.post('/compliance', { ...form, dueDate: form.dueDate || null });
    setModal(null); setForm({ title: '', category: 'safety', dueDate: '', frequency: 'once', description: '' });
    load();
  };
  const complete = async (id, evidenceUrl) => {
    await api.post(`/compliance/${id}/complete`, { evidenceUrl: evidenceUrl || null });
    load();
  };

  const shown = items.filter(i => filter === 'all' || i.status === filter);
  return (
    <div className="space-y-6">
      <PageHeader title="✅ Compliance Checklist" sub="Fire, safety, licenses, tax — sab ek jagah" actions={<button className="btn-primary" onClick={() => setModal(true)}>+ Naya Item</button>} />
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Pending" value={summary.counts?.find(c => c.status === 'pending')?._count ?? 0} tone="amber" />
          <StatCard label="Overdue" value={summary.counts?.find(c => c.status === 'overdue')?._count ?? 0} tone="red" />
          <StatCard label="Done" value={summary.counts?.find(c => c.status === 'done')?._count ?? 0} tone="green" />
          <StatCard label="7 din me due" value={summary.dueSoon ?? 0} tone="blue" />
        </div>
      )}
      <div className="flex gap-2">
        {['all', 'pending', 'overdue', 'done'].map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1 rounded-full text-sm ${filter === f ? 'bg-[#0f766e] text-white' : 'bg-gray-100 text-gray-600'}`}>{f}</button>
        ))}
      </div>
      <DataTable
        columns={[
          { key: 'title', label: 'Item' },
          { key: 'category', label: 'Category', render: i => CATS[i.category] || i.category },
          { key: 'dueDate', label: 'Due', render: i => i.dueDate ? new Date(i.dueDate).toLocaleDateString() : '—' },
          { key: 'status', label: 'Status', render: i => <Badge tone={TONES[i.status]}>{i.status}</Badge> },
          { key: 'assignedTo', label: 'Assigned', render: i => i.assignedTo?.name || '—' },
          { key: 'act', label: '', render: i => i.status !== 'done'
            ? <button className="btn-sm btn-primary" onClick={() => complete(i.id)}>✓ Complete</button>
            : <span className="text-green-400 text-sm">✓ {i.completedAt ? new Date(i.completedAt).toLocaleDateString() : ''}</span> },
        ]}
        rows={shown}
      />
      {modal && (
        <Modal title="Naya Compliance Item" onClose={() => setModal(null)}>
          <Field label="Title"><input className="input-premium" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Category">
            <select className="input-premium" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {Object.keys(CATS).map(c => <option key={c} value={c}>{CATS[c]}</option>)}
            </select>
          </Field>
          <Field label="Due date"><input type="date" className="input-premium" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} /></Field>
          <Field label="Frequency">
            <select className="input-premium" value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })}>
              <option value="once">Once</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option>
            </select>
          </Field>
          <Field label="Description"><textarea className="input-premium" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="flex justify-end gap-2 mt-4"><button className="btn-ghost" onClick={() => setModal(null)}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></div>
        </Modal>
      )}
    </div>
  );
}
