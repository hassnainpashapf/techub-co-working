'use client';

// Phase 30: Saved Filter Views — reusable component.
// Props: page (string), currentFilters (object), onApply (fn(filters)).
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function SavedViews({ page, currentFilters, onApply }) {
  const [views, setViews] = useState([]);
  const [selected, setSelected] = useState('');
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [showSave, setShowSave] = useState(false);

  const load = async () => {
    try {
      const d = await api.get(`/saved-views?page=${encodeURIComponent(page)}`);
      setViews(d.views || []);
    } catch {
      setViews([]);
    }
  };

  useEffect(() => {
    load();
  }, [page]);

  const apply = (id) => {
    setSelected(id);
    const v = views.find((x) => x.id === id);
    if (v && onApply) onApply(v.filters || {});
  };

  const save = async () => {
    const n = name.trim();
    if (!n) return;
    setSaving(true);
    try {
      await api.post('/saved-views', { page, name: n, filters: currentFilters || {} });
      setName('');
      setShowSave(false);
      await load();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    try {
      await api.delete(`/saved-views/${id}`);
      if (selected === id) setSelected('');
      await load();
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex items-center gap-2">
      <select
        className="input !py-1.5 text-[13px] max-w-[180px]"
        value={selected}
        onChange={(e) => apply(e.target.value)}
        title="Saved views"
      >
        <option value="">Saved views…</option>
        {views.map((v) => (
          <option key={v.id} value={v.id}>{v.name}</option>
        ))}
      </select>
      {selected && (
        <button
          className="text-xs text-gray-500 hover:text-red-700"
          onClick={() => remove(selected)}
          title="Delete this view"
        >
          ✕
        </button>
      )}
      {!showSave ? (
        <button className="btn-ghost btn-sm" onClick={() => setShowSave(true)}>
          💾 Save
        </button>
      ) : (
        <div className="flex items-center gap-1">
          <input
            className="input !py-1.5 text-[13px] w-[140px]"
            placeholder="View name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          <button className="btn-primary btn-sm" onClick={save} disabled={saving || !name.trim()}>
            {saving ? '…' : 'Save'}
          </button>
          <button className="btn-ghost btn-sm" onClick={() => { setShowSave(false); setName(''); }}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
