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
  unitPct: 1,
  maxStakePct: 5,
  maxExposurePct: 20,
  maxDailyLossPct: 10,
  maxDailyBets: 5,
  maxOdds: 5,
  monthlyGoalPct: 5,
  taxMode: 'stake',
  stakeTaxPct: 12,
  winTaxPct: 10,
  winTaxFreeLimit: 2280
};

const SUGGEST = {
  books: ['STS', 'Fortuna', 'Superbet', 'Betclic', 'Betfan', 'LV BET', 'eToto', 'forBET', 'PZBuk', 'Totalbet', 'Betcris'],
  sports: ['Piłka nożna', 'Koszykówka', 'Tenis', 'Siatkówka', 'Hokej', 'MMA / UFC', 'Boks', 'Żużel', 'Esport', 'Formuła 1', 'Skoki narciarskie'],
  markets: ['Bet builder', 'AKO', 'Solo', '1X2', 'Podwójna szansa', 'Over / Under', 'Handicap azjatycki', 'BTTS', 'Zawodnik – punkty', 'Liczba rożnych', 'Liczba kartek'],
  leagues: ['Liga Mistrzów', 'Liga Europy', 'Ekstraklasa', 'Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'NBA', 'NHL', 'ATP'],
  tags: ['value', 'underdog', 'faworyci', 'bet builder', 'statystyka', 'typ dnia', 'longshot', 'promo']
};

const STATUS_LABEL = {
  pending: 'W grze',
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
let betFilters = { status: 'all', q: '', book: '', period: 'all', grouping: 'week' };
let calendarState = { month: today().slice(0, 7), metric: 'pnl' };
let entryMode = 'payout';
let entryConf = 3;
let settleResult = 'won';
let settleHits = null;
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
function posClass(v) { return v > 0 ? 'pos' : v < 0 ? 'neg' : ''; }
function addDays(dateStr, n) { const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

// Polska odmiana: 1 kupon, 2–4 kupony, 5+ kuponów (z wyjątkiem 12–14)
function plural(n, one, few, many) {
  n = Math.abs(Math.round(n));
  const t = n % 10, h = n % 100;
  if (n === 1) return one;
  if (t >= 2 && t <= 4 && (h < 12 || h > 14)) return few;
  return many;
}
function nKupon(n) { return `${n} ${plural(n, 'kupon', 'kupony', 'kuponów')}`; }
function nZdarz(n) { return `${n} ${plural(n, 'zdarzenie', 'zdarzenia', 'zdarzeń')}`; }

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
  const dow = (d.getDay() + 6) % 7;
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
function defaultStakeTaxPct() {
  return (settings.taxMode === 'stake' || settings.taxMode === 'both') ? settings.stakeTaxPct : 0;
}

function normalizeBet(b) {
  const status = STATUS_LABEL[b.status] ? b.status : 'pending';
  const legs = Array.isArray(b.legs) ? b.legs : [];
  // migracja ze starego modelu: event -> title, taxFree -> taxPct 0
  const title = String(b.title || b.event || '').trim();
  const taxPct = Number.isFinite(Number(b.taxPct))
    ? Math.max(Number(b.taxPct), 0)
    : (b.taxFree ? 0 : defaultStakeTaxPct());
  const legCount = Math.max(Math.round(numberOr(b.legCount, legs.length || 1)), 1);
  const rawHits = numberNullable(b.hitLegs);
  return {
    id: b.id || uid('bet'),
    date: b.date || today(),
    settledAt: b.settledAt || null,
    title,
    bookmaker: String(b.bookmaker || '').trim(),
    sport: String(b.sport || '').trim(),
    league: String(b.league || '').trim(),
    market: String(b.market || '').trim(),
    pick: String(b.pick || '').trim(),
    legCount,
    hitLegs: rawHits === null ? null : clamp(Math.round(rawHits), 0, legCount),
    stake: Math.max(numberOr(b.stake, 0), 0),
    odds: positiveOr(b.odds, 1),
    boostPct: Math.max(numberOr(b.boostPct, 0), 0),
    taxPct,
    closingOdds: numberNullable(b.closingOdds),
    entryMode: b.entryMode === 'odds' ? 'odds' : 'payout',
    live: !!b.live,
    freebet: !!b.freebet,
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
  // ustawienia najpierw — normalizeBet potrzebuje domyślnej stawki podatku
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

  try {
    const raw = localStorage.getItem(BET_KEY);
    if (raw) state = JSON.parse(raw);
  } catch { state = { bets: [], ledger: [] }; }
  if (!state || typeof state !== 'object') state = { bets: [], ledger: [] };
  state.bets = Array.isArray(state.bets) ? state.bets.map(normalizeBet) : [];
  state.ledger = Array.isArray(state.ledger) ? state.ledger.map(normalizeLedger) : [];
}
function saveState() { localStorage.setItem(BET_KEY, JSON.stringify(state)); }
function saveSettingsStorage() { localStorage.setItem(BET_SETTINGS_KEY, JSON.stringify(settings)); }

/* ============================================================
   Matematyka kuponu
   ------------------------------------------------------------
   Podstawa: bukmacher pobiera podatek od stawki, więc do gry
   wchodzi stawka netto. Wygrana = stawka netto × kurs × boost.
   Formularz pozwala podać wygraną i wyliczyć kurs (odwrotnie).
   ============================================================ */
function boostMul(bet) { return 1 + Math.max(numberOr(bet.boostPct, 0), 0) / 100; }

function winTaxRate() {
  return (settings.taxMode === 'win' || settings.taxMode === 'both') ? settings.winTaxPct / 100 : 0;
}
// Ryczałt od wygranej – zwolnienie do kwoty wolnej (powyżej opodatkowana całość)
function winTaxOn(gross) {
  const rate = winTaxRate();
  if (rate <= 0 || gross <= settings.winTaxFreeLimit) return 0;
  return gross * rate;
}

// kurs -> wygrana brutto
function payoutFromOdds(odds, stake, taxPct, boost) {
  return stake * (1 - taxPct / 100) * odds * (1 + boost / 100);
}
// wygrana brutto -> kurs
function oddsFromPayout(payout, stake, taxPct, boost) {
  const net = stake * (1 - taxPct / 100) * (1 + boost / 100);
  if (!(net > 0)) return null;
  return payout / net;
}

function betMath(bet) {
  const b = normalizeBet(bet);
  const stake = b.stake;
  const stakeTax = stake * (b.taxPct / 100);
  const netStake = stake - stakeTax;

  const grossWin = netStake * b.odds * boostMul(b);
  const winTaxFull = winTaxOn(grossWin);
  const payoutIfWon = b.freebet
    ? Math.max(grossWin - stake - winTaxFull, 0)
    : (grossWin - winTaxFull);

  const risked = b.freebet ? 0 : stake;
  const settled = b.status !== 'pending';

  if (!settled) {
    return {
      ...b, netStake, stakeTax, risked, settled: false,
      grossWin, payoutIfWon, potentialProfit: payoutIfWon - risked,
      returned: null, profit: 0, stakeTaxPaid: 0, winTaxPaid: 0, taxPaid: 0,
      turnover: 0, effOdds: stake > 0 ? payoutIfWon / stake : 0,
      settledDate: null, roi: null
    };
  }

  let returned = 0, winTaxPaid = 0, stakeTaxPaid = 0, turnover = 0;

  switch (b.status) {
    case 'won':
      returned = payoutIfWon; stakeTaxPaid = stakeTax; winTaxPaid = winTaxFull; turnover = stake;
      break;
    case 'lost':
      returned = 0; stakeTaxPaid = stakeTax; turnover = stake;
      break;
    case 'void':
      // zwrot kuponu – bukmacher oddaje pełną stawkę wraz z podatkiem
      returned = b.freebet ? 0 : stake; turnover = 0;
      break;
    case 'half_won': {
      const gross = (netStake / 2) * b.odds * boostMul(b) + (stake / 2);
      const t = winTaxOn(gross);
      returned = b.freebet ? Math.max(gross - stake, 0) : gross - t;
      stakeTaxPaid = stakeTax / 2; winTaxPaid = t; turnover = stake / 2;
      break;
    }
    case 'half_lost':
      returned = b.freebet ? 0 : stake / 2; stakeTaxPaid = stakeTax / 2; turnover = stake / 2;
      break;
    case 'cashout':
      returned = Math.max(numberOr(b.payoutOverride, 0), 0); stakeTaxPaid = stakeTax; turnover = stake;
      break;
  }

  if (b.status !== 'cashout' && b.payoutOverride !== null && Number.isFinite(b.payoutOverride)) {
    returned = Math.max(b.payoutOverride, 0);
  }

  const profit = returned - risked;
  return {
    ...b, netStake, stakeTax, risked, settled: true,
    grossWin, payoutIfWon, potentialProfit: payoutIfWon - risked,
    returned, profit,
    stakeTaxPaid, winTaxPaid, taxPaid: stakeTaxPaid + winTaxPaid,
    turnover,
    effOdds: stake > 0 ? returned / stake : 0,
    settledDate: b.settledAt || b.date,
    roi: turnover > 0 ? (profit / turnover) * 100 : null
  };
}

function unitValue(bankroll) { return Math.max(bankroll, 0) * (settings.unitPct / 100); }

/* ------------------------------------------------------------
   Trafione zdarzenia na kuponie.
   Wygrany kupon = wszystkie trafione (nie ma czego wpisywać).
   Przegrany solo = zero trafionych. W pozostałych przypadkach
   liczba pochodzi z rozliczenia; null oznacza „nie podano”.
   ------------------------------------------------------------ */
function hitsOf(b) {
  if (b.status === 'pending') return null;
  if (b.status === 'won' || b.status === 'half_won') return b.legCount;
  if (b.legCount === 1) return (b.status === 'lost' || b.status === 'half_lost') ? 0 : null;
  return b.hitLegs === null ? null : clamp(b.hitLegs, 0, b.legCount);
}
// czy kupon przegrał o włos (zabrakło jednego zdarzenia)
function isNearMiss(b) {
  const h = hitsOf(b);
  return b.legCount > 1 && h !== null && b.profit < 0 && (b.legCount - h) === 1;
}

/* ============================================================
   Agregacja
   ============================================================ */
function aggregate() {
  const all = state.bets.map(betMath).sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
  const settled = all.filter(b => b.settled).sort((a, b) => (a.settledDate === b.settledDate ? 0 : a.settledDate < b.settledDate ? -1 : 1));
  const pending = all.filter(b => !b.settled);

  const ledger = [...state.ledger].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
  const ledgerNet = ledger.reduce((s, e) => {
    if (e.type === 'deposit' || e.type === 'bonus') return s + e.amount;
    if (e.type === 'withdraw') return s - e.amount;
    return s + e.amount;
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
  const winRate = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : null;

  const avgOdds = turnover > 0 ? settled.reduce((s, b) => s + b.odds * b.turnover, 0) / turnover : null;
  const avgStake = settled.length ? settled.reduce((s, b) => s + b.stake, 0) / settled.length : null;
  const wonBets = settled.filter(b => b.status === 'won' || b.status === 'half_won');
  const lostBets = settled.filter(b => b.status === 'lost' || b.status === 'half_lost');
  const avgWinOdds = wonBets.length ? wonBets.reduce((s, b) => s + b.odds, 0) / wonBets.length : null;
  const avgLoseOdds = lostBets.length ? lostBets.reduce((s, b) => s + b.odds, 0) / lostBets.length : null;

  // trafione zdarzenia — „pech czy słaby kupon”
  const withHits = settled.filter(b => hitsOf(b) !== null);
  const legsTotal = withHits.reduce((s, b) => s + b.legCount, 0);
  const legsHit = withHits.reduce((s, b) => s + hitsOf(b), 0);
  const legHitRate = legsTotal > 0 ? (legsHit / legsTotal) * 100 : null;
  const lostMulti = settled.filter(b => b.profit < 0 && b.legCount > 1 && hitsOf(b) !== null);
  const missDist = new Map();
  for (const b of lostMulti) {
    const miss = b.legCount - hitsOf(b);
    const key = miss >= 4 ? 4 : miss;
    if (!missDist.has(key)) missDist.set(key, { count: 0, loss: 0 });
    const e = missDist.get(key);
    e.count += 1;
    e.loss += b.profit;
  }
  const nearMisses = lostMulti.filter(isNearMiss);
  const nearMissLoss = nearMisses.reduce((s, b) => s + b.profit, 0);
  const nearMissWouldWin = nearMisses.reduce((s, b) => s + (b.payoutIfWon - b.stake), 0);
  const unknownHits = settled.filter(b => b.legCount > 1 && b.profit < 0 && hitsOf(b) === null).length;

  const clvValues = all.filter(b => b.closingOdds > 0).map(b => (b.odds / b.closingOdds - 1) * 100);
  const avgClv = clvValues.length ? clvValues.reduce((a, c) => a + c, 0) / clvValues.length : null;
  const beatClose = clvValues.filter(v => v > 0).length;

  const byDay = {}, turnoverByDay = {}, countByDay = {}, winsByDay = {}, lossesByDay = {};
  for (const b of settled) {
    const d = b.settledDate;
    byDay[d] = (byDay[d] || 0) + b.profit;
    turnoverByDay[d] = (turnoverByDay[d] || 0) + b.turnover;
    countByDay[d] = (countByDay[d] || 0) + 1;
    if (b.profit > 0) winsByDay[d] = (winsByDay[d] || 0) + 1;
    if (b.profit < 0) lossesByDay[d] = (lossesByDay[d] || 0) + 1;
  }
  const flowByDay = {};
  for (const e of ledger) {
    flowByDay[e.date] = (flowByDay[e.date] || 0) + (e.type === 'withdraw' ? -e.amount : e.amount);
  }

  const dates = [...new Set([...Object.keys(byDay), ...Object.keys(flowByDay)])].sort();
  const points = [];
  let running = settings.bankrollStart, cumProfit = 0, peak = 0, maxDd = 0, maxDdPct = 0;
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

  let curWin = 0, curLoss = 0, bestWin = 0, worstLoss = 0;
  for (const b of settled) {
    if (b.profit > 0) { curWin++; curLoss = 0; bestWin = Math.max(bestWin, curWin); }
    else if (b.profit < 0) { curLoss++; curWin = 0; worstLoss = Math.max(worstLoss, curLoss); }
  }

  const todayKey = today();
  const monthKey = todayKey.slice(0, 7);
  const todayPnl = byDay[todayKey] || 0;
  const todayBets = all.filter(b => b.date === todayKey).length;
  const todayStaked = all.filter(b => b.date === todayKey).reduce((s, b) => s + b.risked, 0);
  const monthBets = settled.filter(b => b.settledDate.startsWith(monthKey));
  const monthPnl = monthBets.reduce((s, b) => s + b.profit, 0);

  return {
    all, settled, pending, ledger, ledgerNet, cashBase,
    realizedPnl, bankroll, openExposure, available,
    turnover, yieldPct, wins, losses, pushes, winRate,
    avgOdds, avgStake, avgWinOdds, avgLoseOdds,
    avgClv, beatClose, clvCount: clvValues.length,
    legHitRate, legsHit, legsTotal, missDist, lostMulti,
    nearMisses, nearMissLoss, nearMissWouldWin, unknownHits,
    byDay, turnoverByDay, countByDay, winsByDay, lossesByDay, flowByDay,
    points, maxDd, maxDdPct, bestWin, worstLoss,
    todayPnl, todayBets, todayStaked, monthPnl, monthBets,
    taxTotal: settled.reduce((s, b) => s + b.taxPaid, 0),
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
    count: bets.length, turnover, profit,
    yieldPct: turnover > 0 ? (profit / turnover) * 100 : null,
    wins, losses,
    winRate: (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : null
  };
}

/* ============================================================
   Pomocnicze do renderu
   ============================================================ */
function el(id) { return document.getElementById(id); }
function setText(id, txt, cls) {
  const n = el(id);
  if (!n) return;
  n.textContent = txt;
  if (cls !== undefined) n.className = cls;
}
function setTone(id, tone) {
  const n = el(id);
  if (n) n.setAttribute('data-tone', tone || '');
}
function slipRows(rows) {
  return rows.map(r => `<div class="bt-slip-row ${r[3] || ''}"><span class="k">${r[0]}</span><span class="v ${r[2] || ''}">${r[1]}</span></div>`).join('');
}

/* Wizualizacja trafień: od razu widać, czy zabrakło jednego
   zdarzenia (pech), czy kupon posypał się od początku. */
function hitsCell(b) {
  if (!b.settled) return `<span class="muted">${b.legCount}</span>`;
  const h = hitsOf(b);
  if (h === null) {
    return b.legCount > 1
      ? `<button class="bt-hits-ask" title="Uzupełnij liczbę trafionych zdarzeń" onclick="openSettleModal('${b.id}')">? / ${b.legCount}</button>`
      : `<span class="muted">${b.legCount}</span>`;
  }
  const miss = b.legCount - h;
  const tone = miss === 0 ? 'full' : h === 0 ? 'none' : miss === 1 ? 'near' : 'weak';
  const frac = `<span class="frac">${h}/${b.legCount}</span>`;
  const badge = (tone === 'near' && b.profit < 0) ? `<span class="badge">pech</span>` : '';
  const title = `Trafione ${h} z ${b.legCount}`;

  if (b.legCount === 1) {
    return `<span class="bt-hits ${tone}" title="${title}"><span class="pips"><i class="${h ? 'on' : ''}"></i></span>${frac}</span>`;
  }
  if (b.legCount > 10) {
    return `<span class="bt-hits ${tone}" title="${title}">
      <span class="meter"><i style="width:${(h / b.legCount) * 100}%"></i></span>${frac}${badge}</span>`;
  }
  const pips = Array.from({ length: b.legCount }, (_, i) => `<i class="${i < h ? 'on' : ''}"></i>`).join('');
  return `<span class="bt-hits ${tone}" title="${title}"><span class="pips">${pips}</span>${frac}${badge}</span>`;
}

function betEventCell(b, compact = false) {
  const meta = [];
  if (b.legCount > 1) meta.push(`<span class="bt-pill accent">${b.legCount} zdarz.</span>`);
  if (b.bookmaker) meta.push(`<span class="bt-pill">${esc(b.bookmaker)}</span>`);
  if (!compact && b.sport) meta.push(`<span class="bt-pill">${esc(b.sport)}</span>`);
  if (b.live) meta.push(`<span class="bt-pill live">LIVE</span>`);
  if (b.freebet) meta.push(`<span class="bt-pill free">FREEBET</span>`);
  if (b.boostPct > 0) meta.push(`<span class="bt-pill boost">BOOST +${b.boostPct}%</span>`);
  if (!compact && b.taxPct !== defaultStakeTaxPct()) meta.push(`<span class="bt-pill warn">podatek ${b.taxPct}%</span>`);
  if (!compact) for (const t of b.tags.slice(0, 3)) meta.push(`<span class="bt-pill">#${esc(t)}</span>`);
  const sub = [b.market, b.pick].filter(Boolean).join(' → ');
  return `<div class="bt-event${compact ? ' compact' : ''}">
      <span class="ev">${esc(b.title || 'Kupon bez nazwy')}</span>
      ${sub ? `<span class="pk">${esc(sub)}</span>` : ''}
      ${meta.length ? `<span class="meta">${meta.join('')}</span>` : ''}
    </div>`;
}

/* ============================================================
   Dashboard: hero
   ============================================================ */
function heroSparkline(points) {
  if (!points || points.length < 2) return '';
  const vals = points.map(p => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = (max - min) || 1;
  const W = 320, H = 100;
  const step = W / (points.length - 1);
  const coords = vals.map((v, i) => [i * step, H - ((v - min) / range) * (H * 0.82) - H * 0.09]);
  const line = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${area}" fill="rgba(255,255,255,.22)"></path>
    <path d="${line}" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="2"
          stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>
  </svg>`;
}

function renderHero(agg) {
  setText('hero-bankroll', fmtPLN(agg.bankroll));
  el('hero-spark').innerHTML = heroSparkline(agg.points);

  const delta = el('hero-delta');
  delta.className = 'bt-hero-chip ' + posClass(agg.realizedPnl);
  delta.innerHTML = `<span class="material-symbols-outlined">${agg.realizedPnl >= 0 ? 'trending_up' : 'trending_down'}</span>${fmtPLN(agg.realizedPnl, true)}`;

  const y = el('hero-yield');
  y.className = 'bt-hero-chip';
  y.textContent = agg.yieldPct === null ? 'yield —' : `yield ${fmtPct(agg.yieldPct)}`;

  setText('hero-note', agg.settled.length
    ? `${nKupon(agg.settled.length)} rozliczonych · obrót ${fmtPLN0(agg.turnover)}`
    : 'Dodaj pierwszy kupon, aby zobaczyć statystyki');

  setText('hero-today', fmtPLN(agg.todayPnl, true), 'v ' + posClass(agg.todayPnl));
  setText('hero-month', fmtPLN(agg.monthPnl, true), 'v ' + posClass(agg.monthPnl));
  setText('hero-open', String(agg.pending.length), 'v');
  setText('hero-unit', fmtPLN0(agg.unit), 'v');
}

function renderKpis(agg) {
  setText('kpi-desc', agg.settled.length ? `na podstawie ${nKupon(agg.settled.length)}` : 'brak rozliczonych kuponów');

  setText('k-pnl', fmtPLN(agg.realizedPnl, true), 'v mono ' + posClass(agg.realizedPnl));
  setText('k-pnl-n', `${agg.wins} W / ${agg.losses} P${agg.pushes ? ` / ${agg.pushes} zwrot` : ''}`);
  setTone('k-pnl', agg.realizedPnl > 0 ? 'pos' : agg.realizedPnl < 0 ? 'neg' : 'accent');

  setText('k-roi', agg.yieldPct === null ? '—' : fmtPct(agg.yieldPct), 'v mono ' + posClass(agg.yieldPct || 0));
  setText('k-roi-n', 'zysk / obrót');
  setTone('k-roi', agg.yieldPct > 0 ? 'pos' : agg.yieldPct < 0 ? 'neg' : '');

  setText('k-wr', agg.winRate === null ? '—' : agg.winRate.toFixed(1) + '%', 'v mono');
  setText('k-wr-n', agg.bestWin || agg.worstLoss ? `seria: ${agg.bestWin}W / ${agg.worstLoss}P` : 'trafione / rozstrzygnięte');

  setText('k-turnover', fmtPLN0(agg.turnover), 'v mono');
  setText('k-turnover-n', agg.avgStake === null ? 'suma stawek' : `śr. stawka ${fmtPLN0(agg.avgStake)}`);

  setText('k-odds', agg.avgOdds === null ? '—' : fmtOdds(agg.avgOdds), 'v mono');
  setText('k-odds-n', agg.avgWinOdds || agg.avgLoseOdds
    ? `wygrane ${fmtOdds(agg.avgWinOdds)} · przegrane ${fmtOdds(agg.avgLoseOdds)}`
    : 'ważony obrotem');

  setText('k-dd', agg.maxDd > 0 ? fmtPLN(-agg.maxDd) : '—', 'v mono ' + (agg.maxDd > 0 ? 'neg' : ''));
  setText('k-dd-n', agg.maxDd > 0 ? `${agg.maxDdPct.toFixed(1)}% szczytu bankrolla` : 'brak obsunięcia');
  setTone('k-dd', agg.maxDd > 0 ? 'warn' : '');
}

function renderDiscipline(agg) {
  setText('d-exposure', fmtPLN(agg.openExposure), 'v');
  setText('d-exposure-n', `${nKupon(agg.pending.length)} w grze · dostępne ${fmtPLN(agg.available)}`);

  const target = agg.cashBase * settings.monthlyGoalPct / 100;
  const goalPct = target > 0 ? (agg.monthPnl / target) * 100 : null;
  setText('d-goal', fmtPLN(agg.monthPnl, true), 'v ' + posClass(agg.monthPnl));
  setText('d-goal-n', target > 0
    ? `cel ${fmtPLN0(target)} · ${goalPct === null ? '—' : goalPct.toFixed(0) + '%'} wykonania`
    : 'ustaw cel w ustawieniach');

  const expPct = agg.bankroll > 0 ? (agg.openExposure / agg.bankroll) * 100 : 0;
  setText('m-exp-pct', expPct.toFixed(1) + '%');
  const expBar = el('m-exp-bar');
  expBar.style.width = clamp(expPct / settings.maxExposurePct * 100, 0, 100) + '%';
  expBar.className = 'tc-bar-fill' + (expPct > settings.maxExposurePct ? ' bad' : expPct > settings.maxExposurePct * 0.7 ? ' warn' : '');
  setText('m-exp-limit', `Limit ${settings.maxExposurePct}% = ${fmtPLN0(agg.bankroll * settings.maxExposurePct / 100)}`);
  setText('m-exp-cur', fmtPLN(agg.openExposure));

  const lossLimit = agg.bankroll * settings.maxDailyLossPct / 100;
  const todayLoss = Math.max(-agg.todayPnl, 0);
  setText('m-loss-pct', lossLimit > 0 ? (todayLoss / lossLimit * 100).toFixed(0) + '%' : '—');
  el('m-loss-bar').style.width = (lossLimit > 0 ? clamp(todayLoss / lossLimit * 100, 0, 100) : 0) + '%';
  setText('m-loss-limit', `Limit ${settings.maxDailyLossPct}% = ${fmtPLN0(lossLimit)}`);
  setText('m-loss-cur', fmtPLN(agg.todayPnl, true));

  setText('m-cnt-pct', `${agg.todayBets} / ${settings.maxDailyBets}`);
  const cntBar = el('m-cnt-bar');
  cntBar.style.width = clamp(agg.todayBets / settings.maxDailyBets * 100, 0, 100) + '%';
  cntBar.className = 'tc-bar-fill' + (agg.todayBets > settings.maxDailyBets ? ' bad' : agg.todayBets >= settings.maxDailyBets ? ' warn' : '');
  setText('m-cnt-limit', `Postawione dziś: ${fmtPLN0(agg.todayStaked)}`);
  setText('m-cnt-cur', nKupon(agg.todayBets));

  const alerts = [];
  let limitBad = false, limitWarn = false;
  if (todayLoss >= lossLimit && lossLimit > 0) { limitBad = true; alerts.push(['bad', 'block', '<strong>Dzienny stop-loss osiągnięty.</strong> Zamknij laptopa — dziś już nie odrabiasz.']); }
  if (agg.todayBets >= settings.maxDailyBets) { limitWarn = true; alerts.push(['warn', 'timer', `<strong>Limit ${settings.maxDailyBets} kuponów dziennie</strong> osiągnięty. Kolejne typy to zwykle tilt.`]); }
  if (expPct > settings.maxExposurePct) { limitWarn = true; alerts.push(['warn', 'account_balance_wallet', `Ekspozycja ${expPct.toFixed(1)}% przekracza limit ${settings.maxExposurePct}%.`]); }

  let tailLoss = 0;
  for (let i = agg.settled.length - 1; i >= 0; i--) { if (agg.settled[i].profit < 0) tailLoss++; else break; }
  if (tailLoss >= 3) alerts.push(['warn', 'trending_down', `Seria <strong>${tailLoss} przegranych</strong> z rzędu. Trzymaj płaskie stawki, nie podnoś.`]);

  const last5 = agg.all.slice(-5);
  if (last5.length === 5 && agg.avgStake) {
    const avg5 = last5.reduce((s, b) => s + b.stake, 0) / 5;
    if (avg5 > agg.avgStake * 1.6) alerts.push(['warn', 'trending_up', `Ostatnie 5 stawek jest <strong>${(avg5 / agg.avgStake).toFixed(1)}×</strong> wyższe od Twojej średniej — klasyczny objaw odgrywania się.`]);
  }

  if (agg.avgClv !== null && agg.clvCount >= 5) {
    alerts.push([agg.avgClv > 0 ? 'good' : 'bad', 'insights',
      `Średni CLV <strong>${fmtPct(agg.avgClv)}</strong> (${agg.beatClose}/${agg.clvCount} kuponów lepszych od kursu zamknięcia). ${agg.avgClv > 0 ? 'Bijesz rynek — najlepszy dowód realnej przewagi.' : 'Rynek zamyka się lepiej niż Twój kurs — szukaj wcześniejszych wejść.'}`]);
  }

  if (!alerts.length) alerts.push(['good', 'check_circle', 'Wszystkie limity w normie. Trzymaj płaskie stawki i rejestruj każdy kupon.']);

  el('disc-alerts').innerHTML = alerts.map(([k, i, h]) =>
    `<div class="bt-alert ${k}"><span class="material-symbols-outlined">${i}</span><span>${h}</span></div>`).join('');

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
  g.addColorStop(0, base + '0.24)');
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

function renderOpenBets(agg) {
  const wrap = el('open-bets-wrap');
  setText('open-count', agg.pending.length ? `${nKupon(agg.pending.length)} · ekspozycja ${fmtPLN0(agg.openExposure)}` : 'brak otwartych');
  if (!agg.pending.length) {
    wrap.innerHTML = `<div class="tc-empty">
      <span class="material-symbols-outlined">receipt_long</span>
      <h4>Brak kuponów w grze</h4>
      <p>Dodaj kupon zaraz po jego postawieniu — rejestrowanie na bieżąco to podstawa uczciwej statystyki.</p>
    </div>`;
    return;
  }
  const unit = agg.unit;
  const rows = [...agg.pending].sort((a, b) => (a.date < b.date ? 1 : -1)).map(b => `
    <tr>
      <td class="nowrap">${esc(b.date)}</td>
      <td>${betEventCell(b)}</td>
      <td class="num">${b.legCount}</td>
      <td class="num"><span class="bt-odds">${fmtOdds(b.odds)}</span></td>
      <td class="num">${fmtPLN(b.stake)}${unit > 0 ? `<br><span class="muted" style="font-size:10.5px">${(b.stake / unit).toFixed(2)}u</span>` : ''}</td>
      <td class="num">${fmtPLN(b.payoutIfWon)}</td>
      <td class="num pos">${fmtPLN(b.potentialProfit, true)}</td>
      <td>
        <div class="row-actions">
          <button class="row-btn" title="Wygrany" onclick="quickSettle('${b.id}','won')" style="color:var(--tc-pos)"><span class="material-symbols-outlined">check_circle</span></button>
          <button class="row-btn" title="Przegrany" onclick="quickSettle('${b.id}','lost')" style="color:var(--tc-neg)"><span class="material-symbols-outlined">cancel</span></button>
          <button class="row-btn" title="Rozlicz szczegółowo" onclick="openSettleModal('${b.id}')"><span class="material-symbols-outlined">tune</span></button>
          <button class="row-btn" title="Edytuj" onclick="editBet('${b.id}')"><span class="material-symbols-outlined">edit</span></button>
          <button class="row-btn danger" title="Usuń" onclick="deleteBet('${b.id}')"><span class="material-symbols-outlined">delete</span></button>
        </div>
      </td>
    </tr>`).join('');

  wrap.innerHTML = `<table class="tc-tbl">
    <thead><tr>
      <th>Data</th><th>Kupon</th><th class="num">Zdarz.</th><th class="num">Kurs</th>
      <th class="num">Stawka</th><th class="num">Wygrana</th><th class="num">Zysk</th><th style="width:150px"></th>
    </tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function renderRecent(agg) {
  const wrap = el('recent-wrap');
  const recent = [...agg.settled].reverse().slice(0, 8);
  if (!recent.length) {
    wrap.innerHTML = `<div class="tc-empty"><span class="material-symbols-outlined">history</span><h4>Brak rozliczeń</h4><p>Tu pojawią się ostatnio rozliczone kupony.</p></div>`;
    return;
  }
  wrap.innerHTML = `<div class="tc-tbl-wrap"><table class="tc-tbl">
    <thead><tr><th>Data</th><th>Kupon</th><th class="num">Kurs</th><th class="num">Stawka</th><th>Wynik</th><th class="num">Zwrot</th><th class="num">P&L</th></tr></thead>
    <tbody>${recent.map(b => `
      <tr>
        <td class="nowrap">${esc(b.settledDate)}</td>
        <td>${betEventCell(b)}</td>
        <td class="num"><span class="bt-odds">${fmtOdds(b.odds)}</span></td>
        <td class="num">${fmtPLN(b.stake)}</td>
        <td><span class="bt-tag ${b.status}">${STATUS_LABEL[b.status]}</span></td>
        <td class="num">${fmtPLN(b.returned)}</td>
        <td class="num ${posClass(b.profit)}">${fmtPLN(b.profit, true)}</td>
      </tr>`).join('')}</tbody></table></div>`;
}

function renderRankList(wrapId, map, emptyText) {
  const wrap = el(wrapId);
  if (!wrap) return;
  const rows = [...map.entries()].map(([k, bets]) => ({ key: k, ...bucketStats(bets) }))
    .filter(r => r.count > 0)
    .sort((a, b) => Math.abs(b.profit) - Math.abs(a.profit))
    .slice(0, 8);
  if (!rows.length) {
    wrap.innerHTML = `<div class="tc-empty"><span class="material-symbols-outlined">bar_chart</span><h4>Brak danych</h4><p>${esc(emptyText)}</p></div>`;
    return;
  }
  const max = Math.max(...rows.map(r => Math.abs(r.profit)), 1);
  wrap.innerHTML = `<div class="bt-rank">${rows.map(r => `
    <div class="bt-rank-row">
      <div class="t">${esc(r.key)}<small>${nKupon(r.count)} · obrót ${fmtPLN0(r.turnover)}</small></div>
      <div class="bar"><i class="${r.profit < 0 ? 'neg' : ''}" style="width:${Math.abs(r.profit) / max * 50}%"></i></div>
      <div class="v ${posClass(r.profit)}">${fmtPLN(r.profit, true)}</div>
      <div class="r">${r.yieldPct === null ? '—' : fmtPct(r.yieldPct, true, 1)}</div>
    </div>`).join('')}</div>`;
}

/* ============================================================
   Wykresy
   ============================================================ */
const TOOLTIP = { backgroundColor: '#0f172a', titleColor: '#fff', bodyColor: '#cbd5e1', padding: 10, displayColors: false, cornerRadius: 6 };
function axisPLN() {
  return { grid: { color: 'rgba(226,232,240,0.7)' }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => Math.round(v).toLocaleString('pl-PL') } };
}
function axisPct() {
  return { grid: { color: 'rgba(226,232,240,0.7)' }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => v + '%' } };
}
function axisCat() {
  return { grid: { display: false }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } };
}
function barColors(values) { return values.map(v => v >= 0 ? '#0b8a4a' : '#c0362c'); }
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

function renderCharts(agg) {
  const settled = agg.settled;

  // P&L miesięczny
  const byMonth = groupBy(settled, b => b.settledDate.slice(0, 7));
  const mKeys = [...byMonth.keys()].sort();
  const mVals = mKeys.map(k => bucketStats(byMonth.get(k)).profit);
  makeChart('chart-monthly', {
    type: 'bar',
    data: { labels: mKeys.map(monthLabel), datasets: [{ data: mVals, backgroundColor: barColors(mVals), borderRadius: 5, maxBarThickness: 40 }] },
    options: {
      maintainAspectRatio: false, responsive: true, animation: { duration: 200 },
      plugins: { legend: { display: false }, tooltip: { ...TOOLTIP, callbacks: { label: c => fmtPLN(c.parsed.y, true) } } },
      scales: { x: axisCat(), y: axisPLN() }
    }
  });

  // Yield wg kursu
  const byOdds = groupBy(settled, b => (ODDS_BUCKETS.find(x => b.odds >= x.lo && b.odds < x.hi) || ODDS_BUCKETS[5]).k);
  const oKeys = ODDS_BUCKETS.map(x => x.k).filter(k => byOdds.has(k));
  const oVals = oKeys.map(k => bucketStats(byOdds.get(k)).yieldPct ?? 0);
  makeChart('chart-odds', {
    type: 'bar',
    data: { labels: oKeys, datasets: [{ data: oVals, backgroundColor: barColors(oVals), borderRadius: 5, maxBarThickness: 34 }] },
    options: {
      maintainAspectRatio: false, responsive: true, animation: { duration: 200 },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP, callbacks: {
            label: c => {
              const s = bucketStats(byOdds.get(oKeys[c.dataIndex]));
              return [`Yield: ${fmtPct(s.yieldPct)}`, `${nKupon(s.count)}`, `P&L: ${fmtPLN(s.profit, true)}`];
            }
          }
        }
      },
      scales: { x: axisCat(), y: axisPct() }
    }
  });

  // P&L wg bukmachera
  const byBook = groupBy(settled, b => b.bookmaker || 'Bez nazwy');
  const bKeys = [...byBook.keys()].sort((a, b) => bucketStats(byBook.get(b)).profit - bucketStats(byBook.get(a)).profit).slice(0, 8);
  const bVals = bKeys.map(k => bucketStats(byBook.get(k)).profit);
  makeChart('chart-book', {
    type: 'bar',
    data: { labels: bKeys, datasets: [{ data: bVals, backgroundColor: barColors(bVals), borderRadius: 5, maxBarThickness: 26 }] },
    options: {
      maintainAspectRatio: false, responsive: true, animation: { duration: 200 }, indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { ...TOOLTIP, callbacks: { label: c => fmtPLN(c.parsed.x, true) } } },
      scales: {
        x: { grid: { color: 'rgba(226,232,240,0.7)' }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => Math.round(v).toLocaleString('pl-PL') } },
        y: { grid: { display: false }, border: { display: false }, ticks: { color: '#64748b', font: { size: 10 } } }
      }
    }
  });

  // Struktura wyników
  const counts = {
    won: settled.filter(b => b.status === 'won').length,
    half_won: settled.filter(b => b.status === 'half_won').length,
    lost: settled.filter(b => b.status === 'lost').length,
    half_lost: settled.filter(b => b.status === 'half_lost').length,
    void: settled.filter(b => b.status === 'void').length,
    cashout: settled.filter(b => b.status === 'cashout').length
  };
  const wrKeys = Object.keys(counts).filter(k => counts[k] > 0);
  makeChart('chart-wr', {
    type: 'doughnut',
    data: {
      labels: wrKeys.map(k => STATUS_LABEL[k]),
      datasets: [{
        data: wrKeys.map(k => counts[k]),
        backgroundColor: wrKeys.map(k => ({ won: '#0b8a4a', half_won: '#4ea87c', lost: '#c0362c', half_lost: '#d9736b', void: '#6366f1', cashout: '#7c3aed' }[k])),
        borderWidth: 0
      }]
    },
    options: {
      maintainAspectRatio: false, responsive: true, cutout: '62%',
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 9, boxHeight: 9, font: { size: 10 }, color: '#64748b', padding: 8 } },
        tooltip: { ...TOOLTIP, displayColors: true }
      }
    }
  });

  // Wg liczby zdarzeń
  const legBucket = b => b.legCount <= 1 ? 'Solo' : b.legCount <= 3 ? '2–3' : b.legCount <= 5 ? '4–5' : b.legCount <= 9 ? '6–9' : '10+';
  const legOrder = ['Solo', '2–3', '4–5', '6–9', '10+'];
  const byLegs = groupBy(settled, legBucket);
  const lKeys = legOrder.filter(k => byLegs.has(k));
  const lVals = lKeys.map(k => bucketStats(byLegs.get(k)).profit);
  makeChart('chart-legs', {
    type: 'bar',
    data: { labels: lKeys, datasets: [{ data: lVals, backgroundColor: barColors(lVals), borderRadius: 5, maxBarThickness: 30 }] },
    options: {
      maintainAspectRatio: false, responsive: true, animation: { duration: 200 },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP, callbacks: {
            label: c => {
              const s = bucketStats(byLegs.get(lKeys[c.dataIndex]));
              return [`P&L: ${fmtPLN(s.profit, true)}`, `${nKupon(s.count)}`, `Yield: ${fmtPct(s.yieldPct)}`];
            }
          }
        }
      },
      scales: { x: axisCat(), y: axisPLN() }
    }
  });

  // Wg wielkości stawki
  const unit = agg.unit || 1;
  const stakeBucket = b => {
    const u = b.stake / unit;
    return u < 0.75 ? '< 0.75u' : u < 1.25 ? '≈ 1u' : u < 2 ? '1.25–2u' : u < 3 ? '2–3u' : '3u+';
  };
  const sOrder = ['< 0.75u', '≈ 1u', '1.25–2u', '2–3u', '3u+'];
  const byStake = groupBy(settled, stakeBucket);
  const sKeys = sOrder.filter(k => byStake.has(k));
  const sVals = sKeys.map(k => bucketStats(byStake.get(k)).profit);
  makeChart('chart-stake', {
    type: 'bar',
    data: { labels: sKeys, datasets: [{ data: sVals, backgroundColor: barColors(sVals), borderRadius: 5, maxBarThickness: 30 }] },
    options: {
      maintainAspectRatio: false, responsive: true, animation: { duration: 200 },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP, callbacks: {
            label: c => {
              const s = bucketStats(byStake.get(sKeys[c.dataIndex]));
              return [`P&L: ${fmtPLN(s.profit, true)}`, `${nKupon(s.count)}`, `Yield: ${fmtPct(s.yieldPct)}`];
            }
          }
        }
      },
      scales: { x: axisCat(), y: axisPLN() }
    }
  });
}

function renderHitsCard(agg) {
  const near = agg.nearMisses.length;
  const missKeys = [1, 2, 3, 4].filter(k => agg.missDist.has(k));
  const missVals = missKeys.map(k => agg.missDist.get(k).count);

  el('hits-stats').innerHTML = `
    <div class="bt-hits-stat">
      <div class="k">Trafialność zdarzeń</div>
      <div class="v ${agg.legHitRate === null ? '' : agg.legHitRate >= 50 ? 'pos' : 'neg'}">${agg.legHitRate === null ? '—' : agg.legHitRate.toFixed(1) + '%'}</div>
      <div class="n">${agg.legsTotal ? `${agg.legsHit} z ${agg.legsTotal} zdarzeń na rozliczonych kuponach` : 'uzupełnij trafienia przy rozliczaniu'}</div>
    </div>
    <div class="bt-hits-stat">
      <div class="k">Przegrane o włos</div>
      <div class="v warn">${near || '—'}</div>
      <div class="n">${near
      ? `strata ${fmtPLN(agg.nearMissLoss)} · gdyby weszły: <strong>${fmtPLN(agg.nearMissWouldWin, true)}</strong>`
      : 'żaden kupon nie przegrał o jedno zdarzenie'}</div>
    </div>
    <div class="bt-hits-stat">
      <div class="k">Werdykt</div>
      <div class="v">${agg.lostMulti.length ? `${Math.round(near / agg.lostMulti.length * 100)}%` : '—'}</div>
      <div class="n">${agg.lostMulti.length
      ? `przegranych kuponów wielozdarzeniowych to pech (zabrakło jednego)${agg.unknownHits ? ` · ${agg.unknownHits} bez uzupełnionych trafień` : ''}`
      : 'brak przegranych kuponów wielozdarzeniowych'}</div>
    </div>`;

  makeChart('chart-miss', {
    type: 'bar',
    data: {
      labels: missKeys.map(k => k === 4 ? 'o 4+' : `o ${k}`),
      datasets: [{
        data: missVals,
        backgroundColor: missKeys.map(k => k === 1 ? '#b45309' : '#c0362c'),
        borderRadius: 5, maxBarThickness: 46
      }]
    },
    options: {
      maintainAspectRatio: false, responsive: true, animation: { duration: 200 },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP, callbacks: {
            title: items => `Zabrakło ${items[0].label.replace('o ', '')} zdarzeń`,
            label: c => {
              const e = agg.missDist.get(missKeys[c.dataIndex]);
              return [`${nKupon(e.count)}`, `Strata: ${fmtPLN(e.loss)}`];
            }
          }
        }
      },
      scales: {
        x: axisCat(),
        y: { grid: { color: 'rgba(226,232,240,0.7)' }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 }, precision: 0 } }
      }
    }
  });
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
    const w = agg.winsByDay[key] || 0, l = agg.lossesByDay[key] || 0;
    const turnover = agg.turnoverByDay[key] || 0;
    const pnl = agg.byDay[key] || 0;
    stats[key] = isFuture
      ? { isFuture: true, pnl: 0, turnover: 0, bets: 0, wins: 0, losses: 0, roi: null, wr: null, bank: null }
      : {
        isFuture: false, pnl, turnover, bets: agg.countByDay[key] || 0, wins: w, losses: l,
        roi: turnover > 0 ? (pnl / turnover) * 100 : null,
        wr: (w + l) > 0 ? (w / (w + l)) * 100 : null,
        bank: running
      };
  }

  const buckets = [[1, 7], [8, 14], [15, 21], [22, 28], [29, daysInMonth], ['all', 'all']];
  el('cal-buckets').innerHTML = buckets.map(r => {
    const list = Object.entries(stats).filter(([k, s]) => {
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
    const label = r[0] === 'all' ? 'Cały miesiąc' : `${r[0]}–${r[1]} dzień`;
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

  const byWeek = groupBy(settled, b => isoWeekKey(b.settledDate));
  const wKeys = [...byWeek.keys()].sort().reverse().slice(0, 12);
  const wMax = Math.max(...wKeys.map(k => Math.abs(bucketStats(byWeek.get(k)).profit)), 1);
  el('week-table-wrap').innerHTML = wKeys.length ? `<table class="bt-mini-tbl">
    <thead><tr><th>Tydzień</th><th class="num">Kup.</th><th class="num">Obrót</th><th class="num">P&L</th><th class="num">Yield</th><th>Trend</th></tr></thead>
    <tbody>${wKeys.map(k => {
    const bets = byWeek.get(k);
    const s = bucketStats(bets);
    return `<tr class="${k === isoWeekKey(today()) ? 'current' : ''}">
        <td><strong>T${k.split('-W')[1]}</strong> <span class="muted" style="font-size:11px">${isoWeekRange(bets[0].settledDate)}</span></td>
        <td class="num">${s.count}</td>
        <td class="num">${fmtPLN0(s.turnover)}</td>
        <td class="num ${posClass(s.profit)}">${fmtPLN(s.profit, true)}</td>
        <td class="num ${posClass(s.yieldPct || 0)}">${s.yieldPct === null ? '—' : fmtPct(s.yieldPct, true, 1)}</td>
        <td><span class="bt-spark"><i class="${s.profit < 0 ? 'neg' : ''}" style="width:${Math.abs(s.profit) / wMax * 50}%"></i></span></td>
      </tr>`;
  }).join('')}</tbody></table>`
    : `<div class="tc-empty"><span class="material-symbols-outlined">date_range</span><h4>Brak danych tygodniowych</h4><p>Rozlicz pierwsze kupony.</p></div>`;

  const byMonth = groupBy(settled, b => b.settledDate.slice(0, 7));
  const mKeys = [...byMonth.keys()].sort().reverse().slice(0, 12);
  const mMax = Math.max(...mKeys.map(k => Math.abs(bucketStats(byMonth.get(k)).profit)), 1);
  el('month-table-wrap').innerHTML = mKeys.length ? `<table class="bt-mini-tbl">
    <thead><tr><th>Miesiąc</th><th class="num">Kup.</th><th class="num">Obrót</th><th class="num">P&L</th><th class="num">Yield</th><th class="num">Skut.</th><th>Trend</th></tr></thead>
    <tbody>${mKeys.map(k => {
    const s = bucketStats(byMonth.get(k));
    return `<tr class="${k === today().slice(0, 7) ? 'current' : ''}">
        <td><strong>${monthLabel(k)}</strong></td>
        <td class="num">${s.count}</td>
        <td class="num">${fmtPLN0(s.turnover)}</td>
        <td class="num ${posClass(s.profit)}">${fmtPLN(s.profit, true)}</td>
        <td class="num ${posClass(s.yieldPct || 0)}">${s.yieldPct === null ? '—' : fmtPct(s.yieldPct, true, 1)}</td>
        <td class="num">${s.winRate === null ? '—' : s.winRate.toFixed(0) + '%'}</td>
        <td><span class="bt-spark"><i class="${s.profit < 0 ? 'neg' : ''}" style="width:${Math.abs(s.profit) / mMax * 50}%"></i></span></td>
      </tr>`;
  }).join('')}</tbody></table>`
    : `<div class="tc-empty"><span class="material-symbols-outlined">calendar_month</span><h4>Brak danych miesięcznych</h4><p>Rozlicz pierwsze kupony.</p></div>`;
}

/* ============================================================
   Zakładka: Kupony — formularz
   ============================================================ */
function setEntryMode(mode) {
  entryMode = mode === 'odds' ? 'odds' : 'payout';
  el('entry-mode').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.m === entryMode));
  el('e-payout-box').style.display = entryMode === 'payout' ? '' : 'none';
  el('e-odds-box').style.display = entryMode === 'odds' ? '' : 'none';
  setText('entry-sub', entryMode === 'payout'
    ? 'Wpisz stawkę i wygraną z kuponu — kurs policzy się sam'
    : 'Wpisz stawkę i kurs — wygrana policzy się sama');
  updateEntryCalc();
}
function setEntryConf(c) {
  entryConf = clamp(Math.round(c), 1, 5);
  el('e-conf').querySelectorAll('button').forEach(b => b.classList.toggle('active', Number(b.dataset.c) === entryConf));
}

// Przelicza pola formularza na obiekt kuponu (kurs zawsze wyliczony)
function readEntryForm() {
  const stake = Math.max(numberOr(el('e-stake').value, 0), 0);
  const taxPct = clamp(numberOr(el('e-tax').value, defaultStakeTaxPct()), 0, 100);
  const boost = Math.max(numberOr(el('e-boost').value, 0), 0);

  let odds;
  if (entryMode === 'payout') {
    const payout = Math.max(numberOr(el('e-payout').value, 0), 0);
    odds = stake > 0 && payout > 0 ? oddsFromPayout(payout, stake, taxPct, boost) : null;
  } else {
    odds = numberOr(el('e-odds').value, 0) || null;
  }

  return normalizeBet({
    id: el('e-id').value || undefined,
    date: el('e-date').value || today(),
    title: el('e-title').value,
    bookmaker: el('e-book').value,
    sport: el('e-sport').value,
    league: el('e-league').value,
    market: el('e-market').value,
    pick: el('e-pick').value,
    legCount: Math.max(Math.round(numberOr(el('e-legs').value, 1)), 1),
    stake,
    odds: odds && odds > 0 ? odds : 1,
    boostPct: boost,
    taxPct,
    closingOdds: el('e-closing').value,
    entryMode,
    live: el('e-live').checked,
    freebet: el('e-freebet').checked,
    confidence: entryConf,
    tags: el('e-tags').value.split(',').map(s => s.trim()).filter(Boolean),
    note: el('e-note').value,
    status: 'pending'
  });
}

function updateEntryCalc() {
  const agg = aggregate();
  const draft = readEntryForm();
  const m = betMath(draft);
  const unit = agg.unit;

  const stakeOk = m.stake > 0;
  const payoutIn = Math.max(numberOr(el('e-payout').value, 0), 0);
  const oddsIn = numberOr(el('e-odds').value, 0);
  const ready = stakeOk && (entryMode === 'payout' ? payoutIn > 0 : oddsIn > 1);

  setText('e-stake-hint', stakeOk && unit > 0 ? `${(m.stake / unit).toFixed(2)} unita (1u = ${fmtPLN0(unit)})` : '');
  setText('e-tax-hint', m.taxPct === 0 ? 'Bez podatku' : `Domyślnie ${defaultStakeTaxPct()}%`);

  const perLeg = ready && m.legCount > 1 && m.odds > 1 ? Math.pow(m.odds, 1 / m.legCount) : null;
  const grossWin = ready ? m.grossWin : null;
  const profit = ready ? m.payoutIfWon - m.stake : null;

  el('entry-calc').innerHTML = `
    <div class="bt-calc-cell hero">
      <div class="k">${entryMode === 'payout' ? 'Kurs kuponu' : 'Wygrana total'}</div>
      <div class="v">${ready ? (entryMode === 'payout' ? fmtOdds(m.odds) : fmtPLN(m.payoutIfWon)) : '—'}</div>
      <div class="n">${ready ? (entryMode === 'payout' ? 'wyliczony z wygranej' : 'wyliczona z kursu') : 'uzupełnij pola'}</div>
    </div>
    <div class="bt-calc-cell">
      <div class="k">Kurs efektywny</div>
      <div class="v">${ready && m.stake > 0 ? fmtOdds(m.payoutIfWon / m.stake) : '—'}</div>
      <div class="n">wypłata / stawka brutto</div>
    </div>
    <div class="bt-calc-cell">
      <div class="k">Śr. kurs / zdarzenie</div>
      <div class="v">${perLeg ? fmtOdds(perLeg) : '—'}</div>
      <div class="n">${m.legCount > 1 ? nZdarz(m.legCount) : 'kupon solo'}</div>
    </div>
    <div class="bt-calc-cell">
      <div class="k">Zysk netto</div>
      <div class="v ${profit !== null && profit > 0 ? 'pos' : profit !== null && profit < 0 ? 'neg' : ''}">${profit !== null ? fmtPLN(profit, true) : '—'}</div>
      <div class="n">${ready ? `podatek ${fmtPLN(m.stakeTax)}` : 'po podatku'}</div>
    </div>
    <div class="bt-calc-cell">
      <div class="k">Szansa z kursu</div>
      <div class="v">${ready && m.odds > 1 ? (100 / m.odds).toFixed(1) + '%' : '—'}</div>
      <div class="n">${grossWin !== null && m.boostPct > 0 ? `z boostem +${m.boostPct}%` : 'implikowane prawdop.'}</div>
    </div>`;

  // ostrzeżenia dyscypliny
  const warn = [];
  const maxStake = agg.bankroll * settings.maxStakePct / 100;
  if (ready && m.risked > maxStake && maxStake > 0) warn.push(['bad', 'warning', `Stawka ${fmtPLN(m.stake)} przekracza limit ${settings.maxStakePct}% bankrolla (${fmtPLN(maxStake)}).`]);
  else if (ready && unit > 0 && m.stake > unit * 3) warn.push(['warn', 'warning', `Stawka to ${(m.stake / unit).toFixed(1)} unita — trzymaj płaskie stawki bez mocnego uzasadnienia.`]);
  if (ready && m.odds > settings.maxOdds) warn.push(['warn', 'casino', `Kurs ${fmtOdds(m.odds)} powyżej progu ${fmtOdds(settings.maxOdds)} — wysoka wariancja.`]);
  if (ready && m.legCount > 4) warn.push(['warn', 'link', `${nZdarz(m.legCount)} na kuponie — marża bukmachera kumuluje się na każdym z nich.`]);
  if (ready && m.risked > agg.available && m.risked > 0) warn.push(['bad', 'account_balance', `Stawka przekracza dostępny bankroll (${fmtPLN(agg.available)}).`]);
  if (entryMode === 'payout' && ready && payoutIn <= m.stake) warn.push(['warn', 'error', 'Wygrana nie jest wyższa od stawki — sprawdź, czy nie pomyliłeś pól.']);
  if (agg.todayBets >= settings.maxDailyBets && !el('e-id').value) warn.push(['warn', 'timer', `To byłby ${agg.todayBets + 1}. kupon dzisiaj przy limicie ${settings.maxDailyBets}.`]);

  el('entry-warnings').innerHTML = warn.map(([k, i, t]) =>
    `<div class="bt-alert ${k}"><span class="material-symbols-outlined">${i}</span><span>${t}</span></div>`).join('');
}

function resetEntry() {
  const agg = aggregate();
  el('e-id').value = '';
  el('e-title').value = '';
  el('e-book').value = '';
  el('e-date').value = today();
  el('e-legs').value = 1;
  el('e-stake').value = Math.round(agg.unit * 100) / 100 || '';
  el('e-payout').value = '';
  el('e-odds').value = '';
  el('e-tax').value = defaultStakeTaxPct();
  el('e-boost').value = 0;
  el('e-sport').value = '';
  el('e-league').value = '';
  el('e-market').value = '';
  el('e-pick').value = '';
  el('e-tags').value = '';
  el('e-closing').value = '';
  el('e-note').value = '';
  el('e-live').checked = false;
  el('e-freebet').checked = false;
  setEntryConf(3);
  setText('entry-title', 'Nowy kupon');
  el('entry-save').innerHTML = '<span class="material-symbols-outlined">add</span>Dodaj kupon';
  updateEntryCalc();
}

function editBet(id) {
  const b = state.bets.find(x => x.id === id);
  if (!b) return;
  switchTab('bets');
  el('e-id').value = b.id;
  el('e-title').value = b.title;
  el('e-book').value = b.bookmaker;
  el('e-date').value = b.date;
  el('e-legs').value = b.legCount;
  el('e-stake').value = b.stake;
  el('e-tax').value = b.taxPct;
  el('e-boost').value = b.boostPct;
  el('e-sport').value = b.sport;
  el('e-league').value = b.league;
  el('e-market').value = b.market;
  el('e-pick').value = b.pick;
  el('e-tags').value = b.tags.join(', ');
  el('e-closing').value = b.closingOdds || '';
  el('e-note').value = b.note;
  el('e-live').checked = b.live;
  el('e-freebet').checked = b.freebet;
  setEntryConf(b.confidence);
  setEntryMode(b.entryMode);
  // odtwarzamy dokładnie tę wartość, którą wpisano przy dodawaniu
  if (b.entryMode === 'payout') {
    el('e-payout').value = Math.round(payoutFromOdds(b.odds, b.stake, b.taxPct, b.boostPct) * 100) / 100;
  } else {
    el('e-odds').value = Math.round(b.odds * 1000) / 1000;
  }
  if (b.sport || b.league || b.market || b.pick || b.note || b.tags.length || b.closingOdds) openMore(true);
  setText('entry-title', 'Edytujesz kupon');
  el('entry-save').innerHTML = '<span class="material-symbols-outlined">check</span>Zapisz zmiany';
  updateEntryCalc();
  el('entry-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function saveEntry() {
  const bet = readEntryForm();
  if (!bet.title.trim()) { toast('Podaj nazwę kuponu', 'err'); el('e-title').focus(); return; }
  if (!(bet.stake > 0)) { toast('Podaj stawkę', 'err'); el('e-stake').focus(); return; }
  if (entryMode === 'payout') {
    if (!(numberOr(el('e-payout').value, 0) > 0)) { toast('Podaj wygraną total', 'err'); el('e-payout').focus(); return; }
  } else if (!(numberOr(el('e-odds').value, 0) > 1)) {
    toast('Kurs musi być większy niż 1.00', 'err'); el('e-odds').focus(); return;
  }
  if (!(bet.odds > 1)) { toast('Wyliczony kurs jest nieprawidłowy — sprawdź stawkę, wygraną i podatek', 'err'); return; }

  const existingId = el('e-id').value;
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
  resetEntry();
  renderAll();
  toast(existingId ? 'Kupon zaktualizowany' : 'Kupon dodany', 'ok');
}

function openMore(open) {
  const panel = el('more-panel'), btn = el('more-btn');
  const willOpen = open === undefined ? !panel.classList.contains('open') : open;
  panel.classList.toggle('open', willOpen);
  btn.classList.toggle('open', willOpen);
  btn.lastChild.textContent = willOpen ? 'Ukryj szczegóły' : 'Więcej szczegółów (opcjonalnie)';
}

function goToEntry() {
  switchTab('bets');
  el('e-title').focus();
  el('entry-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ============================================================
   Zakładka: Kupony — lista
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
    if (from && (b.settledDate || b.date) < from) return false;
    if (q) {
      const hay = [b.title, b.pick, b.market, b.league, b.bookmaker, b.sport, b.note, b.tags.join(' ')].join(' ').toLowerCase();
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
  if (grouping === 'day') return new Date(key + 'T00:00:00').toLocaleDateString('pl-PL', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  if (grouping === 'week') return `Tydzień ${key.split('-W')[1]} · ${key.split('-W')[0]}`;
  return monthLabel(key);
}

function renderBetsSummary(list) {
  const settled = list.filter(b => b.settled);
  const pending = list.filter(b => !b.settled);
  const s = bucketStats(settled);
  el('bets-summary').innerHTML = [
    ['Kupony', String(list.length), `${pending.length} w grze`, ''],
    ['Obrót', fmtPLN0(s.turnover), settled.length ? `śr. stawka ${fmtPLN0(settled.reduce((a, b) => a + b.stake, 0) / settled.length)}` : '—', ''],
    ['Zysk / strata', fmtPLN(s.profit, true), `${s.wins} W / ${s.losses} P`, posClass(s.profit)],
    ['Yield', s.yieldPct === null ? '—' : fmtPct(s.yieldPct), 'zysk / obrót', posClass(s.yieldPct || 0)],
    ['Skuteczność', s.winRate === null ? '—' : s.winRate.toFixed(1) + '%', 'trafione / rozstrzygnięte', ''],
    ['Ekspozycja', fmtPLN0(pending.reduce((a, b) => a + b.risked, 0)), 'zablokowane w grze', '']
  ].map(([k, v, n, cls]) => `<div class="bt-acct-cell"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="n">${n}</div></div>`).join('');
}

function betRow(b, agg) {
  const unit = agg.unit;
  const clv = b.closingOdds ? (b.odds / b.closingOdds - 1) * 100 : null;
  return `
    <tr class="${b.settled ? '' : 'pending-row'}">
      <td class="nowrap"><button class="expand-btn ${expandedBets.has(b.id) ? 'open' : ''}" onclick="toggleBet('${b.id}')"><span class="material-symbols-outlined">chevron_right</span></button></td>
      <td class="nowrap">${esc(b.settled ? b.settledDate : b.date)}</td>
      <td>${betEventCell(b)}</td>
      <td>${hitsCell(b)}</td>
      <td class="num"><span class="bt-odds">${fmtOdds(b.odds)}</span>${clv !== null ? `<br><span class="muted" style="font-size:10px">CLV ${fmtPct(clv, true, 1)}</span>` : ''}</td>
      <td class="num">${fmtPLN(b.stake)}${unit > 0 ? `<br><span class="muted" style="font-size:10.5px">${(b.stake / unit).toFixed(2)}u</span>` : ''}</td>
      <td><span class="bt-tag ${b.status}">${STATUS_LABEL[b.status]}</span></td>
      <td class="num">${b.settled ? fmtPLN(b.returned) : `<span class="muted">${fmtPLN(b.payoutIfWon)}</span>`}</td>
      <td class="num ${b.settled ? posClass(b.profit) : 'muted'}">${b.settled ? fmtPLN(b.profit, true) : fmtPLN(b.potentialProfit, true)}</td>
      <td>
        <div class="row-actions">
          <button class="row-btn" title="${b.settled ? 'Zmień rozliczenie' : 'Rozlicz'}" onclick="openSettleModal('${b.id}')"><span class="material-symbols-outlined">task_alt</span></button>
          <button class="row-btn" title="Edytuj" onclick="editBet('${b.id}')"><span class="material-symbols-outlined">edit</span></button>
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
    ['Zdarzenia', String(b.legCount)],
    ['Trafione', hitsOf(b) === null ? '—' : `${hitsOf(b)} / ${b.legCount}`],
    ['Kurs', fmtOdds(b.odds)],
    ['Śr. kurs / zdarzenie', b.legCount > 1 ? fmtOdds(Math.pow(b.odds, 1 / b.legCount)) : '—'],
    ['Kurs efektywny', b.stake > 0 ? fmtOdds(b.payoutIfWon / b.stake) : '—'],
    ['Kurs zamknięcia', b.closingOdds ? fmtOdds(b.closingOdds) : '—'],
    ['CLV', clv === null ? '—' : fmtPct(clv, true, 1)],
    ['Stawka', fmtPLN(b.stake)],
    ['Podatek od stawki', `${fmtPLN(b.stakeTax)} (${b.taxPct}%)`],
    ['Stawka netto', fmtPLN(b.netStake)],
    ['Boost', b.boostPct > 0 ? `+${b.boostPct}%` : '—'],
    ['Wygrana total', fmtPLN(b.payoutIfWon)],
    ['Zwrot', b.settled ? fmtPLN(b.returned) : '—'],
    ['Wynik', b.settled ? fmtPLN(b.profit, true) : '—'],
    ['Pewność', `${b.confidence} / 5`]
  ];
  return `<tr class="bt-detail-row"><td colspan="10">
    <div class="bt-detail-title">Szczegóły kuponu</div>
    <div class="bt-kv">${kv.map(([k, v]) => `<div class="kv"><span class="k">${k}</span><span class="v ${k === 'Wynik' ? posClass(b.profit) : ''}">${esc(String(v))}</span></div>`).join('')}</div>
    ${b.pick ? `<div class="bt-note"><strong>Typ:</strong> ${esc(b.pick)}</div>` : ''}
    ${b.note ? `<div class="bt-note">${esc(b.note)}</div>` : ''}
  </td></tr>`;
}

function betsTable(list, agg) {
  return `<div class="tc-tbl-wrap"><table class="tc-tbl">
    <thead><tr>
      <th style="width:34px"></th><th>Data</th><th>Kupon</th><th>Trafienia</th><th class="num">Kurs</th>
      <th class="num">Stawka</th><th>Status</th><th class="num">Zwrot</th><th class="num">P&L</th><th style="width:100px"></th>
    </tr></thead>
    <tbody>${list.map(b => betRow(b, agg)).join('')}</tbody></table></div>`;
}

function renderBetsTab(agg) {
  const list = filteredBets(agg);
  renderBetsSummary(list);

  const pending = list.filter(b => !b.settled).sort((a, b) => (a.date < b.date ? 1 : -1));
  const settled = list.filter(b => b.settled);

  el('pending-section').innerHTML = pending.length
    ? `<div class="bt-group-head" style="cursor:default">
         <div class="left"><strong>W grze</strong><span class="meta">${nKupon(pending.length)} · ekspozycja ${fmtPLN0(pending.reduce((s, b) => s + b.risked, 0))}</span></div>
       </div>${betsTable(pending, agg)}`
    : '';

  if (!settled.length) {
    el('settled-section').innerHTML = `<div class="tc-empty" style="border-top:1px solid var(--tc-line)">
      <span class="material-symbols-outlined">filter_alt_off</span>
      <h4>Brak rozliczonych kuponów</h4>
      <p>Zmień filtry albo rozlicz kupony, które są w grze.</p>
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
          <span class="mono ${posClass(s.profit)}" style="font-weight:700">${fmtPLN(s.profit, true)}</span>
          <span class="mono muted" style="font-size:11.5px">${s.yieldPct === null ? '—' : fmtPct(s.yieldPct, true, 1)}</span>
        </div>
      </div>
      ${open ? `<div class="bt-group-body">${betsTable(bets, agg)}</div>` : ''}
    </div>`;
  }).join('')}</div>`;
}

function toggleBet(id) { expandedBets.has(id) ? expandedBets.delete(id) : expandedBets.add(id); renderBetsTab(aggregate()); }
function toggleGroup(k) { expandedGroups.has(k) ? expandedGroups.delete(k) : expandedGroups.add(k); renderBetsTab(aggregate()); }

function deleteBet(id) {
  if (!confirm('Usunąć ten kupon? Operacji nie da się cofnąć.')) return;
  state.bets = state.bets.filter(b => b.id !== id);
  expandedBets.delete(id);
  if (el('e-id').value === id) resetEntry();
  saveState();
  renderAll();
  toast('Kupon usunięty');
}

/* ============================================================
   Rozliczanie kuponu
   ============================================================ */
function computeSettlePayout(bet, result) {
  return betMath({ ...bet, status: result, payoutOverride: null }).returned;
}

function openSettleModal(id) {
  const bet = state.bets.find(b => b.id === id);
  if (!bet) return;
  const m = betMath(bet);
  el('st-id').value = id;
  el('st-date').value = bet.settledAt || today();
  settleResult = bet.status === 'pending' ? 'won' : bet.status;
  settleHits = bet.hitLegs;
  settlePayoutTouched = false;

  el('st-info').innerHTML = slipRows([
    ['Kupon', esc(bet.title || 'Bez nazwy')],
    ['Bukmacher / data', `${esc(bet.bookmaker || '—')} · ${bet.date}`],
    ['Zdarzenia', String(m.legCount)],
    ['Stawka × kurs', `${fmtPLN(m.stake)} × ${fmtOdds(m.odds)}`],
    ['Wygrana przy trafieniu', fmtPLN(m.payoutIfWon), '', 'total']
  ]);

  setSettleResult(settleResult, true);
  if (bet.payoutOverride !== null && Number.isFinite(bet.payoutOverride)) {
    el('st-payout').value = bet.payoutOverride;
    updateSettlePreview();
  }
  el('settle-modal').classList.add('on');
}
function closeSettleModal() { el('settle-modal').classList.remove('on'); }

// Ile zdarzeń mogło wejść przy danym wyniku — przy przegranej
// komplet jest z definicji niemożliwy.
function maxHitsFor(bet, result) {
  return (result === 'lost' || result === 'half_lost') ? bet.legCount - 1 : bet.legCount;
}

function renderHitPicker(bet) {
  const box = el('st-hits-box');
  if (bet.legCount <= 1 || settleResult === 'won' || settleResult === 'half_won') {
    box.style.display = 'none';
    return;
  }
  box.style.display = '';
  const max = maxHitsFor(bet, settleResult);
  if (settleHits !== null && settleHits > max) settleHits = max;

  const buttons = Array.from({ length: max + 1 }, (_, i) =>
    `<button type="button" data-h="${i}" class="${i === 0 ? 'zero ' : ''}${settleHits === i ? 'active' : ''}">${i}</button>`).join('');
  el('st-hits').innerHTML = buttons +
    `<button type="button" data-h="" class="${settleHits === null ? 'active' : ''}" title="Nie pamiętam / nie podaję">—</button>`;
  el('st-hits').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    settleHits = b.dataset.h === '' ? null : Number(b.dataset.h);
    renderHitPicker(bet);
  }));

  const miss = settleHits === null ? null : bet.legCount - settleHits;
  el('st-hits-note').innerHTML = settleHits === null
    ? `Ile z ${nZdarz(bet.legCount)} weszło? Dzięki temu na liście odróżnisz pecha od słabego kuponu.`
    : miss === 1
      ? `Zabrakło jednego zdarzenia — kupon trafi na listę jako <strong>pech</strong>.`
      : miss === 0
        ? `Komplet trafiony.`
        : `Nie weszło ${nZdarz(miss)} — to raczej słaby kupon niż pech.`;
}

function setSettleResult(r, force) {
  settleResult = r;
  el('st-result').querySelectorAll('.bt-result-btn').forEach(b => b.classList.toggle('active', b.dataset.r === r));
  const bet = state.bets.find(b => b.id === el('st-id').value);
  if (!bet) return;
  renderHitPicker(bet);
  if (force || !settlePayoutTouched) {
    // cashout nie ma wzoru — proponujemy 60% pełnej wypłaty jako punkt startowy
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
  const bet = state.bets[idx];
  const hits = (bet.legCount > 1 && settleResult !== 'won' && settleResult !== 'half_won' && settleHits !== null)
    ? clamp(settleHits, 0, maxHitsFor(bet, settleResult))
    : null;
  state.bets[idx] = {
    ...bet,
    status: settleResult,
    settledAt: el('st-date').value || today(),
    hitLegs: hits,
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
   Rozliczenia (księgowość)
   ============================================================ */
const LEDGER_LABEL = { deposit: 'Wpłata', withdraw: 'Wypłata', bonus: 'Bonus', adjust: 'Korekta' };

function renderLedger(agg) {
  const sum = t => agg.ledger.filter(e => e.type === t).reduce((s, e) => s + e.amount, 0);
  const deposits = sum('deposit'), withdrawals = sum('withdraw'), bonuses = sum('bonus'), adjust = sum('adjust');

  el('acct-grid').innerHTML = [
    ['Bankroll startowy', fmtPLN(settings.bankrollStart), 'kapitał wyjściowy', ''],
    ['Wpłaty', fmtPLN(deposits), `${agg.ledger.filter(e => e.type === 'deposit').length} operacji`, ''],
    ['Wypłaty', fmtPLN(withdrawals), `${agg.ledger.filter(e => e.type === 'withdraw').length} operacji`, ''],
    ['Bonusy / korekty', fmtPLN(bonuses + adjust), 'freebety, cashbacki', ''],
    ['Wynik zakładów', fmtPLN(agg.realizedPnl, true), `${nKupon(agg.settled.length)} rozliczonych`, posClass(agg.realizedPnl)],
    ['Bankroll bieżący', fmtPLN(agg.bankroll), `dostępne ${fmtPLN(agg.available)}`, ''],
    ['Zablokowane', fmtPLN(agg.openExposure), `${nKupon(agg.pending.length)} w grze`, ''],
    ['Podatek zapłacony', fmtPLN(agg.taxTotal), 'wg ustawień modułu', '']
  ].map(([k, v, n, cls]) => `<div class="bt-acct-cell"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="n">${n}</div></div>`).join('');

  const roiOnCapital = agg.cashBase > 0 ? (agg.realizedPnl / agg.cashBase) * 100 : null;
  el('acct-recon').innerHTML = `<div class="bt-alert">
    <span class="material-symbols-outlined">calculate</span>
    <span><strong>Bilans:</strong> ${fmtPLN(settings.bankrollStart)} (start)
      ${agg.ledgerNet >= 0 ? '+' : '−'} ${fmtPLN(Math.abs(agg.ledgerNet))} (przepływy)
      ${agg.realizedPnl >= 0 ? '+' : '−'} ${fmtPLN(Math.abs(agg.realizedPnl))} (wynik)
      = <strong>${fmtPLN(agg.bankroll)}</strong>.
      Zwrot na zaangażowanym kapitale: <strong>${roiOnCapital === null ? '—' : fmtPct(roiOnCapital)}</strong>,
      yield na obrocie: <strong>${agg.yieldPct === null ? '—' : fmtPct(agg.yieldPct)}</strong>.</span>
  </div>`;

  const wrap = el('ledger-wrap');
  if (!agg.ledger.length) {
    wrap.innerHTML = `<div class="tc-empty"><span class="material-symbols-outlined">account_balance_wallet</span><h4>Brak operacji kasowych</h4><p>Zaksięguj wpłaty i wypłaty, aby bankroll zgadzał się z rzeczywistością.</p></div>`;
  } else {
    wrap.innerHTML = `<table class="tc-tbl">
      <thead><tr><th>Data</th><th>Typ</th><th>Opis</th><th class="num">Kwota</th><th style="width:50px"></th></tr></thead>
      <tbody>${[...agg.ledger].reverse().map(e => {
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

  const books = [...new Set(agg.all.map(b => b.bookmaker).filter(Boolean))];
  const bookWrap = el('book-balance-wrap');
  if (!books.length) {
    bookWrap.innerHTML = `<div class="tc-empty"><span class="material-symbols-outlined">storefront</span><h4>Brak bukmacherów</h4><p>Uzupełnij pole „Bukmacher” w kuponach.</p></div>`;
  } else {
    const rows = books.map(bk => {
      const open = agg.pending.filter(b => b.bookmaker === bk);
      return { bk, ...bucketStats(agg.settled.filter(b => b.bookmaker === bk)), open: open.length, exposure: open.reduce((a, b) => a + b.risked, 0) };
    }).sort((a, b) => b.profit - a.profit);
    bookWrap.innerHTML = `<table class="tc-tbl">
      <thead><tr><th>Bukmacher</th><th class="num">Kupony</th><th class="num">Obrót</th><th class="num">P&L</th><th class="num">Yield</th><th class="num">W grze</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td><span class="ticker">${esc(r.bk)}</span></td>
        <td class="num">${r.count}</td>
        <td class="num">${fmtPLN0(r.turnover)}</td>
        <td class="num ${posClass(r.profit)}">${fmtPLN(r.profit, true)}</td>
        <td class="num ${posClass(r.yieldPct || 0)}">${r.yieldPct === null ? '—' : fmtPct(r.yieldPct, true, 1)}</td>
        <td class="num">${r.open ? `${r.open} · ${fmtPLN0(r.exposure)}` : '—'}</td>
      </tr>`).join('')}</tbody></table>`;
  }

  const stakeTaxTotal = agg.settled.reduce((s, b) => s + b.stakeTaxPaid, 0);
  const winTaxTotal = agg.settled.reduce((s, b) => s + b.winTaxPaid, 0);
  const grossWins = agg.settled.filter(b => b.profit > 0).reduce((s, b) => s + b.returned, 0);
  const taxable = agg.settled.filter(b => b.winTaxPaid > 0).length;
  el('tax-wrap').innerHTML = `<table class="tc-tbl">
    <thead><tr><th>Pozycja</th><th class="num">Wartość</th><th>Uwagi</th></tr></thead>
    <tbody>
      <tr><td>Model podatkowy</td><td class="num">${{ stake: 'Od stawki', win: 'Od wygranej', both: 'Od stawki i wygranej', none: 'Bez podatku' }[settings.taxMode]}</td><td class="muted">ustawienia modułu</td></tr>
      <tr><td>Obrót (podstawa)</td><td class="num">${fmtPLN(agg.turnover)}</td><td class="muted">suma stawek rozliczonych</td></tr>
      <tr><td>Podatek od stawki</td><td class="num">${fmtPLN(stakeTaxTotal)}</td><td class="muted">pobierany przy zawarciu zakładu</td></tr>
      <tr><td>Wypłaty brutto</td><td class="num">${fmtPLN(grossWins)}</td><td class="muted">kupony na plusie</td></tr>
      <tr><td>Podatek od wygranych (${settings.winTaxPct}%)</td><td class="num">${fmtPLN(winTaxTotal)}</td><td class="muted">${nKupon(taxable)} powyżej ${fmtPLN0(settings.winTaxFreeLimit)}</td></tr>
      <tr><td><strong>Podatek łącznie</strong></td><td class="num"><strong>${fmtPLN(stakeTaxTotal + winTaxTotal)}</strong></td><td class="muted">${agg.turnover > 0 ? ((stakeTaxTotal + winTaxTotal) / agg.turnover * 100).toFixed(1) + '% obrotu' : '—'}</td></tr>
      <tr><td>Wynik przed podatkiem</td><td class="num ${posClass(agg.realizedPnl + stakeTaxTotal + winTaxTotal)}">${fmtPLN(agg.realizedPnl + stakeTaxTotal + winTaxTotal, true)}</td><td class="muted">gdyby podatku nie było</td></tr>
    </tbody></table>`;

  const byMonth = groupBy(agg.settled, b => b.settledDate.slice(0, 7));
  const mKeys = [...byMonth.keys()].sort();
  const monthWrap = el('acct-month-wrap');
  if (!mKeys.length) {
    monthWrap.innerHTML = `<div class="tc-empty"><span class="material-symbols-outlined">receipt</span><h4>Brak księgi</h4><p>Pojawi się po pierwszych rozliczeniach.</p></div>`;
  } else {
    let cum = 0;
    const rows = mKeys.map(k => {
      const bets = byMonth.get(k);
      const s = bucketStats(bets);
      cum += s.profit;
      return {
        k, s,
        tax: bets.reduce((a, b) => a + b.taxPaid, 0),
        flows: agg.ledger.filter(e => e.date.startsWith(k)).reduce((a, e) => a + (e.type === 'withdraw' ? -e.amount : e.amount), 0),
        cum
      };
    }).reverse();
    monthWrap.innerHTML = `<table class="tc-tbl">
      <thead><tr><th>Miesiąc</th><th class="num">Kupony</th><th class="num">Obrót</th><th class="num">Podatek</th><th class="num">Przepływy</th><th class="num">Wynik</th><th class="num">Yield</th><th class="num">Narastająco</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
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
   Kalkulator wartości (modal)
   ============================================================ */
function openCalc() {
  const agg = aggregate();
  if (!el('c-bank').dataset.touched) el('c-bank').value = Math.round(agg.bankroll);
  if (!el('c-tax').dataset.touched) el('c-tax').value = defaultStakeTaxPct();
  if (!el('c-max').dataset.touched) el('c-max').value = settings.maxStakePct;
  renderCalc();
  el('calc-modal').classList.add('on');
}
function closeCalc() { el('calc-modal').classList.remove('on'); }

function renderCalc() {
  const odds = numberOr(el('c-odds').value, 0);
  const prob = clamp(numberOr(el('c-prob').value, 0), 0, 100) / 100;
  const kf = clamp(numberOr(el('c-kelly').value, 0.25), 0, 1);
  const bank = Math.max(numberOr(el('c-bank').value, 0), 0);
  const taxRate = Math.max(numberOr(el('c-tax').value, 0), 0) / 100;
  const maxPct = Math.max(numberOr(el('c-max').value, 5), 0);
  const v = el('calc-verdict');

  if (odds <= 1 || prob <= 0) {
    el('calc-out').innerHTML = slipRows([['Uzupełnij kurs i prawdopodobieństwo', '—']]);
    v.className = 'bt-alert';
    v.textContent = 'Uzupełnij dane, aby zobaczyć ocenę wartości.';
    return;
  }

  const netOdds = odds * (1 - taxRate);
  const ev = prob * (netOdds - 1) - (1 - prob);
  const edge = (prob * netOdds - 1) * 100;
  const kelly = netOdds > 1 ? (prob * (netOdds - 1) - (1 - prob)) / (netOdds - 1) : 0;
  const kellyFrac = Math.max(kelly, 0) * kf;
  const capped = Math.min(bank * kellyFrac, bank * maxPct / 100);

  el('calc-out').innerHTML = slipRows([
    ['Kurs nominalny', fmtOdds(odds)],
    ['Kurs po podatku', fmtOdds(netOdds), 'warn'],
    ['Prawdopodobieństwo z kursu', (100 / odds).toFixed(1) + '%'],
    ['Twoje prawdopodobieństwo', (prob * 100).toFixed(1) + '%'],
    ['Przewaga (edge)', fmtPct(edge), edge > 0 ? 'pos' : 'neg'],
    ['EV na 1 zł stawki', fmtPLN(ev, true), ev > 0 ? 'pos' : 'neg'],
    [`Kelly ×${kf}`, (kellyFrac * 100).toFixed(2) + '% bankrolla'],
    ['Sugerowana stawka', bank > 0 ? fmtPLN(capped) : 'podaj bankroll', '', 'total']
  ]);

  if (edge > 5) { v.className = 'bt-alert good'; v.innerHTML = `<span class="material-symbols-outlined">check_circle</span><span>Wyraźna wartość — kurs jest zawyżony względem Twojej oceny (edge ${fmtPct(edge)}).</span>`; }
  else if (edge > 0) { v.className = 'bt-alert warn'; v.innerHTML = `<span class="material-symbols-outlined">warning</span><span>Minimalna przewaga (${fmtPct(edge)}). Przy takiej marży wynik zdominuje wariancja.</span>`; }
  else { v.className = 'bt-alert bad'; v.innerHTML = `<span class="material-symbols-outlined">block</span><span>Brak wartości — po podatku ten kurs jest poniżej Twojej oceny (${fmtPct(edge)}). Odpuść.</span>`; }
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
  for (const id of ['c-tax', 'c-max', 'c-bank']) { const n = el(id); if (n) delete n.dataset.touched; }
  if (!el('e-id').value) el('e-tax').value = defaultStakeTaxPct();
  renderAll();
  toast('Ustawienia zapisane', 'ok');
}

function clearAllBets() {
  if (!confirm('Usunąć WSZYSTKIE kupony i operacje kasowe? Zrób najpierw backup JSON.')) return;
  state = { bets: [], ledger: [] };
  expandedBets.clear(); expandedGroups.clear();
  saveState();
  closeSettings();
  resetEntry();
  renderAll();
  toast('Dane wyczyszczone');
}

function exportJSON() {
  const blob = new Blob([JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), settings, state }, null, 2)], { type: 'application/json' });
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
      if (!confirm(`Zaimportować ${nKupon(data.state.bets.length)}? Obecne dane zostaną nadpisane.`)) return;
      if (data.settings) settings = { ...DEFAULT_SETTINGS, ...data.settings };
      state = { bets: data.state.bets.map(normalizeBet), ledger: (data.state.ledger || []).map(normalizeLedger) };
      saveState(); saveSettingsStorage();
      closeSettings();
      renderAll();
      toast('Dane zaimportowane', 'ok');
    } catch { toast('Nieprawidłowy plik JSON', 'err'); }
  };
  reader.readAsText(file);
}

function exportCSV() {
  const rows = [['Data', 'Rozliczono', 'Kupon', 'Bukmacher', 'Dyscyplina', 'Rozgrywki', 'Rynek', 'Typ',
    'Zdarzenia', 'Trafione', 'Stawka', 'Kurs', 'Podatek %', 'Boost %', 'Wygrana', 'Kurs zamkniecia',
    'Status', 'Zwrot', 'Zysk', 'Podatek', 'Pewnosc', 'Live', 'Freebet', 'Tagi', 'Notatka']];
  for (const b of aggregate().all) {
    rows.push([b.date, b.settledDate || '', b.title, b.bookmaker, b.sport, b.league, b.market, b.pick,
    b.legCount, hitsOf(b) === null ? '' : hitsOf(b), b.stake.toFixed(2), b.odds.toFixed(4), b.taxPct, b.boostPct, b.payoutIfWon.toFixed(2),
    b.closingOdds ? b.closingOdds.toFixed(2) : '', STATUS_LABEL[b.status],
    b.settled ? b.returned.toFixed(2) : '', b.settled ? b.profit.toFixed(2) : '',
    b.settled ? b.taxPaid.toFixed(2) : '', b.confidence, b.live ? 'tak' : 'nie', b.freebet ? 'tak' : 'nie',
    b.tags.join(' '), b.note]);
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
  const t = document.createElement('div');
  t.className = 'tc-toast ' + kind;
  t.textContent = msg;
  el('toasts').appendChild(t);
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
  fillDatalist('dl-titles', bets.map(b => b.title));
  fillDatalist('dl-picks', bets.map(b => b.pick));
  fillDatalist('dl-tags', [...SUGGEST.tags, ...bets.flatMap(b => b.tags)]);

  const books = [...new Set(bets.map(b => b.bookmaker).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl'));
  el('f-book').innerHTML = `<option value="">Bukmacher: wszyscy</option>` +
    books.map(b => `<option value="${esc(b)}"${betFilters.book === b ? ' selected' : ''}>${esc(b)}</option>`).join('');
}

/* ============================================================
   Render główny
   ============================================================ */
function renderAll() {
  const agg = aggregate();
  refreshDatalists(agg);
  renderHero(agg);
  renderKpis(agg);
  renderDiscipline(agg);
  renderBankrollChart(agg);
  renderOpenBets(agg);
  renderCalendar(agg);
  renderCharts(agg);
  renderHitsCard(agg);
  renderRankList('sport-perf-wrap', groupBy(agg.settled, b => b.sport || 'Bez dyscypliny'), 'Uzupełnij dyscyplinę w szczegółach kuponu.');
  renderRankList('book-perf-wrap', groupBy(agg.settled, b => b.bookmaker || 'Bez nazwy'), 'Uzupełnij bukmachera w kuponach.');
  const tagMap = new Map();
  for (const b of agg.settled) for (const t of (b.tags.length ? b.tags : ['bez tagu'])) {
    if (!tagMap.has(t)) tagMap.set(t, []);
    tagMap.get(t).push(b);
  }
  renderRankList('tag-perf-wrap', tagMap, 'Taguj kupony strategiami, aby porównać ich skuteczność.');
  renderRecent(agg);
  renderBetsTab(agg);
  renderLedger(agg);
  updateEntryCalc();
}

/* ============================================================
   Init
   ============================================================ */
function init() {
  loadState();

  document.querySelectorAll('.trade-tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  document.querySelectorAll('.sidebar__link[data-page]').forEach(l => {
    if (l.dataset.page === 'betting') l.classList.add('sidebar__link--active');
  });

  el('new-bet-btn').addEventListener('click', goToEntry);
  el('settings-btn').addEventListener('click', openSettings);
  el('calc-btn').addEventListener('click', openCalc);
  el('export-btn').addEventListener('click', exportCSV);
  el('import-file').addEventListener('change', e => { if (e.target.files[0]) importJSON(e.target.files[0]); e.target.value = ''; });

  el('eq-range').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    eqRange = b.dataset.range;
    el('eq-range').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    renderBankrollChart(aggregate());
  }));

  // formularz kuponu
  el('entry-mode').querySelectorAll('button').forEach(b => b.addEventListener('click', () => setEntryMode(b.dataset.m)));
  el('e-conf').querySelectorAll('button').forEach(b => b.addEventListener('click', () => setEntryConf(Number(b.dataset.c))));
  ['e-stake', 'e-payout', 'e-odds', 'e-tax', 'e-boost', 'e-legs'].forEach(id => el(id).addEventListener('input', updateEntryCalc));
  el('e-freebet').addEventListener('change', updateEntryCalc);
  el('more-btn').addEventListener('click', () => openMore());
  el('entry-save').addEventListener('click', saveEntry);
  el('entry-reset').addEventListener('click', () => { resetEntry(); toast('Formularz wyczyszczony'); });
  el('entry-form').addEventListener('submit', e => { e.preventDefault(); saveEntry(); });
  el('entry-form').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); saveEntry(); }
  });

  // filtry
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
  el('f-period').addEventListener('change', e => { betFilters.period = e.target.value; renderBetsTab(aggregate()); });

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

  // rozliczanie
  el('st-result').querySelectorAll('.bt-result-btn').forEach(b => b.addEventListener('click', () => { settlePayoutTouched = false; setSettleResult(b.dataset.r, true); }));
  el('st-payout').addEventListener('input', () => { settlePayoutTouched = true; updateSettlePreview(); });
  el('st-date').addEventListener('change', updateSettlePreview);

  // kalkulator
  ['c-odds', 'c-prob', 'c-kelly', 'c-bank', 'c-tax', 'c-max'].forEach(id =>
    el(id).addEventListener('input', e => { e.target.dataset.touched = '1'; renderCalc(); }));

  document.querySelectorAll('.tc-modal-ov').forEach(ov => ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('on'); }));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.tc-modal-ov.on').forEach(m => m.classList.remove('on'));
    if (e.key === 'n' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); goToEntry(); }
  });

  resetEntry();
  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
