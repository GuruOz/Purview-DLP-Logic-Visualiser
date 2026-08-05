// js/har-extract.js — shared DLP-payload extraction.
// Loaded as a classic script on the main thread AND via importScripts inside
// har-worker.js, so the same bucketing logic serves both the worker path and the
// file:// fallback path. Pure JSON logic — no DOM, no DOMParser, no worker APIs.
(function(global) {
    // Best-effort recovery for captures whose JSON is damaged. DevTools can emit a
    // torn write inside a long _initiator.stack.callFrames array — a real 127 MB
    // capture spliced a deeply-indented region mid-property, giving
    // `"        "scriptId": "2344",` and a JSON.parse failure ~46% into the file.
    // A whole-file parse loses all 943 entries over the one bad one.

    // Primary strategy: split on line-anchored entry boundaries.
    //
    // A literal newline can never appear inside a JSON string — it must be escaped as
    // \n — so in pretty-printed output "newline + entry indent + {" is an unambiguous
    // entry boundary. That matters because a torn line usually leaves an ODD number of
    // quotes, which permanently desyncs any quote/brace scanner: it then reads the
    // following entries' braces as string content and swallows them. Splitting on the
    // newline anchor is immune to that, so every entry stays accounted for —
    // entries.length + skippedEntries always equals what the file really contains.
    function splitPrettyEntries(text, openIdx) {
        const first = /\n([ \t]+)\{\n/.exec(text.slice(openIdx, openIdx + 4096));
        if (!first) return null; // not pretty-printed — caller falls back to scanning
        const indent = first[1];

        const anchor = new RegExp('\\n' + indent + '\\{\\n', 'g');
        anchor.lastIndex = openIdx;
        const starts = [];
        let m;
        while ((m = anchor.exec(text)) !== null) {
            starts.push(m.index + 1); // the '{' itself
            anchor.lastIndex = m.index + 1;
        }
        if (starts.length === 0) return null;

        // The last entry ends at its own closing brace, which sits on a line at exactly
        // the entry indent. Anchoring on that rather than on the array's "]" avoids
        // assuming a 2-space indent step, so 4-space exporters work too. A literal
        // newline cannot occur inside a string, so this cannot match entry content.
        const lastClose = text.lastIndexOf('\n' + indent + '}');
        const end = lastClose > starts[starts.length - 1]
            ? lastClose + 1 + indent.length + 1
            : text.length;

        const entries = [];
        let skipped = 0;
        for (let k = 0; k < starts.length; k += 1) {
            const to = k + 1 < starts.length ? starts[k + 1] : end;
            const chunk = text.slice(starts[k], to).replace(/[\s,]+$/, '');
            try {
                entries.push(JSON.parse(chunk));
            } catch (_e) {
                skipped += 1; // this one entry is torn; the rest are unaffected
            }
        }
        return { entries, skippedEntries: skipped };
    }

    // Fallback for minified captures (no newlines to anchor on), where quote-aware
    // brace tracking is the only option. Entries that never close, or whose depth goes
    // negative, are skipped and the scan resumes at the next plausible entry start.
    const ENTRY_BUDGET = 8 * 1024 * 1024; // bytes before we declare an entry stuck

    function scanBalancedEntries(text, openIdx) {
        const entries = [];
        let skipped = 0;
        const n = text.length;
        let i = openIdx + 1;
        let depth = 0;
        let inString = false;
        let entryStart = null;
        let entryBytes = 0;

        while (i < n) {
            const c = text[i];
            if (inString) {
                if (c === '\\') { i += 2; continue; }
                if (c === '"') inString = false;
            } else if (c === '"') {
                inString = true;
            } else if (c === '{') {
                if (depth === 0) { entryStart = i; entryBytes = 0; }
                depth += 1;
            } else if (c === '}') {
                depth -= 1;
                if (depth === 0 && entryStart !== null) {
                    try {
                        entries.push(JSON.parse(text.slice(entryStart, i + 1)));
                    } catch (_e) {
                        skipped += 1;
                    }
                    entryStart = null;
                } else if (depth < 0) {
                    skipped += 1;
                    depth = 0;
                    entryStart = null;
                }
            } else if (c === ']' && depth === 0 && entryStart === null) {
                let j = i + 1;
                while (j < n && (text[j] === ' ' || text[j] === '\t' || text[j] === '\r' || text[j] === '\n')) j += 1;
                if (j < n && text[j] === '}') break; // end of the entries array
            }

            if (entryStart !== null) {
                entryBytes += 1;
                if (entryBytes > ENTRY_BUDGET) {
                    skipped += 1; // stuck (corrupted) entry
                    entryStart = null;
                    depth = 0;
                }
            }
            i += 1;
        }

        return { entries, skippedEntries: skipped };
    }

    // text → { entries, skippedEntries }
    global.extractHarEntries = function(text) {
        // Fast path: the capture is well-formed.
        try {
            const data = JSON.parse(text);
            return { entries: ((data && data.log) || {}).entries || [], skippedEntries: 0 };
        } catch (_err) {
            // fall through to tolerant recovery
        }

        // Match the key and its '[' together. A bare indexOf('"entries"') can land on
        // the text of a captured response body, but an occurrence inside a JSON string
        // is escaped (\"entries\"), so the quote before 'e' never matches there.
        const arr = /"entries"\s*:\s*\[/.exec(text);
        const openIdx = arr ? arr.index + arr[0].length - 1 : -1;
        if (openIdx === -1) {
            throw new Error('HAR file is not valid JSON and has no log.entries array to recover from.');
        }

        return splitPrettyEntries(text, openIdx) || scanBalancedEntries(text, openIdx);
    };

    // Filter to the Purview API responses that carry DLP data and bucket them by the
    // envelope's own DataType field (robust to the several near-duplicate calls in a
    // capture), keeping the response with the highest RecordCount where the result is
    // a success. Also collects the portal's InvokeCommand responses (the PowerShell
    // bridge the UI uses when a rule is opened for editing), which carry FULL rule
    // data — populated AdvancedRule, ParentPolicyName, Policy GUID — that the Lite
    // list never contains.
    // The portal's content file-type table — the GUIDs that Item.ContentFileType and
    // ContentFileTypeMatches reference — is not served by any API. It is hardcoded in a
    // portal JS bundle (mip.js) as {id:"<guid>",name:"Word processing",format:"Word, PDF"}.
    // Scraping a minified bundle is a heuristic, so it is written to degrade safely: if
    // Microsoft renames these keys the regex matches nothing and callers fall back to
    // showing the raw GUID exactly as before.
    const FILE_TYPE_ROW = /\{id:"([0-9a-fA-F-]{36})",name:"([^"]{1,80})"(?:,format:"([^"]{0,80})")?/g;

    global.extractDlpPayloads = function(entries) {
        // Object.create(null): DataType is untrusted capture data — a literal
        // "__proto__" key must not be able to pollute the bucket object's prototype.
        const buckets = Object.create(null);
        const fullRules = [];
        const fullPolicies = [];
        const fileTypes = Object.create(null);

        entries.forEach(entry => {
            const url = (entry.request && entry.request.url) || '';

            // Script bundles are never API calls, so check first and skip the rest.
            if (url.indexOf('.js') !== -1) {
                const js = (entry.response && entry.response.content && entry.response.content.text) || '';
                if (js.indexOf(',format:"') === -1) return; // not the file-type table
                let row;
                FILE_TYPE_ROW.lastIndex = 0;
                while ((row = FILE_TYPE_ROW.exec(js)) !== null) {
                    const id = row[1].toLowerCase();
                    if (!fileTypes[id]) fileTypes[id] = { name: row[2], format: row[3] || '' };
                }
                return;
            }

            // Every catalog the portal loads lives under /di/find/<DataType>, and the
            // sensitivity label catalog is /di/find/Label — matching only /di/find/Dlp
            // silently excluded it. Bucketing is keyed off the envelope's own DataType
            // and only named buckets are read below, so the broader match is safe.
            if (url.includes('/di/find/')) {
                let body;
                try {
                    body = JSON.parse((entry.response && entry.response.content && entry.response.content.text) || '');
                } catch (_e) {
                    return; // not a JSON envelope — ignore
                }
                if (!body || typeof body !== 'object') return;

                const dataType = body.DataType;
                const resultCode = body.ResultCode;
                const resultData = body.ResultData;
                if (resultCode !== 'Success' || !Array.isArray(resultData)) return;
                if (!dataType) return;

                const recordCount = typeof body.RecordCount === 'number' ? body.RecordCount : 0;
                const existing = buckets[dataType];
                if (!existing || recordCount > existing.RecordCount) {
                    buckets[dataType] = { RecordCount: recordCount, ResultData: resultData };
                }
                return;
            }

            if (url.includes('/InvokeCommand')) {
                // Portal PowerShell bridge: {CmdletInput:{CmdletName, Parameters}} →
                // {value:[...]} with full rule/policy objects.
                let reqBody;
                let respBody;
                try {
                    reqBody = JSON.parse((entry.request.postData && entry.request.postData.text) || '');
                    respBody = JSON.parse((entry.response && entry.response.content && entry.response.content.text) || '');
                } catch (_e) {
                    return;
                }
                const cmd = reqBody && reqBody.CmdletInput && reqBody.CmdletInput.CmdletName;
                const values = respBody && Array.isArray(respBody.value) ? respBody.value : [];
                if (!cmd || values.length === 0) return;
                if (cmd === 'Get-DlpComplianceRule') {
                    const params = (reqBody.CmdletInput.Parameters) || {};
                    const policyGuid = params.policy || null;
                    values.forEach(v => fullRules.push({ rule: v, policyGuid }));
                } else if (cmd === 'Get-DlpCompliancePolicy') {
                    values.forEach(v => fullPolicies.push(v));
                }
            }
        });

        return {
            rules: (buckets.DlpComplianceRule || {}).ResultData || [],
            policies: (buckets.DlpCompliancePolicy || {}).ResultData || [],
            sits: (buckets.DlpSensitiveInformationType || {}).ResultData || [],
            // Sensitivity label catalog. RuleXml identifies a label by its INTERNAL name
            // (tagName, e.g. "Non Sensitive_2"); only this catalog carries the display
            // name and parent, and the display name alone is ambiguous — one real tenant
            // has 8 distinct labels all displaying as "NON-SENSITIVE".
            labels: (buckets.Label || {}).ResultData || [],
            // guid → { name, format }, scraped from the portal bundle (see above).
            fileTypes,
            fullRules,
            fullPolicies
        };
    };
})(typeof self !== 'undefined' ? self : window);
