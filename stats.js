/* ============================================================
   STATYSTYKI — silnik pokrycia rynków (football-data.co.uk)

   Dlaczego nie TheSportsDB: darmowy klucz "123" obcina każdą
   odpowiedź do 3 rekordów (terminarz) i 5 pozycji statystyk
   (same strzały). Rożnych, kartek i fauli tam po prostu nie ma.

   football-data.co.uk daje w jednym pliku CSV cały sezon ligi
   z kompletem: gole, gole do przerwy, strzały, strzały celne,
   faule, rożne, żółte i czerwone kartki oraz kursy zamknięcia.
   Bez klucza, bez limitów zapytań.

   Serwis nie wysyła nagłówka CORS, więc pliki idą przez proxy:
   najpierw lokalne (node server.js), a gdy go nie ma — publiczne
   z automatycznym przełączaniem.
   ============================================================ */

/* ---------- KATALOG LIG ---------- */

/* Pliki mmz4281 — pełny zestaw statystyk meczowych. */
const MAIN_LEAGUES = [
  { id: 'E0', country: 'Anglia', name: 'Premier League' },
  { id: 'E1', country: 'Anglia', name: 'Championship' },
  { id: 'E2', country: 'Anglia', name: 'League One' },
  { id: 'E3', country: 'Anglia', name: 'League Two' },
  { id: 'EC', country: 'Anglia', name: 'National League' },
  { id: 'SC0', country: 'Szkocja', name: 'Premiership' },
  { id: 'SC1', country: 'Szkocja', name: 'Championship' },
  { id: 'SC2', country: 'Szkocja', name: 'League One' },
  { id: 'SC3', country: 'Szkocja', name: 'League Two' },
  { id: 'D1', country: 'Niemcy', name: 'Bundesliga' },
  { id: 'D2', country: 'Niemcy', name: '2. Bundesliga' },
  { id: 'I1', country: 'Włochy', name: 'Serie A' },
  { id: 'I2', country: 'Włochy', name: 'Serie B' },
  { id: 'SP1', country: 'Hiszpania', name: 'La Liga' },
  { id: 'SP2', country: 'Hiszpania', name: 'La Liga 2' },
  { id: 'F1', country: 'Francja', name: 'Ligue 1' },
  { id: 'F2', country: 'Francja', name: 'Ligue 2' },
  { id: 'N1', country: 'Holandia', name: 'Eredivisie' },
  { id: 'B1', country: 'Belgia', name: 'Jupiler Pro League' },
  { id: 'P1', country: 'Portugalia', name: 'Liga Portugal' },
  { id: 'T1', country: 'Turcja', name: 'Süper Lig' },
  { id: 'G1', country: 'Grecja', name: 'Super League' }
];

/* Pliki new/ — jeden plik = pełna historia ligi, ale tylko gole i kursy. */
const EXTRA_LEAGUES = [
  { id: 'POL', country: 'Polska', name: 'Ekstraklasa' },
  { id: 'ARG', country: 'Argentyna', name: 'Liga Profesional' },
  { id: 'AUT', country: 'Austria', name: 'Bundesliga' },
  { id: 'BRA', country: 'Brazylia', name: 'Serie A' },
  { id: 'CHN', country: 'Chiny', name: 'Super League' },
  { id: 'DNK', country: 'Dania', name: 'Superliga' },
  { id: 'FIN', country: 'Finlandia', name: 'Veikkausliiga' },
  { id: 'IRL', country: 'Irlandia', name: 'Premier Division' },
  { id: 'JPN', country: 'Japonia', name: 'J1 League' },
  { id: 'MEX', country: 'Meksyk', name: 'Liga MX' },
  { id: 'NOR', country: 'Norwegia', name: 'Eliteserien' },
  { id: 'ROU', country: 'Rumunia', name: 'Liga I' },
  { id: 'RUS', country: 'Rosja', name: 'Premier Liga' },
  { id: 'SWE', country: 'Szwecja', name: 'Allsvenskan' },
  { id: 'SWZ', country: 'Szwajcaria', name: 'Super League' },
  { id: 'USA', country: 'USA', name: 'MLS' }
];

/* Drużyna po awansie ma krótką historię w swojej lidze — dobieramy
   mecze z ligi sąsiedniej, żeby okno 20 spotkań miało pokrycie. */
const RELATED_DIVISIONS = {
  E0: ['E1'], E1: ['E0', 'E2'], E2: ['E1', 'E3'], E3: ['E2', 'EC'], EC: ['E3'],
  SC0: ['SC1'], SC1: ['SC0', 'SC2'], SC2: ['SC1', 'SC3'], SC3: ['SC2'],
  D1: ['D2'], D2: ['D1'], I1: ['I2'], I2: ['I1'],
  SP1: ['SP2'], SP2: ['SP1'], F1: ['F2'], F2: ['F1']
};

const LEAGUE_BY_ID = new Map([...MAIN_LEAGUES.map(l => [l.id, { ...l, kind: 'main' }]),
  ...EXTRA_LEAGUES.map(l => [l.id, { ...l, kind: 'extra' }])]);

/* ---------- PROXY ---------- */

const UPSTREAM = 'https://www.football-data.co.uk';
const PROXIES = [
  { id: 'local', label: 'lokalne proxy (server.js)', build: (_url, target) => `api/fd/csv?path=${encodeURIComponent(target)}` },
  { id: 'allorigins', label: 'allorigins.win', build: url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` },
  { id: 'codetabs', label: 'codetabs.com', build: url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}` },
  { id: 'jina', label: 'r.jina.ai', build: url => `https://r.jina.ai/${url}` }
];

/* ---------- STAŁE ---------- */

const CACHE_KEY = 'lifeos_fd_cache_v1';
const PREFS_KEY = 'lifeos_stats_prefs_v1';
const CACHE_BUDGET = 3_500_000;
const WINDOWS = [5, 10, 20];
const TTL = { fixtures: 30 * 60 * 1000, season: 12 * 60 * 60 * 1000 };
const CARD_POINTS = { yellow: 10, red: 25 };

/* Kolejność pól w kompaktowym zapisie cache — nie zmieniać bez bumpu CACHE_KEY. */
const FIELDS = ['ts', 'home', 'away', 'fthg', 'ftag', 'hthg', 'htag', 'hs', 'as', 'hst', 'ast',
  'hf', 'af', 'hc', 'ac', 'hy', 'ay', 'hr', 'ar', 'oh', 'od', 'oa', 'oOver', 'oUnder'];

/* ---------- STAN ---------- */

const state = {
  leagueId: 'E0',
  seasons: 3,
  venueSplit: false,
  focusWindow: 10,
  matches: [],
  teams: [],
  fixtures: [],
  analysis: null,
  proxy: null,
  busy: false,
  loadedLabel: ''
};

let cache = {};

/* ---------- NARZĘDZIA ---------- */

const el = id => document.getElementById(id);
const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const num = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const fmtPct = (value, dp = 0) => Number.isFinite(value) ? `${(value * 100).toFixed(dp)}%` : '—';
const fmtNum = (value, dp = 2) => Number.isFinite(value) ? value.toFixed(dp) : '—';
const fmtLine = value => String(value).replace('.', ',');
const fairOdds = value => Number.isFinite(value) && value > 0.001 ? (1 / value).toFixed(2) : '—';
const fmtDate = ts => new Date(ts).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: '2-digit' });

function toast(message, kind = '') {
  const node = document.createElement('div');
  node.className = `tc-toast ${kind}`;
  node.textContent = message;
  el('toasts').appendChild(node);
  setTimeout(() => node.remove(), 3800);
}

function mean(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

/* Kody sezonów football-data: 2526 = 2025/26. Nowy sezon liczymy od lipca. */
function seasonCodes(count) {
  const now = new Date();
  const first = now.getUTCFullYear() - (now.getUTCMonth() < 6 ? 1 : 0);
  return Array.from({ length: count }, (_, i) => {
    const start = first - i;
    return `${String(start).slice(2)}${String(start + 1).slice(2)}`;
  });
}

function parseDate(value, time) {
  const match = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;
  const [, d, m, y] = match;
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const clock = String(time || '').match(/^(\d{1,2}):(\d{2})/);
  return Date.UTC(year, Number(m) - 1, Number(d), clock ? Number(clock[1]) : 12, clock ? Number(clock[2]) : 0);
}

/* Parser CSV z obsługą cudzysłowów — nazwy sędziów bywają cytowane. */
function parseCsv(text) {
  const clean = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (clean[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (char !== '\r') field += char;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows.shift().map(name => name.trim());
  return rows
    .filter(cells => cells.some(cell => cell.trim() !== ''))
    .map(cells => Object.fromEntries(header.map((name, i) => [name, (cells[i] ?? '').trim()])));
}

/* ---------- CACHE PRZEGLĄDARKI ---------- */

function loadCache() {
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch { cache = {}; }
}

function saveCache() {
  try {
    let payload = JSON.stringify(cache);
    while (payload.length > CACHE_BUDGET) {
      const oldest = Object.entries(cache).sort((a, b) => a[1].ts - b[1].ts)[0];
      if (!oldest) break;
      delete cache[oldest[0]];
      payload = JSON.stringify(cache);
    }
    localStorage.setItem(CACHE_KEY, payload);
  } catch { /* brak miejsca w localStorage nie może psuć analizy */ }
}

const packMatch = match => FIELDS.map(field => match[field] ?? null);
const unpackMatch = tuple => Object.fromEntries(FIELDS.map((field, i) => [field, tuple[i]]));

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    Object.assign(state, {
      leagueId: LEAGUE_BY_ID.has(saved.leagueId) ? saved.leagueId : state.leagueId,
      seasons: [1, 2, 3, 4].includes(saved.seasons) ? saved.seasons : state.seasons,
      venueSplit: Boolean(saved.venueSplit),
      focusWindow: WINDOWS.includes(saved.focusWindow) ? saved.focusWindow : state.focusWindow,
      proxy: saved.proxy || null
    });
  } catch { /* domyślne ustawienia wystarczą */ }
}

function savePrefs() {
  const { leagueId, seasons, venueSplit, focusWindow, proxy } = state;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ leagueId, seasons, venueSplit, focusWindow, proxy })); } catch { /* opcjonalne */ }
}

/* ---------- POBIERANIE ---------- */

async function fetchWithTimeout(url, ms = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try { return await fetch(url, { signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

/* Proxy potrafi dokleić preambułę (r.jina.ai) — tniemy do nagłówka CSV. */
function unwrapCsv(text) {
  const start = text.search(/^(?:﻿)?(Div|Country),/m);
  return start > 0 ? text.slice(start) : text;
}

function looksLikeCsv(text) {
  return /^(?:﻿)?(Div|Country),/m.test(text);
}

async function fetchCsv(target) {
  const url = `${UPSTREAM}/${target}`;
  const ordered = state.proxy
    ? [...PROXIES.filter(p => p.id === state.proxy), ...PROXIES.filter(p => p.id !== state.proxy)]
    : PROXIES;
  const problems = [];
  for (const proxy of ordered) {
    try {
      const response = await fetchWithTimeout(proxy.build(url, target));
      if (!response.ok) {
        /* 404 to brak sezonu u źródła, a nie wina proxy — nie próbujemy dalej. */
        if (response.status === 404) return null;
        problems.push(`${proxy.label}: HTTP ${response.status}`);
        continue;
      }
      const text = unwrapCsv(await response.text());
      if (!looksLikeCsv(text)) { problems.push(`${proxy.label}: odpowiedź nie jest plikiem CSV`); continue; }
      if (state.proxy !== proxy.id) { state.proxy = proxy.id; savePrefs(); }
      renderProxyBadge();
      return text;
    } catch (error) {
      problems.push(`${proxy.label}: ${error.name === 'AbortError' ? 'przekroczony czas' : error.message}`);
    }
  }
  throw new Error(`Nie udało się pobrać ${target}. Próby — ${problems.join('; ')}`);
}

async function getMatches(target, ttl) {
  const hit = cache[target];
  if (hit && Date.now() - hit.ts < ttl) return hit.rows.map(unpackMatch);
  const text = await fetchCsv(target);
  if (text === null) { cache[target] = { ts: Date.now(), rows: [] }; saveCache(); return []; }
  const rows = parseCsv(text).map(normalizeRow).filter(Boolean);
  cache[target] = { ts: Date.now(), rows: rows.map(packMatch) };
  saveCache();
  return rows;
}

/* ---------- NORMALIZACJA ---------- */

const firstNum = (row, keys) => {
  for (const key of keys) { const value = num(row[key]); if (value !== null) return value; }
  return null;
};

/* Kursy: najpierw zamknięcia (kolumny z C), potem otwarcia. */
const ODDS_HOME = ['PSCH', 'AvgCH', 'B365CH', 'MaxCH', 'PSH', 'AvgH', 'B365H', 'MaxH'];
const ODDS_DRAW = ['PSCD', 'AvgCD', 'B365CD', 'MaxCD', 'PSD', 'AvgD', 'B365D', 'MaxD'];
const ODDS_AWAY = ['PSCA', 'AvgCA', 'B365CA', 'MaxCA', 'PSA', 'AvgA', 'B365A', 'MaxA'];
const ODDS_OVER = ['PC>2.5', 'AvgC>2.5', 'B365C>2.5', 'P>2.5', 'Avg>2.5', 'B365>2.5'];
const ODDS_UNDER = ['PC<2.5', 'AvgC<2.5', 'B365C<2.5', 'P<2.5', 'Avg<2.5', 'B365<2.5'];

function normalizeRow(row) {
  const home = (row.HomeTeam || row.Home || '').trim();
  const away = (row.AwayTeam || row.Away || '').trim();
  const ts = parseDate(row.Date, row.Time);
  const fthg = num(row.FTHG ?? row.HG);
  const ftag = num(row.FTAG ?? row.AG);
  if (!home || !away || ts === null || fthg === null || ftag === null) return null;
  return {
    ts, home, away, fthg, ftag,
    hthg: num(row.HTHG), htag: num(row.HTAG),
    hs: num(row.HS), as: num(row.AS), hst: num(row.HST), ast: num(row.AST),
    hf: num(row.HF), af: num(row.AF), hc: num(row.HC), ac: num(row.AC),
    hy: num(row.HY), ay: num(row.AY), hr: num(row.HR), ar: num(row.AR),
    oh: firstNum(row, ODDS_HOME), od: firstNum(row, ODDS_DRAW), oa: firstNum(row, ODDS_AWAY),
    oOver: firstNum(row, ODDS_OVER), oUnder: firstNum(row, ODDS_UNDER)
  };
}

function normalizeFixture(row) {
  const home = (row.HomeTeam || row.Home || '').trim();
  const away = (row.AwayTeam || row.Away || '').trim();
  const ts = parseDate(row.Date, row.Time);
  if (!home || !away || ts === null) return null;
  return {
    div: (row.Div || '').trim(), ts, home, away, time: (row.Time || '').trim(),
    oh: firstNum(row, ODDS_HOME), od: firstNum(row, ODDS_DRAW), oa: firstNum(row, ODDS_AWAY),
    oOver: firstNum(row, ODDS_OVER), oUnder: firstNum(row, ODDS_UNDER)
  };
}

/* ---------- PERSPEKTYWA DRUŻYNY ---------- */

/* Jeden mecz widziany oczami jednej drużyny — wszystkie metryki
   sprowadzone do trójki: zdobyte / stracone / suma w meczu. */
function perspective(match, team) {
  const home = match.home === team;
  const side = (h, a) => {
    if (h === null || a === null) return { f: null, a: null, t: null };
    return { f: home ? h : a, a: home ? a : h, t: h + a };
  };
  const goals = side(match.fthg, match.ftag);
  const half = side(match.hthg, match.htag);
  const shots = side(match.hs, match.as);
  const target = side(match.hst, match.ast);
  const corners = side(match.hc, match.ac);
  const fouls = side(match.hf, match.af);
  const yellow = side(match.hy, match.ay);
  const red = side(match.hr, match.ar);
  const points = (y, r) => (y === null && r === null) ? null : (y ?? 0) * CARD_POINTS.yellow + (r ?? 0) * CARD_POINTS.red;
  const cardsFor = points(yellow.f, red.f);
  const cardsAgainst = points(yellow.a, red.a);

  return {
    ts: match.ts,
    venue: home ? 'H' : 'A',
    opponent: home ? match.away : match.home,
    score: `${match.fthg}:${match.ftag}`,
    gf: goals.f, ga: goals.a, gt: goals.t,
    htf: half.f, hta: half.a, htt: half.t,
    sf: shots.f, sa: shots.a, st: shots.t,
    tf: target.f, ta: target.a, tt: target.t,
    cf: corners.f, ca: corners.a, ct: corners.t,
    ff: fouls.f, fa: fouls.a, ft: fouls.t,
    yf: yellow.f, ya: yellow.a, yt: yellow.t,
    rf: red.f, ra: red.a, rt: red.t,
    pf: cardsFor, pa: cardsAgainst,
    pt: cardsFor === null || cardsAgainst === null ? null : cardsFor + cardsAgainst,
    won: goals.f > goals.a, drew: goals.f === goals.a, lost: goals.f < goals.a,
    btts: goals.f > 0 && goals.a > 0,
    clean: goals.a === 0, blank: goals.f === 0,
    raw: match
  };
}

/* ---------- REJESTR RYNKÓW ---------- */

/* Każda grupa opisuje jedną rodzinę statystyk: klucze perspektywy
   dla sumy w meczu / zdobytych / straconych + linie do sprawdzenia. */
const GROUPS = [
  {
    id: 'gole', label: 'Gole', icon: 'sports_soccer', probe: 'gt',
    rows: [
      { key: 'gt', scope: 'match', label: 'Gole w meczu', lines: [0.5, 1.5, 2.5, 3.5, 4.5] },
      { key: 'gf', scope: 'team', label: 'Gole strzelone', lines: [0.5, 1.5, 2.5] },
      { key: 'ga', scope: 'team', label: 'Gole stracone', lines: [0.5, 1.5, 2.5] },
      { key: 'htt', scope: 'match', label: 'Gole do przerwy', lines: [0.5, 1.5, 2.5] }
    ]
  },
  {
    id: 'rozne', label: 'Rzuty rożne', icon: 'flag', probe: 'ct',
    rows: [
      { key: 'ct', scope: 'match', label: 'Rożne w meczu', lines: [7.5, 8.5, 9.5, 10.5, 11.5, 12.5] },
      { key: 'cf', scope: 'team', label: 'Rożne drużyny', lines: [2.5, 3.5, 4.5, 5.5, 6.5] },
      { key: 'ca', scope: 'team', label: 'Rożne rywala', lines: [2.5, 3.5, 4.5, 5.5, 6.5] }
    ]
  },
  {
    id: 'kartki', label: 'Kartki', icon: 'style', probe: 'yt',
    rows: [
      { key: 'yt', scope: 'match', label: 'Żółte w meczu', lines: [1.5, 2.5, 3.5, 4.5, 5.5, 6.5] },
      { key: 'yf', scope: 'team', label: 'Żółte drużyny', lines: [0.5, 1.5, 2.5, 3.5] },
      { key: 'pt', scope: 'match', label: 'Punkty kartkowe', lines: [24.5, 34.5, 44.5, 54.5, 64.5] },
      { key: 'rt', scope: 'match', label: 'Czerwone w meczu', lines: [0.5] }
    ]
  },
  {
    id: 'strzaly', label: 'Strzały', icon: 'sports_handball', probe: 'st',
    rows: [
      { key: 'st', scope: 'match', label: 'Strzały w meczu', lines: [18.5, 20.5, 22.5, 24.5, 26.5, 28.5] },
      { key: 'sf', scope: 'team', label: 'Strzały drużyny', lines: [8.5, 10.5, 12.5, 14.5] },
      { key: 'tt', scope: 'match', label: 'Celne w meczu', lines: [5.5, 6.5, 7.5, 8.5, 9.5, 10.5] },
      { key: 'tf', scope: 'team', label: 'Celne drużyny', lines: [2.5, 3.5, 4.5, 5.5] }
    ]
  },
  {
    id: 'faule', label: 'Faule', icon: 'sports', probe: 'ft',
    rows: [
      { key: 'ft', scope: 'match', label: 'Faule w meczu', lines: [17.5, 19.5, 21.5, 23.5, 25.5] },
      { key: 'ff', scope: 'team', label: 'Faule drużyny', lines: [8.5, 10.5, 12.5, 14.5] }
    ]
  }
];

/* Rynki zerojedynkowe — bez linii, liczone tak samo jak pokrycie. */
const BOOLEAN_MARKETS = [
  { key: 'btts', label: 'Obie drużyny strzelą', no: 'Któraś drużyna nie strzeli', scope: 'match' },
  { key: 'won', label: 'Wygrana drużyny', no: 'Drużyna nie wygra', scope: 'team' },
  { key: 'lost', label: 'Porażka drużyny', no: 'Drużyna nie przegra', scope: 'team' },
  { key: 'drew', label: 'Remis', no: 'Rozstrzygnięcie', scope: 'match' },
  { key: 'clean', label: 'Czyste konto', no: 'Drużyna straci gola', scope: 'team' },
  { key: 'blank', label: 'Drużyna nie strzeli', no: 'Drużyna strzeli gola', scope: 'team' }
];

/* ---------- STATYSTYKA ---------- */

function coverage(records, key, predicate) {
  const values = records.map(record => record[key]).filter(value => value !== null && value !== undefined);
  if (!values.length) return null;
  const hits = values.filter(predicate).length;
  return { hits, n: values.length, p: hits / values.length };
}

const over = line => value => value > line;

/* Dolna granica przedziału Wilsona — kara za małą próbkę. */
function wilsonLower(hits, n, z = 1.282) {
  if (!n) return null;
  const p = hits / n, z2 = z * z;
  return clamp((p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n), 0, 1);
}

function poissonPmf(k, lambda) {
  if (!Number.isFinite(lambda) || lambda <= 0) return k === 0 ? 1 : 0;
  let value = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) value *= lambda / i;
  return value;
}

function poissonOver(lambda, line) {
  if (!Number.isFinite(lambda) || lambda < 0) return null;
  let cdf = 0;
  for (let k = 0; k <= Math.floor(line); k++) cdf += poissonPmf(k, lambda);
  return clamp(1 - cdf, 0, 1);
}

function outcomeProbs(lambdaHome, lambdaAway) {
  if (!Number.isFinite(lambdaHome) || !Number.isFinite(lambdaAway)) return { home: null, draw: null, away: null };
  let home = 0, draw = 0, away = 0;
  for (let i = 0; i <= 12; i++) {
    for (let j = 0; j <= 12; j++) {
      const p = poissonPmf(i, lambdaHome) * poissonPmf(j, lambdaAway);
      if (i > j) home += p; else if (i === j) draw += p; else away += p;
    }
  }
  const total = home + draw + away;
  return { home: home / total, draw: draw / total, away: away / total };
}

/* Kursy bukmachera zawierają marżę — normalizujemy do sumy 1. */
function devig(odds) {
  const valid = odds.filter(value => Number.isFinite(value) && value > 1);
  if (valid.length !== odds.length) return odds.map(() => null);
  const raw = odds.map(value => 1 / value);
  const total = raw.reduce((sum, value) => sum + value, 0);
  return raw.map(value => value / total);
}

function tone(p) {
  if (!Number.isFinite(p)) return 'empty';
  if (p >= 0.85) return 't6';
  if (p >= 0.7) return 't5';
  if (p >= 0.55) return 't4';
  if (p >= 0.4) return 't3';
  if (p >= 0.25) return 't2';
  return 't1';
}

/* ---------- WCZYTYWANIE LIGI ---------- */

function indexTeams(matches) {
  const set = new Set();
  for (const match of matches) { set.add(match.home); set.add(match.away); }
  return [...set].sort((a, b) => a.localeCompare(b, 'pl'));
}

async function loadDivision(id, seasons) {
  const league = LEAGUE_BY_ID.get(id);
  if (!league) return [];
  if (league.kind === 'extra') {
    const rows = await getMatches(`new/${id}.csv`, TTL.season);
    const cutoff = Date.now() - seasons * 400 * 24 * 60 * 60 * 1000;
    return rows.filter(match => match.ts >= cutoff);
  }
  const codes = seasonCodes(seasons);
  const batches = await Promise.all(codes.map(code => getMatches(`mmz4281/${code}/${id}.csv`, TTL.season).catch(() => [])));
  return batches.flat();
}

async function loadLeague() {
  if (state.busy) return;
  state.busy = true;
  el('load-league').disabled = true;
  renderLoadStatus('<span class="material-symbols-outlined spin">progress_activity</span>Pobieram dane ligi…');
  try {
    const matches = await loadDivision(state.leagueId, state.seasons);
    if (!matches.length) throw new Error('Źródło nie zwróciło żadnych rozegranych meczów dla tej ligi i zakresu sezonów.');
    state.matches = matches.sort((a, b) => b.ts - a.ts);
    state.teams = indexTeams(state.matches);
    state.analysis = null;
    const league = LEAGUE_BY_ID.get(state.leagueId);
    state.loadedLabel = `${league.country} · ${league.name}`;
    const oldest = state.matches[state.matches.length - 1];
    renderLoadStatus(`<span class="material-symbols-outlined ok">check_circle</span>
      <strong>${state.matches.length}</strong> meczów, <strong>${state.teams.length}</strong> drużyn
      · od ${fmtDate(oldest.ts)} do ${fmtDate(state.matches[0].ts)}`);
    await loadFixtures();
    renderTeamPickers();
    renderFixtures();
    renderAnalysis();
    setStep(2);
    el('step1-sub').textContent = state.loadedLabel;
  } catch (error) {
    renderLoadStatus(`<span class="material-symbols-outlined bad">error</span>${esc(error.message)}`);
    toast(error.message, 'err');
  } finally {
    state.busy = false;
    el('load-league').disabled = false;
  }
}

async function loadFixtures() {
  const league = LEAGUE_BY_ID.get(state.leagueId);
  if (league.kind !== 'main') { state.fixtures = []; return; }
  try {
    const hit = cache['fixtures.csv'];
    let rows;
    if (hit && Date.now() - hit.ts < TTL.fixtures) rows = hit.rows;
    else {
      const text = await fetchCsv('fixtures.csv');
      rows = text === null ? [] : parseCsv(text).map(normalizeFixture).filter(Boolean);
      cache['fixtures.csv'] = { ts: Date.now(), rows };
      saveCache();
    }
    state.fixtures = rows.filter(fixture => fixture.div === state.leagueId).sort((a, b) => a.ts - b.ts);
  } catch { state.fixtures = []; }
}

/* Drużyna po awansie/spadku ma za mało meczów — dobieramy z ligi sąsiedniej. */
async function topUpTeam(team, needed) {
  const related = RELATED_DIVISIONS[state.leagueId] || [];
  const extra = [];
  for (const div of related) {
    const rows = await loadDivision(div, state.seasons).catch(() => []);
    extra.push(...rows.filter(match => match.home === team || match.away === team));
    if (extra.length >= needed) break;
  }
  return extra;
}

/* ---------- ANALIZA ---------- */

async function buildAnalysis(homeTeam, awayTeam, fixture = null) {
  const maxWindow = Math.max(...WINDOWS);
  const forTeam = team => state.matches
    .filter(match => match.home === team || match.away === team)
    .map(match => perspective(match, team))
    .sort((a, b) => b.ts - a.ts);

  let home = forTeam(homeTeam);
  let away = forTeam(awayTeam);
  const borrowed = [];

  for (const [team, list, label] of [[homeTeam, home, 'home'], [awayTeam, away, 'away']]) {
    if (list.length >= maxWindow) continue;
    const extra = await topUpTeam(team, maxWindow - list.length);
    if (!extra.length) continue;
    const merged = [...list, ...extra.map(match => perspective(match, team))]
      .filter((record, index, all) => all.findIndex(other => other.ts === record.ts && other.opponent === record.opponent) === index)
      .sort((a, b) => b.ts - a.ts);
    if (label === 'home') home = merged; else away = merged;
    borrowed.push(team);
  }

  /* Filtr dom–wyjazd zawęża próbkę do meczów granych na tym samym terenie. */
  const homeRecs = state.venueSplit ? home.filter(record => record.venue === 'H') : home;
  const awayRecs = state.venueSplit ? away.filter(record => record.venue === 'A') : away;

  const h2h = state.matches
    .filter(match => (match.home === homeTeam && match.away === awayTeam) || (match.home === awayTeam && match.away === homeTeam))
    .map(match => perspective(match, homeTeam))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 10);

  return {
    homeTeam, awayTeam, fixture,
    home: homeRecs, away: awayRecs,
    homeAll: home, awayAll: away,
    borrowed, h2h,
    projections: projections(homeRecs, awayRecs)
  };
}

/* Oczekiwana wartość metryki = średnia z tego, co drużyna kreuje,
   i tego, na co pozwala rywal. Liczona na oknie 10 meczów. */
function projectPair(homeRecs, awayRecs, keyFor, keyAgainst, window = 10) {
  const h = homeRecs.slice(0, window), a = awayRecs.slice(0, window);
  const homeSide = mean([mean(h.map(r => r[keyFor])), mean(a.map(r => r[keyAgainst]))]);
  const awaySide = mean([mean(a.map(r => r[keyFor])), mean(h.map(r => r[keyAgainst]))]);
  if (!Number.isFinite(homeSide) || !Number.isFinite(awaySide)) return { home: null, away: null, total: null };
  return { home: homeSide, away: awaySide, total: homeSide + awaySide };
}

function projections(homeRecs, awayRecs) {
  return {
    goals: projectPair(homeRecs, awayRecs, 'gf', 'ga'),
    corners: projectPair(homeRecs, awayRecs, 'cf', 'ca'),
    yellow: projectPair(homeRecs, awayRecs, 'yf', 'ya'),
    points: projectPair(homeRecs, awayRecs, 'pf', 'pa'),
    shots: projectPair(homeRecs, awayRecs, 'sf', 'sa'),
    target: projectPair(homeRecs, awayRecs, 'tf', 'ta'),
    fouls: projectPair(homeRecs, awayRecs, 'ff', 'fa')
  };
}

/* Klucz metryki -> odpowiadająca projekcja, żeby model i pokrycie
   stały obok siebie w tej samej tabeli. */
const PROJECTION_FOR = {
  gt: a => a.projections.goals.total, gf: a => a.projections.goals.home, ga: a => a.projections.goals.away,
  ct: a => a.projections.corners.total, cf: a => a.projections.corners.home, ca: a => a.projections.corners.away,
  yt: a => a.projections.yellow.total, yf: a => a.projections.yellow.home,
  pt: a => a.projections.points.total,
  st: a => a.projections.shots.total, sf: a => a.projections.shots.home,
  tt: a => a.projections.target.total, tf: a => a.projections.target.home,
  ft: a => a.projections.fouls.total, ff: a => a.projections.fouls.home
};

/* Punkty kartkowe rosną skokowo — Poisson na nich kłamie, więc pomijamy model. */
const MODEL_BLACKLIST = new Set(['pt', 'rt', 'htt']);

function modelProb(analysis, key, line) {
  if (MODEL_BLACKLIST.has(key)) return null;
  const projector = PROJECTION_FOR[key];
  if (!projector) return null;
  return poissonOver(projector(analysis), line);
}

/* ---------- SKRÓT TYPÓW ---------- */

/* Kandydat trafia na listę tylko wtedy, gdy trzyma poziom w każdym
   oknie 5/10/20 — jednorazowa seria z pięciu meczów to za mało.
   Górny próg odcina zdarzenia niemal pewne: pokrycie 100% oznacza
   kurs godziwy 1,00, więc na taki rynek i tak nie ma jak zagrać. */
const CERTAINTY_CAP = 0.93;

function shortlist(analysis) {
  const picks = [];
  const push = (label, group, samples, modelP) => {
    const pooled = samples.pooled;
    if (!pooled || pooled.n < 8) return;
    const consistent = samples.windows.filter(w => w && w.n >= 3);
    if (consistent.length < 2) return;
    const worst = Math.min(...consistent.map(w => w.p));
    const lower = wilsonLower(pooled.hits, pooled.n);
    picks.push({ label, group, p: pooled.p, hits: pooled.hits, n: pooled.n, lower, worst, modelP });
  };

  /* Rynki drużynowe pooluje się z prób obu ekip — etykieta musi to mówić. */
  const scoped = (row, text) => row.scope === 'team' ? `${text} (każda z drużyn)` : text;

  for (const group of GROUPS) {
    if (!hasMetric(analysis, group.probe)) continue;
    for (const row of group.rows) {
      if (!hasMetric(analysis, row.key)) continue;
      for (const line of row.lines) {
        const pack = poolSamples(analysis, row, line);
        const model = modelProb(analysis, row.key, line);
        push(scoped(row, `${row.label} pow. ${fmtLine(line)}`), group.label, pack.over, model);
        push(scoped(row, `${row.label} pon. ${fmtLine(line)}`), group.label, pack.under, invert(model));
      }
    }
  }
  for (const market of BOOLEAN_MARKETS) {
    const pack = poolBoolean(analysis, market);
    push(scoped(market, market.label), 'Zdarzenia', pack.yes, null);
    push(scoped(market, market.no), 'Zdarzenia', pack.no, null);
  }

  return picks
    .filter(pick => pick.worst >= 0.5 && pick.lower >= 0.5 && pick.p <= CERTAINTY_CAP)
    .sort((a, b) => (b.lower - a.lower) || (b.worst - a.worst))
    .slice(0, 12);
}

const invert = p => Number.isFinite(p) ? 1 - p : null;

function mergeCoverage(a, b) {
  if (!a && !b) return null;
  const hits = (a?.hits || 0) + (b?.hits || 0);
  const n = (a?.n || 0) + (b?.n || 0);
  return n ? { hits, n, p: hits / n } : null;
}

const flipCoverage = c => c ? { hits: c.n - c.hits, n: c.n, p: 1 - c.p } : null;

/* Rynek "drużynowy" liczymy każdej ekipie z jej własnej perspektywy,
   "meczowy" — z obu prób, bo opisuje to samo zdarzenie. */
function poolSamples(analysis, row, line) {
  const window = state.focusWindow;
  const home = coverage(analysis.home.slice(0, window), row.key, over(line));
  const away = coverage(analysis.away.slice(0, window), row.key, over(line));
  const pooled = mergeCoverage(home, away);
  const windows = WINDOWS.map(size =>
    mergeCoverage(coverage(analysis.home.slice(0, size), row.key, over(line)),
      coverage(analysis.away.slice(0, size), row.key, over(line))));
  return {
    over: { pooled, windows },
    under: { pooled: flipCoverage(pooled), windows: windows.map(flipCoverage) }
  };
}

function poolBoolean(analysis, market) {
  const window = state.focusWindow;
  const pooled = mergeCoverage(
    coverage(analysis.home.slice(0, window), market.key, Boolean),
    coverage(analysis.away.slice(0, window), market.key, Boolean));
  const windows = WINDOWS.map(size => mergeCoverage(
    coverage(analysis.home.slice(0, size), market.key, Boolean),
    coverage(analysis.away.slice(0, size), market.key, Boolean)));
  return { yes: { pooled, windows }, no: { pooled: flipCoverage(pooled), windows: windows.map(flipCoverage) } };
}

function hasMetric(analysis, key) {
  return [...analysis.home, ...analysis.away].some(record => record[key] !== null && record[key] !== undefined);
}

/* ---------- RENDER: STEROWANIE ---------- */

function setStep(n) {
  document.querySelectorAll('.st-step').forEach(step => {
    const value = Number(step.dataset.step);
    step.classList.toggle('done', value < n);
    step.classList.toggle('active', value === n);
  });
}

function renderLoadStatus(html) { el('load-status').innerHTML = html; }

function renderProxyBadge() {
  const proxy = PROXIES.find(item => item.id === state.proxy);
  el('proxy-badge').innerHTML = proxy
    ? `<strong>${esc(proxy.id === 'local' ? 'Proxy lokalne' : 'Proxy publiczne')}</strong> · ${esc(proxy.label)}`
    : '<strong>football-data.co.uk</strong> · darmowe CSV';
}

function renderLeaguePicker() {
  const optionsFor = list => list.map(league =>
    `<option value="${esc(league.id)}" ${state.leagueId === league.id ? 'selected' : ''}>${esc(league.country)} — ${esc(league.name)}</option>`).join('');
  el('league-select').innerHTML =
    `<optgroup label="Pełna statystyka (rożne, kartki, strzały, faule)">${optionsFor(MAIN_LEAGUES)}</optgroup>` +
    `<optgroup label="Tylko gole i kursy">${optionsFor(EXTRA_LEAGUES)}</optgroup>`;
  el('season-select').value = String(state.seasons);
  el('venue-toggle').checked = state.venueSplit;
  document.querySelectorAll('#focus-seg button').forEach(button =>
    button.classList.toggle('active', Number(button.dataset.window) === state.focusWindow));
}

function renderTeamPickers() {
  const options = ['<option value="">— wybierz drużynę —</option>',
    ...state.teams.map(team => `<option value="${esc(team)}">${esc(team)}</option>`)].join('');
  el('home-select').innerHTML = options;
  el('away-select').innerHTML = options;
  el('custom-block').style.display = state.teams.length ? '' : 'none';
}

function fixtureBuckets() {
  const startOfDay = ts => { const d = new Date(ts); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
  const today = startOfDay(Date.now());
  const day = 24 * 60 * 60 * 1000;
  return [
    { id: 'today', label: 'Dziś', test: ts => startOfDay(ts) === today },
    { id: 'tomorrow', label: 'Jutro', test: ts => startOfDay(ts) === today + day },
    { id: 'week', label: 'Najbliższe 7 dni', test: ts => startOfDay(ts) > today + day && startOfDay(ts) <= today + 7 * day }
  ];
}

function renderFixtures() {
  const block = el('fixtures-block');
  const league = LEAGUE_BY_ID.get(state.leagueId);
  if (!state.matches.length) { block.style.display = 'none'; return; }
  block.style.display = '';

  if (league.kind !== 'main') {
    el('fixtures-body').innerHTML = `<div class="st-note"><span class="material-symbols-outlined">info</span>
      <span>Dla tej ligi źródło nie publikuje terminarza. Użyj <strong>własnego zestawienia</strong> poniżej — analiza działa dla dowolnej pary drużyn.</span></div>`;
    return;
  }
  if (!state.fixtures.length) {
    el('fixtures-body').innerHTML = `<div class="st-note"><span class="material-symbols-outlined">event_busy</span>
      <span>Plik <code>fixtures.csv</code> nie zawiera meczów tej ligi. Publikowany jest na ok. tydzień naprzód i bywa pusty w przerwie między sezonami — skorzystaj z <strong>własnego zestawienia</strong>.</span></div>`;
    return;
  }

  const buckets = fixtureBuckets().map(bucket => ({ ...bucket, list: state.fixtures.filter(fixture => bucket.test(fixture.ts)) }))
    .filter(bucket => bucket.list.length);
  if (!buckets.length) {
    el('fixtures-body').innerHTML = `<div class="st-note"><span class="material-symbols-outlined">event_busy</span>
      <span>Brak meczów w najbliższych 7 dniach (${state.fixtures.length} pozycji w pliku poza tym oknem).</span></div>`;
    return;
  }

  el('fixtures-body').innerHTML = buckets.map(bucket => `
    <div class="st-fx-group">
      <div class="st-fx-head"><strong>${esc(bucket.label)}</strong><span>${bucket.list.length} mecz(e)</span></div>
      <div class="tc-tbl-wrap">
        <table class="tc-tbl st-fx-tbl">
          <thead><tr><th>Data</th><th>Godz.</th><th>Gospodarz</th><th>Gość</th><th class="num">1</th><th class="num">X</th><th class="num">2</th><th class="num">pow. 2,5</th><th></th></tr></thead>
          <tbody>${bucket.list.map(fixture => `
            <tr>
              <td class="mono">${fmtDate(fixture.ts)}</td>
              <td class="mono">${esc(fixture.time || '—')}</td>
              <td><strong>${esc(fixture.home)}</strong></td>
              <td>${esc(fixture.away)}</td>
              <td class="num mono">${fmtNum(fixture.oh)}</td>
              <td class="num mono">${fmtNum(fixture.od)}</td>
              <td class="num mono">${fmtNum(fixture.oa)}</td>
              <td class="num mono">${fmtNum(fixture.oOver)}</td>
              <td><button class="st-btn primary" data-fixture="${esc(fixture.home)}|${esc(fixture.away)}">
                <span class="material-symbols-outlined">insights</span>Analizuj</button></td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`).join('');

  el('fixtures-body').querySelectorAll('[data-fixture]').forEach(button =>
    button.addEventListener('click', () => {
      const [home, away] = button.dataset.fixture.split('|');
      const fixture = state.fixtures.find(item => item.home === home && item.away === away) || null;
      runAnalysis(home, away, fixture);
    }));
}

/* ---------- RENDER: ANALIZA ---------- */

function coverageCell(sample, extraClass = '') {
  if (!sample) return '<td class="mx-td"><div class="mx empty"><span class="p">—</span></div></td>';
  const title = `${sample.hits} z ${sample.n} · dolna granica Wilsona ${fmtPct(wilsonLower(sample.hits, sample.n))} · kurs godziwy ${fairOdds(sample.p)}`;
  return `<td class="mx-td"><div class="mx ${tone(sample.p)} ${extraClass}" title="${esc(title)}">
    <span class="p">${fmtPct(sample.p)}</span><span class="h">${sample.hits}/${sample.n}</span></div></td>`;
}

function modelCell(p) {
  if (!Number.isFinite(p)) return '<td class="mx-td"><div class="mx empty"><span class="p">—</span></div></td>';
  return `<td class="mx-td"><div class="mx ${tone(p)} model" title="Model Poissona · kurs godziwy ${fairOdds(p)}">
    <span class="p">${fmtPct(p)}</span><span class="h">${fairOdds(p)}</span></div></td>`;
}

/* Pasek ostatnich 20 meczów: jedna kropka = jeden mecz, zapełniona = trafienie. */
function formStrip(records, key, predicate) {
  const dots = records.slice(0, 20).reverse().map(record => {
    const value = record[key];
    if (value === null || value === undefined) return '<i class="void"></i>';
    const hit = predicate(value);
    return `<i class="${hit ? 'hit' : 'miss'}" title="${fmtDate(record.ts)} ${record.venue === 'H' ? 'dom' : 'wyjazd'} vs ${esc(record.opponent)} · ${value}"></i>`;
  }).join('');
  return `<div class="st-form">${dots}</div>`;
}

function matrixRow(analysis, row, line) {
  const predicate = over(line);
  const cellFor = (records, size) => coverageCell(coverage(records.slice(0, size), row.key, predicate));
  const pooled = mergeCoverage(
    coverage(analysis.home.slice(0, state.focusWindow), row.key, predicate),
    coverage(analysis.away.slice(0, state.focusWindow), row.key, predicate));

  return `<tr>
    <td class="lbl">${esc(row.label)} <span class="ln">pow. ${fmtLine(line)}</span></td>
    ${WINDOWS.map(size => cellFor(analysis.home, size)).join('')}
    <td class="sep"></td>
    ${WINDOWS.map(size => cellFor(analysis.away, size)).join('')}
    <td class="sep"></td>
    ${coverageCell(pooled, 'pooled')}
    ${modelCell(modelProb(analysis, row.key, line))}
  </tr>`;
}

function buildMatrix(analysis, group) {
  if (!hasMetric(analysis, group.probe)) {
    return `<section class="tc-card st-group" id="grp-${group.id}">
      <div class="tc-card-head"><h3><span class="material-symbols-outlined">${group.icon}</span>${esc(group.label)}</h3></div>
      <div class="st-note warn"><span class="material-symbols-outlined">info</span>
        <span>Ta liga nie ma w źródle danych z tej kategorii — dostępne są tylko gole i kursy.</span></div>
    </section>`;
  }

  const rows = group.rows
    .filter(row => hasMetric(analysis, row.key))
    .map(row => row.lines.map(line => matrixRow(analysis, row, line)).join(''))
    .join('<tr class="gap"><td colspan="12"></td></tr>');

  return `<section class="tc-card st-group" id="grp-${group.id}">
    <div class="tc-card-head">
      <h3><span class="material-symbols-outlined">${group.icon}</span>${esc(group.label)}</h3>
      <span class="sub">pokrycie linii w oknach 5 / 10 / 20 meczów</span>
    </div>
    <div class="st-matrix-wrap">
      <table class="st-matrix">
        <thead>
          <tr class="grp">
            <th rowspan="2" class="lbl">Rynek</th>
            <th colspan="3">${esc(analysis.homeTeam)}</th>
            <th class="sep" rowspan="2"></th>
            <th colspan="3">${esc(analysis.awayTeam)}</th>
            <th class="sep" rowspan="2"></th>
            <th rowspan="2">Razem<br><small>2 × ost. ${state.focusWindow}</small></th>
            <th rowspan="2">Model<br><small>kurs godziwy</small></th>
          </tr>
          <tr>${WINDOWS.map(size => `<th>${size}</th>`).join('')}${WINDOWS.map(size => `<th>${size}</th>`).join('')}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${buildFormBlock(analysis, group)}
  </section>`;
}

/* Dla najciekawszej linii w grupie pokazujemy przebieg mecz po meczu. */
function buildFormBlock(analysis, group) {
  const row = group.rows.find(item => item.scope === 'match' && hasMetric(analysis, item.key));
  if (!row) return '';
  const line = row.lines[Math.floor(row.lines.length / 2)];
  return `<div class="st-form-block">
    <div class="st-form-title"><strong>${esc(row.label)} pow. ${fmtLine(line)}</strong><span>ostatnie 20 meczów, od najstarszego</span></div>
    <div class="st-form-row"><span class="tn">${esc(analysis.homeTeam)}</span>${formStrip(analysis.home, row.key, over(line))}</div>
    <div class="st-form-row"><span class="tn">${esc(analysis.awayTeam)}</span>${formStrip(analysis.away, row.key, over(line))}</div>
  </div>`;
}

function buildOutcomes(analysis) {
  const goals = analysis.projections.goals;
  const probs = outcomeProbs(goals.home, goals.away);
  const fixture = analysis.fixture;
  const market = fixture ? devig([fixture.oh, fixture.od, fixture.oa]) : [null, null, null];
  /* null + null daje w JS zero — bez tej straży brak kursu udawałby ogromną przewagę. */
  const add = (a, b) => Number.isFinite(a) && Number.isFinite(b) ? a + b : null;
  const items = [
    ['Wygrana gospodarza', probs.home, market[0], fixture?.oh],
    ['Remis', probs.draw, market[1], fixture?.od],
    ['Wygrana gościa', probs.away, market[2], fixture?.oa],
    ['Gospodarz nie przegra', add(probs.home, probs.draw), add(market[0], market[1]), null],
    ['Gość nie przegra', add(probs.away, probs.draw), add(market[2], market[1]), null]
  ];

  return `<section class="tc-card st-group" id="grp-wynik">
    <div class="tc-card-head"><h3><span class="material-symbols-outlined">emoji_events</span>Wynik meczu</h3>
      <span class="sub">model bramkowy${fixture ? ' vs kurs rynkowy' : ''}</span></div>
    <div class="st-matrix-wrap">
      <table class="st-matrix wide">
        <thead><tr><th class="lbl">Rynek</th><th>Model</th><th>Kurs godziwy</th><th>Rynek</th><th>Kurs bukmachera</th><th>Przewaga</th></tr></thead>
        <tbody>${items.map(([label, p, mp, odds]) => {
          const edge = Number.isFinite(p) && Number.isFinite(mp) ? p - mp : null;
          return `<tr>
            <td class="lbl">${esc(label)}</td>
            ${modelCell(p)}
            <td class="mono num">${fairOdds(p)}</td>
            <td class="mono num">${fmtPct(mp)}</td>
            <td class="mono num">${fmtNum(odds)}</td>
            <td class="mono num ${edge > 0.03 ? 'edge-pos' : edge < -0.03 ? 'edge-neg' : ''}">${Number.isFinite(edge) ? `${edge > 0 ? '+' : ''}${(edge * 100).toFixed(1)} pkt` : '—'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  </section>`;
}

function buildBooleanMatrix(analysis) {
  const rows = BOOLEAN_MARKETS.map(market => {
    const cellFor = (records, size) => coverageCell(coverage(records.slice(0, size), market.key, Boolean));
    const pooled = mergeCoverage(
      coverage(analysis.home.slice(0, state.focusWindow), market.key, Boolean),
      coverage(analysis.away.slice(0, state.focusWindow), market.key, Boolean));
    return `<tr>
      <td class="lbl">${esc(market.label)}</td>
      ${WINDOWS.map(size => cellFor(analysis.home, size)).join('')}
      <td class="sep"></td>
      ${WINDOWS.map(size => cellFor(analysis.away, size)).join('')}
      <td class="sep"></td>
      ${coverageCell(pooled, 'pooled')}
      <td class="mx-td"><div class="mx empty"><span class="p">—</span></div></td>
    </tr>`;
  }).join('');

  return `<section class="tc-card st-group" id="grp-zdarzenia">
    <div class="tc-card-head"><h3><span class="material-symbols-outlined">rule</span>Zdarzenia</h3>
      <span class="sub">rynki bez linii</span></div>
    <div class="st-matrix-wrap">
      <table class="st-matrix">
        <thead>
          <tr class="grp">
            <th rowspan="2" class="lbl">Rynek</th>
            <th colspan="3">${esc(analysis.homeTeam)}</th><th class="sep" rowspan="2"></th>
            <th colspan="3">${esc(analysis.awayTeam)}</th><th class="sep" rowspan="2"></th>
            <th rowspan="2">Razem<br><small>2 × ost. ${state.focusWindow}</small></th><th rowspan="2">Model</th>
          </tr>
          <tr>${WINDOWS.map(size => `<th>${size}</th>`).join('')}${WINDOWS.map(size => `<th>${size}</th>`).join('')}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`;
}

function buildShortlist(analysis) {
  const picks = shortlist(analysis);
  if (!picks.length) {
    return `<section class="tc-card"><div class="st-note"><span class="material-symbols-outlined">filter_alt_off</span>
      <span>Żaden rynek nie utrzymał pokrycia powyżej 50% we wszystkich oknach. To sam w sobie sygnał — ten mecz jest statystycznie niejednoznaczny.</span></div></section>`;
  }
  return `<section class="tc-card st-group">
    <div class="tc-card-head"><h3><span class="material-symbols-outlined">bolt</span>Skrót typów</h3>
      <span class="sub">rynki trzymające poziom w każdym oknie, ranking wg dolnej granicy Wilsona</span></div>
    <div class="st-rec-grid">${picks.map(pick => `
      <div class="st-rec ${tone(pick.lower)}">
        <span class="grp">${esc(pick.group)}</span>
        <strong>${esc(pick.label)}</strong>
        <span class="value">${fmtPct(pick.p)}</span>
        <small>${pick.hits}/${pick.n} trafień · konserwatywnie ${fmtPct(pick.lower)} · kurs godziwy ${fairOdds(pick.lower)}</small>
        ${Number.isFinite(pick.modelP) ? `<small class="model">model ${fmtPct(pick.modelP)}</small>` : ''}
      </div>`).join('')}</div>
  </section>`;
}

function buildLegend() {
  const steps = [['t1', 'do 25%'], ['t2', '25–40%'], ['t3', '40–55%'], ['t4', '55–70%'], ['t5', '70–85%'], ['t6', 'od 85%']];
  const swatch = { t1: '#fbe9e7', t2: '#fdf3e3', t3: '#f6f8fa', t4: '#eaf8f0', t5: '#dcf5e7', t6: '#c8efdb' };
  return `<section class="tc-card"><div class="st-legend">
    <span><strong>Pokrycie linii</strong></span>
    ${steps.map(([id, label]) => `<span class="item"><span class="sw" style="background:${swatch[id]}"></span>${label}</span>`).join('')}
    <span class="item">Duża liczba w komórce = procent trafień, mała = <em>trafienia / mecze w próbce</em>.</span>
  </div></section>`;
}

function buildProfiles(analysis) {
  const metrics = [
    ['Gole', 'gf', 'ga'], ['Rożne', 'cf', 'ca'], ['Strzały', 'sf', 'sa'],
    ['Celne', 'tf', 'ta'], ['Żółte', 'yf', 'ya'], ['Faule', 'ff', 'fa']
  ].filter(([, keyFor]) => hasMetric(analysis, keyFor));

  const column = (team, records) => `
    <div class="st-profile">
      <div class="st-profile-head">${esc(team)} <span>${records.length} meczów w próbce</span></div>
      <table class="st-profile-tbl">
        <thead><tr><th>Metryka</th><th>Zdobyte</th><th>Stracone</th><th>Suma</th></tr></thead>
        <tbody>${metrics.map(([label, keyFor, keyAgainst]) => {
          const window = records.slice(0, state.focusWindow);
          const forAvg = mean(window.map(record => record[keyFor]));
          const againstAvg = mean(window.map(record => record[keyAgainst]));
          return `<tr><td class="lbl">${esc(label)}</td>
            <td class="mono num">${fmtNum(forAvg, 2)}</td>
            <td class="mono num">${fmtNum(againstAvg, 2)}</td>
            <td class="mono num strong">${Number.isFinite(forAvg) && Number.isFinite(againstAvg) ? (forAvg + againstAvg).toFixed(2) : '—'}</td></tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;

  return `<section class="tc-card st-group" id="grp-profile">
    <div class="tc-card-head"><h3><span class="material-symbols-outlined">contrast</span>Profile drużyn</h3>
      <span class="sub">średnie na mecz z ostatnich ${state.focusWindow} spotkań</span></div>
    <div class="st-profiles">${column(analysis.homeTeam, analysis.home)}${column(analysis.awayTeam, analysis.away)}</div>
  </section>`;
}

function buildH2H(analysis) {
  if (!analysis.h2h.length) return '';
  return `<section class="tc-card st-group" id="grp-h2h">
    <div class="tc-card-head"><h3><span class="material-symbols-outlined">swap_horiz</span>Bezpośrednie starcia</h3>
      <span class="sub">${analysis.h2h.length} ostatnich meczów w tej lidze</span></div>
    <div class="tc-tbl-wrap">
      <table class="tc-tbl">
        <thead><tr><th>Data</th><th>Teren</th><th>Wynik</th><th class="num">Gole</th><th class="num">Rożne</th><th class="num">Żółte</th><th class="num">Strzały</th></tr></thead>
        <tbody>${analysis.h2h.map(record => `<tr>
          <td class="mono">${fmtDate(record.ts)}</td>
          <td>${record.venue === 'H' ? 'dom' : 'wyjazd'}</td>
          <td class="mono strong">${record.gf}:${record.ga}</td>
          <td class="num mono">${record.gt ?? '—'}</td>
          <td class="num mono">${record.ct ?? '—'}</td>
          <td class="num mono">${record.yt ?? '—'}</td>
          <td class="num mono">${record.st ?? '—'}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
  </section>`;
}

function buildHistory(analysis) {
  const table = (team, records) => `
    <details class="st-history">
      <summary><strong>${esc(team)}</strong><span>ostatnie ${Math.min(records.length, 20)} meczów — pełne dane</span></summary>
      <div class="tc-tbl-wrap">
        <table class="tc-tbl">
          <thead><tr><th>Data</th><th>T</th><th>Rywal</th><th>Wynik</th><th class="num">Rożne</th><th class="num">Żółte</th><th class="num">Strzały</th><th class="num">Celne</th><th class="num">Faule</th></tr></thead>
          <tbody>${records.slice(0, 20).map(record => `<tr>
            <td class="mono">${fmtDate(record.ts)}</td>
            <td>${record.venue === 'H' ? 'D' : 'W'}</td>
            <td>${esc(record.opponent)}</td>
            <td class="mono strong ${record.won ? 'win' : record.lost ? 'loss' : ''}">${record.gf}:${record.ga}</td>
            <td class="num mono">${record.cf ?? '—'}:${record.ca ?? '—'}</td>
            <td class="num mono">${record.yf ?? '—'}:${record.ya ?? '—'}</td>
            <td class="num mono">${record.sf ?? '—'}:${record.sa ?? '—'}</td>
            <td class="num mono">${record.tf ?? '—'}:${record.ta ?? '—'}</td>
            <td class="num mono">${record.ff ?? '—'}:${record.fa ?? '—'}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </details>`;
  return `<section class="tc-card st-group" id="grp-historia">
    <div class="tc-card-head"><h3><span class="material-symbols-outlined">history</span>Historia meczów</h3>
      <span class="sub">dane źródłowe stojące za macierzami</span></div>
    ${table(analysis.homeTeam, analysis.home)}${table(analysis.awayTeam, analysis.away)}
  </section>`;
}

function buildHero(analysis) {
  const p = analysis.projections;
  const tiles = [
    ['Gole', p.goals.total, 'sports_soccer'],
    ['Rożne', p.corners.total, 'flag'],
    ['Żółte', p.yellow.total, 'style'],
    ['Strzały', p.shots.total, 'sports_handball'],
    ['Celne', p.target.total, 'my_location'],
    ['Faule', p.fouls.total, 'sports']
  ].filter(([, value]) => Number.isFinite(value));

  const warnings = [];
  const minSample = Math.min(analysis.home.length, analysis.away.length);
  if (minSample < 20) warnings.push(`Mniejsza z prób ma ${minSample} meczów — kolumna „20” opiera się na tym, co jest dostępne.`);
  if (analysis.borrowed.length) warnings.push(`Historię uzupełniono meczami z ligi powiązanej dla: ${analysis.borrowed.join(', ')}.`);
  if (state.venueSplit) warnings.push('Filtr dom–wyjazd jest włączony: gospodarz liczony tylko z meczów u siebie, gość tylko z wyjazdowych.');

  return `<section class="tc-card">
    <div class="st-hero">
      <div class="st-hero-team"><div class="n">${esc(analysis.homeTeam)}</div><div class="s">gospodarz · ${analysis.home.length} meczów</div></div>
      <div class="st-hero-mid">
        <div class="k">Projekcja wyniku</div>
        <div class="lam">${fmtNum(analysis.projections.goals.home, 2)} – ${fmtNum(analysis.projections.goals.away, 2)}</div>
        ${analysis.fixture ? `<div class="odds">${fmtDate(analysis.fixture.ts)} ${esc(analysis.fixture.time || '')}</div>` : '<div class="odds">zestawienie własne</div>'}
      </div>
      <div class="st-hero-team away"><div class="n">${esc(analysis.awayTeam)}</div><div class="s">gość · ${analysis.away.length} meczów</div></div>
    </div>
    <div class="st-tiles">${tiles.map(([label, value, icon]) => `
      <div class="st-tile"><span class="material-symbols-outlined">${icon}</span>
        <div><div class="k">${esc(label)} w meczu</div><div class="v">${value.toFixed(2)}</div></div></div>`).join('')}</div>
    ${warnings.length ? `<div class="st-notes">${warnings.map(text => `<div class="st-note warn"><span class="material-symbols-outlined">info</span><span>${esc(text)}</span></div>`).join('')}</div>` : ''}
  </section>`;
}

function renderAnalysis() {
  const block = el('analysis-block');
  if (!state.analysis) { block.style.display = 'none'; return; }
  const analysis = state.analysis;
  block.style.display = '';
  el('analysis-desc').textContent = `${analysis.homeTeam} – ${analysis.awayTeam} · ${state.loadedLabel}`;

  const jump = [...GROUPS.map(group => ({ id: `grp-${group.id}`, label: group.label })),
    { id: 'grp-zdarzenia', label: 'Zdarzenia' }, { id: 'grp-wynik', label: 'Wynik' },
    { id: 'grp-profile', label: 'Profile' }, { id: 'grp-h2h', label: 'H2H' }, { id: 'grp-historia', label: 'Historia' }];

  el('analysis').innerHTML =
    buildHero(analysis) +
    `<div class="st-jump">${jump.map(item => `<a href="#${item.id}">${esc(item.label)}</a>`).join('')}</div>` +
    buildLegend() +
    buildShortlist(analysis) +
    GROUPS.map(group => buildMatrix(analysis, group)).join('') +
    buildBooleanMatrix(analysis) +
    buildOutcomes(analysis) +
    buildProfiles(analysis) +
    buildH2H(analysis) +
    buildHistory(analysis);
}

async function runAnalysis(homeTeam, awayTeam, fixture = null) {
  if (state.busy || !homeTeam || !awayTeam) return;
  if (homeTeam === awayTeam) { toast('Wybierz dwie różne drużyny', 'err'); return; }
  state.busy = true;
  el('analysis-block').style.display = '';
  el('analysis').innerHTML = `<section class="tc-card"><div class="tc-empty">
    <span class="material-symbols-outlined spin">progress_activity</span><h4>Liczę macierze…</h4>
    <p>Składam pokrycie linii dla obu drużyn.</p></div></section>`;
  try {
    state.analysis = await buildAnalysis(homeTeam, awayTeam, fixture);
    el('home-select').value = homeTeam;
    el('away-select').value = awayTeam;
    setStep(4);
    el('step3-sub').textContent = `${homeTeam} – ${awayTeam}`;
    el('step4-sub').textContent = `${state.analysis.home.length} / ${state.analysis.away.length} meczów`;
    renderAnalysis();
    el('analysis-block').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    state.analysis = null;
    el('analysis').innerHTML = `<section class="tc-card"><div class="tc-empty">
      <span class="material-symbols-outlined">error</span><h4>Nie udało się policzyć</h4><p>${esc(error.message)}</p></div></section>`;
    toast(error.message, 'err');
  } finally {
    state.busy = false;
  }
}

function refreshAnalysis() {
  if (!state.analysis) return;
  runAnalysis(state.analysis.homeTeam, state.analysis.awayTeam, state.analysis.fixture);
}

/* ---------- START ---------- */

async function detectLocalProxy() {
  try {
    const response = await fetchWithTimeout('api/fd/health', 4000);
    if (response.ok) { state.proxy = 'local'; savePrefs(); }
  } catch { /* brak lokalnego proxy — zadziała łańcuch publicznych */ }
  renderProxyBadge();
}

function clearCache() {
  cache = {};
  try { localStorage.removeItem(CACHE_KEY); } catch { /* nic nie szkodzi */ }
  fetch('api/fd/purge').catch(() => {});
  toast('Cache wyczyszczony — kolejne pobranie pójdzie do źródła');
}

function init() {
  loadPrefs();
  loadCache();
  renderLeaguePicker();
  renderProxyBadge();
  setStep(1);
  document.querySelectorAll('.sidebar__link[data-page]').forEach(link =>
    link.classList.toggle('sidebar__link--active', link.dataset.page === 'stats'));

  el('league-select').addEventListener('change', event => { state.leagueId = event.target.value; savePrefs(); });
  el('season-select').addEventListener('change', event => { state.seasons = Number(event.target.value); savePrefs(); });
  el('load-league').addEventListener('click', loadLeague);
  el('venue-toggle').addEventListener('change', event => { state.venueSplit = event.target.checked; savePrefs(); refreshAnalysis(); });
  el('focus-seg').querySelectorAll('button').forEach(button =>
    button.addEventListener('click', () => {
      state.focusWindow = Number(button.dataset.window);
      renderLeaguePicker();
      savePrefs();
      renderAnalysis();
    }));
  el('analyse-custom').addEventListener('click', () => {
    setStep(3);
    runAnalysis(el('home-select').value, el('away-select').value, null);
  });
  el('swap-teams').addEventListener('click', () => {
    const home = el('home-select').value;
    el('home-select').value = el('away-select').value;
    el('away-select').value = home;
  });
  el('clear-cache-btn').addEventListener('click', clearCache);

  detectLocalProxy();
}

document.addEventListener('DOMContentLoaded', init);
