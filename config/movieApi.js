require('dotenv').config();

// Put this file at config/movieApi.js. Requires Node 18+ (global fetch, AbortSignal.timeout).

const OMDB_URL = 'https://www.omdbapi.com/';
const REQUEST_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_MAX_ENTRIES = 300;
const IMDB_ID_RE = /^tt\d{6,}$/i;

/* ------------------------------ tiny cache ------------------------------ */

const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value); // drop oldest entry
  }
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

/* ------------------------------- helpers -------------------------------- */

// OMDb returns the string "N/A" for missing fields
const clean = (v) => (v && v !== 'N/A' ? v : null);

// "Râmâyana" -> "ramayana", strips punctuation, collapses spaces
function normalize(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseYear(yearStr) {
  const m = String(yearStr || '').match(/\d{4}/);
  return m ? parseInt(m[0], 10) : null;
}

// "ramayana 2026" / "ramayana (2026)" -> { title: "ramayana", year: "2026" }
// Titles that are themselves numbers (e.g. "1917") are left untouched.
function splitQueryAndYear(query) {
  const q = String(query || '').trim();
  const m = q.match(/^(.+?)\s*\(?\b((?:19|20)\d{2})\)?$/);
  const maxYear = new Date().getFullYear() + 3;
  if (m && m[1].trim() && parseInt(m[2], 10) <= maxYear) {
    return { title: m[1].trim(), year: m[2] };
  }
  return { title: q, year: null };
}

async function omdbFetch(params) {
  const apiKey = process.env.OMDB_API_KEY;
  if (!apiKey) {
    console.error('OMDB_API_KEY is missing. Add it to your .env file.');
    return { Response: 'False', Error: 'Missing API key' };
  }

  const url = new URL(OMDB_URL);
  url.searchParams.set('apikey', apiKey);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) {
      console.error(`OMDb HTTP ${res.status}`);
      return { Response: 'False', Error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    if (data.Response === 'False' && data.Error === 'Request limit reached!') {
      console.error('OMDb daily request limit reached.');
    }
    return data;
  } catch (err) {
    console.error('OMDb request failed:', err.name === 'TimeoutError' ? 'timeout' : err.message);
    return { Response: 'False', Error: 'Network error' };
  }
}

/* ------------------------------- ranking -------------------------------- */

function scoreResult(item, queryNorm, queryTokens, wantedYear) {
  const titleNorm = normalize(item.title);
  const titleTokens = titleNorm.split(' ').filter(Boolean);
  let score = 0;

  // Title relevance
  if (titleNorm === queryNorm) score += 100;
  else if (titleNorm.startsWith(queryNorm + ' ')) score += 60;
  else if (` ${titleNorm} `.includes(` ${queryNorm} `)) score += 40;

  const matched = queryTokens.filter((t) => titleTokens.includes(t)).length;
  score += (matched / Math.max(queryTokens.length, 1)) * 30;

  // Prefer shorter titles (fewer unrelated extra words)
  score -= Math.min(Math.max(titleTokens.length - queryTokens.length, 0), 10);

  // Year handling
  const year = parseYear(item.year);
  if (wantedYear && year === wantedYear) score += 50;
  if (year) score += Math.max(0, (year - 1900) / 10); // mild recency boost (max ~13)

  // Quality signal
  if (item.poster) score += 5;

  return score;
}

/* ------------------------------- searching ------------------------------ */

async function fetchAllSearchPages(title, year, type, maxPages) {
  const first = await omdbFetch({ s: title, y: year, type, page: 1 });
  if (first.Response === 'False' || !Array.isArray(first.Search)) return [];

  const items = [...first.Search];
  const totalPages = Math.min(Math.ceil((parseInt(first.totalResults, 10) || 0) / 10), maxPages);

  if (totalPages > 1) {
    const pageNumbers = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    const rest = await Promise.allSettled(
      pageNumbers.map((page) => omdbFetch({ s: title, y: year, type, page }))
    );
    for (const r of rest) {
      if (r.status === 'fulfilled' && r.value.Response === 'True' && Array.isArray(r.value.Search)) {
        items.push(...r.value.Search);
      }
    }
  }
  return items;
}

/**
 * Search IMDb-listed titles through OMDb, ranked by relevance.
 * By default only feature films are returned (no series, episodes or games).
 *
 * @param {string} query   e.g. "ramayana", "ramayana 2026", "Dune (2021)"
 * @param {object} [opts]  { limit = 10, maxPages = 3, type = 'movie' }
 *                         type: 'movie' | 'series' | 'episode' | null (null = everything)
 * @returns {Promise<Array<{title, year, poster, imdbID, type}>>}
 */
async function searchMovies(query, { limit = 10, maxPages = 3, type = 'movie' } = {}) {
  const raw = String(query || '').trim();
  if (raw.length < 2) return [];

  const cacheKey = `search:${raw.toLowerCase()}:${limit}:${maxPages}:${type}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const { title, year } = splitQueryAndYear(raw);

  // 1) title + year   2) title only   3) full raw query (e.g. "Blade Runner 2049")
  let items = await fetchAllSearchPages(title, year, type, maxPages);
  if (items.length === 0 && year) items = await fetchAllSearchPages(title, null, type, maxPages);
  if (items.length === 0 && title !== raw) items = await fetchAllSearchPages(raw, null, type, maxPages);

  // Keep only real IMDb entries, de-duplicate, normalise fields
  const seen = new Set();
  const results = [];
  for (const it of items) {
    if (!it || !IMDB_ID_RE.test(it.imdbID || '') || seen.has(it.imdbID)) continue;
    seen.add(it.imdbID);
    results.push({
      title: it.Title,
      year: it.Year,
      poster: clean(it.Poster),
      imdbID: it.imdbID,
      type: it.Type,
    });
  }

  const wantedYear = year ? parseInt(year, 10) : null;
  const queryNorm = normalize(title);
  const queryTokens = queryNorm.split(' ').filter(Boolean);

  const ranked = results
    .map((r) => ({ r, score: scoreResult(r, queryNorm, queryTokens, wantedYear) }))
    .sort((a, b) => b.score - a.score || (parseYear(b.r.year) || 0) - (parseYear(a.r.year) || 0))
    .slice(0, limit)
    .map(({ r }) => r);

  if (ranked.length > 0) cacheSet(cacheKey, ranked); // never cache failures
  return ranked;
}

/* ------------------------------ movie details --------------------------- */

/**
 * Get full details. Accepts an imdbID (exact, preferred) or a movie name.
 * Names are resolved through the ranked search; pass { year } to disambiguate
 * remakes / same-named films (used by the backfill script).
 *
 * @param {string} input   "tt27988879" or "ramayana"
 * @param {object} [opts]  { year }
 * @returns {Promise<object|null>}
 */
async function getMovieInfo(input, { year = null } = {}) {
  const value = String(input || '').trim();
  if (!value) return null;

  let imdbID = IMDB_ID_RE.test(value) ? value : null;

  if (!imdbID) {
    const alreadyHasYear = splitQueryAndYear(value).year !== null;
    const query = year && !alreadyHasYear ? `${value} ${year}` : value;
    const [best] = await searchMovies(query, { limit: 1 });
    if (!best) return null;
    imdbID = best.imdbID;
  }

  const cacheKey = `info:${imdbID}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const data = await omdbFetch({ i: imdbID, plot: 'short' });
  if (data.Response === 'False') return null;

  const info = {
    imdbID: data.imdbID || imdbID,
    title: data.Title || null,
    type: data.Type || null,
    poster: clean(data.Poster),
    year: clean(data.Year),
    rating: clean(data.imdbRating),
    genre: clean(data.Genre), // e.g. "Action, Crime, Drama"
    releaseDate: clean(data.Released) || clean(data.Year),
    director: clean(data.Director),
    actors: clean(data.Actors),
    runtime: clean(data.Runtime),
    plot: clean(data.Plot),
    boxOffice: clean(data.BoxOffice), // e.g. "$292,576,195" (often N/A -> null)
  };

  cacheSet(cacheKey, info);
  return info;
}

module.exports = { getMovieInfo, searchMovies };