/* ============================================================
   ROAD TO GLORY 2027 — interfejs (korzysta z rtg.js)
   ============================================================ */
(function () {
  'use strict';
  var R = window.RTG;
  var st = R.load();
  var tab = 'home';
  var charts = {};
  var logTab = 'workout';
  var weekOff = 0; // przesunięcie wyświetlanego tygodnia (0 = bieżący)

  var G = {
    gym:  { name: 'Siłownia', ic: 'fitness_center', color: 'var(--rg-gym)', unit: 'treningi' },
    run:  { name: 'Bieganie', ic: 'directions_run', color: 'var(--rg-run)', unit: 'km' },
    kcal: { name: 'Kalorie + białko', ic: 'restaurant', color: 'var(--rg-kcal)', unit: 'dni w normie' },
    read: { name: 'Czytanie', ic: 'menu_book', color: 'var(--rg-read)', unit: 'stron' }
  };
  var LV = { hit: 'Zaliczone', ok: 'W normie', behind: 'Do tyłu', lost: 'Stracone', part: 'Prawie', miss: 'Pudło', future: '—' };
  var DAYS = ['Pn', 'Wt', 'Śr', 'Czw', 'Pt', 'So', 'Nd'];
  var MON = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
  var MONL = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n, d) { return R.fmt(n, d); }
  function dm(s) { var a = s.split('-'); return (+a[2]) + ' ' + MON[+a[1] - 1]; }
  function dmy(s) { return dm(s) + ' ' + s.slice(0, 4); }
  function rng(mon) { var sun = R.addDays(mon, 6); return mon.slice(5, 7) === sun.slice(5, 7) ? (+mon.slice(8)) + '–' + (+sun.slice(8)) + ' ' + MON[+sun.slice(5, 7) - 1] : dm(mon) + ' – ' + dm(sun); }
  function lvColor(l) { return { hit: 'var(--rg-hit)', ok: 'var(--rg-ok)', part: 'var(--rg-part)', behind: 'var(--rg-part)', miss: 'var(--rg-bad)', lost: 'var(--rg-bad)' }[l] || 'var(--rg-line)'; }
  function persist() { R.save(st); }
  function toast(msg, kind) {
    var el = document.createElement('div'); el.className = 'rg-toast ' + (kind || ''); el.textContent = msg;
    $('toasts').appendChild(el); setTimeout(function () { el.remove(); }, 2600);
  }
  function S() { return R.summary(st); }
  function val(k, o) {
    if (k === 'run') return fmt(o.done) + ' / ' + fmt(o.target) + ' km';
    if (k === 'kcal') return o.done + ' / ' + o.target + ' dni';
    if (k === 'read') return fmt(o.done, 0) + ' / ' + fmt(o.target, 0) + ' str.';
    return o.done + ' / ' + o.target;
  }

  /* ---------------- PULPIT ---------------- */
  function ring(pct, color) {
    var C = 2 * Math.PI * 45, off = C * (1 - Math.min(100, pct) / 100);
    return '<div class="rg-ring"><svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="45"/><circle class="fg" cx="50" cy="50" r="45" stroke="' + color + '" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/></svg><div class="ctr"><span class="pct">' + pct + '%</span><span class="lbl">tydzień</span></div></div>';
  }
  function freshChips(s) {
    var items = [['gym', 'fitness_center', 'Siłownia'], ['run', 'directions_run', 'Bieg'], ['kcal', 'restaurant', 'Kalorie'], ['read', 'menu_book', 'Czytanie'], ['body', 'monitor_weight', 'Waga']];
    return items.map(function (it) {
      var f = s.fresh[it[0]], cls = 'fresh', txt;
      if (!f.date) { cls = 'dead'; txt = 'brak danych'; }
      else {
        var lim = it[0] === 'gym' || it[0] === 'run' ? 14 : (it[0] === 'body' ? 14 : 4);
        cls = f.ago > lim * 3 ? 'dead' : (f.ago > lim ? 'stale' : 'fresh');
        txt = f.ago === 0 ? 'dziś' : (f.ago === 1 ? 'wczoraj' : dm(f.date) + ' (' + f.ago + ' dni temu)');
      }
      return '<span class="rg-chip ' + cls + '"><span class="material-symbols-outlined">' + it[1] + '</span>' + it[2] + ': ' + txt + '</span>';
    }).join('');
  }
  function matrixRow(k, w) {
    var o = w[k], g = G[k];
    var pct = o.target > 0 ? Math.min(100, Math.round(100 * o.done / o.target)) : 100;
    var cells = w.days.map(function (d) {
      var cls = 'rg-cell ' + k + (d.today ? ' today' : ''), txt = '';
      if (k === 'gym') { if (d.gym) { cls += ' has'; txt = d.gymMin ? Math.round(d.gymMin) + '′' : '✓'; if (d.gym > 1) txt += '×' + d.gym; } else if (d.future) cls += ' fut'; else txt = '·'; }
      else if (k === 'run') { if (d.km > 0) { cls += ' has'; txt = fmt(d.km); } else if (d.future) cls += ' fut'; else txt = '·'; }
      else if (k === 'read') { if (d.pages > 0) { cls += ' has'; txt = fmt(d.pages, 0); } else if (d.future) cls += ' fut'; else txt = '·'; }
      else {
        cls += ' kc-' + d.kcalState;
        if (d.kcal) txt = d.kcal; else if (d.kcalState === 'open') { if (d.future) cls += ' fut'; txt = d.today ? '…' : ''; } else txt = '?';
      }
      var tt = d.date + (k === 'kcal' && d.kcal ? ' · ' + d.kcal + ' kcal' + (d.protein ? ' · białko ' + Math.round(d.protein) + ' g' + (d.kcalState === 'lowp' ? ' (za mało)' : '') : ' · brak białka') : '');
      var act = d.future ? '' : ' data-act="cell" data-k="' + k + '" data-d="' + d.date + '" style="cursor:pointer"';
      return '<div class="' + cls + '" title="' + tt + '"' + act + '>' + txt + '</div>';
    }).join('');
    return '<div class="rg-mrow"><div class="rg-mname"><div class="t"><span class="material-symbols-outlined" style="color:' + g.color + '">' + g.ic + '</span>' + g.name + '</div>' +
      '<div class="val"><b>' + val(k, o).split(' / ')[0] + '</b> / ' + val(k, o).split(' / ')[1] + '</div>' +
      '<div class="rg-bar"><i style="width:' + pct + '%;background:' + (o.lvl === 'hit' ? 'var(--rg-hit)' : g.color) + '"></i></div></div>' + cells +
      '<div class="rg-mst"><span class="rg-st ' + o.lvl + '">' + LV[o.lvl] + '</span></div></div>';
  }
  function roadTile(w) {
    var title = (w.warm ? 'Rozgrzewka' : 'Tydzień ' + w.idx) + ' · ' + rng(w.mon) + (w.off ? ' · wolny (' + w.offReason + ')' : ' · wynik ' + w.score + '%') +
      '\n🏋 ' + w.gym.done + '/' + w.gym.target + '  🏃 ' + fmt(w.run.done) + '/' + w.run.target + ' km  🍽 ' + w.kcal.done + '/' + w.kcal.target + ' dni  📖 ' + fmt(w.read.done, 0) + '/' + w.read.target;
    var cls = 'rg-wk' + (w.closed ? ' closed' : '') + (w.phase === 'current' ? ' cur' : '') + (w.off ? ' off' : '');
    return '<div class="' + cls + '" title="' + esc(title) + '">' + ['gym', 'run', 'kcal', 'read'].map(function (k) { return '<i style="background:' + (w.phase === 'future' ? 'var(--rg-line)' : lvColor(w[k].lvl)) + '"></i>'; }).join('') + '</div>';
  }
  function roadHtml(s) {
    var warm = s.weeks.filter(function (w) { return w.warm; }), season = s.weeks.filter(function (w) { return !w.warm; });
    var h = '<div class="rg-road">';
    if (warm.length) h += '<div><div class="rg-road-lbl">Przed startem sezonu</div><div class="rg-road-warm">' + warm.map(roadTile).join('') + '</div></div>';
    
    for (var i = 0; i < season.length; i += 13) h += '<div><div class="rg-road-lbl">Tygodnie ' + (i + 1) + '–' + Math.min(season.length, i + 13) + ' · od ' + dm(season[i].mon) + '</div><div class="rg-road-grid">' + season.slice(i, i + 13).map(roadTile).join('') + '</div></div>';
    h += '</div><div class="rg-legend"><span>Kwadraciki: siłownia · bieg / kalorie · czytanie</span><span><span class="rg-lv lv-hit"></span>zaliczone</span><span><span class="rg-lv lv-part"></span>prawie / do tyłu</span><span><span class="rg-lv lv-miss"></span>pudło</span><span><span class="rg-lv lv-none"></span>przyszłość</span><span style="color:#b8860b">▣ złota ramka = tydzień zamknięty (średnia realizacji celów ≥ 100%)</span></div>';
    return h;
  }
  function renderHome() {
    var s = S(), w = s.cur, pct = w.score;
    var title, sub;
    if (!s.seasonStarted) { title = 'Rozgrzewka · ' + st.season.name; sub = 'Sezon rusza w pn ' + dmy(st.season.start) + ' — za ' + s.daysToStart + ' ' + R.plural(s.daysToStart, 'dzień', 'dni', 'dni') + '. Te tygodnie nie wliczają się do sezonu.'; }
    else if (w.warm) { title = 'Po sezonie'; sub = rng(w.mon); }
    else { title = 'Tydzień ' + w.idx + ' z ' + st.season.weeks; sub = rng(w.mon) + ' · ' + (w.left > 0 ? 'zostało ' + w.left + ' ' + R.plural(w.left, 'dzień', 'dni', 'dni') : 'koniec tygodnia'); }
    if (!s.seasonStarted) sub = rng(w.mon) + ' · ' + sub;
    var r12 = s.rates.all.w12;
    var rc = s.seasonStarted ? s.rates.all.season : s.rates.all.w12;
    var h = '';
    if (!st.goals.kcalConfirmed) h += '<div class="rg-alert"><span class="material-symbols-outlined">tune</span><div><b>Widełki kalorii są domyślne.</b></div></div>';
    h += '<div class="rg-card rg-hero">' + ring(pct, w.closed ? 'var(--rg-hit)' : 'var(--rg-acc)') +
      '<div><h2>' + esc(title) + '</h2><div class="sub">' + esc(sub) + '</div><div class="rg-fresh" style="margin-top:10px">' + freshChips(s) + '</div></div>' +
      '<div class="rg-kpis">' +
      '<div class="rg-kpi"><div class="k">Zamknięte tyg.</div><div class="v">' + (s.seasonStarted ? s.seasonClosed + '<small>/ ' + s.seasonDone + '</small>' : (r12.n ? r12.hits + '<small>/ ' + r12.n + '</small>' : '—')) + '</div></div>' +
      '<div class="rg-kpi"><div class="k">Seria</div><div class="v">' + s.streak + '<small>' + R.plural(s.streak, 'tydzień', 'tygodnie', 'tygodni') + '</small></div></div>' +
      '<div class="rg-kpi"><div class="k">Rekord serii</div><div class="v">' + s.bestStreak + '</div></div>' +
      '<div class="rg-kpi"><div class="k">Skuteczność</div><div class="v">' + (rc.pct == null ? '—' : rc.pct + '%') + '</div></div>' +
      '</div></div>';
    var vw = weekOff === 0 ? w : R.weekData(st, R.addDays(w.mon, 7 * weekOff), s.today);
    var navTitle = weekOff === 0 ? 'Ten tydzień' : (weekOff === -1 ? 'Poprzedni tydzień' : (weekOff === 1 ? 'Następny tydzień' : 'Tydzień'));
    h += '<div class="rg-card"><div class="rg-card-h"><div style="display:flex;align-items:center;gap:6px"><button class="rg-ibtn" style="color:var(--rg-ink2)" data-act="wk" data-o="-1" title="Wcześniejszy tydzień"><span class="material-symbols-outlined">chevron_left</span></button><h3>' + navTitle + ' · ' + rng(vw.mon) + '</h3><button class="rg-ibtn" style="color:var(--rg-ink2)" data-act="wk" data-o="1" title="Następny tydzień"><span class="material-symbols-outlined">chevron_right</span></button>' + (weekOff !== 0 ? '<button class="rg-hbtn sm" data-act="wk" data-o="0">Wróć do bieżącego</button>' : '') + '</div><span class="sub">' + (vw.off ? 'tydzień wolny — nie liczy się do serii' : 'wynik tygodnia: ' + vw.score + '% · kliknij komórkę, żeby dodać') + '</span></div><div class="rg-matrix">' +
      '<div class="rg-mrow head"><div class="rg-mname">Cel</div>' + vw.days.map(function (d, i) { return '<div class="c' + (d.today ? ' today' : '') + '" style="text-align:center">' + DAYS[i] + ' ' + (+d.date.slice(8)) + '</div>'; }).join('') + '<div class="rg-mst">Status</div></div>' +
      ['gym', 'run', 'kcal', 'read'].map(function (k) { return matrixRow(k, vw); }).join('') + '</div></div>';
    h += '<div class="rg-grid2"><div class="rg-card"><div class="rg-card-h"><h3>Do zrobienia</h3><span class="sub">do zamknięcia tygodnia brakuje ' + Math.max(0, 100 - s.cur.score) + ' pkt proc.</span></div>' + todoHtml(s) + '</div>' +
      '<div class="rg-card"><div class="rg-card-h"><h3>Konsekwencja</h3><span class="sub">% tygodni z zaliczonym celem</span></div><div class="rg-card-b" style="padding:0">' + ratesTable(s) + '</div></div></div>';
    h += '<div class="rg-card"><div class="rg-card-h"><h3>Droga do chwały</h3><span class="sub">' + esc(st.season.name) + ' · ' + st.season.weeks + ' tygodni od ' + dmy(st.season.start) + '</span></div><div class="rg-card-b">' + roadHtml(s) + '</div></div>';
    $('v-home').innerHTML = h;
  }
  function todoHtml(s) {
    if (s.cur.phase !== 'current') return '<div class="rg-empty">—</div>';
    if (!s.todo.length) return '<div class="rg-empty"><b>Tydzień zamknięty 🏆</b>Średnia realizacji celów ≥ 100%. Reszta tygodnia to bonus.</div>';
    return '<div class="rg-todo">' + s.todo.map(function (t) {
      return '<div class="rg-todo-i ' + t.lvl + '"><div class="dot" style="background:' + G[t.key].color + '"><span class="material-symbols-outlined">' + G[t.key].ic + '</span></div><div><div class="t">' + esc(t.title) + '</div><div class="s">' + esc(t.sub) + '</div></div></div>';
    }).join('') + '</div>';
  }
  function pctCell(r) {
    if (r.pct == null) return '<span class="rg-note">—</span>';
    var c = r.pct >= 80 ? 'var(--rg-hit)' : (r.pct >= 50 ? 'var(--rg-part)' : 'var(--rg-bad)');
    return '<div class="rg-pct"><b class="rg-mono" style="min-width:36px">' + r.pct + '%</b><div class="rg-bar"><i style="width:' + r.pct + '%;background:' + c + '"></i></div></div><div class="rg-note" style="font-size:10.5px">' + r.hits + ' z ' + r.n + '</div>';
  }
  function ratesTable(s) {
    var rows = ['gym', 'run', 'kcal', 'read', 'all'].map(function (k) {
      var nm = k === 'all' ? '<b>Wszystkie 4</b>' : '<span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;color:' + G[k].color + '">' + G[k].ic + '</span> ' + G[k].name;
      return '<tr><td>' + nm + '</td><td>' + pctCell(s.rates[k].w4) + '</td><td>' + pctCell(s.rates[k].w12) + '</td><td>' + pctCell(s.rates[k].season) + '</td></tr>';
    }).join('');
    return '<div class="rg-scroll"><table class="rg-tbl"><thead><tr><th>Cel</th><th>4 tyg.</th><th>12 tyg.</th><th>Sezon</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  /* ---------------- KONSEKWENCJA ---------------- */
  function renderCons() {
    var s = S(), h = '';
    // porównanie lat
    var legacy = null;
    try { legacy = JSON.parse(localStorage.getItem(R.LEGACY_KEY) || 'null'); } catch (e) { }
    var ls = R.legacyStats(legacy) || [];
    var seasonNow = s.weeks.filter(function (w) { return !w.warm && w.phase === 'past' && !w.off; });
    var cur = { year: '2027', weeks: seasonNow.length, closed: seasonNow.filter(function (w) { return w.closed; }).length, gym: seasonNow.filter(function (w) { return w.gym.lvl === 'hit'; }).length, run: seasonNow.filter(function (w) { return w.run.lvl === 'hit'; }).length, read: seasonNow.filter(function (w) { return w.read.lvl === 'hit'; }).length, kcal: seasonNow.filter(function (w) { return w.kcal.lvl === 'hit'; }).length, gymSum: 0, kmSum: 0, pagesSum: 0 };
    seasonNow.forEach(function (w) { cur.gymSum += w.gym.done; cur.kmSum += w.run.done; cur.pagesSum += w.read.done; });
    function yearCard(y, now) {
      var n = y.weeks || 0, avg = function (v) { return n ? fmt(v / n) : '—'; }, pc = n ? Math.round(100 * y.closed / n) : null;
      return '<div class="rg-year' + (now ? ' now' : '') + '"><h4>' + (now ? '🏁 ' : '') + y.year + (now ? ' (Road to Glory)' : ' (archiwum)') + '</h4><div class="big">' + (pc == null ? '—' : pc + '%') + '</div><div class="rg-note" style="margin-bottom:8px">zamkniętych tygodni (' + y.closed + ' z ' + n + ')</div>' +
        '<div class="row"><span>Siłownia ≥ cel</span><b>' + y.gym + ' tyg.</b></div><div class="row"><span>Bieg ≥ cel</span><b>' + y.run + ' tyg.</b></div>' +
        (now ? '<div class="row"><span>Kalorie ≥ cel</span><b>' + y.kcal + ' tyg.</b></div>' : '') + '<div class="row"><span>Czytanie ≥ cel</span><b>' + y.read + ' tyg.</b></div>' +
        '<div class="row"><span>Średnio / tydzień</span><b>' + avg(y.gymSum) + ' tren. · ' + avg(y.kmSum) + ' km · ' + avg(y.pagesSum) + ' str.</b></div></div>';
    }
    h += '<div class="rg-card"><div class="rg-card-h"><h3>Porównanie z poprzednimi latami</h3><span class="sub">stare dane z modułu Progres — bez kalorii (nie były śledzone)</span></div><div class="rg-card-b"><div class="rg-years">' +
      ls.slice(-2).map(function (y) { return yearCard(y, false); }).join('') + yearCard(cur, true) + '</div>' +
      (ls.length ? '<p class="rg-note" style="margin:12px 0 0">Archiwum: <a href="trainings-legacy.html">otwórz stary moduł Progres</a> (dane nietknięte, bez edycji tutaj). Tydzień zamknięty = średnia realizacji celów ≥ 100% (nadwyżka pokrywa braki; w 2027 doszły kalorie, liczone maks. do 100%).</p>' : '') + '</div></div>';
    h += '<div class="rg-grid2"><div class="rg-card"><div class="rg-card-h"><h3>Konsekwencja</h3><span class="sub">% tygodni z zaliczonym celem</span></div><div style="padding:0">' + ratesTable(s) + '</div></div>' +
      '<div class="rg-card"><div class="rg-card-h"><h3>Wynik tygodni</h3><span class="sub">% realizacji 4 celów</span></div><div class="rg-card-b"><div class="rg-chart sm"><canvas id="ch-weeks"></canvas></div></div></div></div>';
    // miesiące
    var mrows = s.months.slice().reverse().map(function (m) {
      var ym = m.ym.split('-');
      return '<tr><td><b>' + MONL[+ym[1] - 1] + ' ' + ym[0] + '</b></td><td class="c">' + m.weeks + '</td><td class="c"><b>' + m.closed + '</b> / ' + m.weeks + '</td>' +
        ['gym', 'run', 'kcal', 'read'].map(function (k) { return '<td class="c">' + m[k] + ' / ' + m.weeks + '</td>'; }).join('') +
        '<td class="r rg-mono">' + fmt(m.gymSum / m.weeks) + ' tren. · ' + fmt(m.kmSum / m.weeks) + ' km · ' + fmt(m.pagesSum / m.weeks, 0) + ' str.</td></tr>';
    }).join('');
    h += '<div class="rg-card"><div class="rg-card-h"><h3>Miesiące</h3><span class="sub">tydzień należy do miesiąca, w którym wypada jego czwartek</span></div><div class="rg-scroll"><table class="rg-tbl"><thead><tr><th>Miesiąc</th><th class="c">Tyg.</th><th class="c">Zamknięte</th><th class="c">Siłownia</th><th class="c">Bieg</th><th class="c">Kalorie</th><th class="c">Czytanie</th><th class="r">Średnio / tydzień</th></tr></thead><tbody>' +
      (mrows || '<tr><td colspan="8" class="rg-empty">Brak zakończonych tygodni.</td></tr>') + '</tbody></table></div></div>';
    // tygodnie
    var wrows = s.weeks.filter(function (w) { return w.phase !== 'future'; }).reverse().map(function (w) {
      var cell = function (k) { var o = w[k]; return '<td class="c"><span class="rg-lv lv-' + o.lvl + '"></span>' + (k === 'run' ? fmt(o.done) + ' / ' + o.target : (k === 'read' ? fmt(o.done, 0) + ' / ' + o.target : o.done + ' / ' + o.target)) + '</td>'; };
      return '<tr class="' + (w.phase === 'current' ? 'cur ' : '') + (w.off ? 'off' : '') + '"><td><b>' + (w.warm ? 'Rozgrz.' : 'T' + w.idx) + '</b> <span class="rg-note">' + rng(w.mon) + '</span></td>' + cell('gym') + cell('run') + cell('kcal') + cell('read') +
        '<td><div class="rg-pct"><b class="rg-mono" style="min-width:34px">' + w.score + '%</b><div class="rg-bar"><i style="width:' + w.score + '%;background:' + (w.closed ? 'var(--rg-hit)' : 'var(--rg-acc)') + '"></i></div></div></td>' +
        '<td class="c">' + (w.closed ? '🏆' : (w.off ? '<span class="rg-note">wolny</span>' : '')) + '</td>' +
        '<td class="r"><button class="rg-hbtn sm" data-act="off" data-mon="' + w.mon + '">' + (w.off ? 'Cofnij wolny' : 'Wolny') + '</button></td></tr>';
    }).join('');
    h += '<div class="rg-card"><div class="rg-card-h"><h3>Wszystkie tygodnie</h3><span class="sub">„Wolny” = urlop/choroba; tydzień nie psuje serii i nie wlicza się do statystyk</span></div><div class="rg-scroll"><table class="rg-tbl"><thead><tr><th>Tydzień</th><th class="c">Siłownia</th><th class="c">Bieg km</th><th class="c">Kalorie dni</th><th class="c">Strony</th><th>Wynik</th><th class="c"></th><th></th></tr></thead><tbody>' +
      (wrows || '<tr><td colspan="8" class="rg-empty">Jeszcze nic.</td></tr>') + '</tbody></table></div></div>';
    $('v-cons').innerHTML = h;
    drawWeeksChart(s);
  }
  function mkChart(id, cfg) {
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
    var el = $(id); if (!el) return;
    if (typeof Chart === 'undefined') { el.parentNode.innerHTML = '<div class="rg-empty">Wykres wymaga Chart.js (brak połączenia z siecią).</div>'; return; }
    charts[id] = new Chart(el, cfg);
  }
  function drawWeeksChart(s) {
    var wk = s.weeks.filter(function (w) { return w.phase !== 'future' && !w.off; }).slice(-26);
    mkChart('ch-weeks', {
      type: 'bar', data: { labels: wk.map(function (w) { return dm(w.mon); }), datasets: [{ label: 'Wynik %', data: wk.map(function (w) { return w.score; }), backgroundColor: wk.map(function (w) { return w.closed ? '#0b8a4a' : (w.phase === 'current' ? '#7da7e8' : '#0057c0'); }), borderRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, ticks: { callback: function (v) { return v + '%'; } } }, x: { ticks: { maxRotation: 0, autoSkip: true } } } }
    });
  }

  /* ---------------- CIAŁO ---------------- */
  function renderBody() {
    var b = R.bodyAll(st), today = R.today(), h = '';
    var last = b[b.length - 1];
    function nearest(daysAgo, key) { var t = R.addDays(today, -daysAgo), best = null; b.forEach(function (x) { if (x[key] != null && x.date <= t) best = x; }); return best; }
    function delta(key, d) { if (!last || last[key] == null) return null; var o = nearest(d, key); return o ? last[key] - o[key] : null; }
    function dTxt(v, goodDown) { if (v == null) return '<div class="d">—</div>'; var good = goodDown ? v < 0 : v > 0, cls = Math.abs(v) < 0.05 ? '' : (good ? 'good' : 'bad'); return '<div class="d ' + cls + '">' + (v > 0 ? '+' : '') + fmt(v) + ' vs 30 dni temu</div>'; }
    if (last && R.diffDays(today, last.date) > 14) h += '<div class="rg-alert bad"><span class="material-symbols-outlined">sync_problem</span><div><b>Ostatni pomiar: ' + dmy(last.date) + ' (' + R.diffDays(today, last.date) + ' dni temu).</b> Waga Zepp nie synchronizuje się ze Zdrowiem albo nie ważysz się regularnie — bez świeżych pomiarów nie widać efektu rekompozycji.</div></div>';
    if (!last) h += '<div class="rg-alert info"><span class="material-symbols-outlined">info</span><div>Brak pomiarów w nowym module. Dodaj pierwszy przyciskiem „Wpis” albo wyślij mi eksport — dołożę wagę, BF % i masę beztłuszczową.</div></div>';
    var fatKg = last && last.weight != null && last.bf != null ? last.weight * last.bf / 100 : null;
    h += '<div class="rg-card"><div class="rg-bkpis">' +
      '<div class="rg-bkpi"><div class="k">Waga</div><div class="v">' + (last && last.weight != null ? fmt(last.weight) + ' kg' : '—') + '</div>' + dTxt(delta('weight', 30), true) + '</div>' +
      '<div class="rg-bkpi"><div class="k">Tkanka tłuszczowa</div><div class="v">' + (last && last.bf != null ? fmt(last.bf) + '%' : '—') + '</div>' + dTxt(delta('bf', 30), true) + (fatKg ? '<div class="d">≈ ' + fmt(fatKg) + ' kg tłuszczu</div>' : '') + '</div>' +
      '<div class="rg-bkpi"><div class="k">Masa beztłuszczowa</div><div class="v">' + (last && last.lean != null ? fmt(last.lean) + ' kg' : '—') + '</div>' + dTxt(delta('lean', 30), false) + '</div>' +
      '<div class="rg-bkpi"><div class="k">Talia</div><div class="v">' + (last && last.waist != null ? fmt(last.waist) + ' cm' : '—') + '</div>' + (last && last.waist != null ? dTxt(delta('waist', 30), true) : '<div class="d">dodaj pomiar centymetrem raz w tygodniu</div>') + '</div>' +
      '</div></div>';
    var cp = R.composition(st, today), col = { good: 'var(--rg-hit)', warn: 'var(--rg-part)', bad: 'var(--rg-bad)', info: 'var(--rg-mut2)' };
    function dt(v, goodDown) { if (v == null) return '—'; var g = goodDown == null ? '' : ((v < -0.05) === goodDown && Math.abs(v) >= 0.3 ? 'color:var(--rg-hit)' : (Math.abs(v) >= 0.3 ? 'color:var(--rg-bad)' : '')); return '<b style="' + g + '">' + (v > 0 ? '+' : '') + fmt(v, 1) + ' kg</b>'; }
    h += '<div class="rg-card"><div class="rg-card-h"><h3>Czy chudnę z tłuszczu, czy z mięśni?</h3><span class="sub">średnie z pomiarów: ostatnie 4 tyg. vs poprzednie 4 tyg.</span></div>' +
      (cp.ok ? '<div class="rg-card-b"><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:12px"><div class="rg-year"><div class="rg-note">Waga</div><div class="big" style="font-size:20px">' + dt(cp.d.weight, null) + '</div><div class="rg-note">' + fmt(cp.A.weight, 1) + ' kg (z ' + cp.A.n + ' pomiarów)</div></div>' +
        '<div class="rg-year"><div class="rg-note">Tłuszcz</div><div class="big" style="font-size:20px">' + dt(cp.d.fat, true) + '</div><div class="rg-note">' + fmt(cp.A.fat, 1) + ' kg · ' + fmt(cp.A.bf, 1) + '% BF</div></div>' +
        '<div class="rg-year"><div class="rg-note">Masa beztłuszczowa</div><div class="big" style="font-size:20px">' + dt(cp.d.lean, false) + '</div><div class="rg-note">' + fmt(cp.A.lean, 1) + ' kg</div></div></div>' +
        '<div class="rg-alert" style="background:var(--rg-surf);border-color:var(--rg-line);color:var(--rg-ink)"><span class="material-symbols-outlined" style="color:' + col[cp.lvl] + '">' + ({ good: 'check_circle', warn: 'warning', bad: 'error', info: 'info' }[cp.lvl]) + '</span><div><b>' + esc(cp.title) + '.</b> ' + esc(cp.text) + '</div></div></div>'
        : '<div class="rg-card-b"><p class="rg-note" style="margin:0">Za mało danych: ' + esc(cp.reason) + '. Idealny układ do osiągnięcia: <b>waga ↓, BF ↓, masa beztłuszczowa → lub ↑</b>.</p></div>') + '</div>';
    h += '<div class="rg-card"><div class="rg-card-h"><h3>Tłuszcz vs masa beztłuszczowa</h3><span class="sub">kg, średnie tygodniowe · idealnie: tłuszcz ↓, beztłuszczowa → lub ↑ · beztłuszczowa ≈ mięśnie + kości + woda (mięśnie ≈ beztłuszczowa − 3 kg)</span></div><div class="rg-card-b"><div class="rg-chart"><canvas id="ch-comp"></canvas></div></div></div>';
    h += '<div class="rg-card"><div class="rg-card-h"><h3>Waga i tkanka tłuszczowa</h3><span class="sub">średnia z pomiarów w tygodniu (liczba pomiarów w podpowiedzi) · dane z archiwum 2026 są dołączone</span></div><div class="rg-card-b"><div class="rg-chart"><canvas id="ch-body"></canvas></div></div></div>';
    h += '<div class="rg-card"><div class="rg-card-h"><h3>Pomiary</h3><button class="rg-hbtn sm primary" data-act="add" data-t="body"><span class="material-symbols-outlined">add</span>Pomiar</button></div><div class="rg-scroll"><table class="rg-tbl"><thead><tr><th>Data</th><th class="r">Waga</th><th class="r">BF %</th><th class="r">Beztłuszcz.</th><th class="r">Talia</th><th></th></tr></thead><tbody>' +
      (b.slice(-20).reverse().map(function (x) { return '<tr><td>' + dmy(x.date) + '</td><td class="r rg-mono">' + (x.weight != null ? fmt(x.weight) : '—') + '</td><td class="r rg-mono">' + (x.bf != null ? fmt(x.bf) : '—') + '</td><td class="r rg-mono">' + (x.lean != null ? fmt(x.lean) : '—') + '</td><td class="r rg-mono">' + (x.waist != null ? fmt(x.waist) : '—') + '</td><td class="r">' + (x.arch ? '<span class="rg-note">archiwum</span>' : '<button class="rg-ibtn" data-act="delbody" data-d="' + x.date + '"><span class="material-symbols-outlined">delete</span></button>') + '</td></tr>'; }).join('') || '<tr><td colspan="6" class="rg-empty">Brak pomiarów.</td></tr>') + '</tbody></table></div></div>';
    $('v-body').innerHTML = h;
    // wykres: średnie tygodniowe (kropka = tydzień; w podpowiedzi liczba pomiarów)
    var wb = R.weeklyBody(b).slice(-40), ds = [];
    ds.push({ label: 'Waga (kg, średnia tyg.)', data: wb.map(function (x) { return x.weight == null ? null : Math.round(x.weight * 100) / 100; }), borderColor: '#0057c0', backgroundColor: '#0057c0', yAxisID: 'y', tension: 0, spanGaps: false, pointRadius: 4 });
    ds.push({ label: 'BF (%, średnia tyg.)', data: wb.map(function (x) { return x.bf == null ? null : Math.round(x.bf * 10) / 10; }), borderColor: '#ea580c', backgroundColor: '#ea580c', yAxisID: 'y2', tension: 0, spanGaps: false, pointRadius: 4 });
    mkChart('ch-body', { type: 'line', data: { labels: wb.map(function (x) { return dm(x.mon); }), datasets: ds }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { callbacks: { afterBody: function (it) { var x = wb[it[0].dataIndex]; return x ? 'pomiarów w tygodniu: ' + x.n : ''; } } } }, scales: { y: { position: 'left', title: { display: true, text: 'kg' } }, y2: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '% BF' } }, x: { ticks: { maxTicksLimit: 12, maxRotation: 0 } } } } });
    var rd = function (v, d) { return v == null ? null : Math.round(v * d) / d; };
    mkChart('ch-comp', { type: 'line', data: { labels: wb.map(function (x) { return dm(x.mon); }), datasets: [
      { label: 'Tłuszcz (kg)', data: wb.map(function (x) { return rd(x.fat, 100); }), borderColor: '#ea580c', backgroundColor: '#ea580c', yAxisID: 'y', tension: 0, spanGaps: false, pointRadius: 4 },
      { label: 'Masa beztłuszczowa (kg)', data: wb.map(function (x) { return rd(x.lean, 100); }), borderColor: '#0b8a4a', backgroundColor: '#0b8a4a', yAxisID: 'y2', tension: 0, spanGaps: false, pointRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { callbacks: { afterBody: function (it) { var x = wb[it[0].dataIndex]; return x ? 'pomiarów w tygodniu: ' + x.n : ''; } } } }, scales: { y: { position: 'left', title: { display: true, text: 'tłuszcz, kg' } }, y2: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'beztłuszczowa, kg' } }, x: { ticks: { maxTicksLimit: 12, maxRotation: 0 } } } } });
  }

  /* ---------------- DZIENNIK ---------------- */
  function renderLog() {
    var rows = [];
    st.workouts.forEach(function (w) { rows.push({ d: w.date, t: 'w', id: w.id, k: w.kind, w: w }); });
    Object.keys(st.days).forEach(function (d) { var x = st.days[d]; if (x && (x.kcal || x.pages || x.protein)) rows.push({ d: d, t: 'd', x: x }); });
    st.body.forEach(function (b) { rows.push({ d: b.date, t: 'b', b: b }); });
    rows.sort(function (a, b) { return a.d < b.d ? 1 : (a.d > b.d ? -1 : 0); });
    var h = '<div class="rg-card"><div class="rg-card-h"><h3>Dziennik</h3><button class="rg-hbtn sm primary" data-act="add"><span class="material-symbols-outlined">add</span>Wpis</button></div><div class="rg-scroll"><table class="rg-tbl"><thead><tr><th>Data</th><th>Typ</th><th>Szczegóły</th><th>Źródło</th><th></th></tr></thead><tbody>' +
      (rows.slice(0, 120).map(function (r) {
        var ty, det, src = '', del;
        if (r.t === 'w') { var w = r.w; ty = r.k === 'gym' ? 'Siłownia' : (r.k === 'run' ? 'Bieg' : 'Inny'); det = [w.min ? w.min + ' min' : '', w.km ? fmt(w.km) + ' km' : '', w.avgHr ? 'tętno ' + Math.round(w.avgHr) : '', w.kcal ? Math.round(w.kcal) + ' kcal' : ''].filter(Boolean).join(' · '); src = w.src || 'ręcznie'; del = 'data-act="delw" data-id="' + esc(r.id) + '"'; }
        else if (r.t === 'd') { var x = r.x; ty = 'Dzień'; det = [x.kcal ? Math.round(x.kcal) + ' kcal' : '', x.protein ? 'białko ' + Math.round(x.protein) + ' g' : '', x.pages ? x.pages + ' str.' : '', x.steps ? Math.round(x.steps) + ' kroków' : ''].filter(Boolean).join(' · '); del = 'data-act="delday" data-d="' + r.d + '"'; }
        else { var b = r.b; ty = 'Pomiar'; det = [b.weight != null ? fmt(b.weight) + ' kg' : '', b.bf != null ? fmt(b.bf) + '% BF' : '', b.lean != null ? fmt(b.lean) + ' kg beztł.' : '', b.waist != null ? 'talia ' + fmt(b.waist) : ''].filter(Boolean).join(' · '); del = 'data-act="delbody" data-d="' + r.d + '"'; }
        return '<tr><td>' + dmy(r.d) + '</td><td>' + ty + '</td><td>' + esc(det) + '</td><td class="rg-note">' + esc(src) + '</td><td class="r"><button class="rg-ibtn" ' + del + '><span class="material-symbols-outlined">delete</span></button></td></tr>';
      }).join('') || '<tr><td colspan="5" class="rg-empty">Pusto. Dodaj wpis albo wczytaj paczkę danych w Ustawieniach.</td></tr>') + '</tbody></table></div></div>';
    $('v-log').innerHTML = h;
  }

  /* ---------------- USTAWIENIA ---------------- */
  function renderSet() {
    var g = st.goals, h = '';
    function inp(id, label, v, step) { return '<div class="rg-ff"><label>' + label + '</label><input id="' + id + '" type="number" step="' + (step || 1) + '" value="' + v + '"></div>'; }
    h += '<div class="rg-card"><div class="rg-card-h"><h3>Cele tygodniowe</h3></div><div class="rg-card-b"><div class="rg-set">' +
      inp('g-gym', 'Siłownia (treningi / tydz.)', g.gymPerWeek) + inp('g-gymmin', 'Min. długość treningu (min)', g.gymMinMinutes) +
      inp('g-run', 'Bieganie (km / tydz.)', g.runKmPerWeek, 0.5) + inp('g-read', 'Czytanie (stron / tydz.)', g.pagesPerWeek, 10) +
      inp('g-kmin', 'Kalorie — od (kcal)', g.kcalMin, 50) + inp('g-kmax', 'Kalorie — do (kcal)', g.kcalMax, 50) + inp('g-prot', 'Białko — minimum (g / dzień)', g.proteinMin, 5) + inp('g-steps', 'Kroki — cel (dziennie)', g.stepsTarget, 500) + inp('g-sleep', 'Sen — cel (godziny)', g.sleepTarget, 0.5) + inp('g-kdays', 'Dni w normie / tydz.', g.kcalDaysPerWeek) +
      '<div class="rg-ff"><label>Start sezonu (poniedziałek)</label><input id="g-start" type="date" value="' + st.season.start + '"></div></div>' +
      '<p class="rg-note" style="margin:12px 0 0">Dzień „w normie” = kcal w widełkach i białko ≥ minimum (gdy wpisane; brak białka w danych nie blokuje dnia). Trening siłowy z zegarka krótszy niż minimum nie jest liczony. Zmiana celów przelicza także tygodnie wstecz.</p>' +
      '<div style="margin-top:12px"><button class="rg-hbtn primary" data-act="savegoals"><span class="material-symbols-outlined">save</span>Zapisz cele</button></div></div></div>';
    var offs = Object.keys(st.offWeeks).sort();
    h += '<div class="rg-card"><div class="rg-card-h"><h3>Tygodnie wolne</h3><span class="sub">urlop, choroba — nie psują serii</span></div><div class="rg-card-b">' +
      (offs.length ? offs.map(function (m) { return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--rg-line)"><span>' + rng(m) + ' <span class="rg-note">' + esc(st.offWeeks[m]) + '</span></span><button class="rg-ibtn" data-act="off" data-mon="' + m + '"><span class="material-symbols-outlined">close</span></button></div>'; }).join('') : '<p class="rg-note" style="margin:0 0 8px">Brak. Możesz też oznaczyć tydzień w zakładce Konsekwencja.</p>') +
      '<div class="rg-ffg" style="margin-top:12px;align-items:end"><div class="rg-ff"><label>Dzień w tygodniu</label><input type="date" id="off-d"></div><div class="rg-ff"><label>Powód</label><input id="off-r" placeholder="urlop"></div></div><div style="margin-top:10px"><button class="rg-hbtn" data-act="addoff">Dodaj tydzień wolny</button></div></div></div>';
    h += '<div class="rg-card"><div class="rg-card-h"><h3>Dane i kopie</h3></div><div class="rg-card-b"><p class="rg-note" style="margin-top:0">Paczkę z danymi (treningi z zegarka, kalorie, strony, waga) przygotowuje Claude jako plik JSON — wczytanie jest bezpieczne, uzupełnia wpisy i nie nadpisuje reszty. Pełny backup aplikacji (Dashboard → Eksport) zawiera te dane razem z resztą.</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><label class="rg-hbtn primary" style="cursor:pointer"><span class="material-symbols-outlined">upload_file</span>Wczytaj paczkę danych<input type="file" id="imp-file" accept="application/json,.json" hidden></label><button class="rg-hbtn" data-act="export"><span class="material-symbols-outlined">download</span>Pobierz dane RTG</button><a class="rg-hbtn" href="trainings-legacy.html"><span class="material-symbols-outlined">history</span>Archiwum 2026</a><button class="rg-hbtn danger" data-act="reset"><span class="material-symbols-outlined">delete_forever</span>Wyczyść dane RTG</button></div></div></div>';
    $('v-set').innerHTML = h;
  }


  /* ---------------- ZDROWIE ---------------- */
  function renderHealth() {
    var today = R.today(), hl = R.health(st, today), c = hl.cur, b = hl.base, h = '';
    function kpi(label, cur, base, unit, d, goodUp) {
      var v = cur.avg == null ? '—' : fmt(cur.avg, d) + ' <small style="font-size:12px;color:var(--rg-mut)">' + unit + '</small>';
      var dl = '';
      if (cur.avg != null && base.avg != null) { var x = cur.avg - base.avg, cls = Math.abs(x) < 0.01 * base.avg ? '' : ((x > 0) === goodUp ? 'good' : 'bad'); dl = '<div class="d ' + cls + '">' + (x > 0 ? '+' : '') + fmt(x, d) + ' vs poprz. 4 tyg.</div>'; }
      else dl = '<div class="d">' + (cur.n ? 'brak bazy do porównania' : 'brak danych (7 dni)') + '</div>';
      return '<div class="rg-bkpi"><div class="k">' + label + '</div><div class="v">' + v + '</div>' + dl + '<div class="d" style="font-size:11px">' + cur.n + ' z 7 dni z danymi</div></div>';
    }
    h += '<div class="rg-card"><div class="rg-bkpis">' + kpi('Kroki / dzień', c.steps, b.steps, '', 0, true) + kpi('Sen', c.sleepH, b.sleepH, 'h', 1, true) + kpi('Tętno spoczynkowe', c.rhr, b.rhr, 'bpm', 0, false) + kpi('HRV', c.hrv, b.hrv, 'ms', 0, true) + '</div></div>';
    h += '<div class="rg-card"><div class="rg-card-h"><h3>Wnioski</h3><span class="sub">z ostatnich 7 dni vs poprzednie 4 tygodnie</span></div>' +
      (hl.insights.length ? '<div class="rg-todo">' + hl.insights.map(function (i) {
        var col = { good: 'var(--rg-hit)', warn: 'var(--rg-part)', bad: 'var(--rg-bad)', info: 'var(--rg-mut2)' }[i.lvl], ic = { good: 'check_circle', warn: 'warning', bad: 'error', info: 'info' }[i.lvl];
        return '<div class="rg-todo-i"><div class="dot" style="background:' + col + '"><span class="material-symbols-outlined">' + ic + '</span></div><div><div class="t">' + esc(i.title) + '</div><div class="s">' + esc(i.text) + '</div></div></div>';
      }).join('') + '</div>' : '<div class="rg-empty">Za mało danych na wnioski. Wczytaj eksport z Health Auto Export.</div>') +
      '<div class="rg-card-b" style="border-top:1px solid var(--rg-line)"><p class="rg-note" style="margin:0">To obserwacje z danych, nie diagnoza. Utrzymujące się odchylenia tętna/HRV z objawami omów z lekarzem.</p></div></div>';
    h += '<div class="rg-grid2"><div class="rg-card"><div class="rg-card-h"><h3>Kroki</h3><span class="sub">ostatnie 8 tygodni, cel ' + fmt(st.goals.stepsTarget, 0) + '</span></div><div class="rg-card-b"><div class="rg-chart sm"><canvas id="ch-steps"></canvas></div></div></div>' +
      '<div class="rg-card"><div class="rg-card-h"><h3>Sen</h3><span class="sub">godziny na dobę, cel ' + fmt(st.goals.sleepTarget) + ' h</span></div><div class="rg-card-b"><div class="rg-chart sm"><canvas id="ch-sleep"></canvas></div></div></div></div>' +
      '<div class="rg-card"><div class="rg-card-h"><h3>Tętno spoczynkowe i HRV</h3><span class="sub">średnie tygodniowe, ostatnie 26 tygodni</span></div><div class="rg-card-b"><div class="rg-chart sm"><canvas id="ch-hr"></canvas></div></div></div>';
    $('v-health').innerHTML = h;
    // dane do wykresów
    var from = R.addDays(R.mondayOf(today), -7 * 7), labels = [], steps = [], sleep = [];
    for (var d = from; d <= today; d = R.addDays(d, 1)) { var x = st.days[d] || {}; labels.push(dm(d)); steps.push(R.num(x.steps) > 0 ? Math.round(x.steps) : null); sleep.push(R.num(x.sleepH) > 0 ? R.num(x.sleepH) : null); }
    var tgt = function (v) { return labels.map(function () { return v; }); };
    mkChart('ch-steps', { type: 'bar', data: { labels: labels, datasets: [{ label: 'Kroki', data: steps, backgroundColor: steps.map(function (v) { return v != null && v >= st.goals.stepsTarget ? '#0b8a4a' : '#7da7e8'; }), borderRadius: 2 }, { type: 'line', label: 'Cel', data: tgt(st.goals.stepsTarget), borderColor: '#c0362c', borderDash: [5, 4], borderWidth: 1.2, pointRadius: 0 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 8, maxRotation: 0 } } } } });
    mkChart('ch-sleep', { type: 'bar', data: { labels: labels, datasets: [{ label: 'Sen (h)', data: sleep, backgroundColor: sleep.map(function (v) { return v != null && v >= st.goals.sleepTarget ? '#0b8a4a' : (v != null && v < 6.5 ? '#c0362c' : '#e0a63a'); }), borderRadius: 2 }, { type: 'line', label: 'Cel', data: tgt(st.goals.sleepTarget), borderColor: '#334155', borderDash: [5, 4], borderWidth: 1.2, pointRadius: 0 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0 }, x: { ticks: { maxTicksLimit: 8, maxRotation: 0 } } } } });
    var wl = [], rh = [], hv = [], m0 = R.addDays(R.mondayOf(today), -7 * 25);
    for (var m = m0; m <= today; m = R.addDays(m, 7)) { var e = R.addDays(m, 6); wl.push(dm(m)); var a = R.avgField(st, m, e, 'rhr'), v = R.avgField(st, m, e, 'hrv'); rh.push(a.n ? Math.round(a.avg * 10) / 10 : null); hv.push(v.n ? Math.round(v.avg) : null); }
    mkChart('ch-hr', { type: 'line', data: { labels: wl, datasets: [{ label: 'Tętno spoczynkowe (bpm)', data: rh, borderColor: '#c0362c', backgroundColor: '#c0362c', yAxisID: 'y', spanGaps: true, tension: .25, pointRadius: 3 }, { label: 'HRV (ms)', data: hv, borderColor: '#0057c0', backgroundColor: '#0057c0', yAxisID: 'y2', spanGaps: true, tension: .25, pointRadius: 3 }] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { position: 'left', title: { display: true, text: 'bpm' } }, y2: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'ms' } }, x: { ticks: { maxTicksLimit: 9, maxRotation: 0 } } } } });
  }

  /* ---------------- SZYBKIE WPISY (klik w komórkę dnia) ---------------- */
  function closePop() { var p = $('pop'); if (p) p.remove(); }
  function wsOf(date, kind) { return st.workouts.filter(function (w) { return w.date === date && w.kind === kind; }); }
  function manualOf(date, kind) { return wsOf(date, kind).filter(function (w) { return !w.src || w.src === 'ręcznie'; })[0]; }
  function dayObj(date) { return st.days[date] || (st.days[date] = {}); }
  function openCell(el, k, date) {
    closePop();
    if (k === 'gym' && !wsOf(date, 'gym').length) {
      st.workouts.push({ id: 'w_' + date + '_gym_' + Date.now().toString(36), date: date, kind: 'gym', src: 'ręcznie' });
      persist(); renderAll(); toast('Siłownia ✓ ' + dm(date) + ' — kliknij ponownie, żeby edytować', 'ok'); return;
    }
    var pop = document.createElement('div'); pop.className = 'rg-pop'; pop.id = 'pop';
    var d = st.days[date] || {}, html = '<div class="rg-pop-h">' + { gym: 'Siłownia', run: 'Bieg', read: 'Czytanie', kcal: 'Kalorie i białko' }[k] + ' · ' + dm(date) + '</div>';
    if (k === 'gym') {
      var gs = wsOf(date, 'gym');
      html += gs.map(function (w, i) { return '<div class="rg-pop-r"><span>Trening ' + (i + 1) + ' · ' + (w.src && w.src !== 'ręcznie' ? esc(w.src) : 'ręcznie') + (w.min ? ' · ' + Math.round(w.min) + ' min' : '') + '</span><button class="rg-ibtn" data-act="popdelw" data-id="' + esc(w.id) + '" title="Usuń"><span class="material-symbols-outlined">delete</span></button></div>'; }).join('') +
        '<div class="rg-pop-r"><button class="rg-hbtn sm" data-act="popaddgym" data-d="' + date + '">+ kolejny trening</button></div>';
    } else if (k === 'run') {
      var mr = manualOf(date, 'run'), wr = wsOf(date, 'run').filter(function (w) { return w !== mr; });
      html += (wr.length ? '<div class="rg-note">Z zegarka: ' + wr.map(function (w) { return fmt(w.km || 0) + ' km'; }).join(', ') + '</div>' : '') + '<div class="rg-ff"><label>Dystans (km)' + (wr.length ? ' — dodatkowy' : '') + '</label><input id="pp-km" inputmode="decimal" value="' + (mr && mr.km ? mr.km : '') + '"></div>';
    } else if (k === 'read') {
      html += '<div class="rg-ff"><label>Przeczytane strony</label><input id="pp-pages" inputmode="decimal" value="' + (d.pages || '') + '"></div>';
    } else {
      html += '<div class="rg-ffg"><div class="rg-ff"><label>Kalorie</label><input id="pp-kcal" inputmode="decimal" value="' + (d.kcal || '') + '"></div><div class="rg-ff"><label>Białko (g)</label><input id="pp-prot" inputmode="decimal" value="' + (d.protein || '') + '"></div></div>';
    }
    if (k !== 'gym') html += '<div class="rg-pop-f"><button class="rg-hbtn sm" data-act="popclear" data-k="' + k + '" data-d="' + date + '">Wyczyść</button><button class="rg-hbtn sm primary" data-act="popsave" data-k="' + k + '" data-d="' + date + '">Zapisz</button></div>';
    else html += '<div class="rg-pop-f"><button class="rg-hbtn sm" data-act="popclose">Zamknij</button></div>';
    pop.innerHTML = html; document.body.appendChild(pop);
    var r = el.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.left + r.width / 2 - pw / 2)) + 'px';
    pop.style.top = Math.max(8, (r.bottom + ph + 12 > window.innerHeight ? r.top - ph - 6 : r.bottom + 6)) + 'px';
    var inp = pop.querySelector('input'); if (inp) { inp.focus(); inp.select(); }
    pop.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var sv = pop.querySelector('[data-act="popsave"]'); if (sv) sv.click(); } if (e.key === 'Escape') closePop(); });
  }
  function popSave(k, date) {
    var g = function (id) { var el = $(id); return el ? R.num(el.value) : null; };
    if (k === 'run') {
      var km = g('pp-km'), mr = manualOf(date, 'run');
      if (km > 0) { if (mr) mr.km = km; else st.workouts.push({ id: 'w_' + date + '_run_' + Date.now().toString(36), date: date, kind: 'run', km: km, src: 'ręcznie' }); }
      else if (mr) st.workouts = st.workouts.filter(function (w) { return w !== mr; });
    } else if (k === 'read') { var pg = g('pp-pages'), d1 = dayObj(date); if (pg > 0) d1.pages = pg; else delete d1.pages; }
    else if (k === 'kcal') { var d2 = dayObj(date), kc = g('pp-kcal'), pr = g('pp-prot'); if (kc > 0) d2.kcal = kc; else delete d2.kcal; if (pr > 0) d2.protein = pr; else delete d2.protein; }
    persist(); closePop(); renderAll(); toast('Zapisano', 'ok');
  }

  /* ---------------- AKCJE ---------------- */
  function renderAll() {
    ({ home: renderHome, cons: renderCons, body: renderBody, health: renderHealth, log: renderLog, set: renderSet })[tab]();
  }
  function setTab(t) {
    tab = t;
    document.querySelectorAll('.rg-tab').forEach(function (b) { b.classList.toggle('on', b.dataset.v === t); });
    document.querySelectorAll('.rg-view').forEach(function (v) { v.classList.toggle('on', v.id === 'v-' + t); });
    try { localStorage.setItem('lifeos_rtg_tab', t); } catch (e) { }
    renderAll();
  }
  function openAdd(t) {
    logTab = t || logTab;
    var today = R.today();
    document.querySelectorAll('#log-seg button').forEach(function (b) { b.classList.toggle('on', b.dataset.t === logTab); });
    document.querySelectorAll('.lg-pane').forEach(function (p) { p.hidden = p.dataset.t !== logTab; });
    ['lw-date', 'ld-date', 'lb-date'].forEach(function (id) { if (!$(id).value) $(id).value = today; });
    $('m-add').classList.add('on');
  }
  function closeAdd() { $('m-add').classList.remove('on'); }
  function val1(id) { var v = R.num($(id).value); return v; }
  function saveEntry() {
    if (logTab === 'workout') {
      var d = $('lw-date').value, k = $('lw-kind').value;
      if (!d) return toast('Podaj datę', 'err');
      var w = { date: d, kind: k, min: val1('lw-min'), src: 'ręcznie' };
      if (k === 'run') { w.km = val1('lw-km'); if (!(w.km > 0)) return toast('Podaj dystans biegu', 'err'); }
      if (val1('lw-hr')) w.avgHr = val1('lw-hr');
      w.id = 'w_' + d + '_' + k + '_' + Date.now().toString(36);
      st.workouts.push(w);
    } else if (logTab === 'day') {
      var dd = $('ld-date').value; if (!dd) return toast('Podaj datę', 'err');
      var x = st.days[dd] || {};
      [['ld-kcal', 'kcal'], ['ld-prot', 'protein'], ['ld-pages', 'pages'], ['ld-steps', 'steps']].forEach(function (p) { var v = val1(p[0]); if (v != null) x[p[1]] = v; });
      st.days[dd] = x;
    } else {
      var bd = $('lb-date').value; if (!bd) return toast('Podaj datę', 'err');
      var rec = { date: bd };
      [['lb-w', 'weight'], ['lb-bf', 'bf'], ['lb-lean', 'lean'], ['lb-waist', 'waist']].forEach(function (p) { var v = val1(p[0]); if (v != null) rec[p[1]] = v; });
      if (Object.keys(rec).length < 2) return toast('Podaj przynajmniej jedną wartość', 'err');
      var i = st.body.findIndex(function (z) { return z.date === bd; });
      if (i >= 0) Object.assign(st.body[i], rec); else st.body.push(rec);
    }
    persist(); closeAdd(); toast('Zapisano', 'ok'); renderAll();
  }
  function onClick(e) {
    if (!e.target.closest('#pop') && !e.target.closest('[data-act="cell"]')) closePop();
    var t = e.target.closest('[data-act]'); if (!t) return;
    var a = t.dataset.act;
    if (a === 'cell') openCell(t, t.dataset.k, t.dataset.d);
    else if (a === 'wk') { var o = +t.dataset.o; weekOff = o === 0 ? 0 : weekOff + o; renderAll(); }
    else if (a === 'popsave') popSave(t.dataset.k, t.dataset.d);
    else if (a === 'popclose') closePop();
    else if (a === 'popclear') { var kk = t.dataset.k, dd = t.dataset.d; if (kk === 'run') { st.workouts = st.workouts.filter(function (w) { return !(w.date === dd && w.kind === 'run' && (!w.src || w.src === 'ręcznie')); }); } else if (kk === 'read') delete dayObj(dd).pages; else { delete dayObj(dd).kcal; delete dayObj(dd).protein; } persist(); closePop(); renderAll(); }
    else if (a === 'popdelw') { st.workouts = st.workouts.filter(function (w) { return w.id !== t.dataset.id; }); persist(); closePop(); renderAll(); }
    else if (a === 'popaddgym') { st.workouts.push({ id: 'w_' + t.dataset.d + '_gym_' + Date.now().toString(36), date: t.dataset.d, kind: 'gym', src: 'ręcznie' }); persist(); closePop(); renderAll(); }
    else if (a === 'add') openAdd(t.dataset.t);
    else if (a === 'off') { var m = t.dataset.mon; if (st.offWeeks[m] != null) delete st.offWeeks[m]; else st.offWeeks[m] = 'wolny'; persist(); renderAll(); }
    else if (a === 'delw') { st.workouts = st.workouts.filter(function (w) { return w.id !== t.dataset.id; }); persist(); renderAll(); }
    else if (a === 'delday') { delete st.days[t.dataset.d]; persist(); renderAll(); }
    else if (a === 'delbody') { st.body = st.body.filter(function (b) { return b.date !== t.dataset.d; }); persist(); renderAll(); }
    else if (a === 'savegoals') {
      var g = st.goals, n = function (id, dv) { var v = R.num($(id).value); return v == null ? dv : v; };
      g.gymPerWeek = n('g-gym', g.gymPerWeek); g.gymMinMinutes = n('g-gymmin', g.gymMinMinutes); g.runKmPerWeek = n('g-run', g.runKmPerWeek); g.pagesPerWeek = n('g-read', g.pagesPerWeek);
      g.kcalMin = n('g-kmin', g.kcalMin); g.kcalMax = n('g-kmax', g.kcalMax); g.proteinMin = n('g-prot', g.proteinMin); g.stepsTarget = n('g-steps', g.stepsTarget); g.sleepTarget = n('g-sleep', g.sleepTarget); g.kcalDaysPerWeek = Math.max(1, Math.min(7, n('g-kdays', g.kcalDaysPerWeek)));
      if (g.kcalMin > g.kcalMax) return toast('„Od” musi być mniejsze niż „do”', 'err');
      g.kcalConfirmed = true;
      if ($('g-start').value) st.season.start = R.mondayOf($('g-start').value);
      persist(); toast('Cele zapisane', 'ok'); renderAll();
    }
    else if (a === 'addoff') { var od = $('off-d').value; if (!od) return toast('Wybierz dzień', 'err'); st.offWeeks[R.mondayOf(od)] = $('off-r').value || 'wolny'; persist(); renderAll(); }
    else if (a === 'export') { var blob = new Blob([JSON.stringify({ rtg: st }, null, 1)], { type: 'application/json' }); var l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = 'rtg_' + R.today() + '.json'; l.click(); URL.revokeObjectURL(l.href); }
    else if (a === 'reset') { if (confirm('Usunąć wszystkie dane Road to Glory (treningi, kalorie, strony, pomiary)? Archiwum 2026 zostaje.')) { st = R.normalize(null); persist(); toast('Wyczyszczono', 'ok'); renderAll(); } }
  }
  function onImport(ev) {
    var f = ev.target.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var p = JSON.parse(rd.result), rep = R.merge(st, p);
        if (!rep.workouts && !rep.days && !rep.body && !(p.rtg || p).goals && !(p.rtg || p).offWeeks) return toast('Plik nie zawiera danych RTG', 'err');
        persist(); toast('Wczytano: ' + rep.workouts + ' treningów' + (rep.replaced ? ' (' + rep.replaced + ' wpisów ręcznych zastąpiono danymi z zegarka)' : '') + ', ' + rep.days + ' dni, ' + rep.body + ' pomiarów', 'ok'); renderAll();
      } catch (e) { toast('Nieprawidłowy plik', 'err'); }
    };
    rd.readAsText(f); ev.target.value = '';
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.addEventListener('click', onClick);
    document.querySelectorAll('.rg-tab').forEach(function (b) { b.addEventListener('click', function () { setTab(b.dataset.v); }); });
    document.querySelectorAll('#log-seg button').forEach(function (b) { b.addEventListener('click', function () { openAdd(b.dataset.t); }); });
    $('lw-kind').addEventListener('change', function () { $('lw-km-wrap').hidden = this.value !== 'run'; });
    $('m-add').addEventListener('click', function (e) { if (e.target === this) closeAdd(); });
    $('btn-add').addEventListener('click', function () { openAdd(); });
    $('btn-close').addEventListener('click', closeAdd); $('btn-cancel').addEventListener('click', closeAdd);
    $('btn-save').addEventListener('click', saveEntry);
    document.addEventListener('change', function (e) { if (e.target.id === 'imp-file') onImport(e); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeAdd(); closePop(); } });
    var t0 = 'home'; try { t0 = localStorage.getItem('lifeos_rtg_tab') || 'home'; } catch (e) { }
    if (!{ home: 1, cons: 1, body: 1, health: 1, log: 1, set: 1 }[t0]) t0 = 'home';
    setTab(t0);
  });
  window.RTG_UI = { reload: function () { st = R.load(); renderAll(); } };
})();
