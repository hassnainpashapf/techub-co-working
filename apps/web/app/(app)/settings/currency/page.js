'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Field, Spinner, ErrorBanner } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

export default function CurrencySettingsPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin']);
  const [currencies, setCurrencies] = useState({});
  const [form, setForm] = useState({ baseCurrency: 'PKR', enabledCurrencies: ['PKR'], defaultInvoiceCurrency: '', fxSource: 'manual' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!allowed) return;
    api.get('/currency-settings')
      .then((d) => {
        setCurrencies(d.currencies || {});
        if (d.settings) {
          setForm({
            baseCurrency: d.settings.baseCurrency || 'PKR',
            enabledCurrencies: d.settings.enabledCurrencies || [d.settings.baseCurrency || 'PKR'],
            defaultInvoiceCurrency: d.settings.defaultInvoiceCurrency || '',
            fxSource: d.settings.fxSource || 'manual',
          });
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [allowed]);

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;

  const codes = Object.keys(currencies);
  const toggle = (code) => {
    setForm((f) => ({
      ...f,
      enabledCurrencies: f.enabledCurrencies.includes(code)
        ? f.enabledCurrencies.filter((c) => c !== code)
        : [...f.enabledCurrencies, code],
    }));
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setError(''); setMsg('');
    try {
      const d = await api.put('/currency-settings', {
        baseCurrency: form.baseCurrency,
        enabledCurrencies: form.enabledCurrencies,
        defaultInvoiceCurrency: form.defaultInvoiceCurrency || null,
        fxSource: form.fxSource,
      });
      setMsg('Currency settings saved.');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-6 max-w-3xl">
      <PageHeader title="Currency Settings" subtitle="Base currency, enabled currencies and FX source" />
      {error && <ErrorBanner message={error} />}
      {msg && <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-emerald-200">{msg}</div>}
      <form onSubmit={save} className="space-y-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <Field label="Base currency (reporting)">
          <select
            value={form.baseCurrency}
            onChange={(e) => setForm({ ...form, baseCurrency: e.target.value })}
            className="w-full rounded-lg bg-[#12121f] border border-white/10 px-3 py-2 text-white"
          >
            {codes.map((c) => <option key={c} value={c}>{c} — {currencies[c]}</option>)}
          </select>
        </Field>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-300">Enabled currencies</label>
          <div className="flex flex-wrap gap-2">
            {codes.map((c) => {
              const on = form.enabledCurrencies.includes(c);
              const isBase = c === form.baseCurrency;
              return (
                <button
                  key={c}
                  type="button"
                  disabled={isBase}
                  onClick={() => toggle(c)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold border transition ${on ? 'border-blue-400/50 bg-blue-500/20 text-blue-200' : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/25'} ${isBase ? 'opacity-60 cursor-not-allowed' : ''}`}
                  title={isBase ? 'Base currency is always enabled' : currencies[c]}
                >
                  {c}{isBase ? ' (base)' : ''}
                </button>
              );
            })}
          </div>
        </div>

        <Field label="Default invoice currency">
          <select
            value={form.defaultInvoiceCurrency}
            onChange={(e) => setForm({ ...form, defaultInvoiceCurrency: e.target.value })}
            className="w-full rounded-lg bg-[#12121f] border border-white/10 px-3 py-2 text-white"
          >
            <option value="">Same as base ({form.baseCurrency})</option>
            {form.enabledCurrencies.map((c) => <option key={c} value={c}>{c} — {currencies[c]}</option>)}
          </select>
        </Field>

        <Field label="Exchange rate source">
          <select
            value={form.fxSource}
            onChange={(e) => setForm({ ...form, fxSource: e.target.value })}
            className="w-full rounded-lg bg-[#12121f] border border-white/10 px-3 py-2 text-white"
          >
            <option value="manual">Manual rates</option>
            <option value="auto">Auto update (daily)</option>
          </select>
          <p className="mt-1 text-xs text-slate-500">Manual: rates entered by staff. Auto: refreshed daily by the FX rate job.</p>
        </Field>

        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-6 py-2.5 font-semibold text-white shadow-lg shadow-blue-600/30 hover:brightness-110 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </form>
    </div>
  );
}
