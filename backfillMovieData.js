// backfillMovieData.js
//
// One-off script that fills in movie data for OLD posts:
//   - imdb_id and box_office (new columns, run migration.sql first)
//   - any missing poster / rating / genre / release date / director /
//     actors / runtime / plot
//
// It only FILLS EMPTY FIELDS. Values already stored on a post are kept.
//
// Usage (from the project root, same place you run `node app.js`):
//   node backfillMovieData.js
//
// Safe to re-run: a post is skipped once it has both imdb_id and box_office
// ('' in box_office means "checked, OMDb has no figure"). Posts where OMDb
// returned nothing stay untouched and are retried on the next run.

const pool = require('./config/db');
const { getMovieInfo } = require('./config/movieApi');

const DELAY_MS = 300; // pause between real API lookups to stay under rate limits
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// "07 Nov 2026" / "2026" / "2026-11-07" -> "2026"
function yearFrom(releaseDate) {
  const m = String(releaseDate || '').match(/(?:19|20)\d{2}/);
  return m ? m[0] : null;
}

async function backfill() {
  const [posts] = await pool.query(
    `SELECT id, movie_name, release_date, imdb_id
     FROM posts
     WHERE imdb_id IS NULL OR box_office IS NULL
     ORDER BY id`
  );

  console.log(`Found ${posts.length} post(s) to update.\n`);

  // Many posts share the same movie, so look each one up only once per run.
  const lookups = new Map();
  let updated = 0;
  let skipped = 0;

  for (const post of posts) {
    try {
      const year = yearFrom(post.release_date);
      const key = post.imdb_id || `${String(post.movie_name).trim().toLowerCase()}|${year || ''}`;

      let info = lookups.get(key);
      if (info === undefined) {
        // Exact imdb_id when we have it, otherwise name + year from the post
        info = await getMovieInfo(post.imdb_id || post.movie_name, { year });
        lookups.set(key, info || null);
        await sleep(DELAY_MS);
      }

      if (!info) {
        console.warn(`  [skip] "${post.movie_name}" (post #${post.id}): no data returned`);
        skipped++;
        continue;
      }

      await pool.query(
        `UPDATE posts
         SET imdb_id      = COALESCE(imdb_id, ?),
             poster_url   = COALESCE(NULLIF(NULLIF(poster_url, ''), 'N/A'), ?),
             imdb_rating  = COALESCE(NULLIF(NULLIF(imdb_rating, ''), 'N/A'), ?),
             genre        = COALESCE(NULLIF(genre, ''), ?),
             release_date = COALESCE(NULLIF(release_date, ''), ?),
             director     = COALESCE(NULLIF(director, ''), ?),
             actors       = COALESCE(NULLIF(actors, ''), ?),
             runtime      = COALESCE(NULLIF(runtime, ''), ?),
             plot         = COALESCE(NULLIF(plot, ''), ?),
             box_office   = ?
         WHERE id = ?`,
        [
          info.imdbID || null,
          info.poster || null,
          info.rating || null,
          info.genre || null,
          info.releaseDate || null,
          info.director || null,
          info.actors || null,
          info.runtime || null,
          info.plot || null,
          info.boxOffice || '', // '' = looked up, no box office listed
          post.id,
        ]
      );

      console.log(
        `  [ok] #${post.id} "${post.movie_name}" -> "${info.title}" (${info.year}) ${info.imdbID}` +
          ` | box office: ${info.boxOffice || 'n/a'}`
      );
      updated++;
    } catch (err) {
      console.error(`  [error] post #${post.id} (${post.movie_name}): ${err.message}`);
      skipped++;
    }
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);
  console.log('Tip: check the "->" matches above. If an old post matched the wrong film, fix its imdb_id by hand.');
  process.exit(0);
}

backfill().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});