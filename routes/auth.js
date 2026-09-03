const express = require('express');
const router = express.Router();

const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { searchMovies, getMovieInfo } = require('../config/movieApi');

// A small pool of acclaimed/recognizable titles to seed background poster art.
const POSTER_SEED_TERMS = ['inception', 'interstellar', 'dark knight', 'parasite', 'oldboy', 'whiplash', 'her', 'arrival'];

async function getBackgroundPosters() {
  try {
    const randomTerm = POSTER_SEED_TERMS[Math.floor(Math.random() * POSTER_SEED_TERMS.length)];
    const results = await searchMovies(randomTerm);
    return results
      .map(m => m.poster)
      .filter(p => p && p !== 'N/A')
      .slice(0, 8);
  } catch (err) {
    console.error('Poster fetch failed:', err);
    return [];
  }
}

// ---------- REGISTER ----------

// ---------- REGISTER ----------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/register', async (req, res) => {
  const posters = await getBackgroundPosters();
  res.render('register', { error: null, posters });
});

router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  try {
    if (!username || !email || !password) {
      const posters = await getBackgroundPosters();
      return res.render('register', { error: 'All fields are required.', posters });
    }

    if (!EMAIL_REGEX.test(email)) {
      const posters = await getBackgroundPosters();
      return res.render('register', { error: 'Please enter a valid email address.', posters });
    }

    const [existingUsername] = await pool.query(
      'SELECT id FROM users WHERE username = ?',
      [username]
    );

    if (existingUsername.length > 0) {
      const posters = await getBackgroundPosters();
      return res.render('register', { error: 'Username is already taken.', posters });
    }

    const [existingEmail] = await pool.query(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingEmail.length > 0) {
      const posters = await getBackgroundPosters();
      return res.render('register', { error: 'An account with that email already exists.', posters });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
      [username, email, hashedPassword]
    );

    res.redirect('/login');
  } catch (err) {
    console.error(err);
    const posters = await getBackgroundPosters();
    res.render('register', { error: 'Something went wrong. Try a different username or email.', posters });
  }
});
// ---------- LOGIN ----------

router.get('/login', async (req, res) => {
  const posters = await getBackgroundPosters();
  res.render('login', { error: null, posters });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);

    if (rows.length === 0) {
      const posters = await getBackgroundPosters();
      return res.render('login', { error: 'No account with that email.', posters });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      const posters = await getBackgroundPosters();
      return res.render('login', { error: 'Incorrect password.', posters });
    }
    
    req.session.userId = user.id;
    req.session.username = user.username;

    res.redirect('/feed');
  } catch (err) {
    console.error(err);
    const posters = await getBackgroundPosters();
    res.render('login', { error: 'Something went wrong. Please try again.', posters });
  }
});

// ---------- LOGOUT ----------

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// ---------- ABOUT ----------

const FAVORITE_MOVIES = [
  'Interstellar', 'Avengers: Endgame', 'Spider-Man: No Way Home',
  'Spider-Man: Into the Spider-Verse', 'Your Name',
  'Fight Club', 'The Shawshank Redemption', 'Dead Poets Society',
  'Inception', 'The Dark Knight', 'Avengers: Infinity War',
  'Spider-Man 2', 'Spider-Man: Across the Spider-Verse',
  'Good Will Hunting', 'Forrest Gump', 'The Prestige',
  'The Truman Show', 'Eternal Sunshine of the Spotless Mind',
  'The Matrix', 'Oppenheimer', 'The Green Mile', 'Whiplash',
  'Dune: Part Two', 'Dune', 'Everything Everywhere All at Once',
  'Weathering with You', 'A Silent Voice', 'Suzume',
  'The Lord of the Rings: The Return of the King', 'Gladiator',
  'The Godfather', '12 Angry Men', 'The Pursuit of Happyness',
  'The Social Network', 'Parasite', 'The Wolf of Wall Street',
  'The Departed'
];

let favoritePostersCache = null;

async function getFavoritePosters() {
  if (favoritePostersCache) return favoritePostersCache;

  try {
    const results = await Promise.all(FAVORITE_MOVIES.map(title => getMovieInfo(title)));
    favoritePostersCache = results
      .filter(m => m && m.poster && m.poster !== 'N/A')
      .map(m => m.poster);
    return favoritePostersCache;
  } catch (err) {
    console.error('Favorite posters fetch failed:', err);
    return [];
  }
}

router.get('/about', async (req, res) => {
  const posters = await getFavoritePosters();

  res.render('about', { posters });
});

module.exports = router;

