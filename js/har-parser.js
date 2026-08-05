// js/har-parser.js
// Converts DLP payloads extracted from a Purview portal HAR capture (see har-worker.js)
// into a visualizer workspace:
//   - parses each DlpComplianceRule's RuleXml string into visualizer tokens (the Lite
//     API response strips every PowerShell condition field, so RuleXml is the only
//     source of condition logic)
//   - resolves sensitive-information-type GUIDs through the SIT catalog payload
//   - groups rules into policies via fuzzy name matching anchored on the G-code prefix
// Pure logic only — no UI, no file IO. Runs on the main thread because DOMParser is
// not available in a Web Worker (and this makes it unit-testable under jsdom).

(function() {
    'use strict';

    const MARKER_KEYWORD_LIST = '(keyword list not in capture)';
    const MARKER_FILE_TYPE_PREFIX = '(unknown file type ';
    const MARKER_SIT_PREFIX = 'Unresolved SIT (';

    // Element/property → existing purviewConditions base string. Every base below
    // already exists in window.purviewConditions so imported conditions merge into
    // the existing pool vocabulary instead of inventing new strings.
    const IS_BASE = {
        'Item.SharedWithDomains': { base: 'Recipient domain is' },
        'Item.ContentExtensions': { base: 'File extension is' },
        'Item.ContentIsPasswordProtected': { base: 'Attachment is password protected', boolean: true },
        'Item.ContentIsNotLabeled': { base: 'Content is not labeled', boolean: true },
        'ExtendedItem.ExMessage.Document.IsNotLabeled': { base: 'Content is not labeled', boolean: true, targetContext: 'Attachment' }
    };

    const ACTION_MAP = {
        GenerateAlert: 'monitor',
        NotifyUser: 'notify',
        NotifyEndpointUser: 'override',
        BlockAccess: 'block',
        EndpointRestrictAccess: 'block'
    };

    // ------------------------------------------------------------------
    // RuleXml → tokens
    // ------------------------------------------------------------------

    // Mirrors parseAdvancedRuleAST's boolean walk (parser.js): same parenthesisation,
    // same AND NOT folding for non-first NOT siblings, same "AND NOT at index 0 → NOT"
    // convention.
    function walkXml(el, sitMap, warnings, variables, catalogs) {
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        const children = el.children ? Array.from(el.children) : [];

        if (tag === 'is' || tag === 'textscan' || tag === 'numericmatch' || tag === 'containsdataclassification') {
            const token = window.harConditionToken(el, sitMap, warnings, variables, catalogs);
            return token ? [token] : [];
        }

        if (tag === 'and' || tag === 'or') {
            const op = tag.toUpperCase();
            const hasMultiple = children.length > 1;
            const tokens = [];
            if (hasMultiple) tokens.push({ type: 'operator', val: '(' });

            children.forEach((sub, idx) => {
                let subTokens = walkXml(sub, sitMap, warnings, variables, catalogs);
                if (subTokens.length > 0 && subTokens[0].val === 'NOT') {
                    // Fold a leading NOT into an "AND NOT" when it is a non-first sibling
                    // (matches parser.js lines 72-78); keep plain NOT at index 0.
                    subTokens.shift();
                    if (idx > 0) tokens.push({ type: 'operator', val: 'AND NOT' });
                    else tokens.push({ type: 'operator', val: 'NOT' });
                    subTokens.forEach(t => tokens.push(t));
                } else {
                    if (idx > 0) tokens.push({ type: 'operator', val: op });
                    subTokens.forEach(t => tokens.push(t));
                }
            });

            if (hasMultiple) tokens.push({ type: 'operator', val: ')' });
            return tokens;
        }

        if (tag === 'not') {
            const tokens = [{ type: 'operator', val: 'NOT' }, { type: 'operator', val: '(' }];
            if (children.length > 0) {
                walkXml(children[0], sitMap, warnings, variables, catalogs).forEach(t => tokens.push(t));
            }
            tokens.push({ type: 'operator', val: ')' });
            return tokens;
        }

        // Unknown element: never silently drop a condition.
        const fallback = fallbackToken(el, warnings);
        return fallback ? [fallback] : [];
    }

    // Unknown RuleXml elements fall back to psPropertyMap[last-segment] then a
    // space-split of the property name, and always push a warning.
    function fallbackToken(el, warnings) {
        const prop = el.getAttribute ? (el.getAttribute('property') || el.getAttribute('target') || '') : '';
        const lastSeg = prop.split('.').pop();
        const base = window.psPropertyMap[lastSeg] || lastSeg.replace(/([A-Z])/g, ' $1').trim() || (el.tagName || 'Unknown');
        warnings.push({ type: 'unknown-condition', detail: `Unknown RuleXml element <${el.tagName}> with property "${prop}" mapped to "${base}"` });
        return { type: 'variable', val: `${base}: (unknown values)`, targetContext: 'Both', degraded: 'unknown' };
    }

    // Build a variable token; each individual value is also pushed into the shared
    // variables pool (mirrors parser.js lines 47-50).
    function makeCondition(base, values, targetContext, variables, degraded) {
        const joined = values.join(', ');
        const full = joined === '' ? base : `${base}: ${joined}`;
        if (degraded) {
            return { type: 'variable', val: full, targetContext: targetContext || 'Both', degraded };
        }
        values.forEach(v => {
            const ind = (v === 'true' || v === 'True' || v === '') ? base : `${base}: ${v}`;
            if (variables && !variables.includes(ind)) variables.push(ind);
        });
        return { type: 'variable', val: full, targetContext: targetContext || 'Both' };
    }

    function keyValuePairs(keyValuesEl) {
        const pairs = {};
        const kids = keyValuesEl.children ? Array.from(keyValuesEl.children) : [];
        kids.forEach(kv => {
            if (!kv.tagName || kv.tagName.toLowerCase() !== 'keyvalue') return;
            const key = kv.getAttribute('key');
            if (!key) return;
            pairs[key] = kv.getAttribute('value') || '';
        });
        return pairs;
    }

    // guid → "Spreadsheet (Excel, CSV, TSV)". Keeps the format list because the group
    // names alone ("Mail", "Archive") do not say which extensions they cover.
    function fileTypeName(guid, fileTypes) {
        const row = fileTypes && fileTypes[String(guid).toLowerCase()];
        if (!row) return guid;
        return row.format ? `${row.name} (${row.format})` : row.name;
    }

    // RuleXml identifies a sensitivity label by tagId (GUID) plus tagName, where tagName
    // is Purview's INTERNAL name — "Non Sensitive_2", the numeric suffix being Purview's
    // own disambiguation. The portal shows "SECRET/NON-SENSITIVE". Only the Label catalog
    // carries that, and the display name alone is not enough: one real tenant has 8
    // labels displaying as "NON-SENSITIVE" under different parents, so the parent must
    // be included or the condition is ambiguous. Falls back to the raw tagName when the
    // capture has no Label catalog, so nothing is ever dropped.
    function resolveLabelName(pairs, labelMap, warnings) {
        const raw = pairs.tagName;
        if (!labelMap) return raw;
        const row = labelMap[String(pairs.tagId || '').toLowerCase()]
            || labelMap[String(raw || '').toLowerCase()];
        if (!row) {
            warnings.push({ type: 'unresolved-label', detail: `Sensitivity label "${raw}" is not in the label catalog — showing its internal name` });
            return raw;
        }
        const display = row.DisplayName || raw;
        return row.ParentLabelDisplayName ? `${row.ParentLabelDisplayName}/${display}` : display;
    }

    // containsDataClassification has two shapes, both present in real captures:
    //   - Sensitivity labels: <keyValues> groups carrying tagName/tagType/tagId
    //   - SITs:              <keyValues> groups carrying id/minCount/maxCount/minConfidence
    // Leading header groups (whose only keys are operator/name) are skipped.
    function classificationToken(el, sitMap, warnings, variables, catalogs) {
        const labels = [];
        const sitNames = [];
        const groups = el.children ? Array.from(el.children) : [];

        groups.forEach(group => {
            if (!group.tagName || group.tagName.toLowerCase() !== 'keyvalues') return;
            const pairs = keyValuePairs(group);
            const keys = Object.keys(pairs);

            // Skip header groups such as {operator} or {operator, name}.
            if (keys.length > 0 && keys.every(k => k === 'operator' || k === 'name')) return;
            // A group with no recognizable keys is not a label/SIT group.
            if (!pairs.tagName && !pairs.id) return;

            if (pairs.tagName) {
                labels.push(resolveLabelName(pairs, catalogs && catalogs.labels, warnings));
            } else if (pairs.id) {
                const id = pairs.id;
                const resolved = sitMap[String(id).toLowerCase()];
                if (resolved) {
                    sitNames.push(resolved);
                } else {
                    sitNames.push(`${MARKER_SIT_PREFIX}${id.slice(0, 8)})`);
                    warnings.push({ type: 'unresolved-sit', detail: `Sensitive information type GUID ${id} is not in the SIT catalog` });
                }
            }
        });

        const values = labels.concat(sitNames);
        return makeCondition('Content contains', values, 'Both', variables, values.some(v => isMarker(v)) ? 'unresolved-sit' : undefined);
    }

    function isMarker(value) {
        return value.indexOf(MARKER_KEYWORD_LIST) !== -1
            || value.indexOf(MARKER_FILE_TYPE_PREFIX) !== -1
            || value.indexOf(MARKER_SIT_PREFIX) !== -1;
    }

    // Convert a single RuleXml predicate element into a visualizer token.
    // Signature: (el, sitMap, warnings, variables)
    window.harConditionToken = function(el, sitMap, warnings, variables, catalogs) {
        sitMap = sitMap || {};
        warnings = warnings || [];
        variables = variables || [];
        const tag = el.tagName ? el.tagName.toLowerCase() : '';

        if (tag === 'containsdataclassification') {
            return classificationToken(el, sitMap, warnings, variables, catalogs);
        }

        if (tag === 'is') {
            const property = el.getAttribute('property') || '';
            const known = IS_BASE[property];

            if (property === 'Item.ContentFileType') {
                const values = (el.children ? Array.from(el.children) : [])
                    .filter(c => c.tagName && c.tagName.toLowerCase() === 'value')
                    .map(c => c.textContent.trim())
                    .filter(Boolean);
                const fileTypes = catalogs && catalogs.fileTypes;
                const unresolved = values.filter(v => !(fileTypes && fileTypes[v.toLowerCase()]));
                if (unresolved.length === 0 && values.length > 0) {
                    // Named from the portal's own file-type table — a real condition now,
                    // not a placeholder, so it is not marked degraded.
                    return makeCondition('File type is', values.map(v => fileTypeName(v, fileTypes)), 'Both', variables);
                }
                const markers = values.map(v => (fileTypes && fileTypes[v.toLowerCase()])
                    ? fileTypeName(v, fileTypes)
                    : `${MARKER_FILE_TYPE_PREFIX}${v.slice(0, 8)})`);
                warnings.push({ type: 'file-type', detail: `Content file type IDs (${unresolved.join(', ')}) are not in the portal file-type table found in this capture` });
                return makeCondition('File type is', markers, 'Both', variables, 'file-type');
            }

            if (known) {
                if (known.boolean) {
                    if (!variables.includes(known.base)) variables.push(known.base);
                    return { type: 'variable', val: known.base, targetContext: known.targetContext || 'Both' };
                }
                const values = (el.children ? Array.from(el.children) : [])
                    .filter(c => c.tagName && c.tagName.toLowerCase() === 'value')
                    .map(c => c.textContent.trim())
                    .filter(Boolean);
                return makeCondition(known.base, values, 'Both', variables);
            }

            warnings.push({ type: 'unknown-condition', detail: `Unknown <is> property "${property}"` });
            return fallbackToken(el, warnings);
        }

        if (tag === 'textscan') {
            const target = el.getAttribute('target') || '';
            let base;
            let targetContext = 'Both';
            if (target.indexOf('SubjectOrBody') !== -1) {
                base = 'Subject or Body contains words';
                targetContext = 'Message';
            } else if (target.toLowerCase().indexOf('header') !== -1) {
                base = 'Header contains words or phrases';
            } else if (target === 'Item.DisplayName') {
                base = 'Document name contains words';
            } else if (target.indexOf('.Document') !== -1) {
                base = 'Document name contains words';
                targetContext = 'Attachment';
            } else {
                warnings.push({ type: 'unknown-condition', detail: `Unknown textScan target "${target}"` });
                return fallbackToken(el, warnings);
            }
            // Keyword lists are referenced only by processorId GUID, which never
            // appears anywhere else in the capture — the list itself is unrecoverable.
            warnings.push({ type: 'keyword-list', detail: `Keyword list referenced by processorId "${el.getAttribute('processorId') || ''}" is not included in the HAR capture` });
            return makeCondition(base, [MARKER_KEYWORD_LIST], targetContext, variables, 'keyword-list');
        }

        if (tag === 'numericmatch') {
            const target = el.getAttribute('rhsTarget') || '';
            const value = el.getAttribute('lhsValue') || '';
            let base;
            if (target.indexOf('RecipientCount') !== -1) base = 'Unique recipient count over';
            else {
                warnings.push({ type: 'unknown-condition', detail: `Unknown numericMatch target "${target}"` });
                return fallbackToken(el, warnings);
            }
            return makeCondition(base, [value], 'Both', variables);
        }

        warnings.push({ type: 'unknown-condition', detail: `Unknown RuleXml element <${tag}>` });
        return fallbackToken(el, warnings);
    };

    // Parse one rule's RuleXml string.
    // Signature: (xmlString, sitMap, variables) — variables is optional and receives
    // the individual condition values (mirrors parser.js pool behaviour).
    // Returns { tokens, actions, stopProcessing, enabled, warnings }.
    // Throws a descriptive Error on malformed XML — never returns partial tokens.
    window.parseRuleXml = function(xmlString, sitMap, variables, catalogs) {
        sitMap = sitMap || {};
        variables = variables || [];
        const warnings = [];
        const doc = new DOMParser().parseFromString(xmlString, 'application/xml');

        const parserError = doc.querySelector('parsererror');
        if (parserError) {
            const detail = (parserError.textContent || 'malformed XML').trim().replace(/\s+/g, ' ').slice(0, 300);
            throw new Error(`Could not parse rule XML: ${detail}`);
        }

        const tokens = [];
        const condEl = doc.querySelector('condition');
        if (condEl) {
            Array.from(condEl.children).forEach(child => {
                walkXml(child, sitMap, warnings, variables, catalogs).forEach(t => tokens.push(t));
            });
        }

        const actions = { monitor: false, notify: false, override: false, block: false };
        let stopProcessing = false;
        doc.querySelectorAll('action').forEach(actionEl => {
            const name = actionEl.getAttribute('name') || '';
            if (ACTION_MAP[name]) actions[ACTION_MAP[name]] = true;
            if (name === 'Halt') stopProcessing = true;
        });

        const ruleEl = doc.documentElement;
        const enabled = (ruleEl && ruleEl.getAttribute('enabled') || 'true').toLowerCase() !== 'false';

        return { tokens, actions, stopProcessing, enabled, warnings };
    };

    // ------------------------------------------------------------------
    // Fuzzy policy matching, anchored on the leading policy-code prefix
    // ------------------------------------------------------------------

    // The leading code token, e.g. "G006", "G00A1", "HTA001", "SPF003", "MHA001A".
    // Handles both the G-code tenant and tenants that prefix policies with agency
    // codes (HTA/SPF/MHA/VVIP/…). Names without a digit-bearing code prefix
    // ("Teams file hover test", "073 catch all…") yield no code and rely on
    // global similarity.
    function code(name) {
        const m = /^\s*([A-Z]{1,4}\d{2,3}[A-Z]?\d*)\b/i.exec(name || '');
        return m ? m[1].toLowerCase() : null;
    }

    function normalise(name) {
        return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    // Dice coefficient over character bigram multisets.
    function diceCoefficient(a, b) {
        if (a === b) return 1;
        if (!a || !b) return 0;
        const bigrams = (s) => {
            const counts = new Map();
            for (let i = 0; i < s.length - 1; i++) {
                const g = s.slice(i, i + 2);
                counts.set(g, (counts.get(g) || 0) + 1);
            }
            return counts;
        };
        const ga = bigrams(a);
        const gb = bigrams(b);
        let shared = 0;
        ga.forEach((count, g) => shared += Math.min(count, gb.get(g) || 0));
        let total = 0;
        ga.forEach(c => total += c);
        gb.forEach(c => total += c);
        return total === 0 ? 0 : (2 * shared) / total;
    }

    // Signature: (ruleName, policyNames) → { name, score } | null
    //
    // Two-tier matching:
    //   Tier 1 — code anchor: policies sharing the rule's leading code. The code is
    //     strong identity, so a lower similarity bar applies (0.45): a same-code
    //     variant like "G009-Web Uploads-Block -- Secret to SGDCS & GCC intranet"
    //     still lands on "G009-Web Uploads-Block".
    //   Tier 2 — global similarity (rules without a code, or with a code no policy
    //     shares): best Dice over all policies at the stricter 0.62 bar. Near-duplicate
    //     code families are guarded: if the rule and candidate have different,
    //     non-prefix-related codes (G075 vs G076), the score is crushed so G075 can
    //     never be filed under G076. Prefix-related codes (MHA001A vs MHA001) are
    //     allowed — those are typically the same policy, just renamed.
    // Exact normalised-name equality always scores 1.0; ties break on shortest name.
    // The "- AIP" suffix is NOT stripped during normalisation — some tenants have
    // both variants and stripping collapses them into a coin flip.
    window.matchRuleToPolicy = function(ruleName, policyNames) {
        policyNames = policyNames || [];
        const ruleCode = code(ruleName);

        let candidates = policyNames;
        let threshold = 0.62;
        if (ruleCode) {
            const withCode = policyNames.filter(p => code(p) === ruleCode);
            if (withCode.length > 0) {
                candidates = withCode;
                threshold = 0.45;
            }
        }

        const rn = normalise(ruleName);
        let best = null;
        candidates.forEach(p => {
            const pn = normalise(p);
            let score = pn === rn ? 1.0 : diceCoefficient(rn, pn);

            // Near-duplicate family guard (only meaningful outside the code anchor).
            const policyCode = code(p);
            if (ruleCode && policyCode && ruleCode !== policyCode
                && !ruleCode.startsWith(policyCode) && !policyCode.startsWith(ruleCode)) {
                score *= 0.3;
            }

            if (best === null || score > best.score || (score === best.score && p.length < best.name.length)) {
                best = { name: p, score };
            }
        });

        return best && best.score >= threshold ? best : null;
    };

    // ------------------------------------------------------------------
    // Workspace assembly
    // ------------------------------------------------------------------

    // Signature: (payload, currentVariables, selectedRuleNames)
    // payload = { rules, policies, sits } as extracted by har-worker.js.
    // currentVariables: existing condition pool, appended to.
    // selectedRuleNames (optional): array of rule names to import; when omitted all
    // rules are imported. Only selected rules are parsed, grouped and added to the
    // variables pool — unselected rules leave no trace in the result.
    // Replaces the workspace on success; the caller persists with a single saveState.
    window.buildWorkspaceFromHar = function(payload, currentVariables, selectedRuleNames) {
        const rules = (payload && payload.rules) || [];
        const policies = (payload && payload.policies) || [];
        const sits = (payload && payload.sits) || [];
        const labels = (payload && payload.labels) || [];
        const fileTypes = (payload && payload.fileTypes) || null;
        const fullRules = (payload && payload.fullRules) || [];
        const fullPolicies = (payload && payload.fullPolicies) || [];
        const selected = selectedRuleNames ? new Set(selectedRuleNames) : null;

        // SIT catalog, keyed lowercase — RuleXml references SITs as bare GUIDs.
        const sitMap = {};
        sits.forEach(s => {
            if (s && s.Id && s.Name) sitMap[String(s.Id).toLowerCase()] = s.Name;
        });

        // Sensitivity label catalog, keyed by BOTH GUID and internal name: RuleXml gives
        // tagId and tagName, and older captures have been seen with one but not the other.
        // Object.create(null) for the same reason as the DataType buckets — these keys
        // come from untrusted capture data.
        const labelMap = Object.create(null);
        labels.forEach(l => {
            if (!l) return;
            const guid = l.Guid || l.Id || l.ImmutableId;
            if (guid) labelMap[String(guid).toLowerCase()] = l;
            if (l.Name) labelMap[String(l.Name).toLowerCase()] = l;
        });

        const catalogs = { labels: labelMap, fileTypes };

        // The same two lookups for the full-detail path, whose AdvancedRule carries
        // {Name, Id, Type} per label and bare GUID strings per file type, rather than
        // RuleXml's tagName/tagId and <value> elements.
        const resolvers = {
            label: labels.length === 0 ? null : function(l) {
                return resolveLabelName({ tagName: l && l.Name, tagId: l && l.Id }, labelMap, warnings);
            },
            fileType: function(guid) {
                const named = fileTypeName(guid, fileTypes);
                if (named === guid) {
                    warnings.push({ type: 'file-type', detail: `Content file type ID ${guid} is not in the portal file-type table found in this capture` });
                }
                return named;
            }
        };

        // Full rule detail from the portal's InvokeCommand responses (captured when a
        // rule is opened for editing): populated AdvancedRule, ParentPolicyName, Policy
        // GUID — the authoritative version of the rule.
        const fullRuleByName = new Map();
        fullRules.forEach(fr => {
            const rule = fr && fr.rule;
            const name = rule && (rule.Name || rule.DisplayName);
            if (name) fullRuleByName.set(name, { rule, policyGuid: fr.policyGuid });
        });

        // policy GUID → display name, from full policy responses and Lite policy records.
        const policyNameByGuid = new Map();
        fullPolicies.forEach(p => {
            if (p && p.Guid && p.DisplayName) policyNameByGuid.set(String(p.Guid).toLowerCase(), p.DisplayName);
        });
        policies.forEach(p => {
            if (p && p.Guid && p.Name) policyNameByGuid.set(String(p.Guid).toLowerCase(), p.Name);
        });

        const variables = Array.isArray(currentVariables) ? currentVariables.slice() : [];
        const policyNames = policies.map(p => (p && p.Name)).filter(Boolean);

        const warnings = [];
        const orderedPolicies = [];
        const matchedByName = {};
        const unmatchedRules = [];
        const unmatchedNames = [];
        let processedCount = 0;
        let fullDetailCount = 0;

        // Merge: Lite list first (capture order), then any full-detail rules that the
        // Lite list somehow missed. Full-detail rules override their Lite counterparts.
        const seenNames = new Set();
        const mergedRules = [];
        rules.forEach(rule => {
            const n = (rule && (rule.Name || rule.DisplayName)) || 'Unnamed Rule';
            if (seenNames.has(n)) return;
            seenNames.add(n);
            mergedRules.push(rule);
        });
        fullRules.forEach(fr => {
            const rule = fr && fr.rule;
            const n = rule && (rule.Name || rule.DisplayName);
            if (n && !seenNames.has(n)) {
                seenNames.add(n);
                mergedRules.push(rule);
            }
        });

        mergedRules.forEach(rule => {
            const name = (rule && (rule.Name || rule.DisplayName)) || 'Unnamed Rule';
            if (selected && !selected.has(name)) return; // unselected rules leave no trace
            processedCount += 1;

            const full = fullRuleByName.get(name);
            let parsed = null;
            let isFullDetail = false;

            if (full) {
                // Prefer the full rule: AdvancedRule (or its plain condition fields) via
                // the same path as PowerShell JSON import.
                try {
                    const parsedFull = window.parsePurviewJSON(
                        JSON.stringify([{ PolicyName: 'HAR Detail', Rules: [full.rule] }]),
                        [],
                        resolvers
                    );
                    const pr = parsedFull.policies[0].rules[0];
                    if (pr) {
                        parsed = {
                            tokens: pr.tokens,
                            actions: pr.actions,
                            stopProcessing: pr.stopProcessing,
                            enabled: pr.enabled,
                            workloads: pr.workloads
                        };
                        parsedFull.variables.forEach(v => { if (!variables.includes(v)) variables.push(v); });
                        isFullDetail = true;
                        fullDetailCount += 1;
                    }
                } catch (_err) {
                    parsed = null; // fall through to the RuleXml path
                }
            }

            const xml = (rule && rule.RuleXml) || '';
            if (!parsed && xml) {
                try {
                    parsed = window.parseRuleXml(xml, sitMap, variables, catalogs);
                } catch (parseErr) {
                    warnings.push({ rule: name, type: 'malformed-xml', detail: parseErr.message });
                }
            }

            const tokens = parsed ? parsed.tokens : [];
            const actions = parsed ? parsed.actions : { monitor: false, notify: false, override: false, block: false };
            const stopProcessing = parsed ? parsed.stopProcessing : false;
            const enabled = parsed ? parsed.enabled : (rule.Disabled === false || rule.Disabled === undefined);
            if (parsed && !isFullDetail) {
                parsed.warnings.forEach(w => warnings.push(Object.assign({ rule: name }, w)));
            }

            const ruleObj = {
                id: window.generateId(),
                name,
                enabled,
                tokens,
                actions,
                stopProcessing,
                workloads: parsed && parsed.workloads
                    ? { email: parsed.workloads.email !== false, endpoint: !!parsed.workloads.endpoint }
                    : { email: true, endpoint: true }
            };

            // Authoritative policy when the full rule says so; otherwise fuzzy match.
            let match = null;
            if (full) {
                const parentName = full.rule.ParentPolicyName || '';
                if (parentName && policyNames.includes(parentName)) {
                    match = { name: parentName, score: 1.0 };
                } else if (full.policyGuid) {
                    const byGuid = policyNameByGuid.get(String(full.policyGuid).toLowerCase());
                    if (byGuid && policyNames.includes(byGuid)) match = { name: byGuid, score: 1.0 };
                }
            }
            if (!match) match = window.matchRuleToPolicy(name, policyNames);

            if (!match) {
                unmatchedNames.push(name);
                unmatchedRules.push(ruleObj);
                return;
            }

            const pol = policies.find(p => p.Name === match.name);
            if (pol) {
                // Full-detail rules carry their own real Workload; Lite rules inherit
                // the policy's workload because the Lite record reports Workload 'None'.
                if (!isFullDetail) {
                    ruleObj.workloads.email = String(pol.Workload || '').includes('Exchange');
                    ruleObj.workloads.endpoint = Array.isArray(pol.EndpointDlpLocation) && pol.EndpointDlpLocation.length > 0;
                }
            }

            if (!matchedByName[match.name]) {
                const policyObj = {
                    id: window.generateId(),
                    name: match.name,
                    enabled: pol ? pol.Mode !== 'Disable' : true,
                    rules: []
                };
                matchedByName[match.name] = policyObj;
                orderedPolicies.push(policyObj);
            }
            // Priority: the portal's Lite API zeroes every rule's Priority field, so the
            // only order information in the capture is the response array — rules get a
            // 1-based ordinal in the order they appear for their policy. serializePurviewJSON
            // exports this as the PowerShell Priority.
            ruleObj.priority = matchedByName[match.name].rules.length + 1;
            matchedByName[match.name].rules.push(ruleObj);
        });

        if (unmatchedRules.length > 0) {
            orderedPolicies.push({
                id: window.generateId(),
                name: 'Unmatched Rules (from HAR)',
                enabled: true,
                rules: unmatchedRules
            });
        }

        // Summarise degraded conditions (those carrying a visible marker).
        const degradedByType = { 'keyword-list': 0, 'file-type': 0, 'unresolved-sit': 0, unknown: 0 };
        let degradedCount = 0;
        orderedPolicies.forEach(p => {
            p.rules.forEach(r => {
                r.tokens.forEach(t => {
                    if (t.type === 'variable' && t.degraded) {
                        degradedCount += 1;
                        if (degradedByType[t.degraded] !== undefined) degradedByType[t.degraded] += 1;
                    }
                });
            });
        });

        const report = {
            ruleCount: processedCount,
            totalRules: mergedRules.length,
            fullDetailCount,
            matchedCount: processedCount - unmatchedNames.length,
            unmatchedCount: unmatchedNames.length,
            unmatchedNames: unmatchedNames.slice(),
            policyCount: orderedPolicies.length,
            degradedConditions: degradedCount,
            keywordLists: degradedByType['keyword-list'],
            fileTypes: degradedByType['file-type'],
            unresolvedSits: degradedByType['unresolved-sit'],
            unknownConditions: degradedByType.unknown,
            warnings
        };

        return { policies: orderedPolicies, variables, report };
    };
})();
