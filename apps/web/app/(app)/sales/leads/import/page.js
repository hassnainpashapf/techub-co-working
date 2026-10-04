'use client';

// Phase 39 Track 10/10: Bulk lead import — upload → validate → assign salesperson → confirm.
// Reuses the member import (phase 38) pattern.
import { useEffect, useRef, useState } from 'react';
import { api, apiUpload, apiDownload } from '../../../../../lib/api';
import { PageHeader, StatCard, Field, Badge, Spinner, EmptyState, ErrorBanner } from '../../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../../components/Protected';

const FIELDS = [
  { value: 'name', label: 'Name (required)' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'company', label: 'Company' },
  { value: 'source', label: 'Source (walkin/website/referral/social/other)' },
  { value: 'interestedIn', label: 'Interested in' },
  { value: 'budget', label: 'Budget' },
  { value: 'notes', label: 'Notes' },
  { value: '', label: '— Ignore column —' },
];

export default function LeadImportPage() {
  const { allowed, loading: roleLoading } = useRequireRoles('ceo', 'admin', 'super_admin', 'manager');
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);
  const [mapping, setMapping] = useState({});
  const [filter, setFilter] = useState('all'); // all | valid | invalid
  const [assignTo, setAssignTo] = useState('');
  const [team, setTeam] = useState([]);
  const [result, setResult] = useState(null);
  const [fileName, setFileName] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    if (!allowed) return;
    api('/users').then((r) => {
      const list = r.users || r || [];
      setTeam(Array.isArray(list) ? list.filter((u) => ['ceo', 'admin', 'super_admin', 'manager', 'receptionist'].includes(u.role)) : []);
    }).catch(() => { /* manager may not have user-list access — assignment stays optional */ });
  }, [allowed]);

  async function handleFile(file) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      setError('Please choose a .csv file.');
      return;
    }
    setError('');
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (Object.keys(mapping).length) fd.append('mapping', JSON.stringify(mapping));
      const r = await apiUpload('/lead-import/upload', fd);
      setReport(r);
      setMapping(r.suggestedMapping || {});
      setFileName(file.name);
      setFilter('all');
    } catch (e) {
      setError(e.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function remapAndRevalidate() {
    if (fileRef.current?.files?.[0]) {
      await handleFile(fileRef.current.files[0]);
    }
  }

  async function confirmImport() {
    const rows = (report?.rows || []).filter((x) => x.valid).map((x) => ({
      row: x.row,
      name: x.data.name,
      email: x.data.email,
      phone: x.data.phone,
      company: x.data.company,
      source: x.data.source,
      interestedIn: x.data.interestedIn,
      budget: x.data.budget,
      notes: x.data.notes,
    }));
    if (!rows.length) {
      setError('No valid rows to import.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const r = await api.post('/lead-import/confirm', { rows, assignTo: assignTo || undefined });
      setResult(r);
    } catch (e) {
      setError(e.message || 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setReport(null);
    setResult(null);
    setMapping({});
    setError('');
    setFileName('');
    setAssignTo('');
    if (fileRef.current) fileRef.current.value = '';
  }

  if (roleLoading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  if (!allowed) return <AccessDenied />;

  const rows = report?.rows || [];
  const shown = rows.filter((x) =>
    filter === 'all' ? true : filter === 'valid' ? x.valid : !x.valid
  );

  return (
    <div>
      <PageHeader
        title="Import Leads"
        sub="Upload a CSV, review validation, assign a salesperson, then confirm."
        actions={
          <button
            onClick={() => apiDownload('/lead-import/template', 'leads-import-template.csv').catch((e) => setError(e.message))}
            className="btn-secondary text-sm"
          >
            ⬇ Template CSV
          </button>
        }
      />

      {error && <ErrorBanner message={error} onRetry={() => setError('')} />}

      {/* Step 1 — upload */}
      {!report && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
          onClick={() => fileRef.current?.click()}
          className={`card-premium p-10 text-center cursor-pointer border-2 border-dashed transition ${
            dragOver ? 'border-[#0f766e] bg-[#0f766e]/10' : 'border-gray-200 hover:border-white/25'
          }`}
        >
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])} />
          {busy ? <Spinner size="lg" /> : (
            <>
              <p className="text-4xl mb-3">📥</p>
              <p className="text-gray-900 font-semibold mb-1">Drop your CSV here or click to browse</p>
              <p className="text-gray-500 text-sm">Max 2 MB · up to 1000 rows · columns: name, email, phone, company, source, interestedIn, budget, notes</p>
            </>
          )}
        </div>
      )}

      {/* Step 2 — validation report */}
      {report && !result && (
        <>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <StatCard label="Total rows" value={report.total} accent="blue" />
            <StatCard label="Valid" value={report.valid} accent="emerald" />
            <StatCard label="Invalid" value={report.invalid} accent={report.invalid > 0 ? 'red' : 'slate'} />
          </div>

          {/* Column mapping */}
          <div className="card-premium p-5 mb-6">
            <h2 className="text-gray-900 font-bold mb-1">Column mapping</h2>
            <p className="text-gray-500 text-xs mb-4">File: <span className="text-gray-800">{fileName}</span> — adjust any column, then re-validate.</p>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              {report.headers.map((h) => (
                <Field key={h} label={`"${h}"`}>
                  <select
                    className="input"
                    value={mapping[h] || ''}
                    onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}
                  >
                    {FIELDS.map((f) => <option key={f.value || 'x'} value={f.value}>{f.label}</option>)}
                  </select>
                </Field>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={remapAndRevalidate} disabled={busy} className="btn-secondary text-sm">
                {busy ? 'Validating…' : '↻ Re-validate with this mapping'}
              </button>
              <button onClick={reset} className="text-sm text-gray-500 hover:text-gray-800 underline">
                Start over
              </button>
            </div>
          </div>

          {/* Preview */}
          <div className="card-premium p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-gray-900 font-bold">Row preview</h2>
              <div className="flex gap-1 text-xs">
                {['all', 'valid', 'invalid'].map((f) => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`px-3 py-1.5 rounded-lg capitalize ${filter === f ? 'bg-[#0f766e]/70 text-white' : 'text-gray-500 hover:text-gray-900'}`}>
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="text-left text-gray-500 text-xs border-b border-gray-200">
                    <th className="py-2 pr-3">Row</th>
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3">Email</th>
                    <th className="py-2 pr-3">Phone</th>
                    <th className="py-2 pr-3">Company</th>
                    <th className="py-2 pr-3">Interested in</th>
                    <th className="py-2 pr-3">Budget</th>
                    <th className="py-2 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, 200).map((x) => (
                    <tr key={x.row} className={`border-b border-gray-200 ${x.valid ? '' : 'bg-red-500/[0.04]'}`}>
                      <td className="py-2 pr-3 text-slate-500">{x.row}</td>
                      <td className="py-2 pr-3 text-gray-900">{x.data.name || '—'}</td>
                      <td className="py-2 pr-3 text-gray-600">{x.data.email || '—'}</td>
                      <td className="py-2 pr-3 text-gray-600">{x.data.phone || '—'}</td>
                      <td className="py-2 pr-3 text-gray-600">{x.data.company || '—'}</td>
                      <td className="py-2 pr-3 text-gray-600">{x.data.interestedIn || '—'}</td>
                      <td className="py-2 pr-3 text-gray-600">{x.data.budget || '—'}</td>
                      <td className="py-2 pr-3">
                        {x.valid
                          ? <Badge tone="emerald">Valid</Badge>
                          : <Badge tone="red">Invalid</Badge>}
                        {x.errors.map((e, i) => <p key={i} className="text-red-300 text-xs mt-1">⚠ {e}</p>)}
                        {x.warnings.map((w, i) => <p key={i} className="text-amber-300 text-xs mt-1">⚠ {w}</p>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length > 200 && <p className="text-slate-500 text-xs mt-3">Showing first 200 of {shown.length} rows.</p>}
              {shown.length === 0 && <EmptyState title="No rows" hint="Try a different filter." />}
            </div>
          </div>

          {/* Confirm */}
          <div className="card-premium p-5">
            <Field label="Assign salesperson (optional)">
              <select className="input max-w-sm" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                <option value="">— Unassigned —</option>
                {team.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                ))}
              </select>
            </Field>
            <div className="flex gap-2 mt-4">
              <button onClick={confirmImport} disabled={busy || report.valid === 0} className="btn-primary">
                {busy ? 'Importing…' : `✓ Import ${report.valid} valid lead${report.valid === 1 ? '' : 's'}`}
              </button>
              <button onClick={reset} className="btn-secondary">Cancel</button>
            </div>
            <p className="text-slate-500 text-xs mt-3">Imported leads start in the “New” stage with source “import”. Duplicates (email/phone already in the system) are skipped and counted in the summary.</p>
          </div>
        </>
      )}

      {/* Step 3 — result */}
      {result && (
        <div className="card-premium p-6">
          <h2 className="text-gray-900 font-bold text-lg mb-4">Import complete ✅</h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <StatCard label="Imported" value={result.imported} accent="emerald" />
            <StatCard label="Skipped" value={result.skipped} accent="amber" />
            <StatCard label="Errors" value={result.errors?.length || 0} accent={result.errors?.length ? 'red' : 'slate'} />
          </div>
          {result.errors?.length > 0 && (
            <div className="mb-4">
              <p className="text-sm font-semibold text-red-300 mb-2">Errors</p>
              {result.errors.slice(0, 50).map((e, i) => (
                <p key={i} className="text-red-300 text-xs">Row {e.row}: {e.message}</p>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <a href="/sales/leads" className="btn-primary text-sm">View leads →</a>
            <button onClick={reset} className="btn-secondary text-sm">Import another file</button>
          </div>
        </div>
      )}
    </div>
  );
}
