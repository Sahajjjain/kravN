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

    const [likers] = await pool.query(
      `SELECT users.id, users.username
       FROM likes JOIN users ON likes.user_id = users.id
       WHERE likes.post_id = ?
       ORDER BY likes.id DESC`,
      [postId]
    );

    res.render('postDetail', {
      post: postRows[0],
      comments,
      likeCount: likers.length,
      likers,
      currentUserId: req.session.userId
    });
  } catch (err) {
    console.error(err);
    res.send('Something went wrong: ' + err.message);
  }
});

router.get('/users/:username', requireLogin, async (req, res) => {
  const { username } = req.params;

  try {
    const [userRows] = await pool.query(
      'SELECT id, username, created_at FROM users WHERE username = ?',
      [username]
    );

    if (userRows.length === 0) {
      return res.send('User not found.');
    }

    const user = userRows[0];

    const [posts] = await pool.query(
      `SELECT posts.*,
        (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) AS like_count,
        (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) AS comment_count
       FROM posts
       WHERE posts.user_id = ?
       ORDER BY posts.created_at DESC`,
      [user.id]
    );

    res.render('userProfile', {
      profileUser: user,
      posts,
      isOwnProfile: req.session.userId === user.id
    });
  } catch (err) {
    console.error(err);
    res.send('Something went wrong: ' + err.message);
  }
});
router.get('/posts/:id/likes', requireLogin, async (req, res) => {
  const postId = req.params.id;

  try {
    const [postRows] = await pool.query(
      'SELECT posts.*, users.username FROM posts JOIN users ON posts.user_id = users.id WHERE posts.id = ?',
      [postId]
    );

    if (postRows.length === 0) return res.send('Post not found.');

    const [likers] = await pool.query(
      `SELECT users.id, users.username, users.created_at
       FROM likes JOIN users ON likes.user_id = users.id
       WHERE likes.post_id = ?
       ORDER BY likes.id DESC`,
      [postId]
    );

    res.render('likesPage', { post: postRows[0], likers });
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

    // Get post owner
    const [postRows] = await pool.query('SELECT user_id FROM posts WHERE id = ?', [postId]);

    // Only notify if someone else commented
    if (postRows.length > 0 && postRows[0].user_id !== userId) {
      await pool.query(
        'INSERT INTO notifications (user_id, actor_id, post_id, type) VALUES (?, ?, ?, ?)',
        [postRows[0].user_id, userId, postId, 'comment']
      );
    }

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

    // Get post owner
    const [postRows] = await pool.query('SELECT user_id FROM posts WHERE id = ?', [postId]);

    // Only notify if someone else liked it (not the post author liking their own post)
    if (postRows.length > 0 && postRows[0].user_id !== userId) {
      await pool.query(
        'INSERT INTO notifications (user_id, actor_id, post_id, type) VALUES (?, ?, ?, ?)',
        [postRows[0].user_id, userId, postId, 'like']
      );
    }

    res.redirect(`/posts/${postId}`);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.redirect(`/posts/${postId}`);
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
// Delete a comment
router.post('/comments/:id/delete', requireLogin, async (req, res) => {
  const commentId = req.params.id;
  const userId = req.session.userId;

  try {
    const [rows] = await pool.query('SELECT * FROM comments WHERE id = ?', [commentId]);

    if (rows.length === 0) return res.send('Comment not found.');
    if (rows[0].user_id !== userId) return res.status(403).send('Not your comment.');

    const postId = rows[0].post_id;
    await pool.query('DELETE FROM comments WHERE id = ?', [commentId]);
    res.redirect(`/posts/${postId}`);
  } catch (err) {
    console.error(err);
    res.send('Something went wrong: ' + err.message);
  }
});

// Show edit comment form
router.get('/comments/:id/edit', requireLogin, async (req, res) => {
  const commentId = req.params.id;
  const userId = req.session.userId;

  try {
    const [rows] = await pool.query(
      'SELECT comments.*, posts.movie_name, posts.title AS post_title FROM comments JOIN posts ON comments.post_id = posts.id WHERE comments.id = ?',
      [commentId]
    );

    if (rows.length === 0) return res.send('Comment not found.');
    if (rows[0].user_id !== userId) return res.status(403).send('Not your comment.');

    res.render('editComment', { comment: rows[0] });
  } catch (err) {
    console.error(err);
    res.send('Something went wrong: ' + err.message);
  }
});

// Handle edit comment submission
router.post('/comments/:id/edit', requireLogin, async (req, res) => {
  const commentId = req.params.id;
  const userId = req.session.userId;
  const { content } = req.body;

  try {
    const [rows] = await pool.query('SELECT * FROM comments WHERE id = ?', [commentId]);

    if (rows.length === 0) return res.send('Comment not found.');
    if (rows[0].user_id !== userId) return res.status(403).send('Not your comment.');

    await pool.query('UPDATE comments SET content = ? WHERE id = ?', [content, commentId]);
    res.redirect(`/posts/${rows[0].post_id}`);
  } catch (err) {
    console.error(err);
    res.send('Something went wrong: ' + err.message);
  }
});
router.get('/notifications', requireLogin, async (req, res) => {
  const userId = req.session.userId;

  try {
    const [notifications] = await pool.query(
      `SELECT notifications.*, 
        actor.username AS actor_username,
        posts.title AS post_title,
        posts.movie_name
       FROM notifications
       JOIN users AS actor ON notifications.actor_id = actor.id
       JOIN posts ON notifications.post_id = posts.id
       WHERE notifications.user_id = ?
       ORDER BY notifications.created_at DESC
       LIMIT 50`,
      [userId]
    );

    // Mark all as read
    await pool.query(
      'UPDATE notifications SET is_read = 1 WHERE user_id = ?',
      [userId]
    );

    res.render('notifications', { notifications });
  } catch (err) {
    console.error(err);
    res.send('Something went wrong: ' + err.message);
  }
});
module.exports = router;