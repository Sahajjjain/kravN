const express = require('express');
const router = express.Router();

const requireLogin = require('../middleware/authMiddleware');
const tmdb = require('../config/tmdb');
const { buildRow, rowCount } = require('../lib/rows');
const { listPosts, filterWhere, topMovies, sortKey } = require('../lib/posts');
const { sendPage, fragment } = require('../lib/render');
const { toInt } = require('../lib/util');

const DISCUSSION_PAGE = 10;
const GRID_SORTS = {
  popular: 'popularity.desc',
  rated: 'vote_average.desc',
  newest: 'primary_release_date.desc',
  revenue: 'revenue.desc',
};

/* ----------------------------------- home --------------------------------- */

router.get('/feed', async (req, res) => {
  // Old links like /feed?genre=Action now open the discussions list for that genre
  if (req.query.genre) return res.redirect(`/discussions?genre=${encodeURIComponent(req.query.genre)}`);

  const userId = req.session.userId;
  const FIRST_ROWS = 4;

  const [trending, latest, top, ...rows] = await Promise.all([
    tmdb.trending(1),
    listPosts({ userId, limit: 12 }),
    topMovies(18),
    ...Array.from({ length: FIRST_ROWS }, (_, i) => buildRow(i)),
  ]);

  const genres = await tmdb.genres();
  const withBackdrop = trending.results.filter((m) => m.backdropLg).slice(0, 8);
  const hero = withBackdrop.length ? withBackdrop[Math.floor(Math.random() * withBackdrop.length)] : null;

  res.render('feed', {
    nav: 'home',
    hero,
    genreNames: Object.fromEntries(genres.map((g) => [g.id, g.name])),
    latest: latest.posts,
    top,
    rows: rows.filter(Boolean),
    nextRow: FIRST_ROWS,
    totalRows: await rowCount(),
  });
});

// Infinite rows: the browser keeps asking for the next few
router.get('/api/home/rows', async (req, res) => {
  const from = toInt(req.query.from, 0, 0, 100000);
  const count = toInt(req.query.count, 3, 1, 5);
  const total = await rowCount();

  const built = await Promise.all(Array.from({ length: count }, (_, i) => (from + i < total ? buildRow(from + i) : null)));
  const rows = built.filter(Boolean);
  const html = (await Promise.all(rows.map((row) => fragment(res, 'partials/row', { row })))).join('');

  res.json({ html, next: from + count, hasMore: from + count < total });
});

/* -------------------------------- discussions ----------------------------- */

router.get('/discussions', async (req, res) => {
  const { genre, sort } = req.query;
  const { where, params } = filterWhere({ genre });
  const { posts, hasMore } = await listPosts({
    userId: req.session.userId, where, params, sort: sortKey(sort), limit: DISCUSSION_PAGE,
  });
  res.render('discussions', {
    nav: 'discussions',
    posts, hasMore,
    genre: genre || '',
    sort: sortKey(sort),
    genres: await tmdb.genres(),
  });
});

// Used by /discussions, search results (q) and — via routes/movies.js — movie pages
router.get('/api/discussions', async (req, res) => {
  const { genre, sort, q } = req.query;
  const { where, params } = filterWhere({ genre, q });
  const { posts, hasMore } = await listPosts({
    userId: req.session.userId, where, params, sort: sortKey(sort), page: req.query.page, limit: DISCUSSION_PAGE,
  });
  await sendPage(res, 'partials/postCards', { posts }, hasMore);
});

/* ---------------------------- search + genre grids ------------------------- */

router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (!q) return res.render('search', { nav: 'search', q, movies: [], totalMovies: 0, hasMoreMovies: false, people: [], posts: [], hasMorePosts: false });

  const { where, params } = filterWhere({ q });
  const [movies, multi, discussions] = await Promise.all([
    tmdb.searchMovies(q, 1),
    tmdb.searchMulti(q),
    listPosts({ userId: req.session.userId, where, params, limit: DISCUSSION_PAGE }),
  ]);

  res.render('search', {
    nav: 'search',
    q,
    movies: movies.results,
    totalMovies: movies.totalResults,
    hasMoreMovies: movies.page < movies.totalPages,
    people: multi.filter((r) => r.type === 'person').slice(0, 8),
    posts: discussions.posts,
    hasMorePosts: discussions.hasMore,
  });
});

// Live search dropdown (movies + people)
router.get('/api/search', async (req, res) => {
  res.json(await tmdb.searchMulti(req.query.q));
});

// One endpoint feeds every infinite movie grid
async function gridData(req) {
  const page = toInt(req.query.page, 1, 1, 500);
  if (req.query.src === 'search') return tmdb.searchMovies(req.query.q, page);
  if (req.query.src === 'genre') {
    return tmdb.discover({ genre: toInt(req.query.id, 0, 0), sort: GRID_SORTS[req.query.sort] || GRID_SORTS.popular, page });
  }
  return { results: [], page: 1, totalPages: 0 };
}

router.get('/api/grid', async (req, res) => {
  const data = await gridData(req);
  await sendPage(res, 'partials/movieCards', { movies: data.results }, data.page < data.totalPages);
});

router.get('/genre/:id', async (req, res) => {
  const id = toInt(req.params.id, 0, 0);
  const genres = await tmdb.genres();
  const genre = genres.find((g) => g.id === id);
  if (!genre) return res.status(404).render('error', { code: 404, message: 'That genre does not exist.' });

  const sort = GRID_SORTS[req.query.sort] ? req.query.sort : 'popular';
  const data = await tmdb.discover({ genre: id, sort: GRID_SORTS[sort], page: 1 });
  res.render('genre', { nav: 'home', genre, genres, sort, sorts: Object.keys(GRID_SORTS), movies: data.results, hasMore: data.page < data.totalPages });
});

module.exports = router;
