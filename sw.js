// Service Worker für die Push-Nachrichten des Köcheclub Werne.
// Erfasst ab dieser Version getrennt: angezeigt, geöffnet (angetippt) und geschlossen.
const RECEIPT_URL = 'https://ptblnpiroqftcvlsrhac.supabase.co/functions/v1/kc-communication-push-receipt';
const DEFAULT_URL = 'https://sire65.github.io/KC-Spruchauswahl/push.html';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

async function receipt(data, state) {
  data = data || {};
  const requestId = String(data.requestId || '');
  const memberMessageToken = String(data.memberMessageToken || '');
  if (!requestId && !memberMessageToken) return;

  let endpoint = '';
  try {
    const sub = await self.registration.pushManager.getSubscription();
    endpoint = sub && sub.endpoint ? sub.endpoint : '';
  } catch {}

  try {
    await fetch(RECEIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, memberMessageToken, endpoint, state }),
    });
  } catch {
    // Eine fehlende Quittung darf die Push-Anzeige niemals verhindern.
  }
}

self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { body: event.data ? event.data.text() : '' };
  }

  const title = msg.title || 'Köcheclub Werne';
  const data = msg.data || {};
  const options = {
    body: msg.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data,
    requireInteraction: true,
    tag: data.notificationId || data.requestId || data.memberMessageToken || undefined,
  };

  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    await receipt(data, 'displayed');
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || DEFAULT_URL;

  event.waitUntil(Promise.allSettled([
    receipt(data, 'opened'),
    self.clients.openWindow(url),
  ]));
});

self.addEventListener('notificationclose', (event) => {
  const data = event.notification.data || {};
  event.waitUntil(receipt(data, 'dismissed'));
});
