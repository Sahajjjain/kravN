const BASIC = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LEN = 100; // users.email is VARCHAR(100)

// Strict: NEW email signups only
function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length > MAX_LEN || !BASIC.test(email)) return null;
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const isGmail = domain === 'gmail.com' || domain === 'googlemail.com';
  if (!isGmail) return { email, canonical: email, isGmail: false };
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  const base = local.split('+')[0].replace(/\./g, '');
  if (!/^[a-z0-9]{6,30}$/.test(base)) return null;
  return { email: `${local}@gmail.com`, canonical: `${base}@gmail.com`, isGmail: true };
}

// Lenient: login, forgot-password, Google. Identical to the SQL backfill.
function canonicalEmail(raw) {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length > MAX_LEN || !BASIC.test(email)) return null;
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (domain !== 'gmail.com' && domain !== 'googlemail.com') {
    return { email, canonical: email, isGmail: false };
  }
  const base = local.split('+')[0].replace(/\./g, '');
  if (!base) return null;
  return { email: `${local}@gmail.com`, canonical: `${base}@gmail.com`, isGmail: true };
}

module.exports = { normalizeEmail, canonicalEmail };