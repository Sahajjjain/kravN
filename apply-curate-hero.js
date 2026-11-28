// Usage (from your project root):  node apply-curate-hero.js views/curate.ejs
// Brings the Curate hero up to the Wrapped standard:
//   - drifting aurora background + film grain, bigger serif headline, glowing gold button
//   - fan of your three strongest matches (tap one to open it), rising in with the same stagger as Wrapped
//   - facts row (titles read, top match, picks ready)
//   - phone layout: poster fan first, everything centred, full-width buttons
// Works with or without apply-curate-feed.js. Aborts without writing if any anchor is missing.
// Saves <file>.bak first. Safe to re-run.
const fs = require('fs');
const file = process.argv[2] || 'views/curate.ejs';
if (!fs.existsSync(file)) { console.error('ABORTED: ' + file + ' not found. Nothing changed.'); process.exit(1); }
const orig = fs.readFileSync(file, 'utf8');
if (orig.includes('.cu-fan')) { console.log('Nothing to change: ' + file + ' is already patched.'); process.exit(0); }

const CSS = `  /* ============ hero upgrade (Wrapped-level polish) ============ */
  .cu-hero { display: grid; grid-template-columns: minmax(0, 1fr); padding: clamp(24px, 5vw, 56px) clamp(20px, 5vw, 60px); border-radius: 32px; }
  .cu-hero::before { inset: -25%; animation: cu-drift 14s ease-in-out infinite alternate;
    background: radial-gradient(40% 36% at 15% 20%, rgba(245, 181, 68, .4), transparent), radial-gradient(36% 32% at 85% 85%, rgba(45, 212, 191, .28), transparent), radial-gradient(30% 28% at 72% 8%, rgba(249, 115, 22, .22), transparent); }
  .cu-hero::after { content: ""; position: absolute; z-index: -1; inset: 0; opacity: .08; mix-blend-mode: overlay; pointer-events: none;
    background-image: url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
  @keyframes cu-drift { from { transform: translate(0, 0) scale(1); } to { transform: translate(-90px, 70px) scale(1.12); } }
  .cu-top { grid-column: 1 / -1; grid-row: 1; }
  .cu-brand { font: 600 12px/1 var(--font); letter-spacing: .22em; text-transform: uppercase; color: rgba(255, 255, 255, .62); }
  .cu-arch { font-size: clamp(38px, 6vw, 68px); }
  .cu-hero .cu-cta .cu-btn:not(.ghost) { box-shadow: 0 18px 44px -16px rgba(245, 181, 68, .75); }
  .cu-facts { display: flex; flex-wrap: wrap; row-gap: 14px; margin-top: 2px; }
  .cu-fact { padding: 0 24px; border-left: 1px solid rgba(255, 255, 255, .16); }
  .cu-fact:first-child { padding-left: 0; border-left: 0; }
  .cu-fact b { display: block; font: 500 30px/1.1 var(--cu-serif); font-variant-numeric: tabular-nums; }
  .cu-fact span { display: block; margin-top: 6px; font: 600 11px/1 var(--font); letter-spacing: .16em; text-transform: uppercase; color: rgba(255, 255, 255, .5); }
  .cu-fan { position: relative; grid-column: 1; grid-row: 2; height: 270px; margin-top: 18px; }
  .cu-hero.has-fan .cu-copy { grid-column: 1; grid-row: 3; }
  .cu-fp { position: absolute; left: 50%; bottom: 0; margin: 0; padding: 10px; width: 112px; aspect-ratio: 2 / 3; border: 0; border-radius: 14px; overflow: hidden; display: grid; place-items: center; text-align: center; cursor: pointer;
    font: 700 13px/1.25 var(--font); color: rgba(255, 255, 255, .85); background: linear-gradient(160deg, #3a2a10, #171007); transform-origin: 50% 100%; -webkit-tap-highlight-color: transparent;
    box-shadow: 0 30px 60px -20px rgba(0, 0, 0, .85), 0 0 0 1px rgba(255, 255, 255, .14);
    --y: var(--y0); transform: translateX(calc(-50% + var(--x))) translateY(var(--y)) rotate(var(--r)); transition: transform .25s ease;
    animation: cu-rise .9s cubic-bezier(.2, .8, .2, 1) backwards; animation-delay: calc(var(--d) * .12s + .1s); }
  .cu-fp:hover { --y: calc(var(--y0) - 10px); }
  .cu-fp:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
  .cu-fp img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .cu-fp-m { position: absolute; z-index: 2; left: 8px; bottom: 8px; padding: 4px 8px; border-radius: 8px; font: 800 11px/1 var(--font); font-style: normal; color: #1a1205; background: var(--cu-grad); }
  .cu-fp-l { --x: -76%; --r: -9deg; --y0: 14px; z-index: 1; }
  .cu-fp-c { --x: 0%; --r: 0deg; --y0: -18px; z-index: 3; width: 134px; }
  .cu-fp-r { --x: 76%; --r: 9deg; --y0: 14px; z-index: 2; }
  .cu-fan.still .cu-fp { animation: none; }
  @keyframes cu-rise { from { opacity: 0; transform: translateX(-50%) translateY(60px) rotate(0deg); } }
  @media (min-width: 641px) {
    .cu-fan { height: clamp(300px, 42vw, 420px); margin-top: 0; }
    .cu-fp { width: clamp(130px, 19vw, 200px); } .cu-fp-c { width: clamp(150px, 22vw, 230px); }
    .cu-fp-l { --x: -82%; } .cu-fp-r { --x: 82%; }
  }
  @media (min-width: 860px) {
    .cu-hero.has-fan { grid-template-columns: 1.05fr .95fr; grid-template-rows: auto 1fr; column-gap: 40px; align-items: center; min-height: 520px; }
    .cu-hero.has-fan .cu-copy { grid-row: 2; } .cu-fan { grid-column: 2; }
  }
  @media (max-width: 640px) {
    .cu-hero { padding: 22px 16px 26px; border-radius: 24px; }
    .cu-copy { justify-items: center; text-align: center; }
    .cu-lead { margin-inline: auto; max-width: 34ch; }
    .cu-links { justify-content: center; margin-left: 0; }
    #cu-genres { justify-content: center; }
    .cu-facts { justify-content: center; width: 100%; }
    .cu-fact { padding: 0 16px; } .cu-fact b { font-size: 25px; }
    .cu-hero::before { animation: none; } .cu-hero::after { display: none; }
  }
  @media (prefers-reduced-motion: reduce) { .cu-fp, .cu-hero::before { animation: none !important; } }
  `;

const JS = `/* ---------- hero: poster fan + facts ---------- */
  function renderFan(d) {
    var hero = root.querySelector('.cu-hero'), old = hero.querySelector('.cu-fan');
    if (old) old.remove();
    var pick = vis(d.items).slice(0, 3);
    if (!pick.length) { hero.classList.remove('has-fan'); return; }
    var slots = pick.length >= 3 ? [[pick[1], 'l'], [pick[0], 'c'], [pick[2], 'r']] : pick.length === 2 ? [[pick[1], 'r'], [pick[0], 'c']] : [[pick[0], 'c']];
    var fan = el('div', 'cu-fan' + (old ? ' still' : ''));
    slots.forEach(function (s, i) {
      var it = s[0], b = btn('cu-fp cu-fp-' + s[1], '', { 'aria-label': it.title + (it.match != null ? ', ' + it.match + '% match' : '') + '. Open details' });
      b.style.setProperty('--d', i); b.appendChild(el('span', '', it.title));
      var im = new Image(); im.alt = ''; im.decoding = 'async'; im.onerror = function () { this.remove(); }; im.src = it.posterL || it.poster; b.appendChild(im);
      if (it.match != null) b.appendChild(el('i', 'cu-fp-m', it.match + '%'));
      b.addEventListener('click', function () { openDetail(it); });
      fan.appendChild(b);
    });
    hero.appendChild(fan); hero.classList.add('has-fan');
  }
  function renderFacts(d) {
    var copy = root.querySelector('.cu-copy'), old = $('cu-facts'); if (old) old.remove();
    var list = vis(d.items), facts = [];
    if (!d.cold) {
      facts.push([d.taste.count, 'Titles read']);
      if (list[0] && list[0].match != null) facts.push([list[0].match + '%', 'Top match']);
    }
    if (list.length) facts.push([list.length, 'Picks ready']);
    if (!facts.length) return;
    var box = el('div', 'cu-facts'); box.id = 'cu-facts';
    facts.forEach(function (f) { var x = el('div', 'cu-fact'); x.appendChild(el('b', '', String(f[0]))); x.appendChild(el('span', '', f[1])); box.appendChild(x); });
    copy.insertBefore(box, copy.querySelector('.cu-cta'));
  }
  $('cu-genres').addEventListener('click',`;

const reps = [
  ['@media (prefers-reduced-motion: reduce) { .cu-skel,', CSS + '@media (prefers-reduced-motion: reduce) { .cu-skel,'],
  ["var d = base, t = d.taste, arch = $('cu-arch'), gbox = $('cu-genres'); arch.textContent = ''; gbox.textContent = '';",
    "var d = base, t = d.taste, arch = $('cu-arch'), gbox = $('cu-genres'); arch.textContent = ''; gbox.textContent = ''; renderFan(d); renderFacts(d);"],
  ["$('cu-genres').addEventListener('click',", JS],
  ["if (!$('cu-results').hidden) paintCount();", "if (!$('cu-results').hidden) paintCount();\n    if (base) { renderFan(base); renderFacts(base); }"],
];

let s = orig;
for (const [a, b] of reps) {
  const n = s.split(a).length - 1;
  if (n !== 1) { console.error('ABORTED: expected 1 match, found ' + n + ' for:\n  ' + a.slice(0, 110) + '\nNothing changed.'); process.exit(1); }
  s = s.split(a).join(b);
}
fs.writeFileSync(file + '.bak', orig);
fs.writeFileSync(file, s);
console.log('Done. ' + file + ' updated (backup: ' + file + '.bak). Hard-refresh the page.');