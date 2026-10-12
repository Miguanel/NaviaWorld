/* Service worker „Cieni Navii”.
 * - Szkielet aplikacji (HTML/CSS/JS/ikony) ładuje się natychmiast z pamięci urządzenia,
 *   a w tle pobierana jest świeża wersja (stale-while-revalidate).
 * - Do pamięci trafiają tylko prawdziwe odpowiedzi naszego serwera (nagłówek X-Navia),
 *   nigdy strona zastępcza hostingu wyświetlana, gdy serwer się budzi.
 * - Zapytania /api/ zawsze idą do sieci (świat jest na serwerze).
 */
const VERSION = 'navia-v5';
const SHELL = [
  '/', '/static/css/style.css', '/static/js/api.js', '/static/js/ui.js', '/static/js/map.js',
  '/static/js/combat.js', '/static/js/bag.js', '/static/js/finder.js', '/static/js/game.js', '/static/icons/icon.svg',
  '/static/icons/icon-192.png', '/static/icons/icon-512.png', '/manifest.webmanifest',
];
const EXT = VERSION + '-ext';

const ours = res => res && res.ok && res.headers.get('X-Navia') === '1';

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all(SHELL.map(async url => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (ours(res)) await c.put(url, res);
      } catch (err) { /* offline — spróbujemy następnym razem */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => ![VERSION, EXT, EXT + '-tiles'].includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function staleWhileRevalidate(req, key) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(key || req, { ignoreSearch: true });
  const network = fetch(req).then(res => {
    if (ours(res)) cache.put(key || req, res.clone());
    return res;
  }).catch(() => null);
  if (cached) {
    network.catch(() => {});
    return cached;
  }
  const res = await network;
  return res || new Response('Brak połączenia', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

async function cacheFirstExternal(req) {
  const cache = await caches.open(EXT);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return; // zawsze sieć
    if (req.mode === 'navigate') {
      e.respondWith(staleWhileRevalidate(req, '/'));
      return;
    }
    if (url.pathname.startsWith('/static/') || url.pathname === '/manifest.webmanifest') {
      e.respondWith(staleWhileRevalidate(req));
    }
    return;
  }
  // biblioteki (Leaflet), czcionki — najpierw pamięć
  if (url.host.includes('unpkg.com') || url.host.includes('fonts.googleapis.com') || url.host.includes('fonts.gstatic.com')) {
    e.respondWith(cacheFirstExternal(req));
    return;
  }
  // kafelki mapy — najpierw pamięć, ale z limitem rozmiaru, żeby nie zapchać telefonu
  if (url.host.includes('basemaps.cartocdn.com') || url.host.includes('tile.openstreetmap.org')) {
    e.respondWith((async () => {
      const cache = await caches.open(EXT + '-tiles');
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) {
        cache.put(req, res.clone());
        cache.keys().then(keys => { if (keys.length > 1500) keys.slice(0, 300).forEach(k => cache.delete(k)); });
      }
      return res;
    })());
  }
});
