'use client';

// Phase 39 Track 2: Public lead capture form — "/join/[slug]".
// No login needed; slug se tenant branding load hoti hai (white-label).
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const INTERESTS = ['Hot Desk', 'Dedicated Desk', 'Private Office', 'Meeting Room', 'Virtual Office', 'Event Space', 'Other'];

export default function JoinPage() {
  const { slug } = useParams();
  const [brand, setBrand] = useState({ brandName: 'CoworkOS', primaryColor: '#0f766e', supportEmail: null });
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', interest: '', budget: '', message: '', website: '' });
  const [state, setState] = useState('idle'); // idle | sending | done | error
  const [error, setError] = useState('');

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const base = process.env.NEXT_PUBLIC_API_URL || '';
        const r = await fetch(`${base}/api/leads/public/branding?tenantSlug=${encodeURIComponent(slug)}`);
        const d = await r.json();
        if (r.ok && d.branding) setBrand(d.branding);
      } catch { /* default branding */ }
    })();
  }, [slug]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setState('sending'); setError('');
    try {
      const base = process.env.NEXT_PUBLIC_API_URL || '';
      const payload = {
        tenantSlug: slug,
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        company: form.company.trim() || null,
        interest: form.interest || null,
        budget: form.budget ? Number(form.budget) : null,
        notes: form.message.trim() || null,
        website: form.website, // honeypot
      };
      if (!payload.name) throw new Error('Please enter your name.');
      if (!payload.email && !payload.phone) throw new Error('Please enter email or phone.');
      const r = await fetch(`${base}/api/leads/public`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Submission failed.');
      setState('done');
    } catch (err) {
      setError(err.message || 'Submission failed.');
      setState('error');
    }
  }

  const color = brand.primaryColor || '#0f766e';

  return (
    <div className="min-h-screen bg-[#f4f5f7] px-4 py-10 flex items-start justify-center">
      <div className="card-premium w-full max-w-lg p-8">
        <h1 className="text-2xl font-extrabold text-gray-900 mb-1">Request a Tour</h1>
        <p className="text-sm text-gray-500 mb-6">
          Get in touch with <span className="text-gray-900 font-semibold">{brand.brandName}</span> — we'll show you around.
        </p>

        {state === 'done' ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-3">✅</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Thanks, {form.name.split(' ')[0] || 'there'}!</h2>
            <p className="text-sm text-gray-500">Your request has been received. Someone from {brand.brandName} will contact you shortly.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {/* honeypot — humans never see this */}
            <input
              type="text" name="website" value={form.website} onChange={set('website')}
              autoComplete="off" tabIndex="-1" aria-hidden="true"
              style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0 }}
            />
            <div>
              <label className="text-xs font-semibold text-gray-600">Full name *</label>
              <input className="input mt-1" value={form.name} onChange={set('name')} required placeholder="Your name" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-600">Email *</label>
                <input type="email" className="input mt-1" value={form.email} onChange={set('email')} placeholder="you@example.com" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">Phone</label>
                <input className="input mt-1" value={form.phone} onChange={set('phone')} placeholder="+92 …" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-600">Company</label>
                <input className="input mt-1" value={form.company} onChange={set('company')} placeholder="Optional" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">Interested in</label>
                <select className="input mt-1" value={form.interest} onChange={set('interest')}>
                  <option value="">Select…</option>
                  {INTERESTS.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600">Monthly budget</label>
              <input type="number" min="0" className="input mt-1" value={form.budget} onChange={set('budget')} placeholder="Optional" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600">Message</label>
              <textarea className="input mt-1" rows="3" value={form.message} onChange={set('message')} placeholder="Anything you'd like us to know…" />
            </div>

            {state === 'error' && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit" disabled={state === 'sending'} className="btn-primary w-full py-3 text-sm font-bold"
              style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}
            >
              {state === 'sending' ? 'Sending…' : 'Request a Tour'}
            </button>

            {brand.supportEmail && (
              <p className="text-center text-xs text-slate-500">
                Prefer email? <a className="text-gray-600 underline" href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

