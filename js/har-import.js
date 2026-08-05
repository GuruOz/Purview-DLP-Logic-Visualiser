// js/har-import.js
// Wires the "Import from HAR…" button and hidden file input in the Import / Export
// modal. The heavy lifting happens in a same-origin Web Worker (har-worker.js) so the
// main thread stays responsive while a large capture is parsed; the extracted payload
// is then shown in a preview modal where the user picks which rules to import, and the
// selection is committed through har-parser.js.
//
// Fallback: opening index.html directly from disk (file://) gives the page an opaque
// origin, so Workers cannot be constructed (SecurityError). In that case the same
// extraction logic (js/har-extract.js) runs on the main thread — still fully local,
// just without the responsiveness guarantee for very large captures.
//
// On commit the workspace is REPLACED (like every other importer) and persisted with
// a SINGLE saveState call — localStorage.setItem is monkey-patched into a 30-entry
// undo ring (state.js), so per-rule saves would blow the history away.

(function() {
    'use strict';

    let harWorker = null;
    let harImportInProgress = false;
    let harPendingPayload = null; // extracted {rules, policies, sits}, awaiting user selection
    let harPendingFileName = '';
    let harSelection = new Set(); // rule names the user has ticked
    let harAvailableNames = [];

    function showModalInfo(text) {
        const info = document.getElementById('modalInfo');
        if (!info) return;
        info.textContent = text;
        info.classList.remove('hidden');
    }

    function showModalError(text) {
        const err = document.getElementById('modalError');
        if (!err) return;
        err.textContent = text;
        err.classList.remove('hidden');
    }

    function hideModalStatus() {
        const info = document.getElementById('modalInfo');
        if (info) info.classList.add('hidden');
        const err = document.getElementById('modalError');
        if (err) err.classList.add('hidden');
    }

    function showPreviewError(text) {
        const err = document.getElementById('harPreviewError');
        if (!err) return;
        err.textContent = text;
        err.classList.remove('hidden');
    }

    function hidePreviewError() {
        const err = document.getElementById('harPreviewError');
        if (err) err.classList.add('hidden');
    }

    function buildSummary(report) {
        let summary;
        if (report.totalRules === report.ruleCount) {
            summary = `Imported ${report.ruleCount} rules into ${report.policyCount} policies.`;
        } else {
            summary = `Imported ${report.ruleCount} of ${report.totalRules} rules into ${report.policyCount} policies.`;
        }
        if (report.fullDetailCount > 0) {
            summary += ` ${report.fullDetailCount} with full rule detail from the portal (rules you clicked into).`;
        }
        if (report.unmatchedCount > 0) {
            summary += ` ${report.unmatchedCount} rules had no matching policy and were placed in Unmatched Rules (from HAR).`;
        }
        if (report.degradedConditions > 0) {
            const parts = [];
            if (report.keywordLists > 0) parts.push(`${report.keywordLists} keyword lists`);
            if (report.fileTypes > 0) parts.push(`${report.fileTypes} file-type conditions`);
            if (report.unresolvedSits > 0) parts.push(`${report.unresolvedSits} unresolved SITs`);
            if (report.unknownConditions > 0) parts.push(`${report.unknownConditions} unknown conditions`);
            summary += ` ${report.degradedConditions} conditions could not be fully resolved (${parts.join(', ')}) — these are marked in the rule.`;
        }
        return summary;
    }

    // Commit the user's selection: rebuild the workspace from only the selected rules.
    function commitHarSelection() {
        if (harSelection.size === 0) {
            showPreviewError('Select at least one rule to import.');
            return;
        }
        const payload = harPendingPayload;
        const fileName = harPendingFileName;
        const selectedNames = Array.from(harSelection);
        window.closeHarPreview();
        finishHarImport(payload, fileName, selectedNames);
    }

    // Shared completion for both the worker and the file:// fallback paths.
    function finishHarImport(payload, fileName, selectedNames) {
        try {
            const result = window.buildWorkspaceFromHar(payload, window.variables || [], selectedNames);
            window.setPolicies(result.policies);
            window.setVariables(result.variables);
            window.setActivePolicyIndex(0);
            window.setActiveRuleIndex(0);
            window.saveState(`Imported ${result.report.ruleCount} rules from HAR file "${fileName}"`);
            showModalInfo(buildSummary(result.report));
            if (window.logEvent) {
                window.logEvent('info', 'har-import', `Imported ${result.report.ruleCount} rules from HAR file "${fileName}"`, {
                    policyCount: result.report.policyCount,
                    unmatched: result.report.unmatchedNames,
                    warnings: result.report.warnings
                });
            }
            if (window.showToast) window.showToast('HAR workspace imported successfully!', 'success');
        } catch (err) {
            showModalError('Error building workspace from HAR: ' + err.message);
        } finally {
            harImportInProgress = false;
            harPendingPayload = null;
            harPendingFileName = '';
        }
    }

    // ------------------------------------------------------------------
    // Preview modal — let the user choose which rules to import
    // ------------------------------------------------------------------

    window.closeHarPreview = function() {
        const modal = document.getElementById('harPreviewModal');
        if (modal) modal.classList.add('hidden');
        harPendingPayload = null;
        harPendingFileName = '';
        harSelection = new Set();
        harAvailableNames = [];
    };

    function updateHarSelectionUI() {
        const countEl = document.getElementById('harSelectionCount');
        if (countEl) {
            countEl.textContent = `${harSelection.size} of ${harAvailableNames.length} rules selected`;
        }
        const btn = document.getElementById('harImportSelectedBtn');
        if (btn) {
            btn.textContent = `Import Selected (${harSelection.size})`;
            btn.disabled = harSelection.size === 0;
            btn.classList.toggle('opacity-50', harSelection.size === 0);
            btn.classList.toggle('cursor-not-allowed', harSelection.size === 0);
        }
    }

    function renderHarPreviewList(preview) {
        const list = document.getElementById('harRuleList');
        if (!list) return;
        list.innerHTML = '';
        harSelection = new Set();
        harAvailableNames = [];

        if (!preview.policies || preview.policies.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'p-6 text-center text-sm text-gray-500 dark:text-gray-400';
            empty.textContent = 'No rules were found in this HAR capture.';
            list.appendChild(empty);
            return;
        }

        preview.policies.forEach(policy => {
            const isUnmatched = policy.name === 'Unmatched Rules (from HAR)';
            const group = document.createElement('div');
            group.className = 'har-policy-group rounded border border-teal-200 dark:border-teal-800 bg-teal-50/40 dark:bg-teal-900/10';
            if (isUnmatched) {
                group.className = 'har-policy-group rounded border border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-900/10';
            }

            // Policy header with its own "select all in policy" checkbox.
            const header = document.createElement('label');
            header.className = 'flex items-center gap-2 px-2 py-1.5 text-xs font-bold text-gray-700 dark:text-gray-200 cursor-pointer select-none';
            const headerCheck = document.createElement('input');
            headerCheck.type = 'checkbox';
            headerCheck.checked = true;
            headerCheck.className = 'har-policy-select';
            headerCheck.dataset.policy = policy.name;
            header.appendChild(headerCheck);
            const headerLabel = document.createElement('span');
            headerLabel.textContent = isUnmatched
                ? `${policy.name} — no matching policy found in the capture`
                : `${policy.name} (${policy.rules.length} rule${policy.rules.length === 1 ? '' : 's'})`;
            header.appendChild(headerLabel);
            group.appendChild(header);

            policy.rules.forEach(rule => {
                harAvailableNames.push(rule.name);
                harSelection.add(rule.name); // everything selected by default

                const row = document.createElement('label');
                row.className = 'flex items-start gap-2 px-2 py-1 rounded hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm cursor-pointer select-none';
                const rowCheck = document.createElement('input');
                rowCheck.type = 'checkbox';
                rowCheck.checked = true;
                rowCheck.className = 'har-rule-select mt-1';
                rowCheck.dataset.rule = rule.name;
                row.appendChild(rowCheck);

                const nameSpan = document.createElement('span');
                nameSpan.textContent = rule.name;
                nameSpan.className = 'font-medium text-gray-800 dark:text-gray-100';
                row.appendChild(nameSpan);

                const varCount = rule.tokens.filter(t => t.type === 'variable').length;
                const degradedCount = rule.tokens.filter(t => t.type === 'variable' && t.degraded).length;
                const detail = document.createElement('span');
                detail.className = 'ml-auto text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap';
                let detailText = `${varCount} condition${varCount === 1 ? '' : 's'}`;
                if (degradedCount > 0) detailText += ` · ${degradedCount} degraded`;
                detail.textContent = detailText;
                row.appendChild(detail);

                group.appendChild(row);
            });

            list.appendChild(group);
        });
    }

    function openHarPreview(payload, fileName, skippedEntries) {
        harPendingPayload = payload;
        harPendingFileName = fileName;
        hidePreviewError();
        // Damaged capture: say so rather than silently importing a partial workspace,
        // so a missing rule can be traced to the file instead of to the matcher.
        if (skippedEntries > 0) {
            showPreviewError(skippedEntries + ' damaged ' + (skippedEntries === 1 ? 'entry was' : 'entries were') +
                ' skipped — this capture is partly corrupt, so a rule may be missing. Re-export the HAR if anything looks absent.');
        }
        // Throwaway build: grouping + condition counts for the preview only; the real
        // workspace variables are untouched (fresh [] pool) and the commit re-builds.
        const preview = window.buildWorkspaceFromHar(payload, []);
        renderHarPreviewList(preview);
        const modal = document.getElementById('harPreviewModal');
        if (modal) modal.classList.remove('hidden');
        updateHarSelectionUI();
    }

    function bindPreviewControls() {
        const list = document.getElementById('harRuleList');
        if (list) {
            list.addEventListener('change', (e) => {
                const target = e.target;
                if (target.classList && target.classList.contains('har-rule-select')) {
                    const name = target.dataset.rule;
                    if (target.checked) harSelection.add(name);
                    else harSelection.delete(name);
                } else if (target.classList && target.classList.contains('har-policy-select')) {
                    const group = target.closest('.har-policy-group');
                    const checked = target.checked;
                    if (group) {
                        group.querySelectorAll('.har-rule-select').forEach(rcb => {
                            const name = rcb.dataset.rule;
                            rcb.checked = checked;
                            if (checked) harSelection.add(name);
                            else harSelection.delete(name);
                        });
                    }
                }
                updateHarSelectionUI();
            });
        }

        const selectAll = document.getElementById('harSelectAllBtn');
        if (selectAll) {
            selectAll.onclick = () => {
                harAvailableNames.forEach(n => harSelection.add(n));
                const all = document.querySelectorAll('#harRuleList .har-rule-select, #harRuleList .har-policy-select');
                all.forEach(c => { c.checked = true; });
                updateHarSelectionUI();
            };
        }

        const selectNone = document.getElementById('harSelectNoneBtn');
        if (selectNone) {
            selectNone.onclick = () => {
                harSelection = new Set();
                const all = document.querySelectorAll('#harRuleList .har-rule-select, #harRuleList .har-policy-select');
                all.forEach(c => { c.checked = false; });
                updateHarSelectionUI();
            };
        }

        const importBtn = document.getElementById('harImportSelectedBtn');
        if (importBtn) importBtn.onclick = commitHarSelection;

        const cancelBtn = document.getElementById('harImportCancelBtn');
        if (cancelBtn) cancelBtn.onclick = () => window.closeHarPreview();
    }

    // ------------------------------------------------------------------
    // Import entry points (worker path + file:// fallback)
    // ------------------------------------------------------------------

    // file:// fallback: same extraction logic, on the main thread.
    function importHarFileMainThread(file) {
        harImportInProgress = true;
        showModalInfo('Reading HAR file on the main thread (opened from disk)… very large captures may briefly pause the page');
        file.text().then(text => {
            showModalInfo('Parsing HAR entries…');
            let payload;
            let skippedEntries;
            try {
                const extracted = window.extractHarEntries(text);
                skippedEntries = extracted.skippedEntries;
                payload = window.extractDlpPayloads(extracted.entries);
            } catch (err) {
                harImportInProgress = false;
                showModalError('Could not read HAR file: ' + err.message);
                return;
            }
            // Released before rendering: a preview build that throws on odd capture
            // data must not leave the importer wedged on "already in progress".
            harImportInProgress = false;
            try {
                openHarPreview(payload, file.name, skippedEntries);
            } catch (err) {
                showModalError('Could not build a preview from this HAR: ' + (err && err.message ? err.message : String(err)));
            }
        }).catch(err => {
            harImportInProgress = false;
            showModalError('Could not read HAR file: ' + (err && err.message ? err.message : String(err)));
        });
    }

    window.startHarImport = function(file) {
        if (!file) return;

        // Guard against concurrent imports on BOTH paths: a second pick while one is
        // still running would otherwise let the first completion handler terminate the
        // newer worker and apply the stale payload.
        if (harImportInProgress) {
            showModalError('A HAR import is already in progress — wait for it to finish before choosing another file.');
            return;
        }

        hideModalStatus();

        if (typeof window.Worker === 'undefined') {
            importHarFileMainThread(file);
            return;
        }

        let worker;
        try {
            worker = new Worker('js/har-worker.js');
        } catch (_err) {
            // file:// pages have an opaque origin — Worker construction is forbidden.
            importHarFileMainThread(file);
            return;
        }

        harImportInProgress = true;
        harWorker = worker;

        worker.onmessage = (e) => {
            const msg = e.data;
            if (msg.type === 'progress') {
                if (msg.phase === 'reading') {
                    showModalInfo('Reading HAR file… (large captures can take a few seconds)');
                } else if (msg.phase === 'parsing') {
                    showModalInfo('Parsing HAR entries…');
                }
                return;
            }

            if (msg.type === 'error') {
                if (harWorker) { harWorker.terminate(); harWorker = null; }
                harImportInProgress = false;
                showModalError('Could not read HAR file: ' + msg.message);
                return;
            }

            if (msg.type === 'done') {
                if (harWorker) { harWorker.terminate(); harWorker = null; }
                // Released before rendering, for the same reason as the fallback path:
                // openHarPreview runs inside this handler, so a throw here would skip
                // the reset and wedge every later import behind the concurrency guard
                // with no error shown — recoverable only by reloading the page.
                harImportInProgress = false;
                try {
                    openHarPreview(msg.payload, file.name, msg.skippedEntries);
                } catch (err) {
                    showModalError('Could not build a preview from this HAR: ' + (err && err.message ? err.message : String(err)));
                }
            }
        };

        worker.onerror = (e) => {
            if (harWorker) { harWorker.terminate(); harWorker = null; }
            harImportInProgress = false;
            showModalError('HAR import failed: ' + (e.message || 'unknown worker error'));
        };

        try {
            worker.postMessage({ file });
        } catch (err) {
            if (harWorker) { harWorker.terminate(); harWorker = null; }
            harImportInProgress = false;
            showModalError('Could not start HAR import: ' + (err && err.message ? err.message : String(err)));
        }
    };

    // Bind the hidden file input (script runs at the end of <body>, DOM is ready —
    // same pattern as app.js registerEventHandlers()).
    const harFileInput = document.getElementById('harFileInput');
    if (harFileInput) {
        harFileInput.onchange = (e) => {
            const file = e.target.files && e.target.files[0];
            window.startHarImport(file);
            e.target.value = ''; // allow re-selecting the same file
        };
    }

    bindPreviewControls();
})();
