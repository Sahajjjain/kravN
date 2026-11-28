const express = require('express');
const router = express.Router();

const pool = require('../config/db');
const tmdb = require('../config/tmdb');
const requireLogin = require('../middleware/authMiddleware');
const { listPosts } = require('../lib/posts');
const curate = require('../lib/curate');

// true  = anyone can see which discussions a user has liked (Likes tab on every profile)
// false = only the owner sees the Likes tab on their own dashboard
const SHOW_LIKES_PUBLIC = true;

console.log('[users] bio + vibes routes loaded');

const BIO_MAX = 20;   // characters
const VIBE_MAX = 3;   // movies

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ------------------- schema (runs once, safe to repeat) ------------------- */

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      try {
        await pool.query('ALTER TABLE users ADD COLUMN bio VARCHAR(80) NULL');
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') throw err; // column already exists = fine
      }
      await pool.query(
        `CREATE TABLE IF NOT EXISTS user_vibes (
           user_id   INT NOT NULL,
           slot      TINYINT NOT NULL,
           movie_key VARCHAR(24) NOT NULL,
           title     VARCHAR(200) NOT NULL,
           year      VARCHAR(4) NOT NULL DEFAULT '',
           poster    VARCHAR(300) NOT NULL DEFAULT '',
           PRIMARY KEY (user_id, slot)
         )`
      );
    })().catch((err) => { schemaReady = null; throw err; }); // retry on the next request
  }
  return schemaReady;
}

/* --------------------------------- helpers -------------------------------- */

const cleanBio = (s) =>
  Array.from(String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()).join('');

const jsonAuth = (req, res) => {
  if (req.session && req.session.userId) return true;
  res.status(401).json({ error: 'Please log in' });
  return false;
};

// Dashboard (your own) and public profiles are the same page: one query, one view
async function renderProfile(req, res, user, isOwn) {
  const showLikes = SHOW_LIKES_PUBLIC || isOwn;

  const [{ posts }, likedResult, [recentComments], [vibeRows], watchLists, curatePublic] = await Promise.all([
    listPosts({
      userId: req.session.userId, where: 'posts.user_id = ?', params: [user.id], limit: 500,
    }),
    showLikes
      ? listPosts({
          userId: req.session.userId,
          where: 'posts.id IN (SELECT likes.post_id FROM likes WHERE likes.user_id = ?)',
          params: [user.id],
          limit: 100,
        })
      : Promise.resolve(null),
    pool.query(
      `SELECT comments.id, comments.content, comments.created_at,
              posts.id AS post_id, posts.title AS post_title, posts.movie_name
       FROM comments JOIN posts ON comments.post_id = posts.id
       WHERE comments.user_id = ?
       ORDER BY comments.created_at DESC, comments.id DESC
       LIMIT 30`,
      [user.id]
    ),
    pool.query(
      'SELECT movie_key AS id, title, year, poster FROM user_vibes WHERE user_id = ? ORDER BY slot LIMIT ?',
      [user.id, VIBE_MAX]
    ),
    // public watchlists (Lists tab); never lets a watchlist problem break the profile
    (async () => {
      try {
        const wl = require('./watchlist');
        return typeof wl.publicLists === 'function' ? await wl.publicLists(user.id) : undefined;
      } catch (err) {
        return undefined;
      }
    })(),
    // KravN Curate visibility (private by default); never lets a Curate problem break the profile
    curate.isPublic(user.id).catch(() => false),
  ]);

  res.render('profile', {
    nav: isOwn ? 'dashboard' : '',
    profileUser: user,
    isOwn,
    posts,
    likedPosts: likedResult ? likedResult.posts : undefined, // undefined hides the Likes tab
    recentComments,
    vibeMovies: vibeRows,
    watchLists,
    curatePublic,
    stats: {
      discussions: posts.length,
      likes: posts.reduce((n, p) => n + Number(p.like_count), 0),
      comments: posts.reduce((n, p) => n + Number(p.comment_count), 0),
      movies: new Set(posts.map((p) => p.imdb_id || String(p.movie_name).toLowerCase())).size,
    },
  });
}

/* ---------------------------------- pages --------------------------------- */

router.get('/dashboard', requireLogin, wrap(async (req, res) => {
  await ensureSchema();
  const [rows] = await pool.query('SELECT id, username, created_at, bio FROM users WHERE id = ?', [req.session.userId]);
  if (!rows.length) return res.redirect('/logout');
  await renderProfile(req, res, rows[0], true);
}));

router.get('/profile', requireLogin, (req, res) => res.redirect('/dashboard'));

router.get('/users/:username', wrap(async (req, res) => {
  await ensureSchema();
  const [rows] = await pool.query('SELECT id, username, created_at, bio FROM users WHERE username = ?', [req.params.username]);
  if (!rows.length) return res.status(404).render('error', { code: 404, message: 'No one by that name here.' });
  await renderProfile(req, res, rows[0], rows[0].id === req.session.userId);
}));

/* ------------------------- bio + vibe movies (JSON) ------------------------ */

router.post('/profile/bio', wrap(async (req, res) => {
  if (!jsonAuth(req, res)) return;
  try {
    await ensureSchema();
    const bio = cleanBio(req.body && req.body.bio);
    if (Array.from(bio).length > BIO_MAX) return res.status(400).json({ error: `Bio can be at most ${BIO_MAX} characters` });
    await pool.query('UPDATE users SET bio = ? WHERE id = ?', [bio || null, req.session.userId]);
    res.json({ bio });
  } catch (err) {
    console.error('bio save failed:', err);
    res.status(500).json({ error: 'Could not save' });
  }
}));

router.post('/profile/vibes', wrap(async (req, res) => {
  if (!jsonAuth(req, res)) return;
  const input = req.body && Array.isArray(req.body.movies) ? req.body.movies : null;
  if (!input) return res.status(400).json({ error: 'Invalid request' });

  const seen = new Set();
  const movies = [];
  for (const m of input) {
    if (!m || typeof m !== 'object') continue;
    const id = String(m.id || '');
    const title = String(m.title || '').trim().slice(0, 200);
    if (!/^(movie|tv):\d{1,9}$/.test(id) || !title || seen.has(id)) continue;
    seen.add(id);
    const year = /^\d{4}$/.test(String(m.year || '')) ? String(m.year) : '';
    const poster = /^https:\/\/image\.tmdb\.org\/t\/p\/[\w/.-]+$/.test(String(m.poster || '')) ? String(m.poster).slice(0, 300) : '';
    movies.push({ id, title, year, poster });
    if (movies.length === VIBE_MAX) break;
  }

  let conn;
  try {
    await ensureSchema();
    conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.query('DELETE FROM user_vibes WHERE user_id = ?', [req.session.userId]);
    for (let i = 0; i < movies.length; i++) {
      const m = movies[i];
      await conn.query(
        'INSERT INTO user_vibes (user_id, slot, movie_key, title, year, poster) VALUES (?, ?, ?, ?, ?, ?)',
        [req.session.userId, i, m.id, m.title, m.year, m.poster]
      );
    }
    await conn.commit();
    res.json({ movies });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (e) { /* ignore */ } }
    console.error('vibes save failed:', err);
    res.status(500).json({ error: 'Could not save' });
  } finally {
    if (conn) conn.release();
  }
}));

// Movie / series search used by the "Movies you vibe with" picker
router.get('/api/vibes/search', wrap(async (req, res) => {
  if (!jsonAuth(req, res)) return;
  const q = String(req.query.q || '').trim().slice(0, 100);
  res.set('Cache-Control', 'no-store');
  if (q.length < 2) return res.json({ results: [] });
  const list = await tmdb.searchTitles(q);
  res.json({
    results: list.results.slice(0, 12).map((m) => ({
      id: `${m.type}:${m.id}`,
      title: m.title,
      year: m.year,
      poster: m.poster || '',
    })),
  });
}));

/* ------------------------------ notifications ----------------------------- */

const NOTIFS_PER_PAGE = 30;

router.get('/notifications', requireLogin, wrap(async (req, res) => {
  const userId = req.session.userId;
  const page = Math.min(50, Math.max(1, parseInt(req.query.page, 10) || 1));

  // one extra row tells us whether an "older" page exists
  const [rows] = await pool.query(
    `SELECT notifications.*,
       actor.username AS actor_username,
       posts.title AS post_title,
       posts.movie_name,
       posts.poster_url,
       COALESCE(
         cm.content,
         (SELECT c.content FROM comments c
           WHERE c.post_id = notifications.post_id AND c.user_id = notifications.actor_id
           ORDER BY c.id DESC LIMIT 1)
       ) AS comment_content
     FROM notifications
     LEFT JOIN users AS actor ON notifications.actor_id = actor.id
     LEFT JOIN posts ON notifications.post_id = posts.id
     LEFT JOIN comments AS cm ON cm.id = notifications.comment_id
     WHERE notifications.user_id = ?
     ORDER BY notifications.created_at DESC
     LIMIT ? OFFSET ?`,
    [userId, NOTIFS_PER_PAGE + 1, (page - 1) * NOTIFS_PER_PAGE]
  );
  const hasMore = rows.length > NOTIFS_PER_PAGE;
  const notifications = rows.slice(0, NOTIFS_PER_PAGE);

  await pool.query('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [userId]);
  res.render('notifications', { nav: 'notifications', notifications, unreadBefore: res.locals.unread, page, hasMore });
}));

module.exports = router;