// ─────────────────────────────────────────────────────────────────────────────
// Cento — service worker
// Caches all static assets on install; serves from cache first thereafter.
// Bump CACHE_VERSION whenever you deploy updated files.
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_VERSION = 'cento-v6';

const STATIC_ASSETS = [
    './',
    'index.html',
    'looks.css',
    'app.js',
    'components.js',
    'markdown.js',
    'manifest.json',
    'local/codemirror.min.js',
    'local/codemirror.min.css',
    'local/markdown.min.js',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'fonts/DMSans-VariableFont.ttf',
    'fonts/IBMPlexSans-VariableFont.ttf',
    'fonts/Inter-VariableFont.ttf',
    'fonts/JetBrainsMono-VariableFont.ttf',
    'fonts/Lora-Italic-VariableFont.ttf',
    'fonts/Lora-VariableFont.ttf',
    'fonts/PlayfairDisplay-VariableFont.ttf',
    'fonts/SourceSerif4-VariableFont.ttf',
];

// Maths + code-highlighting libraries. Cached if present, silently skipped if a file is
// missing (the app still works without them: maths shows as plain code, code is unhighlighted).
// A missing file here therefore can never break the service-worker install.
const OPTIONAL_ASSETS = [
    'local/katex/katex.min.js',
    'local/katex/katex.min.css',
    'local/highlightjs/highlight.min.js',
    'local/katex/fonts/KaTeX_AMS-Regular.woff2',
    'local/katex/fonts/KaTeX_Caligraphic-Bold.woff2',
    'local/katex/fonts/KaTeX_Caligraphic-Regular.woff2',
    'local/katex/fonts/KaTeX_Fraktur-Bold.woff2',
    'local/katex/fonts/KaTeX_Fraktur-Regular.woff2',
    'local/katex/fonts/KaTeX_Main-Bold.woff2',
    'local/katex/fonts/KaTeX_Main-BoldItalic.woff2',
    'local/katex/fonts/KaTeX_Main-Italic.woff2',
    'local/katex/fonts/KaTeX_Main-Regular.woff2',
    'local/katex/fonts/KaTeX_Math-BoldItalic.woff2',
    'local/katex/fonts/KaTeX_Math-Italic.woff2',
    'local/katex/fonts/KaTeX_SansSerif-Bold.woff2',
    'local/katex/fonts/KaTeX_SansSerif-Italic.woff2',
    'local/katex/fonts/KaTeX_SansSerif-Regular.woff2',
    'local/katex/fonts/KaTeX_Script-Regular.woff2',
    'local/katex/fonts/KaTeX_Size1-Regular.woff2',
    'local/katex/fonts/KaTeX_Size2-Regular.woff2',
    'local/katex/fonts/KaTeX_Size3-Regular.woff2',
    'local/katex/fonts/KaTeX_Size4-Regular.woff2',
    'local/katex/fonts/KaTeX_Typewriter-Regular.woff2',
];

// Install: cache everything
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then(async cache => {
                await cache.addAll(STATIC_ASSETS);
                await Promise.all(OPTIONAL_ASSETS.map(url => cache.add(url).catch(() => {})));
            })
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
