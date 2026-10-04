'use client';

import { useEffect, useState } from 'react';
import Protected from '../../components/Protected';
import Sidebar from '../../components/Sidebar';
import Topbar from '../../components/Topbar';
import Shortcuts from '../../components/Shortcuts';
import OnboardingTour from '../../components/OnboardingTour';

const KEY = 'cw_sidebar_open';
const ZOOM_KEY = 'cw_zoom';

export default function AppLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [zoom, setZoom] = useState(100);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(KEY);
      if (v === '0') setSidebarOpen(false);
      const z = parseInt(window.localStorage.getItem(ZOOM_KEY) || '100', 10);
      if (z >= 70 && z <= 130) setZoom(z);
    } catch (_e) { /* ignore */ }
  }, []);

  useEffect(() => {
    try {
      document.body.style.zoom = String(zoom / 100);
      window.localStorage.setItem(ZOOM_KEY, String(zoom));
    } catch (_e) { /* ignore */ }
  }, [zoom]);

  const changeZoom = (delta) => {
    setZoom((z) => Math.min(130, Math.max(70, z + delta)));
  };

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
            <Topbar
              onMenuClick={toggle}
              sidebarOpen={sidebarOpen}
              zoom={zoom}
              onZoomIn={() => changeZoom(10)}
              onZoomOut={() => changeZoom(-10)}
              onZoomReset={() => setZoom(100)}
            />
            <Shortcuts />
            <main className="flex-1 p-6 3xl:p-8 4xl:p-10 max-w-7xl 3xl:max-w-[1680px] 4xl:max-w-[2400px] w-full mx-auto">{children}</main>
          </div>
        </div>
        <OnboardingTour />
      </div>
    </Protected>
  );
}
