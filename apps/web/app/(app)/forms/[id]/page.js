'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, Field, Modal, Badge } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const FIELD_TYPES = [
  { v: 'text', label: '📝 Text' }, { v: 'textarea', label: '📄 Long Text' },
  { v: 'number', label: '🔢 Number' }, { v: 'date', label: '📅 Date' },
  { v: 'select', label: '▾ Dropdown' }, { v: 'multiselect', label: '☑️ Multi Select' },
  { v: 'radio', label: '🔘 Radio' }, { v: 'checkbox', label: '✅ Checkboxes' },
  { v: 'file', label: '📎 File Upload' }, { v: 'rating', label: '⭐ Rating' },
  { v: 'email', label: '✉️ Email' }, { v: 'phone', label: '📞 Phone' },
];
const NEEDS_OPTIONS = ['select', 'multiselect', 'radio', 'checkbox'];

const uid = () => 'f_' + Math.random().toString(36).slice(2, 10);

function PreviewField({ field }) {
  const { type, label, required, options, placeholder } = field;
  const base = 'input-premium w-full';
  const lbl = <label className="block text-sm text-slate-300 mb-1">{label}{required && <span className="text-red-400"> *</span>}</label>;
  switch (type) {
    case 'textarea': return <div>{lbl}<textarea className={base} rows={3} placeholder={placeholder} /></div>;
    case 'select': return <div>{lbl}<select className={base}><option value="">{placeholder || 'Select...'}</option>{(options || []).map((o) => <option key={o}>{o}</option>)}</select></div>;
    case 'multiselect': return <div>{lbl}<select multiple className={base}>{(options || []).map((o) => <option key={o}>{o}</option>)}</select></div>;
    case 'radio': return <div>{lbl}{(options || []).map((o) => <label key={o} className="flex items-center gap-2 text-sm text-slate-300"><input type="radio" name={field.id} />{o}</label>)}</div>;
    case 'checkbox': return <div>{lbl}{(options || []).map((o) => <label key={o} className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" />{o}</label>)}</div>;
    case 'rating': return <div>{lbl}<div className="flex gap-1 text-2xl text-amber-400">{[1, 2, 3, 4, 5].map((n) => <span key={n}>★</span>)}</div></div>;
    case 'file': return <div>{lbl}<input type="file" className={base} /></div>;
    default: return <div>{lbl}<input type={type === 'date' ? 'date' : type === 'number' ? 'number' : 'text'} className={base} placeholder={placeholder} /></div>;
  }
}

export default function FormBuilderPage() {
  const allowed = useRequireRoles('ceo', 'admin', 'super_admin', 'manager');
  const { id } = useParams();
  const [form, setForm] = useState(null);
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [editing, setEditing] = useState(null); // field id being edited
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [cloning, setCloning] = useState('');

  useEffect(() => {
    if (!allowed) return;
    (async () => {
      try {
        setLoading(true);
        const d = await api.get(`/forms/${id}`);
        setForm(d.form);
        setFields(Array.isArray(d.form.fields) ? d.form.fields : []);
      } catch (e) { setErr(e.message || 'Form load nahi ho saka'); }
      finally { setLoading(false); }
    })();
  }, [allowed, id]);

  const save = async () => {
    try {
      setSaving(true); setErr('');
      const d = await api.put(`/forms/${id}`, { ...form, fields });
      setForm(d.form); setSavedAt(new Date());
    } catch (e) { setErr(e.message || 'Save nahi ho saka'); }
    finally { setSaving(false); }
  };

  const addField = (type) => {
    const f = { id: uid(), type, label: 'Naya field', required: false, placeholder: '', options: NEEDS_OPTIONS.includes(type) ? ['Option 1', 'Option 2'] : undefined };
    setFields([...fields, f]);
    setEditing(f.id);
  };

  const updateField = (fid, patch) => setFields(fields.map((f) => (f.id === fid ? { ...f, ...patch } : f)));
  const removeField = (fid) => { setFields(fields.filter((f) => f.id !== fid)); setEditing(null); };
  const moveField = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= fields.length) return;
    const arr = [...fields];
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    setFields(arr);
  };

  const publish = async () => {
    try { const d = await api.patch(`/forms/${id}/publish`, { status: 'published' }); setForm({ ...form, status: d.status }); }
    catch (e) { setErr(e.message || 'Publish nahi ho saka'); }
  };

  const openTemplates = async () => {
    setShowTemplates(true);
    try { const d = await api.get('/form-templates'); setTemplates(d.templates || []); }
    catch (e) { setErr(e.message || 'Templates load nahi ho sake'); }
  };

  const cloneTemplate = async (key) => {
    try {
      setCloning(key);
      const d = await api.post(`/form-templates/${key}/clone`, {});
      window.location = `/forms/${d.form.id}`;
    } catch (e) { setErr(e.message || 'Template clone nahi ho saka'); }
    finally { setCloning(''); }
  };

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;

  const editField = fields.find((f) => f.id === editing);

  return (
    <div>
      <PageHeader
        title={form?.title || 'Form Builder'}
        sub={`/${form?.slug} • ${form?.status}`}
        actions={
          <div className="flex gap-2">
            <Link href="/forms" className="btn-secondary">← Forms</Link>
            <Link href={`/forms/${id}/responses`} className="btn-secondary">📥 Responses</Link>
            <button onClick={save} disabled={saving} className="btn-secondary">{saving ? 'Saving...' : '💾 Save'}</button>
            {form?.status !== 'published' && <button onClick={publish} className="btn-primary">🚀 Publish</button>}
          </div>
        }
      />
      {err && <ErrorBanner message={err} onRetry={() => setErr('')} />}
      {savedAt && <p className="text-xs text-green-400 mb-2">✓ Saved {savedAt.toLocaleTimeString('en-PK')}</p>}

      <div className="grid xl:grid-cols-3 gap-4">
        {/* Left: fields list + settings */}
        <div className="space-y-4">
          <div className="card p-4">
            <h3 className="font-semibold text-white mb-3">Form Settings</h3>
            <div className="space-y-2">
              <Field label="Title"><input value={form?.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input-premium w-full" /></Field>
              <Field label="Slug"><input value={form?.slug || ''} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="input-premium w-full" /></Field>
              <Field label="Description"><textarea value={form?.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="input-premium w-full" /></Field>
              <Field label="Submit Button Text"><input value={form?.submitButtonText || ''} onChange={(e) => setForm({ ...form, submitButtonText: e.target.value })} className="input-premium w-full" /></Field>
              <Field label="Success Message"><input value={form?.successMessage || ''} onChange={(e) => setForm({ ...form, successMessage: e.target.value })} className="input-premium w-full" /></Field>
              <Field label="Notify Emails (comma separated)"><input value={(form?.notifyEmails || []).join(', ')} onChange={(e) => setForm({ ...form, notifyEmails: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} className="input-premium w-full" /></Field>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={!!form?.isPublic} onChange={(e) => setForm({ ...form, isPublic: e.target.checked })} />
                Public form (bina login ke bhar sako)
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={!!form?.autoCreateLead} onChange={(e) => setForm({ ...form, autoCreateLead: e.target.checked })} />
                🤝 Auto-create CRM lead (submission par lead ban jaye)
              </label>
            </div>
          </div>

          <div className="card p-4">
            <h3 className="font-semibold text-white mb-3">+ Field Joro</h3>
            <div className="grid grid-cols-2 gap-2">
              {FIELD_TYPES.map((t) => (
                <button key={t.v} onClick={() => addField(t.v)} className="btn-secondary text-xs">{t.label}</button>
              ))}
            </div>
            <button onClick={openTemplates} className="btn-secondary text-xs w-full mt-2">📋 Template se shuru karein</button>
          </div>

          <div className="card p-4">
            <h3 className="font-semibold text-white mb-3">Fields ({fields.length})</h3>
            {fields.length === 0 && <p className="text-sm text-slate-400">Koi field nahi — upar se joro.</p>}
            <div className="space-y-2">
              {fields.map((f, i) => (
                <div key={f.id} className={`flex items-center gap-2 p-2 rounded-lg ${editing === f.id ? 'bg-blue-500/10 border border-blue-500/40' : 'bg-white/5'}`}>
                  <span className="text-xs text-slate-400 w-6">{i + 1}</span>
                  <span className="flex-1 text-sm text-white truncate">{f.label}{f.required && <span className="text-red-400"> *</span>}</span>
                  <span className="text-xs text-slate-500">{f.type}</span>
                  <button onClick={() => moveField(i, -1)} disabled={i === 0} className="btn-secondary text-xs px-1.5">↑</button>
                  <button onClick={() => moveField(i, 1)} disabled={i === fields.length - 1} className="btn-secondary text-xs px-1.5">↓</button>
                  <button onClick={() => setEditing(f.id)} className="btn-secondary text-xs">⚙️</button>
                  <button onClick={() => removeField(f.id)} className="btn-secondary text-xs text-red-300">✕</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Middle: field editor */}
        <div>
          {editField ? (
            <div className="card p-4">
              <h3 className="font-semibold text-white mb-3">Field Edit: {editField.type}</h3>
              <div className="space-y-2">
                <Field label="Label"><input value={editField.label} onChange={(e) => updateField(editField.id, { label: e.target.value })} className="input-premium w-full" /></Field>
                <Field label="Placeholder"><input value={editField.placeholder || ''} onChange={(e) => updateField(editField.id, { placeholder: e.target.value })} className="input-premium w-full" /></Field>
                {NEEDS_OPTIONS.includes(editField.type) && (
                  <Field label="Options (har line par ek)">
                    <textarea value={(editField.options || []).join('\n')} onChange={(e) => updateField(editField.id, { options: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} rows={4} className="input-premium w-full" />
                  </Field>
                )}
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={!!editField.required} onChange={(e) => updateField(editField.id, { required: e.target.checked })} />
                  Lazmi (required)
                </label>
                {/* Track 3: conditional logic — field kab dikhe */}
                <div className="border-t border-white/10 pt-3 mt-1">
                  <h4 className="text-sm font-semibold text-white mb-2">🔀 Conditional Logic</h4>
                  <label className="flex items-center gap-2 text-sm text-slate-300 mb-2">
                    <input
                      type="checkbox"
                      checked={!!editField.showIf}
                      onChange={(e) => updateField(editField.id, e.target.checked ? { showIf: { fieldId: fields[0]?.id || '', operator: 'equals', value: '' } } : { showIf: undefined })}
                    />
                    Sirf tab dikhao jab...
                  </label>
                  {editField.showIf && (
                    <div className="space-y-2">
                      <Field label="Source field (is se pehle wala)">
                        <select
                          value={editField.showIf.fieldId || ''}
                          onChange={(e) => updateField(editField.id, { showIf: { ...editField.showIf, fieldId: e.target.value } })}
                          className="input-premium w-full"
                        >
                          <option value="">— Select —</option>
                          {fields.filter((f) => f.id !== editField.id).map((f) => (
                            <option key={f.id} value={f.id}>{f.label} ({f.type})</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Condition">
                        <select
                          value={editField.showIf.operator || 'equals'}
                          onChange={(e) => updateField(editField.id, { showIf: { ...editField.showIf, operator: e.target.value } })}
                          className="input-premium w-full"
                        >
                          <option value="equals">Jawab barabar ho (equals)</option>
                          <option value="not_equals">Jawab barabar na ho (not equals)</option>
                          <option value="contains">Jawab me ye ho (contains)</option>
                        </select>
                      </Field>
                      <Field label="Value">
                        <input
                          value={editField.showIf.value || ''}
                          onChange={(e) => updateField(editField.id, { showIf: { ...editField.showIf, value: e.target.value } })}
                          placeholder="misal: Haan"
                          className="input-premium w-full"
                        />
                      </Field>
                    </div>
                  )}
                </div>
                <button onClick={() => setEditing(null)} className="btn-secondary w-full">Done</button>
              </div>
            </div>
          ) : (
            <div className="card p-4 text-sm text-slate-400">Field edit karne ke liye ⚙️ dabao.</div>
          )}
        </div>

        {/* Right: live preview */}
        <div>
          <div className="card p-5">
            <h3 className="font-semibold text-white mb-1">{form?.title}</h3>
            {form?.description && <p className="text-sm text-slate-400 mb-4">{form.description}</p>}
            <div className="space-y-3">
              {fields.length === 0 && <p className="text-sm text-slate-500">Preview: koi field nahi.</p>}
              {fields.map((f) => <PreviewField key={f.id} field={f} />)}
            </div>
            <button className="btn-primary w-full mt-4" disabled>{form?.submitButtonText || 'Submit'}</button>
          </div>
        </div>
      </div>

      {showTemplates && (
        <Modal title="📋 Template se shuru karein" onClose={() => setShowTemplates(false)}>
          <p className="text-sm text-slate-400 mb-3">Template select karein — naya draft form ban jayega aur builder me khul jayega.</p>
          <div className="grid md:grid-cols-2 gap-3">
            {templates.map((t) => (
              <div key={t.key} className="card p-4">
                <h4 className="font-semibold text-white text-sm">{t.title}</h4>
                <p className="text-xs text-slate-400 mt-1">{t.description}</p>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-slate-500">{t.fieldCount} fields</span>
                  <button onClick={() => cloneTemplate(t.key)} disabled={cloning === t.key} className="btn-primary text-xs">
                    {cloning === t.key ? '...' : 'Use template'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {templates.length === 0 && <p className="text-sm text-slate-400">Koi template nahi mila.</p>}
        </Modal>
      )}
    </div>
  );
}
