/* Statystyki piłkarskie — TheSportsDB v1, publiczny klucz Free „123”.
   API jest wywoływane wyłącznie po akcji użytkownika, a odpowiedzi są cache'owane. */
const API_BASE = 'https://www.thesportsdb.com/api/v1/json/123';
const CACHE_STORE = 'lifeos_thesportsdb_cache_v1';
const HISTORY_WINDOWS = [5, 10, 20];
const TTL = { fixtures: 30 * 60 * 1000, history: 6 * 60 * 60 * 1000 };

let cache = {};
let dayOffset = 0;
let fixtures = [];
let leagues = [];
let selectedLeagueId = null;
let selectedFixture = null;
let analysis = null;
let leagueFilter = '';
let historyWindow = 5;
let busy = false;

const el = id => document.getElementById(id);
const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const num = (value, fallback = null) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; };

function todayISO(offset = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
function fmtPct(value, dp = 0) { return Number.isFinite(value) ? `${(value * 100).toFixed(dp)}%` : '—'; }
function fairOdds(value) { return Number.isFinite(value) && value > 0 ? (1 / value).toFixed(2) : '—'; }
function toast(message, kind = '') {
  const node = document.createElement('div');
  node.className = `tc-toast ${kind}`;
  node.textContent = message;
  el('toasts').appendChild(node);
  setTimeout(() => node.remove(), 3400);
}
function loadCache() {
  try { cache = JSON.parse(localStorage.getItem(CACHE_STORE) || '{}') || {}; } catch { cache = {}; }
}
function saveCache() {
  try { localStorage.setItem(CACHE_STORE, JSON.stringify(cache)); } catch { /* cache jest opcjonalny */ }
}
async function apiGet(path, ttl) {
  const hit = cache[path];
  if (hit && Date.now() - hit.ts < ttl) return { data: hit.data, cached: true };
  let response;
  try { response = await fetch(`${API_BASE}/${path}`); }
  catch { throw new Error('Brak połączenia z TheSportsDB. Sprawdź internet.'); }
  if (!response.ok) throw new Error(`TheSportsDB zwróciło błąd HTTP ${response.status}.`);
  const data = await response.json();
  cache[path] = { ts: Date.now(), data };
  saveCache();
  return { data, cached: false };
}

function eventDate(event) {
  if (event.strTimestamp) return new Date(event.strTimestamp);
  const time = (event.strTime || '00:00:00').slice(0, 8);
  return new Date(`${event.dateEvent}T${time}Z`);
}
function eventStatus(event) {
  const status = String(event.strStatus || '').toLowerCase();
  const hasScore = event.intHomeScore !== null && event.intHomeScore !== '' && event.intAwayScore !== null && event.intAwayScore !== '';
  if (hasScore || status.includes('finished')) return { short: 'FT', elapsed: null };
  if (status.includes('postpon')) return { short: 'PST', elapsed: null };
  if (status.includes('live') || status.includes('progress')) return { short: 'LIVE', elapsed: null };
  return { short: 'NS', elapsed: null };
}
function adaptEvent(event) {
  const date = eventDate(event);
  return {
    fixture: { id: String(event.idEvent), date: date.toISOString(), timestamp: date.getTime() / 1000, status: eventStatus(event) },
    league: { id: String(event.idLeague || event.strLeague || 'other'), name: event.strLeague || 'Inne rozgrywki', country: event.strCountry || '', logo: event.strLeagueBadge || '' },
    teams: {
      home: { id: String(event.idHomeTeam), name: event.strHomeTeam || '—', logo: event.strHomeTeamBadge || '' },
      away: { id: String(event.idAwayTeam), name: event.strAwayTeam || '—', logo: event.strAwayTeamBadge || '' }
    },
    goals: { home: num(event.intHomeScore), away: num(event.intAwayScore) },
    raw: event
  };
}
function completedSample(events, teamId) {
  return [...new Map((events || []).map(event => [event.idEvent, event])).values()]
    .map(adaptEvent)
    .filter(match => match.fixture.status.short === 'FT' && (match.teams.home.id === String(teamId) || match.teams.away.id === String(teamId)))
    .map(match => {
      const home = match.teams.home.id === String(teamId);
      const scored = home ? match.goals.home : match.goals.away;
      const conceded = home ? match.goals.away : match.goals.home;
      return { id: match.fixture.id, date: match.fixture.date.slice(0, 10), opponent: home ? match.teams.away.name : match.teams.home.name, scored, conceded, total: scored + conceded, btts: scored > 0 && conceded > 0, won: scored > conceded, draw: scored === conceded };
    }).sort((a, b) => b.date.localeCompare(a.date));
}
function cachedTeamEvents(teamId) {
  const events = [];
  for (const [path, entry] of Object.entries(cache)) {
    const payload = entry?.data;
    if (!payload) continue;
    const list = path.startsWith('eventsday.php') ? payload.events : path.startsWith('eventslast.php') ? payload.results : null;
    if (!Array.isArray(list)) continue;
    events.push(...list.filter(event => String(event.idHomeTeam) === String(teamId) || String(event.idAwayTeam) === String(teamId)));
  }
  return events;
}
async function fetchTeamHistory(teamId, wanted) {
  const { data } = await apiGet(`eventslast.php?id=${encodeURIComponent(teamId)}`, TTL.history);
  const apiEvents = data.results || data.events || [];
  return completedSample([...apiEvents, ...cachedTeamEvents(teamId)], teamId).slice(0, wanted);
}

function mean(values) { const valid = values.filter(Number.isFinite); return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null; }
function empirical(values, predicate) {
  const valid = values.filter(value => value !== null && value !== undefined);
  if (!valid.length) return null;
  const hits = valid.filter(predicate).length;
  return { p: hits / valid.length, hits, n: valid.length };
}
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
function pOver(lambda, line) {
  if (!Number.isFinite(lambda) || lambda < 0) return null;
  let cdf = 0;
  for (let k = 0; k <= Math.floor(line); k++) cdf += poissonPmf(k, lambda);
  return clamp(1 - cdf, 0, 1);
}
function outcomeProbs(homeLambda, awayLambda) {
  if (!Number.isFinite(homeLambda) || !Number.isFinite(awayLambda)) return { home: null, draw: null, away: null };
  let home = 0, draw = 0, away = 0;
  for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) {
    const p = poissonPmf(i, homeLambda) * poissonPmf(j, awayLambda);
    if (i > j) home += p; else if (i === j) draw += p; else away += p;
  }
  const total = home + draw + away;
  return { home: home / total, draw: draw / total, away: away / total };
}
function tone(p) { return !Number.isFinite(p) ? 'empty' : p >= .8 ? 't5' : p >= .65 ? 't4' : p >= .45 ? 't3' : p >= .3 ? 't2' : 't1'; }

async function analyseFixture(fixture) {
  const [home, away] = await Promise.all([
    fetchTeamHistory(fixture.teams.home.id, historyWindow),
    fetchTeamHistory(fixture.teams.away.id, historyWindow)
  ]);
  const lambdaHome = mean([mean(home.map(m => m.scored)), mean(away.map(m => m.conceded))]);
  const lambdaAway = mean([mean(away.map(m => m.scored)), mean(home.map(m => m.conceded))]);
  return { fixture, recent: { home, away, window: historyWindow }, lambdaHome, lambdaAway, lambdaTotal: (lambdaHome ?? 0) + (lambdaAway ?? 0) };
}

function matrixCell(model, observed) {
  const shown = model ?? observed?.p;
  const title = observed ? `${observed.hits}/${observed.n} trafień · dolna granica Wilsona ${fmtPct(wilsonLower(observed.hits, observed.n))}` : `Model Poissona · kurs godziwy ${fairOdds(model)}`;
  return `<td><div class="mx ${tone(shown)}" title="${esc(title)}"><span class="p">${fmtPct(shown)}</span>${observed ? `<span class="h">${observed.hits}/${observed.n}</span>` : ''}</div></td>`;
}
function buildRecommendations(a) {
  const all = [...a.recent.home, ...a.recent.away];
  const definitions = [
    ['Gole pow. 1,5', all.map(m => m.total), v => v > 1.5],
    ['Gole pow. 2,5', all.map(m => m.total), v => v > 2.5],
    ['Obie drużyny strzelą', all.map(m => m.btts), Boolean],
    [`${a.fixture.teams.home.name} strzeli`, a.recent.home.map(m => m.scored), v => v > 0],
    [`${a.fixture.teams.away.name} strzeli`, a.recent.away.map(m => m.scored), v => v > 0]
  ];
  const picks = definitions.map(([label, values, test]) => ({ label, ...empirical(values, test) })).filter(p => Number.isFinite(p.p)).map(p => ({ ...p, lower: wilsonLower(p.hits, p.n) })).sort((x, y) => y.lower - x.lower);
  return `<div class="st-recommendations"><div class="st-matrix-title"><strong>Rekomendacje statystyczne</strong><span class="sub">ranking wg dolnej granicy Wilsona (80%)</span></div><div class="st-rec-grid">${picks.map(p => `<div class="st-rec ${tone(p.p)}"><strong>${esc(p.label)}</strong><span class="value">${fmtPct(p.p)}</span><small>${p.hits}/${p.n} trafień · konserwatywnie ${fmtPct(p.lower)}</small></div>`).join('')}</div></div>`;
}
function buildGoalsMatrix(a) {
  const lines = [.5, 1.5, 2.5, 3.5, 4.5];
  const all = [...a.recent.home, ...a.recent.away];
  const rows = [
    ['Gole w meczu', a.lambdaTotal, all.map(m => m.total)],
    [`Gole: ${a.fixture.teams.home.name}`, a.lambdaHome, a.recent.home.map(m => m.scored)],
    [`Gole: ${a.fixture.teams.away.name}`, a.lambdaAway, a.recent.away.map(m => m.scored)]
  ];
  return `<div class="st-matrix-title"><strong>Gole</strong><span class="sub">model Poissona + pokrycie ostatnich dostępnych meczów</span></div><div class="st-matrix-wrap"><table class="st-matrix"><thead><tr><th>Rynek</th>${lines.map(line => `<th>pow. ${String(line).replace('.', ',')}</th>`).join('')}</tr></thead><tbody>${rows.map(([label, lambda, values]) => `<tr><td class="lbl">${esc(label)}</td>${lines.map(line => matrixCell(pOver(lambda, line), empirical(values, value => value > line))).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function buildOutcomes(a) {
  const probs = outcomeProbs(a.lambdaHome, a.lambdaAway);
  const items = [['Wygrana gospodarza', probs.home], ['Remis', probs.draw], ['Wygrana gościa', probs.away], ['Gospodarz nie przegra', probs.home + probs.draw], ['Gość nie przegra', probs.away + probs.draw]];
  return `<div class="st-matrix-title"><strong>Wynik meczu</strong><span class="sub">model bramkowy</span></div><div class="st-matrix-wrap"><table class="st-matrix"><thead><tr><th>Rynek</th><th>Prawdopodobieństwo</th><th>Kurs godziwy</th></tr></thead><tbody>${items.map(([label, p]) => `<tr><td class="lbl">${esc(label)}</td>${matrixCell(p, null)}<td><div class="mx t3"><span class="p">${fairOdds(p)}</span></div></td></tr>`).join('')}</tbody></table></div>`;
}
function historyList(title, team, rows) {
  return `<div class="tc-card-head"><h3>${esc(title)}</h3><span class="sub">${rows.length} spotkań</span></div><div class="st-h2h-list">${rows.map(m => `<div class="st-h2h-row"><span class="d">${esc(m.date)}</span><span class="tn">${esc(team)}</span><span class="sc">${m.scored} : ${m.conceded}</span><span class="tn a">${esc(m.opponent)}</span><span class="ex">${m.total} gole${m.btts ? ' · BTTS' : ''}</span></div>`).join('')}</div>`;
}

function setStep(n) { document.querySelectorAll('.st-step').forEach(step => { const value = Number(step.dataset.step); step.classList.toggle('done', value < n); step.classList.toggle('active', value === n); }); }
function renderDayLabel() { const date = new Date(`${todayISO(dayOffset)}T00:00:00Z`); el('day-label').textContent = date.toLocaleDateString('pl-PL', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' }); }
function renderFixturesStatus(html) { el('fixtures-status').innerHTML = html; }
function groupLeagues(list) {
  const map = new Map();
  for (const match of list) { if (!map.has(match.league.id)) map.set(match.league.id, { ...match.league, count: 0 }); map.get(match.league.id).count++; }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pl'));
}
function renderLeagues() {
  el('leagues-block').style.display = leagues.length ? '' : 'none';
  const q = leagueFilter.trim().toLowerCase();
  const visible = q ? leagues.filter(l => `${l.name} ${l.country}`.toLowerCase().includes(q)) : leagues;
  el('leagues-desc').textContent = `${leagues.length} lig · ${fixtures.length} meczów`;
  el('leagues').innerHTML = visible.map(l => `<button class="st-league ${selectedLeagueId === l.id ? 'active' : ''}" data-league="${esc(l.id)}"><span class="t"><span class="n">${esc(l.name)}</span><span class="c">${esc(l.country)}</span></span><span class="cnt">${l.count}</span></button>`).join('') || '<div class="tc-empty">Brak lig</div>';
  el('leagues').querySelectorAll('[data-league]').forEach(button => button.addEventListener('click', () => selectLeague(button.dataset.league)));
}
function statusTag(status) { return status.short === 'FT' ? '<span class="st-status ft">Zakończony</span>' : status.short === 'NS' ? '<span class="st-status ns">Przed meczem</span>' : `<span class="st-status live">${esc(status.short)}</span>`; }
function renderMatches() {
  if (!selectedLeagueId) { el('matches-block').style.display = 'none'; return; }
  const list = fixtures.filter(match => match.league.id === selectedLeagueId).sort((a, b) => a.fixture.timestamp - b.fixture.timestamp);
  el('matches-block').style.display = '';
  el('matches-desc').textContent = `${leagues.find(l => l.id === selectedLeagueId)?.name || ''} · ${list.length} meczów`;
  el('matches').innerHTML = `<table class="tc-tbl"><thead><tr><th>Godz.</th><th>Gospodarz</th><th>Wynik</th><th>Gość</th><th>Status</th><th></th></tr></thead><tbody>${list.map(match => `<tr class="st-match-row" data-fx="${match.fixture.id}"><td class="st-time">${new Date(match.fixture.date).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</td><td><span class="st-team"><span>${esc(match.teams.home.name)}</span></span></td><td class="num mono">${match.goals.home == null ? '—' : `${match.goals.home} : ${match.goals.away}`}</td><td><span class="st-team"><span>${esc(match.teams.away.name)}</span></span></td><td>${statusTag(match.fixture.status)}</td><td><button class="st-btn primary" data-analyse="${match.fixture.id}"><span class="material-symbols-outlined">insights</span>Analizuj</button></td></tr>`).join('')}</tbody></table>`;
  el('matches').querySelectorAll('[data-analyse]').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); runAnalysis(button.dataset.analyse); }));
  el('matches').querySelectorAll('[data-fx]').forEach(row => row.addEventListener('click', () => runAnalysis(row.dataset.fx)));
}
function renderAnalysis() {
  if (!analysis) { el('analysis-block').style.display = 'none'; return; }
  const a = analysis, fx = a.fixture;
  el('analysis-block').style.display = '';
  el('analysis-desc').textContent = `${fx.teams.home.name} – ${fx.teams.away.name}`;
  const available = Math.min(a.recent.home.length, a.recent.away.length);
  const warning = available < a.recent.window ? `TheSportsDB Free zwraca endpointem <code>eventslast</code> maksymalnie ostatnie dostępne spotkania (zwykle 5). Wybrano ${a.recent.window}, ale wspólna próbka ma ${available}. Cache kolejnych dni może ją stopniowo powiększyć.` : `Analiza obejmuje po ${available} ostatnich dostępnych spotkań drużyn.`;
  el('analysis').innerHTML = `<section class="tc-card"><div class="st-fixture-hero"><div class="st-fx-team"><div><div class="n">${esc(fx.teams.home.name)}</div><div class="s">${a.recent.home.length} meczów</div></div></div><div class="st-fx-mid"><div class="k">Oczekiwane gole</div><div class="lam">${(a.lambdaHome ?? 0).toFixed(2)} – ${(a.lambdaAway ?? 0).toFixed(2)}</div></div><div class="st-fx-team away"><div><div class="n">${esc(fx.teams.away.name)}</div><div class="s">${a.recent.away.length} meczów</div></div></div></div><div class="st-history-toolbar"><span>Zakres historii:</span><div class="st-seg" id="history-seg">${HISTORY_WINDOWS.map(n => `<button data-window="${n}" class="${n === a.recent.window ? 'active' : ''}">Ostatnie ${n}</button>`).join('')}</div></div><div class="st-notes"><div class="st-note warn"><span class="material-symbols-outlined">info</span><span>${warning}</span></div><div class="st-note"><span class="material-symbols-outlined">analytics</span><span>TheSportsDB Free nie udostępnia rożnych, strzałów, kartek ani predykcji. Rekomendacje bazują wyłącznie na wynikach i golach; nie są poradą bukmacherską.</span></div></div></section><section class="tc-card">${buildRecommendations(a)}${buildGoalsMatrix(a)}${buildOutcomes(a)}</section><section class="tc-card">${historyList(`Historia: ${fx.teams.home.name}`, fx.teams.home.name, a.recent.home)}${historyList(`Historia: ${fx.teams.away.name}`, fx.teams.away.name, a.recent.away)}</section>`;
  el('history-seg').querySelectorAll('button').forEach(button => button.addEventListener('click', () => { const next = Number(button.dataset.window); if (next !== historyWindow && !busy) { historyWindow = next; runAnalysis(fx.fixture.id); } }));
}
async function fetchFixtures() {
  if (busy) return;
  busy = true;
  const button = el('fetch-fixtures'); button.disabled = true;
  const date = todayISO(dayOffset);
  renderFixturesStatus('<div class="st-note"><span class="material-symbols-outlined">hourglass_top</span><span>Pobieram mecze…</span></div>');
  try {
    const { data, cached } = await apiGet(`eventsday.php?d=${date}&s=Soccer`, TTL.fixtures);
    fixtures = (data.events || []).map(adaptEvent);
    leagues = groupLeagues(fixtures); selectedLeagueId = null; selectedFixture = null; analysis = null;
    renderLeagues(); renderMatches(); renderAnalysis(); setStep(2);
    el('step1-sub').textContent = `${fixtures.length} meczów, ${leagues.length} lig`;
    renderFixturesStatus(`<div class="st-notes"><div class="st-note good"><span class="material-symbols-outlined">check_circle</span><span>Pobrano <strong>${fixtures.length}</strong> meczów z TheSportsDB${cached ? ' (cache)' : ''}.</span></div></div>`);
  } catch (error) { renderFixturesStatus(`<div class="st-note bad"><span class="material-symbols-outlined">error</span><span>${esc(error.message)}</span></div>`); toast(error.message, 'err'); }
  finally { busy = false; button.disabled = false; }
}
function selectLeague(id) { selectedLeagueId = id; analysis = null; el('step2-sub').textContent = leagues.find(l => l.id === id)?.name || '—'; setStep(3); renderLeagues(); renderMatches(); renderAnalysis(); }
async function runAnalysis(id) {
  if (busy) return;
  const fixture = fixtures.find(match => match.fixture.id === String(id)); if (!fixture) return;
  busy = true; selectedFixture = fixture; el('analysis-block').style.display = ''; el('analysis').innerHTML = '<section class="tc-card"><div class="tc-empty"><span class="material-symbols-outlined">hourglass_top</span><h4>Liczę…</h4><p>Pobieram ostatnie wyniki obu drużyn z TheSportsDB.</p></div></section>';
  try { analysis = await analyseFixture(fixture); setStep(4); el('step3-sub').textContent = `${fixture.teams.home.name} – ${fixture.teams.away.name}`; el('step4-sub').textContent = `${analysis.recent.home.length} / ${analysis.recent.away.length} meczów`; renderAnalysis(); el('analysis-block').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  catch (error) { analysis = null; el('analysis').innerHTML = `<section class="tc-card"><div class="tc-empty"><span class="material-symbols-outlined">error</span><h4>Nie udało się przeanalizować</h4><p>${esc(error.message)}</p></div></section>`; toast(error.message, 'err'); }
  finally { busy = false; }
}
function clearCache() { cache = {}; saveCache(); toast('Cache TheSportsDB wyczyszczony'); }
function init() {
  loadCache(); renderDayLabel(); setStep(1);
  document.querySelectorAll('.sidebar__link[data-page]').forEach(link => link.classList.toggle('sidebar__link--active', link.dataset.page === 'stats'));
  el('day-seg').querySelectorAll('button').forEach(button => button.addEventListener('click', () => { dayOffset = Number(button.dataset.day); el('day-seg').querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button)); renderDayLabel(); }));
  el('fetch-fixtures').addEventListener('click', fetchFixtures);
  el('clear-cache-btn').addEventListener('click', clearCache);
  el('league-search').addEventListener('input', event => { leagueFilter = event.target.value; renderLeagues(); });
}
document.addEventListener('DOMContentLoaded', init);
