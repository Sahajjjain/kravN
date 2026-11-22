/* View helpers — registered on app.locals so every template can use them. */

const TZ = 'Asia/Kolkata';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(d, withTime = false) {
  const date = new Date(d);
  if (isNaN(date)) return '';
  return date.toLocaleString('en-IN', { dateStyle: 'medium', ...(withTime ? { timeStyle: 'short' } : {}), timeZone: TZ });
}

function timeAgo(d) {
  const date = new Date(d);
  if (isNaN(date)) return '';
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return fmtDate(date);
}

// "2024-05-30" -> "30 May 2024"
function longDate(iso) {
  const [y, m, d] = String(iso || '').split('-');
  return y && m && d ? `${parseInt(d, 10)} ${MONTHS[parseInt(m, 10) - 1]} ${y}` : y || '';
}

function money(n) {
  if (!n) return '';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2).replace(/\.?0+$/, '')}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  return `$${n.toLocaleString('en-US')}`;
}

function runtime(mins) {
  if (!mins) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

// Safe to drop inside <script> tags and HTML attributes
function json(value) {
  return JSON.stringify(value === undefined ? null : value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16));
}

/* Old posts may hold the string "N/A" from OMDb — treat it as empty everywhere */
const clean = (v) => (v && v !== 'N/A' ? v : null);
const posterOf = (post) => clean(post.poster_url);
const ratingOf = (post) => {
  const r = clean(post.imdb_rating);
  return r && !isNaN(parseFloat(r)) ? parseFloat(r).toFixed(1) : null;
};

// Old posts used OMDb genre names, new ones use TMDB's — show one consistent name
const GENRE_NAMES = { 'Sci-Fi': 'Science Fiction', Biography: 'History', Musical: 'Music', Sport: 'Sports' };
const genreList = (post) => [
  ...new Set(
    String(post.genre || '').split(',').map((g) => g.trim()).filter(Boolean).map((g) => GENRE_NAMES[g] || g)
  ),
];

// Stable hue (0-359) per username so every avatar keeps its own colour
const hue = (name) => [...String(name || '?')].reduce((a, c) => a + c.charCodeAt(0) * 37, 0) % 360;

// What the client-side Kravn Cards / share sheet need for one post
function cardData(post) {
  return {
    id: post.id,
    movieName: post.movie_name || '',
    title: post.title || '',
    username: post.username || '',
    rating: ratingOf(post),
    posterUrl: posterOf(post),
    createdAt: post.created_at,
    likes: Number(post.like_count) || 0,
    liked: !!Number(post.liked_by_me),
  };
}

// Link to the movie page of a stored post (resolved lazily through TMDB)
function movieLink(post) {
  const q = new URLSearchParams();
  if (post.imdb_id) q.set('imdb', post.imdb_id);
  q.set('title', post.movie_name || '');
  const y = String(post.release_date || '').match(/(?:19|20)\d{2}/);
  if (y) q.set('year', y[0]);
  return `/movie/find?${q.toString()}`;
}

module.exports = { fmtDate, timeAgo, longDate, money, runtime, json, clean, posterOf, ratingOf, genreList, hue, cardData, movieLink };
