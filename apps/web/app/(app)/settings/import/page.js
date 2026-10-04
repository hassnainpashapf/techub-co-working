'use client';

import { useState } from 'react';
import { API_BASE, getTokens } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const TABS = [
  { key: 'members', label: 'Members', template: '/import/templates/members', file: 'members-template.csv' },
  { key: 'units', label: 'Units', template: '/import/templates/units', file: 'units-template.csv' },
];

function parsePreview(text, maxRows = 5) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  return lines.slice(0, maxRows + 1).map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, '')));
}

async function authFetch(path, opts = {}) {
  const { access } = getTokens();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { ...(opts.headers || {}), ...(access ? { Authorization: `Bearer ${access}` } : {}) },
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const d = await res.json(); msg = d?.error?.message || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res;
}

export default function ImportPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'manager', 'super_admin']);
  const [tab, setTab] = useState('members');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!allowed) return <AccessDenied />;

  const active = TABS.find((t) => t.key === tab);

  const downloadTemplate = async () => {
    setError('');
    try {
      const res = await authFetch(active.template);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = active.file; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(e.message); }
  };

  const onFile = async (f) => {
    setFile(f); setResult(null); setError('');
    if (!f) { setPreview([]); return; }
    const text = await f.text();
    setPreview(parsePreview(text));
  };

  const doImport = async () => {
    if (!file) return setError('Please choose a CSV file first.');
    setBusy(true); setError(''); setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await authFetch(`/import/${tab}`, { method: 'POST', body: fd });
      const data = await res.json();
      setResult(data);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title="Import Data" sub="Bulk import members and units from CSV files." />

      <div className="flex gap-2 mb-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setFile(null); setPreview([]); setResult(null); setError(''); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium border ${tab === t.key ? 'bg-[#7c3aed]/20 text-[#c4b5fd] border-[#8b5cf6]/40' : 'text-slate-400 border-white/10 hover:text-white'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4"><ErrorBanner message={error} /></div>}

      <div className="card-premium p-6 mb-6">
        <h3 className="text-white font-semibold mb-2">1. Download template</h3>
        <p className="text-sm text-slate-400 mb-4">Use the template so columns match. First row must be the header row.</p>
        <button onClick={downloadTemplate} className="btn-secondary">⬇ Download {active.label} template</button>
      </div>

      <div className="card-premium p-6 mb-6">
        <h3 className="text-white font-semibold mb-2">2. Choose CSV file</h3>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => onFile(e.target.files?.[0] || null)}
          className="text-sm text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-[#7c3aed]/20 file:text-[#c4b5fd] hover:file:bg-[#7c3aed]/30"
        />
        {preview.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <p className="text-xs text-slate-400 mb-2">Preview (first {preview.length - 1} data rows):</p>
            <table className="w-full text-sm">
              <thead>
                <tr>{preview[0].map((h, i) => <th key={i} className="text-left text-xs text-slate-400 font-semibold px-2 py-1 border-b border-white/10">{h}</th>)}</tr>
              </thead>
              <tbody>
                {preview.slice(1).map((r, i) => (
                  <tr key={i} className="border-b border-white/5">
                    {r.map((c, j) => <td key={j} className="px-2 py-1.5 text-slate-300">{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card-premium p-6">
        <h3 className="text-white font-semibold mb-2">3. Import</h3>
        <button onClick={doImport} disabled={busy || !file} className="btn-primary disabled:opacity-50">
          {busy ? 'Importing…' : `Import ${active.label}`}
        </button>
        {result && (
          <div className="mt-4">
            <div className="flex gap-4 text-sm mb-3">
              <span className="text-emerald-300 font-semibold">✅ Imported: {result.imported}</span>
              <span className="text-amber-300 font-semibold">⏭ Skipped (duplicates): {result.skipped}</span>
              <span className="text-red-300 font-semibold">❌ Errors: {(result.errors || []).length}</span>
            </div>
            {(result.errors || []).length > 0 && (
              <div className="max-h-48 overflow-y-auto bg-black/30 rounded-lg p-3">
                {result.errors.map((e, i) => (
                  <div key={i} className="text-xs text-red-300 py-0.5">Row {e.row}: {e.message}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
