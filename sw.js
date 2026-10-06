// ARAHAS PPE — service worker. Bump CACHE on every deploy that changes a
// cached file, so returning devices pick up the new shell instead of a
// stale one stuck in the cache.
const CACHE = 'arahas-ppe-shell-v2';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/favicon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for the API and navigations (always want live data when
// online); cache-first for the static shell (instant load, works offline).
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return; // never intercept POST /api/rpc

  if (url.pathname.startsWith('/api/')) return; // API always goes to the network

  if (SHELL.includes(url.pathname) || url.pathname === '/') {
    event.respondWith(
      fetch(event.request)
        .then((resp) => { caches.open(CACHE).then((c) => c.put(event.request, resp.clone())); return resp; })
        .catch(() => caches.match(event.request).then((r) => r || caches.match('/index.html')))
    );
  }
});

// ---- Push notifications: a request is waiting for Caleb or the store keeper ----
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'ARAHAS PPE', body: event.data ? event.data.text() : 'You have an update.' }; }
  const title = data.title || 'ARAHAS PPE';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'ppe-update',
    renotify: true,
    data: { url: data.url || '/' },
    vibrate: [80, 40, 80]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) { c.navigate(url); return c.focus(); } }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
