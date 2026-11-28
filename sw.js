const CACHE_NAME = 'cpa-study-hub-v2';
const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './coach-rules.js',
  './icon2.png',
  './manifest.json'
];

// 外部CDN（オフライン時でもUI・グラフが崩れないようランタイムキャッシュ対象にする）
const CACHEABLE_EXTERNAL_HOSTS = [
  'cdn.tailwindcss.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_ASSETS)).catch(() => { })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // API呼び出し（Google API / Vercel Serverless / GAS等）はキャッシュしない
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('googleapis.com') && !url.hostname.startsWith('fonts.') ||
    url.hostname.includes('accounts.google.com') ||
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('script.googleusercontent.com')
  ) {
    return;
  }

  const isSameOrigin = url.origin === self.location.origin;
  const isCacheableExternal = CACHEABLE_EXTERNAL_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h));

  if (!isSameOrigin && !isCacheableExternal) return;

  // HTMLナビゲーション・同一オリジンは Network-First（オフライン時はキャッシュへフォールバック）
  if (isSameOrigin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => {
            if (cached) return cached;
            if (req.mode === 'navigate') return caches.match('./index.html');
            return undefined;
          })
        )
    );
    return;
  }

  // 外部CDNアセットは Stale-While-Revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && (res.status === 200 || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
