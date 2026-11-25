'use strict';

/**
 * Watchlist: database helpers + JSON API + the /watchlist pages, all in one file.
 * Tables (watchlists, watchlist_items) are created automatically on first start,
 * and the `watched` column is added automatically to existing installs.
 *
 * New in this version:
 *  - GET /api/watchlist/suggest?q=...  -> instant search suggestions across ALL of the user's lists
 *  - fewer queries per request (lists are loaded once, default list is created only when missing)
 *  - stricter input validation
 */

const express = require('express');
const router = express.Router();

const pool = require('../config/db');
const tmdb = require('../config/tmdb');

const DEFAULT_NAME = 'My Watchlist';
const MAX_LISTS = 30;
const MAX_ITEMS_PER_LIST = 1000;
const BULK_MAX = 200;
const SUGGEST_MAX = 8;

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/* ------------------------------ tables ------------------------------ */

let readyPromise = null;
function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS watchlists (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          name VARCHAR(60) NOT NULL,
          is_default TINYINT(1) NOT NULL DEFAULT 0,
          is_public TINYINT(1) NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_watchlists_user_name (user_id, name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS watchlist_items (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          watchlist_id INT UNSIGNED NOT NULL,
          user_id INT NOT NULL,
          media_type VARCHAR(5) NOT NULL,
          tmdb_id INT UNSIGNED NOT NULL,
          imdb_id VARCHAR(20) NULL,
          title VARCHAR(255) NOT NULL,
          release_year VARCHAR(4) NULL,
          poster VARCHAR(255) NULL,
          watched TINYINT(1) NOT NULL DEFAULT 0,
          added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_watchlist_items (watchlist_id, media_type, tmdb_id),
          KEY ix_watchlist_items_user (user_id, media_type, tmdb_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      // existing installs: add the "watched" column once
      const [cols] = await pool.query(
        `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'watchlist_items' AND COLUMN_NAME = 'watched'`
      );
      if (!Number(cols[0].n)) {
        try {
          await pool.query('ALTER TABLE watchlist_items ADD COLUMN watched TINYINT(1) NOT NULL DEFAULT 0');
        } catch (err) {
          if (err.code !== 'ER_DUP_FIELDNAME') throw err; // another instance added it first
        }
      }
    })().catch((err) => {
      readyPromise = null; // try again on the next request
      throw err;
    });
  }
  return readyPromise;
}

async function q(sql, params) {
  await ready();
  return pool.query(sql, params);
}

/* ------------------------------ helpers ------------------------------ */

const toId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);

// Keys the browser uses to know "is this title saved?" without asking the server per card
function keysOf(it) {
  const keys = [`${it.media_type}:${it.tmdb_id}`];
  if (it.imdb_id) keys.push(`imdb:${it.imdb_id}`);
  const n = tmdb.normalize(it.title);
  if (n) keys.push(`name:${n}`);
  return keys;
}

// Accepts {type,id} or {imdb,title,year} (discussion cards only know the IMDb id / name)
async function resolveRef(input) {
  const b = input || {};
  const type = b.type === 'tv' ? 'tv' : b.type === 'movie' ? 'movie' : '';
  if (type && /^\d+$/.test(String(b.id || ''))) {
    const id = Number(b.id);
    if (id > 0 && id <= 4294967295) return { type, id };
  }
  const hit = await tmdb.resolveTitle({
    imdbId: String(b.imdb || '').slice(0, 20) || undefined,
    title: String(b.title || '').slice(0, 200) || undefined,
    year: String(b.year || '').slice(0, 4) || undefined,
  });
  if (!hit) throw fail(404, "We couldn't find that title.");
  return { type: hit.type, id: hit.id };
}

/* ------------------------------- lists -------------------------------- */

async function defaultList(userId) {
  const find = async () => (await q('SELECT * FROM watchlists WHERE user_id = ? AND is_default = 1 ORDER BY id LIMIT 1', [userId]))[0][0];
  let row = await find();
  if (row) return row;
  try {
    await q('INSERT INTO watchlists (user_id, name, is_default) VALUES (?, ?, 1)', [userId, DEFAULT_NAME]);
  } catch (err) {
    if (err.code !== 'ER_DUP_ENTRY') throw err; // another request just created it (or the name is taken)
  }
  row = await find();
  if (row) return row;
  await q('UPDATE watchlists SET is_default = 1 WHERE user_id = ? ORDER BY id LIMIT 1', [userId]);
  row = await find();
  if (!row) throw fail(500, 'Could not create your watchlist.');
  return row;
}

async function ownList(userId, id) {
  const n = toId(id);
  if (!n) throw fail(404, 'List not found.');
  const [rows] = await q('SELECT * FROM watchlists WHERE id = ? AND user_id = ?', [n, userId]);
  if (!rows[0]) throw fail(404, 'List not found.');
  return rows[0];
}

async function listsOf(userId) {
  const load = async () => (await q(
    `SELECT w.id, w.name, w.is_default, w.is_public,
       (SELECT COUNT(*) FROM watchlist_items i WHERE i.watchlist_id = w.id) AS n
     FROM watchlists w WHERE w.user_id = ? ORDER BY w.is_default DESC, w.id ASC`,
    [userId]
  ))[0];
  let rows = await load();
  if (!rows.some((r) => r.is_default)) { // first visit: create "My Watchlist"
    await defaultList(userId);
    rows = await load();
  }
  return rows.map((r) => ({ id: r.id, name: r.name, isDefault: !!r.is_default, isPublic: !!r.is_public, count: Number(r.n) }));
}

async function createList(userId, name, ref) {
  const clean = cleanName(name);
  if (!clean) throw fail(400, 'Give your list a name.');
  const lists = await listsOf(userId);
  if (lists.length >= MAX_LISTS) throw fail(400, `You can have up to ${MAX_LISTS} lists.`);
  let id;
  try {
    const [r] = await q('INSERT INTO watchlists (user_id, name) VALUES (?, ?)', [userId, clean]);
    id = r.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw fail(409, 'You already have a list with that name.');
    throw err;
  }
  const out = { list: { id, name: clean, isDefault: false, isPublic: false, count: 0 } };
  if (ref) {
    const added = await add(userId, ref, id);
    Object.assign(out, added, { saved: true });
    out.list.count = 1;
  }
  return out;
}

async function renameList(userId, id, name) {
  const list = await ownList(userId, id);
  const clean = cleanName(name);
  if (!clean) throw fail(400, 'Give your list a name.');
  try {
    await q('UPDATE watchlists SET name = ? WHERE id = ?', [clean, list.id]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw fail(409, 'You already have a list with that name.');
    throw err;
  }
  return { id: list.id, name: clean };
}

async function deleteList(userId, id) {
  const list = await ownList(userId, id);
  if (list.is_default) throw fail(400, "Your main watchlist can't be deleted. You can rename it instead.");
  await q('DELETE FROM watchlist_items WHERE watchlist_id = ?', [list.id]);
  await q('DELETE FROM watchlists WHERE id = ?', [list.id]);
  return { id: list.id };
}

async function setPublic(userId, id, isPublic) {
  const list = await ownList(userId, id);
  await q('UPDATE watchlists SET is_public = ? WHERE id = ?', [isPublic ? 1 : 0, list.id]);
  return { id: list.id, isPublic: !!isPublic };
}

// Save a copy of someone else's PUBLIC list into the current user's own lists
async function saveList(userId, id) {
  const n = toId(id);
  if (!n) throw fail(404, 'List not found.');
  const [rows] = await q('SELECT * FROM watchlists WHERE id = ? AND is_public = 1', [n]);
  const src = rows[0];
  if (!src) throw fail(404, 'List not found.');
  if (Number(src.user_id) === Number(userId)) throw fail(400, 'This is already your list.');

  const lists = await listsOf(userId);
  if (lists.length >= MAX_LISTS) throw fail(400, `You can have up to ${MAX_LISTS} lists.`);

  const base = cleanName(src.name).slice(0, 52) || 'Saved list';
  let listId = 0;
  let name = base;
  for (let i = 1; i <= 20 && !listId; i++) {
    name = i === 1 ? base : `${base} (${i})`;
    try {
      const [r] = await q('INSERT INTO watchlists (user_id, name) VALUES (?, ?)', [userId, name]);
      listId = r.insertId;
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
    }
  }
  if (!listId) throw fail(409, "Couldn't pick a name for the copy. Rename one of your lists and try again.");

  // oldest first so the copy keeps the same "recently added" order
  const [r] = await q(
    `INSERT IGNORE INTO watchlist_items (watchlist_id, user_id, media_type, tmdb_id, imdb_id, title, release_year, poster)
     SELECT ?, ?, media_type, tmdb_id, imdb_id, title, release_year, poster
     FROM watchlist_items WHERE watchlist_id = ? ORDER BY added_at ASC, id ASC LIMIT ?`,
    [listId, userId, src.id, MAX_ITEMS_PER_LIST]
  );
  return { list: { id: listId, name, count: Number(r.affectedRows) || 0 } };
}

/* ------------------------------- items -------------------------------- */

async function itemRows(userId, ref) {
  const [rows] = await q(
    `SELECT i.*, w.name AS list_name FROM watchlist_items i
     JOIN watchlists w ON w.id = i.watchlist_id
     WHERE i.user_id = ? AND i.media_type = ? AND i.tmdb_id = ?
     ORDER BY i.id`,
    [userId, ref.type, ref.id]
  );
  return rows;
}

async function add(userId, ref, listId) {
  const list = listId ? await ownList(userId, listId) : await defaultList(userId);
  const [[c]] = await q('SELECT COUNT(*) AS n FROM watchlist_items WHERE watchlist_id = ?', [list.id]);
  if (Number(c.n) >= MAX_ITEMS_PER_LIST) throw fail(400, 'This list is full.');

  const movie = await tmdb.getTitle(ref.type, ref.id);
  if (!movie) throw fail(502, "Couldn't load this title right now. Please try again.");

  // a title that is already saved elsewhere keeps its "watched" state
  const [prev] = await q(
    'SELECT MAX(watched) AS w FROM watchlist_items WHERE user_id = ? AND media_type = ? AND tmdb_id = ?',
    [userId, movie.type, movie.id]
  );
  const watched = prev[0] && Number(prev[0].w) ? 1 : 0;

  await q(
    `INSERT INTO watchlist_items (watchlist_id, user_id, media_type, tmdb_id, imdb_id, title, release_year, poster, watched)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE watchlist_id = watchlist_id`,
    [list.id, userId, movie.type, movie.id, movie.imdbId || null, String(movie.title).slice(0, 255), movie.year || null, movie.poster ? String(movie.poster).slice(0, 255) : null, watched]
  );
  return {
    ref: { type: movie.type, id: movie.id },
    listId: list.id,
    listName: list.name,
    saved: true,
    keys: keysOf({ media_type: movie.type, tmdb_id: movie.id, imdb_id: movie.imdbId, title: movie.title }),
  };
}

async function remove(userId, ref, listId) {
  const rows = await itemRows(userId, ref);
  const wanted = toId(listId);
  const targets = wanted ? rows.filter((r) => Number(r.watchlist_id) === wanted) : rows;
  if (targets.length) {
    await q(`DELETE FROM watchlist_items WHERE id IN (${targets.map(() => '?').join(',')})`, targets.map((r) => r.id));
  }
  return {
    ref,
    saved: rows.length - targets.length > 0,
    keys: rows[0] ? keysOf(rows[0]) : [`${ref.type}:${ref.id}`],
  };
}

// "Watched" belongs to the title, so it is set in every list of yours that holds it
async function setWatched(userId, ref, watched, listId) {
  const flag = watched ? 1 : 0;

  // 1) the normal case: the title is saved by this user (in any of their lists)
  const rows = await itemRows(userId, ref);
  if (rows.length) {
    await q(
      'UPDATE watchlist_items SET watched = ? WHERE user_id = ? AND media_type = ? AND tmdb_id = ?',
      [flag, userId, ref.type, ref.id]
    );
    return { ref, watched: !!watched };
  }

  // 2) fallback: look inside the list the card is shown in. This covers rows saved by an older version
  //    of the feature, whose user_id may not match the logged-in user even though the list is theirs.
  const lid = toId(listId);
  if (lid) {
    const list = await ownList(userId, lid);
    const [found] = await q(
      'SELECT id FROM watchlist_items WHERE watchlist_id = ? AND media_type = ? AND tmdb_id = ? LIMIT 1',
      [list.id, ref.type, ref.id]
    );
    if (found.length) {
      await q(
        'UPDATE watchlist_items SET watched = ?, user_id = ? WHERE watchlist_id = ? AND media_type = ? AND tmdb_id = ?',
        [flag, userId, list.id, ref.type, ref.id]
      );
      return { ref, watched: !!watched };
    }
  }

  throw fail(404, "This title isn't in your watchlist anymore. Refresh the page.");
}

// Several titles at once from one list: watched / unwatched / remove / move / copy
async function bulk(userId, b) {
  const list = await ownList(userId, b.listId);
  const refs = [];
  const seen = new Set();
  (Array.isArray(b.items) ? b.items.slice(0, BULK_MAX) : []).forEach((r) => {
    const type = r && r.type === 'tv' ? 'tv' : r && r.type === 'movie' ? 'movie' : '';
    const id = toId(r && r.id);
    if (!type || !id || seen.has(type + id)) return;
    seen.add(type + id);
    refs.push({ type, id });
  });
  if (!refs.length) throw fail(400, 'Select at least one title.');

  const where = refs.map(() => '(media_type = ? AND tmdb_id = ?)').join(' OR ');
  const flat = [];
  refs.forEach((r) => flat.push(r.type, r.id));
  const action = String(b.action || '');

  if (action === 'watched' || action === 'unwatched') {
    await q(`UPDATE watchlist_items SET watched = ? WHERE user_id = ? AND (${where})`, [action === 'watched' ? 1 : 0, userId, ...flat]);
    return { action, count: refs.length };
  }

  if (action === 'remove') {
    await q(`DELETE FROM watchlist_items WHERE watchlist_id = ? AND (${where})`, [list.id, ...flat]);
    return { action, count: refs.length };
  }

  if (action === 'move' || action === 'copy') {
    const target = await ownList(userId, b.targetId);
    if (target.id === list.id) throw fail(400, 'Pick a different list.');
    const [[c]] = await q('SELECT COUNT(*) AS n FROM watchlist_items WHERE watchlist_id = ?', [target.id]);
    if (Number(c.n) + refs.length > MAX_ITEMS_PER_LIST) throw fail(400, "That list doesn't have room for all of these.");
    const [r] = await q(
      `INSERT IGNORE INTO watchlist_items (watchlist_id, user_id, media_type, tmdb_id, imdb_id, title, release_year, poster, watched)
       SELECT ?, user_id, media_type, tmdb_id, imdb_id, title, release_year, poster, watched
       FROM watchlist_items WHERE watchlist_id = ? AND (${where})`,
      [target.id, list.id, ...flat]
    );
    if (action === 'move') await q(`DELETE FROM watchlist_items WHERE watchlist_id = ? AND (${where})`, [list.id, ...flat]);
    return { action, count: refs.length, added: Number(r.affectedRows) || 0, targetName: target.name };
  }

  throw fail(400, 'Unknown action.');
}

async function membership(userId, ref) {
  const rows = await itemRows(userId, ref);
  const has = new Set(rows.map((r) => Number(r.watchlist_id)));
  const lists = (await listsOf(userId)).map((l) => ({ ...l, has: has.has(l.id) }));
  return { ref, saved: rows.length > 0, lists, keys: rows[0] ? keysOf(rows[0]) : [`${ref.type}:${ref.id}`] };
}

/**
 * One tap on a bookmark:
 *  - not saved anywhere  -> save to the default list
 *  - saved in one list   -> remove it
 *  - saved in several    -> tell the browser to show the list picker
 */
async function toggle(userId, ref) {
  const rows = await itemRows(userId, ref);
  if (rows.length === 0) return { state: 'added', ...(await add(userId, ref)) };
  if (rows.length === 1) {
    await q('DELETE FROM watchlist_items WHERE id = ?', [rows[0].id]);
    return { state: 'removed', ref, saved: false, listId: rows[0].watchlist_id, listName: rows[0].list_name, keys: keysOf(rows[0]) };
  }
  return { state: 'choose', ...(await membership(userId, ref)) };
}

/* ------------------------------- reading ------------------------------- */

async function status(userId) {
  const lists = await listsOf(userId);
  const [items] = await q('SELECT media_type, tmdb_id, imdb_id, title FROM watchlist_items WHERE user_id = ?', [userId]);
  const keys = new Set();
  for (const it of items) for (const k of keysOf(it)) keys.add(k);
  return { lists, keys: [...keys] };
}

// Search suggestions across ALL of the user's lists. One row per title, with the lists that hold it.
async function suggest(userId, term) {
  const t = String(term || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!t) return { items: [] };
  const esc = t.replace(/[|%_]/g, '|$&'); // '|' is the LIKE escape character below
  const [rows] = await q(
    `SELECT i.media_type, i.tmdb_id, i.title, i.release_year, i.poster, i.watched, i.watchlist_id, w.name AS list_name
     FROM watchlist_items i
     JOIN watchlists w ON w.id = i.watchlist_id
     WHERE i.user_id = ? AND i.title LIKE ? ESCAPE '|'
     ORDER BY (i.title LIKE ? ESCAPE '|') DESC, i.added_at DESC, i.id DESC
     LIMIT 120`,
    [userId, `%${esc}%`, `${esc}%`]
  );
  const byKey = new Map();
  for (const r of rows) {
    const key = `${r.media_type}:${r.tmdb_id}`;
    let it = byKey.get(key);
    if (!it) {
      if (byKey.size >= SUGGEST_MAX) continue;
      it = {
        type: r.media_type,
        id: r.tmdb_id,
        title: r.title,
        year: r.release_year || '',
        poster: r.poster || '',
        watched: false,
        lists: [],
        url: `/${r.media_type}/${r.tmdb_id}`,
      };
      byKey.set(key, it);
    }
    if (r.watched) it.watched = true;
    if (!it.lists.some((l) => l.id === r.watchlist_id)) it.lists.push({ id: r.watchlist_id, name: r.list_name });
  }
  return { items: [...byKey.values()] };
}

async function itemsOf(listId) {
  const [rows] = await q(
    'SELECT media_type, tmdb_id, title, release_year, poster, watched FROM watchlist_items WHERE watchlist_id = ? ORDER BY added_at DESC, id DESC',
    [listId]
  );
  return rows.map((r) => ({
    type: r.media_type,
    id: r.tmdb_id,
    title: r.title,
    year: r.release_year || '',
    poster: r.poster || '',
    watched: !!r.watched,
    url: `/${r.media_type}/${r.tmdb_id}`,
  }));
}

async function pageData(userId, listId) {
  const lists = await listsOf(userId);
  const current = lists.find((l) => l.id === toId(listId)) || lists[0];
  return { lists, current, items: await itemsOf(current.id) };
}

// Public view of someone's shared lists, or null when they have none.
// "Watched" is private to the owner, so it is never sent to visitors.
async function publicData(username, listId) {
  const [users] = await q('SELECT id, username FROM users WHERE username = ? LIMIT 1', [String(username || '').slice(0, 100)]);
  const user = users[0];
  if (!user) return null;
  const [rows] = await q(
    `SELECT w.id, w.name, w.is_default,
       (SELECT COUNT(*) FROM watchlist_items i WHERE i.watchlist_id = w.id) AS n
     FROM watchlists w WHERE w.user_id = ? AND w.is_public = 1 ORDER BY w.is_default DESC, w.id ASC`,
    [user.id]
  );
  if (!rows.length) return null;
  const lists = rows.map((r) => ({ id: r.id, name: r.name, isDefault: !!r.is_default, isPublic: true, count: Number(r.n) }));
  const current = lists.find((l) => l.id === toId(listId)) || lists[0];
  const items = (await itemsOf(current.id)).map((it) => ({ ...it, watched: false }));
  return { user, lists, current, items };
}

// A user's public lists for their profile page: name, size and the 4 newest posters (small collage).
// Empty lists are skipped. Call it from the profile route: `await require('./watchlist').publicLists(profileUser.id)`
async function publicLists(userId, limit) {
  const max = Math.max(1, Math.min(MAX_LISTS, Number(limit) || 12));
  const [rows] = await q(
    `SELECT w.id, w.name,
       (SELECT COUNT(*) FROM watchlist_items i WHERE i.watchlist_id = w.id) AS n
     FROM watchlists w WHERE w.user_id = ? AND w.is_public = 1 ORDER BY w.is_default DESC, w.id ASC LIMIT ?`,
    [toId(userId), max]
  );
  const lists = rows.filter((r) => Number(r.n) > 0);
  return Promise.all(lists.map(async (r) => {
    const [ps] = await q(
      `SELECT poster FROM watchlist_items WHERE watchlist_id = ? AND poster IS NOT NULL AND poster <> ''
       ORDER BY added_at DESC, id DESC LIMIT 4`,
      [r.id]
    );
    return { id: r.id, name: r.name, count: Number(r.n), posters: ps.map((p) => p.poster) };
  }));
}

async function usernameOf(req) {
  if (req.session.username) return req.session.username;
  const [rows] = await q('SELECT username FROM users WHERE id = ? LIMIT 1', [req.session.userId]);
  return rows[0] ? rows[0].username : '';
}

const wl = {
  ready, resolveRef, status, suggest, membership, toggle, add, remove, setWatched, bulk,
  createList, renameList, deleteList, setPublic, saveList, pageData, publicData,
};

/* ============================ routes ============================ */

const notFound = (res, message) => res.status(404).render('error', { code: 404, message });

// JSON endpoints: always answer in JSON, 401 (with login:true) when logged out
const api = (fn) => async (req, res) => {
  const userId = req.session && req.session.userId;
  if (!userId) return res.status(401).json({ error: 'Please log in to use your watchlist.', login: true });
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await fn(req.body || {}, userId, req));
  } catch (err) {
    if (err.status) {
      if (err.status === 404) console.warn('watchlist 404:', req.method, req.originalUrl, '-', err.message);
      return res.status(err.status).json({ error: err.message });
    }
    console.error('watchlist error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

/* --------------------------------- API --------------------------------- */

router.get('/api/watchlist/status', api((body, userId) => wl.status(userId)));
router.get('/api/watchlist/suggest', api((body, userId, req) => wl.suggest(userId, req.query.q)));

router.post('/api/watchlist/toggle', api(async (b, userId) => wl.toggle(userId, await wl.resolveRef(b))));
router.post('/api/watchlist/membership', api(async (b, userId) => wl.membership(userId, await wl.resolveRef(b))));
router.post('/api/watchlist/add', api(async (b, userId) => wl.add(userId, await wl.resolveRef(b), b.listId)));
router.post('/api/watchlist/remove', api(async (b, userId) => wl.remove(userId, await wl.resolveRef(b), b.listId)));
router.post('/api/watchlist/watched', api(async (b, userId) => wl.setWatched(userId, await wl.resolveRef(b), b.watched === true || b.watched === 1 || b.watched === '1' || b.watched === 'true', b.listId)));
router.post('/api/watchlist/bulk', api((b, userId) => wl.bulk(userId, b)));

router.post('/api/watchlist/lists', api(async (b, userId) => {
  const ref = b.add ? await wl.resolveRef(b.add) : null;
  return wl.createList(userId, b.name, ref);
}));
router.post('/api/watchlist/lists/:id/rename', api((b, userId, req) => wl.renameList(userId, req.params.id, b.name)));
router.post('/api/watchlist/lists/:id/delete', api((b, userId, req) => wl.deleteList(userId, req.params.id)));
router.post('/api/watchlist/lists/:id/public', api((b, userId, req) => wl.setPublic(userId, req.params.id, !!b.isPublic)));
router.post('/api/watchlist/lists/:id/save', api((b, userId, req) => wl.saveList(userId, req.params.id)));

/* -------------------------------- pages -------------------------------- */

router.get('/watchlist', async (req, res, next) => {
  if (!req.session || !req.session.userId) {
    const back = '/watchlist' + (req.query.list ? '?list=' + encodeURIComponent(String(req.query.list)) : '');
    return res.redirect('/login?next=' + encodeURIComponent(back));
  }
  try {
    const [data, ownerName] = await Promise.all([
      wl.pageData(req.session.userId, req.query.list),
      usernameOf(req),
    ]);
    res.set('Cache-Control', 'no-store');
    res.render('watchlist', {
      nav: 'watchlist',
      title: 'My Watchlist',
      owner: true,
      ownerName,
      baseUrl: '/watchlist',
      ...data,
    });
  } catch (err) {
    next(err);
  }
});

// Read-only page for lists a user chose to make public (no login needed)
router.get('/users/:username/watchlist', async (req, res, next) => {
  try {
    const data = await wl.publicData(req.params.username, req.query.list);
    if (!data) return notFound(res, 'This person has no public watchlists.');
    res.render('watchlist', {
      nav: '',
      title: `${data.user.username}'s watchlist`,
      owner: false,
      ownerName: data.user.username,
      baseUrl: `/users/${encodeURIComponent(data.user.username)}/watchlist`,
      lists: data.lists,
      current: data.current,
      items: data.items,
    });
  } catch (err) {
    next(err);
  }
});

router.ready = ready; // app.js calls this once at startup to create the tables
router.publicLists = publicLists; // used by the profile route
module.exports = router;