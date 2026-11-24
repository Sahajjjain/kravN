const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();

const pool = require('../config/db');
const tmdb = require('../config/tmdb');
const { safePath } = require('../lib/util');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Poster wall behind the landing and auth pages (trending films, shuffled)
async function backgroundPosters() {
  const { results } = await tmdb.trending(1);
  return results.map((m) => m.poster).filter(Boolean).sort(() => Math.random() - 0.5).slice(0, 18);
}

async function renderAuth(res, mode, error = null, status = 200) {
  res.status(status).render('auth', { mode, error, posters: await backgroundPosters() });
}

/* ---------------------------------- home --------------------------------- */

// The site opens straight onto the home page — browsing never needs an account
router.get('/', (req, res) => res.redirect('/feed'));

// "?next=/movie/123" brings people back to where they were after logging in or signing up
router.use(['/login', '/register'], (req, res, next) => {
  const next_ = safePath(req.query.next);
  if (req.method === 'GET' && next_) req.session.returnTo = next_;
  next();
});

/* -------------------------------- register -------------------------------- */

router.get('/register', (req, res) => renderAuth(res, 'register'));

router.post('/register', async (req, res) => {
  const { username, email, password } = req.body || {};

  try {
    if (!username || !email || !password) return renderAuth(res, 'register', 'All fields are required.');
    if (!EMAIL_REGEX.test(email)) return renderAuth(res, 'register', 'Please enter a valid email address.');

    const [sameName] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    if (sameName.length > 0) return renderAuth(res, 'register', 'Username is already taken.');

    const [sameEmail] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (sameEmail.length > 0) return renderAuth(res, 'register', 'An account with that email already exists.');

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', [username, email, hashedPassword]);

    res.redirect('/login');
  } catch (err) {
    console.error(err);
    renderAuth(res, 'register', 'Something went wrong. Try a different username or email.');
  }
});

/* ---------------------------------- login --------------------------------- */

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/feed');
  renderAuth(res, 'login');
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};

  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) return renderAuth(res, 'login', 'No account with that email.');

    const user = rows[0];
    const match = await bcrypt.compare(password || '', user.password);
    if (!match) return renderAuth(res, 'login', 'Incorrect password.');

    const returnTo = safePath(req.session.returnTo);
    req.session.userId = user.id;
    req.session.username = user.username;
    delete req.session.returnTo;

    res.redirect(returnTo || '/feed');
  } catch (err) {
    console.error(err);
    renderAuth(res, 'login', 'Something went wrong. Please try again.');
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

/* ---------------------------------- about --------------------------------- */

const FAVORITE_MOVIES = [
  'Interstellar', 'Avengers: Endgame', 'Spider-Man: No Way Home', 'Spider-Man: Into the Spider-Verse',
  'Your Name.', 'Fight Club', 'The Shawshank Redemption', 'Dead Poets Society', 'Inception', 'The Dark Knight',
  'Avengers: Infinity War', 'Spider-Man 2', 'Spider-Man: Across the Spider-Verse', 'Good Will Hunting',
  'Forrest Gump', 'The Prestige', 'The Truman Show', 'Eternal Sunshine of the Spotless Mind', 'The Matrix',
  'Oppenheimer', 'The Green Mile', 'Whiplash', 'Dune: Part Two', 'Dune', 'Everything Everywhere All at Once',
  'Weathering with You', 'A Silent Voice', 'Suzume', 'The Lord of the Rings: The Return of the King',
  'Gladiator', 'The Godfather', '12 Angry Men', 'The Pursuit of Happyness', 'The Social Network', 'Parasite',
  'The Wolf of Wall Street', 'The Departed',
];

let favoritePosters = null;

async function getFavoritePosters() {
  if (favoritePosters) return favoritePosters;
  const found = await Promise.all(
    FAVORITE_MOVIES.map(async (title) => {
      const { results } = await tmdb.searchMovies(title);
      const want = tmdb.normalize(title);
      const films = results.filter((m) => m.type === 'movie');
      const hit = films.find((m) => tmdb.normalize(m.title) === want && m.poster) || films.find((m) => m.poster);
      return hit ? { id: hit.id, url: hit.url, title: hit.title, poster: hit.poster } : null;
    })
  );
  const list = found.filter(Boolean);
  if (list.length > 10) favoritePosters = list; // only cache a healthy result
  return list;
}

router.get('/about', async (req, res) => {
  res.render('about', { nav: 'about', favorites: await getFavoritePosters() });
});

module.exports = router;
