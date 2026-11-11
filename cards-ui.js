/* ============================================================
   KARTY — nowy interfejs
   Silnik (stan, compute(), VAT, alokacja kosztów, zwroty) jest w cards.js,
   ładowanym w trybie CARDS_HEADLESS. Ten plik to wyłącznie widoki i formularze;
   zapisuje dane w tym samym schemacie, więc stara wersja (cards-legacy.html)
   dalej działa na tych samych danych.
   Wszystko siedzi w jednym domknięciu, a na zewnątrz wystawiony jest tylko
   obiekt UI (do onclick w HTML) — żadna nazwa nie nadpisze funkcji silnika.
   ============================================================ */
(function () {
'use strict';

/* ---------- Drobne narzędzia ---------- */
const $ = id => document.getElementById(id);
const fmt = v => fmtPLN0(v);
const fmt2 = v => fmtPLN(v);
const pct = v => (v == null || !Number.isFinite(v)) ? '—' : Math.round(v) + '%';
const dShort = d => d ? d.slice(8, 10) + '.' + d.slice(5, 7) : '—';
const dFull = d => d ? d.split('-').reverse().join('.') : '—';
const mk = d => (d || '').slice(0, 7);
const MNF = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
const mFull = k => `${MNF[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`;
const mLow = k => mFull(k).toLowerCase();
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dim = k => +monthEnd(k).slice(8, 10);
const numIn = id => num(($(id) || {}).value);
const setv = (id, v) => { const e = $(id); if (e) e.value = v == null ? '' : v; };
const getv = id => (($(id) || {}).value || '');
const RYC = () => num(settings.ryczalt);
const TM = () => num(settings.targetMargin);
const vin = g => g * vatRate() / (100 + vatRate());

const CH_COLORS = { Vinted: '#09b1ba', Empik: '#e2001a', Allegro: '#ff5a00', eBay: '#0064d2', Cardmarket: '#1f3a93', Whatnot: '#e0a100', OLX: '#002f34' };
const chColor = n => CH_COLORS[n] || PALETTE[(Math.max(0, settings.channels.findIndex(c => c.name === n)) + 3) % PALETTE.length];
const dot = n => `<span class="cx-dot" style="background:${chColor(n)}"></span>`;
const kindIco = k => `<span class="cx-kind ${k === 'card' ? 'card' : 'box'}" title="${k === 'card' ? 'Karta' : 'Box'}"><span class="material-symbols-outlined">${k === 'card' ? 'style' : 'inventory_2'}</span></span>`;
const CHS = () => settings.channels.filter(c => !c.hidden);
const chOf = n => settings.channels.find(c => c.name === n) || { name: n, fee: 0, fixed: 0, ship: 0 };

function delta(cur, prev, mode) {
  if (!prev) return '';
  const d = (cur - prev) / Math.abs(prev) * 100;
  if (!Number.isFinite(d)) return '';
  if (Math.abs(d) < 3) return '<span class="cx-delta flat">≈</span>';
  const arrow = d > 0 ? '▲' : '▼';
  if (mode === 'neutral') return `<span class="cx-delta flat">${arrow} ${Math.abs(Math.round(d))}%</span>`;
  const good = mode === 'invert' ? d < 0 : d > 0;
  return `<span class="cx-delta ${good ? 'up' : 'down'}">${arrow} ${Math.abs(Math.round(d))}%</span>`;
}
const kpi = (k, v, n, cls) => `<div class="tc-kpi"><span class="k">${k}</span><span class="v ${cls || ''}">${v}</span><span class="n">${n || ''}</span></div>`;
function li(ic, tone, t, d, rt, onclick) {
  const icon = /^[a-z_0-9]+$/.test(ic) ? `<span class="material-symbols-outlined">${ic}</span>` : `<b style="font-size:12px">${ic}</b>`;
  return `<div class="cx-item${onclick ? ' click' : ''}"${onclick ? ` onclick="${onclick}"` : ''}><div class="ic ${tone}">${icon}</div><div class="bd"><div class="t">${t}</div>${d ? `<div class="d">${d}</div>` : ''}</div>${rt ? `<div class="rt">${rt}</div>` : ''}</div>`;
}
const empty = t => `<div class="cx-empty">${t}</div>`;
const normName = s => String(s || '').toLowerCase().replace(/topps|panini|\b20\d\d(\/|-)?\d{0,4}\b|\bbox\b|[^a-z0-9ąćęłńóśźż]+/g, ' ').replace(/\s+/g, ' ').trim();
function segBind(id, fn) { document.querySelectorAll('#' + id + ' button').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('#' + id + ' button').forEach(x => x.classList.toggle('active', x === b)); fn(b.dataset.v); })); }
function segSet(id, v) { document.querySelectorAll('#' + id + ' button').forEach(x => x.classList.toggle('active', x.dataset.v === String(v))); }

/* ---------- Zysk na czysto: po VAT, prowizjach, wysyłce i ryczałcie ---------- */
/* Ryczałt od sprzedaży: stawka od przychodu bez VAT (zwrot oddaje ryczałt z minusem). */
const saleRyc = s => (s.gross - (s.vat || 0)) * RYC() / 100;
const pnlNet = s => s.pnl - saleRyc(s);

/** Wycena jednej sprzedaży: P = cena płacona przez kupującego. it = { cost, vatCost, scheme }. */
function calc(it, ch, P, noVat) {
  const vOn = vatOn() && !noVat;
  const outVat = !vOn ? 0 : it.scheme === 'margin' ? vin(Math.max(0, P - (it.vatCost || 0))) : vin(P);
  const fee = P * num(ch.fee) / 100 + num(ch.fixed);
  const feeVat = vOn && ch.feeVat ? vin(fee) : 0;
  const ship = num(ch.ship);
  const shipVat = vOn && ch.shipVat ? vin(ship) : 0;
  const cashIn = P - fee - ship;
  const vatPay = outVat - feeVat - shipVat;
  const ryc = Math.max(0, P - outVat) * RYC() / 100;
  const profit = cashIn - vatPay - it.cost - ryc;
  return { P, outVat, fee, feeVat, ship, shipVat, cashIn, vatPay, ryc, cost: it.cost, profit, roi: it.cost > 0 ? profit / it.cost * 100 : 0 };
}
/* Zaokrąglenie w górę do ceny kończącej się na 4 albo 9 (powyżej 1000 zł — na 9, co 10 zł),
   żeby ROI nie odjeżdżało od celu o więcej niż ok. 2–3 punkty. */
function nicePrice(p) {
  if (p <= 0) return 0;
  if (p < 30) return Math.ceil(p);
  const step = p < 1000 ? 5 : 10;
  return Math.ceil((p + 1) / step) * step - 1;
}
/** Dokładna najniższa cena, przy której zysk na czysto ≥ ROI × koszt. */
function breakPrice(it, ch, roi = TM(), noVat) {
  let lo = 0, hi = Math.max(50, it.cost * 10);
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (calc(it, ch, mid, noVat).profit >= it.cost * roi / 100) hi = mid; else lo = mid; }
  return hi;
}
/** Najniższa „ładna” cena, przy której zysk na czysto ≥ ROI × koszt. */
const recommend = (it, ch, roi = TM(), noVat) => nicePrice(breakPrice(it, ch, roi, noVat));

/* ---------- Dane pochodne ---------- */
let G = [];          // grupy sealed: ten sam produkt, dokument VAT i status dostawy
let LAST = {};       // ostatnia sprzedaż per nazwa produktu
let ORDERS = [];     // zamówienia (grupy boxów)
const deals = () => M.sales.filter(s => !s.returned && !s.isReturn && s.date <= today());
const salesToDate = () => M.sales.filter(s => s.date <= today());

function rebuild() {
  M = compute();
  const m = new Map();
  for (const b of M.sealed) {
    const key = [b.name, b.vatDoc, b.transit ? 1 : 0].join('|');
    if (!m.has(key)) m.set(key, { key, name: b.name, doc: b.vatDoc, transit: !!b.transit, items: [], src: new Set(), date: b.date });
    const g = m.get(key); g.items.push(b); if (b.source) g.src.add(b.source); if (b.date < g.date) g.date = b.date;
  }
  G = [...m.values()].map(g => {
    const n = g.items.length;
    return {
      ...g, n, src: [...g.src].join(', '),
      cost: sum(g.items, x => x.landed) / n, gross: sum(g.items, x => x.landedGross) / n, vat: sum(g.items, x => x.vatDed) / n,
      scheme: g.items[0].vatScheme, days: Math.max(...g.items.map(x => x.daysHeld || 0)), capital: sum(g.items, x => x.landed)
    };
  }).sort((a, b) => b.capital - a.capital);
  LAST = {};
  for (const s of deals()) if (!LAST[s.name] || LAST[s.name].date < s.date) LAST[s.name] = s;
  ORDERS = buildOrders();
}
const gItem = g => ({ cost: g.cost, vatCost: g.gross, scheme: g.scheme });
const cItem = c => ({ cost: c.basis, vatCost: c.vatCost, scheme: c.vatScheme, value: c.marketValue });
const gByKey = k => G.find(g => g.key === k);
const onHand = () => G.filter(g => !g.transit);
const inTransit = () => G.filter(g => g.transit);

/* ============================================================
   Nawigacja
   ============================================================ */
let view = 'home';
const TAB_OF = { shops: 'buys', rev: 'vat' };
function go(v) {
  view = v;
  const tab = TAB_OF[v] || v;
  document.querySelectorAll('#cx-tabs .trade-tab, .cx-gear').forEach(b => b.classList.toggle('active', b.dataset.v === tab));
  document.querySelectorAll('.cx-view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
  renderView(v);
  window.scrollTo(0, 0);
  try { history.replaceState(null, '', '#' + v); } catch (e) { /* plik lokalny bez historii */ }
}
function renderView(v) {
  ({ home: renderHome, stock: renderStock, sales: renderSales, buys: renderBuys, shops: renderShops, results: renderResults, vat: renderVat, rev: renderRev, settings: renderSettings }[v] || renderHome)();
}
function renderAll() {
  renderCounts();
  renderView(view);
}
function commit(msg, kind = 'ok') {
  saveState();
  rebuild();
  renderAll();
  if (msg) toast(msg, kind);
}
function renderCounts() {
  $('cnt-stock').textContent = sum(onHand(), g => g.n);
  const unk = (state.shops || []).filter(s => s.st === 'unknown').length;
  $('cnt-shops').hidden = !unk; $('cnt-shops').textContent = unk;
  const dw = dwPending().length, vatDue = vatUnpaid();
  $('cnt-tax').hidden = !(dw || vatDue); $('cnt-tax').textContent = dw || '!';
  ['shops-sub-1', 'shops-sub-2'].forEach(i => { if ($(i)) $(i).innerHTML = unk ? `<span class="cx-count">· ${unk}</span>` : ''; });
  ['dw-sub', 'dw-sub-2'].forEach(i => { if ($(i)) $(i).innerHTML = dw ? `<span class="cx-count">· ${dw} do ING</span>` : ''; });
}

/* ============================================================
   PULPIT
   ============================================================ */
function vatPeriods() { return (M.vatLedger && M.vatLedger.periods) || []; }
function vatUnpaid() { return vatPeriods().find(p => p.closed && p.payable > 0.005 && !(settings.vat.paid || {})[p.key]) || null; }
function dwDays() { const ks = [...new Set(salesToDate().map(s => mk(s.date)))]; return [...new Set(ks.flatMap(k => accountingSales(k).map(s => s.date)))].filter(d => d <= today()).sort(); }
function dwPending() { return dwDays().filter(d => !(state.dwDone || {})[d] && d <= today()); }

function reorderList() {
  const T = today(), d30 = addDays(T, -30), d60 = addDays(T, -60), lt = num(settings.leadTime) || 14;
  const by = new Map();
  for (const s of deals()) {
    if (s.kind !== 'box' || s.date < d60) continue;
    const k = normName(s.name);
    if (!by.has(k)) by.set(k, { name: s.name, u30: 0, u60: 0, weeks: new Set(), profit: 0, last: '' });
    const o = by.get(k);
    o.u60++; if (s.date >= d30) o.u30++;
    o.weeks.add(Math.floor(daysBetween(d60, s.date) / 7));
    o.profit += pnlNet(s);
    if (s.date > o.last) { o.last = s.date; o.name = s.name; }
  }
  const out = [];
  for (const [k, o] of by) {
    /* Regularnie: min. 4 szt. w 60 dni, w 3 różnych tygodniach, i dalej schodzi (2 w 30 dni). */
    if (o.u60 < 4 || o.u30 < 2 || o.weeks.size < 3 || o.profit <= 0) continue;
    const v = 0.6 * (o.u30 / 30) + 0.4 * (o.u60 / 60);
    const stock = sum(onHand().filter(g => normName(g.name) === k), g => g.n);
    const transit = sum(inTransit().filter(g => normName(g.name) === k), g => g.n);
    const cover = (stock + transit) / v, need = lt + 14;
    if (cover >= need + 14) continue;
    out.push({ ...o, v, stock, transit, cover, need, qty: Math.max(1, Math.ceil(v * (lt + 45) - stock - transit)), level: cover < need ? 'now' : 'soon', avg: o.profit / o.u60 });
  }
  return out.sort((a, b) => a.cover - b.cover);
}

function renderHome() {
  const T = today(), m30 = deals().filter(s => s.date >= addDays(T, -29)), p30 = deals().filter(s => s.date < addDays(T, -29) && s.date >= addDays(T, -59));
  const all30 = salesToDate().filter(s => s.date >= addDays(T, -29)), allP30 = salesToDate().filter(s => s.date < addDays(T, -29) && s.date >= addDays(T, -59));
  const rec = capitalRecovery();
  const due = vatUnpaid(), cur = vatPeriods().find(p => p.current);
  const p30v = sum(all30, pnlNet);
  $('home-kpi').innerHTML = [
    kpi('Zysk na czysto — 30 dni', fmt(p30v) + delta(p30v, sum(allP30, pnlNet)), `${m30.length} ${plural(m30.length, 'sprzedaż', 'sprzedaże', 'sprzedaży')} · od startu ${fmt(sum(salesToDate(), pnlNet))}`, p30v >= 0 ? 'pos' : 'neg'),
    kpi('Towar na stanie', fmt(sum(onHand(), g => g.capital)), `${nBoxes(sum(onHand(), g => g.n))} (koszt netto) · ${nCards(M.held.length)}`),
    kpi('Gotówka do odzyskania', fmt(rec.missing), `wydane ${fmt(rec.spent)} − wróciło ${fmt(rec.cashBack)}`, 'warn'),
    due ? kpi(`VAT do zapłaty do ${dShort(due.dueDate)}`, fmt2(due.payable), `za ${mLow(due.key)} · <a href="#" onclick="UI.go('vat');return false">rozliczenie</a>`, 'neg')
      : kpi('VAT — bieżący miesiąc', cur ? fmt2(Math.max(0, cur.due)) : '—', cur ? `${mLow(cur.key)} · termin ${dShort(cur.dueDate)}` : 'VAT wyłączony')
  ].join('');
  // Do zrobienia
  const out = [];
  const dw = dwPending();
  if (dw.length) out.push(li('receipt_long', 'warn', `${dw.length} ${plural(dw.length, 'dzień', 'dni', 'dni')} sprzedaży do wprowadzenia w ING`, 'dowód wewnętrzny na każdy dzień — kwoty kopiujesz jednym kliknięciem', '', "UI.go('rev')"));
  if (due) out.push(li('account_balance', 'neg', `Zapłać ${fmt2(due.payable)} VAT do ${dShort(due.dueDate)}`, `JPK za ${mLow(due.key)} · mikrorachunek podatkowy`, '', "UI.go('vat')"));
  if (vatOn() && !(settings.vat.extra || []).some(x => x.side === 'out' && mk(x.date) === mk(T)) && (settings.vat.extra || []).some(x => x.side === 'out'))
    out.push(li('description', 'warn', `Faktura B2B za ${mLow(mk(T))}`, 'wystaw z datą ostatniego dnia miesiąca i dodaj w Podatkach', '', "UI.go('vat')"));
  const fut = M.sales.filter(s => s.date > T && !s.isReturn);
  fut.forEach(s => out.push(li('event_busy', 'warn', 'Sprzedaż z datą z przyszłości', `${esc(s.name)} · ${dFull(s.date)} · ${esc(s.channel)} · ${fmt(s.gross)} — pewnie literówka w dacie`, '', `UI.editSale('${s.kind}','${s.id}')`)));
  const slowD = num(settings.slowDays) || 45, slow = onHand().filter(g => g.days > slowD).sort((a, b) => b.days - a.days);
  if (slow.length) out.push(li('hourglass_top', 'warn', `${nBoxes(sum(slow, g => g.n))} leży ponad ${slowD} dni`, `${fmt(sum(slow, g => g.capital))} zamrożone · najdłużej: ${esc(slow[0].name)} (${slow[0].days} dni)`, '', "UI.stockFilter('slow')"));
  const novat = onHand().filter(g => g.vat < 0.005 && vatOn());
  if (novat.length) out.push(li('percent', 'acc', `${nBoxes(sum(novat, g => g.n))} bez odliczonego VAT`, 'przy sprzedaży oddajesz VAT od całej ceny — rekomendowane ceny już to uwzględniają', '', "UI.stockFilter('novat')"));
  const unk = (state.shops || []).filter(s => s.st === 'unknown').length;
  if (unk) out.push(li('storefront', 'mut', `${unk} ${plural(unk, 'sklep', 'sklepy', 'sklepów')} do sprawdzenia`, 'czy mają konto B2B (faktura 0% na VAT-UE)', '', "UI.go('shops')"));
  if (Math.abs(M.residual) > 0.5) out.push(li('error', 'neg', 'Dane się nie spinają', `różnica ${fmt2(M.residual)} — sprawdź ostatnie zmiany`, ''));
  $('home-todo').innerHTML = out.join('') || empty('Wszystko zrobione.');
  // Pora domówić
  const ro = reorderList();
  $('home-reorder').innerHTML = (ro.length ? ro.slice(0, 6).map(o => li(o.level === 'now' ? 'priority_high' : 'autorenew', o.level === 'now' ? 'neg' : 'warn', esc(o.name),
    `${o.u60} szt. w 60 dni (${o.u30} w ostatnich 30) · ~${(o.v * 7).toFixed(1).replace('.', ',')} szt./tydz. · zysk śr. ${fmt(o.avg)}/szt.<br>${o.stock ? `na stanie ${o.stock}` : '<b class="neg">brak na stanie</b>'}${o.transit ? ` · w drodze ${o.transit}` : ''} — ${o.cover < 1 ? 'wyprzedane' : `starczy na ~${Math.round(o.cover)} dni`}
     <div class="cx-bar" style="width:110px;margin-top:6px"><i style="width:${Math.min(100, o.cover / (o.need + 14) * 100)}%;background:${o.level === 'now' ? 'var(--tc-neg)' : 'var(--tc-warn)'}"></i></div>`,
    `<span class="cx-pill ${o.level === 'now' ? 'neg' : 'warn'}">${o.level === 'now' ? 'zamów teraz' : 'wkrótce'}</span><span class="cx-note">~${o.qty} szt.</span>`)).join('')
    : empty('Żaden regularnie sprzedawany produkt się nie kończy.')) +
    `<p class="cx-note" style="margin-top:10px">Liczę tylko produkty, które schodzą regularnie: min. 4 szt. w 60 dni, w co najmniej 3 różnych tygodniach, i nadal się sprzedają (min. 2 w 30 dni). Alert, gdy zapas na stanie i w drodze wystarczy na krócej niż dostawa (${num(settings.leadTime) || 14} dni) + 2 tygodnie.</p>`;
  // W drodze
  const tr = inTransit();
  $('home-transit-sub').textContent = tr.length ? `${sum(tr, g => g.n)} szt. · ${fmt(sum(tr, g => g.capital))}` : '';
  $('home-transit').innerHTML = tr.length ? tr.map(g => li('local_shipping', 'acc', `${g.n}× ${esc(g.name)}`, `${esc(g.src)} · zamówione ${dShort(g.date)} (${daysBetween(g.date, T)} dni temu) · ${fmt(g.capital)} netto`,
    `<button class="btn-small" onclick="UI.deliver('${esc(g.key)}')">Dostarczone</button>`)).join('') : empty('Nic nie jest w drodze. Przy zakupie zaznacz „W drodze”, a towar pojawi się tutaj.');
  // Bestsellery
  const by = new Map();
  m30.forEach(s => { const k = s.kind === 'card' ? '__cards' : normName(s.name); if (!by.has(k)) by.set(k, { name: s.kind === 'card' ? 'Karty single' : s.name, k: s.kind, u: 0, g: 0, p: 0, ch: {} }); const o = by.get(k); o.u++; o.g += s.gross; o.p += pnlNet(s); o.ch[s.channel] = (o.ch[s.channel] || 0) + 1; });
  const best = [...by.values()].sort((a, b) => b.p - a.p).slice(0, 6);
  $('home-best').innerHTML = best.length ? best.map(o => `<div class="cx-item">${kindIco(o.k)}<div class="bd"><div class="t">${esc(o.name)}</div><div class="d">${o.u} szt. · sprzedaż ${fmt(o.g)} · ${Object.entries(o.ch).map(([c, n]) => `${dot(c)} ${esc(c)} ${n}`).join(' · ')}</div></div><div class="rt"><b class="pos">${fmt(o.p)}</b><span class="cx-note">marża ${pct(o.p / o.g * 100)}</span></div></div>`).join('') : empty('Brak sprzedaży w ostatnich 30 dniach.');
}

/* ============================================================
   MAGAZYN
   ============================================================ */
let stockKind = 'box', stockF = 'all';
function stockFilter(f) { stockKind = 'box'; stockF = f; segSet('stock-kind', 'box'); segSet('stock-filter', f); go('stock'); }
function priceChips(it, gKey, kind) {
  return `<div class="cx-prices">${CHS().slice(0, 4).map(c => { const P = recommend(it, c); const r = calc(it, c, P); return `<button class="cx-price" onclick="UI.openSell('${kind}','${esc(gKey)}','${esc(c.name)}',${P})"><div class="c">${dot(c.name)}${esc(c.name)}</div><div class="p">${fmt(P)}</div><div class="z ${r.profit >= 0 ? 'pos' : 'neg'}">zysk ${fmt(r.profit)}</div></button>`; }).join('')}</div>`;
}
function renderStock() {
  $('stock-filter').style.display = stockKind === 'box' ? '' : 'none';
  const q = getv('stock-q').trim().toLowerCase();
  if (stockKind === 'card') return renderStockCards(q);
  const v = chOf(CHS()[0] ? CHS()[0].name : 'Vinted');
  const H = onHand(), slowD = num(settings.slowDays) || 45, slow = H.filter(g => g.days > slowD);
  $('stock-kpi').innerHTML = [
    kpi('Boxy na stanie', `${sum(H, g => g.n)} szt.`, `${H.length} produktów${inTransit().length ? ` · ${sum(inTransit(), g => g.n)} szt. w drodze` : ''}`),
    kpi('Koszt netto', fmt(sum(H, g => g.capital)), `brutto ${fmt(sum(H, g => g.n * g.gross))} · VAT odliczony ${fmt(sum(H, g => g.n * g.vat))}`),
    kpi('Zysk przy cenach rekomendowanych', fmt(sum(H, g => g.n * calc(gItem(g), v, recommend(gItem(g), v)).profit)), `wszystko na ${esc(v.name)}, ROI ${TM()}%`, 'pos'),
    kpi(`Leżą ponad ${slowD} dni`, fmt(sum(slow, g => g.capital)), `${sum(slow, g => g.n)} szt. — warto obniżyć cenę`, slow.length ? 'warn' : '')
  ].join('');
  $('stock-note').innerHTML = `Ceny przy kanałach: rekomendowana cena dla <b>ROI ${TM()}%</b> i zysk na czysto — po VAT, prowizji, wysyłce i ryczałcie ${RYC()}%. Kliknij cenę, żeby sprzedać.`;
  const L = G.filter(g => (stockF === 'all' || (stockF === 'slow' && g.days > slowD && !g.transit) || (stockF === 'novat' && g.vat < 0.005) || (stockF === 'transit' && g.transit)) && (!q || g.name.toLowerCase().includes(q)));
  $('stock-list').innerHTML = L.length ? L.map(g => {
    const ls = LAST[g.name], ded = g.vat > 0.005, it = gItem(g);
    return `<div class="cx-prod">
      <div><div class="name">${kindIco('box')}<span class="cx-qty">×${g.n}</span><span>${esc(g.name)}</span></div>
        <div class="meta">${g.transit ? '<span class="cx-pill acc"><span class="material-symbols-outlined" style="font-size:14px">local_shipping</span>w drodze</span>' : ''}${vatOn() ? `<span class="cx-pill ${ded ? 'pos' : 'warn'}">${ded ? 'VAT odliczony' : 'bez odliczenia VAT'}</span>` : ''}<span>${esc(g.src)}</span><span class="${g.days > slowD && !g.transit ? 'warn' : ''}">${g.days} dni</span>${ls ? `<span>ostatnio ${fmt(ls.gross)} na ${esc(ls.channel)} (${dShort(ls.date)})</span>` : ''}</div></div>
      <div class="cost"><b>${fmt2(g.cost)}</b> <span class="mut">/szt.</span><div class="s">${ded ? `brutto ${fmt2(g.gross)} − VAT ${fmt2(g.vat)}` : `brutto ${fmt2(g.gross)}${vatOn() ? ', VAT nie wraca' : ''}`}</div></div>
      ${priceChips(it, g.key, 'box')}
      <div class="act">${g.transit ? `<button class="btn-small" onclick="UI.deliver('${esc(g.key)}')">Dostarczone</button>` : `<button class="btn-small" onclick="UI.openOpen('${esc(g.key)}')">Otwórz</button><button class="btn-small primary" onclick="UI.openSell('box','${esc(g.key)}')">Sprzedaj</button>`}</div>
    </div>`;
  }).join('') : empty('Nic tu nie ma dla tych filtrów.');
}
function renderStockCards(q) {
  const T = today(), c90 = deals().filter(s => s.kind === 'card' && s.date >= addDays(T, -90));
  $('stock-kpi').innerHTML = [
    kpi('Karty na stanie', `${M.held.length} szt.`, `${M.held.filter(c => c.marketValue >= 20).length} wycenionych na 20 zł i więcej`),
    kpi('Koszt netto', fmt(M.heldBasis), 'część kosztu boxów, z których pochodzą'),
    kpi('Wycena', fmt(M.heldValue), 'brutto, wg ostatnich wycen'),
    kpi('Sprzedane — 90 dni', `${c90.length} szt.`, `${fmt(sum(c90, s => s.gross))} · zysk ${fmt(sum(c90, pnlNet))}`, 'pos')
  ].join('');
  const cc = settings.cardChannel || 'Vinted';
  $('stock-note').innerHTML = `Karty sprzedajesz głównie na <b>${esc(cc)}</b> — sugerowana cena to wycena (albo koszt, jeśli wyższy). Posortowane od najcenniejszych.`;
  const all = M.held.slice().sort((a, b) => b.marketValue - a.marketValue);
  const L = all.filter(c => !q || cardTitle(c).toLowerCase().includes(q)).slice(0, 80);
  $('stock-list').innerHTML = L.length ? `<div class="tc-tbl-wrap"><table class="tc-tbl"><thead><tr><th></th><th>Karta</th><th class="num">Koszt netto</th><th class="num">Wycena</th><th class="num">Cena na ${esc(cc)}</th><th class="num">Zysk</th><th></th></tr></thead><tbody>` +
    L.map(c => { const it = cItem(c), P = Math.max(Math.round(c.marketValue || 0), recommend(it, chOf(cc), 0)), r = calc(it, chOf(cc), P);
      return `<tr><td style="width:40px">${kindIco('card')}</td><td><div class="cd-name"><span class="t">${esc(c.player)}${c.rookie ? ' <span class="cd-tag rc">RC</span>' : ''}${c.auto ? ' <span class="cd-tag auto">AUTO</span>' : ''}</span><span class="s">${esc([c.product, c.parallel, c.run ? '/' + String(c.run).replace(/^\//, '') : ''].filter(Boolean).join(' · '))}</span></div></td>
        <td class="num">${fmt2(c.basis)}</td><td class="num">${c.hasValuation ? fmt(c.marketValue) : '—'}</td><td class="num"><b>${fmt(P)}</b></td><td class="num ${r.profit >= 0 ? 'pos' : 'neg'}">${fmt(r.profit)}</td>
        <td><button class="btn-small" onclick="UI.openSell('card','${c.id}')">Sprzedaj</button></td></tr>`; }).join('') +
    `</tbody></table></div>${all.length > 80 && !q ? `<p class="cx-note" style="padding:10px 16px">Pokazuję 80 najcenniejszych z ${all.length} — wpisz nazwisko, żeby znaleźć resztę.</p>` : ''}` : empty('Brak kart dla tego wyszukiwania.');
}

/* ============================================================
   SPRZEDAŻE
   ============================================================ */
const SF = { k: '', ch: '', q: '' };
function renderSales() {
  const L0 = salesToDate(), D0 = deals();
  const rev = sum(L0, s => s.gross), vat = sum(L0, s => s.vat), fee = sum(L0, s => s.fees), p = sum(L0, pnlNet), ryc = sum(L0, saleRyc);
  const nb = D0.filter(s => s.kind === 'box').length;
  $('sales-kpi').innerHTML = [
    kpi('Sprzedaż brutto', fmt(rev), `${D0.length} transakcji · ${nb} boxów, ${D0.length - nb} kart`),
    kpi('VAT należny', fmt(vat), vatOn() ? `od sprzedaży od ${dFull(vatFrom())}` : 'VAT wyłączony'),
    kpi('Prowizje, wysyłka, ryczałt', fmt(fee + ryc), `prowizje i wysyłka ${fmt(fee)} · ryczałt ${fmt(ryc)}`),
    kpi('Zysk na czysto', fmt(p), `marża ${pct(p / rev * 100)} · śr. ${Math.round(M.avgDaysToSell || 0)} dni na stanie`, 'pos')
  ].join('');
  $('sf-ch').innerHTML = [['', 'Wszystkie kanały'], ...CHS().map(c => [c.name, c.name])].map(([v, l]) => `<button data-v="${esc(v)}" class="${SF.ch === v ? 'active' : ''}" onclick="UI.salesCh('${esc(v)}')">${l}</button>`).join('');
  const all = M.sales.filter(s => (!SF.k || s.kind === SF.k) && (!SF.ch || s.channel === SF.ch) && (!SF.q || s.name.toLowerCase().includes(SF.q)));
  if (!all.length) { $('sales-months').innerHTML = `<div class="tc-card">${empty('Brak sprzedaży dla tych filtrów.')}</div>`; return; }
  const byM = {}; all.forEach(s => (byM[mk(s.date)] = byM[mk(s.date)] || []).push(s));
  const ks = Object.keys(byM).sort().reverse();
  const openK = ks.find(k => k <= mk(today()));
  $('sales-months').innerHTML = ks.map(k => {
    const L = byM[k], r = sum(L, s => s.gross), pr = sum(L, pnlNet), n = sum(L, s => s.qty);
    const fut = k > mk(today());
    return `<details class="cx-month" ${k === openK ? 'open' : ''}><summary><span class="mname">${mFull(k)}${fut ? ' <span class="cx-pill warn">przyszła data?</span>' : ''}</span>
      <span class="st"><span><b>${n}</b> szt.</span><span>sprzedaż <b>${fmt(r)}</b></span><span>VAT <b>${fmt(sum(L, s => s.vat))}</b></span><span>koszty <b>${fmt(sum(L, s => s.fees) + sum(L, saleRyc))}</b></span><span>zysk <b class="${pr >= 0 ? 'pos' : 'neg'}">${fmt(pr)}</b></span></span>
      <span style="margin-left:auto;display:flex;gap:4px;flex-wrap:wrap">${CHS().map(c => { const x = L.filter(s => s.channel === c.name && !s.isReturn).length; return x ? `<span class="cx-pill">${dot(c.name)}${x}</span>` : ''; }).join('')}</span></summary>
      <div class="tc-tbl-wrap"><table class="tc-tbl"><thead><tr><th></th><th>Data</th><th>Produkt</th><th>Kanał</th><th class="num">Cena</th><th class="num">VAT</th><th class="num">Prowizja + wysyłka</th><th class="num">Ryczałt</th><th class="num">Koszt</th><th class="num">Zysk</th></tr></thead><tbody>
      ${L.map(s => `<tr class="click" onclick="${s.isReturn ? `UI.undoReturn('${s.kind}','${s.id}','${s.retId}')` : s.returned ? `UI.toastInfo('Ta sprzedaż została zwrócona — zwrot widać w dniu zwrotu')` : `UI.editSale('${s.kind}','${s.id}')`}">
        <td style="width:40px">${kindIco(s.kind)}</td><td class="cd-mono">${dShort(s.date)}</td><td>${esc(s.name)}${s.isReturn ? ' <span class="cx-pill neg">zwrot</span>' : s.returned ? ' <span class="cx-pill">zwrócona</span>' : ''}${s.sale && s.sale.invoiced ? ' <span class="cx-pill acc">faktura</span>' : ''}</td>
        <td style="white-space:nowrap">${dot(s.channel)} ${esc(s.channel)}</td><td class="num">${fmt2(s.gross)}</td><td class="num mut">${s.vat ? fmt2(s.vat) : '—'}</td><td class="num mut">${s.fees ? fmt2(s.fees) : '—'}</td><td class="num mut">${fmt2(saleRyc(s))}</td><td class="num mut">${fmt2(s.basis)}</td><td class="num ${pnlNet(s) >= 0 ? 'pos' : 'neg'}"><b>${fmt2(pnlNet(s))}</b></td></tr>`).join('')}
      </tbody></table></div></details>`;
  }).join('');
}

/* ============================================================
   ZAKUPY — zamówienia (grupa boxów z jednego sklepu i dnia)
   ============================================================ */
const orderKeyOf = b => b.orderId || `${b.date}|${b.source || ''}`;
function buildOrders() {
  const m = new Map();
  for (const b of M.boxes) {
    const k = orderKeyOf(b);
    if (!m.has(k)) m.set(k, { key: k, date: b.date, source: b.source || '', shopId: b.shopId || null, doc: b.vatDoc, items: [], st: {} });
    const o = m.get(k); o.items.push(b);
    const st = b.status === 'sealed' && b.transit ? 'transit' : b.status; o.st[st] = (o.st[st] || 0) + 1;
  }
  return [...m.values()].map(o => ({ ...o, g: sum(o.items, b => b.landedGross), vat: sum(o.items, b => b.vatDed) })).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
const shopOfBox = b => (state.shops || []).find(s => s.id === b.shopId) || (state.shops || []).find(s => (s.alias || []).includes(b.source) || s.name === b.source);
const DOC_LBL = { fv: 'Faktura VAT', oss: 'FV 23% z UE', wnt: 'B2B (WNT)', import: 'Import', foreign: 'bez odliczenia', private: 'od prywatnej', margin: 'VAT-marża', unknown: 'nieokreślony' };
const ST_LBL = { sealed: ['na stanie', 'acc'], sold: ['sprzedane', 'pos'], opened: ['otwarte', ''], transit: ['w drodze', 'warn'] };
function renderBuys() {
  const all = M.boxes, g = sum(all, b => b.landedGross), v = sum(all, b => b.vatDed);
  const nod = all.filter(b => b.vatDed < 0.005 && b.vatDoc !== 'wnt');
  $('buys-kpi').innerHTML = [
    kpi('Wydane na towar', fmt(g), `${nBoxes(all.length)} w ${ORDERS.length} zamówieniach`),
    kpi('VAT odzyskany', fmt(v), 'z faktur i korekty za towar na stanie', 'pos'),
    kpi('Koszt netto', fmt(g - v), 'tyle naprawdę kosztował towar'),
    kpi('Bez odliczenia VAT', fmt(sum(nod, b => b.landedGross)), 'VAT naliczony przez sklep został w koszcie', 'warn')
  ].join('');
  $('buys-wrap').innerHTML = `<table class="tc-tbl"><thead><tr><th>Data</th><th>Sklep</th><th>Co</th><th>Dokument</th><th class="num">Brutto</th><th class="num">VAT</th><th class="num">Netto</th><th>Status</th></tr></thead><tbody>` +
    ORDERS.map((o, i) => {
      const cnt = {}; o.items.forEach(b => { cnt[b.name] = (cnt[b.name] || 0) + 1; });
      const sh = shopOfBox(o.items[0]);
      return `<tr class="click" onclick="UI.openBuy(${i})"><td class="cd-mono">${dShort(o.date)}</td><td>${sh ? `<span class="cx-cc">${sh.cc}</span> ` : ''}<b>${esc(sh ? sh.name : (o.source || '—'))}</b></td>
        <td style="font-size:12.5px">${Object.entries(cnt).map(([n, q]) => `${q > 1 ? q + '× ' : ''}${esc(n)}`).join('<br>')}</td>
        <td>${vatOn() ? `<span class="cx-pill ${o.vat > 0.005 || o.doc === 'wnt' ? 'pos' : 'warn'}">${esc(DOC_LBL[o.doc] || o.doc || '—')}</span>` : '—'}</td>
        <td class="num">${fmt2(o.g)}</td><td class="num pos">${o.vat > 0.005 ? fmt2(o.vat) : '—'}</td><td class="num">${fmt2(o.g - o.vat)}</td>
        <td>${Object.entries(o.st).map(([s, q]) => `<span class="cx-pill ${(ST_LBL[s] || ['', ''])[1]}">${(ST_LBL[s] || [s])[0]} ${q}</span>`).join(' ')}</td></tr>`;
    }).join('') + '</tbody></table>';
}

/* ============================================================
   SKLEPY — baza z oznaczeniem B2B
   ============================================================ */
const COUNTRIES = { PL: 'Polska', DE: 'Niemcy', NL: 'Holandia', ES: 'Hiszpania', FR: 'Francja', IT: 'Włochy', SE: 'Szwecja', BE: 'Belgia', AT: 'Austria', IE: 'Irlandia', DK: 'Dania', CZ: 'Czechy', UK: 'Wielka Brytania', US: 'USA', '??': 'Kraj do uzupełnienia' };
const EU = ['DE', 'NL', 'ES', 'FR', 'IT', 'SE', 'BE', 'AT', 'IE', 'DK', 'CZ'];
const zone = cc => cc === 'PL' ? 'pl' : (EU.includes(cc) || cc === '??') ? 'eu' : 'out';
const SHOP_ST = {
  b2b:     { l: 'B2B — faktura 0% (WNT)', s: 'B2B', doc: 'wnt', ok: true, tone: 'pos', zones: ['eu'], hint: 'Podajesz numer VAT-UE, sklep nie dolicza VAT. W JPK naliczasz i odliczasz 23% — wychodzi na zero.' },
  fv:      { l: 'Faktura z 23% VAT', s: 'Faktura VAT', doc: 'fv', ok: true, tone: 'pos', zones: ['pl'], hint: 'Faktura na firmę (albo paragon z NIP do 450 zł) — VAT odliczasz w JPK.' },
  import:  { l: 'Import z dokumentem celnym', s: 'Import', doc: 'import', ok: true, tone: 'pos', zones: ['out'], hint: 'Spoza UE: VAT z odprawy odliczysz, jeśli masz dokument celny.' },
  none:    { l: 'Tylko z VAT — bez odliczenia', s: 'Bez odliczenia', doc: 'foreign', ok: false, tone: 'warn', zones: ['pl', 'eu', 'out'], hint: 'Sklep dolicza VAT jak konsumentowi — ten VAT zostaje w koszcie.' },
  unknown: { l: 'Nie wiem — do sprawdzenia', s: 'Do sprawdzenia', doc: 'foreign', ok: false, tone: '', zones: ['pl', 'eu', 'out'], hint: 'Dopóki nie sprawdzisz, zakup liczy się jak bez odliczenia.' }
};
function shopStats(sh) {
  const B = M.boxes.filter(b => b.shopId === sh.id || (!b.shopId && ((sh.alias || []).includes(b.source) || b.source === sh.name)));
  return { n: B.length, orders: new Set(B.map(orderKeyOf)).size, g: sum(B, b => b.landedGross), last: B.map(b => b.date).sort().pop() || null, noDed: sum(B.filter(b => b.vatDed < 0.005 && b.vatDoc !== 'wnt'), b => b.landedGross) };
}
let shF = 'all';
function renderShops() {
  const S = state.shops || [], st = S.map(s => ({ s, x: shopStats(s) }));
  const all = sum(st, o => o.x.g), noDed = sum(st, o => o.x.noDed);
  $('shops-kpi').innerHTML = [
    kpi('Sklepy', S.length, `w ${new Set(S.map(s => s.cc).filter(c => c !== '??')).size} krajach`),
    kpi('Odliczam VAT', S.filter(s => (SHOP_ST[s.st] || {}).ok).length, 'B2B z UE albo faktura z Polski', 'pos'),
    kpi('Do sprawdzenia', S.filter(s => s.st === 'unknown').length, 'zapytaj o konto B2B / fakturę 0%', S.some(s => s.st === 'unknown') ? 'warn' : ''),
    kpi('Kupione bez odliczenia', fmt(noDed), `${pct(all ? noDed / all * 100 : 0)} zakupów · VAT został w koszcie`, 'warn')
  ].join('');
  const q = getv('shops-q').trim().toLowerCase();
  const vis = st.filter(({ s }) => (shF === 'all' || (shF === 'ok' && (SHOP_ST[s.st] || {}).ok) || (shF === 'none' && s.st === 'none') || (shF === 'unknown' && s.st === 'unknown')) && (!q || (s.name + ' ' + (s.url || '')).toLowerCase().includes(q)));
  const byC = {}; vis.forEach(o => (byC[o.s.cc] = byC[o.s.cc] || []).push(o));
  const order = Object.keys(byC).sort((a, b) => (a === '??') - (b === '??') || sum(byC[b], o => o.x.g) - sum(byC[a], o => o.x.g));
  $('shops-list').innerHTML = order.length ? order.map(cc => {
    const L = byC[cc].sort((a, b) => b.x.g - a.x.g);
    return `<div class="tc-card" style="margin-bottom:12px"><div class="tc-card-head"><h3><span class="cx-cc">${cc}</span>&nbsp; ${COUNTRIES[cc] || cc}</h3><span class="sub">${cc === '??' ? 'kliknij „Edytuj” i uzupełnij kraj' : zone(cc) === 'eu' ? 'UE — odliczenie tylko przez B2B (faktura 0%)' : zone(cc) === 'pl' ? 'Polska — faktura z 23% VAT' : 'poza UE — import'} · ${L.length} ${plural(L.length, 'sklep', 'sklepy', 'sklepów')} · ${fmt(sum(L, o => o.x.g))}</span></div>` +
      L.map(({ s, x }) => `<div class="cx-shop"><div style="min-width:0"><div class="t">${esc(s.name)}</div><div class="s">${s.url ? esc(s.url) + ' · ' : ''}${esc(s.cur)}${s.note ? ' · ' + esc(s.note) : ''}</div></div>
        <div class="cx-chips sm">${Object.entries(SHOP_ST).filter(([k, v]) => v.zones.includes(zone(s.cc))).map(([k, v]) => `<button class="${s.st === k ? 'active ' + v.tone : ''}" title="${esc(v.hint)}" onclick="UI.setShopSt('${s.id}','${k}')">${v.s}</button>`).join('')}</div>
        <div class="st">${x.orders ? `${x.orders} zam. · ${x.n} szt.<br>${fmt(x.g)}${x.last ? ` · ost. ${dShort(x.last)}` : ''}` : 'brak zakupów'}</div>
        <div><button class="btn-small" onclick="UI.openShop('${s.id}')">Edytuj</button></div></div>`).join('') + '</div>';
  }).join('') : `<div class="tc-card">${empty('Brak sklepów.')}</div>`;
}
function setShopSt(id, st) { const s = state.shops.find(x => x.id === id); if (!s) return; s.st = st; commit(`${s.name}: ${SHOP_ST[st].l}`); }

/* ============================================================
   WYNIKI — wykresy w Chart.js, z tymi samymi osiami, legendą
   i tooltipem co reszta modułów (helpery z silnika).
   ============================================================ */
const R = { metric: 'g', kind: '', days: 90, per: 'm', chp: 0 };
const C = { blue: '#0057c0', blueSoft: 'rgba(0,87,192,0.28)', green: '#0b8a4a', ink: '#0f172a', grey: '#cbd5e6', greyLine: '#94a3b8', amber: '#d97706', violet: '#7c3aed', vat: '#cbd5e1', ryc: '#f2a7a0' };
const mv = s => R.metric === 'pnl' ? pnlNet(s) : s.gross;
const rSales = () => salesToDate().filter(s => !R.kind || s.kind === R.kind);
const rIn = (a, b) => rSales().filter(s => s.date >= a && s.date <= b);
const sumM = L => sum(L, mv);
const weekStart = d => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
const tip = () => ({ ...TOOLTIP, displayColors: true, callbacks: { label: ctx => { const v = ctx.parsed[ctx.chart.options.indexAxis === 'y' ? 'x' : 'y']; return `${ctx.dataset.label}: ${ctx.dataset.yAxisID === 'y1' ? v + '%' : fmtPLN0(v)}`; } } });
function baseOpts(extra = {}) {
  return { maintainAspectRatio: false, responsive: true, animation: { duration: 200 }, interaction: { mode: 'index', intersect: false },
    plugins: { legend: legendBottom(), tooltip: tip() }, scales: { x: axisCat(), y: axisPLN() }, ...extra };
}
const lineDs = (label, data, color, o = {}) => ({ type: 'line', label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.3, cubicInterpolationMode: 'monotone', spanGaps: false, ...o });
const barDs = (label, data, color, o = {}) => ({ type: 'bar', label, data, backgroundColor: color, borderRadius: 4, maxBarThickness: 26, ...o });

function pace(label, cur, prev, prevLabel, L, extra) {
  const p = sum(L, pnlNet), g = sum(L, s => s.gross);
  return `<div class="tc-kpi"><span class="k">${label}</span><span class="v">${fmt(cur)}${prev === null ? ' <span class="cx-delta flat">nowe</span>' : delta(cur, prev)}</span><span class="n">${prevLabel}${prev !== null ? `: <b>${fmt(prev)}</b>` : ''}</span><span class="n">${extra || `zysk ${fmt(p)} · marża ${g ? pct(p / g * 100) : '—'} · ${L.filter(s => !s.isReturn).length} szt.`}</span></div>`;
}

function renderResults() {
  const T = today(), k0 = mk(T), pk = addMonths(k0, -1), dom = +T.slice(8, 10), wd = (new Date(T + 'T00:00:00Z').getUTCDay() + 6) % 7;
  $('r-asof').textContent = `Stan na ${dFull(T)}`;
  /* Tempo */
  const ws = weekStart(T), pws = addDays(ws, -7);
  const today_ = rIn(T, T), lastWkDay = rIn(addDays(T, -7), addDays(T, -7));
  const wk = rIn(ws, T), pwk = rIn(pws, addDays(pws, wd));
  const mtd = rIn(k0 + '-01', T), pmtd = rIn(pk + '-01', pk + '-' + String(Math.min(dom, dim(pk))).padStart(2, '0'));
  const l30 = rIn(addDays(T, -29), T), p30 = rIn(addDays(T, -59), addDays(T, -30));
  const y = T.slice(0, 4), ytd = rIn(y + '-01-01', T), pytd = rIn((+y - 1) + '-01-01', (+y - 1) + T.slice(4));
  const pmFull = rSales().filter(s => mk(s.date) === pk);
  const rate28 = sumM(rIn(addDays(T, -27), T)) / 28, left = dim(k0) - dom;
  const fc = sumM(mtd) + left * (0.5 * (sumM(mtd) / dom) + 0.5 * rate28);
  $('r-pace').innerHTML = [
    pace('Dziś', sumM(today_), sumM(lastWkDay), `vs ${dShort(addDays(T, -7))}`, today_),
    pace('Tydzień do dziś', sumM(wk), sumM(pwk), 'vs poprzedni tydzień do tego dnia', wk),
    pace('Miesiąc do dziś', sumM(mtd), sumM(pmtd), `vs 1–${dom} ${MONTHS_PL[+pk.slice(5) - 1]}`, mtd),
    pace('Ostatnie 30 dni', sumM(l30), sumM(p30), 'vs poprzednie 30 dni', l30),
    pace('Rok do dziś', sumM(ytd), pytd.length ? sumM(pytd) : null, `vs ${+y - 1} do ${dShort(T)}`, ytd),
    pace('Prognoza miesiąca', fc, sumM(pmFull), `vs cały ${MNF[+pk.slice(5) - 1].toLowerCase()}`, mtd, `pół na pół: tempo z ${dom} dni miesiąca i średnia z 28 dni · zostało ${left} dni`)
  ].join('');
  /* Narracja */
  const c30 = deals().filter(s => s.date >= addDays(T, -29));
  const chS = CHS().map(c => { const L = c30.filter(s => s.channel === c.name); return { c: c.name, p: sum(L, pnlNet), b: sum(L, s => s.basis), g: sum(L, s => s.gross), f: sum(L, s => s.commission) }; }).filter(x => x.g);
  const top = chS.slice().sort((a, b) => b.p - a.p)[0], roiTop = chS.slice().sort((a, b) => b.p / b.b - a.p / a.b)[0], costly = chS.slice().sort((a, b) => b.f / b.g - a.f / a.g)[0];
  $('r-narr').innerHTML = `<span class="material-symbols-outlined">insights</span><span><strong>${MNF[+k0.slice(5) - 1]} do ${dom}. dnia:</strong> ${fmt(sumM(mtd))} ${R.metric === 'pnl' ? 'zysku' : 'przychodu'} z ${mtd.filter(s => !s.isReturn).length} transakcji${sumM(pmtd) ? `, ${delta(sumM(mtd), sumM(pmtd))} vs ${MONTHS_PL[+pk.slice(5) - 1]} do tego samego dnia` : ''}. Prognoza na koniec miesiąca: <strong>${fmt(fc)}</strong>.` +
    (top ? ` W 30 dni najwięcej zarobił <strong>${esc(top.c)}</strong> (${fmt(top.p)}), najwyższy ROI ma <strong>${esc(roiTop.c)}</strong> (${pct(roiTop.p / roiTop.b * 100)})${costly && costly.f ? `, najwięcej prowizji zjada <strong>${esc(costly.c)}</strong> (${(costly.f / costly.g * 100).toFixed(1)}% przychodu)` : ''}.` : ' W ostatnich 30 dniach nie było sprzedaży.') + '</span>';
  /* Tydzień i miesiąc narastająco */
  const cum = (from, n) => { let a = 0; return Array.from({ length: n }, (_, i) => { a += sumM(rIn(addDays(from, i), addDays(from, i))); return Math.round(a); }); };
  const cw = cum(ws, 7).map((v, i) => i <= wd ? v : null), pw = cum(pws, 7);
  const avg4 = Array.from({ length: 7 }, (_, i) => Math.round(sum([1, 2, 3, 4], k => cum(addDays(ws, -7 * k), 7)[i]) / 4));
  $('r-wk-sub').textContent = `${R.metric === 'pnl' ? 'zysk' : 'przychód'} · ${dShort(ws)}–${dShort(addDays(ws, 6))}`;
  renderChart('ch-week', { type: 'line', data: { labels: ['pn', 'wt', 'śr', 'cz', 'pt', 'sb', 'nd'], datasets: [
    lineDs('Ten tydzień', cw, C.blue, { borderWidth: 2.6, pointRadius: 3 }), lineDs('Poprzedni', pw, C.ink, { borderDash: [6, 4], borderWidth: 1.6 }), lineDs('Śr. 4 tygodni', avg4, C.greyLine, { borderDash: [2, 4], borderWidth: 1.6 })] }, options: baseOpts() });
  const nd = Math.max(dim(k0), dim(pk));
  const cm = cum(k0 + '-01', nd).map((v, i) => i < dom ? v : null), pm = cum(pk + '-01', dim(pk));
  const fcl = Array.from({ length: nd }, (_, i) => i < dom - 1 || i >= dim(k0) ? null : Math.round(cm[dom - 1] + (i - dom + 1) * (fc - cm[dom - 1]) / Math.max(1, left)));
  $('r-mo-sub').textContent = `${mLow(k0)} vs ${MNF[+pk.slice(5) - 1].toLowerCase()}`;
  renderChart('ch-month', { type: 'line', data: { labels: Array.from({ length: nd }, (_, i) => String(i + 1)), datasets: [
    lineDs(MNF[+k0.slice(5) - 1], cm, C.blue, { borderWidth: 2.6 }), lineDs(MNF[+pk.slice(5) - 1], pm, C.ink, { borderDash: [6, 4], borderWidth: 1.6 }), lineDs('Prognoza', fcl, C.blue, { borderDash: [2, 4], borderWidth: 1.8 })] }, options: baseOpts() });
  /* Dzień po dniu */
  const N = R.days, from = addDays(T, -(N - 1));
  const days = Array.from({ length: N }, (_, i) => addDays(from, i));
  const allV = [...Array.from({ length: 27 }, (_, i) => addDays(from, -(27 - i))), ...days].map(d => sumM(rIn(d, d)));
  const ma = k => days.map((_, i) => Math.round(sum(allV.slice(i + 27 - k + 1, i + 28)) / k));
  const dv = days.map(d => Math.round(sumM(rIn(d, d))));
  renderChart('ch-daily', { type: 'bar', data: { labels: days.map(dShort), datasets: [
    lineDs('Średnia 7 dni', ma(7), C.blue, { borderWidth: 2.2, order: 0 }), lineDs('Średnia 28 dni', ma(28), C.ink, { borderDash: [5, 4], borderWidth: 1.5, order: 1 }),
    barDs(R.metric === 'pnl' ? 'Zysk dnia' : 'Przychód dnia', dv, 'rgba(0,87,192,0.22)', { order: 2, maxBarThickness: 14, borderRadius: 2 })] },
    options: baseOpts({ scales: { x: { ...axisCat(), ticks: { ...axisCat().ticks, autoSkip: true, maxTicksLimit: 12 } }, y: axisPLN() } }) });
  const ma7 = ma(7), ma28 = ma(28), best = days.reduce((b, d, i) => dv[i] > b.v ? { d, v: dv[i] } : b, { d: null, v: 0 });
  $('r-daily-st').innerHTML = [
    [`Suma ${N} dni`, fmt(sum(dv)), `${rIn(from, T).filter(s => !s.isReturn).length} transakcji`],
    ['Średnia 7 dni', fmt(ma7[N - 1]) + ' ' + delta(ma7[N - 1], ma7[Math.max(0, N - 8)]), 'vs tydzień temu'],
    ['Średnia 28 dni', fmt(ma28[N - 1]) + ' ' + delta(ma28[N - 1], ma28[Math.max(0, N - 29)]), 'vs 28 dni temu'],
    ['Dni ze sprzedażą', `${dv.filter(v => v).length}/${N}`, pct(dv.filter(v => v).length / N * 100) + ' dni'],
    ['Najlepszy dzień', fmt(best.v), best.d ? dFull(best.d) : '—']
  ].map(([k, v, n]) => `<div><div class="k">${k}</div><div class="v">${v}</div><div class="n">${n}</div></div>`).join('');
  /* Trend per okres */
  const per = R.per, keyOf = d => per === 'w' ? weekStart(d) : mk(d);
  const first = [...M.boxes.map(b => b.date), ...rSales().map(s => s.date)].filter(Boolean).sort()[0] || T;
  const keys = []; for (let k = keyOf(first); k <= keyOf(T);) { keys.push(k); k = per === 'w' ? addDays(k, 7) : addMonths(k, 1); }
  const lab = k => per === 'w' ? dShort(k) : monthLabel(k);
  const buyOf = k => sum(M.boxes.filter(b => keyOf(b.date) === k), b => b.landedGross) + sum(M.cards.filter(c => c.acq !== 'box' && keyOf(c.date) === k), c => cardOwnCost(c));
  const stat = k => { const L = rSales().filter(s => keyOf(s.date) === k); const g = sum(L, s => s.gross), p = sum(L, pnlNet), b = sum(L, s => s.basis);
    return { k, L, n: sum(L, s => s.qty), g, p, b, com: sum(L, s => s.commission), sh: sum(L, s => s.shipping), vat: sum(L, s => s.vat), ryc: sum(L, saleRyc), m: g ? p / g * 100 : null, roi: b ? p / b * 100 : null, buy: buyOf(k), cur: k === keyOf(T) }; };
  const allP = keys.map(stat), P = per === 'w' ? allP.slice(-13) : allP;
  $('r-tr-t').textContent = (R.metric === 'pnl' ? 'Zysk' : 'Przychód') + (per === 'w' ? ' per tydzień' : ' per miesiąc');
  renderChart('ch-trend', { type: 'bar', data: { labels: P.map(x => lab(x.k)), datasets: [
    lineDs('Marża %', P.map(x => x.m == null ? null : Math.round(x.m)), C.ink, { yAxisID: 'y1', borderWidth: 1.6, pointRadius: 3, order: 0 }),
    barDs('Zakupy', P.map(x => Math.round(x.buy)), C.grey, { order: 2 }),
    barDs(R.metric === 'pnl' ? 'Zysk' : 'Przychód', P.map(x => Math.round(R.metric === 'pnl' ? x.p : x.g)), C.blue, { order: 1 })] },
    options: baseOpts({ plugins: { legend: legendBottom(), tooltip: tip() }, scales: { x: axisCat(), y: axisPLN(), y1: { ...axisPct(), position: 'right', grid: { display: false } } } }) });
  let a1 = 0, a2 = 0, a3 = 0;
  const cg = allP.map(x => (a1 += x.g)), cp = allP.map(x => (a2 += x.p)), cb = allP.map(x => (a3 += x.buy));
  $('r-cum-sub').textContent = `${fmt(a1)} przychodu · ${fmt(a2)} zysku · ${fmt(a3)} zakupów`;
  renderChart('ch-cum', { type: 'line', data: { labels: keys.map(lab), datasets: [
    lineDs('Przychód', cg.map(Math.round), C.blue, { fill: 'origin', backgroundColor: 'rgba(0,87,192,0.08)' }),
    lineDs('Zysk na czysto', cp.map(Math.round), C.green, { fill: 'origin', backgroundColor: 'rgba(11,138,74,0.08)' }),
    lineDs('Zakupy', cb.map(Math.round), C.greyLine, { borderDash: [5, 4], borderWidth: 1.6 })] }, options: baseOpts() });
  const tot = { n: sum(P, x => x.n), g: sum(P, x => x.g), b: sum(P, x => x.b), com: sum(P, x => x.com), sh: sum(P, x => x.sh), vat: sum(P, x => x.vat), ryc: sum(P, x => x.ryc), p: sum(P, x => x.p), buy: sum(P, x => x.buy) };
  $('r-pl-sub').textContent = per === 'w' ? 'ostatnie 13 tygodni · Δ vs poprzedni okres' : 'Δ vs poprzedni miesiąc';
  $('r-pl').innerHTML = `<table class="tc-tbl"><thead><tr><th>Okres</th><th class="num">Szt.</th><th class="num">Przychód</th><th class="num">Δ</th><th class="num">Koszt towaru</th><th class="num">Prowizje</th><th class="num">Wysyłka</th><th class="num">VAT</th><th class="num">Ryczałt</th><th class="num">Zysk</th><th class="num">Δ zysku</th><th class="num">Marża</th><th class="num">ROI</th><th class="num">Zakupy</th></tr></thead><tbody>` +
    P.slice().reverse().map((x, i, arr) => { const pv = arr[i + 1]; return `<tr><td style="white-space:nowrap"><b>${per === 'w' ? `${dShort(x.k)}–${dShort(addDays(x.k, 6))}` : mFull(x.k)}</b>${x.cur ? ' <span class="cx-pill acc">w toku</span>' : ''}</td><td class="num">${x.n}</td><td class="num"><b>${fmt(x.g)}</b></td><td class="num">${pv ? delta(x.g, pv.g) : ''}</td><td class="num mut">${fmt(x.b)}</td><td class="num mut">${x.com ? fmt(x.com) : '—'}</td><td class="num mut">${x.sh ? fmt(x.sh) : '—'}</td><td class="num mut">${x.vat ? fmt(x.vat) : '—'}</td><td class="num mut">${x.ryc ? fmt(x.ryc) : '—'}</td><td class="num ${x.p >= 0 ? 'pos' : 'neg'}"><b>${fmt(x.p)}</b></td><td class="num">${pv ? delta(x.p, pv.p) : ''}</td><td class="num">${pct(x.m)}</td><td class="num">${pct(x.roi)}</td><td class="num mut">${x.buy ? fmt(x.buy) : '—'}</td></tr>`; }).join('') +
    `</tbody><tfoot><tr><td>Razem</td><td class="num">${tot.n}</td><td class="num">${fmt(tot.g)}</td><td></td><td class="num">${fmt(tot.b)}</td><td class="num">${fmt(tot.com)}</td><td class="num">${fmt(tot.sh)}</td><td class="num">${fmt(tot.vat)}</td><td class="num">${fmt(tot.ryc)}</td><td class="num">${fmt(tot.p)}</td><td></td><td class="num">${pct(tot.p / tot.g * 100)}</td><td class="num">${pct(tot.p / tot.b * 100)}</td><td class="num">${fmt(tot.buy)}</td></tr></tfoot></table>`;
  /* Kanały */
  const cf = R.chp ? addDays(T, -(R.chp - 1)) : '0000';
  const CL = rSales().filter(s => s.date >= cf);
  const names = [...new Set(CL.map(s => s.channel))];
  const CS = names.map(n => { const L = CL.filter(s => s.channel === n); return { c: n, n: sum(L, s => s.qty), g: sum(L, s => s.gross), p: sum(L, pnlNet), b: sum(L, s => s.basis), com: sum(L, s => s.commission), sh: sum(L, s => s.shipping), vat: sum(L, s => s.vat) - sum(L, s => (s.feeVatIn || 0) + (s.shipVatIn || 0)), ryc: sum(L, saleRyc), days: (() => { const d = L.filter(s => s.days != null); return d.length ? sum(d, s => s.days) / d.length : 0; })() }; })
    .filter(x => Math.abs(x.g) > 0.5).sort((a, b) => b.g - a.g);
  renderChart('ch-split', CS.length ? { type: 'bar', data: { labels: CS.map(x => x.c), datasets: [
    barDs('Koszt towaru', CS.map(x => Math.round(x.b)), C.greyLine, { stack: 's' }), barDs('Prowizje', CS.map(x => Math.round(x.com)), C.amber, { stack: 's' }),
    barDs('Wysyłka', CS.map(x => Math.round(x.sh)), C.violet, { stack: 's' }), barDs('VAT', CS.map(x => Math.round(x.vat)), C.vat, { stack: 's' }),
    barDs('Ryczałt', CS.map(x => Math.round(x.ryc)), C.ryc, { stack: 's' }), barDs('Zysk', CS.map(x => Math.round(Math.max(0, x.p))), C.green, { stack: 's' })] },
    options: baseOpts({ indexAxis: 'y', interaction: { mode: 'nearest', intersect: true }, scales: { x: { ...axisPLN(), stacked: true }, y: { ...axisCat(), stacked: true } } }) } : null);
  const tp = sum(CS, x => x.p), tg = sum(CS, x => x.g);
  const bp = CS.slice().sort((a, b) => b.p - a.p)[0], br = CS.slice().sort((a, b) => b.p / b.b - a.p / a.b)[0], bc = CS.slice().sort((a, b) => (b.com + b.sh) / b.g - (a.com + a.sh) / a.g)[0], bf = CS.slice().filter(x => x.days).sort((a, b) => a.days - b.days)[0];
  $('r-ins').innerHTML = CS.length ? [
    li('emoji_events', 'pos', `Najwięcej zarabia ${esc(bp.c)}`, `${fmt(bp.p)} zysku · ${pct(bp.p / tp * 100)} całego zysku przy ${pct(bp.g / tg * 100)} przychodu`),
    li('percent', 'acc', `Najwyższy ROI: ${esc(br.c)}`, `${pct(br.p / br.b * 100)} na koszcie towaru · marża ${pct(br.p / br.g * 100)}`),
    li('payments', 'warn', `Najdroższy kanał: ${esc(bc.c)}`, `prowizje i wysyłka ${((bc.com + bc.sh) / bc.g * 100).toFixed(1)}% przychodu · ${fmt(bc.com + bc.sh)} oddane`),
    bf ? li('bolt', 'mut', `Najszybciej schodzi na ${esc(bf.c)}`, `średnio ${Math.round(bf.days)} dni od zakupu do sprzedaży`) : ''
  ].join('') : empty('Brak sprzedaży w tym okresie.');
  $('r-ch').innerHTML = CS.length ? `<table class="tc-tbl"><thead><tr><th>Kanał</th><th class="num">Szt.</th><th class="num">Przychód</th><th class="num">Udział</th><th class="num">Koszt towaru</th><th class="num">Prowizje</th><th class="num">Wysyłka</th><th class="num">Ryczałt</th><th class="num">Zysk</th><th class="num">Marża</th><th class="num">ROI</th><th class="num">Zysk/szt.</th><th class="num">Śr. dni</th></tr></thead><tbody>` +
    CS.map(x => `<tr><td><b>${dot(x.c)} ${esc(x.c)}</b>${x === bp ? ' <span class="cx-pill pos">top zysk</span>' : ''}${x === br ? ' <span class="cx-pill acc">top ROI</span>' : ''}</td><td class="num">${x.n}</td><td class="num">${fmt(x.g)}</td><td class="num">${pct(x.g / tg * 100)}</td><td class="num mut">${fmt(x.b)}</td><td class="num mut">${x.com ? fmt(x.com) : '—'}</td><td class="num mut">${x.sh ? fmt(x.sh) : '—'}</td><td class="num mut">${fmt(x.ryc)}</td><td class="num pos"><b>${fmt(x.p)}</b></td><td class="num">${pct(x.p / x.g * 100)}</td><td class="num">${pct(x.p / x.b * 100)}</td><td class="num">${fmt(x.n ? x.p / x.n : 0)}</td><td class="num">${Math.round(x.days)}</td></tr>`).join('') + '</tbody></table>' : '';
  renderRecovery(); renderBreaks(); renderRotation();
}

/* Odzysk kapitału — kiedy biznes zaczyna finansować się sam. */
function renderRecovery() {
  const r = capitalRecovery();
  const spent = r.spent, back = r.cashBack, missing = r.missing, stock = r.stock;
  const covered = Math.min(stock, missing), gap = Math.max(0, missing - stock);
  const pb = spent ? back / spent * 100 : 0, ps = spent ? covered / spent * 100 : 0, pg = spent ? gap / spent * 100 : 0;
  const gross = missing / (1 - (r.feeRate || 0));
  const mode = settings.recStock === 'cost' ? 'cost' : 'market';
  $('r-rec').innerHTML = `<div class="tc-card-head"><h3>Ile z wydanych pieniędzy już wróciło</h3><span class="seg" id="rec-mode"><button data-v="market" class="${mode === 'market' ? 'active' : ''}">towar po wycenie</button><button data-v="cost" class="${mode === 'cost' ? 'active' : ''}">po cenie zakupu</button></span></div>
    <div class="tc-card-body">
      <div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-start">
        <p class="cx-note" style="max-width:720px">Cały pasek to wszystko, co wydałeś na biznes. Zielone wróciło gotówką (po rozliczeniu VAT), niebieskie stoi w towarze, szare to luka, której nie pokrywa nawet cały magazyn.</p>
        <div style="text-align:right"><div style="font-size:30px;font-weight:700;font-family:var(--mono)">${pct(pb)}</div><div class="cx-note">odzyskane gotówką · zostało ${fmt(missing)}</div></div></div>
      <div class="cx-recbar"><div style="width:${pb}%;background:var(--tc-pos)">Wróciło ${fmt(back)}</div><div style="width:${ps}%;background:var(--tc-accent)">Pokryte towarem ${fmt(covered)}</div>${pg > 0 ? `<div style="width:${pg}%;background:var(--tc-line-strong)"></div>` : ''}</div>
      <div class="cx-note" style="display:flex;justify-content:space-between"><span>0 zł</span><span>próg zwrotu kapitału: ${fmt(spent)}</span></div>
      <div class="cx-tiles">${[
        ['Wydane od startu', fmt(spent), r.firstDate ? `od ${dFull(r.firstDate)} · śr. ${fmt(r.lifeSpendRate || 0)}/mies.` : '', ''],
        ['Wróciło w gotówce', fmt(back), `${pct(pb)} wydatków · sprzedaż po VAT + odzyskany VAT`, 'pos'],
        ['Zostało do odzyskania', fmt(missing), `trzeba sprzedać za ok. ${fmt(gross)} brutto — prowizje i wysyłka zjadają ${((r.feeRate || 0) * 100).toFixed(1)}%`, 'warn'],
        ['Zamrożone w towarze', fmt(stock), mode === 'cost' ? 'karty, sealed i bulk w cenie zakupu' : 'karty, sealed i bulk po dzisiejszej wycenie', ''],
        ['Pokrycie luki towarem', missing > 0 ? (stock / missing).toFixed(2).replace('.', ',') + '×' : '—', stock >= missing ? `towar pokrywa lukę z zapasem ${fmt(stock - missing)}` : `brakuje ${fmt(missing - stock)}`, stock >= missing ? 'pos' : 'neg'],
        ['Tempo netto (90 dni)', fmt(r.netRate) + '/mies.', `wydajesz ${fmt(r.spendRate)}/mies., wraca ${fmt(r.backRate)}/mies. — ${r.netRate >= 0 ? 'luka się zamyka' : 'luka rośnie'}`, r.netRate >= 0 ? 'pos' : 'neg']
      ].map(([k, v, n, c]) => `<div><div class="k">${k}</div><div class="v ${c}">${v}</div><div class="n">${n}</div></div>`).join('')}</div>
    </div>`;
  segBind('rec-mode', v => { settings.recStock = v; savePrefs(); renderRecovery(); });
  /* Wydane vs wróciło, miesięcznie */
  const ks = [...new Set([...M.boxes.map(b => mk(b.date)), ...M.sales.map(s => mk(s.date))])].filter(k => k && k <= mk(today())).sort();
  const spentK = k => sum(M.boxes.filter(b => mk(b.date) === k), b => b.landedGross) + sum(M.cards.filter(c => c.acq !== 'box' && mk(c.date) === k), c => cardOwnCost(c)) + sum(state.expenses.filter(e => mk(e.date) === k), e => num(e.amount));
  const backK = k => sum(M.sales.filter(s => mk(s.date) === k), s => s.net - s.vat) + sum(M.vatAttr.events.filter(e => e.kind !== 'wnt' && mk(e.date) === k), e => e.vat);
  let acc = 0; const S = ks.map(k => ({ k, s: spentK(k), b: backK(k) })).map(x => ({ ...x, acc: (acc += x.b - x.s) }));
  renderChart('ch-rec', { type: 'bar', data: { labels: S.map(x => monthLabel(x.k)), datasets: [
    lineDs('Saldo narastająco', S.map(x => Math.round(x.acc)), C.ink, { pointRadius: 3, order: 0 }),
    barDs('Wydane', S.map(x => Math.round(x.s)), C.grey, { order: 1 }), barDs('Wróciło', S.map(x => Math.round(x.b)), C.green, { order: 1 })] }, options: baseOpts() });
  const self = S.filter(x => x.b >= x.s);
  $('r-rec-why').innerHTML = `<b>Biznes finansuje się sam</b> w miesiącu, w którym to, co wróciło, pokrywa zakupy — wtedy saldo przestaje spadać. ${self.length ? `Tak było w: ${self.map(x => MNF[+x.k.slice(5) - 1].toLowerCase()).join(', ')}.` : 'Jeszcze nie było takiego miesiąca.'} Ostatnie 90 dni: wpływy pokrywają <b>${pct(r.spendRate ? r.backRate / r.spendRate * 100 : 0)}</b> wydatków. ${r.netRate < 0 ? `Żeby luka zaczęła maleć, kupuj za mniej niż ${fmt(r.backRate)} miesięcznie albo sprzedawaj więcej.` : r.etaMonths ? `Przy tym tempie luka zamknie się za ok. ${Math.ceil(r.etaMonths)} mies.` : ''}`;
  /* Gdzie stoją pieniądze */
  const cardsV = mode === 'cost' ? M.heldBasis : M.heldValueNet;
  const L = [['style', 'Karty na stanie', cardsV, `${M.held.length} szt. · gotowe do wystawienia`, 'var(--cd-auto, #6d28d9)'], ['inventory_2', 'Sealed na stanie', sum(onHand(), g => g.capital), `${sum(onHand(), g => g.n)} szt. · do sprzedaży lub otwarcia`, 'var(--tc-accent)'],
    ['local_shipping', 'W drodze', sum(inTransit(), g => g.capital), `${sum(inTransit(), g => g.n)} szt. · jeszcze nie dotarło`, 'var(--tc-muted-2)'], ['layers', 'Bulk z breaków', mode === 'cost' ? Math.max(0, M.unallocated) : M.bulkValue, `${M.opened.length} otwartych boxów`, 'var(--tc-line-strong)']].filter(x => x[2] > 0.5);
  const totL = sum(L, x => x[2]);
  $('r-ladder').innerHTML = L.map(([ic, n, v, d, c]) => li(ic, 'mut', n, `${d}<div class="cx-bar" style="margin-top:7px"><i style="width:${v / totL * 100}%;background:${c}"></i></div>`, `<b>${fmt(v)}</b><span class="cx-note">${pct(v / totL * 100)} towaru${missing ? ` · ${pct(v / missing * 100)} luki` : ''}</span>`)).join('') || empty('Brak towaru.');
}

/* Otwarte boxy — breaki. */
function renderBreaks() {
  const O = M.opened, bs = M.breakStats;
  $('r-br-kpi').innerHTML = [
    kpi('Otwarte boxy', `${O.length} szt.`, `za ${fmt(bs.cost)} (koszt netto) · śr. ${fmt(bs.avgCost || 0)}`),
    kpi('Wróciło z pulli', fmt(bs.ret), `sprzedane karty + wycena tych na stanie + bulk`),
    kpi('Wynik breaków', fmt(bs.pnl), `ROI ${pct(bs.roi)} · mnożnik ${bs.cost ? (bs.ret / bs.cost).toFixed(2).replace('.', ',') : '—'}×`, bs.pnl >= 0 ? 'pos' : 'neg'),
    kpi('Trafione', pct(bs.hitRate), `${bs.hits}/${O.length} boxów na plusie`)
  ].join('');
  const by = {}; O.forEach(x => { const k = mk(x.openedDate || x.date); (by[k] = by[k] || []).push(x); });
  $('r-br-m').innerHTML = O.length ? `<table class="tc-tbl"><thead><tr><th>Miesiąc</th><th class="num">Otwarte</th><th class="num">Koszt</th><th class="num">Zwrot</th><th class="num">Wynik</th><th class="num">ROI</th><th class="num">Trafione</th></tr></thead><tbody>` +
    Object.keys(by).sort().reverse().map(k => { const L = by[k], c = sum(L, x => x.landed), r = sum(L, x => x.ret), p = sum(L, x => x.pnl); return `<tr><td><b>${mFull(k)}</b></td><td class="num">${L.length}</td><td class="num">${fmt(c)}</td><td class="num">${fmt(r)}</td><td class="num ${p >= 0 ? 'pos' : 'neg'}"><b>${fmt(p)}</b></td><td class="num">${pct(c ? p / c * 100 : 0)}</td><td class="num">${L.filter(x => x.pnl > 0).length}/${L.length}</td></tr>`; }).join('') +
    `</tbody><tfoot><tr><td>Razem</td><td class="num">${O.length}</td><td class="num">${fmt(bs.cost)}</td><td class="num">${fmt(bs.ret)}</td><td class="num">${fmt(bs.pnl)}</td><td class="num">${pct(bs.roi)}</td><td class="num">${bs.hits}/${O.length}</td></tr></tfoot></table>` : empty('Nie otworzyłeś jeszcze żadnego boxa.');
  const bp = {}; O.forEach(x => (bp[x.name] = bp[x.name] || []).push(x));
  $('r-br-p').innerHTML = O.length ? `<table class="tc-tbl"><thead><tr><th>Produkt</th><th class="num">Szt.</th><th class="num">Śr. koszt</th><th class="num">Śr. zwrot</th><th class="num">EV</th><th class="num">Wynik</th></tr></thead><tbody>` +
    Object.entries(bp).map(([n, L]) => ({ n, L, c: sum(L, x => x.landed), r: sum(L, x => x.ret), p: sum(L, x => x.pnl) })).sort((a, b) => b.c - a.c).slice(0, 12)
      .map(o => `<tr><td>${esc(o.n)}</td><td class="num">${o.L.length}</td><td class="num">${fmt(o.c / o.L.length)}</td><td class="num">${fmt(o.r / o.L.length)}</td><td class="num"><span class="cx-pill ${o.r >= o.c ? 'pos' : 'neg'}">${o.c ? (o.r / o.c).toFixed(2).replace('.', ',') : '—'}×</span></td><td class="num ${o.p >= 0 ? 'pos' : 'neg'}">${fmt(o.p)}</td></tr>`).join('') + '</tbody></table>' : '';
}

/* Rotacja: co kupione, ile sprzedane, jak szybko i z jakim zyskiem. */
function renderRotation() {
  const Gm = new Map();
  M.boxes.forEach(b => { const k = normName(b.name); if (!Gm.has(k)) Gm.set(k, { name: b.name, bought: 0, sold: 0, stock: 0, p: 0, g: 0, dd: 0, n: 0 }); const o = Gm.get(k); o.bought++; if (b.status === 'sold') o.sold++; else if (b.status === 'sealed') o.stock++; });
  deals().filter(s => s.kind === 'box').forEach(s => { const o = Gm.get(normName(s.name)); if (!o) return; o.p += pnlNet(s); o.g += s.gross; o.dd += s.days || 0; o.n++; });
  const L = [...Gm.values()].filter(o => o.bought >= 2).sort((a, b) => b.p - a.p).slice(0, 15);
  $('r-rot').innerHTML = `<table class="tc-tbl"><thead><tr><th>Produkt</th><th class="num">Kupione</th><th class="num">Sprzedane</th><th>Sprzedaż z zakupu</th><th class="num">Na stanie</th><th class="num">Śr. dni</th><th class="num">Marża</th><th class="num">Zysk</th><th>Ocena</th></tr></thead><tbody>` +
    L.map(o => { const st = o.sold / o.bought * 100, dd = o.n ? o.dd / o.n : null, m = o.g ? o.p / o.g * 100 : null;
      const tag = st >= 70 && dd !== null && dd <= 21 && m >= 20 ? ['pos', 'kupuj dalej'] : st < 30 && o.stock ? ['warn', 'stoi'] : m !== null && m < 15 ? ['neg', 'słaba marża'] : ['', 'ok'];
      return `<tr><td>${esc(o.name)}</td><td class="num">${o.bought}</td><td class="num">${o.sold}</td><td><div style="display:flex;align-items:center;gap:8px"><div class="cx-bar" style="width:90px"><i style="width:${st}%;background:${st >= 70 ? 'var(--tc-pos)' : st >= 30 ? 'var(--tc-accent)' : 'var(--tc-warn)'}"></i></div><span class="cx-note">${pct(st)}</span></div></td><td class="num">${o.stock || '—'}</td><td class="num">${dd !== null ? Math.round(dd) : '—'}</td><td class="num">${pct(m)}</td><td class="num ${o.p >= 0 ? 'pos' : 'neg'}"><b>${o.n ? fmt(o.p) : '—'}</b></td><td><span class="cx-pill ${tag[0]}">${tag[1]}</span></td></tr>`; }).join('') +
    `</tbody></table><p class="cx-note" style="padding:10px 16px">„Kupuj dalej”: sprzedane ≥70% zakupu, średnio do 3 tygodni, marża ≥20%. „Stoi”: sprzedane poniżej 30% i jest jeszcze na stanie. Produkty kupione min. 2 razy, posortowane po zysku na czysto.</p>`;
}

/* ============================================================
   PODATKI — VAT: lejek jednego miesiąca z rozwijanymi pozycjami
   ============================================================ */
const BIZ = {
  b2b:   { l: 'Faktura B2B — sprzedaż usług', side: 'out', pct: 100, c: '#0057c0' },
  phone: { l: 'Telefon i internet', side: 'in', pct: 100, c: '#09b1ba' },
  equip: { l: 'Sprzęt (laptop, monitor…)', side: 'in', pct: 100, c: '#0b8a4a' },
  car:   { l: 'Samochód i paliwo', side: 'in', pct: 50, c: '#c0362c', hint: 'auto osobowe w użytku mieszanym — 50% VAT' },
  soft:  { l: 'Oprogramowanie i usługi', side: 'in', pct: 100, c: '#7c3aed' },
  other: { l: 'Materiały i inne', side: 'in', pct: 100, c: '#94a3b8', hint: 'koperty, toploadery, taśma…' }
};
const extraById = id => (settings.vat.extra || []).find(x => x.id === id);
const catOf = x => x.cat || (x.side === 'out' ? 'b2b' : 'other');
let vmSel = null;

function vatLine(r) {
  const x = r.ref && r.ref.type === 'extra' ? extraById(r.ref.id) : null;
  const ed = x ? ` onclick="UI.openBiz('${x.id}')" class="ed" title="Edytuj"` : '';
  const pctTxt = x && x.vatFull && Math.abs(x.vatFull - x.vat) > 0.005 ? ` <span class="cx-note">VAT ${fmt2(x.vatFull)} × ${Math.round(num(x.pct))}%</span>` : '';
  return `<div class="cx-vl"><span class="mut">${dShort(r.date)}</span><span${ed}>${r.channel ? dot(r.channel) + ' ' : ''}${esc(r.label)}${x && x.rec ? ' <span class="cx-pill acc">co miesiąc</span>' : ''}${r.side === 'wnt' ? ' <span class="cx-pill pos">B2B</span>' : ''}${pctTxt}</span><b>${fmt2(r.vat)}</b></div>`;
}
const lines = L => L.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).map(vatLine).join('') || '<div class="cx-vl"><span></span><span class="cx-note">brak pozycji</span><span></span></div>';
function vrow(sign, label, sub, amt, body, open) {
  const cls = sign === '+' ? 'neg' : 'pos';
  const sm = `<span class="sg ${cls}">${sign}</span><span class="lb">${label}${sub ? `<span class="s"> · ${sub}</span>` : ''}</span><span class="am ${amt ? cls : 'mut'}">${amt ? (sign === '+' ? '+ ' : '− ') + fmt2(amt) : '—'}</span>`;
  return body ? `<details class="cx-vf" ${open ? 'open' : ''}><summary>${sm}<span class="cv"></span></summary><div class="vb">${body}</div></details>` : `<div class="cx-vf flat"><div class="sm">${sm}<span></span></div></div>`;
}
const nPos = L => `${L.length} ${plural(L.length, 'pozycja', 'pozycje', 'pozycji')}`;

function renderVat() {
  if (!vatOn()) { $('vm-funnel').innerHTML = empty('VAT jest wyłączony w ustawieniach starej wersji modułu.'); return; }
  const PS = vatPeriods();
  if (!vmSel || !PS.some(p => p.key === vmSel)) vmSel = (vatUnpaid() || PS.find(p => p.current) || PS[PS.length - 1]).key;
  const paid = settings.vat.paid || {};
  $('vm-months').innerHTML = PS.map(p => `<button class="${p.key === vmSel ? 'active' : ''}" onclick="UI.vatMonth('${p.key}')">${monthLabel(p.key)}${p.closed && p.payable > 0.005 && !paid[p.key] ? ' <span class="cx-count">!</span>' : ''}</button>`).join('');
  const p = PS.find(x => x.key === vmSel);
  const R_ = p.rows;
  const b2b = R_.filter(r => r.side === 'out' && r.kind === 'other');
  const sales = R_.filter(r => r.side === 'out' && r.kind !== 'other');
  const wnt = R_.filter(r => r.side === 'wnt');
  const cardsIn = R_.filter(r => r.side === 'in' && r.kind === 'in' && !(r.ref && r.ref.type === 'expense')).concat(wnt);
  const fees = R_.filter(r => r.side === 'in' && r.kind === 'fees'), ship = R_.filter(r => r.side === 'in' && r.kind === 'ship');
  const supplies = R_.filter(r => r.side === 'in' && r.kind === 'in' && r.ref && r.ref.type === 'expense');
  const other = R_.filter(r => r.side === 'in' && r.kind === 'other');
  const corr = R_.filter(r => r.side === 'in' && r.kind === 'corr');
  const sOut = sum(b2b, r => r.vat), sSale = sum(sales, r => r.vat), sWnt = sum(wnt, r => r.vat);
  $('vm-title').textContent = mFull(p.key);
  $('vm-due').textContent = `JPK do ${dFull(p.dueDate)}`;
  const byCh = [...new Set(sales.map(r => r.channel || '—'))].map(c => ({ c, L: sales.filter(r => (r.channel || '—') === c) }));
  const salesBody = byCh.map(x => `<details class="cx-vf sub"><summary><span class="sg"></span><span class="lb">${dot(x.c)} ${esc(x.c)}<span class="s"> · ${nPos(x.L)}</span></span><span class="am">${fmt2(sum(x.L, r => r.vat))}</span><span class="cv"></span></summary><div class="vb">${lines(x.L)}</div></details>`).join('');
  const otherGroups = [...Object.keys(BIZ).filter(k => k !== 'b2b').map(k => ({ k, l: BIZ[k].l, c: BIZ[k].c, L: other.filter(r => catOf(extraById(r.ref.id) || {}) === k) })),
    { k: 'supplies', l: 'Koszty ogólne kart (materiały)', c: '#64748b', L: supplies }].filter(x => x.L.length);
  const otherBody = otherGroups.map(x => `<details class="cx-vf sub"><summary><span class="sg"></span><span class="lb"><span class="cx-dot" style="background:${x.c}"></span> ${x.l}<span class="s"> · ${nPos(x.L)}</span></span><span class="am">${fmt2(sum(x.L, r => r.vat))}</span><span class="cv"></span></summary><div class="vb">${lines(x.L)}</div></details>`).join('');
  $('vm-funnel').innerHTML = `
    <div class="cx-vgrp">VAT należny — co musisz oddać</div>
    ${vrow('+', 'Faktury B2B', b2b.length ? `netto ${fmt(sum(b2b, r => r.base))}` : 'brak faktury', sOut, b2b.length ? lines(b2b) : '')}
    ${vrow('+', 'Sprzedaż kart', sales.length ? nPos(sales) : 'brak sprzedaży', sSale, salesBody)}
    ${sWnt ? vrow('+', 'WNT — zakupy B2B z UE', 'naliczasz i od razu odliczasz niżej', sWnt, lines(wnt)) : ''}
    <div class="cx-vtot"><span>= VAT należny</span><b class="neg">${fmt2(p.outVat)}</b></div>
    <div class="cx-vgrp">Odliczenia — co pomniejsza przelew</div>
    ${vrow('−', 'Zakupy kart', cardsIn.length ? nPos(cardsIn) : '', sum(cardsIn, r => r.vat), cardsIn.length ? lines(cardsIn) : '')}
    ${vrow('−', 'Prowizje platform', fees.length ? nPos(fees) : '', sum(fees, r => r.vat), fees.length ? lines(fees) : '')}
    ${vrow('−', 'Wysyłka', ship.length ? nPos(ship) : '', sum(ship, r => r.vat), ship.length ? lines(ship) : '')}
    ${vrow('−', 'Pozostałe odliczenia', otherGroups.map(x => x.l.split(' ')[0].toLowerCase()).join(', '), sum(other, r => r.vat) + sum(supplies, r => r.vat), otherBody)}
    ${corr.length ? vrow('−', 'Korekta za towar na stanie', 'jednorazowo, spis z natury', sum(corr, r => r.vat), lines(corr)) : ''}
    ${p.carryIn ? vrow('−', 'Nadwyżka z poprzedniego miesiąca', '', p.carryIn) : ''}
    <div class="cx-vtot"><span>= Odliczenia razem</span><b class="pos">${fmt2(p.inVat + p.carryIn)}</b></div>
    <div class="cx-vtot big"><span>Do zapłaty</span><b class="${p.payable > 0.005 ? 'neg' : 'pos'}">${fmt2(p.payable)}</b></div>
    ${p.carryOut > 0.005 ? `<p class="cx-note" style="text-align:right">${fmt2(p.carryOut)} nadwyżki przechodzi na ${mLow(addMonths(p.key, 1))}</p>` : ''}`;
  /* Panel boczny */
  const prevKey = addMonths(p.key, -1);
  const recPrev = (settings.vat.extra || []).filter(x => x.rec && mk(x.date) === prevKey && !(settings.vat.extra || []).some(y => y !== x && y.rec && catOf(y) === catOf(x) && mk(y.date) === p.key && y.label === x.label));
  const st = paid[p.key] ? `<span class="cx-pill pos">zapłacone ${dShort(paid[p.key])}</span>` : !p.closed ? '<span class="cx-pill acc">miesiąc trwa</span>' : p.payable > 0.005 ? (p.dueDate < today() ? '<span class="cx-pill neg">po terminie</span>' : `<span class="cx-pill warn">do zapłaty do ${dShort(p.dueDate)}</span>`) : '<span class="cx-pill pos">nic do zapłaty</span>';
  const todo = [];
  if (!b2b.length && (settings.vat.extra || []).some(x => x.side === 'out')) todo.push(li('description', 'warn', 'Brak faktury B2B', 'wystaw ją z datą ostatniego dnia miesiąca', `<button class="btn-small" onclick="UI.addB2b('${p.key}')">Dodaj taką samą</button>`));
  recPrev.forEach(x => todo.push(li('autorenew', 'acc', `Brak faktury: ${esc(x.label)}`, 'powtarza się co miesiąc', `<button class="btn-small" onclick="UI.repeatBiz('${x.id}','${p.key}')">Dodaj</button>`)));
  $('vm-side').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">${st}
      ${p.closed && p.payable > 0.005 ? (paid[p.key] ? `<button class="btn-small" onclick="UI.vatPaid('${p.key}',false)">Cofnij</button>` : `<button class="btn-small primary" onclick="UI.vatPaid('${p.key}',true)">Oznacz jako zapłacone</button>`) : ''}</div>
    <div class="cx-kv" style="margin-top:12px">
      <div><span>Przelew na mikrorachunek</span><b>${fmt2(p.payable)}</b></div>
      ${sOut ? `<div><span>VAT od klienta B2B (odłożony)</span><b>${fmt2(sOut)}</b></div><div><span>${sOut >= p.payable ? 'Zostaje Ci z VAT od klienta' : 'Dopłacasz ponad VAT od klienta'}</span><b class="${sOut >= p.payable ? 'pos' : 'neg'}">${fmt2(Math.abs(sOut - p.payable))}</b></div>` : ''}
      ${sWnt ? `<div><span>Nie zapłaciłeś sklepom dzięki B2B</span><b class="pos">${fmt2(sWnt)}</b></div>` : ''}
    </div>
    ${todo.length ? `<div class="cx-vgrp" style="margin-top:16px">Do uzupełnienia</div>${todo.join('')}` : ''}
    <p class="cx-note" style="margin-top:12px">${p.closed ? '' : 'Miesiąc trwa — kwota zmienia się z każdą sprzedażą i fakturą. '}Fakturę kosztową możesz odliczyć w miesiącu jej otrzymania albo w jednym z dwóch kolejnych.</p>`;
  /* Tabela miesięcy */
  $('vm-periods').innerHTML = `<table class="tc-tbl"><thead><tr><th>Miesiąc</th><th class="num">B2B</th><th class="num">Sprzedaż kart</th><th class="num">Zakupy kart</th><th class="num">Prowizje i wysyłka</th><th class="num">Pozostałe</th><th class="num">Do zapłaty</th><th>Status</th></tr></thead><tbody>` +
    PS.slice().reverse().map(x => { const r = x.rows, o = r.filter(y => y.side === 'out' && y.kind === 'other');
      return `<tr class="click ${x.key === vmSel ? 'sel' : ''}" onclick="UI.vatMonth('${x.key}')"><td><b>${mFull(x.key)}</b></td><td class="num">${fmt(sum(o, y => y.vat))}</td><td class="num">${fmt(x.stdVat + x.marginVat)}</td><td class="num pos">${fmt(x.buyVat + x.wntVat)}</td><td class="num pos">${fmt(x.feeVat + x.shipVat)}</td><td class="num pos">${fmt(x.otherIn + x.corrVat)}</td><td class="num"><b>${fmt2(x.payable)}</b></td>
        <td>${paid[x.key] ? '<span class="cx-pill pos">zapłacone</span>' : !x.closed ? '<span class="cx-pill acc">trwa</span>' : x.payable > 0.005 ? '<span class="cx-pill warn">do zapłaty</span>' : '<span class="cx-pill pos">rozliczone</span>'}</td></tr>`; }).join('') + '</tbody></table>';
}
function vatMonth(k) { vmSel = k; renderVat(); }
function vatPaid(k, on) { const pd = { ...(settings.vat.paid || {}) }; if (on) pd[k] = today(); else delete pd[k]; settings.vat.paid = pd; commit(on ? `VAT za ${mLow(k)} oznaczony jako zapłacony` : 'Cofnięte'); }
function addB2b(k) {
  k = k || vmSel || mk(today());
  const last = (settings.vat.extra || []).filter(x => x.side === 'out').sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!last) { openBiz(null, 'b2b'); return; }
  const date = monthEnd(k);
  const label = String(last.label || 'Usługi').replace(/\s*\([^)]*\)\s*$/, '').replace(/\b\d{1,2}\/\d{4}\b/, `${k.slice(5, 7)}/${k.slice(0, 4)}`);
  if (!confirm(`Dodać „${label}” z datą ${dFull(date)}: ${fmt2(num(last.base))} netto + ${fmt2(num(last.vat))} VAT?`)) return;
  settings.vat.extra = [...(settings.vat.extra || []), { id: uid('vx'), date, label, side: 'out', cat: 'b2b', base: num(last.base), vat: num(last.vat) }];
  vmSel = k; commit('Faktura B2B dodana');
}
function repeatBiz(id, k) {
  const x = extraById(id); if (!x) return;
  const day = Math.min(+x.date.slice(8, 10), dim(k));
  settings.vat.extra = [...settings.vat.extra, { ...x, id: uid('vx'), date: `${k}-${String(day).padStart(2, '0')}` }];
  vmSel = k; commit(`Dodane: ${x.label}`);
}
function exportVat() {
  const key = vmSel; if (!key) return;
  const rows = vatRegisterRows(key);
  const head = ['data', 'rodzaj', 'dokument', 'opis', 'kanal', 'brutto', 'netto', 'vat'];
  const data = rows.map(r => [r.date, r.type, r.doc, r.name, r.channel, r.gross.toFixed(2), r.base.toFixed(2), r.vat.toFixed(2)]);
  download(`ewidencja_vat_${key}.csv`, [head, ...data].map(r => r.map(csvCell).join(';')).join('\n'));
  toast('Ewidencja pobrana', 'ok');
}

/* ============================================================
   PODATKI — Ryczałt i dowody wewnętrzne (ING)
   ============================================================ */
let rvSel = null;
function renderRev() {
  const ks = [...new Set(salesToDate().map(s => mk(s.date)).concat(mk(today())))].sort();
  if (!rvSel || !ks.includes(rvSel)) rvSel = ks.filter(k => k <= mk(today())).pop();
  $('rv-months').innerHTML = ks.slice(-6).map(k => `<button class="${k === rvSel ? 'active' : ''}" onclick="UI.revMonth('${k}')">${monthLabel(k)}${[...new Set(accountingSales(k).map(s => s.date))].some(d => !(state.dwDone || {})[d] && d <= today()) ? ' <span class="cx-count">•</span>' : ''}</button>`).join('');
  const rows = accountingSales(rvSel).filter(s => s.date <= today());
  const days = [...new Set(rows.map(s => s.date))].sort();
  const net = sum(rows, s => s.accounting), vat = sum(rows, s => s.accountingVat), done = days.filter(d => (state.dwDone || {})[d]);
  const nm = addMonths(rvSel, 1);
  $('rv-kpi').innerHTML = [
    kpi('Przychód ze sprzedaży kart', fmt2(net), `${rows.filter(s => !s.isReturn).length} sprzedaży bez faktury · bez VAT`),
    kpi(`Ryczałt ${RYC()}% od kart`, fmt2(net * RYC() / 100), `zapłać do 20.${nm.slice(5)}.${nm.slice(0, 4)} (razem z ryczałtem od usług)`, 'neg'),
    kpi('Dowody wewnętrzne', `${done.length}/${days.length}`, days.length - done.length ? `${days.length - done.length} do wprowadzenia w ING` : 'wszystkie w ING ✓', days.length - done.length ? 'warn' : 'pos'),
    kpi('VAT w tych sprzedażach', fmt2(vat), vatOn() && rvSel >= mk(vatFrom()) ? 'w JPK jako dokument WEW' : 'przed rejestracją — bez VAT')
  ].join('');
  $('rv-list').innerHTML = days.length ? days.slice().reverse().map(d => {
    const L = rows.filter(s => s.date === d), g = sum(L, s => s.accountingGross), v = sum(L, s => s.accountingVat), n = g - v, ok = (state.dwDone || {})[d];
    const chs = {}; L.forEach(s => { chs[s.channel] = (chs[s.channel] || 0) + 1; });
    const no = `DW/${d.replaceAll('-', '/')}`;
    return `<details class="cx-vf dw"><summary><span class="sg">${ok ? '<span class="material-symbols-outlined pos" style="font-size:18px">check_circle</span>' : '<span class="material-symbols-outlined warn" style="font-size:18px">radio_button_unchecked</span>'}</span>
      <span class="lb">${no}<span class="s"> · ${dFull(d)} · ${L.length} ${plural(L.length, 'pozycja', 'pozycje', 'pozycji')} ${Object.entries(chs).map(([c, k]) => `${dot(c)}${k}`).join(' ')}${L.some(s => s.isReturn) ? ' <span class="cx-pill neg">zwrot</span>' : ''}</span></span>
      <span class="am">${fmt2(n)} <span class="cx-note">netto</span></span><span class="cv"></span></summary>
      <div class="vb"><div class="cx-dwbox"><div>Brutto<b>${fmt2(g)}</b></div><div>VAT<b>${fmt2(v)}</b></div><div>Netto (przychód)<b>${fmt2(n)}</b></div><div>Ryczałt ${RYC()}%<b>${fmt2(n * RYC() / 100)}</b></div></div>
        ${L.map(s => `<div class="cx-vl"><span>${kindIco(s.kind)}</span><span>${dot(s.channel)} ${esc(s.name)}</span><b>${fmt2(s.accountingGross)}</b></div>`).join('')}
        <div class="cx-actions" style="justify-content:flex-end;margin:10px 0 0"><button class="btn-small" onclick="UI.copyDw('${d}')"><span class="material-symbols-outlined">content_copy</span>Kopiuj do ING</button>
          ${ok ? `<button class="btn-small" onclick="UI.dwDone('${d}',false)">Cofnij</button>` : `<button class="btn-small primary" onclick="UI.dwDone('${d}',true)"><span class="material-symbols-outlined">check</span>Wprowadzone do ING</button>`}</div></div></details>`;
  }).join('') + `<div class="cx-vtot" style="margin:10px 16px 14px"><span>Razem ${mLow(rvSel)}</span><b>${fmt2(net)} netto · ryczałt ${fmt2(net * RYC() / 100)}</b></div>`
    : empty(`Brak sprzedaży bez faktury w ${mLow(rvSel)} — nie ma czego wprowadzać.`);
}
function revMonth(k) { rvSel = k; renderRev(); }
function dwDone(d, on) { state.dwDone = { ...(state.dwDone || {}) }; if (on) state.dwDone[d] = true; else delete state.dwDone[d]; savePrefs(); renderCounts(); renderRev(); toast(on ? 'Oznaczone jako wprowadzone do ING' : 'Cofnięte', 'ok'); }
function copyDw(d) {
  const L = accountingSales(mk(d)).filter(s => s.date === d), g = sum(L, s => s.accountingGross), v = sum(L, s => s.accountingVat);
  const txt = [`DW/${d.replaceAll('-', '/')}`, dFull(d), 'Sprzedaż kart kolekcjonerskich online', g.toFixed(2).replace('.', ','), v.toFixed(2).replace('.', ','), (g - v).toFixed(2).replace('.', ',')].join('\t');
  const ok = () => toast('Skopiowano: numer, data, opis, brutto, VAT, netto', 'ok');
  if (navigator.clipboard) navigator.clipboard.writeText(txt).then(ok, () => toast(txt)); else toast(txt);
}
function exportDw() {
  const rows = accountingSales(rvSel);
  const head = ['data', 'dokument', 'platforma', 'produkt', 'brutto', 'vat', 'netto_do_ryczaltu', 'stawka'];
  const data = rows.map(s => [s.date, `DW/${s.date.replaceAll('-', '/')}`, s.channel, s.name, s.accountingGross.toFixed(2), s.accountingVat.toFixed(2), s.accounting.toFixed(2), RYC() + '%']);
  download(`dowody_wewnetrzne_${rvSel}.csv`, [head, ...data].map(r => r.map(csvCell).join(';')).join('\n'));
  toast('Plik za miesiąc pobrany', 'ok');
}

/* ============================================================
   USTAWIENIA
   ============================================================ */
function renderSettings() {
  const used = new Set(M.sales.map(s => s.channel));
  $('set-channels').innerHTML = `<table class="tc-tbl cx-chtbl"><thead><tr><th>Kanał</th><th>Pokaż</th><th class="num">Prowizja %</th><th class="num">Opłata stała (zł)</th><th>Faktura z VAT za prowizję</th><th class="num">Wysyłka po Twojej stronie (zł)</th><th>Faktura z VAT za wysyłkę</th><th>Przykład: box za 100 zł</th></tr></thead><tbody>` +
    settings.channels.map((c, i) => { const r = calc({ cost: 0, vatCost: 0, scheme: 'std' }, c, 100);
      return `<tr><td><b>${dot(c.name)} ${esc(c.name)}</b>${used.has(c.name) ? '' : ' <span class="cx-note">· brak sprzedaży</span>'}</td>
      <td><input type="checkbox" ${c.hidden ? '' : 'checked'} onchange="UI.setCh(${i},'hidden',!this.checked)"></td>
      <td class="num"><input type="number" step="0.1" value="${num(c.fee)}" onchange="UI.setCh(${i},'fee',this.value)"></td>
      <td class="num"><input type="number" step="0.5" value="${num(c.fixed)}" onchange="UI.setCh(${i},'fixed',this.value)"></td>
      <td><input type="checkbox" ${c.feeVat ? 'checked' : ''} onchange="UI.setCh(${i},'feeVat',this.checked)"> odliczam</td>
      <td class="num"><input type="number" step="0.5" value="${num(c.ship)}" onchange="UI.setCh(${i},'ship',this.value)"></td>
      <td><input type="checkbox" ${c.shipVat ? 'checked' : ''} onchange="UI.setCh(${i},'shipVat',this.checked)"> odliczam</td>
      <td class="cx-note">na konto ${fmt2(r.cashIn)} · zostaje po VAT i ryczałcie <b>${fmt2(r.cashIn - r.vatPay - r.ryc)}</b></td></tr>`; }).join('') + '</tbody></table>';
  setv('set-tm', num(settings.targetMargin)); setv('set-lt', num(settings.leadTime) || 14); setv('set-slow', num(settings.slowDays) || 45); setv('set-ryc', RYC());
  $('set-cardch').innerHTML = settings.channels.map(c => `<option ${c.name === settings.cardChannel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  setv('set-alloc', settings.alloc || 'value'); setv('set-bulk', settings.bulkOffset || 'yes');
  $('set-vatinfo').innerHTML = vatOn() ? `<div><span>Czynny podatnik VAT od</span><b>${dFull(vatFrom())}</b></div><div><span>Rozliczenie</span><b>${settings.vat.period === 'Q' ? 'kwartalne (JPK_V7K)' : 'miesięczne (JPK_V7M)'}</b></div>${settings.vat.opening ? `<div><span>Korekta za towar na stanie</span><b>${fmt2(num(settings.vat.opening.total))}</b></div>` : ''}` : '<div><span>VAT</span><b>wyłączony</b></div>';
  $('set-check').innerHTML = `Kontrola spójności danych (wynik = majątek + wpływy − wydatki − saldo VAT): ${Math.abs(M.residual) < 0.5 ? '<b class="pos">różnica 0,00 zł ✓</b>' : `<b class="neg">różnica ${fmt2(M.residual)}</b> — coś się nie spina, daj znać`}`;
}
function setCh(i, k, v) {
  const c = settings.channels[i]; if (!c) return;
  c[k] = (k === 'fee' || k === 'fixed' || k === 'ship') ? num(v) : v;
  commit();
}
function addChannel() {
  const name = (prompt('Nazwa kanału (np. eBay, Cardmarket, Whatnot):') || '').trim();
  if (!name) return;
  if (settings.channels.some(c => c.name.toLowerCase() === name.toLowerCase())) { toast('Taki kanał już jest', 'err'); return; }
  settings.channels.push({ name, fee: 0, fixed: 0, ship: 0, feeVat: false, shipVat: false });
  commit(`Dodany kanał ${name}`);
}
function bindSettings() {
  const on = (id, fn) => $(id).addEventListener('change', fn);
  on('set-tm', () => { settings.targetMargin = Math.max(0, num(getv('set-tm'))); commit(); });
  on('set-lt', () => { settings.leadTime = Math.max(1, num(getv('set-lt'))); commit(); });
  on('set-slow', () => { settings.slowDays = Math.max(1, num(getv('set-slow'))); commit(); });
  on('set-ryc', () => { settings.ryczalt = Math.max(0, num(getv('set-ryc'))); commit(); });
  on('set-cardch', () => { settings.cardChannel = getv('set-cardch'); commit(); });
  on('set-alloc', () => { settings.alloc = getv('set-alloc'); reallocateAll(); commit('Koszty kart przeliczone'); });
  on('set-bulk', () => { settings.bulkOffset = getv('set-bulk'); reallocateAll(); commit('Koszty kart przeliczone'); });
}
function backupJson() { download(`karty_kopia_${today()}.json`, JSON.stringify(state, null, 1), 'application/json'); toast('Kopia pobrana', 'ok'); }

/* ============================================================
   OKNA — wspólne
   ============================================================ */
function open_(id) { $(id).classList.add('on'); }
function close() { document.querySelectorAll('.tc-modal-ov.on').forEach(o => { if (o.id !== 'm-shop') o.classList.remove('on'); }); }
function chipRow(id, opts, cur, onPick) {
  $(id).innerHTML = opts.map(([v, l, tone]) => `<button data-v="${esc(v)}" class="${v === cur ? 'active ' + (tone || '') : ''}">${l}</button>`).join('');
  $(id).querySelectorAll('button').forEach(b => b.addEventListener('click', () => onPick(b.dataset.v)));
}

/* ============================================================
   SPRZEDAŻ — nowa, edycja, zwrot
   ============================================================ */
const S = { mode: 'new', kind: 'box', list: [], ch: 'Vinted', ref: null, ret: 'full' };
const sellList = () => S.kind === 'card' ? M.held.slice().sort((a, b) => b.marketValue - a.marketValue) : onHand();
function sItem() {
  if (S.mode === 'edit') { const it = S.ref.kind === 'card' ? M.byId.get(S.ref.id) : M.boxes.find(b => b.id === S.ref.id); return S.ref.kind === 'card' ? cItem(it) : { cost: it.landed, vatCost: it.landedGross, scheme: it.vatScheme }; }
  const x = S.list[+getv('s-item')]; if (!x) return null;
  return S.kind === 'card' ? cItem(x) : gItem(x);
}
const sNoVat = () => !vatOn() || (getv('s-date') || today()) < vatFrom();
function sCh() { const c = chOf(S.ch); return { ...c, fee: numIn('s-pct'), fixed: S.mode === 'edit' && S.sale ? num(S.sale.feeAbs) : num(c.fixed), ship: numIn('s-ship') }; }
function setFeeFromCh() { const c = chOf(S.ch); setv('s-pct', num(c.fee)); setv('s-ship', num(c.ship)); }
function defaultPrice() {
  const it = sItem(); if (!it) return '';
  if (S.kind === 'card') return Math.max(Math.round(it.value || 0), recommend(it, sCh(), 0, sNoVat()));
  return recommend(it, sCh(), TM(), sNoVat());
}
function openSell(kind = 'box', key, ch, price) {
  S.mode = 'new'; S.kind = kind; S.ref = null; S.sale = null;
  S.ch = ch || (kind === 'card' ? (settings.cardChannel || 'Vinted') : (CHS()[0] || {}).name || 'Vinted');
  $('s-title').textContent = 'Sprzedaż'; $('s-pick').hidden = false; $('s-fixed').hidden = true; $('s-ret').hidden = true;
  setv('s-date', today()); $('s-inv').checked = false; setFeeFromCh();
  fillSellItems(key);
  if (price) setv('s-price', price);
  $('s-foot').innerHTML = `<button class="btn-small ghost" onclick="UI.close()">Anuluj</button><button class="btn-small primary" onclick="UI.saveSale()">Zapisz sprzedaż</button>`;
  open_('m-sell'); renderSell();
}
function fillSellItems(key) {
  segSet('s-kind', S.kind);
  S.list = sellList();
  if (!S.list.length) { $('s-item').innerHTML = '<option value="">— brak towaru —</option>'; setv('s-price', ''); return; }
  $('s-item').innerHTML = S.list.map((x, i) => `<option value="${i}">${esc(S.kind === 'card' ? `${cardTitle(x)}${x.hasValuation ? ` (${fmtPLN0(x.marketValue)})` : ''}` : `${x.name} (×${x.n})`)}</option>`).join('');
  const idx = key ? S.list.findIndex(x => (S.kind === 'card' ? x.id : x.key) === key) : 0;
  setv('s-item', Math.max(0, idx));
  setv('s-price', defaultPrice());
}
function editSale(kind, id) {
  const ref = kind === 'card' ? state.cards.find(c => c.id === id) : state.boxes.find(b => b.id === id);
  if (!ref || !ref.sale) return;
  S.mode = 'edit'; S.kind = kind; S.ref = { kind, id }; S.sale = ref.sale; S.ch = ref.sale.channel || 'Vinted';
  const view = kind === 'card' ? M.byId.get(id) : M.boxes.find(b => b.id === id);
  $('s-title').textContent = 'Sprzedaż — edycja'; $('s-pick').hidden = true; $('s-fixed').hidden = false; $('s-ret').hidden = true;
  $('s-fixed').innerHTML = `<label>Sprzedany towar</label><div class="cx-strong">${kindIco(kind)} ${esc(kind === 'card' ? cardTitle(ref) : ref.name)}</div><div class="hint">koszt ${fmt2(kind === 'card' ? view.basis : view.landed)} netto · sprzedane ${dFull(ref.sale.date)}</div>`;
  setv('s-price', num(ref.sale.price) * fxFor(ref.sale.currency, ref.sale.fx)); setv('s-date', ref.sale.date);
  setv('s-pct', num(ref.sale.feePct)); setv('s-ship', num(ref.sale.shippingOut)); $('s-inv').checked = !!ref.sale.invoiced;
  $('s-foot').innerHTML = `<button class="btn-small ghost" style="margin-right:auto;color:var(--tc-neg)" onclick="UI.deleteSale()"><span class="material-symbols-outlined">delete</span>Usuń sprzedaż</button>
    <button class="btn-small" onclick="UI.toggleRet()"><span class="material-symbols-outlined">undo</span>Zwrot</button><button class="btn-small primary" onclick="UI.saveSale()">Zapisz zmiany</button>`;
  open_('m-sell'); renderSell();
}
function renderSell() {
  const it = sItem(), ch = sCh(), cfg = chOf(S.ch), nv = sNoVat();
  chipRow('s-ch', CHS().concat(CHS().some(c => c.name === S.ch) ? [] : [cfg]).map(c => [c.name, `${dot(c.name)}${esc(c.name)}`]), S.ch, v => { S.ch = v; setFeeFromCh(); if (S.mode === 'new') setv('s-price', defaultPrice()); renderSell(); });
  const diff = Math.abs(num(ch.fee) - num(cfg.fee)) > 0.001 || Math.abs(num(ch.ship) - num(cfg.ship)) > 0.001;
  $('s-fee-hint').innerHTML = diff ? `<span class="cx-pill warn">inaczej niż w ustawieniach ${esc(cfg.name)}</span> (${num(cfg.fee)}% · ${fmt2(num(cfg.ship))}) — zapisze się tylko przy tej sprzedaży. <a href="#" onclick="UI.feeReset();return false">Przywróć</a>` : `Z ustawień kanału ${esc(cfg.name)}. Jeśli box wpadł w inną kategorię, popraw tylko tutaj.`;
  if (!it) { $('s-wf').innerHTML = empty('Brak towaru do sprzedaży.'); $('s-res').innerHTML = ''; return; }
  if (S.mode === 'new') {
    const x = S.list[+getv('s-item')], ls = x ? LAST[x.name || ''] : null;
    $('s-item-hint').innerHTML = `koszt ${fmt2(it.cost)} netto${S.kind === 'box' ? '/szt.' : ''}${it.value ? ` · wycena ${fmt(it.value)}` : ''}${ls ? ` · ostatnio ${fmt(ls.gross)} na ${esc(ls.channel)}` : ''}`;
    const opts = [[recommend(it, ch, 0, nv), 'na zero'], [recommend(it, ch, TM(), nv), `ROI ${TM()}%`], [recommend(it, ch, 50, nv), 'ROI 50%']];
    if (it.value) opts.unshift([Math.round(it.value), 'wycena']);
    $('s-sugg').innerHTML = opts.map(([p, l]) => `<button onclick="UI.setPrice(${p})">${fmt(p)} · ${l}</button>`).join('');
  } else $('s-sugg').innerHTML = `<button onclick="UI.setPrice(${num(S.sale.price) * fxFor(S.sale.currency, S.sale.fx)})">przywróć ${fmt2(num(S.sale.price) * fxFor(S.sale.currency, S.sale.fx))}</button>`;
  const P = numIn('s-price'), r = calc(it, ch, P, nv);
  $('s-wf').innerHTML = `
    <div class="r"><span>Kupujący płaci</span><b>${fmt2(P)}</b></div>
    <div class="r"><span>− prowizja ${esc(ch.name)}${num(ch.fee) ? ` (${num(ch.fee)}%)` : ''}</span><span>${r.fee ? '−' + fmt2(r.fee) : '—'}</span></div>
    <div class="r"><span>− wysyłka po Twojej stronie</span><span>${r.ship ? '−' + fmt2(r.ship) : '—'}</span></div>
    <div class="r tot"><span>Wpłynie na konto</span><span>${fmt2(r.cashIn)}</span></div>
    <div class="sep"></div>
    <div class="r"><span>− VAT ${nv ? '(sprzedaż przed rejestracją — brak)' : it.scheme === 'margin' ? 'od marży' : 'od sprzedaży (23/123)'}</span><span>${r.outVat ? '−' + fmt2(r.outVat) : '—'}</span></div>
    ${r.feeVat || r.shipVat ? `<div class="r sub"><span>+ VAT z faktur za prowizję i wysyłkę (odliczasz)</span><span>+${fmt2(r.feeVat + r.shipVat)}</span></div>` : ''}
    <div class="r"><span>− koszt towaru netto</span><span>−${fmt2(r.cost)}</span></div>
    <div class="r"><span>− ryczałt ${RYC()}% od przychodu bez VAT</span><span>−${fmt2(r.ryc)}</span></div>
    <div class="r tot"><span>Zysk na czysto</span><span class="${r.profit >= 0 ? 'pos' : 'neg'}">${fmt2(r.profit)}</span></div>`;
  $('s-res').innerHTML = `<div class="box"><div class="k">ROI (zysk / koszt)</div><div class="v ${r.roi >= TM() ? 'pos' : r.roi >= 0 ? 'warn' : 'neg'}">${pct(r.roi)}</div></div>
    <div class="box"><div class="k">Odłóż na podatki</div><div class="v">${fmt2(r.vatPay + r.ryc)}</div><div class="n">VAT ${fmt2(r.vatPay)} · ryczałt ${fmt2(r.ryc)}</div></div>`;
  if (!$('s-ret').hidden) renderRet();
}
function saveSale() {
  const P = numIn('s-price');
  if (P <= 0) { toast('Podaj cenę sprzedaży', 'err'); return; }
  const date = getv('s-date') || today(), ch = sCh();
  if (S.mode === 'edit') {
    const ref = S.ref.kind === 'card' ? state.cards.find(c => c.id === S.ref.id) : state.boxes.find(b => b.id === S.ref.id);
    ref.sale = { ...ref.sale, date, price: P, currency: 'PLN', fx: null, channel: S.ch, feePct: num(ch.fee), shippingOut: num(ch.ship), invoiced: $('s-inv').checked };
    close(); commit('Sprzedaż poprawiona'); return;
  }
  const x = S.list[+getv('s-item')]; if (!x) { toast('Wybierz towar', 'err'); return; }
  const sale = { date, price: P, currency: 'PLN', fx: null, channel: S.ch, feePct: num(ch.fee), feeAbs: num(ch.fixed), shippingOut: num(ch.ship), shippingIn: 0, orderId: '', refund: 0, invoiced: $('s-inv').checked, note: '' };
  let pnl;
  if (S.kind === 'card') {
    const card = state.cards.find(c => c.id === x.id);
    card.sale = sale; card.status = 'sold'; card.listing = null;
    pnl = calc(cItem(x), ch, P, sNoVat()).profit;
  } else {
    const box = state.boxes.find(b => b.id === x.items.find(i => !i.transit).id);
    box.sale = sale; box.status = 'sold';
    pnl = calc(gItem(x), ch, P, sNoVat()).profit;
  }
  close(); commit(`Sprzedane — zysk na czysto ${fmtPLN0(pnl, true)}`, pnl >= 0 ? 'ok' : 'err');
}
function deleteSale() {
  const ref = S.ref.kind === 'card' ? state.cards.find(c => c.id === S.ref.id) : state.boxes.find(b => b.id === S.ref.id);
  if (!ref || !confirm('Usunąć tę sprzedaż? Towar wróci na stan.')) return;
  ref.sale = null; ref.status = S.ref.kind === 'card' ? 'held' : 'sealed';
  close(); commit('Sprzedaż usunięta — towar wrócił na stan');
}
/* Zwrot: pełny (towar wraca) albo częściowy (rabat, towar zostaje u kupującego). */
function toggleRet() { $('s-ret').hidden = !$('s-ret').hidden; if (!$('s-ret').hidden) { S.ret = 'full'; drawRet(); } }
function drawRet() {
  const P = numIn('s-price'), com = saleCommission(S.sale);
  $('s-ret').innerHTML = `<h4>Zwrot</h4>
    <div class="seg" id="rt-type"><button data-v="full" class="${S.ret === 'full' ? 'active' : ''}">Pełny — towar wraca do mnie</button><button data-v="part" class="${S.ret === 'part' ? 'active' : ''}">Częściowy — oddaję część pieniędzy</button></div>
    <div class="ff-grid cols-3"><div class="ff"><label>Data zwrotu</label><input type="date" id="rt-date" value="${today() < S.sale.date ? S.sale.date : today()}"></div>
      <div class="ff"><label>Oddaję kupującemu (zł)</label><input id="rt-amt" inputmode="decimal" value="${S.ret === 'full' ? P.toFixed(2) : ''}" placeholder="np. 20"></div>
      ${S.ret === 'full' ? '<div class="ff"><label>Wysyłka zwrotna po mojej stronie (zł)</label><input id="rt-ship" inputmode="decimal" value="0"></div>' : '<div></div>'}</div>
    ${S.ret === 'full' && com > 0.005 ? `<label class="cx-check"><input type="checkbox" id="rt-fee"> Platforma oddała prowizję (${fmt2(com)})</label>` : ''}
    <div class="cx-wf" id="rt-wf"></div>
    <div class="cx-actions" style="justify-content:flex-end;margin:0"><button class="btn-small primary" onclick="UI.saveRet()">Zapisz zwrot</button></div>`;
  segBind('rt-type', v => { S.ret = v; drawRet(); });
  ['rt-date', 'rt-amt', 'rt-ship', 'rt-fee'].forEach(i => { if ($(i)) $(i).addEventListener('input', renderRet); });
  renderRet();
}
function renderRet() {
  if (!$('rt-wf')) return;
  const view = S.ref.kind === 'card' ? M.byId.get(S.ref.id) : M.boxes.find(b => b.id === S.ref.id);
  const s = M.sales.find(x => x.id === S.ref.id && !x.isReturn && !x.returned);
  const amt = numIn('rt-amt'), rs = $('rt-ship') ? numIn('rt-ship') : 0, feeBack = $('rt-fee') && $('rt-fee').checked ? saleCommission(S.sale) : 0;
  /* Jak w silniku: pełny zwrot po rejestracji koryguje cały VAT w dniu zwrotu; rabat zmniejsza podstawę proporcjonalnie. */
  const vRet = s.vat && (getv('rt-date') || today()) >= vatFrom() ? s.vat : 0;
  const vatShare = S.ret === 'full' ? vRet : (s.vat && s.taxable ? s.vat * Math.min(1, amt / s.taxable) : 0);
  const before = pnlNet(s);
  const res = s.net - amt + feeBack - rs - (s.vat - vRet) - (s.gross - amt - s.vat + vRet) * RYC() / 100;
  const after = before - amt + vatShare + (amt - vatShare) * RYC() / 100;
  const cost = S.ref.kind === 'card' ? view.basis : view.landed;
  $('rt-wf').innerHTML = S.ret === 'full' ? `
    <div class="r"><span>Wpłynęło ze sprzedaży</span><span>${fmt2(s.net)}</span></div>
    <div class="r"><span>− oddane kupującemu</span><span>−${fmt2(amt)}</span></div>
    ${feeBack ? `<div class="r"><span>+ prowizja wraca</span><span>+${fmt2(feeBack)}</span></div>` : ''}${rs ? `<div class="r"><span>− wysyłka zwrotna</span><span>−${fmt2(rs)}</span></div>` : ''}
    ${s.vat ? `<div class="r"><span>VAT po korekcie</span><span>−${fmt2(s.vat - vatShare)}</span></div><div class="r sub"><span>korekta −${fmt2(vatShare)} w JPK za ${mLow(mk(getv('rt-date') || today()))} — w miesiącu zwrotu</span><span></span></div>` : ''}
    <div class="r tot"><span>Koszt zwrotu (gotówka)</span><span class="${res >= 0 ? 'pos' : 'neg'}">${fmt2(res)}</span></div>
    <div class="r sub" style="padding-left:0"><span>${kindIco(S.ref.kind)} towar (koszt ${fmt2(cost)}) wraca na stan i możesz go sprzedać ponownie.</span><span></span></div>`
    : `<div class="r"><span>Zysk z tej sprzedaży teraz</span><span>${fmt2(before)}</span></div>
    <div class="r"><span>− oddane kupującemu</span><span>−${fmt2(amt)}</span></div>
    ${vatShare ? `<div class="r"><span>+ mniejszy VAT należny</span><span>+${fmt2(vatShare)}</span></div>` : ''}
    <div class="r tot"><span>Zysk po rabacie</span><span class="${after >= 0 ? 'pos' : 'neg'}">${fmt2(after)}</span></div>
    <div class="r sub" style="padding-left:0"><span>Towar zostaje u kupującego. VAT i przychód do ryczałtu zmniejszą się w miesiącu sprzedaży (${mLow(mk(S.sale.date))}).</span><span></span></div>`;
}
function saveRet() {
  const ref = S.ref.kind === 'card' ? state.cards.find(c => c.id === S.ref.id) : state.boxes.find(b => b.id === S.ref.id);
  const amt = numIn('rt-amt'), date = getv('rt-date') || today();
  if (amt < 0) { toast('Kwota nie może być ujemna', 'err'); return; }
  if (S.ret === 'part') {
    if (amt <= 0) { toast('Podaj kwotę rabatu', 'err'); return; }
    ref.sale = { ...ref.sale, refund: num(ref.sale.refund) + amt, note: [ref.sale.note, `rabat ${fmtPLN(amt)} (${dFull(date)})`].filter(Boolean).join('; ') };
    close(); commit('Rabat zapisany'); return;
  }
  if (date < ref.sale.date) { toast('Zwrot nie może być przed datą sprzedaży', 'err'); return; }
  const basis = S.ref.kind === 'card' ? (M.byId.get(ref.id) || {}).basis || 0 : boxLanded(ref);
  const r = { id: uid('ret'), date, refund: amt, shipping: $('rt-ship') ? numIn('rt-ship') : 0, feeBack: !!($('rt-fee') && $('rt-fee').checked), note: '', basis, sale: ref.sale };
  ref.returns = [...(ref.returns || []), r];
  ref.sale = null; ref.status = S.ref.kind === 'card' ? 'held' : 'sealed'; if (S.ref.kind === 'card') ref.listing = null;
  close(); commit('Zwrot zapisany — towar wrócił na stan');
}
function undoReturn(kind, id, retId) {
  const ref = kind === 'card' ? state.cards.find(c => c.id === id) : state.boxes.find(b => b.id === id);
  if (!ref || !ref.returns) return;
  const r = ref.returns[ref.returns.length - 1];
  if (!r || r.id !== retId) { toast('Cofnąć można tylko ostatni zwrot tej pozycji', 'err'); return; }
  if (ref.sale || (kind === 'box' && ref.status !== 'sealed')) { toast('Towar poszedł dalej (sprzedany albo otwarty) — najpierw cofnij tamto', 'err'); return; }
  if (!confirm('Cofnąć ten zwrot? Sprzedaż wróci jako zamknięta, a towar zniknie ze stanu.')) return;
  ref.returns = ref.returns.slice(0, -1); if (!ref.returns.length) delete ref.returns;
  ref.sale = r.sale; ref.status = 'sold'; if (kind === 'card') ref.listing = null;
  commit('Zwrot cofnięty');
}

/* ============================================================
   ZAKUP — zamówienie z kilkoma pozycjami, edycja, zwrot do sklepu
   ============================================================ */
const B = { mode: 'new', order: null, lines: [], doc: 'fv' };
const DOC_CHIPS = [['wnt', 'B2B z UE — faktura 0% (WNT)'], ['fv', 'Faktura PL z 23% VAT'], ['import', 'Import (dok. celny)'], ['foreign', 'Bez odliczenia — VAT w cenie'], ['private', 'Od osoby prywatnej']];
function fillShopSelect(sel) {
  const S2 = state.shops || [], byC = {};
  S2.forEach(s => (byC[s.cc] = byC[s.cc] || []).push(s));
  $('b-shop').innerHTML = '<option value="">— wybierz sklep —</option>' + Object.keys(byC).sort((a, b) => (a === '??') - (b === '??') || (a === 'PL' ? -1 : b === 'PL' ? 1 : a.localeCompare(b)))
    .map(cc => `<optgroup label="${cc === '??' ? COUNTRIES[cc] : `${cc} · ${COUNTRIES[cc] || cc}`}">${byC[cc].sort((a, b) => a.name.localeCompare(b.name)).map(s => `<option value="${s.id}">${esc(s.name)} — ${(SHOP_ST[s.st] || SHOP_ST.unknown).s}</option>`).join('')}</optgroup>`).join('') + '<option value="__new">＋ Nowy sklep…</option>';
  if (sel !== undefined) setv('b-shop', sel);
}
function pickShop() {
  const v = getv('b-shop');
  if (v === '__new') { setv('b-shop', ''); openShop(null, true); return; }
  const s = (state.shops || []).find(x => x.id === v);
  if (!s) { $('b-shop-hint').textContent = 'Wybierz sklep — dokument VAT i waluta ustawią się same. Nie ma go na liście? „＋ Nowy sklep…” na dole.'; renderBuy(); return; }
  if (vatOn()) B.doc = (SHOP_ST[s.st] || SHOP_ST.unknown).doc;
  setv('b-cur', s.cur || 'PLN');
  $('b-shop-hint').innerHTML = `<span class="cx-pill ${(SHOP_ST[s.st] || {}).tone || ''}">${(SHOP_ST[s.st] || SHOP_ST.unknown).l}</span> ${s.st === 'unknown' ? `— sprawdź na stronie sklepu, czy jest konto B2B. <a href="#" onclick="UI.openShop('${s.id}',true);return false">Uzupełnij</a>` : esc(s.note || '')}`;
  renderBuy();
}
function openBuy(oi, preset) {
  $('dl-products').innerHTML = [...new Set(state.boxes.map(b => b.name))].map(n => `<option value="${esc(n)}">`).join('');
  $('b-ret').hidden = true;
  if (oi != null) {
    const o = ORDERS[oi]; B.mode = 'edit'; B.order = o;
    $('b-title').textContent = 'Zamówienie — edycja';
    const sh = shopOfBox(o.items[0]); fillShopSelect(sh ? sh.id : '');
    const b0 = o.items[0];
    setv('b-date', o.date); setv('b-cur', b0.currency || 'PLN'); B.doc = b0.vatDoc || vatDocOf(b0);
    $('b-transit').checked = o.items.some(b => b.transit && b.status === 'sealed');
    const byName = {}; o.items.forEach(b => { (byName[b.name] = byName[b.name] || []).push(b); });
    B.lines = Object.entries(byName).map(([n, L]) => ({ n, q: L.length, p: String(num(L[0].price)), orig: n }));
    setv('b-ship', String(+sum(o.items, b => num(b.shipping)).toFixed(2)));
    $('b-shop-hint').innerHTML = `${o.items.length} szt. · ${Object.entries(o.st).map(([s, q]) => `${(ST_LBL[s] || [s])[0]} ${q}`).join(', ')}. Zmiana ceny przeliczy koszt i wynik także sprzedanych sztuk.`;
    $('b-foot').innerHTML = `<button class="btn-small ghost" style="margin-right:auto;color:var(--tc-neg)" onclick="UI.deleteOrder()"><span class="material-symbols-outlined">delete</span>Usuń zamówienie</button>
      <button class="btn-small" onclick="UI.toggleBuyRet()"><span class="material-symbols-outlined">undo</span>Zwrot do sklepu</button><button class="btn-small primary" onclick="UI.saveBuy()">Zapisz zmiany</button>`;
  } else {
    B.mode = 'new'; B.order = null; B.doc = vatOn() ? (settings.vat.defaultDoc || 'fv') : 'fv';
    B.lines = preset ? [preset.line] : [{ n: '', q: 1, p: '' }];
    $('b-title').textContent = 'Zakup'; fillShopSelect(''); setv('b-date', today()); setv('b-ship', ''); setv('b-cur', preset ? preset.cur : 'PLN');
    if (preset && preset.doc) B.doc = preset.doc;
    $('b-transit').checked = true;
    $('b-shop-hint').textContent = 'Wybierz sklep — dokument VAT i waluta ustawią się same. Nie ma go na liście? „＋ Nowy sklep…” na dole.';
    $('b-foot').innerHTML = `<button class="btn-small ghost" onclick="UI.close()">Anuluj</button><button class="btn-small primary" onclick="UI.saveBuy()">Zapisz zakup</button>`;
  }
  renderLines(); open_('m-buy'); renderBuy();
}
function renderLines() {
  $('b-lines').innerHTML = B.lines.map((l, i) => `<div class="cx-line">
    <input list="dl-products" placeholder="Produkt" value="${esc(l.n)}" oninput="UI.line(${i},'n',this.value)">
    <input type="number" min="1" value="${l.q}" oninput="UI.line(${i},'q',this.value)">
    <input inputmode="decimal" placeholder="0,00" value="${esc(l.p)}" oninput="UI.line(${i},'p',this.value)">
    <button class="x" title="Usuń pozycję" onclick="UI.delLine(${i})"><span class="material-symbols-outlined">close</span></button></div>`).join('');
}
function line(i, k, v) { B.lines[i][k] = k === 'q' ? Math.max(1, Math.round(num(v)) || 1) : v; renderBuy(); }
function addLine() { B.lines.push({ n: '', q: 1, p: '' }); renderLines(); renderBuy(); }
function delLine(i) { B.lines.splice(i, 1); if (!B.lines.length) B.lines.push({ n: '', q: 1, p: '' }); renderLines(); renderBuy(); }
function buyCalc() {
  const cur = getv('b-cur') || 'PLN', fx = cur === 'PLN' ? 1 : num(settings.fx[cur]) || 1, ship = numIn('b-ship') * fx;
  const L = B.lines.map(l => ({ ...l, gross: num(l.p) * fx * l.q }));
  const goods = sum(L, l => l.gross), gross = goods + ship, doc = VAT_DOCS[B.doc] || VAT_DOCS.unknown;
  const vatOf = g => !vatOn() || B.doc === 'wnt' ? 0 : doc.deduct ? vin(g) : 0;
  L.forEach(l => { l.ship = goods ? ship * l.gross / goods : 0; l.tot = l.gross + l.ship; l.vat = vatOf(l.tot); l.net = l.tot - l.vat; l.unitG = l.tot / l.q; l.unitN = l.net / l.q; });
  return { cur, fx, ship, L, gross, vat: vatOf(gross), net: gross - vatOf(gross), doc, goods };
}
function renderBuy() {
  if (vatOn()) chipRow('b-doc', DOC_CHIPS, B.doc, v => { B.doc = v; renderBuy(); }); else $('b-doc').innerHTML = '<span class="cx-note">VAT wyłączony</span>';
  const c = buyCalc(), q = sum(c.L, l => l.q), lost = vatOn() && B.doc === 'foreign' ? vin(c.gross) : 0;
  $('b-wf').innerHTML = `
    <div class="r"><span>Towar (${q} szt.)</span><span>${fmt2(c.goods)}</span></div>
    <div class="r"><span>Wysyłka</span><span>${c.ship ? fmt2(c.ship) : '—'}</span></div>
    <div class="r tot"><span>Płacisz razem${c.fx !== 1 ? ` (kurs ${c.fx})` : ''}</span><span>${fmt2(c.gross)}</span></div>
    ${vatOn() ? `<div class="r"><span>− VAT do odliczenia</span><span class="pos">${c.vat ? '−' + fmt2(c.vat) : '—'}</span></div>` : ''}
    ${B.doc === 'wnt' && vatOn() ? '<div class="r sub"><span>WNT: naliczasz i odliczasz 23% w JPK — wychodzi na zero</span><span></span></div>' : ''}
    <div class="r tot"><span>Koszt netto</span><span>${fmt2(c.net)}</span></div>
    ${lost ? `<div class="r warn" style="margin-top:6px"><span>VAT, którego nie odliczysz (ok. 23/123)</span><span>${fmt2(lost)}</span></div><div class="r sub"><span>z kontem B2B zapłaciłbyś ok. ${fmt2(c.gross - lost)} zamiast ${fmt2(c.gross)}</span><span></span></div>` : ''}
    ${vatOn() ? `<div class="r sub" style="padding-left:0"><span>${c.doc.margin ? 'Sprzedasz w VAT-marży — VAT tylko od zarobku.' : c.doc.deduct || B.doc === 'wnt' ? 'VAT nie zostaje w koszcie.' : 'VAT nie wróci — przy sprzedaży oddasz VAT od całej ceny.'}</span><span></span></div>` : ''}`;
  const filled = c.L.filter(l => l.n && l.gross);
  const scheme = c.doc.margin ? 'margin' : 'std';
  $('b-per').innerHTML = filled.length ? `<div class="tc-tbl-wrap"><table class="tc-tbl"><thead><tr><th>Pozycja</th><th class="num">Koszt/szt.</th><th class="num">Cena dla ROI ${TM()}% (${esc((CHS()[0] || {}).name || '')})</th><th class="num">Ostatnio sprzedane → zysk przy tym koszcie</th></tr></thead><tbody>` +
    filled.map(l => { const it = { cost: l.unitN, vatCost: l.unitG, scheme }; const ls = LAST[l.n]; const r = ls ? calc(it, chOf(ls.channel), ls.gross) : null;
      return `<tr><td>${l.q}× ${esc(l.n)}</td><td class="num">${fmt2(l.unitN)}</td><td class="num"><b>${fmt(recommend(it, CHS()[0] || chOf('Vinted')))}</b></td><td class="num">${r ? `${fmt(ls.gross)} ${esc(ls.channel)} → <b class="${r.profit >= 0 ? 'pos' : 'neg'}">${fmt(r.profit)}</b> <span class="mut">(${pct(r.roi)})</span>` : '<span class="mut">brak historii</span>'}</td></tr>`; }).join('') + '</tbody></table></div>' : '';
  if (!$('b-ret').hidden) renderBuyRet();
}
const guessBrand = n => (/topps/i.test(n) ? 'Topps' : /panini/i.test(n) ? 'Panini' : /futera/i.test(n) ? 'Futera' : /leaf/i.test(n) ? 'Leaf' : '');
const guessSeason = n => { const m = String(n).match(/(20\d\d)[\/-](\d{2,4})/); return m ? `${m[1]}/${m[2].slice(-2)}` : ''; };
const guessFormat = n => (/hobby/i.test(n) ? 'hobby' : /blaster/i.test(n) ? 'blaster' : /tin/i.test(n) ? 'tin' : /mega/i.test(n) ? 'mega' : /hanger/i.test(n) ? 'hanger' : /retail/i.test(n) ? 'retail' : 'other');
function saveBuy() {
  const shop = (state.shops || []).find(s => s.id === getv('b-shop'));
  if (!shop) { toast('Wybierz sklep', 'err'); return; }
  const c = buyCalc(), lines_ = c.L.filter(l => l.n.trim() && num(l.p) > 0);
  if (!lines_.length) { toast('Dodaj co najmniej jedną pozycję z ceną', 'err'); return; }
  const date = getv('b-date') || today(), transit = $('b-transit').checked;
  const fxv = c.cur === 'PLN' ? null : num(settings.fx[c.cur]);
  const shipPerUnit = l => (c.goods ? numIn('b-ship') * (l.gross / c.goods) / l.q : 0);
  const base = l => ({ name: l.n.trim(), brand: guessBrand(l.n), season: guessSeason(l.n), format: guessFormat(l.n), purpose: 'flip', date, price: num(l.p), currency: c.cur, fx: fxv, shipping: +shipPerUnit(l).toFixed(4), customs: 0, fees: 0, source: shop.name, shopId: shop.id, vatDoc: vatOn() ? B.doc : undefined });
  if (B.mode === 'new') {
    const orderId = uid('ord');
    for (const l of lines_) for (let i = 0; i < l.q; i++) state.boxes.push({ id: uid('box'), status: 'sealed', bulkValue: 0, createdAt: new Date().toISOString(), notes: '', ...base(l), orderId, transit });
    close(); commit(`Zakup zapisany: ${nBoxes(sum(lines_, l => l.q))}${transit ? ' w drodze' : ''}`); return;
  }
  /* Edycja: ceny i dane zamówienia dla wszystkich sztuk; liczba sztuk — dokładamy albo zdejmujemy nieotwarte. */
  const o = B.order, ids = new Set(o.items.map(b => b.id)), orderId = o.items[0].orderId || uid('ord');
  const mine = () => state.boxes.filter(b => ids.has(b.id));
  for (const l of lines_) {
    const cur = mine().filter(b => b.name === (l.orig || l.n));
    cur.forEach(b => Object.assign(b, base(l), { orderId, notes: b.notes, transit: b.status === 'sealed' ? transit : b.transit }));
    if (l.q > cur.length) for (let i = cur.length; i < l.q; i++) { const nb = { id: uid('box'), status: 'sealed', bulkValue: 0, createdAt: new Date().toISOString(), notes: '', ...base(l), orderId, transit }; state.boxes.push(nb); ids.add(nb.id); }
    if (l.q < cur.length) {
      const removable = cur.filter(b => b.status === 'sealed').slice(0, cur.length - l.q);
      if (removable.length < cur.length - l.q) { toast(`${l.n}: część sztuk jest już sprzedana albo otwarta — nie mogę ich usunąć`, 'err'); return; }
      const rm = new Set(removable.map(b => b.id)); state.boxes = state.boxes.filter(b => !rm.has(b.id));
    }
  }
  const keep = new Set(lines_.map(l => l.orig || l.n));
  const gone = mine().filter(b => !keep.has(b.name));
  if (gone.some(b => b.status !== 'sealed')) { toast('Usunięta pozycja ma sprzedane albo otwarte sztuki', 'err'); return; }
  const goneIds = new Set(gone.map(b => b.id)); state.boxes = state.boxes.filter(b => !goneIds.has(b.id));
  mine().filter(b => b.status === 'opened').forEach(b => reallocateBox(b.id));
  close(); commit('Zamówienie poprawione');
}
function deleteOrder() {
  const o = B.order; if (!o) return;
  const busy = o.items.filter(b => b.status !== 'sealed');
  if (busy.length) { toast(`${busy.length} szt. z tego zamówienia jest już sprzedanych albo otwartych — najpierw cofnij tamte zdarzenia`, 'err'); return; }
  if (!confirm(`Usunąć całe zamówienie (${nBoxes(o.items.length)})?`)) return;
  const ids = new Set(o.items.map(b => b.id)); state.boxes = state.boxes.filter(b => !ids.has(b.id));
  close(); commit('Zamówienie usunięte');
}
function toggleBuyRet() {
  $('b-ret').hidden = !$('b-ret').hidden; if ($('b-ret').hidden) return;
  const o = B.order, byName = {}; o.items.filter(b => b.status === 'sealed').forEach(b => { (byName[b.name] = byName[b.name] || []).push(b); });
  const names = Object.keys(byName);
  if (!names.length) { $('b-ret').innerHTML = '<p class="cx-note">Nie ma nieotwartych sztuk do zwrotu.</p>'; return; }
  $('b-ret').innerHTML = `<h4>Zwrot do sklepu</h4><div class="ff-grid cols-3">
    <div class="ff"><label>Pozycja</label><select id="br-line">${names.map(n => `<option value="${esc(n)}">${esc(n)} (${byName[n].length} szt.)</option>`).join('')}</select></div>
    <div class="ff"><label>Sztuk</label><input id="br-q" type="number" min="1" value="1"></div><div class="ff"><label>Data zwrotu</label><input id="br-date" type="date" value="${today()}"></div>
    <div class="ff"><label>Sklep oddał (zł)</label><input id="br-amt" inputmode="decimal"></div><div class="ff"><label>Koszt odesłania (zł)</label><input id="br-ship" inputmode="decimal" value="0"></div></div>
    <div class="cx-wf" id="br-wf"></div><div class="cx-actions" style="justify-content:flex-end;margin:0"><button class="btn-small primary" onclick="UI.saveBuyRet()">Zapisz zwrot</button></div>`;
  const first = byName[names[0]][0]; setv('br-amt', boxLanded(first).toFixed(2));
  ['br-line', 'br-q', 'br-amt', 'br-ship', 'br-date'].forEach(i => $(i).addEventListener('input', renderBuyRet));
  renderBuyRet();
}
function retBoxes() { const n = getv('br-line'); return B.order.items.filter(b => b.status === 'sealed' && b.name === n); }
function renderBuyRet() {
  if (!$('br-wf')) return;
  const L = retBoxes(), q = Math.min(L.length, Math.max(1, Math.round(numIn('br-q')) || 1)), paid = sum(L.slice(0, q), b => b.landedGross), ded = sum(L.slice(0, q), b => b.vatDed);
  const amt = numIn('br-amt'), sh = numIn('br-ship'), loss = paid - amt + sh;
  $('br-wf').innerHTML = `<div class="r"><span>Zapłaciłeś za ${q} szt.</span><span>${fmt2(paid)}</span></div><div class="r"><span>Wraca na konto</span><span>${fmt2(amt)}</span></div>${sh ? `<div class="r"><span>− koszt odesłania</span><span>−${fmt2(sh)}</span></div>` : ''}
    <div class="r tot"><span>${loss > 0.005 ? 'Koszt zwrotu (trafi do kosztów ogólnych)' : 'Bez straty'}</span><span class="${loss > 0.005 ? 'neg' : 'pos'}">${loss > 0.005 ? '−' + fmt2(loss) : '0 zł'}</span></div>
    ${ded > 0.005 ? `<div class="r sub" style="padding-left:0"><span>Odliczony VAT (${fmt2(ded)}) zniknie z rozliczenia — fakturę korygującą od sklepu wprowadź w ING.</span><span></span></div>` : ''}`;
}
function saveBuyRet() {
  const L = retBoxes(), q = Math.min(L.length, Math.max(1, Math.round(numIn('br-q')) || 1));
  const paid = sum(L.slice(0, q), b => b.landedGross), amt = numIn('br-amt'), sh = numIn('br-ship'), loss = paid - amt + sh, date = getv('br-date') || today();
  if (!confirm(`Zwrócić ${q} szt. „${getv('br-line')}” do sklepu?`)) return;
  const rm = new Set(L.slice(0, q).map(b => b.id)); state.boxes = state.boxes.filter(b => !rm.has(b.id));
  if (Math.abs(loss) > 0.005) state.expenses.push({ id: uid('exp'), date, category: 'other', amount: +loss.toFixed(2), note: `Zwrot do sklepu: ${getv('br-line')} ×${q}`, recurring: 'no' });
  close(); commit('Zwrot do sklepu zapisany');
}

/* ============================================================
   OTWIERAM BOX
   ============================================================ */
const O = { boxId: null, lines: [] };
function openOpen(gKey) {
  const g = gByKey(gKey); if (!g) return;
  const box = g.items.find(b => !b.transit); if (!box) return;
  O.boxId = box.id; O.lines = [{ p: '', s: '', v: '' }, { p: '', s: '', v: '' }];
  $('op-name').innerHTML = `${kindIco('box')} ${esc(box.name)}`;
  $('op-cost').textContent = `koszt netto ${fmt2(box.landed)} · na stanie ${g.n} szt. — otwierasz jedną`;
  setv('op-date', today()); setv('op-bulk', ''); setv('op-note', '');
  renderPulls(); open_('m-open');
}
function renderPulls() {
  $('op-lines').innerHTML = O.lines.map((l, i) => `<div class="cx-line op"><input placeholder="np. Lamine Yamal" value="${esc(l.p)}" oninput="UI.pull(${i},'p',this.value)"><input placeholder="np. Gold /50" value="${esc(l.s)}" oninput="UI.pull(${i},'s',this.value)"><input inputmode="decimal" placeholder="zł" value="${esc(l.v)}" oninput="UI.pull(${i},'v',this.value)"><button class="x" onclick="UI.delPull(${i})"><span class="material-symbols-outlined">close</span></button></div>`).join('');
  renderOpenCalc();
}
function pull(i, k, v) { O.lines[i][k] = v; if (k === 'v') renderOpenCalc(); }
function addPull() { O.lines.push({ p: '', s: '', v: '' }); renderPulls(); }
function delPull(i) { O.lines.splice(i, 1); if (!O.lines.length) O.lines.push({ p: '', s: '', v: '' }); renderPulls(); }
function renderOpenCalc() {
  const box = M.boxes.find(b => b.id === O.boxId); if (!box) return;
  const hits = sum(O.lines.filter(l => l.p.trim()), l => num(l.v)), bulk = numIn('op-bulk'), val = hits + bulk, cost = box.landed;
  const n = O.lines.filter(l => l.p.trim()).length, bs = M.breakStats;
  $('op-wf').innerHTML = `<div class="r"><span>Koszt boxa (netto)</span><span>${fmt2(cost)}</span></div><div class="r"><span>Hity (${nCards(n)})</span><span>${fmt2(hits)}</span></div><div class="r"><span>Bulk</span><span>${fmt2(bulk)}</span></div>
    <div class="r tot"><span>Wynik breaka (na papierze)</span><span class="${val - cost >= 0 ? 'pos' : 'neg'}">${fmt2(val - cost)} · ${cost ? (val / cost).toFixed(2).replace('.', ',') : '0'}×</span></div>
    ${bs.count ? `<div class="r sub"><span>Twoja średnia z ${bs.count} breaków: ${bs.cost ? (bs.ret / bs.cost).toFixed(2).replace('.', ',') : '—'}×</span><span></span></div>` : ''}`;
}
function saveOpen() {
  const box = state.boxes.find(b => b.id === O.boxId); if (!box) return;
  const date = getv('op-date') || today();
  for (const l of O.lines.filter(x => x.p.trim())) {
    const id = uid('card');
    const m = String(l.s).match(/\/\s*(\d+)/);
    state.cards.push({ id, status: 'held', condition: 'NM-MT', grade: null, createdAt: new Date().toISOString(), player: l.p.trim(), parallel: l.s.trim(), run: m ? m[1] : '', product: box.name, brand: box.brand, season: box.season, rookie: false, auto: /auto/i.test(l.s), patch: /patch/i.test(l.s), acq: 'box', boxId: box.id, date, price: 0, currency: 'PLN', shipping: 0, fees: 0, customs: 0, source: box.name });
    if (num(l.v) > 0) upsertValuation(id, date, num(l.v), 'Break');
  }
  box.status = 'opened'; box.openedDate = date; box.bulkValue = numIn('op-bulk'); box.breakNote = getv('op-note').trim(); box.transit = false;
  reallocateBox(box.id);
  close(); commit('Break zapisany — karty są w Magazynie → Karty');
}

/* ============================================================
   KALKULATOR OPŁACALNOŚCI (przed zakupem)
   ============================================================ */
let kDed = true;
let kTryP = {};   // „Twoja cena” wpisana w karcie kanału (np. konkurencja minus 10 zł)
function kTryHtml(it, c, P) {
  if (!(P > 0) || !it.cost) return '';
  const r = calc(it, c, P), rec = recommend(it, c, num(getv('k-roi')));
  return `<div class="cx-note" style="margin-top:6px">zysk <b class="${r.profit >= 0 ? 'pos' : 'neg'}">${fmt2(r.profit)}</b> · ROI <span class="cx-pill ${r.roi >= num(getv('k-roi')) ? 'pos' : r.roi >= 0 ? 'warn' : 'neg'}">${pct(r.roi)}</span> · marża ${pct(r.profit / P * 100)}<br>na konto ${fmt2(r.cashIn)} · VAT ${fmt2(r.vatPay)} · ryczałt ${fmt2(r.ryc)}${P !== rec ? ` · ${P < rec ? fmt(rec - P) + ' poniżej' : fmt(P - rec) + ' powyżej'} rekomendowanej` : ''}</div>`;
}
function kTry(i, v) {
  const c = CHS()[i]; if (!c) return;
  kTryP[c.name] = v; $('k-try-' + i).innerHTML = kTryHtml(calcItem(), c, parseFloat(String(v).replace(',', '.')));
}
function openCalc() {
  $('dl-products').innerHTML = [...new Set(state.boxes.map(b => b.name))].map(n => `<option value="${esc(n)}">`).join('');
  kTryP = {}; setv('k-roi', TM()); $('k-roi-q').innerHTML = [10, 20, 30, 50].map(v => `<button onclick="UI.kRoi(${v})">${v}%</button>`).join('');
  open_('m-calc'); renderCalc(); setTimeout(() => $('k-price').focus(), 50);
}
function calcItem() {
  const cur = getv('k-cur') || 'PLN', fx = cur === 'PLN' ? 1 : num(settings.fx[cur]) || 1, c = (numIn('k-price') + numIn('k-ship')) * fx;
  return kDed ? { cost: c, vatCost: c * (1 + vatRate() / 100), scheme: 'std', fx } : { cost: c, vatCost: c, scheme: 'std', fx };
}
function renderCalc() {
  const roi = num(getv('k-roi')); $('k-roi-v').textContent = roi + '%';
  chipRow('k-vat', [['1', 'Odliczam VAT — B2B z UE albo faktura PL'], ['0', 'Nie odliczam — VAT zostaje w koszcie']], kDed ? '1' : '0', v => { kDed = v === '1'; renderCalc(); });
  $('k-price-l').textContent = kDed ? 'Cena za szt. netto' : 'Cena za szt. brutto';
  const it = calcItem();
  $('k-sum').innerHTML = `<div class="r"><span>Koszt na sztukę${it.fx !== 1 ? ` (kurs ${it.fx})` : ''}</span><b>${fmt2(it.cost)}</b></div>
    <div class="r sub"><span>${kDed ? 'VAT wraca — liczę od netto' : 'VAT nie wraca — przy sprzedaży oddasz VAT od całej ceny'}</span><span></span></div>
    <div class="r"><span>Cel: zysk na czysto</span><b>${fmt2(it.cost * roi / 100)} (${roi}% ROI)</b></div>`;
  const name = getv('k-name').trim();
  const H = name ? deals().filter(s => normName(s.name) === normName(name)).sort((a, b) => (b.date < a.date ? -1 : 1)) : [];
  $('k-hist').innerHTML = name ? (H.length ? `<p class="cx-note" style="margin:10px 0 4px"><b>Twoja historia:</b> ${H.length} szt., średnio ${fmt(sum(H, s => s.gross) / H.length)}, ${Math.round(sum(H, s => s.days || 0) / H.length)} dni na stanie</p>` +
    H.slice(0, 4).map(s => { const r = calc(it, chOf(s.channel), s.gross); return `<div class="cx-vl"><span class="mut">${dShort(s.date)}</span><span>${dot(s.channel)} ${esc(s.channel)} · ${fmt(s.gross)}</span><b class="${r.profit >= 0 ? 'pos' : 'neg'}">${fmt(r.profit)}</b></div>`; }).join('') : '<p class="cx-note" style="margin-top:10px">Nie sprzedawałeś jeszcze tego produktu.</p>') : '';
  if (!it.cost) { $('k-out').innerHTML = empty('Wpisz cenę zakupu.'); return; }
  const mkt = numIn('k-market'), lv = [0, 10, 20, 30, 40, 50];
  $('k-out').innerHTML = `
    <div class="cd-section" style="margin-top:6px"><span class="ico"><span class="material-symbols-outlined">sell</span></span><h2>Po ile wystawić, żeby mieć ${roi}% na czysto</h2><span class="line"></span></div>
    <div class="cx-grid3">${CHS().slice(0, 3).map((c, i) => { const P = recommend(it, c, roi), r = calc(it, c, P); return `<div class="tc-card"><div class="tc-card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>${dot(c.name)} ${esc(c.name)}</b><span class="cx-note">${num(c.fee) ? num(c.fee) + '% prowizji' : 'bez prowizji'}${num(c.ship) ? ` · wysyłka ${fmt2(num(c.ship))}` : ''}</span></div>
      <div style="font-size:26px;font-weight:700;font-family:var(--mono);margin:8px 0 4px">${fmt(P)}</div>
      <div class="cx-note">minimum dla ${roi}%: ${fmt2(breakPrice(it, c, roi))} — zaokrąglone w górę do końcówki 4/9</div>
      <div class="cx-note">na konto ${fmt2(r.cashIn)} · VAT ${fmt2(r.vatPay)} · ryczałt ${fmt2(r.ryc)}<br>zysk <b class="pos">${fmt2(r.profit)}</b> · ROI ${pct(r.roi)} · marża ${pct(r.profit / P * 100)}</div>
      <div class="cx-try"><label class="cx-note" for="k-tryin-${i}">Twoja cena (np. konkurencja − 10 zł)</label><input id="k-tryin-${i}" inputmode="decimal" placeholder="np. ${fmt(Math.max(0, P - 10)).replace(/\s?zł/, '')}" value="${esc(kTryP[c.name] || '')}" oninput="UI.kTry(${i}, this.value)"><div id="k-try-${i}">${kTryHtml(it, c, parseFloat(String(kTryP[c.name] || '').replace(',', '.')))}</div></div></div></div>`; }).join('')}</div>
    ${mkt ? `<div class="cd-section"><span class="ico"><span class="material-symbols-outlined">storefront</span></span><h2>Przy cenie rynkowej ${fmt(mkt)}</h2><span class="line"></span></div>
    <div class="tc-card"><div class="tc-tbl-wrap"><table class="tc-tbl"><thead><tr><th>Kanał</th><th class="num">Na konto</th><th class="num">VAT + ryczałt</th><th class="num">Zysk</th><th class="num">ROI</th><th class="num">Maks. cena zakupu dla ${roi}% ROI</th></tr></thead><tbody>
      ${CHS().slice(0, 4).map(c => { const r = calc(it, c, mkt); const keep = r.cashIn - r.vatPay - r.ryc; const maxC = keep / (1 + roi / 100); const maxIn = maxC / it.fx - numIn('k-ship');
        return `<tr><td><b>${dot(c.name)} ${esc(c.name)}</b></td><td class="num">${fmt2(r.cashIn)}</td><td class="num mut">${fmt2(r.vatPay + r.ryc)}</td><td class="num ${r.profit >= 0 ? 'pos' : 'neg'}"><b>${fmt2(r.profit)}</b></td><td class="num"><span class="cx-pill ${r.roi >= roi ? 'pos' : r.roi >= 0 ? 'warn' : 'neg'}">${pct(r.roi)}</span></td><td class="num"><b>${maxIn.toFixed(2).replace('.', ',')}</b> ${esc(getv('k-cur'))} ${kDed ? 'netto' : 'brutto'}</td></tr>`; }).join('')}</tbody></table></div></div>
    <p class="cx-note">${(() => { const best = CHS().slice(0, 4).map(c => ({ c, r: calc(it, c, mkt) })).sort((a, b) => b.r.profit - a.r.profit)[0]; return !best ? '' : best.r.roi >= roi ? `Opłaca się: najlepiej na ${esc(best.c.name)} — ${fmt2(best.r.profit)} zysku (${pct(best.r.roi)} ROI).` : best.r.profit > 0 ? `Zarobisz, ale poniżej celu: najlepiej ${esc(best.c.name)} — ${pct(best.r.roi)} ROI. Negocjuj cenę zakupu do kwoty z ostatniej kolumny.` : 'Przy tej cenie rynkowej tracisz na każdym kanale.'; })()}</p>` : ''}
    <div class="cd-section"><span class="ico"><span class="material-symbols-outlined">tune</span></span><h2>Co jeśli zmienisz ROI</h2><span class="desc">cena wystawienia / zysk na czysto</span><span class="line"></span></div>
    <div class="tc-card"><div class="tc-tbl-wrap"><table class="tc-tbl"><thead><tr><th>ROI</th>${CHS().slice(0, 3).map(c => `<th class="num">${dot(c.name)} ${esc(c.name)}</th>`).join('')}</tr></thead><tbody>
      ${lv.map(l => `<tr class="${l === roi ? 'sel' : ''}"><td><b>${l}%</b>${l === 0 ? ' <span class="cx-note">na zero</span>' : ''}</td>${CHS().slice(0, 3).map(c => { const P = recommend(it, c, l), r = calc(it, c, P); return `<td class="num">${fmt(P)} <span class="mut">/ ${fmt(r.profit)}</span>${mkt && P <= mkt ? ' <span class="cx-pill pos">≤ rynek</span>' : ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}
function calcToBuy() {
  const name = getv('k-name').trim(), p = getv('k-price'), cur = getv('k-cur');
  close(); openBuy(null, { line: { n: name, q: 1, p }, cur, doc: kDed ? 'wnt' : 'foreign' });
  toast(kDed ? 'Wybierz sklep z B2B albo z fakturą PL' : 'Wybierz sklep');
}

/* ============================================================
   SKLEP
   ============================================================ */
let shEdit = null, shFromBuy = false, shSt = 'unknown';
function openShop(id, fromBuy) {
  shEdit = id ? state.shops.find(s => s.id === id) : null; shFromBuy = !!fromBuy;
  $('sh-title').textContent = shEdit ? 'Sklep — edycja' : 'Nowy sklep'; $('sh-del').style.display = shEdit ? '' : 'none';
  $('sh-cc').innerHTML = Object.entries(COUNTRIES).map(([k, v]) => `<option value="${k}">${k === '??' ? v : `${k} — ${v}`}</option>`).join('');
  setv('sh-name', shEdit ? shEdit.name : ''); setv('sh-url', shEdit ? shEdit.url : ''); setv('sh-note', shEdit ? shEdit.note : '');
  setv('sh-cc', shEdit ? shEdit.cc : 'DE'); setv('sh-cur', shEdit ? shEdit.cur : 'EUR'); shSt = shEdit ? shEdit.st : 'unknown';
  open_('m-shop'); renderShopSt(); setTimeout(() => $('sh-name').focus(), 50);
}
function renderShopSt() {
  const z = zone(getv('sh-cc'));
  if (!SHOP_ST[shSt] || !SHOP_ST[shSt].zones.includes(z)) shSt = 'unknown';
  chipRow('sh-st', Object.entries(SHOP_ST).filter(([k, v]) => v.zones.includes(z)).map(([k, v]) => [k, v.l, v.tone]), shSt, v => { shSt = v; renderShopSt(); });
  $('sh-st-hint').textContent = SHOP_ST[shSt].hint;
}
function closeShop() { $('m-shop').classList.remove('on'); if (shFromBuy) fillShopSelect(getv('b-shop')); }
function saveShop() {
  const name = getv('sh-name').trim(); if (!name) { toast('Podaj nazwę sklepu', 'err'); return; }
  const data = { name, cc: getv('sh-cc'), url: getv('sh-url').trim(), cur: getv('sh-cur'), st: shSt, note: getv('sh-note').trim() };
  let s = shEdit;
  if (s) { if (s.name !== name) s.alias = [...new Set([...(s.alias || []), s.name])]; Object.assign(s, data); }
  else { s = { id: uid('shop'), alias: [name], ...data }; state.shops.push(s); }
  $('m-shop').classList.remove('on');
  commit(shEdit ? 'Sklep zapisany' : 'Sklep dodany');
  if (shFromBuy) { fillShopSelect(s.id); pickShop(); }
}
function deleteShop() {
  if (!shEdit || !confirm(`Usunąć „${shEdit.name}” z bazy sklepów? Zakupy zostaną, tylko bez przypisanego sklepu.`)) return;
  state.shops = state.shops.filter(s => s !== shEdit); $('m-shop').classList.remove('on'); commit('Sklep usunięty');
}

/* ============================================================
   ZAKUP FIRMOWY / FAKTURA B2B (pozycje JPK spoza kart)
   ============================================================ */
let bzEdit = null;
function openBiz(id, cat) {
  bzEdit = id ? extraById(id) : null;
  $('bz-cat').innerHTML = Object.entries(BIZ).map(([k, v]) => `<option value="${k}">${v.l}${v.pct < 100 ? ` (${v.pct}% VAT)` : ''}</option>`).join('');
  $('bz-title').textContent = bzEdit ? 'Pozycja VAT — edycja' : 'Zakup firmowy albo faktura B2B';
  $('bz-del').style.display = bzEdit ? '' : 'none';
  if (bzEdit) {
    setv('bz-cat', catOf(bzEdit)); setv('bz-date', bzEdit.date); setv('bz-label', bzEdit.label);
    const isOut = bzEdit.side === 'out';
    setv('bz-gross', isOut ? num(bzEdit.base) : num(bzEdit.gross) || +(num(bzEdit.base) + num(bzEdit.vatFull || bzEdit.vat)).toFixed(2));
    setv('bz-vat', num(bzEdit.vatFull || bzEdit.vat)); setv('bz-pct', isOut ? 100 : num(bzEdit.pct) || 100); $('bz-rec').checked = !!bzEdit.rec;
  } else { setv('bz-cat', cat || 'phone'); setv('bz-date', today()); ['bz-label', 'bz-gross', 'bz-vat'].forEach(i => setv(i, '')); bzCat(); }
  open_('m-biz'); bzCalc(true);
}
function bzCat() { const v = BIZ[getv('bz-cat')]; setv('bz-pct', v.pct); $('bz-rec').checked = getv('bz-cat') === 'phone' || getv('bz-cat') === 'b2b'; bzCalc(); }
function bzCalc(keep) {
  const cat = getv('bz-cat'), isOut = cat === 'b2b', g = numIn('bz-gross');
  $('bz-gross').previousElementSibling.textContent = isOut ? 'Kwota netto faktury (zł)' : 'Kwota brutto (zł)';
  $('bz-pct').closest('.ff').style.display = isOut ? 'none' : '';
  if (!keep) setv('bz-vat', g ? (isOut ? g * vatRate() / 100 : vin(g)).toFixed(2) : '');
  const vat = numIn('bz-vat'), p = isOut ? 100 : numIn('bz-pct'), ded = vat * p / 100, c = BIZ[cat];
  $('bz-wf').innerHTML = isOut ? `<div class="r"><span>Netto</span><span>${fmt2(g)}</span></div><div class="r"><span>VAT należny 23%</span><span class="neg">+${fmt2(vat)}</span></div><div class="r tot"><span>Klient płaci brutto</span><span>${fmt2(g + vat)}</span></div><div class="r sub" style="padding-left:0"><span>VAT z tej faktury odłóż — zapłacisz go w JPK za ${mLow(mk(getv('bz-date') || today()))}.</span><span></span></div>`
    : `<div class="r"><span>VAT z faktury</span><span>${fmt2(vat)}</span></div><div class="r"><span>Odliczasz ${p}%${c.hint ? ` <span class="cx-note">— ${c.hint}</span>` : ''}</span><span class="pos">${fmt2(ded)}</span></div>${p < 100 ? `<div class="r sub"><span>reszta (${fmt2(vat - ded)}) zostaje w koszcie</span><span></span></div>` : ''}<div class="r tot"><span>Przelew VAT za ${mLow(mk(getv('bz-date') || today()))} mniejszy o</span><span class="pos">${fmt2(ded)}</span></div>`;
}
function saveBiz() {
  const cat = getv('bz-cat'), isOut = cat === 'b2b', g = numIn('bz-gross'), vat = numIn('bz-vat'), p = isOut ? 100 : numIn('bz-pct'), date = getv('bz-date') || today();
  if (!vat || !g) { toast('Podaj kwotę', 'err'); return; }
  const label = getv('bz-label').trim() || BIZ[cat].l;
  const rec = isOut ? { side: 'out', cat, date, label, base: g, vat, rec: $('bz-rec').checked }
    : { side: 'in', cat, date, label, gross: g, vatFull: vat, pct: p, vat: +(vat * p / 100).toFixed(2), base: +(g - vat).toFixed(2), rec: $('bz-rec').checked };
  if (bzEdit) Object.assign(bzEdit, rec); else settings.vat.extra = [...(settings.vat.extra || []), { id: uid('vx'), ...rec }];
  vmSel = vatPeriodOf(date); close(); commit(bzEdit ? 'Zapisane' : (isOut ? 'Faktura B2B dodana' : 'Dodane do odliczeń'));
}
function deleteBiz() { if (!bzEdit || !confirm('Usunąć tę pozycję?')) return; settings.vat.extra = settings.vat.extra.filter(x => x !== bzEdit); close(); commit('Usunięte'); }

/* ============================================================
   Start, migracja, eksport
   ============================================================ */
const SHOP_SEED = [
  ['Topps Europe', 'DE', 'shop-de.topps.com', ['Topps Europe (shop-de.topps.com)']], ['dennistheripper.de', 'DE', 'dennistheripper.de', ['dennistheripper.de']],
  ['cobracards.de', 'DE', 'cobracards.de', ['cobracards.de']], ['Yocardo', 'DE', '', ['Yocardo GmbH']],
  ['Card Culture (dacardworld.eu)', 'NL', 'dacardworld.eu', ['dacardworld.eu', 'Card Culture / dacardworld.eu']], ['Grizi Cards', 'ES', '', ['Grizi Cards']],
  ['Flash Store', 'ES', '', ['Flash Store (ES)']], ['El Rincón del Coleccionista', 'ES', '', ['El Rincón del Coleccionista (ES)']],
  ['Invest Collect', 'FR', 'investcollect.com', ['Invest Collect (FR)']], ['ScCards', 'IT', '', ['ScCards (IT)']], ['Boozt', 'SE', 'boozt.com', ['Boozt']],
  ['Liverpool FC Store', 'UK', 'store.liverpoolfc.com', ['Liverpool FC Online Store (UK)']], ['Premier League Shop', 'UK', 'shop.premierleague.com', ['Premier League shop']],
  ['Empik', 'PL', 'empik.com', ['Empik (salon)', 'Empik'], 'fv', 'w salonie proś o paragon z NIP albo fakturę'], ['VonHalsky', 'PL', '', ['VonHalsky'], 'fv'],
  ['Cards Hub', '??', 'cardshub.eu', ['Cards Hub', 'cardshub.eu'], 'b2b', 'B2B potwierdzone — zamówienie bez VAT na firmę'],
  ['Soccer Cards United', '??', '', ['Soccer Cards United']], ['ax.cards', '??', 'ax.cards', ['ax.cards']], ['MafiosiCards', '??', '', ['MafiosiCards']], ['Atlantic Collectibles', '??', '', ['Atlantic Collectibles']]
];
/* Jednorazowo: baza sklepów z dotychczasowych zakupów, ukrycie nieużywanych kanałów. */
function migrateUi() {
  let changed = false;
  if (!state.shops.length) {
    const sources = new Set(state.boxes.map(b => b.source).filter(Boolean));
    for (const [name, cc, url, alias, st, note] of SHOP_SEED) {
      if (!alias.some(a => sources.has(a))) continue;
      state.shops.push({ id: uid('shop'), name, cc, url, alias, st: st || 'unknown', cur: cc === 'PL' ? 'PLN' : cc === 'UK' ? 'GBP' : 'EUR', note: note || '' });
    }
    const known = new Set(state.shops.flatMap(s => s.alias));
    [...sources].filter(s => !known.has(s)).forEach(s => state.shops.push({ id: uid('shop'), name: s, cc: '??', url: '', alias: [s], st: 'unknown', cur: 'EUR', note: '' }));
    changed = true;
  }
  if (settings.channels.every(c => c.hidden === undefined)) {
    const used = new Set([...state.boxes, ...state.cards].filter(x => x.sale).map(x => x.sale.channel));
    settings.channels.forEach(c => { c.hidden = !(used.has(c.name) || ['Vinted', 'Empik', 'Allegro'].includes(c.name)); });
    changed = true;
  }
  /* Jednorazowe przejście na nowy moduł (na danych, które już są w przeglądarce). */
  if (!settings.uiV2) {
    /* Dowody wewnętrzne sprzed listopada były wprowadzane do ING na bieżąco. */
    state.dwDone = state.dwDone || {};
    [...state.boxes, ...state.cards].forEach(x => {
      const dates = [x.sale && x.sale.date, ...((x.returns || []).flatMap(r => [r.date, r.sale && r.sale.date]))].filter(Boolean);
      dates.forEach(d => { if (d < '2026-11-01') state.dwDone[d] = true; });
    });
    /* Summer Signings z zamówienia z 18.09 jeszcze nie dotarło. */
    state.boxes.forEach(b => { if (b.status === 'sealed' && /summer signings/i.test(b.name) && b.date === '2026-09-18' && b.transit === undefined) b.transit = true; });
    /* Koszty kanałów z historii sprzedaży (zostawione bez zmian, jeśli już je ustawiłeś). */
    const ch = n => settings.channels.find(c => c.name === n);
    const al = ch('Allegro'), em = ch('Empik');
    if (al && num(al.fee) === 9 && !num(al.ship)) { al.fee = 10.5; al.ship = 7.99; }
    if (em && !num(em.ship)) em.ship = 16.49;
    settings.uiV2 = today();
    changed = true;
  }
  if (changed) savePrefs();
}
function init() {
  loadState();
  migrateUi();
  rebuild();
  try { publishCardsSummary(M); } catch (e) { /* Dashboard dostanie dane przy najbliższym zapisie */ }
  document.querySelectorAll('#cx-tabs .trade-tab, .cx-gear').forEach(b => b.addEventListener('click', () => go(b.dataset.v)));
  segBind('stock-kind', v => { stockKind = v; renderStock(); });
  segBind('stock-filter', v => { stockF = v; renderStock(); });
  $('stock-q').addEventListener('input', renderStock);
  segBind('sf-kind', v => { SF.k = v; renderSales(); });
  $('sf-q').addEventListener('input', () => { SF.q = getv('sf-q').trim().toLowerCase(); renderSales(); });
  segBind('shops-filter', v => { shF = v; renderShops(); });
  $('shops-q').addEventListener('input', renderShops);
  [['r-metric', 'metric', v => v], ['r-kind', 'kind', v => v], ['r-days', 'days', v => +v], ['r-per', 'per', v => v], ['r-chp', 'chp', v => +v]].forEach(([id, k, cv]) => segBind(id, v => { R[k] = cv(v); renderResults(); }));
  segBind('s-kind', v => { S.kind = v; S.ch = v === 'card' ? (settings.cardChannel || S.ch) : S.ch; setFeeFromCh(); fillSellItems(); renderSell(); });
  $('s-item').addEventListener('change', () => { setv('s-price', defaultPrice()); renderSell(); });
  ['s-price', 's-pct', 's-ship', 's-date'].forEach(i => $(i).addEventListener('input', renderSell));
  $('b-shop').addEventListener('change', pickShop);
  ['b-ship', 'b-cur'].forEach(i => $(i).addEventListener('input', renderBuy));
  $('op-bulk').addEventListener('input', renderOpenCalc);
  ['k-name', 'k-price', 'k-cur', 'k-ship', 'k-roi', 'k-market'].forEach(i => $(i).addEventListener('input', renderCalc));
  $('sh-cc').addEventListener('change', renderShopSt);
  $('bz-cat').addEventListener('change', bzCat);
  ['bz-gross', 'bz-date'].forEach(i => $(i).addEventListener('input', () => bzCalc()));
  ['bz-vat', 'bz-pct'].forEach(i => $(i).addEventListener('input', () => bzCalc(true)));
  bindSettings();
  document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; if ($('m-shop').classList.contains('on')) closeShop(); else close(); });
  window.addEventListener('storage', e => { if (e.key === CARDS_KEY) { loadState(); rebuild(); renderAll(); } });
  renderCounts();
  const h = (location.hash || '').slice(1);
  go(['home', 'stock', 'sales', 'buys', 'shops', 'results', 'vat', 'rev', 'settings'].includes(h) ? h : 'home');
}

window.UI = {
  go, close, stockFilter, deliver: key => { const g = gByKey(key); if (!g) return; g.items.forEach(b => { const x = state.boxes.find(y => y.id === b.id); x.transit = false; x.deliveredDate = today(); }); commit(`Dostarczone: ${g.n}× ${g.name}`); },
  openSell, editSale, saveSale, deleteSale, toggleRet, saveRet, undoReturn, setPrice: p => { setv('s-price', p); renderSell(); }, feeReset: () => { setFeeFromCh(); renderSell(); },
  salesCh: v => { SF.ch = v; renderSales(); }, toastInfo: t => toast(t),
  openBuy, saveBuy, deleteOrder, toggleBuyRet, saveBuyRet, line, addLine, delLine,
  openOpen, saveOpen, pull, addPull, delPull,
  openCalc, calcToBuy, kTry, kRoi: v => { setv('k-roi', v); renderCalc(); },
  openShop, saveShop, closeShop, deleteShop, setShopSt,
  vatMonth, vatPaid, addB2b, repeatBiz, exportVat, openBiz, saveBiz, deleteBiz,
  revMonth, dwDone, copyDw, exportDw,
  setCh, addChannel, exportCsv: () => exportCsv(), backupJson
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
