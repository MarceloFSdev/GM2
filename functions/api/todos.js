/**
 * Cloudflare Pages Function backing the To-Do list.
 *
 *   GET /api/todos  -> { todos: [...], updatedAt }
 *   PUT /api/todos  -> persists { todos: [...] } and echoes the stored document
 *
 * Storage is a single JSON document in Workers KV under the key `todos`,
 * mirroring how the app already treats its data as one blob (config.json).
 * Bind a KV namespace to this Pages project as `TODOS_KV` (dashboard or
 * wrangler.toml). Unhandled methods get an automatic 405 from the runtime.
 */

const KV_KEY = 'todos';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * When Cloudflare Access guards the site it injects an authenticated-user header
 * on every request — treat its presence as authorization. If a TODO_TOKEN env var
 * is configured, also accept a matching X-Todo-Token (useful for local/dev tools).
 * If neither Access nor a token is configured, allow writes and rely on the site
 * being private (e.g. an obscure URL) — see the plan's auth note.
 */
function isAuthorized(request, env) {
  if (request.headers.get('Cf-Access-Authenticated-User-Email')) return true;
  const expected = env.TODO_TOKEN;
  if (!expected) return true;
  return request.headers.get('X-Todo-Token') === expected;
}

function genId(prefix, idx) {
  return `${prefix}-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Accept only an ISO calendar date (YYYY-MM-DD); anything else becomes null. */
function sanitizeDeadline(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/**
 * Coerce one task into a clean item, or null to drop it.
 * Top-level tasks (allowSub) may carry one level of `subtasks`.
 */
function sanitizeTask(raw, idx, allowSub) {
  if (!raw || typeof raw !== 'object') return null;
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (!text) return null;
  const done = raw.done === true;
  const item = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : genId(allowSub ? 'todo' : 'sub', idx),
    text: text.slice(0, 2000),
    done,
    urgent: raw.urgent === true,
    deadline: sanitizeDeadline(raw.deadline),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    doneAt: done ? (typeof raw.doneAt === 'string' ? raw.doneAt : new Date().toISOString()) : null,
  };
  if (allowSub) {
    item.subtasks = Array.isArray(raw.subtasks)
      ? raw.subtasks.map((s, i) => sanitizeTask(s, i, false)).filter(Boolean)
      : [];
  }
  return item;
}

/** Coerce arbitrary input into a clean array of to-do items, or null if not an array. */
function sanitizeTodos(input) {
  if (!Array.isArray(input)) return null;
  return input.map((raw, i) => sanitizeTask(raw, i, true)).filter(Boolean);
}

export async function onRequestGet({ env }) {
  if (!env.TODOS_KV) return json({ error: 'KV binding TODOS_KV is not configured' }, 500);
  const stored = await env.TODOS_KV.get(KV_KEY, 'json');
  if (stored && Array.isArray(stored.todos)) return json(stored);
  return json({ todos: [], updatedAt: null });
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

  const todos = sanitizeTodos(body && body.todos);
  if (todos === null) return json({ error: 'expected { todos: [...] }' }, 400);

  const doc = { todos, updatedAt: new Date().toISOString() };
  await env.TODOS_KV.put(KV_KEY, JSON.stringify(doc));
  return json(doc);
}
