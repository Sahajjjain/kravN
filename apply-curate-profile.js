// Usage (from your project root):  node apply-curate-profile.js views/profile.ejs
// Makes the "KravN Curate" button on the profile stand out (gold gradient, soft glow, subtle shine).
// Saves profile.ejs.bak first. Safe to re-run. Aborts without writing if the Curate button is not found.
const fs = require('fs');
const file = process.argv[2] || 'views/profile.ejs';
let s = fs.readFileSync(file, 'utf8');
const orig = s;

// 1. restyle the button (works for the '#curate' and the '/curate' versions of the button)
const re = /<a class="btn btn-glass"( href="[^"]*curate[^"]*">)★ KravN Curate<\/a>/;
if (re.test(s)) {
  s = s.replace(re, '<a class="btn btn-curate"$1<span class="btn-curate-star" aria-hidden="true">★</span> KravN Curate</a>');
} else if (!s.includes('btn-curate')) {
  console.error('ABORTED: could not find the KravN Curate button in ' + file + '. File not changed.');
  process.exit(1);
}

// 2. add the styles once, right before <main class="page">
if (!s.includes('/* kravn-curate-btn */')) {
  const css = `<style>
  /* kravn-curate-btn */
  .profile-actions .btn.btn-curate {
    position: relative; overflow: hidden; color: #1a1205; border: 0; background: linear-gradient(135deg, #f5b544, #f97316);
    box-shadow: 0 14px 34px -14px rgba(245, 181, 68, .85), inset 0 0 0 1px rgba(255, 255, 255, .25);
  }
  .profile-actions .btn.btn-curate::after {
    content: ""; position: absolute; top: 0; bottom: 0; left: -60%; width: 40%; transform: skewX(-20deg); pointer-events: none;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, .45), transparent); animation: curate-shine 5s ease-in-out 1.2s infinite;
  }
  .profile-actions .btn.btn-curate:hover { filter: brightness(1.06); }
  .profile-actions .btn-curate-star { font-size: 14px; line-height: 1; }
  @keyframes curate-shine { 0%, 70% { left: -60%; } 100% { left: 130%; } }
  @media (prefers-reduced-motion: reduce) { .profile-actions .btn.btn-curate::after { animation: none; display: none; } }
</style>
`;
  if (s.split('<main class="page">').length !== 2) { console.error('ABORTED: could not find <main class="page"> in ' + file + '. File not changed.'); process.exit(1); }
  s = s.replace('<main class="page">', () => css + '<main class="page">');
}

if (s === orig) { console.log('Nothing to change: ' + file + ' is already up to date.'); process.exit(0); }
fs.writeFileSync(file + '.bak', orig);
fs.writeFileSync(file, s);
console.log('Done. ' + file + ' updated (backup: ' + file + '.bak).');