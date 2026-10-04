'use client';

import { useEffect, useState } from 'react';

const DISMISS_KEY = 'techub-ios-guide-dismissed';

function isIosDevice() {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || '';
  const isIPhone = /iPhone|iPod/i.test(ua);
  const isIPad = /iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return isIPhone || isIPad;
}

function isSafari() {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || '';
  // Safari on iOS: contains "Safari" but not Chrome/Chromium/Firefox/Opera/Edge
  return /Safari/i.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser/i.test(ua);
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  if (window.navigator.standalone === true) return true;
  try {
    return window.matchMedia('(display-mode: standalone)').matches;
  } catch (_e) {
    return false;
  }
}

export default function IosInstallGuide() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === '1') return;
    } catch (_e) { /* ignore */ }
    if (isIosDevice() && isSafari() && !isStandalone()) {
      const t = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(t);
    }
  }, []);

  const dismiss = () => {
    try { window.localStorage.setItem(DISMISS_KEY, '1'); } catch (_e) { /* ignore */ }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 inset-x-4 z-[60] sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[360px]">
      <div className="rounded-2xl bg-white border border-gray-200 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.35)] p-4">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl bg-teal-600 flex items-center justify-center text-white font-bold text-[18px] shrink-0">T</span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-bold text-gray-900">Install Techub on your iPhone</h3>
            <p className="text-[12px] text-gray-500 mt-0.5">Add the app icon to your home screen for quick access.</p>
          </div>
          <button onClick={dismiss} aria-label="Dismiss"
            className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <ol className="mt-3 space-y-2.5 text-[13px] text-gray-700">
          <li className="flex items-center gap-2.5">
            <span className="w-5 h-5 rounded-full bg-teal-100 text-teal-800 text-[11px] font-bold flex items-center justify-center shrink-0">1</span>
            <span>Tap the <strong>Share</strong> button in Safari</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0f766e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
          </li>
          <li className="flex items-center gap-2.5">
            <span className="w-5 h-5 rounded-full bg-teal-100 text-teal-800 text-[11px] font-bold flex items-center justify-center shrink-0">2</span>
            <span>Tap <strong>&ldquo;Add to Home Screen&rdquo;</strong></span>
          </li>
          <li className="flex items-center gap-2.5">
            <span className="w-5 h-5 rounded-full bg-teal-100 text-teal-800 text-[11px] font-bold flex items-center justify-center shrink-0">3</span>
            <span>Tap <strong>&ldquo;Add&rdquo;</strong> to confirm</span>
          </li>
        </ol>
        <button onClick={dismiss} className="btn-primary w-full mt-3 !py-2 text-[13px]">Got it</button>
      </div>
    </div>
  );
}
