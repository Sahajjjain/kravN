// Usage (from your project root):
//   node apply-curate-feed.js [routes/curate.js] [lib/curate.js] [views/curate.ejs]
// Adds to KravN Curate:
//   1. An endless "Curated for you" feed under the shelves (keeps loading as you scroll, never repeats a title).
//   2. Endless loading for filtered results too (Movies / Series / Indian / genre / rating / box office / region).
//   3. Shuffle now reshuffles the feed as well as the pick and the rows.
// Every file is checked first: if any anchor is missing the script aborts and writes NOTHING.
// Saves <file>.bak before changing a file. Safe to re-run (already patched files are skipped).
const fs = require('fs');

const routeFile = process.argv[2] || 'routes/curate.js';
const libFile = process.argv[3] || 'lib/curate.js';
const viewFile = process.argv[4] || 'views/curate.ejs';

const CSS = `  .cu-feed-stat { margin: 18px 0 8px; min-height: 20px; text-align: center; font-size: 13px; color: var(--cu-soft); }
  #cu-feed .cu-grid { margin-top: 0; }
  `;

const FEED_HTML = `<div id="cu-shelves"></div>
    <section id="cu-feed" hidden>
      <div class="cu-h"><h3><i></i><span id="cu-feed-h">Curated for you</span></h3><p>Keeps going as you scroll</p></div>
      <div class="cu-grid" id="cu-fgrid"></div>
      <div class="cu-sent" id="cu-fsent" aria-hidden="true"></div>
      <p class="cu-feed-stat" id="cu-fstat" aria-live="polite"></p>
    </section>`;

const JS = `/* ---------- endless feed (default view) + load-more for filtered results ---------- */
  function nearEnd(n) { return !!(n && n.offsetParent && n.getBoundingClientRect().top < window.innerHeight + 900); }
  function moreCheck() {
    if (!base) return;
    if (!isDefault()) {
      if (!$('cu-results').hidden && nearEnd($('cu-sent'))) {
        if (gridN < items.length) { appendGrid(); setTimeout(moreCheck, 80); } else gridMore();
      }
    } else if (!$('cu-feed').hidden && nearEnd($('cu-fsent'))) {
      if (feedQ.length) feedAppend(); else feedMore();
    }
  }
  function feedKeys() {
    var u = {}; if (featKey) u[featKey] = 1;
    shelves.forEach(function (sh) { sh.l.forEach(function (i) { u[i.key] = 1; }); });
    return u;
  }
  function paintFeedStat() {
    var s = $('cu-fstat'); s.textContent = '';
    if (feedBusy) { s.textContent = 'Finding more for you…'; return; }
    if (feedFail) {
      var b = btn('cu-btn ghost sm', 'Couldn’t load more. Try again');
      b.addEventListener('click', function () { feedFail = false; feedMore(); });
      s.appendChild(b); return;
    }
    if (feedDone && !feedQ.length) s.textContent = 'You’re all caught up. Shuffle, or open Filters for a fresh batch.';
  }
  function resetFeed() {
    var box = $('cu-feed');
    feedTok++; feedBusy = false; feedDone = false; feedFail = false; feedPg = 1; feedQ = []; feedHave = {};
    $('cu-fgrid').textContent = '';
    if (!base || !isDefault() || !items.length) { box.hidden = true; return; }
    $('cu-feed-h').textContent = own ? 'Curated for you' : 'Curated for @' + user;
    var u = feedKeys();
    feedQ = wshuffle(vis(base.items).filter(function (i) { return !u[i.key]; }));
    feedQ.forEach(function (i) { feedHave[i.key] = 1; });
    box.hidden = false; feedAppend();
  }
  function feedAppend() {
    var g = $('cu-fgrid'), batch = feedQ.splice(0, 24);
    batch.forEach(function (it) { g.appendChild(card(it)); });
    paintFeedStat(); setTimeout(moreCheck, 80);
  }
  function feedMore() {
    if (feedBusy || feedDone || feedFail || !base || !isDefault()) return;
    if (feedPg >= 8) { feedDone = true; paintFeedStat(); return; }
    var tok = feedTok, pg = feedPg + 1; feedBusy = true; paintFeedStat();
    fetch(apiUrl('?page=' + pg), { credentials: 'same-origin', headers: { 'Accept': 'application/json' } }).then(readJSON).then(function (j) {
      if (tok !== feedTok) return;
      feedBusy = false;
      if (j.status >= 400 || !j.items) { feedFail = true; paintFeedStat(); return; }
      feedPg = pg;
      var u = feedKeys(), add = vis(j.items).filter(function (i) { return !u[i.key] && !feedHave[i.key]; });
      add.forEach(function (i) { feedHave[i.key] = 1; if (!imap[i.key]) imap[i.key] = i; });
      feedQ = feedQ.concat(wshuffle(add));
      if (feedQ.length) feedAppend(); else feedMore();
    }).catch(function () { if (tok !== feedTok) return; feedBusy = false; feedFail = true; paintFeedStat(); });
  }
  function dropFeedKey(key) {
    feedQ = feedQ.filter(function (i) { return i.key !== key; });
    Array.prototype.forEach.call($('cu-fgrid').querySelectorAll('.cu-card'), function (n) { if (n.getAttribute('data-key') === key) n.remove(); });
  }
  function gridMore() {
    if (gBusy || gDone || more || isDefault()) return;
    if (gPg >= 8) { gDone = true; paintCount(); return; }
    var my = seq, pg = gPg + 1;
    var qs = '?type=' + st.type + '&genre=' + encodeURIComponent(st.genre) + '&min=' + st.min + '&box=' + st.box + '&origin=' + st.origin + '&country=' + st.country + '&page=' + pg;
    gBusy = true; paintCount();
    fetch(apiUrl(qs), { credentials: 'same-origin', headers: { 'Accept': 'application/json' } }).then(readJSON).then(function (j) {
      if (my !== seq) return;
      gBusy = false;
      if (j.status >= 400 || !j.items) { gDone = true; paintCount(); return; }
      gPg = pg;
      var have = {}; items.forEach(function (i) { have[i.key] = 1; });
      var add = vis(j.items).filter(function (i) { return !have[i.key]; }).sort(byScore);
      add.forEach(function (i) { if (!imap[i.key]) imap[i.key] = i; });
      items = items.concat(add); paintCount();
      if (add.length) { appendGrid(); setTimeout(moreCheck, 80); } else gridMore();
    }).catch(function () { if (my === seq) { gBusy = false; gDone = true; paintCount(); } });
  }
  window.addEventListener('scroll', function () {
    if (moreTick) return; moreTick = true;
    requestAnimationFrame(function () { moreTick = false; moreCheck(); });
  }, { passive: true });
  window.addEventListener('resize', function () { setTimeout(moreCheck, 100); });

  /* ---------- explore controls ---------- */`;

const targets = [
  {
    file: routeFile,
    marker: 'const page = Math.min(8',
    reps: [
      ['  return { type, genre, minRating, box, origin, country };',
        "  const page = Math.min(8, Math.max(1, parseInt(q.page, 10) || 1)); // later pages feed the endless scroll\n  return { type, genre, minRating, box, origin, country, page };"],
    ],
  },
  {
    file: libFile,
    marker: 'const off = ((f.page',
    reps: [
      ["const DEFAULT_F = { type: 'all', genre: '', minRating: 0, box: '', origin: '', country: '' };",
        "const DEFAULT_F = { type: 'all', genre: '', minRating: 0, box: '', origin: '', country: '', page: 1 };"],
      ['const isDefaultF = (f) => f.type === \'all\' && !f.genre && !f.minRating && !f.box && !f.origin && !f.country;',
        'const isDefaultF = (f) => f.type === \'all\' && !f.genre && !f.minRating && !f.box && !f.origin && !f.country && (f.page || 1) === 1;'],
      ['const jobs = [];',
        "const jobs = [];\n  const off = ((f.page || 1) - 1) * 2; // later pages of the same feed look further down TMDB's lists"],
      ["language: 'en-US', page: page || 1,",
        "language: 'en-US', page: (page || 1) + off,"],
    ],
  },
  {
    file: viewFile,
    marker: 'id="cu-feed"',
    reps: [
      ['@media (prefers-reduced-motion: reduce) { .cu-skel,', CSS + '@media (prefers-reduced-motion: reduce) { .cu-skel,'],
      ['<div id="cu-shelves"></div>', FEED_HTML],
      ["var featKey = '', featQueue = [], watched = [], wmap = {}, saved = {}, posterBlob = null, tasteTab = 'overview', repaintFilters = null;",
        "var featKey = '', featQueue = [], watched = [], wmap = {}, saved = {}, posterBlob = null, tasteTab = 'overview', repaintFilters = null;\n  var feedQ = [], feedHave = {}, feedPg = 1, feedBusy = false, feedDone = false, feedFail = false, feedTok = 0, gPg = 1, gBusy = false, gDone = false, moreTick = false;"],
      ["(more ? ' · finding more…' : '')", "((more || gBusy) ? ' · finding more…' : '')"],
      ["$('cu-grid').textContent = ''; gridN = 0; appendGrid(); paintCount();",
        "$('cu-grid').textContent = ''; gridN = 0; appendGrid(); paintCount(); setTimeout(moreCheck, 60);"],
      ["$('cu-shelves').hidden = !def; $('cu-results').hidden = def;",
        "$('cu-shelves').hidden = !def; $('cu-results').hidden = def; if ($('cu-feed') && !def) $('cu-feed').hidden = true;"],
      ["$('cu-shelves').textContent = ''; $('cu-grid').textContent = ''; $('cu-results').hidden = true;",
        "$('cu-shelves').textContent = ''; $('cu-grid').textContent = ''; $('cu-results').hidden = true; $('cu-feed').hidden = true;"],
      ['if (def) renderShelves(); else renderGrid();', 'if (def) { renderShelves(); resetFeed(); } else renderGrid();'],
      ['var my = ++seq; more = false;', 'var my = ++seq; more = false; gPg = 1; gBusy = false; gDone = false;'],
      ['if (local.length >= 36 && !st.box) return;', 'if (local.length >= 36 && !st.box) { gPg = 0; setTimeout(moreCheck, 60); return; }'],
      ["if (isDefault()) { shuffleAll(); toast('Shuffled to your taste'); return; }",
        "if (isDefault()) { shuffleAll(); resetFeed(); toast('Shuffled to your taste'); return; }"],
      ['swapFeature(old && !wmap[old.key] ? old : null, it.key);',
        'swapFeature(old && !wmap[old.key] ? old : null, it.key);\n    dropFeedKey(it.key);'],
      ['featQueue = featQueue.filter(function (i) { return i.key !== key; });',
        'featQueue = featQueue.filter(function (i) { return i.key !== key; });\n    feedQ = feedQ.filter(function (i) { return i.key !== key; });'],
      ['/* ---------- explore controls ---------- */', JS],
    ],
  },
];

const count = (s, a) => s.split(a).length - 1;
const plan = [];
for (const t of targets) {
  if (!fs.existsSync(t.file)) { console.error('ABORTED: ' + t.file + ' not found. Pass the right paths: node apply-curate-feed.js <routes file> <lib file> <view file>. Nothing changed.'); process.exit(1); }
  const orig = fs.readFileSync(t.file, 'utf8');
  if (orig.includes(t.marker)) { console.log('Skipping ' + t.file + ' (already patched).'); continue; }
  let s = orig;
  for (const [a, b] of t.reps) {
    const n = count(s, a);
    if (n !== 1) { console.error('ABORTED: expected 1 match, found ' + n + ' in ' + t.file + ' for:\n  ' + a.slice(0, 110) + '\nNothing changed.'); process.exit(1); }
    s = s.split(a).join(b);
  }
  plan.push({ file: t.file, orig, out: s });
}

plan.forEach((p) => { fs.writeFileSync(p.file + '.bak', p.orig); fs.writeFileSync(p.file, p.out); console.log('Updated ' + p.file + ' (backup: ' + p.file + '.bak)'); });
console.log(plan.length ? 'Done. Restart your server.' : 'Nothing to change.');