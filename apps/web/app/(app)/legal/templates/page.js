'use client';

// Phase 50 Track 1/10: Contract Template Library — list + editor (textarea + variable hints) + preview.

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, EmptyState, Badge, Field, Modal, DataTable } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const CATEGORIES = [
  { value: 'membership', label: 'Membership' },
  { value: 'nda', label: 'NDA' },
  { value: 'employment', label: 'Employment' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'event', label: 'Event' },
];
const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));
const CAT_TONE = { membership: 'blue', nda: 'violet', employment: 'amber', vendor: 'green', event: 'rose' };

const SAMPLE = {
  memberName: 'Ali Raza',
  companyName: 'Techub',
  startDate: '2026-11-01',
  monthlyRent: '45,000',
  unitName: 'Desk D-12',
  today: new Date().toLocaleDateString(),
};

function VarChips({ vars }) {
  if (!vars || !vars.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {vars.map((v) => (
        <code key={v} className="text-[11px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/30">
          {`{{${v}}}`}
        </code>
      ))}
    </div>
  );
}

export default function LegalTemplatesPage() {
  const allowed = useRequireRoles('ceo', 'admin', 'super_admin', 'manager');
  const [templates, setTemplates] = useState([]);
  const [cat, setCat] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null); // full template or null (new)
  const [form, setForm] = useState({ name: '', category: 'membership', body: '', isActive: true });
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState([]);
  const [preview, setPreview] = useState('');
  const [previewVars, setPreviewVars] = useState([]);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const q = cat ? `?category=${cat}` : '';
      const d = await api.get(`/legal-templates${q}`);
      setTemplates(d.templates || []);
    } catch (e) {
      setErr(e.message || 'Load nahi ho saka');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [cat]);

  const openNew = () => {
    setEditing(null);
    setForm({ name: '', category: 'membership', body: '', isActive: true });
    setVersions([]);
    setPreview('');
    setShowModal(true);
  };

  const openEdit = async (id) => {
    try {
      const d = await api.get(`/legal-templates/${id}`);
      const t = d.template;
      setEditing(t);
      setForm({ name: t.name, category: t.category, body: t.body, isActive: t.isActive });
      setPreview('');
      const v = await api.get(`/legal-templates/${id}/versions`);
      setVersions(v.versions || []);
      setShowModal(true);
    } catch (e) {
      setErr(e.message || 'Template nahi khul saka');
    }
  };

  const doPreview = async () => {
    if (!editing) return;
    setLoadingPreview(true);
    try {
      const d = await api.post(`/legal-templates/${editing.id}/preview`, { sample: SAMPLE });
      setPreview(d.preview.body);
      setPreviewVars(d.preview.variables || []);
    } catch (e) {
      setPreview('Preview nahi ban saka: ' + (e.message || ''));
    } finally {
      setLoadingPreview(false);
    }
  };

  const save = async () => {
    if (!form.name.trim() || !form.body.trim()) { setErr('Naam aur body lazmi hain'); return; }
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/legal-templates/${editing.id}`, form);
      } else {
        await api.post('/legal-templates', form);
      }
      setShowModal(false);
      load();
    } catch (e) {
      setErr(e.message || 'Save nahi ho saka');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id, name) => {
    if (!confirm(`"${name}" aur us ke purane versions delete kar dun?`)) return;
    try {
      await api.del(`/legal-templates/${id}`);
      load();
    } catch (e) {
      setErr(e.message || 'Delete nahi ho saka');
    }
  };

  // Phase 50 Track 5: Send for signing
  const [signT, setSignT] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [signForm, setSignForm] = useState({ contractId: '', signerName: '', signerEmail: '', data: {} });
  const [signing, setSigning] = useState(false);
  const [signResult, setSignResult] = useState(null);

  const openSign = async (t) => {
    setSignT(t);
    setSignForm({ contractId: '', signerName: '', signerEmail: '', data: {} });
    setSignResult(null);
    try {
      const d = await api.get('/contracts?limit=100');
      const list = d.contracts || d.items || [];
      setContracts(list.filter((c) => c.status !== 'cancelled'));
    } catch { setContracts([]); }
  };

  const doSign = async () => {
    if (!signForm.contractId || !signForm.signerName.trim() || !signForm.signerEmail.trim()) {
      setErr('Contract, signer ka naam aur email lazmi hain');
      return;
    }
    setSigning(true);
    setErr('');
    try {
      const r = await api.post(`/legal-templates/${signT.id}/send-for-signing`, signForm);
      setSignResult(r);
    } catch (e) {
      setErr(e.message || 'Signing request nahi bhej saka');
    } finally {
      setSigning(false);
    }
  };

  if (!allowed) return <AccessDenied />;

  return (
    <div>
      <PageHeader
        title="📄 Contract Templates"
        sub="Membership, NDA, employment, vendor aur event contracts — {{variables}} ke sath"
        actions={
          <div className="flex gap-2 items-center">
            <select value={cat} onChange={(e) => setCat(e.target.value)} className="input-premium">
              <option value="">Sab categories</option>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <button onClick={openNew} className="btn-primary">+ Naya Template</button>
          </div>
        }
      />

      {err && <ErrorBanner message={err} onRetry={load} />}

      {loading ? <Spinner /> : templates.length === 0 ? (
        <EmptyState title="Koi template nahi" hint="Naya template banayein ya baad me templates aayenge" />
      ) : (
        <DataTable
          columns={['Naam', 'Category', 'Version', 'Variables', 'Status', 'Actions']}
          rows={templates.map((t) => [
            <span key="n" className="font-medium text-white">{t.name}</span>,
            <Badge key="c" tone={CAT_TONE[t.category] || 'slate'}>{CAT_LABEL[t.category] || t.category}</Badge>,
            <Badge key="v" tone="slate">v{t.version}</Badge>,
            <span key="vars" className="text-xs text-slate-400">{(t.variables || []).length} vars</span>,
            t.isActive ? <Badge key="s" tone="green">Active</Badge> : <Badge key="s" tone="slate">Inactive</Badge>,
            <div key="a" className="flex gap-2">
              <button onClick={() => openEdit(t.id)} className="btn-ghost text-xs">✏️ Edit</button>
              <button onClick={() => openSign(t)} className="btn-ghost text-xs">📝 Send for signing</button>
              <button onClick={() => remove(t.id, t.name)} className="btn-ghost text-xs text-rose-300">🗑️</button>
            </div>,
          ])}
          empty="Koi template nahi"
        />
      )}

      {showModal && (
        <Modal title={editing ? `✏️ ${editing.name} (v${editing.version})` : '📄 Naya Contract Template'} onClose={() => setShowModal(false)}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-4">
              <Field label="Naam">
                <input className="input-premium w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Membership Agreement" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category">
                  <select className="input-premium w-full" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </Field>
                <Field label="Status">
                  <select className="input-premium w-full" value={form.isActive ? '1' : '0'} onChange={(e) => setForm({ ...form, isActive: e.target.value === '1' })}>
                    <option value="1">Active</option>
                    <option value="0">Inactive</option>
                  </select>
                </Field>
              </div>
              <Field label="Body — {{variable}} likhein, auto-detect honge">
                <textarea className="input-premium w-full font-mono text-sm" rows={14} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder={"This agreement is between {{companyName}} and {{memberName}} starting {{startDate}}..."} />
              </Field>
              <div className="flex gap-2">
                <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Save ho raha...' : editing ? '💾 Save (nayi version)' : '➕ Banayein'}</button>
                {editing && <button onClick={doPreview} disabled={loadingPreview} className="btn-ghost">{loadingPreview ? '...' : '👁️ Preview'}</button>}
                <button onClick={() => setShowModal(false)} className="btn-ghost">Cancel</button>
              </div>
              {versions.length > 0 && (
                <div className="mt-2">
                  <div className="text-xs text-slate-400 mb-1">🕘 Purani versions (archive):</div>
                  <div className="flex flex-wrap gap-1.5">
                    {versions.map((v) => <Badge key={v.id} tone="slate">v{v.version}</Badge>)}
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-3">
              <div className="text-sm font-medium text-white">Variable hints</div>
              <VarChips vars={editing ? (editing.variables || []) : (form.body.match(/\{\{\s*([\w.]+)\s*\}\}/g) || []).map((m) => m.replace(/[{}]/g, '').trim())} />
              <div className="text-sm font-medium text-white mt-2">Preview (sample data)</div>
              {preview ? (
                <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-slate-200 whitespace-pre-wrap max-h-[480px] overflow-y-auto">{preview}</div>
              ) : (
                <div className="text-xs text-slate-500">Save ke baad 👁️ Preview dabayein — sample data se render hoga.</div>
              )}
              {previewVars.length > 0 && (
                <div>
                  <div className="text-xs text-slate-400 mb-1">Detected variables:</div>
                  <VarChips vars={previewVars} />
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {signT && (
        <Modal title={`📝 Send for signing — ${signT.name}`} onClose={() => setSignT(null)}>
          <div className="space-y-4">
            {signResult ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                <div className="text-emerald-300 font-medium mb-2">✅ Signing request bhej di gayi</div>
                <div className="text-xs text-slate-300 break-all">Sign link: <span className="text-white">{signResult.signUrl}</span></div>
                <div className="text-xs text-slate-400 mt-1">Signer ko ye link bhej dein. Sign hone par document Legal Vault me auto-save hoga.</div>
                <button onClick={() => setSignT(null)} className="btn-primary mt-3">Band karein</button>
              </div>
            ) : (
              <>
                <Field label="Contract (asal — signing isi se jurta hai)">
                  <select className="input-premium w-full" value={signForm.contractId} onChange={(e) => setSignForm({ ...signForm, contractId: e.target.value })}>
                    <option value="">Contract select karein</option>
                    {contracts.map((c) => (
                      <option key={c.id} value={c.id}>{c.contractNo || c.id} — {c.member?.name || c.memberName || ''}</option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Signer ka naam">
                    <input className="input-premium w-full" value={signForm.signerName} onChange={(e) => setSignForm({ ...signForm, signerName: e.target.value })} />
                  </Field>
                  <Field label="Signer ka email">
                    <input className="input-premium w-full" value={signForm.signerEmail} onChange={(e) => setSignForm({ ...signForm, signerEmail: e.target.value })} />
                  </Field>
                </div>
                {(signT.variables || []).length > 0 && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-white">Variables bhar dein</div>
                    {(signT.variables || []).map((v) => (
                      <Field key={v} label={`{{${v}}}`}>
                        <input className="input-premium w-full" value={signForm.data[v] || ''} onChange={(e) => setSignForm({ ...signForm, data: { ...signForm.data, [v]: e.target.value } })} />
                      </Field>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={doSign} disabled={signing} className="btn-primary">{signing ? 'Bhej raha...' : '📩 Signing request bhejein'}</button>
                  <button onClick={() => setSignT(null)} className="btn-ghost">Cancel</button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
