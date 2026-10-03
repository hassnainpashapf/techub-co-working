'use client';

import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Spinner } from './ui';

export default function Protected({ children }) {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user && typeof window !== 'undefined') {
      window.location = '/login';
    }
  }, [loading, user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a14]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) return null;
  return children;
}

export function useRequireRoles(...roles) {
  const { user, loading } = useAuth();
  if (loading) return { allowed: null, user: null };
  if (!user) {
    if (typeof window !== 'undefined') window.location = '/login';
    return { allowed: null, user: null };
  }
  // super_admin bypasses all role checks — full access to everything
  const allowed = user.role === 'super_admin' || roles.length === 0 || roles.includes(user.role);
  return { allowed, user };
}

export function AccessDenied() {
  return (
    <div className="card max-w-md mx-auto text-center">
      <div className="text-4xl mb-3">🔒</div>
      <h2 className="text-lg font-semibold text-white mb-1">Access denied</h2>
      <p className="text-sm text-slate-500">
        Your role does not have permission to view this section.
      </p>
    </div>
  );
}
