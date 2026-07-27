/* ============================================================
   ZAKŁADY — analityczne centrum dowodzenia
   Dane trzymane lokalnie:
     lifeos_betting_v1           – kupony + operacje kasowe
     lifeos_betting_settings_v1  – bankroll, limity, podatki
   Moduł jest samodzielny: nie miesza się z księgowaniem
   inwestycji w budget.html (tam tylko odnośnik).
   ============================================================ */

const BET_KEY = 'lifeos_betting_v1';
const BET_SETTINGS_KEY = 'lifeos_betting_settings_v1';

const DEFAULT_SETTINGS = {
  bankrollStart: 1000,
  unitPct: 1,          // 1 unit = % bankrolla
  maxStakePct: 5,      // max stawka na kupon
  maxExposurePct: 20,  // max jednoczesna ekspozycja
  maxDailyLossPct: 10, // dzienny stop-loss
  maxDailyBets: 5,     // tilt guard
  maxOdds: 5,          // kurs powyżej którego ostrzegamy
  monthlyGoalPct: 5,   // cel miesięczny w % bankrolla
  taxMode: 'stake',    // stake | win | both | none
  stakeTaxPct: 12,
  winTaxPct: 10,
  winTaxFreeLimit: 2280
};

const SUGGEST = {
  books: ['STS', 'Fortuna', 'Superbet', 'Betclic', 'Betfan', 'LV BET', 'eToto', 'forBET', 'PZBuk', 'Totalbet', 'Betcris'],
  sports: ['Piłka nożna', 'Koszykówka', 'Tenis', 'Siatkówka', 'Hokej', 'MMA / UFC', 'Boks', 'Żużel', 'Esport', 'Formuła 1', 'Skoki narciarskie'],
  markets: ['1X2', 'Podwójna szansa', 'Over / Under', 'Handicap azjatycki', 'Handicap europejski', 'BTTS', 'Zakład bez remisu', 'Zawodnik – punkty', 'Liczba rożnych', 'Liczba kartek', 'Zwycięzca turnieju'],
  leagues: ['Ekstraklasa', 'Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'NBA', 'NHL', 'ATP', 'WTA', 'Liga Mistrzów'],
  tags: ['value', 'underdog', 'faworyt', 'live', 'statystyka', 'kontuzje', 'typ dnia', 'longshot']
};

const STATUS_LABEL = {
  pending: 'Otwarty',
  won: 'Wygrany',
  lost: 'Przegrany',
  void: 'Zwrot',
  half_won: '½ wygrany',
  half_lost: '½ przegrany',
  cashout: 'Cashout'
};

let settings = { ...DEFAULT_SETTINGS };
let state = { bets: [], ledger: [] };

let eqRange = '90';
let betFilters = { status: 'all', q: '', book: '', sport: '', period: 'all', grouping: 'week' };
let calendarState = { month: today().slice(0, 7), metric: 'pnl' };
let modalType = 'single';
let modalConf = 3;
let settleResult = 'won';
let settlePayoutTouched = false;
let expandedBets = new Set();
let expandedGroups = new Set();
let charts = {};

/* ============================================================
   Narzędzia
   ============================================================ */
function numberOr(v, f = 0) { const n = Number(v); return Number.isFinite(n) ? n : f; }
function numberNullable(v) { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function positiveOr(v, f) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : f; }
function clamp(v, a, b) { return Math.min(Math.max(v, a), b); }
function today() { return new Date().toISOString().slice(0, 10); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function uid(p) { return p + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); }

function fmtPLN(v, sign = false) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  v = Number(v);
  const abs = Math.abs(v);
  const s = abs.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '−' : (sign && v > 0 ? '+' : '')) + s + ' zł';
}
function fmtPLN0(v) {
  if (!Number.isFinite(Number(v))) return '—';
  return Math.round(Number(v)).toLocaleString('pl-PL') + ' zł';
}
function fmtPct(v, sign = true, dp = 2) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  v = Number(v);
  return (sign && v > 0 ? '+' : (v < 0 ? '−' : '')) + Math.abs(v).toFixed(dp) + '%';
}
function fmtOdds(v) {
  if (!Number.isFinite(Number(v)) || Number(v) <= 0) return '—';
  return Number(v).toFixed(2);
}
function fmtNum(v, dp = 2) {
  if (!Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('pl-PL', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function posClass(v) { return v > 0 ? 'pos' : v < 0 ? 'neg' : ''; }

// Polska odmiana: 1 kupon, 2–4 kupony, 5+ kuponów (z wyjątkiem 12–14)
function plural(n, one, few, many) {
  n = Math.abs(Math.round(n));
  const t = n % 10, h = n % 100;
  if (n === 1) return one;
  if (t >= 2 && t <= 4 && (h < 12 || h > 14)) return few;
  return many;
}
function nKupon(n) { return `${n} ${plural(n, 'kupon', 'kupony', 'kuponów')}`; }
function addDays(dateStr, n) { const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

function isoWeekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
function isoWeekRange(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = (d.getDay() + 6) % 7; // pn = 0
  const mon = new Date(d); mon.setDate(d.getDate() - dow);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const f = x => `${String(x.getDate()).padStart(2, '0')}.${String(x.getMonth() + 1).padStart(2, '0')}`;
  return `${f(mon)}–${f(sun)}`;
}
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pl-PL', { month: 'short', year: 'numeric' });
}

/* ============================================================
   Model danych
   ============================================================ */
function normalizeLeg(l) {
  return {
    event: String(l.event || ''),
    pick: String(l.pick || ''),
    odds: positiveOr(l.odds, 1)
  };
}

function normalizeBet(b) {
  const type = b.betType === 'combo' ? 'combo' : 'single';
  const legs = Array.isArray(b.legs) ? b.legs.map(normalizeLeg) : [];
  const status = STATUS_LABEL[b.status] ? b.status : 'pending';
  return {
    id: b.id || uid('bet'),
    date: b.date || today(),
    settledAt: b.settledAt || null,
    bookmaker: String(b.bookmaker || '').trim(),
    sport: String(b.sport || '').trim(),
    league: String(b.league || '').trim(),
    event: String(b.event || '').trim(),
    market: String(b.market || '').trim(),
    pick: String(b.pick || '').trim(),
    betType: type,
    legs,
    stake: Math.max(numberOr(b.stake, 0), 0),
    odds: positiveOr(b.odds, 1),
    closingOdds: numberNullable(b.closingOdds),
    live: !!b.live,
    freebet: !!b.freebet,
    taxFree: !!b.taxFree,
    confidence: clamp(Math.round(numberOr(b.confidence, 3)), 1, 5),
    tags: Array.isArray(b.tags) ? b.tags.filter(Boolean).map(String) : String(b.tags || '').split(',').map(s => s.trim()).filter(Boolean),
    status,
    payoutOverride: numberNullable(b.payoutOverride),
    note: String(b.note || '')
  };
}

function normalizeLedger(e) {
  const types = ['deposit', 'withdraw', 'bonus', 'adjust'];
  return {
    id: e.id || uid('led'),
    date: e.date || today(),
    type: types.includes(e.type) ? e.type : 'deposit',
    amount: numberOr(e.amount, 0),
    note: String(e.note || '')
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(BET_KEY);
    if (raw) state = JSON.parse(raw);
  } catch { state = { bets: [], ledger: [] }; }
  if (!state || typeof state !== 'object') state = { bets: [], ledger: [] };
  state.bets = Array.isArray(state.bets) ? state.bets.map(normalizeBet) : [];
  state.ledger = Array.isArray(state.ledger) ? state.ledger.map(normalizeLedger) : [];

  try {
    const r = localStorage.getItem(BET_SETTINGS_KEY);
    if (r) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(r) };
  } catch { settings = { ...DEFAULT_SETTINGS }; }
  settings = {
    bankrollStart: Math.max(numberOr(settings.bankrollStart, DEFAULT_SETTINGS.bankrollStart), 0),
    unitPct: positiveOr(settings.unitPct, DEFAULT_SETTINGS.unitPct),
    maxStakePct: positiveOr(settings.maxStakePct, DEFAULT_SETTINGS.maxStakePct),
    maxExposurePct: positiveOr(settings.maxExposurePct, DEFAULT_SETTINGS.maxExposurePct),
    maxDailyLossPct: positiveOr(settings.maxDailyLossPct, DEFAULT_SETTINGS.maxDailyLossPct),
    maxDailyBets: Math.max(Math.round(numberOr(settings.maxDailyBets, DEFAULT_SETTINGS.maxDailyBets)), 1),
    maxOdds: positiveOr(settings.maxOdds, DEFAULT_SETTINGS.maxOdds),
    monthlyGoalPct: numberOr(settings.monthlyGoalPct, DEFAULT_SETTINGS.monthlyGoalPct),
    taxMode: ['stake', 'win', 'both', 'none'].includes(settings.taxMode) ? settings.taxMode : 'stake',
    stakeTaxPct: Math.max(numberOr(settings.stakeTaxPct, DEFAULT_SETTINGS.stakeTaxPct), 0),
    winTaxPct: Math.max(numberOr(settings.winTaxPct, DEFAULT_SETTINGS.winTaxPct), 0),
    winTaxFreeLimit: Math.max(numberOr(settings.winTaxFreeLimit, DEFAULT_SETTINGS.winTaxFreeLimit), 0)
  };
}
function saveState() { localStorage.setItem(BET_KEY, JSON.stringify(state)); }
function saveSettingsStorage() { localStorage.setItem(BET_SETTINGS_KEY, JSON.stringify(settings)); }

/* ============================================================
   Matematyka kuponu
   ============================================================ */
function taxRates(bet) {
  const mode = settings.taxMode;
  const exempt = !!bet.taxFree;
  return {
    stakeRate: (!exempt && (mode === 'stake' || mode === 'both')) ? settings.stakeTaxPct / 100 : 0,
    winRate: (!exempt && (mode === 'win' || mode === 'both')) ? settings.winTaxPct / 100 : 0
  };
}

// Podatek ryczałtowy od wygranej – zwolnienie do kwoty wolnej (powyżej opodatkowana całość)
function winTaxOn(gross, rate) {
  if (rate <= 0) return 0;
  if (gross <= settings.winTaxFreeLimit) return 0;
  return gross * rate;
}

function betMath(bet) {
  const b = normalizeBet(bet);
  const { stakeRate, winRate } = taxRates(b);
  const stake = b.stake;
  const odds = b.odds;

  const stakeTax = stake * stakeRate;
  const netStake = stake - stakeTax;

  // pełna wygrana
  const grossWin = netStake * odds;
  const winTaxFull = winTaxOn(grossWin, winRate);
  const payoutIfWon = b.freebet ? Math.max(grossWin - stake - winTaxFull, 0) : (grossWin - winTaxFull);

  // ryzyko: freebet nie obciąża bankrolla
  const risked = b.freebet ? 0 : stake;

  let returned = 0;      // ile wraca od bukmachera
  let winTaxPaid = 0;
  let stakeTaxPaid = 0;
  let settled = b.status !== 'pending';
  let turnover = 0;

  if (!settled) {
    return {
      ...b, stake, odds, netStake, stakeTax, risked, settled: false,
      payoutIfWon, potentialProfit: payoutIfWon - risked,
      returned: null, profit: 0, stakeTaxPaid: 0, winTaxPaid: 0, taxPaid: 0,
      turnover: 0, effOdds: stake > 0 ? payoutIfWon / stake : 0,
      settledDate: null, roi: null
    };
  }

  switch (b.status) {
    case 'won':
      returned = payoutIfWon;
      stakeTaxPaid = stakeTax;
      winTaxPaid = winTaxFull;
      turnover = stake;
      break;
    case 'lost':
      returned = 0;
      stakeTaxPaid = stakeTax;
      turnover = stake;
      break;
    case 'void': {
      // zwrot kuponu – bukmacher oddaje pełną stawkę wraz z podatkiem
      returned = b.freebet ? 0 : stake;
      turnover = 0;
      break;
    }
    case 'half_won': {
      const gross = (netStake / 2) * odds + (stake / 2);
      const t = winTaxOn(gross, winRate);
      returned = b.freebet ? Math.max(gross - stake, 0) : gross - t;
      stakeTaxPaid = stakeTax / 2;
      winTaxPaid = t;
      turnover = stake / 2;
      break;
    }
    case 'half_lost':
      returned = b.freebet ? 0 : stake / 2;
      stakeTaxPaid = stakeTax / 2;
      turnover = stake / 2;
      break;
    case 'cashout':
      returned = Math.max(numberOr(b.payoutOverride, 0), 0);
      stakeTaxPaid = stakeTax;
      turnover = stake;
      break;
  }

  // ręczne nadpisanie wypłaty (poza cashoutem, gdzie jest źródłem prawdy)
  if (b.status !== 'cashout' && b.payoutOverride !== null && Number.isFinite(b.payoutOverride)) {
    returned = Math.max(b.payoutOverride, 0);
  }

  const profit = returned - risked;
  const settledDate = b.settledAt || b.date;

  return {
    ...b, stake, odds, netStake, stakeTax, risked, settled: true,
    payoutIfWon, potentialProfit: payoutIfWon - risked,
    returned, profit,
    stakeTaxPaid, winTaxPaid, taxPaid: stakeTaxPaid + winTaxPaid,
    turnover,
    effOdds: stake > 0 ? returned / stake : 0,
    settledDate,
    roi: turnover > 0 ? (profit / turnover) * 100 : null
  };
}

function unitValue(bankroll) {
  return Math.max(bankroll, 0) * (settings.unitPct / 100);
}

function comboOdds(legs) {
  if (!legs || !legs.length) return null;
  return legs.reduce((a, l) => a * positiveOr(l.odds, 1), 1);
}

/* ============================================================
   Agregacja
   ============================================================ */
function aggregate() {
  const all = state.bets.map(betMath).sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
  const settled = all.filter(b => b.settled);
  const pending = all.filter(b => !b.settled);

  settled.sort((a, b) => (a.settledDate === b.settledDate ? 0 : a.settledDate < b.settledDate ? -1 : 1));

  const ledger = [...state.ledger].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
  const ledgerNet = ledger.reduce((s, e) => {
    if (e.type === 'deposit' || e.type === 'bonus') return s + e.amount;
    if (e.type === 'withdraw') return s - e.amount;
    return s + e.amount; // korekta ze znakiem
  }, 0);

  const cashBase = settings.bankrollStart + ledgerNet;
  const realizedPnl = settled.reduce((s, b) => s + b.profit, 0);
  const bankroll = cashBase + realizedPnl;
  const openExposure = pending.reduce((s, b) => s + b.risked, 0);
  const available = bankroll - openExposure;

  const turnover = settled.reduce((s, b) => s + b.turnover, 0);
  const yieldPct = turnover > 0 ? (realizedPnl / turnover) * 100 : null;

  const wins = settled.filter(b => b.profit > 0).length;
  const losses = settled.filter(b => b.profit < 0).length;
  const pushes = settled.filter(b => b.profit === 0).length;
  const decided = wins + losses;
  const winRate = decided > 0 ? (wins / decided) * 100 : null;

  const stakeWeighted = settled.reduce((s, b) => s + b.odds * b.turnover, 0);
  const avgOdds = turnover > 0 ? stakeWeighted / turnover : null;
  const avgStake = settled.length ? settled.reduce((s, b) => s + b.stake, 0) / settled.length : null;
  const wonBets = settled.filter(b => b.status === 'won' || b.status === 'half_won');
  const lostBets = settled.filter(b => b.status === 'lost' || b.status === 'half_lost');
  const avgWinOdds = wonBets.length ? wonBets.reduce((s, b) => s + b.odds, 0) / wonBets.length : null;
  const avgLoseOdds = lostBets.length ? lostBets.reduce((s, b) => s + b.odds, 0) / lostBets.length : null;

  // CLV
  const clvBets = all.filter(b => b.closingOdds && b.closingOdds > 0);
  const clvValues = clvBets.map(b => (b.odds / b.closingOdds - 1) * 100);
  const avgClv = clvValues.length ? clvValues.reduce((a, c) => a + c, 0) / clvValues.length : null;
  const beatClose = clvValues.filter(v => v > 0).length;

  // P&L per dzień rozliczenia
  const byDay = {};
  const turnoverByDay = {};
  const countByDay = {};
  const winsByDay = {};
  const lossesByDay = {};
  for (const b of settled) {
    const d = b.settledDate;
    byDay[d] = (byDay[d] || 0) + b.profit;
    turnoverByDay[d] = (turnoverByDay[d] || 0) + b.turnover;
    countByDay[d] = (countByDay[d] || 0) + 1;
    if (b.profit > 0) winsByDay[d] = (winsByDay[d] || 0) + 1;
    if (b.profit < 0) lossesByDay[d] = (lossesByDay[d] || 0) + 1;
  }

  // przepływy kasowe per dzień
  const flowByDay = {};
  for (const e of ledger) {
    const v = e.type === 'withdraw' ? -e.amount : e.amount;
    flowByDay[e.date] = (flowByDay[e.date] || 0) + v;
  }

  // krzywa bankrolla (dzienna, od pierwszego zdarzenia do dziś)
  const dates = [...new Set([...Object.keys(byDay), ...Object.keys(flowByDay)])].sort();
  const points = [];
  let running = settings.bankrollStart;
  let cumProfit = 0;
  let peak = 0, maxDd = 0, maxDdPct = 0;
  points.push({ date: dates.length ? addDays(dates[0], -1) : today(), value: running, profit: 0 });
  for (const d of dates) {
    running += (flowByDay[d] || 0) + (byDay[d] || 0);
    cumProfit += (byDay[d] || 0);
    if (cumProfit > peak) peak = cumProfit;
    const dd = peak - cumProfit;
    if (dd > maxDd) {
      maxDd = dd;
      const base = settings.bankrollStart + peak;
      maxDdPct = base > 0 ? (dd / base) * 100 : 0;
    }
    points.push({ date: d, value: running, profit: cumProfit });
  }

  // serie
  let curWin = 0, curLoss = 0, bestWin = 0, worstLoss = 0;
  for (const b of settled) {
    if (b.profit > 0) { curWin++; curLoss = 0; bestWin = Math.max(bestWin, curWin); }
    else if (b.profit < 0) { curLoss++; curWin = 0; worstLoss = Math.max(worstLoss, curLoss); }
  }

  const todayKey = today();
  const todayPnl = byDay[todayKey] || 0;
  const todayBets = all.filter(b => b.date === todayKey).length;
  const todayStaked = all.filter(b => b.date === todayKey).reduce((s, b) => s + b.risked, 0);

  const taxTotal = settled.reduce((s, b) => s + b.taxPaid, 0);

  return {
    all, settled, pending, ledger, ledgerNet, cashBase,
    realizedPnl, bankroll, openExposure, available,
    turnover, yieldPct, wins, losses, pushes, winRate, decided,
    avgOdds, avgStake, avgWinOdds, avgLoseOdds,
    avgClv, beatClose, clvCount: clvValues.length,
    byDay, turnoverByDay, countByDay, winsByDay, lossesByDay, flowByDay,
    points, maxDd, maxDdPct, bestWin, worstLoss,
    todayPnl, todayBets, todayStaked, taxTotal,
    unit: unitValue(cashBase + realizedPnl)
  };
}

function groupBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const k = keyFn(item);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

function bucketStats(bets) {
  const turnover = bets.reduce((s, b) => s + b.turnover, 0);
  const profit = bets.reduce((s, b) => s + b.profit, 0);
  const wins = bets.filter(b => b.profit > 0).length;
  const losses = bets.filter(b => b.profit < 0).length;
  return {
    count: bets.length,
    turnover,
    profit,
    yieldPct: turnover > 0 ? (profit / turnover) * 100 : null,
    wins, losses,
    winRate: (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : null
  };
}

/* ============================================================
   Dashboard
   ============================================================ */
function el(id) { return document.getElementById(id); }
function setText(id, txt, cls) {
  const n = el(id);
  if (!n) return;
  n.textContent = txt;
  if (cls !== undefined) n.className = cls;
}

function renderHeader(agg) {
  setText('hdr-bankroll', fmtPLN(agg.bankroll), 'v mono');
  setText('hdr-pnl', fmtPLN(agg.realizedPnl, true), 'v mono ' + posClass(agg.realizedPnl));
  setText('hdr-roi', agg.yieldPct === null ? '—' : fmtPct(agg.yieldPct), 'v mono ' + posClass(agg.yieldPct || 0));
  setText('hdr-open', String(agg.pending.length), 'v mono');
  setText('hdr-today', fmtPLN(agg.todayPnl, true), 'v mono ' + posClass(agg.todayPnl));
}

function renderKpis(agg) {
  setText('k-bank', fmtPLN(agg.bankroll), 'v mono');
  setText('k-bank-n', `start ${fmtPLN0(settings.bankrollStart)} · przepływy ${fmtPLN(agg.ledgerNet, true)}`);

  setText('k-pnl', fmtPLN(agg.realizedPnl, true), 'v mono ' + posClass(agg.realizedPnl));
  setText('k-pnl-n', `${agg.settled.length} rozliczonych · obrót ${fmtPLN0(agg.turnover)}`);

  setText('k-roi', agg.yieldPct === null ? '—' : fmtPct(agg.yieldPct), 'v mono ' + posClass(agg.yieldPct || 0));
  setText('k-roi-n', agg.yieldPct === null ? 'brak rozliczeń' : 'zysk / obrót');

  setText('k-wr', agg.winRate === null ? '—' : agg.winRate.toFixed(1) + '%', 'v mono');
  setText('k-wr-n', `${agg.wins} W / ${agg.losses} P${agg.pushes ? ` / ${agg.pushes} zwrot` : ''}`);

  setText('k-odds', agg.avgOdds === null ? '—' : fmtOdds(agg.avgOdds), 'v mono');
  setText('k-odds-n', agg.avgWinOdds || agg.avgLoseOdds
    ? `wygrane ${fmtOdds(agg.avgWinOdds)} · przegrane ${fmtOdds(agg.avgLoseOdds)}`
    : 'ważony obrotem');

  setText('k-dd', agg.maxDd > 0 ? fmtPLN(-agg.maxDd) : '—', 'v mono ' + (agg.maxDd > 0 ? 'neg' : ''));
  setText('k-dd-n', agg.maxDd > 0 ? `${agg.maxDdPct.toFixed(1)}% szczytu bankrolla` : 'brak obsunięcia');
}

function renderDiscipline(agg) {
  const unit = agg.unit;
  setText('d-unit', fmtPLN(unit), 'v');
  setText('d-unit-n', `${settings.unitPct}% bankrolla · max ${fmtPLN0(agg.bankroll * settings.maxStakePct / 100)} / kupon`);

  setText('d-exposure', fmtPLN(agg.openExposure), 'v' + (agg.openExposure > 0 ? '' : ''));
  setText('d-exposure-n', `${nKupon(agg.pending.length)} w grze · dostępne ${fmtPLN(agg.available)}`);

  // ekspozycja
  const expPct = agg.bankroll > 0 ? (agg.openExposure / agg.bankroll) * 100 : 0;
  const expRatio = clamp(expPct / settings.maxExposurePct * 100, 0, 100);
  setText('m-exp-pct', expPct.toFixed(1) + '%');
  const expBar = el('m-exp-bar');
  expBar.style.width = expRatio + '%';
  expBar.className = 'tc-bar-fill' + (expPct > settings.maxExposurePct ? ' bad' : expPct > settings.maxExposurePct * 0.7 ? ' warn' : '');
  setText('m-exp-limit', `Limit ${settings.maxExposurePct}% = ${fmtPLN0(agg.bankroll * settings.maxExposurePct / 100)}`);
  setText('m-exp-cur', fmtPLN(agg.openExposure));

  // strata dzienna
  const lossLimit = agg.bankroll * settings.maxDailyLossPct / 100;
  const todayLoss = Math.max(-agg.todayPnl, 0);
  const lossRatio = lossLimit > 0 ? clamp(todayLoss / lossLimit * 100, 0, 100) : 0;
  setText('m-loss-pct', lossLimit > 0 ? (todayLoss / lossLimit * 100).toFixed(0) + '%' : '—');
  el('m-loss-bar').style.width = lossRatio + '%';
  setText('m-loss-limit', `Limit ${settings.maxDailyLossPct}% = ${fmtPLN0(lossLimit)}`);
  setText('m-loss-cur', fmtPLN(agg.todayPnl, true));

  // liczba kuponów
  const cntRatio = clamp(agg.todayBets / settings.maxDailyBets * 100, 0, 100);
  setText('m-cnt-pct', `${agg.todayBets} / ${settings.maxDailyBets}`);
  const cntBar = el('m-cnt-bar');
  cntBar.style.width = cntRatio + '%';
  cntBar.className = 'tc-bar-fill' + (agg.todayBets > settings.maxDailyBets ? ' bad' : agg.todayBets >= settings.maxDailyBets ? ' warn' : '');
  setText('m-cnt-limit', `Postawione dziś: ${fmtPLN0(agg.todayStaked)}`);
  setText('m-cnt-cur', nKupon(agg.todayBets));

  // status + alerty (o statusie decydują wyłącznie przekroczone limity, nie noty informacyjne)
  const alerts = [];
  let limitBad = false, limitWarn = false;
  if (todayLoss >= lossLimit && lossLimit > 0) { limitBad = true; alerts.push(['bad', 'block', '<strong>Dzienny stop-loss osiągnięty.</strong> Zamknij laptopa — dziś już nie odrabiasz.']); }
  if (agg.todayBets >= settings.maxDailyBets) { limitWarn = true; alerts.push(['warn', 'timer', `<strong>Limit ${settings.maxDailyBets} kuponów dziennie</strong> osiągnięty. Kolejne typy to zwykle tilt.`]); }
  if (expPct > settings.maxExposurePct) { limitWarn = true; alerts.push(['warn', 'account_balance_wallet', `Ekspozycja ${expPct.toFixed(1)}% przekracza limit ${settings.maxExposurePct}%.`]); }

  // seria przegranych na koniec
  let tailLoss = 0;
  for (let i = agg.settled.length - 1; i >= 0; i--) {
    if (agg.settled[i].profit < 0) tailLoss++; else break;
  }
  if (tailLoss >= 3) alerts.push(['warn', 'trending_down', `Seria <strong>${tailLoss} przegranych</strong> z rzędu. Trzymaj płaskie stawki, nie podnoś.`]);

  // wzrost średniej stawki (chasing)
  const last5 = agg.all.slice(-5);
  if (last5.length === 5 && agg.avgStake) {
    const avg5 = last5.reduce((s, b) => s + b.stake, 0) / 5;
    if (avg5 > agg.avgStake * 1.6) alerts.push(['warn', 'trending_up', `Ostatnie 5 stawek jest <strong>${(avg5 / agg.avgStake).toFixed(1)}×</strong> wyższe od Twojej średniej. To klasyczny objaw odgrywania się.`]);
  }

  if (agg.avgClv !== null && agg.clvCount >= 5) {
    alerts.push([agg.avgClv > 0 ? 'good' : 'bad', 'insights',
      `Średni CLV <strong>${fmtPct(agg.avgClv)}</strong> (${agg.beatClose}/${agg.clvCount} kuponów lepszych od kursu zamknięcia). ${agg.avgClv > 0 ? 'Bijesz rynek — to najlepszy dowód przewagi.' : 'Rynek zamyka się lepiej niż Twój kurs — szukaj wcześniejszych wejść.'}`]);
  }

  if (!alerts.length) alerts.push(['good', 'check_circle', 'Wszystkie limity w normie. Trzymaj płaskie stawki i rejestruj każdy kupon.']);

  el('disc-alerts').innerHTML = alerts.map(([kind, icon, html]) =>
    `<div class="bt-alert ${kind}"><span class="material-symbols-outlined">${icon}</span><span>${html}</span></div>`).join('');

  setText('disc-status', limitBad ? 'STOP — limit przekroczony' : limitWarn ? 'Uwaga na limity' : 'Pod kontrolą');
  el('disc-status').className = 'sub';
  el('disc-status').style.color = limitBad ? 'var(--tc-neg)' : limitWarn ? 'var(--tc-warn)' : 'var(--tc-pos)';
}

function renderBankrollChart(agg) {
  const canvas = el('chart-bankroll');
  if (!canvas || typeof Chart === 'undefined') return;
  const ctx = canvas.getContext('2d');

  let pts = agg.points;
  if (eqRange !== 'all' && pts.length > 1) {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - Number(eqRange));
    const c = cutoff.toISOString().slice(0, 10);
    const filtered = pts.filter((p, i) => i === 0 || p.date >= c);
    if (filtered.length > 1) pts = filtered;
  }

  const labels = pts.map(p => p.date);
  const values = pts.map(p => p.value);
  const net = values.length ? values[values.length - 1] : settings.bankrollStart;
  const delta = agg.realizedPnl;

  setText('eq-net', fmtPLN(net), 'net mono');
  setText('eq-delta', `${fmtPLN(delta, true)} · ${agg.yieldPct === null ? '—' : fmtPct(agg.yieldPct)} yield`, 'delta mono ' + posClass(delta));

  if (charts.bankroll) charts.bankroll.destroy();
  const g = ctx.createLinearGradient(0, 0, 0, 240);
  const base = delta >= 0 ? 'rgba(11,138,74,' : 'rgba(192,54,44,';
  g.addColorStop(0, base + '0.22)');
  g.addColorStop(1, base + '0)');
  const line = delta >= 0 ? '#0b8a4a' : '#c0362c';

  charts.bankroll = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: values, borderColor: line, backgroundColor: g, fill: true,
        borderWidth: 2, tension: 0.25, pointRadius: 0, pointHoverRadius: 4,
        pointHoverBackgroundColor: line, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2
      }]
    },
    options: {
      maintainAspectRatio: false, responsive: true, animation: { duration: 200 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f172a', titleColor: '#fff', bodyColor: '#cbd5e1',
          padding: 10, displayColors: false, cornerRadius: 6,
          callbacks: { label: c => fmtPLN(c.parsed.y) }
        }
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 }, maxTicksLimit: 8 } },
        y: { grid: { color: 'rgba(226,232,240,0.7)' }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => Math.round(v).toLocaleString('pl-PL') } }
      }
    }
  });
}

function betEventCell(b, compact = false) {
  const meta = [];
  if (b.betType === 'combo') meta.push(`<span class="bt-pill accent">AKO ${b.legs.length}</span>`);
  if (b.bookmaker) meta.push(`<span class="bt-pill">${esc(b.bookmaker)}</span>`);
  if (!compact && b.sport) meta.push(`<span class="bt-pill">${esc(b.sport)}</span>`);
  if (b.live) meta.push(`<span class="bt-pill live">LIVE</span>`);
  if (b.freebet) meta.push(`<span class="bt-pill free">FREEBET</span>`);
  if (!compact && b.taxFree) meta.push(`<span class="bt-pill warn">bez podatku</span>`);
  if (!compact) for (const t of b.tags.slice(0, 3)) meta.push(`<span class="bt-pill">#${esc(t)}</span>`);
  const title = b.betType === 'combo'
    ? (b.event || `Kupon ${b.legs.length}-zdarzeniowy`)
    : (b.event || '—');
  const sub = b.betType === 'combo'
    ? b.legs.map(l => l.pick || l.event).filter(Boolean).slice(0, 3).join(' • ') + (b.legs.length > 3 ? ' …' : '')
    : [b.market, b.pick].filter(Boolean).join(' → ');
  return `<div class="bt-event${compact ? ' compact' : ''}">
      <span class="ev">${esc(title)}</span>
      ${sub ? `<span class="pk">${esc(sub)}</span>` : ''}
      ${meta.length ? `<span class="meta">${meta.join('')}</span>` : ''}
    </div>`;
}

function confBars(n) {
  return `<span class="bt-conf">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
}

function renderOpenBets(agg) {
  const wrap = el('open-bets-wrap');
  setText('open-count', String(agg.pending.length));
  if (!agg.pending.length) {
    wrap.innerHTML = `<div class="tc-empty">
      <span class="material-symbols-outlined">receipt_long</span>
      <h4>Brak otwartych kuponów</h4>
      <p>Dodaj kupon zaraz po jego postawieniu — rejestrowanie na bieżąco to podstawa uczciwej statystyki.</p>
    </div>`;
    return;
  }
  const unit = agg.unit;
  const rows = [...agg.pending].sort((a, b) => (a.date < b.date ? 1 : -1)).map(b => `
    <tr>
      <td class="nowrap">${esc(b.date)}</td>
      <td>${betEventCell(b)}</td>
      <td class="num"><span class="bt-odds">${fmtOdds(b.odds)}</span></td>
      <td class="num">${fmtPLN(b.stake)}<br><span class="muted" style="font-size:10.5px">${unit > 0 ? (b.stake / unit).toFixed(2) + 'u' : ''}</span></td>
      <td class="num">${fmtPLN(b.payoutIfWon)}</td>
      <td class="num pos">${fmtPLN(b.potentialProfit, true)}</td>
      <td>${confBars(b.confidence)}</td>
      <td>
        <div class="row-actions">
          <button class="row-btn" title="Wygrany" onclick="quickSettle('${b.id}','won')" style="color:var(--tc-pos)"><span class="material-symbols-outlined">thumb_up</span></button>
          <button class="row-btn" title="Przegrany" onclick="quickSettle('${b.id}','lost')" style="color:var(--tc-neg)"><span class="material-symbols-outlined">thumb_down</span></button>
          <button class="row-btn" title="Rozlicz szczegółowo" onclick="openSettleModal('${b.id}')"><span class="material-symbols-outlined">task_alt</span></button>
          <button class="row-btn" title="Edytuj" onclick="openBetModal('${b.id}')"><span class="material-symbols-outlined">edit</span></button>
          <button class="row-btn danger" title="Usuń" onclick="deleteBet('${b.id}')"><span class="material-symbols-outlined">delete</span></button>
        </div>
      </td>
    </tr>`).join('');

  wrap.innerHTML = `<table class="tc-tbl">
    <thead><tr>
      <th>Data</th><th>Kupon</th><th class="num">Kurs</th><th class="num">Stawka</th>
      <th class="num">Wypłata</th><th class="num">Potencjał</th><th>Pewność</th><th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderRecent(agg) {
  const wrap = el('recent-wrap');
  const recent = [...agg.settled].reverse().slice(0, 8);
  setText('recent-count', `${agg.settled.length} rozliczonych`);
  if (!recent.length) {
    wrap.innerHTML = `<div class="tc-empty"><span class="material-symbols-outlined">history</span><h4>Brak rozliczeń</h4><p>Tu pojawią się ostatnio rozliczone kupony.</p></div>`;
    return;
  }
  wrap.innerHTML = `<div class="tc-tbl-wrap"><table class="tc-tbl">
    <thead><tr><th>Data</th><th>Kupon</th><th class="num">Kurs</th><th class="num">Stawka</th><th>Wynik</th><th class="num">P&L</th></tr></thead>
    <tbody>${recent.map(b => `
      <tr>
        <td class="nowrap">${esc(b.settledDate)}</td>
        <td>${betEventCell(b, true)}</td>
        <td class="num"><span class="bt-odds">${fmtOdds(b.odds)}</span></td>
        <td class="num">${fmtPLN(b.stake)}</td>
        <td><span class="bt-tag ${b.status}">${STATUS_LABEL[b.status]}</span></td>
        <td class="num ${posClass(b.profit)}">${fmtPLN(b.profit, true)}</td>
      </tr>`).join('')}</tbody>
  </table></div>`;
}

function renderRankList(wrapId, map, emptyText) {
  const wrap = el(wrapId);
  const rows = [...map.entries()].map(([k, bets]) => ({ key: k, ...bucketStats(bets) }))
    .filter(r => r.count > 0)
    .sort((a, b) => Math.abs(b.profit) - Math.abs(a.profit))
    .slice(0, 8);
  if (!rows.length) {
    wrap.innerHTML = `<div class="tc-empty"><span class="material-symbols-outlined">bar_chart</span><h4>Brak danych</h4><p>${esc(emptyText)}</p></div>`;
    return;
  }
  const max = Math.max(...rows.map(r => Math.abs(r.profit)), 1);
  wrap.innerHTML = `<div class="bt-rank">${rows.map(r => {
    const w = Math.abs(r.profit) / max * 50;
    return `<div class="bt-rank-row">
      <div class="t">${esc(r.key)}<small>${nKupon(r.count)} · obrót ${fmtPLN0(r.turnover)}</small></div>
      <div class="bar"><i class="${r.profit < 0 ? 'neg' : ''}" style="width:${w}%"></i></div>
      <div class="v ${posClass(r.profit)}">${fmtPLN(r.profit, true)}</div>
      <div class="r">${r.yieldPct === null ? '—' : fmtPct(r.yieldPct, true, 1)}</div>
    </div>`;
  }).join('')}</div>`;
}

function renderGoal(agg) {
  const monthKey = today().slice(0, 7);
  const monthBets = agg.settled.filter(b => b.settledDate.startsWith(monthKey));
  const monthPnl = monthBets.reduce((s, b) => s + b.profit, 0);
  const target = agg.cashBase * settings.monthlyGoalPct / 100;
  const pct = target > 0 ? (monthPnl / target) * 100 : 0;

  setText('goal-sub', new Date().toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' }));
  setText('goal-label', `Cel: ${fmtPLN(target)} (${settings.monthlyGoalPct}% bankrolla)`);
  setText('goal-pct', target > 0 ? pct.toFixed(0) + '%' : '—');
  const bar = el('goal-bar');
  bar.style.width = clamp(pct, 0, 100) + '%';
  bar.className = 'tc-bar-fill ' + (monthPnl >= 0 ? 'good' : 'bad');
  setText('goal-note', `Rozliczone w tym miesiącu: ${nKupon(monthBets.length)}`);
  setText('goal-cur', fmtPLN(monthPnl, true));
}

/* ============================================================
   Zakładka: Kupony
   ============================================================ */
function periodStart(period) {
  const now = new Date();
  if (period === '30') { const d = new Date(now); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); }
  if (period === '90') { const d = new Date(now); d.setDate(d.getDate() - 90); return d.toISOString().slice(0, 10); }
  if (period === 'ytd') return `${now.getFullYear()}-01-01`;
  if (period === 'month') return today().slice(0, 7) + '-01';
  return null;
}

function filteredBets(agg) {
  const q = betFilters.q.trim().toLowerCase();
  const from = periodStart(betFilters.period);
  return agg.all.filter(b => {
    if (betFilters.status === 'pending' && b.settled) return false;
    if (betFilters.status === 'won' && b.status !== 'won' && b.status !== 'half_won') return false;
    if (betFilters.status === 'lost' && b.status !== 'lost' && b.status !== 'half_lost') return false;
    if (betFilters.status === 'other' && b.status !== 'void' && b.status !== 'cashout') return false;
    if (betFilters.book && b.bookmaker !== betFilters.book) return false;
    if (betFilters.sport && b.sport !== betFilters.sport) return false;
    if (from && (b.settledDate || b.date) < from) return false;
    if (q) {
      const hay = [b.event, b.pick, b.market, b.league, b.bookmaker, b.sport, b.note, b.tags.join(' '),
      ...b.legs.map(l => `${l.event} ${l.pick}`)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function groupKeyFor(dateStr, grouping) {
  if (grouping === 'day') return dateStr;
  if (grouping === 'week') return isoWeekKey(dateStr);
  return dateStr.slice(0, 7);
}
function groupLabelFor(key, grouping) {
  if (grouping === 'day') {
    const d = new Date(key + 'T00:00:00');
    return d.toLocaleDateString('pl-PL', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  }
  if (grouping === 'week') return `Tydzień ${key.split('-W')[1]} · ${key.split('-W')[0]}`;
  return monthLabel(key);
}

function renderBetsSummary(list) {
  const settled = list.filter(b => b.settled);
  const s = bucketStats(settled);
  const pending = list.filter(b => !b.settled);
  const cells = [
    ['Kupony', String(list.length), `${pending.length} otwartych`, ''],
    ['Obrót', fmtPLN0(s.turnover), `śr. stawka ${settled.length ? fmtPLN0(settled.reduce((a, b) => a + b.stake, 0) / settled.length) : '—'}`, ''],
    ['Zysk / strata', fmtPLN(s.profit, true), `${s.wins} W / ${s.losses} P`, posClass(s.profit)],
    ['Yield', s.yieldPct === null ? '—' : fmtPct(s.yieldPct), 'zysk / obrót', posClass(s.yieldPct || 0)],
    ['Skuteczność', s.winRate === null ? '—' : s.winRate.toFixed(1) + '%', 'trafione / rozstrzygnięte', ''],
    ['Ekspozycja', fmtPLN0(pending.reduce((a, b) => a + b.risked, 0)), 'zablokowane w otwartych', '']
  ];
  el('bets-summary').innerHTML = cells.map(([k, v, n, cls]) =>
    `<div class="bt-acct-cell"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="n">${n}</div></div>`).join('');
}

function betRow(b, agg) {
  const unit = agg.unit;
  const clv = b.closingOdds ? (b.odds / b.closingOdds - 1) * 100 : null;
  return `
    <tr class="${b.settled ? '' : 'pending-row'}">
      <td class="nowrap">
        <button class="expand-btn ${expandedBets.has(b.id) ? 'open' : ''}" onclick="toggleBet('${b.id}')"><span class="material-symbols-outlined">chevron_right</span></button>
      </td>
      <td class="nowrap">${esc(b.settled ? b.settledDate : b.date)}</td>
      <td>${betEventCell(b)}</td>
      <td class="num"><span class="bt-odds">${fmtOdds(b.odds)}</span>${clv !== null ? `<br><span class="muted" style="font-size:10px">CLV ${fmtPct(clv, true, 1)}</span>` : ''}</td>
      <td class="num">${fmtPLN(b.stake)}${unit > 0 ? `<br><span class="muted" style="font-size:10.5px">${(b.stake / unit).toFixed(2)}u</span>` : ''}</td>
      <td><span class="bt-tag ${b.status}">${STATUS_LABEL[b.status]}</span></td>
      <td class="num">${b.settled ? fmtPLN(b.returned) : `<span class="muted">${fmtPLN(b.payoutIfWon)}</span>`}</td>
      <td class="num ${b.settled ? posClass(b.profit) : 'muted'}">${b.settled ? fmtPLN(b.profit, true) : fmtPLN(b.potentialProfit, true)}</td>
      <td>
        <div class="row-actions">
          <button class="row-btn" title="${b.settled ? 'Zmień rozliczenie' : 'Rozlicz'}" onclick="openSettleModal('${b.id}')"><span class="material-symbols-outlined">task_alt</span></button>
          <button class="row-btn" title="Edytuj" onclick="openBetModal('${b.id}')"><span class="material-symbols-outlined">edit</span></button>
          <button class="row-btn danger" title="Usuń" onclick="deleteBet('${b.id}')"><span class="material-symbols-outlined">delete</span></button>
        </div>
      </td>
    </tr>
    ${expandedBets.has(b.id) ? betDetailRow(b) : ''}`;
}

function betDetailRow(b) {
  const clv = b.closingOdds ? (b.odds / b.closingOdds - 1) * 100 : null;
  const kv = [
    ['Postawiony', b.date],
    ['Rozliczony', b.settledDate || '—'],
    ['Bukmacher', b.bookmaker || '—'],
    ['Dyscyplina', b.sport || '—'],
    ['Rozgrywki', b.league || '—'],
    ['Rynek', b.market || '—'],
    ['Kurs', fmtOdds(b.odds)],
    ['Kurs efektywny', b.stake > 0 ? fmtOdds(b.payoutIfWon / b.stake) : '—'],
    ['Kurs zamknięcia', b.closingOdds ? fmtOdds(b.closingOdds) : '—'],
    ['CLV', clv === null ? '—' : fmtPct(clv, true, 1)],
    ['Stawka', fmtPLN(b.stake)],
    ['Podatek od stawki', fmtPLN(b.stakeTax)],
    ['Stawka netto', fmtPLN(b.netStake)],
    ['Wypłata przy wygranej', fmtPLN(b.payoutIfWon)],
    ['Podatek od wygranej', fmtPLN(b.winTaxPaid || 0)],
    ['Zwrot', b.settled ? fmtPLN(b.returned) : '—'],
    ['Wynik', b.settled ? fmtPLN(b.profit, true) : '—'],
    ['Pewność', `${b.confidence} / 5`]
  ];
  const legsHtml = b.betType === 'combo' && b.legs.length
    ? `<div>
         <div class="bt-detail-title">Nogi kuponu (${b.legs.length})</div>
         <div class="bt-legs">${b.legs.map(l => `
           <div class="bt-leg">
             <div class="l-main"><div class="l-ev">${esc(l.event || '—')}</div><div class="l-pk">${esc(l.pick || '')}</div></div>
             <div class="l-odds">${fmtOdds(l.odds)}</div>
             <div></div>
           </div>`).join('')}
         </div>
         <div style="margin-top:6px; font-size:11.5px; color:var(--tc-muted)">Kurs łączny z nóg: <strong>${fmtOdds(comboOdds(b.legs))}</strong></div>
       </div>`
    : '';

  return `<tr class="bt-detail-row"><td colspan="9">
    <div class="bt-detail">
      <div>
        <div class="bt-detail-title">Szczegóły kuponu</div>
        <div class="bt-kv">${kv.map(([k, v]) => `<div class="kv"><span class="k">${k}</span><span class="v ${k === 'Wynik' ? posClass(b.profit) : ''}">${esc(String(v))}</span></div>`).join('')}</div>
        ${b.note ? `<div class="bt-note">${esc(b.note)}</div>` : ''}
      </div>
      ${legsHtml || `<div><div class="bt-detail-title">Typ</div><div class="bt-legs"><div class="bt-leg"><div class="l-main"><div class="l-ev">${esc(b.event || '—')}</div><div class="l-pk">${esc([b.market, b.pick].filter(Boolean).join(' → ') || '—')}</div></div><div class="l-odds">${fmtOdds(b.odds)}</div><div></div></div></div></div>`}
    </div>
  </td></tr>`;
}

function betsTable(list, agg) {
  return `<div class="tc-tbl-wrap"><table class="tc-tbl">
    <thead><tr>
      <th style="width:34px"></th><th>Data</th><th>Kupon</th><th class="num">Kurs</th><th class="num">Stawka</th>
      <th>Status</th><th class="num">Zwrot</th><th class="num">P&L</th><th style="width:110px"></th>
    </tr></thead>
    <tbody>${list.map(b => betRow(b, agg)).join('')}</tbody>
  </table></div>`;
}

function renderBetsTab(agg) {
  const list = filteredBets(agg);
  renderBetsSummary(list);

  const pending = list.filter(b => !b.settled).sort((a, b) => (a.date < b.date ? 1 : -1));
  const settled = list.filter(b => b.settled);

  el('pending-section').innerHTML = pending.length
    ? `<div class="bt-group-head" style="cursor:default; border-top:1px solid var(--tc-line)">
         <div class="left"><strong>Otwarte kupony</strong><span class="meta">${nKupon(pending.length)} · ekspozycja ${fmtPLN0(pending.reduce((s, b) => s + b.risked, 0))}</span></div>
       </div>${betsTable(pending, agg)}`
    : '';

  if (!settled.length) {
    el('settled-section').innerHTML = `<div class="tc-empty" style="border-top:1px solid var(--tc-line)">
      <span class="material-symbols-outlined">filter_alt_off</span>
      <h4>Brak rozliczonych kuponów</h4>
      <p>Zmień filtry albo rozlicz otwarte kupony, żeby zobaczyć historię.</p>
    </div>`;
    return;
  }

  const grouping = betFilters.grouping;
  const groups = groupBy(settled, b => groupKeyFor(b.settledDate, grouping));
  const keys = [...groups.keys()].sort().reverse();

  el('settled-section').innerHTML = `<div class="bt-groups">${keys.map(k => {
    const bets = groups.get(k).sort((a, b) => (a.settledDate < b.settledDate ? 1 : -1));
    const s = bucketStats(bets);
    const open = expandedGroups.has(k);
    return `<div class="bt-group ${open ? 'open' : ''}">
      <div class="bt-group-head" onclick="toggleGroup('${k}')">
        <div class="left">
          <span class="material-symbols-outlined chev">chevron_right</span>
          <strong>${groupLabelFor(k, grouping)}</strong>
          <span class="meta">${nKupon(s.count)} · obrót ${fmtPLN0(s.turnover)} · ${s.winRate === null ? '—' : s.winRate.toFixed(0) + '% skut.'}</span>
        </div>
        <div style="display:flex; gap:12px; align-items:baseline;">
          <span class="mono ${posClass(s.profit)}" style="font-weight:600">${fmtPLN(s.profit, true)}</span>
          <span class="mono muted" style="font-size:11.5px">${s.yieldPct === null ? '—' : fmtPct(s.yieldPct, true, 1)}</span>
        </div>
      </div>
      ${open ? `<div class="bt-group-body">${betsTable(bets, agg)}</div>` : ''}
    </div>`;
  }).join('')}</div>`;
}

function toggleBet(id) {
  if (expandedBets.has(id)) expandedBets.delete(id); else expandedBets.add(id);
  renderAll();
}
function toggleGroup(k) {
  if (expandedGroups.has(k)) expandedGroups.delete(k); else expandedGroups.add(k);
  renderAll();
}

/* ============================================================
   Analityka
   ============================================================ */
const CHART_BASE = {
  maintainAspectRatio: false, responsive: true, animation: { duration: 200 },
  plugins: {
    legend: { display: false },
    tooltip: { backgroundColor: '#0f172a', titleColor: '#fff', bodyColor: '#cbd5e1', padding: 10, displayColors: false, cornerRadius: 6 }
  },
  scales: {
    x: { grid: { display: false }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } },
    y: { grid: { color: 'rgba(226,232,240,0.7)' }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } }
  }
};
function structuredCloneSafe(o) {
  return JSON.parse(JSON.stringify(o));
}
function barColors(values) {
  return values.map(v => v >= 0 ? '#0b8a4a' : '#c0362c');
}
function makeChart(id, config) {
  const canvas = el(id);
  if (!canvas || typeof Chart === 'undefined') return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(canvas.getContext('2d'), config);
}

const ODDS_BUCKETS = [
  { k: '< 1.50', lo: 0, hi: 1.5 },
  { k: '1.50–1.99', lo: 1.5, hi: 2 },
  { k: '2.00–2.99', lo: 2, hi: 3 },
  { k: '3.00–4.99', lo: 3, hi: 5 },
  { k: '5.00–9.99', lo: 5, hi: 10 },
  { k: '10.00+', lo: 10, hi: Infinity }
];
function oddsBucket(o) {
  return (ODDS_BUCKETS.find(b => o >= b.lo && o < b.hi) || ODDS_BUCKETS[ODDS_BUCKETS.length - 1]).k;
}

function renderAnalytics(agg) {
  const settled = agg.settled;

  setText('an-total', String(agg.all.length));
  setText('an-wl', `${agg.wins} / ${agg.losses}`);
  setText('an-turnover', fmtPLN0(agg.turnover));
  setText('an-avgstake', agg.avgStake === null ? '—' : fmtPLN(agg.avgStake));
  setText('an-oddswin', agg.avgWinOdds === null ? '—' : fmtOdds(agg.avgWinOdds), 'v mono pos');
  setText('an-oddslose', agg.avgLoseOdds === null ? '—' : fmtOdds(agg.avgLoseOdds), 'v mono neg');

  const best = settled.reduce((m, b) => (m === null || b.profit > m.profit ? b : m), null);
  const worst = settled.reduce((m, b) => (m === null || b.profit < m.profit ? b : m), null);
  setText('an-best', best ? fmtPLN(best.profit, true) : '—', 'v mono pos');
  setText('an-worst', worst ? fmtPLN(worst.profit, true) : '—', 'v mono neg');
  setText('an-winstreak', agg.bestWin ? `${agg.bestWin}×` : '—');
  setText('an-lossstreak', agg.worstLoss ? `${agg.worstLoss}×` : '—');
  setText('an-clv', agg.avgClv === null ? '—' : fmtPct(agg.avgClv), 'v mono ' + posClass(agg.avgClv || 0));
  setText('an-tax', fmtPLN(agg.taxTotal));

  // 1. P&L miesięczny
  const byMonth = groupBy(settled, b => b.settledDate.slice(0, 7));
  const mKeys = [...byMonth.keys()].sort();
  const mVals = mKeys.map(k => bucketStats(byMonth.get(k)).profit);
  makeChart('chart-monthly', {
    type: 'bar',
    data: { labels: mKeys.map(monthLabel), datasets: [{ data: mVals, backgroundColor: barColors(mVals), borderRadius: 4, maxBarThickness: 34 }] },
    options: {
      ...structuredCloneSafe(CHART_BASE),
      plugins: { legend: { display: false }, tooltip: { ...CHART_BASE.plugins.tooltip, callbacks: { label: c => fmtPLN(c.parsed.y, true) } } },
      scales: { ...structuredCloneSafe(CHART_BASE.scales), y: { ...structuredCloneSafe(CHART_BASE.scales.y), ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => Math.round(v).toLocaleString('pl-PL') } } }
    }
  });

  // 2. Skumulowany zysk vs obrót
  let cp = 0, ct = 0;
  const cumLabels = [], cumProfit = [], cumTurn = [];
  for (const b of settled) { cp += b.profit; ct += b.turnover; cumLabels.push(b.settledDate); cumProfit.push(cp); cumTurn.push(ct); }
  makeChart('chart-cum', {
    type: 'line',
    data: {
      labels: cumLabels,
      datasets: [
        { label: 'Zysk', data: cumProfit, borderColor: '#0b8a4a', backgroundColor: 'rgba(11,138,74,.12)', fill: true, borderWidth: 2, tension: .2, pointRadius: 0 },
        { label: 'Obrót', data: cumTurn, borderColor: '#94a3b8', borderDash: [4, 4], borderWidth: 1.5, tension: .2, pointRadius: 0, fill: false }
      ]
    },
    options: {
      ...structuredCloneSafe(CHART_BASE),
      plugins: {
        legend: { display: true, labels: { boxWidth: 10, boxHeight: 10, font: { size: 10 }, color: '#64748b' } },
        tooltip: { ...CHART_BASE.plugins.tooltip, displayColors: true, callbacks: { label: c => `${c.dataset.label}: ${fmtPLN(c.parsed.y, true)}` } }
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 }, maxTicksLimit: 8 } },
        y: { grid: { color: 'rgba(226,232,240,0.7)' }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => Math.round(v).toLocaleString('pl-PL') } }
      }
    }
  });

  // 3. Yield wg kursu
  const byOdds = groupBy(settled, b => oddsBucket(b.odds));
  const oKeys = ODDS_BUCKETS.map(b => b.k).filter(k => byOdds.has(k));
  const oVals = oKeys.map(k => { const s = bucketStats(byOdds.get(k)); return s.yieldPct === null ? 0 : s.yieldPct; });
  makeChart('chart-odds', {
    type: 'bar',
    data: { labels: oKeys, datasets: [{ data: oVals, backgroundColor: barColors(oVals), borderRadius: 4, maxBarThickness: 30 }] },
    options: {
      ...structuredCloneSafe(CHART_BASE),
      plugins: {
        legend: { display: false },
        tooltip: {
          ...CHART_BASE.plugins.tooltip,
          callbacks: {
            label: c => {
              const s = bucketStats(byOdds.get(oKeys[c.dataIndex]));
              return [`Yield: ${fmtPct(s.yieldPct)}`, `Kupony: ${s.count}`, `P&L: ${fmtPLN(s.profit, true)}`];
            }
          }
        }
      },
      scales: { ...structuredCloneSafe(CHART_BASE.scales), y: { ...structuredCloneSafe(CHART_BASE.scales.y), ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => v + '%' } } }
    }
  });

  // 4. P&L wg wielkości stawki (unity)
  const unit = agg.unit || 1;
  const stakeBucket = b => {
    const u = b.stake / unit;
    if (u < 0.75) return '< 0.75u';
    if (u < 1.25) return '≈ 1u';
    if (u < 2) return '1.25–2u';
    if (u < 3) return '2–3u';
    return '3u+';
  };
  const sOrder = ['< 0.75u', '≈ 1u', '1.25–2u', '2–3u', '3u+'];
  const byStake = groupBy(settled, stakeBucket);
  const sKeys = sOrder.filter(k => byStake.has(k));
  const sVals = sKeys.map(k => bucketStats(byStake.get(k)).profit);
  makeChart('chart-stake', {
    type: 'bar',
    data: { labels: sKeys, datasets: [{ data: sVals, backgroundColor: barColors(sVals), borderRadius: 4, maxBarThickness: 30 }] },
    options: {
      ...structuredCloneSafe(CHART_BASE),
      plugins: {
        legend: { display: false },
        tooltip: {
          ...CHART_BASE.plugins.tooltip,
          callbacks: {
            label: c => {
              const s = bucketStats(byStake.get(sKeys[c.dataIndex]));
              return [`P&L: ${fmtPLN(s.profit, true)}`, `Kupony: ${s.count}`, `Yield: ${fmtPct(s.yieldPct)}`];
            }
          }
        }
      },
      scales: { ...structuredCloneSafe(CHART_BASE.scales), y: { ...structuredCloneSafe(CHART_BASE.scales.y), ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => Math.round(v).toLocaleString('pl-PL') } } }
    }
  });

  // 5. P&L wg bukmachera
  const byBook = groupBy(settled, b => b.bookmaker || 'Bez nazwy');
  const bKeys = [...byBook.keys()].sort((a, b) => bucketStats(byBook.get(b)).profit - bucketStats(byBook.get(a)).profit).slice(0, 8);
  const bVals = bKeys.map(k => bucketStats(byBook.get(k)).profit);
  makeChart('chart-book', {
    type: 'bar',
    data: { labels: bKeys, datasets: [{ data: bVals, backgroundColor: barColors(bVals), borderRadius: 4, maxBarThickness: 26 }] },
    options: {
      ...structuredCloneSafe(CHART_BASE),
      indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { ...CHART_BASE.plugins.tooltip, callbacks: { label: c => fmtPLN(c.parsed.x, true) } } },
      scales: {
        x: { grid: { color: 'rgba(226,232,240,0.7)' }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => Math.round(v).toLocaleString('pl-PL') } },
        y: { grid: { display: false }, border: { display: false }, ticks: { color: '#64748b', font: { size: 10 } } }
      }
    }
  });

  // 6. Struktura wyników
  const counts = {
    won: settled.filter(b => b.status === 'won').length,
    half_won: settled.filter(b => b.status === 'half_won').length,
    lost: settled.filter(b => b.status === 'lost').length,
    half_lost: settled.filter(b => b.status === 'half_lost').length,
    void: settled.filter(b => b.status === 'void').length,
    cashout: settled.filter(b => b.status === 'cashout').length
  };
  const wrLabels = Object.keys(counts).filter(k => counts[k] > 0);
  makeChart('chart-wr', {
    type: 'doughnut',
    data: {
      labels: wrLabels.map(k => STATUS_LABEL[k]),
      datasets: [{
        data: wrLabels.map(k => counts[k]),
        backgroundColor: wrLabels.map(k => ({ won: '#0b8a4a', half_won: '#4ea87c', lost: '#c0362c', half_lost: '#d9736b', void: '#6366f1', cashout: '#7c3aed' }[k])),
        borderWidth: 0
      }]
    },
    options: {
      maintainAspectRatio: false, responsive: true, cutout: '62%',
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, font: { size: 10 }, color: '#64748b', padding: 8 } },
        tooltip: { backgroundColor: '#0f172a', titleColor: '#fff', bodyColor: '#cbd5e1', padding: 10, cornerRadius: 6 }
      }
    }
  });

  // 7. P&L wg dnia tygodnia
  const dows = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb', 'Nd'];
  const dowVals = dows.map((_, i) => settled
    .filter(b => ((new Date(b.settledDate + 'T00:00:00').getDay() + 6) % 7) === i)
    .reduce((s, b) => s + b.profit, 0));
  makeChart('chart-dow', {
    type: 'bar',
    data: { labels: dows, datasets: [{ data: dowVals, backgroundColor: barColors(dowVals), borderRadius: 4, maxBarThickness: 26 }] },
    options: {
      ...structuredCloneSafe(CHART_BASE),
      plugins: { legend: { display: false }, tooltip: { ...CHART_BASE.plugins.tooltip, callbacks: { label: c => fmtPLN(c.parsed.y, true) } } },
      scales: { ...structuredCloneSafe(CHART_BASE.scales), y: { ...structuredCloneSafe(CHART_BASE.scales.y), ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => Math.round(v).toLocaleString('pl-PL') } } }
    }
  });

  // 8. Skuteczność wg pewności
  const confKeys = [1, 2, 3, 4, 5];
  const confStats = confKeys.map(c => bucketStats(settled.filter(b => b.confidence === c)));
  makeChart('chart-conf', {
    type: 'bar',
    data: {
      labels: confKeys.map(c => `Pewność ${c}`),
      datasets: [
        { label: 'Skuteczność (%)', data: confStats.map(s => s.winRate === null ? 0 : s.winRate), backgroundColor: '#0057c0', borderRadius: 4, maxBarThickness: 28, yAxisID: 'y' },
        { label: 'Yield (%)', data: confStats.map(s => s.yieldPct === null ? 0 : s.yieldPct), type: 'line', borderColor: '#b45309', backgroundColor: '#b45309', borderWidth: 2, tension: .25, pointRadius: 3, yAxisID: 'y1' }
      ]
    },
    options: {
      maintainAspectRatio: false, responsive: true, animation: { duration: 200 },
      plugins: {
        legend: { display: true, labels: { boxWidth: 10, boxHeight: 10, font: { size: 10 }, color: '#64748b' } },
        tooltip: {
          backgroundColor: '#0f172a', titleColor: '#fff', bodyColor: '#cbd5e1', padding: 10, cornerRadius: 6, displayColors: true,
          callbacks: { afterBody: items => `Kupony: ${confStats[items[0].dataIndex].count}` }
        }
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } },
        y: { position: 'left', grid: { color: 'rgba(226,232,240,0.7)' }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => v + '%' } },
        y1: { position: 'right', grid: { display: false }, border: { display: false }, ticks: { color: '#b45309', font: { size: 10 }, callback: v => v + '%' } }
      }
    }
  });

  // Rankingi
  renderRankList('market-perf-wrap', groupBy(settled, b => b.market || 'Bez rynku'), 'Uzupełniaj pole „Rynek”, aby zobaczyć, które typy zakładów Ci płacą.');
  const tagMap = new Map();
  for (const b of settled) for (const t of (b.tags.length ? b.tags : ['bez tagu'])) {
    if (!tagMap.has(t)) tagMap.set(t, []);
    tagMap.get(t).push(b);
  }
  renderRankList('tag-perf-wrap', tagMap, 'Taguj kupony strategiami, aby porównać ich skuteczność.');

  // Mapa kursów
  el('odds-heat').innerHTML = ODDS_BUCKETS.map(bk => {
    const bets = settled.filter(b => b.odds >= bk.lo && b.odds < bk.hi);
    const s = bucketStats(bets);
    const cls = !s.count ? '' : s.profit > 0 ? 'pos' : s.profit < 0 ? 'neg' : '';
    return `<div class="bt-heat-cell ${cls}">
      <div class="k">${bk.k}</div>
      <div class="v">${s.count ? fmtPct(s.yieldPct, true, 1) : '—'}</div>
      <div class="n">${nKupon(s.count)} · ${fmtPLN0(s.profit)}</div>
    </div>`;
  }).join('');
}

/* ============================================================
   Kalendarz P&L
   ============================================================ */
function shiftCalendarMonth(delta) {
  const [y, m] = calendarState.month.split('-').map(Number);
  const d = new Date(y, (m - 1) + delta, 1);
  calendarState.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  renderCalendar(aggregate());
}

function dayStat(agg, key, runningBank) {
  const pnl = agg.byDay[key] || 0;
  const turnover = agg.turnoverByDay[key] || 0;
  const bets = agg.countByDay[key] || 0;
  const w = agg.winsByDay[key] || 0;
  const l = agg.lossesByDay[key] || 0;
  return {
    pnl, turnover, bets, wins: w, losses: l,
    roi: turnover > 0 ? (pnl / turnover) * 100 : null,
    wr: (w + l) > 0 ? (w / (w + l)) * 100 : null,
    bank: runningBank
  };
}

function calMetricValue(metric, s) {
  if (!s) return '—';
  if (metric === 'pnl') return s.bets ? fmtPLN(s.pnl, true) : '—';
  if (metric === 'roi') return s.roi === null ? '—' : fmtPct(s.roi, true, 1);
  if (metric === 'bank') return s.bank === null ? '—' : fmtPLN0(s.bank);
  if (metric === 'turnover') return s.turnover ? fmtPLN0(s.turnover) : '—';
  if (metric === 'bets') return s.bets ? String(s.bets) : '—';
  if (metric === 'wr') return s.wr === null ? '—' : s.wr.toFixed(0) + '%';
  return '—';
}
function calMetricClass(metric, s) {
  if (!s || !s.bets) return '';
  if (metric === 'bets' || metric === 'turnover') return '';
  if (metric === 'bank') return s.bank > settings.bankrollStart ? 'pos' : s.bank < settings.bankrollStart ? 'neg' : '';
  if (metric === 'wr') return s.wr === null ? '' : (s.wr >= 50 ? 'pos' : 'neg');
  const v = metric === 'roi' ? (s.roi ?? 0) : s.pnl;
  return v > 0 ? 'pos' : v < 0 ? 'neg' : '';
}

function renderCalendar(agg) {
  const metric = calendarState.metric;
  const [year, mon] = calendarState.month.split('-').map(Number);
  setText('cal-month-label', new Date(year, mon - 1, 1).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' }));

  const daysInMonth = new Date(year, mon, 0).getDate();
  const firstDay = (new Date(year, mon - 1, 1).getDay() + 6) % 7;
  const monthStartKey = `${year}-${String(mon).padStart(2, '0')}-01`;
  const todayKey = today();

  // bankroll na koniec poprzedniego miesiąca
  const pnlBefore = Object.entries(agg.byDay).filter(([k]) => k < monthStartKey).reduce((a, [, v]) => a + v, 0);
  const flowBefore = Object.entries(agg.flowByDay).filter(([k]) => k < monthStartKey).reduce((a, [, v]) => a + v, 0);
  const openingBank = settings.bankrollStart + flowBefore + pnlBefore;

  const lmInfo = el('cal-lm-info');
  const prevName = new Date(year, mon - 2, 1).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
  lmInfo.style.display = '';
  lmInfo.innerHTML = `<span class="lm-label">Bankroll na koniec ${prevName}:</span><span class="lm-value">${fmtPLN(openingBank)}</span><span class="lm-target">cel +${settings.monthlyGoalPct}%: ${fmtPLN(openingBank * (1 + settings.monthlyGoalPct / 100))}</span>`;

  const stats = {};
  let running = openingBank;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isFuture = key > todayKey;
    if (!isFuture) running += (agg.flowByDay[key] || 0) + (agg.byDay[key] || 0);
    stats[key] = isFuture
      ? { isFuture: true, pnl: 0, turnover: 0, bets: 0, wins: 0, losses: 0, roi: null, wr: null, bank: null }
      : { ...dayStat(agg, key, running), isFuture: false };
  }

  // kubełki tygodniowe
  const buckets = [[1, 7], [8, 14], [15, 21], [22, 28], [29, daysInMonth], ['all', 'all']];
  el('cal-buckets').innerHTML = buckets.map(r => {
    const list = Object.entries(stats)
      .filter(([k, s]) => {
        if (s.isFuture) return false;
        if (r[0] === 'all') return true;
        const d = Number(k.slice(8, 10));
        return d >= r[0] && d <= r[1];
      }).map(([, s]) => s);
    const pnl = list.reduce((a, s) => a + s.pnl, 0);
    const turnover = list.reduce((a, s) => a + s.turnover, 0);
    const bets = list.reduce((a, s) => a + s.bets, 0);
    const wins = list.reduce((a, s) => a + s.wins, 0);
    const losses = list.reduce((a, s) => a + s.losses, 0);
    const agg2 = {
      pnl, turnover, bets, wins, losses,
      roi: turnover > 0 ? (pnl / turnover) * 100 : null,
      wr: (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : null,
      bank: list.length ? list[list.length - 1].bank : null
    };
    const label = r[0] === 'all' ? 'Cały miesiąc' : (r[0] === 29 ? `29–${daysInMonth} dzień` : `${r[0]}–${r[1]} dzień`);
    return `<div class="cal-bucket"><div class="k">${label}</div><div class="v ${calMetricClass(metric, agg2)}">${calMetricValue(metric, agg2)}</div></div>`;
  }).join('');

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push('<div class="cal-cell empty"></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const s = stats[key];
    if (s.isFuture) { cells.push(`<div class="cal-cell empty"><div class="d">${d}</div></div>`); continue; }
    cells.push(`<div class="cal-cell ${calMetricClass(metric, s)}">
      <div class="d">${d}</div>
      <div class="m">${calMetricValue(metric, s)}</div>
      <div class="s">${s.bets ? `${s.bets} kup. · ${s.wins}W/${s.losses}P` : '—'}</div>
    </div>`);
  }
  el('cal-grid').innerHTML = cells.join('');

  renderPeriodTables(agg);
}

function renderPeriodTables(agg) {
  const settled = agg.settled;

  // Tygodnie
  const byWeek = groupBy(settled, b => isoWeekKey(b.settledDate));
  const wKeys = [...byWeek.keys()].sort().reverse().slice(0, 16);
  const wMax = Math.max(...wKeys.map(k => Math.abs(bucketStats(byWeek.get(k)).profit)), 1);
  el('week-table-wrap').innerHTML = wKeys.length ? `<table class="bt-mini-tbl">
    <thead><tr><th>Tydzień</th><th class="num">Kup.</th><th class="num">Obrót</th><th class="num">P&L</th><th class="num">Yield</th><th>Trend</th></tr></thead>
    <tbody>${wKeys.map(k => {
    const bets = byWeek.get(k);
    const s = bucketStats(bets);
    const range = isoWeekRange(bets[0].settledDate);
    const w = Math.abs(s.profit) / wMax * 50;
    const isCur = k === isoWeekKey(today());
    return `<tr class="${isCur ? 'current' : ''}">
        <td><strong>T${k.split('-W')[1]}</strong> <span class="muted" style="font-size:11px">${range}</span></td>
        <td class="num">${s.count}</td>
        <td class="num">${fmtPLN0(s.turnover)}</td>
        <td class="num ${posClass(s.profit)}">${fmtPLN(s.profit, true)}</td>
        <td class="num ${posClass(s.yieldPct || 0)}">${s.yieldPct === null ? '—' : fmtPct(s.yieldPct, true, 1)}</td>
        <td><span class="bt-spark"><i class="${s.profit < 0 ? 'neg' : ''}" style="width:${w}%"></i></span></td>
      </tr>`;
  }).join('')}</tbody></table>`
    : `<div class="tc-empty"><span class="material-symbols-outlined">date_range</span><h4>Brak danych tygodniowych</h4><p>Rozlicz pierwsze kupony, żeby zobaczyć ujęcie tygodniowe.</p></div>`;

  // Miesiące
  const byMonth = groupBy(settled, b => b.settledDate.slice(0, 7));
  const mKeys = [...byMonth.keys()].sort().reverse().slice(0, 12);
  const mMax = Math.max(...mKeys.map(k => Math.abs(bucketStats(byMonth.get(k)).profit)), 1);
  el('month-table-wrap').innerHTML = mKeys.length ? `<table class="bt-mini-tbl">
    <thead><tr><th>Miesiąc</th><th class="num">Kup.</th><th class="num">Obrót</th><th class="num">P&L</th><th class="num">Yield</th><th class="num">Skut.</th><th>Trend</th></tr></thead>
    <tbody>${mKeys.map(k => {
    const s = bucketStats(byMonth.get(k));
    const w = Math.abs(s.profit) / mMax * 50;
    const isCur = k === today().slice(0, 7);
    return `<tr class="${isCur ? 'current' : ''}">
        <td><strong>${monthLabel(k)}</strong></td>
        <td class="num">${s.count}</td>
        <td class="num">${fmtPLN0(s.turnover)}</td>
        <td class="num ${posClass(s.profit)}">${fmtPLN(s.profit, true)}</td>
        <td class="num ${posClass(s.yieldPct || 0)}">${s.yieldPct === null ? '—' : fmtPct(s.yieldPct, true, 1)}</td>
        <td class="num">${s.winRate === null ? '—' : s.winRate.toFixed(0) + '%'}</td>
        <td><span class="bt-spark"><i class="${s.profit < 0 ? 'neg' : ''}" style="width:${w}%"></i></span></td>
      </tr>`;
  }).join('')}</tbody></table>`
    : `<div class="tc-empty"><span class="material-symbols-outlined">calendar_month</span><h4>Brak danych miesięcznych</h4><p>Rozlicz pierwsze kupony, żeby zobaczyć ujęcie miesięczne.</p></div>`;
}

/* ============================================================
   Księgowość
   ============================================================ */
const LEDGER_LABEL = { deposit: 'Wpłata', withdraw: 'Wypłata', bonus: 'Bonus', adjust: 'Korekta' };

function renderLedger(agg) {
  const deposits = agg.ledger.filter(e => e.type === 'deposit').reduce((s, e) => s + e.amount, 0);
  const withdrawals = agg.ledger.filter(e => e.type === 'withdraw').reduce((s, e) => s + e.amount, 0);
  const bonuses = agg.ledger.filter(e => e.type === 'bonus').reduce((s, e) => s + e.amount, 0);
  const adjust = agg.ledger.filter(e => e.type === 'adjust').reduce((s, e) => s + e.amount, 0);

  el('acct-grid').innerHTML = [
    ['Bankroll startowy', fmtPLN(settings.bankrollStart), 'kapitał wyjściowy', ''],
    ['Wpłaty', fmtPLN(deposits), `${agg.ledger.filter(e => e.type === 'deposit').length} operacji`, ''],
    ['Wypłaty', fmtPLN(withdrawals), `${agg.ledger.filter(e => e.type === 'withdraw').length} operacji`, ''],
    ['Bonusy / korekty', fmtPLN(bonuses + adjust), 'freebety, cashbacki', ''],
    ['Wynik zakładów', fmtPLN(agg.realizedPnl, true), `${agg.settled.length} rozliczonych`, posClass(agg.realizedPnl)],
    ['Bankroll bieżący', fmtPLN(agg.bankroll), `dostępne ${fmtPLN(agg.available)}`, ''],
    ['Zablokowane', fmtPLN(agg.openExposure), `${nKupon(agg.pending.length)} w grze`, ''],
    ['Podatek zapłacony', fmtPLN(agg.taxTotal), 'wg ustawień modułu', '']
  ].map(([k, v, n, cls]) => `<div class="bt-acct-cell"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="n">${n}</div></div>`).join('');

  const roiOnCapital = agg.cashBase > 0 ? (agg.realizedPnl / agg.cashBase) * 100 : null;
  el('acct-recon').innerHTML = `<div class="bt-alert">
    <span class="material-symbols-outlined">calculate</span>
    <span>
      <strong>Bilans:</strong> ${fmtPLN(settings.bankrollStart)} (start)
      ${agg.ledgerNet >= 0 ? '+' : '−'} ${fmtPLN(Math.abs(agg.ledgerNet))} (przepływy)
      ${agg.realizedPnl >= 0 ? '+' : '−'} ${fmtPLN(Math.abs(agg.realizedPnl))} (wynik)
      = <strong>${fmtPLN(agg.bankroll)}</strong>.
      Zwrot na zaangażowanym kapitale: <strong>${roiOnCapital === null ? '—' : fmtPct(roiOnCapital)}</strong>,
      yield na obrocie: <strong>${agg.yieldPct === null ? '—' : fmtPct(agg.yieldPct)}</strong>.
    </span>
  </div>`;

  // tabela operacji
  const wrap = el('ledger-wrap');
  if (!agg.ledger.length) {
    wrap.innerHTML = `<div class="tc-empty"><span class="material-symbols-outlined">account_balance_wallet</span><h4>Brak operacji kasowych</h4><p>Zaksięguj wpłaty i wypłaty, aby bankroll zgadzał się z rzeczywistością.</p></div>`;
  } else {
    const sorted = [...agg.ledger].reverse();
    wrap.innerHTML = `<table class="tc-tbl">
      <thead><tr><th>Data</th><th>Typ</th><th>Opis</th><th class="num">Kwota</th><th style="width:50px"></th></tr></thead>
      <tbody>${sorted.map(e => {
      const signed = e.type === 'withdraw' ? -e.amount : e.amount;
      return `<tr>
          <td class="nowrap">${esc(e.date)}</td>
          <td><span class="bt-pill ${e.type === 'bonus' ? 'free' : e.type === 'withdraw' ? 'warn' : 'accent'}">${LEDGER_LABEL[e.type]}</span></td>
          <td>${esc(e.note || '—')}</td>
          <td class="num ${posClass(signed)}">${fmtPLN(signed, true)}</td>
          <td><button class="row-btn danger" title="Usuń" onclick="deleteLedger('${e.id}')"><span class="material-symbols-outlined">delete</span></button></td>
        </tr>`;
    }).join('')}</tbody></table>`;
  }

  // salda wg bukmachera
  const books = new Set([...agg.all.map(b => b.bookmaker).filter(Boolean)]);
  const bookWrap = el('book-balance-wrap');
  if (!books.size) {
    bookWrap.innerHTML = `<div class="tc-empty"><span class="material-symbols-outlined">storefront</span><h4>Brak bukmacherów</h4><p>Uzupełnij pole „Bukmacher” w kuponach.</p></div>`;
  } else {
    const rows = [...books].map(bk => {
      const bets = agg.settled.filter(b => b.bookmaker === bk);
      const open = agg.pending.filter(b => b.bookmaker === bk);
      const s = bucketStats(bets);
      return { bk, ...s, open: open.length, exposure: open.reduce((a, b) => a + b.risked, 0) };
    }).sort((a, b) => b.profit - a.profit);
    bookWrap.innerHTML = `<table class="tc-tbl">
      <thead><tr><th>Bukmacher</th><th class="num">Kupony</th><th class="num">Obrót</th><th class="num">P&L</th><th class="num">Yield</th><th class="num">Otwarte</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td><span class="ticker">${esc(r.bk)}</span></td>
        <td class="num">${r.count}</td>
        <td class="num">${fmtPLN0(r.turnover)}</td>
        <td class="num ${posClass(r.profit)}">${fmtPLN(r.profit, true)}</td>
        <td class="num ${posClass(r.yieldPct || 0)}">${r.yieldPct === null ? '—' : fmtPct(r.yieldPct, true, 1)}</td>
        <td class="num">${r.open ? `${r.open} · ${fmtPLN0(r.exposure)}` : '—'}</td>
      </tr>`).join('')}</tbody></table>`;
  }

  // podatki
  const stakeTaxTotal = agg.settled.reduce((s, b) => s + b.stakeTaxPaid, 0);
  const winTaxTotal = agg.settled.reduce((s, b) => s + b.winTaxPaid, 0);
  const grossWins = agg.settled.filter(b => b.profit > 0).reduce((s, b) => s + b.returned, 0);
  const taxable = agg.settled.filter(b => b.winTaxPaid > 0).length;
  el('tax-wrap').innerHTML = `<table class="tc-tbl">
    <thead><tr><th>Pozycja</th><th class="num">Wartość</th><th>Uwagi</th></tr></thead>
    <tbody>
      <tr><td>Model podatkowy</td><td class="num">${{ stake: 'Od stawki', win: 'Od wygranej', both: 'Od stawki i wygranej', none: 'Bez podatku' }[settings.taxMode]}</td><td class="muted">ustawienia modułu</td></tr>
      <tr><td>Obrót (podstawa)</td><td class="num">${fmtPLN(agg.turnover)}</td><td class="muted">suma stawek rozliczonych</td></tr>
      <tr><td>Podatek od stawki (${settings.stakeTaxPct}%)</td><td class="num">${fmtPLN(stakeTaxTotal)}</td><td class="muted">pobierany przy zawarciu zakładu</td></tr>
      <tr><td>Wypłaty brutto</td><td class="num">${fmtPLN(grossWins)}</td><td class="muted">kupony na plusie</td></tr>
      <tr><td>Podatek od wygranych (${settings.winTaxPct}%)</td><td class="num">${fmtPLN(winTaxTotal)}</td><td class="muted">${nKupon(taxable)} powyżej ${fmtPLN0(settings.winTaxFreeLimit)}</td></tr>
      <tr><td><strong>Podatek łącznie</strong></td><td class="num"><strong>${fmtPLN(stakeTaxTotal + winTaxTotal)}</strong></td><td class="muted">${agg.turnover > 0 ? ((stakeTaxTotal + winTaxTotal) / agg.turnover * 100).toFixed(1) + '% obrotu' : '—'}</td></tr>
      <tr><td>Wynik przed podatkiem</td><td class="num ${posClass(agg.realizedPnl + stakeTaxTotal + winTaxTotal)}">${fmtPLN(agg.realizedPnl + stakeTaxTotal + winTaxTotal, true)}</td><td class="muted">gdyby podatku nie było</td></tr>
    </tbody>
  </table>`;

  // księga miesięczna
  const byMonth = groupBy(agg.settled, b => b.settledDate.slice(0, 7));
  const mKeys = [...byMonth.keys()].sort().reverse();
  const monthWrap = el('acct-month-wrap');
  if (!mKeys.length) {
    monthWrap.innerHTML = `<div class="tc-empty"><span class="material-symbols-outlined">receipt</span><h4>Brak księgi</h4><p>Pojawi się po pierwszych rozliczeniach.</p></div>`;
  } else {
    let cum = 0;
    const rowsAsc = [...mKeys].reverse().map(k => {
      const bets = byMonth.get(k);
      const s = bucketStats(bets);
      const tax = bets.reduce((a, b) => a + b.taxPaid, 0);
      const flows = agg.ledger.filter(e => e.date.startsWith(k))
        .reduce((a, e) => a + (e.type === 'withdraw' ? -e.amount : e.amount), 0);
      cum += s.profit;
      return { k, s, tax, flows, cum };
    });
    monthWrap.innerHTML = `<table class="tc-tbl">
      <thead><tr><th>Miesiąc</th><th class="num">Kupony</th><th class="num">Obrót</th><th class="num">Podatek</th><th class="num">Przepływy</th><th class="num">Wynik</th><th class="num">Yield</th><th class="num">Narastająco</th></tr></thead>
      <tbody>${rowsAsc.reverse().map(r => `<tr>
        <td><span class="ticker">${monthLabel(r.k)}</span></td>
        <td class="num">${r.s.count}</td>
        <td class="num">${fmtPLN0(r.s.turnover)}</td>
        <td class="num">${fmtPLN(r.tax)}</td>
        <td class="num ${posClass(r.flows)}">${r.flows ? fmtPLN(r.flows, true) : '—'}</td>
        <td class="num ${posClass(r.s.profit)}">${fmtPLN(r.s.profit, true)}</td>
        <td class="num ${posClass(r.s.yieldPct || 0)}">${r.s.yieldPct === null ? '—' : fmtPct(r.s.yieldPct, true, 1)}</td>
        <td class="num ${posClass(r.cum)}">${fmtPLN(r.cum, true)}</td>
      </tr>`).join('')}</tbody></table>`;
  }
}

function deleteLedger(id) {
  if (!confirm('Usunąć tę operację kasową?')) return;
  state.ledger = state.ledger.filter(e => e.id !== id);
  saveState();
  renderAll();
  toast('Operacja usunięta');
}

/* ============================================================
   Kalkulator
   ============================================================ */
function slipRows(rows) {
  return rows.map(r => `<div class="bt-slip-row ${r[3] || ''}"><span class="k">${r[0]}</span><span class="v ${r[2] || ''}">${r[1]}</span></div>`).join('');
}

function renderValueCalc() {
  const odds = numberOr(el('c-odds').value, 0);
  const prob = clamp(numberOr(el('c-prob').value, 0), 0, 100) / 100;
  const kf = clamp(numberOr(el('c-kelly').value, 0.25), 0, 1);
  const bank = Math.max(numberOr(el('c-bank').value, 0), 0);
  const taxRate = Math.max(numberOr(el('c-tax').value, 0), 0) / 100;
  const maxPct = Math.max(numberOr(el('c-max').value, 5), 0);

  if (odds <= 1 || prob <= 0) {
    el('calc-value-out').innerHTML = slipRows([['Uzupełnij kurs i prawdopodobieństwo', '—']]);
    el('calc-verdict').className = 'bt-verdict';
    el('calc-verdict').textContent = 'Uzupełnij dane, aby zobaczyć ocenę wartości.';
    return;
  }

  const netOdds = odds * (1 - taxRate);   // wypłata / stawka brutto
  const implied = (1 / odds) * 100;
  const impliedEff = (1 / netOdds) * 100;
  const ev = prob * (netOdds - 1) - (1 - prob);   // na 1 zł stawki
  const edge = (prob * netOdds - 1) * 100;
  const kelly = netOdds > 1 ? ((prob * (netOdds - 1) - (1 - prob)) / (netOdds - 1)) : 0;
  const kellyFrac = Math.max(kelly, 0) * kf;
  const rawStake = bank * kellyFrac;
  const capped = Math.min(rawStake, bank * maxPct / 100);

  el('calc-value-out').innerHTML = slipRows([
    ['Kurs nominalny', fmtOdds(odds)],
    ['Kurs po podatku od stawki', fmtOdds(netOdds), 'warn'],
    ['Prawdopodobieństwo z kursu', implied.toFixed(1) + '%'],
    ['Prawdopodobieństwo po podatku', impliedEff.toFixed(1) + '%'],
    ['Twoje prawdopodobieństwo', (prob * 100).toFixed(1) + '%'],
    ['Przewaga (edge)', fmtPct(edge), edge > 0 ? 'pos' : 'neg'],
    ['EV na 1 zł stawki', fmtPLN(ev, true), ev > 0 ? 'pos' : 'neg'],
    ['Kelly (pełny)', (Math.max(kelly, 0) * 100).toFixed(2) + '%'],
    [`Kelly ×${kf}`, (kellyFrac * 100).toFixed(2) + '%'],
    ['Sugerowana stawka', bank > 0 ? fmtPLN(capped) : 'podaj bankroll', '', 'total']
  ]);

  const v = el('calc-verdict');
  if (edge > 5) { v.className = 'bt-verdict good'; v.innerHTML = `<span>Wyraźna wartość — kurs jest zawyżony względem Twojej oceny.</span><strong>${fmtPct(edge)}</strong>`; }
  else if (edge > 0) { v.className = 'bt-verdict warn'; v.innerHTML = `<span>Minimalna przewaga. Przy takiej marży wynik zdominuje wariancja.</span><strong>${fmtPct(edge)}</strong>`; }
  else { v.className = 'bt-verdict bad'; v.innerHTML = `<span>Brak wartości — po podatku ten kurs jest poniżej Twojej oceny. Odpuść.</span><strong>${fmtPct(edge)}</strong>`; }
}

function parseOddsList(str) {
  return String(str || '').split(/[\s,;]+/).map(s => Number(s.replace(',', '.'))).filter(n => Number.isFinite(n) && n > 1);
}

function renderAkoCalc() {
  const legs = parseOddsList(el('c-legs').value);
  const stake = Math.max(numberOr(el('c-ako-stake').value, 0), 0);
  const taxRate = Math.max(numberOr(el('c-ako-tax').value, 0), 0) / 100;
  if (!legs.length) { el('calc-ako-out').innerHTML = slipRows([['Podaj kursy nóg', '—']]); return; }
  const total = legs.reduce((a, b) => a * b, 1);
  const netStake = stake * (1 - taxRate);
  const payout = netStake * total;
  const impliedTotal = (1 / total) * 100;
  el('calc-ako-out').innerHTML = slipRows([
    ['Liczba zdarzeń', String(legs.length)],
    ['Kurs łączny', fmtOdds(total)],
    ['Szansa z kursu', impliedTotal.toFixed(2) + '%'],
    ['Podatek od stawki', fmtPLN(stake - netStake), 'warn'],
    ['Stawka netto', fmtPLN(netStake)],
    ['Kurs efektywny', stake > 0 ? fmtOdds(payout / stake) : '—', 'warn'],
    ['Wypłata', fmtPLN(payout)],
    ['Zysk', fmtPLN(payout - stake, true), payout - stake > 0 ? 'pos' : 'neg', 'total']
  ]);
}

function renderCashoutCalc() {
  const stake = Math.max(numberOr(el('co-stake').value, 0), 0);
  const odds = Math.max(numberOr(el('co-odds').value, 1), 1);
  const offer = Math.max(numberOr(el('co-offer').value, 0), 0);
  const prob = clamp(numberOr(el('co-prob').value, 0), 0, 100) / 100;
  const taxRate = Math.max(numberOr(el('co-tax').value, 0), 0) / 100;

  const payout = stake * (1 - taxRate) * odds;
  const ev = prob * payout;             // wartość oczekiwana dalszej gry
  const diff = offer - ev;
  const breakEvenProb = payout > 0 ? (offer / payout) * 100 : 0;

  el('calc-co-out').innerHTML = slipRows([
    ['Wypłata przy wygranej', fmtPLN(payout)],
    ['Wartość oczekiwana gry', fmtPLN(ev)],
    ['Oferta cashout', fmtPLN(offer)],
    ['Różnica (oferta − EV)', fmtPLN(diff, true), diff > 0 ? 'pos' : 'neg'],
    ['Zysk z cashoutu', fmtPLN(offer - stake, true), offer - stake > 0 ? 'pos' : 'neg'],
    ['Próg opłacalności', breakEvenProb.toFixed(1) + '% szansy', '', 'total']
  ]);
  const v = el('calc-co-verdict');
  if (diff > 0) { v.className = 'bt-verdict good'; v.innerHTML = `<span>Bierz cashout — bukmacher płaci więcej, niż wynosi wartość oczekiwana kuponu.</span><strong>${fmtPLN(diff, true)}</strong>`; }
  else if (diff > -payout * 0.03) { v.className = 'bt-verdict warn'; v.innerHTML = `<span>Blisko wartości godziwej. Decyduj wg zarządzania ryzykiem, nie wg EV.</span><strong>${fmtPLN(diff, true)}</strong>`; }
  else { v.className = 'bt-verdict bad'; v.innerHTML = `<span>Cashout poniżej wartości — bukmacher zarabia na Twoim strachu.</span><strong>${fmtPLN(diff, true)}</strong>`; }
}

function renderMarginCalc() {
  const odds = parseOddsList(el('c-margin').value);
  const taxRate = Math.max(numberOr(el('c-margin-tax').value, 0), 0) / 100;
  if (odds.length < 2) { el('calc-margin-out').innerHTML = slipRows([['Podaj co najmniej 2 kursy', '—']]); return; }
  const sumImplied = odds.reduce((a, o) => a + 1 / o, 0);
  const margin = (sumImplied - 1) * 100;
  const fair = odds.map(o => 1 / ((1 / o) / sumImplied));   // kursy po usunięciu marży
  const totalCost = margin + taxRate * 100;                 // marża + podatek od stawki
  el('calc-margin-out').innerHTML = slipRows([
    ['Suma prawdopodobieństw', (sumImplied * 100).toFixed(2) + '%'],
    ['Marża bukmachera', fmtPct(margin, false), 'warn'],
    ['Kursy „fair” (bez marży)', fair.map(f => f.toFixed(2)).join(' / ')],
    ['Podatek od stawki', (taxRate * 100).toFixed(1) + '%', 'warn'],
    ['Łączny koszt gry', fmtPct(totalCost, false), 'neg', 'total']
  ]);
  const v = el('calc-margin-verdict');
  if (margin < 4) { v.className = 'bt-verdict good'; v.innerHTML = `<span>Niska marża — dobre warunki, warto tu szukać wartości.</span><strong>${margin.toFixed(2)}%</strong>`; }
  else if (margin < 7) { v.className = 'bt-verdict warn'; v.innerHTML = `<span>Przeciętna marża. Do pobicia, ale potrzebujesz realnej przewagi.</span><strong>${margin.toFixed(2)}%</strong>`; }
  else { v.className = 'bt-verdict bad'; v.innerHTML = `<span>Wysoka marża — na dłuższą metę bardzo trudno wyjść na plus.</span><strong>${margin.toFixed(2)}%</strong>`; }
}

function renderCalculators(agg) {
  const bankInput = el('c-bank');
  if (bankInput && !bankInput.dataset.touched) bankInput.value = Math.round(agg.bankroll);
  const taxDefault = settings.taxMode === 'stake' || settings.taxMode === 'both' ? settings.stakeTaxPct : 0;
  for (const id of ['c-tax', 'c-ako-tax', 'co-tax', 'c-margin-tax']) {
    const n = el(id);
    if (n && !n.dataset.touched) n.value = taxDefault;
  }
  const maxN = el('c-max');
  if (maxN && !maxN.dataset.touched) maxN.value = settings.maxStakePct;
  renderValueCalc(); renderAkoCalc(); renderCashoutCalc(); renderMarginCalc();
}

/* ============================================================
   Modal: kupon
   ============================================================ */
function legRowHtml(leg = { event: '', pick: '', odds: '' }, idx = 0) {
  return `<div class="bt-leg-row" data-leg>
    <div class="ff"><label>Zdarzenie</label><input class="leg-event" type="text" list="dl-events" value="${esc(leg.event)}"></div>
    <div class="ff"><label>Typ</label><input class="leg-pick" type="text" list="dl-picks" value="${esc(leg.pick)}"></div>
    <div class="ff"><label>Kurs</label><input class="leg-odds" type="number" step="any" min="1" value="${leg.odds || ''}"></div>
    <button type="button" class="row-btn danger" onclick="this.closest('[data-leg]').remove(); syncComboOdds();"><span class="material-symbols-outlined">delete</span></button>
  </div>`;
}
function addLegRow(leg) {
  el('b-legs').insertAdjacentHTML('beforeend', legRowHtml(leg || { event: '', pick: '', odds: '' }));
  bindLegInputs();
  syncComboOdds();
}
function bindLegInputs() {
  el('b-legs').querySelectorAll('.leg-odds').forEach(i => {
    if (i.dataset.bound) return;
    i.dataset.bound = '1';
    i.addEventListener('input', syncComboOdds);
  });
}
function readLegs() {
  return [...el('b-legs').querySelectorAll('[data-leg]')].map(r => ({
    event: r.querySelector('.leg-event').value.trim(),
    pick: r.querySelector('.leg-pick').value.trim(),
    odds: positiveOr(r.querySelector('.leg-odds').value, 1)
  })).filter(l => l.event || l.pick || l.odds > 1);
}
function syncComboOdds() {
  if (modalType !== 'combo') return;
  const legs = readLegs();
  const o = comboOdds(legs);
  if (o && legs.length) el('b-odds').value = o.toFixed(2);
  updateBetPreview();
}

function setModalType(t) {
  modalType = t === 'combo' ? 'combo' : 'single';
  el('b-type-toggle').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.t === modalType));
  el('b-single-box').style.display = modalType === 'single' ? '' : 'none';
  el('b-combo-box').style.display = modalType === 'combo' ? '' : 'none';
  if (modalType === 'combo' && !el('b-legs').children.length) { addLegRow(); addLegRow(); }
  updateBetPreview();
}
function setModalConf(c) {
  modalConf = clamp(Math.round(c), 1, 5);
  el('b-conf').querySelectorAll('button').forEach(b => b.classList.toggle('active', Number(b.dataset.c) === modalConf));
}

function openBetModal(id) {
  const agg = aggregate();
  el('b-warnings').innerHTML = '';
  el('b-legs').innerHTML = '';

  if (id) {
    const b = state.bets.find(x => x.id === id);
    if (!b) return;
    el('bet-modal-title').textContent = 'Edytuj kupon';
    el('b-id').value = b.id;
    el('b-date').value = b.date;
    el('b-book').value = b.bookmaker;
    el('b-sport').value = b.sport;
    el('b-event').value = b.event;
    el('b-league').value = b.league;
    el('b-market').value = b.market;
    el('b-pick').value = b.pick;
    el('b-stake').value = b.stake || '';
    el('b-odds').value = b.odds || '';
    el('b-closing').value = b.closingOdds || '';
    el('b-tags').value = b.tags.join(', ');
    el('b-note').value = b.note;
    el('b-live').checked = b.live;
    el('b-freebet').checked = b.freebet;
    el('b-taxfree').checked = b.taxFree;
    setModalConf(b.confidence);
    setModalType(b.betType);
    if (b.betType === 'combo') { el('b-legs').innerHTML = ''; (b.legs.length ? b.legs : [{}, {}]).forEach(l => addLegRow(l)); }
  } else {
    el('bet-modal-title').textContent = 'Nowy kupon';
    el('b-id').value = '';
    el('b-date').value = today();
    el('b-book').value = '';
    el('b-sport').value = '';
    el('b-event').value = '';
    el('b-league').value = '';
    el('b-market').value = '';
    el('b-pick').value = '';
    el('b-stake').value = Math.round(agg.unit * 100) / 100 || '';
    el('b-odds').value = '';
    el('b-closing').value = '';
    el('b-tags').value = '';
    el('b-note').value = '';
    el('b-live').checked = false;
    el('b-freebet').checked = false;
    el('b-taxfree').checked = false;
    setModalConf(3);
    setModalType('single');
  }
  updateBetPreview();
  el('bet-modal').classList.add('on');
}
function closeBetModal() { el('bet-modal').classList.remove('on'); }

function readBetForm() {
  return normalizeBet({
    id: el('b-id').value || undefined,
    date: el('b-date').value || today(),
    bookmaker: el('b-book').value,
    sport: el('b-sport').value,
    league: el('b-league').value,
    event: el('b-event').value,
    market: el('b-market').value,
    pick: el('b-pick').value,
    betType: modalType,
    legs: modalType === 'combo' ? readLegs() : [],
    stake: el('b-stake').value,
    odds: el('b-odds').value,
    closingOdds: el('b-closing').value,
    live: el('b-live').checked,
    freebet: el('b-freebet').checked,
    taxFree: el('b-taxfree').checked,
    confidence: modalConf,
    tags: el('b-tags').value.split(',').map(s => s.trim()).filter(Boolean),
    note: el('b-note').value,
    status: 'pending'
  });
}

function updateBetPreview() {
  const agg = aggregate();
  const draft = readBetForm();
  const m = betMath(draft);
  const unit = agg.unit;

  el('b-units').value = unit > 0 && m.stake > 0 ? `${(m.stake / unit).toFixed(2)} u (1u = ${fmtPLN(unit)})` : '—';

  // dopóki kurs nie jest wpisany, nie pokazujemy mylących wartości wyliczonych z kursu 1.00
  const hasOdds = numberOr(el('b-odds').value, 0) > 1;
  el('b-preview').innerHTML = slipRows([
    ['Stawka', m.stake > 0 ? fmtPLN(m.stake) : '—'],
    ['Podatek od stawki', m.stakeTax > 0 ? fmtPLN(m.stakeTax) : '—', m.stakeTax > 0 ? 'warn' : ''],
    ['Stawka netto', m.stake > 0 ? fmtPLN(m.netStake) : '—'],
    ['Kurs', hasOdds ? fmtOdds(m.odds) : '—'],
    ['Kurs efektywny', hasOdds && m.stake > 0 ? fmtOdds(m.payoutIfWon / m.stake) : '—', 'warn'],
    ['Szansa z kursu', hasOdds ? (100 / m.odds).toFixed(1) + '%' : '—'],
    ['Wypłata przy wygranej', hasOdds && m.stake > 0 ? fmtPLN(m.payoutIfWon) : '—'],
    ['Potencjalny zysk', hasOdds && m.stake > 0 ? fmtPLN(m.potentialProfit, true) : '—', m.potentialProfit > 0 ? 'pos' : '', 'total']
  ]);

  // ostrzeżenia dyscypliny
  const warn = [];
  const maxStake = agg.bankroll * settings.maxStakePct / 100;
  if (m.risked > maxStake && maxStake > 0) warn.push(['bad', 'warning', `Stawka ${fmtPLN(m.stake)} przekracza limit ${settings.maxStakePct}% bankrolla (${fmtPLN(maxStake)}).`]);
  else if (unit > 0 && m.stake > unit * 3) warn.push(['warn', 'warning', `Stawka to ${(m.stake / unit).toFixed(1)} unita — trzymaj płaskie stawki, jeśli nie masz mocnego uzasadnienia.`]);
  if (m.odds > settings.maxOdds) warn.push(['warn', 'casino', `Kurs ${fmtOdds(m.odds)} powyżej progu ${fmtOdds(settings.maxOdds)} — wysoka wariancja.`]);
  if (modalType === 'combo' && readLegs().length > 3) warn.push(['warn', 'link', `AKO z ${readLegs().length} zdarzeń — marża bukmachera kumuluje się na każdej nodze.`]);
  if (agg.todayBets >= settings.maxDailyBets) warn.push(['warn', 'timer', `To ${agg.todayBets + 1}. kupon dzisiaj przy limicie ${settings.maxDailyBets}.`]);
  if (m.risked > agg.available && m.risked > 0) warn.push(['bad', 'account_balance', `Stawka przekracza dostępny bankroll (${fmtPLN(agg.available)}).`]);

  el('b-warnings').innerHTML = warn.map(([k, i, t]) =>
    `<div class="bt-alert ${k}"><span class="material-symbols-outlined">${i}</span><span>${t}</span></div>`).join('');
}

function saveBetModal() {
  const bet = readBetForm();
  if (!(bet.stake > 0)) { toast('Podaj stawkę', 'err'); return; }
  if (!(bet.odds > 1)) { toast('Kurs musi być większy niż 1.00', 'err'); return; }
  if (bet.betType === 'single' && !bet.event.trim()) { toast('Podaj zdarzenie', 'err'); return; }
  if (bet.betType === 'combo' && bet.legs.length < 2) { toast('AKO wymaga co najmniej 2 nóg', 'err'); return; }

  const existingId = el('b-id').value;
  if (existingId) {
    const idx = state.bets.findIndex(b => b.id === existingId);
    if (idx >= 0) {
      const prev = state.bets[idx];
      state.bets[idx] = { ...bet, id: prev.id, status: prev.status, settledAt: prev.settledAt, payoutOverride: prev.payoutOverride };
    }
  } else {
    state.bets.push(bet);
  }
  saveState();
  closeBetModal();
  renderAll();
  toast(existingId ? 'Kupon zaktualizowany' : 'Kupon dodany', 'ok');
}

function deleteBet(id) {
  if (!confirm('Usunąć ten kupon? Operacji nie da się cofnąć.')) return;
  state.bets = state.bets.filter(b => b.id !== id);
  expandedBets.delete(id);
  saveState();
  renderAll();
  toast('Kupon usunięty');
}

/* ============================================================
   Modal: rozliczenie
   ============================================================ */
function computeSettlePayout(bet, result) {
  const probe = betMath({ ...bet, status: result, payoutOverride: null });
  return probe.returned;
}

function openSettleModal(id) {
  const bet = state.bets.find(b => b.id === id);
  if (!bet) return;
  const m = betMath(bet);
  el('st-id').value = id;
  el('st-date').value = bet.settledAt || today();
  settleResult = bet.status === 'pending' ? 'won' : bet.status;
  settlePayoutTouched = false;

  el('st-info').innerHTML = slipRows([
    ['Kupon', bet.event || `AKO ${bet.legs.length}`],
    ['Typ', bet.betType === 'combo' ? `${bet.legs.length} zdarzeń` : ([bet.market, bet.pick].filter(Boolean).join(' → ') || '—')],
    ['Bukmacher / data', `${bet.bookmaker || '—'} · ${bet.date}`],
    ['Stawka × kurs', `${fmtPLN(m.stake)} × ${fmtOdds(m.odds)}`],
    ['Wypłata przy wygranej', fmtPLN(m.payoutIfWon), '', 'total']
  ]);

  setSettleResult(settleResult, true);
  if (bet.payoutOverride !== null && Number.isFinite(bet.payoutOverride)) {
    el('st-payout').value = bet.payoutOverride;
    updateSettlePreview();
  }
  el('settle-modal').classList.add('on');
}
function closeSettleModal() { el('settle-modal').classList.remove('on'); }

function setSettleResult(r, force) {
  settleResult = r;
  el('st-result').querySelectorAll('.bt-result-btn').forEach(b => b.classList.toggle('active', b.dataset.r === r));
  const bet = state.bets.find(b => b.id === el('st-id').value);
  if (!bet) return;
  if (force || !settlePayoutTouched) {
    // dla cashoutu nie ma wzoru — proponujemy 60% pełnej wypłaty jako punkt startowy
    const auto = r === 'cashout'
      ? (bet.status === 'cashout' && bet.payoutOverride !== null ? bet.payoutOverride : computeSettlePayout(bet, 'won') * 0.6)
      : computeSettlePayout(bet, r);
    el('st-payout').value = Math.round(auto * 100) / 100;
  }
  updateSettlePreview();
}

function updateSettlePreview() {
  const bet = state.bets.find(b => b.id === el('st-id').value);
  if (!bet) return;
  const payout = Math.max(numberOr(el('st-payout').value, 0), 0);
  const m = betMath({ ...bet, status: settleResult, payoutOverride: payout, settledAt: el('st-date').value || today() });
  const auto = computeSettlePayout(bet, settleResult);
  el('st-preview').innerHTML = slipRows([
    ['Wynik', STATUS_LABEL[settleResult]],
    ['Wyliczona wypłata', fmtPLN(auto)],
    ['Wypłata zapisana', fmtPLN(payout), Math.abs(payout - auto) > 0.01 ? 'warn' : ''],
    ['Podatek od wygranej', m.winTaxPaid > 0 ? fmtPLN(m.winTaxPaid) : '—', m.winTaxPaid > 0 ? 'warn' : ''],
    ['Kurs efektywny', m.stake > 0 ? fmtOdds(payout / m.stake) : '—'],
    ['Wynik kuponu', fmtPLN(m.profit, true), m.profit > 0 ? 'pos' : m.profit < 0 ? 'neg' : '', 'total']
  ]);
}

function saveSettle() {
  const id = el('st-id').value;
  const idx = state.bets.findIndex(b => b.id === id);
  if (idx < 0) return;
  const payout = Math.max(numberOr(el('st-payout').value, 0), 0);
  const auto = computeSettlePayout(state.bets[idx], settleResult);
  state.bets[idx] = {
    ...state.bets[idx],
    status: settleResult,
    settledAt: el('st-date').value || today(),
    payoutOverride: (settleResult === 'cashout' || Math.abs(payout - auto) > 0.01) ? payout : null
  };
  saveState();
  closeSettleModal();
  renderAll();
  toast('Kupon rozliczony', 'ok');
}

function quickSettle(id, result) {
  const idx = state.bets.findIndex(b => b.id === id);
  if (idx < 0) return;
  state.bets[idx] = { ...state.bets[idx], status: result, settledAt: today(), payoutOverride: null };
  saveState();
  renderAll();
  toast(`Rozliczono: ${STATUS_LABEL[result]}`, 'ok');
}

/* ============================================================
   Ustawienia / import / eksport
   ============================================================ */
function openSettings() {
  el('s-bank').value = settings.bankrollStart;
  el('s-unit').value = settings.unitPct;
  el('s-goal').value = settings.monthlyGoalPct;
  el('s-maxstake').value = settings.maxStakePct;
  el('s-maxexp').value = settings.maxExposurePct;
  el('s-maxloss').value = settings.maxDailyLossPct;
  el('s-maxbets').value = settings.maxDailyBets;
  el('s-maxodds').value = settings.maxOdds;
  el('s-taxmode').value = settings.taxMode;
  el('s-staketax').value = settings.stakeTaxPct;
  el('s-wintax').value = settings.winTaxPct;
  el('s-winfree').value = settings.winTaxFreeLimit;
  el('settings-modal').classList.add('on');
}
function closeSettings() { el('settings-modal').classList.remove('on'); }

function saveSettings() {
  settings = {
    bankrollStart: Math.max(numberOr(el('s-bank').value, DEFAULT_SETTINGS.bankrollStart), 0),
    unitPct: positiveOr(el('s-unit').value, DEFAULT_SETTINGS.unitPct),
    maxStakePct: positiveOr(el('s-maxstake').value, DEFAULT_SETTINGS.maxStakePct),
    maxExposurePct: positiveOr(el('s-maxexp').value, DEFAULT_SETTINGS.maxExposurePct),
    maxDailyLossPct: positiveOr(el('s-maxloss').value, DEFAULT_SETTINGS.maxDailyLossPct),
    maxDailyBets: Math.max(Math.round(numberOr(el('s-maxbets').value, DEFAULT_SETTINGS.maxDailyBets)), 1),
    maxOdds: positiveOr(el('s-maxodds').value, DEFAULT_SETTINGS.maxOdds),
    monthlyGoalPct: numberOr(el('s-goal').value, DEFAULT_SETTINGS.monthlyGoalPct),
    taxMode: el('s-taxmode').value,
    stakeTaxPct: Math.max(numberOr(el('s-staketax').value, DEFAULT_SETTINGS.stakeTaxPct), 0),
    winTaxPct: Math.max(numberOr(el('s-wintax').value, DEFAULT_SETTINGS.winTaxPct), 0),
    winTaxFreeLimit: Math.max(numberOr(el('s-winfree').value, DEFAULT_SETTINGS.winTaxFreeLimit), 0)
  };
  saveSettingsStorage();
  closeSettings();
  // odśwież domyślne wartości w kalkulatorach
  for (const id of ['c-tax', 'c-ako-tax', 'co-tax', 'c-margin-tax', 'c-max', 'c-bank']) {
    const n = el(id); if (n) delete n.dataset.touched;
  }
  renderAll();
  toast('Ustawienia zapisane', 'ok');
}

function clearAllBets() {
  if (!confirm('Usunąć WSZYSTKIE kupony i operacje kasowe? Zrób najpierw backup JSON.')) return;
  state = { bets: [], ledger: [] };
  expandedBets.clear(); expandedGroups.clear();
  saveState();
  closeSettings();
  renderAll();
  toast('Dane wyczyszczone');
}

function exportJSON() {
  const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), settings, state }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lifeos-zaklady-${today()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Backup pobrany', 'ok');
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !data.state || !Array.isArray(data.state.bets)) throw new Error('bad');
      if (!confirm(`Zaimportować ${data.state.bets.length} kuponów? Obecne dane zostaną nadpisane.`)) return;
      state = { bets: data.state.bets.map(normalizeBet), ledger: (data.state.ledger || []).map(normalizeLedger) };
      if (data.settings) settings = { ...DEFAULT_SETTINGS, ...data.settings };
      saveState(); saveSettingsStorage();
      closeSettings();
      renderAll();
      toast('Dane zaimportowane', 'ok');
    } catch {
      toast('Nieprawidłowy plik JSON', 'err');
    }
  };
  reader.readAsText(file);
}

function exportCSV() {
  const rows = [[
    'Data', 'Rozliczono', 'Bukmacher', 'Dyscyplina', 'Rozgrywki', 'Zdarzenie', 'Rynek', 'Typ',
    'Rodzaj', 'Nogi', 'Stawka', 'Kurs', 'Kurs zamkniecia', 'Status', 'Zwrot', 'Zysk',
    'Podatek', 'Pewnosc', 'Live', 'Freebet', 'Tagi', 'Notatka'
  ]];
  for (const b of aggregate().all) {
    rows.push([
      b.date, b.settledDate || '', b.bookmaker, b.sport, b.league, b.event, b.market, b.pick,
      b.betType === 'combo' ? 'AKO' : 'Solo', b.betType === 'combo' ? b.legs.length : 1,
      b.stake.toFixed(2), b.odds.toFixed(2), b.closingOdds ? b.closingOdds.toFixed(2) : '',
      STATUS_LABEL[b.status], b.settled ? b.returned.toFixed(2) : '', b.settled ? b.profit.toFixed(2) : '',
      b.settled ? b.taxPaid.toFixed(2) : '', b.confidence, b.live ? 'tak' : 'nie', b.freebet ? 'tak' : 'nie',
      b.tags.join(' '), b.note
    ]);
  }
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lifeos-zaklady-${today()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('CSV pobrany', 'ok');
}

/* ============================================================
   UI: zakładki, toasty, datalisty
   ============================================================ */
function switchTab(name) {
  document.querySelectorAll('.trade-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  // wykresy tworzone w ukrytej zakładce mają zerowy rozmiar — przeliczamy po pokazaniu
  requestAnimationFrame(() => Object.values(charts).forEach(c => { try { c.resize(); } catch { } }));
}

function toast(msg, kind = '') {
  const box = el('toasts');
  const t = document.createElement('div');
  t.className = 'tc-toast ' + kind;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function fillDatalist(id, values) {
  const n = el(id);
  if (!n) return;
  n.innerHTML = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl')).map(v => `<option value="${esc(v)}">`).join('');
}

function refreshDatalists(agg) {
  const bets = agg.all;
  fillDatalist('dl-books', [...SUGGEST.books, ...bets.map(b => b.bookmaker)]);
  fillDatalist('dl-sports', [...SUGGEST.sports, ...bets.map(b => b.sport)]);
  fillDatalist('dl-leagues', [...SUGGEST.leagues, ...bets.map(b => b.league)]);
  fillDatalist('dl-markets', [...SUGGEST.markets, ...bets.map(b => b.market)]);
  fillDatalist('dl-events', bets.flatMap(b => [b.event, ...b.legs.map(l => l.event)]));
  fillDatalist('dl-picks', bets.flatMap(b => [b.pick, ...b.legs.map(l => l.pick)]));
  fillDatalist('dl-tags', [...SUGGEST.tags, ...bets.flatMap(b => b.tags)]);

  // selecty filtrów
  const books = [...new Set(bets.map(b => b.bookmaker).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl'));
  const sports = [...new Set(bets.map(b => b.sport).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl'));
  const fb = el('f-book'), fs = el('f-sport');
  fb.innerHTML = `<option value="">Bukmacher: wszyscy</option>` + books.map(b => `<option value="${esc(b)}"${betFilters.book === b ? ' selected' : ''}>${esc(b)}</option>`).join('');
  fs.innerHTML = `<option value="">Dyscyplina: wszystkie</option>` + sports.map(s => `<option value="${esc(s)}"${betFilters.sport === s ? ' selected' : ''}>${esc(s)}</option>`).join('');
}

/* ============================================================
   Render główny
   ============================================================ */
function renderAll() {
  const agg = aggregate();
  refreshDatalists(agg);
  renderHeader(agg);
  renderKpis(agg);
  renderDiscipline(agg);
  renderBankrollChart(agg);
  renderOpenBets(agg);
  renderRecent(agg);
  renderRankList('sport-perf-wrap', groupBy(agg.settled, b => b.sport || 'Bez dyscypliny'), 'Uzupełnij dyscyplinę w kuponach, aby zobaczyć ranking.');
  renderGoal(agg);
  renderBetsTab(agg);
  renderAnalytics(agg);
  renderCalendar(agg);
  renderLedger(agg);
  renderCalculators(agg);
}

/* ============================================================
   Init
   ============================================================ */
function init() {
  loadState();

  // nawigacja
  document.querySelectorAll('.trade-tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  document.querySelectorAll('.sidebar__link[data-page]').forEach(link => {
    if (link.dataset.page === 'betting') link.classList.add('sidebar__link--active');
  });

  el('new-bet-btn').addEventListener('click', () => openBetModal());
  el('settings-btn').addEventListener('click', openSettings);
  el('export-btn').addEventListener('click', exportCSV);
  el('import-file').addEventListener('change', e => { if (e.target.files[0]) importJSON(e.target.files[0]); e.target.value = ''; });

  // zakres wykresu
  el('eq-range').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    eqRange = b.dataset.range;
    el('eq-range').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    renderBankrollChart(aggregate());
  }));

  // filtry kuponów
  el('f-status').querySelectorAll('.filter-chip').forEach(c => c.addEventListener('click', () => {
    betFilters.status = c.dataset.s;
    el('f-status').querySelectorAll('.filter-chip').forEach(x => x.classList.toggle('active', x === c));
    renderBetsTab(aggregate());
  }));
  el('f-group').querySelectorAll('.filter-chip').forEach(c => c.addEventListener('click', () => {
    betFilters.grouping = c.dataset.g;
    el('f-group').querySelectorAll('.filter-chip').forEach(x => x.classList.toggle('active', x === c));
    renderBetsTab(aggregate());
  }));
  el('f-q').addEventListener('input', e => { betFilters.q = e.target.value; renderBetsTab(aggregate()); });
  el('f-book').addEventListener('change', e => { betFilters.book = e.target.value; renderBetsTab(aggregate()); });
  el('f-sport').addEventListener('change', e => { betFilters.sport = e.target.value; renderBetsTab(aggregate()); });
  el('f-period').addEventListener('change', e => { betFilters.period = e.target.value; renderBetsTab(aggregate()); });

  // szybkie dodanie
  el('quick-form').addEventListener('submit', e => {
    e.preventDefault();
    const bet = normalizeBet({
      date: today(),
      event: el('q-event').value,
      pick: el('q-pick').value,
      stake: el('q-stake').value,
      odds: el('q-odds').value,
      bookmaker: el('q-book').value,
      status: 'pending'
    });
    if (!(bet.stake > 0) || !(bet.odds > 1)) { toast('Podaj poprawną stawkę i kurs', 'err'); return; }
    state.bets.push(bet);
    saveState();
    el('quick-form').reset();
    renderAll();
    toast('Kupon dodany', 'ok');
  });

  // kalendarz
  el('cal-prev').addEventListener('click', () => shiftCalendarMonth(-1));
  el('cal-next').addEventListener('click', () => shiftCalendarMonth(1));
  el('cal-metric-toggle').querySelectorAll('.filter-chip').forEach(c => c.addEventListener('click', () => {
    calendarState.metric = c.dataset.m;
    el('cal-metric-toggle').querySelectorAll('.filter-chip').forEach(x => x.classList.toggle('active', x === c));
    renderCalendar(aggregate());
  }));

  // księgowość
  el('l-date').value = today();
  el('ledger-form').addEventListener('submit', e => {
    e.preventDefault();
    const amount = numberOr(el('l-amount').value, 0);
    if (!(Math.abs(amount) > 0)) { toast('Podaj kwotę', 'err'); return; }
    state.ledger.push(normalizeLedger({
      date: el('l-date').value || today(),
      type: el('l-type').value,
      amount: el('l-type').value === 'adjust' ? amount : Math.abs(amount),
      note: el('l-note').value
    }));
    saveState();
    el('l-amount').value = '';
    el('l-note').value = '';
    renderAll();
    toast('Operacja zaksięgowana', 'ok');
  });

  // modal kuponu
  el('b-type-toggle').querySelectorAll('button').forEach(b => b.addEventListener('click', () => setModalType(b.dataset.t)));
  el('b-conf').querySelectorAll('button').forEach(b => b.addEventListener('click', () => setModalConf(Number(b.dataset.c))));
  ['b-stake', 'b-odds', 'b-closing', 'b-date'].forEach(id => el(id).addEventListener('input', updateBetPreview));
  ['b-freebet', 'b-taxfree', 'b-live'].forEach(id => el(id).addEventListener('change', updateBetPreview));

  // modal rozliczenia
  el('st-result').querySelectorAll('.bt-result-btn').forEach(b => b.addEventListener('click', () => { settlePayoutTouched = false; setSettleResult(b.dataset.r, true); }));
  el('st-payout').addEventListener('input', () => { settlePayoutTouched = true; updateSettlePreview(); });
  el('st-date').addEventListener('change', updateSettlePreview);

  // kalkulatory
  ['c-odds', 'c-prob', 'c-kelly', 'c-bank', 'c-tax', 'c-max'].forEach(id => el(id).addEventListener('input', e => { e.target.dataset.touched = '1'; renderValueCalc(); }));
  ['c-legs', 'c-ako-stake', 'c-ako-tax'].forEach(id => el(id).addEventListener('input', e => { e.target.dataset.touched = '1'; renderAkoCalc(); }));
  ['co-stake', 'co-odds', 'co-offer', 'co-prob', 'co-tax'].forEach(id => el(id).addEventListener('input', e => { e.target.dataset.touched = '1'; renderCashoutCalc(); }));
  ['c-margin', 'c-margin-tax'].forEach(id => el(id).addEventListener('input', e => { e.target.dataset.touched = '1'; renderMarginCalc(); }));

  // zamykanie modali
  document.querySelectorAll('.tc-modal-ov').forEach(ov => ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('on'); }));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.tc-modal-ov.on').forEach(m => m.classList.remove('on'));
    if (e.key === 'n' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openBetModal(); }
  });

  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
