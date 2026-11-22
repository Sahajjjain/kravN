/**
 * Renders a partial to an HTML string (for infinite-scroll JSON endpoints),
 * so the browser never has to rebuild markup that the server already knows how to draw.
 */
function fragment(res, view, data = {}) {
  return new Promise((resolve, reject) => {
    res.render(view, data, (err, html) => (err ? reject(err) : resolve(html)));
  });
}

// Sends { html, hasMore } for the client-side infinite scroller (public/js/core.js)
async function sendPage(res, view, data, hasMore) {
  const html = await fragment(res, view, data);
  res.json({ html, hasMore: !!hasMore });
}

module.exports = { fragment, sendPage };
