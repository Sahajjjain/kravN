const express = require('express');
const router = express.Router();

const pool = require('../config/db');
const requireLogin = require('../middleware/authMiddleware');
const { listPosts } = require('../lib/posts');
const { genreList } = require('../lib/format');

// true  = anyone can see which discussions a user has liked (Likes tab on every profile)
// false = only the owner sees the Likes tab on their own dashboard
const SHOW_LIKES_PUBLIC = true;

// Dashboard (your own) and public profiles are the same page — one query, one view
async function renderProfile(req, res, user, isOwn) {
  const showLikes = SHOW_LIKES_PUBLIC || isOwn;

  const [{ posts }, likedResult, [recentComments]] = await Promise.all([
    listPosts({
      userId: req.session.userId, where: 'posts.user_id = ?', params: [user.id], limit: 500,
    }),
    // discussions this profile's user has liked (same row shape as `posts`;
    // liked_by_me still reflects the person viewing the page)
    showLikes
      ? listPosts({
          userId: req.session.userId,
          where: 'posts.id IN (SELECT likes.post_id FROM likes WHERE likes.user_id = ?)',
          params: [user.id],
          limit: 100,
        })
      : Promise.resolve(null),
    pool.query(
      `SELECT comments.id, comments.content, comments.created_at,
              posts.id AS post_id, posts.title AS post_title, posts.movie_name
       FROM comments JOIN posts ON comments.post_id = posts.id
       WHERE comments.user_id = ?
       ORDER BY comments.created_at DESC, comments.id DESC
       LIMIT 30`,
      [user.id]
    ),
  ]);

  const genreCounts = {};
  posts.forEach((p) => genreList(p).forEach((g) => { genreCounts[g] = (genreCounts[g] || 0) + 1; }));

  res.render('profile', {
    nav: isOwn ? 'dashboard' : '',
    profileUser: user,
    isOwn,
    posts,
    likedPosts: likedResult ? likedResult.posts : undefined, // undefined hides the Likes tab
    recentComments,
    stats: {
      discussions: posts.length,
      likes: posts.reduce((n, p) => n + Number(p.like_count), 0),
      comments: posts.reduce((n, p) => n + Number(p.comment_count), 0),
      movies: new Set(posts.map((p) => p.imdb_id || String(p.movie_name).toLowerCase())).size,
    },
    topGenres: Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g),
  });
}

router.get('/dashboard', requireLogin, async (req, res) => {
  const [rows] = await pool.query('SELECT id, username, created_at FROM users WHERE id = ?', [req.session.userId]);
  if (!rows.length) return res.redirect('/logout');
  await renderProfile(req, res, rows[0], true);
});

router.get('/profile', requireLogin, (req, res) => res.redirect('/dashboard'));

router.get('/users/:username', async (req, res) => {
  const [rows] = await pool.query('SELECT id, username, created_at FROM users WHERE username = ?', [req.params.username]);
  if (!rows.length) return res.status(404).render('error', { code: 404, message: 'No one by that name here.' });
  await renderProfile(req, res, rows[0], rows[0].id === req.session.userId);
});

const NOTIFS_PER_PAGE = 30;

router.get('/notifications', requireLogin, async (req, res) => {
  const userId = req.session.userId;
  const page = Math.min(50, Math.max(1, parseInt(req.query.page, 10) || 1));

  // one extra row tells us whether an "older" page exists
  const [rows] = await pool.query(
    `SELECT notifications.*,
       actor.username AS actor_username,
       posts.title AS post_title,
       posts.movie_name,
       posts.poster_url,
       COALESCE(
         cm.content,
         (SELECT c.content FROM comments c
           WHERE c.post_id = notifications.post_id AND c.user_id = notifications.actor_id
           ORDER BY c.id DESC LIMIT 1)
       ) AS comment_content
     FROM notifications
     LEFT JOIN users AS actor ON notifications.actor_id = actor.id
     LEFT JOIN posts ON notifications.post_id = posts.id
     LEFT JOIN comments AS cm ON cm.id = notifications.comment_id
     WHERE notifications.user_id = ?
     ORDER BY notifications.created_at DESC
     LIMIT ? OFFSET ?`,
    [userId, NOTIFS_PER_PAGE + 1, (page - 1) * NOTIFS_PER_PAGE]
  );
  const hasMore = rows.length > NOTIFS_PER_PAGE;
  const notifications = rows.slice(0, NOTIFS_PER_PAGE);

  await pool.query('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [userId]);
  res.render('notifications', { nav: 'notifications', notifications, unreadBefore: res.locals.unread, page, hasMore });
});

module.exports = router;