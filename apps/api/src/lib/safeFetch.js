// Phase 32 Track 3: SSRF-safe HTTP client for outbound webhooks.
// Validates every URL (including redirect targets): DNS-resolves the host and
// blocks private/loopback/link-local/multicast/reserved ranges, allows only
// http/https, 10s timeout, 2MB max response body, max 3 redirects.
const dns = require('dns').promises;
const net = require('net');

const TIMEOUT_MS = 10000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

// IPv4 CIDRs that must never be contacted (SSRF protection).
const BLOCKED_V4 = [
  [0x00000000, 8],          // 0.0.0.0/8 (this network)
  [0x0a000000, 8],          // 10.0.0.0/8
  [0x64400000, 10],         // 100.64.0.0/10 (CGNAT)
  [0x7f000000, 8],          // 127.0.0.0/8 (loopback)
  [0xa9fe0000, 16],         // 169.254.0.0/16 (link-local, cloud metadata)
  [0xac100000, 12],         // 172.16.0.0/12
  [0xc0000200, 24],         // 192.0.2.0/24 (TEST-NET-1)
  [0xc0a80000, 16],         // 192.168.0.0/16
  [0xc6126400, 24],         // 198.18.0.0/15 would be 2 entries; use exact below
  [0xc6336400, 24],         // 198.51.100.0/24 (TEST-NET-2)
  [0xcb007100, 24],         // 203.0.113.0/24 (TEST-NET-3)
  [0xe0000000, 4],          // 224.0.0.0/4 (multicast)
  [0xf0000000, 4],          // 240.0.0.0/4 (reserved)
];
BLOCKED_V4.push([0xc6120000, 15]); // 198.18.0.0/15 (benchmarking)

function ipToInt(ip) {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

function isBlockedV4(ip) {
  const n = ipToInt(ip);
  return BLOCKED_V4.some(([base, bits]) => (n >>> (32 - bits)) === (base >>> (32 - bits)));
}

function isBlockedV6(ip) {
  const low = ip.toLowerCase();
  if (low === '::1' || low === '::') return true;
  if (low.startsWith('fe80:')) return true;                       // link-local
  if (low.startsWith('fc') || low.startsWith('fd')) return true;  // unique-local
  if (low.startsWith('ff')) return true;                          // multicast
  if (low.startsWith('::ffff:')) {                                 // IPv4-mapped
    const v4 = low.slice('::ffff:'.length);
    if (net.isIPv4(v4)) return isBlockedV4(v4);
    return true;
  }
  if (low.startsWith('2001:db8')) return true;                     // documentation
  return false;
}

function isBlockedIp(ip) {
  if (net.isIPv4(ip)) return isBlockedV4(ip);
  if (net.isIPv6(ip)) return isBlockedV6(ip);
  return true; // unknown format — fail closed
}

// Throws on any problem; returns null when the host is safe to contact.
async function assertUrlSafe(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Blocked protocol: ${u.protocol}`);
  }
  if (u.username || u.password) {
    throw new Error('URLs with embedded credentials are blocked');
  }
  let host = u.hostname;
  // WHATWG URL keeps brackets on IPv6 literals: [::1] -> ::1
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  // Literal IP in the URL — check directly.
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error(`Blocked destination IP: ${host}`);
    return u;
  }
  // Resolve and check EVERY returned address (fail closed on any blocked one).
  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new Error(`DNS resolution failed for ${host}`);
  }
  if (!addrs.length) throw new Error(`No DNS records for ${host}`);
  for (const a of addrs) {
    if (isBlockedIp(a.address)) {
      throw new Error(`Blocked destination (resolves to private IP): ${host}`);
    }
  }
  return u;
}

async function readLimited(res) {
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error('Response body exceeds 2MB limit');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// SSRF-safe POST with manual redirect handling (each hop re-validated).
// Returns { ok, status, body, error } — never throws on HTTP-level failures.
async function safePost(rawUrl, { headers = {}, body = '', timeoutMs = TIMEOUT_MS } = {}) {
  let url = rawUrl;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertUrlSafe(url);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers,
          body,
          signal: ctrl.signal,
          redirect: 'manual', // we validate redirects ourselves
        });
      } catch (e) {
        clearTimeout(timer);
        return { ok: false, status: null, body: '', error: e.name === 'AbortError' ? 'Request timed out (10s)' : (e.message || 'Request failed') };
      }
      clearTimeout(timer);
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        if (hop === MAX_REDIRECTS) return { ok: false, status: null, body: '', error: 'Too many redirects' };
        const loc = res.headers.get('location');
        if (!loc) return { ok: false, status: null, body: '', error: 'Redirect without Location header' };
        try {
          url = new URL(loc, url).toString(); // resolves relative redirects
        } catch {
          return { ok: false, status: null, body: '', error: 'Invalid redirect target' };
        }
        continue;
      }
      let text = '';
      try {
        text = await readLimited(res);
      } catch (e) {
        return { ok: false, status: res.status, body: '', error: e.message };
      }
      return { ok: res.ok, status: res.status, body: text, error: res.ok ? null : `HTTP ${res.status}` };
    }
    return { ok: false, status: null, body: '', error: 'Too many redirects' };
  } catch (e) {
    return { ok: false, status: null, body: '', error: e.message || 'URL validation failed' };
  }
}

module.exports = { safePost, assertUrlSafe, TIMEOUT_MS, MAX_BODY_BYTES };
