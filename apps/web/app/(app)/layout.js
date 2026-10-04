'use client';

import { useEffect, useState } from 'react';
import Protected from '../../components/Protected';
import Sidebar from '../../components/Sidebar';
import Topbar from '../../components/Topbar';
import Shortcuts from '../../components/Shortcuts';
import OnboardingTour from '../../components/OnboardingTour';

const KEY = 'cw_sidebar_open';

export default function AppLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(KEY);
      if (v === '0') setSidebarOpen(false);
      // Permanent 90% page zoom (zoom control removed) — matches the compact look
      window.localStorage.removeItem('cw_zoom');
      document.body.style.zoom = '0.9';
    } catch (_e) { /* ignore */ }
  }, []);

  const toggle = () => {
    setSidebarOpen((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(KEY, next ? '1' : '0'); } catch (_e) { /* ignore */ }
      return next;
    });
  };

  return (
    <Protected>
      <div className="flex min-h-screen relative bg-[#f4f5f7]">
        <div className="relative z-10 flex min-h-screen w-full">
          {sidebarOpen && <Sidebar />}
          <div className="flex-1 min-w-0 flex flex-col">
            <Topbar onMenuClick={toggle} sidebarOpen={sidebarOpen} />
            <Shortcuts />
            <main className="flex-1 p-4 3xl:p-6 4xl:p-6 max-w-7xl 3xl:max-w-[1680px] 4xl:max-w-[2400px] w-full mx-auto">{children}</main>
          </div>
        </div>
        <OnboardingTour />
      </div>
    </Protected>
  );
}
