/* KravN service worker: network-first, so pages are never stale; cached copies are only a fallback offline. */
const CACHE = 'kravn-v4';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/css/kravn.css', '/js/core.js', '/js/cards.js', '/js/eggs.js']).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return; // never cache API / cross-origin

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (req.destination === 'style' || req.destination === 'script' || req.destination === 'image')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || Response.error()))
  );
});
