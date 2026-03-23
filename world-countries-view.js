/**
 * World countries map: TopoJSON + d3.geo (globals: d3, topojson).
 * Mount with: ChronosWorldMap.mount(document.getElementById('world-mount'), config);
 */
(function (global) {
  'use strict';

  const STORAGE_WANT = 'chronos-gmt-map-show-want';
  const TOPO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

  /** Map atlas / config labels to a single comparison key (lowercase). */
  const SYNONYMS = {
    'united states of america': 'united states',
    usa: 'united states',
    'u.s.a.': 'united states',
    'u.s.': 'united states',
    gb: 'united kingdom',
    uk: 'united kingdom',
    'great britain': 'united kingdom',
    'check republic': 'czech republic',
    croacia: 'croatia',
    grece: 'greece',
    'new zeland': 'new zealand',
    'holy see': 'vatican',
    'vatican city': 'vatican',
    'russian federation': 'russia',
    'viet nam': 'vietnam',
    'czechia': 'czech republic',
    'korea, republic of': 'south korea',
    'iran (islamic republic of)': 'iran',
    'syrian arab republic': 'syria',
    'lao pdr': 'laos',
    'tanzania, united republic of': 'tanzania',
    'moldova, republic of': 'moldova',
    'venezuela (bolivarian republic of)': 'venezuela',
    'bolivia (plurinational state of)': 'bolivia',
    'brunei darussalam': 'brunei',
    "côte d'ivoire": 'ivory coast',
    'dem. rep. congo': 'democratic republic of the congo',
    'central african rep.': 'central african republic',
    'dominican rep.': 'dominican republic',
    'eq. guinea': 'equatorial guinea',
    'bosnia and herz.': 'bosnia and herzegovina',
    'w. sahara': 'western sahara',
    'cote divoire': 'ivory coast',
    'fr. s. antarctic lands': 'french southern and antarctic lands',
    'somaliland': 'somaliland',
    'n. cyprus': 'northern cyprus',
    'falkland is.': 'falkland islands',
    'solomon is.': 'solomon islands',
  };

  function norm(s) {
    return String(s || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function canon(s) {
    const n = norm(s);
    return SYNONYMS[n] || n;
  }

  function collectVisited(config) {
    const set = new Set();
    for (const st of config.travelLog || []) {
      if (st && st.country) set.add(canon(st.country));
    }
    for (const ev of config.travelTimeline || []) {
      if (ev && ev.country) set.add(canon(ev.country));
    }
    for (const c of config.countriesVisitedEver || []) {
      if (typeof c === 'string' && c.trim()) set.add(canon(c));
    }
    return set;
  }

  function collectWant(config) {
    const set = new Set();
    for (const c of config.countriesWantToVisit || []) {
      if (typeof c === 'string' && c.trim()) set.add(canon(c));
    }
    return set;
  }

  function countryClass(feature, visited, want) {
    const key = canon(feature.properties.name);
    if (visited.has(key)) return 'map-country map-country--visited';
    if (want.has(key)) return 'map-country map-country--want';
    return 'map-country map-country--default';
  }

  function prettyLabel(key) {
    return key.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function fillLists(el, visited, want) {
    const ulV = el.querySelector('#wm-list-visited');
    const ulW = el.querySelector('#wm-list-want');
    if (ulV) {
      const sorted = Array.from(visited).sort();
      ulV.innerHTML = sorted.map((k) => `<li>${prettyLabel(k)}</li>`).join('');
    }
    if (ulW) {
      const sorted = Array.from(want).sort();
      ulW.innerHTML = sorted.map((k) => `<li>${prettyLabel(k)}</li>`).join('');
    }
  }

  async function mount(el, config) {
    if (!el || !config) return;
    if (typeof d3 === 'undefined' || typeof topojson === 'undefined') {
      el.innerHTML =
        '<p class="world-map-view__error">Map libraries missing. Add d3 and topojson-client before this script.</p>';
      return;
    }

    const visited = collectVisited(config);
    const want = collectWant(config);

    el.innerHTML = `
      <div class="world-map-view">
        <h1 id="world-countries-heading" class="world-map-view__h1">Countries</h1>
        <header class="world-map-view__intro">
          <p class="world-map-view__lede">
            Visited countries are taken from your travel log and timeline, plus optional <code>countriesVisitedEver</code> in config.
            Wishlist countries come from <code>countriesWantToVisit</code>.
          </p>
          <label class="world-map-view__toggle">
            <input type="checkbox" id="world-map-show-want" checked />
            <span>Show wishlist on map</span>
          </label>
        </header>
        <div class="world-map-view__map card" id="world-map-svg-wrap" aria-busy="true">
          <p class="world-map-view__loading">Loading map…</p>
        </div>
        <div class="world-map-view__lists">
          <section class="world-map-view__list-panel card" aria-labelledby="wm-visited-h">
            <h2 id="wm-visited-h" class="world-map-view__list-title">Visited (${visited.size})</h2>
            <ul class="world-map-view__list" id="wm-list-visited"></ul>
          </section>
          <section class="world-map-view__list-panel card" aria-labelledby="wm-want-h">
            <h2 id="wm-want-h" class="world-map-view__list-title">Want to visit (${want.size})</h2>
            <ul class="world-map-view__list" id="wm-list-want"></ul>
          </section>
        </div>
      </div>`;

    fillLists(el, visited, want);

    const wrap = el.querySelector('#world-map-svg-wrap');
    const chk = el.querySelector('#world-map-show-want');

    try {
      const saved = localStorage.getItem(STORAGE_WANT);
      if (saved === '0') {
        chk.checked = false;
        wrap.classList.add('world-map-view__map--hide-want');
      }
    } catch {
      /* ignore */
    }

    chk.addEventListener('change', () => {
      wrap.classList.toggle('world-map-view__map--hide-want', !chk.checked);
      try {
        localStorage.setItem(STORAGE_WANT, chk.checked ? '1' : '0');
      } catch {
        /* ignore */
      }
    });

    let topology;
    try {
      const res = await fetch(TOPO_URL);
      if (!res.ok) throw new Error(String(res.status));
      topology = await res.json();
    } catch (e) {
      wrap.innerHTML = `<p class="world-map-view__error">Could not load map data (${e.message}). Check network or host <code>countries-110m.json</code> locally.</p>`;
      return;
    }

    const countriesObj = topology.objects.countries;
    const fc = topojson.feature(topology, countriesObj);

    const width = 960;
    const height = 500;
    const projection = d3.geoNaturalEarth1().fitSize([width, height], fc);
    const path = d3.geoPath(projection);

    const svg = d3
      .create('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('class', 'world-map-svg')
      .attr('role', 'img')
      .attr('aria-label', 'World map: visited and wishlist countries');

    for (const f of fc.features) {
      if (!f.properties || !f.properties.name) continue;
      const cls = countryClass(f, visited, want);
      svg
        .append('path')
        .attr('class', cls)
        .attr('d', path(f))
        .attr('data-country', f.properties.name)
        .attr('title', f.properties.name);
    }

    wrap.innerHTML = '';
    wrap.appendChild(svg.node());
    wrap.setAttribute('aria-busy', 'false');
  }

  global.ChronosWorldMap = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
