/* ============================================================
   TRADING — analytical dashboard logic
   Uses existing localStorage keys: lifeos_trading_v2 and
   lifeos_trading_settings_v1 so user's data carries over.
   ============================================================ */

const TRADE_KEY = 'lifeos_trading_v2';
const SETTINGS_KEY = 'lifeos_trading_settings_v1';

const DEFAULT_SETTINGS = {
  capital: 10000,
  maxRiskPct: 1,
  minRR: 2,
  maxDailyLoss: 3,
  maxDailyGain: 10
};

let settings = { ...DEFAULT_SETTINGS };
let state = { trades: [] };
let planDir = 'long';
let modalDir = 'long';
let eqRange = '90';
let tradeFilters = { status: 'all', dir: 'all', q: '' };
let expandedRows = new Set();
let charts = {};

// ---------- Utilities ----------
function numberOr(v, f = 0) { const n = Number(v); return Number.isFinite(n) ? n : f; }
function numberNullable(v) { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function positiveOr(v, f) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : f; }
function clamp(v, a, b) { return Math.min(Math.max(v, a), b); }
function today() { return new Date().toISOString().slice(0, 10); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtUSD(v, sign = false) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  v = Number(v);
  const abs = Math.abs(v);
  const s = abs >= 1000 ? abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : abs.toFixed(2);
  return (v < 0 ? '-' : (sign && v > 0 ? '+' : '')) + '$' + s;
}
function fmtPct(v, sign = true, dp = 2) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  v = Number(v);
  return (sign && v > 0 ? '+' : '') + v.toFixed(dp) + '%';
}
function fmtR(v, sign = true, dp = 2) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  v = Number(v);
  return (sign && v > 0 ? '+' : '') + v.toFixed(dp) + 'R';
}
function fmtNum(v, dp = 2) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function fmtQty(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  v = Number(v);
  if (Math.abs(v) >= 1000) return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (Math.abs(v) >= 1) return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}
function posClass(v) { return v > 0 ? 'pos' : v < 0 ? 'neg' : ''; }

// ---------- Data ----------
function normalizeTrade(t) {
  return {
    id: t.id || ('tr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
    ticker: String(t.ticker || '').toUpperCase(),
    direction: t.direction === 'short' ? 'short' : 'long',
    leverage: positiveOr(t.leverage, 1),
    entry: numberOr(t.entry, 0),
    sl: numberNullable(t.sl),
    tp: numberNullable(t.tp),
    size: Math.max(numberOr(t.size, 0), 0),
    date: t.date || today(),
    note: t.note || '',
    closings: Array.isArray(t.closings) ? t.closings.map(c => ({
      date: c.date || today(),
      price: numberOr(c.price, 0),
      pct: Math.max(numberOr(c.pct, 0), 0),
      commission: Math.max(numberOr(c.commission, 0), 0)
    })) : []
  };
}

function loadState() {
  try { const raw = localStorage.getItem(TRADE_KEY); if (raw) state = JSON.parse(raw); } catch { state = { trades: [] }; }
  if (!state || !Array.isArray(state.trades)) state = { trades: [] };
  state.trades = state.trades.map(normalizeTrade);
  try { const r = localStorage.getItem(SETTINGS_KEY); if (r) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(r) }; } catch { settings = { ...DEFAULT_SETTINGS }; }
  settings = {
    capital: positiveOr(settings.capital, DEFAULT_SETTINGS.capital),
    maxRiskPct: positiveOr(settings.maxRiskPct, DEFAULT_SETTINGS.maxRiskPct),
    minRR: positiveOr(settings.minRR, DEFAULT_SETTINGS.minRR),
    maxDailyLoss: positiveOr(settings.maxDailyLoss, DEFAULT_SETTINGS.maxDailyLoss),
    maxDailyGain: positiveOr(settings.maxDailyGain, DEFAULT_SETTINGS.maxDailyGain),
  };
}
function saveState() { localStorage.setItem(TRADE_KEY, JSON.stringify(state)); }
function saveSettingsStorage() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }

// ---------- Trade math ----------
function tradeMetrics(t) {
  t = normalizeTrade(t);
  let realized = 0, commission = 0, closedPct = 0, weightedExit = 0;
  for (const c of t.closings) {
    const p = clamp(numberOr(c.pct), 0, 100);
    const sz = t.size * (p / 100);
    const gross = t.direction === 'long' ? (c.price - t.entry) * sz : (t.entry - c.price) * sz;
    realized += gross - numberOr(c.commission, 0);
    commission += numberOr(c.commission, 0);
    closedPct += p;
    weightedExit += c.price * p;
  }
  closedPct = clamp(closedPct, 0, 100);
  const avgExit = closedPct > 0 ? weightedExit / closedPct : null;
  const remainingPct = Math.max(0, 100 - closedPct);
  const remainingSize = t.size * (remainingPct / 100);
  const riskPerUnit = t.sl !== null ? Math.abs(t.entry - t.sl) : null;
  const rewardPerUnit = t.tp !== null ? Math.abs(t.tp - t.entry) : null;
  const initialRiskUSD = riskPerUnit !== null ? riskPerUnit * t.size : null;
  const initialRewardUSD = rewardPerUnit !== null ? rewardPerUnit * t.size : null;
  const openRiskUSD = riskPerUnit !== null ? riskPerUnit * remainingSize : null;
  const openRewardUSD = rewardPerUnit !== null ? rewardPerUnit * remainingSize : null;
  const realizedR = initialRiskUSD && initialRiskUSD > 0 ? realized / initialRiskUSD : null;
  const plannedRR = (riskPerUnit && rewardPerUnit && riskPerUnit > 0) ? rewardPerUnit / riskPerUnit : null;
  const notional = t.entry * remainingSize;
  const margin = t.leverage > 0 ? notional / t.leverage : notional;
  return {
    realized, commission, closedPct, remainingPct, remainingSize, avgExit,
    riskPerUnit, rewardPerUnit, initialRiskUSD, initialRewardUSD,
    openRiskUSD, openRewardUSD, realizedR, plannedRR, notional, margin,
    isClosed: closedPct >= 100
  };
}

function getClosingEvents(trades) {
  const events = [];
  for (const t of trades) {
    const tm = tradeMetrics(t);
    for (const c of t.closings || []) {
      const p = clamp(numberOr(c.pct), 0, 100);
      const sz = t.size * (p / 100);
      const gross = t.direction === 'long' ? (c.price - t.entry) * sz : (t.entry - c.price) * sz;
      const net = gross - numberOr(c.commission, 0);
      const allocRisk = tm.initialRiskUSD !== null ? tm.initialRiskUSD * (p / 100) : null;
      const r = allocRisk && allocRisk > 0 ? net / allocRisk : null;
      events.push({ tradeId: t.id, date: c.date || today(), price: c.price, pct: p, commission: numberOr(c.commission, 0), pnl: net, realizedR: r, trade: t });
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date));
  return events;
}

function aggregate() {
  const trades = state.trades;
  const closedTrades = trades.filter(t => tradeMetrics(t).isClosed);
  const openTrades = trades.filter(t => !tradeMetrics(t).isClosed);

  const events = getClosingEvents(trades);
  const totalPNL = events.reduce((a, e) => a + e.pnl, 0);
  const equity = settings.capital + totalPNL;

  // Win rate / PF / expectancy based on closed-trade aggregated P&L
  const perTradePNL = closedTrades.map(t => tradeMetrics(t).realized);
  const wins = perTradePNL.filter(x => x > 0);
  const losses = perTradePNL.filter(x => x < 0);
  const winRate = perTradePNL.length ? wins.length / perTradePNL.length : null;
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const pf = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : null);
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const expectancy = winRate !== null ? (winRate * avgWin - (1 - winRate) * avgLoss) : null;

  // Equity curve
  const byDay = {};
  for (const e of events) byDay[e.date] = (byDay[e.date] || 0) + e.pnl;
  const days = Object.keys(byDay).sort();
  let running = settings.capital;
  const equityPoints = [{ date: 'Start', value: settings.capital }];
  const dailyPNL = [];
  for (const d of days) {
    running += byDay[d];
    equityPoints.push({ date: d, value: Math.round(running * 100) / 100 });
    dailyPNL.push({ date: d, pnl: byDay[d] });
  }

  // Max drawdown
  let peak = equityPoints[0].value, mdd = 0, mddPct = 0;
  for (const p of equityPoints) {
    if (p.value > peak) peak = p.value;
    const dd = peak - p.value;
    if (dd > mdd) { mdd = dd; mddPct = peak > 0 ? dd / peak * 100 : 0; }
  }

  // Today
  const td = today();
  const todayPNL = byDay[td] || 0;

  // Risk
  let openRisk = 0, openReward = 0, margin = 0, notional = 0;
  for (const t of openTrades) {
    const m = tradeMetrics(t);
    openRisk += m.openRiskUSD || 0;
    openReward += m.openRewardUSD || 0;
    margin += m.margin;
    notional += m.notional;
  }

  // Streaks
  let curWin = 0, curLoss = 0, maxWin = 0, maxLoss = 0, lastKind = null;
  const closedSorted = [...closedTrades].sort((a, b) => {
    const ad = a.closings[a.closings.length - 1]?.date || a.date;
    const bd = b.closings[b.closings.length - 1]?.date || b.date;
    return ad.localeCompare(bd);
  });
  for (const t of closedSorted) {
    const p = tradeMetrics(t).realized;
    if (p > 0) { curWin++; curLoss = 0; if (curWin > maxWin) maxWin = curWin; lastKind = 'w'; }
    else if (p < 0) { curLoss++; curWin = 0; if (curLoss > maxLoss) maxLoss = curLoss; lastKind = 'l'; }
  }

  // Symbol perf
  const bySym = {};
  for (const t of closedTrades) {
    const m = tradeMetrics(t);
    const s = t.ticker || 'N/A';
    if (!bySym[s]) bySym[s] = { sym: s, pnl: 0, count: 0, wins: 0 };
    bySym[s].pnl += m.realized;
    bySym[s].count++;
    if (m.realized > 0) bySym[s].wins++;
  }

  return {
    trades, closedTrades, openTrades, events, equityPoints, dailyPNL, byDay,
    totalPNL, equity, winRate, pf, expectancy, avgWin, avgLoss,
    mdd, mddPct, todayPNL, openRisk, openReward, margin, notional,
    maxWin, maxLoss, currentStreak: lastKind === 'w' ? curWin : (lastKind === 'l' ? -curLoss : 0),
    bySym: Object.values(bySym)
  };
}

// ============================================================
// RENDER — Dashboard
// ============================================================
function renderHeader(agg) {
  const el = id => document.getElementById(id);
  el('hdr-capital').textContent = fmtUSD(agg.equity);
  el('hdr-pnl').textContent = fmtUSD(agg.totalPNL, true);
  el('hdr-pnl').className = 'v ' + posClass(agg.totalPNL);
  el('hdr-open').textContent = String(agg.openTrades.length);
  el('hdr-today').textContent = fmtUSD(agg.todayPNL, true);
  el('hdr-today').className = 'v ' + posClass(agg.todayPNL);
}

function renderKpis(agg) {
  const el = id => document.getElementById(id);
  const equityPct = settings.capital > 0 ? (agg.totalPNL / settings.capital) * 100 : 0;
  el('k-equity').textContent = fmtUSD(agg.equity);
  el('k-equity-n').textContent = 'Kapitał ' + fmtUSD(settings.capital);
  el('k-pnl').textContent = fmtUSD(agg.totalPNL, true);
  el('k-pnl').className = 'v mono ' + posClass(agg.totalPNL);
  el('k-pnl-n').textContent = fmtPct(equityPct) + ' do kapitału';
  el('k-wr').textContent = agg.winRate !== null ? (agg.winRate * 100).toFixed(1) + '%' : '—';
  el('k-wr-n').textContent = agg.closedTrades.length + ' zamkniętych';
  el('k-pf').textContent = agg.pf === null ? '—' : (agg.pf === Infinity ? '∞' : agg.pf.toFixed(2));
  el('k-pf-n').textContent = 'Profit / Loss';
  el('k-exp').textContent = agg.expectancy === null ? '—' : fmtUSD(agg.expectancy, true);
  el('k-exp').className = 'v mono ' + (agg.expectancy === null ? '' : posClass(agg.expectancy));
  el('k-exp-n').textContent = 'Śr. na transakcję';
  el('k-dd').textContent = agg.mdd > 0 ? fmtUSD(-agg.mdd) : '$0.00';
  el('k-dd').className = 'v mono ' + (agg.mdd > 0 ? 'neg' : '');
  el('k-dd-n').textContent = agg.mdd > 0 ? '-' + agg.mddPct.toFixed(2) + '%' : 'bez obsunięć';
}

function renderRisk(agg) {
  const el = id => document.getElementById(id);
  const budget = agg.equity * (settings.maxRiskPct / 100);
  const heat = agg.equity > 0 ? (agg.openRisk / agg.equity) * 100 : 0;
  el('r-budget').textContent = fmtUSD(budget);
  el('r-budget-n').textContent = settings.maxRiskPct.toFixed(2) + '% kapitału';
  el('r-open').textContent = fmtUSD(-Math.abs(agg.openRisk));
  el('r-open').className = 'v mono ' + (agg.openRisk > 0 ? 'neg' : '');
  const rr = agg.openRisk > 0 ? (agg.openReward / agg.openRisk) : null;
  el('r-open-n').textContent = (agg.openTrades.length + ' pozycji · RR ' + (rr === null ? '—' : rr.toFixed(2)));
  const heatPct = clamp(heat / Math.max(settings.maxRiskPct * agg.openTrades.length || settings.maxRiskPct, 0.01) * 100, 0, 100);
  el('m-heat-pct').textContent = heat.toFixed(2) + '%';
  const heatFillPct = clamp(heat / 5 * 100, 0, 100); // 5% = pełny heat
  el('m-heat-bar').style.width = heatFillPct + '%';
  el('m-heat-bar').className = 'tc-bar-fill ' + (heat >= 4 ? 'bad' : heat >= 2 ? 'warn' : 'good');
  el('m-heat-caption').textContent = fmtUSD(agg.openRisk) + ' / ' + fmtUSD(agg.equity);

  // Risk status chip
  const rs = el('risk-status');
  if (heat >= 4) { rs.textContent = '● high'; rs.style.color = 'var(--tc-neg)'; }
  else if (heat >= 2) { rs.textContent = '● elevated'; rs.style.color = 'var(--tc-warn)'; }
  else { rs.textContent = '● safe'; rs.style.color = 'var(--tc-pos)'; }

  // Daily loss / gain
  const lossLimit = agg.equity * (settings.maxDailyLoss / 100);
  const gainLimit = agg.equity * (settings.maxDailyGain / 100);
  const lossUsed = agg.todayPNL < 0 ? Math.min(Math.abs(agg.todayPNL) / Math.max(lossLimit, 0.01) * 100, 100) : 0;
  const gainUsed = agg.todayPNL > 0 ? Math.min(agg.todayPNL / Math.max(gainLimit, 0.01) * 100, 100) : 0;
  el('m-loss-pct').textContent = lossUsed.toFixed(0) + '%';
  el('m-loss-bar').style.width = lossUsed + '%';
  el('m-loss-limit').textContent = 'Limit ' + fmtUSD(-lossLimit);
  el('m-loss-cur').textContent = fmtUSD(agg.todayPNL < 0 ? agg.todayPNL : 0);
  el('m-gain-pct').textContent = gainUsed.toFixed(0) + '%';
  el('m-gain-bar').style.width = gainUsed + '%';
  el('m-gain-limit').textContent = 'Limit ' + fmtUSD(gainLimit, true);
  el('m-gain-cur').textContent = fmtUSD(agg.todayPNL > 0 ? agg.todayPNL : 0, true);
}

// Equity chart
function renderEquityChart(agg) {
  const ctx = document.getElementById('chart-equity').getContext('2d');
  let pts = agg.equityPoints;
  if (eqRange !== 'all' && pts.length > 1) {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - Number(eqRange));
    const c = cutoff.toISOString().slice(0, 10);
    const filtered = pts.filter(p => p.date === 'Start' || p.date >= c);
    if (filtered.length > 1) pts = filtered;
  }
  const labels = pts.map(p => p.date);
  const values = pts.map(p => p.value);

  const net = values.length ? values[values.length - 1] : settings.capital;
  const start = values.length ? values[0] : settings.capital;
  const delta = net - start;
  const el = id => document.getElementById(id);
  el('eq-net').textContent = fmtUSD(net);
  el('eq-delta').textContent = fmtUSD(delta, true) + ' · ' + fmtPct((delta / Math.max(start, 0.01)) * 100);
  el('eq-delta').className = 'delta mono ' + posClass(delta);

  if (charts.equity) charts.equity.destroy();

  // gradient
  const g = ctx.createLinearGradient(0, 0, 0, 240);
  const color = delta >= 0 ? 'rgba(11,138,74,' : 'rgba(192,54,44,';
  g.addColorStop(0, color + '0.22)');
  g.addColorStop(1, color + '0)');
  const line = delta >= 0 ? '#0b8a4a' : '#c0362c';

  charts.equity = new Chart(ctx, {
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
          callbacks: { label: c => fmtUSD(c.parsed.y) }
        }
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 }, maxTicksLimit: 8 } },
        y: { grid: { color: 'rgba(226,232,240,0.7)' }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => '$' + v.toLocaleString() } }
      }
    }
  });
}

// Open positions table
function renderOpenPositions(agg) {
  const wrap = document.getElementById('open-positions-wrap');
  const countEl = document.getElementById('open-count');
  if (!agg.openTrades.length) {
    countEl.textContent = '0';
    wrap.innerHTML = `<div class="tc-empty"><span class="material-symbols-outlined">inbox</span><h4>Brak otwartych pozycji</h4><p>Użyj planera lub przycisku "Nowa pozycja" aby dodać setup.</p></div>`;
    return;
  }
  countEl.textContent = String(agg.openTrades.length);

  const maxRiskAbs = Math.max(...agg.openTrades.map(t => tradeMetrics(t).openRiskUSD || 0), 1);

  const rows = agg.openTrades.map(t => {
    const m = tradeMetrics(t);
    const rr = m.plannedRR;
    const riskPct = (m.openRiskUSD || 0) / maxRiskAbs * 100;
    return `
      <tr>
        <td><div style="display:flex; align-items:center; gap:8px;"><span class="ticker">${esc(t.ticker || '—')}</span><span class="dir-tag ${t.direction}">${t.direction === 'long' ? '▲ L' : '▼ S'}</span></div></td>
        <td class="num">${fmtNum(t.entry, t.entry < 1 ? 6 : 2)}</td>
        <td class="num">${t.sl !== null ? fmtNum(t.sl, t.sl < 1 ? 6 : 2) : '—'}</td>
        <td class="num">${t.tp !== null ? fmtNum(t.tp, t.tp < 1 ? 6 : 2) : '—'}</td>
        <td class="num">${fmtQty(m.remainingSize)}</td>
        <td class="num neg">${m.openRiskUSD !== null ? fmtUSD(-m.openRiskUSD) : '—'}</td>
        <td class="num">${rr !== null ? rr.toFixed(2) : '—'}</td>
        <td>
          <div class="cell-bar">
            <div class="b"><i class="neg" style="width:${riskPct}%"></i></div>
            <span class="t">${m.closedPct > 0 ? Math.round(100 - m.closedPct) + '%' : '100%'}</span>
          </div>
        </td>
        <td class="num">${fmtUSD(m.margin)}</td>
        <td class="num">${t.leverage > 1 ? t.leverage + '×' : '—'}</td>
        <td><span class="muted" style="font-size:11.5px;">${esc(t.date)}</span></td>
        <td>
          <div class="row-actions">
            <button class="row-btn" title="Zamknij" onclick="openCloseModal('${t.id}')"><span class="material-symbols-outlined">call_received</span></button>
            <button class="row-btn" title="Edytuj" onclick="openEditTrade('${t.id}')"><span class="material-symbols-outlined">edit</span></button>
            <button class="row-btn danger" title="Usuń" onclick="deleteTrade('${t.id}')"><span class="material-symbols-outlined">delete</span></button>
          </div>
        </td>
      </tr>`;
  }).join('');

  wrap.innerHTML = `
    <table class="tc-tbl">
      <thead><tr>
        <th>Pozycja</th><th class="num">Entry</th><th class="num">SL</th><th class="num">TP</th>
        <th class="num">Size</th><th class="num">Open risk</th><th class="num">RR</th>
        <th>Exposure</th><th class="num">Margin</th><th class="num">Lev</th><th>Data</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderRecentClosings(agg) {
  const wrap = document.getElementById('recent-closings-wrap');
  const events = [...agg.events].reverse().slice(0, 8);
  document.getElementById('recent-closings-count').textContent = events.length + ' ostatnich';
  if (!events.length) {
    wrap.innerHTML = `<div class="tc-empty"><span class="material-symbols-outlined">history</span><h4>Brak zamknięć</h4><p>Zamknij częściowo lub w całości, aby zobaczyć wyniki tutaj.</p></div>`;
    return;
  }
  const rows = events.map(e => `
    <tr>
      <td><span class="muted mono" style="font-size:11.5px;">${esc(e.date)}</span></td>
      <td><span class="ticker">${esc(e.trade.ticker)}</span></td>
      <td><span class="dir-tag ${e.trade.direction}">${e.trade.direction === 'long' ? 'L' : 'S'}</span></td>
      <td class="num">${fmtNum(e.price, e.price < 1 ? 6 : 2)}</td>
      <td class="num">${e.pct.toFixed(0)}%</td>
      <td class="num ${posClass(e.pnl)}">${fmtUSD(e.pnl, true)}</td>
      <td class="num ${posClass(e.realizedR)}">${fmtR(e.realizedR)}</td>
    </tr>`).join('');
  wrap.innerHTML = `
    <table class="tc-tbl">
      <thead><tr><th>Data</th><th>Ticker</th><th>Dir</th><th class="num">Cena</th><th class="num">%</th><th class="num">P&L</th><th class="num">R</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderSymbolPerf(agg) {
  const wrap = document.getElementById('symbol-perf-wrap');
  if (!agg.bySym.length) {
    wrap.innerHTML = `<div class="tc-empty"><span class="material-symbols-outlined">show_chart</span><h4>Brak danych</h4><p>Statystyki pojawią się po zamknięciu pierwszych transakcji.</p></div>`;
    return;
  }
  const sorted = [...agg.bySym].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)).slice(0, 8);
  const maxAbs = Math.max(...sorted.map(s => Math.abs(s.pnl)), 1);
  wrap.innerHTML = `<div class="perf-list">` + sorted.map(s => {
    const w = Math.abs(s.pnl) / maxAbs * 50;
    const pos = s.pnl >= 0;
    return `
      <div class="perf-row">
        <div class="t">${esc(s.sym)}</div>
        <div class="bar">
          <i class="${pos ? '' : 'neg'}" style="width:${w}%"></i>
        </div>
        <div class="v ${posClass(s.pnl)}">${fmtUSD(s.pnl, true)}</div>
      </div>`;
  }).join('') + `</div>`;
}

// ============================================================
// Trades table
// ============================================================
function renderTradesTable() {
  const wrap = document.getElementById('trades-table-wrap');
  const countEl = document.getElementById('trades-count');
  let list = state.trades.slice();
  // Filter
  list = list.filter(t => {
    const m = tradeMetrics(t);
    const status = m.isClosed ? 'closed' : 'open';
    if (tradeFilters.status !== 'all' && tradeFilters.status !== status) return false;
    if (tradeFilters.dir !== 'all' && tradeFilters.dir !== t.direction) return false;
    if (tradeFilters.q) {
      const q = tradeFilters.q.toLowerCase();
      if (!t.ticker.toLowerCase().includes(q) && !(t.note || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });
  list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  countEl.textContent = list.length + ' transakcji';

  if (!list.length) {
    wrap.innerHTML = `<div class="tc-empty"><span class="material-symbols-outlined">search_off</span><h4>Brak transakcji</h4><p>Zmień filtry albo dodaj pierwszą pozycję.</p></div>`;
    return;
  }

  const rowsHtml = list.map(t => {
    const m = tradeMetrics(t);
    const status = m.isClosed ? 'closed' : 'open';
    const isOpen = expandedRows.has(t.id);
    const rr = m.plannedRR;
    const pnl = m.realized;
    const r = m.realizedR;
    const barFill = r !== null ? clamp(Math.abs(r) / 3 * 50, 0, 50) : 0;
    const rBarHtml = r !== null
      ? `<div class="r-bar"><i class="${r < 0 ? 'neg' : ''}" style="${r < 0 ? `right:50%; width:${barFill}%` : `left:50%; width:${barFill}%`}"></i></div>`
      : `<div class="r-bar"></div>`;

    const mainRow = `
      <tr class="${status === 'closed' ? 'closed' : ''}">
        <td style="padding-right:0;"><button class="expand-btn ${isOpen ? 'open' : ''}" onclick="toggleRow('${t.id}')"><span class="material-symbols-outlined">chevron_right</span></button></td>
        <td><span class="muted mono" style="font-size:11.5px;">${esc(t.date)}</span></td>
        <td><span class="ticker">${esc(t.ticker || '—')}</span></td>
        <td><span class="dir-tag ${t.direction}">${t.direction === 'long' ? '▲ L' : '▼ S'}</span></td>
        <td><span class="status-tag ${status}">${status === 'open' ? 'open' : 'closed'}</span></td>
        <td class="num">${fmtNum(t.entry, t.entry < 1 ? 6 : 2)}</td>
        <td class="num">${t.sl !== null ? fmtNum(t.sl, t.sl < 1 ? 6 : 2) : '—'}</td>
        <td class="num">${t.tp !== null ? fmtNum(t.tp, t.tp < 1 ? 6 : 2) : '—'}</td>
        <td class="num">${fmtQty(t.size)}</td>
        <td class="num">${rr !== null ? rr.toFixed(2) : '—'}</td>
        <td class="num ${posClass(pnl)}">${pnl !== 0 ? fmtUSD(pnl, true) : (m.closedPct > 0 ? fmtUSD(pnl, true) : '—')}</td>
        <td>${rBarHtml}</td>
        <td class="num ${posClass(r)}">${fmtR(r)}</td>
        <td>
          <div class="row-actions">
            ${!m.isClosed ? `<button class="row-btn" title="Zamknij" onclick="openCloseModal('${t.id}')"><span class="material-symbols-outlined">call_received</span></button>` : ''}
            <button class="row-btn" title="Edytuj" onclick="openEditTrade('${t.id}')"><span class="material-symbols-outlined">edit</span></button>
            <button class="row-btn danger" title="Usuń" onclick="deleteTrade('${t.id}')"><span class="material-symbols-outlined">delete</span></button>
          </div>
        </td>
      </tr>`;

    const expanded = isOpen ? renderExpandedRow(t, m) : '';
    return mainRow + expanded;
  }).join('');

  wrap.innerHTML = `
    <table class="tc-tbl">
      <thead><tr>
        <th></th><th>Data</th><th>Ticker</th><th>Dir</th><th>Status</th>
        <th class="num">Entry</th><th class="num">SL</th><th class="num">TP</th>
        <th class="num">Size</th><th class="num">RR plan</th>
        <th class="num">P&L</th><th>R</th><th class="num">R-mult</th><th></th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
}

function renderExpandedRow(t, m) {
  const closings = (t.closings || []);
  const closingsTable = closings.length ? `
    <table class="closings-mini">
      <thead><tr><th>Data</th><th class="num">Cena</th><th class="num">% zamknięcia</th><th class="num">Prowizja</th><th class="num">P&L</th></tr></thead>
      <tbody>
        ${closings.map((c, i) => {
          const sz = t.size * (c.pct / 100);
          const gross = t.direction === 'long' ? (c.price - t.entry) * sz : (t.entry - c.price) * sz;
          const net = gross - c.commission;
          return `<tr>
            <td>${esc(c.date)}</td>
            <td class="num">${fmtNum(c.price, c.price < 1 ? 6 : 2)}</td>
            <td class="num">${c.pct.toFixed(1)}%</td>
            <td class="num">${fmtUSD(c.commission)}</td>
            <td class="num ${posClass(net)}">${fmtUSD(net, true)} <button class="row-btn danger" style="margin-left:4px;" onclick="removeClosing('${t.id}', ${i})" title="Usuń"><span class="material-symbols-outlined">close</span></button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>` : `<div class="muted" style="font-size:12px;">Brak zamknięć. Dodaj pierwsze częściowe/całkowite zamknięcie poniżej.</div>`;

  const meta = `
    <div style="display:flex; gap:16px; font-size:12px; color:var(--tc-muted); flex-wrap:wrap;">
      <span>Notatka: <strong style="color:var(--tc-ink); font-weight:500;">${esc(t.note) || '—'}</strong></span>
      <span>Notional: <span class="mono">${fmtUSD(m.notional)}</span></span>
      <span>Margin: <span class="mono">${fmtUSD(m.margin)}</span></span>
      <span>Zamknięto: <span class="mono">${m.closedPct.toFixed(1)}%</span></span>
      <span>Avg exit: <span class="mono">${m.avgExit !== null ? fmtNum(m.avgExit, m.avgExit < 1 ? 6 : 2) : '—'}</span></span>
    </div>`;

  const quickClose = !m.isClosed ? `
    <div style="margin-top:8px;">
      <button class="btn-small primary" onclick="openCloseModal('${t.id}')"><span class="material-symbols-outlined">call_received</span>Dodaj zamknięcie</button>
    </div>` : '';

  return `
    <tr class="closings-row"><td colspan="14">
      <div class="closings-wrap">
        <div class="closings-hdr">
          <span>Zamknięcia</span>
        </div>
        ${meta}
        ${closingsTable}
        ${quickClose}
      </div>
    </td></tr>`;
}

// ============================================================
// Planner
// ============================================================
function setPlanDir(d) {
  planDir = d;
  document.getElementById('p-long').classList.toggle('active', d === 'long');
  document.getElementById('p-short').classList.toggle('active', d === 'short');
  updatePlanner();
}

function updatePlanner() {
  const el = id => document.getElementById(id);
  const entry = numberNullable(el('p-entry').value);
  const sl = numberNullable(el('p-sl').value);
  const tp = numberNullable(el('p-tp').value);
  const finalTpOverride = numberNullable(el('p-finaltp').value);
  const sizeUsdOverride = numberNullable(el('p-sizeusd').value);
  const lev = Math.max(1, numberOr(el('p-lev').value, 1));
  const riskPctRaw = numberNullable(el('p-riskpct').value);
  const riskPct = riskPctRaw !== null ? riskPctRaw : settings.maxRiskPct;
  if (!el('p-riskpct').value) el('p-riskpct').placeholder = settings.maxRiskPct.toFixed(2);

  const capital = settings.capital;
  const riskUSD = capital * (riskPct / 100);

  let riskPerUnit = null;
  if (entry !== null && sl !== null) riskPerUnit = Math.abs(entry - sl);

  const calcSize = (riskPerUnit && riskPerUnit > 0) ? riskUSD / riskPerUnit : null;
  const riskBasedNotional = (calcSize !== null && entry !== null) ? calcSize * entry : null;
  const leverageBudgetNotional = riskUSD * lev;
  const cappedAutoNotional = riskBasedNotional !== null ? Math.min(riskBasedNotional, leverageBudgetNotional) : null;
  const autoSize = (cappedAutoNotional !== null && entry !== null && entry > 0) ? cappedAutoNotional / entry : null;
  const size = (entry && sizeUsdOverride && sizeUsdOverride > 0) ? sizeUsdOverride / entry : autoSize;
  let sizeSource = 'auto (risk %)';
  if (entry && sizeUsdOverride && sizeUsdOverride > 0) sizeSource = 'manual ($)';
  else if (riskBasedNotional !== null && riskBasedNotional > leverageBudgetNotional) sizeSource = 'auto (cap: lewar)';

  const minTp = (entry !== null && riskPerUnit !== null)
    ? (planDir === 'long' ? entry + (riskPerUnit * settings.minRR) : entry - (riskPerUnit * settings.minRR))
    : null;
  const activeTp = finalTpOverride ?? tp ?? minTp;

  let rewardPerUnit = null;
  if (entry !== null && activeTp !== null) rewardPerUnit = Math.abs(activeTp - entry);

  // Direction sanity
  const dirValid = (() => {
    if (entry === null || sl === null) return { ok: true };
    if (planDir === 'long' && sl >= entry) return { ok: false, msg: 'Dla LONG, SL musi być poniżej entry' };
    if (planDir === 'short' && sl <= entry) return { ok: false, msg: 'Dla SHORT, SL musi być powyżej entry' };
    if (tp !== null) {
      if (planDir === 'long' && tp <= entry) return { ok: false, msg: 'Dla LONG, TP musi być powyżej entry' };
      if (planDir === 'short' && tp >= entry) return { ok: false, msg: 'Dla SHORT, TP musi być poniżej entry' };
    }
    if (finalTpOverride !== null) {
      if (planDir === 'long' && finalTpOverride <= entry) return { ok: false, msg: 'Final TP dla LONG musi być powyżej entry' };
      if (planDir === 'short' && finalTpOverride >= entry) return { ok: false, msg: 'Final TP dla SHORT musi być poniżej entry' };
    }
    return { ok: true };
  })();

  const rr = (riskPerUnit && rewardPerUnit && riskPerUnit > 0) ? rewardPerUnit / riskPerUnit : null;
  const notional = (size !== null && entry !== null) ? size * entry : null;
  const margin = (notional !== null) ? notional / lev : null;
  const rewardUSD = (size !== null && rewardPerUnit !== null) ? size * rewardPerUnit : null;
  const actualRiskUSD = (size !== null && riskPerUnit !== null) ? size * riskPerUnit : null;
  const effectiveRiskPct = actualRiskUSD !== null && capital > 0 ? (actualRiskUSD / capital) * 100 : null;

  el('p-rpu').textContent = riskPerUnit !== null ? fmtNum(riskPerUnit, riskPerUnit < 1 ? 6 : 2) : '—';
  el('p-wpu').textContent = rewardPerUnit !== null ? fmtNum(rewardPerUnit, rewardPerUnit < 1 ? 6 : 2) : '—';
  el('p-rr').textContent = rr !== null ? rr.toFixed(2) : '—';
  el('p-size').textContent = size !== null ? fmtQty(size) : '—';
  el('p-notional').textContent = notional !== null ? fmtUSD(notional) : '—';
  el('p-margin').textContent = margin !== null ? fmtUSD(margin) : '—';
  el('p-riskusd').textContent = actualRiskUSD !== null ? fmtUSD(-actualRiskUSD) : '—';
  el('p-rewardusd').textContent = rewardUSD !== null ? fmtUSD(rewardUSD, true) : '—';
  el('p-be').textContent = entry !== null ? fmtNum(entry, entry < 1 ? 6 : 2) : '—';
  el('p-minrrtp').textContent = minTp !== null ? fmtNum(minTp, minTp < 1 ? 6 : 2) : '—';
  el('p-activetp').textContent = activeTp !== null ? fmtNum(activeTp, activeTp < 1 ? 6 : 2) : '—';
  el('p-sizesrc').textContent = size !== null ? sizeSource : '—';

  // Price track
  const ptWrap = el('p-price-track');
  if (entry !== null && sl !== null) {
    const vals = [entry, sl];
    if (activeTp !== null) vals.push(activeTp);
    if (minTp !== null) vals.push(minTp);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.25 || entry * 0.01;
    const a = lo - pad, b = hi + pad, span = b - a || 1;
    const pos = x => ((x - a) / span) * 100;
    const entryPos = pos(entry), slPos = pos(sl), tpPos = activeTp !== null ? pos(activeTp) : null;
    const minTpPos = minTp !== null ? pos(minTp) : null;
    const slLeft = Math.min(slPos, entryPos), slWidth = Math.abs(entryPos - slPos);
    let tpHtml = '';
    if (activeTp !== null) {
      const tpLeft = Math.min(tpPos, entryPos);
      const tpWidth = Math.abs(entryPos - tpPos);
      tpHtml = `<div class="tp" style="left:${tpLeft}%; width:${tpWidth}%;"></div>`;
    }
    ptWrap.innerHTML = `
      <div class="price-track">
        <div class="axis">
          <div class="stop" style="left:${slLeft}%; width:${slWidth}%;"></div>
          ${tpHtml}
        </div>
        <div class="marker sl" style="left:${slPos}%;"></div>
        <div class="marker entry" style="left:${entryPos}%;"></div>
        ${activeTp !== null ? `<div class="marker tp" style="left:${tpPos}%;"></div>` : ''}
        ${minTp !== null ? `<div class="marker minrr" style="left:${minTpPos}%;"></div>` : ''}
        <div class="label lt sl" style="left:${slPos}%">SL ${fmtNum(sl, sl < 1 ? 4 : 2)}</div>
        <div class="label lt entry" style="left:${entryPos}%">ENTRY ${fmtNum(entry, entry < 1 ? 4 : 2)}</div>
        ${activeTp !== null ? `<div class="label lt tp" style="left:${tpPos}%">TP aktywny ${fmtNum(activeTp, activeTp < 1 ? 4 : 2)}</div>` : ''}
        ${minTp !== null ? `<div class="label lt minrr" style="left:${minTpPos}%">TP min RR ${fmtNum(minTp, minTp < 1 ? 4 : 2)}</div>` : ''}
        <div class="label" style="left:${slPos}%">-${fmtNum(Math.abs(entry - sl) / entry * 100)}%</div>
        <div class="label" style="left:${entryPos}%">0%</div>
        ${activeTp !== null ? `<div class="label" style="left:${tpPos}%">+${fmtNum(Math.abs(activeTp - entry) / entry * 100)}%</div>` : ''}
      </div>`;
  } else {
    ptWrap.innerHTML = `<div style="height:56px; background:var(--tc-surface); border-radius:8px; display:flex; align-items:center; justify-content:center; color:var(--tc-muted-2); font-size:12px;">Uzupełnij Entry + SL aby zobaczyć wizualizację</div>`;
  }

  // Score
  const issues = [];
  if (!dirValid.ok) issues.push({ k: 'bad', m: dirValid.msg });
  let score = 50;
  if (rr !== null) {
    if (rr >= settings.minRR) { score += 25; issues.push({ k: 'good', m: `RR ${rr.toFixed(2)} spełnia minimum ${settings.minRR}` }); }
    else if (rr >= settings.minRR * 0.7) { score += 10; issues.push({ k: 'warn', m: `RR ${rr.toFixed(2)} poniżej minimum (${settings.minRR})` }); }
    else { score -= 15; issues.push({ k: 'bad', m: `RR ${rr.toFixed(2)} znacznie poniżej min. ${settings.minRR}` }); }
  }
  if (riskPct > settings.maxRiskPct) { score -= 20; issues.push({ k: 'bad', m: `Ryzyko ${riskPct.toFixed(2)}% przekracza limit ${settings.maxRiskPct}%` }); }
  else if (riskPct <= settings.maxRiskPct) { score += 10; }
  if (effectiveRiskPct !== null && effectiveRiskPct > settings.maxRiskPct) {
    score -= 10;
    issues.push({ k: 'warn', m: `Po nadpisaniu size realne ryzyko to ${effectiveRiskPct.toFixed(2)}% (limit ${settings.maxRiskPct}%)` });
  }
  if (riskBasedNotional !== null && riskBasedNotional > leverageBudgetNotional) {
    issues.push({ k: 'warn', m: `Dźwignia ${lev}× ogranicza size: budżet notional ${fmtUSD(leverageBudgetNotional)} (risk% × lewar).` });
  }
  if (sizeUsdOverride !== null && sizeUsdOverride <= 0) issues.push({ k: 'bad', m: 'Nadpisanie size w $ musi być większe od zera' });
  if (margin !== null && margin > capital * 0.5) { score -= 10; issues.push({ k: 'warn', m: 'Margin > 50% kapitału – wysoka ekspozycja' }); }
  if (lev > 10) { score -= 10; issues.push({ k: 'warn', m: `Dźwignia ${lev}× – uważaj na liquidation` }); }
  if (finalTpOverride !== null) issues.push({ k: 'warn', m: 'Final TP nadpisany ręcznie — ten poziom zostanie zapisany do logu' });
  if (size !== null) issues.push({ k: 'good', m: `Size źródło: ${sizeSource}. Jeśli pole nadpisania puste, używany jest size automatyczny.` });
  score = clamp(Math.round(score), 0, 100);

  el('p-score').textContent = score + '/100';
  const badge = el('p-badge');
  badge.className = 'badge ' + (score >= 75 ? 'good' : score >= 50 ? 'warn' : score >= 25 ? 'bad' : 'bad');
  badge.textContent = score >= 75 ? 'A+ trade' : score >= 50 ? 'OK' : score >= 25 ? 'weak' : 'avoid';
  if (!dirValid.ok) { badge.className = 'badge bad'; badge.textContent = 'invalid'; }

  const notesEl = el('p-notes');
  if (issues.length) {
    notesEl.innerHTML = '<ul>' + issues.map(i => `<li class="${i.k}">${esc(i.m)}</li>`).join('') + '</ul>';
  } else {
    notesEl.textContent = 'Uzupełnij entry, stop i TP aby zobaczyć kalkulację i walidację setupu.';
  }

  // Add button
  const canAdd = dirValid.ok && entry !== null && sl !== null && size !== null && size > 0 && activeTp !== null && el('p-ticker').value.trim();
  el('p-add-btn').disabled = !canAdd;
  el('p-add-btn').dataset.size = size !== null ? size : '';
  el('p-add-btn').dataset.tp = activeTp !== null ? activeTp : '';
}

function clearPlanner() {
  ['p-ticker', 'p-entry', 'p-sl', 'p-tp', 'p-finaltp', 'p-sizeusd', 'p-riskpct', 'p-note'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('p-lev').value = 1;
  document.getElementById('p-date').value = today();
  setPlanDir('long');
}

function addTradeFromPlanner() {
  const el = id => document.getElementById(id);
  const entry = numberNullable(el('p-entry').value);
  const sl = numberNullable(el('p-sl').value);
  const size = Number(el('p-add-btn').dataset.size);
  if (!entry || !sl || !size) return;
  const t = normalizeTrade({
    ticker: el('p-ticker').value.trim(),
    direction: planDir,
    leverage: numberOr(el('p-lev').value, 1),
    entry, sl,
    tp: numberNullable(el('p-add-btn').dataset.tp),
    size,
    date: el('p-date').value || today(),
    note: el('p-note').value.trim()
  });
  state.trades.push(t);
  saveState();
  toast('Pozycja dodana: ' + t.ticker, 'ok');
  clearPlanner();
  switchTab('dashboard');
  renderAll();
}

// ============================================================
// Modals
// ============================================================
function openNewTradeModal() {
  modalDir = 'long';
  const el = id => document.getElementById(id);
  el('trade-modal-title').textContent = 'Nowa pozycja';
  el('t-id').value = '';
  el('t-ticker').value = '';
  el('t-entry').value = '';
  el('t-sl').value = '';
  el('t-tp').value = '';
  el('t-size').value = '';
  el('t-lev').value = 1;
  el('t-date').value = today();
  el('t-note').value = '';
  setModalDir('long');
  el('trade-modal').classList.add('on');
  updateTradeModalPreview();
  setTimeout(() => el('t-ticker').focus(), 50);
}
function openEditTrade(id) {
  const t = state.trades.find(x => x.id === id);
  if (!t) return;
  modalDir = t.direction;
  const el = i => document.getElementById(i);
  el('trade-modal-title').textContent = 'Edycja pozycji';
  el('t-id').value = t.id;
  el('t-ticker').value = t.ticker;
  el('t-entry').value = t.entry;
  el('t-sl').value = t.sl ?? '';
  el('t-tp').value = t.tp ?? '';
  el('t-size').value = t.size;
  el('t-lev').value = t.leverage;
  el('t-date').value = t.date;
  el('t-note').value = t.note;
  setModalDir(t.direction);
  el('trade-modal').classList.add('on');
  updateTradeModalPreview();
}
function setModalDir(d) {
  modalDir = d;
  document.getElementById('t-long').classList.toggle('active', d === 'long');
  document.getElementById('t-short').classList.toggle('active', d === 'short');
  updateTradeModalPreview();
}
function closeTradeModal() { document.getElementById('trade-modal').classList.remove('on'); }

function updateTradeModalPreview() {
  const el = i => document.getElementById(i);
  const entry = numberNullable(el('t-entry').value);
  const sl = numberNullable(el('t-sl').value);
  const tp = numberNullable(el('t-tp').value);
  const size = numberOr(el('t-size').value, 0);
  const lev = Math.max(1, numberOr(el('t-lev').value, 1));
  let html = '';
  if (entry && sl && size > 0) {
    const rpu = Math.abs(entry - sl);
    const risk = rpu * size;
    const notional = entry * size;
    const margin = notional / lev;
    const rr = tp ? Math.abs(tp - entry) / rpu : null;
    const reward = tp ? Math.abs(tp - entry) * size : null;
    html = `Risk: <b class="mono neg">${fmtUSD(-risk)}</b> · Reward: <b class="mono pos">${reward ? fmtUSD(reward, true) : '—'}</b> · RR: <b class="mono">${rr ? rr.toFixed(2) : '—'}</b> · Notional: <b class="mono">${fmtUSD(notional)}</b> · Margin: <b class="mono">${fmtUSD(margin)}</b>`;
  } else {
    html = 'Uzupełnij Entry, SL i Size aby zobaczyć kalkulację.';
  }
  el('t-preview').innerHTML = html;
}

function saveTradeModal() {
  const el = i => document.getElementById(i);
  const id = el('t-id').value;
  const entry = numberNullable(el('t-entry').value);
  const sl = numberNullable(el('t-sl').value);
  const size = numberOr(el('t-size').value, 0);
  if (!el('t-ticker').value.trim() || entry === null || !size) {
    toast('Uzupełnij ticker, entry i size', 'err');
    return;
  }
  if (sl !== null) {
    if (modalDir === 'long' && sl >= entry) return toast('LONG: SL musi być poniżej entry', 'err');
    if (modalDir === 'short' && sl <= entry) return toast('SHORT: SL musi być powyżej entry', 'err');
  }
  const data = {
    ticker: el('t-ticker').value.trim(),
    direction: modalDir,
    entry, sl,
    tp: numberNullable(el('t-tp').value),
    size,
    leverage: Math.max(1, numberOr(el('t-lev').value, 1)),
    date: el('t-date').value || today(),
    note: el('t-note').value.trim()
  };
  if (id) {
    const t = state.trades.find(x => x.id === id);
    if (t) Object.assign(t, data);
  } else {
    state.trades.push(normalizeTrade(data));
  }
  saveState();
  closeTradeModal();
  toast(id ? 'Zaktualizowano' : 'Dodano pozycję', 'ok');
  renderAll();
}

function deleteTrade(id) {
  if (!confirm('Usunąć pozycję bezpowrotnie?')) return;
  state.trades = state.trades.filter(t => t.id !== id);
  saveState();
  toast('Usunięto', 'ok');
  renderAll();
}

// Close modal
let activeCloseTrade = null;
function openCloseModal(id) {
  const t = state.trades.find(x => x.id === id);
  if (!t) return;
  activeCloseTrade = t;
  const m = tradeMetrics(t);
  const el = i => document.getElementById(i);
  el('close-trade-id').value = id;
  el('close-date').value = today();
  el('close-price').value = '';
  el('close-pct').value = Math.round(m.remainingPct);
  el('close-comm').value = 0;
  el('close-info').innerHTML = `
    <div><b>${esc(t.ticker)}</b> <span class="dir-tag ${t.direction}">${t.direction === 'long' ? 'LONG' : 'SHORT'}</span> · Entry: <span class="mono">${fmtNum(t.entry, t.entry < 1 ? 6 : 2)}</span> · Size: <span class="mono">${fmtQty(t.size)}</span></div>
    <div class="muted" style="margin-top:4px;">Pozostało do zamknięcia: <span class="mono" style="color:var(--tc-ink);">${m.remainingPct.toFixed(1)}%</span> (${fmtQty(m.remainingSize)})</div>
  `;
  el('close-modal').classList.add('on');
  updateClosePreview();
  setTimeout(() => el('close-price').focus(), 50);
}
function closeCloseModal() { document.getElementById('close-modal').classList.remove('on'); activeCloseTrade = null; }
function updateClosePreview() {
  if (!activeCloseTrade) return;
  const t = activeCloseTrade;
  const el = i => document.getElementById(i);
  const price = numberNullable(el('close-price').value);
  const pct = clamp(numberOr(el('close-pct').value, 0), 0, 100);
  const comm = numberOr(el('close-comm').value, 0);
  if (price === null || pct <= 0) { el('close-preview').textContent = '—'; return; }
  const sz = t.size * (pct / 100);
  const gross = t.direction === 'long' ? (price - t.entry) * sz : (t.entry - price) * sz;
  const net = gross - comm;
  const m = tradeMetrics(t);
  const r = m.initialRiskUSD && m.initialRiskUSD > 0 ? (net / (m.initialRiskUSD * (pct / 100))) : null;
  el('close-preview').innerHTML = `P&L: <b class="mono ${posClass(net)}">${fmtUSD(net, true)}</b> · R: <b class="mono ${posClass(r)}">${fmtR(r)}</b> · Size: <b class="mono">${fmtQty(sz)}</b>`;
}

function saveClose() {
  if (!activeCloseTrade) return;
  const el = i => document.getElementById(i);
  const price = numberNullable(el('close-price').value);
  const pct = clamp(numberOr(el('close-pct').value, 0), 0, 100);
  const comm = numberOr(el('close-comm').value, 0);
  const date = el('close-date').value || today();
  if (price === null || pct <= 0) { toast('Podaj cenę i %', 'err'); return; }
  const m = tradeMetrics(activeCloseTrade);
  if (pct > m.remainingPct + 0.001) { toast('% większe niż pozostałe ' + m.remainingPct.toFixed(1) + '%', 'err'); return; }
  activeCloseTrade.closings.push({ date, price, pct, commission: comm });
  saveState();
  toast('Zamknięcie zapisane', 'ok');
  closeCloseModal();
  renderAll();
}
function removeClosing(tradeId, idx) {
  if (!confirm('Usunąć to zamknięcie?')) return;
  const t = state.trades.find(x => x.id === tradeId);
  if (!t) return;
  t.closings.splice(idx, 1);
  saveState();
  renderAll();
}

// Settings
function openSettings() {
  const el = i => document.getElementById(i);
  el('s-capital').value = settings.capital;
  el('s-risk').value = settings.maxRiskPct;
  el('s-rr').value = settings.minRR;
  el('s-loss').value = settings.maxDailyLoss;
  el('s-gain').value = settings.maxDailyGain;
  el('settings-modal').classList.add('on');
}
function closeSettings() { document.getElementById('settings-modal').classList.remove('on'); }
function saveSettings() {
  const el = i => document.getElementById(i);
  settings = {
    capital: positiveOr(el('s-capital').value, DEFAULT_SETTINGS.capital),
    maxRiskPct: positiveOr(el('s-risk').value, DEFAULT_SETTINGS.maxRiskPct),
    minRR: positiveOr(el('s-rr').value, DEFAULT_SETTINGS.minRR),
    maxDailyLoss: positiveOr(el('s-loss').value, DEFAULT_SETTINGS.maxDailyLoss),
    maxDailyGain: positiveOr(el('s-gain').value, DEFAULT_SETTINGS.maxDailyGain)
  };
  saveSettingsStorage();
  closeSettings();
  toast('Zapisano ustawienia', 'ok');
  renderAll();
}

function clearAll() {
  if (!confirm('Na pewno wyczyścić WSZYSTKIE dane transakcji? Ta operacja jest nieodwracalna.')) return;
  state = { trades: [] };
  saveState();
  closeSettings();
  toast('Wyczyszczono', 'ok');
  renderAll();
}

function toggleRow(id) {
  if (expandedRows.has(id)) expandedRows.delete(id); else expandedRows.add(id);
  renderTradesTable();
}

// Tabs
function switchTab(name) {
  document.querySelectorAll('.trade-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'analytics') setTimeout(renderAnalytics, 30);
  if (name === 'planner') setTimeout(updatePlanner, 30);
}

function toast(msg, kind = '') {
  const c = document.getElementById('toasts');
  const d = document.createElement('div');
  d.className = 'tc-toast ' + kind;
  d.textContent = msg;
  c.appendChild(d);
  setTimeout(() => d.remove(), 2400);
}

// CSV export
function exportCSV() {
  const rows = [['id','date','ticker','direction','leverage','entry','sl','tp','size','note','closings_json']];
  for (const t of state.trades) {
    rows.push([t.id, t.date, t.ticker, t.direction, t.leverage, t.entry, t.sl ?? '', t.tp ?? '', t.size, `"${(t.note || '').replace(/"/g, '""')}"`, `"${JSON.stringify(t.closings).replace(/"/g, '""')}"`]);
  }
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'trades_' + today() + '.csv';
  a.click();
}

// ============================================================
// Analytics
// ============================================================
function renderAnalytics() {
  const agg = aggregate();
  const el = i => document.getElementById(i);

  const closed = agg.closedTrades;
  const pnls = closed.map(t => tradeMetrics(t).realized);
  const wins = pnls.filter(x => x > 0), losses = pnls.filter(x => x < 0);
  el('an-total').textContent = String(state.trades.length);
  el('an-wl').textContent = wins.length + ' / ' + losses.length;
  el('an-avgwin').textContent = wins.length ? fmtUSD(wins.reduce((a,b)=>a+b,0)/wins.length, true) : '—';
  el('an-avgloss').textContent = losses.length ? fmtUSD(losses.reduce((a,b)=>a+b,0)/losses.length, true) : '—';

  const days = Object.entries(agg.byDay);
  let best = days[0], worst = days[0];
  for (const d of days) {
    if (!best || d[1] > best[1]) best = d;
    if (!worst || d[1] < worst[1]) worst = d;
  }
  el('an-bestday').textContent = best ? fmtUSD(best[1], true) : '—';
  el('an-worstday').textContent = worst ? fmtUSD(worst[1], true) : '—';
  el('an-winstreak').textContent = String(agg.maxWin);
  el('an-lossstreak').textContent = String(agg.maxLoss);

  // Daily chart
  drawDaily(agg);
  drawRDist(agg);
  drawMonthly(agg);
  drawDir(agg);
  drawWR(agg);
  drawDOW(agg);
  drawHeatmap(agg);
}

function commonOpts() {
  return {
    maintainAspectRatio: false, responsive: true, animation: { duration: 200 },
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor: '#0f172a', titleColor: '#fff', bodyColor: '#cbd5e1', padding: 8, cornerRadius: 6, displayColors: false }
    },
    scales: {
      x: { grid: { display: false }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 }, maxTicksLimit: 8 } },
      y: { grid: { color: 'rgba(226,232,240,0.7)' }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } }
    }
  };
}

function drawDaily(agg) {
  const ctx = document.getElementById('chart-daily').getContext('2d');
  const data = agg.dailyPNL;
  if (charts.daily) charts.daily.destroy();
  charts.daily = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.date.slice(5)),
      datasets: [{ data: data.map(d => d.pnl), backgroundColor: data.map(d => d.pnl >= 0 ? '#0b8a4a' : '#c0362c'), borderRadius: 3, maxBarThickness: 18 }]
    },
    options: { ...commonOpts(), plugins: { ...commonOpts().plugins, tooltip: { ...commonOpts().plugins.tooltip, callbacks: { label: c => fmtUSD(c.parsed.y, true) } } }, scales: { ...commonOpts().scales, y: { ...commonOpts().scales.y, ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => '$' + v } } } }
  });
}

function drawRDist(agg) {
  const ctx = document.getElementById('chart-rdist').getContext('2d');
  const rs = agg.events.map(e => e.realizedR).filter(x => x !== null && Number.isFinite(x));
  const bins = [-4,-3,-2,-1,0,1,2,3,4,5];
  const labels = ['<-3R','-3/-2','-2/-1','-1/0','0/1','1/2','2/3','3/4','4/5','>5R'];
  const counts = new Array(labels.length).fill(0);
  for (const r of rs) {
    let idx = 0;
    if (r < -3) idx = 0;
    else if (r < -2) idx = 1;
    else if (r < -1) idx = 2;
    else if (r < 0) idx = 3;
    else if (r < 1) idx = 4;
    else if (r < 2) idx = 5;
    else if (r < 3) idx = 6;
    else if (r < 4) idx = 7;
    else if (r < 5) idx = 8;
    else idx = 9;
    counts[idx]++;
  }
  const colors = counts.map((_, i) => i <= 3 ? '#c0362c' : '#0b8a4a');
  if (charts.rdist) charts.rdist.destroy();
  charts.rdist = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data: counts, backgroundColor: colors, borderRadius: 3 }] },
    options: commonOpts()
  });
}

function drawMonthly(agg) {
  const ctx = document.getElementById('chart-monthly').getContext('2d');
  const byM = {};
  for (const e of agg.events) {
    const m = e.date.slice(0, 7);
    byM[m] = (byM[m] || 0) + e.pnl;
  }
  const months = Object.keys(byM).sort();
  const vals = months.map(m => byM[m]);
  if (charts.monthly) charts.monthly.destroy();
  charts.monthly = new Chart(ctx, {
    type: 'bar',
    data: { labels: months, datasets: [{ data: vals, backgroundColor: vals.map(v => v >= 0 ? '#0b8a4a' : '#c0362c'), borderRadius: 4, maxBarThickness: 28 }] },
    options: { ...commonOpts(), plugins: { ...commonOpts().plugins, tooltip: { ...commonOpts().plugins.tooltip, callbacks: { label: c => fmtUSD(c.parsed.y, true) } } }, scales: { ...commonOpts().scales, y: { ...commonOpts().scales.y, ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => '$' + v } } } }
  });
}

function drawDir(agg) {
  const ctx = document.getElementById('chart-dir').getContext('2d');
  let longP = 0, shortP = 0;
  for (const t of agg.closedTrades) {
    const p = tradeMetrics(t).realized;
    if (t.direction === 'long') longP += p; else shortP += p;
  }
  if (charts.dir) charts.dir.destroy();
  charts.dir = new Chart(ctx, {
    type: 'bar',
    data: { labels: ['Long', 'Short'], datasets: [{ data: [longP, shortP], backgroundColor: [longP >= 0 ? '#0b8a4a' : '#c0362c', shortP >= 0 ? '#0b8a4a' : '#c0362c'], borderRadius: 5, maxBarThickness: 50 }] },
    options: { ...commonOpts(), indexAxis: 'y', plugins: { ...commonOpts().plugins, tooltip: { ...commonOpts().plugins.tooltip, callbacks: { label: c => fmtUSD(c.parsed.x, true) } } }, scales: { x: { grid: { color: 'rgba(226,232,240,0.7)' }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => '$' + v } }, y: { grid: { display: false }, border: { display: false }, ticks: { color: '#334155', font: { size: 11, weight: 'bold' } } } } }
  });
}

function drawWR(agg) {
  const ctx = document.getElementById('chart-wr').getContext('2d');
  const closed = agg.closedTrades;
  const pnls = closed.map(t => tradeMetrics(t).realized);
  const w = pnls.filter(x => x > 0).length;
  const l = pnls.filter(x => x < 0).length;
  const be = pnls.filter(x => x === 0).length;
  if (charts.wr) charts.wr.destroy();
  charts.wr = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: ['Wins', 'Losses', 'BE'], datasets: [{ data: [w, l, be], backgroundColor: ['#0b8a4a', '#c0362c', '#94a3b8'], borderWidth: 0 }] },
    options: { maintainAspectRatio: false, responsive: true, cutout: '65%', plugins: { legend: { display: true, position: 'right', labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 }, color: '#334155' } }, tooltip: { ...commonOpts().plugins.tooltip } } }
  });
}

function drawDOW(agg) {
  const ctx = document.getElementById('chart-dow').getContext('2d');
  const names = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb', 'Nd'];
  const sums = [0,0,0,0,0,0,0], counts = [0,0,0,0,0,0,0];
  for (const e of agg.events) {
    const d = new Date(e.date);
    const day = (d.getDay() + 6) % 7;
    sums[day] += e.pnl; counts[day]++;
  }
  const avgs = sums.map((s, i) => counts[i] > 0 ? s / counts[i] : 0);
  if (charts.dow) charts.dow.destroy();
  charts.dow = new Chart(ctx, {
    type: 'bar',
    data: { labels: names, datasets: [{ data: avgs, backgroundColor: avgs.map(v => v >= 0 ? '#0b8a4a' : '#c0362c'), borderRadius: 3, maxBarThickness: 26 }] },
    options: { ...commonOpts(), plugins: { ...commonOpts().plugins, tooltip: { ...commonOpts().plugins.tooltip, callbacks: { label: c => fmtUSD(c.parsed.y, true) } } } }
  });
}

function drawHeatmap(agg) {
  const wrap = document.getElementById('calendar-heatmap');
  // 12 weeks × 7 = 84 days
  const weeks = 12;
  const cells = weeks * 7;
  const end = new Date(); end.setHours(0,0,0,0);
  const start = new Date(end); start.setDate(end.getDate() - cells + 1);
  const vals = [];
  const max = Math.max(1, ...Object.values(agg.byDay).map(v => Math.abs(v)));
  for (let i = 0; i < cells; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    vals.push({ date: key, pnl: agg.byDay[key] || 0 });
  }
  wrap.innerHTML = `
    <div style="display:grid; grid-template-columns: repeat(${weeks}, 1fr); grid-auto-flow: column; grid-template-rows: repeat(7, 1fr); gap: 3px; min-height: 150px;">
    ${vals.map(v => {
      if (!v.pnl) return `<div class="cell" title="${v.date}: —"></div>`;
      const pct = Math.abs(v.pnl) / max;
      const color = v.pnl > 0
        ? `rgba(11, 138, 74, ${0.15 + pct * 0.85})`
        : `rgba(192, 54, 44, ${0.15 + pct * 0.85})`;
      return `<div class="cell" title="${v.date}: ${fmtUSD(v.pnl, true)}" style="background:${color};"></div>`;
    }).join('')}
    </div>
    <div style="display:flex; align-items:center; gap:8px; margin-top:12px; font-size:11px; color:var(--tc-muted);">
      <span>strata</span>
      <div style="display:flex; gap:2px;">
        ${[0.9,0.6,0.3,0.1].map(a=>`<div style="width:12px;height:12px;background:rgba(192,54,44,${a});border-radius:2px;"></div>`).join('')}
        <div style="width:12px;height:12px;background:var(--tc-surface);border-radius:2px;margin:0 4px;"></div>
        ${[0.1,0.3,0.6,0.9].map(a=>`<div style="width:12px;height:12px;background:rgba(11,138,74,${a});border-radius:2px;"></div>`).join('')}
      </div>
      <span>zysk</span>
    </div>
  `;
}

// ============================================================
// Render all
// ============================================================
function renderAll() {
  const agg = aggregate();
  renderHeader(agg);
  renderKpis(agg);
  renderRisk(agg);
  renderEquityChart(agg);
  renderOpenPositions(agg);
  renderRecentClosings(agg);
  renderSymbolPerf(agg);
  renderTradesTable();
  // Only redraw analytics if tab visible
  if (document.getElementById('tab-analytics').classList.contains('active')) renderAnalytics();
}

// ============================================================
// Init
// ============================================================
function init() {
  loadState();
  // Tabs
  document.querySelectorAll('.trade-tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  // Equity range
  document.querySelectorAll('#eq-range button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#eq-range button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    eqRange = b.dataset.range;
    const agg = aggregate();
    renderEquityChart(agg);
  }));
  // Header buttons
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('export-btn').addEventListener('click', exportCSV);
  document.getElementById('new-trade-btn').addEventListener('click', openNewTradeModal);

  // Filters
  document.querySelectorAll('#filter-status .filter-chip').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#filter-status .filter-chip').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); tradeFilters.status = b.dataset.f; renderTradesTable();
  }));
  document.querySelectorAll('#filter-dir .filter-chip').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#filter-dir .filter-chip').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); tradeFilters.dir = b.dataset.d; renderTradesTable();
  }));
  document.getElementById('filter-search').addEventListener('input', e => { tradeFilters.q = e.target.value; renderTradesTable(); });

  // Planner listeners
  ['p-ticker', 'p-entry', 'p-sl', 'p-tp', 'p-finaltp', 'p-sizeusd', 'p-riskpct', 'p-lev', 'p-date', 'p-note'].forEach(id => {
    document.getElementById(id).addEventListener('input', updatePlanner);
  });
  document.getElementById('p-date').value = today();

  // Modal listeners
  ['t-entry', 't-sl', 't-tp', 't-size', 't-lev'].forEach(id => document.getElementById(id).addEventListener('input', updateTradeModalPreview));
  ['close-price', 'close-pct', 'close-comm'].forEach(id => document.getElementById(id).addEventListener('input', updateClosePreview));

  // Click outside modals to close
  document.querySelectorAll('.tc-modal-ov').forEach(ov => ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('on'); }));
  // ESC
  document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.tc-modal-ov.on').forEach(m => m.classList.remove('on')); });

  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
