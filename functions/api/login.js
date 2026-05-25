import { getCreds, safeEqual, createSessionToken, sessionCookie, sanitizeRedirect } from '../_lib/auth.js';
import { loginPageHtml } from '../_lib/login-page.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const secure = url.protocol === 'https:';

  let form;
  try {
    form = await request.formData();
  } catch {
    return new Response(loginPageHtml('/', true), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const username = String(form.get('username') || '');
  const password = String(form.get('password') || '');
  const redirect = sanitizeRedirect(String(form.get('redirect') || '/'));
  const creds = getCreds(env);

  // Compare both fields regardless of the first result to avoid early-exit timing leaks.
  const okUser = safeEqual(username, creds.username);
  const okPass = safeEqual(password, creds.password);
  if (!okUser || !okPass) {
    return new Response(loginPageHtml(redirect, true), {
      status: 401,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const token = await createSessionToken(env, creds.username);
  return new Response(null, {
    status: 303,
    headers: { Location: redirect, 'Set-Cookie': sessionCookie(token, secure), 'Cache-Control': 'no-store' },
  });
}
