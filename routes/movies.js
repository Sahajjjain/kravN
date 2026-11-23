const express = require('express');
const router = express.Router();

const requireLogin = require('../middleware/authMiddleware');
const tmdb = require('../config/tmdb');
const { listPosts, movieWhere, countWhere, createDiscussion, sortKey, clip } = require('../lib/posts');
const { sendPage } = require('../lib/render');
const { toInt } = require('../lib/util');

const PAGE = 10;
const PREVIEW = 4; // discussions shown on the movie page itself

const notFound = (res, message) => res.status(404).render('error', { code: 404, message });

// Movies and series share every route below; only the URL prefix tells them apart
// (TMDB reuses the same numbers for both, so /movie/1399 and /tv/1399 are different titles).
const typeOf = (req) => (req.path.startsWith('/tv/') || req.path.startsWith('/api/tv/') ? 'tv' : 'movie');
const missing = (type) => (type === 'tv' ? "We couldn't find that series." : "We couldn't find that movie.");

/* Open the page for a stored post — movie or series (IMDb id first, then name + year) */
router.get('/movie/find', async (req, res) => {
  const { imdb, title, year } = req.query;
  const hit = await tmdb.resolveTitle({ imdbId: imdb, title, year });
  if (hit) return res.redirect(`/${hit.type}/${hit.id}`);
  res.redirect(`/search?q=${encodeURIComponent(title || '')}`);
});

/* ------------------------------ title page ------------------------------- */

router.get(['/movie/:id', '/tv/:id'], async (req, res) => {
  const type = typeOf(req);
  if (!tmdb.isReady()) return notFound(res, 'Movie data is not connected yet (TMDB_API_KEY is missing).');
  const movie = await tmdb.getTitle(type, req.params.id);
  if (!movie) return notFound(res, missing(type));

  const { where, params } = movieWhere(movie);
  const posted = toInt(req.query.posted, 0, 0);
  // preview = most liked; right after posting, newest first so your own post is visible
  const sort = posted ? 'latest' : 'top';
  const [list, total, collection] = await Promise.all([
    listPosts({ userId: req.session.userId, where, params, sort, limit: PREVIEW }),
    countWhere(where, params),
    movie.collection ? tmdb.getCollection(movie.collection.id) : null,
  ]);

  res.render('movie', {
    nav: 'home',
    movie,
    collection,
    posts: list.posts,
    total,
    compose: req.query.compose === '1',
    posted,
  });
});

/* ------------------------- all discussions of a title ------------------------- */

router.get(['/movie/:id/discussions', '/tv/:id/discussions'], async (req, res) => {
  const type = typeOf(req);
  if (!tmdb.isReady()) return notFound(res, 'Movie data is not connected yet (TMDB_API_KEY is missing).');
  const movie = await tmdb.getTitle(type, req.params.id);
  if (!movie) return notFound(res, missing(type));

  const { where, params } = movieWhere(movie);
  const sort = sortKey(req.query.sort);
  const [list, total] = await Promise.all([
    listPosts({ userId: req.session.userId, where, params, sort, limit: PAGE }),
    countWhere(where, params),
  ]);

  res.render('movie-discussions', { nav: 'home', movie, posts: list.posts, hasMore: list.hasMore, total, sort });
});

// Infinite scroll for one title's discussions
router.get(['/api/movie/:id/discussions', '/api/tv/:id/discussions'], async (req, res) => {
  const movie = await tmdb.getTitle(typeOf(req), req.params.id);
  if (!movie) return res.json({ html: '', hasMore: false });
  const { where, params } = movieWhere(movie);
  const { posts, hasMore } = await listPosts({
    userId: req.session.userId, where, params, sort: sortKey(req.query.sort), page: req.query.page, limit: PAGE,
  });
  await sendPage(res, 'partials/postCards', { posts }, hasMore);
});

// Posting from a title page: the new discussion appears right there under it
router.post(['/movie/:id/discussions', '/tv/:id/discussions'], requireLogin, async (req, res) => {
  const type = typeOf(req);
  const { title, content } = req.body || {};
  const back = `/${type}/${encodeURIComponent(req.params.id)}`;
  if (!clip(title, 1) || !clip(content, 1)) return res.redirect(`${back}?compose=1#discussions`);

  const movie = await tmdb.getTitle(type, req.params.id);
  if (!movie) return notFound(res, missing(type));

  const postId = await createDiscussion(req.session.userId, { title, content }, tmdb.postFields(movie));
  res.redirect(`${back}?posted=${postId}#d-${postId}`);
});

/* ------------------------------- person page ------------------------------- */

router.get('/person/:id', async (req, res) => {
  const person = await tmdb.getPerson(req.params.id);
  if (!person) return notFound(res, "We couldn't find that person.");
  res.render('person', { nav: 'home', person });
});

module.exports = router;