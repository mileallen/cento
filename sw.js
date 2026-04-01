// ─────────────────────────────────────────────────────────────────────────────
// Cento — service worker
// Caches all static assets on install; serves from cache first thereafter.
// Bump CACHE_VERSION whenever you deploy updated files.
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_VERSION = 'cento-v4';

const STATIC_ASSETS = [
    './',
    'index.html',
    'looks.css',
    'app.js',
    'manifest.json',
    'local/codemirror.min.js',
    'local/codemirror.min.css',
    'local/markdown.min.js',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'fonts/DM-Sans-300-normal.woff2',
    'fonts/DM-Sans-400-normal.woff2',
    'fonts/DM-Sans-500-normal.woff2',
    'fonts/DM-Sans-600-normal.woff2',
    'fonts/Lora-400-normal.woff2',
    'fonts/Lora-400-italic.woff2',
    'fonts/Lora-600-normal.woff2',
    'fonts/JetBrains-Mono-400-normal.woff2',
    'fonts/JetBrains-Mono-500-normal.woff2',
];

// Install: cache everything
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate: delete any old cache versions
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(key => key !== CACHE_VERSION)
                    .map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

// Fetch: cache-first for all requests
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            // Return cached file OR try to fetch from network
            return cachedResponse || fetch(event.request).catch(() => {
                // If both fail (offline & not in cache), 
                // you could return a fallback page here
                if (event.request.mode === 'navigate') {
                    return caches.match('index.html');
                }
            });
        })
    );
});
