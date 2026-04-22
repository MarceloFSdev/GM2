/**
 * World countries map: TopoJSON + d3.geo (globals: d3, topojson).
 * Mount with: ChronosWorldMap.mount(document.getElementById('world-mount'), config);
 */
(function (global) {
  'use strict';

  const STORAGE_WANT = 'chronos-gmt-map-show-want';
  const TOPO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

  /** ISO 3166-1 numeric → alpha-2 (flags). Source: ISO country codes dataset. */
  const ISO_NUMERIC_TO_ALPHA2 = JSON.parse(
    '{"4":"AF","8":"AL","10":"AQ","12":"DZ","16":"AS","20":"AD","24":"AO","28":"AG","31":"AZ","32":"AR","36":"AU","40":"AT","44":"BS","48":"BH","50":"BD","51":"AM","52":"BB","56":"BE","60":"BM","64":"BT","68":"BO","70":"BA","72":"BW","74":"BV","76":"BR","84":"BZ","86":"IO","90":"SB","92":"VG","96":"BN","100":"BG","104":"MM","108":"BI","112":"BY","116":"KH","120":"CM","124":"CA","132":"CV","136":"KY","140":"CF","144":"LK","148":"TD","152":"CL","156":"CN","158":"TW","162":"CX","166":"CC","170":"CO","174":"KM","175":"YT","178":"CG","180":"CD","184":"CK","188":"CR","191":"HR","192":"CU","196":"CY","203":"CZ","204":"BJ","208":"DK","212":"DM","214":"DO","218":"EC","222":"SV","226":"GQ","231":"ET","232":"ER","233":"EE","234":"FO","238":"FK","239":"GS","242":"FJ","246":"FI","248":"AX","250":"FR","254":"GF","258":"PF","260":"TF","262":"DJ","266":"GA","268":"GE","270":"GM","275":"PS","276":"DE","288":"GH","292":"GI","296":"KI","300":"GR","304":"GL","308":"GD","312":"GP","316":"GU","320":"GT","324":"GN","328":"GY","332":"HT","334":"HM","336":"VA","340":"HN","344":"HK","348":"HU","352":"IS","356":"IN","360":"ID","364":"IR","368":"IQ","372":"IE","376":"IL","380":"IT","384":"CI","388":"JM","392":"JP","398":"KZ","400":"JO","404":"KE","408":"KP","410":"KR","414":"KW","417":"KG","418":"LA","422":"LB","426":"LS","428":"LV","430":"LR","434":"LY","438":"LI","440":"LT","442":"LU","446":"MO","450":"MG","454":"MW","458":"MY","462":"MV","466":"ML","470":"MT","474":"MQ","478":"MR","480":"MU","484":"MX","492":"MC","496":"MN","498":"MD","499":"ME","500":"MS","504":"MA","508":"MZ","512":"OM","516":"NA","520":"NR","524":"NP","528":"NL","531":"CW","533":"AW","534":"SX","535":"BQ","540":"NC","548":"VU","554":"NZ","558":"NI","562":"NE","566":"NG","570":"NU","574":"NF","578":"NO","580":"MP","581":"UM","583":"FM","584":"MH","585":"PW","586":"PK","591":"PA","598":"PG","600":"PY","604":"PE","608":"PH","612":"PN","616":"PL","620":"PT","624":"GW","626":"TL","630":"PR","634":"QA","638":"RE","642":"RO","643":"RU","646":"RW","652":"BL","654":"SH","659":"KN","660":"AI","662":"LC","663":"MF","666":"PM","670":"VC","674":"SM","678":"ST","682":"SA","686":"SN","688":"RS","690":"SC","694":"SL","702":"SG","703":"SK","704":"VN","705":"SI","706":"SO","710":"ZA","716":"ZW","724":"ES","728":"SS","729":"SD","732":"EH","740":"SR","744":"SJ","748":"SZ","752":"SE","756":"CH","760":"SY","762":"TJ","764":"TH","768":"TG","772":"TK","776":"TO","780":"TT","784":"AE","788":"TN","792":"TR","795":"TM","796":"TC","798":"TV","800":"UG","804":"UA","807":"MK","818":"EG","826":"GB","831":"GG","832":"JE","833":"IM","834":"TZ","840":"US","850":"VI","854":"BF","858":"UY","860":"UZ","862":"VE","876":"WF","882":"WS","887":"YE","894":"ZM"}'
  );

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
    'united states of america': 'united states',
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

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  function flagEmoji(alpha2) {
    if (!alpha2 || alpha2.length !== 2) return '';
    const upper = String(alpha2).toUpperCase();
    if (!/^[A-Z]{2}$/.test(upper)) return '';
    const base = 0x1f1e6;
    try {
      return String.fromCodePoint(base + upper.charCodeAt(0) - 65, base + upper.charCodeAt(1) - 65);
    } catch {
      return '';
    }
  }

  function alpha2ForFeature(f) {
    const idNum = parseInt(f.id, 10);
    if (Number.isNaN(idNum)) return '';
    return ISO_NUMERIC_TO_ALPHA2[idNum] || '';
  }

  function buildMetaByCanon(fc) {
    const map = new Map();
    for (const f of fc.features) {
      if (!f.properties || !f.properties.name) continue;
      const key = canon(f.properties.name);
      if (!map.has(key)) {
        map.set(key, { alpha2: alpha2ForFeature(f), atlasName: f.properties.name });
      }
    }
    return map;
  }

  function fillLists(el, visited, want, metaByCanon) {
    const ulV = el.querySelector('#wm-list-visited');
    const ulW = el.querySelector('#wm-list-want');
    function rowHtml(k) {
      const meta = metaByCanon.get(k);
      const flag = flagEmoji(meta && meta.alpha2);
      const flagHtml = flag
        ? `<span class="world-map-view__flag" aria-hidden="true">${flag}</span>`
        : '<span class="world-map-view__flag world-map-view__flag--empty" aria-hidden="true"></span>';
      return `<li class="world-map-view__list-item" data-country-key="${escapeHtml(k)}">${flagHtml}<span class="world-map-view__country-name">${escapeHtml(prettyLabel(k))}</span></li>`;
    }
    if (ulV) {
      const sorted = Array.from(visited).sort();
      ulV.innerHTML = sorted.map(rowHtml).join('');
    }
    if (ulW) {
      const sorted = Array.from(want).sort();
      ulW.innerHTML = sorted.map(rowHtml).join('');
    }
  }

  function clearMapSpotlight(svgNode) {
    if (!svgNode) return;
    svgNode.querySelectorAll('path.map-country--spotlight').forEach((p) => p.classList.remove('map-country--spotlight'));
  }

  function setMapSpotlight(svgNode, countryKey) {
    if (!svgNode) return;
    clearMapSpotlight(svgNode);
    if (!countryKey) return;
    svgNode.querySelectorAll('path.map-country').forEach((p) => {
      if (p.getAttribute('data-country-key') === countryKey) {
        p.classList.add('map-country--spotlight');
        const parent = p.parentNode;
        if (parent) parent.appendChild(p);
      }
    });
  }

  function wireListMapHover(el, mapWrap) {
    const svg = mapWrap && mapWrap.querySelector('.world-map-svg');
    if (!svg) return;
    el.querySelectorAll('#wm-list-visited li, #wm-list-want li').forEach((li) => {
      li.addEventListener('mouseenter', () => {
        setMapSpotlight(svg, li.getAttribute('data-country-key'));
      });
    });
    el.querySelectorAll('#wm-list-visited, #wm-list-want').forEach((ul) => {
      ul.addEventListener('mouseleave', () => clearMapSpotlight(svg));
    });
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
        <div class="world-map-view__body">
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
        </div>
      </div>`;

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
    const metaByCanon = buildMetaByCanon(fc);

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
      const key = canon(f.properties.name);
      svg
        .append('path')
        .attr('class', cls)
        .attr('d', path(f))
        .attr('data-country', f.properties.name)
        .attr('data-country-key', key)
        .attr('title', f.properties.name);
    }

    wrap.innerHTML = '';
    wrap.appendChild(svg.node());
    wrap.setAttribute('aria-busy', 'false');

    fillLists(el, visited, want, metaByCanon);
    wireListMapHover(el, wrap);
  }

  global.ChronosWorldMap = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
