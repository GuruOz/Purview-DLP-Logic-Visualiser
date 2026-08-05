// Tests for sw.js cache bookkeeping.
// The service worker is cache-first with no revalidation and activate() only drops
// caches whose name differs from CACHE_NAME, so a CACHE_NAME that lags APP_VERSION
// pins every returning visitor to the JS they first loaded. It stayed on v1.6.2
// from 1.7.0 through 1.10.0 and served pre-recovery har-import.js against a HAR the
// current code handles. These two checks fail the build instead.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(join(root, file), 'utf-8');

const sw = read('sw.js');
const cacheName = /const CACHE_NAME = '([^']+)'/.exec(sw)?.[1];
const assets = [...sw.matchAll(/'(\/purview-dlp-logic-visualiser\/[^']*)'/g)].map(m => m[1]);

describe('service worker cache', () => {
    test('CACHE_NAME tracks APP_VERSION so returning visitors get new code', () => {
        const appVersion = /window\.APP_VERSION = '([^']+)'/.exec(read('js/version.js'))?.[1];
        expect(appVersion).toBeTruthy();
        expect(cacheName).toBe(`dlp-visualizer-v${appVersion}`);
    });

    test('every script index.html loads is precached', () => {
        const scripts = [...read('index.html').matchAll(/<script src="(js\/[^"]+)"><\/script>/g)]
            .map(m => m[1]);
        expect(scripts.length).toBeGreaterThan(0);

        const missing = scripts.filter(s => !assets.includes(`/purview-dlp-logic-visualiser/${s}`));
        expect(missing).toEqual([]);
    });
});
