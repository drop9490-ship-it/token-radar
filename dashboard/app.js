// Token Radar's page: no framework, no network. It reads window.RADAR, the
// dataset main.ts writes beside it, and renders the board, the filters and
// the detail view. The value model itself lives in lib/radar.ts and is
// stated in full in the Model section of index.html; this file only renders
// what the model scored, and never re-scores a row.
//
// Implied value = TVL x sector multiple x growth x maturity x chains, where
// the sector multiple is the category's median market-cap / TVL among the
// snapshot's own live-token protocols (ratios winsorised at the 90th
// percentile, shrunk toward the global median, clamped to 0.02-1.50).

(function () {
  'use strict';
  var D = window.RADAR;
  var boardEl = document.getElementById('rows');
  var countEl = document.getElementById('count');
  var noteEl = document.getElementById('board-note');
  var detailEl = document.getElementById('detail');
  var qEl = document.getElementById('q');
  var catEl = document.getElementById('category');
  var chainEl = document.getElementById('chain');
  var sortEl = document.getElementById('sort');
  var viewBoardBtn = document.getElementById('view-board');
  var viewLiveBtn = document.getElementById('view-live');

  if (!D || !Array.isArray(D.rows)) {
    document.getElementById('meta').textContent = 'No radar data found: data.js did not load.';
    return;
  }

  var state = { q: '', category: '', chain: '', sort: 'rank', view: 'board', selected: null };
  var watchlist = {};
  D.rows.forEach(function (r) { watchlist[r.slug] = false; });

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

  // ---- header, stats, source -------------------------------------------
  var fetched = (D.source || '').split('fetched ')[1] || '';
  document.getElementById('meta').textContent =
    'Snapshot as of ' + D.as_of + ' · ' + D.protocols_scanned + ' protocols scanned · ' +
    'watchlist floor $' + D.floor_usd.toLocaleString('en-US') + ' TVL · model ' + D.model_version;
  document.getElementById('source').textContent =
    'Source: DefiLlama protocols endpoint, fetched ' + fetched + '. ' +
    'The snapshot is sealed: every run reads the same bytes.';
  document.getElementById('stats').innerHTML =
    stat(D.protocols_scanned, 'protocols scanned') +
    stat(D.watchlist_size, 'on the watchlist') +
    stat(D.board_size, 'rows on the board') +
    stat(fmtMult(D.global_multiple), 'global sector multiple');
  function stat(big, label) {
    return '<div class="stat"><b>' + esc(big) + '</b><span>' + esc(label) + '</span></div>';
  }

  // ---- filter options ----------------------------------------------------
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

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var by = {
      rank: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d == null ? -1e9 : b.change_7d) - (a.change_7d == null ? -1e9 : a.change_7d); },
      age: function (a, b) { return (b.age_days == null ? -1 : b.age_days) - (a.age_days == null ? -1 : a.age_days); },
      name: function (a, b) { return a.name < b.name ? -1 : 1; },
    }[state.sort] || function (a, b) { return a.rank - b.rank; };
    return rows.slice().sort(by);
  }

  function rowHtml(r) {
    var chg = r.change_7d;
    var chgCls = chg == null ? '' : chg >= 0 ? 'up' : 'down';
    var badge = r.on_watchlist ? ' <span class="badge">Watchlist</span>' : '';
    return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="sel"' : '') + '>' +
      '<td class="num">' + r.rank + '</td>' +
      '<td><span class="name">' + esc(r.name) + '</span>' + badge + '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td>' + (r.category ? '<span class="pill">' + esc(r.category) + '</span>' : '—') + '</td>' +
      '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num ' + chgCls + '">' + pct(chg) + '</td>' +
      '<td class="num">' + ageText(r.age_days) + '</td>' +
      '<td class="num"><span class="val">' + money(r.implied_value_usd) + '</span></td>' +
      '</tr>';
  }

  // ---- board + live rendering --------------------------------------------
  function renderBoard() {
    var rows = filteredRows();
    boardEl.innerHTML = rows.map(rowHtml).join('');
    countEl.textContent = 'Showing ' + rows.length + ' of ' + D.board_size + ' ranked protocols' +
      (state.category || state.chain || state.q ? ' (filtered)' : '') + '.';
    noteEl.textContent = state.view === 'board'
      ? 'Rank 1 is the board\u2019s most valuable protocol. Implied values are this radar\u2019s own claim, from the snapshot\u2019s figures alone.'
      : '';
    document.querySelector('#board thead tr').innerHTML =
      '<th class="num">#</th><th>Protocol</th><th>Category</th><th>Chains</th>' +
      '<th class="num">TVL</th><th class="num">7d</th><th class="num">Age</th><th class="num">Implied value</th>';
  }

  function renderLive() {
    var rows = D.live.slice().sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0); });
    boardEl.innerHTML = rows.map(function (p, i) {
      var chg = p.change_7d;
      var chgCls = chg == null ? '' : chg >= 0 ? 'up' : 'down';
      return '<tr>' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td><span class="name">' + esc(p.name) + '</span><br><span class="slug">' + esc(p.slug) + '</span></td>' +
        '<td>' + (p.category ? '<span class="pill">' + esc(p.category) + '</span>' : '—') + '</td>' +
        '<td>' + esc(p.chains.slice(0, 3).join(', ')) + (p.chains.length > 3 ? ' +' + (p.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(p.tvl_usd) + '</td>' +
        '<td class="num ' + chgCls + '">' + pct(chg) + '</td>' +
        '<td class="num">—</td>' +
        '<td class="num"><span class="val">' + money(p.mcap_usd) + '</span></td>' +
        '</tr>';
    }).join('');
    countEl.textContent = 'The ' + rows.length + ' largest live-token protocols by market cap — the market the sector multiples are calibrated from.';
    noteEl.textContent = 'These protocols already trade, so the board shows the market\u2019s own value for them, never a model\u2019s. They are not ranked for a launch.';
    document.querySelector('#board thead tr').innerHTML =
      '<th class="num">#</th><th>Protocol</th><th>Category</th><th>Chains</th>' +
      '<th class="num">TVL</th><th class="num">7d</th><th class="num">Age</th><th class="num">Market cap</th>';
  }

  function render() {
    if (state.view === 'live') { renderLive(); return; }
    renderBoard();
  }

  // ---- detail view ---------------------------------------------------------
  function renderDetail(slug) {
    var r = null;
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === slug) { r = D.rows[i]; break; }
    if (!r) { detailEl.innerHTML = '<p class="detail-empty">Select a row to see its model breakdown and farm plan.</p>'; return; }
    state.selected = slug;
    var base = r.tvl_usd * r.sector_multiple;
    var steps = r.farm_steps.map(function (s) {
      return '<li>' + esc(s) + '</li>';
    }).join('');
    detailEl.innerHTML =
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">Rank #' + r.rank + ' · ' + esc(r.slug) +
      (r.on_watchlist ? ' · <span class="badge">Watchlist</span>' : ' · Early find') +
      '<br>' + esc(r.category || 'No category') + ' · ' + esc(r.chains.join(', ') || 'no chain listed') +
      ' · tracked since ' + esc(r.listed_at || 'unknown') + '</p>' +
      '<h3>Why it ranks here</h3>' +
      '<table class="math"><tbody>' +
      mathRow('TVL', moneyFull(r.tvl_usd)) +
      mathRow('Sector multiple (' + esc(r.category || 'global') + ')', fmtMult(r.sector_multiple)) +
      mathRow('Base value (TVL × multiple)', moneyFull(base)) +
      mathRow('Growth (' + pct(r.change_7d) + ' in 7 days)', '×' + r.growth_multiplier.toFixed(3)) +
      mathRow('Maturity (' + ageText(r.age_days) + ' tracked)', '×' + r.maturity_multiplier.toFixed(3)) +
      mathRow('Chains (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')', '×' + r.chain_multiplier.toFixed(3)) +
      '<tr class="total"><td>Implied value</td><td>' + moneyFull(r.implied_value_usd) + '</td></tr>' +
      '</tbody></table>' +
      '<h3>Farm plan — 7 steps</h3>' +
      '<ol class="steps">' + steps + '</ol>' +
      '<p class="note">This protocol records no token. The plan is this radar\u2019s own reading of its record, not a promise of a launch.</p>';
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
    viewBoardBtn.classList.toggle('on', view === 'board');
    viewLiveBtn.classList.toggle('on', view === 'live');
    render();
  }
  viewBoardBtn.addEventListener('click', function () { setView('board'); });
  viewLiveBtn.addEventListener('click', function () { setView('live'); });
  qEl.addEventListener('input', function () { state.q = qEl.value; renderBoard(); });
  catEl.addEventListener('change', function () { state.category = catEl.value; renderBoard(); });
  chainEl.addEventListener('change', function () { state.chain = chainEl.value; renderBoard(); });
  sortEl.addEventListener('change', function () { state.sort = sortEl.value; renderBoard(); });

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
  if (pq) { state.q = pq; qEl.value = pq; }
  if (pc) { state.category = pc; catEl.value = pc; }
  if (pch) { state.chain = pch; chainEl.value = pch; }
  if (pv === 'live') { setView('live'); }
  else if (pv === 'detail' && ps) { renderBoard(); renderDetail(ps); }
  else if (pv === 'filtered') { renderBoard(); }
  else { renderBoard(); }
})();
