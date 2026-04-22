/**
 * CHRONOS GMT — config-driven dashboard + Countries map (TopoJSON / d3).
 * entryDate inclusive; exitDate exclusive (departure day not counted as full day).
 */
(function () {
  'use strict';

  const STORAGE_VIEW = 'chronos-gmt-view';
  const STORAGE_DASH_STAY_PERIOD = 'chronos-gmt-dashboard-stay-period';
  const STORAGE_FISCAL = 'chronos-gmt-fiscal-planner';
  const ABROAD_ANCHOR_COUNTRY = 'Spain';

  const VIEW_TITLES = {
    dashboard: 'Dashboard',
    travel: 'Travel Log',
    clocks: 'World Clocks',
    world: 'Countries',
    bookings: 'Bookings',
    fiscal: 'Fiscal Year',
  };

  let config = null;
  let validationWarnings = [];
  let travelLogMode = 'calendar';
  /** Dashboard Stay card: second metric — 'calendar' | 'rolling'. */
  let dashboardStayCountryDaysMode = 'calendar';
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
  let elBookings;
  let elFiscal;

  let fiscalState = null;

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

  /** Continuous days in the ongoing travel-log stay (prefers row matching current base country). */
  function daysConsecutiveCurrentStay() {
    const cb = config.currentBase || {};
    const baseCountry = cb.country ? String(cb.country).trim() : '';
    const ongoing = (config.travelLog || []).filter((s) => s && s.exitDate == null);
    let stay = null;
    if (baseCountry && ongoing.length) {
      stay = ongoing.find((s) => String(s.country || '').trim() === baseCountry) || null;
    }
    if (!stay && ongoing.length) stay = ongoing[ongoing.length - 1];
    if (stay) {
      const s = stayInclusiveStartMs(stay);
      if (!Number.isNaN(s)) {
        const today = parseYmdToUtcMs(todayUtcYmd());
        return Math.max(0, Math.floor((addUtcDaysMs(today, 1) - s) / 86400000));
      }
    }
    return daysSinceBaseStart();
  }

  function countryDaysCurrentBaseCountry(mode) {
    const country = (config.currentBase || {}).country;
    if (!country) return 0;
    const win = mode === 'rolling' ? rolling365Window() : currentCalendarYearWindow();
    const map = countryDaysInPeriod(config.travelLog || [], win.startMs, win.endExMs);
    return map[country] || 0;
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

  function isAlertUrgent(a) {
    const days = alertDaysUntil(a);
    return days !== null && days <= 10;
  }

  function tripDaysUntil(trip) {
    const departure = parseYmdToUtcMs(trip.departureDate);
    const today = parseYmdToUtcMs(todayUtcYmd());
    if (Number.isNaN(departure) || Number.isNaN(today)) return null;
    return Math.round((departure - today) / 86400000);
  }

  function formatAlertType(t) {
    const s = String(t || 'notice').replace(/_/g, ' ');
    if (!s) return 'Notice';
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
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
      upcomingTrips: Array.isArray(o.upcomingTrips) ? o.upcomingTrips : [],
      bookings: Array.isArray(o.bookings) ? o.bookings : [],
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
      const sidebar = $('sidebar');
      if (sidebar && sidebar.classList.contains('is-open')) closeMobileMenu();
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

    const stayConsec = daysConsecutiveCurrentStay();
    const countryDaysMetric = countryDaysCurrentBaseCountry(dashboardStayCountryDaysMode);
    const calYear = new Date().getUTCFullYear();
    const countryDaysLabel =
      dashboardStayCountryDaysMode === 'calendar'
        ? `In ${escapeHtml(cb.country || '—')} · ${calYear} (calendar year)`
        : `In ${escapeHtml(cb.country || '—')} · rolling 365 days`;

    const upcomingTripsArr = (config.upcomingTrips || []).filter((t) => {
      const days = tripDaysUntil(t);
      return days !== null && days >= 0;
    }).sort((a, b) => {
      const da = parseYmdToUtcMs(a.departureDate);
      const db = parseYmdToUtcMs(b.departureDate);
      return da - db;
    });

    const tripsHtml = upcomingTripsArr.slice(0, 2).map((t) => {
      const days = tripDaysUntil(t);
      const daysLabel = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days}d`;
      return `<div class="upcoming-trip">
        <p class="upcoming-trip__route">${escapeHtml(t.departureCity)} → ${escapeHtml(t.arrivalCity)}</p>
        <p class="upcoming-trip__when">${escapeHtml(t.departureDate)} ${escapeHtml(t.departureTime)} · ${daysLabel}</p>
        <p class="upcoming-trip__detail">${escapeHtml(t.airline)} ${escapeHtml(t.flightNumber)}</p>
      </div>`;
    }).join('');

    const combinedAlertAndTrips = [
      ...alertsSorted.map((a) => ({ type: 'alert', item: a, sortDate: alertSortDate(a) })),
      ...upcomingTripsArr.map((t) => ({ type: 'trip', item: t, sortDate: t.departureDate }))
    ].sort((a, b) => {
      const da = parseYmdToUtcMs(a.sortDate);
      const db = parseYmdToUtcMs(b.sortDate);
      return da - db;
    });

    const nextEntriesDash = combinedAlertAndTrips.slice(0, 3);
    const firstEntry = nextEntriesDash[0];
    const panelSeverityClass = firstEntry
      ? firstEntry.type === 'alert'
        ? alertSeverityClass(firstEntry.item.severity)
        : ''
      : '';

    const alertAndTripHtml = combinedAlertAndTrips.map((entry) => {
      if (entry.type === 'alert') {
        const a = entry.item;
        const place = [a.city, a.country].filter(Boolean).join(' · ');
        const sub = [formatAlertType(a.type), place].filter(Boolean).join(' · ');
        const urgentClass = isAlertUrgent(a) ? 'is-urgent' : '';
        return `<li class="alerts-queue__item ${alertSeverityClass(a.severity)} ${urgentClass}">
          <div>
            <p class="alerts-queue__title">${escapeHtml(a.title || 'Alert')}</p>
            <p class="alerts-queue__sub">${escapeHtml(sub)}</p>
          </div>
          <div>
            <p class="alerts-queue__when">${escapeHtml(alertSortDate(a))}</p>
            <p class="alerts-queue__countdown">${escapeHtml(alertCountdownLabel(alertDaysUntil(a)))}</p>
          </div>
        </li>`;
      } else {
        const t = entry.item;
        const days = tripDaysUntil(t);
        const daysLabel = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days}d`;
        return `<li class="alerts-queue__item is-trip">
          <div>
            <p class="alerts-queue__title">${escapeHtml(t.departureCity)} → ${escapeHtml(t.arrivalCity)}</p>
            <p class="alerts-queue__sub">${escapeHtml(t.airline)} ${escapeHtml(t.flightNumber)} · ${escapeHtml(t.duration)}</p>
          </div>
          <div>
            <p class="alerts-queue__when">${escapeHtml(t.departureDate)}</p>
            <p class="alerts-queue__countdown">${escapeHtml(daysLabel)}</p>
          </div>
        </li>`;
      }
    }).join('');

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
          ${
            upcomingTripsArr.length
              ? `<div style="margin-top:1rem;padding-top:1rem;border-top:1px solid rgba(255,255,255,.06)">${tripsHtml}</div>`
              : ''
          }
        </div>
        <div>
          <div class="card stay-card" style="margin-bottom:1rem">
            <div class="panel-head"><h2>Stay</h2></div>
            <div class="stay-metrics">
              <div class="stay-metrics__block">
                <p class="stay-metrics__value">${stayConsec}</p>
                <p class="stay-metrics__label">Consecutive days · this stay</p>
                <p class="stay-metrics__hint">From current travel-log segment (or base start date)</p>
              </div>
              <div class="stay-metrics__block">
                <p class="stay-metrics__value">${countryDaysMetric}</p>
                <p class="stay-metrics__label stay-metrics__label--period">${countryDaysLabel}</p>
                <div class="segmented stay-metrics__toggle" role="group" aria-label="Country days period">
                  <button type="button" id="dash-stay-cal" class="${dashboardStayCountryDaysMode === 'calendar' ? 'is-active' : ''}">Calendar year</button>
                  <button type="button" id="dash-stay-roll" class="${dashboardStayCountryDaysMode === 'rolling' ? 'is-active' : ''}">Rolling 365</button>
                </div>
              </div>
            </div>
          </div>
          <div class="card alert-feature ${panelSeverityClass}" id="alerts-panel">
            <div class="alert-feature__head">
              <div class="panel-head"><h2>Next alerts</h2></div>
              ${
                combinedAlertAndTrips.length > 0
                  ? `<span class="alert-feature__type">${combinedAlertAndTrips.length} total active</span>`
                  : ''
              }
            </div>
            ${
              nextEntriesDash.length
                ? `<ul class="alert-preview">${nextEntriesDash
                    .map((entry) => {
                      if (entry.type === 'alert') {
                        const a = entry.item;
                        const place = [a.city, a.country].filter(Boolean).join(' · ');
                        const urgentClass = isAlertUrgent(a) ? 'is-urgent' : '';
                        return `<li class="alert-preview__item ${alertSeverityClass(a.severity)} ${urgentClass}">
                      <div>
                        <p class="alert-preview__title">${escapeHtml(a.title || 'Alert')}</p>
                        <p class="alert-preview__meta">${escapeHtml(alertSortDate(a))} · ${escapeHtml(alertCountdownLabel(alertDaysUntil(a)))}</p>
                        ${place ? `<p class="alert-preview__where">${escapeHtml(place)}</p>` : ''}
                      </div>
                      <span class="alert-preview__type">${escapeHtml(formatAlertType(a.type))}</span>
                    </li>`;
                      }
                      const t = entry.item;
                      const days = tripDaysUntil(t);
                      const daysLabel = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days}d`;
                      const timePart = t.departureTime ? ` ${t.departureTime}` : '';
                      const detail = [t.airline, t.flightNumber].filter(Boolean).join(' ');
                      return `<li class="alert-preview__item is-trip">
                      <div>
                        <p class="alert-preview__title">${escapeHtml(t.departureCity)} → ${escapeHtml(t.arrivalCity)}</p>
                        <p class="alert-preview__meta">${escapeHtml(t.departureDate)}${escapeHtml(timePart)} · ${escapeHtml(daysLabel)}</p>
                        ${detail ? `<p class="alert-preview__where">${escapeHtml(detail)}</p>` : ''}
                      </div>
                      <span class="alert-preview__type">Flight</span>
                    </li>`;
                    })
                    .join('')}</ul>`
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
          combinedAlertAndTrips.length
            ? `<div class="alerts-queue-scroll"><ul class="alerts-queue">${alertAndTripHtml}</ul></div>`
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

  let dashboardStayPeriodWired = false;
  function wireDashboardStayPeriod() {
    if (dashboardStayPeriodWired || !elDashboard) return;
    dashboardStayPeriodWired = true;
    elDashboard.addEventListener('click', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.id === 'dash-stay-cal') {
        dashboardStayCountryDaysMode = 'calendar';
        try {
          localStorage.setItem(STORAGE_DASH_STAY_PERIOD, 'calendar');
        } catch {
          /* ignore */
        }
        if (config) renderDashboard();
      } else if (t.id === 'dash-stay-roll') {
        dashboardStayCountryDaysMode = 'rolling';
        try {
          localStorage.setItem(STORAGE_DASH_STAY_PERIOD, 'rolling');
        } catch {
          /* ignore */
        }
        if (config) renderDashboard();
      }
    });
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

  function bookingPrimaryMs(b) {
    const ms = parseYmdToUtcMs(b.startDate || b.date || b.checkIn || b.departureDate);
    return Number.isNaN(ms) ? 0 : ms;
  }

  function bookingEndMs(b) {
    const ms = parseYmdToUtcMs(b.endDate || b.checkOut || b.returnDate || b.startDate || b.date);
    return Number.isNaN(ms) ? bookingPrimaryMs(b) : ms;
  }

  function bookingIcon(type) {
    if (type === 'flight') {
      return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10.5 18.5 8 21l-1-.5.5-4L3 14l.5-1.5L8 13l4-5-8-4 .5-1.5L14 4l4.5-2c1 0 1.5.5 1.5 1.5L18 8l2 9.5-1.5.5-4-4.5-4 5Z"/></svg>`;
    }
    if (type === 'hotel') {
      return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 20V7h18v13"/><path d="M3 14h18"/><path d="M7 11h3"/><path d="M3 20h18"/></svg>`;
    }
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>`;
  }

  function formatBookingDate(ymd) {
    const ms = parseYmdToUtcMs(ymd);
    if (Number.isNaN(ms)) return escapeHtml(ymd || '');
    const d = new Date(ms);
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  function mapsLinkFor(b) {
    if (b && b.mapsUrl) return b.mapsUrl;
    const q = [b && b.address, b && b.city, b && b.country].filter(Boolean).join(', ');
    if (!q) return '';
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }

  function renderBookingDetailRows(b) {
    const rows = [];
    const push = (label, value) => {
      if (value == null || value === '') return;
      rows.push(`<div class="booking-field"><span class="booking-field__label">${escapeHtml(label)}</span><span class="booking-field__value">${value}</span></div>`);
    };

    if (b.type === 'flight') {
      push('Flight', escapeHtml([b.airline, b.flightNumber].filter(Boolean).join(' · ')));
      const dep = [b.departureAirport, b.departureCity].filter(Boolean).join(' · ');
      const arr = [b.arrivalAirport, b.arrivalCity].filter(Boolean).join(' · ');
      if (dep || b.departureTime) push('Departs', escapeHtml(`${dep}${b.departureTime ? ' @ ' + b.departureTime : ''}`));
      if (arr || b.arrivalTime) push('Arrives', escapeHtml(`${arr}${b.arrivalTime ? ' @ ' + b.arrivalTime : ''}`));
      if (b.duration) push('Duration', escapeHtml(b.duration));
      if (b.seat) push('Seat', escapeHtml(b.seat));
      if (b.confirmation) push('Confirmation', escapeHtml(b.confirmation));
    } else if (b.type === 'hotel') {
      if (b.checkIn || b.checkOut) {
        push('Stay', escapeHtml(`${b.checkIn || '…'} → ${b.checkOut || '…'}`));
      }
      if (b.checkInTime || b.checkOutTime) {
        push('Times', escapeHtml(`in ${b.checkInTime || '—'} · out ${b.checkOutTime || '—'}`));
      }
      if (b.confirmation) push('Confirmation', escapeHtml(b.confirmation));
      if (b.phone) push('Phone', escapeHtml(b.phone));
    } else {
      if (b.startDate || b.endDate) push('Dates', escapeHtml(`${b.startDate || '…'} → ${b.endDate || '…'}`));
      if (b.confirmation) push('Confirmation', escapeHtml(b.confirmation));
    }

    const addressPieces = [b.address, b.city, b.country].filter(Boolean).join(', ');
    if (addressPieces) {
      const href = mapsLinkFor(b);
      const inner = href
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(addressPieces)}</a>`
        : escapeHtml(addressPieces);
      push('Address', inner);
    } else if (b.mapsUrl) {
      push('Map', `<a href="${escapeHtml(b.mapsUrl)}" target="_blank" rel="noopener">Open in Google Maps</a>`);
    }

    if (b.url) {
      push('Link', `<a href="${escapeHtml(b.url)}" target="_blank" rel="noopener">Open booking</a>`);
    }

    return rows.join('');
  }

  function renderBookingCard(b) {
    const type = (b.type || 'other').toLowerCase();
    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
    const whenMs = bookingPrimaryMs(b);
    const whenText = whenMs ? formatBookingDate(b.startDate || b.date || b.checkIn || b.departureDate) : '';
    const today = parseYmdToUtcMs(todayUtcYmd());
    const endMs = bookingEndMs(b);
    const isPast = endMs && endMs < today;
    const daysOut = whenMs ? Math.round((whenMs - today) / 86400000) : null;
    let countdown = '';
    if (!isPast && daysOut !== null) {
      if (daysOut === 0) countdown = 'Today';
      else if (daysOut === 1) countdown = 'Tomorrow';
      else if (daysOut > 0) countdown = `in ${daysOut} days`;
    }
    const attachments = Array.isArray(b.attachments) ? b.attachments : [];
    const attachList = attachments
      .map((a) => {
        const path = typeof a === 'string' ? a : a.path;
        const name = typeof a === 'string' ? a.split('/').pop() : a.label || (a.path || '').split('/').pop();
        if (!path) return '';
        return `<li><a href="${escapeHtml(path)}" target="_blank" rel="noopener">${escapeHtml(name)}</a></li>`;
      })
      .filter(Boolean)
      .join('');

    return `
      <article class="booking-card booking-card--${escapeHtml(type)} ${isPast ? 'booking-card--past' : ''}">
        <header class="booking-card__head">
          <span class="booking-card__icon" aria-hidden="true">${bookingIcon(type)}</span>
          <div class="booking-card__heading">
            <p class="booking-card__type">${escapeHtml(typeLabel)}</p>
            <h3 class="booking-card__title">${escapeHtml(b.title || b.name || typeLabel)}</h3>
          </div>
          <div class="booking-card__when">
            ${whenText ? `<p class="booking-card__date">${escapeHtml(whenText)}</p>` : ''}
            ${countdown ? `<p class="booking-card__countdown">${escapeHtml(countdown)}</p>` : ''}
            ${isPast ? `<p class="booking-card__countdown booking-card__countdown--past">Past</p>` : ''}
          </div>
        </header>
        <div class="booking-card__body">
          ${renderBookingDetailRows(b)}
        </div>
        ${b.notes ? `<p class="booking-card__notes">${escapeHtml(b.notes)}</p>` : ''}
        ${attachList ? `<div class="booking-card__attachments"><p class="booking-card__attachments-label">Files</p><ul>${attachList}</ul></div>` : ''}
      </article>`;
  }

  function renderBookings() {
    if (!elBookings) return;
    const all = [...(config.bookings || [])];
    const today = parseYmdToUtcMs(todayUtcYmd());

    const upcoming = all
      .filter((b) => bookingEndMs(b) >= today)
      .sort((a, b) => bookingPrimaryMs(a) - bookingPrimaryMs(b));
    const past = all
      .filter((b) => bookingEndMs(b) < today)
      .sort((a, b) => bookingPrimaryMs(b) - bookingPrimaryMs(a));

    const emptyMsg = `<p class="booking-empty">No bookings saved yet. Send Claude a flight or hotel confirmation and it will be added here.</p>`;

    elBookings.innerHTML = `
      <h1 id="bookings-heading">Bookings</h1>
      <div class="travel-header">
        <div>
          <p>Stored reservations for upcoming trips — flights, hotels, and anything else worth remembering on the road.</p>
        </div>
      </div>

      <section class="bookings-section">
        <div class="bookings-section__head">
          <h2>Upcoming</h2>
          <span class="bookings-count">${upcoming.length}</span>
        </div>
        ${upcoming.length ? `<div class="bookings-grid">${upcoming.map(renderBookingCard).join('')}</div>` : emptyMsg}
      </section>

      ${past.length ? `
        <section class="bookings-section">
          <div class="bookings-section__head">
            <h2>Past</h2>
            <span class="bookings-count">${past.length}</span>
          </div>
          <div class="bookings-grid bookings-grid--past">${past.map(renderBookingCard).join('')}</div>
        </section>` : ''}
    `;
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

  function ymdFromMs(ms) {
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  const FISCAL_COUNTRY_PALETTE = [
    '#7ecbff',
    '#c8a2ff',
    '#ffcc7e',
    '#8fe0b5',
    '#ff9bc8',
    '#a0e8ff',
    '#ffb07e',
    '#e08fff',
    '#9bffd6',
  ];

  function fiscalCountryColor(country) {
    const s = String(country || '');
    let h = 0;
    for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
    return FISCAL_COUNTRY_PALETTE[Math.abs(h) % FISCAL_COUNTRY_PALETTE.length];
  }

  function defaultFiscalState() {
    const y = new Date().getUTCFullYear();
    return {
      yearStart: `${y}-01-01`,
      yearEnd: `${y}-12-31`,
      companyStart: '',
      useTravelLog: true,
      trips: [
        { id: 'tsum', label: 'Summer trip', start: `${y}-07-01`, days: 14 },
        { id: 'teoy', label: 'End of year trip', start: `${y}-12-15`, days: 14 },
      ],
    };
  }

  function loadFiscalState() {
    try {
      const raw = localStorage.getItem(STORAGE_FISCAL);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          typeof parsed === 'object' &&
          Array.isArray(parsed.trips) &&
          typeof parsed.yearStart === 'string' &&
          typeof parsed.yearEnd === 'string'
        ) {
          return {
            yearStart: parsed.yearStart,
            yearEnd: parsed.yearEnd,
            companyStart: typeof parsed.companyStart === 'string' ? parsed.companyStart : '',
            useTravelLog: parsed.useTravelLog !== false,
            trips: parsed.trips
              .filter((t) => t && typeof t === 'object')
              .map((t, i) => ({
                id: String(t.id || `t${i}-${Date.now().toString(36)}`),
                label: String(t.label || `Trip ${i + 1}`).slice(0, 60),
                start: String(t.start || parsed.yearStart),
                days: Math.max(1, Math.min(180, Number(t.days) || 14)),
              })),
          };
        }
      }
    } catch {
      /* ignore */
    }
    return defaultFiscalState();
  }

  function saveFiscalState() {
    try {
      localStorage.setItem(STORAGE_FISCAL, JSON.stringify(fiscalState));
    } catch {
      /* ignore */
    }
  }

  function buildFiscalMonthMarks(startMs, endExMs, span, valid) {
    const out = [];
    if (!valid || span <= 0) return out;
    const start = new Date(startMs);
    let y = start.getUTCFullYear();
    let m = start.getUTCMonth();
    const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const MONTH_FULL = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    while (true) {
      const monthStart = Date.UTC(y, m, 1);
      if (monthStart >= endExMs) break;
      const nextMonth = Date.UTC(y, m + 1, 1);
      const segStart = Math.max(monthStart, startMs);
      const segEnd = Math.min(nextMonth, endExMs);
      if (segEnd > segStart) {
        const leftPct = ((segStart - startMs) / span) * 100;
        const widthPct = ((segEnd - segStart) / span) * 100;
        out.push({
          year: y,
          month: m,
          leftPct,
          widthPct,
          name: MONTH_ABBR[m],
          fullLabel: `${MONTH_FULL[m]} ${y}`,
          isYearStart: m === 0 && monthStart > startMs,
        });
      }
      m += 1;
      if (m >= 12) {
        m = 0;
        y += 1;
      }
    }
    return out;
  }

  function mergeIntervals(intervals) {
    const sorted = intervals
      .filter((iv) => Number.isFinite(iv.start) && Number.isFinite(iv.endEx) && iv.endEx > iv.start)
      .sort((a, b) => a.start - b.start);
    const out = [];
    for (const iv of sorted) {
      if (!out.length || iv.start > out[out.length - 1].endEx) out.push({ ...iv });
      else out[out.length - 1].endEx = Math.max(out[out.length - 1].endEx, iv.endEx);
    }
    return out;
  }

  function buildLoggedAbroadSegments(startMs, endExMs, valid) {
    if (!valid) return [];
    const home = (homeCountry() || '').trim().toLowerCase();
    if (!home) return [];
    const todayExMs = addUtcDaysMs(parseYmdToUtcMs(todayUtcYmd()), 1);
    const out = [];
    for (const stay of config.travelLog || []) {
      if (!stay || !stay.country) continue;
      if (String(stay.country).trim().toLowerCase() === home) continue;
      const sMs = stayInclusiveStartMs(stay);
      const eExMs = stay.exitDate ? parseYmdToUtcMs(stay.exitDate) : todayExMs;
      if (!Number.isFinite(sMs) || !Number.isFinite(eExMs) || eExMs <= sMs) continue;
      const cs = Math.max(sMs, startMs);
      const ce = Math.min(eExMs, endExMs);
      if (ce <= cs) continue;
      out.push({
        country: stay.country,
        city: stay.city || '',
        start: cs,
        endEx: ce,
        days: Math.floor((ce - cs) / 86400000),
      });
    }
    return out;
  }

  function computeFiscal() {
    const startMs = parseYmdToUtcMs(fiscalState.yearStart);
    const endMs = parseYmdToUtcMs(fiscalState.yearEnd);
    const valid = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs;
    const endExMs = valid ? addUtcDaysMs(endMs, 1) : NaN;
    const totalDays = valid ? Math.floor((endExMs - startMs) / 86400000) : 0;
    const intervals = [];
    const loggedSegs = fiscalState.useTravelLog ? buildLoggedAbroadSegments(startMs, endExMs, valid) : [];
    if (fiscalState.useTravelLog) {
      for (const seg of loggedSegs) intervals.push({ start: seg.start, endEx: seg.endEx });
    }
    const tripsResolved = fiscalState.trips.map((t) => {
      const sMs = parseYmdToUtcMs(t.start);
      const days = Math.max(0, Math.min(365, Number(t.days) || 0));
      const tEndExMs = Number.isFinite(sMs) ? addUtcDaysMs(sMs, days) : NaN;
      const lastMs = Number.isFinite(tEndExMs) ? addUtcDaysMs(tEndExMs, -1) : NaN;
      let effective = 0;
      if (valid && Number.isFinite(sMs)) {
        const cs = Math.max(sMs, startMs);
        const ce = Math.min(tEndExMs, endExMs);
        if (ce > cs) {
          effective = Math.floor((ce - cs) / 86400000);
          intervals.push({ start: cs, endEx: ce });
        }
      }
      return {
        ...t,
        days,
        startMs: sMs,
        endExMs: tEndExMs,
        returnYmd: Number.isFinite(tEndExMs) ? ymdFromMs(tEndExMs) : '—',
        lastDayYmd: Number.isFinite(lastMs) ? ymdFromMs(lastMs) : '—',
        effective,
      };
    });
    const merged = mergeIntervals(intervals);
    let awayDays = 0;
    for (const iv of merged) awayDays += Math.floor((iv.endEx - iv.start) / 86400000);
    const inCountry = Math.max(0, totalDays - awayDays);
    const threshold = Math.ceil(totalDays / 2);

    const companyMs = parseYmdToUtcMs(fiscalState.companyStart);
    const companySet = Number.isFinite(companyMs);
    let projValid = false;
    let projStartMs = NaN;
    let projTotalDays = 0;
    let projAwayDays = 0;
    let projInCountry = 0;
    let projThreshold = 0;
    if (companySet && valid && companyMs < endExMs) {
      projStartMs = Math.max(companyMs, startMs);
      projTotalDays = Math.max(0, Math.floor((endExMs - projStartMs) / 86400000));
      const projIntervals = fiscalState.trips
        .map((t) => {
          const sMs = parseYmdToUtcMs(t.start);
          const d = Math.max(0, Math.min(365, Number(t.days) || 0));
          if (!Number.isFinite(sMs)) return null;
          const ivStart = Math.max(sMs, projStartMs);
          const ivEnd = Math.min(addUtcDaysMs(sMs, d), endExMs);
          if (ivEnd <= ivStart) return null;
          return { start: ivStart, endEx: ivEnd };
        })
        .filter(Boolean);
      if (fiscalState.useTravelLog) {
        for (const seg of loggedSegs) {
          const ivStart = Math.max(seg.start, projStartMs);
          const ivEnd = Math.min(seg.endEx, endExMs);
          if (ivEnd > ivStart) projIntervals.push({ start: ivStart, endEx: ivEnd });
        }
      }
      const merged = mergeIntervals(projIntervals);
      for (const iv of merged) projAwayDays += Math.floor((iv.endEx - iv.start) / 86400000);
      projInCountry = Math.max(0, projTotalDays - projAwayDays);
      projThreshold = Math.ceil(projTotalDays / 2);
      projValid = projTotalDays > 0;
    }

    return {
      valid,
      startMs,
      endExMs,
      totalDays,
      awayDays,
      inCountry,
      threshold,
      tripsResolved,
      loggedSegs,
      companySet,
      companyMs,
      projValid,
      projStartMs,
      projTotalDays,
      projAwayDays,
      projInCountry,
      projThreshold,
    };
  }

  function renderFiscal() {
    if (!elFiscal) return;
    if (!fiscalState) fiscalState = loadFiscalState();
    paintFiscal();
  }

  function paintFiscal() {
    const data = computeFiscal();
    const {
      valid,
      totalDays,
      awayDays,
      inCountry,
      threshold,
      tripsResolved,
      loggedSegs,
      startMs,
      endExMs,
      companySet,
      projValid,
      projTotalDays,
      projAwayDays,
      projInCountry,
      projThreshold,
    } = data;
    const projDiff = projInCountry - projThreshold;
    const projOk = projValid && projDiff >= 0;
    const projStatusLabel = !projValid
      ? companySet
        ? 'Company start is outside fiscal year'
        : ''
      : projOk
      ? `${projDiff} day${projDiff === 1 ? '' : 's'} above projected threshold`
      : `${Math.abs(projDiff)} day${Math.abs(projDiff) === 1 ? '' : 's'} short of projected threshold`;
    const projStatusCls = !projValid ? '' : projOk ? 'fiscal-status--ok' : 'fiscal-status--bad';
    const diff = inCountry - threshold;
    const ok = valid && diff >= 0;
    const statusLabel = !valid
      ? 'Set valid fiscal-year dates'
      : ok
      ? `${diff} day${diff === 1 ? '' : 's'} above threshold`
      : `${Math.abs(diff)} day${Math.abs(diff) === 1 ? '' : 's'} short`;
    const statusCls = !valid ? '' : ok ? 'fiscal-status--ok' : 'fiscal-status--bad';
    const home = homeCountry() || 'home country';

    const tripsHtml = fiscalState.trips
      .map((t) => {
        const r = tripsResolved.find((x) => x.id === t.id) || { lastDayYmd: '—', returnYmd: '—', effective: 0 };
        return `<div class="fiscal-trip" data-trip-id="${escapeHtml(t.id)}">
          <div class="fiscal-trip__head">
            <input type="text" class="fiscal-trip__name" value="${escapeHtml(t.label)}" data-field="label" aria-label="Trip name" maxlength="60" />
            <button type="button" class="fiscal-trip__remove" data-action="remove" title="Remove trip" aria-label="Remove trip">×</button>
          </div>
          <div class="fiscal-trip__controls">
            <label class="fiscal-trip__field">
              <span>Departure</span>
              <input type="date" value="${escapeHtml(t.start)}" data-field="start" />
            </label>
            <label class="fiscal-trip__field fiscal-trip__field--slider">
              <span class="fiscal-trip__slider-header">
                <span>Duration</span>
                <strong><span data-role="days-num">${t.days}</span> day${t.days === 1 ? '' : 's'}</strong>
              </span>
              <input type="range" min="1" max="180" step="1" value="${t.days}" data-field="days" class="wc-rail__slider fiscal-slider" />
            </label>
          </div>
          <p class="fiscal-trip__return">
            Away <strong>${escapeHtml(t.start)}</strong> → <strong data-role="last-day">${escapeHtml(r.lastDayYmd)}</strong> · return <strong data-role="return">${escapeHtml(r.returnYmd)}</strong> · <span data-role="effective">${r.effective}</span> day${r.effective === 1 ? '' : 's'} counted
          </p>
        </div>`;
      })
      .join('');

    const span = valid ? endExMs - startMs : 0;

    const loggedHtml = (loggedSegs || [])
      .map((seg) => {
        if (span <= 0) return '';
        const leftPct = ((seg.start - startMs) / span) * 100;
        const widthPct = ((seg.endEx - seg.start) / span) * 100;
        const color = fiscalCountryColor(seg.country);
        const title = `${seg.country}${seg.city ? ' · ' + seg.city : ''} · ${seg.days}d (travel log)`;
        return `<span class="fiscal-timeline__logged" style="left:${leftPct.toFixed(3)}%;width:${widthPct.toFixed(3)}%;--fiscal-c:${color}" title="${escapeHtml(title)}"></span>`;
      })
      .join('');

    const legendCountries = Array.from(
      new Map((loggedSegs || []).map((s) => [s.country, fiscalCountryColor(s.country)])).entries()
    );
    const legendHtml = legendCountries.length
      ? `<div class="fiscal-timeline__legend">
          <span class="fiscal-timeline__legend-item"><span class="fiscal-timeline__legend-swatch fiscal-timeline__legend-swatch--planned"></span>Planned trips</span>
          ${legendCountries
            .map(
              ([c, col]) =>
                `<span class="fiscal-timeline__legend-item"><span class="fiscal-timeline__legend-swatch" style="background:${col}"></span>${escapeHtml(c)}</span>`
            )
            .join('')}
        </div>`
      : '';

    const segments = tripsResolved
      .map((r) => {
        if (!valid || !Number.isFinite(r.startMs) || !Number.isFinite(r.endExMs)) return '';
        const cs = Math.max(r.startMs, startMs);
        const ce = Math.min(r.endExMs, endExMs);
        if (ce <= cs) return '';
        const leftPct = ((cs - startMs) / span) * 100;
        const widthPct = ((ce - cs) / span) * 100;
        return `<span class="fiscal-timeline__seg" style="left:${leftPct.toFixed(3)}%;width:${widthPct.toFixed(3)}%" title="${escapeHtml(r.label)} · ${r.effective}d"></span>`;
      })
      .join('');

    let anchorHtml = '';
    if (valid && companySet && data.companyMs >= startMs && data.companyMs <= endExMs) {
      const pct = ((data.companyMs - startMs) / span) * 100;
      anchorHtml = `<span class="fiscal-timeline__anchor" style="left:${pct.toFixed(3)}%" title="Company start · ${escapeHtml(fiscalState.companyStart)}"><span class="fiscal-timeline__anchor-flag">Company start</span></span>`;
    }

    const months = buildFiscalMonthMarks(startMs, endExMs, span, valid);

    const monthDividers = months
      .filter((m) => m.leftPct > 0.01)
      .map((m) => `<span class="fiscal-timeline__month-divider" style="left:${m.leftPct.toFixed(3)}%"></span>`)
      .join('');
    const monthLabels = months
      .map(
        (m) =>
          `<span class="fiscal-timeline__month-label" style="left:${(m.leftPct + m.widthPct / 2).toFixed(3)}%" title="${escapeHtml(m.fullLabel)}">${escapeHtml(m.name)}</span>`
      )
      .join('');
    const yearLabels = months
      .filter((m) => m.isYearStart)
      .map(
        (m) => `<span class="fiscal-timeline__year-label" style="left:${m.leftPct.toFixed(3)}%">${m.year}</span>`
      )
      .join('');

    elFiscal.innerHTML = `
      <h1 id="fiscal-heading">Fiscal Year Residency</h1>
      <div class="fiscal-header">
        <p>Plan trips abroad and see how many days you'd spend in ${escapeHtml(home)} this fiscal year. Tax residency typically requires more than half the year in country — drag the sliders to find a combination that keeps you above the line.</p>
        <div class="fiscal-year-range">
          <label class="fiscal-trip__field">
            <span>Fiscal year start</span>
            <input type="date" id="fiscal-year-start" value="${escapeHtml(fiscalState.yearStart)}" />
          </label>
          <label class="fiscal-trip__field">
            <span>Fiscal year end</span>
            <input type="date" id="fiscal-year-end" value="${escapeHtml(fiscalState.yearEnd)}" />
          </label>
          <label class="fiscal-trip__field">
            <span>Company start <em class="fiscal-trip__field-hint">(optional)</em></span>
            <input type="date" id="fiscal-company-start" value="${escapeHtml(fiscalState.companyStart || '')}" />
          </label>
          <label class="fiscal-trip__field fiscal-trip__field--toggle">
            <span>Account for travel log</span>
            <label class="fiscal-toggle">
              <input type="checkbox" id="fiscal-use-log" ${fiscalState.useTravelLog ? 'checked' : ''} />
              <span class="fiscal-toggle__track"><span class="fiscal-toggle__thumb"></span></span>
              <span class="fiscal-toggle__label">${fiscalState.useTravelLog ? 'On' : 'Off'}</span>
            </label>
          </label>
        </div>
      </div>
      <div class="travel-summary">
        <article class="card summary-card--travel fiscal-summary-card ${statusCls}">
          <div class="summary-card__body">
            <p class="summary-card__metric" data-metric="in">${inCountry}</p>
            <h3 class="summary-card__title-line">Days in ${escapeHtml(home)}</h3>
            <p class="summary-card__subtitle-line">Out of <span data-metric="total">${totalDays}</span> in fiscal year</p>
          </div>
        </article>
        <article class="card summary-card--travel">
          <div class="summary-card__body">
            <p class="summary-card__metric" data-metric="away">${awayDays}</p>
            <h3 class="summary-card__title-line">Days abroad</h3>
            <p class="summary-card__subtitle-line" data-metric="trip-count">${escapeHtml(
              fiscalState.useTravelLog
                ? `Travel log + ${fiscalState.trips.length} planned trip${fiscalState.trips.length === 1 ? '' : 's'}`
                : `${fiscalState.trips.length} planned trip${fiscalState.trips.length === 1 ? '' : 's'}`
            )}</p>
          </div>
        </article>
        <article class="card summary-card--travel fiscal-summary-card ${statusCls}">
          <div class="summary-card__body">
            <p class="summary-card__metric" data-metric="threshold">${threshold}</p>
            <h3 class="summary-card__title-line">Half-year threshold</h3>
            <p class="summary-card__subtitle-line" data-metric="status">${escapeHtml(statusLabel)}</p>
          </div>
        </article>
        <article class="card summary-card--travel fiscal-summary-card ${projStatusCls}" data-card="projection" ${companySet ? '' : 'hidden'}>
          <div class="summary-card__body">
            <p class="summary-card__metric" data-metric="proj-in">${projInCountry}</p>
            <h3 class="summary-card__title-line">Projected in-country from company start</h3>
            <p class="summary-card__subtitle-line">Out of <span data-metric="proj-total">${projTotalDays}</span> · threshold <span data-metric="proj-threshold">${projThreshold}</span></p>
            <p class="summary-card__subtitle-line" data-metric="proj-status">${escapeHtml(projStatusLabel)}</p>
          </div>
        </article>
      </div>
      <div class="card fiscal-timeline-card">
        <div class="panel-head"><h2>Fiscal timeline</h2></div>
        <p class="fiscal-timeline__hint">Red segments show time abroad within the fiscal-year window. Drag a trip slider or move its departure date — the bar reacts live.</p>
        <div class="fiscal-timeline">
          <div class="fiscal-timeline__bar" id="fiscal-timeline-bar">${monthDividers}${loggedHtml}${segments}${anchorHtml}</div>
          <div class="fiscal-timeline__months">${monthLabels}</div>
          <div class="fiscal-timeline__years">${yearLabels}</div>
          <div id="fiscal-timeline-legend">${legendHtml}</div>
        </div>
      </div>
      <div class="card fiscal-trips-card">
        <div class="fiscal-trips-head">
          <h2>Trips abroad</h2>
          <button type="button" class="wc-rail__reset" id="fiscal-add-trip">+ Add trip</button>
        </div>
        <div class="fiscal-trips" id="fiscal-trips-list">
          ${tripsHtml || '<p class="fiscal-trips__empty">No trips planned — you would stay in country the full fiscal year.</p>'}
        </div>
      </div>`;

    wireFiscalEvents();
  }

  function updateFiscalTripDerived(host, trip) {
    const sMs = parseYmdToUtcMs(trip.start);
    if (!Number.isFinite(sMs)) return;
    const returnMs = addUtcDaysMs(sMs, trip.days);
    const lastMs = addUtcDaysMs(returnMs, -1);
    const daysEl = host.querySelector('[data-role="days-num"]');
    if (daysEl) {
      daysEl.textContent = String(trip.days);
      const strong = daysEl.parentElement;
      if (strong) {
        const rest = strong.childNodes[1];
        if (rest && rest.nodeType === 3) rest.textContent = ` day${trip.days === 1 ? '' : 's'}`;
      }
    }
    const lastEl = host.querySelector('[data-role="last-day"]');
    if (lastEl) lastEl.textContent = ymdFromMs(lastMs);
    const retEl = host.querySelector('[data-role="return"]');
    if (retEl) retEl.textContent = ymdFromMs(returnMs);
  }

  function updateFiscalSummaryAndTimeline() {
    if (!elFiscal) return;
    const data = computeFiscal();
    const { valid, totalDays, awayDays, inCountry, threshold, tripsResolved, startMs, endExMs } = data;
    const diff = inCountry - threshold;
    const ok = valid && diff >= 0;
    const statusLabel = !valid
      ? 'Set valid fiscal-year dates'
      : ok
      ? `${diff} day${diff === 1 ? '' : 's'} above threshold`
      : `${Math.abs(diff)} day${Math.abs(diff) === 1 ? '' : 's'} short`;

    const setText = (sel, val) => {
      const e = elFiscal.querySelector(sel);
      if (e) e.textContent = val;
    };
    setText('[data-metric="in"]', String(inCountry));
    setText('[data-metric="away"]', String(awayDays));
    setText('[data-metric="total"]', String(totalDays));
    setText('[data-metric="threshold"]', String(threshold));
    setText('[data-metric="status"]', statusLabel);
    setText(
      '[data-metric="trip-count"]',
      fiscalState.useTravelLog
        ? `Travel log + ${fiscalState.trips.length} planned trip${fiscalState.trips.length === 1 ? '' : 's'}`
        : `${fiscalState.trips.length} planned trip${fiscalState.trips.length === 1 ? '' : 's'}`
    );
    const projDiff2 = data.projInCountry - data.projThreshold;
    const projOk2 = data.projValid && projDiff2 >= 0;
    const projStatusLabel2 = !data.projValid
      ? data.companySet
        ? 'Company start is outside fiscal year'
        : ''
      : projOk2
      ? `${projDiff2} day${projDiff2 === 1 ? '' : 's'} above projected threshold`
      : `${Math.abs(projDiff2)} day${Math.abs(projDiff2) === 1 ? '' : 's'} short of projected threshold`;
    setText('[data-metric="proj-in"]', String(data.projInCountry));
    setText('[data-metric="proj-total"]', String(data.projTotalDays));
    setText('[data-metric="proj-threshold"]', String(data.projThreshold));
    setText('[data-metric="proj-status"]', projStatusLabel2);
    const projCard = elFiscal.querySelector('[data-card="projection"]');
    if (projCard) {
      projCard.classList.toggle('fiscal-status--ok', projOk2);
      projCard.classList.toggle('fiscal-status--bad', data.projValid && !projOk2);
    }

    elFiscal.querySelectorAll('.fiscal-summary-card').forEach((card) => {
      card.classList.toggle('fiscal-status--ok', ok);
      card.classList.toggle('fiscal-status--bad', valid && !ok);
    });

    tripsResolved.forEach((r) => {
      const node = elFiscal.querySelector(`.fiscal-trip[data-trip-id="${CSS.escape(r.id)}"]`);
      if (!node) return;
      const eff = node.querySelector('[data-role="effective"]');
      if (eff) eff.textContent = String(r.effective);
    });

    const bar = $('fiscal-timeline-bar');
    const span = valid ? endExMs - startMs : 0;
    if (bar) {
      const months = buildFiscalMonthMarks(startMs, endExMs, span, valid);
      const dividers = months
        .filter((m) => m.leftPct > 0.01)
        .map((m) => `<span class="fiscal-timeline__month-divider" style="left:${m.leftPct.toFixed(3)}%"></span>`)
        .join('');
      const logged = (data.loggedSegs || [])
        .map((seg) => {
          if (span <= 0) return '';
          const leftPct = ((seg.start - startMs) / span) * 100;
          const widthPct = ((seg.endEx - seg.start) / span) * 100;
          const color = fiscalCountryColor(seg.country);
          const title = `${seg.country}${seg.city ? ' · ' + seg.city : ''} · ${seg.days}d (travel log)`;
          return `<span class="fiscal-timeline__logged" style="left:${leftPct.toFixed(3)}%;width:${widthPct.toFixed(3)}%;--fiscal-c:${color}" title="${escapeHtml(title)}"></span>`;
        })
        .join('');
      const segs = tripsResolved
        .map((r) => {
          if (!valid || !Number.isFinite(r.startMs) || !Number.isFinite(r.endExMs) || span <= 0) return '';
          const cs = Math.max(r.startMs, startMs);
          const ce = Math.min(r.endExMs, endExMs);
          if (ce <= cs) return '';
          const leftPct = ((cs - startMs) / span) * 100;
          const widthPct = ((ce - cs) / span) * 100;
          return `<span class="fiscal-timeline__seg" style="left:${leftPct.toFixed(3)}%;width:${widthPct.toFixed(3)}%" title="${escapeHtml(r.label)} · ${r.effective}d"></span>`;
        })
        .join('');
      let anchor = '';
      if (valid && data.companySet && data.companyMs >= startMs && data.companyMs <= endExMs && span > 0) {
        const pct = ((data.companyMs - startMs) / span) * 100;
        anchor = `<span class="fiscal-timeline__anchor" style="left:${pct.toFixed(3)}%" title="Company start · ${escapeHtml(fiscalState.companyStart)}"><span class="fiscal-timeline__anchor-flag">Company start</span></span>`;
      }
      bar.innerHTML = dividers + logged + segs + anchor;
    }
  }

  function openDatePicker(input) {
    if (!(input instanceof HTMLInputElement) || input.type !== 'date') return;
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker();
      } catch {
        input.focus();
      }
    } else {
      input.focus();
    }
  }

  function wireFiscalEvents() {
    $('fiscal-year-start')?.addEventListener('change', (e) => {
      fiscalState.yearStart = e.target.value;
      saveFiscalState();
      paintFiscal();
    });
    $('fiscal-year-end')?.addEventListener('change', (e) => {
      fiscalState.yearEnd = e.target.value;
      saveFiscalState();
      paintFiscal();
    });
    $('fiscal-company-start')?.addEventListener('change', (e) => {
      fiscalState.companyStart = e.target.value || '';
      saveFiscalState();
      paintFiscal();
    });
    $('fiscal-use-log')?.addEventListener('change', (e) => {
      fiscalState.useTravelLog = !!e.target.checked;
      saveFiscalState();
      paintFiscal();
    });

    elFiscal.querySelectorAll('input[type="date"]').forEach((input) => {
      input.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        openDatePicker(input);
      });
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openDatePicker(input);
        }
      });
      const label = input.closest('label');
      if (label) {
        label.addEventListener('mousedown', (ev) => {
          if (ev.target === input) return;
          ev.preventDefault();
          openDatePicker(input);
        });
      }
    });
    $('fiscal-add-trip')?.addEventListener('click', () => {
      const id = `t${Date.now().toString(36)}`;
      const todayYmd = todayUtcYmd();
      const within =
        parseYmdToUtcMs(todayYmd) >= parseYmdToUtcMs(fiscalState.yearStart) &&
        parseYmdToUtcMs(todayYmd) <= parseYmdToUtcMs(fiscalState.yearEnd);
      const start = within ? todayYmd : fiscalState.yearStart;
      fiscalState.trips.push({
        id,
        label: `Trip ${fiscalState.trips.length + 1}`,
        start,
        days: 14,
      });
      saveFiscalState();
      paintFiscal();
    });

    const list = $('fiscal-trips-list');
    if (!list) return;

    list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="remove"]');
      if (!btn) return;
      const host = btn.closest('.fiscal-trip');
      const id = host?.dataset.tripId;
      if (!id) return;
      fiscalState.trips = fiscalState.trips.filter((t) => t.id !== id);
      saveFiscalState();
      paintFiscal();
    });

    list.addEventListener('change', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const field = target.dataset.field;
      if (!field) return;
      const host = target.closest('.fiscal-trip');
      const id = host?.dataset.tripId;
      if (!id) return;
      const trip = fiscalState.trips.find((t) => t.id === id);
      if (!trip) return;
      if (field === 'label') {
        trip.label = String(target.value || '').slice(0, 60);
        saveFiscalState();
      } else if (field === 'start') {
        trip.start = target.value;
        saveFiscalState();
        paintFiscal();
      } else if (field === 'days') {
        saveFiscalState();
      }
    });

    list.addEventListener('input', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.dataset.field !== 'days') return;
      const host = target.closest('.fiscal-trip');
      const id = host?.dataset.tripId;
      if (!id) return;
      const trip = fiscalState.trips.find((t) => t.id === id);
      if (!trip) return;
      trip.days = Math.max(1, Math.min(180, Number(target.value) || 1));
      updateFiscalTripDerived(host, trip);
      updateFiscalSummaryAndTimeline();
    });
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
    const allowed = ['dashboard', 'travel', 'clocks', 'world', 'bookings', 'fiscal'];
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
      bookings: $('view-bookings'),
      fiscal: $('view-fiscal'),
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
    if (view === 'bookings') renderBookings();
    if (view === 'fiscal') renderFiscal();
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

  function wireSidebarCollapse() {
    const root = $('app-root');
    const btn = $('btn-sidebar-toggle');
    if (!root || !btn) return;
    const KEY = 'chronos-gmt-sidebar-collapsed';
    let collapsed = false;
    try {
      collapsed = localStorage.getItem(KEY) === '1';
    } catch {
      /* ignore */
    }
    const apply = () => {
      root.classList.toggle('sidebar-collapsed', collapsed);
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    };
    apply();
    btn.addEventListener('click', () => {
      collapsed = !collapsed;
      apply();
      try {
        localStorage.setItem(KEY, collapsed ? '1' : '0');
      } catch {
        /* ignore */
      }
    });
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
      if (open) {
        const pop = $('alerts-popover');
        const alertsBtn = $('btn-alerts');
        if (pop && !pop.classList.contains('hidden')) {
          pop.classList.add('hidden');
          alertsBtn?.setAttribute('aria-expanded', 'false');
        }
      }
    });
    backdrop?.addEventListener('click', closeMobileMenu);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sidebar.classList.contains('is-open')) closeMobileMenu();
    });
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
    elBookings = $('bookings-mount');
    elFiscal = $('fiscal-mount');

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
    wireSidebarCollapse();
    wireAlertsPopover();
    refreshAlertsChrome();

    let initial = (config.app && config.app.defaultView) || 'dashboard';
    try {
      const saved = localStorage.getItem(STORAGE_VIEW);
      if (saved === 'dashboard' || saved === 'travel' || saved === 'clocks' || saved === 'world' || saved === 'bookings' || saved === 'fiscal') initial = saved;
    } catch {
      /* ignore */
    }
    try {
      const sp = localStorage.getItem(STORAGE_DASH_STAY_PERIOD);
      if (sp === 'rolling' || sp === 'calendar') dashboardStayCountryDaysMode = sp;
    } catch {
      /* ignore */
    }

    wireDashboardStayPeriod();
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
