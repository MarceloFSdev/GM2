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

const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config.json'), 'utf8'));
const merged = api.mergeDefaults(config);
assert.equal(api.collectFlightTrips(merged).length, 5, 'flight trips are de-duplicated across upcomingTrips and bookings');

const singaporeStay = merged.travelLog.find((stay) => stay.country === 'Singapore' && stay.entryDate === '2026-04-29');
assert.deepEqual(
  {
    city: singaporeStay?.city,
    timezone: singaporeStay?.timezone,
    exitDate: singaporeStay?.exitDate,
  },
  {
    city: 'Singapore',
    timezone: 'Asia/Singapore',
    exitDate: '2026-05-04',
  },
  'Singapore flight trip is present in the travel log'
);

const indonesiaStayAfterSingapore = merged.travelLog.find((stay) => stay.country === 'Indonesia' && stay.entryDate === '2026-05-04');
assert.equal(indonesiaStayAfterSingapore?.exitDate, '2026-05-30', 'Indonesia stay after Singapore closes when the KL flight departs');
const malaysiaStay = merged.travelLog.find((stay) => stay.country === 'Malaysia' && stay.entryDate === '2026-05-30');
assert.equal(malaysiaStay?.exitDate, '2026-06-14', 'KL outbound/return flights create the Malaysia stay');
const indonesiaStayAfterKL = merged.travelLog.find((stay) => stay.country === 'Indonesia' && stay.entryDate === '2026-06-14');
assert.equal(indonesiaStayAfterKL?.exitDate, '2026-07-19', 'return flight from KL starts the Indonesia stay until the Spain flight');
const spainStay = merged.travelLog.find((stay) => stay.country === 'Spain' && stay.entryDate === '2026-07-19');
assert.equal(spainStay?.exitDate, null, 'planned Bali to Spain flight starts the open-ended Spain stay');

const y2026 = { start: Date.UTC(2026, 0, 1), endEx: Date.UTC(2027, 0, 1) };
const totals = api.countryDaysInPeriod(merged.travelLog, y2026.start, y2026.endEx);
assert.equal(totals.Singapore, 5, 'Singapore stay counts as 5 days in country stats');

const longTerm = api.getLongTermBookings(merged);
assert.equal(longTerm.length, 6, 'long-term bookings are loaded separately from one-time bookings');
assert.equal(merged.bookings.some((b) => /rent|gym|motorbike/i.test(b.title || '')), false, 'renewing commitments are not stored as one-time bookings');

const renewalAlerts = api.longTermRenewalAlerts(merged);
assert.equal(renewalAlerts.length, 5, 'dated long-term bookings create renewal alerts');
assert.deepEqual(
  renewalAlerts.map((a) => [a.title, a.expiresDate]).sort(),
  [
    ['B-Work renewal', '2026-06-22'],
    ['Bali rent renewal', '2026-06-04'],
    ['Mobile SIM renewal', '2026-06-04'],
    ['Motorbike rental renewal', '2026-06-06'],
    ['Wellness Gym Canggu renewal', '2026-05-26'],
  ].sort(),
  'rent, motorbike, and gym renewal dates feed alerts'
);
assert.equal(api.longTermRenewalAlerts(merged).some((a) => /visa/i.test(a.title)), false, 'visa status has no alert until a renewal/expiry date is recorded');
assert.equal(api.getLongTermBookings(merged).find((item) => item.type === 'visa')?.title, 'Indonesia visa status', 'visa status lives with long-term bookings');

const missingSingapore = JSON.parse(JSON.stringify(config));
missingSingapore.travelLog = missingSingapore.travelLog
  .filter((stay) => stay.country !== 'Singapore' && stay.entryDate !== '2026-05-04')
  .map((stay) => stay.entryDate === '2026-03-07' ? { ...stay, exitDate: null, notes: 'Current stay' } : stay);
const auto = api.mergeDefaults(missingSingapore);
const autoSingaporeStay = auto.travelLog.find((stay) => stay.country === 'Singapore' && stay.entryDate === '2026-04-29');
const autoReturnStay = auto.travelLog.find((stay) => stay.country === 'Indonesia' && stay.entryDate === '2026-05-04');
const autoPostKLStay = auto.travelLog.find((stay) => stay.country === 'Indonesia' && stay.entryDate === '2026-06-14');
const autoSpainStay = auto.travelLog.find((stay) => stay.country === 'Spain' && stay.entryDate === '2026-07-19');
assert.equal(autoSingaporeStay?.exitDate, '2026-05-04', 'future flight additions auto-close derived stays');
assert.equal(autoReturnStay?.exitDate, '2026-05-30', 'derived Indonesia stay closes when the next outbound flight departs');
assert.equal(autoPostKLStay?.exitDate, '2026-07-19', 'derived Indonesia stay closes when the Spain flight departs');
assert.equal(autoSpainStay?.exitDate, null, 'Spain stay remains open-ended until a return is added');

console.log('travel-log-derived tests passed');
