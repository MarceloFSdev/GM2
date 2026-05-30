/**
 * Cloudflare Pages Function backing the Birthdays tab.
 *
 *   GET /api/birthdays -> { birthdays: [...], updatedAt }
 *   PUT /api/birthdays -> persists { birthdays: [...] }
 *
 * Uses the existing TODOS_KV binding under key `birthdays`.
 */

const KV_KEY = 'birthdays';
const MAX_ITEMS = 500;

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

function genId(idx) {
  return `birthday-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`;
}

function sanitizeMonthDay(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function sanitizeBirthday(raw, idx) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const monthDay = sanitizeMonthDay(raw.monthDay || raw.date);
  if (!name || !monthDay) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : genId(idx),
    name: name.slice(0, 120),
    monthDay,
    note: typeof raw.note === 'string' ? raw.note.trim().slice(0, 500) : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
  };
}

function sanitizeBirthdays(input) {
  if (!Array.isArray(input)) return null;
  return input.slice(0, MAX_ITEMS).map(sanitizeBirthday).filter(Boolean);
}

export async function onRequestGet({ env }) {
  if (!env.TODOS_KV) return json({ error: 'KV binding TODOS_KV is not configured' }, 500);
  const stored = await env.TODOS_KV.get(KV_KEY, 'json');
  if (stored && Array.isArray(stored.birthdays)) return json(stored);
  return json({ birthdays: [], updatedAt: null });
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

  const birthdays = sanitizeBirthdays(body && body.birthdays);
  if (birthdays === null) return json({ error: 'expected { birthdays: [...] }' }, 400);

  const doc = { birthdays, updatedAt: new Date().toISOString() };
  await env.TODOS_KV.put(KV_KEY, JSON.stringify(doc));
  return json(doc);
}
