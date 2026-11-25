const express = require('express');
const router = express.Router();

const pool = require('../config/db');
const requireLogin = require('../middleware/authMiddleware');
const tmdb = require('../config/tmdb');
const { getPost, listPosts, createDiscussion, notify, clip } = require('../lib/posts');
const { withTimeout } = require('../lib/util');
const { posterOf } = require('../lib/format');

const notFound = (res, message = 'That page could not be found.') =>
  res.status(404).render('error', { code: 404, message });

const isAjax = (req) => req.get('x-requested-with') === 'fetch';

// Notification that also remembers which comment caused it (comments and replies)
async function notifyComment(toUserId, actorId, postId, type, commentId) {
  if (Number(toUserId) === Number(actorId)) return;
  await pool.query(
    'INSERT INTO notifications (user_id, actor_id, post_id, type, comment_id) VALUES (?, ?, ?, ?, ?)',
    [toUserId, actorId, postId, type, commentId]
  );
}

// Numeric ids only — anything else is a plain 404
router.param('id', (req, res, next, id) => (/^\d+$/.test(id) ? next() : notFound(res)));

/* --------------------------------- create ---------------------------------- */

// Step 1 of posting: pick the movie or series. The discussion itself is written on the movie page.
router.get('/posts/new', requireLogin, (req, res) => {
  res.render('createPost', { nav: 'new', prefill: String(req.query.movie || '').slice(0, 100) });
});

// Kept so older forms/bookmarks still work: resolves the movie, saves the post, lands on the movie page
router.post('/posts', requireLogin, async (req, res) => {
  const { movie_name, title, content, imdb_id } = req.body || {};
  if (!clip(movie_name, 1) || !clip(title, 1) || !clip(content, 1)) return res.redirect('/posts/new');

  const hit = await tmdb.resolveTitle({ imdbId: imdb_id, title: movie_name });
  const movie = hit ? await tmdb.getTitle(hit.type, hit.id) : null;
  const fields = movie ? tmdb.postFields(movie) : { movie_name: clip(movie_name, 200) };

  const postId = await createDiscussion(req.session.userId, { title, content }, fields);
  res.redirect(movie ? `${movie.url}?posted=${postId}#d-${postId}` : `/posts/${postId}`);
});

/* ------------------------------ discussion page ---------------------------- */

router.get('/posts/:id', async (req, res) => {
  const userId = req.session.userId;
  const post = await getPost(req.params.id, userId);
  if (!post) return notFound(res, 'That discussion could not be found.');

  const yearMatch = String(post.release_date || '').match(/(?:19|20)\d{2}/);
  const sameMovie = post.imdb_id ? ['posts.imdb_id = ?', post.imdb_id] : ['posts.movie_name = ?', post.movie_name];

  const [[comments], [likers], more, movie] = await Promise.all([
    pool.query(
      `SELECT comments.*, users.username FROM comments JOIN users ON comments.user_id = users.id
       WHERE comments.post_id = ? ORDER BY comments.created_at ASC, comments.id ASC`,
      [post.id]
    ),
    pool.query(
      `SELECT users.id, users.username FROM likes JOIN users ON likes.user_id = users.id
       WHERE likes.post_id = ? ORDER BY likes.id DESC LIMIT 8`,
      [post.id]
    ),
    listPosts({ userId, where: `${sameMovie[0]} AND posts.id <> ?`, params: [sameMovie[1], post.id], limit: 4 }),
    // Richer header (backdrop etc.) from TMDB — optional, never blocks the page for long
    withTimeout(
      tmdb.resolveTitle({ imdbId: post.imdb_id, title: post.movie_name, year: yearMatch && yearMatch[0] })
        .then((hit) => (hit ? tmdb.getTitle(hit.type, hit.id) : null)),
      2500
    ),
  ]);

  // group replies under their parent comment (one level deep); orphans fall back to top level
  const byId = new Map(comments.map((c) => [c.id, Object.assign(c, { replies: [] })]));
  const threads = [];
  comments.forEach((c) => {
    const parent = c.parent_id ? byId.get(c.parent_id) : null;
    if (parent) parent.replies.push(c); else threads.push(c);
  });

  res.render('post', { nav: 'discussions', post, comments, threads, likers, more: more.posts, movie });
});

router.get('/posts/:id/likes', async (req, res) => {
  const post = await getPost(req.params.id, req.session.userId);
  if (!post) return notFound(res, 'That discussion could not be found.');

  const [likers] = await pool.query(
    `SELECT users.id, users.username, users.created_at FROM likes JOIN users ON likes.user_id = users.id
     WHERE likes.post_id = ? ORDER BY likes.id DESC`,
    [post.id]
  );
  res.render('likes', { nav: 'discussions', post, likers });
});

/* ------------------------------- like / unlike ------------------------------ */

// action = like (idempotent, used by double-tap) | unlike | toggle (default, used by the heart button)
router.post('/posts/:id/like', requireLogin, async (req, res) => {
  const postId = Number(req.params.id);
  const userId = req.session.userId;
  const action = (req.body && req.body.action) || req.query.action || 'toggle';

  const [owner] = await pool.query('SELECT user_id FROM posts WHERE id = ?', [postId]);
  if (!owner.length) return isAjax(req) ? res.status(404).json({ error: 'Not found' }) : notFound(res);

  const [existing] = await pool.query('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ? LIMIT 1', [postId, userId]);
  const hasLiked = existing.length > 0;
  const shouldLike = action === 'like' ? true : action === 'unlike' ? false : !hasLiked;

  if (shouldLike && !hasLiked) {
    try {
      await pool.query('INSERT INTO likes (post_id, user_id) VALUES (?, ?)', [postId, userId]);
      await notify(owner[0].user_id, userId, postId, 'like');
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
    }
  } else if (!shouldLike && hasLiked) {
    await pool.query('DELETE FROM likes WHERE post_id = ? AND user_id = ?', [postId, userId]);
    // take back the "liked your discussion" notification too
    await pool.query(
      "DELETE FROM notifications WHERE type = 'like' AND actor_id = ? AND post_id = ?",
      [userId, postId]
    );
  }

  if (!isAjax(req)) return res.redirect(req.get('referer') || `/posts/${postId}`);

  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM likes WHERE post_id = ?', [postId]);
  res.json({ liked: shouldLike, count: n });
});

/* -------------------------------- comments -------------------------------- */

router.post('/posts/:id/comments', requireLogin, async (req, res) => {
  const postId = Number(req.params.id);
  const userId = req.session.userId;
  const content = clip(req.body && req.body.content, 2000);
  if (!content) return res.redirect(`/posts/${postId}#comments`);

  const [owner] = await pool.query('SELECT user_id FROM posts WHERE id = ?', [postId]);
  if (!owner.length) return notFound(res, 'That discussion could not be found.');

  // replying? the target must be a comment on this same post
  let parentId = null;
  let target = null;
  const replyTo = Number(req.body && req.body.parent_id);
  if (Number.isInteger(replyTo) && replyTo > 0) {
    const [found] = await pool.query('SELECT id, user_id, parent_id FROM comments WHERE id = ? AND post_id = ?', [replyTo, postId]);
    if (found.length) {
      target = found[0];
      parentId = target.parent_id || target.id; // replies to a reply attach to the top-level comment
    }
  }

  const [result] = await pool.query(
    'INSERT INTO comments (post_id, user_id, content, parent_id) VALUES (?, ?, ?, ?)',
    [postId, userId, content, parentId]
  );

  if (target) {
    // the person you replied to
    await notifyComment(target.user_id, userId, postId, 'reply', result.insertId);
    // the post owner still hears about it, unless they are the person already notified
    if (Number(owner[0].user_id) !== Number(target.user_id)) {
      await notifyComment(owner[0].user_id, userId, postId, 'comment', result.insertId);
    }
  } else {
    await notifyComment(owner[0].user_id, userId, postId, 'comment', result.insertId);
  }

  res.redirect(`/posts/${postId}#c-${result.insertId}`);
});

// Loads a comment and checks it belongs to the logged-in user
async function ownComment(req, res) {
  const [rows] = await pool.query(
    `SELECT comments.*, posts.movie_name, posts.title AS post_title
     FROM comments JOIN posts ON comments.post_id = posts.id WHERE comments.id = ?`,
    [req.params.id]
  );
  if (!rows.length) { notFound(res, 'That comment could not be found.'); return null; }
  if (rows[0].user_id !== req.session.userId) { res.status(403).render('error', { code: 403, message: 'That is not your comment.' }); return null; }
  return rows[0];
}

router.get('/comments/:id/edit', requireLogin, async (req, res) => {
  const comment = await ownComment(req, res);
  if (comment) res.render('editComment', { nav: 'discussions', comment });
});

router.post('/comments/:id/edit', requireLogin, async (req, res) => {
  const comment = await ownComment(req, res);
  if (!comment) return;
  const content = clip(req.body && req.body.content, 2000);
  if (content) await pool.query('UPDATE comments SET content = ? WHERE id = ?', [content, comment.id]);
  res.redirect(`/posts/${comment.post_id}#c-${comment.id}`);
});

router.post('/comments/:id/delete', requireLogin, async (req, res) => {
  const comment = await ownComment(req, res);
  if (!comment) return;

  // deleting a top-level comment also removes its replies; deleting a reply removes only itself
  const [doomed] = await pool.query('SELECT id FROM comments WHERE id = ? OR parent_id = ?', [comment.id, comment.id]);
  const ids = doomed.map((r) => r.id);

  // remove the notifications caused by those comments first, so none are left pointing at nothing
  if (ids.length) await pool.query('DELETE FROM notifications WHERE comment_id IN (?)', [ids]);
  await pool.query('DELETE FROM comments WHERE id = ? OR parent_id = ?', [comment.id, comment.id]);

  res.redirect(`/posts/${comment.post_id}#comments`);
});

/* ---------------------------------- delete --------------------------------- */

router.post('/posts/:id/delete', requireLogin, async (req, res) => {
  const [rows] = await pool.query('SELECT user_id FROM posts WHERE id = ?', [req.params.id]);
  if (!rows.length) return notFound(res, 'That discussion could not be found.');
  if (rows[0].user_id !== req.session.userId) {
    return res.status(403).render('error', { code: 403, message: 'You can only delete your own posts.' });
  }
  // clear this discussion's notifications (likes, comments, replies) along with it
  await pool.query('DELETE FROM notifications WHERE post_id = ?', [req.params.id]);
  await pool.query('DELETE FROM posts WHERE id = ?', [req.params.id]);
  res.redirect('/dashboard');
});

module.exports = router;