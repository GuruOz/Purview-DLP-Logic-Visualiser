// Tests for extractHarEntries in js/har-extract.js — the tolerant HAR reader.
// Motivated by a real 127 MB Purview capture that DevTools wrote with a torn line
// inside an _initiator.stack.callFrames array: a deeply-indented region was spliced
// mid-property, giving `"        "scriptId": "2344",` and failing JSON.parse ~46%
// into the file. A whole-file parse loses all 942 entries over the one bad one.

// Entries indented 6 spaces with 8-space properties — the shape DevTools emits, and
// what the newline-anchored splitter keys off.
const entry = (url, body) =>
    '      {\n' +
    '        "request": {\n' +
    '          "url": "' + url + '"\n' +
    '        },\n' +
    '        "response": {\n' +
    '          "content": {\n' +
    '            "text": ' + JSON.stringify(JSON.stringify(body)) + '\n' +
    '          }\n' +
    '        }\n' +
    '      }';

const har = entries => '{\n  "log": {\n    "entries": [\n' + entries.join(',\n') + '\n    ]\n  }\n}';

const dlpBody = (dataType, count) => ({
    DataType: dataType,
    ResultCode: 'Success',
    RecordCount: count,
    ResultData: Array.from({ length: count }, (_, i) => ({ Name: dataType + '-' + i }))
});

const goodEntry = n => entry('https://x/di/find/Dlp?n=' + n, dlpBody('DlpComplianceRule', n));

// The real corruption: a property name is cut and a fragment from a deeper region is
// spliced in. Note the ODD number of quotes — that is what desyncs a quote-tracking
// scanner and made it swallow the following entries uncounted.
const TORN = '      {\n' +
    '        "request": {\n' +
    '          "url": "https://x/di/find/Dlp?n=99"\n' +
    '        "        "scriptId": "2344",\n' +
    '                    "lineNumber": 23\n' +
    '        }\n' +
    '      }';

// ---------------------------------------------------------------------------
describe('extractHarEntries', () => {
    test('well-formed capture takes the fast path with nothing skipped', () => {
        const { entries, skippedEntries } = window.extractHarEntries(har([goodEntry(1), goodEntry(2)]));
        expect(entries).toHaveLength(2);
        expect(skippedEntries).toBe(0);
        expect(entries[0].request.url).toContain('/di/find/Dlp');
    });

    test('recovers surrounding entries when one is torn mid-property', () => {
        const { entries, skippedEntries } = window.extractHarEntries(har([goodEntry(1), TORN, goodEntry(2)]));

        expect(skippedEntries).toBe(1);
        const urls = entries.map(e => e.request.url);
        expect(urls).toEqual(['https://x/di/find/Dlp?n=1', 'https://x/di/find/Dlp?n=2']);
    });

    test('a torn entry loses only itself — every other entry stays accounted for', () => {
        // Regression guard: the previous quote/brace scanner desynced on the odd quote
        // above and silently dropped 12 of the real capture's entries without counting
        // them. parsed + skipped must always equal the number of entries present.
        const good = Array.from({ length: 20 }, (_, i) => goodEntry(i + 1));
        const withTorn = good.slice(0, 7).concat([TORN], good.slice(7));

        const { entries, skippedEntries } = window.extractHarEntries(har(withTorn));

        expect(entries.length + skippedEntries).toBe(21);
        expect(entries).toHaveLength(20);
        expect(skippedEntries).toBe(1);
    });

    test('recovered entries still feed extractDlpPayloads', () => {
        const text = har([
            entry('https://x/di/find/Dlp', dlpBody('DlpComplianceRule', 3)),
            TORN,
            entry('https://x/di/find/Dlp', dlpBody('DlpCompliancePolicy', 2)),
            entry('https://x/di/find/Dlp', dlpBody('DlpSensitiveInformationType', 4))
        ]);

        const { entries } = window.extractHarEntries(text);
        const payload = window.extractDlpPayloads(entries);
        expect(payload.rules).toHaveLength(3);
        expect(payload.policies).toHaveLength(2);
        expect(payload.sits).toHaveLength(4);
    });

    test('braces and brackets inside string values do not split an entry', () => {
        // Response bodies are JSON-in-a-string full of {} and [] — miscounting these
        // would truncate every entry in a real capture.
        const body = dlpBody('DlpComplianceRule', 1);
        body.ResultData[0].RuleXml = '<Rule><Group operator="And">{[}]"quoted"</Group></Rule>';
        // Trailing garbage forces the tolerant path without touching the entries.
        const text = har([entry('https://x/di/find/Dlp', body), goodEntry(2)]) + ' trailing-garbage';

        const { entries, skippedEntries } = window.extractHarEntries(text);
        expect(skippedEntries).toBe(0);
        expect(entries).toHaveLength(2);
        expect(entries[0].response.content.text).toContain('RuleXml');
    });

    test('handles a 4-space-indented exporter, not just DevTools 2-space output', () => {
        const wide = s => s.replace(/^( +)/gm, (_m, sp) => ' '.repeat(sp.length * 2));
        const text = wide(har([goodEntry(1), TORN, goodEntry(2)]));

        const { entries, skippedEntries } = window.extractHarEntries(text);
        expect(entries).toHaveLength(2);
        expect(skippedEntries).toBe(1);
    });

    test('an "entries" key inside a captured response body does not hijack the scan', () => {
        // A captured body legitimately containing {"entries":[...]} appears in the raw
        // text as \"entries\": — the escape means it must not be mistaken for log.entries.
        const decoy = { DataType: 'DlpComplianceRule', ResultCode: 'Success', RecordCount: 1, entries: [1, 2, 3], ResultData: [{ Name: 'Real' }] };
        const text = har([entry('https://x/di/find/Dlp', decoy), goodEntry(2)]) + ' trailing-garbage';

        const { entries, skippedEntries } = window.extractHarEntries(text);
        expect(skippedEntries).toBe(0);
        expect(entries).toHaveLength(2);
    });

    test('falls back to brace scanning for a minified capture', () => {
        // No newlines to anchor on, so splitPrettyEntries bows out.
        const minified = JSON.stringify({ log: { entries: [{ request: { url: 'https://x/a' } }] } }) + ' garbage';
        const { entries } = window.extractHarEntries(minified);
        expect(entries).toHaveLength(1);
        expect(entries[0].request.url).toBe('https://x/a');
    });

    test('throws a clear error when there is no entries array to recover', () => {
        expect(() => window.extractHarEntries('{"log": broken')).toThrow(/no log\.entries array/);
    });
});
