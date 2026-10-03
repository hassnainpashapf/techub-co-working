'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, API_BASE } from '../../../../lib/api';

const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;
const dstr = (d) => (d ? String(d).slice(0, 10) : '—');

const STATUS_STYLE = {
  paid: { label: 'PAID', color: '#16a34a', border: '#16a34a' },
  partial: { label: 'PARTIALLY PAID', color: '#d97706', border: '#d97706' },
  unpaid: { label: 'UNPAID', color: '#dc2626', border: '#dc2626' },
  overdue: { label: 'OVERDUE', color: '#dc2626', border: '#dc2626' },
  cancelled: { label: 'CANCELLED', color: '#64748b', border: '#64748b' },
};

export default function PrintInvoicePage() {
  const params = useParams();
  const id = params?.id;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    api.get(`/print/invoice/${id}`)
      .then((d) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="print-loading">Loading invoice…</div>;
  if (error || !data?.invoice) {
    return (
      <div className="print-loading">
        <p>Could not load invoice: {error || 'not found'}</p>
        <button className="no-print print-btn" onClick={() => window.close()}>Close</button>
      </div>
    );
  }

  const { invoice: inv, branding } = data;
  const st = STATUS_STYLE[String(inv.status).toLowerCase()] || STATUS_STYLE.unpaid;
  const amount = Number(inv.amount || 0);
  const paid = Number(inv.amountPaid || 0);
  const balance = Math.max(amount - paid, 0);
  const logoUrl = branding?.hasLogo && branding?.slug ? `${API_BASE}/branding/${branding.slug}/logo` : null;
  const accent = branding?.primaryColor || '#7c3aed';

  return (
    <>
      <style>{`
        .print-sheet { max-width: 800px; margin: 24px auto; background: #fff; color: #111; font-family: ui-sans-serif, system-ui, sans-serif; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,.35); }
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
        <div className="no-print" style={{ maxWidth: 800, margin: '0 auto 12px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="print-btn" onClick={() => window.print()}>🖨️ Print</button>
          <button className="print-btn" style={{ background: '#334155' }} onClick={() => window.close()}>Close</button>
        </div>
        <div className="print-sheet">
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '32px 40px', borderBottom: `4px solid ${accent}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {logoUrl && <img src={logoUrl} alt="logo" style={{ height: 56, objectFit: 'contain' }} />}
              <div>
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>{branding?.name || 'Coworking'}</h1>
                {branding?.tagline && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>{branding.tagline}</p>}
                {(branding?.address || branding?.phone || branding?.email) && (
                  <p style={{ margin: '6px 0 0', fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
                    {[branding.address, branding.phone, branding.email].filter(Boolean).join(' • ')}
                  </p>
                )}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <h2 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: 2 }}>INVOICE</h2>
              <p style={{ margin: '4px 0 0', fontSize: 14, fontWeight: 700 }}>{inv.number}</p>
            </div>
          </div>

          {/* Meta + Bill to */}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '24px 40px', gap: 24 }}>
            <div>
              <p style={{ margin: 0, fontSize: 11, textTransform: 'uppercase', color: '#64748b', letterSpacing: 1 }}>Bill to</p>
              <p style={{ margin: '6px 0 0', fontSize: 15, fontWeight: 700 }}>{inv.member?.name || '—'}</p>
              {inv.member?.companyName && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#475569' }}>{inv.member.companyName}</p>}
              {(inv.member?.phone || inv.member?.email) && (
                <p style={{ margin: '2px 0 0', fontSize: 12, color: '#475569' }}>{[inv.member.phone, inv.member.email].filter(Boolean).join(' • ')}</p>
              )}
            </div>
            <div style={{ textAlign: 'right', fontSize: 13, lineHeight: 1.9 }}>
              <div><span style={{ color: '#64748b' }}>Invoice date: </span><b>{dstr(inv.createdAt)}</b></div>
              <div><span style={{ color: '#64748b' }}>Period: </span><b>{dstr(inv.periodStart)} → {dstr(inv.periodEnd)}</b></div>
              <div><span style={{ color: '#64748b' }}>Due date: </span><b>{dstr(inv.dueDate)}</b></div>
            </div>
          </div>

          {/* Line items */}
          <div style={{ padding: '0 40px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f1f5f9' }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #e2e8f0' }}>Description</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', borderBottom: '2px solid #e2e8f0' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: '12px', borderBottom: '1px solid #f1f5f9' }}>
                    Coworking charges — {dstr(inv.periodStart)} to {dstr(inv.periodEnd)}
                    {inv.notes && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{inv.notes}</div>}
                  </td>
                  <td style={{ padding: '12px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 600 }}>{money(amount)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Totals + stamp */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '24px 40px' }}>
            <div>
              <span style={{ display: 'inline-block', border: `3px solid ${st.border}`, color: st.color, fontWeight: 800, fontSize: 18, letterSpacing: 2, padding: '8px 20px', borderRadius: 8, transform: 'rotate(-4deg)' }}>{st.label}</span>
            </div>
            <div style={{ fontSize: 14, lineHeight: 2, minWidth: 220 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Subtotal</span><b>{money(amount)}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Paid</span><b style={{ color: '#16a34a' }}>{money(paid)}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #111', paddingTop: 6, fontSize: 17 }}><span>Balance due</span><b>{money(balance)}</b></div>
            </div>
          </div>

          {/* Payments */}
          {inv.payments?.length > 0 && (
            <div style={{ padding: '0 40px 24px' }}>
              <p style={{ fontSize: 11, textTransform: 'uppercase', color: '#64748b', letterSpacing: 1, margin: '0 0 8px' }}>Payment history</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <tbody>
                  {inv.payments.map((p) => (
                    <tr key={p.id}>
                      <td style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>{dstr(p.paidAt)}</td>
                      <td style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9', textTransform: 'capitalize' }}>{p.method}</td>
                      <td style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>{p.receiptNo || '—'}</td>
                      <td style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 600 }}>{money(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer */}
          <div style={{ padding: '20px 40px 32px', borderTop: '1px solid #e2e8f0', fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
            Thank you for your business. Please pay by the due date to avoid service interruption.
          </div>
        </div>
      </div>
    </>
  );
}
