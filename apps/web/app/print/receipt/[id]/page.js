'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, API_BASE } from '../../../../lib/api';

const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;
const dstr = (d) => (d ? String(d).slice(0, 10) : '—');

export default function PrintReceiptPage() {
  const params = useParams();
  const id = params?.id;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    api.get(`/print/receipt/${id}`)
      .then((d) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="print-loading">Loading receipt…</div>;
  if (error || !data?.payment) {
    return (
      <div className="print-loading">
        <p>Could not load receipt: {error || 'not found'}</p>
        <button className="no-print print-btn" onClick={() => window.close()}>Close</button>
      </div>
    );
  }

  const { payment: p, invoice: inv, branding } = data;
  const logoUrl = branding?.hasLogo && branding?.slug ? `${API_BASE}/branding/${branding.slug}/logo` : null;
  const accent = branding?.primaryColor || '#7c3aed';

  return (
    <>
      <style>{`
        .print-sheet { max-width: 700px; margin: 24px auto; background: #fff; color: #111; font-family: ui-sans-serif, system-ui, sans-serif; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,.35); }
        .print-loading { min-height: 100vh; display: flex; flex-direction: column; gap: 12px; align-items: center; justify-content: center; background: #0a0a14; color: #fff; }
        .print-btn { background: #7c3aed; color: #fff; border: 0; border-radius: 8px; padding: 10px 22px; font-weight: 600; cursor: pointer; }
        .print-btn:hover { background: #6d28d9; }
        @media print {
          body { background: #fff !important; }
          .no-print { display: none !important; }
          .print-sheet { box-shadow: none !important; margin: 0 !important; max-width: none !important; border-radius: 0 !important; }
        }
      `}</style>
      <div style={{ background: '#0a0a14', minHeight: '100vh', padding: '12px' }}>
        <div className="no-print" style={{ maxWidth: 700, margin: '0 auto 12px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="print-btn" onClick={() => window.print()}>🖨️ Print</button>
          <button className="print-btn" style={{ background: '#334155' }} onClick={() => window.close()}>Close</button>
        </div>
        <div className="print-sheet">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '32px 40px', borderBottom: `4px solid ${accent}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {logoUrl && <img src={logoUrl} alt="logo" style={{ height: 56, objectFit: 'contain' }} />}
              <div>
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>{branding?.name || 'Coworking'}</h1>
                {branding?.tagline && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>{branding.tagline}</p>}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <h2 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: 2 }}>RECEIPT</h2>
              <p style={{ margin: '4px 0 0', fontSize: 14, fontWeight: 700 }}>{p.receiptNo || `RCPT-${String(p.id).slice(0, 8).toUpperCase()}`}</p>
            </div>
          </div>

          <div style={{ padding: '32px 40px', textAlign: 'center' }}>
            <span style={{ display: 'inline-block', border: '3px solid #16a34a', color: '#16a34a', fontWeight: 800, fontSize: 20, letterSpacing: 2, padding: '8px 24px', borderRadius: 8, transform: 'rotate(-4deg)' }}>PAYMENT RECEIVED</span>
            <p style={{ fontSize: 40, fontWeight: 800, margin: '20px 0 4px' }}>{money(p.amount)}</p>
            <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>Received on {dstr(p.paidAt)} via <b style={{ textTransform: 'capitalize', color: '#111' }}>{p.method}</b></p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 40px 24px', gap: 24, fontSize: 13, lineHeight: 1.9 }}>
            <div>
              <p style={{ margin: 0, fontSize: 11, textTransform: 'uppercase', color: '#64748b', letterSpacing: 1 }}>Received from</p>
              <p style={{ margin: '6px 0 0', fontSize: 15, fontWeight: 700 }}>{inv?.member?.name || '—'}</p>
              {inv?.member?.companyName && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#475569' }}>{inv.member.companyName}</p>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div><span style={{ color: '#64748b' }}>Invoice: </span><b>{inv?.number || '—'}</b></div>
              {p.note && <div><span style={{ color: '#64748b' }}>Note: </span><b>{p.note}</b></div>}
            </div>
          </div>

          <div style={{ padding: '20px 40px 32px', borderTop: '1px solid #e2e8f0', fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
            This is a computer-generated receipt. Thank you for your payment.
          </div>
        </div>
      </div>
    </>
  );
}
