// Must match window.APP_VERSION in js/version.js — the fetch handler below is
// cache-first with no revalidation, so a cached asset is served until the cache
// is dropped, and activate() only drops caches whose name differs from this one.
// Leaving this stale ships old JS to everyone who has already loaded the app.
// tests/sw-cache.test.js fails the build if the two drift apart.
const CACHE_NAME = 'dlp-visualizer-v1.10.0';

const ASSETS = [
    '/purview-dlp-logic-visualiser/',
    '/purview-dlp-logic-visualiser/index.html',
    '/purview-dlp-logic-visualiser/simulator.html',
    '/purview-dlp-logic-visualiser/summary.html',
    '/purview-dlp-logic-visualiser/settings.html',
    '/purview-dlp-logic-visualiser/regex.html',
    '/purview-dlp-logic-visualiser/css/styles.css',
    '/purview-dlp-logic-visualiser/js/version.js',
    '/purview-dlp-logic-visualiser/js/nav.js',
    '/purview-dlp-logic-visualiser/js/logger.js',
    '/purview-dlp-logic-visualiser/js/constants.js',
    '/purview-dlp-logic-visualiser/js/state.js',
    '/purview-dlp-logic-visualiser/js/nl-generator.js',
    '/purview-dlp-logic-visualiser/js/evaluator.js',
    '/purview-dlp-logic-visualiser/js/parser.js',
    '/purview-dlp-logic-visualiser/js/har-worker.js',
    '/purview-dlp-logic-visualiser/js/har-extract.js',
    '/purview-dlp-logic-visualiser/js/har-parser.js',
    '/purview-dlp-logic-visualiser/js/har-import.js',
    '/purview-dlp-logic-visualiser/js/policy-csv.js',
    '/purview-dlp-logic-visualiser/js/conflict-detector.js',
    '/purview-dlp-logic-visualiser/js/ui.js',
    '/purview-dlp-logic-visualiser/js/examples.js',
    '/purview-dlp-logic-visualiser/js/app.js',
    '/purview-dlp-logic-visualiser/js/simulator-ui.js',
    '/purview-dlp-logic-visualiser/js/summary-ui.js',
    '/purview-dlp-logic-visualiser/js/settings-ui.js',
    '/purview-dlp-logic-visualiser/js/regex-builder.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Cache-first for local assets, network-first for AI API calls
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Let AI API calls go straight to network — never cache them
    const apiHosts = ['api.openai.com', 'generativelanguage.googleapis.com', 'api.anthropic.com', 'api.deepseek.com'];
    if (apiHosts.includes(url.hostname)) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Cache-first for everything else
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                if (response.ok && event.request.method === 'GET') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            });
        })
    );
});
