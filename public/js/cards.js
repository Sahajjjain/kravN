/* Kravn Cards — the collectible card for a discussion.
   One module powers: the swipeable deck (dashboard, profiles, movie pages),
   the card on a discussion page, and the PNG used when sharing. */
(function () {
  'use strict';

  var kravn = window.kravn = window.kravn || {};
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var css = function (name, fallback) { return (getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim() || fallback; };
  var shortDate = function (d) { var x = new Date(d); return isNaN(x) ? '' : x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); };

  /* ------------------------------ the card DOM ----------------------------- */
  function cardEl(p) {
    var el = document.createElement('div');
    el.className = 'kcard';
    if (p.posterUrl) el.style.backgroundImage = 'url("' + String(p.posterUrl).replace(/"/g, '%22') + '")';
    el.innerHTML =
      '<span class="kcard-holes l"></span><span class="kcard-holes r"></span>' +
      '<div class="kcard-brand"><div>Krav<b>N</b></div><span>CARD №' + esc(p.id) + '</span></div>' +
      '<div class="kcard-info">' +
        '<div class="kcard-movie">' + esc(p.movieName) + '</div>' +
        '<div class="kcard-title">' + esc(p.title) + '</div>' +
        '<div class="kcard-meta"><span>@' + esc(p.username) + '</span>' +
        (p.rating ? '<span class="kcard-stamp">★ ' + esc(p.rating) + '</span>' : '') +
        '<span>' + esc(shortDate(p.createdAt)) + '</span></div>' +
      '</div>';
    return el;
  }

  /* --------------------------- PNG for sharing ------------------------------ */
  function loadImage(url) {
    return new Promise(function (resolve) {
      if (!url) return resolve(null);
      var tries = 0;
      (function attempt(src) {
        var im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = function () { resolve(im); };
        im.onerror = function () {
          // a copy cached earlier without CORS headers can fail once — retry with a fresh URL
          if (tries++ < 1) attempt(src + (src.indexOf('?') > -1 ? '&' : '?') + 'kc=' + Date.now());
          else resolve(null);
        };
        im.src = src;
      })(url);
    });
  }

  function wrap(ctx, text, maxW, maxLines) {
    var words = String(text).split(/\s+/), lines = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = words[i]; } else line = test;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      while (last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
      lines[maxLines - 1] = last.replace(/[\s.,;:!?-]+$/, '') + '…';
    }
    return lines;
  }

  function draw(p, img) {
    var W = 1080, H = 1800, pad = 84;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    var accent = css('--accent', '#8b5cf6');

    ctx.fillStyle = '#0c0a14'; ctx.fillRect(0, 0, W, H);
    if (img) {
      var s = Math.max(W / img.width, H / img.height);
      ctx.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
    } else {
      var bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#2a1b52'); bg.addColorStop(1, '#0c0a14');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    }
    var shade = ctx.createLinearGradient(0, 0, 0, H);
    shade.addColorStop(0, 'rgba(8,6,14,.25)'); shade.addColorStop(.45, 'rgba(8,6,14,.3)'); shade.addColorStop(.78, 'rgba(8,6,14,.94)'); shade.addColorStop(1, 'rgba(8,6,14,.98)');
    ctx.fillStyle = shade; ctx.fillRect(0, 0, W, H);

    // film sprocket holes
    ctx.fillStyle = 'rgba(255,255,255,.16)';
    for (var y = 24; y < H; y += 56) { ctx.fillRect(14, y, 20, 32); ctx.fillRect(W - 34, y, 20, 32); }

    ctx.textBaseline = 'alphabetic';
    ctx.font = '800 64px "Bricolage Grotesque", Inter, sans-serif';
    ctx.fillStyle = '#fff'; ctx.fillText('Krav', pad, 130);
    var kw = ctx.measureText('Krav').width;
    ctx.fillStyle = accent; ctx.fillText('N', pad + kw, 130);
    ctx.font = '600 28px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.textAlign = 'right';
    ctx.fillText('CARD №' + p.id, W - pad, 126); ctx.textAlign = 'left';

    var maxW = W - pad * 2;
    ctx.font = '700 34px "JetBrains Mono", monospace';
    ctx.fillStyle = css('--accent-2', '#a78bfa');
    var movie = wrap(ctx, String(p.movieName).toUpperCase(), maxW, 2);
    ctx.font = '800 92px "Bricolage Grotesque", Inter, sans-serif';
    var title = wrap(ctx, p.title, maxW, 5);

    var blockH = movie.length * 46 + 26 + title.length * 104 + 150;
    var y0 = H - 110 - blockH + 46;
    ctx.font = '700 34px "JetBrains Mono", monospace';
    ctx.fillStyle = css('--accent-2', '#a78bfa');
    movie.forEach(function (l, i) { ctx.fillText(l, pad, y0 + i * 46); });
    y0 += movie.length * 46 + 26;
    ctx.font = '800 92px "Bricolage Grotesque", Inter, sans-serif';
    ctx.fillStyle = '#fff';
    title.forEach(function (l, i) { ctx.fillText(l, pad, y0 + 72 + i * 104); });
    y0 += title.length * 104 + 40;

    ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.setLineDash([10, 10]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pad, y0); ctx.lineTo(W - pad, y0); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '600 34px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillText('@' + p.username, pad, y0 + 62);
    ctx.textAlign = 'center';
    if (p.rating) { ctx.fillStyle = '#f5b83d'; ctx.fillText('★ ' + p.rating, W / 2, y0 + 62); }
    ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.fillText(shortDate(p.createdAt), W - pad, y0 + 62); ctx.textAlign = 'left';

    ctx.font = '600 26px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.textAlign = 'center';
    ctx.fillText('kravn.onrender.com', W / 2, H - 52); ctx.textAlign = 'left';
    return c;
  }

  function toBlob(canvas) {
    return new Promise(function (resolve, reject) {
      try { canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('empty')); }, 'image/png'); } catch (e) { reject(e); }
    });
  }

  function renderBlob(p) {
    var fonts = document.fonts && document.fonts.load ? Promise.all([
      document.fonts.load('800 64px "Bricolage Grotesque"'), document.fonts.load('600 30px "JetBrains Mono"'),
    ]).catch(function () {}) : Promise.resolve();
    return Promise.all([fonts, loadImage(p.posterUrl)]).then(function (r) {
      return toBlob(draw(p, r[1])).catch(function () { return toBlob(draw(p, null)); }); // tainted canvas → no poster
    });
  }

  function saveBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  function download(p) {
    kravn.toast('Preparing your card…');
    return renderBlob(p).then(function (b) { saveBlob(b, 'kravn-card-' + p.id + '.png'); kravn.toast('Card saved 🎬', 'Check your downloads.'); })
      .catch(function () { kravn.toast('Couldn’t build the card', 'Please try again.'); });
  }

  function share(p) {
    var url = location.origin + '/posts/' + p.id;
    var text = '“' + p.title + '” — a discussion on ' + p.movieName + ' · KravN\n' + url;
    kravn.toast('Preparing your card…');
    return renderBlob(p).then(function (blob) {
      var file = new File([blob], 'kravn-card-' + p.id + '.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: p.movieName + ' · KravN', text: text }).catch(function (e) { if (e && e.name !== 'AbortError') throw e; });
      }
      saveBlob(blob, file.name);
      kravn.copyText(url);
      kravn.toast('Card saved & link copied', 'Attach the image wherever you share.');
    }).catch(function () { kravn.toast('Couldn’t share the card', 'Use “Copy link” instead.'); });
  }

  /* ----------------------- card on a discussion page ------------------------ */
  function mount(host) {
    var p; try { p = JSON.parse(host.getAttribute('data-post')); } catch (e) { return; }
    var wrapEl = document.createElement('div');
    wrapEl.className = 'kcard-wrap';
    var card = cardEl(p);
    card.style.transition = 'transform .15s';
    card.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      var r = card.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      card.style.transform = 'perspective(800px) rotateY(' + (x * 12) + 'deg) rotateX(' + (-y * 12) + 'deg)';
    });
    card.addEventListener('pointerleave', function () { card.style.transform = ''; });
    wrapEl.appendChild(card);
    var actions = document.createElement('div');
    actions.className = 'kcard-actions';
    actions.innerHTML = '<button type="button" class="btn btn-primary btn-sm" data-k="share">' + kravn.icon('share') + ' Share card</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-k="download">' + kravn.icon('download') + ' Download</button>';
    actions.addEventListener('click', function (e) {
      var b = e.target.closest('[data-k]'); if (!b) return;
      if (b.dataset.k === 'share') share(p); else download(p);
    });
    wrapEl.appendChild(actions);
    host.appendChild(wrapEl);
  }

  /* --------------------------------- the deck ------------------------------- */
  function open(input) {
    if (!input || !input.length || document.querySelector('.kc-overlay')) return;
    var base = input.slice();
    var list = [], cur = 0, mode = 'latest', navTimer = null, lastTap = 0, closing = false;

    function sortList() {
      list = base.slice();
      if (mode === 'top') list.sort(function (a, b) { return (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0) || b.likes - a.likes; });
      else list.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    }
    sortList();

    var ov = document.createElement('div');
    ov.className = 'kc-overlay';
    ov.innerHTML =
      '<div class="kc-top"><div class="brand">Krav<span>N</span> <small class="muted" style="font:600 11px var(--mono)">CARDS</small></div>' +
      '<div class="kc-modes"><button type="button" data-m="latest" class="on">Latest</button><button type="button" data-m="top">Top rated</button></div>' +
      '<button type="button" class="icon-btn" data-k="close" aria-label="Close">' + kravn.icon('x') + '</button></div>' +
      '<div class="kc-stage"></div>' +
      '<div><p class="kc-hint">Swipe to flip · double-tap to like · tap to open</p>' +
      '<div class="kc-bottom"><button type="button" class="btn btn-ghost" data-k="prev">‹ Back</button>' +
      '<button type="button" class="btn btn-ghost" data-k="like">♥ Like</button><span class="kc-count"></span>' +
      '<button type="button" class="btn btn-ghost" data-k="share">' + kravn.icon('share') + ' Share</button>' +
      '<button type="button" class="btn btn-primary" data-k="next">Next ›</button></div></div>';
    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';
    history.pushState({ kc: 1 }, '');
    var stage = ov.querySelector('.kc-stage');

    function current() { return list[cur]; }
    function refreshBar() {
      ov.querySelector('.kc-count').textContent = cur < list.length ? (cur + 1) + ' / ' + list.length : 'done';
      var lb = ov.querySelector('[data-k=like]');
      var p = current();
      lb.style.visibility = p ? 'visible' : 'hidden';
      if (p) { lb.textContent = p.liked ? '♥ Liked' : '♡ Like'; lb.style.color = p.liked ? '#ff4d7d' : ''; }
    }

    function layout() {
      stage.innerHTML = '';
      if (cur >= list.length) {
        stage.innerHTML = '<div class="kc-empty"><h2>That’s the whole deck 🎬</h2><p class="muted" style="margin:8px 0 16px">You’ve seen every card.</p><button type="button" class="btn btn-primary" data-k="restart">Shuffle back to the start</button></div>';
        refreshBar(); return;
      }
      for (var k = Math.min(2, list.length - cur - 1); k >= 0; k--) {
        var slot = document.createElement('div');
        slot.className = 'kc-slot';
        slot.style.transform = 'translateY(' + (k * 16) + 'px) scale(' + (1 - k * .05) + ')';
        slot.style.opacity = k === 2 ? '.55' : '1';
        slot.style.zIndex = 10 - k;
        slot.appendChild(cardEl(list[cur + k]));
        stage.appendChild(slot);
      }
      attach(stage.lastChild);
      refreshBar();
    }

    function fling(slot, dir) {
      slot.classList.remove('drag');
      slot.style.transform = 'translateX(' + (dir * window.innerWidth) + 'px) rotate(' + (dir * 25) + 'deg)';
      slot.style.opacity = '0';
      setTimeout(function () { cur++; layout(); }, 240);
    }
    function next() { var top = stage.lastChild; if (cur < list.length && top && top.classList.contains('kc-slot')) fling(top, -1); else if (cur >= list.length) { cur = 0; layout(); } }
    function prev() { if (cur > 0) { cur--; layout(); } }

    function likeCurrent(burst) {
      var p = current(); if (!p) return;
      if (burst) {
        var b = document.createElement('div'); b.className = 'kc-burst'; b.textContent = '❤'; stage.appendChild(b);
        setTimeout(function () { b.remove(); }, 800);
      }
      if (p.liked) return;
      kravn.like(p.id, 'like').then(function (j) {
        if (j.guest) return;
        base.concat(list).forEach(function (x) { if (x.id === p.id) { x.liked = true; x.likes = j.count; } });
        refreshBar();
      }).catch(function () { kravn.toast('Couldn’t save that like'); });
    }

    function attach(slot) {
      var sx = 0, sy = 0, st = 0, dx = 0, down = false, moved = false;
      slot.addEventListener('pointerdown', function (e) { down = true; moved = false; sx = e.clientX; sy = e.clientY; st = Date.now(); dx = 0; slot.setPointerCapture(e.pointerId); slot.classList.add('drag'); });
      slot.addEventListener('pointermove', function (e) {
        if (!down) return;
        dx = e.clientX - sx;
        if (Math.abs(dx) > 6 || Math.abs(e.clientY - sy) > 6) moved = true;
        slot.style.transform = 'translateX(' + dx + 'px) translateY(' + ((e.clientY - sy) * .15) + 'px) rotate(' + (dx / 18) + 'deg)';
      });
      function end() {
        if (!down) return; down = false;
        slot.classList.remove('drag');
        var fast = Math.abs(dx) / Math.max(1, Date.now() - st) > .6;
        if (Math.abs(dx) > 110 || (fast && Math.abs(dx) > 40)) return fling(slot, dx > 0 ? 1 : -1);
        slot.style.transform = '';
        if (!moved) {
          var now = Date.now();
          if (now - lastTap < 320) { clearTimeout(navTimer); lastTap = 0; likeCurrent(true); }
          else { lastTap = now; var id = current().id; navTimer = setTimeout(function () { lastTap = 0; location.href = '/posts/' + id; }, 330); }
        }
      }
      slot.addEventListener('pointerup', end);
      slot.addEventListener('pointercancel', end);
    }

    function close() {
      if (closing) return; closing = true;
      clearTimeout(navTimer);
      ov.remove(); document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
      if (history.state && history.state.kc) history.back();
    }
    function onPop() { if (!closing) { closing = true; ov.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); window.removeEventListener('popstate', onPop); } }
    function onKey(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'l' || e.key === 'L') likeCurrent(true);
      else if (e.key === 'Enter' && current()) location.href = '/posts/' + current().id;
    }
    document.addEventListener('keydown', onKey);
    window.addEventListener('popstate', onPop);

    ov.addEventListener('click', function (e) {
      var m = e.target.closest('[data-m]');
      if (m) { mode = m.dataset.m; cur = 0; ov.querySelectorAll('[data-m]').forEach(function (b) { b.classList.toggle('on', b === m); }); sortList(); layout(); return; }
      var k = e.target.closest('[data-k]'); if (!k) return;
      var a = k.dataset.k;
      if (a === 'close') close();
      else if (a === 'next') next();
      else if (a === 'prev') prev();
      else if (a === 'like') likeCurrent(true);
      else if (a === 'share' && current()) share(current());
      else if (a === 'restart') { cur = 0; layout(); }
    });

    layout();
  }

  window.KravnCards = { open: open, share: share, download: download, renderBlob: renderBlob, cardEl: cardEl };

  function init() { document.querySelectorAll('[data-kcard-mount]').forEach(mount); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
