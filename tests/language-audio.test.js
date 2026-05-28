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
assert.equal(typeof api.getLanguageAudioPacks, 'function', 'language audio pack normalizer is exposed');
assert.equal(typeof api.renderLanguageAudioPackCard, 'function', 'language audio card renderer is exposed');

const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config.json'), 'utf8'));
const merged = api.mergeDefaults(config);
const packs = api.getLanguageAudioPacks(merged);
assert.ok(packs.length >= 1, 'language audio packs are loaded from config');

const pack = packs.find((item) => item.id === 'indonesian-basic-daily-pack-001');
assert.ok(pack, 'Indonesian basic daily pack is available');
assert.ok(pack.audio.length >= 1, 'pack exposes playable combined audio files');
assert.ok(pack.phrases.length >= 185, 'pack exposes all phrase spelling rows');
assert.deepEqual(
  { english: pack.phrases[0].english, indonesian: pack.phrases[0].indonesian },
  { english: 'Good morning.', indonesian: 'Selamat pagi.' },
  'first phrase keeps English and Indonesian spelling'
);
assert.ok(pack.audio.every((a) => /^docs\/language-audio\//.test(a.src)), 'audio sources are web-safe relative paths');

const html = api.renderLanguageAudioPackCard(pack);
assert.match(html, /<audio\b[^>]*controls/i, 'rendered card contains a playable audio control');
assert.match(html, /<details\b/i, 'rendered card contains an accordion');
assert.match(html, /Selamat pagi\./, 'rendered card includes Indonesian phrase spelling');
assert.match(html, /Good morning\./, 'rendered card includes English phrase spelling');

console.log('language-audio tests passed');
