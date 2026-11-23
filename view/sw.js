/* Akrix view — офлайн-копия страницы просмотра (сборка e1d2e97a20): сначала сеть, нет сети — сохранённая копия. Запросы к серверу Job не кэшируются. */
const C = 'akx-view';
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.add('./')).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || !u.pathname.startsWith(new URL('./', location.href).pathname)) return;
  const key = new URL('./', location.href).href;   /* одна страница: ?order=… — та же копия */
  e.respondWith(fetch(r).then(res => { if (res.ok && (u.pathname.endsWith('/') || u.pathname.endsWith('index.html'))) { const cp = res.clone(); caches.open(C).then(c => c.put(key, cp)); } return res; })
    .catch(() => caches.open(C).then(c => c.match(key)).then(m => m || Response.error())));
});
