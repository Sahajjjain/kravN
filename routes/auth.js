const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const router = express.Router();

const pool = require('../config/db');
const tmdb = require('../config/tmdb');
const { safePath } = require('../lib/util');
const { normalizeEmail, canonicalEmail } = require('../lib/email');
const { sendMail } = require('../lib/mailer');

for (const k of [
  'OTP_SECRET',
  'APP_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET'
]) {
  if (!process.env[k]) {
    console.warn(`[auth] Missing ${k} in environment`);
  }
}

if (process.env.BREVO_API_KEY && !process.env.MAIL_FROM) {
  console.warn('[auth] MAIL_FROM is missing');
}

if (!process.env.BREVO_API_KEY &&
    (!process.env.SMTP_USER || !process.env.SMTP_PASS)) {
  console.warn('[auth] Email provider credentials are missing');
}

const USERNAME_REGEX = /^[A-Za-z0-9_]{3,30}$/;
const OTP_TTL_MIN = 10;
const MAX_OTP_ATTEMPTS = 5;
const RESEND_COOLDOWN_SEC = 60;
const RESET_TTL_MIN = 15;
const BCRYPT_COST = 12;
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_COST);

let _google;
const googleClient = () =>
  _google ||
  (_google = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_URL}/auth/google/callback`
  ));

/* --------------------------------- helpers -------------------------------- */

const limiter = (limit, windowMin) =>
  rateLimit({
    windowMs: windowMin * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => res.status(429).send('Too many attempts. Please wait a while and try again.'),
  });

const registerLimiter = limiter(10, 60);
const verifyLimiter = limiter(20, 15);
const loginLimiter = limiter(10, 15);
const forgotLimiter = limiter(5, 60);
const resetLimiter = limiter(10, 60);
const googleLimiter = limiter(20, 15);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmacOtp = (canonical, code) =>
  crypto.createHmac('sha256', process.env.OTP_SECRET).update(`${canonical}:${code}`).digest('hex');
const safeEqualHex = (a, b) => {
  const A = Buffer.from(a, 'hex');
  const B = Buffer.from(b, 'hex');
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};
const newOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

function checkPassword(pw) {
  if (typeof pw !== 'string' || !pw) return 'Password is required.';
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (Buffer.byteLength(pw) > 72) return 'Password is too long (max 72 bytes).';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use at least one letter and one number.';
  return null;
}

async function sendOtpMail(to, code) {
  await sendMail({
    to,
    subject: `Your KravN verification code: ${code}`,
    text: `Your KravN verification code is ${code}. It expires in ${OTP_TTL_MIN} minutes. If you didn't request it, ignore this email.`,
    html: `<p>Your KravN verification code is:</p><p style="font-size:28px;letter-spacing:6px"><b>${code}</b></p><p>It expires in ${OTP_TTL_MIN} minutes. If you didn't request it, ignore this email.</p>`,
  });
}

// Poster wall behind the landing and auth pages (trending films, shuffled)
async function backgroundPosters() {
  try {
    const { results } = await tmdb.trending(1);
    return results.map((m) => m.poster).filter(Boolean).sort(() => Math.random() - 0.5).slice(0, 18);
  } catch (err) {
    console.error(err);
    return [];
  }
}

async function renderAuth(res, mode, error = null, status = 200, notice = null) {
  res.status(status).render('auth', { mode, error, notice, posters: await backgroundPosters() });
}

async function renderAccount(res, mode, { error = null, notice = null, status = 200, email = '', token = '', done = false } = {}) {
  res.set('Cache-Control', 'no-store');
  res.status(status).render('account', { mode, error, notice, email, token, done, posters: await backgroundPosters() });
}

// Same session shape as before (userId, username), with a fresh session id
function startSession(req, res, user, returnTo) {
  req.session.regenerate((err) => {
    if (err) {
      console.error(err);
      return renderAuth(res, 'login', 'Something went wrong. Please try again.', 500);
    }
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.save((saveErr) => {
      if (saveErr) console.error(saveErr);
      res.redirect(returnTo || '/feed');
    });
  });
}

/* ---------------------------------- home --------------------------------- */

// The site opens straight onto the home page — browsing never needs an account
router.get('/', (req, res) => res.redirect('/feed'));

// "?next=/movie/123" brings people back to where they were after logging in or signing up
router.use(['/login', '/register'], (req, res, next) => {
  const next_ = safePath(req.query.next);
  if (req.method === 'GET' && next_) req.session.returnTo = next_;
  next();
});

/* -------------------------------- register -------------------------------- */

router.get('/register', (req, res) => renderAuth(res, 'register'));

router.post('/register', registerLimiter, async (req, res) => {
  const { username, email, password } = req.body || {};

  try {
    if (typeof username !== 'string' || typeof email !== 'string' || typeof password !== 'string' || !username || !email || !password) {
      return renderAuth(res, 'register', 'All fields are required.', 400);
    }
    const name = username.trim();
    if (!USERNAME_REGEX.test(name)) {
      return renderAuth(res, 'register', 'Username must be 3-30 characters: letters, numbers and underscores only.', 400);
    }
    const mail = normalizeEmail(email);
    if (!mail || !mail.isGmail) {
      return renderAuth(res, 'register', 'Please use a valid Gmail address (@gmail.com).', 400);
    }
    const pwError = checkPassword(password);
    if (pwError) return renderAuth(res, 'register', pwError, 400);

    await pool.query('DELETE FROM pending_signups WHERE expires_at < NOW()');

    const [sameName] = await pool.query('SELECT id FROM users WHERE username = ?', [name]);
    if (sameName.length > 0) return renderAuth(res, 'register', 'Username is already taken.', 409);

    const [sameEmail] = await pool.query('SELECT id FROM users WHERE email_canonical = ?', [mail.canonical]);
    if (sameEmail.length > 0) return renderAuth(res, 'register', 'An account with that email already exists.', 409);

    const [pendingName] = await pool.query(
      'SELECT id FROM pending_signups WHERE username = ? AND email_canonical <> ?',
      [name, mail.canonical]
    );
    if (pendingName.length > 0) return renderAuth(res, 'register', 'Username is already taken.', 409);

    const [pending] = await pool.query(
      'SELECT TIMESTAMPDIFF(SECOND, last_sent_at, NOW()) AS since FROM pending_signups WHERE email_canonical = ?',
      [mail.canonical]
    );
    if (pending.length > 0 && pending[0].since < RESEND_COOLDOWN_SEC) {
      const wait = RESEND_COOLDOWN_SEC - pending[0].since;
      return renderAuth(res, 'register', `A code was just sent. Please wait ${wait}s before trying again.`, 429);
    }

    const code = newOtp();
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    await pool.query(
      `INSERT INTO pending_signups
         (email_canonical, email, username, password_hash, otp_hash, attempts, last_sent_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 0, NOW(), DATE_ADD(NOW(), INTERVAL ? MINUTE))
       ON DUPLICATE KEY UPDATE
         email = VALUES(email), username = VALUES(username), password_hash = VALUES(password_hash),
         otp_hash = VALUES(otp_hash), attempts = 0, last_sent_at = NOW(), expires_at = VALUES(expires_at)`,
      [mail.canonical, mail.email, name, passwordHash, hmacOtp(mail.canonical, code), OTP_TTL_MIN]
    );

    await sendOtpMail(mail.email, code);

    req.session.pendingEmail = mail.canonical;
    req.session.pendingShown = mail.email;
    req.session.save(() => res.redirect('/verify'));
  } catch (err) {
    console.error(err);
    renderAuth(res, 'register', 'Could not send the verification email. Please try again.', 500);
  }
});

/* --------------------------- email verification --------------------------- */

router.get('/verify', (req, res) => {
  if (!req.session.pendingEmail) return res.redirect('/register');
  renderAccount(res, 'verify', { email: req.session.pendingShown || '' });
});

router.post('/verify', verifyLimiter, async (req, res) => {
  const canonical = req.session.pendingEmail;
  if (!canonical) return res.redirect('/register');
  const shown = req.session.pendingShown || '';
  const code = String((req.body && req.body.code) || '').trim();

  try {
    if (!/^\d{6}$/.test(code)) return renderAccount(res, 'verify', { error: 'Enter the 6-digit code.', email: shown, status: 400 });

    const [rows] = await pool.query(
      'SELECT *, (expires_at <= NOW()) AS expired FROM pending_signups WHERE email_canonical = ?',
      [canonical]
    );
    const p = rows[0];
    const restart = async (msg) => {
      if (p) await pool.query('DELETE FROM pending_signups WHERE id = ?', [p.id]);
      delete req.session.pendingEmail;
      delete req.session.pendingShown;
      return renderAuth(res, 'register', msg, 400);
    };
    if (!p || p.expired) return restart('That code has expired. Please sign up again.');

    // spend one attempt atomically BEFORE comparing, so parallel guesses can't beat the limit
    const [spent] = await pool.query(
      'UPDATE pending_signups SET attempts = attempts + 1 WHERE id = ? AND attempts < ?',
      [p.id, MAX_OTP_ATTEMPTS]
    );
    if (spent.affectedRows !== 1) return restart('Too many wrong attempts. Please sign up again.');

    if (!safeEqualHex(hmacOtp(canonical, code), p.otp_hash)) {
      return renderAccount(res, 'verify', { error: 'Incorrect code.', email: shown, status: 400 });
    }

    const conn = await pool.getConnection();
    let taken = false;
    try {
      await conn.beginTransaction();
      const [del] = await conn.query('DELETE FROM pending_signups WHERE id = ?', [p.id]);
      if (del.affectedRows !== 1) {
        await conn.rollback();
        return res.redirect('/login');
      }
      await conn.query(
        "INSERT INTO users (username, email, email_canonical, password, auth_provider, is_verified) VALUES (?, ?, ?, ?, 'local', 1)",
        [p.username, p.email, canonical, p.password_hash]
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      if (e.code === 'ER_DUP_ENTRY') taken = true;
      else throw e;
    } finally {
      conn.release();
    }

    delete req.session.pendingEmail;
    delete req.session.pendingShown;
    if (taken) return renderAuth(res, 'register', 'That username or email was just taken. Please sign up again.', 409);

    req.session.notice = 'Email verified. You can log in now.';
    req.session.save(() => res.redirect('/login'));
  } catch (err) {
    console.error(err);
    renderAccount(res, 'verify', { error: 'Something went wrong. Please try again.', email: shown, status: 500 });
  }
});

router.post('/verify/resend', verifyLimiter, async (req, res) => {
  const canonical = req.session.pendingEmail;
  if (!canonical) return res.redirect('/register');
  const shown = req.session.pendingShown || '';

  try {
    const [rows] = await pool.query(
      'SELECT id, email, TIMESTAMPDIFF(SECOND, last_sent_at, NOW()) AS since FROM pending_signups WHERE email_canonical = ?',
      [canonical]
    );
    const p = rows[0];
    if (!p) return res.redirect('/register');
    if (p.since < RESEND_COOLDOWN_SEC) {
      return renderAccount(res, 'verify', { error: `Please wait ${RESEND_COOLDOWN_SEC - p.since}s before requesting another code.`, email: shown, status: 429 });
    }
    const code = newOtp();
    await pool.query(
      'UPDATE pending_signups SET otp_hash = ?, attempts = 0, last_sent_at = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?',
      [hmacOtp(canonical, code), OTP_TTL_MIN, p.id]
    );
    await sendOtpMail(p.email, code);
    renderAccount(res, 'verify', { notice: 'A new code has been sent.', email: shown });
  } catch (err) {
    console.error(err);
    renderAccount(res, 'verify', { error: 'Could not send the email. Please try again.', email: shown, status: 500 });
  }
});

/* ---------------------------------- login --------------------------------- */

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/feed');
  const notice = req.session.notice || null;
  delete req.session.notice;
  renderAuth(res, 'login', null, 200, notice);
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  const BAD = 'Incorrect email or password.';
  const GOOGLE_ONLY = 'This account uses Google sign-in. Use "Continue with Google", or "Forgot password?" to set a password.';

  try {
    const mail = canonicalEmail(email);
    if (!mail || typeof password !== 'string' || !password || password.length > 200) {
      return renderAuth(res, 'login', BAD, 401);
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE email_canonical = ?', [mail.canonical]);
    const user = rows[0];
    // always run one bcrypt compare so timing doesn't reveal whether the account exists.
    // Google-only accounts have password NULL, so they use the dummy hash and can never match.
    const match = await bcrypt.compare(password, user && user.password ? user.password : DUMMY_HASH);
    if (!user) return renderAuth(res, 'login', BAD, 401);
    if (!user.password) return renderAuth(res, 'login', GOOGLE_ONLY, 401);
    if (!match) return renderAuth(res, 'login', BAD, 401);

    startSession(req, res, user, safePath(req.session.returnTo));
  } catch (err) {
    console.error(err);
    renderAuth(res, 'login', 'Something went wrong. Please try again.', 500);
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

/* ------------------------------ Google login ------------------------------ */

async function createGoogleUser(p, mail) {
  const local = mail.email.split('@')[0];
  let base = String(p.given_name || local).replace(/[^A-Za-z0-9_]/g, '').slice(0, 20);
  if (base.length < 3) base = 'user';

  for (let i = 0; i < 5; i++) {
    const username = `${base}${crypto.randomInt(1000, 10000)}`;
    try {
      const [r] = await pool.query(
        "INSERT INTO users (username, email, email_canonical, password, google_id, auth_provider, is_verified) VALUES (?, ?, ?, NULL, ?, 'google', 1)",
        [username, mail.email, mail.canonical, p.sub]
      );
      return { id: r.insertId, username };
    } catch (e) {
      if (e.code !== 'ER_DUP_ENTRY') throw e;
      // duplicate could be the username (retry) or a race on google_id / email (use that account)
      const [again] = await pool.query(
        'SELECT id, username, google_id FROM users WHERE google_id = ? OR email_canonical = ?',
        [p.sub, mail.canonical]
      );
      if (again[0]) return again[0].google_id === p.sub || !again[0].google_id ? again[0] : null;
    }
  }
  throw new Error('Could not generate a unique username');
}

router.get('/auth/google', googleLimiter, (req, res) => {
  const state = crypto.randomBytes(24).toString('hex');
  req.session.googleState = state;
  const url = googleClient().generateAuthUrl({
    scope: ['openid', 'email', 'profile'],
    state,
    prompt: 'select_account',
  });
  req.session.save(() => res.redirect(url));
});

router.get('/auth/google/callback', googleLimiter, async (req, res) => {
  const FAIL = 'Google sign-in failed or was cancelled. Please try again.';
  try {
    const { code, state, error } = req.query;
    const expected = req.session.googleState;
    delete req.session.googleState;
    if (error || typeof code !== 'string' || typeof state !== 'string' || !expected ||
        !safeEqualHex(sha256(state), sha256(expected))) {
      return renderAuth(res, 'login', FAIL, 400);
    }

    const { tokens } = await googleClient().getToken(code);
    const ticket = await googleClient().verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    const mail = p && p.sub && p.email_verified ? canonicalEmail(p.email) : null;
    if (!mail) return renderAuth(res, 'login', FAIL, 400);

    // 1) this Google account is already linked to a user
    let [rows] = await pool.query('SELECT id, username FROM users WHERE google_id = ?', [p.sub]);
    let user = rows[0];

    // 2) an account with the same verified email exists: link only if it has no conflicting Google ID
    if (!user) {
      [rows] = await pool.query('SELECT id, username, google_id FROM users WHERE email_canonical = ?', [mail.canonical]);
      const match = rows[0];
      if (match) {
        if (match.google_id && match.google_id !== p.sub) {
          return renderAuth(res, 'login', 'This email is already linked to a different Google account.', 409);
        }
        if (!match.google_id) {
          try {
            const [upd] = await pool.query('UPDATE users SET google_id = ? WHERE id = ? AND google_id IS NULL', [p.sub, match.id]);
            if (upd.affectedRows !== 1) {
              const [chk] = await pool.query('SELECT google_id FROM users WHERE id = ?', [match.id]);
              if (!chk[0] || chk[0].google_id !== p.sub) {
                return renderAuth(res, 'login', 'This email is already linked to a different Google account.', 409);
              }
            }
          } catch (e) {
            if (e.code === 'ER_DUP_ENTRY') return renderAuth(res, 'login', 'This Google account is already linked to another user.', 409);
            throw e;
          }
        }
        // password, auth_provider and everything else on the existing account are left untouched
        user = { id: match.id, username: match.username };
      }
    }

    // 3) brand-new user (Gmail only)
    if (!user) {
      if (!mail.isGmail) return renderAuth(res, 'login', 'Only Gmail accounts can sign up.', 403);
      user = await createGoogleUser(p, mail);
      if (!user) return renderAuth(res, 'login', 'This email is already linked to a different Google account.', 409);
      await pool.query('DELETE FROM pending_signups WHERE email_canonical = ?', [mail.canonical]);
    }

    startSession(req, res, user, safePath(req.session.returnTo));
  } catch (err) {
    console.error(err);
    renderAuth(res, 'login', FAIL, 500);
  }
});

/* ----------------------------- forgot password ---------------------------- */

router.get('/forgot-password', (req, res) => renderAccount(res, 'forgot'));

router.post('/forgot-password', forgotLimiter, async (req, res) => {
  const GENERIC = `If an account exists for that email, a reset link is on its way. It works for ${RESET_TTL_MIN} minutes. Check your spam folder too.`;

  try {
    const mail = canonicalEmail(req.body && req.body.email);
    if (!mail) return renderAccount(res, 'forgot', { error: 'Please enter a valid email address.', status: 400 });

    const [rows] = await pool.query('SELECT id, email FROM users WHERE email_canonical = ?', [mail.canonical]);
    const user = rows[0];

    if (user) {
      const [recent] = await pool.query(
        'SELECT id FROM password_resets WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL ? SECOND) LIMIT 1',
        [user.id, RESEND_COOLDOWN_SEC]
      );
      if (recent.length === 0) {
        const token = crypto.randomBytes(32).toString('hex');
        await pool.query('DELETE FROM password_resets WHERE user_id = ?', [user.id]); // old links die
        await pool.query(
          'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))',
          [user.id, sha256(token), RESET_TTL_MIN]
        );
        const link = `${process.env.APP_URL}/reset-password/${token}`;
        // not awaited: response time is the same whether or not the account exists
        sendMail({
          to: user.email,
          subject: 'Reset your KravN password',
          text: `Use this link to reset your password (valid ${RESET_TTL_MIN} minutes, one use):\n${link}\n\nIf you didn't request this, ignore this email.`,
          html: `<p>Click to reset your KravN password (valid ${RESET_TTL_MIN} minutes, one use):</p><p><a href="${link}">Reset password</a></p><p>If you didn't request this, ignore this email.</p>`,
        }).catch((e) => console.error('reset mail failed', e));
      }
    }

    renderAccount(res, 'forgot', { notice: GENERIC, done: true });
  } catch (err) {
    console.error(err);
    renderAccount(res, 'forgot', { error: 'Something went wrong. Please try again.', status: 500 });
  }
});

const INVALID_LINK = 'This reset link is invalid or has expired. Request a new one.';

router.get('/reset-password/:token', async (req, res) => {
  res.set('Referrer-Policy', 'no-referrer');
  const { token } = req.params;
  try {
    if (!/^[a-f0-9]{64}$/.test(token)) return renderAccount(res, 'forgot', { error: INVALID_LINK, status: 400 });
    const [rows] = await pool.query(
      'SELECT id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()',
      [sha256(token)]
    );
    if (rows.length === 0) return renderAccount(res, 'forgot', { error: INVALID_LINK, status: 400 });
    renderAccount(res, 'reset', { token });
  } catch (err) {
    console.error(err);
    renderAccount(res, 'forgot', { error: 'Something went wrong. Please try again.', status: 500 });
  }
});

router.post('/reset-password', resetLimiter, async (req, res) => {
  res.set('Referrer-Policy', 'no-referrer');
  const { token, password, confirm } = req.body || {};

  try {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
      return renderAccount(res, 'forgot', { error: INVALID_LINK, status: 400 });
    }
    const pwError = checkPassword(password);
    if (pwError) return renderAccount(res, 'reset', { error: pwError, token, status: 400 });
    if (password !== confirm) return renderAccount(res, 'reset', { error: 'Passwords do not match.', token, status: 400 });

    const hashed = await bcrypt.hash(password, BCRYPT_COST);
    const tokenHash = sha256(token);

    const conn = await pool.getConnection();
    let userEmail = null;
    try {
      await conn.beginTransaction();
      // atomic claim: a token can be used exactly once
      const [claim] = await conn.query(
        'UPDATE password_resets SET used_at = NOW() WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()',
        [tokenHash]
      );
      if (claim.affectedRows !== 1) {
        await conn.rollback();
        return renderAccount(res, 'forgot', { error: INVALID_LINK, status: 400 });
      }
      const [[row]] = await conn.query('SELECT user_id FROM password_resets WHERE token_hash = ?', [tokenHash]);
      await conn.query('UPDATE users SET password = ? WHERE id = ?', [hashed, row.user_id]);
      await conn.query('DELETE FROM password_resets WHERE user_id = ?', [row.user_id]);
      const [[u]] = await conn.query('SELECT email FROM users WHERE id = ?', [row.user_id]);
      userEmail = u && u.email;
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    if (userEmail) {
      sendMail({
        to: userEmail,
        subject: 'Your KravN password was changed',
        text: "Your KravN password was just changed. If this wasn't you, reset it again immediately.",
        html: "<p>Your KravN password was just changed.</p><p>If this wasn't you, reset it again immediately.</p>",
      }).catch((e) => console.error('confirmation mail failed', e));
    }

    req.session.notice = 'Password updated. Log in with your new password.';
    req.session.save(() => res.redirect('/login'));
  } catch (err) {
    console.error(err);
    renderAccount(res, 'forgot', { error: 'Something went wrong. Please try again.', status: 500 });
  }
});

/* ---------------------------------- about --------------------------------- */

const FAVORITE_MOVIES = [
  'Interstellar', 'Avengers: Endgame', 'Spider-Man: No Way Home', 'Spider-Man: Into the Spider-Verse',
  'Your Name.', 'Fight Club', 'The Shawshank Redemption', 'Dead Poets Society', 'Inception', 'The Dark Knight',
  'Avengers: Infinity War', 'Spider-Man 2', 'Spider-Man: Across the Spider-Verse', 'Good Will Hunting',
  'Forrest Gump', 'The Prestige', 'The Truman Show', 'Eternal Sunshine of the Spotless Mind', 'The Matrix',
  'Oppenheimer', 'The Green Mile', 'Whiplash', 'Dune: Part Two', 'Dune', 'Everything Everywhere All at Once',
  'Weathering with You', 'A Silent Voice', 'Suzume', 'The Lord of the Rings: The Return of the King',
  'Gladiator', 'The Godfather', '12 Angry Men', 'The Pursuit of Happyness', 'The Social Network', 'Parasite',
  'The Wolf of Wall Street', 'The Departed',
];

let favoritePosters = null;

async function getFavoritePosters() {
  if (favoritePosters) return favoritePosters;
  const found = await Promise.all(
    FAVORITE_MOVIES.map(async (title) => {
      const { results } = await tmdb.searchMovies(title);
      const want = tmdb.normalize(title);
      const films = results.filter((m) => m.type === 'movie');
      const hit = films.find((m) => tmdb.normalize(m.title) === want && m.poster) || films.find((m) => m.poster);
      return hit ? { id: hit.id, url: hit.url, title: hit.title, poster: hit.poster } : null;
    })
  );
  const list = found.filter(Boolean);
  if (list.length > 10) favoritePosters = list; // only cache a healthy result
  return list;
}

router.get('/about', async (req, res) => {
  res.render('about', { nav: 'about', favorites: await getFavoritePosters() });
});

module.exports = router;