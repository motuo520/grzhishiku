const CACHE_NAME = 'psb-cache-v1';
const STATIC_EXTENSIONS = /\.(js|css|png|jpg|jpeg|svg|gif|webp|woff|woff2|ttf|ico|json|mp3|wav)$/;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll([
        '/',
        '/index.html',
        '/brain.svg',
        '/icon-192.png',
        '/icon-512.png',
        '/manifest.json',
      ]).catch(() => {})
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API / dynamic requests: network only
  if (url.pathname.startsWith('/api/') || request.method !== 'GET') {
    return;
  }

  // Static assets: cache first, fallback to network
  if (STATIC_EXTENSIONS.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Navigation / HTML: network first, fallback to cached index.html for offline SPA
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(() => caches.match('/index.html'))
    );
  }
});
