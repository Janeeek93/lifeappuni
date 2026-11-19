/* ============================================================
   ROAD TO GLORY 2027 — silnik (bez DOM, testowalny w node)
   Dane: localStorage 'lifeos_rtg_v1'. Stare dane (moduł Progres 2026)
   zostają nietknięte w 'lifeos_trainings_month_v1' i 'lifeos_body_metrics_v1'.
   Tydzień = pon–nd. Daty jako teksty 'YYYY-MM-DD' (bez stref czasowych).
   ============================================================ */
(function (root) {
  'use strict';

  var KEY = 'lifeos_rtg_v1';
  var LEGACY_KEY = 'lifeos_trainings_month_v1';
  var BODY_KEY = 'lifeos_body_metrics_v1';
  var GOALS = ['gym', 'run', 'kcal', 'read'];

  function defaults() {
    return {
      v: 1,
      season: { name: 'Road to Glory 2027', start: '2026-11-23', weeks: 57 },
      goals: {
        gymPerWeek: 3, gymMinMinutes: 20,
        runKmPerWeek: 5,
        pagesPerWeek: 100,
        kcalMin: 2100, kcalMax: 2400, proteinMin: 140, kcalDaysPerWeek: 6, kcalConfirmed: true,
        stepsTarget: 8000, sleepTarget: 7
      },
      workouts: [],   // {id,date,kind:'gym'|'run'|'other',min,km,avgHr,maxHr,kcal,src}
      days: {},       // 'YYYY-MM-DD': {kcal,protein,carbs,fat,pages,steps,sleepH,rhr,hrv}
      body: [],       // {date,weight,bf,lean,waist}
      offWeeks: {},   // 'YYYY-MM-DD'(poniedziałek): 'powód'
      updatedAt: 0
    };
  }

  /* ---------- daty ---------- */
  function p2(n) { return n < 10 ? '0' + n : '' + n; }
  function dstr(d) { return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()); }
  function dparse(s) { var a = String(s).slice(0, 10).split('-'); return new Date(Date.UTC(+a[0], +a[1] - 1, +a[2])); }
  function addDays(s, n) { var d = dparse(s); d.setUTCDate(d.getUTCDate() + n); return dstr(d); }
  function diffDays(a, b) { return Math.round((dparse(a) - dparse(b)) / 864e5); }
  function mondayOf(s) { return addDays(s, -((dparse(s).getUTCDay() + 6) % 7)); }
  function todayStr() {
    if (root.__RTG_TODAY__) return root.__RTG_TODAY__;
    var n = new Date();
    return n.getFullYear() + '-' + p2(n.getMonth() + 1) + '-' + p2(n.getDate());
  }
  function monthOfWeek(mon) { return addDays(mon, 3).slice(0, 7); } // czwartek rozstrzyga (jak ISO)
  function num(x) { var n = typeof x === 'number' ? x : parseFloat(String(x == null ? '' : x).replace(',', '.')); return isFinite(n) ? n : null; }
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  function r1(x) { return Math.round(x * 10) / 10; }

  /* ---------- zapis ---------- */
  function normalize(st) {
    var d = defaults();
    st = st && typeof st === 'object' ? st : {};
    var out = {
      v: 1,
      season: Object.assign({}, d.season, st.season || {}),
      goals: Object.assign({}, d.goals, st.goals || {}),
      workouts: Array.isArray(st.workouts) ? st.workouts.filter(function (w) { return w && w.date; }) : [],
      days: st.days && typeof st.days === 'object' && !Array.isArray(st.days) ? st.days : {},
      body: Array.isArray(st.body) ? st.body.filter(function (b) { return b && b.date; }) : [],
      offWeeks: st.offWeeks && typeof st.offWeeks === 'object' ? st.offWeeks : {},
      updatedAt: st.updatedAt || 0
    };
    out.workouts.forEach(function (w) {
      if (!w.id) w.id = wid(w);
      if (w.kind !== 'gym' && w.kind !== 'run') w.kind = 'other';
    });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(out.season.start))) out.season.start = d.season.start;
    out.season.start = mondayOf(out.season.start);
    if (!(out.season.weeks > 0)) out.season.weeks = d.season.weeks;
    // migracja: poprzedni domyślny start (4.01.2027, 52 tyg.) -> start 23.11.2026
    if (out.season.start === '2027-01-04' && out.season.weeks === 52) { out.season.start = d.season.start; out.season.weeks = d.season.weeks; }
    return out;
  }
  function wid(w) { return 'w_' + w.date + '_' + (w.kind || 'x') + '_' + (w.start || w.min || w.km || '0'); }
  function load() {
    try { return normalize(JSON.parse(root.localStorage.getItem(KEY) || 'null')); }
    catch (e) { return normalize(null); }
  }
  function save(st) {
    st.updatedAt = Date.now();
    try { root.localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* pełny dysk / tryb prywatny */ }
    return st;
  }

  /* ---------- tydzień ---------- */
  function dayRow(st, ds, today) {
    var g = st.goals, dd = st.days[ds] || {};
    var gyms = 0, gymMin = 0, km = 0, other = 0;
    st.workouts.forEach(function (w) {
      if (w.date !== ds) return;
      if (w.kind === 'gym') { if (!(num(w.min) > 0) || num(w.min) >= g.gymMinMinutes) { gyms++; gymMin += num(w.min) || 0; } }
      else if (w.kind === 'run') km += num(w.km) || 0;
      else other++;
    });
    var kc = num(dd.kcal), ks;
    var pr = num(dd.protein);
    if (kc > 0) {
      ks = kc > g.kcalMax ? 'over' : (kc < g.kcalMin ? 'under' : 'ok');
      // białko: brak wpisu nie blokuje dnia (dane mogą przyjść bez makro), wpisane za niskie — blokuje
      if (ks === 'ok' && g.proteinMin > 0 && pr != null && pr > 0 && pr < g.proteinMin) ks = 'lowp';
    }
    else ks = ds >= today ? 'open' : 'unknown';
    return {
      date: ds, today: ds === today, future: ds > today,
      gym: gyms, gymMin: gymMin, km: r1(km), other: other,
      kcal: kc > 0 ? Math.round(kc) : null, kcalState: ks,
      protein: num(dd.protein), pages: num(dd.pages) || 0,
      steps: num(dd.steps), sleepH: num(dd.sleepH), rhr: num(dd.rhr), hrv: num(dd.hrv)
    };
  }

  function lvlCount(done, target, phase, elapsed, left, capByDays) {
    if (target <= 0) return 'hit';
    if (done >= target - 1e-9) return 'hit';
    if (phase === 'past') return done / target >= 0.6 ? 'part' : 'miss';
    if (phase === 'future') return 'future';
    if (capByDays && (target - done) > left) return 'lost';
    return done >= target * elapsed / 7 - 1e-9 ? 'ok' : 'behind';
  }

  function weekData(st, mon, today) {
    today = today || todayStr();
    var g = st.goals, sun = addDays(mon, 6), days = [], i;
    var phase = sun < today ? 'past' : (mon > today ? 'future' : 'current');
    var elapsed = phase === 'past' ? 7 : (phase === 'future' ? 0 : diffDays(today, mon));
    var left = 7 - elapsed;
    for (i = 0; i < 7; i++) days.push(dayRow(st, addDays(mon, i), today));
    var gymN = sum(days.map(function (d) { return d.gym; }));
    var runKm = r1(sum(days.map(function (d) { return d.km; })));
    var pages = sum(days.map(function (d) { return d.pages; }));
    var kOk = days.filter(function (d) { return d.kcalState === 'ok'; }).length;
    var kBad = days.filter(function (d) { return d.kcalState === 'over' || d.kcalState === 'under' || d.kcalState === 'lowp' || (phase === 'past' && d.kcalState === 'unknown'); }).length;
    var kPending = days.filter(function (d) { return d.kcalState === 'open' || (phase === 'current' && d.kcalState === 'unknown'); }).length;
    var kT = Math.min(7, g.kcalDaysPerWeek);
    var kLvl;
    if (kOk >= kT) kLvl = 'hit';
    else if (phase === 'past') kLvl = kOk / kT >= 0.6 ? 'part' : 'miss';
    else if (phase === 'future') kLvl = 'future';
    else if (kOk + kPending < kT) kLvl = 'lost';
    else kLvl = kBad >= (7 - kT) ? 'behind' : 'ok';

    var w = {
      mon: mon, sun: sun, phase: phase, elapsed: elapsed, left: left, days: days,
      off: Object.prototype.hasOwnProperty.call(st.offWeeks, mon), offReason: st.offWeeks[mon] || '',
      gym: { done: gymN, target: g.gymPerWeek, lvl: lvlCount(gymN, g.gymPerWeek, phase, elapsed, left, true) },
      run: { done: runKm, target: g.runKmPerWeek, lvl: lvlCount(runKm, g.runKmPerWeek, phase, elapsed, left, false) },
      read: { done: pages, target: g.pagesPerWeek, lvl: lvlCount(pages, g.pagesPerWeek, phase, elapsed, left, false) },
      kcal: { done: kOk, target: kT, bad: kBad, pending: kPending, lvl: kLvl }
    };
    // nadwyżka jednego celu pokrywa braki innego (jak w starym module); kalorie max 100%
    var ratios = GOALS.map(function (k) {
      var o = w[k], r = o.target > 0 ? o.done / o.target : 1;
      return k === 'kcal' ? Math.min(1, r) : r;
    });
    var avg = sum(ratios) / ratios.length;
    w.score = Math.round(100 * avg);
    w.closed = phase !== 'future' && w.score >= 100; // zaokrąglenie do pełnych % jak w starym module
    w.strict = GOALS.every(function (k) { return w[k].lvl === 'hit'; });
    return w;
  }

  /* ---------- sezon ---------- */
  function firstDataDate(st) {
    var ds = [];
    st.workouts.forEach(function (w) { ds.push(w.date); });
    Object.keys(st.days).forEach(function (d) { var x = st.days[d] || {}; if (x.kcal || x.pages) ds.push(d); });
    ds.sort();
    return ds[0] || null;
  }
  function lastDataDate(st) {
    var ds = [];
    st.workouts.forEach(function (w) { ds.push(w.date); });
    Object.keys(st.days).forEach(function (d) { var x = st.days[d]; if (x && (x.kcal || x.pages)) ds.push(d); });
    ds.sort();
    return ds.length ? ds[ds.length - 1] : null;
  }
  function freshness(st, today) {
    today = today || todayStr();
    var last = { gym: null, run: null, kcal: null, read: null, body: null };
    st.workouts.forEach(function (w) { if (w.kind === 'gym' || w.kind === 'run') { var k = w.kind; if (!last[k] || w.date > last[k]) last[k] = w.date; } });
    Object.keys(st.days).forEach(function (d) {
      var x = st.days[d] || {};
      if (num(x.kcal) > 0 && (!last.kcal || d > last.kcal)) last.kcal = d;
      if (num(x.pages) > 0 && (!last.read || d > last.read)) last.read = d;
    });
    bodyAll(st).forEach(function (b) { if (b.weight != null && (!last.body || b.date > last.body)) last.body = b.date; });
    var out = {};
    Object.keys(last).forEach(function (k) { out[k] = { date: last[k], ago: last[k] ? Math.max(0, diffDays(today, last[k])) : null }; });
    return out;
  }

  function roadWeeks(st, today) {
    today = today || todayStr();
    var sMon = st.season.start, n = st.season.weeks, list = [], i;
    var first = firstDataDate(st);
    var warmFrom = first ? mondayOf(first) : null;
    var curMon = mondayOf(today);
    // rozgrzewka: tygodnie przed startem sezonu, od pierwszych danych (lub bieżący, jeśli sezon jeszcze nie ruszył)
    var wStart = warmFrom && warmFrom < sMon ? warmFrom : (curMon < sMon ? curMon : null);
    var cap = addDays(sMon, -56); if (wStart && wStart < cap) wStart = cap;
    if (wStart) for (var m = wStart, k = 0; m < sMon && k < 80; m = addDays(m, 7), k++) list.push({ idx: -diffDays(sMon, m) / 7, mon: m, warm: true });
    for (i = 0; i < n; i++) list.push({ idx: i + 1, mon: addDays(sMon, 7 * i), warm: false });
    return list.map(function (x) { var w = weekData(st, x.mon, today); w.idx = x.idx; w.warm = x.warm; return w; });
  }

  function rate(weeks, key) {
    var c = weeks.filter(function (w) { return w.phase === 'past' && !w.off; });
    if (!c.length) return { hits: 0, n: 0, pct: null };
    var hits = c.filter(function (w) { return key === 'all' ? w.closed : w[key].lvl === 'hit'; }).length;
    return { hits: hits, n: c.length, pct: Math.round(100 * hits / c.length) };
  }

  function summary(st, today) {
    today = today || todayStr();
    var weeks = roadWeeks(st, today);
    var cur = weekData(st, mondayOf(today), today);
    var curRoad = weeks.filter(function (w) { return w.mon === cur.mon; })[0];
    cur.idx = curRoad ? curRoad.idx : null; cur.warm = curRoad ? curRoad.warm : true;
    // tygodnie "po sezonie"/przed sezonem poza rozgrzewką też mogą być bieżące
    var pastAll = weeks.filter(function (w) { return w.phase === 'past' && !w.off; });
    var seasonPast = pastAll.filter(function (w) { return !w.warm; });
    var seasonStarted = today >= st.season.start;
    var daysToStart = Math.max(0, diffDays(st.season.start, today));

    function lastN(n) { return pastAll.slice(-n); }
    var rates = {};
    GOALS.concat(['all']).forEach(function (k) {
      rates[k] = { w4: rate(lastN(4), k), w12: rate(lastN(12), k), season: rate(seasonPast, k) };
    });

    // serie zamkniętych tygodni (tygodnie wolne nie przerywają)
    var seq = weeks.filter(function (w) { return (w.phase === 'past' || (w.phase === 'current' && w.closed)) && !w.off; });
    var streak = 0, best = 0, run = 0;
    seq.forEach(function (w) { if (w.closed) { run++; if (run > best) best = run; } else run = 0; });
    for (var i = seq.length - 1; i >= 0 && seq[i].closed; i--) streak++;

    // miesiące
    var months = {};
    weeks.forEach(function (w) {
      if (w.phase === 'future' || w.off) return;
      if (w.phase === 'current' && !w.closed) return;
      var m = monthOfWeek(w.mon);
      var o = months[m] || (months[m] = { ym: m, weeks: 0, closed: 0, gym: 0, run: 0, kcal: 0, read: 0, gymSum: 0, kmSum: 0, pagesSum: 0 });
      o.weeks++; if (w.closed) o.closed++;
      GOALS.forEach(function (k) { if (w[k].lvl === 'hit') o[k]++; });
      o.gymSum += w.gym.done; o.kmSum += w.run.done; o.pagesSum += w.read.done;
    });
    var monthList = Object.keys(months).sort().map(function (k) { return months[k]; });

    return {
      today: today, cur: cur, weeks: weeks, rates: rates, streak: streak, bestStreak: best,
      seasonStarted: seasonStarted, daysToStart: daysToStart,
      seasonClosed: seasonPast.filter(function (w) { return w.closed; }).length,
      seasonDone: seasonPast.length,
      curSeasonWeek: cur.warm ? null : cur.idx,
      months: monthList, fresh: freshness(st, today), todo: todoList(st, cur)
    };
  }

  /* ---------- lista "do zrobienia" ---------- */
  function plural(n, a, b, c) { var m10 = n % 10, m100 = n % 100; if (n === 1) return a; if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return b; return c; }
  function fmt(n, d) { return Number(n).toLocaleString('pl-PL', { maximumFractionDigits: d == null ? 1 : d }); }
  function todoList(st, w) {
    var out = [];
    if (w.phase !== 'current' || w.closed) return out;
    var left = w.left, ds = left + ' ' + plural(left, 'dzień', 'dni', 'dni');
    var g = w.gym;
    if (g.lvl !== 'hit') {
      var need = g.target - g.done;
      out.push({ key: 'gym', lvl: g.lvl, title: 'Siłownia: jeszcze ' + need + ' ' + plural(need, 'trening', 'treningi', 'treningów'),
        sub: g.lvl === 'lost' ? 'nie zmieścisz już w tym tygodniu — zostaje ' + ds : 'zostaje ' + ds + (need >= left ? ' — trenuj codziennie' : (need === left - 1 ? ' — jeden dzień luzu' : '')) });
    }
    var r = w.run;
    if (r.lvl !== 'hit') {
      var rk = Math.max(0, r1(r.target - r.done));
      out.push({ key: 'run', lvl: r.lvl, title: 'Bieg: jeszcze ' + fmt(rk) + ' km',
        sub: 'zostaje ' + ds + (left > 0 ? ' — np. jedno bieganie ' + fmt(rk) + ' km albo ' + (rk > 3 ? '2 × ' + fmt(r1(rk / 2)) : '2 × ' + fmt(r1(rk / 2))) + ' km' : '') });
    }
    var rd = w.read;
    if (rd.lvl !== 'hit') {
      var pg = Math.max(0, Math.round(rd.target - rd.done));
      out.push({ key: 'read', lvl: rd.lvl, title: 'Czytanie: jeszcze ' + pg + ' ' + plural(pg, 'strona', 'strony', 'stron'),
        sub: 'to ' + Math.ceil(pg / Math.max(1, left)) + ' str./dzień przez ' + ds });
    }
    var k = w.kcal;
    if (k.lvl !== 'hit') {
      var kn = k.target - k.done;
      out.push({ key: 'kcal', lvl: k.lvl, title: 'Kalorie i białko: jeszcze ' + kn + ' ' + plural(kn, 'dzień', 'dni', 'dni') + ' w normie',
        sub: k.lvl === 'lost' ? 'cel tygodnia nie do zaliczenia — celuj w kolejny' : 'zapas pomyłek: ' + Math.max(0, (7 - k.target) - k.bad) });
    }
    return out;
  }

  /* ---------- dane z poprzedniego roku (stary moduł) ---------- */
  function legacyStats(legacy, lg, today) {
    today = today || todayStr();
    // legacy: {activities:{date:[{type,completed,loggedValue,plannedValue}]}, vacations:{date:true}}
    lg = lg || { gym: 3, run: 5, read: 100 };
    if (!legacy || !legacy.activities) return null;
    var acts = legacy.activities, vac = legacy.vacations || {};
    var byWeek = {}, first = null, last = null;
    Object.keys(acts).forEach(function (d) {
      (acts[d] || []).forEach(function (a) {
        if (!a || !a.completed) return;
        var mon = mondayOf(d);
        var o = byWeek[mon] || (byWeek[mon] = { gym: 0, run: 0, read: 0 });
        if (a.type === 'gym') o.gym += 1;
        else {
          var v = num(a.loggedValue); if (!(v > 0)) v = num(a.plannedValue) || 0;
          if (a.type === 'running') o.run += v; else if (a.type === 'reading') o.read += v;
        }
        if (!first || d < first) first = d;
        if (!last || d > last) last = d;
      });
    });
    if (!first) return null;
    var res = {};
    var lastMon = addDays(mondayOf(today), -7); if (mondayOf(last) > lastMon) lastMon = mondayOf(last);
    for (var m = mondayOf(first); m <= lastMon; m = addDays(m, 7)) {
      var vdays = 0; for (var i = 0; i < 7; i++) if (vac[addDays(m, i)]) vdays++;
      if (vdays >= 4) continue;
      var y = addDays(m, 3).slice(0, 4);
      var o = byWeek[m] || { gym: 0, run: 0, read: 0 };
      var r = res[y] || (res[y] = { year: y, weeks: 0, closed: 0, gym: 0, run: 0, read: 0, gymSum: 0, kmSum: 0, pagesSum: 0 });
      r.weeks++;
      var hg = o.gym >= lg.gym, hr = o.run >= lg.run, hp = o.read >= lg.read;
      if (hg) r.gym++; if (hr) r.run++; if (hp) r.read++;
      if (Math.round(100 * (o.gym / lg.gym + o.run / lg.run + o.read / lg.read) / 3) >= 100) r.closed++;
      r.gymSum += o.gym; r.kmSum += o.run; r.pagesSum += o.read;
    }
    return Object.keys(res).sort().map(function (k) { return res[k]; });
  }

  /* ---------- ciało ---------- */
  function bodySeries(st) { return st.body.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }); }


  /* ---------- ciało: nowe pomiary + archiwum 2026 (rtg ma pierwszeństwo) ---------- */
  function bodyAll(st) {
    var map = {};
    try {
      (JSON.parse(root.localStorage.getItem(BODY_KEY) || '[]') || []).forEach(function (x) {
        if (x && x.date) map[x.date] = { date: x.date, weight: num(x.weight), bf: num(x.bf), lean: null, waist: null, arch: true };
      });
    } catch (e) { }
    st.body.forEach(function (b) { map[b.date] = Object.assign({}, map[b.date] || {}, b, { arch: false }); });
    return Object.keys(map).sort().map(function (k) { return map[k]; });
  }
  function weeklyBody(arr) {
    var m = {};
    arr.forEach(function (b) {
      var mon = mondayOf(b.date), o = m[mon] || (m[mon] = { mon: mon, n: 0, w: [], f: [], l: [] });
      o.n++; if (b.weight != null) o.w.push(b.weight); if (b.bf != null) o.f.push(b.bf); if (b.lean != null) o.l.push(b.lean);
    });
    var avg = function (a) { return a.length ? sum(a) / a.length : null; };
    return Object.keys(m).sort().map(function (k) { var o = m[k]; return { mon: o.mon, n: o.n, weight: avg(o.w), bf: avg(o.f), lean: avg(o.l) }; });
  }

  /* ---------- zdrowie: kroki, sen, tętno, HRV, trend wagi -> wnioski ---------- */
  function avgField(st, from, to, f) {
    var v = [];
    for (var d = from; d <= to; d = addDays(d, 1)) { var x = num((st.days[d] || {})[f]); if (x != null && x > 0) v.push(x); }
    return { n: v.length, avg: v.length ? sum(v) / v.length : null };
  }
  function slopePerWeek(pts) { // pts: [{date, v}] -> kg/tydz. (regresja liniowa)
    if (pts.length < 3) return null;
    var t0 = pts[0].date, xs = pts.map(function (p) { return diffDays(p.date, t0); }), ys = pts.map(function (p) { return p.v; });
    var mx = sum(xs) / xs.length, my = sum(ys) / ys.length, nu = 0, de = 0;
    for (var i = 0; i < xs.length; i++) { nu += (xs[i] - mx) * (ys[i] - my); de += (xs[i] - mx) * (xs[i] - mx); }
    return de > 0 ? 7 * nu / de : null;
  }
  function health(st, today) {
    today = today || todayStr();
    var g = st.goals, a7 = addDays(today, -6), b1 = addDays(today, -7), b0 = addDays(today, -34);
    var F = ['steps', 'sleepH', 'rhr', 'hrv', 'kcal', 'protein'], cur = {}, base = {};
    F.forEach(function (f) { cur[f] = avgField(st, a7, today, f); base[f] = avgField(st, b0, b1, f); });
    var out = [], add = function (lvl, title, text) { out.push({ lvl: lvl, title: title, text: text }); };
    // pokrycie danych
    if (cur.steps.n < 5) add('info', 'Mało danych o krokach', 'Tylko ' + cur.steps.n + ' z 7 dni — telefon/zegarek nie zapisuje kroków albo eksport jest stary.');
    if (cur.sleepH.n === 0) add('info', 'Brak danych o śnie', 'Sen mierzy tylko zegarek noszony w nocy. Bez niego nie ocenię regeneracji.');
    // kroki
    if (cur.steps.n >= 3) {
      var s7 = Math.round(cur.steps.avg);
      if (s7 < g.stepsTarget * 0.75) add('warn', 'Mało ruchu: ' + fmt(s7, 0) + ' kroków dziennie', 'Cel ' + fmt(g.stepsTarget, 0) + '. Trening trwa kilkadziesiąt minut, resztę dnia spalanie zależy od chodzenia — dodatkowe 20–30 min spaceru to ok. 150–250 kcal dziennie bez wpływu na regenerację.');
      else if (s7 >= g.stepsTarget) add('good', 'Kroki OK: ' + fmt(s7, 0) + ' dziennie', 'Ponad cel ' + fmt(g.stepsTarget, 0) + '.');
      else add('info', 'Kroki: ' + fmt(s7, 0) + ' dziennie', 'Do celu ' + fmt(g.stepsTarget, 0) + ' brakuje ' + fmt(g.stepsTarget - s7, 0) + '.');
    }
    // sen
    if (cur.sleepH.n >= 3) {
      var h = cur.sleepH.avg;
      if (h < 6.5) add('bad', 'Za mało snu: ' + fmt(h) + ' h', 'Poniżej 6,5 h rośnie apetyt, spada siła i regeneracja, a deficyt kaloryczny częściej zjada mięśnie zamiast tłuszczu. To największa dźwignia w tym planie.');
      else if (h < g.sleepTarget) add('warn', 'Sen krótszy niż cel: ' + fmt(h) + ' h', 'Cel ' + fmt(g.sleepTarget) + ' h. Stałe godziny zasypiania pomagają bardziej niż jedna długa noc w weekend.');
      else add('good', 'Sen OK: ' + fmt(h) + ' h', 'Średnia z ' + cur.sleepH.n + ' nocy.');
    }
    // przemęczenie / infekcja
    if (cur.rhr.n >= 3 && base.rhr.n >= 10) {
      var dr = cur.rhr.avg - base.rhr.avg, dh = (cur.hrv.n >= 3 && base.hrv.n >= 10) ? (cur.hrv.avg / base.hrv.avg - 1) * 100 : null;
      if (dr >= 4 && dh != null && dh <= -15) add('bad', 'Sygnał przemęczenia lub infekcji', 'Tętno spoczynkowe +' + fmt(dr, 0) + ' bpm, HRV ' + fmt(dh, 0) + '% względem ostatnich 4 tygodni. Lżejszy tydzień, sen, nawodnienie; jeśli utrzymuje się ponad 2 tygodnie albo są objawy — warto do lekarza.');
      else if (dr >= 4 || (dh != null && dh <= -20)) add('warn', 'Regeneracja pogorszona', (dr >= 4 ? 'Tętno spoczynkowe +' + fmt(dr, 0) + ' bpm. ' : '') + (dh != null && dh <= -20 ? 'HRV ' + fmt(dh, 0) + '%. ' : '') + 'Obserwuj kolejne dni; unikaj podwójnych dni ciężkiego treningu.');
      else add('good', 'Tętno i HRV w normie', 'Tętno spoczynkowe ' + fmt(cur.rhr.avg, 0) + ' bpm' + (cur.hrv.n >= 3 ? ', HRV ' + fmt(cur.hrv.avg, 0) + ' ms' : '') + ' — bez odchylenia od ostatnich 4 tygodni.');
    }
    // odżywianie
    if (cur.kcal.n < 5) { if (cur.kcal.n > 0 || base.kcal.n > 0) add('info', 'Liczenie kalorii: ' + cur.kcal.n + ' z 7 dni', 'Wnioski o diecie mają sens od ok. 5 z 7 dni zapisanych.'); }
    else {
      var kc = cur.kcal.avg;
      add(kc > g.kcalMax ? 'warn' : (kc < g.kcalMin ? 'warn' : 'good'), 'Średnio ' + fmt(kc, 0) + ' kcal', 'Widełki ' + g.kcalMin + '–' + g.kcalMax + '.' + (cur.protein.n >= 3 ? ' Białko średnio ' + fmt(cur.protein.avg, 0) + ' g (min ' + g.proteinMin + ').' : ''));
    }
    // trend wagi
    var all = bodyAll(st), pts = all.filter(function (b) { return b.weight != null && b.date >= addDays(today, -28) && b.date <= today; }).map(function (b) { return { date: b.date, v: b.weight }; });
    var lastB = all.length ? all[all.length - 1] : null, trend = null;
    if (pts.length >= 3) {
      trend = slopePerWeek(pts);
      if (trend < -0.6) add('warn', 'Waga spada szybko: ' + fmt(trend, 2) + ' kg/tydz.', 'Przy rekompozycji celuj w −0,2…−0,5. Dołóż ok. 150 kcal i pilnuj białka, żeby nie tracić mięśni.');
      else if (trend < -0.1) add('good', 'Tempo spadku wagi dobre: ' + fmt(trend, 2) + ' kg/tydz.', 'Mieści się w zakresie bezpiecznym dla mięśni.');
      else if (trend <= 0.15) add('info', 'Waga stoi (' + fmt(trend, 2) + ' kg/tydz.)', 'W rekompozycji to może być dobrze, jeśli talia/BF spadają. Jeśli nie — obetnij ok. 150–200 kcal albo dołóż kroków.');
      else add('warn', 'Waga rośnie: +' + fmt(trend, 2) + ' kg/tydz.', 'Sprawdź kalorie i weekendy; przy deficycie to nie powinno się dziać.');
    } else if (!lastB || diffDays(today, lastB.date) > 21) {
      add('warn', 'Za mało pomiarów wagi', lastB ? 'Ostatni: ' + lastB.date + '. Ważenie 2–3 razy w tygodniu rano po toalecie wystarczy do trendu.' : 'Brak pomiarów.');
    }
    return { cur: cur, base: base, insights: out, trend: trend };
  }

  /* ---------- scalanie paczki od Claude ---------- */
  function merge(st, patch) {
    patch = patch && patch.rtg ? patch.rtg : patch;
    var rep = { workouts: 0, days: 0, body: 0, replaced: 0 };
    if (!patch || typeof patch !== 'object') return rep;
    var have = {};
    st.workouts.forEach(function (w) { have[w.id] = w; });
    (patch.workouts || []).forEach(function (w) {
      if (!w || !w.date) return;
      var n = Object.assign({}, w);
      if (n.kind !== 'gym' && n.kind !== 'run') n.kind = 'other';
      if (!n.id) n.id = wid(n);
      if (!have[n.id] && n.src && n.src !== 'ręcznie') {
        // wzbogacenie: zastąp jeden ręczny wpis z tego dnia i rodzaju danymi z zegarka
        var mi = st.workouts.findIndex(function (x) { return x.date === n.date && x.kind === n.kind && (!x.src || x.src === 'ręcznie'); });
        if (mi >= 0) { delete have[st.workouts[mi].id]; st.workouts.splice(mi, 1); rep.replaced = (rep.replaced || 0) + 1; }
      }
      if (have[n.id]) { Object.assign(have[n.id], n); }
      else { st.workouts.push(n); have[n.id] = n; }
      rep.workouts++;
    });
    Object.keys(patch.days || {}).forEach(function (d) {
      var v = patch.days[d]; if (!v) return;
      st.days[d] = Object.assign({}, st.days[d] || {}, v); rep.days++;
    });
    (patch.body || []).forEach(function (b) {
      if (!b || !b.date) return;
      var i = st.body.findIndex(function (x) { return x.date === b.date; });
      if (i >= 0) st.body[i] = Object.assign(st.body[i], b); else st.body.push(Object.assign({}, b));
      rep.body++;
    });
    if (patch.goals) Object.assign(st.goals, patch.goals);
    if (patch.offWeeks) Object.assign(st.offWeeks, patch.offWeeks);
    if (patch.season) { Object.assign(st.season, patch.season); st.season.start = mondayOf(st.season.start); }
    return rep;
  }

  var API = {
    KEY: KEY, LEGACY_KEY: LEGACY_KEY, BODY_KEY: BODY_KEY, GOALS: GOALS,
    defaults: defaults, normalize: normalize, load: load, save: save, merge: merge,
    today: todayStr, addDays: addDays, diffDays: diffDays, mondayOf: mondayOf, monthOfWeek: monthOfWeek,
    weekData: weekData, roadWeeks: roadWeeks, summary: summary, freshness: freshness,
    lastDataDate: lastDataDate, legacyStats: legacyStats, bodySeries: bodySeries, bodyAll: bodyAll, weeklyBody: weeklyBody, health: health, avgField: avgField,
    fmt: fmt, plural: plural, num: num
  };
  root.RTG = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
