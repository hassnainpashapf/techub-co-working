'use client';

import Protected from '../../components/Protected';
import Sidebar from '../../components/Sidebar';
import Topbar from '../../components/Topbar';
import Shortcuts from '../../components/Shortcuts';
import OnboardingTour from '../../components/OnboardingTour';

export default function AppLayout({ children }) {
  return (
    <Protected>
      <div className="flex min-h-screen relative bg-[#f4f5f7]">
        <div className="relative z-10 flex min-h-screen w-full">
          <Sidebar />
          <div className="flex-1 min-w-0 flex flex-col">
            <Topbar />
            <Shortcuts />
            <main className="flex-1 p-6 3xl:p-8 4xl:p-10 max-w-7xl 3xl:max-w-[1680px] 4xl:max-w-[2400px] w-full mx-auto">{children}</main>
          </div>
        </div>
        <OnboardingTour />
      </div>
    </Protected>
  );
}
