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
  /** Offset from system time in ms; World Clocks view only — drives slider + all zone readouts. */
  let worldClocksShiftMs = 0;

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

  function initNodeGridBackground() {
    const canvas = $('bg-node-grid');
    if (!canvas) return;
    const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mqReduce.matches) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const spacing = 52;
    let w = 0;
    let h = 0;
    let cols = 0;
    let rows = 0;
    let mx = -9999;
    let my = -9999;
    let pointerEnergy = 0;
    const pulsars = [];

    function seedPulsars() {
      pulsars.length = 0;
      const n = Math.min(12, Math.max(4, Math.floor((w * h) / 140000)));
      for (let i = 0; i < n; i += 1) {
        pulsars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          phase: Math.random() * Math.PI * 2,
          period: 2.8 + Math.random() * 3.6,
        });
      }
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / spacing) + 2;
      rows = Math.ceil(h / spacing) + 2;
      seedPulsars();
    }

    function onMove(e) {
      mx = e.clientX;
      my = e.clientY;
      pointerEnergy = Math.min(1, pointerEnergy + 0.12);
    }

    function onLeave() {
      mx = -9999;
      my = -9999;
    }

    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('mousemove', onMove, { passive: true });
    document.body.addEventListener('mouseleave', onLeave);

    let raf = 0;
    function frame(now) {
      if (mqReduce.matches) return;
      pointerEnergy *= 0.982;
      const t = now * 0.001;

      ctx.clearRect(0, 0, w, h);

      ctx.strokeStyle = 'rgba(130, 155, 175, 0.045)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= w; x += spacing) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = 0; y <= h; y += spacing) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();

      for (let gy = 0; gy < rows; gy += 1) {
        for (let gx = 0; gx < cols; gx += 1) {
          const stagger = (gy % 2) * (spacing * 0.5);
          const x = gx * spacing + stagger - spacing;
          const y = gy * spacing - spacing;
          if (x < -spacing || y < -spacing || x > w + spacing || y > h + spacing) continue;
          const dx = x - mx;
          const dy = y - my;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const near = dist < 220 ? (1 - dist / 220) * pointerEnergy : 0;
          const pulse = 0.5 + 0.5 * Math.sin(t * 0.85 + gx * 0.14 + gy * 0.11);
          const a = 0.055 + pulse * 0.09 + near * 0.38;
          ctx.fillStyle = `rgba(165, 198, 222, ${Math.min(0.52, a)})`;
          ctx.beginPath();
          ctx.arc(x, y, 0.9 + near * 2.8 + pulse * 0.45, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      for (const p of pulsars) {
        const u = ((t + p.phase) % p.period) / p.period;
        const r = 18 + u * 92;
        const alpha = (1 - u) * 0.11;
        ctx.strokeStyle = `rgba(145, 188, 218, ${alpha})`;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      raf = window.requestAnimationFrame(frame);
    }

    const onReduce = () => {
      if (mqReduce.matches) window.cancelAnimationFrame(raf);
    };
    mqReduce.addEventListener('change', onReduce);

    resize();
    raf = window.requestAnimationFrame(frame);
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

  function worldClocksNow() {
    return new Date(Date.now() + worldClocksShiftMs);
  }

  function formatShiftLabel(ms) {
    if (ms === 0) return 'Live';
    const sign = ms > 0 ? '+' : '−';
    const abs = Math.abs(ms);
    const h = Math.floor(abs / 3600000);
    const m = Math.round((abs % 3600000) / 60000);
    if (h === 0 && m === 0) return 'Live';
    if (m === 0) return `${sign}${h}h`;
    if (h === 0) return `${sign}${m}m`;
    return `${sign}${h}h ${m}m`;
  }

  function localHourFraction(tz, atDate) {
    try {
      const d = atDate instanceof Date ? atDate : new Date();
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(d);
      let h = 0;
      let m = 0;
      for (const p of parts) {
        if (p.type === 'hour') h = Number(p.value);
        if (p.type === 'minute') m = Number(p.value);
      }
      return ((h + m / 60) % 24 + 24) % 24;
    } catch {
      return 0;
    }
  }

  function formatTimeForZone(tz, withSeconds, atDate) {
    try {
      const opts = { hour: '2-digit', minute: '2-digit', hour12: false };
      if (withSeconds) opts.second = '2-digit';
      const d = atDate instanceof Date ? atDate : new Date();
      return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: tz }).format(d);
    } catch {
      return '—';
    }
  }

  function formatDateForZone(tz, atDate) {
    try {
      const d = atDate instanceof Date ? atDate : new Date();
      return new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: tz,
      }).format(d);
    } catch {
      return '—';
    }
  }

  function getUtcOffsetLabel(tz, atDate) {
    try {
      const d = atDate instanceof Date ? atDate : new Date();
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        timeZoneName: 'longOffset',
      }).formatToParts(d);
      const p = parts.find((x) => x.type === 'timeZoneName');
      return p ? p.value.replace('GMT', 'UTC') : '';
    } catch {
      return '';
    }
  }

  function alertSortDate(a) {
    return a.expiresDate || a.date || a.startDate || '';
  }

  function getVisibleAlerts() {
    return (config.alerts || []).filter((a) => {
      if (!a || a.isActive === false) return false;
      const raw = alertSortDate(a);
      if (!raw || String(raw).trim() === '') return false;
      return !Number.isNaN(parseYmdToUtcMs(raw));
    });
  }

  function getVisibleAlertsSorted() {
    return [...getVisibleAlerts()].sort((a, b) => {
      const da = parseYmdToUtcMs(alertSortDate(a));
      const db = parseYmdToUtcMs(alertSortDate(b));
      return da - db;
    });
  }

  function alertDaysUntil(a) {
    const event = parseYmdToUtcMs(alertSortDate(a));
    const today = parseYmdToUtcMs(todayUtcYmd());
    if (Number.isNaN(event) || Number.isNaN(today)) return null;
    return Math.round((event - today) / 86400000);
  }

  function alertCountdownLabel(days) {
    if (days === null) return '';
    if (days < 0) return `${Math.abs(days)}d overdue`;
    if (days === 0) return 'Due today';
    if (days === 1) return '1 day left';
    return `${days} days left`;
  }

  function alertSeverityClass(sev) {
    const s = String(sev || '').toLowerCase();
    if (s === 'high') return 'alert-severity--high';
    if (s === 'low') return 'alert-severity--low';
    return 'alert-severity--medium';
  }

  function formatAlertType(t) {
    const s = String(t || 'notice').replace(/_/g, ' ');
    if (!s) return 'Notice';
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }

  function getNearestAlert() {
    const sorted = getVisibleAlertsSorted();
    if (!sorted.length) return null;
    const today = parseYmdToUtcMs(todayUtcYmd());
    const upcoming = sorted.find((a) => parseYmdToUtcMs(alertSortDate(a)) >= today);
    return upcoming || sorted[sorted.length - 1];
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

  function refreshAlertsChrome() {
    const badge = $('alerts-badge');
    const body = $('alerts-popover-body');
    if (!config) {
      if (badge) {
        badge.textContent = '';
        badge.classList.add('hidden');
      }
      if (body) body.innerHTML = '<p class="alerts-popover__empty">No configuration loaded.</p>';
      return;
    }
    const sorted = getVisibleAlertsSorted();
    if (badge) {
      badge.textContent = String(sorted.length);
      badge.classList.toggle('hidden', sorted.length === 0);
    }
    if (body) {
      if (!sorted.length) {
        body.innerHTML = '<p class="alerts-popover__empty">No active alerts.</p>';
      } else {
        const rows = sorted.slice(0, 8).map((a) => {
          const days = alertDaysUntil(a);
          const sev = alertSeverityClass(a.severity);
          return `<article class="alerts-popover__row ${sev}" role="button" tabindex="0" data-alert-id="${escapeHtml(a.id || '')}">
            <p class="alerts-popover__row-title">${escapeHtml(a.title || 'Alert')}</p>
            <p class="alerts-popover__row-meta">${escapeHtml(alertSortDate(a))} · ${escapeHtml(alertCountdownLabel(days))}</p>
          </article>`;
        });
        let html = rows.join('');
        if (sorted.length > 8) {
          html += `<p class="alerts-popover__more">+${sorted.length - 8} more on Dashboard</p>`;
        }
        body.innerHTML = html;
      }
    }
  }

  let alertsPopoverWired = false;
  function wireAlertsPopover() {
    if (alertsPopoverWired) return;
    alertsPopoverWired = true;
    const btn = $('btn-alerts');
    const pop = $('alerts-popover');
    const closeBtn = $('alerts-popover-close');
    const goDash = $('alerts-go-dashboard');
    const wrap = document.querySelector('.alerts-trigger-wrap');
    if (!btn || !pop) return;

    function closeAlertsPopover() {
      pop.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
    }

    function openAlertsPopover() {
      refreshAlertsChrome();
      pop.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
    }

    function toggleAlertsPopover() {
      if (pop.classList.contains('hidden')) openAlertsPopover();
      else closeAlertsPopover();
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleAlertsPopover();
    });
    closeBtn?.addEventListener('click', closeAlertsPopover);
    goDash?.addEventListener('click', () => {
      closeAlertsPopover();
      setView('dashboard');
      requestAnimationFrame(() => {
        $('alerts-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });

    document.addEventListener('click', (e) => {
      if (pop.classList.contains('hidden')) return;
      if (wrap && !wrap.contains(e.target)) closeAlertsPopover();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAlertsPopover();
    });

    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleAlertsPopover();
      }
    });

    const popBody = $('alerts-popover-body');
    if (popBody && !popBody.dataset.delegateAlerts) {
      popBody.dataset.delegateAlerts = '1';
      popBody.addEventListener('click', (e) => {
        const row = e.target.closest('.alerts-popover__row');
        if (!row) return;
        closeAlertsPopover();
        setView('dashboard');
        requestAnimationFrame(() => $('alerts-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
      });
      popBody.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const row = e.target.closest('.alerts-popover__row');
        if (!row) return;
        e.preventDefault();
        closeAlertsPopover();
        setView('dashboard');
        requestAnimationFrame(() => $('alerts-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
      });
    }
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
    const alertsSorted = getVisibleAlertsSorted();
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
          <div class="card alert-feature ${nearest ? alertSeverityClass(nearest.severity) : ''}" id="alerts-panel">
            <div class="alert-feature__head">
              <div class="panel-head"><h2>Nearest alert</h2></div>
              ${nearest ? `<span class="alert-feature__type">${escapeHtml(formatAlertType(nearest.type))}</span>` : ''}
            </div>
            ${
              nearest
                ? `<p class="alert-feature__title">${escapeHtml(nearest.title || 'Alert')}</p>
            <p class="alert-feature__meta">${escapeHtml(alertSortDate(nearest))} · ${escapeHtml(alertCountdownLabel(alertDaysUntil(nearest)))}</p>
            ${
              [nearest.city, nearest.country].filter(Boolean).length
                ? `<p class="alert-feature__where">${escapeHtml([nearest.city, nearest.country].filter(Boolean).join(' · '))}</p>`
                : ''
            }
            ${nearest.notes ? `<p class="alert-feature__notes">${escapeHtml(nearest.notes)}</p>` : ''}`
                : '<p class="alert-feature__empty">No scheduled alerts in config.</p>'
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
      </div>
      <div class="card" style="margin-top:1.25rem">
        <div class="panel-head" style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap">
          <h2>All active alerts</h2>
          <span style="font-size:0.72rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim)">${alertsSorted.length} total</span>
        </div>
        ${
          alertsSorted.length
            ? `<ul class="alerts-queue">${alertsSorted
                .map((a) => {
                  const place = [a.city, a.country].filter(Boolean).join(' · ');
                  const sub = [formatAlertType(a.type), place].filter(Boolean).join(' · ');
                  return `<li class="alerts-queue__item ${alertSeverityClass(a.severity)}">
                    <div>
                      <p class="alerts-queue__title">${escapeHtml(a.title || 'Alert')}</p>
                      <p class="alerts-queue__sub">${escapeHtml(sub)}</p>
                    </div>
                    <div>
                      <p class="alerts-queue__when">${escapeHtml(alertSortDate(a))}</p>
                      <p class="alerts-queue__countdown">${escapeHtml(alertCountdownLabel(alertDaysUntil(a)))}</p>
                    </div>
                  </li>`;
                })
                .join('')}</ul>`
            : '<p style="margin:0.75rem 0 0;color:var(--text-dim)">No active alerts. Add objects under <code style="font-size:0.85em">alerts</code> in <code style="font-size:0.85em">config.json</code>.</p>'
        }
      </div>
      <div class="dashboard-metrics" role="region" aria-label="Summary metrics">
        <div class="dashboard-metrics__cell">
          <span class="dashboard-metrics__value">${alertsSorted.length}</span>
          <span class="dashboard-metrics__label">Active alerts</span>
        </div>
        <div class="dashboard-metrics__cell">
          <span class="dashboard-metrics__value">${Object.keys(totals).filter((k) => totals[k] > 0).length}</span>
          <span class="dashboard-metrics__label">Countries YTD</span>
        </div>
        <div class="dashboard-metrics__cell">
          <span class="dashboard-metrics__value">${(config.travelLog || []).length}</span>
          <span class="dashboard-metrics__label">Stays logged</span>
        </div>
        <div class="dashboard-metrics__cell">
          <span class="dashboard-metrics__value">${escapeHtml((tz.split('/').pop() || tz).replace(/_/g, ' '))}</span>
          <span class="dashboard-metrics__label">Base timezone</span>
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

  function paintWcRail() {
    const track = $('wc-rail-track');
    if (!track || !config) return;
    const ref = worldClocksNow();
    const cb = config.currentBase || {};
    const pri = (config.worldClocks && config.worldClocks.priority) || [];
    const us = (config.worldClocks && config.worldClocks.us) || [];
    const zones = new Map();
    function addZone(tz, label, isBase) {
      if (!tz) return;
      if (!zones.has(tz)) zones.set(tz, { labels: [], isBase: false });
      const z = zones.get(tz);
      if (label) z.labels.push(label);
      if (isBase) z.isBase = true;
    }
    const baseLabel = [cb.city, 'Base'].filter(Boolean).join(' · ') || 'Base';
    addZone(cb.timezone, baseLabel, true);
    pri.forEach((c) => addZone(c.timezone, c.label, false));
    us.forEach((c) => addZone(c.timezone, c.label, false));

    const parts = [];
    zones.forEach((meta, tz) => {
      const frac = localHourFraction(tz, ref);
      const pct = (frac / 24) * 100;
      const timeStr = formatTimeForZone(tz, false, ref);
      const title = `${meta.labels.join(' · ')} — ${timeStr}`;
      const cls = meta.isBase ? 'wc-rail__marker wc-rail__marker--base' : 'wc-rail__marker';
      parts.push(
        `<span class="${cls}" style="left:${pct.toFixed(3)}%" title="${escapeHtml(title)}"></span>`
      );
    });
    track.innerHTML = parts.join('');
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
          if (el) el.textContent = formatTimeForZone(c.timezone, true, worldClocksNow());
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
          if (el) el.textContent = formatTimeForZone(c.timezone, true, worldClocksNow());
        });
        return `<div class="sync-card">
          <p style="margin:0;font-weight:600">${escapeHtml(c.label)}</p>
          <p class="sync-card__time" id="${id}">—</p>
        </div>`;
      })
      .join('');

    let shiftMin = Math.round(worldClocksShiftMs / 60000);
    shiftMin = Math.round(shiftMin / 15) * 15;
    shiftMin = Math.max(-720, Math.min(720, shiftMin));
    worldClocksShiftMs = shiftMin * 60000;

    elClocks.innerHTML = `
      <div class="card clocks-hero">
        <p style="margin:0;font-size:0.65rem;letter-spacing:0.2em;text-transform:uppercase;color:var(--text-dim)">Current base</p>
        <p class="clocks-hero__place">${escapeHtml([cb.city, cb.country].filter(Boolean).join(', ') || '—')}</p>
        <div class="clocks-hero__clock"><span id="wc-hero">—</span></div>
        <p style="margin:0.5rem 0 0;font-size:0.85rem;color:var(--text-muted)">
          <span id="wc-hero-date">—</span> · <span id="wc-hero-offset">—</span>
        </p>
      </div>
      <div class="card" style="margin-top:1.25rem">
        <div class="panel-head"><h2>Global sync</h2></div>
        <div class="sync-grid" style="margin-top:1rem">${priHtml}</div>
      </div>
      <div class="card" style="margin-top:1.25rem">
        <div class="panel-head"><h2>United States</h2></div>
        <div class="sync-grid" style="margin-top:1rem">${usHtml}</div>
      </div>
      <div class="card wc-rail-card" style="margin-top:1.25rem">
        <div class="wc-rail__head">
          <h2 class="wc-rail__title">24h comparison rail</h2>
          <button type="button" class="wc-rail__reset" id="wc-time-reset">Reset</button>
        </div>
        <p class="wc-rail__hint">Marker position is local time of day in each zone (hover for label). Use the slider to shift the whole timeline for meeting planning.</p>
        <div class="wc-rail__track-wrap">
          <div class="wc-rail__track" id="wc-rail-track" role="presentation"></div>
          <div class="wc-rail__ticks" aria-hidden="true">
            <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
          </div>
        </div>
        <div class="wc-rail__shift">
          <label class="wc-rail__shift-label" for="wc-time-shift">Timeline shift</label>
          <div class="wc-rail__shift-row">
            <input
              type="range"
              id="wc-time-shift"
              class="wc-rail__slider"
              min="-720"
              max="720"
              step="15"
              value="${shiftMin}"
              aria-valuemin="-720"
              aria-valuemax="720"
              aria-valuenow="${shiftMin}"
              aria-valuetext="${escapeHtml(formatShiftLabel(worldClocksShiftMs))}"
            />
            <output class="wc-rail__shift-readout" id="wc-shift-label" for="wc-time-shift">${escapeHtml(formatShiftLabel(worldClocksShiftMs))}</output>
          </div>
        </div>
      </div>`;

    registerClock('wc-hero', () => {
      const el = $('wc-hero');
      const ref = worldClocksNow();
      if (el) el.textContent = formatTimeForZone(tz, true, ref);
    });
    registerClock('wc-hero-meta', () => {
      const ref = worldClocksNow();
      const dEl = $('wc-hero-date');
      const oEl = $('wc-hero-offset');
      if (dEl) dEl.textContent = formatDateForZone(tz, ref);
      if (oEl) oEl.textContent = getUtcOffsetLabel(tz, ref);
    });
    registerClock('wc-rail', paintWcRail);

    const slider = $('wc-time-shift');
    const shiftReadout = $('wc-shift-label');
    function syncShiftAria() {
      if (!slider) return;
      const v = Number(slider.value);
      slider.setAttribute('aria-valuenow', String(v));
      slider.setAttribute('aria-valuetext', formatShiftLabel(v * 60000));
    }
    function onShiftInput() {
      if (!slider) return;
      worldClocksShiftMs = Number(slider.value) * 60000;
      if (shiftReadout) shiftReadout.textContent = formatShiftLabel(worldClocksShiftMs);
      syncShiftAria();
      updateAllClocks();
    }
    slider?.addEventListener('input', onShiftInput);
    $('wc-time-reset')?.addEventListener('click', () => {
      worldClocksShiftMs = 0;
      if (slider) slider.value = '0';
      if (shiftReadout) shiftReadout.textContent = formatShiftLabel(0);
      syncShiftAria();
      updateAllClocks();
    });
    syncShiftAria();

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
    refreshAlertsChrome();
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
    wireAlertsPopover();
    refreshAlertsChrome();

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

  function boot() {
    initNodeGridBackground();
    initApp();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
