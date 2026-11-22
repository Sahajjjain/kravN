const { safePath } = require('../lib/util');

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    // remember where they were headed (e.g. a shared discussion link) so login can bring them back
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      req.session.returnTo = safePath(req.originalUrl);
    }
    return res.redirect('/login');
  }
  next();
}

module.exports = requireLogin;
