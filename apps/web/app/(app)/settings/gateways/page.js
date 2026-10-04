'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const SETUP_DOCS = {
  manual: {
    title: 'Manual / Pay at Reception',
    steps: [
      'No setup needed — always available.',
      'Member "Pay Online" dabata hai → reference number milta hai.',
      'Reception par payment verify karke aap billing me payment record karte hain.',
    ],
  },
  jazzcash: {
    title: 'JazzCash',
    steps: [
      'JazzCash merchant account se credentials lein.',
      'VPS env me set karein: JAZZCASH_MERCHANT_ID, JAZZCASH_PASSWORD, JAZZCASH_INTEGRITY_SALT, JAZZCASH_RETURN_URL.',
      'Backend me apps/api/src/lib/gateways.js ka JazzCash stub asal API calls se badlein (EXTENSION POINT comments dekhein).',
    ],
  },
  easypaisa: {
    title: 'Easypaisa',
    steps: [
      'Easypaisa developer portal se Store ID aur Hash Key lein.',
      'VPS env me set karein: EASYPAYSA_STORE_ID, EASYPAYSA_HASH_KEY, EASYPAYSA_RETURN_URL.',
      'Backend me apps/api/src/lib/gateways.js ka Easypaisa stub asal API calls se badlein (EXTENSION POINT comments dekhein).',
    ],
  },
};

const ICONS = { manual: '🏦', jazzcash: '📱', easypaisa: '💚' };

export default function GatewaysPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin']);
  const [gateways, setGateways] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState('');

  useEffect(() => {
    if (!allowed) return;
    api.get('/gateways')
      .then((d) => setGateways(d.gateways || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [allowed]);

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;

  const testManualFlow = async () => {
    setTesting(true); setTestMsg(''); setError('');
    try {
      // Dry-run: sirf gateway interface check — koi asal payment nahi
      const d = await api.get('/gateways');
      const manual = (d.gateways || []).find((g) => g.name === 'manual');
      setTestMsg(manual && manual.configured ? 'Manual gateway ready — members "Pay Online" use kar sakte hain.' : 'Manual gateway available nahi.');
    } catch (e) { setError(e.message); }
    finally { setTesting(false); }
  };

  return (
    <div>
      <PageHeader title="Payment Gateways" subtitle="Online payments accept karne ke liye gateways configure karein" />

      {error && <ErrorBanner message={error} />}
      {testMsg && <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm">{testMsg}</div>}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {gateways.map((g) => {
          const doc = SETUP_DOCS[g.name] || { title: g.displayName, steps: [] };
          const isOpen = open === g.name;
          return (
            <div key={g.name} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{ICONS[g.name] || '💳'}</span>
                  <div>
                    <h3 className="font-semibold text-white">{g.displayName}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${g.configured
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : 'bg-amber-500/15 text-amber-300 border-amber-500/30'}`}>
                      {g.configured ? 'Configured' : 'Not configured'}
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setOpen(isOpen ? null : g.name)}
                className="text-sm text-[#c4b5fd] hover:text-[#c4b5fd]"
              >
                {isOpen ? 'Hide setup instructions ▲' : 'Setup instructions ▼'}
              </button>
              {isOpen && (
                <ol className="mt-3 text-sm text-slate-300 space-y-2 list-decimal list-inside">
                  {doc.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h3 className="font-semibold text-white mb-2">Test payment flow</h3>
        <p className="text-sm text-slate-400 mb-4">
          Manual gateway hamesha ready hota hai. Member billing page par "Pay Online" dabakar reference hasil karta hai.
        </p>
        <button onClick={testManualFlow} disabled={testing} className="btn-primary btn-sm">
          {testing ? 'Checking…' : 'Test gateway status'}
        </button>
      </div>

      <div className="mt-4 text-xs text-slate-500">
        Webhook signature security: har gateway ka webhook HMAC-SHA256 signature verify karta hai.
        Production me <code className="text-slate-300">GATEWAY_WEBHOOK_SECRET</code> env lazmi set karein.
      </div>
    </div>
  );
}
