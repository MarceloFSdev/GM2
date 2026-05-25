/** Self-contained login page (inline styles, no external assets needed). */

function escapeAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function loginPageHtml(redirect = '/', error = false) {
  const r = escapeAttr(redirect);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>CHRONOS GMT — Sign in</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1.5rem;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background: radial-gradient(1200px 800px at 50% -10%, #0a0e16 0%, #010102 60%); color: #eceef1; }
  .login { width: 100%; max-width: 360px; }
  .login__card { display: flex; flex-direction: column; gap: 0.85rem; padding: 2rem 1.75rem; border-radius: 22px;
    background: linear-gradient(155deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02) 40%, transparent);
    border: 1px solid rgba(255,255,255,0.09); box-shadow: 0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05); }
  .login__logo { margin: 0; font-size: 1.4rem; letter-spacing: 0.08em; font-weight: 700; }
  .login__sub { margin: 0 0 0.5rem; font-size: 0.72rem; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(175,180,190,0.6); }
  .login__label { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.76rem; letter-spacing: 0.03em; color: rgba(228,230,235,0.68); }
  .login__input { padding: 0.7rem 0.85rem; font-size: 1rem; color: #eceef1; background: rgba(12,16,26,0.55);
    border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; }
  .login__input:focus { outline: none; border-color: #7eb8d4; box-shadow: 0 0 0 2px rgba(126,184,212,0.25); }
  .login__btn { margin-top: 0.5rem; padding: 0.75rem; font-size: 1rem; font-weight: 600; color: #010102;
    background: #7eb8d4; border: none; border-radius: 12px; cursor: pointer; }
  .login__btn:hover { filter: brightness(1.1); }
  .login__error { margin: 0; padding: 0.6rem 0.75rem; font-size: 0.85rem; color: #f0b6c1;
    background: rgba(224,135,154,0.12); border: 1px solid rgba(224,135,154,0.3); border-radius: 10px; }
</style>
</head>
<body>
  <main class="login">
    <form class="login__card" method="POST" action="/api/login">
      <h1 class="login__logo">CHRONOS GMT</h1>
      <p class="login__sub">Private access</p>
      ${error ? '<p class="login__error">Incorrect username or password.</p>' : ''}
      <label class="login__label">Username
        <input class="login__input" type="text" name="username" autocomplete="username" autofocus required />
      </label>
      <label class="login__label">Password
        <input class="login__input" type="password" name="password" autocomplete="current-password" required />
      </label>
      <input type="hidden" name="redirect" value="${r}" />
      <button class="login__btn" type="submit">Sign in</button>
    </form>
  </main>
</body>
</html>`;
}
