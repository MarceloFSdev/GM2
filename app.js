/**
 * CHRONOS GMT — config-driven dashboard + Countries map (TopoJSON / d3).
 * entryDate inclusive; exitDate exclusive (departure day not counted as full day).
 */
(function () {
  'use strict';

  const STORAGE_VIEW = 'chronos-gmt-view';
  const ABROAD_ANCHOR_COUNTRY = 'Spain';

  const VIEW_TITLES = {
    dashboard: 'Dashboard',
    travel: 'Travel Log',
    clocks: 'World Clocks',
    world: 'Countries',
  };

  let config = null;
  let validationWarnings = [];
  let travelLogMode = 'calendar';

  let elLoading;
  let elError;
  let elRoot;
  let elWarnings;
  let elDashboard;
  let elTravel;
  let elClocks;
  let elWorld;

  const clockHandlers = new Map();

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function todayUtcYmd() {
    return new Date().toISOString().slice(0, 10);
  }

  function parseYmdToUtcMs(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
    if (!m) return NaN;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function addUtcDaysMs(ms, days) {
    return ms + days * 86400000;
  }

  function stayInclusiveStartMs(stay) {
    return parseYmdToUtcMs(stay.entryDate);
  }

  function stayExclusiveEndMs(stay) {
    if (stay.exitDate) return parseYmdToUtcMs(stay.exitDate);
    return addUtcDaysMs(parseYmdToUtcMs(todayUtcYmd()), 1);
  }

  function intersectDayCount(sInc, eEx, winStart, winEndEx) {
    const lo = Math.max(sInc, winStart);
    const hi = Math.min(eEx, winEndEx);
    const diff = hi - lo;
    return diff > 0 ? Math.floor(diff / 86400000) : 0;
  }

  function currentCalendarYearWindow() {
    const y = new Date().getUTCFullYear();
    return { startMs: Date.UTC(y, 0, 1), endExMs: Date.UTC(y + 1, 0, 1) };
  }

  function rolling365Window() {
    const todayMs = parseYmdToUtcMs(todayUtcYmd());
    return { startMs: addUtcDaysMs(todayMs, -364), endExMs: addUtcDaysMs(todayMs, 1) };
  }

  function getPeriodWindow() {
    return travelLogMode === 'rolling' ? rolling365Window() : currentCalendarYearWindow();
  }

  function countryDaysInPeriod(stays, winStartMs, winEndExMs) {
    const map = Object.create(null);
    for (const stay of stays) {
      const s = stayInclusiveStartMs(stay);
      const e = stayExclusiveEndMs(stay);
      if (Number.isNaN(s) || Number.isNaN(e)) continue;
      const days = intersectDayCount(s, e, winStartMs, winEndExMs);
      if (days <= 0) continue;
      const c = stay.country || 'Unknown';
      map[c] = (map[c] || 0) + days;
    }
    return map;
  }

  function homeCountry() {
    return (config.app && config.app.homeCountry) || null;
  }

  function isAbroadAnchorCountry(country) {
    if (country == null || country === '') return false;
    return String(country).trim().toLowerCase() === ABROAD_ANCHOR_COUNTRY.toLowerCase();
  }

  function computeYtdCountryTotals() {
    const { startMs, endExMs } = currentCalendarYearWindow();
    return countryDaysInPeriod(config.travelLog || [], startMs, endExMs);
  }

  function daysSinceBaseStart() {
    const cb = config.currentBase || {};
    const start = parseYmdToUtcMs(cb.startDate);
    if (Number.isNaN(start)) return 0;
    const today = parseYmdToUtcMs(todayUtcYmd());
    return Math.max(0, Math.floor((addUtcDaysMs(today, 1) - start) / 86400000));
  }

  function stayRowDays(stay) {
    const s = stayInclusiveStartMs(stay);
    const e = stayExclusiveEndMs(stay);
    if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return 0;
    return Math.floor((e - s) / 86400000);
  }

  function formatTimeForZone(tz, withSeconds) {
    try {
      const opts = { hour: '2-digit', minute: '2-digit', hour12: false };
      if (withSeconds) opts.second = '2-digit';
      return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: tz }).format(new Date());
    } catch {
      return '—';
    }
  }

  function formatDateForZone(tz) {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: tz,
      }).format(new Date());
    } catch {
      return '—';
    }
  }

  function getUtcOffsetLabel(tz) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        timeZoneName: 'longOffset',
      }).formatToParts(new Date());
      const p = parts.find((x) => x.type === 'timeZoneName');
      return p ? p.value.replace('GMT', 'UTC') : '';
    } catch {
      return '';
    }
  }

  function isExcludedAlert(a) {
    if (!a) return true;
    const ty = String(a.type || '').toLowerCase();
    if (ty === 'flat' || ty === 'visa') return true;
    return false;
  }

  function getVisibleAlerts() {
    return (config.alerts || []).filter((a) => a && a.isActive !== false && !isExcludedAlert(a));
  }

  function alertSortDate(a) {
    return a.expiresDate || a.date || a.startDate || '';
  }

  function getNearestAlert() {
    const alerts = getVisibleAlerts();
    const today = parseYmdToUtcMs(todayUtcYmd());
    let best = null;
    let bestMs = Infinity;
    for (const a of alerts) {
      const d = parseYmdToUtcMs(alertSortDate(a));
      if (Number.isNaN(d) || d < today) continue;
      if (d < bestMs) {
        bestMs = d;
        best = a;
      }
    }
    return best;
  }

  function mergeDefaults(raw) {
    const o = raw && typeof raw === 'object' ? raw : {};
    return {
      app: Object.assign({ title: 'CHRONOS GMT', subtitle: 'Global Citizen', defaultView: 'dashboard', systemStatus: 'OPTIMAL' }, o.app || {}),
      currentBase: o.currentBase || {},
      worldClocks: o.worldClocks || { priority: [], us: [] },
      travelLog: Array.isArray(o.travelLog) ? o.travelLog : [],
      travelTimeline: Array.isArray(o.travelTimeline) ? o.travelTimeline : [],
      alerts: Array.isArray(o.alerts) ? o.alerts : [],
      countriesVisitedEver: Array.isArray(o.countriesVisitedEver) ? o.countriesVisitedEver : [],
      countriesWantToVisit: Array.isArray(o.countriesWantToVisit) ? o.countriesWantToVisit : [],
    };
  }

  function validateConfig() {
    validationWarnings = [];
    if (!config.currentBase || !config.currentBase.timezone) {
      validationWarnings.push('currentBase.timezone missing');
    }
  }

  async function loadConfig() {
    const res = await fetch('config.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('config fetch failed');
    return res.json();
  }

  function applyBranding() {
    const t = (config.app && config.app.title) || 'CHRONOS GMT';
    const st = (config.app && config.app.subtitle) || '';
    document.title = t;
    const logo = $('sidebar-logo');
    if (logo) logo.textContent = t;
    const sub = $('sidebar-subtitle');
    if (sub) sub.textContent = st;
    const mob = $('mobile-title');
    if (mob) mob.textContent = t;
    const status = (config.app && config.app.systemStatus) || 'OPTIMAL';
    const ts = $('top-status-text');
    if (ts) ts.textContent = `SYSTEM STATUS: ${status}`;
  }

  function renderConfigWarnings() {
    if (!elWarnings) return;
    if (!validationWarnings.length) {
      elWarnings.classList.add('hidden');
      elWarnings.textContent = '';
      return;
    }
    elWarnings.classList.remove('hidden');
    elWarnings.textContent = validationWarnings.join(' · ');
  }

  function registerClock(id, fn) {
    clockHandlers.set(id, fn);
  }

  function updateAllClocks() {
    clockHandlers.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore */
      }
    });
  }

  function registerCoreClocks() {
    registerClock('utc-clock', () => {
      const el = $('utc-clock');
      if (el) el.textContent = `UTC ${formatTimeForZone('Etc/UTC', true)}`;
    });
    const gmt = $('sidebar-gmt');
    if (gmt) {
      registerClock('sidebar-gmt', () => {
        gmt.textContent = getUtcOffsetLabel('Etc/UTC') || 'GMT +00:00';
      });
    }
  }

  function startClockUpdates() {
    registerCoreClocks();
    setInterval(updateAllClocks, 1000);
    updateAllClocks();
  }

  function ytdPrimaryCountry(totals) {
    let best = null;
    let max = -1;
    for (const c of Object.keys(totals)) {
      if (totals[c] > max) {
        max = totals[c];
        best = c;
      }
    }
    return best;
  }

  function renderDashboard() {
    if (!elDashboard) return;
    const cb = config.currentBase || {};
    const tz = cb.timezone || 'Etc/UTC';
    const totals = computeYtdCountryTotals();
    const primary = ytdPrimaryCountry(totals);
    const nearest = getNearestAlert();
    const rows = Object.keys(totals)
      .filter((k) => totals[k] > 0)
      .sort((a, b) => totals[b] - totals[a])
      .map(
        (country) => `
        <tr>
          <td>${escapeHtml(country)}</td>
          <td>${totals[country]}</td>
          <td>${country === primary ? 'PRIMARY' : totals[country] >= 14 ? 'VISITING' : 'TRANSIT'}</td>
        </tr>`
      )
      .join('');

    const pri = (config.worldClocks && config.worldClocks.priority) || [];
    const clocksHtml = pri
      .map((c) => {
        const id = `dash-clock-${escapeHtml(c.label || '').replace(/\s/g, '-')}`;
        registerClock(id, () => {
          const el = $(id);
          if (el) el.textContent = formatTimeForZone(c.timezone, false);
        });
        return `<div class="sync-card"><div class="panel-head"><h2>${escapeHtml(c.label)}</h2></div><p class="sync-card__time" id="${id}">—</p></div>`;
      })
      .join('');

    elDashboard.innerHTML = `
      <div class="dashboard-grid">
        <div class="hero-card card">
          <div class="hero-card__pills">
            <span class="pill pill--accent">Current Base</span>
            <span class="pill">${escapeHtml(cb.residencyLabel || 'Residence')}</span>
          </div>
          <h2 class="hero-card__title" id="dashboard-heading">${escapeHtml([cb.city, cb.country].filter(Boolean).join(', ') || '—')}</h2>
          <div class="hero-time" id="dash-hero-time">—</div>
          <p style="margin:0.5rem 0 0;font-size:0.85rem;color:var(--text-muted)">${escapeHtml(formatDateForZone(tz))} · ${escapeHtml(getUtcOffsetLabel(tz))}</p>
        </div>
        <div>
          <div class="card" style="margin-bottom:1rem">
            <div class="panel-head"><h2>Stay</h2></div>
            <p style="margin:0;font-size:1.5rem;font-weight:700;color:var(--accent)">${daysSinceBaseStart()} days</p>
            <p style="margin:0.25rem 0 0;font-size:0.8rem;color:var(--text-muted)">Since start date</p>
          </div>
          <div class="card">
            <div class="panel-head"><h2>Nearest alert</h2></div>
            ${
              nearest
                ? `<p style="margin:0;font-weight:600">${escapeHtml(nearest.title)}</p><p style="margin:0.35rem 0 0;font-size:0.85rem;color:var(--text-muted)">${escapeHtml(alertSortDate(nearest))}</p>`
                : '<p style="margin:0;color:var(--text-muted)">No upcoming alerts</p>'
            }
          </div>
        </div>
      </div>
      <div class="card" style="margin-top:1.25rem">
        <div class="panel-head"><h2>World summary</h2></div>
        <div class="sync-grid" style="margin-top:1rem">${clocksHtml || '<p style="color:var(--text-muted)">No priority cities</p>'}</div>
      </div>
      <div class="card" style="margin-top:1.25rem">
        <div class="panel-head"><h2>YTD by country</h2></div>
        <div style="overflow-x:auto;margin-top:0.75rem">
          <table class="data-table">
            <thead><tr><th>Country</th><th>Days</th><th>Status</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="3" style="color:var(--text-muted)">No data</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;

    registerClock('dash-hero-time', () => {
      const el = $('dash-hero-time');
      if (el) el.textContent = formatTimeForZone(tz, true);
    });
    updateAllClocks();
  }

  function renderTravelLog() {
    if (!elTravel) return;
    const { startMs, endExMs } = getPeriodWindow();
    const map = countryDaysInPeriod(config.travelLog || [], startMs, endExMs);
    const countriesCount = Object.keys(map).filter((k) => map[k] > 0).length;
    let abroadDays = 0;
    for (const c of Object.keys(map)) {
      if (!isAbroadAnchorCountry(c)) abroadDays += map[c];
    }
    const cb = config.currentBase || {};
    const stays = [...(config.travelLog || [])].sort((a, b) => {
      const da = parseYmdToUtcMs(a.entryDate);
      const db = parseYmdToUtcMs(b.entryDate);
      return (Number.isNaN(db) ? 0 : db) - (Number.isNaN(da) ? 0 : da);
    });

    const rows = stays
      .map((s) => {
        const days = stayRowDays(s);
        const cur = s.exitDate == null ? 'CURRENT' : '';
        return `<tr>
          <td>${escapeHtml(s.entryDate)} → ${escapeHtml(s.exitDate || '…')}</td>
          <td>${escapeHtml(s.country)}</td>
          <td>${escapeHtml(s.city || '')}</td>
          <td>${escapeHtml(s.timezone || '')}</td>
          <td>${days}</td>
          <td>${cur}</td>
        </tr>`;
      })
      .join('');

    elTravel.innerHTML = `
      <h1 id="travel-heading">Travel Log</h1>
      <div class="travel-header">
        <div>
          <p>A high-precision chronological record of your global movements and temporal residency status.</p>
        </div>
        <div class="segmented" role="group" aria-label="Period">
          <button type="button" id="seg-cal" class="${travelLogMode === 'calendar' ? 'is-active' : ''}">Calendar Year</button>
          <button type="button" id="seg-roll" class="${travelLogMode === 'rolling' ? 'is-active' : ''}">Rolling 365 Days</button>
        </div>
      </div>
      <div class="travel-summary">
        <article class="card summary-card--travel">
          <div class="summary-card__body">
            <p class="summary-card__metric">${countriesCount}</p>
            <h3 class="summary-card__title-line">Countries visited</h3>
          </div>
        </article>
        <article class="card summary-card--travel">
          <div class="summary-card__body">
            <p class="summary-card__metric">${abroadDays}</p>
            <h3 class="summary-card__title-line">Days Abroad</h3>
            <p class="summary-card__subtitle-line">Out of ${escapeHtml(ABROAD_ANCHOR_COUNTRY)}.</p>
          </div>
        </article>
        <article class="card summary-card--travel">
          <div class="summary-card__body">
            <p class="summary-card__place">${escapeHtml([cb.city, cb.country].filter(Boolean).join(', ') || '—')}</p>
            <h3 class="summary-card__title-line">Current location</h3>
            <p class="summary-card__subtitle-line summary-card__subtitle-line--meta">${daysSinceBaseStart()} days in country (since start) · continuous stay</p>
          </div>
        </article>
      </div>
      <div class="card">
        <div class="panel-head"><h2>Stays</h2></div>
        <div style="overflow-x:auto;margin-top:0.75rem">
          <table class="data-table">
            <thead><tr><th>Dates</th><th>Country</th><th>City</th><th>TZ</th><th>Days</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;

    $('seg-cal')?.addEventListener('click', () => {
      travelLogMode = 'calendar';
      renderTravelLog();
    });
    $('seg-roll')?.addEventListener('click', () => {
      travelLogMode = 'rolling';
      renderTravelLog();
    });
  }

  function renderWorldClocks() {
    if (!elClocks) return;
    const cb = config.currentBase || {};
    const tz = cb.timezone || 'Etc/UTC';
    const pri = (config.worldClocks && config.worldClocks.priority) || [];
    const us = (config.worldClocks && config.worldClocks.us) || [];

    const priHtml = pri
      .map((c, i) => {
        const id = `wc-p-${i}`;
        registerClock(id, () => {
          const el = $(id);
          if (el) el.textContent = formatTimeForZone(c.timezone, true);
        });
        return `<div class="sync-card">
          <p style="margin:0;font-size:0.65rem;letter-spacing:0.14em;text-transform:uppercase;color:var(--text-dim)">${escapeHtml(c.country || '')}</p>
          <p style="margin:0.25rem 0 0;font-weight:600">${escapeHtml(c.label)}</p>
          <p class="sync-card__time" id="${id}">—</p>
        </div>`;
      })
      .join('');

    const usHtml = us
      .map((c, i) => {
        const id = `wc-u-${i}`;
        registerClock(id, () => {
          const el = $(id);
          if (el) el.textContent = formatTimeForZone(c.timezone, true);
        });
        return `<div class="sync-card">
          <p style="margin:0;font-weight:600">${escapeHtml(c.label)}</p>
          <p class="sync-card__time" id="${id}">—</p>
        </div>`;
      })
      .join('');

    elClocks.innerHTML = `
      <div class="card clocks-hero">
        <p style="margin:0;font-size:0.65rem;letter-spacing:0.2em;text-transform:uppercase;color:var(--text-dim)">Current base</p>
        <p class="clocks-hero__place">${escapeHtml([cb.city, cb.country].filter(Boolean).join(', ') || '—')}</p>
        <div class="clocks-hero__clock"><span id="wc-hero">—</span></div>
        <p style="margin:0.5rem 0 0;font-size:0.85rem;color:var(--text-muted)">${escapeHtml(formatDateForZone(tz))}</p>
      </div>
      <div class="card" style="margin-top:1.25rem">
        <div class="panel-head"><h2>Global sync</h2></div>
        <div class="sync-grid" style="margin-top:1rem">${priHtml}</div>
      </div>
      <div class="card" style="margin-top:1.25rem">
        <div class="panel-head"><h2>United States</h2></div>
        <div class="sync-grid" style="margin-top:1rem">${usHtml}</div>
      </div>`;

    registerClock('wc-hero', () => {
      const el = $('wc-hero');
      if (el) el.textContent = formatTimeForZone(tz, true);
    });
    updateAllClocks();
  }

  async function renderWorldCountries() {
    if (!elWorld) return;
    if (typeof ChronosWorldMap === 'undefined') {
      elWorld.innerHTML = '<p class="world-map-view__error">Map module not loaded.</p>';
      return;
    }
    elWorld.innerHTML = '<p class="world-map-view__loading">Loading map…</p>';
    await ChronosWorldMap.mount(elWorld, config);
  }

  function setView(view) {
    const allowed = ['dashboard', 'travel', 'clocks', 'world'];
    if (!allowed.includes(view)) view = 'dashboard';

    try {
      localStorage.setItem(STORAGE_VIEW, view);
    } catch {
      /* ignore */
    }

    const views = {
      dashboard: $('view-dashboard'),
      travel: $('view-travel'),
      clocks: $('view-clocks'),
      world: $('view-world'),
    };

    for (const k of Object.keys(views)) {
      const sec = views[k];
      if (!sec) continue;
      const active = k === view;
      sec.classList.toggle('view--active', active);
      sec.setAttribute('aria-hidden', active ? 'false' : 'true');
    }

    document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
      const v = btn.getAttribute('data-view');
      btn.classList.toggle('is-active', v === view);
      btn.setAttribute('aria-current', v === view ? 'page' : 'false');
    });

    const titleEl = $('topbar-view-title');
    if (titleEl) titleEl.textContent = VIEW_TITLES[view] || 'Dashboard';

    clockHandlers.clear();
    registerCoreClocks();
    if (view === 'dashboard') renderDashboard();
    if (view === 'travel') renderTravelLog();
    if (view === 'clocks') renderWorldClocks();
    if (view === 'world') renderWorldCountries();
    updateAllClocks();
  }

  function wireNavigation() {
    document.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-view');
        if (v) setView(v);
        closeMobileMenu();
      });
    });
  }

  function closeMobileMenu() {
    const sidebar = $('sidebar');
    const backdrop = $('sidebar-backdrop');
    const menuBtn = $('btn-menu');
    if (sidebar) sidebar.classList.remove('is-open');
    if (backdrop) {
      backdrop.classList.remove('is-open');
      backdrop.hidden = true;
    }
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
  }

  function wireMobileMenu() {
    const sidebar = $('sidebar');
    const backdrop = $('sidebar-backdrop');
    const menuBtn = $('btn-menu');
    if (!sidebar || !menuBtn) return;
    menuBtn.addEventListener('click', () => {
      const open = !sidebar.classList.contains('is-open');
      sidebar.classList.toggle('is-open', open);
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (backdrop) {
        backdrop.hidden = !open;
        backdrop.classList.toggle('is-open', open);
      }
    });
    backdrop?.addEventListener('click', closeMobileMenu);
  }

  async function initApp() {
    elLoading = $('app-loading');
    elError = $('app-error');
    elRoot = $('app-root');
    elWarnings = $('config-warnings');
    elDashboard = $('dashboard-mount');
    elTravel = $('travel-mount');
    elClocks = $('clocks-mount');
    elWorld = $('world-mount');

    try {
      const raw = await loadConfig();
      config = mergeDefaults(raw);
      validateConfig();
    } catch {
      if (elLoading) elLoading.classList.add('hidden');
      if (elError) elError.classList.remove('hidden');
      return;
    }

    if (elLoading) elLoading.classList.add('hidden');
    if (elRoot) elRoot.classList.remove('hidden');

    applyBranding();
    renderConfigWarnings();
    wireNavigation();
    wireMobileMenu();

    let initial = (config.app && config.app.defaultView) || 'dashboard';
    try {
      const saved = localStorage.getItem(STORAGE_VIEW);
      if (saved === 'dashboard' || saved === 'travel' || saved === 'clocks' || saved === 'world') initial = saved;
    } catch {
      /* ignore */
    }

    startClockUpdates();
    setView(initial);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
