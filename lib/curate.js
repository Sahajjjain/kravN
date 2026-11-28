// KravN Curate engine (v4).
//
//  - Reads everything a user does on KravN: discussions (and their traction), likes, comments on other people's
//    discussions, "Vibes" picks and Watched feedback (loved / liked / meh / disliked / not for me).
//  - Builds a taste model from TMDB data, finds candidates, scores them, removes franchise duplicates and re-ranks
//    with a diversity pass.
//  - The BACKEND decides everything the page shows: reason lines ("Because you loved X"), which shelf each title sits
//    on, and the metadata of watched titles (the client only ever sends { key, verdict }).
//  - Picks stay fresh: an activity fingerprint (posts, likes, comments, vibes, watched) is stored with every snapshot,
//    so any new activity triggers a background rebuild. Recent activity counts more, every rebuild varies a little.
//  - Every user's Curate is public unless they switch it to private.
//
// Needs Node 18+ (global fetch, AbortSignal.timeout) and TMDB_API_KEY.
const pool = require('../config/db');

const KEY = process.env.TMDB_API_KEY || '';
const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w342';
const IMG_L = 'https://image.tmdb.org/t/p/w500';
const IMG_BG = 'https://image.tmdb.org/t/p/w780';
const BEARER = KEY.length > 60 || KEY.startsWith('eyJ');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const STALE = 10 * MIN; // a cached result older than this is still served instantly, but rebuilt in the background
const CONC = 14;

const INDIAN_LANGS = new Set(['hi', 'ta', 'te', 'ml', 'kn', 'bn', 'mr', 'pa', 'gu', 'ur', 'bho']);
const META_KEYWORDS = new Set(['duringcreditsstinger', 'aftercreditsstinger', 'based on novel or book', 'woman director', 'sequel', 'remake', 'based on true story', 'independent film', 'based on comic', 'anime']);

// how much each Watched verdict moves the taste model (negative = pushes similar titles down)
const SEEN_W = { loved: 6, liked: 3.5, meh: 0.5, disliked: -3, skip: -1 };
const VERDICTS = Object.keys(SEEN_W);

/* ------------------------------ small utilities ------------------------------ */

const cache = new Map();
function memo(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.p;
  const p = Promise.resolve().then(fn).catch((e) => { cache.delete(key); throw e; });
  cache.set(key, { exp: Date.now() + ttl, p });
  if (cache.size > 6000) cache.delete(cache.keys().next().value);
  return p;
}

async function pmap(list, n, fn) {
  const out = new Array(list.length).fill(null);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) {
      const k = i++;
      try { out[k] = await fn(list[k], k); } catch (e) { out[k] = null; }
    }
  }));
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tmdb(path, params) {
  if (!KEY) throw new Error('TMDB_API_KEY is not set');
  const url = new URL(BASE + path);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });
  const headers = { accept: 'application/json' };
  if (BEARER) headers.Authorization = 'Bearer ' + KEY; else url.searchParams.set('api_key', KEY);
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(9000) });
      if (res.status === 429 || res.status >= 500) throw new Error('TMDB ' + res.status);
      if (!res.ok) { const e = new Error('TMDB ' + res.status); e.final = true; throw e; }
      return await res.json();
    } catch (e) {
      if (e.final || attempt >= 1) throw e;
      await sleep(300);
    }
  }
}

let regionNames = null;
try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { /* older runtime */ }
const countryName = (c) => { try { return (regionNames && regionNames.of(c)) || c; } catch (e) { return c; } };
const flagEmoji = (c) => (/^[A-Z]{2}$/.test(c || '') ? String.fromCodePoint(127397 + c.charCodeAt(0), 127397 + c.charCodeAt(1)) + ' ' : '');

const shuffle = (a) => { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const pct = (x) => Math.max(0, Math.min(100, Math.round(x)));
const yearOfDate = (d) => String(d || '').slice(0, 4);
const jit = () => 1 + Math.floor(Math.random() * 3); // 1..3

/* --------------------------------- genres ---------------------------------- */

const MOVIE_G = { 28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western' };
const TV_G = { 10759: ['Action', 'Adventure'], 16: ['Animation'], 35: ['Comedy'], 80: ['Crime'], 99: ['Documentary'], 18: ['Drama'], 10751: ['Family'], 10762: ['Kids'], 9648: ['Mystery'], 10763: ['News'], 10764: ['Reality'], 10765: ['Science Fiction', 'Fantasy'], 10766: ['Soap'], 10767: ['Talk'], 10768: ['War'], 37: ['Western'] };
const TO_ID = {
  movie: Object.fromEntries(Object.entries(MOVIE_G).map(([id, n]) => [n, Number(id)])),
  tv: { Action: 10759, Adventure: 10759, Animation: 16, Comedy: 35, Crime: 80, Documentary: 99, Drama: 18, Family: 10751, Mystery: 9648, 'Science Fiction': 10765, Fantasy: 10765, War: 10768, Western: 37 },
};
const FILTER_GENRES = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance', 'Science Fiction', 'Thriller', 'War', 'Western'];
// order used to suggest genres the user has barely touched
const EXPLORE_ORDER = ['Comedy', 'Thriller', 'Animation', 'Mystery', 'Documentary', 'Horror', 'Romance', 'Fantasy', 'Science Fiction', 'Adventure', 'History', 'War', 'Music', 'Western', 'Family', 'Crime', 'Action', 'Drama'];

const namesOf = (type, ids) => (type === 'movie'
  ? ids.map((i) => MOVIE_G[i]).filter(Boolean)
  : ids.flatMap((i) => TV_G[i] || []));

/* ------------------------------- database ---------------------------------- */

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      // Curate is public by default (a user with no row here counts as public)
      await pool.query(
        `CREATE TABLE IF NOT EXISTS user_curate (
           user_id INT NOT NULL PRIMARY KEY,
           is_public TINYINT(1) NOT NULL DEFAULT 1,
           updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
         )`);
      await pool.query(
        `CREATE TABLE IF NOT EXISTS user_curate_seen (
           user_id INT NOT NULL,
           movie_key VARCHAR(24) NOT NULL,
           title VARCHAR(255) NOT NULL DEFAULT '',
           year VARCHAR(8) NOT NULL DEFAULT '',
           poster VARCHAR(255) NOT NULL DEFAULT '',
           verdict VARCHAR(10) NOT NULL DEFAULT 'liked',
           updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
           PRIMARY KEY (user_id, movie_key),
           KEY idx_seen_user_time (user_id, updated_at)
         )`);
      await pool.query(
        `CREATE TABLE IF NOT EXISTS user_curate_cache (
           user_id INT NOT NULL PRIMARY KEY,
           payload MEDIUMTEXT NOT NULL,
           built_at BIGINT NOT NULL
         )`);
    })().catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

async function isPublic(userId) {
  await ensureSchema();
  const [r] = await pool.query('SELECT is_public FROM user_curate WHERE user_id = ?', [userId]);
  return r.length ? !!r[0].is_public : true; // public unless the user chose private
}
async function setPublic(userId, value) {
  await ensureSchema();
  await pool.query(
    'INSERT INTO user_curate (user_id, is_public) VALUES (?, ?) ON DUPLICATE KEY UPDATE is_public = VALUES(is_public)',
    [userId, value ? 1 : 0]
  );
}

/* ---------------------- generations, invalidation, feedback ---------------------- */

// `gens` is bumped whenever a user's inputs change. Every in-memory cache key contains it, so a build that started
// before the change can neither store a stale snapshot nor poison the caches of the build that replaces it.
const gens = new Map();
const inflight = new Map(); // one default build per user at a time
const warmTimers = new Map();
const genOf = (userId) => gens.get(userId) || 0;

function bumpGen(userId) {
  gens.set(userId, genOf(userId) + 1);
  inflight.delete(userId);
  const p1 = 't:' + userId + ':', p2 = 'c:' + userId + ':';
  Array.from(cache.keys()).forEach((k) => { if (k.startsWith(p1) || k.startsWith(p2)) cache.delete(k); });
}

async function invalidate(userId) {
  bumpGen(userId);
  try { await pool.query('DELETE FROM user_curate_cache WHERE user_id = ?', [userId]); } catch (e) { /* cache table not ready yet */ }
}

// Start a background rebuild shortly after feedback (debounced, so rapid taps cause only one build).
function warmSoon(userId, ms) {
  clearTimeout(warmTimers.get(userId));
  const t = setTimeout(() => { warmTimers.delete(userId); refresh(userId); }, ms === undefined ? 700 : ms);
  if (t.unref) t.unref();
  warmTimers.set(userId, t);
}

// Cheap fingerprint of what the user has done. If it changes, the stored picks are out of date.
async function activityStamp(userId) {
  const q = (sql) => pool.query(sql, [userId]).then((r) => r[0][0]).catch(() => ({ n: 0, m: 0 }));
  const [p, l, c, v, s] = await Promise.all([
    q('SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS m FROM posts WHERE user_id = ?'),
    q('SELECT COUNT(*) AS n FROM likes WHERE user_id = ?'),
    q('SELECT COUNT(*) AS n FROM comments WHERE user_id = ?'),
    q('SELECT COUNT(*) AS n FROM user_vibes WHERE user_id = ?'),
    q('SELECT COUNT(*) AS n, COALESCE(UNIX_TIMESTAMP(MAX(updated_at)), 0) AS m FROM user_curate_seen WHERE user_id = ?'),
  ]);
  return [p.n, p.m, l.n, c.n, v.n, s.n, s.m].join('.');
}

/* ---- watched: the client sends only { key, verdict }; title / year / poster are resolved here ---- */

function metaOf(key) {
  const [type, id] = String(key).split(':');
  return deep(type, Number(id)).then((d) => ({
    title: String(d.title || '').slice(0, 250),
    year: (yearOfDate(d.release_date || d.first_air_date).match(/^(?:19|20)\d{2}$/) || [''])[0],
    poster: d.poster_path ? IMG + d.poster_path : '',
  }));
}

async function seenList(userId) {
  await ensureSchema();
  const [r] = await pool.query(
    'SELECT movie_key AS k, title, year, poster, verdict FROM user_curate_seen WHERE user_id = ? ORDER BY updated_at DESC LIMIT 300', [userId]);
  const out = r.map((x) => ({ key: x.k, title: x.title, year: x.year, poster: x.poster, verdict: x.verdict }));
  // backfill rows that were saved without metadata (updated_at = updated_at keeps the order and the fingerprint intact)
  const missing = out.filter((x) => !x.title).slice(0, 20);
  if (missing.length) {
    await pmap(missing, 6, async (x) => {
      const m = await metaOf(x.key);
      if (!m.title) return;
      Object.assign(x, m);
      await pool.query(
        'UPDATE user_curate_seen SET title = ?, year = ?, poster = ?, updated_at = updated_at WHERE user_id = ? AND movie_key = ?',
        [m.title, m.year, m.poster, userId, x.key]);
    });
  }
  return out;
}

async function seenKeySet(userId) {
  try {
    const [r] = await pool.query('SELECT movie_key FROM user_curate_seen WHERE user_id = ?', [userId]);
    return new Set(r.map((x) => x.movie_key));
  } catch (e) { return new Set(); }
}

async function markSeen(userId, b) {
  const key = String((b && b.key) || '');
  const verdict = String((b && b.verdict) || '');
  if (!/^(movie|tv):\d{1,9}$/.test(key) || !VERDICTS.includes(verdict)) return null;
  await ensureSchema();
  const m = await metaOf(key).catch(() => null) || { title: '', year: '', poster: '' };
  await pool.query(
    `INSERT INTO user_curate_seen (user_id, movie_key, title, year, poster, verdict) VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE verdict = VALUES(verdict),
       title = IF(VALUES(title) = '', title, VALUES(title)),
       year = IF(VALUES(year) = '', year, VALUES(year)),
       poster = IF(VALUES(poster) = '', poster, VALUES(poster))`,
    [userId, key, m.title, m.year, m.poster, verdict]);
  // keep the stored picks (they are filtered on read) and rebuild in the background
  bumpGen(userId);
  warmSoon(userId);
  return { key, title: m.title, year: m.year, poster: m.poster, verdict };
}

async function unmarkSeen(userId, key) {
  if (!/^(movie|tv):\d{1,9}$/.test(String(key || ''))) return false;
  await ensureSchema();
  await pool.query('DELETE FROM user_curate_seen WHERE user_id = ? AND movie_key = ?', [userId, key]);
  bumpGen(userId);
  warmSoon(userId);
  return true;
}

/* --------------------------------- signals ---------------------------------- */

// Which columns does `posts` really have? (cached) so a missing column can never crash Curate.
const postCols = () => memo('cols:posts', 6 * HOUR, async () => {
  const [r] = await pool.query('SHOW COLUMNS FROM posts');
  return new Set(r.map((x) => x.Field));
});

function postFields(cols, prefix) {
  const col = (n) => (cols.has(n) ? prefix + n : 'NULL');
  const name = cols.has('movie_name') ? 'movie_name' : cols.has('title') ? 'title' : null;
  if (!name) throw new Error('posts table has no movie_name or title column');
  // only a column that is the USER's own rating steers taste; public IMDb/TMDB scores do not
  const rating = ['rating', 'user_rating'].find((n) => cols.has(n));
  return `${prefix}${name} AS name, ${col('release_date')} AS date, ${rating ? prefix + rating : 'NULL'} AS rating, ${col('imdb_id')} AS imdb`;
}

// how a title got into the taste model, as a phrase for "Because you ___ X" (higher priority wins)
function verbOf(kind, verdict) {
  if (kind === 'seen') return verdict === 'loved' ? ['loved', 7] : verdict === 'liked' ? ['enjoyed', 5] : ['watched', 1];
  if (kind === 'vibe') return ['vibe with', 6];
  if (kind === 'post') return ['discussed', 4];
  if (kind === 'comment') return ['commented on', 3];
  return ['liked', 2];
}

async function loadSignals(userId) {
  const cols = await postCols();
  const order = cols.has('created_at') ? 'created_at DESC' : 'id DESC';
  const first = (p) => p.then((r) => r[0]);
  const none = () => [];

  const postsQ = first(pool.query(
    `SELECT ${postFields(cols, '')},
       (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) AS n_likes,
       (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) AS n_comments
     FROM posts WHERE user_id = ? ORDER BY ${order} LIMIT 150`, [userId]))
    .catch(() => first(pool.query(`SELECT ${postFields(cols, '')} FROM posts WHERE user_id = ? ORDER BY ${order} LIMIT 150`, [userId])));
  const likedQ = first(pool.query(
    `SELECT ${postFields(cols, 'posts.')} FROM likes JOIN posts ON likes.post_id = posts.id
     WHERE likes.user_id = ? ORDER BY likes.post_id DESC LIMIT 80`, [userId])).catch(none);
  const commentedQ = first(pool.query( // movies the user chose to comment on in other people's discussions
    `SELECT ${postFields(cols, 'posts.')}, COUNT(*) AS n FROM comments JOIN posts ON comments.post_id = posts.id
     WHERE comments.user_id = ? AND posts.user_id <> ? GROUP BY posts.id LIMIT 80`, [userId, userId])).catch(none);
  const vibesQ = first(pool.query('SELECT movie_key, title, year FROM user_vibes WHERE user_id = ?', [userId])).catch(none);
  const seenQ = first(pool.query('SELECT movie_key, title, year, verdict FROM user_curate_seen WHERE user_id = ?', [userId])).catch(none);

  const [posts, liked, commented, vibes, seen] = await Promise.all([postsQ, likedQ, commentedQ, vibesQ, seenQ]);

  // posts and likes arrive newest first: newer activity counts up to 2x the oldest
  const recency = (i, n) => 1 - 0.5 * (i / Math.max(1, n));
  const rows = [];
  posts.forEach((p, i) => rows.push({ kind: 'post', name: p.name, date: p.date, rating: p.rating, imdb: p.imdb, eng: (Number(p.n_likes) || 0) + (Number(p.n_comments) || 0), rec: recency(i, posts.length) }));
  liked.forEach((p, i) => rows.push({ kind: 'liked', name: p.name, date: p.date, rating: p.rating, imdb: p.imdb, eng: 0, rec: recency(i, liked.length) }));
  commented.forEach((p) => rows.push({ kind: 'comment', name: p.name, date: p.date, rating: p.rating, imdb: p.imdb, eng: Number(p.n) || 1 }));
  vibes.forEach((v) => rows.push({ kind: 'vibe', name: v.title, date: v.year, rating: 0, imdb: '', tmdbKey: v.movie_key, eng: 0 }));
  seen.forEach((v) => rows.push({ kind: 'seen', name: v.title, date: v.year, rating: 0, imdb: '', tmdbKey: v.movie_key, verdict: v.verdict, eng: 0 }));

  const maxRating = Math.max(0, ...rows.map((r) => Number(r.rating) || 0));
  const scale = maxRating > 0 && maxRating <= 5 ? 2 : 1; // supports 5-star and 10-point ratings

  const map = new Map();
  rows.forEach((r) => {
    const name = String(r.name || '').trim();
    if (!name && !r.tmdbKey) return;
    const year = (String(r.date || '').match(/(?:19|20)\d{2}/) || [''])[0];
    const imdb = String(r.imdb || '').trim();
    const k = r.tmdbKey || imdb || (name.toLowerCase() + '|' + year);
    const e = map.get(k) || { name, year, imdb, tmdbKey: r.tmdbKey || '', weight: 0, seen: null, verb: '', vp: 0 };
    const vb = verbOf(r.kind, r.verdict);
    if (vb[1] > e.vp) { e.verb = vb[0]; e.vp = vb[1]; }
    if (r.kind === 'seen') {
      e.seen = r.verdict;
      e.weight = Math.max(e.weight, Math.abs(SEEN_W[r.verdict] || 1) + 10); // explicit feedback always survives the cut below
      if (r.tmdbKey) e.tmdbKey = r.tmdbKey;
      map.set(k, e);
      return;
    }
    const rated = Number(r.rating) > 0;
    const r01 = rated ? Math.min(1, (Number(r.rating) * scale) / 10) : 0.6;
    let w;
    if (r.kind === 'vibe') w = 4;
    else if (r.kind === 'liked') w = 0.8;
    else if (r.kind === 'comment') w = Math.min(1.6, 0.5 + 0.3 * (r.eng || 1));
    else {
      w = (rated ? 0.3 + 2.5 * r01 : 1.8) + Math.min(1.5, 0.4 * Math.log2(1 + (r.eng || 0))); // discussions that got traction count more
      if (rated && r01 < 0.4) w *= 0.3; // movies they rated low barely steer taste
    }
    w *= (r.rec || 1);
    e.weight = Math.min(8, e.weight + w);
    if (r.tmdbKey) e.tmdbKey = r.tmdbKey;
    map.set(k, e);
  });

  const counts = {
    discussed: posts.length, liked: liked.length, commented: commented.length, vibes: vibes.length,
    watched: seen.filter((s) => s.verdict !== 'skip').length, loved: seen.filter((s) => s.verdict === 'loved').length,
    disliked: seen.filter((s) => s.verdict === 'disliked').length,
  };
  return {
    seeds: Array.from(map.values()).sort((a, b) => b.weight - a.weight).slice(0, 56),
    seenKeys: new Set(seen.map((s) => s.movie_key)),
    counts,
  };
}

function resolve(seed) {
  const ref = seed.tmdbKey || seed.imdb;
  if (/^(movie|tv):\d+$/.test(ref || '')) {
    const [type, id] = ref.split(':');
    return Promise.resolve({ type, id: Number(id) });
  }
  return memo('res:' + seed.imdb + '|' + seed.name + '|' + seed.year, 24 * HOUR, async () => {
    if (/^tt\d+$/.test(seed.imdb || '')) {
      const f = await tmdb('/find/' + seed.imdb, { external_source: 'imdb_id' });
      if (f.movie_results && f.movie_results[0]) return { type: 'movie', id: f.movie_results[0].id };
      if (f.tv_results && f.tv_results[0]) return { type: 'tv', id: f.tv_results[0].id };
    }
    const s = await tmdb('/search/multi', { query: seed.name, include_adult: 'false' });
    const list = (s.results || []).filter((r) => r.media_type === 'movie' || r.media_type === 'tv');
    if (!list.length) return null;
    const hit = (seed.year && list.find((r) => yearOfDate(r.release_date || r.first_air_date) === seed.year)) || list[0];
    return { type: hit.media_type, id: hit.id };
  });
}

// One trimmed details record per title: genres, region, language, themes (keywords), directors and cast.
function deep(type, id) {
  return memo(`dd:${type}:${id}`, 12 * HOUR, async () => {
    const d = await tmdb(`/${type}/${id}`, { language: 'en-US', append_to_response: 'credits,keywords' });
    const crew = (d.credits && d.credits.crew) || [], cast = (d.credits && d.credits.cast) || [];
    const people = [];
    if (type === 'movie') crew.filter((c) => c.job === 'Director').slice(0, 2).forEach((c) => people.push({ id: c.id, name: c.name, role: 'Director' }));
    else (d.created_by || []).slice(0, 2).forEach((c) => people.push({ id: c.id, name: c.name, role: 'Creator' }));
    cast.slice(0, 4).forEach((c) => people.push({ id: c.id, name: c.name, role: 'Cast' }));
    const kwRaw = type === 'movie' ? ((d.keywords && d.keywords.keywords) || []) : ((d.keywords && d.keywords.results) || []);
    return {
      id: d.id, type, title: d.title || d.name || '', overview: d.overview || '',
      genres: (d.genres || []).map((g) => ({ id: g.id, name: g.name })),
      production_countries: (d.production_countries || []).map((c) => ({ iso_3166_1: c.iso_3166_1 })),
      origin_country: d.origin_country || [], original_language: d.original_language || '',
      vote_average: d.vote_average || 0, vote_count: d.vote_count || 0, revenue: d.revenue || 0,
      runtime: d.runtime || 0, episode_run_time: d.episode_run_time || [], number_of_seasons: d.number_of_seasons || 0,
      poster_path: d.poster_path || '', backdrop_path: d.backdrop_path || '',
      release_date: d.release_date || '', first_air_date: d.first_air_date || '',
      collection: d.belongs_to_collection ? d.belongs_to_collection.id : 0,
      kw: kwRaw.slice(0, 15).map((k) => ({ id: k.id, name: k.name })), people,
    };
  });
}

const countriesOf = (type, d) => (type === 'movie'
  ? (d.production_countries || []).map((c) => c.iso_3166_1)
  : (d.origin_country || [])).filter(Boolean);
const isIndian = (d, countries) => INDIAN_LANGS.has(d.original_language) || countries[0] === 'IN';

/* ----------------------------------- taste ----------------------------------- */

function share(map) {
  const total = Array.from(map.values()).reduce((a, b) => a + b, 0) || 1;
  return new Map(Array.from(map.entries()).map(([k, v]) => [k, v / total]));
}
const bump = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
const l2 = (map) => Math.sqrt(Array.from(map.values()).reduce((a, v) => a + v * v, 0)) || 1;
const word = (v, lo, mid, hi) => (v >= 62 ? hi : v <= 38 ? lo : mid);

function emptySummary(counts) {
  return { count: 0, confidence: 'none', strength: 0, genres: [], regions: [], split: { movie: 0, tv: 0 }, themes: [], people: [], traits: [], insights: [], pairs: [], decades: [], unexplored: [], shaped: [], avgRuntime: 0, counts: counts || {} };
}

function coldTaste(excluded, counts) {
  const E = () => new Map();
  return {
    ok: false, cold: true, excluded, seeds: [], vec: E(), gNorm: 1, country: E(), lang: E(), genreList: [], regions: [], topSum: 1,
    pShare: E(), kwShare: E(), kNorm: 1, pName: E(), eraShare: E(), negVec: E(), negKw: E(), split: { movie: 0, tv: 0 }, avgVote: 7.6,
    summary: emptySummary(counts),
  };
}

function buildTaste(userId) {
  return memo(`t:${userId}:${genOf(userId)}:v`, 15 * MIN, async () => {
    const sig = await loadSignals(userId);

    // resolve + details in a single pass (details only for the strongest signals)
    const refs = (await pmap(sig.seeds, CONC, async (s, i) => {
      const r = await resolve(s);
      if (!r) return null;
      const d = i < 32 ? await deep(r.type, r.id).catch(() => null) : null;
      return { s, r, d };
    })).filter(Boolean);

    const merged = new Map();
    refs.forEach(({ s, r, d }) => {
      const k = r.type + ':' + r.id;
      const e = merged.get(k) || { name: s.name, ref: r, w: 0, seen: null, d: null, verb: '', vp: 0 };
      if (s.seen) e.seen = s.seen; else e.w = Math.min(8, e.w + s.weight);
      if ((s.vp || 0) > e.vp) { e.verb = s.verb; e.vp = s.vp; }
      if (d && !e.d) e.d = d;
      merged.set(k, e);
    });
    // everything they discussed, liked, commented on, watched or skipped is never suggested again
    const excluded = new Set([...merged.keys(), ...sig.seenKeys]);

    const entries = Array.from(merged.values()).filter((e) => e.d).map((e) => {
      const sw = e.seen ? SEEN_W[e.seen] + (SEEN_W[e.seen] > 0 ? e.w * 0.25 : 0) : e.w;
      return { name: e.d.title || e.name, weight: Math.abs(sw), sw, ref: e.ref, d: e.d, verb: e.verb || 'discussed' };
    });
    const ok = entries.filter((e) => e.sw > 0).sort((a, b) => b.weight - a.weight);
    const bad = entries.filter((e) => e.sw < 0);

    if (!ok.length) return { ok: false, excluded, summary: emptySummary(sig.counts) };

    const gW = new Map(), cW = new Map(), lW = new Map(), tW = new Map(), pW = new Map(), kW = new Map(), dW = new Map(), pairs = new Map();
    const pName = new Map(), kName = new Map();
    let vSum = 0, wSum = 0, lvS = 0, lvW = 0, rtS = 0, rtW = 0, yrS = 0, yrW = 0, totalW = 0;
    ok.forEach((x) => {
      const w = x.weight, d = x.d;
      const names = namesOf(x.ref.type, d.genres.map((g) => g.id));
      names.forEach((n) => bump(gW, n, w));
      const u = Array.from(new Set(names)).slice(0, 3);
      for (let i = 0; i < u.length; i++) for (let j = i + 1; j < u.length; j++) bump(pairs, [u[i], u[j]].sort().join(' + '), w);
      const cs = countriesOf(x.ref.type, d);
      cs.forEach((c) => bump(cW, c, w / cs.length));
      if (d.original_language) bump(lW, d.original_language, w);
      bump(tW, x.ref.type, w);
      d.people.forEach((p) => { bump(pW, p.id, w * (p.role === 'Cast' ? 0.5 : 1)); pName.set(p.id, { name: p.name, role: p.role }); });
      d.kw.forEach((k) => { if (META_KEYWORDS.has(k.name.toLowerCase())) return; bump(kW, k.id, w); kName.set(k.id, k.name); });
      if (d.vote_average) { vSum += d.vote_average * w; wSum += w; }
      if (d.vote_count) { lvS += Math.log10(d.vote_count + 1) * w; lvW += w; }
      if (x.ref.type === 'movie' && d.runtime > 0) { rtS += d.runtime * w; rtW += w; }
      const y = Number(yearOfDate(d.release_date || d.first_air_date)) || 0;
      if (y) { bump(dW, Math.floor(y / 10) * 10, w); yrS += y * w; yrW += w; }
      totalW += w;
    });

    // negative profile: what they disliked, net of what they also love (one bad action film must not ban action)
    const nG = new Map(), nK = new Map();
    bad.forEach((x) => {
      namesOf(x.ref.type, x.d.genres.map((g) => g.id)).forEach((n) => bump(nG, n, x.weight));
      x.d.kw.forEach((k) => { if (!META_KEYWORDS.has(k.name.toLowerCase())) bump(nK, k.id, x.weight); });
    });

    const vec = share(gW), country = share(cW), lang = share(lW), type = share(tW), pShare = share(pW), kwShare = share(kW), eraShare = share(dW);
    const negVec = new Map(), negKw = new Map();
    share(nG).forEach((v, n) => { const net = v - (vec.get(n) || 0); if (net > 0) negVec.set(n, net); });
    share(nK).forEach((v, id) => { const net = v - (kwShare.get(id) || 0); if (net > 0) negKw.set(id, net); });

    const genreList = Array.from(vec.entries()).sort((a, b) => b[1] - a[1]).map((e) => e[0]);
    const regions = Array.from(country.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([code, s]) => ({ code, name: countryName(code), pct: Math.round(s * 100), share: s }));
    const topSum = genreList.slice(0, 3).reduce((a, n) => a + vec.get(n), 0) || 1;
    // only show names/themes that came up in more than one title (one-off cast members are noise)
    const themes = Array.from(kW.entries()).filter(([, v]) => v >= 1.5).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => kName.get(id)).filter((n) => n && n.length <= 28);
    const people = Array.from(pW.entries()).filter(([, v]) => v >= 1.5).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => pName.get(id));

    /* ----- decode: traits, combos, eras, insights ----- */
    const avgLog = lvW ? lvS / lvW : 3.6, avgYear = yrW ? yrS / yrW : 2010, avgVote = wSum ? vSum / wSum : 7;
    const avgRuntime = rtW ? Math.round(rtS / rtW) : 0;
    const entropy = -Array.from(vec.values()).reduce((a, p) => a + (p > 0 ? p * Math.log(p) : 0), 0);
    const tvShare = type.get('tv') || 0;
    const T = {
      mainstream: pct((avgLog - 2.9) / 1.6 * 100),
      range: pct(entropy / Math.log(9) * 100),
      global: pct((1 - (country.get('US') || 0)) * 100),
      fresh: pct((avgYear - 1985) / 39 * 100),
      picky: pct((avgVote - 6.4) / 1.6 * 100),
      series: pct(tvShare * 100),
    };
    const traits = [
      { k: 'mainstream', l: ['Under the radar', 'Crowd favourites'], v: T.mainstream, word: word(T.mainstream, 'Under the radar', 'Balanced', 'Crowd favourites') },
      { k: 'range', l: ['Focused', 'Wide-ranging'], v: T.range, word: word(T.range, 'Focused', 'Open-minded', 'Wide-ranging') },
      { k: 'global', l: ['Hollywood', 'Beyond Hollywood'], v: T.global, word: word(T.global, 'Hollywood', 'Mixed', 'Beyond Hollywood') },
      { k: 'fresh', l: ['Classics', 'New releases'], v: T.fresh, word: word(T.fresh, 'Classics', 'Mixed eras', 'New releases') },
      { k: 'picky', l: ['Easygoing', 'Selective'], v: T.picky, word: word(T.picky, 'Easygoing', 'Balanced', 'Selective') },
      { k: 'series', l: ['Films', 'Series'], v: T.series, word: word(T.series, 'Film person', 'Both', 'Series person') },
    ];
    const pairsArr = Array.from(pairs.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, w]) => ({ name: k, pct: Math.round(w / (totalW || 1) * 100) })).filter((p) => p.pct >= 5);
    const decades = Array.from(eraShare.entries()).sort((a, b) => a[0] - b[0]).map(([d, s]) => ({ d: d + 's', pct: Math.round(s * 100) })).filter((x) => x.pct >= 3);
    const topDec = decades.slice().sort((a, b) => b.pct - a.pct)[0];
    const unexplored = EXPLORE_ORDER.filter((n) => (vec.get(n) || 0) < 0.02).slice(0, 4);
    const nonUS = regions.filter((r) => r.code !== 'US')[0];

    const ins = [];
    if (pairsArr[0] && pairsArr[0].pct >= 15) ins.push(`${pairsArr[0].name} is your core. It shows up in ${pairsArr[0].pct}% of what you engage with.`);
    else if (genreList[0]) ins.push(`${genreList[0]} drives your taste: ${Math.round(vec.get(genreList[0]) * 100)}% of your signal.`);
    if (topDec && topDec.pct >= 35) ins.push(`You live in the ${topDec.d}: ${topDec.pct}% of your titles come from that decade.`);
    if (avgRuntime >= 135) ins.push(`You can sit through long stories. Your films average ${avgRuntime} minutes.`);
    else if (avgRuntime && avgRuntime <= 100) ins.push(`You like it tight. Your films average ${avgRuntime} minutes.`);
    if (T.mainstream >= 62) ins.push('You trust the crowd. Most of your titles are widely seen and widely loved.');
    else if (T.mainstream <= 38) ins.push('You dig under the radar. Your titles have far fewer votes than a typical pick.');
    if (T.global >= 45 && regions[0]) ins.push(`Less than half your taste is Hollywood. ${nonUS ? nonUS.name : 'World'} cinema pulls you in.`);
    if (themes.length >= 2) ins.push(`Themes you keep coming back to: ${themes.slice(0, 3).join(', ')}.`);
    if (sig.counts.loved) ins.push(`You loved ${sig.counts.loved} title${sig.counts.loved === 1 ? '' : 's'}. Those count most when we rank picks.`);
    if (negVec.size) ins.push(`Down-ranked: ${Array.from(negVec.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2).map((e) => e[0]).join(' and ')}, based on what you disliked.`);

    const strength = pct(Math.min(100, ok.length * 6 + (sig.counts.watched + sig.counts.loved) * 2));

    // the titles that shaped this taste the most (shown in the taste profile)
    const shaped = ok.slice(0, 8).map((x) => ({
      key: x.ref.type + ':' + x.ref.id, title: x.name, year: yearOfDate(x.d.release_date || x.d.first_air_date),
      poster: x.d.poster_path ? IMG + x.d.poster_path : '', verb: x.verb,
    }));

    return {
      ok: true, excluded, seeds: ok, vec, gNorm: l2(vec), country, lang, genreList, regions, topSum, pShare, kwShare, kNorm: l2(kwShare), pName, eraShare, negVec, negKw,
      split: { movie: type.get('movie') || 0, tv: type.get('tv') || 0 },
      avgVote,
      summary: {
        count: ok.length, strength, confidence: strength >= 70 ? 'high' : strength >= 40 ? 'good' : 'low',
        genres: genreList.slice(0, 6).map((n) => ({ name: n, pct: Math.round(vec.get(n) * 100) })),
        regions: regions.map(({ code, name, pct: p }) => ({ code, name, pct: p })),
        split: { movie: Math.round((type.get('movie') || 0) * 100), tv: Math.round((type.get('tv') || 0) * 100) },
        themes, people, traits, insights: ins.slice(0, 5), pairs: pairsArr, decades, unexplored, shaped, avgRuntime, counts: sig.counts,
      },
    };
  });
}

/* --------------------------------- candidates -------------------------------- */

const tierOf = (rev) => (rev >= 5e8 ? 'blockbuster' : rev >= 1e8 ? 'hit' : rev >= 1e7 ? 'solid' : rev > 0 ? 'indie' : '');

// cosine similarity between the user's genre vector and a title's genres (0..1)
function gCos(taste, names) {
  if (!names.length) return 0;
  const s = names.reduce((a, n) => a + (taste.vec.get(n) || 0), 0);
  return Math.min(1, (s / taste.gNorm / Math.sqrt(names.length)) / 0.9);
}

function prescore(taste, c, names) {
  const r = c.r;
  const g = gCos(taste, names);
  const conf = Math.min(1, (r.vote_count || 0) / 400);
  const q = conf * Math.min(1, Math.max(0, ((r.vote_average || 0) - 5.5) / 3.5)) + (1 - conf) * 0.4;
  const rec = Math.min(1, c.recHits / 8);
  const lang = Math.min(1, (taste.lang.get(r.original_language) || 0) / 0.45);
  return { g, q, rec, region: lang };
}

const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let i = 0; a.forEach((x) => { if (b.has(x)) i++; }); return i / (a.size + b.size - i); };

// Re-rank so the head of the list is varied: a pick that looks like the last few already chosen gets a small penalty.
function diversify(list, limit) {
  const rest = list.slice(), out = [];
  while (out.length < limit && rest.length) {
    const lim = Math.min(rest.length, 25), recent = out.slice(-8);
    let bi = 0, bv = -Infinity;
    for (let i = 0; i < lim; i++) {
      const s = rest[i];
      let pen = 0;
      recent.forEach((o) => { pen = Math.max(pen, jaccard(s.gset, o.gset)); if (s.item.because && s.item.because === o.item.because) pen = Math.max(pen, 0.5); });
      const v = s.score - 0.09 * pen;
      if (v > bv) { bv = v; bi = i; }
    }
    out.push(rest.splice(bi, 1)[0]);
  }
  return out.concat(rest);
}

async function build(taste, f) {
  const today = new Date().toISOString().slice(0, 10);
  const cc = /^[A-Z]{2}$/.test(f.country || '') ? f.country : '';
  const types = f.type === 'movie' ? ['movie'] : f.type === 'tv' ? ['tv'] : (f.box ? ['movie'] : ['movie', 'tv']);
  if (f.box && f.type === 'tv') return { items: [] };
  const ind = f.origin === 'indian', world = f.origin === 'world', mixed = !ind && !world && !cc;

  const minVote = ind
    ? Math.max(f.minRating || 0, 6.0)
    : Math.min(8.2, Math.max(f.minRating || 0, 6.2, taste.avgVote - 1));
  const jobs = [];
  const off = ((f.page || 1) - 1) * 2; // later pages of the same feed look further down TMDB's lists
  const disc = (t, extra, page) => jobs.push({
    path: `/discover/${t}`, type: t,
    origin: !!(extra && extra.with_origin_country), country: (extra && extra.with_origin_country) || '',
    params: Object.assign({
      sort_by: 'popularity.desc', 'vote_count.gte': 400, 'vote_average.gte': minVote, include_adult: 'false', language: 'en-US', page: (page || 1) + off,
    }, t === 'movie' ? { 'primary_release_date.lte': today } : { 'first_air_date.lte': today }, extra),
  });

  const seedIn = (s, code) => INDIAN_LANGS.has(s.d.original_language) && code === 'IN' || countriesOf(s.ref.type, s.d).includes(code);
  // the strongest seeds always count, plus a few random ones from further down so each rebuild feels fresh
  const strong = taste.seeds.filter((s) => s.weight >= 1);
  const seedPool = ind ? strong.filter((s) => seedIn(s, 'IN')) : cc ? strong.filter((s) => seedIn(s, cc)) : strong;
  const recSeeds = seedPool.slice(0, 4).concat(shuffle(seedPool.slice(4, 20)).slice(0, ind || cc ? 2 : 4));
  recSeeds.forEach((s) => jobs.push({
    path: `/${s.ref.type}/${s.ref.id}/recommendations`, type: s.ref.type, params: { language: 'en-US', page: jit() > 2 ? 2 : 1 },
    seed: { name: s.name, weight: s.weight, loved: s.weight >= 5, verb: s.verb || 'discussed' },
  }));

  const topRegion = taste.regions.find((r) => r.code !== 'US' && r.code !== 'IN' && r.share >= 0.18);
  const topDirectors = Array.from(taste.pShare.entries()).filter(([id]) => (taste.pName.get(id) || {}).role === 'Director').sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);

  types.forEach((t) => {
    const forced = f.genre ? TO_ID[t][f.genre] : null;
    if (f.genre && !forced) return;
    const tops = Array.from(new Set(taste.genreList.map((n) => TO_ID[t][n]).filter(Boolean)));
    const G = forced || (tops.slice(0, 3).join('|') || undefined);

    if (ind) { // Bollywood first, then the rest of popular Indian cinema
      const hindi = { with_origin_country: 'IN', with_original_language: 'hi', 'vote_count.gte': 100, with_genres: G };
      const anyIn = { with_origin_country: 'IN', 'vote_count.gte': 80, with_genres: G };
      disc(t, hindi); disc(t, hindi, 2); disc(t, anyIn); disc(t, anyIn, 2);
      disc(t, { with_origin_country: 'IN', sort_by: 'vote_average.desc', 'vote_count.gte': 150, 'vote_average.gte': Math.max(minVote, 7), with_genres: G });
      disc(t, { with_origin_country: 'IN', 'vote_count.gte': 150, with_genres: forced || undefined });
      if (f.box && t === 'movie') for (let p = 1; p <= 3; p++) disc(t, { with_origin_country: 'IN', sort_by: 'revenue.desc', 'vote_count.gte': 100, with_genres: forced || undefined }, p);
      return;
    }

    if (cc) { // one chosen country
      const inCc = { with_origin_country: cc, 'vote_count.gte': 60, with_genres: G };
      disc(t, inCc); disc(t, inCc, 2);
      disc(t, { with_origin_country: cc, sort_by: 'vote_average.desc', 'vote_count.gte': 120, 'vote_average.gte': Math.max(minVote, 7), with_genres: G });
      disc(t, { with_origin_country: cc, 'vote_count.gte': 80, with_genres: forced || undefined });
      if (f.box && t === 'movie') for (let p = 1; p <= 3; p++) disc(t, { with_origin_country: cc, sort_by: 'revenue.desc', 'vote_count.gte': 80, with_genres: forced || undefined }, p);
      return;
    }

    if (forced) {
      disc(t, { with_genres: forced }); disc(t, { with_genres: forced }, 2);
      if (tops[0] && tops[0] !== forced) disc(t, { with_genres: forced + ',' + tops[0] });
    } else {
      if (tops.length >= 2) { disc(t, { with_genres: tops[0] + ',' + tops[1] }); disc(t, { with_genres: tops[0] + ',' + tops[1] }, 2); }
      tops.slice(0, 3).forEach((id) => disc(t, { with_genres: id }, jit()));
      disc(t, { with_genres: G }, jit()); // broad pass over their top genres (plain popular picks for a brand-new user)
    }
    if (mixed) disc(t, { with_origin_country: 'IN', with_original_language: 'hi', 'vote_count.gte': 100, with_genres: forced || G }); // keeps Bollywood in the pool
    if (topRegion) disc(t, { with_origin_country: topRegion.code, with_genres: forced || tops[0] });
    if (t === 'movie' && topDirectors.length) disc(t, { with_people: topDirectors.join('|'), 'vote_count.gte': 150, with_genres: forced }); // directors they keep returning to
    disc(t, {
      sort_by: 'vote_average.desc', 'vote_count.gte': 150, 'vote_count.lte': 2500,
      'vote_average.gte': Math.max(minVote, 7.3), with_genres: G,
    });
    if (f.box && t === 'movie') {
      if (f.box === 'indie') {
        for (let p = 1; p <= 3; p++) disc(t, { 'vote_count.gte': 100, 'vote_count.lte': 2500, 'vote_average.gte': Math.max(minVote, 6.5), with_genres: forced }, p);
      } else {
        for (let p = 1; p <= 5; p++) disc(t, { sort_by: 'revenue.desc', 'vote_count.gte': 300, with_genres: forced }, p);
      }
    }
  });

  const results = await pmap(jobs, CONC, async (j) => ({
    j, r: await memo('j:' + j.path + JSON.stringify(j.params), 6 * HOUR, () => tmdb(j.path, j.params)),
  }));

  const minVotes = ind || cc ? 40 : 80;
  const cand = new Map();
  results.filter(Boolean).forEach(({ j, r }) => {
    (r.results || []).forEach((raw) => {
      if (!types.includes(j.type)) return;
      const key = j.type + ':' + raw.id;
      if (taste.excluded.has(key) || !raw.poster_path || (raw.vote_count || 0) < minVotes) return;
      const dt = raw.release_date || raw.first_air_date || '';
      if (!dt || dt > today) return;
      let c = cand.get(key);
      if (!c) { c = { key, type: j.type, id: raw.id, r: raw, recHits: 0, recFrom: [], inOrigin: false }; cand.set(key, c); }
      if (j.origin && (!cc || j.country === cc)) c.inOrigin = true;
      if (j.seed) { c.recHits += j.seed.weight; c.recFrom.push(j.seed); }
    });
  });

  const rawIndian = (c) => INDIAN_LANGS.has(c.r.original_language) || (c.r.origin_country || []).includes('IN');
  const sortedPre = Array.from(cand.values())
    .filter((c) => (ind ? (c.inOrigin || rawIndian(c)) : cc ? (c.inOrigin || (c.r.origin_country || []).includes(cc)) : world ? !rawIndian(c) : true))
    .map((c) => ({ c, names: namesOf(c.type, c.r.genre_ids || []) }))
    .filter((x) => (!f.genre || x.names.includes(f.genre)) && (x.c.r.vote_average || 0) >= (f.minRating || 0))
    .map((x) => { const p = prescore(taste, x.c, x.names); return Object.assign(x, { p, pre: 0.4 * p.g + 0.25 * p.rec + 0.2 * p.q + 0.15 * p.region }); })
    .sort((a, b) => b.pre - a.pre);
  const N = f.box ? 72 : 48; // fewer detail calls = a faster first build
  const pre = sortedPre.slice(0, N);
  if (mixed) { // make sure Indian titles are represented even when the taste leans global
    const have = pre.filter((x) => rawIndian(x.c)).length;
    if (have < 10) pre.push(...sortedPre.slice(N).filter((x) => rawIndian(x.c)).slice(0, 10 - have));
  }

  const detailed = await pmap(pre, CONC, async (x) => Object.assign(x, { d: await deep(x.c.type, x.c.id) }));

  const cold = !!taste.cold;
  const scored = detailed.filter(Boolean).map((x) => {
    const { c, d } = x;
    const names = namesOf(c.type, d.genres.map((g) => g.id));
    const countries = countriesOf(c.type, d);
    const indian = isIndian(d, countries);
    const g = gCos(taste, names);
    const kwu = d.kw.length ? d.kw.reduce((a, k) => a + (taste.kwShare.get(k.id) || 0), 0) / taste.kNorm / Math.sqrt(d.kw.length) : 0;
    const kw = Math.min(1, kwu / 0.35);
    const ppl = Math.min(1, d.people.reduce((a, p) => a + (taste.pShare.get(p.id) || 0) * (p.role === 'Cast' ? 0.6 : 1), 0) * 14);
    const regionShare = Math.max(0, ...countries.map((k) => taste.country.get(k) || 0), (taste.lang.get(d.original_language) || 0) * 0.8);
    const region = Math.min(1, regionShare / 0.45);
    const typePref = Math.min(1, (taste.split[c.type] || 0) / 0.5);
    const va = d.vote_average || c.r.vote_average || 0, vc = d.vote_count || c.r.vote_count || 0;
    const conf = Math.min(1, vc / 400);
    const q = conf * Math.min(1, Math.max(0, (va - 5.5) / 3.5)) + (1 - conf) * 0.4;
    const gem = vc < 3000 && va >= 7.3 ? 1 : 0;
    const rec = x.p.rec;
    const y = Number(yearOfDate(d.release_date || d.first_air_date)) || 0, dec = Math.floor(y / 10) * 10;
    const era = Math.min(1, ((taste.eraShare.get(dec) || 0) + 0.5 * ((taste.eraShare.get(dec - 10) || 0) + (taste.eraShare.get(dec + 10) || 0))) / 0.45);
    // negative profile (from disliked / skipped titles)
    const negG = names.length ? names.reduce((a, n) => a + (taste.negVec.get(n) || 0), 0) / Math.sqrt(names.length) : 0;
    const negK = Math.min(1, d.kw.reduce((a, k) => a + (taste.negKw.get(k.id) || 0), 0) * 3);
    const neg = Math.min(1, negG * 0.8 + negK * 0.5);

    let score = 0.26 * g + 0.2 * rec + 0.12 * kw + 0.07 * ppl + 0.14 * q + 0.09 * region + 0.04 * era + 0.04 * typePref + 0.04 * gem - 0.22 * neg;
    if (cold) score = 0.7 * q + 0.15 * gem + 0.15 * Math.min(1, vc / 4000);
    if (ind && d.original_language === 'hi') score = Math.min(1, score + 0.03); // Bollywood first within Indian picks
    score += (Math.random() - 0.5) * 0.03; // near-ties reshuffle between rebuilds
    score = Math.max(0, score);

    const reasons = [];
    // "Because you loved / enjoyed / discussed / vibe with / commented on / liked X": decided here, never on the client
    const fromAll = c.recFrom.slice().sort((a, b) => b.weight - a.weight);
    const top0 = fromAll[0];
    const verb = top0 ? top0.verb : '';
    const from = top0 ? Array.from(new Set(fromAll.filter((r) => r.verb === verb).map((r) => r.name))).slice(0, 2) : [];
    if (from.length) reasons.push('Because you ' + verb + ' ' + from.join(' & '));
    const known = d.people.find((p) => (taste.pShare.get(p.id) || 0) * 14 >= 0.15);
    if (known) reasons.push((known.role === 'Cast' ? 'Stars ' : known.role === 'Creator' ? 'Created by ' : 'Directed by ') + known.name + ', a name you return to');
    const matched = names.filter((n) => (taste.vec.get(n) || 0) > 0.05).sort((a, b) => taste.vec.get(b) - taste.vec.get(a)).slice(0, 2);
    if (matched.length) reasons.push('Fits your love for ' + matched.join(' & '));
    const reg = taste.regions.find((r) => r.code !== 'US' && r.share >= 0.15 && countries.includes(r.code));
    if (reg) reasons.push((reg.code === 'IN' ? 'Indian' : reg.name) + ' cinema, a favourite of yours');
    if (d.original_language === 'hi') reasons.push('Bollywood pick');
    if (gem) reasons.push('Hidden gem'); else if (va >= 8) reasons.push('Critically loved');
    if (cold) { reasons.length = 0; reasons.push(va >= 8 ? 'Critically loved' : 'Popular right now'); }

    const revenue = c.type === 'movie' ? (d.revenue || 0) : 0;
    return {
      indian, countries, collection: d.collection, score, gset: new Set(names),
      item: {
        key: c.key, type: c.type, id: c.id, title: d.title || c.r.title || c.r.name,
        year: yearOfDate(d.release_date || d.first_air_date),
        poster: IMG + (d.poster_path || c.r.poster_path), posterL: IMG_L + (d.poster_path || c.r.poster_path),
        backdrop: d.backdrop_path ? IMG_BG + d.backdrop_path : '',
        overview: String(d.overview || '').slice(0, 240),
        rating: Math.round(va * 10) / 10, votes: vc,
        runtime: c.type === 'movie' ? d.runtime : (d.episode_run_time[0] || 0), seasons: d.number_of_seasons,
        genres: d.genres.map((x2) => x2.name).slice(0, 5),
        country: countries[0] ? countryName(countries[0]) : '', countryCode: countries[0] || '',
        indian, lang: d.original_language,
        revenue, tier: tierOf(revenue), gem: !!gem, stretch: !cold && g < 0.3 && q > 0.65 && neg < 0.2,
        because: from[0] || '', becauseVerb: verb,
        score: Math.round(score * 1000) / 1000,
        match: cold ? null : Math.round(Math.min(99, 40 + score * 80)),
        fit: { genre: Math.round(g * 100), similar: Math.round(rec * 100), themes: Math.round((kw * 0.6 + ppl * 0.4) * 100), region: Math.round(region * 100), quality: Math.round(q * 100) },
        reasons: reasons.slice(0, 3),
      },
    };
  }).filter((s) => (!ind || s.indian) && (!world || !s.indian) && (!cc || s.countries.includes(cc)) && (!f.box || s.item.tier === f.box) && (s.item.rating >= (f.minRating || 0)))
    .sort((a, b) => b.score - a.score);

  // no redundancies: one title per franchise (the best match), no duplicate ids
  const seenCol = new Set(), seenKey = new Set(), uniq = [];
  scored.forEach((s) => {
    if (seenKey.has(s.item.key)) return;
    if (s.collection) { if (seenCol.has(s.collection)) return; seenCol.add(s.collection); }
    seenKey.add(s.item.key); uniq.push(s);
  });

  const broad = !f.genre && !f.box && !f.origin && !f.country && !f.minRating && f.type === 'all';
  let list = diversify(uniq, broad ? 90 : 60).slice(0, broad ? 90 : 60);
  if (mixed) { // keep a few Indian picks in the pool for the Bollywood shelf
    const have = list.filter((s) => s.indian).length;
    if (have < 12) { const inList = new Set(list.map((s) => s.item.key)); list = list.concat(uniq.filter((s) => s.indian && !inList.has(s.item.key)).slice(0, 12 - have)); }
  }
  return { items: list.map((s, i) => Object.assign(s.item, { rank: i })) };
}

/* ------------------------------------ shelves ------------------------------------ */

// The server decides what each shelf is and which titles sit on it. Each title appears on one shelf only. `more`
// holds extra eligible titles so the page can reshuffle a shelf without asking again.
function shelvesOf(items, summary, cold) {
  if (!items.length) return [];
  const yr = new Date().getFullYear(), specs = [];
  const add = (id, title, sub, pred, min, n) => specs.push({ id, title, sub, pred, min: min || 3, n: n || 12 });

  add('top', cold ? 'Popular to start' : 'Top picks for you', cold ? 'Crowd favourites' : 'Best fit first', () => true);
  const groups = new Map();
  items.forEach((i) => { if (i.because) { if (!groups.has(i.because)) groups.set(i.because, []); groups.get(i.because).push(i); } });
  Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length).slice(0, 2).forEach(([k, g]) => {
    add('b:' + k, 'Because you ' + g[0].becauseVerb + ' ' + k, 'Similar in feel and audience', (i) => i.because === k);
  });
  const reg = ((summary && summary.regions) || []).filter((r) => r.code !== 'US' && r.code !== 'IN')[0];
  if (reg && !cold) add('region:' + reg.code, flagEmoji(reg.code) + reg.name + ' cinema you love', 'Your regional favourite', (i) => i.countryCode === reg.code);
  add('bolly', 'Bollywood & popular Indian picks', 'Hindi first, then the rest of India', (i) => i.indian);
  if (!cold) add('fresh', 'Fresh releases for you', 'Recent and relevant', (i) => Number(i.year) >= yr - 1);
  add('gems', 'Hidden gems', 'Loved by few, rated high', (i) => i.gem);
  add('blockbusters', 'Crowd-pleasing blockbusters', 'Big at the box office', (i) => i.tier === 'blockbuster' || i.tier === 'hit');
  add('series', 'Series worth binging', 'Your next obsession', (i) => i.type === 'tv');
  add('critical', 'Critically loved', 'Rated 8 and above', (i) => i.rating >= 8);
  if (!cold) add('stretch', 'Step outside your lane', 'Great titles from genres you rarely touch', (i) => i.stretch);
  add('more', 'More for you', 'Everything else that fits', () => true, 1, 14);

  const used = new Set([items[0].key]); // the first pick is shown as "Tonight's pick"
  const laid = [];
  specs.forEach((sp) => {
    const shown = items.filter((i) => !used.has(i.key) && sp.pred(i)).slice(0, sp.n);
    if (shown.length < sp.min) return;
    shown.forEach((i) => used.add(i.key));
    laid.push({ sp, shown });
  });
  return laid.map(({ sp, shown }) => ({
    id: sp.id, title: sp.title, sub: sp.sub,
    keys: shown.map((i) => i.key),
    more: items.filter((i) => !used.has(i.key) && sp.pred(i)).slice(0, 24).map((i) => i.key),
  }));
}

/* ---------------------------- public entry points ---------------------------- */

const DEFAULT_F = { type: 'all', genre: '', minRating: 0, box: '', origin: '', country: '', page: 1 };
const isDefaultF = (f) => f.type === 'all' && !f.genre && !f.minRating && !f.box && !f.origin && !f.country && (f.page || 1) === 1;

async function readSnap(userId) {
  try {
    const [r] = await pool.query('SELECT payload, built_at FROM user_curate_cache WHERE user_id = ?', [userId]);
    if (!r.length) return null;
    return { data: JSON.parse(r[0].payload), built: Number(r[0].built_at) };
  } catch (e) { return null; }
}
async function writeSnap(userId, data, built) {
  try {
    await pool.query(
      'INSERT INTO user_curate_cache (user_id, payload, built_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE payload = VALUES(payload), built_at = VALUES(built_at)',
      [userId, JSON.stringify(data), built]);
  } catch (e) { /* cache is an optimisation only */ }
}

// What the page receives: watched titles removed, shelves laid out by the server.
async function present(userId, data) {
  const seen = await seenKeySet(userId);
  const items = seen.size ? data.items.filter((i) => !seen.has(i.key)) : data.items;
  return Object.assign({}, data, { items, shelves: shelvesOf(items, data.taste, data.cold) });
}

async function compute(userId, f) {
  await ensureSchema();
  const gen = genOf(userId);
  const stamp = await activityStamp(userId);
  let taste = await buildTaste(userId);
  const cold = !taste.ok;
  if (cold) taste = coldTaste(taste.excluded, taste.summary.counts);
  const out = await memo(`c:${userId}:${gen}:${JSON.stringify(f)}`, 15 * MIN, () => build(taste, f));
  const data = { taste: taste.summary, items: out.items, cold, stamp };
  const built = Date.now();
  if (isDefaultF(f) && out.items.length && genOf(userId) === gen) await writeSnap(userId, data, built);
  const full = isDefaultF(f) ? await present(userId, data) : data;
  return Object.assign({ built }, full);
}

// one default build per user at a time
function once(userId) {
  let p = inflight.get(userId);
  if (!p) {
    p = compute(userId, DEFAULT_F);
    inflight.set(userId, p);
    const clear = () => { if (inflight.get(userId) === p) inflight.delete(userId); };
    p.then(clear, clear);
  }
  return p;
}
function refresh(userId) { return once(userId).catch((e) => console.error('curate refresh failed:', e.message)); }

// Cached picks, instantly (null when nothing is stored yet). Picks are rebuilt in the background when they are old
// or when the user has done something new (a discussion, like, comment, vibe or watched rating) since they were built.
async function peek(userId) {
  await ensureSchema();
  const s = await readSnap(userId);
  if (!s) return null;
  const changed = s.data.stamp !== (await activityStamp(userId));
  const refreshing = changed || Date.now() - s.built > STALE;
  if (refreshing) {
    if (changed && !inflight.has(userId)) bumpGen(userId); // fresh taste model, but keep the stored snapshot for now
    refresh(userId);
  }
  const data = await present(userId, s.data);
  return Object.assign({ built: s.built, refreshing }, data);
}

async function generate(userId, f, opts) {
  await ensureSchema();
  if (!isDefaultF(f)) return compute(userId, f);
  if (opts && opts.force) await invalidate(userId);
  else { const p = await peek(userId); if (p) return p; }
  return once(userId);
}

// Call (without await) after a new discussion, like, comment or vibe to have picks ready before the page asks.
function touch(userId) { bumpGen(userId); warmSoon(userId, 1500); }

module.exports = {
  isPublic, setPublic, generate, peek, warm: refresh, touch, FILTER_GENRES, ready: ensureSchema, shuffle,
  seenList, markSeen, unmarkSeen, VERDICTS,
};