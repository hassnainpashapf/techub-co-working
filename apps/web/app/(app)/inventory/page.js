'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, DataTable } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;
const ASSET_TONES = { active: 'green', in_repair: 'amber', retired: 'slate', lost: 'red' };

function ItemForm({ onSave, saving }) {
  const [f, setF] = useState({ name: '', sku: '', category: 'general', quantity: 0, unit: 'pcs', reorderLevel: 5, unitPrice: '' });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ ...f, quantity: Number(f.quantity), reorderLevel: Number(f.reorderLevel), unitPrice: f.unitPrice ? Number(f.unitPrice) : null }); }}>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="SKU"><input className="input" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} /></Field>
        <Field label="Category">
          <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {['general', 'stationery', 'pantry', 'cleaning', 'it', 'furniture'].map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
          </select>
        </Field>
        <Field label="Unit"><input className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
        <Field label="Opening qty"><input type="number" min="0" className="input" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
        <Field label="Reorder level"><input type="number" min="0" className="input" value={f.reorderLevel} onChange={(e) => setF({ ...f, reorderLevel: e.target.value })} /></Field>
        <div className="col-span-2"><Field label="Unit price (Rs)"><input type="number" min="0" className="input" value={f.unitPrice} onChange={(e) => setF({ ...f, unitPrice: e.target.value })} /></Field></div>
      </div>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Add Item'}</button>
    </form>
  );
}

function AssetForm({ onSave, saving }) {
  const [f, setF] = useState({ name: '', assetTag: '', category: 'general', purchaseCost: '', notes: '' });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ ...f, purchaseCost: f.purchaseCost ? Number(f.purchaseCost) : null }); }}>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Asset tag"><input className="input" value={f.assetTag} onChange={(e) => setF({ ...f, assetTag: e.target.value })} placeholder="AST-001" /></Field>
        <Field label="Category">
          <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {['general', 'furniture', 'it', 'appliance', 'vehicle'].map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
          </select>
        </Field>
        <Field label="Purchase cost (Rs)"><input type="number" min="0" className="input" value={f.purchaseCost} onChange={(e) => setF({ ...f, purchaseCost: e.target.value })} /></Field>
        <div className="col-span-2"><Field label="Notes"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
      </div>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Add Asset'}</button>
    </form>
  );
}

export default function InventoryPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'manager', 'operations_manager']);
  const [tab, setTab] = useState('items');
  const [items, setItems] = useState([]);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showItemForm, setShowItemForm] = useState(false);
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [moveItem, setMoveItem] = useState(null);
  const [moveQty, setMoveQty] = useState(1);
  const [moveType, setMoveType] = useState('in');

  const load = () => {
    setLoading(true);
    Promise.all([api.get('/inventory/items'), api.get('/inventory/assets')])
      .then(([i, a]) => { setItems(i.items || []); setAssets(a.assets || []); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (allowed) load(); }, [allowed]);

  if (!allowed) return <AccessDenied />;

  const addItem = async (data) => {
    setSaving(true);
    try { await api.post('/inventory/items', data); setShowItemForm(false); load(); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  const addAsset = async (data) => {
    setSaving(true);
    try { await api.post('/inventory/assets', data); setShowAssetForm(false); load(); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  const doMove = async () => {
    try {
      await api.post(`/inventory/items/${moveItem.id}/movements`, { type: moveType, quantity: Number(moveQty) });
      setMoveItem(null); setMoveQty(1); load();
    } catch (e) { setError(e.message); }
  };
  const setAssetStatus = async (id, status) => {
    try { await api.patch(`/inventory/assets/${id}`, { status }); load(); }
    catch (e) { setError(e.message); }
  };

  const lowStock = items.filter((i) => i.quantity <= i.reorderLevel);

  const itemCols = [
    { key: 'name', label: 'Item', render: (i) => {
      const low = i.quantity <= i.reorderLevel;
      return (
        <div>
          <div className="font-medium text-gray-900 flex items-center gap-2">
            {i.name}
            {low && <Badge tone="red">LOW</Badge>}
          </div>
          <div className="text-xs text-gray-500 capitalize">{i.category}{i.sku ? ` · ${i.sku}` : ''} · reorder at {i.reorderLevel}</div>
        </div>
      );
    } },
    { key: 'qty', label: 'Stock', render: (i) => <span className={`font-bold ${i.quantity <= i.reorderLevel ? 'text-red-700' : 'text-emerald-700'}`}>{i.quantity} {i.unit}</span> },
    { key: 'price', label: 'Unit Price', render: (i) => <span className="text-sm text-gray-600">{i.unitPrice ? money(i.unitPrice) : '—'}</span> },
    { key: 'action', label: '', render: (i) => <button className="btn-secondary text-xs px-2 py-1" onClick={() => setMoveItem(i)}>Stock In/Out</button> },
  ];
  const assetCols = [
    { key: 'name', label: 'Asset', render: (a) => <div><div className="font-medium text-gray-900">{a.name}</div><div className="text-xs text-gray-500 capitalize">{a.category}{a.assetTag ? ` · ${a.assetTag}` : ''}</div></div> },
    { key: 'status', label: 'Status', render: (a) => <Badge tone={ASSET_TONES[a.status]}>{a.status.replace('_', ' ')}</Badge> },
    { key: 'cost', label: 'Cost', render: (a) => <span className="text-sm text-gray-600">{a.purchaseCost ? money(a.purchaseCost) : '—'}</span> },
    { key: 'unit', label: 'Location', render: (a) => <span className="text-sm text-gray-600">{a.unit?.code || '—'}</span> },
    {
      key: 'action', label: '', render: (a) => (
        <select className="input text-xs py-1" value={a.status} onChange={(e) => setAssetStatus(a.id, e.target.value)}>
          {Object.keys(ASSET_TONES).map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Inventory & Assets"
        subtitle={lowStock.length ? `⚠️ ${lowStock.length} item(s) low on stock` : 'Stock levels healthy'}
        action={tab === 'items'
          ? <button className="btn-primary" onClick={() => setShowItemForm(true)}>+ Add Item</button>
          : <button className="btn-primary" onClick={() => setShowAssetForm(true)}>+ Add Asset</button>}
      />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      {/* Phase 29: low-stock alert banner */}
      {!loading && tab === 'items' && lowStock.length > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-red-500/40 bg-red-50 px-4 py-3">
          <span className="text-xl">⚠️</span>
          <div className="flex-1">
            <div className="text-sm font-semibold text-red-700">{lowStock.length} item{lowStock.length > 1 ? 's' : ''} low on stock</div>
            <div className="text-xs text-red-700/70 truncate">
              {lowStock.slice(0, 3).map((i) => i.name).join(', ')}{lowStock.length > 3 ? ` +${lowStock.length - 3} more` : ''}
            </div>
          </div>
        </div>
      )}
      <div className="flex gap-2 mb-4">
        {[['items', `Inventory (${items.length})`], ['assets', `Assets (${assets.length})`]].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium border ${tab === v ? 'border-teal-500/60 bg-teal-600/20 text-violet-700' : 'border-gray-200 text-gray-500 hover:bg-gray-100'}`}>
            {l}
          </button>
        ))}
      </div>
      {loading ? <Spinner /> : tab === 'items'
        ? <DataTable columns={itemCols} rows={items} emptyText="No inventory items." />
        : <DataTable columns={assetCols} rows={assets} emptyText="No assets." />}
      {showItemForm && <Modal title="Add Inventory Item" onClose={() => setShowItemForm(false)}><ItemForm onSave={addItem} saving={saving} /></Modal>}
      {showAssetForm && <Modal title="Add Asset" onClose={() => setShowAssetForm(false)}><AssetForm onSave={addAsset} saving={saving} /></Modal>}
      {moveItem && (
        <Modal title={`Stock movement — ${moveItem.name}`} onClose={() => setMoveItem(null)}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select className="input" value={moveType} onChange={(e) => setMoveType(e.target.value)}>
                <option value="in">Stock In</option>
                <option value="out">Stock Out</option>
              </select>
            </Field>
            <Field label="Quantity"><input type="number" min="1" className="input" value={moveQty} onChange={(e) => setMoveQty(e.target.value)} /></Field>
          </div>
          <div className="text-sm text-gray-500 mb-3">Current stock: <span className="text-gray-900 font-bold">{moveItem.quantity}</span></div>
          <button className="btn-primary w-full" onClick={doMove}>Confirm</button>
        </Modal>
      )}
    </div>
  );
}
