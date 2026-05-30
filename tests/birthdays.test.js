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
    confirm() { return true; },
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
assert.equal(typeof api.normalizeBirthday, 'function', 'birthday normalizer is exposed');
assert.equal(typeof api.sortBirthdays, 'function', 'birthday sorter is exposed');
assert.equal(typeof api.birthdayNextInfo, 'function', 'birthday next-date helper is exposed');

const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
assert.match(indexHtml, /data-view="birthdays"/, 'Birthdays nav item exists');
assert.match(indexHtml, /id="view-birthdays"/, 'Birthdays view mount exists');

const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config.json'), 'utf8'));
const merged = api.mergeDefaults(config);
assert.ok(Array.isArray(merged.birthdays), 'config exposes birthdays array');
assert.ok(merged.birthdays.some((b) => b.name === 'Bea' && b.monthDay === '05-30'), 'Bea birthday is configured');
assert.ok(merged.birthdays.some((b) => b.name === 'Juan' && b.monthDay === '07-05'), 'Juan birthday is configured');

const normalized = api.normalizeBirthday({ name: ' Test ', monthDay: '7/5', note: ' x ' }, 0);
assert.deepEqual(
  { name: normalized.name, monthDay: normalized.monthDay, note: normalized.note },
  { name: 'Test', monthDay: '07-05', note: 'x' },
  'normalizer accepts slash dates and pads month/day'
);

const sorted = api.sortBirthdays([
  { id: 'a', name: 'Later', monthDay: '12-31' },
  { id: 'b', name: 'Sooner', monthDay: '01-01' },
]);
assert.equal(sorted.length, 2, 'sorter returns all valid birthdays');

console.log('birthdays tests passed');
