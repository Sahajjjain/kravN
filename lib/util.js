// Resolves to `fallback` if `promise` is slower than `ms` (or fails) — keeps pages snappy
function withTimeout(promise, ms, fallback = null) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

const toInt = (v, def = 1, min = 1, max = 100000) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};

// Only allow same-site paths as post-login destinations (no open redirects)
const safePath = (p) => (typeof p === 'string' && /^\/(?![/\\])/.test(p) ? p : null);

module.exports = { withTimeout, toInt, safePath };
