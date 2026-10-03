'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// Global keyboard shortcuts for the app shell.
// Never fires while the user is typing in a form field.
const GO_TARGETS = { d: '/dashboard', b: '/bookings', m: '/members', i: '/billing', t: '/tickets' };

function Kbd({ children }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[26px] px-1.5 py-0.5 rounded-md bg-white/[0.07] border border-white/10 text-[12px] font-mono font-medium text-slate-200 shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]">
      {children}
    </kbd>
  );
}

function Row({ keys, label }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-[13.5px] text-slate-300">{label}</span>
      <span className="flex items-center gap-1">{keys}</span>
    </div>
  );
}

function ShortcutsHelp({ onClose }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative card-premium w-full max-w-md p-6 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-extrabold text-white">Keyboard shortcuts</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none px-2" aria-label="Close">×</button>
        </div>

        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Navigate</p>
        <div className="mb-4 divide-y divide-white/[0.04]">
          <Row keys={<><Kbd>g</Kbd><Kbd>d</Kbd></>} label="Go to Dashboard" />
          <Row keys={<><Kbd>g</Kbd><Kbd>b</Kbd></>} label="Go to Bookings" />
          <Row keys={<><Kbd>g</Kbd><Kbd>m</Kbd></>} label="Go to Members" />
          <Row keys={<><Kbd>g</Kbd><Kbd>i</Kbd></>} label="Go to Billing" />
          <Row keys={<><Kbd>g</Kbd><Kbd>t</Kbd></>} label="Go to Tickets" />
        </div>

        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Actions</p>
        <div className="mb-4 divide-y divide-white/[0.04]">
          <Row keys={<Kbd>/</Kbd>} label="Focus search" />
          <Row keys={<Kbd>n</Kbd>} label="New booking (on booking pages)" />
        </div>

        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">General</p>
        <div className="divide-y divide-white/[0.04]">
          <Row keys={<Kbd>?</Kbd>} label="Show this help" />
          <Row keys={<Kbd>Esc</Kbd>} label="Close dialog" />
        </div>

        <p className="mt-4 text-[12px] text-slate-500">Shortcuts don&apos;t fire while you&apos;re typing in a field.</p>
      </div>
    </div>
  );
}

export default function Shortcuts() {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const [gArmed, setGArmed] = useState(false);
  const gTimer = useRef(null);

  const disarmG = useCallback(() => {
    if (gTimer.current) clearTimeout(gTimer.current);
    gTimer.current = null;
    setGArmed(false);
  }, []);

  useEffect(() => {
    const isTyping = (el) => {
      if (!el) return false;
      const tag = (el.tagName || '').toUpperCase();
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };

    const onKey = (e) => {
      // Esc always closes the help dialog
      if (e.key === 'Escape') {
        if (helpOpen) { setHelpOpen(false); disarmG(); }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;

      // Toggle help
      if (e.key === '?') {
        e.preventDefault();
        disarmG();
        setHelpOpen((v) => !v);
        return;
      }
      if (helpOpen) return;

      // Two-key "g then x" navigation
      if (gArmed) {
        const target = GO_TARGETS[e.key.toLowerCase()];
        disarmG();
        if (target) {
          e.preventDefault();
          router.push(target);
        }
        return;
      }
      if (e.key.toLowerCase() === 'g') {
        e.preventDefault();
        setGArmed(true);
        if (gTimer.current) clearTimeout(gTimer.current);
        gTimer.current = setTimeout(() => setGArmed(false), 900);
        return;
      }

      // Focus topbar search
      if (e.key === '/') {
        e.preventDefault();
        const input = document.getElementById('topbar-search');
        if (input) input.focus();
        return;
      }

      // New booking — pages with a booking dialog listen for this event
      if (e.key.toLowerCase() === 'n') {
        window.dispatchEvent(new CustomEvent('coworkos:new-booking'));
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (gTimer.current) clearTimeout(gTimer.current);
    };
  }, [router, helpOpen, gArmed, disarmG]);

  return (
    <>
      {gArmed && !helpOpen && (
        <div className="fixed bottom-5 right-5 z-[90] px-3 py-1.5 rounded-lg bg-[#12121f] border border-blue-500/40 shadow-lg shadow-blue-500/20 text-[13px] text-slate-200">
          <Kbd>g</Kbd> <span className="text-slate-400">… then d / b / m / i / t</span>
        </div>
      )}
      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
    </>
  );
}
