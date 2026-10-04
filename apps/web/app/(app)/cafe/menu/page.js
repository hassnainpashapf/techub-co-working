'use client';

// Phase 43 Track 1: Menu Management — staff menu builder (categories + items, prices, availability).
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, Modal, Field, Spinner, EmptyState, ErrorBanner, Badge } from '../../../../components/ui';

const TAGS = [
  { value: 'veg', label: '🟢 Veg' },
  { value: 'non_veg', label: '🔴 Non-Veg' },
  { value: 'vegan', label: '🌱 Vegan' },
  { value: 'spicy', label: '🌶️ Spicy' },
  { value: 'gluten_free', label: '🌾 Gluten-Free' },
  { value: 'bestseller', label: '⭐ Bestseller' },
];
const tagLabel = (t) => (TAGS.find((x) => x.value === t) || {}).label || t;

const emptyCat = { name: '', sortOrder: 0, isActive: true };
const emptyItem = { categoryId: '', name: '', description: '', price: '', imageUrl: '', isAvailable: true, tags: [], prepTimeMin: '' };

export default function CafeMenuPage() {
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [selCat, setSelCat] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [catModal, setCatModal] = useState(null); // null | 'add' | category
  const [itemModal, setItemModal] = useState(null); // null | 'add' | item
  const [catForm, setCatForm] = useState(emptyCat);
  const [itemForm, setItemForm] = useState(emptyItem);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [c, i] = await Promise.all([api.get('/menu/categories'), api.get('/menu/items')]);
      setCategories(c.categories || []);
      setItems(i.items || []);
    } catch (e) {
      setError(e.message || 'Menu load nahi ho saka');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const filteredItems = items.filter((it) => {
    if (selCat !== 'all' && it.categoryId !== selCat) return false;
    if (search && !it.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // ---- category CRUD ----
  function openCatAdd() { setCatForm(emptyCat); setCatModal('add'); }
  function openCatEdit(c) { setCatForm({ name: c.name, sortOrder: c.sortOrder, isActive: c.isActive }); setCatModal(c); }
  async function saveCat() {
    setSaving(true);
    try {
      if (catModal === 'add') await api.post('/menu/categories', catForm);
      else await api.patch(`/menu/categories/${catModal.id}`, catForm);
      setCatModal(null);
      load();
    } catch (e) { setError(e.message || 'Category save nahi ho saki'); }
    finally { setSaving(false); }
  }
  async function deleteCat(c) {
    if (!confirm(`"${c.name}" delete karein? Is ke saare items bhi delete ho jayenge.`)) return;
    try { await api.delete(`/menu/categories/${c.id}`); if (selCat === c.id) setSelCat('all'); load(); }
    catch (e) { setError(e.message || 'Delete nahi ho saki'); }
  }

  // ---- item CRUD ----
  function openItemAdd() { setItemForm({ ...emptyItem, categoryId: selCat === 'all' ? (categories[0] || {}).id || '' : selCat }); setItemModal('add'); }
  function openItemEdit(it) {
    setItemForm({
      categoryId: it.categoryId, name: it.name, description: it.description || '',
      price: it.price, imageUrl: it.imageUrl || '', isAvailable: it.isAvailable,
      tags: it.tags || [], prepTimeMin: it.prepTimeMin ?? '',
    });
    setItemModal(it);
  }
  async function saveItem() {
    if (!itemForm.categoryId) { setError('Category select karein'); return; }
    setSaving(true);
    try {
      const payload = {
        ...itemForm,
        price: Number(itemForm.price),
        prepTimeMin: itemForm.prepTimeMin === '' ? null : Number(itemForm.prepTimeMin),
      };
      if (itemModal === 'add') await api.post('/menu/items', payload);
      else await api.patch(`/menu/items/${itemModal.id}`, payload);
      setItemModal(null);
      load();
    } catch (e) { setError(e.message || 'Item save nahi ho saka'); }
    finally { setSaving(false); }
  }
  async function toggleAvail(it) {
    try { await api.patch(`/menu/items/${it.id}/availability`); load(); }
    catch (e) { setError(e.message || 'Toggle nahi ho saka'); }
  }
  async function deleteItem(it) {
    if (!confirm(`"${it.name}" delete karein?`)) return;
    try { await api.delete(`/menu/items/${it.id}`); load(); }
    catch (e) { setError(e.message || 'Delete nahi ho saka'); }
  }

  const availableCount = items.filter((i) => i.isAvailable).length;

  if (loading) return <Spinner />;
  return (
    <div className="space-y-4">
      <PageHeader title="🍽️ Cafe Menu" subtitle="Categories aur menu items manage karein" />

      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Categories" value={categories.length} />
        <StatCard label="Total Items" value={items.length} />
        <StatCard label="Available" value={availableCount} />
        <StatCard label="Unavailable" value={items.length - availableCount} />
      </div>

      <div className="grid md:grid-cols-[240px_1fr] gap-4">
        {/* Categories column */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 h-fit">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Categories</h3>
            <button onClick={openCatAdd} className="text-sm px-3 py-1.5 rounded-lg bg-[#0f766e] text-white hover:bg-[#0f766e]">+ Add</button>
          </div>
          <div className="space-y-1">
            <button
              onClick={() => setSelCat('all')}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm ${selCat === 'all' ? 'bg-[#0f766e]/20 border border-[#0f766e]/40 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >🍽️ All Items ({items.length})</button>
            {categories.map((c) => (
              <div key={c.id} className={`flex items-center gap-1 px-1 py-1 rounded-lg ${selCat === c.id ? 'bg-[#0f766e]/20 border border-[#0f766e]/40' : ''}`}>
                <button onClick={() => setSelCat(c.id)} className="flex-1 text-left px-2 py-1 text-sm text-gray-800 truncate">
                  {c.name} <span className="text-slate-500">({c._count?.items ?? 0})</span>
                  {!c.isActive && <span className="text-amber-400"> ⏸</span>}
                </button>
                <button onClick={() => openCatEdit(c)} className="text-gray-500 hover:text-gray-900 text-xs px-1">✏️</button>
                <button onClick={() => deleteCat(c)} className="text-gray-500 hover:text-red-400 text-xs px-1">🗑️</button>
              </div>
            ))}
            {categories.length === 0 && <EmptyState title="Koi category nahi" />}
          </div>
        </div>

        {/* Items column */}
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Item search..."
              className="flex-1 min-w-[180px] px-4 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 text-sm focus:outline-none focus:border-[#0f766e]"
            />
            <button onClick={openItemAdd} className="px-4 py-2 rounded-lg bg-[#0f766e] text-white text-sm hover:bg-[#0f766e]">+ Add Item</button>
          </div>

          {filteredItems.length === 0 ? (
            <EmptyState title="Koi item nahi mila" />
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredItems.map((it) => (
                <div key={it.id} className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-gray-900">{it.name}</div>
                      <div className="text-xs text-gray-500">{it.category?.name}</div>
                    </div>
                    <button
                      onClick={() => toggleAvail(it)}
                      title={it.isAvailable ? 'Unavailable karein' : 'Available karein'}
                      className={`text-xs px-2.5 py-1 rounded-full ${it.isAvailable ? 'bg-emerald-500/20 text-emerald-700' : 'bg-slate-500/20 text-gray-500'}`}
                    >{it.isAvailable ? '● Available' : '○ Off'}</button>
                  </div>
                  {it.description && <p className="text-sm text-gray-500 line-clamp-2">{it.description}</p>}
                  <div className="flex flex-wrap gap-1">
                    {(it.tags || []).map((t) => <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{tagLabel(t)}</span>)}
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <div className="text-lg font-bold text-gray-900">Rs {Number(it.price).toLocaleString()}</div>
                    <div className="flex gap-1">
                      <button onClick={() => openItemEdit(it)} className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-100">✏️ Edit</button>
                      <button onClick={() => deleteItem(it)} className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-red-400 hover:bg-red-500/20">🗑️</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Category modal */}
      {catModal && (
        <Modal title={catModal === 'add' ? 'Nayi Category' : 'Category Edit'} onClose={() => setCatModal(null)}>
          <div className="space-y-4">
            <Field label="Name"><input value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 text-sm" /></Field>
            <Field label="Sort Order"><input type="number" value={catForm.sortOrder} onChange={(e) => setCatForm({ ...catForm, sortOrder: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 text-sm" /></Field>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={catForm.isActive} onChange={(e) => setCatForm({ ...catForm, isActive: e.target.checked })} /> Active (menu me dikhe)
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setCatModal(null)} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm">Cancel</button>
              <button onClick={saveCat} disabled={saving} className="px-4 py-2 rounded-lg bg-[#0f766e] text-white text-sm hover:bg-[#0f766e]">{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Item modal */}
      {itemModal && (
        <Modal title={itemModal === 'add' ? 'Naya Item' : 'Item Edit'} onClose={() => setItemModal(null)}>
          <div className="space-y-4">
            <Field label="Category">
              <select value={itemForm.categoryId} onChange={(e) => setItemForm({ ...itemForm, categoryId: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 text-sm">
                <option value="">— Select —</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Name"><input value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 text-sm" /></Field>
            <Field label="Description"><textarea value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} rows={2} className="w-full px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 text-sm" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Price (Rs)"><input type="number" min="0" step="1" value={itemForm.price} onChange={(e) => setItemForm({ ...itemForm, price: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 text-sm" /></Field>
              <Field label="Prep Time (min)"><input type="number" min="0" value={itemForm.prepTimeMin} onChange={(e) => setItemForm({ ...itemForm, prepTimeMin: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 text-sm" /></Field>
            </div>
            <Field label="Image URL"><input value={itemForm.imageUrl} onChange={(e) => setItemForm({ ...itemForm, imageUrl: e.target.value })} placeholder="https://..." className="w-full px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 text-sm" /></Field>
            <Field label="Tags">
              <div className="flex flex-wrap gap-2">
                {TAGS.map((t) => (
                  <button
                    key={t.value} type="button"
                    onClick={() => setItemForm({ ...itemForm, tags: itemForm.tags.includes(t.value) ? itemForm.tags.filter((x) => x !== t.value) : [...itemForm.tags, t.value] })}
                    className={`text-xs px-3 py-1.5 rounded-full border ${itemForm.tags.includes(t.value) ? 'bg-[#0f766e]/30 border-[#0f766e]/50 text-white' : 'bg-gray-100 border-gray-200 text-gray-500'}`}
                  >{t.label}</button>
                ))}
              </div>
            </Field>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={itemForm.isAvailable} onChange={(e) => setItemForm({ ...itemForm, isAvailable: e.target.checked })} /> Available (menu me dikhe)
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setItemModal(null)} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm">Cancel</button>
              <button onClick={saveItem} disabled={saving} className="px-4 py-2 rounded-lg bg-[#0f766e] text-white text-sm hover:bg-[#0f766e]">{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
