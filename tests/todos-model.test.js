const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');

// Minimal DOM/window stubs — enough for the IIFE to load. boot() bails when the
// config fetch throws, so none of the view code runs.
const sandbox = {
  console,
  setInterval() {},
  clearInterval() {},
  window: {
    addEventListener() {},
    matchMedia() {
      return { matches: true, addEventListener() {} };
    },
    requestAnimationFrame() {
      return 0;
    },
    cancelAnimationFrame() {},
  },
  document: {
    readyState: 'loading',
    addEventListener() {},
    getElementById() {
      return null;
    },
    body: { addEventListener() {} },
    title: '',
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
  },
  localStorage: { getItem() { return null; }, setItem() {} },
  fetch() {
    throw new Error('fetch should not run in unit tests');
  },
};
sandbox.window.document = sandbox.document;
sandbox.window.localStorage = sandbox.localStorage;
vm.createContext(sandbox);
vm.runInContext(appSource, sandbox, { filename: 'app.js' });

const api = sandbox.window.__chronosTestApi;
assert.ok(api, 'app exposes test API');
const { normalizeTask, setTaskStatus, setTaskDone } = api;

// ── normalizeTask: status / done coherence ───────────────────────────────────
{
  const fresh = normalizeTask({ text: 'plain' }, true);
  assert.equal(fresh.status, 'todo', 'a new top-level task defaults to the To Do stage');
  assert.equal(fresh.done, false);
  assert.ok(Array.isArray(fresh.subtasks), 'top-level tasks carry a subtasks array');
}
{
  const wip = normalizeTask({ text: 'wip', status: 'in-progress' }, true);
  assert.equal(wip.status, 'in-progress');
  assert.equal(wip.done, false, 'a non-done stage leaves the task open');
}
{
  const viaStatus = normalizeTask({ text: 'finished', status: 'done' }, true);
  assert.equal(viaStatus.done, true, "the 'done' stage implies done");
  assert.ok(viaStatus.doneAt, 'a done task gets a doneAt timestamp');
}
{
  const viaFlag = normalizeTask({ text: 'finished', done: true }, true);
  assert.equal(viaFlag.status, 'done', 'a done task always lands in the Completed stage');
}
{
  const bogus = normalizeTask({ text: 'x', status: 'not-a-stage' }, true);
  assert.equal(bogus.status, 'todo', 'an unknown stage falls back to To Do');
}
{
  const sub = normalizeTask({ text: 'sub' }, false);
  assert.equal(Object.prototype.hasOwnProperty.call(sub, 'status'), false, 'subtasks carry no Kanban status');
  assert.equal(Object.prototype.hasOwnProperty.call(sub, 'subtasks'), false, 'subtasks do not nest');
}

// ── setTaskStatus: keeps done/doneAt in lockstep ─────────────────────────────
{
  const t = normalizeTask({ text: 't' }, true);
  setTaskStatus(t, 'done');
  assert.equal(t.done, true);
  assert.ok(t.doneAt, 'moving to Completed stamps doneAt');
  setTaskStatus(t, 'waiting');
  assert.equal(t.done, false, 'moving out of Completed reopens the task');
  assert.equal(t.doneAt, null, 'reopening clears doneAt');
  assert.equal(t.status, 'waiting');
  setTaskStatus(t, 'bogus');
  assert.equal(t.status, 'todo', 'an invalid stage is coerced to To Do');
}

// ── setTaskDone: the List-view checkbox path ─────────────────────────────────
{
  const t = normalizeTask({ text: 't', status: 'in-progress' }, true);
  setTaskDone(t, true);
  assert.equal(t.done, true);
  assert.equal(t.status, 'done', 'checking a task off moves it to Completed');
  setTaskDone(t, false);
  assert.equal(t.done, false);
  assert.equal(t.status, 'todo', 'un-checking returns the task to To Do');
  assert.equal(t.doneAt, null);
}
{
  // Subtasks have no status field; setTaskDone must not invent one.
  const sub = normalizeTask({ text: 'sub' }, false);
  setTaskDone(sub, true);
  assert.equal(sub.done, true);
  assert.equal(Object.prototype.hasOwnProperty.call(sub, 'status'), false, 'subtasks stay status-free when toggled');
}

console.log('todos-model.test.js: all assertions passed');
