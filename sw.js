// Service worker: network-first for same-origin GETs, cached copy when offline.
var CACHE = 'rb-runtime';
var PRECACHE = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];

self.addEventListener('install', function (e) {
  e.waitUntil((async function () {
    try { var c = await caches.open(CACHE); await c.addAll(PRECACHE); } catch (err) { /* a missing file must not fail install */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async function () {
    try {
      var res = await fetch(req);
      if (res && res.status === 200 && res.type === 'basic') {
        try { var c = await caches.open(CACHE); await c.put(req, res.clone()); } catch (err) { /* ignore */ }
      }
      return res;
    } catch (err) {
      var c2 = await caches.open(CACHE);
      var hit = await c2.match(req) || await c2.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        hit = await c2.match('./index.html') || await c2.match('./');
        if (hit) return hit;
      }
      return Response.error();
    }
  })());
});
