/**
 * Cloudflare Pages Function for the Fiscal Year planner state.
 *
 *   GET /api/fiscal -> { fiscal: <wrap|null>, updatedAt }
 *   PUT /api/fiscal -> persists { fiscal: <wrap> } and echoes the stored document
 *
 * Reuses the same Workers KV namespace as the to-do list (binding TODOS_KV)
 * under a separate key, so only one KV binding is needed for the whole app.
 * The planner document is `{ mode, views: { current, planned } }`; deep
 * validation of each view happens on the client (sanitizeFiscalView).
 */

const KV_KEY = 'fiscal';
const MAX_BYTES = 256 * 1024;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function isAuthorized(request, env) {
  if (request.headers.get('Cf-Access-Authenticated-User-Email')) return true;
  const expected = env.TODO_TOKEN;
  if (!expected) return true;
  return request.headers.get('X-Todo-Token') === expected;
}

/** Accept only the expected planner shape; null rejects the write. */
function sanitizeFiscal(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (!input.views || typeof input.views !== 'object') return null;
  return { mode: input.mode === 'planned' ? 'planned' : 'current', views: input.views };
}

export async function onRequestGet({ env }) {
  if (!env.TODOS_KV) return json({ error: 'KV binding TODOS_KV is not configured' }, 500);
  const stored = await env.TODOS_KV.get(KV_KEY, 'json');
  if (stored && stored.fiscal) return json(stored);
  return json({ fiscal: null, updatedAt: null });
}

export async function onRequestPut({ request, env }) {
  if (!env.TODOS_KV) return json({ error: 'KV binding TODOS_KV is not configured' }, 500);
  if (!isAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const fiscal = sanitizeFiscal(body && body.fiscal);
  if (!fiscal) return json({ error: 'expected { fiscal: { mode, views } }' }, 400);

  const doc = { fiscal, updatedAt: new Date().toISOString() };
  const serialized = JSON.stringify(doc);
  if (serialized.length > MAX_BYTES) return json({ error: 'payload too large' }, 413);

  await env.TODOS_KV.put(KV_KEY, serialized);
  return json(doc);
}
