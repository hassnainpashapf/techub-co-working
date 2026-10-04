'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE } from '../../../lib/api';

// Phase 36 Track 4: public contract signing page (no login — token link).
export default function SignContractPage({ params }) {
  const token = params.token;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [done, setDone] = useState(null); // 'signed' | 'declined'
  const [declineReason, setDeclineReason] = useState('');
  const [typedName, setTypedName] = useState('');
  const [useTyped, setUseTyped] = useState(false);
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const drawnRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/esign/sign/${encodeURIComponent(token)}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message || 'Could not load this signing request.');
      setData(d.signature);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Signature pad
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#e2e8f0';

    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };
    const start = (e) => {
      e.preventDefault();
      drawingRef.current = true;
      const { x, y } = pos(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
    };
    const move = (e) => {
      if (!drawingRef.current) return;
      e.preventDefault();
      const { x, y } = pos(e);
      ctx.lineTo(x, y);
      ctx.stroke();
      drawnRef.current = true;
    };
    const end = () => { drawingRef.current = false; };

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);
    return () => {
      canvas.removeEventListener('mousedown', start);
      canvas.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
      canvas.removeEventListener('touchstart', start);
      canvas.removeEventListener('touchmove', move);
      canvas.removeEventListener('touchend', end);
    };
  }, [data]);

  function clearPad() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    drawnRef.current = false;
  }

  // Render typed name onto the canvas so the stored image is the signature.
  function renderTypedToCanvas(name) {
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'italic 44px "Brush Script MT", "Segoe Script", cursive';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 16, rect.height / 2);
    ctx.restore();
    drawnRef.current = true;
  }

  async function handleSign() {
    setError('');
    if (useTyped) {
      if (!typedName.trim()) { setError('Please type your full name to sign.'); return; }
      renderTypedToCanvas(typedName.trim());
    } else if (!drawnRef.current) {
      setError('Please draw your signature first (or switch to typed signature).');
      return;
    }
    const dataUrl = canvasRef.current.toDataURL('image/png');
    setSigning(true);
    try {
      const r = await fetch(`${API_BASE}/esign/sign/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureDataUrl: dataUrl, typedName: useTyped ? typedName.trim() : null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message || 'Signing failed.');
      setDone('signed');
    } catch (e) {
      setError(e.message);
    } finally {
      setSigning(false);
    }
  }

  async function handleDecline() {
    setError('');
    setDeclining(true);
    try {
      const r = await fetch(`${API_BASE}/esign/sign/${encodeURIComponent(token)}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: declineReason || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message || 'Could not decline.');
      setDone('declined');
    } catch (e) {
      setError(e.message);
    } finally {
      setDeclining(false);
    }
  }

  const c = data?.contract || {};
  const pending = data && data.status === 'pending';

  return (
    <div className="min-h-screen bg-[#f4f5f7] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl rounded-2xl border border-gray-200 bg-gray-100 p-6 sm:p-8">
        <h1 className="text-xl font-extrabold text-gray-900 mb-1">✍️ Contract Signature</h1>
        <p className="text-sm text-gray-500 mb-6">Review the contract summary below, then sign.</p>

        {loading && <p className="text-gray-500 text-sm">Loading…</p>}
        {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 mb-4">{error}</p>}

        {done === 'signed' && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
            <p className="text-2xl mb-2">✅</p>
            <p className="font-semibold text-emerald-700">Contract signed successfully.</p>
            <p className="text-sm text-gray-500 mt-1">A confirmation has been recorded with timestamp and IP address.</p>
          </div>
        )}
        {done === 'declined' && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-center">
            <p className="text-2xl mb-2">📝</p>
            <p className="font-semibold text-amber-700">You declined to sign.</p>
            <p className="text-sm text-gray-500 mt-1">The coworking team has been notified.</p>
          </div>
        )}

        {data && !done && (
          <>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 mb-5 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><p className="text-xs text-slate-500">Member</p><p className="text-gray-900 font-medium">{c.memberName || '—'}</p></div>
                <div><p className="text-xs text-slate-500">Unit</p><p className="text-gray-900 font-medium">{c.unitCode || '—'}</p></div>
                <div><p className="text-xs text-slate-500">Start</p><p className="text-gray-900 font-medium">{c.startDate ? String(c.startDate).slice(0, 10) : '—'}</p></div>
                <div><p className="text-xs text-slate-500">End</p><p className="text-gray-900 font-medium">{c.endDate ? String(c.endDate).slice(0, 10) : '—'}</p></div>
                <div><p className="text-xs text-slate-500">Monthly rent</p><p className="text-gray-900 font-medium">Rs {Number(c.rentAmount || 0).toLocaleString()}</p></div>
                <div><p className="text-xs text-slate-500">Signer</p><p className="text-gray-900 font-medium">{data.signerName}</p></div>
              </div>
            </div>

            {data.status === 'signed' && (
              <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                Already signed on {data.signedAt ? new Date(data.signedAt).toLocaleString() : '—'}.
              </p>
            )}
            {data.status === 'declined' && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">This request was declined.</p>
            )}
            {data.status === 'expired' && (
              <p className="text-sm text-gray-600 bg-gray-100 border border-gray-200 rounded-lg p-3">This signing link has expired. Please ask the coworking team for a new one.</p>
            )}

            {pending && (
              <>
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => setUseTyped(false)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${!useTyped ? 'border-teal-500/60 bg-teal-600/20 text-violet-700' : 'border-gray-200 text-gray-500'}`}>
                    Draw signature
                  </button>
                  <button
                    onClick={() => setUseTyped(true)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${useTyped ? 'border-teal-500/60 bg-teal-600/20 text-violet-700' : 'border-gray-200 text-gray-500'}`}>
                    Type signature
                  </button>
                </div>

                {useTyped ? (
                  <input
                    className="input w-full mb-3"
                    placeholder="Type your full name"
                    value={typedName}
                    onChange={(e) => setTypedName(e.target.value)}
                  />
                ) : null}

                <div className="rounded-xl border border-dashed border-gray-300 bg-black/30 mb-2 overflow-hidden">
                  <canvas ref={canvasRef} className="w-full h-44 touch-none cursor-crosshair" />
                </div>
                {!useTyped && (
                  <button onClick={clearPad} className="text-xs text-gray-500 hover:text-gray-900 mb-4">Clear</button>
                )}

                <div className="flex gap-3 mt-2">
                  <button onClick={handleSign} disabled={signing} className="btn-primary flex-1">
                    {signing ? 'Signing…' : 'Sign contract'}
                  </button>
                </div>
                <details className="mt-4">
                  <summary className="text-xs text-slate-500 cursor-pointer hover:text-gray-600">Decline instead</summary>
                  <div className="mt-2">
                    <input
                      className="input w-full mb-2"
                      placeholder="Reason (optional)"
                      value={declineReason}
                      onChange={(e) => setDeclineReason(e.target.value)}
                    />
                    <button onClick={handleDecline} disabled={declining} className="text-xs px-3 py-2 rounded-lg border border-red-500/40 text-red-700 hover:bg-red-50">
                      {declining ? 'Sending…' : 'Decline to sign'}
                    </button>
                  </div>
                </details>
                <p className="text-[11px] text-slate-500 mt-4">
                  By signing, you agree to the contract terms. Your IP address and the exact time of signing are recorded for legal purposes.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

