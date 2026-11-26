const express = require('express');
const pool = require('../config/db');
const requireLogin = require('../middleware/authMiddleware');
const { listPosts } = require('../lib/posts');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Server runs in UTC; shift to the audience's timezone so "night owl" and "busiest month" are correct.
// Default = India (UTC+5:30). Override with WRAPPED_TZ_MIN in .env.
const envTz = parseInt(process.env.WRAPPED_TZ_MIN, 10);
const TZ = Number.isFinite(envTz) ? envTz : 330;
const local = (d) => new Date(new Date(d).getTime() + TZ * 60000); // read with getUTC* methods

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const FRANCHISES = {
  Marvel: ['avengers', 'iron man', 'thor', 'captain america', 'spider-man', 'guardians of the galaxy', 'black panther', 'doctor strange', 'deadpool', 'ant-man', 'marvel'],
  'Star Wars': ['star wars'], 'Harry Potter': ['harry potter'], Batman: ['batman', 'dark knight'],
  'Fast & Furious': ['fast &', 'fast and', 'furious'], 'John Wick': ['john wick'], 'Lord of the Rings': ['lord of the rings', 'hobbit'],
};
function franchiseOf(title) {
  const t = String(title || '').toLowerCase();
  for (const [name, keys] of Object.entries(FRANCHISES)) if (keys.some((k) => t.includes(k))) return name;
  return String(title || '').split(/[:\-–]/)[0].replace(/\b(part|chapter)?\s*(\d+|[ivx]+)\s*$/i, '').trim() || String(title || '');
}

const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const GENRE_FIX = { 'Sci-Fi': 'Science Fiction', Musical: 'Music' };
const keyOf = (name, imdb) => String(imdb || '').trim() || String(name || '').toLowerCase();
const topEntry = (map, minN = 0) => [...map.entries()].sort((a, b) => b[1].n - a[1].n).find((e) => e[1].n >= minN);
function parseRuntime(s) {
  s = String(s || '');
  const h = /(\d+)\s*h/i.exec(s), m = /(\d+)\s*m/i.exec(s);
  if (h || m) return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0);
  const n = parseInt(s, 10); return Number.isNaN(n) ? 0 : n;
}

/* ---------- persona copy: [name, emoji, blurb, one-line summary] ---------- */
const FR_PERSONA = {
  Marvel: ['The Marvel Loyalist', '🦸', 'Assemble first, ask questions later.', 'Fluent in Marvel, allergic to spoilers, and always ready for the next post-credits scene.'],
  'Star Wars': ['The Rebel at Heart', '🚀', 'You spent the year in a galaxy far, far away.', 'Has opinions about the Force that nobody asked for.'],
  'Harry Potter': ['The Hogwarts Lifer', '⚡', 'Your letter arrived. You never left.', 'Still waiting for the owl, still quoting the books.'],
  Batman: ['The Gotham Resident', '🦇', 'You live in the dark, and you like it.', 'Firmly believes the best heroes work nights.'],
  'Lord of the Rings': ['The Fellowship Member', '💍', 'One does not simply stop talking about Middle-earth.', 'Has already planned the extended-edition marathon.'],
  'John Wick': ['The High Table Regular', '🕶️', 'Style, consequences and exactly one dog.', 'Respects a man of focus, commitment and sheer will.'],
  'Fast & Furious': ['The Family Member', '🏎️', 'It’s about family. And physics-defying cars.', 'Will defend the sequels at any dinner table.'],
};
const GENRE_PERSONA = {
  horror: ['The Horror Devotee', '👻', 'You sleep with the lights on and the sequels queued.', 'Screams on cue, then asks for another one.'],
  'science fiction': ['The Sci-Fi Dreamer', '🛸', 'You’re always thinking about tomorrow’s world.', 'Treats every plot hole as a personal challenge.'],
  animation: ['The Animation Aficionado', '🎨', 'You know every frame is a work of art.', 'Proof that cartoons were never just for kids.'],
  comedy: ['The Comedy Connoisseur', '😄', 'Life’s too short for a bad punchline.', 'Quotes movies at the exact wrong (right) moment.'],
  romance: ['The Hopeless Romantic', '💘', 'You believe in the grand gesture and the rain scene.', 'Cries at the ending and demands a rewatch.'],
  action: ['The Adrenaline Junkie', '💥', 'If nothing is exploding, you’re not interested.', 'Rates movies by chase scenes per hour.'],
  thriller: ['The Thriller Addict', '🕵️', 'You trust no one, especially the narrator.', 'Guessed the twist in the first ten minutes.'],
  crime: ['The Case Closer', '🔎', 'You’re always three clues ahead of the detective.', 'Keeps a mental murder board for every movie.'],
  drama: ['The Drama Devotee', '🎭', 'You come for the performances and stay for the feelings.', 'Believes a quiet scene can hit harder than any explosion.'],
  fantasy: ['The Fantasy Wanderer', '🐉', 'Other worlds are simply better than this one.', 'Has a favourite map, and it isn’t a real one.'],
  mystery: ['The Mystery Solver', '🧩', 'Every detail matters and you noticed all of them.', 'Pauses the movie to point at the clue.'],
  adventure: ['The Adventurer', '🧭', 'You’re always up for the next expedition.', 'Packs a bag for every movie night.'],
  documentary: ['The Real-Life Watcher', '🎥', 'Truth is stranger than fiction, and you know it.', 'Always has a fascinating fact to share.'],
  war: ['The History Buff', '🎖️', 'You watch stories that shaped the world.', 'Can tell you what the movie got wrong.'],
};

/* ---------- poster proxy: lets the browser export posters to PNG without CORS problems ---------- */
const IMG_HOSTS = ['image.tmdb.org', 'm.media-amazon.com'];
router.get('/api/wrapped/img', requireLogin, wrap(async (req, res) => {
  let u;
  try { u = new URL(String(req.query.u || '')); } catch (e) { return res.status(400).end(); }
  if (u.protocol !== 'https:' || !IMG_HOSTS.includes(u.hostname)) return res.status(400).end();
  const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
  const type = r.headers.get('content-type') || '';
  if (!r.ok || !type.startsWith('image/')) return res.status(404).end();
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 5e6) return res.status(413).end();
  res.set({ 'Content-Type': type, 'Cache-Control': 'public, max-age=604800' }).send(buf);
}));

/* ---------- the page ---------- */
router.get('/wrapped', requireLogin, wrap(async (req, res) => {
  const userId = req.session.userId;
  const thisYear = local(Date.now()).getUTCFullYear();
  const asked = parseInt(req.query.year, 10);
  const year = asked >= 2000 && asked <= 2100 ? asked : thisYear;
  const [[user]] = await pool.query('SELECT id, username FROM users WHERE id = ?', [userId]);
  if (!user) return res.redirect('/logout');

  const inYear = (d) => local(d).getUTCFullYear() === year;
  const { posts: allPosts } = await listPosts({ userId, where: 'posts.user_id = ?', params: [userId], limit: 1000 });
  const posts = allPosts.filter((p) => inYear(p.created_at));
  const [allComments] = await pool.query(
    `SELECT comments.created_at, posts.movie_name, posts.imdb_id, posts.poster_url, posts.genre, posts.actors
     FROM comments JOIN posts ON comments.post_id = posts.id
     WHERE comments.user_id = ? ORDER BY comments.created_at DESC LIMIT 5000`, [userId]);
  const comments = allComments.filter((c) => inYear(c.created_at));

  if (!posts.length && !comments.length) return res.render('wrapped', { nav: 'wrapped', W: { empty: true, year, username: user.username } });

  /* one list of "things you did": a post counts 2, a comment counts 1 */
  const ev = [
    ...posts.map((p) => ({ w: 2, post: true, name: p.movie_name, key: keyOf(p.movie_name, p.imdb_id), poster: p.poster_url, genre: p.genre, actors: p.actors, date: p.created_at })),
    ...comments.map((c) => ({ w: 1, post: false, name: c.movie_name, key: keyOf(c.movie_name, c.imdb_id), poster: c.poster_url, genre: c.genre, actors: c.actors, date: c.created_at })),
  ];

  const movies = new Map(), gMap = new Map(), fMap = new Map(), aMap = new Map();
  const monthC = Array(12).fill(0), dayC = Array(7).fill(0);
  let night = 0, early = 0, stamps = 0, gTotal = 0;
  const perDay = new Map(); // local day number -> activity count (for streaks and "marathon" days)
  const bump = (map, k, poster) => { const e = map.get(k) || { n: 0, poster: '' }; e.n++; e.poster = e.poster || poster || ''; map.set(k, e); };

  ev.forEach((e) => {
    const m = movies.get(e.key) || { name: e.name, poster: '', posts: 0, comments: 0, score: 0 };
    m.poster = m.poster || e.poster || ''; m.score += e.w; e.post ? m.posts++ : m.comments++; movies.set(e.key, m);
    splitList(e.genre).forEach((g) => { g = GENRE_FIX[g] || g; const o = gMap.get(g) || { n: 0 }; o.n += e.w; gTotal += e.w; gMap.set(g, o); });
    bump(fMap, franchiseOf(e.name), e.poster);
    splitList(e.actors).slice(0, 3).forEach((a) => bump(aMap, a, e.poster));
    const d = local(e.date);
    if (!Number.isNaN(d.getTime())) {
      monthC[d.getUTCMonth()]++; dayC[d.getUTCDay()]++; stamps++;
      const h = d.getUTCHours(); if (h >= 22 || h < 4) night++; else if (h >= 4 && h < 8) early++;
      const dk = Math.floor(d.getTime() / 86400000); perDay.set(dk, (perDay.get(dk) || 0) + 1);
    }
  });

  /* longest run of consecutive active days, and the busiest single day */
  let streak = 0, run = 0, prevDay = null;
  [...perDay.keys()].sort((a, b) => a - b).forEach((k) => { run = prevDay !== null && k === prevDay + 1 ? run + 1 : 1; prevDay = k; if (run > streak) streak = run; });
  const busiestDay = Math.max(0, ...perDay.values());

  const top5 = [...movies.values()].sort((a, b) => b.score - a.score || b.posts - a.posts).slice(0, 5);
  const genres = [...gMap.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 4)
    .map(([name, o]) => ({ name, pct: Math.round((o.n / (gTotal || 1)) * 100) }));
  const genre = genres[0] || { name: 'A bit of everything', pct: 0 };
  const genreWord = genres.length ? genre.name.toLowerCase() : 'every genre';
  const bestMonth = monthC.indexOf(Math.max(...monthC));
  const bestDay = dayC.indexOf(Math.max(...dayC));

  /* biggest obsession: franchise vs actor (actor needs 3+ mentions and must beat the franchise) */
  const movieNames = new Set(ev.map((e) => e.name));
  const fTop = topEntry(fMap), aTop = topEntry(aMap, 3);
  let obs = { name: 'Movies', count: 0, type: 'movie', poster: '' };
  if (fTop) obs = { name: fTop[0], count: fTop[1].n, type: movieNames.has(fTop[0]) ? 'movie' : 'franchise', poster: fTop[1].poster };
  if (aTop && aTop[1].n > obs.count) obs = { name: aTop[0], count: aTop[1].n, type: 'actor', poster: aTop[1].poster };

  /* favourite face: the most-mentioned actor, shown only when it isn't already the obsession */
  const sTop = topEntry(aMap, 2);
  const star = sTop && obs.type !== 'actor' ? { name: sTop[0], count: sTop[1].n, poster: sTop[1].poster } : null;

  /* best discussion */
  const score = (p) => Number(p.like_count) * 2 + Number(p.comment_count);
  const best = [...posts].sort((a, b) => score(b) - score(a))[0];

  /* taste facts (only from columns that really exist: imdb_rating, release_date, runtime, content) */
  const uniq = new Map(); posts.forEach((p) => { const k = keyOf(p.movie_name, p.imdb_id); if (!uniq.has(k)) uniq.set(k, p); });
  const uPosts = [...uniq.values()];
  const rated = uPosts.map((p) => parseFloat(p.imdb_rating)).filter((n) => n > 0);
  const avgImdb = rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10 : 0;
  const hours = Math.round(uPosts.reduce((n, p) => n + parseRuntime(p.runtime), 0) / 60);
  const years = uPosts.map((p) => +(String(p.release_date).match(/(?:19|20)\d{2}/) || [])[0]).filter(Boolean);
  const decades = new Map();
  years.forEach((y) => { const d = Math.floor(y / 10) * 10; decades.set(d, (decades.get(d) || 0) + 1); });
  const dTop = [...decades.entries()].sort((a, b) => b[1] - a[1])[0];
  const oldShare = years.length ? years.filter((y) => y < 2000).length / years.length : 0;
  const newShare = years.length ? years.filter((y) => y >= year - 1).length / years.length : 0;
  const avgLen = posts.length ? posts.reduce((n, p) => n + String(p.content || '').length, 0) / posts.length : 0;
  const repeatShare = posts.length ? 1 - uniq.size / posts.length : 0;

  let gemShare = 0;
  if (movies.size) {
    const keys = [...movies.keys()];
    const [rows] = await pool.query(
      `SELECT COALESCE(NULLIF(imdb_id, ''), LOWER(movie_name)) AS k, COUNT(*) AS n FROM posts
       WHERE COALESCE(NULLIF(imdb_id, ''), LOWER(movie_name)) IN (?) GROUP BY k`, [keys]);
    gemShare = rows.filter((r) => Number(r.n) <= 2).length / keys.length;
  }

  const likes = posts.reduce((n, p) => n + Number(p.like_count), 0);
  const repliesReceived = posts.reduce((n, p) => n + Number(p.comment_count), 0);
  const nightShare = stamps ? night / stamps : 0;
  const earlyShare = stamps ? early / stamps : 0;
  const weekendShare = stamps ? (dayC[0] + dayC[6]) / stamps : 0;
  const top = top5[0].name;

  /* ---------- traits (shared by personas and awards) ---------- */
  const critic = posts.length >= 3 && avgLen >= 600;
  const nocturnal = stamps >= 6 && nightShare >= 0.5;
  const replyKing = comments.length >= 8 && comments.length > posts.length * 3;
  const gemHunter = gemShare >= 0.6 && movies.size >= 3;
  const streaker = streak >= 7;
  const classic = years.length >= 3 && oldShare >= 0.4;
  const fresh = years.length >= 3 && newShare >= 0.5;
  const underdog = uPosts.length >= 3 && avgImdb > 0 && avgImdb <= 6.3;
  const weekender = stamps >= 6 && weekendShare >= 0.6;
  const earlyBird = stamps >= 6 && earlyShare >= 0.3;
  const hopper = gMap.size >= 7 && genre.pct < 25;
  const comfort = repeatShare >= 0.4 || (posts.length >= 4 && genre.pct >= 60);

  /* ---------- personality: first rule that matches wins (all text is written here, no AI) ---------- */
  const P = (key, on, [name, emoji, blurb, line]) => ({ key, on, name, emoji, blurb, line });
  const frP = FR_PERSONA[obs.name];
  const gP = GENRE_PERSONA[genre.name.toLowerCase()];
  const PERSONAS = [
    P('franchise', obs.type === 'franchise' && obs.count >= 4 && !!frP, frP || []),
    P('franchise', obs.type === 'franchise' && obs.count >= 4, ['The Franchise Loyalist', '🔁', `${obs.name} isn’t a hobby for you. It’s a lifestyle.`, `Fluent in ${obs.name}, and still finding new things to argue about.`]),
    P('stan', obs.type === 'actor' && obs.count >= 4, ['The Certified Stan', '⭐', `If ${obs.name} is in it, you’re already watching.`, `If ${obs.name} is in the cast, you already have an opinion.`]),
    P('streak', streaker, ['The Daily Regular', '📅', `${streak} days in a row. KravN is basically your local cinema.`, 'Never misses a day, never misses a take.']),
    P('night', nocturnal, ['The Midnight Critic', '🌙', 'Your sharpest takes drop after 10 PM.', `Most people sleep. You debate ${genreWord} at midnight.`]),
    P('critic', critic, ['The Hardcore Critic', '🧐', 'Your posts read like proper reviews. Nobody gets a free pass.', 'Writes posts so thorough the director should send a thank-you note.']),
    P('replies', replyKing, ['The Comment Section MVP', '💬', 'You don’t just watch the debate. You win it.', 'You don’t just watch movies. You win the replies.']),
    P('gems', gemHunter, ['The Hidden-Gem Hunter', '💎', 'You find the good stuff before everyone else does.', 'Finds the films your friends will pretend they watched first.']),
    P('genre', !!gP && genre.pct >= 25, gP || []),
    P('classic', classic, ['The Old-Soul Cinephile', '📽️', 'You’d rather watch a classic than a trailer.', 'Thinks the best movies were made long before streaming.']),
    P('fresh', fresh, ['The Opening-Night Regular', '🎟️', 'If it just came out, you already have a take.', 'Has seen it, reviewed it and moved on to the next release.']),
    P('comfort', comfort, ['The Comfort Rewatcher', '🛋️', 'You know what you love, and you keep going back.', `Has seen ${top} enough times to correct the subtitles.`]),
    P('underdog', underdog, ['The Underdog Defender', '🛡️', 'You stand up for the movies critics gave up on.', 'Will argue that a 6.2 is secretly a masterpiece.']),
    P('crowd', avgImdb >= 7.8, ['The Crowd-Pleaser', '🍿', 'Your taste is basically a greatest-hits playlist.', `Your picks average ${avgImdb} on IMDb. The crowd thanks you.`]),
    P('weekend', weekender, ['The Weekend Warrior', '🎬', 'Your movie takes come out when the week ends.', 'Saves the best debates for Saturday night.']),
    P('early', earlyBird, ['The Early Bird', '☀️', 'You’re debating cinema while the rest of the world sleeps in.', 'Morning coffee, hot takes, no mercy.']),
    P('hopper', hopper, ['The Genre Hopper', '🎲', `${gMap.size} genres in one year. You refuse to be boxed in.`, 'Never watches the same kind of movie twice in a row.']),
    P('cine', true, ['The All-Round Cinephile', '🎞️', 'You watch widely and have an opinion on all of it.', `Equal parts ${genreWord} fan and professional opinion-haver.`]),
  ];
  const persona = PERSONAS.find((p) => p.on);

  /* ---------- award: never repeats the personality's own trait ---------- */
  const taken = new Set([persona.key]);
  if (persona.key === 'stan') taken.add('franchise');
  const A = (key, on, title, emoji, why) => ({ key, on, title, emoji, why });
  const AWARDS = [
    A('streak', streak >= 5, 'The Streak Keeper', '🔥', `${streak} days in a row. You showed up every single day.`),
    A('replies', replyKing, 'The Comment Section Hero', '💬', `${comments.length} comments written. Someone had to reply.`),
    A('night', nocturnal, 'The Midnight Reviewer', '🌙', 'Most of your activity happened after 10 PM.'),
    A('viral', likes >= 25, 'The Crowd Favourite', '❤️', `${likes} likes on your posts. People actually agree with you.`),
    A('franchise', obs.count >= 8, 'The Franchise Detective', '🕵️', `You kept circling back to ${obs.name}.`),
    A('critic', critic, 'The Long-Form Legend', '📜', 'You write essays where others write one-liners.'),
    A('gems', gemHunter, 'The Plot Twist Detective', '💎', 'You dig up films nobody else is talking about.'),
    A('marathon', busiestDay >= 6, 'The One-Day Marathon', '🏃', `${busiestDay} posts and comments in a single day.`),
    A('classic', classic, 'The Time Traveller', '🕰️', `${Math.round(oldShare * 100)}% of your titles came out before 2000.`),
    A('fresh', fresh, 'The New-Release Radar', '📡', 'Most of your titles are brand new. You’re always first in line.'),
    A('hopper', gMap.size >= 7, 'The Genre Explorer', '🗺️', `${gMap.size} different genres in one year.`),
    A('crowd', avgImdb >= 7.8, 'The Crowd-Pleaser Curator', '🏅', `Your picks average ${avgImdb} on IMDb.`),
    A('underdog', underdog, 'The Underdog Champion', '🥊', `Your picks average ${avgImdb} on IMDb, and you stand by every one.`),
    A('starter', posts.length >= 3 && posts.length > comments.length, 'The Conversation Starter', '🎤', `${posts.length} discussions started. You open the debates.`),
    A('weekend', weekender, 'The Weekend Warrior', '🛋️', 'Most of your activity landed on a Saturday or Sunday.'),
    A('early', earlyBird, 'The Early Bird', '☀️', 'A lot of your takes dropped before 8 AM.'),
    A('regular', comments.length >= 15, 'The Dependable Regular', '🤝', `${comments.length} comments. You’re always in the thread.`),
    A('main', true, 'The Main Character', '✨', 'Your takes kept the feed alive.'),
  ];
  const award = AWARDS.find((a) => a.on && !taken.has(a.key));

  const guilty = obs.count >= 3
    ? `You brought up ${obs.name} ${obs.count} times this year. We counted. 😂`
    : repeatShare > 0 ? 'You keep coming back to the same movies. No judgement. 😂'
    : 'You say you’re picky, yet you never miss a new release. 😂';

  /* insights you probably didn't notice */
  const insights = [];
  if (hours >= 2) insights.push(`The movies you discussed add up to ${hours} hours of screen time.`);
  if (dTop && uPosts.length >= 3 && dTop[1] / uPosts.length >= 0.35) insights.push(`${Math.round((dTop[1] / uPosts.length) * 100)}% of your titles came from the ${dTop[0]}s.`);
  if (streak >= 3) insights.push(`Your longest streak: ${streak} days in a row on KravN.`);
  if (stamps >= 5) insights.push(nightShare >= 0.35 ? `${Math.round(nightShare * 100)}% of your KravN time was after 10 PM.` : `${DAYS[bestDay]} is your day for movie talk.`);
  if (avgImdb) insights.push(avgImdb >= 7.5 ? `Your picks average ${avgImdb} on IMDb. You stick to the loved ones.` : avgImdb <= 6.5 ? `Your picks average ${avgImdb} on IMDb. You defend what critics ignored.` : `Your picks average ${avgImdb} on IMDb. A healthy mix of hits and risks.`);
  if (posts.length && comments.length) insights.push(comments.length > posts.length ? `You write ${(comments.length / posts.length).toFixed(1)} comments per post. You love a good reply.` : 'You start more conversations than you join.');
  if (!insights.length) insights.push(`${DAYS[bestDay]} is your day for movie talk.`);

  const W = {
    year, username: user.username,
    cinematic: { titles: movies.size, discussions: posts.length, comments: comments.length },
    avgImdb, top5, genre, genres,
    personality: { name: persona.name, emoji: persona.emoji, blurb: persona.blurb },
    award: { title: award.title, emoji: award.emoji, why: award.why },
    sentence: persona.line, guilty, insights, streak, star,
    month: { name: MONTHS[bestMonth], counts: monthC, total: monthC[bestMonth], best: bestMonth },
    obsession: obs,
    best: best ? { title: best.title || best.movie_name, movie: best.movie_name, poster: best.poster_url || '', likes: Number(best.like_count), comments: Number(best.comment_count) } : null,
    impact: { likes, repliesReceived, discussions: posts.length },
  };

  res.render('wrapped', { nav: 'wrapped', W });
}));

module.exports = router;