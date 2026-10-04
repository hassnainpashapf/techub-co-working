'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const STORAGE_KEY = 'tour_completed';

const STEPS = [
  {
    path: '/dashboard',
    target: 'aside nav',
    title: 'Sidebar Navigation',
    text: 'Yahan se tamam modules milenge — Workspaces, Team, Finance, Members aur bohat kuch. Har section expand kar ke dekho.',
  },
  {
    path: '/discover',
    target: 'aside a[href="/discover"]',
    title: 'Discover Booking',
    text: 'Available workspaces browse karo — filters lagao, favorites mark karo aur pasand aaye to foran Book Now dabao.',
  },
  {
    path: '/bookings',
    target: '[data-tour="new-booking"]',
    title: 'New Booking',
    text: 'Is button se nayi booking banao — member, unit, date aur time select karo. Yahan booking history bhi nazar aayegi.',
  },
  {
    path: '/members',
    target: 'aside a[href="/members"]',
    title: 'Members',
    text: 'Tamam members, unke contracts, invoices aur timeline yahan manage hoti hai. Member par click kar ke poori detail dekho.',
  },
  {
    path: '/finance',
    target: 'aside a[href="/finance"]',
    title: 'Finance',
    text: 'Revenue, expenses, invoices aur payments — poora hisab-kitab yahan. Reports se CSV export bhi kar sakte ho.',
  },
  {
    path: '/dashboard',
    target: 'header a[href="/notifications"]',
    title: 'Notifications',
    text: 'Bell icon par tamam alerts milenge — bookings, payments, tickets aur announcements. Kuch miss nahi hoga!',
  },
];

function getRect(selector) {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function startTour() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('onboarding-tour-start'));
}

export default function OnboardingTour() {
  const router = useRouter();
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState(null);
  const [ready, setReady] = useState(false);
  const stepIdxRef = useRef(0);
  const activeRef = useRef(false);

  const finish = useCallback(() => {
    setActive(false);
    activeRef.current = false;
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch { /* ignore */ }
  }, []);

  const showStep = useCallback((idx) => {
    stepIdxRef.current = idx;
    setStepIdx(idx);
    setReady(false);
    const step = STEPS[idx];
    if (!step) {
      finish();
      return;
    }
    // Navigate if needed
    if (step.path && window.location.pathname !== step.path) {
      router.push(step.path);
    }
    // Wait for target element (up to ~3s)
    let tries = 0;
    const tick = () => {
      tries += 1;
      const r = getRect(step.target);
      if (r) {
        setRect(r);
        setReady(true);
        return;
      }
      if (tries < 30 && activeRef.current && stepIdxRef.current === idx) {
        setTimeout(tick, 100);
      } else if (activeRef.current && stepIdxRef.current === idx) {
        // Target not found — skip this step
        const next = idx + 1;
        if (next >= STEPS.length) finish();
        else showStep(next);
      }
    };
    setTimeout(tick, 350);
  }, [finish, router]);

  const start = useCallback(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) return; // mobile: skip
    setActive(true);
    activeRef.current = true;
    showStep(0);
  }, [showStep]);

  // Auto-start on first login
  useEffect(() => {
    let done = false;
    try {
      done = localStorage.getItem(STORAGE_KEY) === '1';
    } catch { /* ignore */ }
    if (done) return;
    if (typeof window !== 'undefined' && window.innerWidth < 768) return;
    const t = setTimeout(() => start(), 1000);
    const onManual = () => start();
    window.addEventListener('onboarding-tour-start', onManual);
    return () => {
      clearTimeout(t);
      window.removeEventListener('onboarding-tour-start', onManual);
    };
  }, [start]);

  // Re-position on scroll/resize while active
  useEffect(() => {
    if (!active) return;
    const reposition = () => {
      const step = STEPS[stepIdxRef.current];
      if (step) {
        const r = getRect(step.target);
        if (r) setRect(r);
      }
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [active]);

  // Scroll target into view when step becomes ready
  useEffect(() => {
    if (ready && rect) {
      const step = STEPS[stepIdx];
      const el = step && document.querySelector(step.target);
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }, [ready, rect, stepIdx]);

  // Escape key closes
  useEffect(() => {
    if (!active) return;
    const onKey = (e) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, finish]);

  if (!active || !ready || !rect) return null;

  const step = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;
  const pad = 8;
  const hl = {
    top: Math.max(4, rect.top - pad),
    left: Math.max(4, rect.left - pad),
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
  // Tooltip position: below if space, else above
  const tooltipBelow = hl.top + hl.height + 200 < window.innerHeight;
  const tooltipStyle = {
    top: tooltipBelow ? hl.top + hl.height + 12 : Math.max(12, hl.top - 190),
    left: Math.min(Math.max(12, hl.left), window.innerWidth - 340),
    width: 320,
  };

  const go = (dir) => {
    const next = stepIdx + dir;
    if (next < 0) return;
    if (next >= STEPS.length) finish();
    else showStep(next);
  };

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Dim overlay with spotlight cutout (4 panels around highlight) */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-x-0 top-0 bg-black/70" style={{ height: hl.top }} />
        <div className="absolute inset-x-0 bottom-0 bg-black/70" style={{ top: hl.top + hl.height }} />
        <div className="absolute bg-black/70" style={{ top: hl.top, left: 0, width: hl.left, height: hl.height }} />
        <div className="absolute bg-black/70" style={{ top: hl.top, left: hl.left + hl.width, right: 0, height: hl.height }} />
      </div>
      {/* Highlight ring */}
      <div
        className="absolute rounded-xl border-2 border-blue-400 pointer-events-none transition-all duration-300"
        style={{
          top: hl.top, left: hl.left, width: hl.width, height: hl.height,
          boxShadow: '0 0 0 4px rgba(96,165,250,0.25), 0 0 40px rgba(96,165,250,0.35)',
        }}
      />
      {/* Tooltip */}
      <div className="absolute card-premium p-5 transition-all duration-300" style={tooltipStyle}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-blue-700 uppercase tracking-wider">
            Step {stepIdx + 1} of {STEPS.length}
          </span>
          <button onClick={finish} className="text-slate-500 hover:text-gray-900 text-lg leading-none" aria-label="Skip tour">×</button>
        </div>
        <h3 className="text-gray-900 font-bold text-[16px] mb-1.5">{step.title}</h3>
        <p className="text-gray-600 text-[13.5px] leading-relaxed mb-3">{step.text}</p>
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${i === stepIdx ? 'bg-blue-400' : i < stepIdx ? 'bg-blue-400/40' : 'bg-white/15'}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {stepIdx > 0 && (
              <button onClick={() => go(-1)} className="btn-secondary btn-sm">Back</button>
            )}
            <button onClick={finish} className="text-gray-500 hover:text-gray-900 text-[13px] px-2">Skip</button>
            <button onClick={() => go(1)} className="btn-primary btn-sm">
              {isLast ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
