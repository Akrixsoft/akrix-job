/* Akrix Пульт — служебный файл для значка на главный экран (23.11.2026). Ничего не кэширует: пульт всегда онлайн. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
