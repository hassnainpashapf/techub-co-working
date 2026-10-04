'use client';

import { useRef, useState } from 'react';
import { api, apiUpload, apiDownload } from '../../../../lib/api';
import { PageHeader, StatCard, Modal, Field, Badge, Spinner, EmptyState, ErrorBanner } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const FIELDS = [
  { value: 'name', label: 'Name (required)' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone (required)' },
  { value: 'company', label: 'Company' },
  { value: 'plan', label: 'Plan' },
  { value: 'status', label: 'Status' },
  { value: '', label: '— Ignore column —' },
];

export default function MemberImportPage() {
  const { allowed, loading: roleLoading } = useRequireRoles('ceo', 'admin', 'super_admin');
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);
  const [mapping, setMapping] = useState({});
  const [filter, setFilter] = useState('all'); // all | valid | invalid
  const [sendWelcome, setSendWelcome] = useState(false);
  const [result, setResult] = useState(null);
  const [fileName, setFileName] = useState('');
  const fileRef = useRef(null);

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
      const r = await apiUpload('/member-import/upload', fd);
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
    // Re-upload is cheapest: the backend accepts a mapping override.
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
      status: x.data.status,
      planName: x.data.planName,
      planId: x.data.planId,
    }));
    if (!rows.length) {
      setError('No valid rows to import.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const r = await api.post('/member-import/confirm', { rows, sendWelcomeEmail: sendWelcome });
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
    setSendWelcome(false);
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
        title="Import Members"
        sub="Upload a CSV, review validation, map columns, then confirm."
        actions={
          <button
            onClick={() => apiDownload('/member-import/template', 'members-import-template.csv').catch((e) => setError(e.message))}
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
            dragOver ? 'border-[#0f766e] bg-[#0f766e]/10' : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])} />
          {busy ? <Spinner size="lg" /> : (
            <>
              <p className="text-4xl mb-3">📥</p>
              <p className="text-gray-900 font-semibold mb-1">Drop your CSV here or click to browse</p>
              <p className="text-gray-500 text-sm">Max 2 MB · up to 1000 rows · columns: name, email, phone, company, plan, status</p>
            </>
          )}
        </div>
      )}

      {/* Step 2 — validation report */}
      {report && !result && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <StatCard label="Total rows" value={report.total} accent="blue" />
            <StatCard label="Valid" value={report.valid} accent="emerald" />
            <StatCard label="Invalid" value={report.invalid} accent={report.invalid > 0 ? 'red' : 'slate'} />
          </div>

          {/* Column mapping */}
          <div className="card-premium p-5 mb-3">
            <h2 className="text-gray-900 font-bold mb-1">Column mapping</h2>
            <p className="text-gray-500 text-xs mb-3">File: <span className="text-gray-800">{fileName}</span> — adjust any column, then re-validate.</p>
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
            <div className="flex gap-2 mt-3">
              <button onClick={remapAndRevalidate} disabled={busy} className="btn-secondary text-sm">
                {busy ? 'Validating…' : '↻ Re-validate with this mapping'}
              </button>
              <button onClick={reset} className="text-sm text-gray-500 hover:text-gray-800 underline">
                Start over
              </button>
            </div>
          </div>

          {/* Preview */}
          <div className="card-premium p-5 mb-3">
            <div className="flex items-center justify-between mb-3">
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
            <div className="overflow-x-auto -mx-5 px-4">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="text-left text-gray-500 text-xs border-b border-gray-200">
                    <th className="py-2 pr-3">Row</th>
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3">Email</th>
                    <th className="py-2 pr-3">Phone</th>
                    <th className="py-2 pr-3">Company</th>
                    <th className="py-2 pr-3">Plan</th>
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
                      <td className="py-2 pr-3 text-gray-600">{x.data.planName || '—'}</td>
                      <td className="py-2 pr-3">
                        {x.valid
                          ? <Badge tone="emerald">Valid</Badge>
                          : <Badge tone="red">Invalid</Badge>}
                        {x.errors.map((e, i) => <p key={i} className="text-red-700 text-xs mt-1">⚠ {e}</p>)}
                        {x.warnings.map((w, i) => <p key={i} className="text-amber-700 text-xs mt-1">⚠ {w}</p>)}
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
            <label className="flex items-center gap-3 mb-3 cursor-pointer">
              <input type="checkbox" checked={sendWelcome} onChange={(e) => setSendWelcome(e.target.checked)}
                className="w-4 h-4 accent-[#0f766e]" />
              <span className="text-sm text-gray-900">Send welcome email to imported members (only those with an email address)</span>
            </label>
            <div className="flex gap-2">
              <button onClick={confirmImport} disabled={busy || report.valid === 0} className="btn-primary">
                {busy ? 'Importing…' : `✓ Import ${report.valid} valid member${report.valid === 1 ? '' : 's'}`}
              </button>
              <button onClick={reset} className="btn-secondary">Cancel</button>
            </div>
            <p className="text-slate-500 text-xs mt-3">Duplicates (email/phone already in the system) are skipped and counted in the summary.</p>
          </div>
        </>
      )}

      {/* Step 3 — result */}
      {result && (
        <div className="card-premium p-6">
          <h2 className="text-gray-900 font-bold text-lg mb-3">Import complete ✅</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <StatCard label="Imported" value={result.imported} accent="emerald" />
            <StatCard label="Skipped" value={result.skipped} accent="amber" />
            <StatCard label="Welcome emails" value={result.emailsQueued} accent="blue" />
            <StatCard label="Errors" value={result.errors?.length || 0} accent={result.errors?.length ? 'red' : 'slate'} />
          </div>
          {result.errors?.length > 0 && (
            <div className="mb-3">
              <p className="text-sm font-semibold text-red-700 mb-2">Errors</p>
              {result.errors.slice(0, 50).map((e, i) => (
                <p key={i} className="text-red-700 text-xs">Row {e.row}: {e.message}</p>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <a href="/members" className="btn-primary text-sm">View members →</a>
            <button onClick={reset} className="btn-secondary text-sm">Import another file</button>
          </div>
        </div>
      )}
    </div>
  );
}
