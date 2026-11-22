/* KravN Easter eggs. Every egg is found once, remembered in this browser,
   and listed (spoiler-free until found) on the About page and in the account menu. */
(function () {
  'use strict';

  var kravn = window.kravn || {};
  var EGGS = [
    { id: 'konami', name: 'Craven Mode', hint: 'An old gamer’s incantation.' },
    { id: 'logo', name: 'Popcorn Overload', hint: 'The logo is more clickable than it looks.' },
    { id: 'popcorn', name: 'Say the Magic Word', hint: 'Just type what the cinema smells like.' },
    { id: 'quotes', name: 'Quote Hunter', hint: 'The search box knows its movie lines.' },
    { id: 'lights', name: 'Lights Out', hint: 'Cinemas dim the lights. Try a key on a movie page.' },
    { id: 'ring', name: 'Critics’ Choice', hint: 'That percentage ring is hiding something.' },
    { id: 'poster', name: 'And the Oscar Goes To…', hint: 'Give a poster the applause it deserves.' },
    { id: 'midnight', name: 'Midnight Screening', hint: 'Visit when the rest of the world is asleep.' },
    { id: 'clapper', name: 'Take Two', hint: 'Get lost, then find the clapperboard.' },
    { id: 'credits', name: 'Roll the Credits', hint: 'Reach the end of an endless scroll.' },
    { id: 'shortcuts', name: 'Power User', hint: 'Ask the keyboard for help.' },
    { id: 'goldreel', name: 'Gold Reel', hint: 'There is another side to the theme switch.' },
  ];
  var KEY = 'kravn-eggs';

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function save(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* private mode */ } }

  function refreshUI() {
    var got = load();
    document.querySelectorAll('[data-egg-count]').forEach(function (el) { el.textContent = got.length + '/' + EGGS.length; });
    document.querySelectorAll('[data-egg-dex]').forEach(function (ul) { ul.innerHTML = dexHTML(got); });
  }
  function dexHTML(got) {
    return EGGS.map(function (e) {
      var yes = got.indexOf(e.id) > -1;
      return '<li class="' + (yes ? '' : 'locked') + '"><strong>' + (yes ? '🥚 ' + kravn.esc(e.name) : '🔒 ???') + '</strong><span class="muted">' + kravn.esc(yes ? 'Found!' : e.hint) + '</span></li>';
    }).join('');
  }

  function found(id) {
    var got = load();
    if (got.indexOf(id) > -1) return false;
    got.push(id); save(got);
    var egg = EGGS.filter(function (e) { return e.id === id; })[0];
    setTimeout(function () { kravn.toast('🥚 Easter egg found: ' + egg.name, got.length + ' of ' + EGGS.length + ' discovered'); }, 900);
    refreshUI();
    return true;
  }

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------- effects -------------------------------- */
  function rain(emojis, n) {
    if (reduced) return;
    var layer = document.createElement('div');
    layer.className = 'fx-layer';
    for (var i = 0; i < n; i++) {
      var s = document.createElement('span');
      s.className = 'fx-item';
      s.textContent = emojis[i % emojis.length];
      s.style.left = Math.random() * 100 + 'vw';
      s.style.fontSize = 22 + Math.random() * 30 + 'px';
      s.style.animationDuration = 2.2 + Math.random() * 2.6 + 's';
      s.style.animationDelay = Math.random() * 1.4 + 's';
      layer.appendChild(s);
    }
    document.body.appendChild(layer);
    setTimeout(function () { layer.remove(); }, 6500);
  }

  function matrix() {
    document.body.classList.add('craven-mode');
    setTimeout(function () { document.body.classList.remove('craven-mode'); }, 6000);
    if (reduced) return;
    var c = document.createElement('canvas');
    c.className = 'fx-matrix';
    c.width = window.innerWidth; c.height = window.innerHeight;
    document.body.appendChild(c);
    var ctx = c.getContext('2d');
    var glyphs = 'KRAVN🎬🍿01アイウエオカキクケコ'.split('');
    var cols = Math.floor(c.width / 22);
    var drops = Array.from({ length: cols }, function () { return Math.random() * -40; });
    var accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim() || '#a78bfa';
    var t0 = Date.now();
    var timer = setInterval(function () {
      ctx.fillStyle = 'rgba(7,6,12,.13)'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = accent; ctx.font = '18px "JetBrains Mono", monospace';
      drops.forEach(function (y, i) {
        ctx.fillText(glyphs[(Math.random() * glyphs.length) | 0], i * 22, y * 22);
        drops[i] = y * 22 > c.height && Math.random() > .975 ? 0 : y + 1;
      });
      if (Date.now() - t0 > 5200) { clearInterval(timer); c.style.transition = 'opacity .8s'; c.style.opacity = 0; setTimeout(function () { c.remove(); }, 900); }
    }, 50);
  }

  function oscar(title) {
    document.querySelectorAll('.modal').forEach(function (m) { m.remove(); });
    document.body.style.overflow = '';
    var o = document.createElement('div');
    o.className = 'oscar';
    o.innerHTML = '<span>🏆</span><small>And the Oscar goes to…</small><strong>' + kravn.esc(title) + '</strong><small>(click to accept graciously)</small>';
    o.addEventListener('click', function () { o.remove(); });
    document.body.appendChild(o);
    rain(['✨', '🌟', '🎉'], 36);
    setTimeout(function () { o.remove(); }, 5200);
  }

  function credits() {
    var c = document.createElement('div');
    c.className = 'credits';
    c.innerHTML = '<div class="credits-roll"><h2>KravN</h2><div><small>Directed by</small>Your curiosity</div><div><small>Starring</small>Every theory you couldn’t keep to yourself</div>' +
      '<div><small>Screenplay</small>The people who stayed past the post-credits scene</div><div><small>Special thanks</small>TMDB · popcorn · that one plot hole</div>' +
      '<div><small>No movies were harmed</small>in the making of this discussion</div><h2>🎬 Fin</h2></div>';
    c.addEventListener('click', function () { c.remove(); });
    document.body.appendChild(c);
    setTimeout(function () { c.remove(); }, 19000);
  }

  /* ----------------------------- search quotes ------------------------------ */
  var QUOTES = {
    'ill be back': ['“I’ll be back.”', 'The Terminator'],
    'rosebud': ['“Rosebud.”', 'Citizen Kane'],
    'there is no spoon': ['“There is no spoon.”', 'The Matrix'],
    'i know kung fu': ['“I know kung fu.”', 'The Matrix'],
    'i am your father': ['“I am your father.”', 'Star Wars: The Empire Strikes Back'],
    'may the force be with you': ['“May the Force be with you.”', 'Star Wars'],
    'you shall not pass': ['“You shall not pass!”', 'The Lord of the Rings'],
    'why so serious': ['“Why so serious?”', 'The Dark Knight'],
    'show me the money': ['“Show me the money!”', 'Jerry Maguire'],
    'heres johnny': ['“Here’s Johnny!”', 'The Shining'],
    'to infinity and beyond': ['“To infinity and beyond!”', 'Toy Story'],
    'hakuna matata': ['“Hakuna Matata.”', 'The Lion King'],
    'bond james bond': ['“Bond. James Bond.”', 'Dr. No'],
    'i see dead people': ['“I see dead people.”', 'The Sixth Sense'],
    'houston we have a problem': ['“Houston, we have a problem.”', 'Apollo 13'],
    'life is like a box of chocolates': ['“Life is like a box of chocolates.”', 'Forrest Gump'],
    'i am inevitable': ['“I am inevitable.”', 'Avengers: Endgame'],
    'with great power comes great responsibility': ['“With great power comes great responsibility.”', 'Spider-Man'],
    'wakanda forever': ['“Wakanda forever!”', 'Black Panther'],
    '42': ['The answer to life, the universe and everything.', 'The Hitchhiker’s Guide to the Galaxy'],
  };
  var lastQuote = '';
  document.addEventListener('kravn:query', function (e) {
    var q = (e.detail.q || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    if (QUOTES[q] && q !== lastQuote) {
      lastQuote = q;
      kravn.toast(QUOTES[q][0], '— ' + QUOTES[q][1], 4200);
      rain(['🎬', '🍿', '⭐'], 14);
      found('quotes');
    }
  });

  /* ------------------------------- listeners -------------------------------- */
  var KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  var kPos = 0, typed = '', gPending = 0, lights = false;

  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '');
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || e.target.isContentEditable;
    var key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (!typing) {
      kPos = key === KONAMI[kPos] ? kPos + 1 : (key === KONAMI[0] ? 1 : 0);
      if (kPos === KONAMI.length) { kPos = 0; matrix(); kravn.toast('CRAVEN MODE ACTIVATED', 'Welcome to the other side of the screen.', 4500); found('konami'); }
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

    // type "popcorn" (or "action" on a 404) anywhere
    if (e.key.length === 1) {
      typed = (typed + key).slice(-10);
      if (/popcorn$/.test(typed)) { typed = ''; rain(['🍿'], 48); kravn.toast('🍿 Fresh, hot and buttery'); found('popcorn'); }
      if (/action$/.test(typed) && document.body.classList.contains('error-page')) { typed = ''; clap(); }
    }

    if (key === '?') { shortcuts(); return; }
    if (key === 'l' && document.body.classList.contains('movie-page')) {
      lights = !lights;
      document.body.classList.toggle('lights-out', lights);
      if (lights) { kravn.toast('🎞 Lights out', 'Press L again to bring them back.'); found('lights'); }
      return;
    }
    if (gPending && Date.now() - gPending < 1200) {
      gPending = 0;
      var dest = { h: '/feed', d: '/discussions', p: '/dashboard', n: '/posts/new', a: '/about' }[key];
      if (dest && window.KRAVN && window.KRAVN.me) location.href = dest;
      return;
    }
    if (key === 'g') gPending = Date.now();
  });

  document.addEventListener('pointermove', function (e) {
    if (!lights) return;
    document.body.style.setProperty('--mx', e.clientX + 'px');
    document.body.style.setProperty('--my', e.clientY + 'px');
  });

  // logo: 7 quick clicks. The nav logo is a link, so a single click waits a beat before navigating.
  var logoClicks = 0, logoTimer;
  document.addEventListener('click', function (e) {
    var logo = e.target.closest('[data-egg="logo"]');
    var ring = e.target.closest('[data-egg="ring"]');
    var credit = e.target.closest('[data-egg="credits"]');
    var clapperEl = e.target.closest('[data-egg="clapper"]');

    if (logo) {
      var isLink = logo.tagName === 'A';
      if (isLink) e.preventDefault();
      logoClicks++;
      clearTimeout(logoTimer);
      if (logoClicks >= 7) { logoClicks = 0; rain(['🍿'], 60); kravn.toast('🍿 You really like clicking things', 'Popcorn is on the house.'); found('logo'); return; }
      logoTimer = setTimeout(function () {
        var n = logoClicks; logoClicks = 0;
        if (isLink && n === 1) location.href = logo.getAttribute('href');
      }, isLink ? 320 : 900);
    }
    if (ring) {
      ring._n = (ring._n || 0) + 1;
      if (ring._n >= 3) {
        ring._n = 0;
        ring.classList.remove('spin'); void ring.offsetWidth; ring.classList.add('spin');
        kravn.toast('Critics: 100% · Your friends: “it was okay”', 'Ratings are just opinions with maths.');
        found('ring');
      }
    }
    if (credit) { credits(); found('credits'); }
    if (clapperEl) clap();
  });

  document.addEventListener('dblclick', function (e) {
    var poster = e.target.closest('[data-egg="poster"]');
    if (!poster) return;
    var h1 = document.querySelector('.mhero-title');
    oscar(h1 ? h1.firstChild.textContent.trim() : 'this movie');
    found('poster');
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act="eggs"]');
    if (b) { openDex(); }
  });
  document.addEventListener('kravn:theme', function (e) {
    if (e.detail === 'light') { kravn.toast('✨ Gold Reel unlocked', 'Same cinema, warmer projector.'); found('goldreel'); }
  });

  function clap() {
    var c = document.querySelector('.clapper');
    if (c) { c.classList.remove('clap'); void c.offsetWidth; c.classList.add('clap'); }
    kravn.toast('🎬 Take two!', 'Action!');
    found('clapper');
  }

  function shortcuts() {
    kravn.openLayer('modal',
      '<div class="modal-box card" style="max-width:480px"><button class="icon-btn modal-close" data-close aria-label="Close">' + kravn.icon('x') + '</button>' +
      '<h3 style="margin-bottom:14px">Secret shortcuts</h3><div class="facts" style="grid-template-columns:1fr 1fr;gap:12px">' +
      [['/', 'Search'], ['g  h', 'Home'], ['g  d', 'Discussions'], ['g  p', 'Dashboard'], ['g  n', 'New discussion'], ['L', 'Lights out (movie page)'], ['?', 'This list']].map(function (r) {
        return '<div><dt><kbd>' + r[0] + '</kbd></dt><dd>' + r[1] + '</dd></div>';
      }).join('') + '</div><p class="muted small" style="margin-top:16px">There’s also an old gamer’s code that works anywhere…</p></div>');
    found('shortcuts');
  }

  function openDex() {
    kravn.openLayer('modal',
      '<div class="modal-box card" style="max-width:640px"><button class="icon-btn modal-close" data-close aria-label="Close">' + kravn.icon('x') + '</button>' +
      '<h3 style="margin-bottom:6px">Easter egg hunt</h3><p class="muted small" style="margin-bottom:14px">' + load().length + ' of ' + EGGS.length + ' found</p>' +
      '<ul class="egg-dex">' + dexHTML(load()) + '</ul></div>');
  }

  /* --------------------------------- start ---------------------------------- */
  function start() {
    refreshUI();
    var hour = new Date().getHours();
    if (window.KRAVN && window.KRAVN.me && hour >= 0 && hour < 4) {
      setTimeout(function () { kravn.toast('🌙 Midnight screening', 'Shouldn’t you be asleep? We won’t tell.'); found('midnight'); }, 1500);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
