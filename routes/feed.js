const express = require('express');
const router = express.Router();
const requireLogin = require('../middleware/authMiddleware');
const pool = require('../config/db');

router.get('/feed', requireLogin, async (req, res) => {
  try {
    const [posts] = await pool.query(
      `SELECT posts.*, users.username 
       FROM posts 
       JOIN users ON posts.user_id = users.id 
       ORDER BY posts.created_at DESC`
    );
    res.render('feed', { username: req.session.username, posts });
  } catch (err) {
    console.error(err);
    res.send('Something went wrong: ' + err.message);
  }
});

module.exports = router;