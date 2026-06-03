/**
 * CHRONOS GMT — config-driven dashboard + Countries map (TopoJSON / d3).
 * entryDate inclusive; exitDate exclusive (departure day not counted as full day).
 */
(function () {
  'use strict';

  const STORAGE_VIEW = 'chronos-gmt-view';
  const STORAGE_DASH_STAY_PERIOD = 'chronos-gmt-dashboard-stay-period';
  const STORAGE_FISCAL = 'chronos-gmt-fiscal-planner';
  const STORAGE_TODOS_COLLAPSED = 'chronos-gmt-todos-collapsed';
  const STORAGE_TODOS_VIEW = 'chronos-gmt-todos-view';
  const STORAGE_TODOS_ARCHIVE_OPEN = 'chronos-gmt-todos-archive-open';
  const ABROAD_ANCHOR_COUNTRY = 'Spain';

  /** Kanban stages, in column order. 'done' mirrors the task `done` flag. */
  const TODO_STATUSES = [
    { key: 'todo', label: 'To Do' },
    { key: 'in-progress', label: 'In Progress' },
    { key: 'waiting', label: 'Waiting For' },
    { key: 'done', label: 'Completed' },
  ];
  const TODO_STATUS_KEYS = TODO_STATUSES.map((s) => s.key);

  const VIEW_TITLES = {
    dashboard: 'Dashboard',
    travel: 'Travel Log',
    clocks: 'World Clocks',
    world: 'Countries',
    bookings: 'Bookings',
    renewals: 'Renewals',
    fiscal: 'Year plan',
    schedule: 'Schedule',
    todos: 'To-Do',
    fitness: 'Fitness',
    birthdays: 'Birthdays',
    'language-audio': 'Language Audio',
  };

  const TODOS_STATUS_LABEL = {
    idle: '',
    loading: 'Loading…',
    saving: 'Saving…',
    saved: 'All changes synced',
    error: 'Offline — changes not saved to the cloud',
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
  let elRenewals;
  let elFiscal;
  let elSchedule;
  let elTodos;
  let elFitness;
  let elBirthdays;
  let elLanguageAudio;

  /** Birthday data — config seeded, editable through /api/birthdays when deployed. */
  let birthdayItems = [];
  let birthdaysLoaded = false;
  let birthdaysLoading = false;
  let birthdaysSyncState = 'idle';

  /** Fitness dashboard data (fitness.json, generated from the Mars OS vault). */
  let fitnessData = null;
  let fitnessLoading = false;
  let fitnessError = false;

  let fiscalState = null;
  let fiscalWrap = null;
  /** Fiscal planner cloud sync (mirrors the to-do list). */
  let fiscalLoadedFromCloud = false;
  let fiscalSyncState = 'idle';
  let fiscalSaveTimer = null;

  /** To-Do list state — synced to the /api/todos backend (Workers KV). */
  let todoItems = [];
  /** Tasks moved out of the active list; never feed alerts/Kanban. */
  let todosArchived = [];
  let todosLoaded = false;
  let todosLoading = false;
  let todosSyncState = 'idle';
  /** Live SortableJS instances (active list, each subtask list, each Kanban column). */
  let todosSortables = [];
  let todosEditingId = null;
  /** Per-device set of collapsed task ids (subtasks hidden). */
  let todosCollapsed = null;
  /** Transient set of task ids whose add-subtask field is open. */
  const todosSubaddOpen = new Set();
  /** Per-device view: 'list' | 'kanban'. */
  let todosViewMode = null;
  /** Per-device: is the archive drawer expanded. */
  let todosArchiveOpen = null;

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

  const COUNTRY_TIMEZONES = {
    Indonesia: 'Asia/Makassar',
    Singapore: 'Asia/Singapore',
    Malaysia: 'Asia/Kuala_Lumpur',
    Thailand: 'Asia/Bangkok',
    India: 'Asia/Kolkata',
    Greece: 'Europe/Athens',
    Spain: 'Europe/Madrid',
  };

  const COUNTRY_FLAGS = {
    Argentina: '🇦🇷',
    Australia: '🇦🇺',
    Austria: '🇦🇹',
    Belgium: '🇧🇪',
    Brazil: '🇧🇷',
    Cambodia: '🇰🇭',
    Canada: '🇨🇦',
    Chile: '🇨🇱',
    China: '🇨🇳',
    Colombia: '🇨🇴',
    'Costa Rica': '🇨🇷',
    Croatia: '🇭🇷',
    Cuba: '🇨🇺',
    'Czech Republic': '🇨🇿',
    Denmark: '🇩🇰',
    Egypt: '🇪🇬',
    Estonia: '🇪🇪',
    Finland: '🇫🇮',
    France: '🇫🇷',
    Germany: '🇩🇪',
    Greece: '🇬🇷',
    Hungary: '🇭🇺',
    Iceland: '🇮🇸',
    India: '🇮🇳',
    Indonesia: '🇮🇩',
    Ireland: '🇮🇪',
    Israel: '🇮🇱',
    Italy: '🇮🇹',
    Japan: '🇯🇵',
    Jordan: '🇯🇴',
    Laos: '🇱🇦',
    Malaysia: '🇲🇾',
    Malta: '🇲🇹',
    Mexico: '🇲🇽',
    Morocco: '🇲🇦',
    Netherlands: '🇳🇱',
    'New Zealand': '🇳🇿',
    Norway: '🇳🇴',
    Peru: '🇵🇪',
    Philippines: '🇵🇭',
    Poland: '🇵🇱',
    Portugal: '🇵🇹',
    Romania: '🇷🇴',
    Russia: '🇷🇺',
    'Saudi Arabia': '🇸🇦',
    Singapore: '🇸🇬',
    Slovakia: '🇸🇰',
    Slovenia: '🇸🇮',
    'South Africa': '🇿🇦',
    'South Korea': '🇰🇷',
    Spain: '🇪🇸',
    Sweden: '🇸🇪',
    Switzerland: '🇨🇭',
    Taiwan: '🇹🇼',
    Thailand: '🇹🇭',
    Tunisia: '🇹🇳',
    Turkey: '🇹🇷',
    Ukraine: '🇺🇦',
    'United Arab Emirates': '🇦🇪',
    'United Kingdom': '🇬🇧',
    'United States': '🇺🇸',
    Vatican: '🇻🇦',
    Vietnam: '🇻🇳',
  };

  function countryFlag(country) {
    return COUNTRY_FLAGS[String(country || '').trim()] || '🌐';
  }

  function normCountry(country) {
    return String(country || '').trim().toLowerCase();
  }

  function normalizeFlightTrip(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const departureDate = raw.departureDate || raw.startDate;
    const arrivalDate = raw.arrivalDate || raw.endDate || departureDate;
    const departureCountry = raw.departureCountry || '';
    const arrivalCountry = raw.arrivalCountry || raw.country || '';
    if (!departureDate || !arrivalDate || !departureCountry || !arrivalCountry) return null;
    if (Number.isNaN(parseYmdToUtcMs(departureDate)) || Number.isNaN(parseYmdToUtcMs(arrivalDate))) return null;
    if (normCountry(departureCountry) === normCountry(arrivalCountry)) return null;
    return {
      id: raw.id || raw.bookingRef || `${departureDate}-${departureCountry}-${arrivalCountry}`,
      departureDate,
      arrivalDate,
      departureCountry,
      arrivalCountry,
      departureCity: raw.departureCity || '',
      arrivalCity: raw.arrivalCity || raw.city || '',
      arrivalTimezone: raw.arrivalTimezone || raw.timezone || COUNTRY_TIMEZONES[arrivalCountry] || '',
      label: raw.title || [raw.departureAirport, raw.arrivalAirport].filter(Boolean).join(' → ') || `${departureCountry} → ${arrivalCountry}`,
    };
  }

  function collectFlightTrips(source) {
    const trips = [];
    const seen = new Set();
    for (const trip of source.upcomingTrips || []) {
      const normalized = normalizeFlightTrip(trip);
      if (!normalized) continue;
      const key = `${normalized.departureDate}|${normCountry(normalized.departureCountry)}|${normalized.arrivalDate}|${normCountry(normalized.arrivalCountry)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      trips.push(normalized);
    }
    for (const booking of source.bookings || []) {
      if (String(booking && booking.type || '').toLowerCase() !== 'flight') continue;
      const normalized = normalizeFlightTrip(booking);
      if (!normalized) continue;
      const key = `${normalized.departureDate}|${normCountry(normalized.departureCountry)}|${normalized.arrivalDate}|${normCountry(normalized.arrivalCountry)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      trips.push(normalized);
    }
    return trips.sort((a, b) => {
      const da = parseYmdToUtcMs(a.departureDate) - parseYmdToUtcMs(b.departureDate);
      if (da !== 0) return da;
      return parseYmdToUtcMs(a.arrivalDate) - parseYmdToUtcMs(b.arrivalDate);
    });
  }

  function closeCoveringStay(stays, country, date) {
    const dateMs = parseYmdToUtcMs(date);
    if (Number.isNaN(dateMs)) return;
    const stay = stays
      .filter((s) => normCountry(s.country) === normCountry(country))
      .find((s) => {
        const sMs = parseYmdToUtcMs(s.entryDate);
        const eMs = s.exitDate ? parseYmdToUtcMs(s.exitDate) : Infinity;
        return Number.isFinite(sMs) && sMs < dateMs && eMs > dateMs;
      });
    if (stay) stay.exitDate = date;
  }

  function hasStayStarting(stays, country, date) {
    return stays.some((s) => normCountry(s.country) === normCountry(country) && s.entryDate === date);
  }

  function deriveTravelLogFromFlights(source) {
    const stays = (source.travelLog || []).map((s) => ({ ...s }));
    const trips = collectFlightTrips(source);
    for (const trip of trips) {
      closeCoveringStay(stays, trip.departureCountry, trip.departureDate);
      if (!hasStayStarting(stays, trip.arrivalCountry, trip.arrivalDate)) {
        stays.push({
          id: `flight-stay-${trip.arrivalDate}-${normCountry(trip.arrivalCountry).replace(/[^a-z0-9]+/g, '-')}`,
          country: trip.arrivalCountry,
          city: trip.arrivalCity,
          timezone: trip.arrivalTimezone,
          entryDate: trip.arrivalDate,
          exitDate: null,
          entryType: 'flight',
          notes: `Auto-created from flight ${trip.label}`,
        });
      }
    }
    return stays.sort((a, b) => {
      const da = parseYmdToUtcMs(a.entryDate) - parseYmdToUtcMs(b.entryDate);
      if (da !== 0) return da;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
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
    return a.expiresDate || a.renewDate || a.date || a.startDate || '';
  }

  function getLongTermBookings(source = config) {
    return (source && Array.isArray(source.longTermBookings) ? source.longTermBookings : []).filter((item) => item && item.isActive !== false);
  }

  function getVisaStatus(source = config) {
    return getLongTermBookings(source).find((item) => String(item.type || '').toLowerCase() === 'visa') || null;
  }

  function longTermRenewalAlerts(source = config) {
    return getLongTermBookings(source)
      .filter((item) => item.renewDate && !Number.isNaN(parseYmdToUtcMs(item.renewDate)))
      .map((item) => ({
        id: `renewal-alert-${item.id || item.title || item.renewDate}`,
        type: 'renewal',
        title: `${item.title || 'Long-term booking'} renewal`,
        startDate: item.startDate,
        expiresDate: item.renewDate,
        country: item.country,
        city: item.city,
        notes: item.notes,
        severity: item.severity || 'medium',
        isActive: item.isActive !== false,
        sourceId: item.id,
        sourceType: item.type,
      }));
  }

  function getVisibleAlerts() {
    return [...(config.alerts || []), ...longTermRenewalAlerts()].filter((a) => {
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
    const base = {
      app: Object.assign({ title: 'CHRONOS GMT', subtitle: 'Global Citizen', defaultView: 'dashboard', systemStatus: 'OPTIMAL' }, o.app || {}),
      currentBase: o.currentBase || {},
      worldClocks: o.worldClocks || { priority: [], us: [] },
      travelLog: Array.isArray(o.travelLog) ? o.travelLog : [],
      travelTimeline: Array.isArray(o.travelTimeline) ? o.travelTimeline : [],
      alerts: Array.isArray(o.alerts) ? o.alerts : [],
      longTermBookings: Array.isArray(o.longTermBookings) ? o.longTermBookings : [],
      countriesVisitedEver: Array.isArray(o.countriesVisitedEver) ? o.countriesVisitedEver : [],
      countriesWantToVisit: Array.isArray(o.countriesWantToVisit) ? o.countriesWantToVisit : [],
      upcomingTrips: Array.isArray(o.upcomingTrips) ? o.upcomingTrips : [],
      bookings: Array.isArray(o.bookings) ? o.bookings : [],
      birthdays: Array.isArray(o.birthdays) ? o.birthdays : [],
      languageAudio: o.languageAudio && typeof o.languageAudio === 'object' ? o.languageAudio : { packs: [] },
    };
    base.travelLog = deriveTravelLogFromFlights(base);
    return base;
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
    const visaStatus = getVisaStatus();
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
          ${visaStatus ? `<div class="card visa-status-card" style="margin-bottom:1rem">
            <div class="panel-head"><h2>Visa status</h2></div>
            <p class="visa-status-card__title">${escapeHtml(visaStatus.title || 'Visa')}</p>
            <p class="visa-status-card__state">${escapeHtml(visaStatus.status || 'Active')}</p>
            <p class="visa-status-card__meta">${escapeHtml([visaStatus.city, visaStatus.country].filter(Boolean).join(' · ') || '—')}</p>
            <p class="visa-status-card__note">${escapeHtml(visaStatus.renewDate ? `Next date: ${visaStatus.renewDate}` : 'No visa expiry/extension date recorded yet.')}</p>
          </div>` : ''}
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
        const cur = s.exitDate == null;
        const dateLabel = `${s.entryDate} → ${s.exitDate || 'Now'}`;
        const dayLabel = days === 1 ? 'day' : 'days';
        const entryLabel = s.entryType ? `${s.entryType}` : '';
        const meta = [s.city, s.timezone, entryLabel, s.notes].filter(Boolean).join(' · ');
        return `<tr class="travel-log-row ${cur ? 'travel-log-row--current' : ''}">
          <td class="travel-log-country">
            <span class="travel-log-country__flag" aria-hidden="true">${countryFlag(s.country)}</span>
            <span class="travel-log-country__text">
              <strong>${escapeHtml(s.country)}</strong>
              ${cur ? '<span class="travel-log-status">Current</span>' : ''}
            </span>
          </td>
          <td class="travel-log-days"><span>${days}</span><small>${dayLabel}</small></td>
          <td class="travel-log-detail">
            <strong>${escapeHtml(dateLabel)}</strong>
            ${meta ? `<span>${escapeHtml(meta)}</span>` : ''}
          </td>
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
            <p class="summary-card__subtitle-line summary-card__subtitle-line--meta">${daysConsecutiveCurrentStay()} days in current stay</p>
          </div>
        </article>
      </div>
      <div class="card travel-log-card">
        <div class="panel-head"><h2>Stays</h2></div>
        <div class="travel-log-table-wrap">
          <table class="data-table travel-log-table">
            <thead><tr><th>Country</th><th>Days</th><th>Date & details</th></tr></thead>
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
          <p>One-time reservations for trips — flights, hotels, short stays, and fixed-date bookings. These do not create renewal alerts.</p>
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

  function formatLongTermType(type) {
    const s = String(type || 'renewal').replace(/[_-]/g, ' ');
    return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : 'Renewal';
  }

  function longTermDaysUntil(item) {
    if (!item || !item.renewDate) return null;
    const event = parseYmdToUtcMs(item.renewDate);
    const today = parseYmdToUtcMs(todayUtcYmd());
    if (Number.isNaN(event) || Number.isNaN(today)) return null;
    return Math.round((event - today) / 86400000);
  }

  function renderRenewalCard(item) {
    const type = String(item.type || 'renewal').toLowerCase();
    const days = longTermDaysUntil(item);
    const countdown = item.renewDate ? alertCountdownLabel(days) : 'No renewal date';
    const place = [item.city, item.country].filter(Boolean).join(' · ');
    const status = item.status || (item.isActive === false ? 'inactive' : 'active');
    const renewalMeta = item.renewDate
      ? `${formatBookingDate(item.renewDate)} · ${countdown}`
      : 'Date needed to enable alerts';
    const detailRows = [
      ['Status', status],
      ['Started / renewed', item.startDate ? formatBookingDate(item.startDate) : '—'],
      ['Next renewal', renewalMeta],
      ['Cycle', item.billingCycle || (item.termMonths ? `${item.termMonths} month${item.termMonths === 1 ? '' : 's'}` : '')],
      ['Location', place],
    ].filter(([, value]) => value != null && value !== '');

    return `<article class="booking-card renewal-card renewal-card--${escapeHtml(type)} ${days !== null && days <= 10 ? 'renewal-card--urgent' : ''}">
      <header class="booking-card__head">
        <span class="booking-card__icon" aria-hidden="true">${bookingIcon(type === 'visa' ? 'other' : type)}</span>
        <div class="booking-card__heading">
          <p class="booking-card__type">${escapeHtml(formatLongTermType(type))}</p>
          <h3 class="booking-card__title">${escapeHtml(item.title || 'Renewal')}</h3>
        </div>
        <div class="booking-card__when">
          ${item.renewDate ? `<p class="booking-card__date">${escapeHtml(formatBookingDate(item.renewDate))}</p>` : ''}
          <p class="booking-card__countdown ${days !== null && days < 0 ? 'booking-card__countdown--past' : ''}">${escapeHtml(countdown)}</p>
        </div>
      </header>
      <div class="booking-card__body">
        ${detailRows.map(([label, value]) => `<div class="booking-field"><span class="booking-field__label">${escapeHtml(label)}</span><span class="booking-field__value">${escapeHtml(value)}</span></div>`).join('')}
      </div>
      ${item.notes ? `<p class="booking-card__notes">${escapeHtml(item.notes)}</p>` : ''}
    </article>`;
  }

  function renderRenewals() {
    if (!elRenewals) return;
    const items = getLongTermBookings().sort((a, b) => {
      const da = a.renewDate ? parseYmdToUtcMs(a.renewDate) : Infinity;
      const db = b.renewDate ? parseYmdToUtcMs(b.renewDate) : Infinity;
      return da - db;
    });
    const activeRenewals = items.filter((item) => String(item.type || '').toLowerCase() !== 'visa');
    const visa = items.filter((item) => String(item.type || '').toLowerCase() === 'visa');
    const next = activeRenewals.filter((item) => item.renewDate).slice(0, 3);

    elRenewals.innerHTML = `
      <h1 id="renewals-heading">Renewals</h1>
      <div class="travel-header">
        <div>
          <p>Long-term commitments that need renewal tracking: rent, bike rental, gym, workspace, SIM, and visa status. Items with a renewal date automatically feed dashboard alerts.</p>
        </div>
      </div>
      <div class="travel-summary">
        <article class="card summary-card--travel">
          <div class="summary-card__body">
            <p class="summary-card__metric">${activeRenewals.length}</p>
            <h3 class="summary-card__title-line">Active renewals</h3>
          </div>
        </article>
        <article class="card summary-card--travel">
          <div class="summary-card__body">
            <p class="summary-card__metric">${next.length ? escapeHtml(alertCountdownLabel(longTermDaysUntil(next[0])).replace(' days left', 'd').replace(' day left', 'd')) : '—'}</p>
            <h3 class="summary-card__title-line">Next due</h3>
            <p class="summary-card__subtitle-line">${next.length ? escapeHtml(next[0].title || '') : 'No dated renewals'}</p>
          </div>
        </article>
        <article class="card summary-card--travel">
          <div class="summary-card__body">
            <p class="summary-card__place">${visa[0] ? escapeHtml(visa[0].status || 'Active') : '—'}</p>
            <h3 class="summary-card__title-line">Visa status</h3>
            <p class="summary-card__subtitle-line summary-card__subtitle-line--meta">${visa[0] ? escapeHtml(visa[0].title || 'Visa') : 'No visa record'}</p>
          </div>
        </article>
      </div>

      ${visa.length ? `<section class="bookings-section"><div class="bookings-section__head"><h2>Visa status</h2><span class="bookings-count">${visa.length}</span></div><div class="bookings-grid">${visa.map(renderRenewalCard).join('')}</div></section>` : ''}
      <section class="bookings-section">
        <div class="bookings-section__head">
          <h2>Long-term bookings</h2>
          <span class="bookings-count">${activeRenewals.length}</span>
        </div>
        ${activeRenewals.length ? `<div class="bookings-grid">${activeRenewals.map(renderRenewalCard).join('')}</div>` : '<p class="booking-empty">No long-term renewals saved yet.</p>'}
      </section>
    `;
  }

  /* ── To-Do list (synced via /api/todos → Workers KV) ───────────────────── */

  async function loadTodos() {
    const res = await fetch('/api/todos', { cache: 'no-store' });
    if (!res.ok) throw new Error('todos fetch failed');
    return res.json();
  }

  async function saveTodos(items) {
    const res = await fetch('/api/todos', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ todos: items, archived: todosArchived }),
    });
    if (!res.ok) throw new Error('todos save failed');
    return res.json();
  }

  function setTodosStatus(state) {
    todosSyncState = state;
    if (!elTodos) return;
    const el = elTodos.querySelector('[data-todos-status]');
    if (!el) return;
    el.textContent = TODOS_STATUS_LABEL[state] || '';
    el.className = `todos-status todos-status--${state}`;
  }

  // Persist optimistically: the UI already reflects the change; this syncs it.
  async function persistTodos() {
    setTodosStatus('saving');
    try {
      await saveTodos(todoItems);
      setTodosStatus('saved');
    } catch {
      setTodosStatus('error');
    }
  }

  function todoDeadlineMeta(deadline) {
    if (!deadline) return null;
    const ms = parseYmdToUtcMs(deadline);
    if (ms == null || Number.isNaN(ms)) return null;
    const days = Math.round((ms - parseYmdToUtcMs(todayUtcYmd())) / 86400000);
    let cls = 'todos-due';
    if (days < 0) cls += ' todos-due--overdue';
    else if (days <= 3) cls += ' todos-due--soon';
    const suffix = days < 0 ? ' · overdue' : days === 0 ? ' · today' : '';
    return { cls, text: `${formatBookingDate(deadline)}${suffix}` };
  }

  // Clickable deadline chip. Shows the date when set, a faint "＋ date" prompt
  // when not. Clicking it opens the native date picker (wired in wireTodos).
  function todoDateChip(item) {
    const meta = todoDeadlineMeta(item.deadline);
    const cls = meta ? meta.cls : 'todos-due todos-due--empty';
    const text = meta ? meta.text : '＋ date';
    const label = item.deadline ? 'Change deadline' : 'Add deadline';
    return `<span class="todos-due-wrap" data-todo-date>
        <button type="button" class="${cls} todos-due--btn" aria-label="${label}" title="${label}">${escapeHtml(text)}</button>
        <input type="date" class="todos-due__input" data-todo-date-input value="${item.deadline ? escapeHtml(item.deadline) : ''}" tabindex="-1" aria-hidden="true" />
      </span>`;
  }

  // Ensure loaded/created items carry every field the UI expects.
  function normalizeTask(t, isTop) {
    const o = t && typeof t === 'object' ? t : {};
    const prefix = isTop ? 'todo' : 'sub';
    // 'done' status and the done flag are two views of the same truth.
    const done = o.done === true || o.status === 'done';
    const item = {
      id: typeof o.id === 'string' && o.id ? o.id : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: typeof o.text === 'string' ? o.text : '',
      done,
      urgent: o.urgent === true,
      deadline: typeof o.deadline === 'string' && o.deadline ? o.deadline : null,
      createdAt: typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString(),
      doneAt: typeof o.doneAt === 'string' ? o.doneAt : done ? new Date().toISOString() : null,
    };
    if (isTop) {
      item.status = done ? 'done' : TODO_STATUS_KEYS.includes(o.status) && o.status !== 'done' ? o.status : 'todo';
      item.subtasks = Array.isArray(o.subtasks) ? o.subtasks.map((s) => normalizeTask(s, false)) : [];
    }
    return item;
  }

  // Keep a task's `done` flag and Kanban `status` in lockstep after a mutation.
  function setTaskStatus(task, status) {
    if (!task) return;
    task.status = TODO_STATUS_KEYS.includes(status) ? status : 'todo';
    const done = task.status === 'done';
    task.done = done;
    task.doneAt = done ? task.doneAt || new Date().toISOString() : null;
  }

  function setTaskDone(item, done) {
    item.done = done;
    item.doneAt = done ? new Date().toISOString() : null;
    // Only top-level tasks carry a Kanban status; reset to 'todo' when reopened.
    if (Object.prototype.hasOwnProperty.call(item, 'status')) item.status = done ? 'done' : 'todo';
  }

  function getTodosCollapsed() {
    if (todosCollapsed) return todosCollapsed;
    todosCollapsed = new Set();
    try {
      const raw = localStorage.getItem(STORAGE_TODOS_COLLAPSED);
      const arr = raw ? JSON.parse(raw) : null;
      if (Array.isArray(arr)) arr.forEach((id) => todosCollapsed.add(id));
    } catch {
      /* ignore */
    }
    return todosCollapsed;
  }

  function saveTodosCollapsed() {
    try {
      localStorage.setItem(STORAGE_TODOS_COLLAPSED, JSON.stringify([...getTodosCollapsed()]));
    } catch {
      /* ignore */
    }
  }

  function getTodosViewMode() {
    if (todosViewMode) return todosViewMode;
    let stored = null;
    try {
      stored = localStorage.getItem(STORAGE_TODOS_VIEW);
    } catch {
      /* ignore */
    }
    todosViewMode = stored === 'kanban' ? 'kanban' : 'list';
    return todosViewMode;
  }

  function setTodosViewMode(mode) {
    todosViewMode = mode === 'kanban' ? 'kanban' : 'list';
    try {
      localStorage.setItem(STORAGE_TODOS_VIEW, todosViewMode);
    } catch {
      /* ignore */
    }
  }

  function getTodosArchiveOpen() {
    if (todosArchiveOpen !== null) return todosArchiveOpen;
    let stored = null;
    try {
      stored = localStorage.getItem(STORAGE_TODOS_ARCHIVE_OPEN);
    } catch {
      /* ignore */
    }
    todosArchiveOpen = stored === '1';
    return todosArchiveOpen;
  }

  function setTodosArchiveOpen(open) {
    todosArchiveOpen = !!open;
    try {
      localStorage.setItem(STORAGE_TODOS_ARCHIVE_OPEN, todosArchiveOpen ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  // The text + checkbox, or an inline input when this item is being edited.
  // Note: a plain div (not a <label>) so clicking the title does NOT toggle
  // done — only the checkbox itself does.
  function todoMainHtml(item, toggleLabel) {
    if (item.id === todosEditingId) {
      return `<input type="text" class="todos-edit-input" data-todo-edit-input value="${escapeHtml(item.text)}" maxlength="2000" aria-label="Edit text" />`;
    }
    return `<div class="todos-item__main">
        <input type="checkbox" class="todos-item__check" data-todo-toggle ${item.done ? 'checked' : ''} aria-label="${toggleLabel}" />
        <span class="todos-item__text">${escapeHtml(item.text)}</span>
      </div>`;
  }

  function renderSubtaskRow(sub) {
    return `<li class="todos-item todos-subitem${sub.done ? ' todos-item--done' : ''}${sub.urgent ? ' todos-subitem--urgent' : ''}" data-sub-id="${escapeHtml(sub.id)}">
      <span class="todos-drag todos-drag--sub" data-todos-sub-handle aria-hidden="true" title="Drag to reorder">⠿</span>
      <div class="todos-item__lead">
        ${todoMainHtml(sub, 'Toggle subtask')}
        ${todoDateChip(sub)}
      </div>
      <div class="todos-item__actions">
        <button type="button" class="todos-light${sub.urgent ? ' todos-light--on' : ''}" data-todo-urgent aria-pressed="${sub.urgent ? 'true' : 'false'}" aria-label="Mark urgent" title="${sub.urgent ? 'Urgent — click to clear' : 'Mark urgent'}"></button>
        <button type="button" class="todos-item__edit" data-todo-edit aria-label="Edit subtask" title="Edit">✎</button>
        <button type="button" class="todos-item__del" data-todo-del aria-label="Delete subtask">×</button>
      </div>
    </li>`;
  }

  // Move done top-level tasks (and any done subtasks under active parents) into
  // the archive. Reversible — restore from the Archive drawer.
  function archiveDoneTasks() {
    const movedTop = todoItems.filter((t) => t.done);
    const remaining = todoItems.filter((t) => !t.done);
    const detached = [];
    remaining.forEach((t) => {
      if (!Array.isArray(t.subtasks)) return;
      const doneSubs = t.subtasks.filter((s) => s.done);
      if (!doneSubs.length) return;
      t.subtasks = t.subtasks.filter((s) => !s.done);
      // A detached subtask becomes a standalone archived task.
      doneSubs.forEach((s) => detached.push(normalizeTask({ ...s, subtasks: [] }, true)));
    });
    todosArchived = [...movedTop, ...detached, ...todosArchived];
    todoItems = remaining;
  }

  function renderArchivedRow(item) {
    const meta = todoDeadlineMeta(item.deadline);
    return `<li class="todos-item todos-archived" data-archived-id="${escapeHtml(item.id)}">
      <div class="todos-item__lead">
        <span class="todos-item__text">${escapeHtml(item.text)}</span>
        ${meta ? `<span class="${meta.cls}">${escapeHtml(meta.text)}</span>` : ''}
      </div>
      <div class="todos-item__actions">
        <button type="button" class="todos-archived__restore" data-todos-restore aria-label="Restore task" title="Restore to list">↩</button>
        <button type="button" class="todos-item__del" data-todos-archived-del aria-label="Delete permanently" title="Delete permanently">×</button>
      </div>
    </li>`;
  }

  function renderArchive() {
    if (!todosArchived.length) return '';
    const open = getTodosArchiveOpen();
    return `<div class="todos-archive${open ? ' is-open' : ''}">
      <div class="todos-archive__head">
        <button type="button" class="todos-archive__toggle" data-todos-archive-toggle aria-expanded="${open ? 'true' : 'false'}">
          <span class="todos-archive__caret" aria-hidden="true">${open ? '▾' : '▸'}</span>
          <span>Archive · ${todosArchived.length}</span>
        </button>
        ${open ? '<button type="button" class="todos-archive__clear" data-todos-archive-clear>Clear archive</button>' : ''}
      </div>
      ${open ? `<ul class="todos-list todos-list--archive">${todosArchived.map(renderArchivedRow).join('')}</ul>` : ''}
    </div>`;
  }

  function renderTaskGroup(item, draggable) {
    const all = Array.isArray(item.subtasks) ? item.subtasks : [];
    const doneCount = all.filter((s) => s.done).length;
    // Done subtasks sink to the bottom of the group (display order only).
    const subs = [...all].sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
    const hasSubs = subs.length > 0;
    const collapsed = hasSubs && getTodosCollapsed().has(item.id);
    const subaddOpen = todosSubaddOpen.has(item.id);
    return `<li class="todos-item todos-task${item.done ? ' todos-item--done' : ''}${item.urgent ? ' todos-task--urgent' : ''}${collapsed ? ' todos-task--collapsed' : ''}" data-id="${escapeHtml(item.id)}">
      <div class="todos-task__head">
        ${draggable ? '<span class="todos-drag" data-todos-handle aria-hidden="true" title="Drag to reorder">⠿</span>' : ''}
        <div class="todos-item__lead">
          ${todoMainHtml(item, 'Toggle complete')}
          ${hasSubs ? `<button type="button" class="todos-collapse" data-todo-collapse aria-expanded="${collapsed ? 'false' : 'true'}" aria-label="${collapsed ? 'Expand subtasks' : 'Collapse subtasks'}" title="${collapsed ? 'Expand' : 'Collapse'}">${collapsed ? '▸' : '▾'}</button>` : ''}
          ${hasSubs ? `<span class="todos-progress">${doneCount}/${subs.length}</span>` : ''}
          ${todoDateChip(item)}
        </div>
        <div class="todos-item__actions">
          <button type="button" class="todos-subadd-toggle${subaddOpen ? ' is-open' : ''}" data-subadd-toggle data-parent="${escapeHtml(item.id)}" aria-expanded="${subaddOpen ? 'true' : 'false'}" aria-label="Add subtask" title="Add subtask">+</button>
          <button type="button" class="todos-light${item.urgent ? ' todos-light--on' : ''}" data-todo-urgent aria-pressed="${item.urgent ? 'true' : 'false'}" aria-label="Mark urgent" title="${item.urgent ? 'Urgent — click to clear' : 'Mark urgent'}"></button>
          <button type="button" class="todos-item__edit" data-todo-edit aria-label="Edit task" title="Edit">✎</button>
          <button type="button" class="todos-item__del" data-todo-del aria-label="Delete task">×</button>
        </div>
      </div>
      ${hasSubs || subaddOpen
        ? `<div class="todos-task__body"${collapsed ? ' hidden' : ''}>
        ${hasSubs ? `<ul class="todos-subtasks" data-todos-subsortable data-parent="${escapeHtml(item.id)}">${subs.map(renderSubtaskRow).join('')}</ul>` : ''}
        ${subaddOpen
          ? `<form class="todos-subadd" data-subtask-add data-parent="${escapeHtml(item.id)}">
              <input type="text" class="todos-subadd__input" name="text" placeholder="Add subtask…" autocomplete="off" maxlength="2000" aria-label="New subtask" />
              <input type="date" class="todos-subadd__date" name="deadline" aria-label="Subtask deadline (optional)" />
              <button type="submit" class="todos-subadd__btn" aria-label="Add subtask">＋</button>
            </form>`
          : ''}
      </div>`
        : ''}
    </li>`;
  }

  // A Kanban card mirrors a top-level task: text, urgent dot, deadline + subtask
  // progress. Editing happens in List view; the board is for staging.
  function renderKanbanCard(item) {
    const subs = Array.isArray(item.subtasks) ? item.subtasks : [];
    const doneCount = subs.filter((s) => s.done).length;
    const meta = todoDeadlineMeta(item.deadline);
    const hasMeta = meta || subs.length;
    return `<li class="todos-kcard${item.urgent ? ' todos-kcard--urgent' : ''}" data-id="${escapeHtml(item.id)}">
      <div class="todos-kcard__top">
        <span class="todos-kcard__text">${escapeHtml(item.text)}</span>
        ${item.urgent ? '<span class="todos-light todos-light--on todos-kcard__dot" aria-label="Urgent"></span>' : ''}
      </div>
      ${hasMeta
        ? `<div class="todos-kcard__meta">
            ${meta ? `<span class="${meta.cls}">${escapeHtml(meta.text)}</span>` : ''}
            ${subs.length ? `<span class="todos-progress">${doneCount}/${subs.length}</span>` : ''}
          </div>`
        : ''}
    </li>`;
  }

  function renderKanban() {
    const cols = TODO_STATUSES.map((s) => {
      const items = todoItems.filter((t) => (t.status || (t.done ? 'done' : 'todo')) === s.key);
      return `<div class="todos-kcol" data-kanban-col="${s.key}">
        <div class="todos-kcol__head">
          <span class="todos-kcol__title">${escapeHtml(s.label)}</span>
          <span class="todos-kcol__count">${items.length}</span>
        </div>
        <ul class="todos-kcol__list" data-kanban-list data-status="${s.key}">${items.map(renderKanbanCard).join('')}</ul>
      </div>`;
    }).join('');
    return `<div class="todos-kanban">${cols}</div>`;
  }

  // There is one master order (todoItems); every column is just that list
  // filtered to a stage, rendered in master order. A board drag is therefore one
  // of two things:
  //   • across columns → a stage change only. The master order is untouched, so
  //     the card re-snaps to its master-order slot in the new column.
  //   • within a column → a reorder. The same-stage cards are permuted among the
  //     array slots they already occupy, leaving every other stage in place.
  function syncKanbanFromDom(evt) {
    if (!evt || !evt.item) return;
    const task = findTask(evt.item.getAttribute('data-id'));
    if (!task) return;
    const fromStatus = evt.from && evt.from.getAttribute('data-status');
    const toStatus = evt.to && evt.to.getAttribute('data-status');

    if (fromStatus !== toStatus) {
      setTaskStatus(task, toStatus);
    } else {
      if (evt.oldIndex === evt.newIndex) return; // dropped back in place
      const colItems = [...evt.to.querySelectorAll('[data-id]')]
        .map((li) => findTask(li.getAttribute('data-id')))
        .filter(Boolean);
      const colSet = new Set(colItems);
      const slots = [];
      todoItems.forEach((t, i) => {
        if (colSet.has(t)) slots.push(i);
      });
      slots.forEach((slotIdx, k) => {
        todoItems[slotIdx] = colItems[k];
      });
    }
    persistTodos();
    // Defer the repaint so SortableJS finishes unwinding the drag first.
    requestAnimationFrame(() => paintTodos());
  }

  function paintTodos() {
    if (!elTodos) return;
    const mode = getTodosViewMode();
    const active = todoItems.filter((t) => !t.done);
    const done = todoItems.filter((t) => t.done);

    const listBody = `
        ${active.length ? `<ul class="todos-list" data-todos-sortable>${active.map((t) => renderTaskGroup(t, true)).join('')}</ul>` : ''}
        ${todosLoaded && !todoItems.length ? '<p class="todos-empty">No tasks yet. Add your first one above.</p>' : ''}
        ${done.length ? `<p class="todos-done-label">Done · ${done.length}</p><ul class="todos-list todos-list--done">${done.map((t) => renderTaskGroup(t, false)).join('')}</ul>` : ''}`;

    elTodos.innerHTML = `
      <h1 id="todos-heading">To-Do</h1>
      <div class="travel-header">
        <div>
          <p>A simple checklist synced to the cloud, so it stays in step across every device. Give a task a deadline, group related steps as subtasks, or switch to the board to organise by stage.</p>
        </div>
      </div>
      <div class="todos-viewbar">
        <div class="todos-viewtoggle" role="group" aria-label="To-Do view">
          <button type="button" class="todos-viewtoggle__btn${mode === 'list' ? ' is-active' : ''}" data-todos-view="list" aria-pressed="${mode === 'list' ? 'true' : 'false'}">List</button>
          <button type="button" class="todos-viewtoggle__btn${mode === 'kanban' ? ' is-active' : ''}" data-todos-view="kanban" aria-pressed="${mode === 'kanban' ? 'true' : 'false'}">Board</button>
        </div>
      </div>
      <section class="card todos-card">
        <form class="todos-add" data-todos-add>
          <input type="text" class="todos-add__input" name="text" placeholder="Add a task…" autocomplete="off" maxlength="2000" aria-label="New to-do" />
          <input type="date" class="todos-add__date" name="deadline" aria-label="Deadline (optional)" />
          <button type="submit" class="todos-add__btn">Add</button>
        </form>
        <p class="todos-status todos-status--${todosSyncState}" data-todos-status>${escapeHtml(TODOS_STATUS_LABEL[todosSyncState] || '')}</p>
        ${todosLoading && !todosLoaded ? '<p class="todos-empty">Loading…</p>' : ''}
        ${mode === 'kanban' ? renderKanban() : listBody}
        ${hasDoneTasks() ? `<div class="todos-actions"><button type="button" class="todos-clear" data-todos-clear-done>Archive ‘done’ tasks</button></div>` : ''}
        ${renderArchive()}
      </section>
    `;
    initTodosSortable();
  }

  function destroyTodosSortables() {
    todosSortables.forEach((s) => {
      try {
        s.destroy();
      } catch {
        /* ignore */
      }
    });
    todosSortables = [];
  }

  // Shared options for every pointer-based (touch + desktop) sortable list.
  const TODOS_SORTABLE_BASE = {
    animation: 150,
    forceFallback: true,
    fallbackTolerance: 3,
    ghostClass: 'todos-item--ghost',
  };

  // (Re)create SortableJS instances. innerHTML rebuilds destroy the old DOM each
  // paint, so destroy the stale instances first. Covers the active top-level
  // list and one instance per subtask list. Kanban columns are wired separately.
  function initTodosSortable() {
    destroyTodosSortables();
    if (!elTodos || !window.Sortable) return;

    const list = elTodos.querySelector('[data-todos-sortable]');
    if (list) {
      todosSortables.push(
        window.Sortable.create(list, {
          ...TODOS_SORTABLE_BASE,
          // Distinct handle attr so grabbing a subtask handle never drags the task.
          handle: '[data-todos-handle]',
          onEnd: (evt) => {
            if (evt.oldIndex === evt.newIndex) return;
            const active = todoItems.filter((t) => !t.done);
            const done = todoItems.filter((t) => t.done);
            const [moved] = active.splice(evt.oldIndex, 1);
            active.splice(evt.newIndex, 0, moved);
            todoItems = [...active, ...done];
            persistTodos();
          },
        }),
      );
    }

    elTodos.querySelectorAll('[data-todos-subsortable]').forEach((ul) => {
      const parentId = ul.getAttribute('data-parent');
      todosSortables.push(
        window.Sortable.create(ul, {
          ...TODOS_SORTABLE_BASE,
          handle: '[data-todos-sub-handle]',
          onEnd: () => reorderSubtasksFromDom(parentId, ul),
        }),
      );
    });

    // Kanban columns share one drag group so cards move between stages.
    elTodos.querySelectorAll('[data-kanban-list]').forEach((ul) => {
      todosSortables.push(
        window.Sortable.create(ul, {
          ...TODOS_SORTABLE_BASE,
          group: 'todos-kanban',
          draggable: '.todos-kcard',
          onEnd: syncKanbanFromDom,
        }),
      );
    });
  }

  // After a subtask drag, rebuild the parent's subtasks array to match the DOM
  // order (done subtasks re-sink to the bottom on the next paint).
  function reorderSubtasksFromDom(parentId, ul) {
    const task = findTask(parentId);
    if (!task || !Array.isArray(task.subtasks)) return;
    const order = [...ul.querySelectorAll('[data-sub-id]')].map((li) => li.getAttribute('data-sub-id'));
    const byId = new Map(task.subtasks.map((s) => [s.id, s]));
    const next = order.map((id) => byId.get(id)).filter(Boolean);
    task.subtasks.forEach((s) => {
      if (!next.includes(s)) next.push(s);
    });
    task.subtasks = next;
    persistTodos();
  }

  // Any completed task or completed subtask anywhere.
  function hasDoneTasks() {
    return todoItems.some((t) => t.done || (Array.isArray(t.subtasks) && t.subtasks.some((s) => s.done)));
  }

  function countDoneTasks() {
    return todoItems.reduce(
      (n, t) => n + (t.done ? 1 : 0) + (Array.isArray(t.subtasks) ? t.subtasks.filter((s) => s.done).length : 0),
      0,
    );
  }

  async function renderTodos() {
    if (!elTodos) return;
    if (todosLoaded) {
      paintTodos();
      return;
    }
    todosLoading = true;
    todosSyncState = 'loading';
    paintTodos();
    try {
      const data = await loadTodos();
      const raw = Array.isArray(data && data.todos) ? data.todos : [];
      todoItems = raw.map((t) => normalizeTask(t, true));
      const rawArchived = Array.isArray(data && data.archived) ? data.archived : [];
      todosArchived = rawArchived.map((t) => normalizeTask(t, true));
      todosLoaded = true;
      todosSyncState = 'idle';
    } catch {
      todosSyncState = 'error';
    } finally {
      todosLoading = false;
      paintTodos();
    }
  }

  function findTask(id) {
    return todoItems.find((t) => t.id === id);
  }

  // Resolve the task or subtask object that owns a DOM element inside a row.
  function taskRefFromEl(el) {
    const parentLi = el.closest('[data-id]');
    const task = findTask(parentLi && parentLi.getAttribute('data-id'));
    if (!task) return null;
    const subLi = el.closest('[data-sub-id]');
    if (!subLi) return task;
    return (task.subtasks || []).find((s) => s.id === subLi.getAttribute('data-sub-id')) || null;
  }

  // Event delegation wired once; survives the innerHTML repaints in paintTodos().
  function wireTodos() {
    if (!elTodos) return;

    elTodos.addEventListener('submit', (e) => {
      const subForm = e.target.closest('[data-subtask-add]');
      if (subForm) {
        e.preventDefault();
        const task = findTask(subForm.getAttribute('data-parent'));
        if (!task) return;
        const input = subForm.querySelector('input[name="text"]');
        const text = (input && input.value ? input.value : '').trim();
        if (!text) return;
        const deadline = (subForm.querySelector('input[name="deadline"]') || {}).value || null;
        task.subtasks = task.subtasks || [];
        task.subtasks.push(normalizeTask({ text, deadline }, false));
        paintTodos();
        const refocus = elTodos.querySelector(`[data-subtask-add][data-parent="${task.id}"] input[name="text"]`);
        if (refocus) refocus.focus();
        persistTodos();
        return;
      }
      const topForm = e.target.closest('[data-todos-add]');
      if (!topForm) return;
      e.preventDefault();
      const input = topForm.querySelector('input[name="text"]');
      const text = (input && input.value ? input.value : '').trim();
      if (!text) return;
      const deadline = (topForm.querySelector('input[name="deadline"]') || {}).value || null;
      todoItems.unshift(normalizeTask({ text, deadline }, true));
      paintTodos();
      const next = elTodos.querySelector('[data-todos-add] input[name="text"]');
      if (next) next.focus();
      persistTodos();
    });

    elTodos.addEventListener('change', (e) => {
      const dateInput = e.target.closest('[data-todo-date-input]');
      if (dateInput) {
        const target = taskRefFromEl(dateInput);
        if (!target) return;
        const v = dateInput.value;
        target.deadline = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
        paintTodos();
        persistTodos();
        return;
      }
      const cb = e.target.closest('[data-todo-toggle]');
      if (!cb) return;
      const target = taskRefFromEl(cb);
      if (!target) return;
      setTaskDone(target, cb.checked);
      paintTodos();
      persistTodos();
    });

    elTodos.addEventListener('click', (e) => {
      const viewBtn = e.target.closest('[data-todos-view]');
      if (viewBtn) {
        const mode = viewBtn.getAttribute('data-todos-view');
        if (mode !== getTodosViewMode()) {
          setTodosViewMode(mode);
          paintTodos();
        }
        return;
      }
      if (e.target.closest('[data-todos-clear-done]')) {
        if (!countDoneTasks()) return;
        // Archive (reversible) rather than delete.
        archiveDoneTasks();
        setTodosArchiveOpen(true);
        paintTodos();
        persistTodos();
        return;
      }
      const archiveToggle = e.target.closest('[data-todos-archive-toggle]');
      if (archiveToggle) {
        setTodosArchiveOpen(!getTodosArchiveOpen());
        paintTodos();
        return;
      }
      if (e.target.closest('[data-todos-archive-clear]')) {
        const n = todosArchived.length;
        if (!n) return;
        if (!window.confirm(`Permanently delete ${n} archived task${n === 1 ? '' : 's'}? This can't be undone.`)) return;
        todosArchived = [];
        paintTodos();
        persistTodos();
        return;
      }
      const restoreBtn = e.target.closest('[data-todos-restore]');
      if (restoreBtn) {
        const li = restoreBtn.closest('[data-archived-id]');
        const id = li && li.getAttribute('data-archived-id');
        const idx = todosArchived.findIndex((t) => t.id === id);
        if (idx === -1) return;
        const [item] = todosArchived.splice(idx, 1);
        todoItems.unshift(item);
        paintTodos();
        persistTodos();
        return;
      }
      const archivedDel = e.target.closest('[data-todos-archived-del]');
      if (archivedDel) {
        const li = archivedDel.closest('[data-archived-id]');
        const id = li && li.getAttribute('data-archived-id');
        todosArchived = todosArchived.filter((t) => t.id !== id);
        paintTodos();
        persistTodos();
        return;
      }
      const dateChip = e.target.closest('[data-todo-date]');
      if (dateChip) {
        const input = dateChip.querySelector('[data-todo-date-input]');
        if (input) {
          // showPicker() needs a user gesture (this click) and isn't universal;
          // fall back to focusing the native control.
          try {
            input.showPicker();
          } catch {
            input.focus();
          }
        }
        return;
      }
      const collapseBtn = e.target.closest('[data-todo-collapse]');
      if (collapseBtn) {
        const li = collapseBtn.closest('[data-id]');
        const id = li && li.getAttribute('data-id');
        if (!id) return;
        const set = getTodosCollapsed();
        if (set.has(id)) set.delete(id);
        else set.add(id);
        saveTodosCollapsed();
        paintTodos();
        return;
      }
      const urgentBtn = e.target.closest('[data-todo-urgent]');
      if (urgentBtn) {
        const target = taskRefFromEl(urgentBtn);
        if (!target) return;
        target.urgent = !target.urgent;
        paintTodos();
        persistTodos();
        return;
      }
      const subaddToggle = e.target.closest('[data-subadd-toggle]');
      if (subaddToggle) {
        const id = subaddToggle.getAttribute('data-parent');
        if (!id) return;
        const opening = !todosSubaddOpen.has(id);
        if (opening) {
          todosSubaddOpen.add(id);
          // The field lives in the collapsible body, so make sure it's expanded.
          if (getTodosCollapsed().delete(id)) saveTodosCollapsed();
        } else {
          todosSubaddOpen.delete(id);
        }
        paintTodos();
        if (opening) {
          const input = elTodos.querySelector(`[data-subtask-add][data-parent="${id}"] input[name="text"]`);
          if (input) input.focus();
        }
        return;
      }
      const editBtn = e.target.closest('[data-todo-edit]');
      if (editBtn) {
        const subLi = editBtn.closest('[data-sub-id]');
        todosEditingId = subLi
          ? subLi.getAttribute('data-sub-id')
          : (editBtn.closest('[data-id]') || {}).getAttribute?.('data-id') || null;
        paintTodos();
        const input = elTodos.querySelector('[data-todo-edit-input]');
        if (input) {
          input.focus();
          input.select();
        }
        return;
      }
      const del = e.target.closest('[data-todo-del]');
      if (!del) return;
      const parentLi = del.closest('[data-id]');
      const parentId = parentLi && parentLi.getAttribute('data-id');
      const subLi = del.closest('[data-sub-id]');
      if (!parentId) return;
      // The × no longer deletes outright — ask whether to archive or delete.
      openTodoRemovalModal(parentId, subLi && subLi.getAttribute('data-sub-id'));
    });

    elTodos.addEventListener('keydown', (e) => {
      // Escape closes an open add-subtask field.
      const subAdd = e.target.closest('[data-subtask-add]');
      if (subAdd && e.key === 'Escape') {
        e.preventDefault();
        todosSubaddOpen.delete(subAdd.getAttribute('data-parent'));
        paintTodos();
        return;
      }
      if (!e.target.closest('[data-todo-edit-input]')) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        commitTodoEdit(e.target.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        todosEditingId = null;
        paintTodos();
      }
    });

    // Commit on blur (e.g. tapping elsewhere). Guarded so the blur fired by the
    // post-commit repaint doesn't double-process.
    elTodos.addEventListener('focusout', (e) => {
      if (!e.target.closest('[data-todo-edit-input]')) return;
      commitTodoEdit(e.target.value);
    });
  }

  function findAnyTask(id) {
    const top = todoItems.find((t) => t.id === id);
    if (top) return top;
    for (const t of todoItems) {
      const sub = (t.subtasks || []).find((s) => s.id === id);
      if (sub) return sub;
    }
    return null;
  }

  function commitTodoEdit(value) {
    if (todosEditingId == null) return;
    const id = todosEditingId;
    todosEditingId = null;
    const text = (value || '').trim();
    let changed = false;
    if (text) {
      const item = findAnyTask(id);
      if (item && item.text !== text.slice(0, 2000)) {
        item.text = text.slice(0, 2000);
        changed = true;
      }
    }
    paintTodos();
    if (changed) persistTodos();
  }

  // ── Delete / archive confirm modal ──────────────────────────────────────
  let todoModalEl = null;
  let todoPendingRemoval = null;

  function ensureTodoModal() {
    if (todoModalEl) return todoModalEl;
    const wrap = document.createElement('div');
    wrap.className = 'todo-modal-backdrop';
    wrap.hidden = true;
    wrap.setAttribute('data-todo-modal', '');
    wrap.innerHTML = `
      <div class="todo-modal" role="dialog" aria-modal="true" aria-labelledby="todo-modal-title">
        <h2 class="todo-modal__title" id="todo-modal-title">Remove this task?</h2>
        <p class="todo-modal__text" data-todo-modal-text></p>
        <div class="todo-modal__actions">
          <button type="button" class="todo-modal__btn" data-todo-modal-cancel>Cancel</button>
          <button type="button" class="todo-modal__btn todo-modal__btn--archive" data-todo-modal-archive>Archive</button>
          <button type="button" class="todo-modal__btn todo-modal__btn--delete" data-todo-modal-delete>Delete</button>
        </div>
      </div>`;
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('[data-todo-modal-cancel]')) {
        closeTodoModal();
      } else if (e.target.closest('[data-todo-modal-archive]')) {
        applyTodoRemoval('archive');
      } else if (e.target.closest('[data-todo-modal-delete]')) {
        applyTodoRemoval('delete');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && todoModalEl && !todoModalEl.hidden) closeTodoModal();
    });
    document.body.appendChild(wrap);
    todoModalEl = wrap;
    return wrap;
  }

  function openTodoRemovalModal(parentId, subId) {
    todoPendingRemoval = { parentId, subId: subId || null };
    const modal = ensureTodoModal();
    const task = findTask(parentId);
    const item = subId && task ? (task.subtasks || []).find((s) => s.id === subId) : task;
    const isSub = !!subId;
    modal.querySelector('#todo-modal-title').textContent = isSub ? 'Remove this subtask?' : 'Remove this task?';
    modal.querySelector('[data-todo-modal-text]').textContent = item && item.text ? `“${item.text}”` : '';
    modal.hidden = false;
    const cancel = modal.querySelector('[data-todo-modal-cancel]');
    if (cancel) cancel.focus();
  }

  function closeTodoModal() {
    todoPendingRemoval = null;
    if (todoModalEl) todoModalEl.hidden = true;
  }

  function applyTodoRemoval(action) {
    const pending = todoPendingRemoval;
    closeTodoModal();
    if (!pending) return;
    const { parentId, subId } = pending;
    const task = findTask(parentId);
    if (!task) return;
    if (subId) {
      const sub = (task.subtasks || []).find((s) => s.id === subId);
      if (!sub) return;
      task.subtasks = (task.subtasks || []).filter((s) => s.id !== subId);
      // Archiving a subtask promotes it to a standalone archived task.
      if (action === 'archive') todosArchived.unshift(normalizeTask({ ...sub, subtasks: [] }, true));
    } else {
      todoItems = todoItems.filter((t) => t.id !== parentId);
      if (action === 'archive') todosArchived.unshift(task);
    }
    paintTodos();
    persistTodos();
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

  /** Countries ordered by how frequently they appear in the travel record, for the trip dropdown. */
  // Every country, so the dropdown is complete. Spellings match config conventions
  // (United States, United Kingdom, Czech Republic, Vatican, Turkey) to avoid duplicates.
  const WORLD_COUNTRIES = [
    'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina',
    'Armenia', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados',
    'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana',
    'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi', 'Cambodia', 'Cameroon', 'Canada',
    'Cape Verde', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros',
    'Congo', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic', 'Democratic Republic of the Congo',
    'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'East Timor', 'Ecuador', 'Egypt',
    'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji', 'Finland',
    'France', 'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala',
    'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras', 'Hungary', 'Iceland', 'India', 'Indonesia',
    'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan', 'Jordan',
    'Kazakhstan', 'Kenya', 'Kiribati', 'Kosovo', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon',
    'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Madagascar', 'Malawi',
    'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico',
    'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar',
    'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria',
    'North Korea', 'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Palau', 'Palestine', 'Panama',
    'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania',
    'Russia', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines',
    'Samoa', 'San Marino', 'Sao Tome and Principe', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles',
    'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa',
    'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland',
    'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Togo', 'Tonga', 'Trinidad and Tobago',
    'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates',
    'United Kingdom', 'United States', 'Uruguay', 'Uzbekistan', 'Vanuatu', 'Vatican', 'Venezuela',
    'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe',
  ];

  function fiscalCountryOptions() {
    const freq = Object.create(null);
    const order = [];
    const bump = (name, weight) => {
      const c = String(name || '').trim();
      if (!c) return;
      if (!(c in freq)) {
        freq[c] = 0;
        order.push(c);
      }
      freq[c] += weight;
    };
    // Travel-log stays are the strongest frequency signal.
    for (const stay of config.travelLog || []) bump(stay && stay.country, 100);
    for (const c of config.countriesVisitedEver || []) bump(c, 1);
    for (const c of config.countriesWantToVisit || []) bump(c, 0.5);
    bump(homeCountry(), 0.1);
    // Keep any country already chosen in either view so custom picks never disappear.
    if (fiscalWrap && fiscalWrap.views) {
      for (const view of Object.values(fiscalWrap.views)) {
        for (const t of (view && view.trips) || []) bump(t.country, 0.01);
      }
    }
    // Include every other country at zero weight so the list is complete; these sort
    // alphabetically below the countries that carry travel frequency.
    for (const c of WORLD_COUNTRIES) bump(c, 0);
    return order.sort((a, b) => freq[b] - freq[a] || a.localeCompare(b));
  }

  /** Whether the travel log feeds the active view (only the current-year view, when enabled). */
  function fiscalUsesLog() {
    return !!(fiscalWrap && fiscalWrap.mode === 'current' && fiscalState && fiscalState.useTravelLog);
  }

  function defaultFiscalCurrentView() {
    const y = new Date().getUTCFullYear();
    return {
      yearStart: `${y}-01-01`,
      yearEnd: `${y}-12-31`,
      useTravelLog: true,
      trips: [
        { id: 'tsum', label: 'Summer trip', country: '', start: `${y}-07-01`, days: 14 },
        { id: 'teoy', label: 'End of year trip', country: '', start: `${y}-12-15`, days: 14 },
      ],
    };
  }

  function defaultFiscalPlannedView() {
    const y = new Date().getUTCFullYear() + 1;
    return {
      yearStart: `${y}-01-01`,
      yearEnd: `${y}-12-31`,
      useTravelLog: false,
      trips: [],
    };
  }

  function defaultFiscalWrap() {
    return {
      mode: 'current',
      views: { current: defaultFiscalCurrentView(), planned: defaultFiscalPlannedView() },
    };
  }

  function sanitizeFiscalView(parsed, fallback) {
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray(parsed.trips) ||
      typeof parsed.yearStart !== 'string' ||
      typeof parsed.yearEnd !== 'string'
    ) {
      return fallback;
    }
    return {
      yearStart: parsed.yearStart,
      yearEnd: parsed.yearEnd,
      useTravelLog: parsed.useTravelLog !== false,
      trips: parsed.trips
        .filter((t) => t && typeof t === 'object')
        .map((t, i) => ({
          id: String(t.id || `t${i}-${Date.now().toString(36)}`),
          label: String(t.label || `Trip ${i + 1}`).slice(0, 60),
          country: typeof t.country === 'string' ? t.country : '',
          start: String(t.start || parsed.yearStart),
          days: Math.max(1, Math.min(180, Number(t.days) || 14)),
        })),
    };
  }

  function loadFiscalState() {
    try {
      const raw = localStorage.getItem(STORAGE_FISCAL);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          // New shape: { mode, views: { current, planned } }
          if (parsed.views && typeof parsed.views === 'object') {
            const mode = parsed.mode === 'planned' ? 'planned' : 'current';
            fiscalWrap = {
              mode,
              views: {
                current: sanitizeFiscalView(parsed.views.current, defaultFiscalCurrentView()),
                planned: sanitizeFiscalView(parsed.views.planned, defaultFiscalPlannedView()),
              },
            };
            return fiscalWrap.views[mode];
          }
          // Legacy flat shape — migrate into the current-year view.
          if (Array.isArray(parsed.trips)) {
            fiscalWrap = {
              mode: 'current',
              views: {
                current: sanitizeFiscalView(parsed, defaultFiscalCurrentView()),
                planned: defaultFiscalPlannedView(),
              },
            };
            return fiscalWrap.views.current;
          }
        }
      }
    } catch {
      /* ignore */
    }
    fiscalWrap = defaultFiscalWrap();
    return fiscalWrap.views[fiscalWrap.mode];
  }

  function saveFiscalState() {
    try {
      if (fiscalWrap) localStorage.setItem(STORAGE_FISCAL, JSON.stringify(fiscalWrap));
    } catch {
      /* ignore */
    }
    scheduleFiscalCloudSave();
  }

  function setFiscalMode(mode) {
    if (mode !== 'current' && mode !== 'planned') return;
    if (!fiscalWrap) fiscalState = loadFiscalState();
    if (fiscalWrap.mode === mode) return;
    fiscalWrap.mode = mode;
    fiscalState = fiscalWrap.views[mode];
    saveFiscalState();
    paintFiscal();
  }

  /* ── Fiscal planner cloud sync (via /api/fiscal → Workers KV) ──────────── */

  async function loadFiscalFromCloud() {
    const res = await fetch('/api/fiscal', { cache: 'no-store' });
    if (!res.ok) throw new Error('fiscal fetch failed');
    return res.json();
  }

  async function saveFiscalToCloud(wrap) {
    const res = await fetch('/api/fiscal', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fiscal: wrap }),
    });
    if (!res.ok) throw new Error('fiscal save failed');
    return res.json();
  }

  function setFiscalSyncStatus(state) {
    fiscalSyncState = state;
    if (!elFiscal) return;
    const el = elFiscal.querySelector('[data-fiscal-status]');
    if (!el) return;
    el.textContent = TODOS_STATUS_LABEL[state] || '';
    el.className = `todos-status todos-status--${state}`;
  }

  // localStorage already holds the change; debounce the cloud write so rapid
  // slider/date edits collapse into one PUT.
  function scheduleFiscalCloudSave() {
    if (!fiscalWrap) return;
    setFiscalSyncStatus('saving');
    if (fiscalSaveTimer) clearTimeout(fiscalSaveTimer);
    fiscalSaveTimer = setTimeout(() => {
      const snapshot = fiscalWrap;
      saveFiscalToCloud(snapshot)
        .then(() => setFiscalSyncStatus('saved'))
        .catch(() => setFiscalSyncStatus('error'));
    }, 600);
  }

  // On first open of the planner this session, adopt the cloud copy (cross-device
  // source of truth); if the cloud has nothing yet, seed it from local state.
  async function syncFiscalFromCloud() {
    setFiscalSyncStatus('loading');
    let data;
    try {
      data = await loadFiscalFromCloud();
    } catch {
      setFiscalSyncStatus('error');
      return;
    }
    const remote = data && data.fiscal;
    if (remote && typeof remote === 'object' && remote.views) {
      fiscalWrap = {
        mode: remote.mode === 'planned' ? 'planned' : 'current',
        views: {
          current: sanitizeFiscalView(remote.views.current, defaultFiscalCurrentView()),
          planned: sanitizeFiscalView(remote.views.planned, defaultFiscalPlannedView()),
        },
      };
      fiscalState = fiscalWrap.views[fiscalWrap.mode];
      try {
        localStorage.setItem(STORAGE_FISCAL, JSON.stringify(fiscalWrap));
      } catch {
        /* ignore */
      }
      setFiscalSyncStatus('idle');
      paintFiscal();
    } else {
      setFiscalSyncStatus('idle');
      if (fiscalWrap) {
        saveFiscalToCloud(fiscalWrap)
          .then(() => setFiscalSyncStatus('saved'))
          .catch(() => setFiscalSyncStatus('error'));
      }
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

  /**
   * Compute year-plan totals using a per-day country assignment.
   *
   *   Priority for each day in the year window:
   *     1. Logged travel-log stay (only when the view enables it)
   *     2. Planned trip
   *     3. Home country (default)
   *
   * Logged stays override planned trips because the past is authoritative.
   * Every dependent number — country tally, days in home, days in Spain,
   * trip "effective" days — is derived from this single source of truth
   * so the UI cannot disagree with itself.
   */
  function computeFiscal() {
    const startMs = parseYmdToUtcMs(fiscalState.yearStart);
    const endMs = parseYmdToUtcMs(fiscalState.yearEnd);
    const valid = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs;
    const endExMs = valid ? addUtcDaysMs(endMs, 1) : NaN;
    const totalDays = valid ? Math.floor((endExMs - startMs) / 86400000) : 0;
    const useLog = fiscalUsesLog();
    const home = (homeCountry() || 'Home').trim();
    const UNASSIGNED = 'Unassigned';

    const tripsResolved = fiscalState.trips.map((t) => {
      const sMs = parseYmdToUtcMs(t.start);
      const days = Math.max(0, Math.min(365, Number(t.days) || 0));
      const tEndExMs = Number.isFinite(sMs) ? addUtcDaysMs(sMs, days) : NaN;
      const lastMs = Number.isFinite(tEndExMs) ? addUtcDaysMs(tEndExMs, -1) : NaN;
      return {
        ...t,
        days,
        startMs: sMs,
        endExMs: tEndExMs,
        returnYmd: Number.isFinite(tEndExMs) ? ymdFromMs(tEndExMs) : '—',
        lastDayYmd: Number.isFinite(lastMs) ? ymdFromMs(lastMs) : '—',
        effective: 0,
      };
    });

    const loggedSegs = useLog ? buildLoggedAbroadSegments(startMs, endExMs, valid) : [];

    const dayCountry = valid ? new Array(totalDays).fill(home) : [];

    if (valid) {
      // Stamp planned trips first.
      for (const r of tripsResolved) {
        if (!Number.isFinite(r.startMs)) continue;
        const c = String(r.country || '').trim() || UNASSIGNED;
        const startDay = Math.max(0, Math.floor((r.startMs - startMs) / 86400000));
        const endDay = Math.min(totalDays, Math.floor((r.endExMs - startMs) / 86400000));
        for (let i = startDay; i < endDay; i += 1) dayCountry[i] = c;
      }
      // Logged stays (any country, including home) override planned where they exist.
      if (useLog) {
        const todayExMs = addUtcDaysMs(parseYmdToUtcMs(todayUtcYmd()), 1);
        for (const stay of config.travelLog || []) {
          if (!stay || !stay.country) continue;
          const sMs = stayInclusiveStartMs(stay);
          const eExMs = stay.exitDate ? parseYmdToUtcMs(stay.exitDate) : todayExMs;
          if (!Number.isFinite(sMs) || !Number.isFinite(eExMs) || eExMs <= sMs) continue;
          const startDay = Math.max(0, Math.floor((sMs - startMs) / 86400000));
          const endDay = Math.min(totalDays, Math.floor((eExMs - startMs) / 86400000));
          for (let i = startDay; i < endDay; i += 1) dayCountry[i] = stay.country;
        }
      }
    }

    const tally = new Map();
    for (const c of dayCountry) tally.set(c, (tally.get(c) || 0) + 1);

    // A trip's "effective" days are the days where its country still wins after
    // logged overrides — i.e. the days that actually show up in the timeline.
    for (const r of tripsResolved) {
      if (!valid || !Number.isFinite(r.startMs)) continue;
      const tripCountry = String(r.country || '').trim() || UNASSIGNED;
      const startDay = Math.max(0, Math.floor((r.startMs - startMs) / 86400000));
      const endDay = Math.min(totalDays, Math.floor((r.endExMs - startMs) / 86400000));
      let eff = 0;
      for (let i = startDay; i < endDay; i += 1) {
        if (dayCountry[i] === tripCountry) eff += 1;
      }
      r.effective = eff;
    }

    const inCountry = tally.get(home) || 0;
    const awayDays = Math.max(0, totalDays - inCountry);
    const daysInSpain = tally.get(ABROAD_ANCHOR_COUNTRY) || 0;
    const threshold = Math.ceil(totalDays / 2);

    const countryTotals = Array.from(tally.entries())
      .filter(([, d]) => d > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([country, days]) => ({ country, days }));

    return {
      valid,
      startMs,
      endExMs,
      totalDays,
      awayDays,
      inCountry,
      daysInSpain,
      threshold,
      tripsResolved,
      loggedSegs,
      countryTotals,
      home,
    };
  }

  function fiscalLoggedSegHtml(seg, startMs, span) {
    if (span <= 0) return '';
    const leftPct = ((seg.start - startMs) / span) * 100;
    const widthPct = ((seg.endEx - seg.start) / span) * 100;
    const color = fiscalCountryColor(seg.country);
    const title = `${seg.country}${seg.city ? ' · ' + seg.city : ''} · ${seg.days}d (travel log)`;
    return `<span class="fiscal-timeline__logged" style="left:${leftPct.toFixed(3)}%;width:${widthPct.toFixed(
      3
    )}%;--fiscal-c:${color}" title="${escapeHtml(title)}"></span>`;
  }

  function fiscalPlannedSegHtml(r, startMs, endExMs, span) {
    if (!Number.isFinite(r.startMs) || !Number.isFinite(r.endExMs) || span <= 0) return '';
    const cs = Math.max(r.startMs, startMs);
    const ce = Math.min(r.endExMs, endExMs);
    if (ce <= cs) return '';
    const leftPct = ((cs - startMs) / span) * 100;
    const widthPct = ((ce - cs) / span) * 100;
    const country = String(r.country || '').trim();
    const cls = country ? 'fiscal-timeline__seg fiscal-timeline__seg--country' : 'fiscal-timeline__seg';
    const colorStyle = country ? `;--fiscal-c:${fiscalCountryColor(country)}` : '';
    const title = `${r.label}${country ? ' · ' + country : ''} · ${r.effective}d`;
    return `<span class="${cls}" style="left:${leftPct.toFixed(3)}%;width:${widthPct.toFixed(
      3
    )}%${colorStyle}" title="${escapeHtml(title)}"></span>`;
  }

  function buildFiscalBarHtml(data) {
    const { valid, startMs, endExMs } = data;
    const span = valid ? endExMs - startMs : 0;
    if (!valid || span <= 0) return '';
    const months = buildFiscalMonthMarks(startMs, endExMs, span, valid);
    const dividers = months
      .filter((m) => m.leftPct > 0.01)
      .map((m) => `<span class="fiscal-timeline__month-divider" style="left:${m.leftPct.toFixed(3)}%"></span>`)
      .join('');
    const logged = (data.loggedSegs || []).map((seg) => fiscalLoggedSegHtml(seg, startMs, span)).join('');
    const segs = (data.tripsResolved || [])
      .map((r) => fiscalPlannedSegHtml(r, startMs, endExMs, span))
      .join('');
    return dividers + logged + segs;
  }

  function fiscalLegendHtml(data) {
    const colorByCountry = new Map();
    for (const s of data.loggedSegs || []) {
      if (s.country) colorByCountry.set(s.country, fiscalCountryColor(s.country));
    }
    let hasGeneric = false;
    for (const r of data.tripsResolved || []) {
      if (r.effective <= 0) continue;
      const c = String(r.country || '').trim();
      if (c) colorByCountry.set(c, fiscalCountryColor(c));
      else hasGeneric = true;
    }
    const hasLogged = (data.loggedSegs || []).length > 0;
    const hasPlanned = (data.tripsResolved || []).some((r) => r.effective > 0 && String(r.country || '').trim());
    if (!colorByCountry.size && !hasGeneric && !hasLogged) return '';
    const items = [];
    if (hasPlanned)
      items.push(
        `<span class="fiscal-timeline__legend-item"><span class="fiscal-timeline__legend-swatch fiscal-timeline__legend-swatch--striped"></span>Planned (striped)</span>`
      );
    if (hasLogged)
      items.push(
        `<span class="fiscal-timeline__legend-item"><span class="fiscal-timeline__legend-swatch fiscal-timeline__legend-swatch--solid"></span>Logged (solid)</span>`
      );
    for (const [c, col] of colorByCountry) {
      items.push(
        `<span class="fiscal-timeline__legend-item"><span class="fiscal-timeline__legend-swatch" style="background:${col}"></span>${escapeHtml(
          c
        )}</span>`
      );
    }
    if (hasGeneric)
      items.push(
        `<span class="fiscal-timeline__legend-item"><span class="fiscal-timeline__legend-swatch fiscal-timeline__legend-swatch--planned"></span>Unassigned trip</span>`
      );
    return `<div class="fiscal-timeline__legend">${items.join('')}</div>`;
  }

  function renderFiscal() {
    if (!elFiscal) return;
    if (!fiscalState) fiscalState = loadFiscalState();
    paintFiscal();
    if (!fiscalLoadedFromCloud) {
      fiscalLoadedFromCloud = true;
      syncFiscalFromCloud();
    }
  }

  function renderFiscalCountryTotals(countryTotals, threshold) {
    if (!Array.isArray(countryTotals) || !countryTotals.length) {
      return '<p class="fiscal-country-totals__empty">No trips planned yet — the entire year would be at home.</p>';
    }
    return countryTotals
      .map(({ country, days }) => {
        const isSpain = country === ABROAD_ANCHOR_COUNTRY;
        const overLimit = isSpain && days > threshold;
        const classes = [
          'fiscal-country-chip',
          isSpain ? 'fiscal-country-chip--spain' : '',
          overLimit ? 'fiscal-country-chip--alert' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return `<div class="${classes}" data-country="${escapeHtml(country)}">
          <span class="fiscal-country-chip__flag" aria-hidden="true">${countryFlag(country)}</span>
          <span class="fiscal-country-chip__name">${escapeHtml(country)}</span>
          <span class="fiscal-country-chip__days"><strong>${days}</strong><span class="fiscal-country-chip__days-unit">d</span></span>
        </div>`;
      })
      .join('');
  }

  function paintFiscal() {
    const data = computeFiscal();
    const {
      valid,
      totalDays,
      awayDays,
      inCountry,
      threshold,
      daysInSpain,
      tripsResolved,
      countryTotals,
      home,
      startMs,
      endExMs,
    } = data;
    // Spain card: red when OVER half-year (would trigger Spanish tax residency).
    const spainHeadroom = threshold - daysInSpain;
    const spainOk = valid && daysInSpain <= threshold;
    const spainStatusLabel = !valid
      ? 'Set valid year dates'
      : spainOk
      ? `${spainHeadroom} day${spainHeadroom === 1 ? '' : 's'} of headroom`
      : `${Math.abs(spainHeadroom)} day${Math.abs(spainHeadroom) === 1 ? '' : 's'} over the limit`;
    const spainStatusCls = !valid ? '' : spainOk ? 'fiscal-status--ok' : 'fiscal-status--bad';
    const homeLabel = home || 'home country';
    const mode = fiscalWrap ? fiscalWrap.mode : 'current';
    const isPlanned = mode === 'planned';
    const countryOpts = fiscalCountryOptions();
    const countryOptionsHtml = (selected) => {
      const sel = String(selected || '');
      const opts = countryOpts
        .map((c) => `<option value="${escapeHtml(c)}"${c === sel ? ' selected' : ''}>${escapeHtml(c)}</option>`)
        .join('');
      return `<option value=""${sel ? '' : ' selected'}>Select country…</option>${opts}`;
    };

    const tripsHtml = fiscalState.trips
      .map((t) => {
        const r = tripsResolved.find((x) => x.id === t.id) || { lastDayYmd: '—', returnYmd: '—', effective: 0 };
        const country = String(t.country || '').trim();
        const swatchStyle = country ? ` style="--fiscal-c:${fiscalCountryColor(country)}"` : '';
        return `<div class="fiscal-trip" data-trip-id="${escapeHtml(t.id)}">
          <div class="fiscal-trip__head">
            <span class="fiscal-trip__swatch${country ? '' : ' fiscal-trip__swatch--empty'}"${swatchStyle} data-role="swatch"></span>
            <input type="text" class="fiscal-trip__name" value="${escapeHtml(t.label)}" data-field="label" aria-label="Trip name" maxlength="60" />
            <button type="button" class="fiscal-trip__remove" data-action="remove" title="Remove trip" aria-label="Remove trip">×</button>
          </div>
          <div class="fiscal-trip__controls">
            <label class="fiscal-trip__field fiscal-trip__field--country">
              <span>Country</span>
              <select class="fiscal-trip__select" data-field="country" aria-label="Trip country">${countryOptionsHtml(country)}</select>
            </label>
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

    const legendHtml = fiscalLegendHtml(data);

    const span = valid ? endExMs - startMs : 0;
    const months = buildFiscalMonthMarks(startMs, endExMs, span, valid);
    const barHtml = buildFiscalBarHtml(data);
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
      <h1 id="fiscal-heading">Year plan</h1>
      <div class="fiscal-header">
        <p>${
          isPlanned
            ? `Plan a future year from a clean slate. Add country segments — 20 days in Spain, two weeks in the Philippines — and the totals, timeline, and country breakdown all update live. The travel log is ignored so you're planning purely from scratch.`
            : `Plan trips abroad and see how the year breaks down by country. Spain is your tax-residency risk country — stay under half the year there (${threshold} days). Drag the trip sliders, move dates, or swap countries; everything below recalculates as you go.`
        }</p>
        <p class="todos-status todos-status--${fiscalSyncState}" data-fiscal-status>${escapeHtml(TODOS_STATUS_LABEL[fiscalSyncState] || '')}</p>
        <div class="fiscal-header__controls">
          <div class="segmented fiscal-mode" role="group" aria-label="Year mode">
            <button type="button" id="fiscal-mode-current" class="${isPlanned ? '' : 'is-active'}">Current year</button>
            <button type="button" id="fiscal-mode-planned" class="${isPlanned ? 'is-active' : ''}">Planned future year</button>
          </div>
          <div class="fiscal-year-range">
            <label class="fiscal-trip__field">
              <span>Year start</span>
              <input type="date" id="fiscal-year-start" value="${escapeHtml(fiscalState.yearStart)}" />
            </label>
            <label class="fiscal-trip__field">
              <span>Year end</span>
              <input type="date" id="fiscal-year-end" value="${escapeHtml(fiscalState.yearEnd)}" />
            </label>
            ${
              isPlanned
                ? ''
                : `<label class="fiscal-trip__field fiscal-trip__field--toggle">
              <span>Account for travel log</span>
              <label class="fiscal-toggle">
                <input type="checkbox" id="fiscal-use-log" ${fiscalState.useTravelLog ? 'checked' : ''} />
                <span class="fiscal-toggle__track"><span class="fiscal-toggle__thumb"></span></span>
                <span class="fiscal-toggle__label">${fiscalState.useTravelLog ? 'On' : 'Off'}</span>
              </label>
            </label>`
            }
          </div>
        </div>
      </div>
      <div class="travel-summary">
        <article class="card summary-card--travel fiscal-summary-card">
          <div class="summary-card__body">
            <p class="summary-card__metric" data-metric="in">${inCountry}</p>
            <h3 class="summary-card__title-line">Days in ${escapeHtml(homeLabel)}</h3>
            <p class="summary-card__subtitle-line">Out of <span data-metric="total">${totalDays}</span> in the year</p>
          </div>
        </article>
        <article class="card summary-card--travel">
          <div class="summary-card__body">
            <p class="summary-card__metric" data-metric="away">${awayDays}</p>
            <h3 class="summary-card__title-line">Days abroad</h3>
            <p class="summary-card__subtitle-line" data-metric="trip-count">${escapeHtml(
              fiscalUsesLog()
                ? `Travel log + ${fiscalState.trips.length} planned trip${fiscalState.trips.length === 1 ? '' : 's'}`
                : `${fiscalState.trips.length} planned trip${fiscalState.trips.length === 1 ? '' : 's'}`
            )}</p>
          </div>
        </article>
        <article class="card summary-card--travel fiscal-summary-card ${spainStatusCls}" data-card="spain">
          <div class="summary-card__body">
            <p class="summary-card__metric" data-metric="spain-days">${daysInSpain}</p>
            <h3 class="summary-card__title-line">Days in ${escapeHtml(ABROAD_ANCHOR_COUNTRY)}</h3>
            <p class="summary-card__subtitle-line">Limit <span data-metric="spain-threshold">${threshold}</span> · <span data-metric="spain-status">${escapeHtml(spainStatusLabel)}</span></p>
          </div>
        </article>
      </div>
      <article class="card fiscal-country-totals" data-card="country-totals">
        <header class="fiscal-country-totals__head">
          <h2>Country totals</h2>
          <p class="fiscal-country-totals__hint">Days per country across the whole year. Updates live as you adjust trips.</p>
        </header>
        <div class="fiscal-country-totals__list" data-role="country-totals-list">${renderFiscalCountryTotals(countryTotals, threshold)}</div>
      </article>
      <div class="card fiscal-timeline-card">
        <div class="panel-head"><h2>Year timeline</h2></div>
        <p class="fiscal-timeline__hint">Each segment shows time abroad within the year window, colored by country.${
          isPlanned ? '' : ' Logged stays are solid; planned trips are striped.'
        } Pick a country per trip, drag its slider, or move its departure date — the bar reacts live.</p>
        <div class="fiscal-timeline">
          <div class="fiscal-timeline__bar" id="fiscal-timeline-bar">${barHtml}</div>
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
    const {
      valid,
      totalDays,
      awayDays,
      inCountry,
      threshold,
      daysInSpain,
      tripsResolved,
      countryTotals,
    } = data;

    const setText = (sel, val) => {
      const e = elFiscal.querySelector(sel);
      if (e) e.textContent = val;
    };

    setText('[data-metric="in"]', String(inCountry));
    setText('[data-metric="away"]', String(awayDays));
    setText('[data-metric="total"]', String(totalDays));
    setText(
      '[data-metric="trip-count"]',
      fiscalUsesLog()
        ? `Travel log + ${fiscalState.trips.length} planned trip${fiscalState.trips.length === 1 ? '' : 's'}`
        : `${fiscalState.trips.length} planned trip${fiscalState.trips.length === 1 ? '' : 's'}`
    );

    // Spain card (red when OVER the half-year line).
    const spainHeadroom = threshold - daysInSpain;
    const spainOk = valid && daysInSpain <= threshold;
    const spainStatusLabel = !valid
      ? 'Set valid year dates'
      : spainOk
      ? `${spainHeadroom} day${spainHeadroom === 1 ? '' : 's'} of headroom`
      : `${Math.abs(spainHeadroom)} day${Math.abs(spainHeadroom) === 1 ? '' : 's'} over the limit`;
    setText('[data-metric="spain-days"]', String(daysInSpain));
    setText('[data-metric="spain-threshold"]', String(threshold));
    setText('[data-metric="spain-status"]', spainStatusLabel);
    const spainCard = elFiscal.querySelector('[data-card="spain"]');
    if (spainCard) {
      spainCard.classList.toggle('fiscal-status--ok', valid && spainOk);
      spainCard.classList.toggle('fiscal-status--bad', valid && !spainOk);
    }

    // Country totals chips.
    const totalsList = elFiscal.querySelector('[data-role="country-totals-list"]');
    if (totalsList) totalsList.innerHTML = renderFiscalCountryTotals(countryTotals, threshold);

    // Per-trip effective day count.
    tripsResolved.forEach((r) => {
      const node = elFiscal.querySelector(`.fiscal-trip[data-trip-id="${CSS.escape(r.id)}"]`);
      if (!node) return;
      const eff = node.querySelector('[data-role="effective"]');
      if (eff) eff.textContent = String(r.effective);
    });

    const bar = $('fiscal-timeline-bar');
    if (bar) bar.innerHTML = buildFiscalBarHtml(data);
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
    $('fiscal-mode-current')?.addEventListener('click', () => setFiscalMode('current'));
    $('fiscal-mode-planned')?.addEventListener('click', () => setFiscalMode('planned'));
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
      } else if (field === 'country') {
        trip.country = String(target.value || '');
        saveFiscalState();
        paintFiscal();
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

  const SCHEDULE_ANCHOR_MIN = 240;
  const SCHEDULE_BLOCKS = [
    { start: 240, end: 660, label: 'Main sleep', kind: 'sleep', summary: 'Anchor block. Dark room, AC, eye mask, phone away. Treat this as your real night.' },
    { start: 660, end: 750, label: 'Breakfast + light work', kind: 'wake', summary: 'Coffee here. Breakfast, sunlight, planning, inbox, light tasks, checking leads/automations.' },
    { start: 750, end: 870, label: 'Gym + chill work', kind: 'gym', summary: 'Train in the first half of the day. Optional light work/admin around gym time.' },
    { start: 870, end: 915, label: 'Post-gym meal + reset', kind: 'meal', summary: 'Protein + carbs. Not a giant coma meal. Start dimming stimulation before the nap.' },
    { start: 930, end: 1020, label: 'Second sleep / nap', kind: 'sleep', summary: '90-minute pre-shift nap. The move that protects the night work block.' },
    { start: 1020, end: 1050, label: 'Wake buffer', kind: 'wake', summary: 'Water, light, quick walk/shower. No calls the second you wake up.' },
    { start: 1050, end: 1290, label: 'Deep work block', kind: 'work', summary: 'Coworking opens. Coffee + protein snack at the start. Best block for sales follow-up, systems, funnels, demos.' },
    { start: 1290, end: 1350, label: 'Dinner break', kind: 'meal', summary: 'Real dinner. Keep it sane. Avoid making 11pm the biggest meal of your day.' },
    { start: 1350, end: 180, label: 'US calls + night shift', kind: 'shift', summary: 'Calls, follow-up, support, sales. No more caffeine. Keep the work operational and focused.' },
    { start: 180, end: 240, label: 'Shutdown', kind: 'wind', summary: 'Hard stop, low light, shower, prep room, no doom-scrolling. Protect the 4am sleep start.' },
  ];
  const SCHEDULE_RULES = [
    { metric: 'Total sleep', target: '7+ hours actual sleep across both blocks' },
    { metric: 'Main sleep', target: 'At least 6 hours actual sleep most days' },
    { metric: 'Nap', target: '60-90 minutes actual sleep; skip it max 1x/week' },
    { metric: 'Caffeine', target: 'Coffee at 11am and 5:30pm only. No later caffeine.' },
    { metric: 'Hard stop', target: 'Stop work by 3:00am unless there is a real emergency' },
    { metric: 'Red flags', target: 'Irritability, anxiety, bad gym performance, needing late caffeine, or missing the nap repeatedly' },
  ];
  const SCHEDULE_HEADLINES = [
    { label: 'Main sleep', value: '4:00am – 11:00am', kind: 'sleep' },
    { label: 'Second sleep', value: '3:30pm – 5:00pm', kind: 'sleep' },
    { label: 'Main shift', value: '5:30pm – 3:00am', kind: 'shift' },
    { label: 'Caffeine cutoff', value: '5:30pm — last one', kind: 'wake' },
  ];

  function fmtMinAsClock(min) {
    const m = ((min % 1440) + 1440) % 1440;
    const h24 = Math.floor(m / 60);
    const mm = m % 60;
    const period = h24 < 12 ? 'am' : 'pm';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return mm === 0 ? `${h12}${period}` : `${h12}:${String(mm).padStart(2, '0')}${period}`;
  }

  function scheduleBlockLength(b) {
    return (((b.end - b.start) % 1440) + 1440) % 1440 || 1440;
  }

  function scheduleAnchorOffset(min, anchor = SCHEDULE_ANCHOR_MIN) {
    return (((min - anchor) % 1440) + 1440) % 1440;
  }

  function scheduleIsNowIn(nowMin, b) {
    const s = b.start;
    const e = b.end;
    if (s === e) return false;
    if (s < e) return nowMin >= s && nowMin < e;
    return nowMin >= s || nowMin < e;
  }

  function nowMinutesLocal() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  }

  function scheduleProgressPct(nowMin, b) {
    const len = scheduleBlockLength(b);
    const offset = (((nowMin - b.start) % 1440) + 1440) % 1440;
    return Math.max(0, Math.min(100, (offset / len) * 100));
  }

  function scheduleTimeUntil(nowMin, target) {
    let diff = (((target - nowMin) % 1440) + 1440) % 1440;
    const h = Math.floor(diff / 60);
    const m = Math.floor(diff % 60);
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  function renderSchedule() {
    if (!elSchedule) return;

    const headlineHtml = SCHEDULE_HEADLINES.map(
      (h) => `<article class="schedule-headline schedule-headline--${h.kind}">
        <p class="schedule-headline__label">${escapeHtml(h.label)}</p>
        <p class="schedule-headline__value">${escapeHtml(h.value)}</p>
      </article>`
    ).join('');

    const tickHtml = [0, 4, 8, 12, 16, 20, 24]
      .map((h) => {
        const min = (SCHEDULE_ANCHOR_MIN + h * 60) % 1440;
        const leftPct = ((h * 60) / 1440) * 100;
        return `<span class="schedule-timeline__tick" style="left:${leftPct.toFixed(3)}%">
          <span class="schedule-timeline__tick-label">${escapeHtml(fmtMinAsClock(min))}</span>
        </span>`;
      })
      .join('');

    const segHtml = SCHEDULE_BLOCKS.map((b, i) => {
      const len = scheduleBlockLength(b);
      const leftPct = (scheduleAnchorOffset(b.start) / 1440) * 100;
      const widthPct = (len / 1440) * 100;
      return `<span class="schedule-timeline__seg schedule-timeline__seg--${b.kind}" data-block-index="${i}" style="left:${leftPct.toFixed(3)}%;width:${widthPct.toFixed(3)}%" title="${escapeHtml(`${b.label} · ${fmtMinAsClock(b.start)}–${fmtMinAsClock(b.end)}`)}"></span>`;
    }).join('');

    const rowsHtml = SCHEDULE_BLOCKS.map((b, i) => {
      const range = `${fmtMinAsClock(b.start)} – ${fmtMinAsClock(b.end)}`;
      return `<div class="schedule-row schedule-row--${b.kind}" data-block-index="${i}">
        <div class="schedule-row__time">${escapeHtml(range)}</div>
        <div class="schedule-row__body">
          <p class="schedule-row__label">${escapeHtml(b.label)}</p>
          <p class="schedule-row__summary">${escapeHtml(b.summary)}</p>
        </div>
      </div>`;
    }).join('');

    const rulesHtml = SCHEDULE_RULES.map(
      (r) => `<div class="schedule-rule">
        <span class="schedule-rule__metric">${escapeHtml(r.metric)}</span>
        <span class="schedule-rule__target">${escapeHtml(r.target)}</span>
      </div>`
    ).join('');

    elSchedule.innerHTML = `
      <h1 id="schedule-heading">Schedule</h1>
      <div class="schedule-header">
        <p>Biphasic Bali → US-market schedule. Long anchor sleep at 4am, tactical 90-minute nap before the night shift, caffeine only at 11am and 5:30pm. Run this as a 14-day experiment, not a personality trait — if the nap fails, the whole system fails.</p>
      </div>

      <div class="schedule-headlines">${headlineHtml}</div>

      <article class="card schedule-now-card">
        <div class="schedule-now" data-role="now">
          <div class="schedule-now__head">
            <span class="schedule-now__kicker">Right now</span>
            <span class="schedule-now__clock" data-role="now-clock">--:--</span>
          </div>
          <p class="schedule-now__label" data-role="now-label">—</p>
          <p class="schedule-now__meta" data-role="now-meta">—</p>
          <div class="schedule-now__progress">
            <span class="schedule-now__progress-fill" data-role="now-fill" style="width:0%"></span>
          </div>
          <p class="schedule-now__next" data-role="now-next">—</p>
        </div>
      </article>

      <article class="card schedule-timeline-card">
        <header class="schedule-timeline-card__head">
          <h2>24-hour timeline</h2>
          <p class="schedule-timeline-card__hint">Starts at 4am wake. Hover a block for details.</p>
        </header>
        <div class="schedule-timeline">
          <div class="schedule-timeline__bar" data-role="timeline-bar">
            ${segHtml}
            <span class="schedule-timeline__now" data-role="timeline-now" style="left:0%"></span>
          </div>
          <div class="schedule-timeline__ticks">${tickHtml}</div>
        </div>
      </article>

      <article class="card schedule-list-card">
        <header class="schedule-list-card__head">
          <h2>Daily blocks</h2>
        </header>
        <div class="schedule-list">${rowsHtml}</div>
      </article>

      <article class="card schedule-rules-card">
        <header class="schedule-list-card__head">
          <h2>Two-week test rules</h2>
        </header>
        <div class="schedule-rules">${rulesHtml}</div>
      </article>
    `;

    registerClock('schedule-now', updateScheduleNow);
    updateScheduleNow();
  }

  function updateScheduleNow() {
    if (!elSchedule || !elSchedule.querySelector('[data-role="now"]')) return;
    const nowMin = nowMinutesLocal();
    const activeIdx = SCHEDULE_BLOCKS.findIndex((b) => scheduleIsNowIn(nowMin, b));
    const active = activeIdx >= 0 ? SCHEDULE_BLOCKS[activeIdx] : null;

    const clockEl = elSchedule.querySelector('[data-role="now-clock"]');
    if (clockEl) {
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      clockEl.textContent = `${hh}:${mm}:${ss}`;
    }

    const labelEl = elSchedule.querySelector('[data-role="now-label"]');
    const metaEl = elSchedule.querySelector('[data-role="now-meta"]');
    const fillEl = elSchedule.querySelector('[data-role="now-fill"]');
    const nextEl = elSchedule.querySelector('[data-role="now-next"]');
    const nowCard = elSchedule.querySelector('[data-role="now"]');

    if (active) {
      const pct = scheduleProgressPct(nowMin, active);
      if (labelEl) labelEl.textContent = active.label;
      if (metaEl) metaEl.textContent = `${fmtMinAsClock(active.start)} – ${fmtMinAsClock(active.end)} · ${active.summary}`;
      if (fillEl) fillEl.style.width = `${pct.toFixed(2)}%`;
      const nextIdx = (activeIdx + 1) % SCHEDULE_BLOCKS.length;
      const next = SCHEDULE_BLOCKS[nextIdx];
      if (nextEl) nextEl.textContent = `Next: ${next.label} at ${fmtMinAsClock(next.start)} (in ${scheduleTimeUntil(nowMin, active.end)})`;
      if (nowCard) nowCard.setAttribute('data-kind', active.kind);
    } else {
      if (labelEl) labelEl.textContent = 'Off-schedule';
      if (metaEl) metaEl.textContent = 'Current time falls outside any defined block.';
      if (fillEl) fillEl.style.width = '0%';
      if (nextEl) nextEl.textContent = '';
      if (nowCard) nowCard.setAttribute('data-kind', 'idle');
    }

    elSchedule.querySelectorAll('.schedule-row').forEach((row) => {
      const idx = Number(row.getAttribute('data-block-index'));
      row.classList.toggle('schedule-row--active', idx === activeIdx);
    });
    elSchedule.querySelectorAll('.schedule-timeline__seg').forEach((seg) => {
      const idx = Number(seg.getAttribute('data-block-index'));
      seg.classList.toggle('schedule-timeline__seg--active', idx === activeIdx);
    });

    const nowOffsetPct = (scheduleAnchorOffset(nowMin) / 1440) * 100;
    const nowMarker = elSchedule.querySelector('[data-role="timeline-now"]');
    if (nowMarker) nowMarker.style.left = `${nowOffsetPct.toFixed(3)}%`;
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

  /* ── Fitness dashboard (data from fitness.json, built from the Mars OS vault) ─ */

  const FIT_MUSCLE_COLORS = {
    Chest: '#7eb8d4',
    Back: '#8ad4a0',
    Delts: '#d4b07e',
    Quads: '#c98ad4',
    Hamstrings: '#d4877e',
    Biceps: '#7ec7d4',
    Triceps: '#b0d47e',
    Calves: '#9aa0d4',
    Core: '#d4d07e',
    Other: '#9aa3ad',
  };

  function fitMuscleColor(m) {
    return FIT_MUSCLE_COLORS[m] || FIT_MUSCLE_COLORS.Other;
  }

  function fitCapitalize(s) {
    s = (s || '').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  /** "2026-05-20" → "May 20". */
  function fitShortDate(ymd) {
    if (!ymd) return '';
    const [y, m, d] = ymd.split('-').map(Number);
    if (!y || !m || !d) return ymd;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[m - 1]} ${d}`;
  }

  /** "Day 1 — Upper A" → "Upper A"; falls back to the short date. */
  function fitSessionShort(s) {
    const m = (s.session || '').match(/[—–-]\s*(.+)$/);
    return m ? m[1].trim() : fitShortDate(s.date);
  }

  async function loadFitness() {
    if (fitnessLoading) return;
    fitnessLoading = true;
    try {
      const res = await fetch('fitness.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fitnessData = await res.json();
      fitnessError = false;
    } catch {
      fitnessError = true;
    } finally {
      fitnessLoading = false;
    }
  }

  function fitPoint(cx, cy, R, ratio, angleDeg) {
    const a = ((angleDeg - 90) * Math.PI) / 180;
    return [cx + R * ratio * Math.cos(a), cy + R * ratio * Math.sin(a)];
  }

  /** Week-completion ring. */
  function svgWeekRing(done, total) {
    const r = 52;
    const c = 2 * Math.PI * r;
    const pct = total ? Math.min(done / total, 1) : 0;
    const dash = (c * pct).toFixed(1);
    return `<svg viewBox="0 0 130 130" class="fit-ring" role="img" aria-label="${done} of ${total} weekly sessions complete">
      <circle class="fit-ring__track" cx="65" cy="65" r="${r}" />
      <circle class="fit-ring__bar" cx="65" cy="65" r="${r}" stroke-dasharray="${dash} ${c.toFixed(1)}" transform="rotate(-90 65 65)" />
      <text class="fit-ring__num" x="65" y="62" text-anchor="middle">${done}</text>
      <text class="fit-ring__den" x="65" y="84" text-anchor="middle">of ${total}</text>
    </svg>`;
  }

  /** Radar: outer heptagon = weekly target max, inner dashed = target min,
   *  filled polygon = this week's actual sets (normalized to target max). */
  function svgMuscleRadar(items) {
    const size = 300;
    const cx = size / 2;
    const cy = size / 2;
    const R = size / 2 - 50;
    const n = items.length;
    const step = 360 / n;
    const ratioActual = (it) => (it.target && it.target.max ? Math.min(it.sets / it.target.max, 1.12) : 0);
    const ratioMin = (it) => (it.target && it.target.max ? it.target.min / it.target.max : 0);
    const ptsAt = (ratioFn) =>
      items.map((it, i) => fitPoint(cx, cy, R, typeof ratioFn === 'function' ? ratioFn(it) : ratioFn, i * step).map((v) => v.toFixed(1)).join(',')).join(' ');

    let grid = '';
    for (const g of [0.25, 0.5, 0.75, 1]) {
      grid += `<polygon class="fit-radar__grid" points="${ptsAt(g)}" />`;
    }
    let spokes = '';
    let labels = '';
    items.forEach((it, i) => {
      const [x, y] = fitPoint(cx, cy, R, 1, i * step);
      spokes += `<line class="fit-radar__spoke" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" />`;
      const [lx, ly] = fitPoint(cx, cy, R + 24, 1, i * step);
      const anchor = Math.abs(lx - cx) < 6 ? 'middle' : lx > cx ? 'start' : 'end';
      labels += `<text class="fit-radar__label" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle">${escapeHtml(it.muscle)}</text>`;
    });
    const dots = items
      .map((it, i) => {
        const [x, y] = fitPoint(cx, cy, R, ratioActual(it), i * step);
        return `<circle class="fit-radar__dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" />`;
      })
      .join('');
    return `<svg viewBox="0 0 ${size} ${size}" class="fit-radar" role="img" aria-label="Weekly muscle volume versus target">
      ${grid}${spokes}
      <polygon class="fit-radar__min" points="${ptsAt(ratioMin)}" />
      <polygon class="fit-radar__actual" points="${ptsAt(ratioActual)}" />
      ${dots}${labels}
    </svg>`;
  }

  /** Vertical bars of estimated volume load per session. */
  function svgSessionBars(sessions) {
    const w = 340;
    const h = 190;
    const padB = 38;
    const padT = 18;
    const inner = w - 16;
    const max = Math.max(...sessions.map((s) => s.volumeLoad), 1);
    const gap = inner / sessions.length;
    const bw = Math.min(gap * 0.46, 54);
    let bars = '';
    sessions.forEach((s, i) => {
      const x = 8 + gap * i + gap / 2;
      const bh = (h - padB - padT) * (s.volumeLoad / max);
      const y = h - padB - bh;
      bars += `<rect class="fit-bar" x="${(x - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(bh, 2).toFixed(1)}" rx="6" />
        <text class="fit-bar__val" x="${x.toFixed(1)}" y="${(y - 7).toFixed(1)}" text-anchor="middle">${(s.volumeLoad / 1000).toFixed(1)}t</text>
        <text class="fit-bar__lbl" x="${x.toFixed(1)}" y="${(h - padB + 17).toFixed(1)}" text-anchor="middle">${escapeHtml(fitSessionShort(s))}</text>
        <text class="fit-bar__sub" x="${x.toFixed(1)}" y="${(h - padB + 31).toFixed(1)}" text-anchor="middle">${s.setCount} sets · ${s.repCount} reps</text>`;
    });
    return `<svg viewBox="0 0 ${w} ${h}" class="fit-bars" role="img" aria-label="Estimated volume load per session">${bars}</svg>`;
  }

  /** Best logged set label for an exercise, e.g. "100kg×10" or "15, 11 reps". */
  function fitExerciseTopLabel(ex) {
    if (ex.topWeight != null) {
      const top = ex.sets.filter((x) => x.weight === ex.topWeight);
      const reps = top.length ? Math.max(...top.map((x) => x.reps || 0)) : 0;
      return `${ex.topWeight}kg${ex.perSide ? '/s' : ''}${reps ? `×${reps}` : ''}`;
    }
    const reps = ex.sets.filter((x) => x.reps).map((x) => x.reps);
    if (reps.length) return `${reps.join(', ')} reps`;
    return `${ex.setCount} sets`;
  }

  /* Heavy-object ladder for the cumulative "mass moved" goal. kg = total
     volume load you must surpass to unlock that creature. Ascending. */
  const FIT_HEAVY_LADDER = [
    { key: 'car', name: 'compact car', emoji: '🚗', kg: 1500 },
    { key: 'rhino', name: 'white rhino', emoji: '🦏', kg: 2300 },
    { key: 'elephant', name: 'elephant', emoji: '🐘', kg: 6000 },
    { key: 'bus', name: 'city bus', emoji: '🚌', kg: 12000 },
    { key: 'humpback', name: 'humpback whale', emoji: '🐋', kg: 30000 },
    { key: 'blue', name: 'blue whale', emoji: '🐳', kg: 150000 },
  ];

  /** Big emoji that "fills" bottom-up to `fill` (0..1): a dimmed ghost glyph
   *  with a full-colour copy clipped to the fill level, plus a waterline. */
  function fitEmojiFill(emoji, fill) {
    const pct = (Math.max(0, Math.min(fill, 1)) * 100).toFixed(1);
    return `<div class="fit-emoji-fill" style="--fill:${pct}%" role="img" aria-label="Progress toward next milestone: ${pct}%">
      <span class="fit-emoji-fill__ghost" aria-hidden="true">${emoji}</span>
      <span class="fit-emoji-fill__full" aria-hidden="true">${emoji}</span>
      <span class="fit-emoji-fill__line" aria-hidden="true"></span>
    </div>`;
  }

  function fitMass(kg) {
    kg = Math.round(kg);
    return kg < 1000 ? `${kg.toLocaleString()} kg` : `${(kg / 1000).toFixed(1)} t`;
  }

  /** Body-weight trend: area + line for ≥2 points, single marker for 1. */
  function svgWeightTrend(series) {
    const w = 320;
    const h = 130;
    const padX = 14;
    const padT = 18;
    const padB = 14;
    if (!series.length) return '';
    const kgs = series.map((p) => p.kg);
    let min = Math.min(...kgs);
    let max = Math.max(...kgs);
    if (max - min < 4) {
      const mid = (max + min) / 2;
      min = mid - 2;
      max = mid + 2;
    }
    const span = max - min;
    const n = series.length;
    const x = (i) => (n === 1 ? w / 2 : padX + ((w - padX * 2) * i) / (n - 1));
    const y = (kg) => padT + (h - padT - padB) * (1 - (kg - min) / span);

    if (n === 1) {
      const cy = y(series[0].kg);
      return `<svg class="fit-wtrend" viewBox="0 0 ${w} ${h}" role="img" aria-label="Body weight">
        <line class="fit-wtrend__base" x1="${padX}" y1="${cy.toFixed(1)}" x2="${w - padX}" y2="${cy.toFixed(1)}" />
        <circle class="fit-wtrend__dot" cx="${(w / 2).toFixed(1)}" cy="${cy.toFixed(1)}" r="5" />
        <text class="fit-wtrend__val" x="${(w / 2).toFixed(1)}" y="${(cy - 12).toFixed(1)}" text-anchor="middle">${series[0].kg} kg</text>
      </svg>`;
    }

    const linePts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.kg).toFixed(1)}`);
    const area = `M${x(0).toFixed(1)},${(h - padB).toFixed(1)} L${linePts.join(' L')} L${x(n - 1).toFixed(1)},${(h - padB).toFixed(1)} Z`;
    const dots = series
      .map((p, i) => `<circle class="fit-wtrend__dot" cx="${x(i).toFixed(1)}" cy="${y(p.kg).toFixed(1)}" r="${i === n - 1 ? 4.5 : 3}" />`)
      .join('');
    const lastY = y(series[n - 1].kg);
    return `<svg class="fit-wtrend" viewBox="0 0 ${w} ${h}" role="img" aria-label="Body weight trend">
      <path class="fit-wtrend__area" d="${area}" />
      <polyline class="fit-wtrend__line" points="${linePts.join(' ')}" />
      ${dots}
      <text class="fit-wtrend__val" x="${(w - padX).toFixed(1)}" y="${(lastY - 10).toFixed(1)}" text-anchor="end">${series[n - 1].kg} kg</text>
    </svg>`;
  }

  function renderFitnessLoading() {
    if (elFitness) elFitness.innerHTML = '<h1 id="fitness-heading">Fitness</h1><div class="fit-skeleton" aria-busy="true">Syncing training data…</div>';
  }

  async function renderFitness() {
    if (!elFitness) return;
    if (!fitnessData && !fitnessError) {
      renderFitnessLoading();
      await loadFitness();
    }
    if (fitnessError || !fitnessData) {
      elFitness.innerHTML = `<h1 id="fitness-heading">Fitness</h1>
        <div class="card fit-empty">
          <p>Couldn't load <code>fitness.json</code>.</p>
          <p class="fit-empty__hint">Generate it from the Mars OS vault with <code>npm run build:fitness</code>, then reload.</p>
        </div>`;
      return;
    }

    const d = fitnessData;
    const state = d.state || {};
    const totals = d.totals || {};
    const routineDays = [...((d.routine && d.routine.days) || [])].sort((a, b) => a.day - b.day);

    // Goal extraction for the hero.
    const goalVal = (prefix) => {
      const g = (d.goals || []).find((x) => x.toLowerCase().startsWith(prefix));
      return g ? g.split(':').slice(1).join(':').trim().replace(/\.$/, '') : '';
    };
    const primaryGoal = fitCapitalize(goalVal('primary training goal') || 'Hypertrophy');
    const phase = fitCapitalize(goalVal('nutrition phase'));

    // Quote of the day (deterministic per day).
    const quotes = d.quotes || [];
    const quote = quotes.length ? quotes[Math.floor(Date.now() / 86400000) % quotes.length] : null;

    // Week status.
    const perWeek = state.sessionsPerWeek || 5;
    const weekDone = totals.weekSessions || 0;
    const byDate = new Map((d.sessions || []).map((s) => [s.date, s]));
    const completedDays = new Set(
      (d.weekSessions || []).map((dt) => byDate.get(dt)).filter(Boolean).map((s) => s.day).filter(Boolean)
    );
    const nextDay = parseInt(((state.next || '').match(/Day\s*(\d)/i) || [])[1] || '0', 10);

    const dayChips = routineDays
      .map((day) => {
        const done = completedDays.has(day.day);
        const isNext = !done && day.day === nextDay;
        const cls = done ? 'is-done' : isNext ? 'is-next' : 'is-pending';
        const mark = done ? '✓' : isNext ? '→' : '';
        return `<div class="fit-day ${cls}">
          <div class="fit-day__mark">${mark}</div>
          <div class="fit-day__body">
            <p class="fit-day__title">Day ${day.day} · ${escapeHtml(day.name)}</p>
            <p class="fit-day__focus">${escapeHtml(day.focus || '')}</p>
          </div>
        </div>`;
      })
      .join('');

    // KPI cards.
    const kpis = [
      { v: `${weekDone}/${perWeek}`, l: 'Sessions this week' },
      { v: totals.weekSets || 0, l: 'Sets logged' },
      { v: totals.weekReps || 0, l: 'Reps logged' },
      { v: `${((totals.weekVolumeLoad || 0) / 1000).toFixed(1)}t`, l: 'Est. volume load' },
    ]
      .map(
        (k) => `<div class="card fit-kpi"><p class="fit-kpi__value">${escapeHtml(String(k.v))}</p><p class="fit-kpi__label">${escapeHtml(k.l)}</p></div>`
      )
      .join('');

    // Muscle volume legend list.
    const muscleList = (d.muscleVolume || [])
      .map((m) => {
        const tgt = m.target ? `${m.target.min}–${m.target.max}` : '—';
        const pct = m.target && m.target.max ? Math.min(Math.round((m.sets / m.target.max) * 100), 130) : 0;
        return `<li class="fit-mlist__row">
          <span class="fit-mlist__dot" style="background:${fitMuscleColor(m.muscle)}"></span>
          <span class="fit-mlist__name">${escapeHtml(m.muscle)}</span>
          <span class="fit-mlist__bar"><span class="fit-mlist__fill" style="width:${Math.min(pct, 100)}%;background:${fitMuscleColor(m.muscle)}"></span></span>
          <span class="fit-mlist__num">${m.sets}<small>/${tgt}</small></span>
        </li>`;
      })
      .join('');

    // Pull-up tracker.
    const pu = d.pullUp || { best: 0, goal: 20 };
    const puPct = pu.goal ? Math.min((pu.best / pu.goal) * 100, 100) : 0;
    const puTicks = [5, 10, 15, 20]
      .map((t) => `<span class="fit-pullup__tick" style="left:${(t / (pu.goal || 20)) * 100}%"><i></i><b>${t}</b></span>`)
      .join('');

    // Mass-moved milestone (cumulative volume load vs the heavy-object ladder).
    const totalKg = totals.volumeLoad || 0;
    const ladder = FIT_HEAVY_LADDER;
    const achievedIdx = ladder.reduce((acc, m, i) => (totalKg >= m.kg ? i : acc), -1);
    const achieved = achievedIdx >= 0 ? ladder[achievedIdx] : null;
    const next = ladder[achievedIdx + 1] || null;
    const prevKg = achieved ? achieved.kg : 0;
    const fillNext = next ? Math.max(0, Math.min((totalKg - prevKg) / (next.kg - prevKg), 1)) : 1;
    const fillAbs = next ? Math.min(totalKg / next.kg, 1) : 1;
    const multiple = achieved ? (totalKg / achieved.kg).toFixed(1) : '0';
    const remaining = next ? next.kg - totalKg : 0;
    const massLadder = ladder
      .map((m, i) => {
        const cls = i <= achievedIdx ? 'is-done' : i === achievedIdx + 1 ? 'is-next' : 'is-locked';
        return `<li class="fit-ladder__node ${cls}" title="${escapeHtml(fitCapitalize(m.name))} · ${fitMass(m.kg)}">
          <span class="fit-ladder__emoji">${m.emoji}</span>
          <span class="fit-ladder__kg">${fitMass(m.kg)}</span>
        </li>`;
      })
      .join('');

    // Body weight.
    const weights = d.bodyweight || [];
    const wCurrent = weights.length ? weights[weights.length - 1] : null;
    const wStart = weights.length ? weights[0] : null;
    const wDelta = wCurrent && wStart ? +(wCurrent.kg - wStart.kg).toFixed(1) : 0;
    const wDeltaLabel = weights.length < 2 ? '' : `${wDelta > 0 ? '+' : ''}${wDelta} kg since ${escapeHtml(fitShortDate(wStart.date))}`;

    // Key lifts.
    const liftRows = (d.keyLifts || [])
      .slice(0, 12)
      .map((l) => {
        const note = l.note ? escapeHtml(l.note.replace(/^note:\s*/i, '').slice(0, 80)) : '';
        return `<li class="fit-lift">
          <span class="fit-lift__wt">${l.weight}<small>kg${l.perSide ? '/s' : ''}</small></span>
          <span class="fit-lift__main">
            <span class="fit-lift__name">${escapeHtml(l.name)}</span>
            <span class="fit-lift__meta"><span class="fit-tag" style="--c:${fitMuscleColor(l.muscle)}">${escapeHtml(l.muscle)}</span>${l.reps ? `<span class="fit-lift__reps">×${l.reps}</span>` : ''}${note ? `<span class="fit-lift__note">${note}</span>` : ''}</span>
          </span>
        </li>`;
      })
      .join('');

    // PR feed.
    const prRows = (d.prs || []).length
      ? (d.prs || [])
          .map(
            (p) => `<li class="fit-pr"><span class="fit-pr__date">${escapeHtml(fitShortDate(p.date))}</span><span class="fit-pr__text">${escapeHtml(p.text)}</span></li>`
          )
          .join('')
      : '<li class="fit-pr fit-pr--empty">No PRs logged yet — go set one.</li>';

    // Session log (most recent first).
    const sessionCards = [...(d.sessions || [])]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((s) => {
        const chips = (s.exercises || [])
          .map(
            (ex) => `<span class="fit-exchip"><span class="fit-exchip__dot" style="background:${fitMuscleColor(ex.muscle)}"></span>${escapeHtml(ex.name)}<b>${escapeHtml(fitExerciseTopLabel(ex))}</b></span>`
          )
          .join('');
        return `<article class="fit-session">
          <header class="fit-session__head">
            <div>
              <p class="fit-session__title">${escapeHtml(s.session || fitShortDate(s.date))}</p>
              <p class="fit-session__date">${escapeHtml(fitShortDate(s.date))}${s.location ? ` · ${escapeHtml(s.location)}` : ''}</p>
            </div>
            <div class="fit-session__stats">
              <span><b>${s.setCount}</b> sets</span>
              <span><b>${s.repCount}</b> reps</span>
              <span><b>${(s.volumeLoad / 1000).toFixed(1)}t</b> load</span>
            </div>
          </header>
          <div class="fit-session__chips">${chips}</div>
        </article>`;
      })
      .join('');

    // Routine reference.
    const routineCols = routineDays
      .map((day) => {
        const exs = (day.exercises || [])
          .map((e) => `<li><span>${escapeHtml(e.name)}</span><small>${escapeHtml(e.scheme || '')}</small></li>`)
          .join('');
        return `<div class="fit-routine__col">
          <p class="fit-routine__day">Day ${day.day}</p>
          <p class="fit-routine__name">${escapeHtml(day.name)}</p>
          <p class="fit-routine__focus">${escapeHtml(day.focus || '')}</p>
          <ul class="fit-routine__list">${exs}</ul>
        </div>`;
      })
      .join('');

    const subBits = [primaryGoal, phase, state.location, d.weekStart ? `Week of ${fitShortDate(d.weekStart)}` : '']
      .filter(Boolean)
      .map((b) => escapeHtml(b))
      .join(' &nbsp;·&nbsp; ');

    elFitness.innerHTML = `
      <h1 id="fitness-heading">Fitness</h1>
      <p class="fit-sub">${subBits}</p>

      <div class="fit-hero">
        <div class="card fit-hero__main">
          <div class="fit-hero__pills">
            <span class="pill pill--accent">${escapeHtml(primaryGoal)}</span>
            ${phase ? `<span class="pill">${escapeHtml(phase)}</span>` : ''}
            <span class="pill">${escapeHtml((d.routine && d.routine.version) || state.location || 'Gym')}</span>
          </div>
          ${
            quote
              ? `<blockquote class="fit-quote">“${escapeHtml(quote.quote)}”${quote.author ? `<cite>— ${escapeHtml(quote.author)}</cite>` : ''}</blockquote>`
              : ''
          }
          <ul class="fit-goals">${(d.goals || []).map((g) => `<li>${escapeHtml(g)}</li>`).join('')}</ul>
        </div>

        <div class="card fit-week">
          <div class="panel-head"><h2>This week</h2></div>
          <div class="fit-week__top">
            ${svgWeekRing(weekDone, perWeek)}
            <div class="fit-week__meta">
              <p class="fit-week__next-label">Next session</p>
              <p class="fit-week__next">${escapeHtml(state.next || '—')}</p>
              <p class="fit-week__rule">${escapeHtml(`${perWeek} sessions / week · Monday resets to Day 1`)}</p>
            </div>
          </div>
          <div class="fit-days">${dayChips}</div>
        </div>
      </div>

      <div class="fit-kpis">${kpis}</div>

      <div class="fit-grid2 fit-grid2--mass">
        <div class="card fit-mass">
          <div class="panel-head"><h2>Mass moved</h2></div>
          <div class="fit-mass__body">
            <div class="fit-mass__sil">
              ${fitEmojiFill(next ? next.emoji : '🐳', next ? fillAbs : 1)}
            </div>
            <div class="fit-mass__copy">
              <p class="fit-mass__total">${fitMass(totalKg)}<span>lifted all-time</span></p>
              ${
                achieved
                  ? `<p class="fit-mass__done">That's <b>${multiple}×</b> a ${escapeHtml(achieved.name)} ${achieved.emoji}</p>`
                  : `<p class="fit-mass__done">Every rep counts — keep stacking plates.</p>`
              }
              ${
                next
                  ? `<div class="fit-mass__next">
                       <p class="fit-mass__next-label">Next target</p>
                       <p class="fit-mass__next-name">${escapeHtml(fitCapitalize(next.name))} ${next.emoji}</p>
                       <div class="fit-mass__bar"><span style="width:${(fillAbs * 100).toFixed(1)}%"></span></div>
                       <p class="fit-mass__next-sub">${(fillAbs * 100).toFixed(0)}% of a ${escapeHtml(next.name)} · <b>${fitMass(remaining)}</b> to go</p>
                     </div>`
                  : `<p class="fit-mass__next-name">🏆 Top of the food chain — you've out-lifted the blue whale.</p>`
              }
            </div>
          </div>
          <ul class="fit-ladder">${massLadder}</ul>
        </div>

        <div class="card fit-panel fit-weight">
          <div class="panel-head"><h2>Body weight</h2></div>
          ${
            wCurrent
              ? `<div class="fit-weight__head">
                   <p class="fit-weight__now">${wCurrent.kg}<small>kg</small></p>
                   ${wDeltaLabel ? `<p class="fit-weight__delta ${wDelta > 0 ? 'is-up' : wDelta < 0 ? 'is-down' : ''}">${escapeHtml(wDeltaLabel)}</p>` : `<p class="fit-weight__delta">Logged ${escapeHtml(fitShortDate(wCurrent.date))}</p>`}
                 </div>
                 <div class="fit-weight__chart">${svgWeightTrend(weights)}</div>
                 <p class="fit-weight__hint">${weights.length < 2 ? 'Add weigh-ins to the vault’s <code>Fitness Weight Log.md</code> to grow this trend.' : 'Lean bulk — a slow, steady climb is the goal.'}</p>`
              : `<p class="fit-panel__hint">No weigh-ins yet. Log them in the vault’s <code>Fitness Weight Log.md</code> as <code>- YYYY-MM-DD: NN kg</code>.</p>`
          }
        </div>
      </div>

      <div class="fit-grid2">
        <div class="card fit-panel">
          <div class="panel-head"><h2>Weekly muscle volume</h2></div>
          <p class="fit-panel__hint">Hard sets so far this week vs. weekly target (outer ring = target max, dashed = target min).</p>
          <div class="fit-radar-wrap">${svgMuscleRadar(d.muscleVolume || [])}</div>
          <ul class="fit-mlist">${muscleList}</ul>
        </div>

        <div class="fit-col">
          <div class="card fit-panel">
            <div class="panel-head"><h2>Pull-up goal</h2></div>
            <div class="fit-pullup">
              <div class="fit-pullup__nums"><span class="fit-pullup__big">${pu.best}</span><span class="fit-pullup__goal">/ ${pu.goal} clean reps</span></div>
              <div class="fit-pullup__track"><div class="fit-pullup__fill" style="width:${puPct}%"></div>${puTicks}</div>
              <p class="fit-pullup__cap">${pu.best >= pu.goal ? 'Goal smashed 🏆' : `${pu.goal - pu.best} reps to go · best on ${escapeHtml(fitShortDate(pu.date))}`}</p>
            </div>
          </div>
          <div class="card fit-panel">
            <div class="panel-head"><h2>Volume per session</h2></div>
            <div class="fit-bars-wrap">${svgSessionBars(d.sessions || [])}</div>
          </div>
        </div>
      </div>

      <div class="fit-grid2">
        <div class="card fit-panel">
          <div class="panel-head"><h2>Working weights</h2></div>
          <ul class="fit-lifts">${liftRows}</ul>
        </div>
        <div class="card fit-panel">
          <div class="panel-head"><h2>PRs & highlights</h2></div>
          <ul class="fit-prs">${prRows}</ul>
        </div>
      </div>

      <div class="card fit-panel">
        <div class="panel-head"><h2>Session log</h2></div>
        <div class="fit-sessions">${sessionCards}</div>
      </div>

      <div class="card fit-panel">
        <div class="panel-head"><h2>Routine · ${escapeHtml((d.routine && d.routine.version) || '')}</h2></div>
        <div class="fit-routine">${routineCols}</div>
      </div>

      <p class="fit-foot">Synced from ${escapeHtml(d.source || 'Mars OS vault')}${d.generatedAt ? ` · generated ${escapeHtml(fitShortDate(d.generatedAt.slice(0, 10)))}` : ''}. Run <code>npm run build:fitness</code> to refresh.</p>
    `;
  }


  /* ── Birthdays (config seeded + /api/birthdays editable store) ───────────── */

  function birthdayStatusLabel() {
    if (birthdaysSyncState === 'loading') return 'Loading…';
    if (birthdaysSyncState === 'saving') return 'Saving…';
    if (birthdaysSyncState === 'saved') return 'All changes synced';
    if (birthdaysSyncState === 'error') return 'Offline — dashboard changes not saved';
    return '';
  }

  function normalizeMonthDay(value) {
    const m = /^(\d{1,2})[-/](\d{1,2})$/.exec(String(value || '').trim());
    if (!m) return null;
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function normalizeBirthday(raw, idx) {
    const o = raw && typeof raw === 'object' ? raw : {};
    const name = String(o.name || '').trim();
    const monthDay = normalizeMonthDay(o.monthDay || o.date);
    if (!name || !monthDay) return null;
    return {
      id: String(o.id || `birthday-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`),
      name,
      monthDay,
      note: String(o.note || '').trim(),
      createdAt: String(o.createdAt || new Date().toISOString()),
    };
  }

  function birthdayKey(b) {
    return `${String(b.name || '').trim().toLowerCase()}|${b.monthDay}`;
  }

  function mergeBirthdaySources(...sources) {
    const map = new Map();
    sources.flat().forEach((raw, idx) => {
      const b = normalizeBirthday(raw, idx);
      if (!b) return;
      map.set(birthdayKey(b), b);
    });
    return [...map.values()];
  }

  function birthdayNextInfo(monthDay) {
    const md = normalizeMonthDay(monthDay);
    if (!md) return { days: null, nextYmd: null, date: null };
    const [month, day] = md.split('-').map(Number);
    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    let target = Date.UTC(now.getFullYear(), month - 1, day);
    if (target < today) target = Date.UTC(now.getFullYear() + 1, month - 1, day);
    const d = new Date(target);
    return {
      days: Math.round((target - today) / 86400000),
      nextYmd: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
      date: d,
    };
  }

  function birthdayMonthDayLabel(monthDay) {
    const info = birthdayNextInfo(monthDay);
    if (!info.date) return monthDay || '';
    return info.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  function birthdayCountdown(days) {
    if (days === null || days === undefined) return '';
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    return `${days} days`;
  }

  function sortBirthdays(items) {
    return [...items].sort((a, b) => {
      const da = birthdayNextInfo(a.monthDay).days ?? 9999;
      const db = birthdayNextInfo(b.monthDay).days ?? 9999;
      if (da !== db) return da - db;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  async function loadBirthdaysRemote() {
    const res = await fetch('/api/birthdays', { cache: 'no-store' });
    if (!res.ok) throw new Error('birthdays fetch failed');
    return res.json();
  }

  async function saveBirthdaysRemote(items) {
    const res = await fetch('/api/birthdays', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ birthdays: items }),
    });
    if (!res.ok) throw new Error('birthdays save failed');
    return res.json();
  }

  function setBirthdaysStatus(state) {
    birthdaysSyncState = state;
    const el = elBirthdays?.querySelector('[data-birthdays-status]');
    if (!el) return;
    el.textContent = birthdayStatusLabel();
    el.className = `birthdays-status birthdays-status--${state}`;
  }

  async function persistBirthdays() {
    setBirthdaysStatus('saving');
    try {
      await saveBirthdaysRemote(birthdayItems);
      setBirthdaysStatus('saved');
    } catch {
      setBirthdaysStatus('error');
    }
  }

  function birthdayListHtml(items) {
    if (!items.length) return '<div class="booking-empty">No birthdays added yet.</div>';
    return `<ul class="birthday-list">${sortBirthdays(items).map((b) => {
      const info = birthdayNextInfo(b.monthDay);
      return `<li class="birthday-row" data-birthday-id="${escapeHtml(b.id)}">
        <div class="birthday-row__date">
          <strong>${escapeHtml(birthdayMonthDayLabel(b.monthDay))}</strong>
          <span>${escapeHtml(birthdayCountdown(info.days))}</span>
        </div>
        <div class="birthday-row__body">
          <h3>${escapeHtml(b.name)}</h3>
          ${b.note ? `<p>${escapeHtml(b.note)}</p>` : ''}
        </div>
        <button type="button" class="birthday-row__delete" data-birthday-delete aria-label="Delete ${escapeHtml(b.name)}">×</button>
      </li>`;
    }).join('')}</ul>`;
  }

  function birthdayCalendarHtml(items) {
    const byMd = new Map();
    items.forEach((b) => {
      const arr = byMd.get(b.monthDay) || [];
      arr.push(b);
      byMd.set(b.monthDay, arr);
    });
    const now = new Date();
    const months = [];
    for (let i = 0; i < 12; i += 1) {
      months.push(new Date(Date.UTC(now.getFullYear(), now.getMonth() + i, 1)));
    }
    return `<div class="birthday-calendar">${months.map((m) => {
      const year = m.getUTCFullYear();
      const month = m.getUTCMonth();
      const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const offset = new Date(Date.UTC(year, month, 1)).getUTCDay();
      const blanks = Array.from({ length: offset }, () => '<span class="birthday-day birthday-day--blank"></span>').join('');
      const dayCells = Array.from({ length: daysInMonth }, (_, dIdx) => {
        const day = dIdx + 1;
        const md = `${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const matches = byMd.get(md) || [];
        const names = matches.map((b) => b.name).join(', ');
        return `<span class="birthday-day${matches.length ? ' birthday-day--has' : ''}" title="${escapeHtml(names)}"><span>${day}</span>${matches.length ? `<em>${escapeHtml(matches.map((b) => b.name).join(' · '))}</em>` : ''}</span>`;
      }).join('');
      return `<section class="card birthday-month">
        <h3>${escapeHtml(m.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }))}</h3>
        <div class="birthday-weekdays"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
        <div class="birthday-days">${blanks}${dayCells}</div>
      </section>`;
    }).join('')}</div>`;
  }

  function paintBirthdays() {
    if (!elBirthdays) return;
    const items = sortBirthdays(birthdayItems);
    const next = items[0] || null;
    const nextInfo = next ? birthdayNextInfo(next.monthDay) : null;
    elBirthdays.innerHTML = `
      <header class="view-heading birthday-heading">
        <div>
          <p class="eyebrow">Personal calendar</p>
          <h1 id="birthdays-heading">Birthdays</h1>
          <p>See upcoming birthdays and add new ones to the dashboard calendar.</p>
        </div>
        <span class="birthdays-status birthdays-status--${escapeHtml(birthdaysSyncState)}" data-birthdays-status>${escapeHtml(birthdayStatusLabel())}</span>
      </header>

      <section class="birthday-hero card">
        <div>
          <p class="eyebrow">Next birthday</p>
          <h2>${next ? escapeHtml(next.name) : 'No birthdays yet'}</h2>
          <p>${next ? `${escapeHtml(birthdayMonthDayLabel(next.monthDay))} · ${escapeHtml(birthdayCountdown(nextInfo.days))}` : 'Add someone below.'}</p>
        </div>
        <strong>${items.length}</strong>
      </section>

      <div class="birthday-grid">
        <section class="card birthday-panel">
          <div class="panel-head"><h2>Add birthday</h2></div>
          <form class="birthday-form" data-birthday-add>
            <label>Name<input type="text" name="name" placeholder="Bea" required autocomplete="off" /></label>
            <label>Date<input type="text" name="monthDay" placeholder="MM-DD" pattern="\\d{1,2}[-/]\\d{1,2}" required /></label>
            <label>Note<input type="text" name="note" placeholder="optional" autocomplete="off" /></label>
            <button type="submit">Add</button>
          </form>
        </section>
        <section class="card birthday-panel">
          <div class="panel-head"><h2>Upcoming list</h2></div>
          ${birthdaysLoading ? '<p class="booking-empty">Loading birthdays…</p>' : birthdayListHtml(items)}
        </section>
      </div>

      <section class="birthday-panel birthday-calendar-panel">
        <div class="panel-head"><h2>12-month calendar</h2></div>
        ${birthdayCalendarHtml(items)}
      </section>
    `;
  }

  async function renderBirthdays() {
    if (!elBirthdays) return;
    if (birthdaysLoaded) {
      paintBirthdays();
      return;
    }
    birthdayItems = mergeBirthdaySources(config.birthdays || []);
    birthdaysLoading = true;
    birthdaysSyncState = 'loading';
    paintBirthdays();
    try {
      const data = await loadBirthdaysRemote();
      birthdayItems = mergeBirthdaySources(config.birthdays || [], Array.isArray(data?.birthdays) ? data.birthdays : []);
      birthdaysSyncState = 'idle';
    } catch {
      birthdaysSyncState = birthdayItems.length ? 'idle' : 'error';
    } finally {
      birthdaysLoaded = true;
      birthdaysLoading = false;
      paintBirthdays();
    }
  }

  function wireBirthdays() {
    if (!elBirthdays) return;
    elBirthdays.addEventListener('submit', (e) => {
      const form = e.target.closest('[data-birthday-add]');
      if (!form) return;
      e.preventDefault();
      const b = normalizeBirthday({
        name: form.querySelector('input[name="name"]')?.value,
        monthDay: form.querySelector('input[name="monthDay"]')?.value,
        note: form.querySelector('input[name="note"]')?.value,
      }, birthdayItems.length);
      if (!b) return;
      birthdayItems = mergeBirthdaySources(birthdayItems, [b]);
      paintBirthdays();
      persistBirthdays();
      const next = elBirthdays.querySelector('[data-birthday-add] input[name="name"]');
      form.reset();
      next?.focus();
    });
    elBirthdays.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-birthday-delete]');
      if (!btn) return;
      const row = btn.closest('[data-birthday-id]');
      const id = row?.getAttribute('data-birthday-id');
      if (!id) return;
      const item = birthdayItems.find((b) => b.id === id);
      if (item && !window.confirm(`Delete birthday for ${item.name}?`)) return;
      birthdayItems = birthdayItems.filter((b) => b.id !== id);
      paintBirthdays();
      persistBirthdays();
    });
  }

  function getLanguageAudioPacks(c = config) {
    const packs = c?.languageAudio?.packs;
    if (!Array.isArray(packs)) return [];
    return packs
      .filter((pack) => pack && (pack.title || pack.id))
      .map((pack, packIndex) => ({
        id: String(pack.id || `language-pack-${packIndex + 1}`),
        title: String(pack.title || `Language pack ${packIndex + 1}`),
        language: String(pack.language || 'Indonesian'),
        sourceLanguage: String(pack.sourceLanguage || 'English'),
        description: String(pack.description || ''),
        audio: Array.isArray(pack.audio)
          ? pack.audio
              .filter((a) => a && a.src)
              .map((a, audioIndex) => ({
                label: String(a.label || `Audio ${audioIndex + 1}`),
                src: String(a.src),
                durationLabel: String(a.durationLabel || ''),
              }))
          : [],
        phrases: Array.isArray(pack.phrases)
          ? pack.phrases
              .filter((p) => p && (p.english || p.indonesian))
              .map((p, phraseIndex) => ({
                idx: Number.isFinite(Number(p.idx)) ? Number(p.idx) : phraseIndex + 1,
                english: String(p.english || ''),
                indonesian: String(p.indonesian || ''),
                note: String(p.note || ''),
                tags: Array.isArray(p.tags) ? p.tags.map((tag) => String(tag)).filter(Boolean) : [],
              }))
          : [],
      }));
  }

  function renderLanguageAudioPackCard(pack) {
    const audioRows = pack.audio.length
      ? pack.audio.map((audio) => `
        <div class="lang-audio-player">
          <div class="lang-audio-player__meta">
            <strong>${escapeHtml(audio.label)}</strong>
            ${audio.durationLabel ? `<span>${escapeHtml(audio.durationLabel)}</span>` : ''}
          </div>
          <audio controls preload="metadata" src="${escapeHtml(audio.src)}"></audio>
        </div>
      `).join('')
      : '<p class="lang-audio-empty">No audio file configured yet.</p>';

    const phraseRows = pack.phrases.length
      ? pack.phrases.map((phrase) => `
        <li class="lang-phrase">
          <span class="lang-phrase__idx">${escapeHtml(phrase.idx)}</span>
          <span class="lang-phrase__text lang-phrase__text--id">${escapeHtml(phrase.indonesian)}</span>
          <span class="lang-phrase__text lang-phrase__text--en">${escapeHtml(phrase.english)}</span>
          ${phrase.note ? `<span class="lang-phrase__note">${escapeHtml(phrase.note)}</span>` : ''}
        </li>
      `).join('')
      : '<li class="lang-phrase lang-phrase--empty">No phrases configured.</li>';

    return `
      <article class="card lang-audio-card">
        <div class="lang-audio-card__head">
          <div>
            <p class="eyebrow">${escapeHtml(pack.language)} ⇄ ${escapeHtml(pack.sourceLanguage)}</p>
            <h2>${escapeHtml(pack.title)}</h2>
            ${pack.description ? `<p>${escapeHtml(pack.description)}</p>` : ''}
          </div>
          <span class="lang-audio-count">${pack.phrases.length} phrases</span>
        </div>
        <div class="lang-audio-players">${audioRows}</div>
        <details class="lang-audio-accordion">
          <summary>
            <span>Phrase spelling</span>
            <span>${pack.phrases.length} rows</span>
          </summary>
          <ol class="lang-phrase-list">${phraseRows}</ol>
        </details>
      </article>
    `;
  }

  function renderLanguageAudio() {
    if (!elLanguageAudio) return;
    const packs = getLanguageAudioPacks(config);
    const cards = packs.length
      ? packs.map(renderLanguageAudioPackCard).join('')
      : '<div class="booking-empty">No language audio packs configured yet.</div>';

    elLanguageAudio.innerHTML = `
      <header class="view-heading">
        <p class="eyebrow">Listen + verify spelling</p>
        <h1 id="language-audio-heading">Language Audio</h1>
        <p>Play each audio pack and open the phrase accordion to check Indonesian and English spelling on the site.</p>
      </header>
      <div class="lang-audio-grid">${cards}</div>
    `;
  }

  function allowedView(view) {
    return ['dashboard', 'travel', 'clocks', 'world', 'bookings', 'renewals', 'birthdays', 'fiscal', 'schedule', 'todos', 'fitness', 'language-audio'].includes(view);
  }

  function setView(view) {
    if (!allowedView(view)) view = 'dashboard';

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
      renewals: $('view-renewals'),
      birthdays: $('view-birthdays'),
      fiscal: $('view-fiscal'),
      schedule: $('view-schedule'),
      todos: $('view-todos'),
      fitness: $('view-fitness'),
      'language-audio': $('view-language-audio'),
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
    if (view === 'renewals') renderRenewals();
    if (view === 'birthdays') renderBirthdays();
    if (view === 'fiscal') renderFiscal();
    if (view === 'schedule') renderSchedule();
    if (view === 'todos') renderTodos();
    if (view === 'fitness') renderFitness();
    if (view === 'language-audio') renderLanguageAudio();
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
    elRenewals = $('renewals-mount');
    elBirthdays = $('birthdays-mount');
    elFiscal = $('fiscal-mount');
    elSchedule = $('schedule-mount');
    elTodos = $('todos-mount');
    elFitness = $('fitness-mount');
    elLanguageAudio = $('language-audio-mount');

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
    wireTodos();
    wireBirthdays();
    refreshAlertsChrome();

    let initial = (config.app && config.app.defaultView) || 'dashboard';
    try {
      const saved = localStorage.getItem(STORAGE_VIEW);
      if (allowedView(saved)) initial = saved;
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

  if (typeof window !== 'undefined') {
    window.__chronosTestApi = {
      collectFlightTrips,
      countryDaysInPeriod,
      deriveTravelLogFromFlights,
      getLongTermBookings,
      getVisibleAlerts,
      longTermRenewalAlerts,
      mergeDefaults,
      parseYmdToUtcMs,
      getLanguageAudioPacks,
      normalizeBirthday,
      sortBirthdays,
      birthdayNextInfo,
      renderLanguageAudioPackCard,
      normalizeTask,
      setTaskStatus,
      setTaskDone,
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
