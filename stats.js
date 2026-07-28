/* ============================================================
   STATYSTYKI — pomoc przy budowaniu kuponów
   Źródło: API-Football (v3.football.api-sports.io)

   Zasady:
   - Nic nie łączy się samo. Każde zapytanie wymaga kliknięcia.
   - Każda odpowiedź ląduje w cache (localStorage), więc powrót
     do raz przeanalizowanego meczu nic nie kosztuje.
   - Klucz API trzymany wyłącznie w przeglądarce użytkownika.

   Ograniczenia planu Free, które kształtują ten moduł:
   - terminarz tylko wczoraj / dziś / jutro,
   - parametr `season` zablokowany na sezony 2022–2024, więc pełnej
     formy z bieżącego sezonu nie da się pobrać wprost; średnie
     sezonowe bierzemy z /predictions (1 zapytanie na mecz),
   - 100 zapytań na dobę, 10 na minutę.
   ============================================================ */

const API_BASE = 'https://v3.football.api-sports.io';
const KEY_STORE = 'lifeos_stats_apikey';
const CACHE_STORE = 'lifeos_stats_cache_v1';
const USAGE_STORE = 'lifeos_stats_usage_v1';
const DAILY_LIMIT = 100;

const TTL = {
  fixtures: 30 * 60 * 1000,        // terminarz dnia — wyniki się zmieniają
  predictions: 6 * 60 * 60 * 1000, // forma drużyn — zmienia się powoli
  statistics: Infinity             // mecz rozegrany nie zmieni już statystyk
};

let apiKey = '';
let cache = {};
let usage = { day: '', count: 0 };

let dayOffset = 0;
let fixtures = [];          // wszystkie mecze pobranego dnia
let leagues = [];           // pogrupowane ligi
let selectedLeagueId = null;
let selectedFixture = null;
let analysis = null;        // wynik analizy wybranego meczu
let leagueFilter = '';
let busy = false;

/* ============================================================
   Narzędzia
   ============================================================ */
const el = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = (v, f = 0) => { const n = Number(v); return Number.isFinite(n) ? n : f; };
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

function todayISO(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}
function fmtPct(p, dp = 0) {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—';
  return (p * 100).toFixed(dp) + '%';
}
function fairOdds(p) {
  if (!Number.isFinite(p) || p <= 0) return '—';
  return (1 / p).toFixed(2);
}
function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'tc-toast ' + kind;
  t.textContent = msg;
  el('toasts').appendChild(t);
  setTimeout(() => t.remove(), 3400);
}

/* ============================================================
   Klucz, cache i licznik zapytań
   ============================================================ */
function loadStores() {
  try { apiKey = localStorage.getItem(KEY_STORE) || ''; } catch { apiKey = ''; }
  try { cache = JSON.parse(localStorage.getItem(CACHE_STORE) || '{}') || {}; } catch { cache = {}; }
  try { usage = JSON.parse(localStorage.getItem(USAGE_STORE) || 'null') || { day: '', count: 0 }; } catch { usage = { day: '', count: 0 }; }
  const d = todayISO();
  if (usage.day !== d) usage = { day: d, count: 0 };
}
function saveCache() {
  try { localStorage.setItem(CACHE_STORE, JSON.stringify(cache)); }
  catch {
    // przy przepełnieniu localStorage wyrzucamy najstarsze wpisy
    const entries = Object.entries(cache).sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < Math.ceil(entries.length / 2); i++) delete cache[entries[i][0]];
    try { localStorage.setItem(CACHE_STORE, JSON.stringify(cache)); } catch { }
  }
}
function bumpUsage() {
  usage.count += 1;
  localStorage.setItem(USAGE_STORE, JSON.stringify(usage));
  renderQuota();
}
function remainingQuota() { return Math.max(DAILY_LIMIT - usage.count, 0); }

function renderQuota() {
  const used = usage.count;
  const pct = clamp(used / DAILY_LIMIT * 100, 0, 100);
  el('quota-bar').style.width = pct + '%';
  el('quota-text').innerHTML = `<strong>${used}</strong> / ${DAILY_LIMIT}`;
  const box = el('quota');
  box.className = 'st-quota' + (used >= DAILY_LIMIT ? ' bad' : used >= DAILY_LIMIT * 0.8 ? ' warn' : '');
  box.title = `Zużyto ${used} z ${DAILY_LIMIT} zapytań w dobie (licznik lokalny, resetuje się o północy).`;
}

function cacheKey(path) { return path; }
function cacheGet(path, ttl) {
  const hit = cache[cacheKey(path)];
  if (!hit) return null;
  if (ttl !== Infinity && Date.now() - hit.ts > ttl) return null;
  return hit.data;
}
function cacheSet(path, data) {
  cache[cacheKey(path)] = { ts: Date.now(), data };
  saveCache();
}

/* ============================================================
   Warstwa API
   ============================================================ */
class ApiError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; }
}

async function apiGet(path, ttl, { force = false } = {}) {
  if (!force) {
    const cached = cacheGet(path, ttl);
    if (cached) return { data: cached, cached: true };
  }
  if (!apiKey) throw new ApiError('Brak klucza API. Dodaj go w „Klucz API”.', 'key');
  if (remainingQuota() <= 0) throw new ApiError(`Wyczerpany dzienny limit ${DAILY_LIMIT} zapytań. Licznik zeruje się o północy.`, 'quota');

  let res;
  try {
    res = await fetch(`${API_BASE}/${path}`, { headers: { 'x-apisports-key': apiKey } });
  } catch {
    throw new ApiError('Brak połączenia z API. Sprawdź internet.', 'network');
  }
  bumpUsage();

  if (res.status === 429) throw new ApiError('Przekroczony limit zapytań na minutę (10). Odczekaj chwilę i spróbuj ponownie.', 'rate');
  if (res.status === 499 || res.status === 401 || res.status === 403) throw new ApiError('Klucz API odrzucony. Sprawdź go w ustawieniach.', 'key');
  if (!res.ok) throw new ApiError(`API zwróciło błąd ${res.status}.`, 'http');

  const json = await res.json();
  const errs = json.errors;
  if (errs && !Array.isArray(errs) && Object.keys(errs).length) {
    const msg = Object.values(errs).join(' ');
    const kind = errs.plan ? 'plan' : errs.token ? 'key' : errs.requests ? 'quota' : 'api';
    throw new ApiError(msg, kind);
  }
  cacheSet(path, json);
  return { data: json, cached: false };
}

/* ============================================================
   Matematyka: rozkład Poissona
   ============================================================ */
function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}
// P(X > threshold) dla progu typu 2.5 → P(X >= 3)
function pOver(lambda, threshold) {
  if (!Number.isFinite(lambda) || lambda <= 0) return null;
  const maxK = Math.floor(threshold);
  let cdf = 0;
  for (let k = 0; k <= maxK; k++) cdf += poissonPmf(k, lambda);
  return clamp(1 - cdf, 0, 1);
}
function pAtLeastOne(lambda) {
  if (!Number.isFinite(lambda) || lambda <= 0) return null;
  return 1 - Math.exp(-lambda);
}
// wynik 1 / X / 2 z dwóch niezależnych rozkładów Poissona
function outcomeProbs(lh, la, maxGoals = 12) {
  let home = 0, draw = 0, away = 0;
  for (let i = 0; i <= maxGoals; i++) {
    for (let j = 0; j <= maxGoals; j++) {
      const p = poissonPmf(i, lh) * poissonPmf(j, la);
      if (i > j) home += p; else if (i === j) draw += p; else away += p;
    }
  }
  const tot = home + draw + away || 1;
  return { home: home / tot, draw: draw / tot, away: away / tot };
}

/* ============================================================
   Wyliczanie oczekiwanych goli ze średnich sezonowych
   ============================================================ */
function avg(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function teamGoalModel(t) {
  const lg = t?.league?.goals || {};
  return {
    forHome: avg(lg.for?.average?.home),
    forAway: avg(lg.for?.average?.away),
    forTotal: avg(lg.for?.average?.total),
    againstHome: avg(lg.against?.average?.home),
    againstAway: avg(lg.against?.average?.away),
    againstTotal: avg(lg.against?.average?.total),
    played: num(t?.league?.fixtures?.played?.total, 0),
    form: t?.league?.form || '',
    minutes: lg.for?.minute || null
  };
}
function expectedGoals(home, away) {
  const h = teamGoalModel(home), a = teamGoalModel(away);
  const pick = (...vals) => { for (const v of vals) if (v !== null && v > 0) return v; return null; };

  // atak gospodarza u siebie vs obrona gościa na wyjeździe
  const hAtt = pick(h.forHome, h.forTotal);
  const aDef = pick(a.againstAway, a.againstTotal);
  const aAtt = pick(a.forAway, a.forTotal);
  const hDef = pick(h.againstHome, h.againstTotal);

  const blend = (x, y) => {
    if (x !== null && y !== null) return (x + y) / 2;
    return x !== null ? x : (y !== null ? y : null);
  };
  return {
    home: blend(hAtt, aDef),
    away: blend(aAtt, hDef),
    sample: Math.min(h.played, a.played),
    homeModel: h,
    awayModel: a
  };
}
// udział goli padających do przerwy (z rozkładu minutowego obu drużyn)
function firstHalfShare(h, a) {
  const buckets = ['0-15', '16-30', '31-45'];
  const grab = m => {
    if (!m) return null;
    let first = 0, total = 0;
    for (const [k, v] of Object.entries(m)) {
      const t = num(v?.total, 0);
      total += t;
      if (buckets.includes(k)) first += t;
    }
    return total > 0 ? first / total : null;
  };
  const sh = grab(h.minutes), sa = grab(a.minutes);
  if (sh === null && sa === null) return 0.45; // typowy udział, gdy brak danych
  if (sh === null) return sa;
  if (sa === null) return sh;
  return (sh + sa) / 2;
}

/* ============================================================
   Empiria z meczów bezpośrednich
   ============================================================ */
function h2hSample(h2h, homeId, awayId) {
  return (h2h || [])
    .filter(m => m?.fixture?.status?.short === 'FT' && m.goals?.home !== null && m.goals?.away !== null)
    .map(m => {
      const isHomeOurs = m.teams.home.id === homeId;
      const gh = num(m.goals.home), ga = num(m.goals.away);
      return {
        id: m.fixture.id,
        date: m.fixture.date.slice(0, 10),
        homeName: m.teams.home.name,
        awayName: m.teams.away.name,
        gh, ga,
        total: gh + ga,
        ourHome: isHomeOurs ? gh : ga,   // gole drużyny, która dziś gra u siebie
        ourAway: isHomeOurs ? ga : gh,
        btts: gh > 0 && ga > 0
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}
function empiricalOver(values, threshold) {
  const vals = values.filter(v => Number.isFinite(v));
  if (!vals.length) return null;
  const hits = vals.filter(v => v > threshold).length;
  return { p: hits / vals.length, hits, n: vals.length };
}

/* ============================================================
   Definicje rynków
   ============================================================ */
const GOAL_LINES = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
const TEAM_GOAL_LINES = [0.5, 1.5, 2.5, 3.5];
const CORNER_LINES = [6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5];
const TEAM_CORNER_LINES = [2.5, 3.5, 4.5, 5.5, 6.5];
const SHOT_LINES = [15.5, 17.5, 19.5, 21.5, 23.5, 25.5];
const SHOT_ON_LINES = [5.5, 6.5, 7.5, 8.5, 9.5, 10.5];
const CARD_LINES = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5];
const FOUL_LINES = [17.5, 19.5, 21.5, 23.5, 25.5, 27.5];

const STAT_MAP = {
  'Corner Kicks': 'corners',
  'Total Shots': 'shots',
  'Shots on Goal': 'shotsOn',
  'Yellow Cards': 'yellow',
  'Red Cards': 'red',
  'Fouls': 'fouls'
};

/* ============================================================
   Analiza meczu
   ============================================================ */
async function analyseFixture(fx, { force = false } = {}) {
  const { data } = await apiGet(`predictions?fixture=${fx.fixture.id}`, TTL.predictions, { force });
  const r = (data.response || [])[0];
  if (!r) throw new ApiError('API nie zwróciło danych dla tego meczu.', 'api');

  const homeId = fx.teams.home.id, awayId = fx.teams.away.id;
  const lam = expectedGoals(r.teams.home, r.teams.away);
  const sample = h2hSample(r.h2h, homeId, awayId);

  return {
    fixture: fx,
    raw: r,
    lambdaHome: lam.home,
    lambdaAway: lam.away,
    lambdaTotal: (lam.home ?? 0) + (lam.away ?? 0),
    models: { home: lam.homeModel, away: lam.awayModel },
    seasonSample: lam.sample,
    fhShare: firstHalfShare(lam.homeModel, lam.awayModel),
    h2h: sample,
    advice: r.predictions?.advice || null,
    underOver: r.predictions?.under_over || null,
    percent: r.predictions?.percent || null,
    stats: null            // uzupełniane osobnym przyciskiem
  };
}

// Statystyki szczegółowe z meczów bezpośrednich (rożne, strzały, kartki)
async function fetchH2HStats(a, onProgress) {
  const ids = a.h2h.slice(0, 8);
  const rows = [];
  let fetched = 0, failed = 0;

  for (let i = 0; i < ids.length; i++) {
    const m = ids[i];
    const path = `fixtures/statistics?fixture=${m.id}`;
    let payload = cacheGet(path, TTL.statistics);
    if (!payload) {
      if (remainingQuota() <= 0) { failed++; break; }
      try {
        const res = await apiGet(path, TTL.statistics);
        payload = res.data;
        fetched++;
        if (i < ids.length - 1) await sleep(260);   // 10 zapytań/min
      } catch (e) {
        failed++;
        if (e.kind === 'rate' || e.kind === 'quota' || e.kind === 'key') break;
        continue;
      }
    }
    const teams = payload.response || [];
    if (teams.length < 2) continue;

    const per = teams.map(t => {
      const out = { teamId: t.team.id };
      for (const s of t.statistics || []) {
        const key = STAT_MAP[s.type];
        if (!key) continue;
        const v = typeof s.value === 'string' ? parseInt(s.value, 10) : s.value;
        // brak wartości zostaje nullem — inaczej mecz bez statystyk
        // zaniżałby średnią, udając same zera
        out[key] = Number.isFinite(v) ? v : null;
      }
      return out;
    });
    // suma obu drużyn tylko wtedy, gdy API podało dane choć dla jednej
    const sum = (...keys) => {
      let total = 0, any = false;
      for (const t of per) for (const k of keys) {
        if (Number.isFinite(t[k])) { total += t[k]; any = true; }
      }
      return any ? total : null;
    };

    rows.push({
      id: m.id, date: m.date,
      corners: sum('corners'),
      shots: sum('shots'),
      shotsOn: sum('shotsOn'),
      cards: sum('yellow', 'red'),
      fouls: sum('fouls')
    });
    if (onProgress) onProgress(i + 1, ids.length);
  }

  a.stats = { rows, fetched, failed, requested: ids.length };
  return a.stats;
}

/* ============================================================
   Budowa macierzy
   ============================================================ */
function tone(p) {
  if (p === null || !Number.isFinite(p)) return 'empty';
  if (p >= 0.80) return 't5';
  if (p >= 0.65) return 't4';
  if (p >= 0.45) return 't3';
  if (p >= 0.30) return 't2';
  return 't1';
}

function matrixCell(model, emp) {
  if (model === null && !emp) return `<td><div class="mx empty"><span class="p">—</span></div></td>`;
  const t = tone(model !== null ? model : emp.p);
  const title = model !== null
    ? `Model: ${fmtPct(model, 1)} (kurs godziwy ${fairOdds(model)})${emp ? ` · H2H: ${emp.hits}/${emp.n} = ${fmtPct(emp.p, 0)}` : ''}`
    : `H2H: ${emp.hits}/${emp.n} = ${fmtPct(emp.p, 0)}`;
  let h = '';
  if (emp) {
    const diff = model !== null && Math.abs(emp.p - model) > 0.22;
    h = `<span class="h ${diff ? 'diff' : ''}">${emp.hits}/${emp.n}</span>`;
  }
  return `<td><div class="mx ${t}" title="${esc(title)}">
    <span class="p">${model !== null ? fmtPct(model) : fmtPct(emp.p)}</span>${h}</div></td>`;
}

function matrixTable(title, sub, lines, rows) {
  return `<div class="st-matrix-title"><strong>${esc(title)}</strong><span class="sub">${esc(sub)}</span></div>
  <div class="st-matrix-wrap"><table class="st-matrix">
    <thead><tr><th>Rynek</th>${lines.map(l => `<th>pow. ${String(l).replace('.', ',')}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td class="lbl">${esc(r.label)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</td>
      ${lines.map((l, i) => matrixCell(r.model[i], r.emp ? r.emp[i] : null)).join('')}
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function buildGoalsMatrix(a) {
  const { lambdaHome: lh, lambdaAway: la, lambdaTotal: lt } = a;
  const s = a.h2h;
  const rows = [
    {
      label: 'Gole w meczu', sub: 'suma obu drużyn',
      model: GOAL_LINES.map(l => pOver(lt, l)),
      emp: GOAL_LINES.map(l => empiricalOver(s.map(m => m.total), l))
    },
    {
      label: `Gole: ${a.fixture.teams.home.name}`, sub: 'gospodarz',
      model: GOAL_LINES.map(l => (l <= 3.5 ? pOver(lh, l) : null)),
      emp: GOAL_LINES.map(l => (l <= 3.5 ? empiricalOver(s.map(m => m.ourHome), l) : null))
    },
    {
      label: `Gole: ${a.fixture.teams.away.name}`, sub: 'gość',
      model: GOAL_LINES.map(l => (l <= 3.5 ? pOver(la, l) : null)),
      emp: GOAL_LINES.map(l => (l <= 3.5 ? empiricalOver(s.map(m => m.ourAway), l) : null))
    },
    {
      label: 'Gole do przerwy', sub: `${fmtPct(a.fhShare, 0)} goli pada w 1. połowie`,
      model: GOAL_LINES.map(l => (l <= 2.5 ? pOver(lt * a.fhShare, l) : null)),
      emp: GOAL_LINES.map(() => null)
    }
  ];
  return matrixTable('Gole', `oczekiwane ${lt.toFixed(2)} gola · próbka H2H: ${s.length}`, GOAL_LINES, rows);
}

function buildStatsMatrix(a) {
  if (!a.stats || !a.stats.rows.length) return '';
  const rows = a.stats.rows;

  const section = (title, key, lines, unit) => {
    const vals = rows.map(r => r[key]).filter(v => Number.isFinite(v));
    if (!vals.length) {
      return `<div class="st-matrix-title"><strong>${esc(title)}</strong>
        <span class="sub">API nie ma tych statystyk dla żadnego z pobranych meczów</span></div>`;
    }
    const m = vals.reduce((s, v) => s + v, 0) / vals.length;
    return matrixTable(title, `średnia ${m.toFixed(1)} ${unit} · próbka ${vals.length} ${vals.length === 1 ? 'mecz' : 'meczów'}`, lines, [{
      label: title, sub: 'suma obu drużyn',
      model: lines.map(l => pOver(m, l)),
      emp: lines.map(l => empiricalOver(vals, l))
    }]);
  };

  return `
    ${section('Rożne', 'corners', CORNER_LINES, 'na mecz')}
    ${section('Strzały', 'shots', SHOT_LINES, 'na mecz')}
    ${section('Strzały celne', 'shotsOn', SHOT_ON_LINES, 'na mecz')}
    ${section('Kartki', 'cards', CARD_LINES, 'na mecz')}
    ${section('Faule', 'fouls', FOUL_LINES, 'na mecz')}`;
}

function buildExtraMarkets(a) {
  const { lambdaHome: lh, lambdaAway: la } = a;
  const oc = outcomeProbs(lh, la);
  const bttsModel = (pAtLeastOne(lh) ?? 0) * (pAtLeastOne(la) ?? 0);
  const bttsEmp = a.h2h.length ? { p: a.h2h.filter(m => m.btts).length / a.h2h.length, hits: a.h2h.filter(m => m.btts).length, n: a.h2h.length } : null;

  const items = [
    ['Obie drużyny strzelą', bttsModel, bttsEmp],
    ['Wygrana gospodarza', oc.home, a.h2h.length ? { p: a.h2h.filter(m => m.ourHome > m.ourAway).length / a.h2h.length, hits: a.h2h.filter(m => m.ourHome > m.ourAway).length, n: a.h2h.length } : null],
    ['Remis', oc.draw, a.h2h.length ? { p: a.h2h.filter(m => m.ourHome === m.ourAway).length / a.h2h.length, hits: a.h2h.filter(m => m.ourHome === m.ourAway).length, n: a.h2h.length } : null],
    ['Wygrana gościa', oc.away, a.h2h.length ? { p: a.h2h.filter(m => m.ourAway > m.ourHome).length / a.h2h.length, hits: a.h2h.filter(m => m.ourAway > m.ourHome).length, n: a.h2h.length } : null],
    ['Gospodarz nie przegra', oc.home + oc.draw, null],
    ['Gość nie przegra', oc.away + oc.draw, null]
  ];

  return `<div class="st-matrix-title"><strong>Rynki dodatkowe</strong><span class="sub">model Poissona z oczekiwanych goli</span></div>
  <div class="st-matrix-wrap"><table class="st-matrix">
    <thead><tr><th>Rynek</th><th>Pokrycie</th><th>Kurs godziwy</th><th>H2H</th></tr></thead>
    <tbody>${items.map(([label, p, emp]) => `<tr>
      <td class="lbl">${esc(label)}</td>
      <td><div class="mx ${tone(p)}"><span class="p">${fmtPct(p)}</span></div></td>
      <td><div class="mx t3"><span class="p">${fairOdds(p)}</span></div></td>
      <td><div class="mx ${emp ? tone(emp.p) : 'empty'}"><span class="p">${emp ? fmtPct(emp.p) : '—'}</span>${emp ? `<span class="h">${emp.hits}/${emp.n}</span>` : ''}</div></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

/* ============================================================
   Render
   ============================================================ */
function setStep(n) {
  document.querySelectorAll('.st-step').forEach(s => {
    const i = Number(s.dataset.step);
    s.classList.toggle('done', i < n);
    s.classList.toggle('active', i === n);
  });
}

function renderDayLabel() {
  const d = todayISO(dayOffset);
  const dt = new Date(d + 'T00:00:00');
  el('day-label').textContent = dt.toLocaleDateString('pl-PL', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function renderFixturesStatus(html) { el('fixtures-status').innerHTML = html; }

function groupLeagues(list) {
  const map = new Map();
  for (const f of list) {
    const id = f.league.id;
    if (!map.has(id)) map.set(id, { id, name: f.league.name, country: f.league.country, logo: f.league.logo, flag: f.league.flag, count: 0 });
    map.get(id).count += 1;
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.country.localeCompare(b.country, 'pl'));
}

function renderLeagues() {
  el('leagues-block').style.display = leagues.length ? '' : 'none';
  if (!leagues.length) return;
  const q = leagueFilter.trim().toLowerCase();
  const list = q ? leagues.filter(l => (l.name + ' ' + l.country).toLowerCase().includes(q)) : leagues;
  el('leagues-desc').textContent = `${leagues.length} lig · ${fixtures.length} meczów`;
  el('leagues').innerHTML = list.length ? list.map(l => `
    <button class="st-league ${selectedLeagueId === l.id ? 'active' : ''}" data-league="${l.id}">
      <img src="${esc(l.logo || l.flag || '')}" alt="" onerror="this.style.visibility='hidden'">
      <span class="t"><span class="n">${esc(l.name)}</span><span class="c">${esc(l.country)}</span></span>
      <span class="cnt">${l.count}</span>
    </button>`).join('')
    : `<div class="tc-empty" style="grid-column:1/-1"><span class="material-symbols-outlined">search_off</span><h4>Brak lig</h4><p>Zmień filtr.</p></div>`;

  el('leagues').querySelectorAll('.st-league').forEach(b =>
    b.addEventListener('click', () => selectLeague(Number(b.dataset.league))));
}

function statusTag(s) {
  const short = s.short;
  if (['1H', '2H', 'HT', 'ET', 'LIVE', 'P', 'BT'].includes(short)) return `<span class="st-status live">${short === 'HT' ? 'Przerwa' : 'Live ' + (s.elapsed ?? '') + "'"}</span>`;
  if (short === 'NS') return `<span class="st-status ns">Przed meczem</span>`;
  if (['FT', 'AET', 'PEN'].includes(short)) return `<span class="st-status ft">Zakończony</span>`;
  return `<span class="st-status">${esc(s.short)}</span>`;
}

function renderMatches() {
  const block = el('matches-block');
  if (!selectedLeagueId) { block.style.display = 'none'; return; }
  block.style.display = '';
  const list = fixtures.filter(f => f.league.id === selectedLeagueId)
    .sort((a, b) => a.fixture.timestamp - b.fixture.timestamp);
  const lg = leagues.find(l => l.id === selectedLeagueId);
  el('matches-desc').textContent = lg ? `${lg.name} · ${lg.country} · ${list.length} meczów` : '';

  el('matches').innerHTML = `<table class="tc-tbl">
    <thead><tr><th style="width:70px">Godz.</th><th>Gospodarz</th><th style="width:70px" class="num">Wynik</th><th>Gość</th><th style="width:120px">Status</th><th style="width:130px"></th></tr></thead>
    <tbody>${list.map(f => {
    const t = new Date(f.fixture.date);
    const active = selectedFixture && selectedFixture.fixture.id === f.fixture.id;
    const score = f.goals.home === null ? '—' : `${f.goals.home} : ${f.goals.away}`;
    return `<tr class="st-match-row ${active ? 'active' : ''}" data-fx="${f.fixture.id}">
        <td class="st-time">${t.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</td>
        <td><span class="st-team"><img src="${esc(f.teams.home.logo)}" alt="" onerror="this.style.visibility='hidden'"><span>${esc(f.teams.home.name)}</span></span></td>
        <td class="num mono">${score}</td>
        <td><span class="st-team"><img src="${esc(f.teams.away.logo)}" alt="" onerror="this.style.visibility='hidden'"><span>${esc(f.teams.away.name)}</span></span></td>
        <td>${statusTag(f.fixture.status)}</td>
        <td><button class="st-btn ${active ? 'primary' : ''}" style="height:30px;padding:0 12px;font-size:12px" data-analyse="${f.fixture.id}">
          <span class="material-symbols-outlined">insights</span>Analizuj</button></td>
      </tr>`;
  }).join('')}</tbody></table>`;

  el('matches').querySelectorAll('[data-analyse]').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); runAnalysis(Number(b.dataset.analyse)); }));
  el('matches').querySelectorAll('.st-match-row').forEach(r =>
    r.addEventListener('click', () => runAnalysis(Number(r.dataset.fx))));
}

function renderAnalysis() {
  const block = el('analysis-block');
  if (!analysis) { block.style.display = 'none'; return; }
  block.style.display = '';
  const a = analysis;
  const fx = a.fixture;
  el('analysis-desc').textContent = `${fx.teams.home.name} – ${fx.teams.away.name}`;

  const hm = a.models.home, am = a.models.away;
  const smallSample = a.seasonSample < 5;
  const noH2H = a.h2h.length === 0;

  const notes = [];
  if (a.advice) notes.push(['good', 'lightbulb', `<strong>Podpowiedź API:</strong> ${esc(a.advice)}${a.underOver ? ` · linia goli ${esc(a.underOver)}` : ''}`]);
  if (smallSample) notes.push(['warn', 'warning', `Drużyny rozegrały w tym sezonie <strong>${hm.played}</strong> i <strong>${am.played}</strong> meczów. Przy tak małej próbce średnie sezonowe są niestabilne — traktuj model orientacyjnie.`]);
  if (noH2H) notes.push(['warn', 'history', 'Brak rozegranych meczów bezpośrednich — kolumna H2H pozostanie pusta, zostaje sam model.']);
  else if (a.h2h.length < 4) notes.push(['warn', 'history', `Tylko <strong>${a.h2h.length}</strong> mecze bezpośrednie w bazie. Odsetki H2H przy tak małej próbce potrafią mocno mylić.`]);
  notes.push(['', 'info', 'Model zakłada rozkład Poissona i niezależność bramek obu drużyn. Nie uwzględnia kontuzji, rotacji składu ani stawki meczu — to punkt wyjścia, nie wyrocznia.']);

  const statsBtn = a.stats
    ? `<button class="st-btn" id="refresh-stats"><span class="material-symbols-outlined">refresh</span>Odśwież statystyki</button>`
    : `<button class="st-btn primary" id="fetch-stats"><span class="material-symbols-outlined">download</span>Dociągnij rożne i strzały (${Math.min(a.h2h.length, 8)} zapytań)</button>`;

  el('analysis').innerHTML = `
    <section class="tc-card">
      <div class="st-fixture-hero">
        <div class="st-fx-team">
          <img src="${esc(fx.teams.home.logo)}" alt="" onerror="this.style.visibility='hidden'">
          <div><div class="n">${esc(fx.teams.home.name)}</div><div class="s">forma: ${esc(hm.form.slice(-6) || '—')}</div></div>
        </div>
        <div class="st-fx-mid">
          <div class="k">Oczekiwane gole</div>
          <div class="lam">${(a.lambdaHome ?? 0).toFixed(2)} – ${(a.lambdaAway ?? 0).toFixed(2)}</div>
          <div class="k">razem ${a.lambdaTotal.toFixed(2)}</div>
        </div>
        <div class="st-fx-team away">
          <img src="${esc(fx.teams.away.logo)}" alt="" onerror="this.style.visibility='hidden'">
          <div><div class="n">${esc(fx.teams.away.name)}</div><div class="s">forma: ${esc(am.form.slice(-6) || '—')}</div></div>
        </div>
      </div>
      <div class="st-fx-meta">
        <div class="cell"><div class="k">Mecze w sezonie</div><div class="v">${hm.played} / ${am.played}</div><div class="n">gospodarz / gość</div></div>
        <div class="cell"><div class="k">Śr. gole zdobyte</div><div class="v">${(hm.forTotal ?? 0).toFixed(2)} / ${(am.forTotal ?? 0).toFixed(2)}</div><div class="n">na mecz</div></div>
        <div class="cell"><div class="k">Śr. gole stracone</div><div class="v">${(hm.againstTotal ?? 0).toFixed(2)} / ${(am.againstTotal ?? 0).toFixed(2)}</div><div class="n">na mecz</div></div>
        <div class="cell"><div class="k">Mecze bezpośrednie</div><div class="v">${a.h2h.length}</div><div class="n">w bazie API</div></div>
      </div>
      <div class="st-notes">${notes.map(([k, i, t]) => `<div class="st-note ${k}"><span class="material-symbols-outlined">${i}</span><span>${t}</span></div>`).join('')}</div>
    </section>

    <section class="tc-card">
      ${buildGoalsMatrix(a)}
      ${buildExtraMarkets(a)}
      <div class="st-legend">
        <span class="item"><span class="sw" style="background:#dcf5e7"></span>≥ 80%</span>
        <span class="item"><span class="sw" style="background:#eaf8f0"></span>65–80%</span>
        <span class="item"><span class="sw" style="background:#f6f8fa"></span>45–65%</span>
        <span class="item"><span class="sw" style="background:#fdf3e3"></span>30–45%</span>
        <span class="item"><span class="sw" style="background:#fbe9e7"></span>&lt; 30%</span>
        <span class="item" style="margin-left:auto">Duża liczba = model · mała = trafienia w H2H · pomarańczowa, gdy historia mocno odbiega od modelu</span>
      </div>
    </section>

    <section class="tc-card">
      <div class="st-toolbar">
        <div class="grp">
          <strong style="font-size:12.5px">Rożne, strzały i kartki</strong>
          <span class="sub" style="font-size:11.5px;color:var(--tc-muted)">
            ${a.stats ? `pobrano ${a.stats.rows.length} z ${a.stats.requested} meczów` : 'wymaga osobnego pobrania — po jednym zapytaniu na mecz bezpośredni'}
          </span>
        </div>
        <div class="grp">${a.h2h.length ? statsBtn : ''}</div>
      </div>
      <div id="stats-body">
        ${a.stats && a.stats.rows.length
      ? buildStatsMatrix(a)
      : `<div class="tc-empty"><span class="material-symbols-outlined">bar_chart</span>
             <h4>${a.h2h.length ? 'Statystyki jeszcze nie pobrane' : 'Brak meczów bezpośrednich'}</h4>
             <p>${a.h2h.length
        ? 'Rożne, strzały i kartki API udostępnia tylko per mecz, więc każdy mecz bezpośredni to jedno zapytanie. Pobierz je świadomie — wyniki zapiszą się na stałe.'
        : 'Bez historii bezpośrednich spotkań nie ma z czego policzyć rożnych ani strzałów.'}</p></div>`}
      </div>
    </section>

    ${a.h2h.length ? `<section class="tc-card">
      <div class="tc-card-head"><h3>Mecze bezpośrednie</h3><span class="sub">${a.h2h.length} spotkań</span></div>
      <div class="st-h2h-list">${a.h2h.map(m => `
        <div class="st-h2h-row">
          <span class="d">${esc(m.date)}</span>
          <span class="tn">${esc(m.homeName)}</span>
          <span class="sc">${m.gh} : ${m.ga}</span>
          <span class="tn a">${esc(m.awayName)}</span>
          <span class="ex">${m.total} gole${m.btts ? ' · BTTS' : ''}</span>
        </div>`).join('')}</div>
    </section>` : ''}
  `;

  const fs = el('fetch-stats') || el('refresh-stats');
  if (fs) fs.addEventListener('click', () => runStatsFetch());
}

/* ============================================================
   Akcje
   ============================================================ */
function setBusy(btn, on, label) {
  busy = on;
  if (!btn) return;
  btn.disabled = on;
  btn.classList.toggle('spin', on);
  if (label) btn.innerHTML = `<span class="material-symbols-outlined">${on ? 'progress_activity' : 'download'}</span>${label}`;
}

function handleError(e) {
  const msg = e instanceof ApiError ? e.message : 'Nieoczekiwany błąd.';
  toast(msg, 'err');
  if (e.kind === 'key') openSettings();
  return msg;
}

async function fetchFixtures() {
  const btn = el('fetch-fixtures');
  if (busy) return;
  const date = todayISO(dayOffset);
  renderFixturesStatus(`<div class="st-notes"><div class="st-note"><span class="material-symbols-outlined">hourglass_top</span><span>Pobieram terminarz na ${date}…</span></div></div>`);
  setBusy(btn, true, 'Pobieram…');
  try {
    const { data, cached } = await apiGet(`fixtures?date=${date}`, TTL.fixtures);
    fixtures = data.response || [];
    leagues = groupLeagues(fixtures);
    selectedLeagueId = null;
    selectedFixture = null;
    analysis = null;
    renderLeagues();
    renderMatches();
    renderAnalysis();
    el('step1-sub').textContent = `${fixtures.length} meczów, ${leagues.length} lig`;
    el('step2-sub').textContent = 'Kliknij ligę';
    setStep(2);
    renderFixturesStatus(`<div class="st-notes"><div class="st-note good">
      <span class="material-symbols-outlined">check_circle</span>
      <span>Pobrano <strong>${fixtures.length}</strong> meczów z <strong>${leagues.length}</strong> lig na ${date}.
      ${cached ? 'Dane z lokalnego cache — nie zużyto zapytania.' : 'Zużyto 1 zapytanie.'}</span></div></div>`);
    if (!fixtures.length) renderFixturesStatus(`<div class="st-notes"><div class="st-note warn">
      <span class="material-symbols-outlined">event_busy</span><span>Brak meczów w tym dniu.</span></div></div>`);
  } catch (e) {
    const msg = handleError(e);
    renderFixturesStatus(`<div class="st-notes"><div class="st-note bad">
      <span class="material-symbols-outlined">error</span><span>${esc(msg)}</span></div></div>`);
  } finally {
    setBusy(btn, false, 'Pobierz mecze');
  }
}

function selectLeague(id) {
  selectedLeagueId = id;
  selectedFixture = null;
  analysis = null;
  const lg = leagues.find(l => l.id === id);
  el('step2-sub').textContent = lg ? lg.name : '—';
  el('step3-sub').textContent = 'Kliknij mecz';
  setStep(3);
  renderLeagues();
  renderMatches();
  renderAnalysis();
  el('matches-block').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function runAnalysis(fixtureId) {
  if (busy) return;
  const fx = fixtures.find(f => f.fixture.id === fixtureId);
  if (!fx) return;
  selectedFixture = fx;
  renderMatches();
  el('analysis-block').style.display = '';
  el('analysis').innerHTML = `<section class="tc-card"><div class="tc-empty">
    <span class="material-symbols-outlined">hourglass_top</span><h4>Liczę…</h4>
    <p>Pobieram formę drużyn i mecze bezpośrednie (1 zapytanie).</p></div></section>`;
  busy = true;
  try {
    analysis = await analyseFixture(fx);
    el('step3-sub').textContent = `${fx.teams.home.name} – ${fx.teams.away.name}`;
    el('step4-sub').textContent = `oczekiwane ${analysis.lambdaTotal.toFixed(2)} gola`;
    setStep(4);
    renderAnalysis();
    el('analysis-block').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    const msg = handleError(e);
    analysis = null;
    el('analysis').innerHTML = `<section class="tc-card"><div class="tc-empty">
      <span class="material-symbols-outlined">error</span><h4>Nie udało się przeanalizować</h4><p>${esc(msg)}</p></div></section>`;
  } finally {
    busy = false;
  }
}

async function runStatsFetch() {
  if (!analysis || busy) return;
  const btn = el('fetch-stats') || el('refresh-stats');
  const need = analysis.h2h.slice(0, 8).filter(m => !cacheGet(`fixtures/statistics?fixture=${m.id}`, TTL.statistics)).length;
  if (need > remainingQuota()) {
    toast(`Potrzeba ${need} zapytań, a zostało ${remainingQuota()}.`, 'err');
    return;
  }
  busy = true;
  setBusy(btn, true, 'Pobieram…');
  try {
    await fetchH2HStats(analysis, (done, total) => {
      if (btn) btn.innerHTML = `<span class="material-symbols-outlined">progress_activity</span>Pobieram ${done}/${total}…`;
    });
    renderAnalysis();
    const s = analysis.stats;
    toast(s.rows.length
      ? `Pobrano statystyki z ${s.rows.length} meczów${s.fetched ? ` (${s.fetched} nowych zapytań)` : ' — wszystko z cache'}.`
      : 'API nie zwróciło statystyk dla tych meczów.', s.rows.length ? 'ok' : 'err');
  } catch (e) {
    handleError(e);
  } finally {
    busy = false;
  }
}

/* ============================================================
   Ustawienia klucza
   ============================================================ */
function openSettings() {
  el('s-key').value = apiKey;
  el('key-status').innerHTML = '';
  el('settings-modal').classList.add('on');
}
function closeSettings() { el('settings-modal').classList.remove('on'); }

async function testKey() {
  const k = el('s-key').value.trim();
  if (!k) { el('key-status').innerHTML = `<div class="st-note bad"><span class="material-symbols-outlined">error</span><span>Wklej klucz.</span></div>`; return; }
  el('key-status').innerHTML = `<div class="st-note"><span class="material-symbols-outlined">hourglass_top</span><span>Sprawdzam…</span></div>`;
  try {
    const res = await fetch(`${API_BASE}/status`, { headers: { 'x-apisports-key': k } });
    const json = await res.json();
    bumpUsage();
    const sub = json?.response?.subscription, req = json?.response?.requests;
    if (!sub) throw new Error('bad');
    el('key-status').innerHTML = `<div class="st-note good"><span class="material-symbols-outlined">check_circle</span>
      <span>Klucz działa. Plan <strong>${esc(sub.plan)}</strong>, zużycie po stronie API:
      <strong>${req.current}/${req.limit_day}</strong> na dobę.</span></div>`;
  } catch {
    el('key-status').innerHTML = `<div class="st-note bad"><span class="material-symbols-outlined">error</span><span>Klucz odrzucony albo brak połączenia.</span></div>`;
  }
}

function saveKey() {
  apiKey = el('s-key').value.trim();
  localStorage.setItem(KEY_STORE, apiKey);
  closeSettings();
  renderKeyGate();
  toast(apiKey ? 'Klucz zapisany' : 'Klucz usunięty', apiKey ? 'ok' : '');
}

function renderKeyGate() {
  if (apiKey) { renderFixturesStatus(''); return; }
  renderFixturesStatus(`<div class="st-key-missing">
    <span class="material-symbols-outlined">key_off</span>
    <h4>Brak klucza API</h4>
    <p>Ten moduł korzysta z API-Football. Wklej swój klucz w „Klucz API” — zapisze się tylko w tej przeglądarce
       i nigdy nie trafi do repozytorium.</p>
    <button class="st-btn primary" onclick="openSettings()"><span class="material-symbols-outlined">key</span>Dodaj klucz</button>
  </div>`);
}

function clearCache() {
  const n = Object.keys(cache).length;
  if (!n) { toast('Cache jest pusty'); return; }
  if (!confirm(`Usunąć ${n} zapisanych odpowiedzi API? Kolejne analizy zużyją zapytania od nowa.`)) return;
  cache = {};
  saveCache();
  toast('Cache wyczyszczony');
}

/* ============================================================
   Init
   ============================================================ */
function init() {
  loadStores();
  renderQuota();
  renderDayLabel();
  renderKeyGate();
  setStep(1);

  document.querySelectorAll('.sidebar__link[data-page]').forEach(l => {
    if (l.dataset.page === 'stats') l.classList.add('sidebar__link--active');
  });

  el('day-seg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    dayOffset = Number(b.dataset.day);
    el('day-seg').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    renderDayLabel();
  }));

  el('fetch-fixtures').addEventListener('click', fetchFixtures);
  el('settings-btn').addEventListener('click', openSettings);
  el('clear-cache-btn').addEventListener('click', clearCache);
  el('save-key-btn').addEventListener('click', saveKey);
  el('test-key-btn').addEventListener('click', testKey);
  el('s-show').addEventListener('change', e => { el('s-key').type = e.target.checked ? 'text' : 'password'; });
  el('league-search').addEventListener('input', e => { leagueFilter = e.target.value; renderLeagues(); });

  document.querySelectorAll('.tc-modal-ov').forEach(ov =>
    ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('on'); }));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.tc-modal-ov.on').forEach(m => m.classList.remove('on'));
  });
}

document.addEventListener('DOMContentLoaded', init);
