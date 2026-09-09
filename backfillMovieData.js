// backfillMovieData.js
//
// One-off script to fix old posts that are missing release_date
// (and possibly poster_url / imdb_rating / genre) because they were
// created before that data was being fetched and stored.
//
// Usage:
//   node backfillMovieData.js
//
// Run this once from your project root (same place you'd run `node app.js`),
// since it reuses your existing db pool and movieApi config.

const pool = require('./config/db');
const { getMovieInfo } = require('./config/movieApi');

async function backfill() {
  // Grab every post that's missing release_date (the symptom you're seeing).
  // Widen this WHERE clause if poster_url/imdb_rating/genre are also missing
  // on old rows and you want those fixed too.
  const [posts] = await pool.query(
    `SELECT id, movie_name, poster_url, imdb_rating, genre, release_date
     FROM posts
     WHERE release_date IS NULL OR release_date = ''`
  );

  console.log(`Found ${posts.length} post(s) missing release_date.`);

  let updated = 0;
  let skipped = 0;

  for (const post of posts) {
    try {
      const movieInfo = await getMovieInfo(post.movie_name);

      if (!movieInfo || !movieInfo.releaseDate) {
        console.warn(`  [skip] "${post.movie_name}" (post #${post.id}) — no data returned`);
        skipped++;
        continue;
      }

      await pool.query(
        `UPDATE posts
         SET poster_url = COALESCE(?, poster_url),
             imdb_rating = COALESCE(?, imdb_rating),
             genre = COALESCE(?, genre),
             release_date = ?
         WHERE id = ?`,
        [
          movieInfo.poster || null,
          movieInfo.rating || null,
          movieInfo.genre || null,
          movieInfo.releaseDate,
          post.id
        ]
      );

      console.log(`  [ok] "${post.movie_name}" (post #${post.id}) -> ${movieInfo.releaseDate}`);
      updated++;

      // Be polite to the movie API — small delay between calls to avoid rate limits.
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`  [error] post #${post.id} (${post.movie_name}): ${err.message}`);
      skipped++;
    }
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);
  process.exit(0);
}

backfill().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});