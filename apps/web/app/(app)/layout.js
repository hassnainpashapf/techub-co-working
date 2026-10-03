'use client';

import Protected from '../../components/Protected';
import Sidebar from '../../components/Sidebar';
import Topbar from '../../components/Topbar';

export default function AppLayout({ children }) {
  return (
    <Protected>
      <div className="flex min-h-screen relative bg-[#08080f]">
        {/* Ambient glows for rich luminous feel */}
        <div className="pointer-events-none fixed inset-0 z-0">
          <div className="absolute -top-32 left-1/4 w-[500px] h-[300px] bg-blue-600/[0.07] blur-[120px] rounded-full" />
          <div className="absolute top-1/3 -right-32 w-[400px] h-[400px] bg-blue-700/[0.05] blur-[120px] rounded-full" />
          <div className="absolute -bottom-32 left-1/3 w-[450px] h-[300px] bg-fuchsia-600/[0.04] blur-[120px] rounded-full" />
        </div>
        <div className="relative z-10 flex min-h-screen w-full">
          <Sidebar />
          <div className="flex-1 min-w-0 flex flex-col">
            <Topbar />
            <main className="flex-1 p-6 max-w-7xl w-full mx-auto">{children}</main>
          </div>
        </div>
      </div>
    </Protected>
  );
}
