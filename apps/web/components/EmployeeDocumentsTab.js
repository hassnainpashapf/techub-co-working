'use client';

// Phase 42 Track 9: HR documents vault tab (employee profile).
import { useEffect, useRef, useState } from 'react';
import { API_BASE, getTokens, api } from '../lib/api';
import { Badge, EmptyState, Spinner, ErrorBanner } from './ui';

const TYPES = [
  { value: 'offer_letter', label: 'Offer letter' },
  { value: 'contract', label: 'Contract' },
  { value: 'cnic', label: 'CNIC' },
  { value: 'police_verification', label: 'Police verification' },
  { value: 'other', label: 'Other' },
];

function expiryBadge(ex) {
  if (!ex || !ex.status) return <Badge tone="slate">—</Badge>;
  if (ex.status === 'expired') return <Badge tone="red">Expired</Badge>;
  if (ex.status === 'due_soon') return <Badge tone="amber">{ex.daysLeft}d left</Badge>;
  return <Badge tone="green">Valid</Badge>;
}

export default function EmployeeDocumentsTab({ employeeId }) {
  const [docs, setDocs] = useState([]);
  const [missing, setMissing] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [uploading, setUploading] = useState(false);
  const [type, setType] = useState('contract');
  const [expiresAt, setExpiresAt] = useState('');
  const fileRef = useRef(null);

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const d = await api(`/hr-documents/employee/${employeeId}`);
      setDocs(d.documents || []); setMissing(d.missing || []);
    } catch (e) { setErr(e.message || 'Load failed'); }
    setLoading(false);
  };
  useEffect(() => { load(); }, [employeeId]);

  const upload = async () => {
    const f = fileRef.current && fileRef.current.files && fileRef.current.files[0];
    if (!f) { setErr('File select karo'); return; }
    setUploading(true); setErr('');
    try {
      const { access } = getTokens();
      const fd = new FormData();
      fd.append('file', f);
      fd.append('employeeId', employeeId);
      fd.append('type', type);
      if (expiresAt) fd.append('expiresAt', expiresAt);
      const res = await fetch(`${API_BASE}/hr-documents/upload`, {
        method: 'POST',
        headers: access ? { Authorization: `Bearer ${access}` } : {},
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data.error && (data.error.message || data.error)) || 'Upload failed');
      setExpiresAt(''); if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e) { setErr(e.message); }
    setUploading(false);
  };

  if (loading) return <div className="py-6"><Spinner /></div>;

  return (
    <div className="text-sm space-y-4">
      {err && <ErrorBanner message={err} />}
      {missing.length > 0 && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">
          ⚠️ Missing documents: {missing.join(', ')}
        </div>
      )}
      <div>
        <h4 className="font-semibold text-gray-800 mb-2">Documents ({docs.length})</h4>
        {docs.length === 0 ? (
          <EmptyState title="Koi document nahi" hint="Upar se upload karo." />
        ) : (
          <div className="space-y-2">
            {docs.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-gray-100/60 border border-gray-200/50">
                <div>
                  <div className="text-gray-800 font-medium">{d.title || d.fileName}</div>
                  <div className="text-xs text-slate-500">{(d.category || '').replace('hr:', '')}{d.uploadedBy ? ` · ${d.uploadedBy.name}` : ''}</div>
                </div>
                {expiryBadge(d.expiry)}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="p-3 rounded-lg bg-gray-100/60 border border-gray-200/50">
        <h4 className="font-semibold text-gray-800 mb-2">Upload document</h4>
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="text-xs text-gray-500">Type</label>
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">Expires (optional)</label>
            <input type="date" className="input" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-500">File</label>
            <input type="file" ref={fileRef} className="input" />
          </div>
          <button className="btn-primary" onClick={upload} disabled={uploading}>
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
