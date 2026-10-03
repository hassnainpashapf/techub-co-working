'use client';

import { useEffect, useState } from 'react';

const DISMISS_KEY = 'techub-pwa-dismissed';

/**
 * Captures the browser's beforeinstallprompt and shows a branded
 * "Install app" banner. Hidden once the app is installed or dismissed.
 */
export default function PwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') return;
      // Already installed (standalone mode)? Never show.
      if (window.matchMedia('(display-mode: standalone)').matches) return;
      if (window.navigator.standalone === true) return; // iOS
    } catch (e) { /* storage unavailable */ }

    const onPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    };
    const onInstalled = () => {
      setDeferredPrompt(null);
      setVisible(false);
      try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) {}
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) {}
  };

  const install = async () => {
    if (!deferredPrompt) return;
    try {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch (e) { /* ignore */ }
    setDeferredPrompt(null);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-[90] sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm">
      <div className="rounded-2xl p-4 shadow-2xl border border-violet-500/30 bg-gradient-to-br from-[#1c1c30] to-[#12121f]">
        <div className="flex items-start gap-3">
          <img src="/icon-192.png" alt="Techub" className="w-11 h-11 rounded-xl shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white">Install Techub App</p>
            <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
              Add Techub to your home screen for faster access and offline support.
            </p>
          </div>
          <button
            onClick={dismiss}
            aria-label="Dismiss"
            className="text-slate-500 hover:text-slate-300 text-lg leading-none px-1"
          >
            ×
          </button>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={install}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-violet-600 to-blue-600 hover:opacity-90 transition"
          >
            Install app
          </button>
          <button
            onClick={dismiss}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-300 bg-white/5 hover:bg-white/10 transition"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
