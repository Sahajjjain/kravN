// backfillGenres.js
// One-time script: fills the `genre` column for posts created before
// genre support existed. Safe to run multiple times — it only
// updates posts where genre IS NULL.
//
// Run locally with:   node backfillGenres.js
// Needs your .env (DB creds + OMDB_API_KEY) in the same folder.

require('dotenv').config();
const pool = require('./config/db'); // adjust path if your db config lives elsewhere

async function getGenre(movieName) {
  const apiKey = process.env.OMDB_API_KEY;
  const url = `http://www.omdbapi.com/?apikey=${apiKey}&t=${encodeURIComponent(movieName)}`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    if (data.Response === 'False') return null;
    return data.Genre || null;
  } catch (err) {
    console.error(`OMDb fetch failed for "${movieName}":`, err.message);
    return null;
  }
}

async function run() {
  console.log('Starting genre backfill...');

  const [posts] = await pool.query(
    'SELECT id, movie_name FROM posts WHERE genre IS NULL'
  );

  console.log(`Found ${posts.length} posts missing genre.`);

  let updated = 0;
  let skipped = 0;

  for (const post of posts) {
    const genre = await getGenre(post.movie_name);

    if (genre) {
      await pool.query('UPDATE posts SET genre = ? WHERE id = ?', [genre, post.id]);
      console.log(`✓ [${post.id}] ${post.movie_name} -> ${genre}`);
      updated++;
    } else {
      console.log(`✗ [${post.id}] ${post.movie_name} -> no genre found, skipped`);
      skipped++;
    }

    // Small delay so we don't hammer OMDb's free tier rate limit.
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);
  process.exit(0);
}

run().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});