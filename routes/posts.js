const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const requireLogin = require('../middleware/authMiddleware');
const { getMovieInfo, searchMovies } = require('../config/movieApi');
// Show the "create post" form
router.get('/posts/new', requireLogin, (req, res) => {
  const prefilledMovie = req.query.movie || '';
  res.render('createPost', { prefilledMovie });
});

// Handle new post submission
// router.post('/posts', requireLogin, async (req, res) => {
//   const { movie_name, title, content } = req.body;
//   const userId = req.session.userId;

//   try {
//     await pool.query(
//       'INSERT INTO posts (user_id, movie_name, title, content) VALUES (?, ?, ?, ?)',
//       [userId, movie_name, title, content]
//     );
//     res.redirect('/feed');
//   } catch (err) {
//     console.error(err);
//     res.send('Something went wrong: ' + err.message);
//   }
// });
router.post('/posts', requireLogin, async (req, res) => {
  const { movie_name, title, content } = req.body;
  const userId = req.session.userId;

  try {
    const movieInfo = await getMovieInfo(movie_name);

    await pool.query(
      'INSERT INTO posts (user_id, movie_name, title, content, poster_url, imdb_rating) VALUES (?, ?, ?, ?, ?, ?)',
      [
        userId,
        movie_name,
        title,
        content,
        movieInfo ? movieInfo.poster : null,
        movieInfo ? movieInfo.rating : null
      ]
    );
    res.redirect('/feed');
  } catch (err) {
    console.error(err);
    res.send('Something went wrong: ' + err.message);
  }
});

router.get('/search', requireLogin, async (req, res) => {
  const query = req.query.q || '';

  try {
    const [posts] = await pool.query(
      `SELECT posts.*, users.username 
       FROM posts JOIN users ON posts.user_id = users.id 
       WHERE posts.movie_name LIKE ? OR posts.title LIKE ?
       ORDER BY posts.created_at DESC`,
      [`%${query}%`, `%${query}%`]
    );
    res.render('searchResults', { posts, query });
  } catch (err) {
    console.error(err);
    res.send('Something went wrong: ' + err.message);
  }
});
router.get('/api/movie-search', requireLogin, async (req, res) => {
  const query = req.query.q || '';

  if (query.length < 2) {
    return res.json([]);
  }

  try {
    const results = await searchMovies(query);
    res.json(results);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});
router.get('/api/movie-check', requireLogin, async (req, res) => {
  const movieName = req.query.title || '';

  try {
    const [rows] = await pool.query(
      'SELECT COUNT(*) AS count FROM posts WHERE movie_name = ?',
      [movieName]
    );
    res.json({ exists: rows[0].count > 0 });
  } catch (err) {
    console.error(err);
    res.json({ exists: false });
  }
});

router.get('/dashboard', requireLogin, async (req, res) => {
  const userId = req.session.userId;

  try {
    const [posts] = await pool.query(
      `SELECT posts.*, 
        (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) AS like_count,
        (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) AS comment_count
       FROM posts
       WHERE posts.user_id = ?
       ORDER BY posts.created_at DESC`,
      [userId]
    );

    res.render('dashboard', { posts, username: req.session.username });
  } catch (err) {
    console.error(err);
    res.send('Something went wrong: ' + err.message);
  }
});

router.get('/posts/:id', requireLogin, async (req, res) => {
  const postId = req.params.id;

  try {
    const [postRows] = await pool.query(
      `SELECT posts.*, users.username 
       FROM posts JOIN users ON posts.user_id = users.id 
       WHERE posts.id = ?`,
      [postId]
    );

    if (postRows.length === 0) {
      return res.send('Post not found.');
    }

    const [comments] = await pool.query(
      `SELECT comments.*, users.username 
       FROM comments JOIN users ON comments.user_id = users.id 
       WHERE comments.post_id = ? 
       ORDER BY comments.created_at ASC`,
      [postId]
    );

    const [likeCountRows] = await pool.query(
      'SELECT COUNT(*) AS count FROM likes WHERE post_id = ?',
      [postId]
    );

    res.render('postDetail', {
  post: postRows[0],
  comments,
  likeCount: likeCountRows[0].count,
  currentUserId: req.session.userId
});
  } catch (err) {
    console.error(err);
    res.send('Something went wrong: ' + err.message);
  }
});

router.post('/posts/:id/comments', requireLogin, async (req, res) => {
  const postId = req.params.id;
  const { content } = req.body;
  const userId = req.session.userId;

  try {
    await pool.query(
      'INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)',
      [postId, userId, content]
    );
    res.redirect(`/posts/${postId}`);
  } catch (err) {
    console.error(err);
    res.send('Something went wrong: ' + err.message);
  }
});

router.post('/posts/:id/like', requireLogin, async (req, res) => {
  const postId = req.params.id;
  const userId = req.session.userId;

  try {
    await pool.query(
      'INSERT INTO likes (post_id, user_id) VALUES (?, ?)',
      [postId, userId]
    );
    res.redirect(`/posts/${postId}`);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.redirect(`/posts/${postId}`); // already liked, just ignore
    }
    console.error(err);
    res.send('Something went wrong: ' + err.message);
  }
});

router.post('/posts/:id/delete', requireLogin, async (req, res) => {
  const postId = req.params.id;
  const userId = req.session.userId;

  try {
    const [rows] = await pool.query('SELECT user_id FROM posts WHERE id = ?', [postId]);

    if (rows.length === 0) {
      return res.send('Post not found.');
    }

    if (rows[0].user_id !== userId) {
      return res.status(403).send('You can only delete your own posts.');
    }

    await pool.query('DELETE FROM posts WHERE id = ?', [postId]);
    res.redirect('/feed');
  } catch (err) {
    console.error(err);
    res.send('Something went wrong: ' + err.message);
  }
});

module.exports = router;