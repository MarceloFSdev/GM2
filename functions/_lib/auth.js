/**
 * Shared auth helpers for the site-wide login gate.
 *
 * Session model: a signed, stateless cookie. The cookie value is
 *   base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, secret))
 * so it cannot be forged without the secret, and carries its own expiry.
 *
 * Credentials and secret come from environment variables when set, with
 * sensible fallbacks so the site works out of the box. For real privacy,
 * set AUTH_USERNAME / AUTH_PASSWORD / AUTH_SECRET as encrypted env vars in
 * the Cloudflare Pages dashboard (Settings -> Environment variables).
 */

export const COOKIE_NAME = 'chronos_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function getCreds(env = {}) {
  const username = env.AUTH_USERNAME || 'mars';
  const password = env.AUTH_PASSWORD || 'pythia';
  const secret = env.AUTH_SECRET || `chronos-${password}-secret`;
  return { username, password, secret };
}

/** Length-aware, constant-time-ish string comparison. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bytesToBase64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBytes(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return bytesToBase64url(new Uint8Array(sig));
}

export async function createSessionToken(env, username) {
  const { secret } = getCreds(env);
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = bytesToBase64url(new TextEncoder().encode(JSON.stringify({ u: username, exp })));
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(env, token) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const { secret } = getCreds(env);
  const expected = await hmac(secret, payload);
  if (!safeEqual(sig, expected)) return false;
  try {
    const data = JSON.parse(new TextDecoder().decode(base64urlToBytes(payload)));
    if (!data || typeof data.exp !== 'number') return false;
    return data.exp >= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function parseCookies(header) {
  const out = {};
  String(header || '')
    .split(/;\s*/)
    .forEach((part) => {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1));
    });
  return out;
}

export async function isAuthenticated(request, env) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  return verifySessionToken(env, cookies[COOKIE_NAME]);
}

export function sessionCookie(token, secure) {
  const flags = `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
  return secure ? `${flags}; Secure` : flags;
}

export function clearCookie(secure) {
  const flags = `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
  return secure ? `${flags}; Secure` : flags;
}

/** Only allow same-site relative redirects (blocks open-redirects). */
export function sanitizeRedirect(r) {
  if (typeof r !== 'string' || !r.startsWith('/') || r.startsWith('//')) return '/';
  return r;
}
