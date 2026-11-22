require('dotenv').config();

/**
 * Compatibility layer so the one-off `backfillMovieData.js` script keeps working.
 * It exposes the same two functions the old OMDb module did, but the data now
 * comes from TMDB. The website itself uses config/tmdb.js directly.
 */

const tmdb = require('./tmdb');

const IMDB_ID_RE = /^tt\d{6,}$/i;

async function searchMovies(query, { limit = 10 } = {}) {
  const { results } = await tmdb.searchMovies(query);
  return results.slice(0, limit).map((m) => ({ title: m.title, year: m.year, poster: m.poster, tmdbId: m.id, type: m.type }));
}

async function getMovieInfo(input, { year = null } = {}) {
  const value = String(input || '').trim();
  if (!value) return null;

  const hit = await tmdb.resolveTitle(
    IMDB_ID_RE.test(value) ? { imdbId: value } : { title: value, year }
  );
  if (!hit) return null;

  const movie = await tmdb.getTitle(hit.type, hit.id);
  if (!movie) return null;

  const f = tmdb.postFields(movie);
  return {
    imdbID: f.imdb_id,
    title: movie.title,
    year: movie.year,
    poster: f.poster_url,
    rating: f.imdb_rating,
    genre: f.genre,
    releaseDate: f.release_date,
    director: f.director,
    actors: f.actors,
    runtime: f.runtime,
    plot: f.plot,
    boxOffice: f.box_office || null,
  };
}

module.exports = { searchMovies, getMovieInfo };
