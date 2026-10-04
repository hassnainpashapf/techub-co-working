'use client';

// Phase 33 Track 10: Web Push device toggle.
// Is device par push notifications enable/disable + permission prompt + test.

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export default function PushToggle() {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState('default');
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setSupported(ok);
    if (!ok) return;
    setPermission(Notification.permission);
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => {});
  }, []);

  const enable = async () => {
    setBusy(true);
    setMsg('');
    try {
      if (!supported) throw new Error('Is browser me push supported nahi hai.');
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') throw new Error('Permission denied — browser settings se allow karein.');
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const { publicKey } = await api.get('/push/vapid-key');
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }
      const json = sub.toJSON();
      await api.post('/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
      setSubscribed(true);
      setMsg('Push notifications on ho gayi hain ✅');
    } catch (e) {
      setMsg(e.message || 'Enable nahi ho saki.');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setMsg('');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = encodeURIComponent(sub.endpoint);
        await sub.unsubscribe();
        await api.del(`/push/unsubscribe?endpoint=${endpoint}`).catch(() => {});
      } else {
        await api.del('/push/unsubscribe').catch(() => {});
      }
      setSubscribed(false);
      setMsg('Push notifications off kar di gayi hain.');
    } catch (e) {
      setMsg(e.message || 'Disable nahi ho saki.');
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    setMsg('');
    try {
      const { result } = await api.post('/push/test');
      if (result && result.sent > 0) setMsg('Test push bhej di gayi! 🔔');
      else setMsg('Koi active subscription nahi mili.');
    } catch (e) {
      setMsg(e.message || 'Test failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!supported) {
    return (
      <div className="card-premium p-5 mb-6">
        <h3 className="text-gray-900 font-semibold mb-1">🔔 Push Notifications</h3>
        <p className="text-sm text-gray-500">Is browser/device me web push supported nahi hai.</p>
      </div>
    );
  }

  return (
    <div className="card-premium p-5 mb-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-gray-900 font-semibold">🔔 Push Notifications</h3>
          <p className="text-sm text-gray-500 mt-1">
            Is device par browser notifications — {permission === 'granted' ? 'permission granted' : permission === 'denied' ? 'permission blocked (browser settings se allow karein)' : 'permission abhi nahi mili'}.
            {subscribed ? ' Status: ON' : ' Status: OFF'}
          </p>
        </div>
        <div className="flex gap-2">
          {subscribed && (
            <button type="button" onClick={sendTest} disabled={busy} className="btn-secondary">
              {busy ? '…' : 'Test bhejo'}
            </button>
          )}
          {subscribed ? (
            <button type="button" onClick={disable} disabled={busy} className="btn-secondary">
              {busy ? '…' : 'Off karo'}
            </button>
          ) : (
            <button type="button" onClick={enable} disabled={busy} className="btn-primary">
              {busy ? '…' : 'On karo'}
            </button>
          )}
        </div>
      </div>
      {msg && <p className="text-sm text-gray-600 mt-3">{msg}</p>}
    </div>
  );
}

// PushToggle component end
