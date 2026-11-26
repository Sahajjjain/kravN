require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');

const pool = require('./config/db');
const tmdb = require('./config/tmdb');
const format = require('./lib/format');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is missing from environment variables');
}

app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Render's proxy

// gzip compression for HTML, JSON, CSS and JS (smaller pages on mobile data).
// Optional: if the package isn't installed yet the site still runs, just without compression.
try { app.use(require('compression')()); } catch (err) { console.warn('compression not installed — run `npm install` to enable it.'); }
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Helpers every template can call, plus a cache-busting token for CSS/JS (changes every deploy)
Object.assign(app.locals, format, {
  assetV: Date.now().toString(36),
  tmdbReady: tmdb.isReady(),
  img: tmdb.img,
});

/* ------------------------------ static files ------------------------------ */

app.use(
  express.static(path.join(__dirname, 'public'), {
    // no long caching while developing, so edits show up on a normal refresh
    maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
    setHeaders(res, file) {
      if (/(sw\.js|manifest\.json)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CSS version = the file's last-modified time, so any edit to kravn.css busts the browser cache.
// res.locals beats app.locals, so head.ejs keeps using <%= assetV %> unchanged.
const cssFile = path.join(__dirname, 'public', 'css', 'kravn.css');
let cssVersionCache = null;
function cssVersion() {
  // in production the file only changes on deploy (which restarts the server), so read it once
  if (process.env.NODE_ENV === 'production' && cssVersionCache) return cssVersionCache;
  try { cssVersionCache = fs.statSync(cssFile).mtimeMs.toString(36); } catch (e) { /* keep old value */ }
  return cssVersionCache;
}

// Same idea for the watchlist script (used as <%= wlV %> in the nav)
const wlFiles = [path.join(__dirname, 'public', 'js', 'watchlist.js')];
let wlVersionCache = null;
function wlVersion() {
  if (process.env.NODE_ENV === 'production' && wlVersionCache) return wlVersionCache;
  try { wlVersionCache = Math.max(...wlFiles.map((f) => fs.statSync(f).mtimeMs)).toString(36); } catch (e) { /* keep old value */ }
  return wlVersionCache;
}

app.use((req, res, next) => {
  const v = cssVersion();
  if (v) res.locals.assetV = v;
  const w = wlVersion();
  if (w) res.locals.wlV = w;
  next();
});

/* -------------------------------- session -------------------------------- */

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    },
  })
);

// Who is logged in + unread notification count, available to every view
app.use(async (req, res, next) => {
  const userId = req.session && req.session.userId;
  res.locals.me = userId ? { id: userId, username: req.session.username } : null;
  res.locals.unread = 0;
  res.locals.nav = '';
  res.locals.path = req.path;
  res.locals.here = req.originalUrl; // where to return to after login

  if (userId && req.method === 'GET' && !req.path.startsWith('/api/')) {
    try {
      const [rows] = await pool.query(
        'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0',
        [userId]
      );
      res.locals.unread = rows[0].count;
    } catch (err) {
      res.locals.unread = 0;
    }
  }
  next();
});

/* --------------------------------- routes -------------------------------- */

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/browse'));
app.use('/', require('./routes/movies'));
app.use('/', require('./routes/posts'));
app.use('/', require('./routes/watchlist')); // before users, so /users/:name/watchlist is never shadowed
app.use('/', require('./routes/wrapped'));
app.use('/', require('./routes/users'));

/* ------------------------------ 404 + errors ------------------------------ */

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).render('error', { code: 404, message: 'This reel is missing from the archive.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return;
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Something went wrong' });
  res.status(500).render('error', { code: 500, message: 'Something went wrong on our side. Please try again.' });
});

/* --------------------------------- start --------------------------------- */

app.listen(PORT, () => {
  console.log(`KravN running on http://localhost:${PORT}`);
  if (!tmdb.isReady()) console.warn('WARNING: TMDB_API_KEY is not set — movie data will be unavailable.');
});

pool
  .query('SELECT 1 + 1 AS result')
  .then(([rows]) => console.log('DB connected. Test query result:', rows[0].result))
  .catch((err) => console.error('DB connection failed:', err));

// create the watchlist tables once at startup (safe to run every time)
require('./routes/watchlist').ready().then(() => console.log('Watchlist tables ready.')).catch((err) => console.error('Watchlist setup failed:', err));