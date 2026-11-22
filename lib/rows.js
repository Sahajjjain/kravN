const tmdb = require('../config/tmdb');

/**
 * The endless Netflix-style home page: a few curated rows, then every TMDB genre
 * over and over with different sort orders and pages, so there is always more to scroll.
 */

const CURATED = [
  { title: 'Trending this week', load: (p) => tmdb.trending(p) },
  { title: 'Popular right now', load: (p) => tmdb.popular(p) },
  { title: 'Top rated of all time', load: (p) => tmdb.topRated(p) },
  { title: 'New & airing now', load: (p) => tmdb.nowPlaying(p) },
  { title: 'Coming soon', load: (p) => tmdb.upcoming(p) },
];

const GENRE_PASSES = [
  { title: (g) => `Popular in ${g}`, sort: 'popularity.desc', minVotes: 200 },
  { title: (g) => `Best of ${g}`, sort: 'vote_average.desc', minVotes: 1500 },
  { title: (g) => `Fresh in ${g}`, sort: 'primary_release_date.desc', minVotes: 50 },
  { title: (g) => `Hidden gems: ${g}`, sort: 'vote_average.desc', minVotes: 300 },
];

const PAGES_PER_GENRE = 6;
const ROW_SIZE = 24; // movies and series are mixed, so a page holds ~40 — a row only needs a screenful or two

async function rowCount() {
  const genres = await tmdb.genres();
  return CURATED.length + genres.length * GENRE_PASSES.length * PAGES_PER_GENRE;
}

/** Row number `i` (0-based) or null when it has nothing to show. */
async function buildRow(i) {
  if (i < CURATED.length) {
    const row = CURATED[i];
    const { results } = await row.load(1);
    return results.length ? { title: row.title, movies: results.slice(0, ROW_SIZE) } : null;
  }
  const genres = await tmdb.genres();
  const j = i - CURATED.length;
  const genre = genres[j % genres.length];
  const pass = Math.floor(j / genres.length);
  const style = GENRE_PASSES[pass % GENRE_PASSES.length];
  const page = Math.floor(pass / GENRE_PASSES.length) + 1;
  const { results } = await tmdb.discover({ genre: genre.id, sort: style.sort, page, minVotes: style.minVotes });
  return results.length
    ? { title: style.title(genre.name), movies: results.slice(0, ROW_SIZE), href: `/genre/${genre.id}` }
    : null;
}

module.exports = { buildRow, rowCount };
