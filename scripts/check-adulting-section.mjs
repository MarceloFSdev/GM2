import fs from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');

const html = read('index.html');
const app = read('app.js');
const css = read('styles.css');

assert.match(html, /data-view="adulting"/, 'sidebar must include Adulting nav item');
assert.match(html, /id="view-adulting"/, 'HTML must include adulting view section');
assert.match(html, /id="adulting-mount"/, 'HTML must include adulting mount');

assert.match(app, /adulting: 'Adulting'/, 'VIEW_TITLES must include Adulting');
assert.match(app, /let elAdulting;/, 'app.js must track adulting mount');
assert.match(app, /function renderAdulting\(/, 'app.js must implement renderAdulting');
assert.match(app, /const allowed = \[[^\]]*'adulting'/s, 'setView allowed list must include adulting');
assert.match(app, /adulting: \$\('view-adulting'\)/, 'setView must map adulting view');
assert.match(app, /if \(view === 'adulting'\) renderAdulting\(\)/, 'setView must render adulting view');
assert.match(app, /elAdulting = \$\('adulting-mount'\)/, 'init must bind adulting mount');
assert.match(app, /saved === 'adulting'/, 'saved view restore must include adulting');
assert.match(app, /Pay rent/, 'simple adulting todo list should include starter items');

assert.match(css, /\.adulting-list/, 'styles.css must include adulting list styling');
assert.match(css, /\.adulting-item/, 'styles.css must include adulting item styling');

console.log('adulting section checks passed');
