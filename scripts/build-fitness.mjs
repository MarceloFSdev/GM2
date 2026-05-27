#!/usr/bin/env node
/**
 * build-fitness.mjs — turn the Mars OS Obsidian fitness vault into fitness.json.
 *
 * GM2 is a static app: the Fitness view reads a committed `fitness.json`, the
 * same way the rest of the app reads `config.json`. The source of truth lives in
 * a separate (private) repo — the Mars OS vault — where an agent logs daily
 * training. This script parses that markdown and emits the structured,
 * chart-ready dataset the dashboard renders.
 *
 * Re-run whenever the vault changes:
 *   npm run build:fitness
 *   MARS_OS_FITNESS="/path/to/vault/10-Personal/Fitness" npm run build:fitness
 *
 * It is intentionally tolerant: diary entries are free-form (two formats coexist
 * — a "## Exercise Log" bullet list and "### Exercise" headed blocks), so when a
 * line can't be fully parsed the raw text is preserved and stats degrade
 * gracefully rather than throwing.
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

/** Where the Fitness markdown lives. Override with MARS_OS_FITNESS or argv[2]. */
const FITNESS_DIR =
  process.argv[2] ||
  process.env.MARS_OS_FITNESS ||
  path.resolve(REPO_ROOT, '..', 'Mars OS', 'vault', '10-Personal', 'Fitness');

const OUT_FILE = path.resolve(REPO_ROOT, 'fitness.json');

/* ── muscle classification ──────────────────────────────────────────────── */
// The 7 muscle groups that carry weekly volume targets, in radar order.
const TARGET_MUSCLES = ['Chest', 'Back', 'Delts', 'Quads', 'Hamstrings', 'Biceps', 'Triceps'];

/** Keyword classifier so new exercise names still land in a sensible bucket. */
function classifyMuscle(name) {
  const n = name.toLowerCase();
  if (/calf|calves/.test(n)) return 'Calves';
  if (/crunch|leg raise|plank|\bab(s)?\b|hanging/.test(n)) return 'Core';
  if (/rear delt|reverse pec|face pull/.test(n)) return 'Delts';
  if (/lateral raise|shoulder press|overhead press|military|delt/.test(n)) return 'Delts';
  if (/leg curl|romanian|rdl|hamstring|good ?morning|deadlift/.test(n)) return 'Hamstrings';
  if (/leg extension|squat|leg press|hack|lunge|split squat|quad/.test(n)) return 'Quads';
  if (/tricep|pushdown|push-down|skull|dip/.test(n)) return 'Triceps';
  if (/curl|bicep/.test(n)) return 'Biceps';
  if (/\brow\b|pulldown|pull-?up|pull up|\bchin/.test(n)) return 'Back';
  if (/press|fly|flye|pec|chest|push-?up/.test(n)) return 'Chest';
  return 'Other';
}

/* ── tiny markdown helpers ──────────────────────────────────────────────── */
function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  const fm = {};
  if (!m) return { fm, body: text };
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (/^(true|false)$/i.test(val)) val = val.toLowerCase() === 'true';
    fm[key] = val;
  }
  return { fm, body: text.slice(m[0].length) };
}

/** Pull the body under a `## Heading` (until the next `##`/`#`). */
function sectionBody(body, heading) {
  const re = new RegExp(`^#{2,3}\\s*${heading}\\s*$`, 'im');
  const m = body.match(re);
  if (!m) return '';
  const start = m.index + m[0].length;
  const rest = body.slice(start);
  const next = rest.search(/^#{1,3}\s/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

function bulletLines(block) {
  return block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, ''));
}

/* ── set parsing ────────────────────────────────────────────────────────── */
/**
 * Extract structured sets from a free-form performance string.
 * Handles: "3 x 10 reps at 100 kg", "20 kg x 10", "50 kg x 10; 70 kg x 10",
 * "15 clean reps", "20 kg each side x 10", "15 kg x 12 x 3 sets", explicit
 * "4 sets total". Returns { sets:[{weight,reps,bodyweight,perSide}], setCount,
 * topWeight, totalReps, pr }.
 */
function parseSets(rawDetail) {
  const detail = rawDetail.replace(/\s+/g, ' ').trim();
  const perSide = /(each side|per side|\/side|each leg|per leg)/i.test(detail);
  const pr = /(personal record|\bpr\b|\bp\.r\.)/i.test(detail);
  // Strip the "each side" qualifier so the numeric patterns line up.
  const d = detail.replace(/\b(each|per)\s+(side|leg|arm)s?\b/gi, ' ');

  const sets = [];

  // 1) "N x R reps at W kg"  → N sets of R reps @ W
  const nxrAt = [...d.matchAll(/(\d+)\s*(?:sets?\s*)?[x×]\s*(\d+)\s*reps?\s*(?:at|@|×|x)?\s*(\d+(?:\.\d+)?)\s*kg/gi)];
  for (const m of nxrAt) {
    const n = parseInt(m[1], 10);
    const reps = parseInt(m[2], 10);
    const w = parseFloat(m[3]);
    for (let i = 0; i < n; i += 1) sets.push({ weight: w, reps, perSide });
  }

  // 2) "W kg x R" (optionally "x S sets")  → repeated S times, else once
  if (!sets.length) {
    const wxr = [...d.matchAll(/(\d+(?:\.\d+)?)\s*kg\s*[x×]\s*(\d+)(?:\s*reps?)?(?:\s*[x×]\s*(\d+)\s*sets?)?/gi)];
    for (const m of wxr) {
      const w = parseFloat(m[1]);
      const reps = parseInt(m[2], 10);
      const n = m[3] ? parseInt(m[3], 10) : 1;
      for (let i = 0; i < n; i += 1) sets.push({ weight: w, reps, perSide });
    }
  }

  // 3) Loose "rep" sets with no explicit "W kg x R": e.g. "15 clean reps",
  //    "Set 1: 11 reps", or "10 kg … 10 reps each except final set 5 reps".
  //    If a bare weight is stated anywhere, attach it; otherwise bodyweight.
  if (!sets.length) {
    const bareWeight = parseFloat((d.match(/(\d+(?:\.\d+)?)\s*kg/i) || [])[1]) || null;
    const bw = [...d.matchAll(/(\d+)\s*(?:clean\s*)?reps?\b/gi)];
    for (const m of bw) {
      const reps = parseInt(m[1], 10);
      if (bareWeight != null) sets.push({ weight: bareWeight, reps, perSide });
      else sets.push({ reps, bodyweight: true, perSide });
    }
  }

  // Explicit set count override, e.g. "4 sets total", "3 sets".
  const explicit = d.match(/(\d+)\s*(?:total\s*)?sets?\b/i);
  const explicitCount = explicit ? parseInt(explicit[1], 10) : 0;
  const setCount = Math.max(sets.length, explicitCount);

  const weights = sets.filter((s) => typeof s.weight === 'number').map((s) => s.weight);
  const topWeight = weights.length ? Math.max(...weights) : null;
  const totalReps = sets.reduce((a, s) => a + (s.reps || 0), 0);

  return { sets, setCount, topWeight, totalReps, pr, perSide };
}

/** Strip trailing prose ("Effort: …", "Notes: …") from a performance string. */
function splitPerf(detail) {
  const cut = detail.search(/\b(Effort|Notes?|Note|Preference|Order note)\s*:/i);
  if (cut === -1) return { perf: detail.trim(), note: '' };
  return { perf: detail.slice(0, cut).trim(), note: detail.slice(cut).trim() };
}

/* ── parse a single diary file ──────────────────────────────────────────── */
function parseDiary(text, fileName) {
  const { fm, body } = parseFrontmatter(text);
  const dateMatch = fileName.match(/(\d{4}-\d{2}-\d{2})/);
  const date = fm.date || (dateMatch ? dateMatch[1] : null);

  // Session label: frontmatter, then "Workout done:" / "Session:", then the
  // first real "Day N — Upper/Lower X" (the Upper/Lower guard avoids matching
  // prose like "Day 1–Day 5, not fixed weekdays").
  let session = fm.session || '';
  if (!session) {
    const done = body.match(/(?:Workout done|Session)\s*:?\s*(Day\s*[1-5][^\n.]*)/i);
    if (done) session = done[1].replace(/\s+/g, ' ').trim();
  }
  if (!session) {
    const sm = body.match(/Day\s*[1-5]\s*[—–-]\s*(?:Upper|Lower)\s*[A-C]/i);
    if (sm) session = sm[0].replace(/\s+/g, ' ').trim();
  }
  const dayMatch = session.match(/Day\s*(\d)/i);
  const day = dayMatch ? parseInt(dayMatch[1], 10) : null;

  const status = (fm.status || '').toString().toLowerCase().includes('complet')
    ? 'completed'
    : /completed:\s*yes/i.test(body)
    ? 'completed'
    : 'logged';

  const location = fm.location || (body.match(/(?:Gym\/location|Location):\s*(.+)/i)?.[1] || '').trim();

  // Exercises — two formats.
  const exercises = [];

  // Format A: "## Exercise Log" / "## Workout Log" bullet list "- Name: detail"
  for (const headName of ['Exercise Log', 'Workout Log']) {
    const block = sectionBody(body, headName);
    if (!block) continue;
    // Only treat as Format A if it has "Name: ..." bullets (not "### " blocks).
    for (const line of bulletLines(block)) {
      const ci = line.indexOf(':');
      if (ci === -1) continue;
      const name = line.slice(0, ci).trim();
      if (!name || name.length > 48) continue;
      const detail = line.slice(ci + 1).trim();
      const { perf, note } = splitPerf(detail);
      const parsed = parseSets(perf);
      exercises.push({ name, ...parsed, note: note || '', raw: detail });
    }
  }

  // Format B: "### Exercise Name" blocks with following "- set" bullets.
  const headingBlocks = [...body.matchAll(/^###\s+(.+?)\s*$/gm)];
  for (let i = 0; i < headingBlocks.length; i += 1) {
    const name = headingBlocks[i][1].trim();
    if (/highlight|trainer note|sensation|voice note|^pr/i.test(name)) continue;
    const start = headingBlocks[i].index + headingBlocks[i][0].length;
    let end = i + 1 < headingBlocks.length ? headingBlocks[i + 1].index : body.length;
    // Also stop at the next ## section (e.g. "## PRs / Highlights") so trailer
    // sections don't bleed into the final exercise block.
    const h2 = body.slice(start).search(/^##\s/m);
    if (h2 !== -1 && start + h2 < end) end = start + h2;
    const sub = body.slice(start, end);
    const lines = bulletLines(sub);
    if (!lines.length) continue;
    // Skip if this exercise already came from Format A.
    if (exercises.some((e) => e.name.toLowerCase() === name.toLowerCase())) continue;
    // Separate prose/note bullets from set bullets so notes (e.g. an "Order
    // note: …progress to 20 clean reps") never get parsed as performed sets.
    const isNote = (l) => /^(notes?|order note|priority note|tip|cue)\b/i.test(l);
    const setLines = lines.filter((l) => !isNote(l));
    const noteLines = lines.filter(isNote);
    const detail = setLines.join('; ');
    const parsed = parseSets(detail);
    exercises.push({
      name,
      ...parsed,
      note: noteLines.join(' '),
      raw: setLines.join('; '),
    });
  }

  // Attach muscle + drop entries that parsed to nothing useful.
  for (const ex of exercises) ex.muscle = classifyMuscle(ex.name);
  const useful = exercises.filter((e) => e.setCount > 0 || e.topWeight != null || e.note);

  const setCount = useful.reduce((a, e) => a + (e.setCount || 0), 0);
  const repCount = useful.reduce((a, e) => a + (e.totalReps || 0), 0);
  // Volume load (est. kg): weighted sets only, doubled for per-side loading.
  let volumeLoad = 0;
  for (const e of useful) {
    for (const s of e.sets) {
      if (typeof s.weight === 'number' && s.reps) {
        volumeLoad += s.weight * s.reps * (s.perSide ? 2 : 1);
      }
    }
  }

  // PRs / highlights section.
  const prBlock = sectionBody(body, 'PRs / Highlights') || sectionBody(body, 'PRs');
  const highlights = prBlock ? bulletLines(prBlock) : [];

  return {
    date,
    session,
    day,
    status,
    location,
    exercises: useful,
    setCount,
    repCount,
    volumeLoad: Math.round(volumeLoad),
    highlights,
    weight: diaryBodyWeight(fm, body),
  };
}

/* ── parse routine (split + weekly volume targets) ──────────────────────── */
function parseRoutine(text) {
  const { body } = parseFrontmatter(text);
  const version = (body.match(/Version\/location:\s*(.+)/i)?.[1] || '').trim();

  const days = [];
  const dayHeads = [...body.matchAll(/^##\s+Day\s*(\d)\s*[—–-]\s*(.+?)\s*$/gim)];
  for (let i = 0; i < dayHeads.length; i += 1) {
    const day = parseInt(dayHeads[i][1], 10);
    const name = dayHeads[i][2].trim();
    const start = dayHeads[i].index + dayHeads[i][0].length;
    const end = i + 1 < dayHeads.length ? dayHeads[i + 1].index : body.length;
    const sub = body.slice(start, end);
    const focusMatch = sub.match(/\*\*Focus:\*\*\s*(.+)/i);
    const focus = focusMatch ? focusMatch[1].trim() : '';
    const exercises = bulletLines(sub)
      .filter((l) => /[—–-]\s*\d|\bx\b|\d\s*[x×]/i.test(l) && !/note:/i.test(l.slice(0, 6)))
      .map((l) => {
        const m = l.match(/^(.+?)\s*[—–-]\s*(\d.*?)$/);
        if (m) return { name: m[1].trim(), scheme: m[2].trim() };
        return { name: l.trim(), scheme: '' };
      })
      .filter((e) => e.name && e.name.length < 60);
    days.push({ day, name, focus, exercises });
  }

  // Weekly Volume targets: "- Chest: ~11–13 hard sets"
  const volBlock = sectionBody(body, 'Weekly Volume');
  const volumeTargets = {};
  for (const line of bulletLines(volBlock)) {
    const m = line.match(/^(.+?):\s*~?\s*(\d+)(?:\s*[–-]\s*(\d+))?/);
    if (!m) continue;
    const muscle = m[1].trim();
    const min = parseInt(m[2], 10);
    const max = m[3] ? parseInt(m[3], 10) : min;
    volumeTargets[muscle] = { min, max };
  }

  return { version, days, volumeTargets };
}

/* ── parse goals ────────────────────────────────────────────────────────── */
function parseGoals(text) {
  const { body } = parseFrontmatter(text);
  const goals = bulletLines(sectionBody(body, 'Current Goals'));
  let pullUpGoal = null;
  const pg = body.match(/(\d+)\s*clean\s*consecutive\s*pull-?ups/i);
  if (pg) pullUpGoal = parseInt(pg[1], 10);
  return { goals, pullUpGoal };
}

/* ── parse state (current week) ─────────────────────────────────────────── */
function parseState(text) {
  const { body } = parseFrontmatter(text);
  const weekBlock = sectionBody(body, 'Current Week');
  const weekStart = (weekBlock.match(/Week starts:\s*(\d{4}-\d{2}-\d{2})/i)?.[1] || '').trim();
  const completedRaw = weekBlock.match(/Completed sessions?:\s*(.+)/i)?.[1] || '';
  const next = (weekBlock.match(/Next session:\s*(.+)/i)?.[1] || '').trim();
  const location = (body.match(/Location:\s*(.+)/i)?.[1] || '').trim();
  // sessions per week
  const perWeek = parseInt(body.match(/(\d+)\s*sessions?\s*per\s*week/i)?.[1] || '5', 10);
  return { weekStart, completedRaw: completedRaw.trim(), next, location, sessionsPerWeek: perWeek };
}

/* ── parse body-weight log ──────────────────────────────────────────────── */
/** Pull "YYYY-MM-DD … NN kg" weigh-ins from the dedicated Body Weight note. */
function parseBodyWeightLog(text) {
  const { body } = parseFrontmatter(text);
  const out = [];
  const re = /(\d{4}-\d{2}-\d{2})\D*?(\d{2,3}(?:\.\d+)?)\s*kg/gi;
  let m;
  while ((m = re.exec(body))) out.push({ date: m[1], kg: parseFloat(m[2]) });
  return out;
}

/** Body weight stated inside a diary (frontmatter `weight:` or a body line). */
function diaryBodyWeight(fm, body) {
  if (fm.weight) {
    const w = parseFloat(fm.weight);
    if (!Number.isNaN(w)) return w;
  }
  const m = body.match(/(?:body ?weight|weight\/body metrics|weight)\s*:?\s*(\d{2,3}(?:\.\d+)?)\s*kg/i);
  return m ? parseFloat(m[1]) : null;
}

/* ── parse quotes ───────────────────────────────────────────────────────── */
function parseQuotes(text) {
  const { body } = parseFrontmatter(text);
  const clean = (l) =>
    l
      .replace(/^“|”$/g, '')
      .replace(/^"|"$/g, '')
      .trim();
  const unused = bulletLines(sectionBody(body, 'Unused')).map((l) => {
    const [q, author] = l.split(/\s+[—–-]\s+/);
    return { quote: clean(q || l), author: author ? author.trim() : '' };
  });
  const used = bulletLines(sectionBody(body, 'Used')).map((l) => {
    const stripped = l.replace(/^\d{4}-\d{2}-\d{2}:\s*/, '');
    const [q, author] = stripped.split(/\s+[—–-]\s+/);
    return { quote: clean(q || stripped), author: author ? author.trim() : '' };
  });
  return [...unused, ...used].filter((q) => q.quote);
}

/* ── main ───────────────────────────────────────────────────────────────── */
async function readIf(file) {
  return existsSync(file) ? readFile(file, 'utf8') : null;
}

async function main() {
  if (!existsSync(FITNESS_DIR)) {
    console.error(`✗ Fitness folder not found: ${FITNESS_DIR}`);
    console.error('  Pass the path as an argument or set MARS_OS_FITNESS.');
    process.exit(1);
  }

  const entries = await readdir(FITNESS_DIR);

  // Diaries
  const diaryFiles = entries.filter((f) => /^Fitness Diary - .*\.md$/.test(f)).sort();
  const sessions = [];
  for (const f of diaryFiles) {
    const txt = await readFile(path.join(FITNESS_DIR, f), 'utf8');
    sessions.push(parseDiary(txt, f));
  }
  sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Routine, goals, state, quotes
  const routine = await readIf(path.join(FITNESS_DIR, 'Fitness Routine.md')).then((t) =>
    t ? parseRoutine(t) : { version: '', days: [], volumeTargets: {} }
  );
  const goals = await readIf(path.join(FITNESS_DIR, 'Fitness Goals.md')).then((t) =>
    t ? parseGoals(t) : { goals: [], pullUpGoal: null }
  );
  const state = await readIf(path.join(FITNESS_DIR, 'Fitness State.md')).then((t) =>
    t ? parseState(t) : {}
  );
  const quotes = await readIf(path.join(FITNESS_DIR, 'Motivation Quote Bank.md')).then((t) =>
    t ? parseQuotes(t) : []
  );

  /* ── body weight: dedicated log + any weights logged inside diaries ───── */
  const weightByDate = new Map();
  for (const s of sessions) {
    if (s.date && typeof s.weight === 'number' && !Number.isNaN(s.weight)) weightByDate.set(s.date, s.weight);
  }
  const weightLogText =
    (await readIf(path.join(FITNESS_DIR, 'Fitness Weight Log.md'))) ||
    (await readIf(path.join(FITNESS_DIR, 'Body Weight.md'))) ||
    (await readIf(path.join(FITNESS_DIR, 'Weight Log.md')));
  if (weightLogText) {
    for (const e of parseBodyWeightLog(weightLogText)) weightByDate.set(e.date, e.kg); // log wins over diary
  }
  const bodyweight = [...weightByDate.entries()]
    .map(([date, kg]) => ({ date, kg }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  /* ── derived: current-week sessions ─────────────────────────────────── */
  const weekStart = state.weekStart || (sessions[0] && sessions[0].date) || null;
  const weekSessions = weekStart
    ? sessions.filter((s) => s.date >= weekStart && s.date < addDays(weekStart, 7))
    : sessions;

  /* ── derived: muscle volume this week (sets per muscle) ─────────────── */
  const muscleSets = {};
  for (const m of TARGET_MUSCLES) muscleSets[m] = 0;
  for (const s of weekSessions) {
    for (const ex of s.exercises) {
      const mu = ex.muscle;
      if (mu in muscleSets) muscleSets[mu] += ex.setCount || 0;
      else muscleSets[mu] = (muscleSets[mu] || 0) + (ex.setCount || 0);
    }
  }
  const muscleVolume = TARGET_MUSCLES.map((m) => ({
    muscle: m,
    sets: muscleSets[m] || 0,
    target: routine.volumeTargets[m] || null,
  }));

  /* ── derived: key lifts (best logged working weight per exercise) ───── */
  const liftMap = new Map();
  for (const s of sessions) {
    for (const ex of s.exercises) {
      if (ex.topWeight == null) continue;
      const prev = liftMap.get(ex.name);
      if (!prev || ex.topWeight > prev.weight) {
        const topReps =
          ex.sets.filter((x) => x.weight === ex.topWeight).map((x) => x.reps).sort((a, b) => b - a)[0] || null;
        liftMap.set(ex.name, {
          name: ex.name,
          muscle: ex.muscle,
          weight: ex.topWeight,
          reps: topReps,
          perSide: !!ex.perSide,
          date: s.date,
          note: ex.note || '',
        });
      }
    }
  }
  const keyLifts = [...liftMap.values()].sort((a, b) => b.weight - a.weight);

  /* ── derived: pull-up progress ──────────────────────────────────────── */
  let pullUpBest = 0;
  let pullUpDate = null;
  for (const s of sessions) {
    for (const ex of s.exercises) {
      if (!/pull-?up|chin/i.test(ex.name)) continue;
      for (const set of ex.sets) {
        if (set.bodyweight && set.reps > pullUpBest) {
          pullUpBest = set.reps;
          pullUpDate = s.date;
        }
      }
    }
  }

  /* ── derived: PR feed ───────────────────────────────────────────────── */
  const prs = [];
  const seenPr = new Set();
  const pushPr = (date, text) => {
    const key = text.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 28);
    if (!key || seenPr.has(key)) return;
    seenPr.add(key);
    prs.push({ date, text });
  };
  for (const s of sessions) {
    // Curated highlights are the cleaner source; only fall back to auto-detected
    // PR lines for sessions that didn't write a highlights block.
    if (s.highlights.length) {
      for (const h of s.highlights) pushPr(s.date, h);
    } else {
      for (const ex of s.exercises) {
        if (ex.pr) pushPr(s.date, `${ex.name}: ${ex.raw}`.slice(0, 160));
      }
    }
  }

  /* ── derived: totals ────────────────────────────────────────────────── */
  const totals = {
    sessionsLogged: sessions.length,
    setsLogged: sessions.reduce((a, s) => a + s.setCount, 0),
    repsLogged: sessions.reduce((a, s) => a + s.repCount, 0),
    volumeLoad: sessions.reduce((a, s) => a + s.volumeLoad, 0),
    weekSessions: weekSessions.length,
    weekSets: weekSessions.reduce((a, s) => a + s.setCount, 0),
    weekReps: weekSessions.reduce((a, s) => a + s.repCount, 0),
    weekVolumeLoad: weekSessions.reduce((a, s) => a + s.volumeLoad, 0),
  };

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'Mars OS vault · 10-Personal/Fitness',
    goals: goals.goals,
    pullUp: { best: pullUpBest, goal: goals.pullUpGoal || 20, date: pullUpDate },
    routine,
    state,
    weekStart,
    sessions,
    weekSessions: weekSessions.map((s) => s.date),
    muscleVolume,
    keyLifts,
    prs,
    totals,
    bodyweight,
    quotes,
  };

  await writeFile(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`✓ Wrote ${path.relative(REPO_ROOT, OUT_FILE)}`);
  console.log(
    `  ${sessions.length} sessions · ${totals.setsLogged} sets · ${keyLifts.length} tracked lifts · ${quotes.length} quotes`
  );
}

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
