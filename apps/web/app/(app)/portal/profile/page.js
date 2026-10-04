'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, apiUpload, API_BASE, getTokens } from '../../../../lib/api';
import { useAuth } from '../../../../context/AuthContext';
import { PageHeader, Field, Spinner, ErrorBanner } from '../../../../components/ui';

function Section({ title, desc, children }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {desc && <p className="text-xs text-gray-500 mt-1">{desc}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${on ? 'bg-[#0f766e]' : 'bg-gray-200'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
      <span className="sr-only">{label}</span>
    </button>
  );
}

function passwordStrength(pw) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s; // 0..5
}

const STRENGTH_LABELS = ['Bohat kamzor', 'Kamzor', 'Theek', 'Mazboot', 'Bohat mazboot'];
const STRENGTH_COLORS = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-lime-500', 'bg-emerald-500'];

export default function PortalProfilePage() {
  const router = useRouter();
  const { logout } = useAuth();
  const fileRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [member, setMember] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', companyName: '', emergencyContact: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const [photoTick, setPhotoTick] = useState(0);
  const [uploading, setUploading] = useState(false);

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);

  const [prefs, setPrefs] = useState(null);
  const [prefMeta, setPrefMeta] = useState({ events: [], channels: [], channelLabels: {} });
  const [prefBusy, setPrefBusy] = useState(false);

  const [dir, setDir] = useState({ directoryOptIn: false, directoryBio: '', directoryTags: '' });
  const [dirBusy, setDirBusy] = useState(false);

  const [delBusy, setDelBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [m, p, d] = await Promise.all([
          api.get('/members/me'),
          api.get('/notification-preferences').catch(() => null),
          api.get('/directory/my-profile').catch(() => null),
        ]);
        setMember(m.member);
        setForm({
          name: m.member.name || '',
          phone: m.member.phone || '',
          companyName: m.member.companyName || '',
          emergencyContact: m.member.emergencyContact || '',
        });
        if (p) {
          setPrefs(p.matrix);
          setPrefMeta({ events: p.events || [], channels: p.channels || [], channelLabels: p.channelLabels || {} });
        }
        if (d?.profile) {
          setDir({
            directoryOptIn: !!d.profile.directoryOptIn,
            directoryBio: d.profile.directoryBio || '',
            directoryTags: (d.profile.directoryTags || []).join(', '),
          });
        }
      } catch (e) {
        setErr(e.message || 'Profile load nahi hui.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const photoUrl = () => {
    const { access } = getTokens();
    return `${API_BASE}/members/me/photo/stream?tick=${photoTick}&token=${encodeURIComponent(access || '')}`;
  };

  async function saveProfile(e) {
    e.preventDefault();
    setErr(''); setMsg(''); setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        companyName: form.companyName.trim() || null,
        emergencyContact: form.emergencyContact.trim() || null,
      };
      const r = await api.patch('/members/me', payload);
      setMember(r.member);
      setMsg('Profile update ho gaya ✅');
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function uploadPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('photo', file);
      await apiUpload('/members/me/photo', fd);
      setPhotoTick((t) => t + 1);
      setMsg('Photo upload ho gayi 📸');
    } catch (e) { setErr(e.message); }
    finally { setUploading(false); e.target.value = ''; }
  }

  async function changePassword(e) {
    e.preventDefault();
    setErr(''); setMsg('');
    if (pw.next !== pw.confirm) { setErr('Naya password confirm se match nahi kar raha.'); return; }
    setPwBusy(true);
    try {
      await api.post('/onboarding/change-password', { currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      setMsg('Password change ho gaya 🔒');
    } catch (e) { setErr(e.message); }
    finally { setPwBusy(false); }
  }

  async function toggleChannel(ch, on) {
    if (!prefs) return;
    setPrefBusy(true);
    try {
      const next = { ...prefs };
      for (const ev of prefMeta.events) {
        next[ev] = { ...next[ev], [ch]: on };
        await api.put('/notification-preferences', { eventType: ev, channel: ch, enabled: on });
      }
      setPrefs(next);
    } catch (e) { setErr(e.message); }
    finally { setPrefBusy(false); }
  }

  function channelState(ch) {
    if (!prefs) return false;
    const vals = prefMeta.events.map((ev) => prefs[ev]?.[ch]);
    if (vals.every(Boolean)) return true;
    return false;
  }

  async function saveDirectory(e) {
    e.preventDefault();
    setErr(''); setMsg(''); setDirBusy(true);
    try {
      await api.put('/directory/my-profile', {
        directoryOptIn: dir.directoryOptIn,
        directoryBio: dir.directoryBio,
        directoryTags: dir.directoryTags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      setMsg('Directory profile update ho gaya ✅');
    } catch (e) { setErr(e.message); }
    finally { setDirBusy(false); }
  }

  async function requestDeletion() {
    if (!confirm('Kya aap apna data delete karne ki request bhejna chahte hain? Admin review karega.')) return;
    setDelBusy(true); setErr(''); setMsg('');
    try {
      await api.post('/tickets', {
        title: 'Data deletion request (GDPR)',
        description: `Member ${member?.name || ''} (${member?.email || member?.phone || ''}) ne apne personal data ko delete/anonymize karne ki request ki hai. Member ID: ${member?.id}`,
        category: 'general',
        priority: 'high',
      });
      setMsg('Request admin ko bhej di gayi — ticket ban gaya hai 📩');
    } catch (e) { setErr(e.message); }
    finally { setDelBusy(false); }
  }

  function doLogout() {
    logout();
    router.push('/login');
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;

  const initials = (member?.name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const pwScore = passwordStrength(pw.next);

  return (
    <div className="space-y-5 max-w-2xl mx-auto pb-10">
      <PageHeader title="Meri Profile" subtitle="Apni maloomat, password aur preferences manage karein" />

      {err && <ErrorBanner message={err} onClose={() => setErr('')} />}
      {msg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm px-4 py-3">{msg}</div>
      )}

      {/* Profile info */}
      <Section title="Profile" desc="Aapki bunyadi maloomat">
        <div className="flex items-center gap-4">
          <div className="relative">
            <img
              key={photoTick}
              src={photoUrl()}
              alt="Profile"
              className="h-20 w-20 rounded-full object-cover border-2 border-[#0f766e]/50 bg-gray-100"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
            <div className="h-20 w-20 rounded-full bg-gradient-to-br from-[#0f766e] to-teal-700 flex items-center justify-center text-xl font-bold text-white absolute inset-0 -z-10">
              {initials}
            </div>
          </div>
          <div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={uploadPhoto} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="rounded-xl bg-[#0f766e] hover:bg-[#0f766e] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 transition"
            >
              {uploading ? 'Uploading…' : 'Photo badlein'}
            </button>
            <p className="text-[11px] text-slate-500 mt-1">JPG/PNG/WebP, max 5MB</p>
          </div>
        </div>

        <form onSubmit={saveProfile} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Naam">
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
            </Field>
            <Field label="Phone">
              <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Company">
              <input className="input" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} placeholder="Company ka naam" />
            </Field>
            <Field label="Emergency contact">
              <input className="input" value={form.emergencyContact} onChange={(e) => setForm({ ...form, emergencyContact: e.target.value })} placeholder="Naam + number" />
            </Field>
          </div>
          <div className="text-xs text-slate-500">Email: <span className="text-gray-600">{member?.email || '—'}</span> · Status: <span className="text-gray-600">{member?.status}</span></div>
          <button type="submit" disabled={saving} className="rounded-xl bg-[#0f766e] hover:bg-[#0f766e] disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 transition">
            {saving ? 'Save ho raha…' : 'Save karein'}
          </button>
        </form>
      </Section>

      {/* Password */}
      <Section title="Password badlein" desc="Maujooda password confirm karke naya set karein">
        <form onSubmit={changePassword} className="space-y-3">
          <Field label="Maujooda password">
            <input type="password" className="input" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required autoComplete="current-password" />
          </Field>
          <Field label="Naya password">
            <input type="password" className="input" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required minLength={8} autoComplete="new-password" />
          </Field>
          {pw.next && (
            <div>
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${STRENGTH_COLORS[Math.max(0, pwScore - 1)] || 'bg-red-500'}`} style={{ width: `${(pwScore / 5) * 100}%` }} />
              </div>
              <p className="text-[11px] text-gray-500 mt-1">{STRENGTH_LABELS[Math.max(0, pwScore - 1)]}</p>
            </div>
          )}
          <Field label="Naya password dobara">
            <input type="password" className="input" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required autoComplete="new-password" />
          </Field>
          <button type="submit" disabled={pwBusy} className="rounded-xl bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 transition">
            {pwBusy ? 'Change ho raha…' : 'Password change karein'}
          </button>
        </form>
      </Section>

      {/* Notification preferences */}
      {prefs && (
        <Section title="Notifications" desc="Har channel ke liye tamam notifications on/off karein">
          <div className="space-y-3">
            {prefMeta.channels.map((ch) => (
              <div key={ch} className="flex items-center justify-between rounded-xl bg-gray-100 px-4 py-3">
                <span className="text-sm text-gray-800 capitalize">{prefMeta.channelLabels[ch] || ch}</span>
                <Toggle label={ch} on={channelState(ch)} onChange={(v) => toggleChannel(ch, v)} />
              </div>
            ))}
          </div>
          {prefBusy && <p className="text-xs text-slate-500">Update ho raha…</p>}
        </Section>
      )}

      {/* Directory */}
      <Section title="Member directory" desc="Directory me apni maujoodgi control karein">
        <form onSubmit={saveDirectory} className="space-y-3">
          <div className="flex items-center justify-between rounded-xl bg-gray-100 px-4 py-3">
            <span className="text-sm text-gray-800">Directory me show hon</span>
            <Toggle label="directory opt-in" on={dir.directoryOptIn} onChange={(v) => setDir({ ...dir, directoryOptIn: v })} />
          </div>
          <Field label="Bio">
            <textarea className="input" rows={2} value={dir.directoryBio} onChange={(e) => setDir({ ...dir, directoryBio: e.target.value })} placeholder="Apne baare me mukhtasar" maxLength={300} />
          </Field>
          <Field label="Tags (comma se alag)">
            <input className="input" value={dir.directoryTags} onChange={(e) => setDir({ ...dir, directoryTags: e.target.value })} placeholder="design, startup, marketing" />
          </Field>
          <button type="submit" disabled={dirBusy} className="rounded-xl bg-[#0f766e] hover:bg-[#0f766e] disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 transition">
            {dirBusy ? 'Save ho raha…' : 'Save karein'}
          </button>
        </form>
      </Section>

      {/* Account */}
      <Section title="Account" desc="Logout ya data deletion request">
        <div className="flex flex-col sm:flex-row gap-3">
          <button type="button" onClick={doLogout} className="rounded-xl border border-gray-200 text-gray-800 text-sm font-semibold px-5 py-2.5 hover:bg-gray-100 transition">
            Logout
          </button>
          <button type="button" onClick={requestDeletion} disabled={delBusy} className="rounded-xl border border-red-500/40 text-red-700 text-sm font-semibold px-5 py-2.5 hover:bg-red-50 disabled:opacity-50 transition">
            {delBusy ? 'Bhej rahe…' : 'Mera data delete karne ki request'}
          </button>
        </div>
        <p className="text-[11px] text-slate-500">Data deletion ki request admin ko ticket ke zariye jati hai — admin review ke baad action lega.</p>
      </Section>
    </div>
  );
}
