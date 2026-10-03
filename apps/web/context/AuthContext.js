'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { api, getTokens, setTokens, clearTokens } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      const { access } = getTokens();
      if (!access) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.get('/auth/me');
        if (!cancelled) setUser(me.user || me);
      } catch {
        clearTokens();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  async function login(email, password) {
    const data = await api.post('/auth/login', { email, password });
    const access = data.accessToken || data.access;
    const refresh = data.refreshToken || data.refresh;
    if (!access) throw new Error('Login failed: no token returned');
    setTokens({ access, refresh });
    const me = data.user;
    setUser(me || null);
    return me;
  }

  function logout() {
    // Phase 32: revoke the server-side refresh token (best-effort), then clear local state
    try {
      const { refresh } = getTokens();
      if (refresh) api.post('/auth/logout', { refreshToken: refresh }).catch(() => {});
    } catch {}
    clearTokens();
    setUser(null);
    window.location = '/login';
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
