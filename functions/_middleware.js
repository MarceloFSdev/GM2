/**
 * Site-wide auth gate. A root _middleware.js runs on every request to the
 * Pages project — static assets and Functions alike. Unauthenticated requests
 * get the login page; authenticated requests fall through to the normal
 * asset/Function handler via next().
 */
import { isAuthenticated } from './_lib/auth.js';
import { loginPageHtml } from './_lib/login-page.js';

// Endpoints that must be reachable without a session (they handle auth themselves).
const PUBLIC_PATHS = new Set(['/api/login', '/api/logout']);

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (PUBLIC_PATHS.has(url.pathname)) return next();
  if (await isAuthenticated(request, env)) return next();

  // Not signed in: serve the self-contained login page, remembering where to return.
  return new Response(loginPageHtml(url.pathname + url.search, false), {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
