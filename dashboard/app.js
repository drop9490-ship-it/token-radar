// Token Radar's page: no framework, no network. It reads window.RADAR, the
// dataset main.ts writes beside it, and renders the board, the filters and
// the detail view. The value model itself lives in lib/radar.ts and is
// stated in full in the Model section of index.html; this file only renders
// what the model scored, and never re-scores a row.
//
// Implied value = TVL x sector multiple x growth x maturity x chains x risk, where
// the sector multiple is the category's fitted size curve (a log-log fit of
// market cap on TVL over the snapshot's own live-token protocols) blended in
// log space with the category's static median, the blend chosen per category
// by leave-one-out error, and risk is 0.90 for TVL under $10M, else 1.00.
// Implied FDV runs the same five factors over the sector FDV / TVL multiple
// (mcap / TVL x 12.5, the entry's stated listing assumption: 8% of supply
// circulating at listing). Net value = 20% x min($3,000, 0.01% of the
// LOW-END implied FDV — the 5th percentile of the 200 bootstrap refits)
// - all-in cost; Farm at +$100, Skip at -$100, Thin between.

(function () {
  'use strict';
  var D = window.RADAR;
  var boardEl = document.getElementById('rows');
  var countEl = document.getElementById('count');
  var noteEl = document.getElementById('board-note');
  var pagerEl = document.getElementById('pager');
  var chipsEl = document.getElementById('chips');
  var detailEl = document.getElementById('detail');
  var qEl = document.getElementById('q');
  var catEl = document.getElementById('category');
  var chainEl = document.getElementById('chain');
  var statusEl = document.getElementById('status');
  var minTvlEl = document.getElementById('mintvl');
  var viewBoardBtn = document.getElementById('view-board');
  var viewLiveBtn = document.getElementById('view-live');
  var theadTr = document.querySelector('#board thead tr');

  if (!D || !Array.isArray(D.rows)) {
    document.getElementById('meta').textContent = 'No radar data found: data.js did not load.';
    return;
  }

  var PAGE_SIZE = 50;
  var state = { q: '', category: '', chain: '', status: '', minTvl: 0, sortKey: 'rank', sortDir: 'asc', view: 'board', selected: null, page: 1 };

  /** HTML-escape a string from the snapshot before it meets innerHTML. */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** $1,708,486,574 -> $1.71B; $544,628 -> $545K. */
  function money(n) {
    if (n == null || !isFinite(n)) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  }

  function moneyFull(n) {
    if (n == null || !isFinite(n)) return '—';
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function pct(n) {
    if (n == null || !isFinite(n)) return '—';
    var v = (Math.round(n * 100) / 100).toFixed(1);
    return (n > 0 ? '+' : '') + v + '%';
  }

  function ageText(days) {
    if (days == null) return '—';
    if (days < 30) return days + 'd';
    if (days < 365) return Math.round(days / 30) + 'mo';
    return (days / 365).toFixed(1) + 'y';
  }

  function fmtMult(n) {
    return n == null ? '—' : (Math.round(n * 1000) / 1000).toFixed(3) + 'x';
  }

  // ---- header, KPI cards, source -----------------------------------------
  var fetched = (D.source || '').split('fetched ')[1] || '';
  document.getElementById('meta').textContent =
    'Snapshot as of ' + D.as_of + ' · ' + D.protocols_scanned + ' protocols scanned · ' +
    'watchlist floor $' + D.floor_usd.toLocaleString('en-US') + ' TVL · model ' + D.model_version;
  document.getElementById('source').textContent =
    'Source: DefiLlama protocols endpoint, fetched ' + fetched + '. ' +
    'The snapshot is sealed: every run reads the same bytes.';
  document.getElementById('stats').innerHTML =
    stat(money(D.watchlist_tvl_usd), 'watchlist TVL total') +
    stat(money(D.median_implied_fdv_usd), 'median implied FDV') +
    stat(D.board_size, 'pre-token protocols ranked') +
    stat(pct(D.top_mover.change_7d), 'top 7-day mover · ' + D.top_mover.name,
      'mover ' + (D.top_mover.change_7d >= 0 ? 'up' : 'down'));
  function stat(big, label, cls) {
    return '<div class="stat' + (cls ? ' ' + cls : '') + '"><b>' + esc(big) + '</b><span>' + esc(label) + '</span></div>';
  }

  // ---- filter options ------------------------------------------------------
  var cats = {};
  var chains = {};
  D.rows.forEach(function (r) {
    if (r.category) cats[r.category] = (cats[r.category] || 0) + 1;
    r.chains.forEach(function (c) { chains[c] = (chains[c] || 0) + 1; });
  });
  Object.keys(cats).sort().forEach(function (c) {
    catEl.insertAdjacentHTML('beforeend', '<option value="' + esc(c) + '">' + esc(c) + ' (' + cats[c] + ')</option>');
  });
  Object.keys(chains).sort().forEach(function (c) {
    chainEl.insertAdjacentHTML('beforeend', '<option value="' + esc(c) + '">' + esc(c) + ' (' + chains[c] + ')</option>');
  });

  // ---- sorting -------------------------------------------------------------
  // Every comparator below is ascending; sortedRows reverses for 'desc'.
  var SORTS = {
    rank: function (a, b) { return a.rank - b.rank; },
    name: function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; },
    category: function (a, b) { var x = a.category || '', y = b.category || ''; return x < y ? -1 : x > y ? 1 : a.rank - b.rank; },
    chains: function (a, b) { return a.chains.length - b.chains.length || a.rank - b.rank; },
    tvl: function (a, b) { return a.tvl_usd - b.tvl_usd; },
    growth: function (a, b) { return (a.change_7d == null ? -1e9 : a.change_7d) - (b.change_7d == null ? -1e9 : b.change_7d); },
    age: function (a, b) { return (a.age_days == null ? -1 : a.age_days) - (b.age_days == null ? -1 : b.age_days); },
    implied: function (a, b) { return a.implied_value_usd - b.implied_value_usd; },
    fdv: function (a, b) { return a.implied_fdv_usd - b.implied_fdv_usd; },
    verdict: function (a, b) { var o = { Farm: 0, Thin: 1, Skip: 2 }; return (o[a.verdict] - o[b.verdict]) || a.rank - b.rank; },
    status: function (a, b) { return (a.on_watchlist - b.on_watchlist) || a.rank - b.rank; },
  };
  var DESC_DEFAULT = { tvl: 1, growth: 1, age: 1, implied: 1, fdv: 1, chains: 1, status: 1 };

  function sortedRows(rows) {
    var fn = SORTS[state.sortKey] || SORTS.rank;
    var out = rows.slice().sort(fn);
    if (state.sortDir === 'desc') out.reverse();
    return out;
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    return sortedRows(rows);
  }

  // ---- filter chips --------------------------------------------------------
  function renderChips(total) {
    var chips = [];
    if (state.q) chips.push(chip('q', 'Search: ' + state.q));
    if (state.category) chips.push(chip('category', 'Category: ' + state.category));
    if (state.chain) chips.push(chip('chain', 'Chain: ' + state.chain));
    if (state.minTvl) chips.push(chip('minTvl', 'Min TVL: ' + money(state.minTvl)));
    if (state.status === 'live') chips.push(chip('status', 'Status: already trading'));
    var html = '';
    if (chips.length) {
      html = '<span class="chip-label">' + total + ' of ' + D.board_size + ' match</span>' + chips.join('') +
        '<button class="chip clear" type="button" data-clear="all">Clear all ×</button>';
    }
    chipsEl.innerHTML = html;
    function chip(key, label) {
      return '<button class="chip" type="button" data-clear="' + esc(key) + '">' + esc(label) + ' ×</button>';
    }
  }

  chipsEl.addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-clear]');
    if (!btn) return;
    var key = btn.getAttribute('data-clear');
    if (key === 'all') {
      state.q = ''; qEl.value = '';
      state.category = ''; catEl.value = '';
      state.chain = ''; chainEl.value = '';
      state.minTvl = 0; minTvlEl.value = '0';
      state.status = ''; statusEl.value = '';
      setView('board');
      return;
    }
    if (key === 'q') { state.q = ''; qEl.value = ''; }
    if (key === 'category') { state.category = ''; catEl.value = ''; }
    if (key === 'chain') { state.chain = ''; chainEl.value = ''; }
    if (key === 'minTvl') { state.minTvl = 0; minTvlEl.value = '0'; }
    if (key === 'status') { state.status = ''; statusEl.value = ''; setView('board'); return; }
    state.page = 1;
    renderBoard();
  });

  // ---- table headers -------------------------------------------------------
  var BOARD_HEAD = [
    ['rank', '#', 'num'], ['name', 'Protocol', ''], ['category', 'Category', ''],
    ['chains', 'Chains', ''], ['tvl', 'TVL', 'num'], ['growth', '7d', 'num'],
    ['age', 'Age', 'num'], ['implied', 'Implied mcap', 'num'], ['fdv', 'Implied FDV', 'num'],
    ['verdict', 'Verdict', ''], ['status', 'Status', ''],
  ];
  var LIVE_HEAD = [
    ['rank', '#', 'num'], ['name', 'Protocol', ''], ['category', 'Category', ''],
    ['chains', 'Chains', ''], ['tvl', 'TVL', 'num'], ['growth', '7d', 'num'],
    ['age', 'Age', 'num'], ['implied', 'Market cap', 'num'],
  ];

  function renderHead() {
    var cols = state.view === 'live' ? LIVE_HEAD : BOARD_HEAD;
    theadTr.innerHTML = cols.map(function (c) {
      var active = state.view === 'board' && state.sortKey === c[0];
      var arrow = active ? (state.sortDir === 'asc' ? ' ▲' : ' ▼') : '';
      var sort = active ? (state.sortDir === 'asc' ? ' aria-sort="ascending"' : ' aria-sort="descending"') : '';
      return '<th class="' + c[2] + '" data-sort="' + c[0] + '"' + sort + '>' + esc(c[1]) + '<span class="arrow">' + arrow + '</span></th>';
    }).join('');
  }

  theadTr.addEventListener('click', function (ev) {
    var th = ev.target.closest('th[data-sort]');
    if (!th || state.view === 'live') return;
    var key = th.getAttribute('data-sort');
    if (key === state.sortKey) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortKey = key;
      state.sortDir = DESC_DEFAULT[key] ? 'desc' : 'asc';
    }
    state.page = 1;
    renderBoard();
  });

  // ---- board + live rendering ----------------------------------------------
  function rowHtml(r) {
    var chg = r.change_7d;
    var chgCls = chg == null ? '' : chg >= 0 ? 'up' : 'down';
    var badge = r.on_watchlist ? '<span class="badge">Watchlist</span>' : '<span class="early">Early</span>';
    return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="sel"' : '') + '>' +
      '<td class="num">' + r.rank + '</td>' +
      '<td><span class="name">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td>' + (r.category ? '<span class="pill">' + esc(r.category) + '</span>' : '—') + '</td>' +
      '<td>' + esc(r.chains[0] || '—') + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '') + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num ' + chgCls + '">' + pct(chg) + '</td>' +
      '<td class="num">' + ageText(r.age_days) + '</td>' +
      '<td class="num"><span class="val">' + money(r.implied_value_usd) + '</span></td>' +
      '<td class="num">' + money(r.implied_fdv_usd) + '</td>' +
      '<td><span class="v-' + esc(r.verdict.toLowerCase()) + '">' + esc(r.verdict) + '</span></td>' +
      '<td>' + badge + '</td>' +
      '</tr>';
  }

  function renderBoard() {
    renderHead();
    var rows = filteredRows();
    var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * PAGE_SIZE;
    var pageRows = rows.slice(start, start + PAGE_SIZE);
    boardEl.innerHTML = pageRows.map(rowHtml).join('');
    countEl.textContent = rows.length === D.board_size
      ? 'Showing ' + (start + 1) + '–' + (start + pageRows.length) + ' of ' + D.board_size + ' ranked protocols.'
      : 'Showing ' + (start + 1) + '–' + (start + pageRows.length) + ' of ' + rows.length + ' matching · ' + D.board_size + ' on the board.';
    pagerEl.innerHTML = pages > 1
      ? '<button type="button" data-page="prev"' + (state.page === 1 ? ' disabled' : '') + '>← Prev</button>' +
        '<span>Page ' + state.page + ' of ' + pages + '</span>' +
        '<button type="button" data-page="next"' + (state.page === pages ? ' disabled' : '') + '>Next →</button>'
      : '';
    noteEl.textContent = 'Rank 1 is the board\u2019s most valuable protocol. Implied values are this radar\u2019s own claim, from the snapshot\u2019s figures alone.';
    renderChips(rows.length);
  }

  function renderLive() {
    renderHead();
    var rows = D.live.slice().sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0); });
    boardEl.innerHTML = rows.map(function (p, i) {
      var chg = p.change_7d;
      var chgCls = chg == null ? '' : chg >= 0 ? 'up' : 'down';
      return '<tr>' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td><span class="name">' + esc(p.name) + '</span><br><span class="slug">' + esc(p.slug) + '</span></td>' +
        '<td>' + (p.category ? '<span class="pill">' + esc(p.category) + '</span>' : '—') + '</td>' +
        '<td>' + esc(p.chains[0] || '—') + (p.chains.length > 1 ? ' +' + (p.chains.length - 1) : '') + '</td>' +
        '<td class="num">' + money(p.tvl_usd) + '</td>' +
        '<td class="num ' + chgCls + '">' + pct(chg) + '</td>' +
        '<td class="num">—</td>' +
        '<td class="num"><span class="val">' + money(p.mcap_usd) + '</span></td>' +
        '</tr>';
    }).join('');
    countEl.textContent = 'The ' + rows.length + ' largest live-token protocols by market cap — the market the sector multiples are calibrated from.';
    noteEl.textContent = 'These protocols already trade, so the board shows the market\u2019s own value for them, never a model\u2019s. They are not ranked for a launch.';
    pagerEl.innerHTML = '';
    renderChips(rows.length);
  }

  function render() {
    if (state.view === 'live') { renderLive(); return; }
    renderBoard();
  }

  pagerEl.addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-page]');
    if (!btn || btn.disabled) return;
    state.page += btn.getAttribute('data-page') === 'next' ? 1 : -1;
    renderBoard();
  });

  // ---- detail view ---------------------------------------------------------
  function renderDetail(slug) {
    var r = null;
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === slug) { r = D.rows[i]; break; }
    if (!r) { detailEl.innerHTML = '<p class="detail-empty">Select a row to see its model breakdown and farm plan.</p>'; return; }
    state.selected = slug;
    var growthAdj = r.growth_adjusted_usd != null ? r.growth_adjusted_usd : r.base_value_usd * r.growth_multiplier;
    var netStr = (r.net_usd < 0 ? '−$' : '+$') + Math.abs(Math.round(r.net_usd)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    var fit = null;
    for (var j = 0; j < (D.fits || []).length; j++) if (D.fits[j].category === r.category) { fit = D.fits[j]; break; }
    var methodNote;
    if (r.method === 'blend') {
      methodNote = fit && fit.usesGlobalCurve
        ? 'blend with the global curve, slope ' + fit.slope.toFixed(3) + ' — ' + fit.n + ' live comp' + (fit.n === 1 ? '' : 's') + ' in this category'
        : 'blend, curve slope ' + (fit ? fit.slope.toFixed(3) : '—');
    } else {
      methodNote = 'median — the combined blind evidence kept the median here';
    }
    if (fit) {
      methodNote += ' (LOO ' + fit.looBlend.toFixed(3) + ' vs ' + fit.looMedian.toFixed(3);
      if (fit.wfBlend != null && fit.wfMedian != null) methodNote += '; walk-forward ' + fit.wfBlend.toFixed(3) + ' vs ' + fit.wfMedian.toFixed(3);
      methodNote += ')';
    }
    var steps = r.farm_steps.map(function (s) {
      return '<li>' + esc(s) + '</li>';
    }).join('');
    var comps = (D.comps && D.comps[r.category]) || [];
    var compHtml;
    if (comps.length) {
      compHtml = '<table class="math"><thead><tr><th>Live comp</th><th class="num">TVL</th><th class="num">mcap / TVL</th><th class="num">FDV / TVL</th></tr></thead><tbody>' +
        comps.map(function (c) {
          return '<tr><td>' + esc(c.name) + '</td><td class="num">' + money(c.tvl_usd) + '</td><td class="num">' + fmtMult(c.mcap_tvl) + '</td><td class="num">' + fmtMult(c.fdv_tvl) + '</td></tr>';
        }).join('') + '</tbody></table>' +
        '<p class="note">FDV / TVL applies the 12.5× listing assumption (8% circulating at listing). The sector multiple is the fitted curve blended with the median of these comps — never one comp alone.</p>';
    } else {
      compHtml = '<p class="note">No live-token comp in this category — the protocol takes the global median multiple.</p>';
    }
    detailEl.innerHTML =
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">Rank #' + r.rank + ' · rank across 200 refits #' + r.rank_lo + '–#' + r.rank_hi + ' · ' + esc(r.slug) +
      (r.on_watchlist ? ' · <span class="badge">Watchlist</span>' : ' · Early find') +
      '<br>' + esc(r.category || 'No category') + ' · ' + esc(r.chains.join(', ') || 'no chain listed') +
      ' · tracked since ' + esc(r.listed_at || 'unknown') + '</p>' +
      '<h3>Why it ranks here</h3>' +
      '<table class="math"><tbody>' +
      mathRow('TVL', moneyFull(r.tvl_usd)) +
      mathRow('Sector multiple (' + (r.category || 'global') + ' — ' + methodNote + ')', fmtMult(r.sector_multiple)) +
      mathRow('Base value (TVL × multiple)', moneyFull(r.base_value_usd)) +
      mathRow('Base FDV (TVL × FDV multiple ' + fmtMult(r.fdv_multiple) + ')', moneyFull(r.base_fdv_usd)) +
      mathRow('Growth (' + pct(r.change_7d) + ' in 7 days)', '×' + r.growth_multiplier.toFixed(3)) +
      mathRow('Growth-adjusted value (base × growth)', moneyFull(growthAdj)) +
      mathRow('Maturity (' + ageText(r.age_days) + ' tracked)', '×' + r.maturity_multiplier.toFixed(3)) +
      mathRow('Chains (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')', '×' + r.chain_multiplier.toFixed(3)) +
      mathRow('Risk (' + (r.risk_multiplier < 1 ? 'thin TVL under $10M' : 'TVL above $10M') + ')', '×' + r.risk_multiplier.toFixed(3)) +
      '<tr class="total"><td>Implied value</td><td>' + moneyFull(r.implied_value_usd) + '</td></tr>' +
      '<tr class="total"><td>Implied FDV</td><td>' + moneyFull(r.implied_fdv_usd) + '</td></tr>' +
      '</tbody></table>' +
      '<p class="note">Growth is the radar\u2019s own formula, printed in the Model section: gains 1 + 0.30 × √(growth / 60%), losses 1 + 0.50 × growth / 100. No published standard growth-adjusted multiple exists.</p>' +
      '<h3>Net value — ' + esc(r.verdict) + '</h3>' +
      '<table class="math"><tbody>' +
      mathRow('Implied FDV, low end (5th percentile of 200 refits)', moneyFull(r.implied_fdv_low_usd)) +
      mathRow('Expected value, low end (20% × min($3,000, 0.01% of low-end FDV))', moneyFull(r.ev_usd)) +
      mathRow('All-in cost (gas + bridge + 12 h at $25/h)', moneyFull(r.all_in_usd)) +
      '<tr class="total"><td>Net value</td><td>' + netStr + '</td></tr>' +
      mathRow('Break-even allocation', moneyFull(r.all_in_usd)) +
      mathRow('Break-even implied FDV (low end)', moneyFull(r.all_in_usd * 50000)) +
      '</tbody></table>' +
      '<p class="note">Farm at +$100 or better, Skip at −$100 or worse, Thin in between. The expected value is netted at the low end: a typical wallet takes 0.01% of the low-end implied FDV and only 20% of airdrops pay meaningfully — the entry\u2019s own assumptions, stated in the Model section.</p>' +
      '<h3>Live comps behind the ' + esc(r.category || 'global') + ' multiple</h3>' + compHtml +
      '<h3>Farm plan — 8 steps over 12 weeks</h3>' +
      '<ol class="steps">' + steps + '</ol>' +
      '<p class="note">This protocol records no token. The plan is this radar\u2019s own reading of its record, not a promise of a launch. DefiLlama: defillama.com/protocol/' + esc(r.slug) + '</p>';
    function mathRow(label, value) {
      return '<tr><td>' + esc(label) + '</td><td>' + esc(value) + '</td></tr>';
    }
  }

  boardEl.addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (!tr) return;
    renderDetail(tr.getAttribute('data-slug'));
    renderBoard();
    detailEl.scrollIntoView({ block: 'nearest' });
  });

  // ---- controls ------------------------------------------------------------
  function setView(view) {
    state.view = view;
    state.status = view === 'live' ? 'live' : '';
    statusEl.value = state.status;
    viewBoardBtn.classList.toggle('on', view === 'board');
    viewLiveBtn.classList.toggle('on', view === 'live');
    state.page = 1;
    render();
  }
  viewBoardBtn.addEventListener('click', function () { setView('board'); });
  viewLiveBtn.addEventListener('click', function () { setView('live'); });
  qEl.addEventListener('input', function () { state.q = qEl.value; state.page = 1; renderBoard(); });
  catEl.addEventListener('change', function () { state.category = catEl.value; state.page = 1; renderBoard(); });
  chainEl.addEventListener('change', function () { state.chain = chainEl.value; state.page = 1; renderBoard(); });
  minTvlEl.addEventListener('change', function () { state.minTvl = Number(minTvlEl.value) || 0; state.page = 1; renderBoard(); });
  statusEl.addEventListener('change', function () { setView(statusEl.value === 'live' ? 'live' : 'board'); });

  // ---- deep links for the screenshots --------------------------------------
  // ?view=detail&slug=<slug> opens one protocol's detail view.
  // ?view=filtered&category=<name> shows one category's board.
  // ?view=live shows the live-token market.
  var params = new URLSearchParams(window.location.search);
  var pv = params.get('view');
  var pq = params.get('q');
  var pc = params.get('category');
  var pch = params.get('chain');
  var ps = params.get('slug');
  var pm = params.get('mintvl');
  if (pq) { state.q = pq; qEl.value = pq; }
  if (pc) { state.category = pc; catEl.value = pc; }
  if (pch) { state.chain = pch; chainEl.value = pch; }
  if (pm) { state.minTvl = Number(pm) || 0; minTvlEl.value = pm; }
  if (pv === 'live') { setView('live'); }
  else if (pv === 'detail' && ps) { renderBoard(); renderDetail(ps); }
  else if (pv === 'filtered') { renderBoard(); }
  else { renderBoard(); }
})();
