// Service Worker für die Push-Nachrichten des Köcheclub Werne (kc-member-push, gleiche VAPID-Schlüssel wie KC DP2).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch { msg = { body: event.data ? event.data.text() : '' }; }
  const title = msg.title || 'Köcheclub Werne';
  const options = {
    body: msg.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: msg.data || {},
    tag: (msg.data && msg.data.notificationId) || undefined
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || 'https://sire65.github.io/KC-Spruchauswahl/push.html';
  event.waitUntil(self.clients.openWindow(url));
});
