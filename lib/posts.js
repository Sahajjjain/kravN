const pool = require('../config/db');

/**
 * Every read of discussions goes through here, so the feed, movie pages, profiles,
 * search and the dashboard all agree on shape, counts and ordering.
 * Only the existing columns/tables are used — nothing here changes your schema.
 */

const BASE_SQL = `
  SELECT posts.*, users.username,
    (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) AS like_count,
    (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) AS comment_count,
    EXISTS(SELECT 1 FROM likes WHERE likes.post_id = posts.id AND likes.user_id = ?) AS liked_by_me
  FROM posts JOIN users ON posts.user_id = users.id`;

const ORDERS = {
  latest: 'posts.created_at DESC, posts.id DESC',
  oldest: 'posts.created_at ASC, posts.id ASC',
  top: 'like_count DESC, posts.id DESC',
  hot: 'comment_count DESC, posts.id DESC',
};

const sortKey = (s) => (ORDERS[s] ? s : 'latest');

/**
 * @param {object} o
 * @param {number} o.userId   viewer (for liked_by_me)
 * @param {string} [o.where]  SQL condition using ? placeholders
 * @param {Array}  [o.params]
 * @param {string} [o.sort]   latest | oldest | top | hot
 * @param {number} [o.page]   1-based
 * @param {number} [o.limit]
 * @returns {Promise<{posts: Array, hasMore: boolean}>}
 */
async function listPosts({ userId = 0, where = '1=1', params = [], sort = 'latest', page = 1, limit = 12 }) {
  const pageNo = Math.max(1, parseInt(page, 10) || 1);
  const [rows] = await pool.query(
    `${BASE_SQL} WHERE ${where} ORDER BY ${ORDERS[sortKey(sort)]} LIMIT ? OFFSET ?`,
    [userId, ...params, limit + 1, (pageNo - 1) * limit]
  );
  return { posts: rows.slice(0, limit), hasMore: rows.length > limit };
}

async function getPost(id, userId = 0) {
  const [rows] = await pool.query(`${BASE_SQL} WHERE posts.id = ?`, [userId, id]);
  return rows[0] || null;
}

const GENRE_ALIASES = {
  'Science Fiction': ['Science Fiction', 'Sci-Fi'],
  'Sci-Fi': ['Science Fiction', 'Sci-Fi'],
  History: ['History', 'Biography'],
  Music: ['Music', 'Musical'],
};

// Genre / text filters shared by the feed and search
function filterWhere({ genre, q } = {}) {
  const where = [];
  const params = [];
  if (genre) {
    // old posts stored OMDb names (e.g. "Sci-Fi"), new ones store TMDB names ("Science Fiction")
    const names = GENRE_ALIASES[genre] || [genre];
    where.push(`(${names.map(() => 'posts.genre LIKE ?').join(' OR ')})`);
    params.push(...names.map((n) => `%${n}%`));
  }
  if (q) { where.push('(posts.movie_name LIKE ? OR posts.title LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  return { where: where.length ? where.join(' AND ') : '1=1', params };
}

/**
 * Which stored posts belong to a TMDB movie:
 *  - posts holding the movie's IMDb id (exact), or
 *  - older posts that never got an IMDb id but carry the same movie name (movies only when the IMDb id is known).
 */
function movieWhere(movie) {
  const names = [...new Set([movie.title, movie.originalTitle].filter(Boolean))];
  const parts = [];
  const params = [];
  if (movie.imdbId) { parts.push('posts.imdb_id = ?'); params.push(movie.imdbId); }
  // Old posts without an IMDb id are matched by name. Skipped for a series that has an IMDb id, so a
  // series never inherits the discussions of an older movie with the same name.
  if (!(movie.type === 'tv' && movie.imdbId)) {
    parts.push(`((posts.imdb_id IS NULL OR posts.imdb_id = '') AND posts.movie_name IN (${names.map(() => '?').join(',')}))`);
    params.push(...names);
  }
  return { where: `(${parts.join(' OR ')})`, params };
}

async function countWhere(where, params) {
  const [rows] = await pool.query(`SELECT COUNT(*) AS n FROM posts WHERE ${where}`, params);
  return rows[0].n;
}

// Movies people are talking about most (grouped by IMDb id, or by name for old posts)
async function topMovies(limit = 20) {
  const [groups] = await pool.query(
    `SELECT COALESCE(NULLIF(imdb_id, ''), LOWER(movie_name)) AS k, COUNT(*) AS n, MAX(id) AS last_id
     FROM posts GROUP BY k ORDER BY n DESC, last_id DESC LIMIT ?`,
    [limit]
  );
  if (!groups.length) return [];
  const [rows] = await pool.query(
    `SELECT id, movie_name, imdb_id, poster_url, release_date, imdb_rating FROM posts WHERE id IN (${groups.map(() => '?').join(',')})`,
    groups.map((g) => g.last_id)
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return groups.map((g) => ({ ...byId.get(g.last_id), discussions: g.n })).filter((m) => m.id);
}

/* ------------------------------- writing --------------------------------- */

const clip = (s, n) => String(s || '').trim().slice(0, n);

/**
 * Creates a discussion. `fields` are the movie columns from tmdb.postFields()
 * (or {} when TMDB has no match). Same INSERT, same columns as before.
 */
async function createDiscussion(userId, { title, content }, fields) {
  const f = fields || {};
  const [result] = await pool.query(
    `INSERT INTO posts
       (user_id, movie_name, title, content, poster_url, imdb_rating, genre,
        release_date, director, actors, runtime, plot, imdb_id, box_office)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      f.movie_name,
      clip(title, 200),
      clip(content, 8000),
      f.poster_url || null,
      f.imdb_rating || null,
      f.genre || null,
      f.release_date || null,
      f.director || null,
      f.actors || null,
      f.runtime || null,
      f.plot || null,
      f.imdb_id || null,
      f.box_office === undefined ? null : f.box_office,
    ]
  );
  return result.insertId;
}

async function notify(ownerId, actorId, postId, type) {
  if (ownerId === actorId) return;
  await pool.query(
    'INSERT INTO notifications (user_id, actor_id, post_id, type) VALUES (?, ?, ?, ?)',
    [ownerId, actorId, postId, type]
  );
}

module.exports = {
  listPosts, getPost, filterWhere, movieWhere, countWhere, topMovies, createDiscussion, notify, sortKey, clip,
};
