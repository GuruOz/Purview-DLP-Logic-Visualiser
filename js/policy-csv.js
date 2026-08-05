// js/policy-csv.js
// Imports the Purview portal's "DLP policies" CSV export (Name, Priority, Mode, …)
// and applies it to the current workspace. The HAR captures zero out every Priority
// field, but this UI export carries the real tenant-wide policy evaluation order and
// the authoritative On/Off state — so loading it after a HAR import restores the
// policy hierarchy. Note: the CSV is policy-level; per-rule priority is still not
// available anywhere in the portal's browser traffic.
//
// Pure logic (parsePolicyCsv / applyPolicyCsv) + UI wiring. No Worker needed — the
// CSV is tiny, so it reads on the main thread even from file://.

(function() {
    'use strict';

    // Quote-aware single CSV line parser (handles commas and doubled quotes inside
    // quoted fields, e.g. the "[object Object]" sync-status column).
    function parseCsvLine(line) {
        const cells = [];
        let cur = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (line[i + 1] === '"') { cur += '"'; i++; }
                    else inQuotes = false;
                } else {
                    cur += ch;
                }
            } else if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                cells.push(cur);
                cur = '';
            } else {
                cur += ch;
            }
        }
        cells.push(cur);
        return cells;
    }

    // text → [{ name, priority, enabled, mode }]
    // BOM-safe; the header row (and any row whose Priority cell is not an integer)
    // is skipped automatically. Mode maps On / Enable → enabled, Off / Disable →
    // disabled, "In simulation…" → enabled.
    window.parsePolicyCsv = function(text) {
        if (typeof text !== 'string') return [];
        const body = text.replace(/^\uFEFF/, '');
        const rows = [];

        body.split(/\r\n|\n|\r/).forEach(line => {
            const cells = parseCsvLine(line);
            if (cells.length < 2) return;
            const name = (cells[0] || '').trim();
            const priority = parseInt(cells[1], 10);
            if (!name || isNaN(priority)) return; // header row or malformed
            const mode = (cells[2] || '').trim();
            rows.push({
                name,
                priority,
                enabled: !/^(off|disable)/i.test(mode),
                mode
            });
        });

        return rows;
    };

    // Apply CSV rows to a workspace policy array (does not mutate it).
    // Returns { policies, matchedCount, unmatchedNames } — policies are reordered to
    // CSV priority order (stable: policies absent from the CSV keep their relative
    // order at the end), matched policies get their CSV priority and enabled state.
    window.applyPolicyCsv = function(policies, rows) {
        policies = Array.isArray(policies) ? policies : [];
        rows = Array.isArray(rows) ? rows : [];

        const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const byExact = new Map(policies.map(p => [p.name, p]));
        const byNorm = new Map();
        policies.forEach(p => {
            const k = norm(p.name);
            if (!byNorm.has(k)) byNorm.set(k, p);
        });

        const matched = [];
        const matchedNames = new Set();
        const unmatchedNames = [];

        rows.forEach(row => {
            let pol = byExact.get(row.name);
            if (!pol) pol = byNorm.get(norm(row.name));
            if (!pol) {
                unmatchedNames.push(row.name);
                return;
            }
            if (matchedNames.has(pol.name)) return; // duplicate CSV row
            matchedNames.add(pol.name);
            matched.push(Object.assign({}, pol, { priority: row.priority, enabled: row.enabled }));
        });

        const rest = policies.filter(p => !matchedNames.has(p.name));
        // Sort matched policies by CSV priority (ascending). The portal export is
        // already ordered, but an arbitrary row order must not change the result.
        matched.sort((a, b) => (a.priority - b.priority) || 0);
        return {
            policies: matched.concat(rest),
            matchedCount: matched.length,
            unmatchedNames
        };
    };

    // ------------------------------------------------------------------
    // UI wiring — "Load Policy CSV…" button + hidden file input
    // ------------------------------------------------------------------

    function showModalInfo(text) {
        const info = document.getElementById('modalInfo');
        if (info) { info.textContent = text; info.classList.remove('hidden'); }
    }

    function showModalError(text) {
        const err = document.getElementById('modalError');
        if (err) { err.textContent = text; err.classList.remove('hidden'); }
    }

    function hideModalStatus() {
        const info = document.getElementById('modalInfo');
        if (info) info.classList.add('hidden');
        const err = document.getElementById('modalError');
        if (err) err.classList.add('hidden');
    }

    window.loadPolicyCsvFile = function(file) {
        if (!file) return;
        hideModalStatus();
        file.text().then(text => {
            try {
                const rows = window.parsePolicyCsv(text);
                if (rows.length === 0) {
                    showModalError('No policy rows found in the CSV. Expected the portal export format: Name, Priority, Mode, …');
                    return;
                }
                const result = window.applyPolicyCsv(window.policies || [], rows);
                window.setPolicies(result.policies);
                window.setActivePolicyIndex(0);
                window.setActiveRuleIndex(0);
                window.saveState(`Applied policy priorities from "${file.name}"`);
                let summary = `Applied priorities and enabled state to ${result.matchedCount} of ${rows.length} policies from "${file.name}".`;
                if (result.unmatchedNames.length > 0) {
                    const shown = result.unmatchedNames.slice(0, 5).join(', ');
                    summary += ` ${result.unmatchedNames.length} CSV policies had no match in the workspace${shown ? ` (${shown}${result.unmatchedNames.length > 5 ? '…' : ''})` : ''}.`;
                }
                showModalInfo(summary);
                if (window.logEvent) {
                    window.logEvent('info', 'policy-csv', `Applied policy priorities from "${file.name}"`, {
                        matched: result.matchedCount,
                        total: rows.length,
                        unmatched: result.unmatchedNames
                    });
                }
                if (window.showToast) window.showToast('Policy priorities applied.', 'success');
            } catch (err) {
                showModalError('Could not parse policy CSV: ' + err.message);
            }
        }).catch(err => {
            showModalError('Could not read policy CSV: ' + (err && err.message ? err.message : String(err)));
        });
    };

    // Bind the hidden file input (script runs at the end of <body>, DOM is ready).
    const policyCsvInput = document.getElementById('policyCsvInput');
    if (policyCsvInput) {
        policyCsvInput.onchange = (e) => {
            const file = e.target.files && e.target.files[0];
            window.loadPolicyCsvFile(file);
            e.target.value = ''; // allow re-selecting the same file
        };
    }
})();
