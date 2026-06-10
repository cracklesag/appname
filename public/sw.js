// Minimal PWA service worker.
// - Static icons/manifest: precached so the app launches when offline.
// - Build assets (/_next/static/, content-hashed + immutable): cache-first, so
//   navigating between pages doesn't re-download the same JS/CSS over a weak
//   signal. New deploys ship new filenames, so this never serves stale code.
// - Everything else (HTML documents, RSC data payloads): network-first, falling
//   back to cache only when offline — so logged farm data is always fresh.
// Data sync (queue writes when offline) is a later milestone.

const CACHE_NAME = 'app-shell-v5';
const STATIC_ASSETS = [
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function putInCache(req, res) {
  // Only cache complete, successful, basic (same-origin) responses.
  if (!res || res.status !== 200 || res.type === 'opaque') return;
  const copy = res.clone();
  caches.open(CACHE_NAME).then((c) => c.put(req, copy));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch Supabase/3rd-party
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  // Immutable, content-hashed build assets + icons → cache-first.
  const isImmutable =
    url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/');
  if (isImmutable) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          putInCache(req, res);
          return res;
        });
      })
    );
    return;
  }

  // Everything else → network-first, cache fallback when offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (STATIC_ASSETS.includes(url.pathname)) putInCache(req, res);
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('/')))
  );
});


// --- Web push (added Phase 5) ---------------------------------------------
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'Swardly', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Swardly';
  const options = {
    body: data.body || '',
    tag: data.tag || undefined,
    data: { url: data.url || '/' },
    icon: '/icons/swardly-mark.png',
    badge: '/icons/swardly-mark.png',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) { try { c.navigate(target); } catch (e) {} return c.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
