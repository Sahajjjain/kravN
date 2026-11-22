# KravN v3 (movies + series)

Same Express + EJS + MySQL app and the same database tables. **No migrations.**

## What's new
- **Series from TMDB, treated exactly like movies.** One search, one home feed, one genre page, one
  discussions flow. A series simply has a few extra bits on its page (Seasons, network, episode count).
  Series pages live at `/tv/:id` (TMDB reuses numbers between movies and series, so the prefix is what
  keeps them apart); movies stay at `/movie/:id`, so all old links keep working.
- Genres are unified: TV "Action & Adventure" / "Sci-Fi & Fantasy" / "War & Politics" are mapped onto
  Action, Adventure, Science Fiction, Fantasy and War, and a few TV-only genres (Reality, Talk, Kids,
  Soap, News) were added.
- Discussions about a series are stored in the same `posts` table and found again through its IMDb id.
- Phone / tablet / laptop polish: safe-area (notch) support, edge-to-edge rails on phones, bigger touch
  targets, no iOS input zoom, tablet navigation, large-screen layout, lazy-rendered rows, responsive hero images.
- Optional gzip compression (`compression` package).

## Where the TMDB key goes
- Render: Dashboard > your KravN service > Environment > Add Environment Variable
  Key: TMDB_API_KEY   Value: (your key)   then Save (Render redeploys).
- Local: create a `.env` file next to server.js with the line TMDB_API_KEY=your_key

## Deploy
1. Replace the repo files with these, then run `npm install` (adds `compression`).
2. git add . && git commit && git push
3. The footer shows "v3 · movies & series" so you can confirm the new version is live.
