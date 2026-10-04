'use client';

// Phase 43 Track 3: Kitchen Display System — bade order cards, live elapsed timer,
// 5s polling, Start/Ready actions, late orders red highlight + naye order par beep.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Spinner, ErrorBanner, EmptyState, StatCard } from '../../../../components/ui';

const LATE_MIN = 15; // is se purana order red

function fmtElapsed(min) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
}

function shortId(id) {
  return id ? '#' + String(id).slice(-6).toUpperCase() : '';
}

// Browser beep (Web Audio) — naye order par. Toggleable.
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [523, 659, 784].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.start(t); o.stop(t + 0.18);
    });
    setTimeout(() => ctx.close(), 900);
  } catch { /* ignore */ }
}

function OrderCard({ order, onStart, onReady, onPay, busy }) {
  const late = order.elapsedMin >= LATE_MIN;
  const items = Array.isArray(order.items) ? order.items : [];
  const totalQty = items.reduce((s, it) => s + Number(it.qty || 0), 0);
  const paid = order.paymentStatus === 'paid' || order.paymentStatus === 'added_to_invoice';
  return (
    <div className={`rounded-2xl border p-5 shadow-lg transition ${
      late ? 'border-red-200 bg-red-50'
           : order.status === 'preparing' ? 'border-amber-200 bg-amber-50'
           : 'border-teal-200 bg-white'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-2xl font-bold text-gray-900">{shortId(order.id)}</div>
          <div className="text-sm text-gray-600">{order.member ? order.member.name : '—'}</div>
          {order.member && order.member.phone && (
            <div className="text-xs text-gray-500">{order.member.phone}</div>
          )}
        </div>
        <div className="text-right">
          <div className={`text-3xl font-extrabold tabular-nums ${late ? 'text-red-700' : 'text-gray-900'}`}>
            {fmtElapsed(order.elapsedMin)}
          </div>
          <div className="mt-1 flex gap-1 justify-end">
            <Badge tone={order.status === 'pending' ? 'violet' : 'amber'}>
              {order.status === 'pending' ? 'New' : 'Preparing'}
            </Badge>
            {late && <Badge tone="red">LATE</Badge>}
            <Badge tone={paid ? 'green' : 'red'}>{paid ? 'Paid' : 'Unpaid'}</Badge>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        {items.map((it, i) => (
          <div key={i} className="flex justify-between text-base">
            <span className="text-gray-800">
              <span className="inline-block min-w-[2.2rem] font-bold text-teal-700">{it.qty}×</span>
              {it.name}
            </span>
            <span className="text-gray-500">Rs {Number(it.price || 0).toLocaleString()}</span>
          </div>
        ))}
        {items.length === 0 && <div className="text-slate-500 text-sm">No items</div>}
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
        <span>{totalQty} items</span>
        {order.deliveryZone && <span>· Zone: {order.deliveryZone}</span>}
        {order.subtotal != null && <span>· <b className="text-gray-800">Rs {Number(order.subtotal).toLocaleString()}</b></span>}
      </div>
      {order.note && (
        <div className="mt-2 rounded-lg bg-yellow-400/10 border border-yellow-400/30 px-3 py-2 text-sm text-yellow-200">
          📝 {order.note}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        {!paid && onPay && (
          <button
            onClick={() => onPay(order)}
            disabled={busy}
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-lg font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
          >
            💰 Pay
          </button>
        )}
        {order.status === 'pending' && (
          <button
            onClick={() => onStart(order.id)}
            disabled={busy}
            className="flex-1 rounded-xl bg-[#0f766e] px-4 py-3 text-lg font-bold text-white shadow-lg hover:bg-[#0d6b63] disabled:opacity-50"
          >
            {busy ? '…' : '▶ Start Cooking'}
          </button>
        )}
        {order.status === 'preparing' && (
          <button
            onClick={() => onReady(order.id)}
            disabled={busy}
            className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-lg font-bold text-white shadow-lg hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? '…' : '✅ Mark Ready'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function KitchenPage() {
  const [orders, setOrders] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, preparing: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [soundOn, setSoundOn] = useState(true);
  const [payOrder, setPayOrder] = useState(null); // order object
  const [payMethod, setPayMethod] = useState('cash');
  const [showWaste, setShowWaste] = useState(false);
  const [waste, setWaste] = useState({ description: '', quantity: 1, reason: 'spoiled', costEstimate: '' });
  const knownIds = useRef(new Set());

  const load = useCallback(async () => {
    try {
      const data = await api.get('/api/kitchen/queue');
      const list = data.orders || [];
      // Naya order aaye to beep
      if (soundOn && knownIds.current.size > 0) {
        const fresh = list.some((o) => !knownIds.current.has(o.id));
        if (fresh) beep();
      }
      knownIds.current = new Set(list.map((o) => o.id));
      setOrders(list);
      setCounts(data.counts || { pending: 0, preparing: 0 });
      setError('');
    } catch (e) {
      setError(e.message || 'Queue load nahi hui');
    } finally {
      setLoading(false);
    }
  }, [soundOn]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000); // 5s polling
    return () => clearInterval(t);
  }, [load]);

  const act = async (id, kind) => {
    setBusyId(id);
    try {
      await api.post(`/api/kitchen/${id}/${kind}`);
      await load();
    } catch (e) {
      setError(e.message || 'Action fail ho gaya');
    } finally {
      setBusyId(null);
    }
  };

  const doPay = async () => {
    if (!payOrder) return;
    setBusyId(payOrder.id);
    try {
      await api.post(`/api/food-orders/${payOrder.id}/pay`, { method: payMethod });
      setPayOrder(null);
      await load();
    } catch (e) {
      setError(e.message || 'Payment fail ho gaya');
    } finally {
      setBusyId(null);
    }
  };

  const doLogWaste = async () => {
    try {
      await api.post('/api/food-waste', {
        description: waste.description,
        quantity: Number(waste.quantity) || 1,
        reason: waste.reason,
        costEstimate: waste.costEstimate ? Number(waste.costEstimate) : undefined,
      });
      setShowWaste(false);
      setWaste({ description: '', quantity: 1, reason: 'spoiled', costEstimate: '' });
    } catch (e) {
      setError(e.message || 'Waste log fail ho gaya');
    }
  };

  const pending = orders.filter((o) => o.status === 'pending');
  const preparing = orders.filter((o) => o.status === 'preparing');
  const lateCount = orders.filter((o) => o.elapsedMin >= LATE_MIN).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kitchen Display"
        sub="Live order queue — har 5 second me auto-refresh"
        actions={
          <div className="flex gap-2">
            <button
              onClick={() => setShowWaste(true)}
              className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100"
            >
              🗑 Log waste
            </button>
            <button
              onClick={() => setSoundOn((s) => !s)}
              className={`rounded-xl border px-4 py-2 text-sm font-semibold ${
                soundOn ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-300 text-gray-500'
              }`}
            >
              {soundOn ? '🔔 Sound ON' : '🔕 Sound OFF'}
            </button>
          </div>
        }
      />

      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="New Orders" value={counts.pending} accent="violet" />
        <StatCard label="Preparing" value={counts.preparing} accent="amber" />
        <StatCard label="Late (15m+)" value={lateCount} accent="red" />
        <StatCard label="Total Active" value={orders.length} accent="blue" />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : orders.length === 0 ? (
        <EmptyState title="Koi active order nahi" hint="Naye orders yahan khud aa jayenge." />
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-3">🆕 New ({pending.length})</h2>
            <div className="space-y-4">
              {pending.map((o) => (
                <OrderCard key={o.id} order={o} onStart={(id) => act(id, 'start')} onPay={(o2) => setPayOrder(o2)} busy={busyId === o.id} />
              ))}
              {pending.length === 0 && <div className="text-slate-500 text-sm">Koi new order nahi</div>}
            </div>
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-3">🍳 Preparing ({preparing.length})</h2>
            <div className="space-y-4">
              {preparing.map((o) => (
                <OrderCard key={o.id} order={o} onReady={(id) => act(id, 'ready')} onPay={(o2) => setPayOrder(o2)} busy={busyId === o.id} />
              ))}
              {preparing.length === 0 && <div className="text-slate-500 text-sm">Koi preparing order nahi</div>}
            </div>
          </div>
        </div>
      )}

      {payOrder && (
        <Modal onClose={() => setPayOrder(null)} title={`💰 Payment — Rs ${Number(payOrder.subtotal || 0).toLocaleString()}`}>
          <div className="space-y-4">
            <div className="text-sm text-gray-500">{payOrder.member ? payOrder.member.name : ''} ka order</div>
            <div>
              <label className="text-sm text-gray-600">Payment method</label>
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="input w-full mt-1">
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="invoice">Add to member invoice</option>
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setPayOrder(null)} className="btn-ghost px-4 py-2 rounded-xl">Cancel</button>
              <button onClick={doPay} disabled={busyId === payOrder.id} className="rounded-xl bg-emerald-600 px-6 py-2 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                {busyId === payOrder.id ? '…' : 'Confirm payment'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showWaste && (
        <Modal onClose={() => setShowWaste(false)} title="🗑 Log food waste">
          <div className="space-y-4">
            <div>
              <label className="text-sm text-gray-600">Kya waste hua?</label>
              <input value={waste.description} onChange={(e) => setWaste((w) => ({ ...w, description: e.target.value }))} placeholder="e.g. 5x chicken biryani" className="input w-full mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-gray-600">Quantity</label>
                <input type="number" min="1" value={waste.quantity} onChange={(e) => setWaste((w) => ({ ...w, quantity: e.target.value }))} className="input w-full mt-1" />
              </div>
              <div>
                <label className="text-sm text-gray-600">Est. cost (Rs)</label>
                <input type="number" min="0" value={waste.costEstimate} onChange={(e) => setWaste((w) => ({ ...w, costEstimate: e.target.value }))} placeholder="optional" className="input w-full mt-1" />
              </div>
            </div>
            <div>
              <label className="text-sm text-gray-600">Reason</label>
              <select value={waste.reason} onChange={(e) => setWaste((w) => ({ ...w, reason: e.target.value }))} className="input w-full mt-1">
                <option value="spoiled">Spoiled</option>
                <option value="overcooked">Overcooked</option>
                <option value="expired">Expired</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowWaste(false)} className="btn-ghost px-4 py-2 rounded-xl">Cancel</button>
              <button onClick={doLogWaste} disabled={!waste.description.trim()} className="rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 px-6 py-2 font-bold text-gray-900 disabled:opacity-50">
                Log waste
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
