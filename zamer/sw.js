// Akrix Замер — офлайн-кэш (страница — сначала сеть, остальное — из кэша)
const C = 'akrix-zamer-v38';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'akrix_markers.pdf'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(FILES)).then(() => self.skipWaiting())) });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim())) });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.mode === 'navigate') { e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put('index.html', cp)); return r }).catch(() => caches.match('index.html'))); return }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
