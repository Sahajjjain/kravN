const express = require('express');
const router = express.Router();

const pool = require('../config/db');
const requireLogin = require('../middleware/authMiddleware');
const curate = require('../lib/curate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function cleanFilters(q) {
  const type = ['movie', 'tv'].includes(q.type) ? q.type : 'all';
  const genre = curate.FILTER_GENRES.includes(q.genre) ? q.genre : '';
  const minRating = [6, 7, 8].includes(Number(q.min)) ? Number(q.min) : 0;
  const box = ['blockbuster', 'hit', 'solid', 'indie'].includes(q.box) ? q.box : '';
  let origin = ['indian', 'world'].includes(q.origin) ? q.origin : '';
  let country = /^[A-Z]{2}$/.test(String(q.country || '')) ? String(q.country) : '';
  if (country === 'IN') { origin = 'indian'; country = ''; } // India has its own Bollywood-first mode
  if (origin) country = '';                                  // one origin filter at a time
  const page = Math.min(8, Math.max(1, parseInt(q.page, 10) || 1)); // later pages feed the endless scroll
  return { type, genre, minRating, box, origin, country, page };
}

const sessionId = (req) => (req.session && req.session.userId) || 0;
const findUser = async (username) => {
  const [rows] = await pool.query('SELECT id, username FROM users WHERE username = ?', [username]);
  return rows[0] || null;
};

/* ------------------------------- pages ------------------------------- */

// Your own Curate page. Cached picks are embedded in the page, so a returning visit has no loading screen.
router.get('/curate', requireLogin, wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT id, username FROM users WHERE id = ?', [req.session.userId]);
  if (!rows.length) return res.redirect('/logout');
  const id = rows[0].id;
  const [isPublic, init, watched] = await Promise.all([
    curate.isPublic(id),
    curate.peek(id).catch(() => null),
    curate.seenList(id).catch(() => []),
  ]);
  if (!init) curate.warm(id); // first visit: start building now, the page joins the same build
  res.set('Cache-Control', 'private, no-store');
  res.render('curate', { nav: 'curate', C: { username: rows[0].username, isOwn: true, isPublic, priv: false, init, watched } });
}));

// Someone else's Curate page: open unless they switched it to private
router.get('/curate/:username', wrap(async (req, res) => {
  const user = await findUser(req.params.username);
  if (!user) return res.status(404).render('error', { code: 404, message: 'No one by that name here.' });
  if (sessionId(req) === user.id) return res.redirect('/curate');
  const isPublic = await curate.isPublic(user.id);
  const init = isPublic ? await curate.peek(user.id).catch(() => null) : null;
  res.set('Cache-Control', 'private, no-store');
  res.render('curate', { nav: '', C: { username: user.username, isOwn: false, isPublic, priv: !isPublic, init, watched: [] } });
}));

/* -------------------------------- API -------------------------------- */

// Same-origin poster proxy (lets the share image be drawn on a canvas without CORS problems)
router.get('/api/curate-img', wrap(async (req, res) => {
  const u = String(req.query.u || '');
  if (!/^https:\/\/image\.tmdb\.org\/t\/p\/(w\d{2,4}|original)\/[\w./-]+$/.test(u)) return res.status(400).end();
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return res.status(404).end();
    res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=604800');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (err) { res.status(502).end(); }
}));

// GET /api/curate/:username?type=&genre=&min=&box=&origin=&country=
router.get('/api/curate/:username', wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const user = await findUser(req.params.username);
  if (!user) return res.status(404).json({ error: 'No one by that name here.' });
  const owner = sessionId(req) === user.id;
  const isPublic = await curate.isPublic(user.id);
  if (!owner && !isPublic) return res.status(403).json({ private: true, error: 'This Curate is private.' });
  try {
    const [data, watched] = await Promise.all([
      curate.generate(user.id, cleanFilters(req.query), { force: owner && req.query.refresh === '1' }),
      owner ? curate.seenList(user.id) : Promise.resolve(undefined),
    ]);
    res.json(Object.assign({ owner, isPublic }, data, owner ? { watched } : {}));
  } catch (err) {
    console.error('curate failed:', err);
    res.status(502).json({ error: 'Could not build recommendations right now. Please try again.' });
  }
}));

// POST /api/curate/seen  { key: "movie:123", verdict: loved|liked|meh|disliked|skip }
// Only the key and the verdict come from the client. Title, year and poster are resolved and stored by the server.
router.post('/api/curate/seen', wrap(async (req, res) => {
  const uid = sessionId(req);
  if (!uid) return res.status(401).json({ error: 'Please log in' });
  const entry = await curate.markSeen(uid, req.body || {});
  if (!entry) return res.status(400).json({ error: 'Invalid title or rating' });
  res.json({ ok: true, entry });
}));

// POST /api/curate/unseen  { key }
router.post('/api/curate/unseen', wrap(async (req, res) => {
  const uid = sessionId(req);
  if (!uid) return res.status(401).json({ error: 'Please log in' });
  const ok = await curate.unmarkSeen(uid, (req.body || {}).key);
  if (!ok) return res.status(400).json({ error: 'Invalid title' });
  res.json({ ok: true });
}));

// POST /profile/curate/visibility  { public: true|false }
router.post('/profile/curate/visibility', wrap(async (req, res) => {
  const uid = sessionId(req);
  if (!uid) return res.status(401).json({ error: 'Please log in' });
  const value = !!(req.body && req.body.public === true);
  await curate.setPublic(uid, value);
  res.json({ isPublic: value });
}));

module.exports = router;