/* KravN core — everything interactive that is shared by every page.
   Pages only add data-* attributes; there is no per-page script. */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };

  var kravn = window.kravn = window.kravn || {};
  kravn.$ = $; kravn.$$ = $$; kravn.esc = esc; kravn.store = store;

  /* ------------------------------- toast -------------------------------- */
  var toastTimer;
  kravn.toast = function (msg, sub, ms) {
    var el = $('#toast');
    if (!el) return;
    el.innerHTML = esc(msg) + (sub ? '<small>' + esc(sub) + '</small>' : '');
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, ms || 2800);
  };

  /* ------------------------------ modals -------------------------------- */
  function openLayer(className, html, onClose) {
    var layer = document.createElement('div');
    layer.className = className;
    layer.innerHTML = html;
    document.body.appendChild(layer);
    document.body.style.overflow = 'hidden';
    function close() {
      layer.remove();
      if (!$('.modal, .sheet, .kc-overlay')) document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      if (onClose) onClose();
    }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    document.addEventListener('keydown', onKey);
    layer.addEventListener('click', function (e) { if (e.target === layer || e.target.closest('[data-close]')) close(); });
    layer.close = close;
    return layer;
  }
  kravn.openLayer = openLayer;

  function openVideo(key) {
    openLayer('modal', '<div class="modal-box"><button class="icon-btn modal-close" data-close aria-label="Close">' + icon('x') + '</button>' +
      '<div class="modal-video"><iframe src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(key) + '?autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="Video"></iframe></div></div>');
  }
  function openImage(src) {
    openLayer('modal', '<div class="modal-box"><button class="icon-btn modal-close" data-close aria-label="Close">' + icon('x') + '</button><img class="modal-img" src="' + esc(src) + '" alt=""></div>');
  }
  function icon(name) {
    var paths = { x: '<path d="M18 6 6 18M6 6l12 12"/>', link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>', share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v14"/>', download: '<path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 21h16"/>', chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' };
    return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || '') + '</svg>';
  }
  kravn.icon = icon;

  /* ----------------------------- share sheet ---------------------------- */
  kravn.openShare = function (opts) {
    var url = new URL(opts.url, location.origin).href;
    var text = opts.text || opts.title;
    var enc = encodeURIComponent;
    var post = opts.post;
    var html = '<div class="sheet-box" role="dialog" aria-label="Share"><h3>Share</h3><p>' + esc(opts.title) + '</p><div class="sheet-grid">' +
      (post ? '<button class="btn btn-primary" data-s="card">' + icon('share') + ' Share Kravn Card</button><button class="btn btn-ghost" data-s="download">' + icon('download') + ' Save card image</button>' : '') +
      '<button class="btn btn-ghost" data-s="copy">' + icon('link') + ' Copy link</button>' +
      '<a class="btn btn-ghost" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=' + enc(text + ' ' + url) + '">WhatsApp</a>' +
      '<a class="btn btn-ghost" target="_blank" rel="noopener noreferrer" href="https://twitter.com/intent/tweet?text=' + enc(text) + '&url=' + enc(url) + '">X / Twitter</a>' +
      '<a class="btn btn-ghost" target="_blank" rel="noopener noreferrer" href="https://t.me/share/url?url=' + enc(url) + '&text=' + enc(text) + '">Telegram</a>' +
      (navigator.share ? '<button class="btn btn-ghost" data-s="native">More…</button>' : '') +
      '</div><button class="btn btn-ghost btn-block" data-close>Close</button></div>';
    var layer = openLayer('sheet', html);
    layer.addEventListener('click', function (e) {
      var b = e.target.closest('[data-s]');
      if (!b) return;
      var act = b.dataset.s;
      if (act === 'copy') copyText(url).then(function () { kravn.toast('Link copied', 'Paste it anywhere'); layer.close(); });
      if (act === 'native') navigator.share({ title: opts.title, text: text, url: url }).catch(function () {});
      if (act === 'card' && window.KravnCards) { layer.close(); window.KravnCards.share(post); }
      if (act === 'download' && window.KravnCards) { window.KravnCards.download(post); }
    });
  };
  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).catch(function () { return legacyCopy(t); });
    return Promise.resolve(legacyCopy(t));
  }
  function legacyCopy(t) {
    var ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
  }
  kravn.copyText = copyText;

  /* ------------------------------ like button --------------------------- */
  kravn.setLiked = function (id, liked, count) {
    $$('[data-like="' + id + '"]').forEach(function (b) {
      b.classList.toggle('on', liked);
      b.setAttribute('aria-pressed', liked ? 'true' : 'false');
      var label = $('[data-like-label]', b);
      if (label) label.textContent = liked ? 'Liked' : 'Like';
    });
    $$('[data-like-count="' + id + '"]').forEach(function (c) { c.textContent = count; c.hidden = false; });
    // keep the data blob (used by Kravn Cards) in sync
    $$('[data-post]').forEach(function (el) {
      try { var d = JSON.parse(el.getAttribute('data-post')); if (String(d.id) === String(id)) { d.liked = liked; d.likes = count; el.setAttribute('data-post', JSON.stringify(d)); el.dataset.likes = count; } } catch (e) { /* ignore */ }
    });
  };
  kravn.like = function (id, action) {
    if (!(window.KRAVN && window.KRAVN.me)) { // guests can look, but liking needs an account
      kravn.toast('Log in to like discussions', 'Taking you there…');
      setTimeout(function () { location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search); }, 900);
      return Promise.resolve({ liked: false, count: 0, guest: true });
    }
    return fetch('/posts/' + id + '/like', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch' },
      body: 'action=' + (action || 'toggle'),
    }).then(function (r) { if (!r.ok) throw new Error('like failed'); return r.json(); })
      .then(function (j) { kravn.setLiked(id, j.liked, j.count); return j; });
  };

  /* -------------------------- infinite scrolling ------------------------ */
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) e.target._load(); });
  }, { rootMargin: '700px 0px' }) : null;

  function initInfinite(el) {
    if (el._inf) return;
    el._inf = true;
    var target = $(el.dataset.target);
    var param = el.dataset.param || 'page';
    var base = el.dataset.infinite;
    var next = parseInt(el.dataset.next, 10) || 2;
    var busy = false;
    if (!target) return;

    function finish() {
      if (io) io.unobserve(el);
      if (el.dataset.end) {
        var p = document.createElement('p');
        p.className = 'end'; p.dataset.egg = 'credits'; p.textContent = el.dataset.end;
        el.replaceWith(p);
      } else el.remove();
    }
    el._load = function () {
      if (busy) return;
      busy = true;
      fetch(base + (base.indexOf('?') > -1 ? '&' : '?') + param + '=' + next, { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } })
        .then(function (r) { if (!r.ok) throw new Error('bad status'); return r.json(); })
        .then(function (j) {
          if (j.html) {
            var tpl = document.createElement('template');
            tpl.innerHTML = j.html;
            target.appendChild(tpl.content);
          }
          next = j.next != null ? j.next : next + 1;
          busy = false;
          if (!j.hasMore) return finish();
          if (io) { io.unobserve(el); io.observe(el); } // re-check: sentinel may still be on screen
        })
        .catch(function () {
          busy = false;
          el.innerHTML = '<button type="button" class="btn btn-ghost btn-sm">Couldn’t load more — tap to retry</button>';
          el.firstChild.addEventListener('click', function () { el.innerHTML = '<span class="spinner"></span>'; el._load(); });
        });
    };
    if (io) io.observe(el);
    else el.innerHTML = '<button type="button" class="btn btn-ghost">Load more</button>', el.firstChild.addEventListener('click', el._load);
  }

  /* ------------------------------ live search --------------------------- */
  function initLiveSearch(input) {
    var out = $(input.dataset.target);
    var compose = input.dataset.mode === 'compose';
    var moviesOnly = input.hasAttribute('data-movies-only');
    var timer, seq = 0, active = -1;
    if (!out) return;

    function items() { return $$('.live-item', out); }
    function setActive(i) {
      var list = items();
      if (!list.length) return;
      active = (i + list.length) % list.length;
      list.forEach(function (el, n) { el.classList.toggle('active', n === active); });
      list[active].scrollIntoView({ block: 'nearest' });
    }
    function render(results, q) {
      active = -1;
      if (moviesOnly) results = results.filter(function (r) { return r.type !== 'person'; }); // movies + series, no people
      if (!results.length) { out.innerHTML = '<p class="live-msg">Nothing found for “' + esc(q) + '”.</p>'; return; }
      out.innerHTML = results.map(function (r) {
        var href = r.type === 'person' ? '/person/' + r.id : (r.url || '/movie/' + r.id) + (compose ? '?compose=1#discussions' : '');
        var img = r.image ? '<img src="' + esc(r.image) + '" alt="" loading="lazy">' : '<span class="live-ph"></span>';
        var tone = r.percent >= 70 ? 'hi' : r.percent >= 50 ? 'mid' : 'lo';
        return '<a class="live-item' + (r.type === 'person' ? ' live-item--person' : '') + '" href="' + href + '">' + img +
          '<span><strong>' + esc(r.title) + '</strong><small>' + esc(r.type === 'person' ? (r.year || 'Person') : [r.year, r.type === 'tv' ? 'Series' : 'Movie'].filter(Boolean).join(' · ')) + '</small></span>' +
          (r.percent ? '<span class="match ' + tone + '">' + r.percent + '%</span>' : '') + '</a>';
      }).join('');
    }
    function run() {
      var q = input.value.trim();
      document.dispatchEvent(new CustomEvent('kravn:query', { detail: { q: q, input: input } }));
      if (q.length < 2) { out.innerHTML = ''; return; }
      var mine = ++seq;
      out.innerHTML = '<p class="live-msg"><span class="spinner" style="display:inline-block"></span></p>';
      fetch('/api/search?q=' + encodeURIComponent(q), { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (res) { if (mine === seq) render(res, q); })
        .catch(function () { if (mine === seq) out.innerHTML = '<p class="live-msg">Search is unavailable right now.</p>'; });
    }
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 260); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Enter') {
        var list = items();
        var pick = active > -1 ? list[active] : (compose ? list[0] : null);
        if (pick) { e.preventDefault(); location.href = pick.getAttribute('href'); }
      }
    });
    if (input.value.trim().length > 1) run();
  }

  /* --------------------------- search overlay --------------------------- */
  function openSearch() {
    var ov = $('#search-overlay');
    if (!ov) return;
    ov.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(function () { $('#search-input').focus(); }, 30);
  }
  function closeOverlay() {
    var ov = $('#search-overlay');
    if (ov && !ov.hidden) { ov.hidden = true; document.body.style.overflow = ''; }
  }

  /* ---------------------- client-side filter / sort --------------------- */
  function initFilterable(list) {
    var chips = $$('[data-filter-genres] [data-genre]');
    var sortSel = $('[data-sort-select]');
    var empty = $('#feed-empty');
    var genre = '';
    function apply() {
      var cards = $$('.pcard', list);
      var shown = 0;
      cards.forEach(function (c) {
        var ok = !genre || (c.dataset.genre || '').split('|').indexOf(genre) > -1;
        c.hidden = !ok; if (ok) shown++;
      });
      var by = sortSel ? sortSel.value : 'latest';
      var num = function (c, k) { return parseFloat(c.dataset[k]) || 0; };
      var sorted = cards.slice();
      if (by === 'random') sorted.sort(function () { return Math.random() - .5; });
      else sorted.sort(function (a, b) {
        if (by === 'oldest') return num(a, 'created') - num(b, 'created');
        if (by === 'rating') return num(b, 'rating') - num(a, 'rating');
        if (by === 'likes') return num(b, 'likes') - num(a, 'likes');
        return num(b, 'created') - num(a, 'created');
      });
      sorted.forEach(function (c) { list.appendChild(c); });
      if (empty) empty.hidden = shown > 0;
    }
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        genre = chip.dataset.genre;
        chips.forEach(function (c) { c.classList.toggle('on', c === chip); });
        apply();
      });
    });
    if (sortSel) sortSel.addEventListener('change', apply);

    var toggles = $$('[data-view-toggle] [data-view]');
    function setView(v) {
      list.classList.toggle('view-grid', v === 'grid');
      toggles.forEach(function (b) { b.classList.toggle('on', b.dataset.view === v); });
      store.set('kravn-view', v);
    }
    toggles.forEach(function (b) { b.addEventListener('click', function () { setView(b.dataset.view); }); });
    if (store.get('kravn-view') === 'grid') setView('grid');
  }

  /* ----------------------------- one-off setup -------------------------- */
  function initOnce() {
    // nav turns solid after scrolling
    var nav = $('#topnav');
    if (nav) {
      var onScroll = function () { nav.classList.toggle('solid', window.scrollY > 24); };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }

    $$('[data-infinite]').forEach(initInfinite);
    $$('[data-livesearch]').forEach(initLiveSearch);
    $$('[data-filterable]').forEach(initFilterable);

    // stat numbers count up
    $$('[data-count]').forEach(function (el) {
      var to = parseInt(el.dataset.count, 10) || 0;
      if (to < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      var t0 = performance.now();
      (function tick(t) {
        var p = Math.min(1, (t - t0) / 900);
        el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(tick);
      })(t0);
    });

    // reviews / bios: only show "Read more" when text is really clamped
    $$('[data-collapse]').forEach(function (box) {
      var text = $('.review-text', box);
      if (text && text.scrollHeight <= text.clientHeight + 2) box.classList.add('no-clamp');
    });

    // posting from a movie page: celebrate and clean the URL
    var params = new URLSearchParams(location.search);
    if (params.get('posted')) {
      kravn.toast('Posted! 🎬', 'Your discussion is live right here.');
      params.delete('posted');
      history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
    }
    flashHash();

    // composer opened from search (?compose=1)
    var composer = $('#composer.open');
    if (composer) setTimeout(function () { composer.scrollIntoView({ block: 'center' }); var t = $('input[name=title]', composer); if (t) t.focus({ preventScroll: true }); }, 150);

    // sticky section nav highlights the section you are in
    var spy = $('[data-spy]');
    if (spy) {
      var links = $$('a', spy);
      var secs = links.map(function (a) { return $(a.getAttribute('href')); }).filter(Boolean);
      var mark = function () {
        var y = window.scrollY + 140, cur = secs[0];
        secs.forEach(function (s) { if (s.offsetTop <= y) cur = s; });
        links.forEach(function (a) { a.classList.toggle('on', cur && a.getAttribute('href') === '#' + cur.id); });
      };
      window.addEventListener('scroll', mark, { passive: true });
      mark();
    }
  }

  function flashHash() {
    if (/^#d-\d+$/.test(location.hash)) {
      var el = $(location.hash);
      if (el) { el.classList.add('flash'); setTimeout(function () { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 200); }
    }
  }
  window.addEventListener('hashchange', flashHash);

  /* ----------------------------- delegated clicks ----------------------- */
  function parsePost(el) {
    var holder = el.closest('[data-post]');
    try { return holder ? JSON.parse(holder.getAttribute('data-post')) : null; } catch (e) { return null; }
  }
  kravn.postsIn = function (container) {
    return $$('[data-post]', container).filter(function (el) { return !el.hidden; }).map(function (el) { try { return JSON.parse(el.getAttribute('data-post')); } catch (e) { return null; } }).filter(Boolean);
  };

  document.addEventListener('click', function (e) {
    var t = e.target;
    var el;

    if ((el = t.closest('[data-act]'))) {
      var act = el.dataset.act;
      if (act === 'theme') {
        var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        store.set('kravn-theme', next);
        document.dispatchEvent(new CustomEvent('kravn:theme', { detail: next }));
        return;
      }
      if (act === 'search') { openSearch(); return; }
      if (act === 'close-overlay') { closeOverlay(); return; }
      if (act === 'composer-toggle') {
        var c = $('#composer');
        if (c) { c.classList.toggle('open'); if (c.classList.contains('open')) { var ti = $('input[name=title]', c); if (ti) ti.focus(); } else c.scrollIntoView({ block: 'center' }); }
        return;
      }
      if (act === 'compose') {
        e.preventDefault();
        var cm = $('#composer');
        if (cm) { cm.classList.add('open'); cm.scrollIntoView({ block: 'center', behavior: 'smooth' }); setTimeout(function () { var ti2 = $('input[name=title]', cm); if (ti2) ti2.focus({ preventScroll: true }); }, 400); }
        return;
      }
    }

    if ((el = t.closest('[data-menu-btn]'))) { el.closest('[data-menu]').classList.toggle('open'); return; }
    if (!t.closest('[data-menu]')) $$('[data-menu].open').forEach(function (m) { m.classList.remove('open'); });

    if ((el = t.closest('[data-rail-btn]'))) {
      var track = $('.rail-track', el.closest('.rail-wrap'));
      track.scrollBy({ left: parseInt(el.dataset.railBtn, 10) * track.clientWidth * 0.85, behavior: 'smooth' });
      return;
    }

    if ((el = t.closest('[data-like]'))) {
      e.preventDefault();
      var id = el.dataset.like;
      el.classList.add('pop'); setTimeout(function () { el.classList.remove('pop'); }, 500);
      kravn.like(id).then(function (j) { if (j && j.guest) el.classList.remove('on'); }).catch(function () { kravn.toast('Couldn’t save that like', 'Check your connection and try again.'); });
      return;
    }

    if ((el = t.closest('[data-share-post]'))) {
      e.preventDefault();
      var p = parsePost(el);
      if (p) kravn.openShare({ url: '/posts/' + p.id, title: p.movieName + ' — ' + p.title, text: '“' + p.title + '” — a discussion on ' + p.movieName + ' · KravN', post: p });
      return;
    }
    if ((el = t.closest('[data-share-movie]'))) {
      kravn.openShare({ url: el.dataset.url, title: el.dataset.title, text: 'Join the discussion on ' + el.dataset.title + ' · KravN' });
      return;
    }
    if ((el = t.closest('[data-cards-open]'))) {
      var box = $(el.dataset.cardsOpen);
      var posts = box ? kravn.postsIn(box) : [];
      if (!posts.length) return kravn.toast('No cards yet', 'Posts will show up here as Kravn Cards.');
      if (window.KravnCards) window.KravnCards.open(posts);
      return;
    }

    if ((el = t.closest('[data-video]'))) { openVideo(el.dataset.video); return; }
    if ((el = t.closest('[data-lightbox]'))) { openImage(el.dataset.lightbox); return; }

    if ((el = t.closest('[data-collapse-btn]'))) {
      var box2 = el.closest('[data-collapse]');
      box2.classList.toggle('open');
      el.textContent = box2.classList.contains('open') ? 'Show less' : 'Read more';
      return;
    }

    if ((el = t.closest('[data-tab]'))) {
      var tabs = el.closest('[data-tabs]');
      $$('[data-tab]', tabs).forEach(function (b) { b.classList.toggle('on', b === el); });
      $$('.tab-panel', tabs).forEach(function (pn) { pn.hidden = pn.id !== el.dataset.tab; });
      return;
    }
  });

  document.addEventListener('change', function (e) {
    var sel = e.target.closest('[data-region-select]');
    if (sel) $$('[data-region]').forEach(function (r) { r.hidden = r.dataset.region !== sel.value; });
  });

  // live character counter in the composer
  document.addEventListener('input', function (e) {
    var ta = e.target.closest('[data-char-count]');
    if (!ta) return;
    var hint = $('[data-char-hint]', ta.closest('form'));
    if (hint) hint.textContent = ta.value.length + ' / ' + ta.maxLength;
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeOverlay();
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '')) || e.target.isContentEditable;
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && $('#search-overlay')) { e.preventDefault(); openSearch(); }
  });

  // pre-warm TLS to TMDB images is done in <head>; start everything once the DOM is ready
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initOnce);
  else initOnce();
})();
