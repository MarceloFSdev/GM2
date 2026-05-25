import { clearCookie } from '../_lib/auth.js';

// GET (or POST) /api/logout clears the session cookie and returns to the login page.
export function onRequest({ request }) {
  const url = new URL(request.url);
  const secure = url.protocol === 'https:';
  return new Response(null, {
    status: 303,
    headers: { Location: '/', 'Set-Cookie': clearCookie(secure), 'Cache-Control': 'no-store' },
  });
}
