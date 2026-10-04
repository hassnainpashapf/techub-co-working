'use client';

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

const ACCESS_KEY = 'cw_access';
const REFRESH_KEY = 'cw_refresh';

export function getTokens() {
  if (typeof window === 'undefined') return { access: null, refresh: null };
  return {
    access: window.localStorage.getItem(ACCESS_KEY),
    refresh: window.localStorage.getItem(REFRESH_KEY),
  };
}

export function setTokens({ access, refresh }) {
  if (typeof window === 'undefined') return;
  if (access) window.localStorage.setItem(ACCESS_KEY, access);
  if (refresh) window.localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
}

async function doRefresh() {
  const { refresh } = getTokens();
  if (!refresh) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    const access = data.accessToken || data.access;
    const newRefresh = data.refreshToken || data.refresh || refresh;
    if (!access) return false;
    setTokens({ access, refresh: newRefresh });
    return true;
  } catch {
    return false;
  }
}

export async function apiFetch(path, { method = 'GET', body } = {}, _retried = false) {
  const { access } = getTokens();
  const headers = { 'Content-Type': 'application/json' };
  if (access) headers.Authorization = `Bearer ${access}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error('Cannot reach the API server. Is it running?');
  }

  if (res.status === 401 && !_retried) {
    const ok = await doRefresh();
    if (ok) return apiFetch(path, { method, body }, true);
    clearTokens();
    if (typeof window !== 'undefined') window.location = '/login';
    throw new Error('Session expired. Please log in again.');
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const raw = data && (data.message || data.error);
    const message =
      (typeof raw === 'string' ? raw : raw && raw.message) ||
      `Request failed with status ${res.status}`;
    throw new Error(message);
  }
  return data;
}

export async function apiUpload(path, formData, _retried = false) {
  const { access } = getTokens();
  const headers = {};
  if (access) headers.Authorization = `Bearer ${access}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: formData });
  } catch (e) {
    throw new Error('Cannot reach the API server. Is it running?');
  }

  if (res.status === 401 && !_retried) {
    const ok = await doRefresh();
    if (ok) return apiUpload(path, formData, true);
    clearTokens();
    if (typeof window !== 'undefined') window.location = '/login';
    throw new Error('Session expired. Please log in again.');
  }

  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const raw = data && (data.message || data.error);
    const message = (typeof raw === 'string' ? raw : raw && raw.message) || `Upload failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export function apiDownloadUrl(path) {
  const { access } = getTokens();
  // Token in query for direct <a> downloads (download endpoint accepts it via auth middleware? no—use fetch blob instead)
  return `${API_BASE}${path}`;
}

export async function apiDownload(path, filename) {
  const { access } = getTokens();
  const headers = {};
  if (access) headers.Authorization = `Bearer ${access}`;
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'file';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export const api = {
  get: (path, opts = {}) => apiFetchCached(path, opts),
  post: (path, body) => { invalidateCache(); return apiFetch(path, { method: 'POST', body }); },
  put: (path, body) => { invalidateCache(); return apiFetch(path, { method: 'PUT', body }); },
  patch: (path, body) => { invalidateCache(); return apiFetch(path, { method: 'PATCH', body }); },
  del: (path) => { invalidateCache(); return apiFetch(path, { method: 'DELETE' }); },
};

// ---- Lightweight GET cache (stale-while-revalidate) ----
// Makes page revisits instant and cuts server load. Mutations clear it.
const CACHE_TTL = 45 * 1000; // 45 seconds
const getCache = new Map(); // key -> { data, ts }
const inflight = new Map(); // key -> promise (dedupes parallel identical requests)

function cacheKey(path) {
  const { access } = getTokens();
  return `${access ? access.slice(-12) : 'anon'}::${path}`;
}

function invalidateCache() {
  getCache.clear();
}

function isCacheable(path) {
  // Don't cache auth, realtime feeds, or download endpoints
  return !/^\/(auth|activity\/feed|notifications\/stream)/.test(path);
}

async function apiFetchCached(path, opts = {}) {
  const { revalidate = false } = opts;
  if (!isCacheable(path)) return apiFetch(path);
  const key = cacheKey(path);
  const now = Date.now();

  const hit = getCache.get(key);
  if (hit && now - hit.ts < CACHE_TTL && !revalidate) {
    // Serve stale instantly, refresh quietly in background
    if (now - hit.ts > CACHE_TTL / 2 && !inflight.has(key)) {
      const p = apiFetch(path)
        .then((data) => { getCache.set(key, { data, ts: Date.now() }); })
        .catch(() => {})
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return hit.data;
  }
  if (inflight.has(key)) return inflight.get(key);
  const p = apiFetch(path)
    .then((data) => { getCache.set(key, { data, ts: Date.now() }); return data; })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
