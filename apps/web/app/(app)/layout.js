'use client';

import Protected from '../../components/Protected';
import Sidebar from '../../components/Sidebar';
import Topbar from '../../components/Topbar';

export default function AppLayout({ children }) {
  return (
    <Protected>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col">
          <Topbar />
          <main className="flex-1 p-6 max-w-7xl w-full mx-auto">{children}</main>
        </div>
      </div>
    </Protected>
  );
}
