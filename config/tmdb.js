require('dotenv').config();

/**
 * KravN's TMDB client — the single source of movie data.
 *
 *  - Works with either a v3 API key (32 hex chars) or a v4 "Read Access Token" (starts with "eyJ").
 *  - Never throws: every call resolves to data or to an empty/null value, so a TMDB hiccup
 *    can never take a KravN page down (discussions come from your own database).
 *  - Caches responses in memory and de-duplicates concurrent identical requests.
 */

const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const TIMEOUT_MS = 8000;
const TTL_SHORT = 10 * 60 * 1000;      // lists, search
const TTL_LONG = 6 * 60 * 60 * 1000;   // movie details, people, genres
const TTL_RESOLVE = 24 * 60 * 60 * 1000;
const MAX_CACHE = 600;

const IMDB_ID_RE = /^tt\d{6,}$/i;

/* ------------------------------- tiny cache ------------------------------- */

const cache = new Map(); // key -> { promise, expires }

function remember(key, ttl, make) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.promise;
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  const promise = make();
  cache.set(key, { promise, expires: Date.now() + ttl });
  // never keep failures around
  promise.then((v) => { if (v === null || v === undefined) cache.delete(key); }, () => cache.delete(key));
  return promise;
}

/* --------------------------------- fetcher -------------------------------- */

const apiKey = () => (process.env.TMDB_API_KEY || '').trim();
const isReady = () => !!apiKey();

let warnedMissing = false;

async function api(path, params = {}, ttl = TTL_SHORT) {
  const key = apiKey();
  if (!key) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.error('TMDB_API_KEY is missing. Add it to your .env file / Render environment variables.');
    }
    return null;
  }

  const url = new URL(BASE + path);
  url.searchParams.set('language', 'en-US');
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const cacheKey = url.pathname + url.search; // key is NOT part of the cache key

  return remember(cacheKey, ttl, async () => {
    const headers = { accept: 'application/json' };
    if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
    else url.searchParams.set('api_key', key);

    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status === 404) return null;
      if (res.status === 401) {
        console.error('TMDB rejected the API key (401). Check TMDB_API_KEY.');
        return null;
      }
      if (!res.ok) {
        console.error(`TMDB HTTP ${res.status} for ${path}`);
        return null;
      }
      return await res.json();
    } catch (err) {
      console.error('TMDB request failed:', path, err.name === 'TimeoutError' ? 'timeout' : err.message);
      return null;
    }
  });
}

/* -------------------------------- normalisers ----------------------------- */

const img = (p, size = 'w500') => (p ? `${IMG}/${size}${p}` : null);

// "% match" shown on cards: TMDB vote average (0-10) as a percentage
const percentOf = (m) => (m && m.vote_count > 0 && m.vote_average > 0 ? Math.round(m.vote_average * 10) : null);

const yearOf = (date) => ((date || '').match(/^\d{4}/) || [''])[0];
const today = () => new Date().toISOString().slice(0, 10);

/* Movies and series live side by side. TMDB uses different genre ids for TV, so everything is
   folded into the movie genre ids KravN already uses (e.g. TV "Action & Adventure" -> Action + Adventure). */
const TV_TO_UNIFIED = { 10759: [28, 12], 10765: [878, 14], 10768: [10752] };
const GENRE_NAME = { 28: 'Action', 12: 'Adventure', 878: 'Science Fiction', 14: 'Fantasy', 10752: 'War' };
const TV_ONLY_GENRES = [
  { id: 10764, name: 'Reality' }, { id: 10767, name: 'Talk' }, { id: 10762, name: 'Kids' },
  { id: 10766, name: 'Soap' }, { id: 10763, name: 'News' },
];
const TV_ONLY_IDS = new Set(TV_ONLY_GENRES.map((g) => g.id));
const MOVIE_ONLY_IDS = new Set([27, 10749, 10402, 36, 53, 10770]); // Horror, Romance, Music, History, Thriller, TV Movie
const UNIFIED_TO_TV = { 28: 10759, 12: 10759, 878: 10765, 14: 10765, 10752: 10768 };

// Which TMDB genre id to ask each catalogue for (null = that catalogue has no such genre)
function genrePlan(id) {
  if (!id) return { movie: undefined, tv: undefined };
  return {
    movie: TV_ONLY_IDS.has(id) ? null : id,
    tv: MOVIE_ONLY_IDS.has(id) ? null : UNIFIED_TO_TV[id] || id,
  };
}

function unifyGenreIds(ids) {
  const out = [];
  for (const id of ids || []) for (const u of TV_TO_UNIFIED[id] || [id]) if (!out.includes(u)) out.push(u);
  return out;
}

const unifyGenres = (list) => {
  const out = [];
  for (const g of list || []) {
    for (const u of TV_TO_UNIFIED[g.id] || [g.id]) {
      if (!out.some((x) => x.id === u)) out.push({ id: u, name: GENRE_NAME[u] || g.name });
    }
  }
  return out;
};

function typeOfItem(m, forced) {
  if (forced) return forced;
  if (m.media_type === 'tv' || m.media_type === 'movie') return m.media_type;
  return m.title === undefined && m.name !== undefined ? 'tv' : 'movie';
}

function toCard(m, forced) {
  const type = typeOfItem(m, forced);
  const date = (type === 'tv' ? m.first_air_date : m.release_date) || '';
  return {
    id: m.id,
    type,
    url: `/${type}/${m.id}`,
    title: m.title || m.name || 'Untitled',
    year: yearOf(date),
    date,
    poster: img(m.poster_path, 'w342'),
    backdrop: img(m.backdrop_path, 'w780'),
    backdropLg: img(m.backdrop_path, 'w1280'),
    percent: percentOf(m),
    overview: m.overview || '',
    genreIds: unifyGenreIds(m.genre_ids),
    pop: m.popularity || 0,
    vote: m.vote_average || 0,
  };
}

const EMPTY_LIST = () => ({ results: [], page: 1, totalPages: 0, totalResults: 0 });

function toList(d, { needPoster = true, type } = {}) {
  if (!d || !Array.isArray(d.results)) return EMPTY_LIST();
  return {
    results: d.results
      .filter((m) => m && m.id && (type || !m.media_type || m.media_type === 'movie' || m.media_type === 'tv'))
      .filter((m) => !needPoster || m.poster_path)
      .map((m) => toCard(m, type)),
    page: d.page || 1,
    totalPages: Math.min(d.total_pages || 1, 500), // TMDB caps paging at 500
    totalResults: d.total_results || 0,
  };
}

/* ----------------------- merging movie + series lists ---------------------- */

const SORTERS = {
  pop: (a, b) => b.pop - a.pop,
  vote: (a, b) => b.vote - a.vote || b.pop - a.pop,
  newest: (a, b) => (b.date || '').localeCompare(a.date || ''),
};

function interleave(a, b) {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
}

// One list made of a movie list and a series list. sorter: 'pop' | 'vote' | 'newest' | null (= alternate)
function merge(movies, shows, sorter) {
  const seen = new Set();
  const all = sorter ? [...movies.results, ...shows.results].sort(SORTERS[sorter]) : interleave(movies.results, shows.results);
  const results = all.filter((c) => (seen.has(c.type + c.id) ? false : seen.add(c.type + c.id)));
  return {
    results,
    page: Math.max(movies.page, shows.page),
    totalPages: Math.max(movies.totalPages, shows.totalPages),
    totalResults: movies.totalResults + shows.totalResults,
  };
}

const skip = () => Promise.resolve(null);

/* --------------------------------- lists ---------------------------------- */

async function trending(page = 1) {
  const d = await api('/trending/all/week', { page });
  return toList(d && { ...d, results: (d.results || []).filter((r) => r.media_type === 'movie' || r.media_type === 'tv') });
}

const both = async (moviePath, tvPath, page, sorter, extra = {}) => {
  const [m, t] = await Promise.all([
    api(moviePath, { page, ...extra }),
    api(tvPath, { page, ...extra }),
  ]);
  return merge(toList(m, { type: 'movie' }), toList(t, { type: 'tv' }), sorter);
};

const popular = (page = 1) => both('/movie/popular', '/tv/popular', page, 'pop');
const topRated = (page = 1) => both('/movie/top_rated', '/tv/top_rated', page, 'vote');
const nowPlaying = (page = 1) => both('/movie/now_playing', '/tv/on_the_air', page, null);

async function upcoming(page = 1) {
  const [m, t] = await Promise.all([
    api('/movie/upcoming', { page }),
    api('/discover/tv', { page, sort_by: 'popularity.desc', 'first_air_date.gte': today(), include_null_first_air_dates: false }),
  ]);
  return merge(toList(m, { type: 'movie' }), toList(t, { type: 'tv' }), null);
}

/**
 * Movies and series for one genre / sort order, as one list.
 * sort: popularity.desc | vote_average.desc | primary_release_date.desc | revenue.desc (movies only)
 */
async function discover({ genre, sort = 'popularity.desc', page = 1, minVotes = 100 } = {}) {
  const plan = genrePlan(genre);
  const isNew = sort.startsWith('primary_release_date');
  const moviesOnly = sort.startsWith('revenue');

  const movieParams = { with_genres: plan.movie, sort_by: sort, page, include_adult: false, 'vote_count.gte': minVotes };
  if (isNew) movieParams['primary_release_date.lte'] = today();

  const tvParams = {
    with_genres: plan.tv, page, 'vote_count.gte': Math.max(10, Math.round(minVotes / 3)),
    sort_by: isNew ? 'first_air_date.desc' : sort,
  };
  if (isNew) tvParams['first_air_date.lte'] = today();

  const [m, t] = await Promise.all([
    plan.movie === null ? skip() : api('/discover/movie', movieParams),
    plan.tv === null || moviesOnly ? skip() : api('/discover/tv', tvParams),
  ]);
  const sorter = isNew ? 'newest' : sort.startsWith('vote_average') ? 'vote' : 'pop';
  return merge(toList(m, { type: 'movie' }), toList(t, { type: 'tv' }), moviesOnly ? null : sorter);
}

// Movies and series matching a text search, in TMDB's own relevance order
async function searchTitles(q, page = 1) {
  const query = String(q || '').trim();
  if (query.length < 1) return EMPTY_LIST();
  const d = await api('/search/multi', { query, page, include_adult: false });
  if (!d || !Array.isArray(d.results)) return EMPTY_LIST();
  return toList({ ...d, results: d.results.filter((r) => r.media_type === 'movie' || r.media_type === 'tv') }, { needPoster: false });
}
const searchMovies = searchTitles; // old name, still used by a few callers

// movies + series + people for the live search dropdown
async function searchMulti(q) {
  const query = String(q || '').trim();
  if (query.length < 2) return [];
  const d = await api('/search/multi', { query, include_adult: false });
  if (!d || !Array.isArray(d.results)) return [];
  return d.results
    .filter((r) => r.media_type === 'movie' || r.media_type === 'tv' || (r.media_type === 'person' && r.profile_path))
    .slice(0, 12)
    .map((r) => {
      if (r.media_type === 'person') {
        return { type: 'person', id: r.id, url: `/person/${r.id}`, title: r.name, year: r.known_for_department || '', image: img(r.profile_path, 'w92'), percent: null };
      }
      return {
        type: r.media_type, id: r.id, url: `/${r.media_type}/${r.id}`,
        title: r.title || r.name, year: yearOf(r.release_date || r.first_air_date),
        image: img(r.poster_path, 'w92'), percent: percentOf(r),
      };
    });
}

/* -------------------------------- genres ---------------------------------- */

// Official TMDB movie genre ids — used as a fallback when the genre call fails
const FALLBACK_GENRES = [
  [28, 'Action'], [12, 'Adventure'], [16, 'Animation'], [35, 'Comedy'], [80, 'Crime'], [99, 'Documentary'],
  [18, 'Drama'], [10751, 'Family'], [14, 'Fantasy'], [36, 'History'], [27, 'Horror'], [10402, 'Music'],
  [9648, 'Mystery'], [10749, 'Romance'], [878, 'Science Fiction'], [53, 'Thriller'], [10752, 'War'], [37, 'Western'],
].map(([id, name]) => ({ id, name }));

// One genre list for movies and series: TMDB's movie genres + the few that only exist for TV
async function genres() {
  const d = await api('/genre/movie/list', {}, TTL_LONG);
  const base = d && Array.isArray(d.genres) && d.genres.length ? d.genres : FALLBACK_GENRES;
  return [...base.filter((g) => g.id !== 10770), ...TV_ONLY_GENRES];
}

/* ------------------------------ movie details ----------------------------- */

function certificationOf(releaseDates) {
  const results = (releaseDates && releaseDates.results) || [];
  for (const cc of ['IN', 'US', 'GB']) {
    const entry = results.find((r) => r.iso_3166_1 === cc);
    const cert = entry && entry.release_dates.map((r) => r.certification).find(Boolean);
    if (cert) return cert;
  }
  return null;
}

// Series carry their age rating in "content_ratings" instead of "release_dates"
function tvCertificationOf(contentRatings) {
  const results = (contentRatings && contentRatings.results) || [];
  for (const cc of ['IN', 'US', 'GB']) {
    const entry = results.find((r) => r.iso_3166_1 === cc && r.rating);
    if (entry) return entry.rating;
  }
  return null;
}

function groupKeyCrew(crew, creators = []) {
  const wanted = [
    ['Director', (c) => c.job === 'Director'],
    ['Writers', (c) => ['Screenplay', 'Writer', 'Story', 'Novel', 'Characters'].includes(c.job)],
    ['Producers', (c) => ['Producer', 'Executive Producer'].includes(c.job)],
    ['Music', (c) => c.job === 'Original Music Composer'],
    ['Cinematography', (c) => c.job === 'Director of Photography'],
    ['Editor', (c) => c.job === 'Editor'],
  ];
  const out = [];
  if (creators.length) out.push({ label: creators.length > 1 ? 'Creators' : 'Creator', people: creators.slice(0, 4).map((p) => ({ id: p.id, name: p.name })) });
  for (const [label, test] of wanted) {
    const seen = new Set();
    const people = crew.filter(test).filter((c) => (seen.has(c.id) ? false : seen.add(c.id))).slice(0, 4);
    if (people.length) out.push({ label: label === 'Director' && people.length > 1 ? 'Directors' : label, people: people.map((p) => ({ id: p.id, name: p.name })) });
  }
  return out;
}

/**
 * One shape for movies AND series, so every page, card and discussion treats them the same.
 * Series simply have a few extra fields (seasons, networks…) that the page shows when present.
 */
function toTitle(d, type) {
  const isTv = type === 'tv';
  const credits = d.credits || {};
  const cast = (credits.cast || []).slice(0, 30).map((c) => ({
    id: c.id, name: c.name, character: c.character || '', photo: img(c.profile_path, 'w185'),
  }));
  const crew = credits.crew || [];
  const creators = isTv ? d.created_by || [] : [];

  const videos = ((d.videos && d.videos.results) || [])
    .filter((v) => v.site === 'YouTube' && v.key)
    .sort((a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0) || (a.type === 'Trailer' ? -1 : 0) - (b.type === 'Trailer' ? -1 : 0))
    .slice(0, 12)
    .map((v) => ({ key: v.key, name: v.name, type: v.type }));

  const images = d.images || {};
  const gallery = (list, thumb, full, n) =>
    (list || []).slice(0, n).map((i) => ({ thumb: img(i.file_path, thumb), full: img(i.file_path, full), ratio: i.aspect_ratio }));

  const providers = {};
  const prov = (d['watch/providers'] && d['watch/providers'].results) || {};
  for (const [cc, p] of Object.entries(prov)) {
    const mapList = (l) => (l || []).map((x) => ({ name: x.provider_name, logo: img(x.logo_path, 'w92') }));
    providers[cc] = { link: p.link, flatrate: mapList(p.flatrate), rent: mapList(p.rent), buy: mapList(p.buy) };
  }

  const ext = d.external_ids || {};
  const imdbId = d.imdb_id || ext.imdb_id || null;
  const collection = d.belongs_to_collection;
  const title = (isTv ? d.name : d.title) || 'Untitled';
  const date = (isTv ? d.first_air_date : d.release_date) || '';
  const epRuntime = isTv
    ? (d.episode_run_time || []).find(Boolean) || (d.last_episode_to_air && d.last_episode_to_air.runtime) || 0
    : d.runtime || 0;
  const keywordList = isTv ? (d.keywords && d.keywords.results) || [] : (d.keywords && d.keywords.keywords) || [];

  const seasonsAll = (d.seasons || []).map((s) => ({
    number: s.season_number,
    name: s.name || `Season ${s.season_number}`,
    episodes: s.episode_count || 0,
    year: yearOf(s.air_date),
    date: s.air_date || '',
    poster: img(s.poster_path, 'w342'),
    overview: s.overview || '',
    percent: s.vote_average > 0 ? Math.round(s.vote_average * 10) : null,
  }));
  const seasons = seasonsAll.length > 1 ? seasonsAll.filter((s) => s.number > 0) : seasonsAll;
  const nextEp = d.next_episode_to_air;

  return {
    id: d.id,
    type,
    isTv,
    url: `/${type}/${d.id}`,
    imdbId: imdbId && IMDB_ID_RE.test(imdbId) ? imdbId : null,
    title,
    originalTitle: (isTv ? d.original_name : d.original_title) || title,
    tagline: d.tagline || '',
    overview: d.overview || '',
    year: yearOf(date),
    date,
    runtime: epRuntime,
    status: d.status || '',
    language: d.original_language || '',
    voteAvg: d.vote_average || 0,
    voteCount: d.vote_count || 0,
    percent: percentOf(d),
    popularity: d.popularity || 0,
    budget: d.budget || 0,
    revenue: d.revenue || 0,
    homepage: d.homepage || '',
    certification: isTv ? tvCertificationOf(d.content_ratings) : certificationOf(d.release_dates),
    poster: img(d.poster_path, 'w500'),
    posterLg: img(d.poster_path, 'w780'),
    backdrop: img(d.backdrop_path, 'w1280'),
    backdropSm: img(d.backdrop_path, 'w780'),
    genres: unifyGenres(d.genres),
    companies: (d.production_companies || []).map((c) => ({ id: c.id, name: c.name, logo: img(c.logo_path, 'w185'), country: c.origin_country })),
    countries: isTv ? d.origin_country || [] : (d.production_countries || []).map((c) => c.name),
    spokenLanguages: (d.spoken_languages || []).map((l) => l.english_name || l.name),
    collection: collection ? { id: collection.id, name: collection.name, poster: img(collection.poster_path, 'w342') } : null,
    keywords: keywordList.slice(0, 20),
    cast,
    keyCrew: groupKeyCrew(crew, creators),
    directors: isTv ? creators.map((c) => c.name) : crew.filter((c) => c.job === 'Director').map((c) => c.name),
    videos,
    backdrops: gallery(images.backdrops, 'w300', 'w1280', 18),
    posters: gallery(images.posters, 'w185', 'w780', 12),
    recommendations: toList(d.recommendations, { type }).results.slice(0, 20),
    similar: toList(d.similar, { type }).results.slice(0, 20),
    reviews: ((d.reviews && d.reviews.results) || []).slice(0, 8).map((r) => ({
      author: (r.author_details && r.author_details.name) || r.author || 'Anonymous',
      rating: r.author_details && r.author_details.rating,
      content: r.content || '',
      date: r.created_at,
      url: r.url,
    })),
    providers,
    // series-only (empty / zero for movies)
    seasons,
    seasonCount: d.number_of_seasons || 0,
    episodeCount: d.number_of_episodes || 0,
    networks: isTv ? (d.networks || []).map((n) => n.name) : [],
    inProduction: !!d.in_production,
    lastAired: isTv ? d.last_air_date || '' : '',
    nextEpisode: nextEp ? { date: nextEp.air_date || '', name: nextEp.name || '', season: nextEp.season_number, number: nextEp.episode_number } : null,
    external: {
      imdb: imdbId ? `https://www.imdb.com/title/${imdbId}/` : null,
      tmdb: `https://www.themoviedb.org/${type}/${d.id}`,
      facebook: ext.facebook_id ? `https://www.facebook.com/${ext.facebook_id}` : null,
      instagram: ext.instagram_id ? `https://www.instagram.com/${ext.instagram_id}` : null,
      twitter: ext.twitter_id ? `https://twitter.com/${ext.twitter_id}` : null,
      wikidata: ext.wikidata_id ? `https://www.wikidata.org/wiki/${ext.wikidata_id}` : null,
      homepage: d.homepage || null,
    },
  };
}

const APPEND = {
  movie: 'credits,videos,images,recommendations,similar,reviews,keywords,release_dates,watch/providers,external_ids',
  tv: 'credits,videos,images,recommendations,similar,reviews,keywords,content_ratings,watch/providers,external_ids',
};

/** One call for either kind: getTitle('movie', 603) or getTitle('tv', 1396) */
async function getTitle(type, id) {
  if ((type !== 'movie' && type !== 'tv') || !/^\d+$/.test(String(id))) return null;
  const d = await api(`/${type}/${id}`, { append_to_response: APPEND[type], include_image_language: 'en,null' }, TTL_LONG);
  return d && d.id ? toTitle(d, type) : null;
}

const getMovie = (id) => getTitle('movie', id);
const getTv = (id) => getTitle('tv', id);

async function getCollection(id) {
  const d = await api(`/collection/${id}`, {}, TTL_LONG);
  if (!d || !Array.isArray(d.parts)) return null;
  return { id: d.id, name: d.name, overview: d.overview || '', parts: toList({ results: d.parts }, { type: 'movie' }).results.sort((a, b) => (a.date || '').localeCompare(b.date || '')) };
}

/* --------------------------------- people --------------------------------- */

async function getPerson(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const d = await api(`/person/${id}`, { append_to_response: 'combined_credits,images,external_ids' }, TTL_LONG);
  if (!d || !d.id) return null;

  const credits = d.combined_credits || {};
  const byKey = new Map();
  const add = (c, role) => {
    if (!c.poster_path || (c.media_type !== 'movie' && c.media_type !== 'tv')) return;
    const key = `${c.media_type}:${c.id}`;
    if (byKey.has(key)) return;
    byKey.set(key, { ...toCard(c), role, popularity: c.popularity || 0 });
  };
  for (const c of credits.cast || []) add(c, c.character || '');
  for (const c of credits.crew || []) add(c, c.job || '');
  const ext = d.external_ids || {};
  return {
    id: d.id,
    name: d.name,
    bio: d.biography || '',
    birthday: d.birthday || '',
    deathday: d.deathday || '',
    birthplace: d.place_of_birth || '',
    department: d.known_for_department || '',
    alsoKnownAs: (d.also_known_as || []).slice(0, 5),
    photo: img(d.profile_path, 'w500'),
    photos: ((d.images && d.images.profiles) || []).slice(0, 12).map((p) => ({ thumb: img(p.file_path, 'w185'), full: img(p.file_path, 'h632') })),
    films: [...byKey.values()].sort((a, b) => b.popularity - a.popularity),
    external: {
      imdb: ext.imdb_id ? `https://www.imdb.com/name/${ext.imdb_id}/` : null,
      instagram: ext.instagram_id ? `https://www.instagram.com/${ext.instagram_id}` : null,
      twitter: ext.twitter_id ? `https://twitter.com/${ext.twitter_id}` : null,
      tmdb: `https://www.themoviedb.org/person/${d.id}`,
    },
  };
}

/* --------------- linking old/new posts to a TMDB title page --------------- */

const normalize = (s) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Finds the TMDB title (movie OR series) for a stored post -> { type, id } or null.
 * Uses the IMDb id when the post has one (exact), otherwise name + year. Result is cached,
 * nothing is ever written back to your database.
 * Pass `type` ('movie' | 'tv') to only look at one kind.
 */
async function resolveTitle({ imdbId, title, year, type } = {}) {
  const cacheKey = `resolve:${type || ''}|${imdbId || ''}|${normalize(title)}|${year || ''}`;
  return remember(cacheKey, TTL_RESOLVE, async () => {
    if (imdbId && IMDB_ID_RE.test(imdbId)) {
      const d = await api(`/find/${imdbId}`, { external_source: 'imdb_id' }, TTL_RESOLVE);
      const movie = d && d.movie_results && d.movie_results[0];
      const show = d && d.tv_results && d.tv_results[0];
      if (movie && type !== 'tv') return { type: 'movie', id: movie.id };
      if (show && type !== 'movie') return { type: 'tv', id: show.id };
    }
    if (!title) return null;

    const want = normalize(title);
    const exact = (list, nameKey, origKey) => list.find((m) => normalize(m[nameKey]) === want || normalize(m[origKey]) === want);
    const searchBoth = async (yr) => {
      const [m, t] = await Promise.all([
        type === 'tv' ? skip() : api('/search/movie', { query: title, include_adult: false, ...(yr ? { primary_release_year: yr } : {}) }),
        type === 'movie' ? skip() : api('/search/tv', { query: title, include_adult: false, ...(yr ? { first_air_date_year: yr } : {}) }),
      ]);
      const movies = (m && m.results) || [];
      const shows = (t && t.results) || [];
      const hitM = exact(movies, 'title', 'original_title');
      const hitT = exact(shows, 'name', 'original_name');
      if (hitM) return { type: 'movie', id: hitM.id };
      if (hitT) return { type: 'tv', id: hitT.id };
      if (movies[0]) return { type: 'movie', id: movies[0].id };
      if (shows[0]) return { type: 'tv', id: shows[0].id };
      return null;
    };
    return (year && (await searchBoth(year))) || searchBoth(null);
  });
}

// Movie-only lookup, kept for the one-off backfill script
async function resolveMovieId(args) {
  const hit = await resolveTitle({ ...args, type: 'movie' });
  return hit ? hit.id : null;
}

/* -------------------- fields stored on a new discussion ------------------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Same shapes the old OMDb data used ("16 Jul 2010", "148 min", "$292,576,195"),
// so old and new posts look and behave alike.
function postFields(movie) {
  const [y, m, dd] = (movie.date || '').split('-');
  const released = y && m && dd ? `${dd} ${MONTHS[parseInt(m, 10) - 1]} ${y}` : y || null;
  const plot = movie.overview.length > 250 ? movie.overview.slice(0, 247).replace(/\s+\S*$/, '') + '…' : movie.overview;
  return {
    movie_name: movie.title,
    poster_url: movie.poster,
    imdb_rating: movie.voteCount > 0 ? movie.voteAvg.toFixed(1) : null,
    genre: movie.genres.map((g) => g.name).join(', ').slice(0, 100) || null,
    release_date: released,
    director: movie.directors.join(', ').slice(0, 100) || null,
    actors: movie.cast.slice(0, 4).map((c) => c.name).join(', ').slice(0, 150) || null,
    runtime: movie.runtime ? `${movie.runtime} min` : null,
    plot: plot || null,
    imdb_id: movie.imdbId,
    box_office: movie.revenue > 0 ? '$' + movie.revenue.toLocaleString('en-US') : '', // '' = checked, none listed
  };
}

module.exports = {
  isReady, img, trending, popular, topRated, nowPlaying, upcoming, discover, searchMovies, searchTitles, searchMulti,
  genres, getMovie, getTv, getTitle, getCollection, getPerson, resolveMovieId, resolveTitle, postFields, normalize,
};
