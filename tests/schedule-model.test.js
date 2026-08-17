const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');

const sandbox = {
  console,
  setInterval() {},
  clearInterval() {},
  window: {
    addEventListener() {},
    matchMedia() { return { matches: true, addEventListener() {} }; },
    requestAnimationFrame() { return 0; },
    cancelAnimationFrame() {},
  },
  document: {
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; },
    body: { addEventListener() {} },
    title: '',
    querySelectorAll() { return []; },
    querySelector() { return null; },
  },
  localStorage: { getItem() { return null; }, setItem() {} },
  fetch() { throw new Error('fetch should not run in unit tests'); },
};
sandbox.window.document = sandbox.document;
sandbox.window.localStorage = sandbox.localStorage;
vm.createContext(sandbox);
vm.runInContext(appSource, sandbox, { filename: 'app.js' });

const api = sandbox.window.__chronosTestApi;
assert.ok(api, 'app exposes test API');
const {
  getScheduleBlocks,
  getScheduleHeadlines,
  getScheduleRules,
  fmtMinAsClock,
  scheduleBlockLength,
  scheduleBlockHeight,
  scheduleFmtDuration,
} = api;

const blocks = getScheduleBlocks();
assert.equal(blocks.length, 12, 'schedule has clear daily blocks');
assert.deepEqual(Array.from(blocks.map((b) => b.start)), [330, 360, 480, 510, 630, 720, 840, 870, 960, 1050, 1170, 1230]);
assert.equal(blocks[0].label, 'Morning launch');
assert.equal(blocks[1].label, 'Build focus 1');
assert.equal(blocks.at(-1).label, 'Sleep');
assert.equal(scheduleBlockLength(blocks.at(-1)), 540, 'sleep crosses midnight and lasts 9h');
assert.equal(fmtMinAsClock(330), '5:30am');
assert.equal(fmtMinAsClock(1230), '8:30pm');

const headlines = getScheduleHeadlines();
assert.equal(headlines[0].value, '5:30am');
assert.ok(headlines.some((h) => h.label === 'Main focus'));
assert.ok(headlines.some((h) => h.value.includes('Spain time')));

const rules = getScheduleRules();
assert.ok(rules.some((r) => r.metric === 'Phone rule'));
assert.ok(rules.some((r) => r.target.includes('20:00')));

// ── Vertical timeline: row height tracks block length ────────────────────────
assert.equal(scheduleFmtDuration(30), '30m');
assert.equal(scheduleFmtDuration(120), '2h');
assert.equal(scheduleFmtDuration(90), '1h 30m');

{
  const heights = blocks.map((b) => ({ label: b.label, len: scheduleBlockLength(b), px: scheduleBlockHeight(b) }));
  // A longer block is never shorter on screen than a shorter one.
  const byLength = [...heights].sort((a, b) => a.len - b.len);
  for (let i = 1; i < byLength.length; i += 1) {
    assert.ok(byLength[i].px >= byLength[i - 1].px, `${byLength[i].label} is at least as tall as ${byLength[i - 1].label}`);
  }
  // Short blocks stay tall enough to hold their label and summary...
  assert.ok(Math.min(...heights.map((h) => h.px)) >= 80, 'shortest block keeps a readable height');
  // ...and the 9h sleep block stays inside one screen instead of scaling linearly.
  assert.ok(Math.max(...heights.map((h) => h.px)) <= 340, 'longest block stays compact enough to scan');
  // Duration differences remain visible: 2h reads clearly taller than 30m.
  const short = heights.find((h) => h.len === 30);
  const long = heights.find((h) => h.len === 120);
  assert.ok(long.px - short.px >= 40, 'a 2h block is visibly taller than a 30m block');
}

console.log('schedule-model.test.js: all assertions passed');
