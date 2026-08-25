const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
const sandbox = {
  console, setInterval() {}, clearInterval() {},
  window: { addEventListener() {}, matchMedia() { return { matches: true, addEventListener() {} }; }, requestAnimationFrame() { return 0; }, cancelAnimationFrame() {} },
  document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, body: { addEventListener() {} }, title: '', querySelectorAll() { return []; }, querySelector() { return null; } },
  localStorage: { getItem() { return null; }, setItem() {} },
  fetch() { throw new Error('fetch should not run in unit tests'); },
};
sandbox.window.document = sandbox.document;
sandbox.window.localStorage = sandbox.localStorage;
vm.createContext(sandbox);
vm.runInContext(appSource, sandbox, { filename: 'app.js' });
const api = sandbox.window.__chronosTestApi;
const config = api.mergeDefaults(JSON.parse(fs.readFileSync(path.join(repoRoot, 'config.json'), 'utf8')));

const y = new Date().getUTCFullYear();
const view = { yearStart: `${y}-01-01`, yearEnd: `${y}-12-31`, trips: [] };

// Current year: the log is always accounted for, and "so far" is cut at today.
const cur = api.computeFiscalFor(view, 'current', config);
assert.ok(cur.valid);
assert.ok(cur.soFar.has, 'today falls inside the current year, so a so-far reading exists');
assert.ok(cur.soFar.days > 0 && cur.soFar.days < cur.totalDays);
assert.ok(cur.soFar.daysInSpain <= cur.daysInSpain, 'realized Spain days never exceed projected');
assert.ok(cur.soFar.inCountry <= cur.inCountry, 'realized home days never exceed projected');
assert.equal(cur.soFar.inCountry + cur.soFar.awayDays, cur.soFar.days, 'so-far home + abroad = elapsed days');
assert.equal(cur.inCountry + cur.awayDays, cur.totalDays, 'projected home + abroad = year');
for (const c of cur.countryTotals) assert.ok(c.soFar <= c.days, `${c.country}: so far ≤ projected`);
assert.equal(cur.countryTotals.reduce((n, c) => n + c.soFar, 0), cur.soFar.days, 'chip so-far values sum to elapsed days');

// A planned trip in the future moves the projection but not the realized number.
const spainSoFar = cur.soFar.daysInSpain;
const withTrip = api.computeFiscalFor({ ...view, trips: [{ id: 't1', label: 'Xmas', country: 'Spain', start: `${y}-12-20`, days: 10 }] }, 'current');
assert.equal(withTrip.soFar.daysInSpain, spainSoFar, 'a future planned trip leaves the so-far count alone');
assert.equal(withTrip.daysInSpain, cur.daysInSpain + 10, 'but adds to the projection');

// Planned future year: no so-far reading, log ignored.
const next = api.computeFiscalFor({ yearStart: `${y + 1}-01-01`, yearEnd: `${y + 1}-12-31`, trips: [] }, 'planned', config);
assert.equal(next.soFar.has, false, 'a future year has nothing realized yet');
assert.equal(next.loggedSegs.length, 0, 'planned view ignores the travel log');
assert.equal(next.awayDays, 0);

console.log('fiscal-model.test.js: all assertions passed');
