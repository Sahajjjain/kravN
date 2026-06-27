const express = require('express');
const router = express.Router();

const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { searchMovies } = require('../config/movieApi');

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

router.get('/register', async (req, res) => {
  const posters = await getBackgroundPosters();
  res.render('register', { error: null, posters });
});

router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  try {
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

module.exports = router;
