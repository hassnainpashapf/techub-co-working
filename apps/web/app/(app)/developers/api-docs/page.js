'use client';

import { useState } from 'react';
import { API_BASE } from '../../../../lib/api';
import { PageHeader, Badge } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const CURL_MEMBERS = `curl -H "X-API-Key: cwk_YOUR_KEY" \\
  https://techub-api.150.230.52.29.sslip.io/api/members`;

const CURL_BOOKING = `curl -X POST -H "X-API-Key: cwk_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"unitId":"UNIT_ID","startsAt":"2026-10-10T09:00:00Z","endsAt":"2026-10-10T11:00:00Z"}' \\
  https://techub-api.150.230.52.29.sslip.io/api/bookings`;

const CURL_JWT = `curl -X POST -H "Content-Type: application/json" \\
  -d '{"email":"you@company.com","password":"***"}' \\
  https://techub-api.150.230.52.29.sslip.io/api/auth/login
# → { "accessToken": "...", "refreshToken": "..." }
curl -H "Authorization: Bearer ACCESS_TOKEN" \\
  https://techub-api.150.230.52.29.sslip.io/api/members`;

function CodeBlock({ title, code }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  return (
    <div className="rounded-xl border border-gray-200 bg-black/40 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
        <span className="text-xs font-semibold text-gray-600">{title}</span>
        <button onClick={copy} className="text-xs text-teal-300 hover:text-violet-200">{copied ? '✓ Copied' : 'Copy'}</button>
      </div>
      <pre className="p-4 text-xs font-mono text-emerald-200/90 overflow-x-auto whitespace-pre">{code}</pre>
    </div>
  );
}

function Step({ n, title, children }) {
  return (
    <div className="flex gap-4">
      <div className="shrink-0 w-8 h-8 rounded-full bg-teal-600/20 border border-teal-500/40 flex items-center justify-center text-sm font-bold text-violet-200">{n}</div>
      <div className="flex-1">
        <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
        <div className="text-sm text-gray-600 space-y-3">{children}</div>
      </div>
    </div>
  );
}

export default function ApiDocsPage() {
  const gate = useRequireRoles('ceo', 'admin', 'super_admin');
  const [tab, setTab] = useState('docs');
  if (gate === 'denied') return <AccessDenied />;
  if (gate === 'loading') return null;

  const docsUrl = `${API_BASE}/docs`;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="API Documentation"
        sub="CoworkOS REST API — 40+ documented endpoints, OpenAPI 3.0"
        actions={<Badge tone="violet">v1.0.0</Badge>}
      />

      <div className="flex gap-2 mb-6">
        {[
          { key: 'docs', label: '📖 Interactive Docs' },
          { key: 'quickstart', label: '🚀 Quickstart Guide' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold border transition ${tab === t.key ? 'border-teal-500/60 bg-teal-600/20 text-violet-100' : 'border-gray-200 text-gray-500 hover:bg-gray-100'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'docs' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 flex flex-wrap items-center gap-3">
            <span className="text-sm text-gray-600">Swagger UI isi page me embedded hai. Nayi tab me kholna ho to:</span>
            <a href={docsUrl} target="_blank" rel="noreferrer" className="btn-primary text-sm">Open in new tab ↗</a>
            <a href={`${docsUrl}/openapi.json`} target="_blank" rel="noreferrer" className="text-sm text-teal-300 hover:text-violet-200 underline">openapi.json</a>
          </div>
          <div className="rounded-2xl border border-gray-200 overflow-hidden bg-white">
            <iframe src={docsUrl} title="CoworkOS API Docs" className="w-full bg-white" style={{ height: '75vh' }} />
          </div>
          <p className="text-xs text-slate-500">Tip: Swagger UI me "Authorize" button se apna JWT ya API key set karo, phir "Try it out" se live test kar sakte ho.</p>
        </div>
      )}

      {tab === 'quickstart' && (
        <div className="space-y-8 card-premium p-6">
          <div className="space-y-6">
            <Step n="1" title="API key banao">
              <p><span className="text-gray-900 font-semibold">Settings → API Keys</span> par jao, "New key" dabao. Secret <span className="text-amber-300 font-semibold">sirf ek dafa</span> dikhega — foran copy karke safe jagah rakho. Key ka format <code className="font-mono text-violet-200">cwk_...</code> hota hai.</p>
              <p className="text-gray-500">Har request me ye header bhejo:</p>
              <CodeBlock title="Auth header" code={`X-API-Key: cwk_YOUR_KEY`} />
            </Step>

            <Step n="2" title="Pehli API call — members list">
              <CodeBlock title="bash" code={CURL_MEMBERS} />
            </Step>

            <Step n="3" title="Booking banao">
              <p>Credit limit cross ho to <code className="font-mono text-red-300">402</code>, slot overlap par <code className="font-mono text-red-300">409</code>, rule violation par <code className="font-mono text-red-300">422</code> milta hai.</p>
              <CodeBlock title="bash" code={CURL_BOOKING} />
            </Step>

            <Step n="4" title="JWT alternative (user login)">
              <p>API key ke bajaye user login se Bearer token bhi chalega:</p>
              <CodeBlock title="bash" code={CURL_JWT} />
            </Step>
          </div>

          <div className="border-t border-gray-200 pt-6">
            <h3 className="font-semibold text-gray-900 mb-3">📌 Zaroori notes</h3>
            <ul className="text-sm text-gray-600 space-y-2 list-disc pl-5">
              <li>Sab tenant-scoped endpoints JWT/API key ke tenant par auto-filter hote hain.</li>
              <li>Rate limits: auth endpoints par strict limits hain (login 5/min, password reset 5/hour).</li>
              <li>Webhook receivers ke liye <code className="font-mono text-violet-200">X-CoworkOS-Signature</code> HMAC header verify karo (docs me Webhooks section).</li>
              <li>Poori endpoint list: <a href={`${docsUrl}/openapi.json`} target="_blank" rel="noreferrer" className="text-teal-300 underline">openapi.json</a> ya <a href={`${docsUrl}/index`} target="_blank" rel="noreferrer" className="text-teal-300 underline">/api/docs/index</a>.</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
