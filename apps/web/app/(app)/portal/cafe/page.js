'use client';

// Phase 43 Track 2: Member ordering — menu browse + cart + my orders.
// Server-side price hota hai; cart sirf qty/name bhejta hai.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Spinner, EmptyState, ErrorBanner, Modal } from '../../../../components/ui';

const STATUS_COLOR = { pending: 'amber', preparing: 'blue', ready: 'green', delivered: 'slate', cancelled: 'red' };

export default function PortalCafePage() {
  const [menu, setMenu] = useState([]); // [{id,name,price,isAvailable,categoryName,avgRating,ratingCount}]
  const [menuLoading, setMenuLoading] = useState(true);
  const [zones, setZones] = useState([]); // delivery zones
  const [sortTop, setSortTop] = useState(false);
  const [orders, setOrders] = useState([]);
  const [cart, setCart] = useState({}); // id -> qty
  const [note, setNote] = useState('');
  const [zone, setZone] = useState('');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');
  const [showCart, setShowCart] = useState(false);

  const load = async () => {
    setError('');
    try {
      const [{ data: m }, { data: o }] = await Promise.all([
        api.get('/menu'),
        api.get('/food-orders/mine'),
      ]);
      // GET /menu returns {categories:[{items}]} — flatten (fallback {items} bhi)
      const flat = (m.categories || []).flatMap((c) =>
        (c.items || []).map((i) => ({ ...i, categoryName: c.name }))
      );
      const items = flat.length ? flat : (m.items || m.menuItems || []);
      setMenu(items.filter((i) => i.isAvailable !== false));
      setOrders(o.orders || []);
      try {
        const { data: z } = await api.get('/delivery-zones/active');
        setZones(z.zones || z || []);
      } catch { /* zones optional */ }
    } catch (e) {
      // menu track abhi merge na hua ho to orders par fallback
      try {
        const { data: o } = await api.get('/food-orders/mine');
        setOrders(o.orders || []);
      } catch (e2) {
        setError(e2?.response?.data?.error?.message || 'Failed to load orders.');
      }
    } finally {
      setMenuLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const cartItems = useMemo(() =>
    Object.entries(cart)
      .map(([id, qty]) => ({ ...menu.find((m) => m.id === id), qty }))
      .filter((i) => i.id && i.qty > 0),
    [cart, menu]
  );
  const cartTotal = useMemo(
    () => cartItems.reduce((s, i) => s + i.qty * Number(i.price || 0), 0),
    [cartItems]
  );

  const sortedMenu = useMemo(() => {
    const list = [...menu];
    if (sortTop) list.sort((a, b) => (Number(b.avgRating) || 0) - (Number(a.avgRating) || 0));
    return list;
  }, [menu, sortTop]);

  const rateItem = async (id, score) => {
    try {
      await api.post(`/menu/items/${id}/rate`, { score });
      setMenu((mm) => mm.map((m) => (m.id === id ? { ...m, myRating: score } : m)));
    } catch (e) {
      setError(e?.response?.data?.error?.message || 'Rating fail ho gayi.');
    }
  };

  const add = (id) => setCart((c) => ({ ...c, [id]: (c[id] || 0) + 1 }));
  const sub = (id) => setCart((c) => {
    const next = { ...c };
    next[id] = (next[id] || 0) - 1;
    if (next[id] <= 0) delete next[id];
    return next;
  });

  const placeOrder = async () => {
    if (!cartItems.length) return;
    setPlacing(true);
    setError('');
    try {
      const { data } = await api.post('/food-orders', {
        items: cartItems.map((i) => ({
          menuItemId: i.id,
          name: i.name,
          qty: i.qty,
          price: Number(i.price || 0),
        })),
        note,
        deliveryZone: zone,
      });
      setOrders((o) => [data, ...o]);
      setCart({});
      setNote('');
      setShowCart(false);
    } catch (e) {
      setError(e?.response?.data?.error?.message || 'Order failed.');
    } finally {
      setPlacing(false);
    }
  };

  const cancelOrder = async (id) => {
    if (!confirm('Cancel this order?')) return;
    try {
      const { data } = await api.post(`/food-orders/${id}/cancel`);
      setOrders((o) => o.map((x) => (x.id === id ? data : x)));
    } catch (e) {
      setError(e?.response?.data?.error?.message || 'Cancel failed.');
    }
  };

  const activeOrders = orders.filter((o) => ['pending', 'preparing', 'ready'].includes(o.status));

  return (
    <div className="space-y-6">
      <PageHeader title="Café" subtitle="Order food & drinks from your desk" />

      {error && <ErrorBanner message={error} onClose={() => setError('')} />}

      {/* Active orders */}
      {activeOrders.length > 0 && (
        <div className="card-premium p-5">
          <h3 className="font-semibold mb-3">🔔 Active orders</h3>
          <div className="space-y-2">
            {activeOrders.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-3 rounded-lg bg-gray-100/60 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm">{o.items.map((i) => `${i.qty}x ${i.name}`).join(', ')}</div>
                  <div className="text-xs text-gray-500">Rs {Number(o.subtotal).toFixed(2)} · {new Date(o.orderedAt).toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge tone={STATUS_COLOR[o.status] || 'slate'}>{o.status}</Badge>
                  {['pending', 'preparing'].includes(o.status) && (
                    <button onClick={() => cancelOrder(o.id)} className="btn-ghost text-xs">Cancel</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Menu */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">🍽️ Menu</h3>
        <div className="flex items-center gap-2">
          <button onClick={() => setSortTop((s) => !s)} className={`btn-ghost text-sm ${sortTop ? 'text-amber-300' : ''}`}>
            ⭐ Top rated
          </button>
          {cartItems.length > 0 && (
            <button onClick={() => setShowCart(true)} className="btn-primary">
              🛒 Cart ({cartItems.reduce((s, i) => s + i.qty, 0)}) · Rs {cartTotal.toFixed(2)}
            </button>
          )}
        </div>
      </div>

      {menuLoading ? <Spinner /> : sortedMenu.length === 0 ? (
        <EmptyState icon="🍽️" title="Menu not available yet" text="The café menu will appear here once published." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sortedMenu.map((m) => (
            <div key={m.id} className="card-premium p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate">{m.name}</div>
                {m.description && <div className="text-xs text-gray-500 truncate">{m.description}</div>}
                <div className="text-sm font-semibold text-amber-300 mt-1">Rs {Number(m.price).toFixed(2)}</div>
                <div className="flex items-center gap-1 mt-1">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <button key={s} onClick={() => rateItem(m.id, s)} className={`text-sm ${(m.myRating || Math.round(m.avgRating || 0)) >= s ? 'text-amber-400' : 'text-gray-500'}`} title={`${s} star`}>
                      ★
                    </button>
                  ))}
                  {m.ratingCount > 0 && <span className="text-xs text-slate-500 ml-1">({m.ratingCount})</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {cart[m.id] ? (
                  <>
                    <button onClick={() => sub(m.id)} className="btn-ghost w-8 h-8">−</button>
                    <span className="font-semibold w-6 text-center">{cart[m.id]}</span>
                    <button onClick={() => add(m.id)} className="btn-ghost w-8 h-8">+</button>
                  </>
                ) : (
                  <button onClick={() => add(m.id)} className="btn-primary text-sm">Add</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Cart modal */}
      <Modal open={showCart} onClose={() => setShowCart(false)} title="Your order">
        <div className="space-y-3">
          {cartItems.map((i) => (
            <div key={i.id} className="flex items-center justify-between">
              <div>
                <div className="font-medium">{i.name}</div>
                <div className="text-xs text-gray-500">{i.qty} × Rs {Number(i.price).toFixed(2)}</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => sub(i.id)} className="btn-ghost w-8 h-8">−</button>
                <span className="w-6 text-center font-semibold">{i.qty}</span>
                <button onClick={() => add(i.id)} className="btn-ghost w-8 h-8">+</button>
              </div>
            </div>
          ))}
          {zones.length > 0 ? (
            <select value={zone} onChange={(e) => setZone(e.target.value)} className="input w-full">
              <option value="">Delivery location select karo…</option>
              {zones.map((z) => (
                <option key={z.id} value={z.name}>{z.name}</option>
              ))}
            </select>
          ) : (
            <input
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              placeholder="Delivery location (e.g. Desk A-12, Meeting Room 2)"
              className="input w-full"
            />
          )}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note for kitchen (optional)"
            className="input w-full"
          />
          <div className="flex items-center justify-between font-semibold">
            <span>Total</span>
            <span>Rs {cartTotal.toFixed(2)}</span>
          </div>
          <button onClick={placeOrder} disabled={placing || !cartItems.length} className="btn-primary w-full">
            {placing ? 'Placing…' : 'Place order'}
          </button>
        </div>
      </Modal>

      {/* Past orders */}
      <div className="card-premium p-5">
        <h3 className="font-semibold mb-3">Order history</h3>
        {orders.length === 0 ? (
          <div className="text-sm text-gray-500">No orders yet.</div>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-3 rounded-lg bg-gray-100/60 px-4 py-2.5">
                <div className="min-w-0 text-sm">
                  <span className="truncate block">{o.items.map((i) => `${i.qty}x ${i.name}`).join(', ')}</span>
                  <span className="text-xs text-gray-500">Rs {Number(o.subtotal).toFixed(2)} · {new Date(o.orderedAt).toLocaleString()}</span>
                </div>
                <Badge tone={STATUS_COLOR[o.status] || 'slate'}>{o.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
