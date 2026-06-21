const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

// Tell Express to use EJS for rendering pages
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Tell Express where static files (css, js, images) live
app.use(express.static(path.join(__dirname, 'public')));

// A route: when someone visits "/", render the home page
app.get('/', (req, res) => {
  res.render('home');
});
app.get('/about', (req, res) => {
  res.render('about');
});

app.listen(PORT, () => {
  console.log(`KravN running on http://localhost:${PORT}`);
});

const pool = require('./config/db');

pool.query('SELECT 1 + 1 AS result')
  .then(([rows]) => console.log('DB connected. Test query result:', rows[0].result))
  .catch(err => console.error('DB connection failed:', err));

  app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const session = require('express-session');

app.use(session({
  secret: process.env.SESSION_SECRET || 'kravn_secret_change_this_later',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    httpOnly: true,
    sameSite: 'lax'
  }
}));

const authRoutes = require('./routes/auth');
app.use('/', authRoutes);

const feedRoutes = require('./routes/feed');
app.use('/', feedRoutes);

const postRoutes = require('./routes/posts');
app.use('/', postRoutes);