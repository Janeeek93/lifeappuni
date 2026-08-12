/* ============================================================
   KARTY PIŁKARSKIE — kolekcja, breaki, odsprzedaż
   Dane lokalne: lifeos_cards_v1 (localStorage)

   Model danych trzyma jedną zasadę: wycena karty NIE jest polem
   karty, tylko wpisem w historii wycen. Dzięki temu wartość
   kolekcji da się odtworzyć na dowolny dzień wstecz, a wykresy
   liczą się z tego samego źródła co tabele.
   ============================================================ */

const CARDS_KEY = 'lifeos_cards_v1';

const DEFAULT_SETTINGS = {
  fx: { EUR: 4.30, USD: 3.95, GBP: 5.05 },
  fxUpdated: null,
  alloc: 'value',          // podział kosztu boxa: value | equal | none
  bulkOffset: 'yes',       // czy bulk pomniejsza bazę kosztową pulli
  valDays: 30,             // po ilu dniach wycena jest nieaktualna
  agingDays: 180,          // martwy stock
  listingDays: 60,         // stare ogłoszenie
  sealedDays: 90,          // sealed czekający na decyzję
  targetMargin: 30,
  concAlert: 25,
  channels: [
    { name: 'Vinted', fee: 0 },
    { name: 'eBay', fee: 11 },
    { name: 'Cardmarket', fee: 5 },
    { name: 'Allegro', fee: 9 },
    { name: 'OLX', fee: 0 },
    { name: 'Facebook / grupy', fee: 0 },
    { name: 'Whatnot', fee: 8 },
    { name: 'Giełda / konwent', fee: 0 },
    { name: 'Prywatnie', fee: 0 }
  ]
};

const SUGGEST = {
  brands: ['Topps', 'Panini', 'Futera', 'Leaf', 'Merlin', 'Upper Deck'],
  products: [
    'Topps Chrome UCL', 'Topps Finest UCL', 'Topps Merlin Chrome', 'Topps Stadium Club',
    'Topps Museum Collection', 'Topps Inception', 'Panini Prizm World Cup', 'Panini Prizm Premier League',
    'Panini Select', 'Panini Mosaic', 'Panini Donruss', 'Panini Obsidian', 'Panini Immaculate',
    'Panini Flawless', 'Panini Revolution', 'Topps Match Attax'
  ],
  parallels: [
    'Base', 'Refractor', 'X-Fractor', 'Prizm Silver', 'Mojo', 'Speckle', 'Aqua', 'Sepia',
    'Green', 'Purple', 'Blue /150', 'Orange /25', 'Gold /50', 'Red /5', 'Black /1', 'SuperFractor 1/1'
  ],
  seasons: ['2021/22', '2022/23', '2023/24', '2024/25', '2025/26', '2026/27'],
  valSources: ['eBay sold 30d', 'eBay sold 90d', 'Cardmarket trend', '130point', 'Vinted', 'Market Movers', 'Własna ocena'],
  buyChannels: ['Vinted', 'eBay', 'Cardmarket', 'Allegro', 'OLX', 'Facebook / grupy', 'Whatnot', 'Giełda / konwent', 'Kartenhaus DE', 'MagicMadhouse UK', 'Sklep PL']
};

const EMPTY_STATE = {
  version: 1,
  settings: null,
  cards: [],
  boxes: [],
  valuations: [],
  gradings: [],
  expenses: [],
  watchlist: []
};

let state = null;
let settings = null;
let charts = {};
let activeTab = 'overview';
let eqRange = '365';
let colFilters = { q: '', status: 'active', player: '', product: '', type: '', origin: '' };
let colSort = { key: 'value', dir: 'desc' };
let saleFilters = { channel: '', period: 'all', kind: '' };
let editing = { card: null, box: null, expense: null, watch: null, grading: null, sellTarget: null, listTarget: null };

/* ============================================================
   Narzędzia
   ============================================================ */
function el(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function uid(p) { return p + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); }
function today() { return new Date().toISOString().slice(0, 10); }

function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v === null || v === undefined || v === '') return 0;
  const raw = String(v).replace(/[\s ]/g, '');
  const normalized = (raw.includes(',') && raw.includes('.'))
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(',', '.');
  const n = Number(normalized.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = num(v);
  return Number.isFinite(n) ? n : null;
}

function fmtPLN(v, sign = false) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  v = Number(v);
  const s = Math.abs(v).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '−' : (sign && v > 0 ? '+' : '')) + s + ' zł';
}
function fmtPLN0(v, sign = false) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  v = Number(v);
  const s = Math.round(Math.abs(v)).toLocaleString('pl-PL');
  return (v < 0 ? '−' : (sign && v > 0 ? '+' : '')) + s + ' zł';
}
function fmtPct(v, sign = true, dp = 1) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  v = Number(v);
  return (sign && v > 0 ? '+' : (v < 0 ? '−' : '')) + Math.abs(v).toFixed(dp) + '%';
}
function fmtNum(v, dp = 0) {
  if (!Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('pl-PL', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function posClass(v) { return v > 0 ? 'pos' : v < 0 ? 'neg' : ''; }

function plural(n, one, few, many) {
  n = Math.abs(Math.round(n));
  const t = n % 10, h = n % 100;
  if (n === 1) return one;
  if (t >= 2 && t <= 4 && (h < 12 || h > 14)) return few;
  return many;
}
function nCards(n) { return `${n} ${plural(n, 'karta', 'karty', 'kart')}`; }
function nDays(n) { return `${n} ${plural(n, 'dzień', 'dni', 'dni')}`; }
function nBoxes(n) { return `${n} ${plural(n, 'box', 'boxy', 'boxów')}`; }

function daysBetween(a, b) {
  if (!a || !b) return null;
  const d1 = new Date(a + 'T00:00:00'), d2 = new Date(b + 'T00:00:00');
  if (isNaN(d1) || isNaN(d2)) return null;
  return Math.round((d2 - d1) / 86400000);
}
function daysSince(d) { return d ? daysBetween(d, today()) : null; }
function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
function monthEnd(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
const MONTHS_PL = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return `${MONTHS_PL[Number(m) - 1]} ${y.slice(2)}`;
}
function fmtDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y.slice(2)}`;
}
function groupBy(arr, fn) {
  const map = new Map();
  for (const x of arr) {
    const k = fn(x);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(x);
  }
  return map;
}
function sum(arr, fn) { return arr.reduce((a, x) => a + (fn ? fn(x) : x), 0); }

function toast(msg, kind = '') {
  const wrap = el('toasts');
  if (!wrap) return;
  const t = document.createElement('div');
  t.className = 'tc-toast ' + kind;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

/* ============================================================
   Stan
   ============================================================ */
function loadState() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(CARDS_KEY) || 'null'); } catch { raw = null; }
  state = Object.assign(structuredClone(EMPTY_STATE), raw || {});
  for (const k of ['cards', 'boxes', 'valuations', 'gradings', 'expenses', 'watchlist']) {
    if (!Array.isArray(state[k])) state[k] = [];
  }
  settings = Object.assign(structuredClone(DEFAULT_SETTINGS), state.settings || {});
  settings.fx = Object.assign({ ...DEFAULT_SETTINGS.fx }, settings.fx || {});
  if (!Array.isArray(settings.channels) || !settings.channels.length) settings.channels = structuredClone(DEFAULT_SETTINGS.channels);
  state.settings = settings;

  /* Samonaprawa: box otwarty, ale któryś pull bez zapisanej bazy kosztowej
     (dane sprzed wprowadzenia allocCost albo ręcznie podpięta karta). */
  for (const box of state.boxes) {
    if (box.status !== 'opened') continue;
    const pulls = state.cards.filter(c => c.boxId === box.id);
    if (pulls.length && pulls.some(c => !Number.isFinite(c.allocCost))) reallocateBox(box.id);
  }
}
function saveState() {
  state.settings = settings;
  try {
    localStorage.setItem(CARDS_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Nie udało się zapisać — pamięć przeglądarki pełna', 'err');
  }
}

/* ============================================================
   Warstwa wyliczeń
   ============================================================ */
function fxFor(currency, explicit) {
  if (!currency || currency === 'PLN') return 1;
  const e = numOrNull(explicit);
  if (e && e > 0) return e;
  return num(settings.fx[currency]) || 1;
}

/** Koszt boxa doprowadzonego do drzwi, w złotówkach. */
function boxLanded(box) {
  const fx = fxFor(box.currency, box.fx);
  return (num(box.price) + num(box.shipping) + num(box.fees)) * fx + num(box.customs);
}

/** Koszt własny karty (dotyczy zakupów single — pull z boxa ma koszt z alokacji). */
function cardOwnCost(card) {
  const fx = fxFor(card.currency, card.fx);
  return (num(card.price) + num(card.shipping) + num(card.fees)) * fx + num(card.customs);
}

/** Wpływ netto ze sprzedaży w złotówkach. */
function saleNet(sale) {
  if (!sale) return 0;
  const fx = fxFor(sale.currency, sale.fx);
  const gross = num(sale.price) * fx;
  const fee = (num(sale.price) * num(sale.feePct) / 100 + num(sale.feeAbs)) * fx;
  return gross - fee + num(sale.shippingIn) - num(sale.shippingOut);
}
function saleFees(sale) {
  if (!sale) return 0;
  const fx = fxFor(sale.currency, sale.fx);
  return (num(sale.price) * num(sale.feePct) / 100 + num(sale.feeAbs)) * fx + num(sale.shippingOut) - num(sale.shippingIn);
}
function saleGross(sale) {
  if (!sale) return 0;
  return num(sale.price) * fxFor(sale.currency, sale.fx);
}

/** Historia wycen karty, posortowana rosnąco po dacie. */
function valuationIndex() {
  const map = new Map();
  for (const v of state.valuations) {
    if (!map.has(v.cardId)) map.set(v.cardId, []);
    map.get(v.cardId).push(v);
  }
  for (const arr of map.values()) arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return map;
}

/** Koszt gradingu przypadający na kartę (suma ze wszystkich wysyłek). */
function gradingCostIndex() {
  const map = new Map();
  for (const g of state.gradings) {
    const ids = g.cardIds || [];
    if (!ids.length) continue;
    const total = num(g.feePerCard) * ids.length + num(g.shipping) + num(g.extra);
    const per = total / ids.length;
    for (const id of ids) map.set(id, (map.get(id) || 0) + per);
  }
  return map;
}

/**
 * Rozdziela koszt boxa na wyciągnięte z niego karty.
 * Metoda „value" waży kosztem udział karty w wartości breaka — droga
 * karta bierze na siebie większą część ceny boxa, więc ROI pojedynczej
 * karty nie jest sztucznie zawyżone tanim podziałem po równo.
 *
 * Wynik ZAPISUJEMY na kartach (allocCost), bo baza kosztowa jest wielkością
 * historyczną: raz ustalona nie może się ruszać. Gdyby liczyć ją w locie,
 * każda nowa wycena innej karty z tego samego boxa zmieniałaby wstecznie
 * zysk zrealizowany na karcie sprzedanej pół roku temu.
 */
function allocateFor(box, pulls) {
  const map = new Map();
  if (!pulls.length) return map;
  let base = boxLanded(box);
  if (settings.bulkOffset === 'yes') base = Math.max(0, base - num(box.bulkValue));
  if (settings.alloc === 'none') { pulls.forEach(c => map.set(c.id, 0)); return map; }
  if (settings.alloc === 'equal') { pulls.forEach(c => map.set(c.id, base / pulls.length)); return map; }

  const latestValue = card => {
    if (card.sale) return saleNet(card.sale);
    const arr = state.valuations.filter(v => v.cardId === card.id).sort((a, b) => (a.date < b.date ? -1 : 1));
    return arr.length ? num(arr[arr.length - 1].value) : 0;
  };
  const weights = pulls.map(c => Math.max(0, latestValue(c)));
  const total = sum(weights);
  if (total <= 0) { pulls.forEach(c => map.set(c.id, base / pulls.length)); return map; }
  pulls.forEach((c, i) => map.set(c.id, base * weights[i] / total));
  return map;
}

/** Ustala na nowo bazę kosztową pulli — wołane tylko wtedy, gdy realnie się zmienia. */
function reallocateBox(boxId) {
  const box = state.boxes.find(b => b.id === boxId);
  if (!box) return;
  const pulls = state.cards.filter(c => c.boxId === boxId);
  if (box.status !== 'opened') { pulls.forEach(c => { delete c.allocCost; }); return; }
  const map = allocateFor(box, pulls);
  pulls.forEach(c => { c.allocCost = map.has(c.id) ? map.get(c.id) : 0; });
}

function reallocateAll() {
  state.boxes.forEach(b => { if (b.status === 'opened') reallocateBox(b.id); });
}

function allocationIndex() {
  const alloc = new Map();
  for (const box of state.boxes) {
    if (box.status !== 'opened') continue;
    for (const c of state.cards) {
      if (c.boxId === box.id) alloc.set(c.id, Number.isFinite(c.allocCost) ? c.allocCost : 0);
    }
  }
  return alloc;
}

/** Zwraca pełny, policzony model — jedno źródło prawdy dla wszystkich widoków. */
function compute() {
  const vIdx = valuationIndex();
  const gIdx = gradingCostIndex();
  const t = today();

  const rawValue = card => {
    const arr = vIdx.get(card.id);
    if (arr && arr.length) {
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i].date <= t) return num(arr[i].value);
      return num(arr[arr.length - 1].value);
    }
    return null;
  };
  const alloc = allocationIndex();
  const allocatedTotal = [...alloc.values()].reduce((a, v) => a + v, 0);

  const basisOf = card => {
    const own = card.acq === 'box' ? (alloc.get(card.id) || 0) : cardOwnCost(card);
    return own + (gIdx.get(card.id) || 0);
  };

  const cards = state.cards.map(card => {
    const basis = basisOf(card);
    const mvRaw = rawValue(card);
    const mv = mvRaw === null ? basis : mvRaw;
    const hist = (vIdx.get(card.id) || []).filter(v => v.date <= t);
    const lastVal = hist.length ? hist[hist.length - 1] : null;
    const prevVal = hist.length > 1 ? hist[hist.length - 2] : null;
    const sold = !!card.sale;
    const net = sold ? saleNet(card.sale) : 0;
    const pnl = sold ? net - basis : mv - basis;
    const daysHeld = sold ? daysBetween(card.date, card.sale.date) : daysSince(card.date);
    return {
      ...card,
      basis,
      marketValue: mv,
      hasValuation: mvRaw !== null,
      lastValuationDate: lastVal ? lastVal.date : null,
      valuationAge: lastVal ? daysSince(lastVal.date) : (card.date ? daysSince(card.date) : null),
      prevValue: prevVal ? num(prevVal.value) : null,
      moveAbs: (lastVal && prevVal) ? num(lastVal.value) - num(prevVal.value) : null,
      movePct: (lastVal && prevVal && num(prevVal.value) > 0) ? (num(lastVal.value) - num(prevVal.value)) / num(prevVal.value) * 100 : null,
      gradingCost: gIdx.get(card.id) || 0,
      sold,
      net,
      pnl,
      roi: basis > 0 ? pnl / basis * 100 : null,
      daysHeld,
      stale: !sold && (lastVal ? daysSince(lastVal.date) > settings.valDays : true),
      valuations: vIdx.get(card.id) || []
    };
  });

  const byId = new Map(cards.map(c => [c.id, c]));
  const held = cards.filter(c => !c.sold);
  const soldCards = cards.filter(c => c.sold);

  const boxes = state.boxes.map(box => {
    const landed = boxLanded(box);
    const pulls = cards.filter(c => c.boxId === box.id);
    const pullsReturn = sum(pulls, c => (c.sold ? c.net : c.marketValue));
    const bulk = num(box.bulkValue);
    const ret = pullsReturn + bulk;
    const flipNet = box.sale ? saleNet(box.sale) : 0;
    const isFlip = box.status === 'sold';
    const pnl = isFlip ? flipNet - landed : (box.status === 'opened' ? ret - landed : 0);
    return {
      ...box,
      landed,
      pulls,
      pullsReturn,
      bulk,
      ret,
      flipNet,
      pnl,
      roi: landed > 0 ? pnl / landed * 100 : null,
      multiple: landed > 0 ? ret / landed : null,
      daysHeld: box.status === 'sold' ? daysBetween(box.date, box.sale.date)
        : box.status === 'opened' ? daysBetween(box.date, box.openedDate || t)
          : daysSince(box.date)
    };
  });

  const sealed = boxes.filter(b => b.status === 'sealed');
  const opened = boxes.filter(b => b.status === 'opened');
  const flipped = boxes.filter(b => b.status === 'sold');

  /* --- Pieniądze --- */
  const goodsSpend = sum(boxes, b => b.landed) + sum(cards.filter(c => c.acq !== 'box'), c => cardOwnCost(c));
  const gradingSpend = sum(state.gradings, g => num(g.feePerCard) * (g.cardIds || []).length + num(g.shipping) + num(g.extra));
  const overhead = sum(state.expenses, e => num(e.amount));
  const cashOut = goodsSpend + gradingSpend + overhead;
  const cashIn = sum(soldCards, c => c.net) + sum(flipped, b => b.flipNet);
  const netCash = cashIn - cashOut;

  const heldValue = sum(held, c => c.marketValue);
  const heldBasis = sum(held, c => c.basis);
  const sealedValue = sum(sealed, b => b.landed);
  const bulkValue = sum(opened, b => b.bulk);
  const assets = heldValue + sealedValue + bulkValue;

  const realized = sum(soldCards, c => c.pnl) + sum(flipped, b => b.pnl);
  const unrealized = heldValue - heldBasis;
  const totalResult = assets + cashIn - cashOut;

  /* Koszt otwartych boxów, który nie trafił na żadną kartę. Bierze się stąd,
     że przy odliczaniu bulku baza pulli jest o niego mniejsza (wtedy bulk
     siedzi już w P&L kart) albo że box otwarto bez wpisania czegokolwiek.
     Rozbicie wyniku spina się dokładnie:
       wynik = zrealizowany + niezrealizowany + bulk − nieprzypisane − koszty ogólne */
  const openedLanded = sum(opened, b => b.landed);
  const unallocated = openedLanded - allocatedTotal;
  const emptyBreaks = opened.filter(b => !b.pulls.length);
  const emptyBreakCost = sum(emptyBreaks, b => b.landed);
  const residual = totalResult - (realized + unrealized + bulkValue - unallocated - overhead);

  /* --- Sprzedaż --- */
  const sales = [
    ...soldCards.map(c => ({
      kind: 'card', id: c.id, ref: c, date: c.sale.date, name: cardTitle(c),
      channel: c.sale.channel || '—', gross: saleGross(c.sale), fees: saleFees(c.sale),
      net: c.net, basis: c.basis, pnl: c.pnl,
      roi: c.basis > 0 ? c.pnl / c.basis * 100 : null,
      margin: saleGross(c.sale) > 0 ? c.pnl / saleGross(c.sale) * 100 : null,
      days: c.daysHeld
    })),
    ...flipped.map(b => ({
      kind: 'box', id: b.id, ref: b, date: b.sale.date, name: b.name,
      channel: b.sale.channel || '—', gross: saleGross(b.sale), fees: saleFees(b.sale),
      net: b.flipNet, basis: b.landed, pnl: b.pnl,
      roi: b.landed > 0 ? b.pnl / b.landed * 100 : null,
      margin: saleGross(b.sale) > 0 ? b.pnl / saleGross(b.sale) * 100 : null,
      days: b.daysHeld
    }))
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  const listed = held.filter(c => c.status === 'listed');
  const inGrading = held.filter(c => c.status === 'grading');

  const wins = sales.filter(s => s.pnl > 0).length;
  const avgDaysToSell = sales.length ? sum(sales.filter(s => s.days != null), s => s.days) / Math.max(1, sales.filter(s => s.days != null).length) : null;

  /* --- Breaki --- */
  const breakStats = {
    count: opened.length,
    cost: sum(opened, b => b.landed),
    ret: sum(opened, b => b.ret),
    pnl: sum(opened, b => b.pnl),
    hits: opened.filter(b => b.pnl > 0).length
  };
  breakStats.roi = breakStats.cost > 0 ? breakStats.pnl / breakStats.cost * 100 : null;
  breakStats.hitRate = opened.length ? breakStats.hits / opened.length * 100 : null;
  breakStats.avgReturn = opened.length ? breakStats.ret / opened.length : null;
  breakStats.avgCost = opened.length ? breakStats.cost / opened.length : null;

  const flipStats = {
    count: flipped.length,
    pnl: sum(flipped, b => b.pnl),
    cost: sum(flipped, b => b.landed)
  };
  flipStats.roi = flipStats.cost > 0 ? flipStats.pnl / flipStats.cost * 100 : null;

  /* --- Grading --- */
  const gradings = state.gradings.map(g => {
    const ids = g.cardIds || [];
    const total = num(g.feePerCard) * ids.length + num(g.shipping) + num(g.extra);
    const items = ids.map(id => byId.get(id)).filter(Boolean);
    const before = sum(items, c => num((g.before || {})[c.id]));
    const after = sum(items, c => (c.sold ? c.net : c.marketValue));
    return {
      ...g, total, items, before, after,
      uplift: g.status === 'returned' ? after - before : null,
      pnl: g.status === 'returned' ? after - before - total : null,
      days: g.status === 'returned' ? daysBetween(g.date, g.returnedDate || t) : daysSince(g.date)
    };
  });
  const gradedReturned = gradings.filter(g => g.status === 'returned');
  const gradeValues = [];
  for (const g of gradedReturned) for (const c of g.items) if (c.grade && c.grade.value) gradeValues.push(num(c.grade.value));

  return {
    cards, byId, held, soldCards, boxes, sealed, opened, flipped, sales, listed, inGrading,
    goodsSpend, gradingSpend, overhead, cashOut, cashIn, netCash,
    heldValue, heldBasis, sealedValue, bulkValue, assets,
    realized, unrealized, totalResult, residual, unallocated, emptyBreaks, emptyBreakCost,
    roiTotal: cashOut > 0 ? totalResult / cashOut * 100 : null,
    roiRealized: sum(sales, s => s.basis) > 0 ? sum(sales, s => s.pnl) / sum(sales, s => s.basis) * 100 : null,
    unrealizedPct: heldBasis > 0 ? unrealized / heldBasis * 100 : null,
    wins, winRate: sales.length ? wins / sales.length * 100 : null,
    avgDaysToSell,
    grossSales: sum(sales, s => s.gross),
    feesTotal: sum(sales, s => s.fees),
    marginPct: sum(sales, s => s.gross) > 0 ? sum(sales, s => s.pnl) / sum(sales, s => s.gross) * 100 : null,
    breakStats, flipStats, gradings, gradedReturned,
    gradingPnl: sum(gradedReturned, g => g.pnl || 0),
    gradingUplift: sum(gradedReturned, g => g.uplift || 0),
    avgGrade: gradeValues.length ? sum(gradeValues) / gradeValues.length : null,
    gemRate: gradeValues.length ? gradeValues.filter(v => v >= 10).length / gradeValues.length * 100 : null,
    valuationIdx: vIdx
  };
}

function cardTitle(c) {
  const bits = [c.player || 'Karta bez nazwy'];
  if (c.parallel && c.parallel.toLowerCase() !== 'base') bits.push(c.parallel);
  if (c.run) bits.push('/' + c.run);
  return bits.join(' · ');
}
function cardSubtitle(c) {
  const bits = [];
  if (c.product) bits.push(c.product);
  if (c.season) bits.push(c.season);
  if (c.number) bits.push('#' + c.number);
  if (c.team) bits.push(c.team);
  return bits.join(' · ');
}
function cardTags(c) {
  const tags = [];
  if (c.rookie) tags.push('<span class="cd-tag rc">RC</span>');
  if (c.auto) tags.push('<span class="cd-tag auto">AUTO</span>');
  if (c.patch) tags.push('<span class="cd-tag patch">PATCH</span>');
  if (num(c.run) === 1) tags.push('<span class="cd-tag one">1/1</span>');
  else if (c.run) tags.push(`<span class="cd-tag num">/${esc(c.run)}</span>`);
  if (c.acq === 'box') tags.push('<span class="cd-tag gold">PULL</span>');
  return tags.length ? `<span class="cd-tags">${tags.join('')}</span>` : '';
}
function gradeBadge(c) {
  if (!c.grade || !c.grade.company) return '<span class="cd-grade raw">RAW</span>';
  const cls = String(c.grade.company).toLowerCase();
  return `<span class="cd-grade ${cls}">${esc(c.grade.company)} ${esc(c.grade.value || '?')}</span>`;
}
const STATUS_LABEL = { held: 'Trzymam', listed: 'Wystawiona', grading: 'W gradingu', sold: 'Sprzedana' };
function statusTag(c) {
  const s = c.sold ? 'sold' : (c.status || 'held');
  return `<span class="cd-status ${s}">${STATUS_LABEL[s] || s}</span>`;
}
function emptyBox(icon, title, text) {
  return `<div class="tc-empty"><span class="material-symbols-outlined">${icon}</span><h4>${esc(title)}</h4><p>${esc(text)}</p></div>`;
}

/* ============================================================
   Render — orkiestracja
   ============================================================ */
let M = null;

function renderAll() {
  M = compute();
  refreshDatalists();
  renderTabCounts();
  renderOverview();
  renderCollection();
  renderBoxes();
  renderSales();
  renderGrading();
  renderCosts();
  renderAnalytics();
  renderWatchlist();
  renderFxBadge();
}

function renderTabCounts() {
  el('cnt-collection').textContent = M.held.length;
  el('cnt-boxes').textContent = M.sealed.length;
  el('cnt-sales').textContent = M.sales.length;
  el('cnt-grading').textContent = M.gradings.filter(g => g.status !== 'returned').length;
  el('cnt-watch').textContent = state.watchlist.length;
}

function renderFxBadge() {
  const b = el('fx-badge');
  if (!b) return;
  const f = settings.fx;
  b.textContent = `EUR ${num(f.EUR).toFixed(2)} · USD ${num(f.USD).toFixed(2)} · GBP ${num(f.GBP).toFixed(2)}`;
  b.title = settings.fxUpdated ? `Kursy z ${settings.fxUpdated}` : 'Kursy wpisane ręcznie — pobierz z NBP w ustawieniach';
}

function setKpi(id, value, note, cls) {
  const v = el(id);
  if (v) { v.textContent = value; v.className = 'v mono ' + (cls || ''); }
  const n = el(id + '-n');
  if (n) n.textContent = note == null ? '' : note;
}

/* ============================================================
   PRZEGLĄD
   ============================================================ */
function renderOverview() {
  el('hero-value').textContent = fmtPLN0(M.heldValue);

  const unrealEl = el('hero-unreal');
  unrealEl.textContent = `${fmtPLN0(M.unrealized, true)} niezreal.`;
  unrealEl.className = 'cd-hero-chip ' + posClass(M.unrealized);

  const series = portfolioSeries();
  const last = series[series.length - 1];
  const prev = series.length > 1 ? series[series.length - 2] : null;
  const mom = prev && prev.market > 0 ? (last.market - prev.market) / prev.market * 100 : null;
  const momEl = el('hero-mom');
  momEl.textContent = mom === null ? 'brak historii m/m' : `${fmtPct(mom)} m/m`;
  momEl.className = 'cd-hero-chip ' + (mom === null ? '' : posClass(mom));

  const staleCount = M.held.filter(c => c.stale).length;
  el('hero-note').innerHTML = M.held.length
    ? `${nCards(M.held.length)} na stanie${M.sealed.length ? `, ${nBoxes(M.sealed.length)} sealed` : ''}. ` +
      (staleCount ? `${staleCount} ${plural(staleCount, 'wycena wymaga', 'wyceny wymagają', 'wycen wymaga')} odświeżenia.` : 'Wyceny aktualne.')
    : 'Pusto. Zacznij od dodania boxa albo pierwszego single — reszta policzy się sama.';

  setKpiHero('hero-cost', fmtPLN0(M.heldBasis), `${fmtPct(M.unrealizedPct)} do wyceny`);
  setKpiHero('hero-real', fmtPLN0(M.realized, true), `${M.sales.length} ${plural(M.sales.length, 'transakcja', 'transakcje', 'transakcji')}`, posClass(M.realized));
  setKpiHero('hero-capital', fmtPLN0(Math.max(0, -M.netCash)), 'gotówka jeszcze nieodzyskana');
  setKpiHero('hero-total', fmtPLN0(M.totalResult, true), `ROI ${fmtPct(M.roiTotal)}`, posClass(M.totalResult));

  el('kpi-desc').textContent = `Baza: ${nCards(M.cards.length)}, ${nBoxes(M.boxes.length)}, ${M.sales.length} ${plural(M.sales.length, 'sprzedaż', 'sprzedaże', 'sprzedaży')}`;

  setKpi('k-total', fmtPLN0(M.totalResult, true), 'wycena + gotówka − wydatki', posClass(M.totalResult));
  setKpi('k-roi', fmtPct(M.roiTotal), `z ${fmtPLN0(M.cashOut)} wydanych`, posClass(M.roiTotal));
  setKpi('k-roi-real', fmtPct(M.roiRealized), `${M.wins}/${M.sales.length} ze zyskiem`, posClass(M.roiRealized));
  setKpi('k-box-ev', M.breakStats.count ? fmtPct(M.breakStats.roi) : '—',
    M.breakStats.count ? `${fmtPLN0(M.breakStats.avgReturn)} z boxa za ${fmtPLN0(M.breakStats.avgCost)}` : 'brak otwartych boxów',
    posClass(M.breakStats.roi));
  setKpi('k-box-hit', M.breakStats.count ? fmtPct(M.breakStats.hitRate, false, 0) : '—',
    M.breakStats.count ? `${M.breakStats.hits}/${M.breakStats.count} breaków na plusie` : '—');
  setKpi('k-dts', M.avgDaysToSell == null ? '—' : Math.round(M.avgDaysToSell) + ' dni',
    M.listed.length ? `${M.listed.length} ${plural(M.listed.length, 'pozycja wystawiona', 'pozycje wystawione', 'pozycji wystawionych')}` : 'nic nie wystawione');
  setKpi('k-overhead', fmtPLN0(M.overhead), M.cashOut > 0 ? `${fmtPct(M.overhead / M.cashOut * 100, false)} wszystkich kosztów` : '—');
  setKpi('k-cash', fmtPLN0(M.netCash, true), M.netCash < 0 ? 'tyle jeszcze nie wróciło' : 'jesteś na plusie kasowo', posClass(M.netCash));

  renderEquityChart(series);
  renderTodo();
  renderMovers();
  renderTopCards();
}

function setKpiHero(id, value, note, cls) {
  const v = el(id);
  if (v) { v.textContent = value; v.className = 'v ' + (cls || ''); }
  const n = el(id + '-n');
  if (n) n.textContent = note || '';
}

/** Miesięczne punkty: wycena kolekcji, koszt, majątek i zainwestowana gotówka. */
function portfolioSeries() {
  const dates = [];
  for (const c of M.cards) { if (c.date) dates.push(c.date); if (c.sale) dates.push(c.sale.date); }
  for (const b of M.boxes) { if (b.date) dates.push(b.date); if (b.sale) dates.push(b.sale.date); }
  for (const v of state.valuations) dates.push(v.date);
  for (const e of state.expenses) dates.push(e.date);
  const valid = dates.filter(Boolean).sort();
  if (!valid.length) return [];

  const startYm = valid[0].slice(0, 7);
  const endYm = today().slice(0, 7);
  const months = [];
  for (let ym = startYm; ym <= endYm; ym = addMonths(ym, 1)) months.push(ym);
  if (!months.length) months.push(endYm);

  const vIdx = M.valuationIdx;
  const valueAt = (card, at) => {
    const arr = vIdx.get(card.id) || [];
    let v = null;
    for (const item of arr) { if (item.date <= at) v = num(item.value); else break; }
    return v === null ? card.basis : v;
  };

  return months.map((ym, i) => {
    const at = (i === months.length - 1) ? today() : monthEnd(ym);
    const holdings = M.cards.filter(c => c.date && c.date <= at && (!c.sale || c.sale.date > at));
    const market = sum(holdings, c => valueAt(c, at));
    const basis = sum(holdings, c => c.basis);
    const sealedAt = sum(M.boxes.filter(b => b.date && b.date <= at
      && !(b.status === 'opened' && (b.openedDate || b.date) <= at)
      && !(b.sale && b.sale.date <= at)), b => b.landed);
    const bulkAt = sum(M.boxes.filter(b => b.status === 'opened' && (b.openedDate || b.date) <= at), b => b.bulk);
    const outAt = sum(M.boxes.filter(b => b.date <= at), b => b.landed)
      + sum(M.cards.filter(c => c.acq !== 'box' && c.date && c.date <= at), c => cardOwnCost(c))
      + sum(state.gradings.filter(g => g.date && g.date <= at), g => num(g.feePerCard) * (g.cardIds || []).length + num(g.shipping) + num(g.extra))
      + sum(state.expenses.filter(e => e.date && e.date <= at), e => num(e.amount));
    const inAt = sum(M.cards.filter(c => c.sale && c.sale.date <= at), c => saleNet(c.sale))
      + sum(M.boxes.filter(b => b.sale && b.sale.date <= at), b => saleNet(b.sale));
    return {
      ym, at, market, basis,
      assets: market + sealedAt + bulkAt,
      invested: outAt - inAt,
      cashOut: outAt, cashIn: inAt,
      result: market + sealedAt + bulkAt + inAt - outAt
    };
  });
}

function renderTodo() {
  const items = [];
  const s = settings;

  const stale = M.held.filter(c => c.stale);
  if (stale.length) {
    items.push(['warn', 'update', `<strong>${stale.length}</strong> ${plural(stale.length, 'karta ma wycenę starszą', 'karty mają wyceny starsze', 'kart ma wyceny starsze')} niż ${nDays(s.valDays)}. Odpal sesję wyceny — bez tego wykres wartości kłamie.`, 'openValuation()']);
  }
  const oldSealed = M.sealed.filter(b => (daysSince(b.date) || 0) > s.sealedDays);
  if (oldSealed.length) {
    items.push(['info', 'package_2', `<strong>${nBoxes(oldSealed.length)}</strong> leży zapakowane dłużej niż ${nDays(s.sealedDays)}. Decyzja: ripujesz czy flipujesz? Sealed z czasem albo drożeje, albo traci hype.`, 'goTab("boxes")']);
  }
  const dead = M.held.filter(c => (c.daysHeld || 0) > s.agingDays && c.status !== 'listed');
  if (dead.length) {
    items.push(['warn', 'hourglass_bottom', `<strong>${nCards(dead.length)}</strong> leży ponad ${nDays(s.agingDays)} bez wystawienia. Kapitał śpi — wystaw albo świadomie uznaj za długi hold.`, 'goTab("collection")']);
  }
  const oldListings = M.listed.filter(c => c.listing && (daysSince(c.listing.date) || 0) > s.listingDays);
  if (oldListings.length) {
    items.push(['warn', 'sell', `<strong>${oldListings.length}</strong> ${plural(oldListings.length, 'ogłoszenie wisi', 'ogłoszenia wiszą', 'ogłoszeń wisi')} dłużej niż ${nDays(s.listingDays)}. Rynek mówi, że cena jest za wysoka.`, 'goTab("sales")']);
  }
  const underwater = M.held.filter(c => c.basis > 0 && c.pnl / c.basis < -0.3);
  if (underwater.length) {
    items.push(['bad', 'trending_down', `<strong>${nCards(underwater.length)}</strong> ${plural(underwater.length, 'jest', 'są', 'jest')} ponad 30% pod kreską. Sprawdź, czy to chwilowy dołek, czy teza się rozjechała.`, 'goTab("collection")']);
  }
  const openGrading = M.gradings.filter(g => g.status !== 'returned' && (g.days || 0) > 60);
  if (openGrading.length) {
    items.push(['info', 'workspace_premium', `<strong>${openGrading.length}</strong> ${plural(openGrading.length, 'wysyłka', 'wysyłki', 'wysyłek')} do gradingu czeka ponad 60 dni. Sprawdź status u firmy.`, 'goTab("grading")']);
  }
  const conc = concentration();
  if (conc.top && conc.top.share > s.concAlert) {
    items.push(['warn', 'donut_large', `<strong>${esc(conc.top.name)}</strong> to ${fmtPct(conc.top.share, false)} wartości kolekcji. Jeden transfer albo kontuzja i portfel leci razem z nim.`, 'goTab("analytics")']);
  }
  const taxSoon = M.held.filter(c => {
    const d = c.daysHeld;
    return d != null && d >= 150 && d < 183;
  });
  if (taxSoon.length) {
    items.push(['info', 'gavel', `<strong>${nCards(taxSoon.length)}</strong> zbliża się do progu 6 miesięcy. Po nim sprzedaż rzeczy ruchomych jest poza PIT — czasem warto poczekać kilka tygodni.`, 'goTab("analytics")']);
  }
  if (M.emptyBreaks.length) {
    items.push(['bad', 'report', `<strong>${nBoxes(M.emptyBreaks.length)}</strong> ${plural(M.emptyBreaks.length, 'jest oznaczony', 'są oznaczone', 'jest oznaczonych')} jako otwarte, ale bez wpisanej karty. ${fmtPLN0(M.emptyBreakCost)} wisi w kosztach bez pokrycia — dopisz pully albo wartość bulku.`, 'goTab("boxes")']);
  }
  if (!items.length) {
    items.push(['good', 'check_circle', 'Nic nie wisi. Wyceny świeże, nic nie zalega, ogłoszenia w normie.', null]);
  }

  el('todo-sub').textContent = items.length === 1 && items[0][0] === 'good' ? 'czysto' : `${items.length} ${plural(items.length, 'pozycja', 'pozycje', 'pozycji')}`;
  el('todo-list').innerHTML = items.map(([kind, icon, html, action]) => `
    <div class="cd-alert ${kind}">
      <span class="material-symbols-outlined">${icon}</span>
      <span>${html}</span>
      ${action ? `<button class="cd-alert-act" onclick='${action}'>Przejdź</button>` : ''}
    </div>`).join('');
}

function concentration() {
  const held = M.held;
  const total = sum(held, c => c.marketValue);
  if (!total) return { top: null, top5: null, hhi: null, rows: [] };
  const byPlayer = groupBy(held, c => c.player || 'Bez nazwy');
  const rows = [...byPlayer.entries()]
    .map(([name, list]) => ({ name, value: sum(list, c => c.marketValue), count: list.length, share: sum(list, c => c.marketValue) / total * 100 }))
    .sort((a, b) => b.value - a.value);
  const hhi = sum(rows, r => (r.share / 100) ** 2) * 10000;
  return { top: rows[0] || null, top5: sum(rows.slice(0, 5), r => r.share), hhi, rows, total };
}

function renderMovers() {
  const moved = M.held.filter(c => c.moveAbs !== null && Math.abs(c.moveAbs) > 0.005);
  const up = [...moved].sort((a, b) => b.moveAbs - a.moveAbs).filter(c => c.moveAbs > 0).slice(0, 8);
  const down = [...moved].sort((a, b) => a.moveAbs - b.moveAbs).filter(c => c.moveAbs < 0).slice(0, 8);
  el('movers-up').innerHTML = moverList(up, 'Brak wzrostów — potrzebne co najmniej dwie sesje wyceny tej samej karty.');
  el('movers-down').innerHTML = moverList(down, 'Brak spadków. Albo rynek rośnie, albo brakuje historii wycen.');
}
function moverList(list, emptyText) {
  if (!list.length) return emptyBox('show_chart', 'Brak danych', emptyText);
  const max = Math.max(...list.map(c => Math.abs(c.moveAbs)), 1);
  return `<div class="cd-rank">${list.map(c => `
    <div class="cd-rank-row center" onclick="openCardDrawer('${c.id}')" style="cursor:pointer">
      <div class="t">${esc(cardTitle(c))}<small>${esc(cardSubtitle(c) || '—')}</small></div>
      <div class="bar"><i class="${c.moveAbs < 0 ? 'neg' : 'pos'}" style="width:${Math.abs(c.moveAbs) / max * 50}%"></i></div>
      <div class="v ${posClass(c.moveAbs)}">${fmtPLN0(c.moveAbs, true)}</div>
      <div class="r">${fmtPct(c.movePct)}</div>
    </div>`).join('')}</div>`;
}

function renderTopCards() {
  const top = [...M.held].sort((a, b) => b.marketValue - a.marketValue).slice(0, 10);
  const wrap = el('top-cards-wrap');
  if (!top.length) { wrap.innerHTML = emptyBox('style', 'Kolekcja jest pusta', 'Dodaj pierwszą kartę albo otwórz box, żeby zobaczyć tutaj ranking wartości.'); return; }
  const total = M.heldValue || 1;
  wrap.innerHTML = `<table class="tc-tbl">
    <thead><tr>
      <th>Karta</th><th>Grade</th><th class="num">Koszt</th><th class="num">Wycena</th>
      <th class="num">P&L</th><th class="num">ROI</th><th class="num">Udział</th><th class="num">Dni</th>
    </tr></thead>
    <tbody>${top.map(c => `
      <tr class="clickable" onclick="openCardDrawer('${c.id}')">
        <td><div class="cd-name"><span class="t">${esc(cardTitle(c))}</span><span class="s">${esc(cardSubtitle(c) || '—')}</span>${cardTags(c)}</div></td>
        <td>${gradeBadge(c)}</td>
        <td class="num">${fmtPLN0(c.basis)}</td>
        <td class="num">${fmtPLN0(c.marketValue)}</td>
        <td class="num ${posClass(c.pnl)}">${fmtPLN0(c.pnl, true)}</td>
        <td class="num ${posClass(c.roi)}">${fmtPct(c.roi)}</td>
        <td class="num">${fmtPct(c.marketValue / total * 100, false)}</td>
        <td class="num">${c.daysHeld == null ? '—' : c.daysHeld}</td>
      </tr>`).join('')}</tbody></table>`;
}

/* ============================================================
   KOLEKCJA
   ============================================================ */
function filteredCards() {
  const f = colFilters;
  const q = f.q.trim().toLowerCase();
  return M.cards.filter(c => {
    if (f.status === 'active' && c.sold) return false;
    if (f.status === 'held' && (c.sold || c.status !== 'held')) return false;
    if (f.status === 'listed' && (c.sold || c.status !== 'listed')) return false;
    if (f.status === 'grading' && (c.sold || c.status !== 'grading')) return false;
    if (f.status === 'sold' && !c.sold) return false;
    if (f.player && c.player !== f.player) return false;
    if (f.product && c.product !== f.product) return false;
    if (f.origin && c.acq !== f.origin) return false;
    if (f.type) {
      if (f.type === 'auto' && !c.auto) return false;
      if (f.type === 'patch' && !c.patch) return false;
      if (f.type === 'numbered' && !c.run) return false;
      if (f.type === 'rookie' && !c.rookie) return false;
      if (f.type === 'graded' && !(c.grade && c.grade.company)) return false;
      if (f.type === 'raw' && c.grade && c.grade.company) return false;
      if (f.type === 'oneofone' && num(c.run) !== 1) return false;
    }
    if (q) {
      const hay = [c.player, c.team, c.product, c.brand, c.parallel, c.number, c.season, c.notes, c.source].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

const COL_SORTERS = {
  name: c => (c.player || '').toLowerCase(),
  date: c => c.date || '',
  basis: c => c.basis,
  value: c => (c.sold ? c.net : c.marketValue),
  pnl: c => c.pnl,
  roi: c => (c.roi == null ? -Infinity : c.roi),
  days: c => (c.daysHeld == null ? -1 : c.daysHeld),
  val: c => (c.valuationAge == null ? -1 : c.valuationAge)
};

function renderCollection() {
  const rows = filteredCards();
  const sorter = COL_SORTERS[colSort.key] || COL_SORTERS.value;
  rows.sort((a, b) => {
    const va = sorter(a), vb = sorter(b);
    const r = typeof va === 'string' ? va.localeCompare(vb, 'pl') : (va - vb);
    return colSort.dir === 'asc' ? r : -r;
  });

  const active = M.held;
  setKpi('c-value', fmtPLN0(M.heldValue), `${nCards(active.length)} na stanie`);
  setKpi('c-cost', fmtPLN0(M.heldBasis), 'baza kosztowa z alokacją boxów');
  setKpi('c-unreal', fmtPLN0(M.unrealized, true), fmtPct(M.unrealizedPct), posClass(M.unrealized));
  setKpi('c-count', String(active.length), `${M.cards.filter(c => c.acq === 'box').length} z boxów, ${M.cards.filter(c => c.acq === 'single').length} single`);
  setKpi('c-avg', active.length ? fmtPLN0(M.heldValue / active.length) : '—',
    active.length ? `mediana ${fmtPLN0(median(active.map(c => c.marketValue)))}` : '—');
  const stale = active.filter(c => c.stale).length;
  setKpi('c-stale', String(stale), stale ? `próg ${nDays(settings.valDays)}` : 'wszystko świeże', stale ? 'warn' : '');

  el('f-count').textContent = `${rows.length} / ${M.cards.length}`;
  const shownValue = sum(rows, c => (c.sold ? c.net : c.marketValue));
  const shownBasis = sum(rows, c => c.basis);
  el('col-summary').innerHTML = rows.length
    ? `Widok: <strong>${rows.length}</strong> ${plural(rows.length, 'pozycja', 'pozycje', 'pozycji')} · koszt <strong>${fmtPLN0(shownBasis)}</strong> · wartość <strong>${fmtPLN0(shownValue)}</strong> · wynik <strong class="${posClass(shownValue - shownBasis)}">${fmtPLN0(shownValue - shownBasis, true)}</strong>${shownBasis > 0 ? ` (${fmtPct((shownValue - shownBasis) / shownBasis * 100)})` : ''}`
    : 'Brak pozycji dla tych filtrów.';

  const wrap = el('collection-wrap');
  if (!rows.length) {
    wrap.innerHTML = emptyBox('style', 'Nic tu nie ma',
      M.cards.length ? 'Zmień filtry — w bazie są karty, ale żadna nie pasuje do wybranych warunków.' : 'Dodaj pierwszą kartę przyciskiem powyżej albo zaimportuj listę wklejką.');
    return;
  }

  const th = (key, label, cls = '') =>
    `<th class="sortable ${cls}" onclick="sortCollection('${key}')">${label}<span class="sort-ind">${colSort.key === key ? (colSort.dir === 'asc' ? '▲' : '▼') : ''}</span></th>`;

  wrap.innerHTML = `<table class="tc-tbl">
    <thead><tr>
      ${th('name', 'Karta')}
      <th>Grade</th>
      ${th('date', 'Nabycie')}
      ${th('basis', 'Koszt', 'num')}
      ${th('value', 'Wycena', 'num')}
      ${th('pnl', 'P&L', 'num')}
      ${th('roi', 'ROI', 'num')}
      ${th('val', 'Wycena z', 'num')}
      ${th('days', 'Dni', 'num')}
      <th>Status</th>
      <th style="width:132px"></th>
    </tr></thead>
    <tbody>${rows.map(c => {
      const value = c.sold ? c.net : c.marketValue;
      return `<tr>
        <td onclick="openCardDrawer('${c.id}')" style="cursor:pointer"><div class="cd-name"><span class="t">${esc(cardTitle(c))}</span><span class="s">${esc(cardSubtitle(c) || '—')}</span>${cardTags(c)}</div></td>
        <td>${gradeBadge(c)}</td>
        <td class="cd-nowrap"><span class="cd-mono">${fmtDate(c.date)}</span><br><span class="cd-muted" style="font-size:10.5px">${esc(c.source || ACQ_LABEL[c.acq] || '—')}</span></td>
        <td class="num">${fmtPLN0(c.basis)}</td>
        <td class="num">${fmtPLN0(value)}${!c.sold && !c.hasValuation ? '<br><span class="cd-warn" style="font-size:10px">brak wyceny</span>' : ''}</td>
        <td class="num ${posClass(c.pnl)}">${fmtPLN0(c.pnl, true)}</td>
        <td class="num ${posClass(c.roi)}">${fmtPct(c.roi)}</td>
        <td class="num ${c.stale && !c.sold ? 'cd-val-stale' : ''}">${c.lastValuationDate ? fmtDate(c.lastValuationDate) : '—'}</td>
        <td class="num">${c.daysHeld == null ? '—' : c.daysHeld}</td>
        <td>${statusTag(c)}</td>
        <td>
          <div class="row-actions">
            <button class="row-btn" title="Szczegóły" onclick="openCardDrawer('${c.id}')"><span class="material-symbols-outlined">visibility</span></button>
            ${c.sold ? '' : `<button class="row-btn" title="Aktualizuj wycenę" onclick="quickValuation('${c.id}')"><span class="material-symbols-outlined">update</span></button>`}
            ${c.sold ? '' : `<button class="row-btn" title="Sprzedaj" onclick="openSell('card','${c.id}')" style="color:var(--tc-pos)"><span class="material-symbols-outlined">sell</span></button>`}
            <button class="row-btn" title="Edytuj" onclick="openCardModal('${c.id}')"><span class="material-symbols-outlined">edit</span></button>
            <button class="row-btn danger" title="Usuń" onclick="deleteCard('${c.id}')"><span class="material-symbols-outlined">delete</span></button>
          </div>
        </td>
      </tr>`;
    }).join('')}</tbody>
    <tfoot><tr>
      <td colspan="3">Razem (widok)</td>
      <td class="num">${fmtPLN0(shownBasis)}</td>
      <td class="num">${fmtPLN0(shownValue)}</td>
      <td class="num ${posClass(shownValue - shownBasis)}">${fmtPLN0(shownValue - shownBasis, true)}</td>
      <td class="num ${posClass(shownValue - shownBasis)}">${shownBasis > 0 ? fmtPct((shownValue - shownBasis) / shownBasis * 100) : '—'}</td>
      <td colspan="4"></td>
    </tr></tfoot></table>`;
}

const ACQ_LABEL = { single: 'Single', box: 'Pull z boxa', trade: 'Wymiana', gift: 'Prezent' };

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function sortCollection(key) {
  if (colSort.key === key) colSort.dir = colSort.dir === 'asc' ? 'desc' : 'asc';
  else { colSort.key = key; colSort.dir = key === 'name' || key === 'date' ? 'asc' : 'desc'; }
  renderCollection();
}

/* ============================================================
   BOXY I BREAKI
   ============================================================ */
const FORMAT_LABEL = {
  hobby: 'Hobby box', blaster: 'Blaster', mega: 'Mega box', tin: 'Tin',
  retail: 'Retail', case: 'Case', other: 'Inne'
};
const PURPOSE_LABEL = { rip: 'do otwarcia', flip: 'do odsprzedaży', undecided: 'bez decyzji' };

function renderBoxes() {
  const bs = M.breakStats, fs = M.flipStats;
  setKpi('b-pnl', bs.count ? fmtPLN0(bs.pnl, true) : '—',
    bs.count ? `zwrot ${fmtPLN0(bs.ret)} z ${fmtPLN0(bs.cost)}` : 'brak otwartych boxów', posClass(bs.pnl));
  setKpi('b-roi', fmtPct(bs.roi), bs.count ? `${nBoxes(bs.count)} otwarte` : '—', posClass(bs.roi));
  setKpi('b-hit', bs.count ? fmtPct(bs.hitRate, false, 0) : '—', bs.count ? `${bs.hits}/${bs.count} na plusie` : '—');
  setKpi('b-avg', bs.count ? fmtPLN0(bs.avgReturn) : '—',
    bs.count ? `mnożnik ${(bs.cost > 0 ? bs.ret / bs.cost : 0).toFixed(2)}×` : '—');
  setKpi('b-flip', fs.count ? fmtPLN0(fs.pnl, true) : '—',
    fs.count ? `${nBoxes(fs.count)}, ROI ${fmtPct(fs.roi)}` : 'brak flipów', posClass(fs.pnl));
  setKpi('b-sealed', String(M.sealed.length), M.sealed.length ? `wartość ${fmtPLN0(M.sealedValue)}` : 'nic nie leży');

  renderSealed();
  renderBreaks();
  renderProductEv();
  renderFlips();
}

function renderSealed() {
  const wrap = el('sealed-wrap');
  if (!M.sealed.length) {
    wrap.innerHTML = emptyBox('inventory_2', 'Brak sealed na stanie', 'Kupione i jeszcze nieotwarte boxy pojawią się tutaj — razem z licznikiem dni od zakupu.');
    return;
  }
  const rows = [...M.sealed].sort((a, b) => (a.date < b.date ? 1 : -1));
  wrap.innerHTML = `<table class="tc-tbl">
    <thead><tr>
      <th>Produkt</th><th>Format</th><th>Plan</th><th>Zakup</th>
      <th class="num">Koszt</th><th class="num">Waluta</th><th class="num">Dni</th><th style="width:170px"></th>
    </tr></thead>
    <tbody>${rows.map(b => {
      const old = (b.daysHeld || 0) > settings.sealedDays;
      return `<tr>
        <td><div class="cd-name"><span class="t">${esc(b.name)}</span><span class="s">${esc([b.brand, b.season, b.source].filter(Boolean).join(' · ') || '—')}</span></div></td>
        <td><span class="cd-status sealed">${FORMAT_LABEL[b.format] || b.format || '—'}</span></td>
        <td class="cd-muted">${PURPOSE_LABEL[b.purpose] || '—'}</td>
        <td class="cd-mono cd-nowrap">${fmtDate(b.date)}</td>
        <td class="num">${fmtPLN0(b.landed)}</td>
        <td class="num cd-muted">${b.currency && b.currency !== 'PLN' ? `${fmtNum(num(b.price), 2)} ${esc(b.currency)}` : '—'}</td>
        <td class="num ${old ? 'cd-warn' : ''}">${b.daysHeld == null ? '—' : b.daysHeld}</td>
        <td>
          <div class="row-actions">
            <button class="row-btn" title="Otwórz box" onclick="openBreakModal('${b.id}')" style="color:var(--cd-gold)"><span class="material-symbols-outlined">auto_awesome</span></button>
            <button class="row-btn" title="Sprzedaj sealed" onclick="openSell('box','${b.id}')" style="color:var(--tc-pos)"><span class="material-symbols-outlined">sell</span></button>
            <button class="row-btn" title="Edytuj" onclick="openBoxModal('${b.id}')"><span class="material-symbols-outlined">edit</span></button>
            <button class="row-btn danger" title="Usuń" onclick="deleteBox('${b.id}')"><span class="material-symbols-outlined">delete</span></button>
          </div>
        </td>
      </tr>`;
    }).join('')}</tbody>
    <tfoot><tr><td colspan="4">Razem</td><td class="num">${fmtPLN0(M.sealedValue)}</td><td colspan="3"></td></tr></tfoot>
  </table>`;
}

function renderBreaks() {
  const wrap = el('breaks-wrap');
  const opened = [...M.opened].sort((a, b) => ((a.openedDate || a.date) < (b.openedDate || b.date) ? 1 : -1));
  el('breaks-desc').textContent = opened.length
    ? `${nBoxes(opened.length)} · ${M.breakStats.hits} na plusie · ROI ${fmtPct(M.breakStats.roi)}`
    : 'jeszcze nic nie otwarte';
  if (!opened.length) {
    wrap.innerHTML = `<section class="tc-card" style="grid-column:1/-1">${emptyBox('auto_awesome', 'Brak breaków', 'Otwórz box z listy sealed — wpiszesz pully, a moduł policzy, ile realnie wyszło z tych pieniędzy.')}</section>`;
    return;
  }
  wrap.innerHTML = opened.map(b => {
    const cls = b.pnl > 0 ? 'win' : b.pnl < 0 ? 'loss' : '';
    const ratio = b.landed > 0 ? Math.min(1.6, b.ret / b.landed) : 0;
    const pulls = [...b.pulls].sort((a, c) => (c.sold ? c.net : c.marketValue) - (a.sold ? a.net : a.marketValue)).slice(0, 4);
    return `<article class="cd-break ${cls}">
      <div class="cd-break-head">
        <div>
          <div class="t">${esc(b.name)}</div>
          <div class="s">${esc([FORMAT_LABEL[b.format] || '', b.season, fmtDate(b.openedDate || b.date)].filter(Boolean).join(' · '))}</div>
        </div>
        <span class="cd-status opened">${b.multiple == null ? '—' : b.multiple.toFixed(2) + '×'}</span>
      </div>
      <div class="cd-break-body">
        <div class="cd-break-nums">
          <div class="cell"><div class="k">Koszt</div><div class="v">${fmtPLN0(b.landed)}</div></div>
          <div class="cell"><div class="k">Zwrot</div><div class="v">${fmtPLN0(b.ret)}</div></div>
          <div class="cell"><div class="k">Wynik</div><div class="v ${posClass(b.pnl)}">${fmtPLN0(b.pnl, true)}</div></div>
        </div>
        <div class="cd-break-bar">
          <i class="${b.pnl < 0 ? 'neg' : ''}" style="width:${Math.max(2, ratio / 1.6 * 100)}%"></i>
          <span class="mark" style="left:${100 / 1.6}%"></span>
        </div>
        <div class="cd-break-pulls">
          ${b.pulls.length ? pulls.map(c => `
            <div class="cd-break-pull" onclick="openCardDrawer('${c.id}')" style="cursor:pointer">
              <span class="material-symbols-outlined" style="font-size:14px;color:var(--tc-muted)">${c.sold ? 'sell' : 'style'}</span>
              <span>${esc(cardTitle(c))}</span>
              <span class="v">${fmtPLN0(c.sold ? c.net : c.marketValue)}</span>
            </div>`).join('')
            : '<div class="cd-break-pull cd-muted">Brak wpisanych kart z tego boxa</div>'}
          ${b.pulls.length > 4 ? `<div class="cd-break-pull cd-muted">+ ${b.pulls.length - 4} ${plural(b.pulls.length - 4, 'karta', 'karty', 'kart')}</div>` : ''}
          ${b.bulk > 0 ? `<div class="cd-break-pull"><span class="material-symbols-outlined" style="font-size:14px;color:var(--tc-muted)">layers</span><span>Bulk / reszta</span><span class="v">${fmtPLN0(b.bulk)}</span></div>` : ''}
        </div>
      </div>
      <div class="cd-break-foot">
        <button class="btn-small" onclick="openBreakModal('${b.id}')"><span class="material-symbols-outlined">edit</span>Popraw pully</button>
        <button class="btn-small ghost" onclick="openBoxModal('${b.id}')">Dane boxa</button>
      </div>
    </article>`;
  }).join('');
}

function renderProductEv() {
  const wrap = el('product-ev-wrap');
  if (!M.opened.length) {
    wrap.innerHTML = emptyBox('analytics', 'Za mało breaków', 'Po kilku otwartych boxach zobaczysz tu, który produkt realnie zwraca więcej niż kosztuje.');
    return;
  }
  const byProduct = groupBy(M.opened, b => b.name || 'Bez nazwy');
  const rows = [...byProduct.entries()].map(([name, list]) => {
    const cost = sum(list, b => b.landed);
    const ret = sum(list, b => b.ret);
    const rois = list.map(b => b.roi).filter(v => v != null);
    return {
      name, n: list.length, cost, ret, pnl: ret - cost,
      roi: cost > 0 ? (ret - cost) / cost * 100 : null,
      hit: list.filter(b => b.pnl > 0).length,
      best: rois.length ? Math.max(...rois) : null,
      worst: rois.length ? Math.min(...rois) : null,
      avgCost: cost / list.length,
      avgRet: ret / list.length
    };
  }).sort((a, b) => b.pnl - a.pnl);

  wrap.innerHTML = `<table class="tc-tbl">
    <thead><tr>
      <th>Produkt</th><th class="num">Boxów</th><th class="num">Śr. koszt</th><th class="num">Śr. zwrot</th>
      <th class="num">Mnożnik</th><th class="num">Wynik</th><th class="num">ROI</th><th class="num">Trafione</th><th class="num">Najlepszy / najgorszy</th>
    </tr></thead>
    <tbody>${rows.map(r => `
      <tr>
        <td><strong>${esc(r.name)}</strong></td>
        <td class="num">${r.n}</td>
        <td class="num">${fmtPLN0(r.avgCost)}</td>
        <td class="num">${fmtPLN0(r.avgRet)}</td>
        <td class="num">${r.cost > 0 ? (r.ret / r.cost).toFixed(2) + '×' : '—'}</td>
        <td class="num ${posClass(r.pnl)}">${fmtPLN0(r.pnl, true)}</td>
        <td class="num ${posClass(r.roi)}">${fmtPct(r.roi)}</td>
        <td class="num">${r.hit}/${r.n}</td>
        <td class="num cd-muted">${fmtPct(r.best)} / ${fmtPct(r.worst)}</td>
      </tr>`).join('')}</tbody>
    <tfoot><tr>
      <td>Razem</td><td class="num">${M.opened.length}</td>
      <td class="num">${fmtPLN0(M.breakStats.avgCost)}</td>
      <td class="num">${fmtPLN0(M.breakStats.avgReturn)}</td>
      <td class="num">${M.breakStats.cost > 0 ? (M.breakStats.ret / M.breakStats.cost).toFixed(2) + '×' : '—'}</td>
      <td class="num ${posClass(M.breakStats.pnl)}">${fmtPLN0(M.breakStats.pnl, true)}</td>
      <td class="num ${posClass(M.breakStats.roi)}">${fmtPct(M.breakStats.roi)}</td>
      <td class="num">${M.breakStats.hits}/${M.opened.length}</td><td></td>
    </tr></tfoot></table>`;
}

function renderFlips() {
  const wrap = el('flips-wrap');
  if (!M.flipped.length) {
    wrap.innerHTML = emptyBox('local_shipping', 'Brak flipów', 'Kupujesz sealed taniej za granicą i sprzedajesz w PL? Zaznacz box jako sprzedany, a rozliczenie marży pojawi się tutaj.');
    return;
  }
  const rows = [...M.flipped].sort((a, b) => (a.sale.date < b.sale.date ? 1 : -1));
  wrap.innerHTML = `<table class="tc-tbl">
    <thead><tr>
      <th>Produkt</th><th>Kupno</th><th>Sprzedaż</th><th class="num">Koszt</th>
      <th class="num">Netto</th><th class="num">Wynik</th><th class="num">ROI</th><th class="num">Dni</th><th style="width:80px"></th>
    </tr></thead>
    <tbody>${rows.map(b => `
      <tr>
        <td><div class="cd-name"><span class="t">${esc(b.name)}</span><span class="s">${esc([b.source, b.sale.channel].filter(Boolean).join(' → ') || '—')}</span></div></td>
        <td class="cd-mono cd-nowrap">${fmtDate(b.date)}</td>
        <td class="cd-mono cd-nowrap">${fmtDate(b.sale.date)}</td>
        <td class="num">${fmtPLN0(b.landed)}</td>
        <td class="num">${fmtPLN0(b.flipNet)}</td>
        <td class="num ${posClass(b.pnl)}">${fmtPLN0(b.pnl, true)}</td>
        <td class="num ${posClass(b.roi)}">${fmtPct(b.roi)}</td>
        <td class="num">${b.daysHeld == null ? '—' : b.daysHeld}</td>
        <td><div class="row-actions">
          <button class="row-btn" title="Edytuj" onclick="openBoxModal('${b.id}')"><span class="material-symbols-outlined">edit</span></button>
          <button class="row-btn danger" title="Usuń" onclick="deleteBox('${b.id}')"><span class="material-symbols-outlined">delete</span></button>
        </div></td>
      </tr>`).join('')}</tbody>
    <tfoot><tr>
      <td colspan="3">Razem</td>
      <td class="num">${fmtPLN0(M.flipStats.cost)}</td>
      <td class="num">${fmtPLN0(sum(M.flipped, b => b.flipNet))}</td>
      <td class="num ${posClass(M.flipStats.pnl)}">${fmtPLN0(M.flipStats.pnl, true)}</td>
      <td class="num ${posClass(M.flipStats.roi)}">${fmtPct(M.flipStats.roi)}</td>
      <td colspan="2"></td>
    </tr></tfoot></table>`;
}

/* ============================================================
   SPRZEDAŻ
   ============================================================ */
function renderSales() {
  setKpi('s-pnl', fmtPLN0(sum(M.sales, s => s.pnl), true), `${M.sales.length} ${plural(M.sales.length, 'transakcja', 'transakcje', 'transakcji')}`, posClass(sum(M.sales, s => s.pnl)));
  setKpi('s-gross', fmtPLN0(M.grossSales), 'przed prowizjami i wysyłką');
  setKpi('s-fees', fmtPLN0(M.feesTotal), M.grossSales > 0 ? `${fmtPct(M.feesTotal / M.grossSales * 100, false)} przychodu` : '—');
  setKpi('s-margin', fmtPct(M.marginPct), `cel ${settings.targetMargin}%`, M.marginPct != null && M.marginPct >= settings.targetMargin ? 'pos' : M.marginPct != null ? 'warn' : '');
  setKpi('s-wr', fmtPct(M.winRate, false, 0), `${M.wins}/${M.sales.length} ze zyskiem`);
  const stoBase = M.sales.length + M.held.length;
  setKpi('s-sto', stoBase ? fmtPct(M.sales.length / stoBase * 100, false, 0) : '—', 'udział sprzedanych w całej bazie');

  renderListed();
  renderSalesTable();
  renderChannelAnalysis();
}

function renderListed() {
  const wrap = el('listed-wrap');
  if (!M.listed.length) {
    wrap.innerHTML = emptyBox('storefront', 'Nic nie wystawione', 'Oznacz kartę jako wystawioną, żeby pilnować wieku ogłoszenia i oczekiwanego wpływu netto.');
    return;
  }
  const rows = [...M.listed].sort((a, b) => ((a.listing && a.listing.date) < (b.listing && b.listing.date) ? -1 : 1));
  const expected = sum(rows, c => expectedNet(c));
  wrap.innerHTML = `<table class="tc-tbl">
    <thead><tr>
      <th>Karta</th><th>Kanał</th><th class="num">Cena</th><th class="num">Oczek. netto</th>
      <th class="num">Wycena</th><th class="num">Marża</th><th class="num">Wisi</th><th style="width:132px"></th>
    </tr></thead>
    <tbody>${rows.map(c => {
      const net = expectedNet(c);
      const margin = c.basis > 0 ? (net - c.basis) / c.basis * 100 : null;
      const age = c.listing ? daysSince(c.listing.date) : null;
      const old = age != null && age > settings.listingDays;
      return `<tr>
        <td onclick="openCardDrawer('${c.id}')" style="cursor:pointer"><div class="cd-name"><span class="t">${esc(cardTitle(c))}</span><span class="s">${esc(cardSubtitle(c) || '—')}</span></div></td>
        <td>${esc((c.listing && c.listing.channel) || '—')}</td>
        <td class="num">${fmtPLN0(c.listing && c.listing.price)}</td>
        <td class="num">${fmtPLN0(net)}</td>
        <td class="num cd-muted">${fmtPLN0(c.marketValue)}</td>
        <td class="num ${posClass(margin)}">${fmtPct(margin)}</td>
        <td class="num ${old ? 'cd-warn' : ''}">${age == null ? '—' : nDays(age)}</td>
        <td><div class="row-actions">
          <button class="row-btn" title="Sprzedane" onclick="openSell('card','${c.id}')" style="color:var(--tc-pos)"><span class="material-symbols-outlined">check_circle</span></button>
          <button class="row-btn" title="Zmień ogłoszenie" onclick="openListModal('${c.id}')"><span class="material-symbols-outlined">edit</span></button>
          <button class="row-btn" title="Zdejmij" onclick="unlistCard('${c.id}')"><span class="material-symbols-outlined">undo</span></button>
        </div></td>
      </tr>`;
    }).join('')}</tbody>
    <tfoot><tr><td colspan="3">Razem oczekiwane</td><td class="num">${fmtPLN0(expected)}</td><td colspan="4"></td></tr></tfoot></table>`;
}

function expectedNet(c) {
  if (!c.listing) return 0;
  const ch = settings.channels.find(x => x.name === c.listing.channel);
  const fee = ch ? num(ch.fee) : 0;
  return num(c.listing.price) * (1 - fee / 100);
}

function filteredSales() {
  const f = saleFilters;
  const t = today();
  return M.sales.filter(s => {
    if (f.channel && s.channel !== f.channel) return false;
    if (f.kind && s.kind !== f.kind) return false;
    if (f.period === 'ytd' && s.date.slice(0, 4) !== t.slice(0, 4)) return false;
    if (f.period !== 'all' && f.period !== 'ytd') {
      const d = daysBetween(s.date, t);
      if (d == null || d > Number(f.period)) return false;
    }
    return true;
  });
}

function renderSalesTable() {
  const rows = filteredSales();
  el('f-sale-count').textContent = `${rows.length} / ${M.sales.length}`;
  const wrap = el('sales-wrap');
  if (!rows.length) {
    wrap.innerHTML = emptyBox('receipt', 'Brak sprzedaży', M.sales.length ? 'Zmień filtry — transakcje są, ale nie w tym zakresie.' : 'Po pierwszej sprzedaży pojawi się tu pełne rozliczenie: brutto, prowizje, netto i ROI.');
    return;
  }
  wrap.innerHTML = `<table class="tc-tbl">
    <thead><tr>
      <th>Data</th><th>Pozycja</th><th>Kanał</th><th class="num">Brutto</th><th class="num">Koszty transakcji</th>
      <th class="num">Netto</th><th class="num">Baza</th><th class="num">P&L</th><th class="num">ROI</th><th class="num">Marża</th><th class="num">Dni</th>
    </tr></thead>
    <tbody>${rows.map(s => `
      <tr ${s.kind === 'card' ? `class="clickable" onclick="openCardDrawer('${s.id}')"` : ''}>
        <td class="cd-mono cd-nowrap">${fmtDate(s.date)}</td>
        <td><div class="cd-name"><span class="t">${esc(s.name)}</span><span class="s">${s.kind === 'box' ? 'sealed box' : esc(cardSubtitle(s.ref) || 'karta')}</span></div></td>
        <td>${esc(s.channel)}</td>
        <td class="num">${fmtPLN0(s.gross)}</td>
        <td class="num cd-neg">${fmtPLN0(-s.fees)}</td>
        <td class="num">${fmtPLN0(s.net)}</td>
        <td class="num cd-muted">${fmtPLN0(s.basis)}</td>
        <td class="num ${posClass(s.pnl)}">${fmtPLN0(s.pnl, true)}</td>
        <td class="num ${posClass(s.roi)}">${fmtPct(s.roi)}</td>
        <td class="num ${posClass(s.margin)}">${fmtPct(s.margin)}</td>
        <td class="num">${s.days == null ? '—' : s.days}</td>
      </tr>`).join('')}</tbody>
    <tfoot><tr>
      <td colspan="3">Razem (widok)</td>
      <td class="num">${fmtPLN0(sum(rows, s => s.gross))}</td>
      <td class="num cd-neg">${fmtPLN0(-sum(rows, s => s.fees))}</td>
      <td class="num">${fmtPLN0(sum(rows, s => s.net))}</td>
      <td class="num">${fmtPLN0(sum(rows, s => s.basis))}</td>
      <td class="num ${posClass(sum(rows, s => s.pnl))}">${fmtPLN0(sum(rows, s => s.pnl), true)}</td>
      <td class="num">${sum(rows, s => s.basis) > 0 ? fmtPct(sum(rows, s => s.pnl) / sum(rows, s => s.basis) * 100) : '—'}</td>
      <td colspan="2"></td>
    </tr></tfoot></table>`;
}

function channelStats() {
  const byChannel = groupBy(M.sales, s => s.channel || '—');
  return [...byChannel.entries()].map(([name, list]) => {
    const gross = sum(list, s => s.gross);
    const pnl = sum(list, s => s.pnl);
    const daysList = list.filter(s => s.days != null).map(s => s.days);
    return {
      name, n: list.length, gross, fees: sum(list, s => s.fees), net: sum(list, s => s.net),
      pnl, margin: gross > 0 ? pnl / gross * 100 : null,
      feePct: gross > 0 ? sum(list, s => s.fees) / gross * 100 : null,
      avgDays: daysList.length ? sum(daysList) / daysList.length : null
    };
  }).sort((a, b) => b.pnl - a.pnl);
}

function renderChannelAnalysis() {
  const rows = channelStats();
  const wrap = el('channel-rank');
  if (!rows.length) {
    wrap.innerHTML = emptyBox('hub', 'Brak danych o kanałach', 'Po kilku sprzedażach zobaczysz, gdzie prowizje zjadają najwięcej marży.');
    renderChart('chart-channel', null);
    return;
  }
  const max = Math.max(...rows.map(r => Math.abs(r.pnl)), 1);
  wrap.innerHTML = `<div class="cd-rank">${rows.map(r => `
    <div class="cd-rank-row center">
      <div class="t">${esc(r.name)}<small>${r.n} ${plural(r.n, 'transakcja', 'transakcje', 'transakcji')} · prowizje ${fmtPct(r.feePct, false)} · ${r.avgDays == null ? '—' : Math.round(r.avgDays) + ' dni'}</small></div>
      <div class="bar"><i class="${r.pnl < 0 ? 'neg' : 'pos'}" style="width:${Math.abs(r.pnl) / max * 50}%"></i></div>
      <div class="v ${posClass(r.pnl)}">${fmtPLN0(r.pnl, true)}</div>
      <div class="r">${fmtPct(r.margin)}</div>
    </div>`).join('')}</div>`;

  renderChart('chart-channel', {
    type: 'bar',
    data: {
      labels: rows.map(r => r.name),
      datasets: [{ data: rows.map(r => r.margin == null ? 0 : r.margin), backgroundColor: rows.map(r => (r.margin || 0) >= 0 ? '#0b8a4a' : '#c0362c'), borderRadius: 5, maxBarThickness: 34 }]
    },
    options: {
      indexAxis: 'y', maintainAspectRatio: false, responsive: true, animation: { duration: 200 },
      plugins: { legend: { display: false }, tooltip: { ...TOOLTIP, callbacks: { label: c => `marża ${fmtPct(c.parsed.x)}` } } },
      scales: { x: axisPct(), y: axisCat() }
    }
  });
}

/* ============================================================
   GRADING
   ============================================================ */
function renderGrading() {
  setKpi('g-pnl', M.gradedReturned.length ? fmtPLN0(M.gradingPnl, true) : '—',
    M.gradedReturned.length ? `${M.gradedReturned.length} ${plural(M.gradedReturned.length, 'wysyłka rozliczona', 'wysyłki rozliczone', 'wysyłek rozliczonych')}` : 'brak rozliczonych', posClass(M.gradingPnl));
  setKpi('g-cost', fmtPLN0(M.gradingSpend), `${sum(M.gradings, g => (g.cardIds || []).length)} ${plural(sum(M.gradings, g => (g.cardIds || []).length), 'karta', 'karty', 'kart')}`);
  setKpi('g-uplift', M.gradedReturned.length ? fmtPLN0(M.gradingUplift, true) : '—', 'wzrost wartości po ocenie', posClass(M.gradingUplift));
  const open = M.gradings.filter(g => g.status !== 'returned');
  setKpi('g-open', String(sum(open, g => (g.cardIds || []).length)), open.length ? `${open.length} ${plural(open.length, 'wysyłka', 'wysyłki', 'wysyłek')} w toku` : 'nic nie wysłane');
  setKpi('g-avg', M.avgGrade == null ? '—' : M.avgGrade.toFixed(2), 'średnia ocena');
  setKpi('g-gem', M.gemRate == null ? '—' : fmtPct(M.gemRate, false, 0), 'udział ocen 10');

  const wrap = el('grading-wrap');
  if (!M.gradings.length) {
    wrap.innerHTML = emptyBox('workspace_premium', 'Brak wysyłek', 'Grading potrafi podnieść wartość karty kilkukrotnie, ale kosztuje i trwa. Zapisuj wysyłki, żeby wiedzieć, czy się opłaca.');
    return;
  }
  const rows = [...M.gradings].sort((a, b) => (a.date < b.date ? 1 : -1));
  wrap.innerHTML = `<table class="tc-tbl">
    <thead><tr>
      <th>Firma</th><th>Poziom</th><th>Wysłano</th><th class="num">Kart</th><th class="num">Koszt</th>
      <th class="num">Wartość przed</th><th class="num">Wartość po</th><th class="num">Wynik</th><th class="num">Dni</th><th>Status</th><th style="width:100px"></th>
    </tr></thead>
    <tbody>${rows.map(g => `
      <tr>
        <td><span class="cd-grade ${String(g.company).toLowerCase()}">${esc(g.company)}</span></td>
        <td>${esc(g.tier || '—')}</td>
        <td class="cd-mono cd-nowrap">${fmtDate(g.date)}</td>
        <td class="num">${(g.cardIds || []).length}</td>
        <td class="num">${fmtPLN0(g.total)}</td>
        <td class="num cd-muted">${g.status === 'returned' ? fmtPLN0(g.before) : '—'}</td>
        <td class="num">${g.status === 'returned' ? fmtPLN0(g.after) : '—'}</td>
        <td class="num ${posClass(g.pnl)}">${g.pnl == null ? '—' : fmtPLN0(g.pnl, true)}</td>
        <td class="num">${g.days == null ? '—' : g.days}</td>
        <td>${g.status === 'returned' ? '<span class="cd-status sold">Wróciło</span>' : '<span class="cd-status grading">W toku</span>'}</td>
        <td><div class="row-actions">
          ${g.status === 'returned' ? '' : `<button class="row-btn" title="Zarejestruj powrót" onclick="openGradingReturn('${g.id}')" style="color:var(--tc-pos)"><span class="material-symbols-outlined">inventory</span></button>`}
          <button class="row-btn danger" title="Usuń" onclick="deleteGrading('${g.id}')"><span class="material-symbols-outlined">delete</span></button>
        </div></td>
      </tr>`).join('')}</tbody></table>`;
}

function renderGradingCalc() {
  const raw = num(el('gc-raw').value);
  const cost = num(el('gc-cost').value);
  const v10 = num(el('gc-v10').value), v9 = num(el('gc-v9').value), v8 = num(el('gc-v8').value);
  const p10 = Math.max(0, Math.min(100, num(el('gc-p10').value)));
  const p9 = Math.max(0, Math.min(100 - p10, num(el('gc-p9').value)));
  const p8 = Math.max(0, 100 - p10 - p9);
  const fee = num(el('gc-fee').value) / 100;

  const netOf = v => v * (1 - fee);
  const ev = (p10 / 100) * netOf(v10) + (p9 / 100) * netOf(v9) + (p8 / 100) * netOf(v8) - cost;
  const rawNet = netOf(raw);
  const edge = ev - rawNet;
  const breakEvenP10 = (() => {
    // Przy jakiej szansie na 10 grading zrównuje się ze sprzedażą raw (reszta idzie na 9).
    const a = netOf(v10) - netOf(v9);
    if (a <= 0) return null;
    return ((rawNet + cost - netOf(v9)) / a) * 100;
  })();

  el('gc-out').innerHTML = `
    <div class="cell"><div class="k">Rozkład ocen</div><div class="v">${p10.toFixed(0)}/${p9.toFixed(0)}/${p8.toFixed(0)}</div></div>
    <div class="cell"><div class="k">EV po gradingu</div><div class="v ${posClass(ev)}">${fmtPLN0(ev)}</div></div>
    <div class="cell"><div class="k">Raw od ręki</div><div class="v">${fmtPLN0(rawNet)}</div></div>
    <div class="cell"><div class="k">Przewaga gradingu</div><div class="v ${posClass(edge)}">${fmtPLN0(edge, true)}</div></div>
    <div class="cell"><div class="k">Próg opłacalności</div><div class="v ${breakEvenP10 == null ? '' : (p10 >= breakEvenP10 ? 'pos' : 'warn')}">${breakEvenP10 == null ? '—' : fmtPct(breakEvenP10, false, 0)}</div></div>
    <div class="cell"><div class="k">Werdykt</div><div class="v ${edge > 0 ? 'pos' : 'neg'}">${edge > 0 ? 'Wysyłaj' : 'Sprzedaj raw'}</div></div>`;
}

/* ============================================================
   KOSZTY
   ============================================================ */
const EXPENSE_LABEL = {
  supplies: 'Materiały', shipping: 'Wysyłka', storage: 'Przechowywanie',
  tools: 'Narzędzia i subskrypcje', travel: 'Dojazdy i giełdy', insurance: 'Ubezpieczenie', other: 'Inne'
};

function costBreakdown() {
  const cardGoods = sum(M.cards.filter(c => c.acq !== 'box'), c => num(c.price) * fxFor(c.currency, c.fx));
  const boxGoods = sum(M.boxes, b => num(b.price) * fxFor(b.currency, b.fx));
  const shippingIn = sum(M.cards.filter(c => c.acq !== 'box'), c => num(c.shipping) * fxFor(c.currency, c.fx))
    + sum(M.boxes, b => num(b.shipping) * fxFor(b.currency, b.fx))
    + sum(M.cards, c => num(c.customs)) + sum(M.boxes, b => num(b.customs));
  const buyFees = sum(M.cards.filter(c => c.acq !== 'box'), c => num(c.fees) * fxFor(c.currency, c.fx))
    + sum(M.boxes, b => num(b.fees) * fxFor(b.currency, b.fx));
  const sellFees = M.feesTotal;
  return {
    cardGoods, boxGoods, shippingIn, buyFees, sellFees,
    grading: M.gradingSpend, overhead: M.overhead,
    total: cardGoods + boxGoods + shippingIn + buyFees + M.gradingSpend + M.overhead
  };
}

function renderCosts() {
  const c = costBreakdown();
  setKpi('e-total', fmtPLN0(M.cashOut), 'gotówka, która wyszła z portfela');
  setKpi('e-cards', fmtPLN0(c.cardGoods), M.cashOut > 0 ? fmtPct(c.cardGoods / M.cashOut * 100, false) : '—');
  setKpi('e-boxes', fmtPLN0(c.boxGoods), M.cashOut > 0 ? fmtPct(c.boxGoods / M.cashOut * 100, false) : '—');
  setKpi('e-ship', fmtPLN0(c.shippingIn), 'wysyłka przychodząca, cło i VAT');
  setKpi('e-fees', fmtPLN0(c.buyFees + c.sellFees), `zakup ${fmtPLN0(c.buyFees)} · sprzedaż ${fmtPLN0(c.sellFees)}`);
  setKpi('e-other', fmtPLN0(c.grading + c.overhead), `grading ${fmtPLN0(c.grading)} · materiały ${fmtPLN0(c.overhead)}`);

  renderCostChart(c);
  renderCashflowChart();
  renderExpenses();
}

function renderExpenses() {
  const wrap = el('expenses-wrap');
  if (!state.expenses.length) {
    wrap.innerHTML = emptyBox('receipt_long', 'Brak kosztów ogólnych',
      'Toploadery, koperty, paliwo na giełdę, subskrypcja cennika — to wszystko zjada marżę. Bez tych wpisów ROI jest zawyżone.');
    return;
  }
  const rows = [...state.expenses].sort((a, b) => (a.date < b.date ? 1 : -1));
  const byCat = groupBy(rows, e => e.category || 'other');
  wrap.innerHTML = `<table class="tc-tbl">
    <thead><tr><th>Data</th><th>Kategoria</th><th>Opis</th><th class="num">Kwota</th><th class="num">Udział</th><th style="width:80px"></th></tr></thead>
    <tbody>${rows.map(e => `
      <tr>
        <td class="cd-mono cd-nowrap">${fmtDate(e.date)}</td>
        <td>${esc(EXPENSE_LABEL[e.category] || e.category)}${e.recurring === 'yes' ? ' <span class="cd-tag">CYKL</span>' : ''}</td>
        <td>${esc(e.note || '—')}</td>
        <td class="num">${fmtPLN0(num(e.amount))}</td>
        <td class="num cd-muted">${M.overhead > 0 ? fmtPct(num(e.amount) / M.overhead * 100, false) : '—'}</td>
        <td><div class="row-actions">
          <button class="row-btn" title="Edytuj" onclick="openExpenseModal('${e.id}')"><span class="material-symbols-outlined">edit</span></button>
          <button class="row-btn danger" title="Usuń" onclick="deleteExpense('${e.id}')"><span class="material-symbols-outlined">delete</span></button>
        </div></td>
      </tr>`).join('')}</tbody>
    <tfoot><tr>
      <td colspan="3">Razem — ${[...byCat.keys()].length} ${plural([...byCat.keys()].length, 'kategoria', 'kategorie', 'kategorii')}</td>
      <td class="num">${fmtPLN0(M.overhead)}</td><td colspan="2"></td>
    </tr></tfoot></table>`;
}

/* ============================================================
   Wykresy — wspólne ustawienia
   ============================================================ */
const TOOLTIP = { backgroundColor: '#0f172a', titleColor: '#fff', bodyColor: '#cbd5e1', padding: 10, displayColors: false, cornerRadius: 6 };
const PALETTE = ['#0057c0', '#0b8a4a', '#a16207', '#7c3aed', '#be185d', '#0369a1', '#c0362c', '#0f766e', '#b45309', '#4338ca', '#64748b', '#9333ea'];

function axisPLN() {
  return { grid: { color: 'rgba(226,232,240,0.7)' }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => Math.round(v).toLocaleString('pl-PL') } };
}
function axisPct() {
  return { grid: { color: 'rgba(226,232,240,0.7)' }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => v + '%' } };
}
function axisCat() {
  return { grid: { display: false }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 }, autoSkip: false } };
}
function axisCount() {
  return { grid: { color: 'rgba(226,232,240,0.7)' }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 }, precision: 0 } };
}
function legendBottom() {
  return { position: 'bottom', labels: { boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: 'circle', color: '#64748b', font: { size: 11 }, padding: 12 } };
}
function barColors(values) { return values.map(v => v >= 0 ? '#0b8a4a' : '#c0362c'); }

function renderChart(id, config) {
  const canvas = el(id);
  if (!canvas) return;
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
  if (!config || typeof Chart === 'undefined') return;
  charts[id] = new Chart(canvas.getContext('2d'), config);
}

function renderEquityChart(series) {
  let pts = series;
  if (eqRange !== 'all' && pts.length > 1) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(eqRange));
    const c = cutoff.toISOString().slice(0, 10);
    const filtered = pts.filter((p, i) => i === pts.length - 1 || p.at >= c);
    if (filtered.length > 1) pts = filtered;
  }
  const last = pts[pts.length - 1];
  el('eq-net').textContent = last ? fmtPLN0(last.market) : '—';
  const delta = last ? last.market - last.basis : 0;
  const d = el('eq-delta');
  d.textContent = last ? `${fmtPLN0(delta, true)} nad kosztem` : '—';
  d.className = 'delta mono ' + posClass(delta);

  if (!pts.length) { renderChart('chart-equity', null); return; }

  renderChart('chart-equity', {
    type: 'line',
    data: {
      labels: pts.map(p => monthLabel(p.ym)),
      datasets: [
        {
          label: 'Wycena', data: pts.map(p => p.market), borderColor: '#0057c0',
          backgroundColor: ctx => {
            const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 240);
            g.addColorStop(0, 'rgba(0,87,192,0.22)'); g.addColorStop(1, 'rgba(0,87,192,0)');
            return g;
          },
          fill: true, borderWidth: 2, tension: 0.25, pointRadius: 0, pointHoverRadius: 4
        },
        {
          label: 'Koszt', data: pts.map(p => p.basis), borderColor: '#94a3b8',
          borderWidth: 1.5, borderDash: [5, 4], fill: false, tension: 0.25, pointRadius: 0, pointHoverRadius: 4
        }
      ]
    },
    options: {
      maintainAspectRatio: false, responsive: true, animation: { duration: 200 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: legendBottom(),
        tooltip: { ...TOOLTIP, displayColors: true, callbacks: { label: c => `${c.dataset.label}: ${fmtPLN(c.parsed.y)}` } }
      },
      scales: { x: { ...axisCat(), ticks: { ...axisCat().ticks, autoSkip: true, maxTicksLimit: 10 } }, y: axisPLN() }
    }
  });
}

function renderCostChart(c) {
  const rows = [
    ['Karty single', c.cardGoods],
    ['Boxy', c.boxGoods],
    ['Wysyłka i cło', c.shippingIn],
    ['Prowizje zakupu', c.buyFees],
    ['Prowizje sprzedaży', c.sellFees],
    ['Grading', c.grading],
    ['Materiały i reszta', c.overhead]
  ].filter(r => r[1] > 0.005);
  if (!rows.length) { renderChart('chart-costs', null); return; }
  renderChart('chart-costs', {
    type: 'doughnut',
    data: { labels: rows.map(r => r[0]), datasets: [{ data: rows.map(r => r[1]), backgroundColor: PALETTE, borderWidth: 2, borderColor: '#fff' }] },
    options: {
      maintainAspectRatio: false, responsive: true, cutout: '58%', animation: { duration: 220 },
      plugins: {
        legend: legendBottom(),
        tooltip: { ...TOOLTIP, displayColors: true, callbacks: { label: ctx => `${ctx.label}: ${fmtPLN0(ctx.parsed)} (${fmtPct(ctx.parsed / sum(rows, r => r[1]) * 100, false)})` } }
      }
    }
  });
}

function renderCashflowChart() {
  const events = [];
  for (const b of M.boxes) { if (b.date) events.push([b.date.slice(0, 7), -b.landed]); if (b.sale) events.push([b.sale.date.slice(0, 7), saleNet(b.sale)]); }
  for (const c of M.cards) {
    if (c.acq !== 'box' && c.date) events.push([c.date.slice(0, 7), -cardOwnCost(c)]);
    if (c.sale) events.push([c.sale.date.slice(0, 7), saleNet(c.sale)]);
  }
  for (const g of state.gradings) if (g.date) events.push([g.date.slice(0, 7), -(num(g.feePerCard) * (g.cardIds || []).length + num(g.shipping) + num(g.extra))]);
  for (const e of state.expenses) if (e.date) events.push([e.date.slice(0, 7), -num(e.amount)]);
  if (!events.length) { renderChart('chart-cashflow', null); return; }

  const months = [...new Set(events.map(e => e[0]))].sort();
  const full = [];
  for (let ym = months[0]; ym <= months[months.length - 1]; ym = addMonths(ym, 1)) full.push(ym);
  const outs = full.map(ym => -sum(events.filter(e => e[0] === ym && e[1] < 0), e => e[1]));
  const ins = full.map(ym => sum(events.filter(e => e[0] === ym && e[1] > 0), e => e[1]));
  let acc = 0;
  const net = full.map((ym, i) => (acc += ins[i] - outs[i]));

  renderChart('chart-cashflow', {
    data: {
      labels: full.map(monthLabel),
      datasets: [
        { type: 'bar', label: 'Wydatki', data: outs.map(v => -v), backgroundColor: '#c0362c', borderRadius: 4, maxBarThickness: 26, stack: 'cf' },
        { type: 'bar', label: 'Wpływy', data: ins, backgroundColor: '#0b8a4a', borderRadius: 4, maxBarThickness: 26, stack: 'cf' },
        { type: 'line', label: 'Gotówka narastająco', data: net, borderColor: '#0f172a', borderWidth: 2, tension: 0.25, pointRadius: 0, fill: false }
      ]
    },
    options: {
      maintainAspectRatio: false, responsive: true, animation: { duration: 200 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: legendBottom(),
        tooltip: { ...TOOLTIP, displayColors: true, callbacks: { label: c => `${c.dataset.label}: ${fmtPLN(c.parsed.y)}` } }
      },
      scales: { x: { ...axisCat(), stacked: true, ticks: { ...axisCat().ticks, autoSkip: true, maxTicksLimit: 12 } }, y: axisPLN() }
    }
  });
}

/* ============================================================
   ANALITYKA
   ============================================================ */
function renderAnalytics() {
  const conc = concentration();
  el('an-desc').textContent = M.held.length
    ? `${nCards(M.held.length)} · ${fmtPLN0(M.heldValue)} · ${new Set(M.held.map(c => c.player)).size} ${plural(new Set(M.held.map(c => c.player)).size, 'zawodnik', 'zawodników', 'zawodników')}`
    : 'brak danych';

  renderPlayerChart(conc);
  renderProductChart();
  renderTypeChart();
  renderAgingChart();
  renderPortfolioChart();
  renderReconStrip();
  renderMonthlyPnlChart();
  renderRoiDistChart();
  renderRankings();
  renderTaxPanel();
  renderLiquidityPanel();
}

function renderPlayerChart(conc) {
  const strip = el('conc-strip');
  if (!conc.rows.length) {
    strip.innerHTML = '';
    renderChart('chart-players', null);
    return;
  }
  const top = conc.rows.slice(0, 12);
  const rest = conc.rows.slice(12);
  const labels = top.map(r => r.name);
  const data = top.map(r => r.value);
  if (rest.length) { labels.push(`Pozostali (${rest.length})`); data.push(sum(rest, r => r.value)); }

  const hhiLabel = conc.hhi > 2500 ? 'skrajna' : conc.hhi > 1500 ? 'wysoka' : 'zdrowa';
  strip.innerHTML = `
    <div class="cell"><div class="k">Największa pozycja</div><div class="v ${conc.top.share > settings.concAlert ? 'warn' : ''}">${fmtPct(conc.top.share, false)}</div></div>
    <div class="cell"><div class="k">Top 5</div><div class="v">${fmtPct(conc.top5, false)}</div></div>
    <div class="cell"><div class="k">HHI</div><div class="v ${conc.hhi > 2500 ? 'neg' : conc.hhi > 1500 ? 'warn' : 'pos'}">${Math.round(conc.hhi)}</div></div>
    <div class="cell"><div class="k">Dywersyfikacja</div><div class="v">${hhiLabel}</div></div>`;

  renderChart('chart-players', {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]), borderRadius: 4, maxBarThickness: 22 }] },
    options: {
      indexAxis: 'y', maintainAspectRatio: false, responsive: true, animation: { duration: 200 },
      plugins: {
        legend: { display: false },
        tooltip: { ...TOOLTIP, callbacks: { label: c => `${fmtPLN0(c.parsed.x)} · ${fmtPct(c.parsed.x / conc.total * 100, false)}` } }
      },
      scales: { x: axisPLN(), y: axisCat() }
    }
  });
}

function renderProductChart() {
  const held = M.held;
  if (!held.length) { renderChart('chart-products', null); return; }
  const byProduct = groupBy(held, c => c.product || 'Bez produktu');
  const rows = [...byProduct.entries()].map(([name, list]) => ({ name, value: sum(list, c => c.marketValue) }))
    .sort((a, b) => b.value - a.value);
  const top = rows.slice(0, 8);
  const rest = rows.slice(8);
  const labels = top.map(r => r.name);
  const data = top.map(r => r.value);
  if (rest.length) { labels.push(`Pozostałe (${rest.length})`); data.push(sum(rest, r => r.value)); }
  const total = sum(data);

  renderChart('chart-products', {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: PALETTE, borderWidth: 2, borderColor: '#fff' }] },
    options: {
      maintainAspectRatio: false, responsive: true, cutout: '58%', animation: { duration: 220 },
      plugins: {
        legend: legendBottom(),
        tooltip: { ...TOOLTIP, displayColors: true, callbacks: { label: c => `${c.label}: ${fmtPLN0(c.parsed)} (${fmtPct(c.parsed / total * 100, false)})` } }
      }
    }
  });
}

function renderTypeChart() {
  const held = M.held;
  if (!held.length) { renderChart('chart-types', null); return; }
  const buckets = [
    ['1/1', c => num(c.run) === 1],
    ['Auto + patch', c => c.auto && c.patch && num(c.run) !== 1],
    ['Autograf', c => c.auto && !c.patch && num(c.run) !== 1],
    ['Patch / mem', c => c.patch && !c.auto && num(c.run) !== 1],
    ['Numerowana', c => !c.auto && !c.patch && c.run && num(c.run) !== 1],
    ['Rookie', c => !c.auto && !c.patch && !c.run && c.rookie],
    ['Parallel / insert', c => !c.auto && !c.patch && !c.run && !c.rookie && c.parallel && c.parallel.toLowerCase() !== 'base'],
    ['Base', () => true]
  ];
  const assigned = new Set();
  const rows = [];
  for (const [label, test] of buckets) {
    const list = held.filter(c => !assigned.has(c.id) && test(c));
    list.forEach(c => assigned.add(c.id));
    if (list.length) rows.push({ label, value: sum(list, c => c.marketValue), count: list.length });
  }
  const total = sum(rows, r => r.value) || 1;

  renderChart('chart-types', {
    type: 'bar',
    data: {
      labels: rows.map(r => r.label),
      datasets: [{ data: rows.map(r => r.value), backgroundColor: rows.map((_, i) => PALETTE[i % PALETTE.length]), borderRadius: 4, maxBarThickness: 30 }]
    },
    options: {
      maintainAspectRatio: false, responsive: true, animation: { duration: 200 },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP,
          callbacks: {
            label: c => `${fmtPLN0(c.parsed.y)} · ${fmtPct(c.parsed.y / total * 100, false)}`,
            afterLabel: c => `${nCards(rows[c.dataIndex].count)}`
          }
        }
      },
      scales: { x: { ...axisCat(), ticks: { ...axisCat().ticks, maxRotation: 45, minRotation: 0, autoSkip: false, font: { size: 9 } } }, y: axisPLN() }
    }
  });
}

const AGE_BUCKETS = [
  ['0–30 dni', 0, 30], ['31–90', 31, 90], ['91–180', 91, 180],
  ['181–365', 181, 365], ['366–730', 366, 730], ['> 2 lata', 731, Infinity]
];

function renderAgingChart() {
  const held = M.held.filter(c => c.daysHeld != null);
  if (!held.length) { renderChart('chart-aging', null); return; }
  const values = AGE_BUCKETS.map(([, lo, hi]) => sum(held.filter(c => c.daysHeld >= lo && c.daysHeld <= hi), c => c.marketValue));
  const counts = AGE_BUCKETS.map(([, lo, hi]) => held.filter(c => c.daysHeld >= lo && c.daysHeld <= hi).length);

  renderChart('chart-aging', {
    data: {
      labels: AGE_BUCKETS.map(b => b[0]),
      datasets: [
        { type: 'bar', label: 'Wartość', data: values, backgroundColor: AGE_BUCKETS.map((b, i) => b[1] >= settings.agingDays ? '#b45309' : '#0057c0'), borderRadius: 4, maxBarThickness: 40, yAxisID: 'y' },
        { type: 'line', label: 'Liczba kart', data: counts, borderColor: '#0f172a', borderWidth: 2, tension: 0.3, pointRadius: 3, fill: false, yAxisID: 'y1' }
      ]
    },
    options: {
      maintainAspectRatio: false, responsive: true, animation: { duration: 200 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: legendBottom(),
        tooltip: { ...TOOLTIP, displayColors: true, callbacks: { label: c => c.dataset.yAxisID === 'y1' ? `${c.parsed.y} kart` : fmtPLN0(c.parsed.y) } }
      },
      scales: {
        x: axisCat(), y: axisPLN(),
        y1: { position: 'right', grid: { display: false }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 }, precision: 0 } }
      }
    }
  });
}

function renderPortfolioChart() {
  const pts = portfolioSeries();
  if (!pts.length) { renderChart('chart-portfolio', null); return; }
  renderChart('chart-portfolio', {
    data: {
      labels: pts.map(p => monthLabel(p.ym)),
      datasets: [
        {
          type: 'line', label: 'Majątek (karty + sealed)', data: pts.map(p => p.assets), borderColor: '#0057c0',
          backgroundColor: ctx => {
            const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 320);
            g.addColorStop(0, 'rgba(0,87,192,0.20)'); g.addColorStop(1, 'rgba(0,87,192,0)');
            return g;
          },
          fill: true, borderWidth: 2, tension: 0.25, pointRadius: 0
        },
        { type: 'line', label: 'Zainwestowana gotówka', data: pts.map(p => p.invested), borderColor: '#b45309', borderWidth: 1.6, borderDash: [5, 4], fill: false, tension: 0.25, pointRadius: 0 },
        { type: 'line', label: 'Wynik łączny', data: pts.map(p => p.result), borderColor: '#0b8a4a', borderWidth: 2, fill: false, tension: 0.25, pointRadius: 0 }
      ]
    },
    options: {
      maintainAspectRatio: false, responsive: true, animation: { duration: 200 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: legendBottom(),
        tooltip: { ...TOOLTIP, displayColors: true, callbacks: { label: c => `${c.dataset.label}: ${fmtPLN(c.parsed.y)}` } }
      },
      scales: { x: { ...axisCat(), ticks: { ...axisCat().ticks, autoSkip: true, maxTicksLimit: 12 } }, y: axisPLN() }
    }
  });
}

function renderReconStrip() {
  el('recon-strip').innerHTML = `
    <div class="cell"><div class="k">Zrealizowany</div><div class="v ${posClass(M.realized)}">${fmtPLN0(M.realized, true)}</div></div>
    <div class="cell"><div class="k">Na papierze</div><div class="v ${posClass(M.unrealized)}">${fmtPLN0(M.unrealized, true)}</div></div>
    <div class="cell"><div class="k">Bulk</div><div class="v">${fmtPLN0(M.bulkValue)}</div></div>
    <div class="cell"><div class="k">Nieprzypisane</div><div class="v ${M.unallocated > 0.5 ? 'warn' : ''}">${fmtPLN0(-M.unallocated)}</div></div>
    <div class="cell"><div class="k">Koszty ogólne</div><div class="v">${fmtPLN0(-M.overhead)}</div></div>
    <div class="cell"><div class="k">Wynik łączny</div><div class="v ${posClass(M.totalResult)}">${fmtPLN0(M.totalResult, true)}</div></div>
    <div class="cell"><div class="k">Różnica</div><div class="v ${Math.abs(M.residual) < 0.01 ? 'pos' : 'neg'}">${Math.abs(M.residual) < 0.01 ? '0 zł' : fmtPLN(M.residual)}</div></div>`;
}

function renderMonthlyPnlChart() {
  if (!M.sales.length) { renderChart('chart-monthly-pnl', null); return; }
  const byMonth = groupBy(M.sales, s => s.date.slice(0, 7));
  const keys = [...byMonth.keys()].sort();
  const full = [];
  for (let ym = keys[0]; ym <= keys[keys.length - 1]; ym = addMonths(ym, 1)) full.push(ym);
  const vals = full.map(ym => sum(byMonth.get(ym) || [], s => s.pnl));
  let acc = 0;
  const cum = vals.map(v => (acc += v));

  renderChart('chart-monthly-pnl', {
    data: {
      labels: full.map(monthLabel),
      datasets: [
        { type: 'bar', label: 'Wynik miesiąca', data: vals, backgroundColor: barColors(vals), borderRadius: 4, maxBarThickness: 34 },
        { type: 'line', label: 'Narastająco', data: cum, borderColor: '#0f172a', borderWidth: 2, tension: 0.25, pointRadius: 0, fill: false }
      ]
    },
    options: {
      maintainAspectRatio: false, responsive: true, animation: { duration: 200 },
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: legendBottom(), tooltip: { ...TOOLTIP, displayColors: true, callbacks: { label: c => `${c.dataset.label}: ${fmtPLN(c.parsed.y, true)}` } } },
      scales: { x: { ...axisCat(), ticks: { ...axisCat().ticks, autoSkip: true, maxTicksLimit: 12 } }, y: axisPLN() }
    }
  });
}

const ROI_BUCKETS = [
  ['< −50%', -Infinity, -50], ['−50…−20%', -50, -20], ['−20…0%', -20, 0],
  ['0…25%', 0, 25], ['25…50%', 25, 50], ['50…100%', 50, 100], ['> 100%', 100, Infinity]
];

function renderRoiDistChart() {
  const withRoi = M.sales.filter(s => s.roi != null);
  if (!withRoi.length) { renderChart('chart-roi-dist', null); return; }
  const counts = ROI_BUCKETS.map(([, lo, hi]) => withRoi.filter(s => s.roi > lo && s.roi <= hi).length);
  renderChart('chart-roi-dist', {
    type: 'bar',
    data: {
      labels: ROI_BUCKETS.map(b => b[0]),
      datasets: [{ data: counts, backgroundColor: ROI_BUCKETS.map(b => b[2] <= 0 ? '#c0362c' : '#0b8a4a'), borderRadius: 4, maxBarThickness: 40 }]
    },
    options: {
      maintainAspectRatio: false, responsive: true, animation: { duration: 200 },
      plugins: {
        legend: { display: false },
        tooltip: { ...TOOLTIP, callbacks: { label: c => `${c.parsed.y} ${plural(c.parsed.y, 'transakcja', 'transakcje', 'transakcji')}` } }
      },
      scales: { x: { ...axisCat(), ticks: { ...axisCat().ticks, font: { size: 9 } } }, y: axisCount() }
    }
  });
}

function renderRankings() {
  renderRank('rank-players', groupResults(c => c.player || 'Bez nazwy'), 'Dodaj karty, żeby zobaczyć, na kim realnie zarabiasz.');
  renderRank('rank-products', groupResults(c => c.product || 'Bez produktu'), 'Po kilku transakcjach zobaczysz, które sety się bronią.');
}

function groupResults(keyFn) {
  const map = new Map();
  for (const c of M.cards) {
    const k = keyFn(c);
    if (!map.has(k)) map.set(k, { key: k, pnl: 0, basis: 0, n: 0, held: 0, sold: 0 });
    const e = map.get(k);
    e.pnl += c.pnl; e.basis += c.basis; e.n++;
    if (c.sold) e.sold++; else e.held++;
  }
  return [...map.values()]
    .map(e => ({ ...e, roi: e.basis > 0 ? e.pnl / e.basis * 100 : null }))
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
    .slice(0, 10);
}

function renderRank(id, rows, emptyText) {
  const wrap = el(id);
  if (!rows.length) { wrap.innerHTML = emptyBox('leaderboard', 'Brak danych', emptyText); return; }
  const max = Math.max(...rows.map(r => Math.abs(r.pnl)), 1);
  wrap.innerHTML = `<div class="cd-rank">${rows.map(r => `
    <div class="cd-rank-row center">
      <div class="t">${esc(r.key)}<small>${nCards(r.n)} · ${r.sold} sprzedanych · baza ${fmtPLN0(r.basis)}</small></div>
      <div class="bar"><i class="${r.pnl < 0 ? 'neg' : 'pos'}" style="width:${Math.abs(r.pnl) / max * 50}%"></i></div>
      <div class="v ${posClass(r.pnl)}">${fmtPLN0(r.pnl, true)}</div>
      <div class="r">${fmtPct(r.roi)}</div>
    </div>`).join('')}</div>`;
}

function renderTaxPanel() {
  const held = M.held.filter(c => c.daysHeld != null);
  const free = held.filter(c => c.daysHeld >= 183);
  const soon = held.filter(c => c.daysHeld >= 150 && c.daysHeld < 183);
  const fresh = held.filter(c => c.daysHeld < 150);
  el('tax-sub').textContent = `${held.length} ${plural(held.length, 'pozycja', 'pozycje', 'pozycji')} na stanie`;
  el('tax-strip').innerHTML = `
    <div class="cell"><div class="k">Poza PIT</div><div class="v pos">${free.length}</div></div>
    <div class="cell"><div class="k">Wartość</div><div class="v">${fmtPLN0(sum(free, c => c.marketValue))}</div></div>
    <div class="cell"><div class="k">Blisko progu</div><div class="v warn">${soon.length}</div></div>
    <div class="cell"><div class="k">Świeże</div><div class="v">${fresh.length}</div></div>`;

  const wrap = el('tax-wrap');
  if (!soon.length) {
    wrap.innerHTML = `<div class="cd-note" style="margin:12px 14px">
      ${free.length ? `<strong>${nCards(free.length)}</strong> przekroczyło 6 miesięcy — sprzedaż tych pozycji nie rodzi obowiązku PIT.` : 'Żadna pozycja nie przekroczyła jeszcze 6 miesięcy.'}
      Karty kupione poniżej 1000 zł i sprzedane przed upływem pół roku podlegają PIT od dochodu — trzymaj dowody zakupu.
    </div>`;
    return;
  }
  wrap.innerHTML = `<table class="tc-tbl">
    <thead><tr><th>Karta</th><th class="num">Dni</th><th class="num">Do progu</th><th class="num">Wycena</th><th class="num">Zysk na papierze</th></tr></thead>
    <tbody>${[...soon].sort((a, b) => b.daysHeld - a.daysHeld).map(c => `
      <tr class="clickable" onclick="openCardDrawer('${c.id}')">
        <td><div class="cd-name"><span class="t">${esc(cardTitle(c))}</span><span class="s">kupiona ${fmtDate(c.date)}</span></div></td>
        <td class="num">${c.daysHeld}</td>
        <td class="num cd-warn">${183 - c.daysHeld}</td>
        <td class="num">${fmtPLN0(c.marketValue)}</td>
        <td class="num ${posClass(c.pnl)}">${fmtPLN0(c.pnl, true)}</td>
      </tr>`).join('')}</tbody></table>`;
}

function renderLiquidityPanel() {
  const soldWithDays = M.sales.filter(s => s.days != null);
  const dead = M.held.filter(c => (c.daysHeld || 0) > settings.agingDays);
  const turnover = M.heldValue > 0 ? sum(M.sales.filter(s => daysBetween(s.date, today()) <= 365), s => s.net) / M.heldValue : null;
  el('liq-strip').innerHTML = `
    <div class="cell"><div class="k">Śr. czas do sprzedaży</div><div class="v">${soldWithDays.length ? Math.round(sum(soldWithDays, s => s.days) / soldWithDays.length) + ' dni' : '—'}</div></div>
    <div class="cell"><div class="k">Mediana</div><div class="v">${soldWithDays.length ? Math.round(median(soldWithDays.map(s => s.days))) + ' dni' : '—'}</div></div>
    <div class="cell"><div class="k">Martwy stock</div><div class="v ${dead.length ? 'warn' : 'pos'}">${dead.length}</div></div>
    <div class="cell"><div class="k">Rotacja 12M</div><div class="v">${turnover == null ? '—' : turnover.toFixed(2) + '×'}</div></div>`;

  if (!soldWithDays.length) { renderChart('chart-dts', null); return; }
  const buckets = [['0–14', 0, 14], ['15–30', 15, 30], ['31–60', 31, 60], ['61–120', 61, 120], ['121–365', 121, 365], ['> rok', 366, Infinity]];
  const counts = buckets.map(([, lo, hi]) => soldWithDays.filter(s => s.days >= lo && s.days <= hi).length);
  const avgRoi = buckets.map(([, lo, hi]) => {
    const list = soldWithDays.filter(s => s.days >= lo && s.days <= hi && s.roi != null);
    return list.length ? sum(list, s => s.roi) / list.length : null;
  });

  renderChart('chart-dts', {
    data: {
      labels: buckets.map(b => b[0]),
      datasets: [
        { type: 'bar', label: 'Transakcje', data: counts, backgroundColor: '#0057c0', borderRadius: 4, maxBarThickness: 34, yAxisID: 'y' },
        { type: 'line', label: 'Śr. ROI', data: avgRoi, borderColor: '#0b8a4a', borderWidth: 2, tension: 0.3, pointRadius: 3, fill: false, yAxisID: 'y1', spanGaps: true }
      ]
    },
    options: {
      maintainAspectRatio: false, responsive: true, animation: { duration: 200 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: legendBottom(),
        tooltip: { ...TOOLTIP, displayColors: true, callbacks: { label: c => c.dataset.yAxisID === 'y1' ? `ROI ${fmtPct(c.parsed.y)}` : `${c.parsed.y} ${plural(c.parsed.y, 'transakcja', 'transakcje', 'transakcji')}` } }
      },
      scales: {
        x: axisCat(), y: axisCount(),
        y1: { position: 'right', grid: { display: false }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => v + '%' } }
      }
    }
  });
}

/* ============================================================
   WATCHLISTA
   ============================================================ */
const PRIO_LABEL = { high: 'wysoki', mid: 'średni', low: 'niski' };

function renderWatchlist() {
  const wrap = el('watch-wrap');
  if (!state.watchlist.length) {
    wrap.innerHTML = emptyBox('visibility', 'Watchlista pusta', 'Zapisz karty, na które polujesz, razem z ceną, przy której to okazja. Emocje z licytacji nie podniosą Ci wtedy progu.');
    return;
  }
  const order = { high: 0, mid: 1, low: 2 };
  const rows = [...state.watchlist].sort((a, b) => (order[a.priority] ?? 3) - (order[b.priority] ?? 3));
  wrap.innerHTML = `<table class="tc-tbl">
    <thead><tr>
      <th>Karta</th><th>Produkt</th><th>Priorytet</th><th class="num">Cel</th><th class="num">Rynek dziś</th>
      <th class="num">Luka</th><th class="num">Budżet</th><th>Notatka</th><th style="width:80px"></th>
    </tr></thead>
    <tbody>${rows.map(w => {
      const target = num(w.target), market = num(w.market);
      const gap = market && target ? (market - target) / target * 100 : null;
      const ready = gap != null && gap <= 0;
      return `<tr>
        <td><strong>${esc(w.name)}</strong></td>
        <td class="cd-muted">${esc(w.product || '—')}</td>
        <td><span class="cd-prio ${w.priority || 'mid'}">${PRIO_LABEL[w.priority] || 'średni'}</span></td>
        <td class="num">${fmtPLN0(target)}</td>
        <td class="num">${market ? fmtPLN0(market) : '—'}</td>
        <td class="num gap ${ready ? 'cd-pos' : gap != null ? 'cd-warn' : ''}">${gap == null ? '—' : (ready ? 'kupuj ' : '') + fmtPct(gap)}</td>
        <td class="num cd-muted">${w.budget ? fmtPLN0(num(w.budget)) : '—'}</td>
        <td class="cd-muted" style="max-width:260px">${esc(w.note || '—')}</td>
        <td><div class="row-actions">
          <button class="row-btn" title="Edytuj" onclick="openWatchModal('${w.id}')"><span class="material-symbols-outlined">edit</span></button>
          <button class="row-btn danger" title="Usuń" onclick="deleteWatch('${w.id}')"><span class="material-symbols-outlined">delete</span></button>
        </div></td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

/* ============================================================
   Modale — obsługa ogólna
   ============================================================ */
function openModal(id) { const m = el(id); if (m) m.classList.add('on'); }
function closeModal(id) { const m = el(id); if (m) m.classList.remove('on'); }
function closeAllModals() { document.querySelectorAll('.tc-modal-ov.on').forEach(m => m.classList.remove('on')); }
function setVal(id, v) { const e = el(id); if (e) e.value = v == null ? '' : v; }
function getVal(id) { const e = el(id); return e ? e.value : ''; }
function setChecked(id, v) { const e = el(id); if (e) e.checked = !!v; syncCheckLabel(e); }
function isChecked(id) { const e = el(id); return e ? e.checked : false; }
function syncCheckLabel(input) {
  if (!input) return;
  const label = input.closest('.cd-check');
  if (label) label.classList.toggle('on', input.checked);
}

function fillSelect(id, options, selected, placeholder) {
  const s = el(id);
  if (!s) return;
  s.innerHTML = (placeholder ? `<option value="">${esc(placeholder)}</option>` : '')
    + options.map(o => {
      const value = typeof o === 'string' ? o : o.value;
      const label = typeof o === 'string' ? o : o.label;
      return `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
    }).join('');
}

function fillDatalist(id, values) {
  const dl = el(id);
  if (!dl) return;
  dl.innerHTML = [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'pl'))
    .map(v => `<option value="${esc(v)}"></option>`).join('');
}

function refreshDatalists() {
  fillDatalist('dl-players', [...state.cards.map(c => c.player), ...state.watchlist.map(w => w.name)]);
  fillDatalist('dl-teams', state.cards.map(c => c.team));
  fillDatalist('dl-products', [...state.cards.map(c => c.product), ...SUGGEST.products]);
  fillDatalist('dl-box-products', [...state.boxes.map(b => b.name), ...SUGGEST.products]);
  fillDatalist('dl-brands', [...state.cards.map(c => c.brand), ...state.boxes.map(b => b.brand), ...SUGGEST.brands]);
  fillDatalist('dl-parallels', [...state.cards.map(c => c.parallel), ...SUGGEST.parallels]);
  fillDatalist('dl-seasons', [...state.cards.map(c => c.season), ...state.boxes.map(b => b.season), ...SUGGEST.seasons]);
  fillDatalist('dl-channels', [...state.cards.map(c => c.source), ...state.boxes.map(b => b.source), ...SUGGEST.buyChannels]);
  fillDatalist('dl-val-sources', [...state.valuations.map(v => v.source), ...SUGGEST.valSources]);

  const players = [...new Set(state.cards.map(c => c.player).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl'));
  const products = [...new Set(state.cards.map(c => c.product).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl'));
  fillSelect('f-player', players, colFilters.player, 'Każdy zawodnik');
  fillSelect('f-product', products, colFilters.product, 'Każdy produkt');
  const channels = [...new Set(M.sales.map(s => s.channel).filter(Boolean))];
  fillSelect('f-sale-channel', channels, saleFilters.channel, 'Każdy kanał');
}

/* ============================================================
   Modal: karta
   ============================================================ */
function openCardModal(cardId, prefill) {
  editing.card = cardId || null;
  const c = cardId ? state.cards.find(x => x.id === cardId) : null;
  el('card-modal-title').textContent = c ? 'Edycja karty' : 'Nowa karta';
  el('cf-save-next').style.display = c ? 'none' : '';

  const src = c || Object.assign({
    player: '', team: '', product: '', brand: '', season: '', number: '', parallel: '', run: '', serial: '',
    rookie: false, auto: false, patch: false, condition: 'NM-MT', grade: null,
    acq: 'single', boxId: '', date: today(), price: '', currency: 'PLN', fx: '',
    shipping: '', fees: '', customs: '', source: '', notes: ''
  }, prefill || {});

  setVal('cf-player', src.player); setVal('cf-team', src.team); setVal('cf-product', src.product);
  setVal('cf-brand', src.brand); setVal('cf-season', src.season); setVal('cf-number', src.number);
  setVal('cf-parallel', src.parallel); setVal('cf-run', src.run); setVal('cf-serial', src.serial);
  setChecked('cf-rookie', src.rookie); setChecked('cf-auto', src.auto); setChecked('cf-patch', src.patch);
  setVal('cf-condition', src.condition || 'NM-MT');
  setVal('cf-grade-company', (src.grade && src.grade.company) || '');
  setVal('cf-grade-value', (src.grade && src.grade.value) || '');
  setVal('cf-grade-cert', (src.grade && src.grade.cert) || '');
  setVal('cf-acq', src.acq || 'single');
  setVal('cf-date', src.date || today());
  setVal('cf-price', src.price); setVal('cf-currency', src.currency || 'PLN');
  setVal('cf-fx', src.fx || (src.currency && src.currency !== 'PLN' ? settings.fx[src.currency] : ''));
  setVal('cf-shipping', src.shipping); setVal('cf-fees', src.fees); setVal('cf-customs', src.customs);
  setVal('cf-source', src.source); setVal('cf-notes', src.notes);

  const boxOptions = state.boxes.filter(b => b.status !== 'sold').map(b => ({ value: b.id, label: `${b.name} · ${fmtDate(b.date)}` }));
  fillSelect('cf-box', boxOptions, src.boxId, '— wybierz box —');

  const cur = M.byId.get(cardId);
  setVal('cf-market', cur && cur.hasValuation ? cur.marketValue.toFixed(2) : '');
  setVal('cf-market-date', cur && cur.lastValuationDate ? cur.lastValuationDate : today());
  const lastVal = cur && cur.valuations.length ? cur.valuations[cur.valuations.length - 1] : null;
  setVal('cf-market-source', lastVal ? lastVal.source : '');

  toggleBoxPicker();
  updateCardCalc();
  openModal('card-modal');
  setTimeout(() => el('cf-player').focus(), 60);
}

function toggleBoxPicker() {
  el('cf-box-wrap').style.display = getVal('cf-acq') === 'box' ? '' : 'none';
}

function updateCardCalc() {
  const currency = getVal('cf-currency');
  const fx = fxFor(currency, getVal('cf-fx'));
  const own = (num(getVal('cf-price')) + num(getVal('cf-shipping')) + num(getVal('cf-fees'))) * fx + num(getVal('cf-customs'));
  const acq = getVal('cf-acq');
  const existing = editing.card ? M.byId.get(editing.card) : null;
  const basis = acq === 'box' ? (existing ? existing.basis : 0) : own;
  const market = num(getVal('cf-market'));
  const pnl = market > 0 ? market - basis : null;
  el('cf-calc').innerHTML = `
    <div class="cell"><div class="k">${acq === 'box' ? 'Koszt z alokacji boxa' : 'Koszt nabycia'}</div><div class="v">${fmtPLN(basis)}</div>${acq === 'box' && !existing ? '<div class="k" style="text-transform:none;letter-spacing:0;font-weight:500;margin-top:2px">policzy się po zapisie</div>' : ''}</div>
    <div class="cell"><div class="k">Kurs</div><div class="v">${currency === 'PLN' ? '1,00' : fx.toFixed(4)}</div></div>
    <div class="cell"><div class="k">Wycena</div><div class="v">${market > 0 ? fmtPLN(market) : '—'}</div></div>
    <div class="cell"><div class="k">P&L na papierze</div><div class="v ${pnl == null ? '' : posClass(pnl)}">${pnl == null ? '—' : fmtPLN(pnl, true)}</div></div>
    <div class="cell"><div class="k">ROI</div><div class="v ${pnl == null ? '' : posClass(pnl)}">${pnl == null || basis <= 0 ? '—' : fmtPct(pnl / basis * 100)}</div></div>`;
}

function readCardForm() {
  const player = getVal('cf-player').trim();
  if (!player) { toast('Podaj przynajmniej zawodnika', 'err'); return null; }
  const acq = getVal('cf-acq');
  if (acq === 'box' && !getVal('cf-box')) { toast('Wybierz box, z którego pochodzi karta', 'err'); return null; }
  const company = getVal('cf-grade-company');
  return {
    player,
    team: getVal('cf-team').trim(),
    product: getVal('cf-product').trim(),
    brand: getVal('cf-brand').trim(),
    season: getVal('cf-season').trim(),
    number: getVal('cf-number').trim(),
    parallel: getVal('cf-parallel').trim(),
    run: getVal('cf-run').trim(),
    serial: getVal('cf-serial').trim(),
    rookie: isChecked('cf-rookie'),
    auto: isChecked('cf-auto'),
    patch: isChecked('cf-patch'),
    condition: getVal('cf-condition'),
    grade: company ? { company, value: getVal('cf-grade-value').trim(), cert: getVal('cf-grade-cert').trim() } : null,
    acq,
    boxId: acq === 'box' ? getVal('cf-box') : '',
    date: getVal('cf-date') || today(),
    price: num(getVal('cf-price')),
    currency: getVal('cf-currency'),
    fx: numOrNull(getVal('cf-fx')),
    shipping: num(getVal('cf-shipping')),
    fees: num(getVal('cf-fees')),
    customs: num(getVal('cf-customs')),
    source: getVal('cf-source').trim(),
    notes: getVal('cf-notes').trim()
  };
}

function upsertValuation(cardId, date, value, source) {
  if (value === null || !Number.isFinite(value)) return;
  const d = date || today();
  const found = state.valuations.find(v => v.cardId === cardId && v.date === d);
  if (found) { found.value = value; found.source = source || found.source; }
  else state.valuations.push({ id: uid('val'), cardId, date: d, value, source: source || '' });
}

function saveCard(addAnother) {
  const data = readCardForm();
  if (!data) return;
  let id = editing.card;
  if (id) {
    const idx = state.cards.findIndex(c => c.id === id);
    state.cards[idx] = { ...state.cards[idx], ...data };
  } else {
    id = uid('card');
    state.cards.push({ id, status: 'held', createdAt: new Date().toISOString(), ...data });
  }
  const market = numOrNull(getVal('cf-market'));
  if (market !== null && market > 0) upsertValuation(id, getVal('cf-market-date') || data.date, market, getVal('cf-market-source'));
  if (data.boxId) reallocateBox(data.boxId);

  saveState();
  renderAll();
  toast(editing.card ? 'Karta zaktualizowana' : 'Karta dodana', 'ok');
  if (addAnother) {
    editing.card = null;
    ['cf-player', 'cf-number', 'cf-serial', 'cf-market', 'cf-notes'].forEach(f => setVal(f, ''));
    setChecked('cf-rookie', false); setChecked('cf-auto', false); setChecked('cf-patch', false);
    updateCardCalc();
    el('cf-player').focus();
  } else {
    closeModal('card-modal');
  }
}

function deleteCard(id) {
  const c = state.cards.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`Usunąć „${cardTitle(c)}"? Znikną też jej wyceny.`)) return;
  state.cards = state.cards.filter(x => x.id !== id);
  state.valuations = state.valuations.filter(v => v.cardId !== id);
  state.gradings.forEach(g => { g.cardIds = (g.cardIds || []).filter(x => x !== id); });
  if (c.boxId) reallocateBox(c.boxId);
  saveState();
  renderAll();
  closeDrawer();
  toast('Karta usunięta');
}

/* ============================================================
   Modal: box
   ============================================================ */
function openBoxModal(boxId) {
  editing.box = boxId || null;
  const b = boxId ? state.boxes.find(x => x.id === boxId) : null;
  el('box-modal-title').textContent = b ? 'Edycja boxa' : 'Nowy box';
  const src = b || {
    name: '', brand: '', season: '', format: 'hobby', purpose: 'rip',
    date: today(), price: '', qty: 1, currency: 'PLN', fx: '', shipping: '', customs: '', fees: '', source: '', notes: ''
  };
  setVal('bf-name', src.name); setVal('bf-brand', src.brand); setVal('bf-season', src.season);
  setVal('bf-format', src.format || 'hobby'); setVal('bf-purpose', src.purpose || 'rip');
  setVal('bf-date', src.date || today()); setVal('bf-price', src.price);
  setVal('bf-qty', b ? 1 : 1);
  setVal('bf-currency', src.currency || 'PLN');
  setVal('bf-fx', src.fx || (src.currency && src.currency !== 'PLN' ? settings.fx[src.currency] : ''));
  setVal('bf-shipping', src.shipping); setVal('bf-customs', src.customs); setVal('bf-fees', src.fees);
  setVal('bf-source', src.source); setVal('bf-notes', src.notes);
  el('bf-qty').closest('.ff').style.display = b ? 'none' : '';
  updateBoxCalc();
  openModal('box-modal');
  setTimeout(() => el('bf-name').focus(), 60);
}

function updateBoxCalc() {
  const currency = getVal('bf-currency');
  const fx = fxFor(currency, getVal('bf-fx'));
  const qty = Math.max(1, Math.round(num(getVal('bf-qty')) || 1));
  const landed = (num(getVal('bf-price')) + num(getVal('bf-shipping')) + num(getVal('bf-fees'))) * fx + num(getVal('bf-customs'));
  el('bf-calc').innerHTML = `
    <div class="cell"><div class="k">Koszt boxa</div><div class="v">${fmtPLN(landed)}</div></div>
    <div class="cell"><div class="k">Kurs</div><div class="v">${currency === 'PLN' ? '1,00' : fx.toFixed(4)}</div></div>
    <div class="cell"><div class="k">Sztuk</div><div class="v">${qty}</div></div>
    <div class="cell"><div class="k">Razem</div><div class="v">${fmtPLN(landed * qty)}</div></div>
    <div class="cell"><div class="k">Próg opłacalności</div><div class="v warn">${fmtPLN(landed)}</div></div>`;
}

function saveBox() {
  const name = getVal('bf-name').trim();
  if (!name) { toast('Podaj nazwę produktu', 'err'); return; }
  const data = {
    name,
    brand: getVal('bf-brand').trim(),
    season: getVal('bf-season').trim(),
    format: getVal('bf-format'),
    purpose: getVal('bf-purpose'),
    date: getVal('bf-date') || today(),
    price: num(getVal('bf-price')),
    currency: getVal('bf-currency'),
    fx: numOrNull(getVal('bf-fx')),
    shipping: num(getVal('bf-shipping')),
    customs: num(getVal('bf-customs')),
    fees: num(getVal('bf-fees')),
    source: getVal('bf-source').trim(),
    notes: getVal('bf-notes').trim()
  };
  if (editing.box) {
    const idx = state.boxes.findIndex(b => b.id === editing.box);
    state.boxes[idx] = { ...state.boxes[idx], ...data };
    reallocateBox(editing.box);
    toast('Box zaktualizowany', 'ok');
  } else {
    const qty = Math.max(1, Math.round(num(getVal('bf-qty')) || 1));
    for (let i = 0; i < qty; i++) {
      state.boxes.push({ id: uid('box'), status: 'sealed', bulkValue: 0, createdAt: new Date().toISOString(), ...data });
    }
    toast(qty > 1 ? `Dodano ${nBoxes(qty)}` : 'Box dodany', 'ok');
  }
  saveState();
  renderAll();
  closeModal('box-modal');
}

function deleteBox(id) {
  const b = state.boxes.find(x => x.id === id);
  if (!b) return;
  const pulls = state.cards.filter(c => c.boxId === id);
  const msg = pulls.length
    ? `Usunąć „${b.name}"? ${nCards(pulls.length)} z tego boxa straci powiązanie i zostanie w kolekcji z zerowym kosztem.`
    : `Usunąć „${b.name}"?`;
  if (!confirm(msg)) return;
  state.boxes = state.boxes.filter(x => x.id !== id);
  state.cards.forEach(c => { if (c.boxId === id) { c.boxId = ''; c.acq = 'single'; delete c.allocCost; } });
  saveState();
  renderAll();
  toast('Box usunięty');
}

/* ============================================================
   Modal: otwarcie boxa (break)
   ============================================================ */
function openBreakModal(boxId) {
  const candidates = state.boxes.filter(b => b.status === 'sealed' || b.id === boxId);
  if (!candidates.length) { toast('Brak boxów do otwarcia — dodaj najpierw sealed', 'err'); return; }
  const options = candidates.map(b => ({ value: b.id, label: `${b.name} · ${fmtDate(b.date)} · ${fmtPLN0(boxLanded(b))}` }));
  fillSelect('of-box', options, boxId || candidates[0].id);
  const box = state.boxes.find(b => b.id === (boxId || candidates[0].id));
  setVal('of-date', (box && box.openedDate) || today());
  setVal('of-bulk', box ? (box.bulkValue || '') : '');
  setVal('of-note', box ? (box.breakNote || '') : '');
  renderPullRows();
  updateBreakCalc();
  openModal('open-modal');
}

function renderPullRows() {
  const boxId = getVal('of-box');
  const box = state.boxes.find(b => b.id === boxId);
  const existing = state.cards.filter(c => c.boxId === boxId);
  const wrap = el('of-pulls');
  wrap.innerHTML = '';
  const soldOnes = existing.filter(c => c.sale);
  if (soldOnes.length) {
    const note = document.createElement('div');
    note.className = 'cd-note';
    note.style.marginBottom = '8px';
    note.innerHTML = `<strong>Sprzedane z tego boxa (nie da się edytować tutaj):</strong> `
      + soldOnes.map(c => `${esc(cardTitle(c))} — ${fmtPLN0(saleNet(c.sale))}`).join(', ');
    wrap.appendChild(note);
  }
  const editable = existing.filter(c => !c.sale);
  if (editable.length) editable.forEach(c => wrap.appendChild(pullRow(c, box)));
  else { wrap.appendChild(pullRow(null, box)); wrap.appendChild(pullRow(null, box)); }
}

function pullRow(card, box) {
  const row = document.createElement('div');
  row.className = 'ff-grid cols-4 pull-row';
  row.style.marginBottom = '8px';
  row.dataset.cardId = card ? card.id : '';
  const mv = card ? (M.byId.get(card.id) || {}).marketValue : '';
  row.innerHTML = `
    <div class="ff span-2"><label>Zawodnik</label><input class="p-player" list="dl-players" value="${esc(card ? card.player : '')}" placeholder="np. Vinícius Júnior" /></div>
    <div class="ff"><label>Parallel</label><input class="p-parallel" list="dl-parallels" value="${esc(card ? card.parallel : '')}" placeholder="np. Gold /50" /></div>
    <div class="ff"><label>Nakład</label><input class="p-run" inputmode="numeric" value="${esc(card ? card.run : '')}" placeholder="/X" /></div>
    <div class="ff"><label>Wartość dziś (zł)</label><input class="p-value" inputmode="decimal" value="${card && mv ? Number(mv).toFixed(2) : ''}" placeholder="0,00" /></div>
    <div class="ff"><label>Produkt</label><input class="p-product" list="dl-products" value="${esc(card ? card.product : (box ? box.name : ''))}" /></div>
    <div class="ff span-2" style="align-self:end">
      <div class="cd-check-row">
        <label class="cd-check rc${card && card.rookie ? ' on' : ''}"><input type="checkbox" class="p-rookie"${card && card.rookie ? ' checked' : ''} />RC</label>
        <label class="cd-check auto${card && card.auto ? ' on' : ''}"><input type="checkbox" class="p-auto"${card && card.auto ? ' checked' : ''} />AUTO</label>
        <label class="cd-check patch${card && card.patch ? ' on' : ''}"><input type="checkbox" class="p-patch"${card && card.patch ? ' checked' : ''} />PATCH</label>
        <button class="row-btn danger" type="button" title="Usuń wiersz" onclick="this.closest('.pull-row').remove();updateBreakCalc()"><span class="material-symbols-outlined">delete</span></button>
      </div>
    </div>`;
  return row;
}

function readPullRows() {
  return [...document.querySelectorAll('#of-pulls .pull-row')].map(row => ({
    cardId: row.dataset.cardId || null,
    player: row.querySelector('.p-player').value.trim(),
    parallel: row.querySelector('.p-parallel').value.trim(),
    run: row.querySelector('.p-run').value.trim(),
    product: row.querySelector('.p-product').value.trim(),
    value: num(row.querySelector('.p-value').value),
    rookie: row.querySelector('.p-rookie').checked,
    auto: row.querySelector('.p-auto').checked,
    patch: row.querySelector('.p-patch').checked
  })).filter(p => p.player);
}

function updateBreakCalc() {
  const box = state.boxes.find(b => b.id === getVal('of-box'));
  if (!box) { el('of-calc').innerHTML = ''; return; }
  const landed = boxLanded(box);
  const pulls = readPullRows();
  const soldValue = sum(state.cards.filter(c => c.boxId === box.id && c.sale), c => saleNet(c.sale));
  const ret = sum(pulls, p => p.value) + num(getVal('of-bulk')) + soldValue;
  const pnl = ret - landed;
  el('of-calc').innerHTML = `
    <div class="cell"><div class="k">Koszt boxa</div><div class="v">${fmtPLN(landed)}</div></div>
    <div class="cell"><div class="k">Kart wpisanych</div><div class="v">${pulls.length}</div></div>
    <div class="cell"><div class="k">Zwrot</div><div class="v">${fmtPLN(ret)}</div></div>
    <div class="cell"><div class="k">Wynik breaka</div><div class="v ${posClass(pnl)}">${fmtPLN(pnl, true)}</div></div>
    <div class="cell"><div class="k">Mnożnik</div><div class="v ${posClass(pnl)}">${landed > 0 ? (ret / landed).toFixed(2) + '×' : '—'}</div></div>`;
}

function saveBreak() {
  const boxId = getVal('of-box');
  const box = state.boxes.find(b => b.id === boxId);
  if (!box) { toast('Wybierz box', 'err'); return; }
  const openedDate = getVal('of-date') || today();
  const pulls = readPullRows();

  const keepIds = new Set(pulls.map(p => p.cardId).filter(Boolean));
  // Karty odpięte z formularza znikają — poza sprzedanymi, których nie ruszamy.
  const removed = state.cards.filter(c => c.boxId === boxId && !c.sale && !keepIds.has(c.id));
  for (const c of removed) {
    state.cards = state.cards.filter(x => x.id !== c.id);
    state.valuations = state.valuations.filter(v => v.cardId !== c.id);
  }

  for (const p of pulls) {
    const payload = {
      player: p.player, parallel: p.parallel, run: p.run, product: p.product || box.name,
      brand: box.brand, season: box.season, rookie: p.rookie, auto: p.auto, patch: p.patch,
      acq: 'box', boxId, date: openedDate, price: 0, currency: 'PLN', shipping: 0, fees: 0, customs: 0,
      source: box.name
    };
    let id = p.cardId;
    if (id && state.cards.some(c => c.id === id)) {
      const idx = state.cards.findIndex(c => c.id === id);
      state.cards[idx] = { ...state.cards[idx], ...payload };
    } else {
      id = uid('card');
      state.cards.push({ id, status: 'held', condition: 'NM-MT', grade: null, createdAt: new Date().toISOString(), ...payload });
    }
    if (p.value > 0) upsertValuation(id, openedDate, p.value, 'Break');
  }

  box.status = 'opened';
  box.openedDate = openedDate;
  box.bulkValue = num(getVal('of-bulk'));
  box.breakNote = getVal('of-note').trim();
  reallocateBox(boxId);

  saveState();
  renderAll();
  closeModal('open-modal');
  const b = compute().boxes.find(x => x.id === boxId);
  toast(`Break zamknięty: ${fmtPLN0(b.pnl, true)} (${b.multiple ? b.multiple.toFixed(2) + '×' : '—'})`, b.pnl >= 0 ? 'ok' : 'err');
}

/* ============================================================
   Modal: sprzedaż
   ============================================================ */
function openSell(kind, id) {
  editing.sellTarget = kind && id ? { kind, id } : null;
  const options = [
    ...M.held.map(c => ({ value: `card:${c.id}`, label: `${cardTitle(c)} · wycena ${fmtPLN0(c.marketValue)}` })),
    ...M.sealed.map(b => ({ value: `box:${b.id}`, label: `[SEALED] ${b.name} · koszt ${fmtPLN0(b.landed)}` }))
  ];
  if (!options.length) { toast('Nie ma czego sprzedać', 'err'); return; }
  fillSelect('sf-item', options, editing.sellTarget ? `${kind}:${id}` : options[0].value);
  el('sell-modal-title').textContent = 'Sprzedaż';
  setVal('sf-date', today());
  setVal('sf-currency', 'PLN');
  setVal('sf-fx', '');
  setVal('sf-fee-abs', ''); setVal('sf-shipping', ''); setVal('sf-shipping-in', ''); setVal('sf-note', '');
  fillSelect('sf-channel', settings.channels.map(c => c.name), settings.channels[0] && settings.channels[0].name);

  const sel = getVal('sf-item');
  const target = resolveSellTarget(sel);
  if (target) {
    setVal('sf-price', target.suggest ? target.suggest.toFixed(2) : '');
    if (target.kind === 'card' && target.card.listing) {
      setVal('sf-price', num(target.card.listing.price).toFixed(2));
      if (target.card.listing.channel) setVal('sf-channel', target.card.listing.channel);
    }
  }
  syncChannelFee();
  updateSellCalc();
  openModal('sell-modal');
}

function resolveSellTarget(value) {
  if (!value) return null;
  const [kind, id] = value.split(':');
  if (kind === 'card') {
    const card = M.byId.get(id);
    return card ? { kind, id, card, basis: card.basis, suggest: card.marketValue } : null;
  }
  const box = M.boxes.find(b => b.id === id);
  return box ? { kind, id, box, basis: box.landed, suggest: box.landed * 1.3 } : null;
}

function syncChannelFee() {
  const ch = settings.channels.find(c => c.name === getVal('sf-channel'));
  setVal('sf-fee-pct', ch ? ch.fee : 0);
}

function updateSellCalc() {
  const target = resolveSellTarget(getVal('sf-item'));
  const sale = readSaleForm();
  const net = saleNet(sale);
  const basis = target ? target.basis : 0;
  const pnl = net - basis;
  const gross = saleGross(sale);
  el('sf-calc').innerHTML = `
    <div class="cell"><div class="k">Brutto</div><div class="v">${fmtPLN(gross)}</div></div>
    <div class="cell"><div class="k">Koszty transakcji</div><div class="v neg">${fmtPLN(-saleFees(sale))}</div></div>
    <div class="cell"><div class="k">Netto do kieszeni</div><div class="v">${fmtPLN(net)}</div></div>
    <div class="cell"><div class="k">Baza kosztowa</div><div class="v">${fmtPLN(basis)}</div></div>
    <div class="cell"><div class="k">Wynik</div><div class="v ${posClass(pnl)}">${fmtPLN(pnl, true)}</div></div>
    <div class="cell"><div class="k">ROI</div><div class="v ${posClass(pnl)}">${basis > 0 ? fmtPct(pnl / basis * 100) : '—'}</div></div>`;
}

function readSaleForm() {
  return {
    date: getVal('sf-date') || today(),
    price: num(getVal('sf-price')),
    currency: getVal('sf-currency'),
    fx: numOrNull(getVal('sf-fx')),
    channel: getVal('sf-channel'),
    feePct: num(getVal('sf-fee-pct')),
    feeAbs: num(getVal('sf-fee-abs')),
    shippingOut: num(getVal('sf-shipping')),
    shippingIn: num(getVal('sf-shipping-in')),
    note: getVal('sf-note').trim()
  };
}

function saveSale() {
  const value = getVal('sf-item');
  const target = resolveSellTarget(value);
  if (!target) { toast('Wybierz pozycję', 'err'); return; }
  const sale = readSaleForm();
  if (sale.price <= 0) { toast('Podaj cenę sprzedaży', 'err'); return; }

  if (target.kind === 'card') {
    const card = state.cards.find(c => c.id === target.id);
    card.sale = sale;
    card.status = 'sold';
    card.listing = null;
  } else {
    const box = state.boxes.find(b => b.id === target.id);
    box.sale = sale;
    box.status = 'sold';
  }
  saveState();
  renderAll();
  closeModal('sell-modal');
  const net = saleNet(sale);
  const pnl = net - target.basis;
  toast(`Zaksięgowane: netto ${fmtPLN0(net)}, wynik ${fmtPLN0(pnl, true)}`, pnl >= 0 ? 'ok' : 'err');
}

/* ============================================================
   Modal: wystawienie
   ============================================================ */
function openListModal(cardId) {
  const card = M.byId.get(cardId);
  if (!card) return;
  editing.listTarget = cardId;
  const listing = card.listing || {};
  setVal('lf-price', listing.price ? num(listing.price).toFixed(2) : (card.marketValue ? card.marketValue.toFixed(2) : ''));
  setVal('lf-date', listing.date || today());
  fillSelect('lf-channel', settings.channels.map(c => c.name), listing.channel || (settings.channels[0] && settings.channels[0].name));
  el('lf-unlist').style.display = card.listing ? '' : 'none';
  updateListCalc();
  openModal('list-modal');
}

function updateListCalc() {
  const card = M.byId.get(editing.listTarget);
  if (!card) return;
  const price = num(getVal('lf-price'));
  const ch = settings.channels.find(c => c.name === getVal('lf-channel'));
  const fee = ch ? num(ch.fee) : 0;
  const net = price * (1 - fee / 100);
  const pnl = net - card.basis;
  const targetPrice = card.basis > 0 ? card.basis * (1 + settings.targetMargin / 100) / (1 - fee / 100) : 0;
  el('lf-calc').innerHTML = `
    <div class="cell"><div class="k">Prowizja kanału</div><div class="v">${fee.toFixed(1)}%</div></div>
    <div class="cell"><div class="k">Oczekiwane netto</div><div class="v">${fmtPLN(net)}</div></div>
    <div class="cell"><div class="k">Baza kosztowa</div><div class="v">${fmtPLN(card.basis)}</div></div>
    <div class="cell"><div class="k">Wynik</div><div class="v ${posClass(pnl)}">${fmtPLN(pnl, true)}</div></div>
    <div class="cell"><div class="k">Cena na cel ${settings.targetMargin}%</div><div class="v warn">${targetPrice > 0 ? fmtPLN(targetPrice) : '—'}</div></div>`;
}

function saveListing() {
  const card = state.cards.find(c => c.id === editing.listTarget);
  if (!card) return;
  const price = num(getVal('lf-price'));
  if (price <= 0) { toast('Podaj cenę wystawienia', 'err'); return; }
  card.listing = { price, date: getVal('lf-date') || today(), channel: getVal('lf-channel') };
  card.status = 'listed';
  saveState();
  renderAll();
  closeModal('list-modal');
  toast('Wystawione', 'ok');
}

function unlistCard(id) {
  const card = state.cards.find(c => c.id === (id || editing.listTarget));
  if (!card) return;
  card.listing = null;
  card.status = 'held';
  saveState();
  renderAll();
  closeModal('list-modal');
  toast('Zdjęte z aukcji');
}

/* ============================================================
   Modal: sesja wyceny
   ============================================================ */
function openValuation() {
  setVal('vf-date', today());
  setVal('vf-source', '');
  renderValuationRows();
  openModal('val-modal');
}

function valuationCandidates() {
  const mode = getVal('vf-filter') || 'stale';
  let list = M.held;
  if (mode === 'stale') list = list.filter(c => c.stale);
  if (mode === 'top') list = [...list].sort((a, b) => b.marketValue - a.marketValue).slice(0, 25);
  return [...list].sort((a, b) => b.marketValue - a.marketValue);
}

function renderValuationRows() {
  const list = valuationCandidates();
  const wrap = el('vf-list');
  if (!list.length) {
    wrap.innerHTML = `<div style="padding:18px">${emptyBox('update', 'Nic do wyceny', 'Przy tym filtrze nie ma kart. Przełącz na „Wszystkie na stanie", żeby zobaczyć całą kolekcję.')}</div>`;
    updateValuationCalc();
    return;
  }
  wrap.innerHTML = list.map(c => `
    <div class="cd-val-row" data-card-id="${c.id}">
      <div class="nm">
        <div class="cd-name">
          <span class="t">${esc(cardTitle(c))}</span>
          <span class="s">${esc(cardSubtitle(c) || '—')} · ${c.lastValuationDate ? `wycena ${fmtDate(c.lastValuationDate)}` : 'brak wyceny'}</span>
        </div>
      </div>
      <div class="old ${c.stale ? 'cd-val-stale' : ''}">${fmtPLN0(c.marketValue)}</div>
      <div class="inp"><input class="v-input" inputmode="decimal" placeholder="${c.marketValue.toFixed(0)}" /></div>
      <div class="delta">—</div>
    </div>`).join('');
  updateValuationCalc();
}

function updateValuationCalc() {
  const rows = [...document.querySelectorAll('#vf-list .cd-val-row')];
  let touched = 0, before = 0, after = 0;
  for (const row of rows) {
    const card = M.byId.get(row.dataset.cardId);
    if (!card) continue;
    const input = row.querySelector('.v-input');
    const raw = input.value.trim();
    const deltaEl = row.querySelector('.delta');
    before += card.marketValue;
    if (raw === '') {
      input.classList.remove('touched');
      deltaEl.textContent = '—';
      deltaEl.className = 'delta';
      after += card.marketValue;
      continue;
    }
    touched++;
    input.classList.add('touched');
    const v = num(raw);
    after += v;
    const d = v - card.marketValue;
    deltaEl.textContent = `${fmtPLN0(d, true)}${card.marketValue > 0 ? ` · ${fmtPct(d / card.marketValue * 100)}` : ''}`;
    deltaEl.className = 'delta ' + posClass(d);
  }
  const diff = after - before;
  el('vf-calc').innerHTML = `
    <div class="cell"><div class="k">Pozycji w sesji</div><div class="v">${rows.length}</div></div>
    <div class="cell"><div class="k">Uzupełnionych</div><div class="v">${touched}</div></div>
    <div class="cell"><div class="k">Wartość przed</div><div class="v">${fmtPLN0(before)}</div></div>
    <div class="cell"><div class="k">Wartość po</div><div class="v">${fmtPLN0(after)}</div></div>
    <div class="cell"><div class="k">Zmiana</div><div class="v ${posClass(diff)}">${fmtPLN0(diff, true)}</div></div>
    <div class="cell"><div class="k">Zmiana %</div><div class="v ${posClass(diff)}">${before > 0 ? fmtPct(diff / before * 100) : '—'}</div></div>`;
}

function saveValuationSession(carryAll) {
  const date = getVal('vf-date') || today();
  const source = getVal('vf-source').trim();
  const rows = [...document.querySelectorAll('#vf-list .cd-val-row')];
  let n = 0;
  for (const row of rows) {
    const card = M.byId.get(row.dataset.cardId);
    if (!card) continue;
    const raw = row.querySelector('.v-input').value.trim();
    if (raw === '') {
      if (carryAll) { upsertValuation(card.id, date, card.marketValue, source || 'Bez zmian'); n++; }
      continue;
    }
    upsertValuation(card.id, date, num(raw), source);
    n++;
  }
  if (!n) { toast('Nie wpisano żadnej wyceny', 'err'); return; }
  saveState();
  renderAll();
  closeModal('val-modal');
  toast(`Zapisano ${n} ${plural(n, 'wycenę', 'wyceny', 'wycen')}`, 'ok');
}

function quickValuation(cardId) {
  const card = M.byId.get(cardId);
  if (!card) return;
  const raw = prompt(`Nowa wartość rynkowa dla „${cardTitle(card)}" (zł)`, card.marketValue.toFixed(0));
  if (raw === null) return;
  const v = num(raw);
  if (v <= 0) { toast('Podaj dodatnią wartość', 'err'); return; }
  upsertValuation(cardId, today(), v, 'Szybka wycena');
  saveState();
  renderAll();
  if (el('card-drawer').classList.contains('on')) openCardDrawer(cardId);
  const d = v - card.marketValue;
  toast(`Wycena zapisana: ${fmtPLN0(v)} (${fmtPLN0(d, true)})`, d >= 0 ? 'ok' : '');
}

/* ============================================================
   Modal: grading
   ============================================================ */
function openGradingModal() {
  const eligible = M.held.filter(c => !(c.grade && c.grade.company) && c.status !== 'grading');
  if (!eligible.length) { toast('Brak surowych kart do wysłania', 'err'); return; }
  setVal('gf-company', 'PSA'); setVal('gf-tier', ''); setVal('gf-date', today());
  setVal('gf-fee', '120'); setVal('gf-shipping', '150'); setVal('gf-extra', '');
  el('gf-cards').innerHTML = eligible.map(c => `
    <label style="display:flex;align-items:center;gap:8px;padding:5px 4px;font-size:12.5px;cursor:pointer">
      <input type="checkbox" class="g-card" value="${c.id}" />
      <span style="flex:1">${esc(cardTitle(c))} <span class="cd-muted">${esc(cardSubtitle(c) || '')}</span></span>
      <span class="cd-mono">${fmtPLN0(c.marketValue)}</span>
    </label>`).join('');
  updateGradingCalc();
  openModal('grading-modal');
}

function selectedGradingCards() {
  return [...document.querySelectorAll('#gf-cards .g-card:checked')].map(i => i.value);
}

function updateGradingCalc() {
  const ids = selectedGradingCards();
  const total = num(getVal('gf-fee')) * ids.length + num(getVal('gf-shipping')) + num(getVal('gf-extra'));
  const value = sum(ids.map(id => M.byId.get(id)).filter(Boolean), c => c.marketValue);
  el('gf-calc').innerHTML = `
    <div class="cell"><div class="k">Kart w wysyłce</div><div class="v">${ids.length}</div></div>
    <div class="cell"><div class="k">Koszt całkowity</div><div class="v">${fmtPLN(total)}</div></div>
    <div class="cell"><div class="k">Koszt na kartę</div><div class="v">${ids.length ? fmtPLN(total / ids.length) : '—'}</div></div>
    <div class="cell"><div class="k">Wartość raw</div><div class="v">${fmtPLN(value)}</div></div>
    <div class="cell"><div class="k">Koszt vs wartość</div><div class="v ${value > 0 && total / value > 0.5 ? 'warn' : ''}">${value > 0 ? fmtPct(total / value * 100, false) : '—'}</div></div>`;
}

function saveGrading() {
  const ids = selectedGradingCards();
  if (!ids.length) { toast('Zaznacz przynajmniej jedną kartę', 'err'); return; }
  const before = {};
  for (const id of ids) { const c = M.byId.get(id); if (c) before[id] = c.marketValue; }
  state.gradings.push({
    id: uid('grad'),
    company: getVal('gf-company'),
    tier: getVal('gf-tier').trim(),
    date: getVal('gf-date') || today(),
    feePerCard: num(getVal('gf-fee')),
    shipping: num(getVal('gf-shipping')),
    extra: num(getVal('gf-extra')),
    cardIds: ids,
    before,
    status: 'sent'
  });
  ids.forEach(id => { const c = state.cards.find(x => x.id === id); if (c) c.status = 'grading'; });
  saveState();
  renderAll();
  closeModal('grading-modal');
  toast(`Wysyłka zapisana — ${nCards(ids.length)}`, 'ok');
}

function openGradingReturn(gradingId) {
  editing.grading = gradingId;
  const g = M.gradings.find(x => x.id === gradingId);
  if (!g) return;
  setVal('grf-date', today());
  setVal('grf-source', '');
  el('grf-list').innerHTML = g.items.map(c => `
    <div class="ff-grid cols-3 grf-row" data-card-id="${c.id}" style="margin-bottom:8px">
      <div class="ff"><label>${esc(cardTitle(c))}</label><input value="${esc(cardSubtitle(c) || '')}" disabled /></div>
      <div class="ff"><label>Ocena ${esc(g.company)}</label><input class="grf-grade" inputmode="decimal" placeholder="np. 9.5" /></div>
      <div class="ff"><label>Wartość po gradingu (zł)</label><input class="grf-value" inputmode="decimal" placeholder="${c.marketValue.toFixed(0)}" /></div>
    </div>`).join('');
  openModal('grading-return-modal');
}

function saveGradingReturn() {
  const g = state.gradings.find(x => x.id === editing.grading);
  if (!g) return;
  const date = getVal('grf-date') || today();
  const source = getVal('grf-source').trim() || 'Po gradingu';
  for (const row of document.querySelectorAll('#grf-list .grf-row')) {
    const id = row.dataset.cardId;
    const card = state.cards.find(c => c.id === id);
    if (!card) continue;
    const grade = row.querySelector('.grf-grade').value.trim();
    const value = numOrNull(row.querySelector('.grf-value').value);
    if (grade) card.grade = { company: g.company, value: grade, cert: (card.grade && card.grade.cert) || '' };
    if (card.status === 'grading') card.status = 'held';
    if (value !== null && value > 0) upsertValuation(id, date, value, source);
  }
  g.status = 'returned';
  g.returnedDate = date;
  saveState();
  renderAll();
  closeModal('grading-return-modal');
  const fresh = compute().gradings.find(x => x.id === g.id);
  toast(`Powrót zapisany — wynik ${fmtPLN0(fresh.pnl, true)}`, (fresh.pnl || 0) >= 0 ? 'ok' : 'err');
}

function deleteGrading(id) {
  const g = state.gradings.find(x => x.id === id);
  if (!g) return;
  if (!confirm('Usunąć tę wysyłkę? Koszt gradingu zniknie z bazy kosztowej kart.')) return;
  (g.cardIds || []).forEach(cid => { const c = state.cards.find(x => x.id === cid); if (c && c.status === 'grading') c.status = 'held'; });
  state.gradings = state.gradings.filter(x => x.id !== id);
  saveState();
  renderAll();
  toast('Wysyłka usunięta');
}

/* ============================================================
   Modal: koszty i watchlista
   ============================================================ */
function openExpenseModal(id) {
  editing.expense = id || null;
  const e = id ? state.expenses.find(x => x.id === id) : null;
  el('expense-modal-title').textContent = e ? 'Edycja kosztu' : 'Koszt ogólny';
  setVal('ef-date', e ? e.date : today());
  setVal('ef-category', e ? e.category : 'supplies');
  setVal('ef-amount', e ? e.amount : '');
  setVal('ef-recurring', e ? (e.recurring || 'no') : 'no');
  setVal('ef-note', e ? e.note : '');
  openModal('expense-modal');
}

function saveExpense() {
  const amount = num(getVal('ef-amount'));
  if (amount <= 0) { toast('Podaj kwotę', 'err'); return; }
  const data = {
    date: getVal('ef-date') || today(),
    category: getVal('ef-category'),
    amount,
    recurring: getVal('ef-recurring'),
    note: getVal('ef-note').trim()
  };
  if (editing.expense) {
    const idx = state.expenses.findIndex(x => x.id === editing.expense);
    state.expenses[idx] = { ...state.expenses[idx], ...data };
  } else {
    state.expenses.push({ id: uid('exp'), ...data });
  }
  saveState();
  renderAll();
  closeModal('expense-modal');
  toast('Koszt zapisany', 'ok');
}

function deleteExpense(id) {
  if (!confirm('Usunąć ten koszt?')) return;
  state.expenses = state.expenses.filter(x => x.id !== id);
  saveState();
  renderAll();
  toast('Koszt usunięty');
}

function openWatchModal(id) {
  editing.watch = id || null;
  const w = id ? state.watchlist.find(x => x.id === id) : null;
  el('watch-modal-title').textContent = w ? 'Edycja celu' : 'Cel zakupowy';
  setVal('wf-name', w ? w.name : '');
  setVal('wf-product', w ? w.product : '');
  setVal('wf-target', w ? w.target : '');
  setVal('wf-market', w ? w.market : '');
  setVal('wf-priority', w ? w.priority : 'mid');
  setVal('wf-budget', w ? w.budget : '');
  setVal('wf-note', w ? w.note : '');
  openModal('watch-modal');
}

function saveWatch() {
  const name = getVal('wf-name').trim();
  if (!name) { toast('Podaj nazwę karty', 'err'); return; }
  const data = {
    name,
    product: getVal('wf-product').trim(),
    target: num(getVal('wf-target')),
    market: num(getVal('wf-market')),
    priority: getVal('wf-priority'),
    budget: num(getVal('wf-budget')),
    note: getVal('wf-note').trim()
  };
  if (editing.watch) {
    const idx = state.watchlist.findIndex(x => x.id === editing.watch);
    state.watchlist[idx] = { ...state.watchlist[idx], ...data };
  } else {
    state.watchlist.push({ id: uid('watch'), ...data });
  }
  saveState();
  renderAll();
  closeModal('watch-modal');
  toast('Zapisane', 'ok');
}

function deleteWatch(id) {
  if (!confirm('Usunąć pozycję z watchlisty?')) return;
  state.watchlist = state.watchlist.filter(x => x.id !== id);
  saveState();
  renderAll();
  toast('Usunięte');
}

/* ============================================================
   Modal: import
   ============================================================ */
function openImportModal() {
  setVal('imf-data', '');
  el('imf-preview').innerHTML = '';
  fillSelect('imf-box', state.boxes.filter(b => b.status !== 'sold').map(b => ({ value: b.id, label: `${b.name} · ${fmtDate(b.date)}` })), '', '— bez boxa (single) —');
  openModal('import-modal');
}

function parseImport() {
  const raw = getVal('imf-data');
  const rows = [];
  const errors = [];
  raw.split('\n').map(l => l.trim()).filter(Boolean).forEach((line, i) => {
    const parts = line.split(';').map(p => p.trim());
    if (!parts[0]) { errors.push(`Linia ${i + 1}: brak zawodnika`); return; }
    const date = parts[6] || '';
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) { errors.push(`Linia ${i + 1}: data musi być w formacie RRRR-MM-DD`); return; }
    rows.push({
      player: parts[0],
      product: parts[1] || '',
      parallel: parts[2] || '',
      run: parts[3] || '',
      price: num(parts[4]),
      market: num(parts[5]),
      date: date || today()
    });
  });
  return { rows, errors };
}

function previewImport() {
  const { rows, errors } = parseImport();
  const wrap = el('imf-preview');
  if (!rows.length && !errors.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `
    ${errors.length ? `<div class="cd-alert bad" style="margin-bottom:8px"><span class="material-symbols-outlined">error</span><span>${errors.map(esc).join('<br>')}</span></div>` : ''}
    ${rows.length ? `<div class="cd-calc-strip" style="margin-bottom:8px">
      <div class="cell"><div class="k">Kart do dodania</div><div class="v">${rows.length}</div></div>
      <div class="cell"><div class="k">Koszt</div><div class="v">${fmtPLN(sum(rows, r => r.price))}</div></div>
      <div class="cell"><div class="k">Wycena</div><div class="v">${fmtPLN(sum(rows, r => r.market))}</div></div>
      <div class="cell"><div class="k">Wynik</div><div class="v ${posClass(sum(rows, r => r.market) - sum(rows, r => r.price))}">${fmtPLN(sum(rows, r => r.market) - sum(rows, r => r.price), true)}</div></div>
    </div>
    <div class="tc-tbl-wrap"><table class="tc-tbl"><thead><tr><th>Zawodnik</th><th>Produkt</th><th>Parallel</th><th class="num">Nakład</th><th class="num">Cena</th><th class="num">Wycena</th><th>Data</th></tr></thead>
    <tbody>${rows.slice(0, 20).map(r => `<tr><td>${esc(r.player)}</td><td>${esc(r.product || '—')}</td><td>${esc(r.parallel || '—')}</td><td class="num">${esc(r.run || '—')}</td><td class="num">${fmtPLN0(r.price)}</td><td class="num">${fmtPLN0(r.market)}</td><td class="cd-mono">${fmtDate(r.date)}</td></tr>`).join('')}</tbody></table></div>
    ${rows.length > 20 ? `<div class="cd-count" style="margin-top:6px">…i jeszcze ${rows.length - 20}</div>` : ''}` : ''}`;
}

function runImport() {
  const { rows, errors } = parseImport();
  if (errors.length) { previewImport(); toast('Popraw błędy przed importem', 'err'); return; }
  if (!rows.length) { toast('Nie ma czego importować', 'err'); return; }
  const boxId = getVal('imf-box');
  for (const r of rows) {
    const id = uid('card');
    state.cards.push({
      id, status: 'held', createdAt: new Date().toISOString(),
      player: r.player, product: r.product, parallel: r.parallel, run: r.run,
      team: '', brand: '', season: '', number: '', serial: '',
      rookie: false, auto: false, patch: false, condition: 'NM-MT', grade: null,
      acq: boxId ? 'box' : 'single', boxId: boxId || '',
      date: r.date, price: boxId ? 0 : r.price, currency: 'PLN', fx: null,
      shipping: 0, fees: 0, customs: 0, source: boxId ? '' : 'Import', notes: ''
    });
    if (r.market > 0) upsertValuation(id, r.date, r.market, 'Import');
  }
  if (boxId) reallocateBox(boxId);
  saveState();
  renderAll();
  closeModal('import-modal');
  toast(`Zaimportowano ${nCards(rows.length)}`, 'ok');
}

/* ============================================================
   Modal: ustawienia
   ============================================================ */
function openSettingsModal() {
  setVal('sf-eur', settings.fx.EUR); setVal('sf-usd', settings.fx.USD); setVal('sf-gbp', settings.fx.GBP);
  el('sf-fx-info').textContent = settings.fxUpdated ? `ostatnia aktualizacja: ${settings.fxUpdated}` : 'kursy wpisane ręcznie';
  setVal('sf-alloc', settings.alloc);
  setVal('sf-bulk-offset', settings.bulkOffset);
  setVal('sf-val-days', settings.valDays);
  setVal('sf-aging', settings.agingDays);
  setVal('sf-listing-days', settings.listingDays);
  setVal('sf-sealed-days', settings.sealedDays);
  setVal('sf-target-margin', settings.targetMargin);
  setVal('sf-conc', settings.concAlert);
  renderChannelEditor();
  openModal('settings-modal');
}

function renderChannelEditor() {
  el('sf-channels').innerHTML = settings.channels.map((c, i) => `
    <div class="ff-grid cols-3 ch-row" style="margin-bottom:6px" data-i="${i}">
      <div class="ff span-2"><input class="ch-name" value="${esc(c.name)}" placeholder="Nazwa kanału" /></div>
      <div class="ff" style="display:flex;gap:6px;align-items:center">
        <input class="ch-fee" inputmode="decimal" value="${esc(c.fee)}" placeholder="% prowizji" />
        <button class="row-btn danger" type="button" onclick="removeChannel(${i})"><span class="material-symbols-outlined">delete</span></button>
      </div>
    </div>`).join('');
}

function readChannelEditor() {
  return [...document.querySelectorAll('#sf-channels .ch-row')]
    .map(r => ({ name: r.querySelector('.ch-name').value.trim(), fee: num(r.querySelector('.ch-fee').value) }))
    .filter(c => c.name);
}

function removeChannel(i) {
  settings.channels = readChannelEditor();
  settings.channels.splice(i, 1);
  renderChannelEditor();
}

function addChannel() {
  settings.channels = readChannelEditor();
  settings.channels.push({ name: '', fee: 0 });
  renderChannelEditor();
}

function saveSettings() {
  settings.fx.EUR = num(getVal('sf-eur')) || settings.fx.EUR;
  settings.fx.USD = num(getVal('sf-usd')) || settings.fx.USD;
  settings.fx.GBP = num(getVal('sf-gbp')) || settings.fx.GBP;
  settings.alloc = getVal('sf-alloc');
  settings.bulkOffset = getVal('sf-bulk-offset');
  settings.valDays = Math.max(1, Math.round(num(getVal('sf-val-days')) || 30));
  settings.agingDays = Math.max(1, Math.round(num(getVal('sf-aging')) || 180));
  settings.listingDays = Math.max(1, Math.round(num(getVal('sf-listing-days')) || 60));
  settings.sealedDays = Math.max(1, Math.round(num(getVal('sf-sealed-days')) || 90));
  settings.targetMargin = Math.max(0, Math.round(num(getVal('sf-target-margin')) || 30));
  settings.concAlert = Math.max(1, Math.round(num(getVal('sf-conc')) || 25));
  const channels = readChannelEditor();
  if (channels.length) settings.channels = channels;
  reallocateAll();
  saveState();
  renderAll();
  closeModal('settings-modal');
  toast('Ustawienia zapisane', 'ok');
}

async function fetchNbpRates() {
  const info = el('sf-fx-info');
  info.textContent = 'pobieram…';
  try {
    const res = await fetch('https://api.nbp.pl/api/exchangerates/tables/A/?format=json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const table = data[0];
    const pick = code => (table.rates.find(r => r.code === code) || {}).mid;
    const eur = pick('EUR'), usd = pick('USD'), gbp = pick('GBP');
    if (eur) setVal('sf-eur', eur.toFixed(4));
    if (usd) setVal('sf-usd', usd.toFixed(4));
    if (gbp) setVal('sf-gbp', gbp.toFixed(4));
    settings.fxUpdated = table.effectiveDate;
    info.textContent = `tabela ${table.no} z ${table.effectiveDate}`;
    toast('Kursy pobrane z NBP', 'ok');
  } catch (e) {
    info.textContent = 'nie udało się pobrać — wpisz ręcznie';
    toast('NBP niedostępne: ' + e.message, 'err');
  }
}

/* ============================================================
   Szuflada ze szczegółami karty
   ============================================================ */
function openCardDrawer(cardId) {
  const c = M.byId.get(cardId);
  if (!c) return;
  el('dr-title').innerHTML = `${esc(cardTitle(c))} ${cardTags(c)}`;
  el('dr-sub').textContent = cardSubtitle(c) || 'brak opisu';

  const box = c.boxId ? M.boxes.find(b => b.id === c.boxId) : null;
  const value = c.sold ? c.net : c.marketValue;

  el('dr-body').innerHTML = `
    <div class="cd-kv">
      <div class="cell"><div class="k">Status</div><div class="v">${statusTag(c)}</div></div>
      <div class="cell"><div class="k">Grade</div><div class="v">${gradeBadge(c)}</div></div>
      <div class="cell"><div class="k">Baza kosztowa</div><div class="v mono">${fmtPLN(c.basis)}</div></div>
      <div class="cell"><div class="k">${c.sold ? 'Netto ze sprzedaży' : 'Wycena'}</div><div class="v mono">${fmtPLN(value)}</div></div>
      <div class="cell"><div class="k">Wynik</div><div class="v mono ${posClass(c.pnl)}">${fmtPLN(c.pnl, true)}</div></div>
      <div class="cell"><div class="k">ROI</div><div class="v mono ${posClass(c.roi)}">${fmtPct(c.roi)}</div></div>
      <div class="cell"><div class="k">${c.sold ? 'Czas do sprzedaży' : 'W kolekcji'}</div><div class="v mono">${c.daysHeld == null ? '—' : nDays(c.daysHeld)}</div></div>
      <div class="cell"><div class="k">Nabycie</div><div class="v">${ACQ_LABEL[c.acq] || '—'}</div></div>
    </div>

    ${!c.sold && c.daysHeld != null ? `<div class="cd-note">
      ${c.daysHeld >= 183
        ? '<strong>Poza PIT.</strong> Minęło ponad 6 miesięcy od nabycia — sprzedaż tej karty nie rodzi obowiązku podatkowego z tytułu sprzedaży rzeczy ruchomych.'
        : `<strong>Do progu 6 miesięcy: ${nDays(183 - c.daysHeld)}.</strong> Sprzedaż przed tą datą jest opodatkowana od dochodu (przychód minus udokumentowany koszt).`}
    </div>` : ''}

    <div>
      <div class="cd-section" style="margin:0 0 8px"><span class="ico"><span class="material-symbols-outlined">show_chart</span></span><h2>Historia wyceny</h2><span class="line"></span></div>
      ${c.valuations.length > 1
        ? '<div class="cd-hist-canvas"><canvas id="dr-chart"></canvas></div>'
        : '<div class="cd-note">Za mało punktów, żeby narysować wykres. Po drugiej sesji wyceny pojawi się tu krzywa wartości.</div>'}
    </div>

    <div>
      <div class="cd-section" style="margin:0 0 8px"><span class="ico"><span class="material-symbols-outlined">history</span></span><h2>Oś zdarzeń</h2><span class="line"></span></div>
      <div class="cd-timeline">${drawerTimeline(c, box)}</div>
    </div>

    ${c.notes ? `<div><div class="cd-section" style="margin:0 0 8px"><span class="ico"><span class="material-symbols-outlined">sticky_note_2</span></span><h2>Notatki</h2><span class="line"></span></div><div class="cd-note">${esc(c.notes)}</div></div>` : ''}`;

  el('dr-foot').innerHTML = `
    <button class="btn-small danger" onclick="deleteCard('${c.id}')"><span class="material-symbols-outlined">delete</span>Usuń</button>
    <button class="btn-small" onclick="openCardModal('${c.id}')"><span class="material-symbols-outlined">edit</span>Edytuj</button>
    ${c.sold ? '' : `<button class="btn-small" onclick="quickValuation('${c.id}')"><span class="material-symbols-outlined">update</span>Wycena</button>`}
    ${c.sold ? '' : `<button class="btn-small" onclick="openListModal('${c.id}')"><span class="material-symbols-outlined">storefront</span>${c.listing ? 'Zmień ofertę' : 'Wystaw'}</button>`}
    ${c.sold ? '' : `<button class="btn-small primary" onclick="openSell('card','${c.id}')"><span class="material-symbols-outlined">sell</span>Sprzedaj</button>`}`;

  el('card-drawer').classList.add('on');

  if (c.valuations.length > 1) {
    renderChart('dr-chart', {
      type: 'line',
      data: {
        labels: c.valuations.map(v => fmtDate(v.date)),
        datasets: [
          {
            label: 'Wycena', data: c.valuations.map(v => num(v.value)), borderColor: '#0057c0',
            backgroundColor: ctx => {
              const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 170);
              g.addColorStop(0, 'rgba(0,87,192,0.22)'); g.addColorStop(1, 'rgba(0,87,192,0)');
              return g;
            },
            fill: true, borderWidth: 2, tension: 0.25, pointRadius: 3
          },
          { label: 'Koszt', data: c.valuations.map(() => c.basis), borderColor: '#94a3b8', borderWidth: 1.4, borderDash: [5, 4], fill: false, pointRadius: 0 }
        ]
      },
      options: {
        maintainAspectRatio: false, responsive: true, animation: { duration: 200 },
        plugins: { legend: legendBottom(), tooltip: { ...TOOLTIP, displayColors: true, callbacks: { label: x => `${x.dataset.label}: ${fmtPLN(x.parsed.y)}` } } },
        scales: { x: axisCat(), y: axisPLN() }
      }
    });
  }
}

function drawerTimeline(c, box) {
  const items = [];
  if (c.date) {
    items.push([c.date, 'buy', c.acq === 'box' && box ? `Pull z boxa: ${esc(box.name)}` : `Zakup${c.source ? ` — ${esc(c.source)}` : ''}`, fmtPLN0(c.basis)]);
  }
  for (const v of c.valuations) items.push([v.date, 'val', `Wycena${v.source ? ` — ${esc(v.source)}` : ''}`, fmtPLN0(num(v.value))]);
  for (const g of M.gradings) {
    if (!(g.cardIds || []).includes(c.id)) continue;
    items.push([g.date, 'cost', `Wysyłka do ${esc(g.company)}${g.tier ? ` (${esc(g.tier)})` : ''}`, fmtPLN0(-(g.total / (g.cardIds.length || 1)))]);
    if (g.status === 'returned' && g.returnedDate) items.push([g.returnedDate, 'grade', `Powrót z gradingu${c.grade && c.grade.value ? ` — ocena ${esc(c.grade.value)}` : ''}`, '']);
  }
  if (c.listing) items.push([c.listing.date, 'val', `Wystawiona na ${esc(c.listing.channel || '—')}`, fmtPLN0(num(c.listing.price))]);
  if (c.sale) items.push([c.sale.date, 'sell', `Sprzedaż — ${esc(c.sale.channel || '—')}`, fmtPLN0(c.net)]);
  items.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (!items.length) return '<div class="cd-note">Brak zdarzeń.</div>';
  return items.map(([date, kind, text, value]) => `
    <div class="cd-timeline-item ${kind}">
      <span class="d">${fmtDate(date)}</span><span class="dot"></span>
      <span>${text}</span><span class="v">${value}</span>
    </div>`).join('');
}

function closeDrawer() { el('card-drawer').classList.remove('on'); }

/* ============================================================
   Eksport / import danych
   ============================================================ */
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(filename, content, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportCsv() {
  const head = [
    'id', 'zawodnik', 'klub', 'produkt', 'producent', 'sezon', 'nr', 'parallel', 'naklad', 'egzemplarz',
    'rookie', 'auto', 'patch', 'stan', 'firma_gradingowa', 'ocena', 'nabycie', 'box', 'data_nabycia',
    'cena', 'waluta', 'kurs', 'wysylka', 'prowizja', 'clo', 'koszt_gradingu', 'baza_kosztowa',
    'wycena', 'data_wyceny', 'status', 'data_sprzedazy', 'kanal_sprzedazy', 'cena_sprzedazy', 'netto_sprzedazy',
    'pnl', 'roi_proc', 'dni', 'zrodlo', 'notatki'
  ];
  const boxName = id => { const b = state.boxes.find(x => x.id === id); return b ? b.name : ''; };
  const rows = M.cards.map(c => [
    c.id, c.player, c.team, c.product, c.brand, c.season, c.number, c.parallel, c.run, c.serial,
    c.rookie ? 'tak' : 'nie', c.auto ? 'tak' : 'nie', c.patch ? 'tak' : 'nie', c.condition,
    c.grade ? c.grade.company : '', c.grade ? c.grade.value : '',
    ACQ_LABEL[c.acq] || c.acq, boxName(c.boxId), c.date,
    num(c.price).toFixed(2), c.currency, fxFor(c.currency, c.fx).toFixed(4),
    num(c.shipping).toFixed(2), num(c.fees).toFixed(2), num(c.customs).toFixed(2),
    c.gradingCost.toFixed(2), c.basis.toFixed(2),
    c.marketValue.toFixed(2), c.lastValuationDate || '',
    c.sold ? 'sprzedana' : (c.status || 'held'),
    c.sale ? c.sale.date : '', c.sale ? c.sale.channel : '',
    c.sale ? num(c.sale.price).toFixed(2) : '', c.sold ? c.net.toFixed(2) : '',
    c.pnl.toFixed(2), c.roi == null ? '' : c.roi.toFixed(1), c.daysHeld == null ? '' : c.daysHeld,
    c.source, c.notes
  ]);
  const csv = [head, ...rows].map(r => r.map(csvCell).join(';')).join('\n');
  download(`karty_kolekcja_${today()}.csv`, csv);
  toast('CSV pobrany', 'ok');
}

function exportJson() {
  download(`karty_backup_${today()}.json`, JSON.stringify(state, null, 2), 'application/json');
  toast('Backup pobrany', 'ok');
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data !== 'object') throw new Error('zły format');
      if (!confirm('Import nadpisze obecne dane modułu Karty. Kontynuować?')) return;
      localStorage.setItem(CARDS_KEY, JSON.stringify(data));
      loadState();
      renderAll();
      closeModal('settings-modal');
      toast('Dane wczytane', 'ok');
    } catch (e) {
      toast('Nie udało się wczytać pliku: ' + e.message, 'err');
    }
  };
  reader.readAsText(file);
}

function resetModule() {
  if (!confirm('Skasować wszystkie dane modułu Karty? Tej operacji nie da się cofnąć.')) return;
  if (!confirm('Na pewno? Znikną karty, boxy, wyceny, sprzedaże i koszty.')) return;
  localStorage.removeItem(CARDS_KEY);
  loadState();
  renderAll();
  closeModal('settings-modal');
  toast('Moduł wyczyszczony');
}

/* ============================================================
   Dane demo — do obejrzenia dashboardu przed pierwszym wpisem
   ============================================================ */
function loadDemo() {
  if (state.cards.length || state.boxes.length) {
    if (!confirm('Dane demo nadpiszą obecną zawartość modułu. Kontynuować?')) return;
  }
  const d = (monthsAgo, day = 12) => {
    const t = new Date();
    t.setMonth(t.getMonth() - monthsAgo);
    t.setDate(day);
    return t.toISOString().slice(0, 10);
  };

  const cards = [], boxes = [], valuations = [], expenses = [], gradings = [], watchlist = [];
  const addVal = (cardId, date, value, source) => valuations.push({ id: uid('val'), cardId, date, value, source });

  const mkBox = (o) => { const b = { id: uid('box'), status: 'sealed', bulkValue: 0, currency: 'PLN', shipping: 0, customs: 0, fees: 0, ...o }; boxes.push(b); return b; };
  const mkCard = (o) => {
    const c = {
      id: uid('card'), status: 'held', team: '', brand: 'Topps', season: '2024/25', number: '', serial: '',
      rookie: false, auto: false, patch: false, condition: 'NM-MT', grade: null, run: '', parallel: '',
      acq: 'single', boxId: '', currency: 'PLN', fx: null, price: 0, shipping: 0, fees: 0, customs: 0,
      source: '', notes: '', ...o
    };
    cards.push(c);
    return c;
  };

  /* Trzy breaki tego samego produktu — widać rozrzut wyników */
  const b1 = mkBox({ name: 'Topps Chrome UCL 2024/25', brand: 'Topps', season: '2024/25', format: 'hobby', purpose: 'rip', date: d(7), price: 620, source: 'Sklep PL', status: 'opened', openedDate: d(7, 14), bulkValue: 60 });
  const b2 = mkBox({ name: 'Topps Chrome UCL 2024/25', brand: 'Topps', season: '2024/25', format: 'hobby', purpose: 'rip', date: d(5), price: 640, source: 'Sklep PL', status: 'opened', openedDate: d(5, 9), bulkValue: 45 });
  const b3 = mkBox({ name: 'Panini Prizm Premier League 2024/25', brand: 'Panini', season: '2024/25', format: 'blaster', purpose: 'rip', date: d(3), price: 180, source: 'Allegro', status: 'opened', openedDate: d(3, 20), bulkValue: 20 });
  mkBox({ name: 'Topps Merlin Chrome 2024/25', brand: 'Topps', season: '2024/25', format: 'hobby', purpose: 'flip', date: d(4), price: 118, currency: 'EUR', fx: 4.31, shipping: 12, customs: 0, source: 'Kartenhaus DE', status: 'sold', sale: { date: d(2, 8), price: 690, currency: 'PLN', channel: 'Allegro', feePct: 9, feeAbs: 0, shippingOut: 18, shippingIn: 15, note: 'Flip z promocji DE' } });
  mkBox({ name: 'Topps Chrome UCL 2025/26', brand: 'Topps', season: '2025/26', format: 'hobby', purpose: 'undecided', date: d(2, 3), price: 690, source: 'Sklep PL' });
  mkBox({ name: 'Panini Select 2024/25', brand: 'Panini', season: '2024/25', format: 'hobby', purpose: 'flip', date: d(1, 18), price: 149, currency: 'EUR', fx: 4.29, shipping: 15, source: 'Kartenhaus DE' });

  const p1 = mkCard({ player: 'Jude Bellingham', team: 'Real Madryt', product: 'Topps Chrome UCL 2024/25', parallel: 'Gold Refractor', run: '50', acq: 'box', boxId: b1.id, date: b1.openedDate, price: 0 });
  addVal(p1.id, b1.openedDate, 520, 'Break');
  addVal(p1.id, d(4), 580, 'eBay sold 30d');
  addVal(p1.id, d(1), 640, 'eBay sold 30d');

  const p2 = mkCard({ player: 'Rodri', team: 'Manchester City', product: 'Topps Chrome UCL 2024/25', parallel: 'Refractor', acq: 'box', boxId: b1.id, date: b1.openedDate, price: 0, auto: true });
  addVal(p2.id, b1.openedDate, 210, 'Break');
  addVal(p2.id, d(1), 185, 'eBay sold 30d');

  const p3 = mkCard({ player: 'Florian Wirtz', team: 'Bayer Leverkusen', product: 'Topps Chrome UCL 2024/25', parallel: 'Aqua /99', run: '99', acq: 'box', boxId: b1.id, date: b1.openedDate, price: 0, rookie: true });
  addVal(p3.id, b1.openedDate, 160, 'Break');
  addVal(p3.id, d(1), 240, 'eBay sold 30d');

  const p4 = mkCard({ player: 'Kylian Mbappé', team: 'Real Madryt', product: 'Topps Chrome UCL 2024/25', parallel: 'SuperFractor 1/1', run: '1', acq: 'box', boxId: b2.id, date: b2.openedDate, price: 0, auto: true, patch: true, status: 'listed', listing: { price: 4200, date: d(1, 5), channel: 'eBay' } });
  addVal(p4.id, b2.openedDate, 3200, 'Break');
  addVal(p4.id, d(2), 3600, '130point');
  addVal(p4.id, d(1), 3900, '130point');

  const p5 = mkCard({ player: 'Vinícius Júnior', team: 'Real Madryt', product: 'Topps Chrome UCL 2024/25', parallel: 'Refractor', acq: 'box', boxId: b2.id, date: b2.openedDate, price: 0 });
  addVal(p5.id, b2.openedDate, 120, 'Break');
  addVal(p5.id, d(1), 105, 'eBay sold 30d');

  const p6 = mkCard({ player: 'Cole Palmer', team: 'Chelsea', product: 'Panini Prizm Premier League 2024/25', brand: 'Panini', parallel: 'Silver Prizm', acq: 'box', boxId: b3.id, date: b3.openedDate, price: 0 });
  addVal(p6.id, b3.openedDate, 95, 'Break');
  addVal(p6.id, d(1), 130, 'Cardmarket trend');

  const p7 = mkCard({ player: 'Bukayo Saka', team: 'Arsenal', product: 'Panini Prizm Premier League 2024/25', brand: 'Panini', parallel: 'Base', acq: 'box', boxId: b3.id, date: b3.openedDate, price: 0 });
  addVal(p7.id, b3.openedDate, 30, 'Break');
  addVal(p7.id, d(1), 26, 'Cardmarket trend');

  /* Single kupione na rynku wtórnym */
  const s1 = mkCard({ player: 'Lamine Yamal', team: 'FC Barcelona', product: 'Topps Chrome UCL 2023/24', parallel: 'Refractor', rookie: true, date: d(6, 4), price: 380, shipping: 15, source: 'Vinted', notes: 'RC z debiutanckiego sezonu — teza: kolejny Messi hype.' });
  addVal(s1.id, d(6, 4), 400, 'Vinted');
  addVal(s1.id, d(3), 560, 'eBay sold 30d');
  addVal(s1.id, d(1), 780, 'eBay sold 30d');

  const s2 = mkCard({ player: 'Erling Haaland', team: 'Manchester City', product: 'Panini Prizm World Cup 2022', brand: 'Panini', parallel: 'Silver', date: d(8, 21), price: 68, currency: 'EUR', fx: 4.32, shipping: 6, fees: 3, source: 'Cardmarket' });
  addVal(s2.id, d(8, 21), 320, 'Cardmarket trend');
  addVal(s2.id, d(1), 295, 'Cardmarket trend');

  const s3 = mkCard({ player: 'Jamal Musiala', team: 'Bayern Monachium', product: 'Topps Finest UCL 2023/24', parallel: 'Gold /50', run: '50', date: d(9, 15), price: 240, shipping: 12, source: 'Facebook / grupy', grade: { company: 'PSA', value: '10', cert: '' } });
  addVal(s3.id, d(9, 15), 260, 'Własna ocena');
  addVal(s3.id, d(4), 430, 'eBay sold graded');
  addVal(s3.id, d(1), 470, 'eBay sold graded');

  /* Sprzedane */
  const x1 = mkCard({ player: 'Harry Kane', team: 'Bayern Monachium', product: 'Topps Chrome UCL 2023/24', parallel: 'Refractor', date: d(9, 8), price: 150, shipping: 10, source: 'Vinted', status: 'sold', sale: { date: d(4, 12), price: 280, currency: 'PLN', channel: 'Vinted', feePct: 0, feeAbs: 0, shippingOut: 12, shippingIn: 12, note: '' } });
  addVal(x1.id, d(9, 8), 160, 'Vinted');

  const x2 = mkCard({ player: 'Phil Foden', team: 'Manchester City', product: 'Panini Mosaic 2023/24', brand: 'Panini', parallel: 'Gold /10', run: '10', date: d(7, 19), price: 420, shipping: 18, source: 'eBay', status: 'sold', sale: { date: d(2, 22), price: 165, currency: 'EUR', fx: 4.3, channel: 'eBay', feePct: 11, feeAbs: 0, shippingOut: 45, shippingIn: 30, note: 'Sprzedane po spadku formy' } });
  addVal(x2.id, d(7, 19), 450, 'eBay sold 30d');

  const x3 = mkCard({ player: 'Endrick', team: 'Real Madryt', product: 'Topps Chrome UCL 2024/25', parallel: 'Purple /150', run: '150', acq: 'box', boxId: b2.id, date: b2.openedDate, price: 0, rookie: true, status: 'sold', sale: { date: d(3, 6), price: 310, currency: 'PLN', channel: 'Allegro', feePct: 9, feeAbs: 0, shippingOut: 15, shippingIn: 15, note: '' } });
  addVal(x3.id, b2.openedDate, 280, 'Break');

  /* Grading w toku */
  gradings.push({
    id: uid('grad'), company: 'PSA', tier: 'Value Bulk', date: d(1, 10),
    feePerCard: 115, shipping: 180, extra: 40, cardIds: [p3.id], before: { [p3.id]: 240 }, status: 'sent'
  });
  const c3 = cards.find(c => c.id === p3.id);
  c3.status = 'grading';

  /* Grading rozliczony */
  gradings.push({
    id: uid('grad'), company: 'PSA', tier: 'Value', date: d(5, 2), returnedDate: d(4, 6),
    feePerCard: 115, shipping: 160, extra: 0, cardIds: [s3.id], before: { [s3.id]: 260 }, status: 'returned'
  });

  expenses.push(
    { id: uid('exp'), date: d(8, 3), category: 'supplies', amount: 180, recurring: 'no', note: '200x toploader + penny sleeves' },
    { id: uid('exp'), date: d(6, 11), category: 'supplies', amount: 95, recurring: 'no', note: 'Koperty bąbelkowe i karton' },
    { id: uid('exp'), date: d(4, 2), category: 'storage', amount: 140, recurring: 'no', note: 'Segregator + strony 9-pocket' },
    { id: uid('exp'), date: d(3, 1), category: 'travel', amount: 120, recurring: 'no', note: 'Giełda kart Warszawa — dojazd i wejściówka' },
    { id: uid('exp'), date: d(1, 1), category: 'tools', amount: 45, recurring: 'yes', note: 'Subskrypcja cennika' }
  );

  watchlist.push(
    { id: uid('watch'), name: 'Lamine Yamal RC', product: 'Topps Chrome UCL 2023/24 Gold /50', target: 2800, market: 3400, priority: 'high', budget: 3000, note: 'Czekam na korektę po hype z ME.' },
    { id: uid('watch'), name: 'Pedri', product: 'Panini Prizm Silver', target: 180, market: 165, priority: 'mid', budget: 250, note: 'Poniżej celu — można brać.' },
    { id: uid('watch'), name: 'Kobbie Mainoo RC', product: 'Topps Chrome PL 2023/24', target: 220, market: 310, priority: 'low', budget: 300, note: 'Za drogo jak na minuty w tym sezonie.' }
  );

  state.cards = cards;
  state.boxes = boxes;
  state.valuations = valuations;
  state.gradings = gradings;
  state.expenses = expenses;
  state.watchlist = watchlist;
  reallocateAll();
  saveState();
  renderAll();
  closeModal('settings-modal');
  toast('Dane demo wczytane — obejrzyj i wyczyść, gdy zaczniesz wpisywać swoje', 'ok');
}

/* ============================================================
   Zakładki i zdarzenia
   ============================================================ */
function goTab(name) {
  activeTab = name;
  document.querySelectorAll('.trade-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  // Chart.js nie zna wymiarów ukrytych kanw — po pokazaniu panelu trzeba je przeliczyć.
  requestAnimationFrame(() => Object.values(charts).forEach(c => { try { c.resize(); } catch { } }));
}

function bindEvents() {
  document.querySelectorAll('.trade-tab').forEach(t => t.addEventListener('click', () => goTab(t.dataset.tab)));

  el('eq-range').addEventListener('click', e => {
    const btn = e.target.closest('button[data-range]');
    if (!btn) return;
    eqRange = btn.dataset.range;
    el('eq-range').querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    renderEquityChart(portfolioSeries());
  });

  /* Nagłówek */
  el('btn-new-card').addEventListener('click', () => openCardModal(null));
  el('btn-new-box').addEventListener('click', () => openBoxModal(null));
  el('btn-valuation').addEventListener('click', openValuation);
  el('btn-settings').addEventListener('click', openSettingsModal);
  el('btn-export').addEventListener('click', exportCsv);

  /* Szybkie akcje */
  el('q-add-box').addEventListener('click', () => openBoxModal(null));
  el('q-open-box').addEventListener('click', () => openBreakModal(null));
  el('q-add-card').addEventListener('click', () => openCardModal(null));
  el('q-valuation').addEventListener('click', openValuation);
  el('q-sell').addEventListener('click', () => openSell(null, null));
  el('q-expense').addEventListener('click', () => openExpenseModal(null));

  /* Kolekcja */
  el('btn-add-card-2').addEventListener('click', () => openCardModal(null));
  el('btn-import').addEventListener('click', openImportModal);
  el('f-q').addEventListener('input', e => { colFilters.q = e.target.value; renderCollection(); });
  ['status', 'player', 'product', 'type', 'origin'].forEach(k => {
    el('f-' + k).addEventListener('change', e => { colFilters[k] = e.target.value; renderCollection(); });
  });

  /* Boxy */
  el('btn-add-box-2').addEventListener('click', () => openBoxModal(null));

  /* Sprzedaż */
  ['channel', 'period', 'kind'].forEach(k => {
    el('f-sale-' + k).addEventListener('change', e => { saleFilters[k] = e.target.value; renderSalesTable(); });
  });

  /* Grading */
  el('btn-add-grading').addEventListener('click', openGradingModal);
  ['gc-raw', 'gc-cost', 'gc-v10', 'gc-v9', 'gc-v8', 'gc-p10', 'gc-p9', 'gc-fee'].forEach(id => {
    el(id).addEventListener('input', renderGradingCalc);
  });

  /* Koszty / watchlista */
  el('btn-add-expense').addEventListener('click', () => openExpenseModal(null));
  el('btn-add-watch').addEventListener('click', () => openWatchModal(null));

  /* Modal: karta */
  el('cf-acq').addEventListener('change', () => { toggleBoxPicker(); updateCardCalc(); });
  el('cf-currency').addEventListener('change', () => {
    const cur = getVal('cf-currency');
    setVal('cf-fx', cur === 'PLN' ? '' : settings.fx[cur]);
    updateCardCalc();
  });
  el('card-modal').addEventListener('input', updateCardCalc);
  el('cf-save').addEventListener('click', () => saveCard(false));
  el('cf-save-next').addEventListener('click', () => saveCard(true));

  /* Modal: box */
  el('bf-currency').addEventListener('change', () => {
    const cur = getVal('bf-currency');
    setVal('bf-fx', cur === 'PLN' ? '' : settings.fx[cur]);
    updateBoxCalc();
  });
  el('box-modal').addEventListener('input', updateBoxCalc);
  el('bf-save').addEventListener('click', saveBox);

  /* Modal: break */
  el('of-box').addEventListener('change', () => { renderPullRows(); updateBreakCalc(); });
  el('of-add-pull').addEventListener('click', () => {
    const box = state.boxes.find(b => b.id === getVal('of-box'));
    el('of-pulls').appendChild(pullRow(null, box));
  });
  el('open-modal').addEventListener('input', updateBreakCalc);
  el('of-save').addEventListener('click', saveBreak);

  /* Modal: sprzedaż */
  el('sf-item').addEventListener('change', () => {
    const target = resolveSellTarget(getVal('sf-item'));
    if (target) setVal('sf-price', target.suggest ? target.suggest.toFixed(2) : '');
    updateSellCalc();
  });
  el('sf-channel').addEventListener('change', () => { syncChannelFee(); updateSellCalc(); });
  el('sf-currency').addEventListener('change', () => {
    const cur = getVal('sf-currency');
    setVal('sf-fx', cur === 'PLN' ? '' : settings.fx[cur]);
    updateSellCalc();
  });
  el('sell-modal').addEventListener('input', updateSellCalc);
  el('sf-save').addEventListener('click', saveSale);

  /* Modal: wystawienie */
  el('list-modal').addEventListener('input', updateListCalc);
  el('lf-channel').addEventListener('change', updateListCalc);
  el('lf-save').addEventListener('click', saveListing);
  el('lf-unlist').addEventListener('click', () => unlistCard(null));

  /* Modal: wycena */
  el('vf-filter').addEventListener('change', renderValuationRows);
  el('vf-list').addEventListener('input', updateValuationCalc);
  el('vf-save').addEventListener('click', () => saveValuationSession(false));
  el('vf-carry').addEventListener('click', () => saveValuationSession(true));

  /* Modal: grading */
  el('gf-cards').addEventListener('change', updateGradingCalc);
  el('grading-modal').addEventListener('input', updateGradingCalc);
  el('gf-save').addEventListener('click', saveGrading);
  el('grf-save').addEventListener('click', saveGradingReturn);

  /* Modale: koszt, watchlista, import */
  el('ef-save').addEventListener('click', saveExpense);
  el('wf-save').addEventListener('click', saveWatch);
  el('imf-check').addEventListener('click', previewImport);
  el('imf-save').addEventListener('click', runImport);

  /* Modal: ustawienia */
  el('sf-save-settings').addEventListener('click', saveSettings);
  el('sf-add-channel').addEventListener('click', addChannel);
  el('sf-fetch-fx').addEventListener('click', fetchNbpRates);
  el('sf-export-json').addEventListener('click', exportJson);
  el('sf-import-json').addEventListener('click', () => el('sf-file').click());
  el('sf-file').addEventListener('change', e => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; });
  el('sf-demo').addEventListener('click', loadDemo);
  el('sf-reset').addEventListener('click', resetModule);

  /* Zamykanie modali i szuflady */
  document.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) { closeAllModals(); return; }
    if (e.target.closest('[data-close-drawer]')) { closeDrawer(); return; }
    if (e.target.classList.contains('tc-modal-ov')) closeAllModals();
    if (e.target.classList.contains('cd-drawer-ov')) closeDrawer();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeAllModals(); closeDrawer(); }
  });
  /* Etykiety pigułkowych checkboxów */
  document.addEventListener('change', e => {
    if (e.target.matches('.cd-check input[type="checkbox"]')) syncCheckLabel(e.target);
  });
}

/* ============================================================
   Start
   ============================================================ */
function init() {
  loadState();
  bindEvents();
  renderAll();
  renderGradingCalc();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
