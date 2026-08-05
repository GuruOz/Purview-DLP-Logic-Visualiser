// js/har-worker.js — runs in a Web Worker.
// Extracts the DLP payloads (rules, policies, sensitive information types) from a
// Purview portal HAR capture. This file only does brute-force JSON work on the
// potentially huge HAR; all RuleXml/XML parsing stays on the main thread in
// har-parser.js because DOMParser is not available in a Worker.
//
// The extraction logic lives in js/har-extract.js (shared with the file://
// fallback path in har-import.js) and is loaded here via importScripts.
//
// Same-origin worker: the app CSP (index.html) has no worker-src, so it falls back
// to default-src 'self' — no CSP edit is needed. Note: when index.html is opened
// directly from disk (file://), the page has an opaque origin and Workers cannot be
// constructed at all — har-import.js detects that and falls back to the main thread.

// Resolved relative to THIS script (js/har-worker.js), not to the page — so it must
// be the bare filename. 'js/har-extract.js' would request js/js/har-extract.js.
importScripts('har-extract.js');

self.onmessage = async (e) => {
    try {
        self.postMessage({ type: 'progress', phase: 'reading' });
        const text = await e.data.file.text();
        self.postMessage({ type: 'progress', phase: 'parsing' });
        const { entries, skippedEntries } = self.extractHarEntries(text);
        const payload = self.extractDlpPayloads(entries);
        self.postMessage({ type: 'done', payload, skippedEntries });
    } catch (err) {
        self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
    }
};
