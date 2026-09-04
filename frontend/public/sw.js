/* Doorway Cortex Bio-Pass — Service Worker (PWA + Web Push) */

// Bump on every deploy that must invalidate old caches. The `activate` handler
// deletes any cache whose name is not this one.
const CACHE_NAME = 'biopass-cache-v5';

// Only truly static, rarely-changing assets are pre-cached. The app shell
// (index.html) and hashed JS/CSS are handled network-first so a new deploy
// always reaches the user on the next load.
const PRECACHE_ASSETS = [
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.map((n) => (n !== CACHE_NAME ? caches.delete(n) : null))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET' || url.protocol.startsWith('chrome-extension')) return;

  // API: never intercept (encrypted medical data, auth, live status).
  if (url.pathname.startsWith('/api/')) return;

  const isHashedAsset =
    url.pathname.startsWith('/assets/') || /\.(js|css)$/.test(url.pathname);
  const isMedia = /\.(png|svg|jpg|jpeg|webp|gif|ico|woff2?|ttf)$/.test(url.pathname);

  // App shell + hashed JS/CSS: NETWORK-FIRST. Guarantees new deploys propagate;
  // falls back to cache only when offline.
  if (event.request.mode === 'navigate' || isHashedAsset) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() =>
          caches
            .match(event.request)
            .then((cached) => cached || caches.match('/index.html') || Response.error()),
        ),
    );
    return;
  }

  // Images / fonts: cache-first (safe — they don't gate behaviour).
  if (isMedia) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((res) => {
            if (res && res.status === 200) {
              const clone = res.clone();
              caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
            }
            return res;
          }),
      ),
    );
  }
});

/* Web Push Notifications */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Bio-Pass', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Doorway Cortex Bio-Pass';
  const options = {
    body: data.body || '',
    tag: data.tag || 'biopass',
    renotify: true,
    requireInteraction: !!data.requireInteraction,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/', ...(data.data || {}) },
    vibrate: data.requireInteraction ? [200, 100, 200, 100, 200] : [120],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(target);
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});
