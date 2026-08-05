// EndpointDlpRestrictions is a nested pile of OData hash tables — arrays of {_key,_value}
// where a _value can itself be another array of them. The verdict (Block / Warn / Audit)
// appears either as a restriction's own "value", or, for grouped settings like
// CloudEgress, as an "action" on each destination group while the outer "value" reads
// "None". Walking for the verdict keys wherever they sit is what makes both shapes work.
// Audit deliberately maps to nothing here: it is plain logging, already covered by
// GenerateAlert → monitor.
window.collectEndpointVerdicts = function(restrictions) {
    const found = { block: false, warn: false, audit: false, requiresJustification: false };
    if (!restrictions) return found;

    (function walk(node) {
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (!node || typeof node !== 'object') return;

        const key = typeof node._key === 'string' ? node._key.toLowerCase() : null;
        const value = node._value;

        if (key && typeof value === 'string') {
            const v = value.toLowerCase();
            if (key === 'value' || key === 'action') {
                if (v === 'block') found.block = true;
                else if (v === 'warn') found.warn = true;
                else if (v === 'audit') found.audit = true;
                else if (v === 'required') found.requiresJustification = true;
            }
        } else if (value !== undefined) {
            walk(value); // grouped settings nest another hash-table array here
        }

        if (node._key === undefined) Object.keys(node).forEach(k => walk(node[k]));
    })(restrictions);

    return found;
};

// resolvers is optional: { label, fileType }, each a function returning a display string.
// HAR import passes resolvers built from the capture's own catalogs so a rule reads the
// way the portal shows it — "SECRET/NON-SENSITIVE" rather than Purview's internal name
// "Non Sensitive_2", and "Spreadsheet (Excel, CSV, TSV)" rather than a bare GUID.
// PowerShell JSON imports carry no catalogs and pass nothing, keeping the raw values.
window.parseAdvancedRuleAST = function(astNode, localVariables = [], resolvers) {
    const labelResolver = resolvers && resolvers.label;
    const fileTypeResolver = resolvers && resolvers.fileType;
    if (!astNode) return [];
    let tokens = [];

    if (astNode.ConditionName || astNode.Target) {
        let base = astNode.ConditionName || astNode.Target;
        if (astNode.Target === 'Message' || astNode.Target === 'Attachment') {
            if (astNode.ConditionName) base = astNode.ConditionName;
        }
        
        let targetContext = 'Both';
        if (astNode.Target === 'Message' || astNode.Target === 'Attachment') {
            targetContext = astNode.Target;
        }
        if (Array.isArray(astNode.Value)) {
            astNode.Value.forEach(v => {
                if (typeof v === 'object' && v.Target) {
                    targetContext = v.Target;
                }
            });
        }

        let visualizerBase = window.psPropertyMap[base] || base.replace(/([A-Z])/g, ' $1').trim();

        let valStrArr = [];
        if (Array.isArray(astNode.Value)) {
            astNode.Value.forEach(v => {
                if (typeof v === 'object' && v !== null) {
                    if (v.Name) valStrArr.push(v.Name);
                    else if (v.Groups) {
                        v.Groups.forEach(g => {
                            if (g.Labels) g.Labels.forEach(l => valStrArr.push(labelResolver ? labelResolver(l) : l.Name));
                            else if (g.Sensitivetypes) g.Sensitivetypes.forEach(s => valStrArr.push(s.Name));
                        });
                    }
                } else {
                    valStrArr.push(v);
                }
            });
        } else if (astNode.Value && typeof astNode.Value === 'object') {
            // Header conditions carry a MAP of header name → values, not a flat array:
            // HeaderContainsWords → {"x-cdlp-device": ["OutlookWindows", "OutlookWebApp"]}.
            // Without this the object fell through to the push below and rendered as the
            // literal string "[object Object]", losing both the header and its values.
            Object.keys(astNode.Value).forEach(headerName => {
                const hv = astNode.Value[headerName];
                (Array.isArray(hv) ? hv : [hv]).forEach(item => valStrArr.push(`${headerName}: ${item}`));
            });
        } else if (astNode.Value !== undefined) {
            valStrArr.push(astNode.Value);
        }

        // Content file types arrive as bare GUIDs; the portal's own table names them.
        if (fileTypeResolver && /FileType/i.test(base)) {
            valStrArr = valStrArr.map(v => fileTypeResolver(v));
        }

        let propVal = valStrArr.join(", ");
        let fullCondition = (propVal === "true" || propVal === "True" || !propVal) ? visualizerBase : `${visualizerBase}: ${propVal}`;
        
        valStrArr.forEach(v => {
            let indCond = (v === "true" || v === "True" || !v) ? visualizerBase : `${visualizerBase}: ${v}`;
            if (!localVariables.includes(indCond)) localVariables.push(indCond);
        });

        tokens.push({ type: 'variable', val: fullCondition, targetContext: targetContext });
        return tokens;
    }

    if (astNode.Operator) {
        let op = astNode.Operator.toUpperCase();
        if (op === "NOT") {
            tokens.push({ type: 'operator', val: 'NOT' });
            tokens.push({ type: 'operator', val: '(' });
            if (astNode.SubConditions && astNode.SubConditions.length > 0) {
                tokens = tokens.concat(window.parseAdvancedRuleAST(astNode.SubConditions[0], localVariables, resolvers));
            }
            tokens.push({ type: 'operator', val: ')' });
        } else if (op === "AND" || op === "OR") {
            if (astNode.SubConditions) {
                let hasMultiple = astNode.SubConditions.length > 1;
                if (hasMultiple) tokens.push({ type: 'operator', val: '(' });
                
                astNode.SubConditions.forEach((sub, idx) => {
                    let subTokens = window.parseAdvancedRuleAST(sub, localVariables, resolvers);
                    if (subTokens.length > 0 && subTokens[0].val === 'NOT') {
                        subTokens.shift(); 
                        if (idx > 0) tokens.push({ type: 'operator', val: 'AND NOT' });
                        else {
                            tokens.push({ type: 'operator', val: 'NOT' });
                        }
                        tokens = tokens.concat(subTokens);
                    } else {
                        if (idx > 0) tokens.push({ type: 'operator', val: op });
                        tokens = tokens.concat(subTokens);
                    }
                });
                
                if (hasMultiple) tokens.push({ type: 'operator', val: ')' });
            }
        }
    }
    return tokens;
};

window.parsePurviewJSON = function(rawText, currentVariables = [], resolvers) {
    if (window.logEvent) window.logEvent('info', 'parser', 'Starting to parse Microsoft Purview JSON data', { byteLength: rawText.length });
    const data = JSON.parse(rawText);
    const exportArray = Array.isArray(data) ? data : [data];
    
    let newPolicies = {};
    let localVariables = [...currentVariables];
    
    exportArray.forEach(exportItem => {
        const pName = exportItem.PolicyName || "Imported Policy";
        
        if (!newPolicies[pName]) {
            newPolicies[pName] = { id: window.generateId(), name: pName, enabled: true, rules: [] };
        }

        let rulesToProcess = [];
        if (Array.isArray(exportItem.Rules)) {
            rulesToProcess = exportItem.Rules;
        } else if (exportItem.Rules) {
            rulesToProcess = [exportItem.Rules];
        } else {
            rulesToProcess = [exportItem];
        }

        rulesToProcess.forEach(ruleObj => {
            const rName = ruleObj.DisplayName || ruleObj.Name || window.generateId();
            
            const actions = { monitor: false, notify: false, override: false, block: false };
            if (ruleObj.BlockAccess || (ruleObj.BlockUsers && ruleObj.BlockUsers.length > 0) || (ruleObj.BlockDomains && ruleObj.BlockDomains.length > 0)) actions.block = true;
            if (ruleObj.NotifyUser && ruleObj.NotifyUser.length > 0) actions.notify = true;
            if (ruleObj.NotifyAllowOverride || (ruleObj.NotifyOverrideRequirements && ruleObj.NotifyOverrideRequirements !== "None")) actions.override = true;
            if ((ruleObj.GenerateAlert && ruleObj.GenerateAlert.length > 0) || (ruleObj.GenerateIncidentReport && ruleObj.GenerateIncidentReport.length > 0)) actions.monitor = true;

            // Endpoint DLP actions live in their OWN fields — the checks above are all
            // Exchange-side, so an endpoint rule that blocks web uploads used to import
            // with nothing but Monitor ticked (31 of 45 full-detail rules in a real
            // tenant capture). BlockAccess is literally false on those rules; the verdict
            // sits inside EndpointDlpRestrictions instead.
            const verdicts = window.collectEndpointVerdicts(ruleObj.EndpointDlpRestrictions);
            if (verdicts.block) actions.block = true;
            // "Warn" lets the user proceed anyway, and a required business justification
            // is the same affirm-then-continue flow — both are an override.
            if (verdicts.warn || verdicts.requiresJustification) actions.override = true;
            // The endpoint policy tip (NotificationTitle/Content shown on the device).
            if (Array.isArray(ruleObj.NotifyEndpointUser) && ruleObj.NotifyEndpointUser.length > 0) actions.notify = true;
            const stopProcessing = !!ruleObj.StopPolicyProcessing;

            let workloads = { email: true, endpoint: true };
            if (ruleObj.Workload) {
                workloads.email = ruleObj.Workload.includes('Exchange');
                workloads.endpoint = ruleObj.Workload.includes('EndpointDevices');
            }

            let tokens = [];

            if (ruleObj.AdvancedRule) {
                let ast;
                try { ast = JSON.parse(ruleObj.AdvancedRule); } catch(_e) {}
                if (ast && ast.Condition) {
                    tokens = window.parseAdvancedRuleAST(ast.Condition, localVariables, resolvers);
                    if (tokens.length > 0 && tokens[0].val === 'AND NOT') {
                        tokens[0].val = 'NOT';
                    }
                }
            } else {
                let conditions = [];
                let exceptions = [];

                const skippedKeys = ["PolicyName", "Name", "DisplayName", "Disabled", "Priority", "Guid", "AdvancedRule", "StopPolicyProcessing", "ObjectVersion", "ExchangeVersion", "Identity", "Id", "DistinguishedName", "OrganizationalUnitRoot", "OrganizationId", "OriginatingServer", "ObjectState", "WhenCreated", "WhenChanged", "WhenCreatedUTC", "WhenChangedUTC", "MaximumBlobRuleLength", "CreatedBy", "LastModifiedBy", "ExecutionRuleGuids", "IsSummarizedPsRule", "IsValid", "ObjectClass", "ObjectCategory", "Workload", "Policy", "Comment", "Mode", "ReportSeverityLevel"];

                for (const [key, value] of Object.entries(ruleObj)) {
                    if (skippedKeys.includes(key) || value === null || value === undefined || (Array.isArray(value) && value.length === 0)) continue;
                    if (value === false) continue;
                    if (typeof value === "string" && value.trim() === "") continue;
                    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) continue;
                    if (key.includes("Action") || key.includes("Notify") || key.includes("Block") || key.includes("Generate") || key.includes("AlertProperties")) continue;
                    
                    const valuesArray = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(',') : [value]);
                    let isException = key.startsWith('ExceptIf');
                    let cleanKey = isException ? key.substring(8) : key;
                    let visualizerBase = window.psPropertyMap[cleanKey] || cleanKey.replace(/([A-Z])/g, ' $1').trim();

                    let propVals = [];
                    valuesArray.forEach(valStr => {
                        let valStrTrimmed = String(valStr).trim();
                        if (typeof valStr === 'object') {
                            if (valStr.name) valStrTrimmed = valStr.name; 
                            else return;
                        }
                        propVals.push(valStrTrimmed);

                        const indCond = (valStrTrimmed === "true" || valStrTrimmed === "True" || !valStrTrimmed) ? visualizerBase : `${visualizerBase}: ${valStrTrimmed}`;
                        if (!localVariables.includes(indCond)) localVariables.push(indCond);
                    });

                    if (propVals.length === 0) continue;

                    let combinedProp = propVals.join(", ");
                    let groupedCond = (combinedProp === "true" || combinedProp === "True" || !combinedProp) ? visualizerBase : `${visualizerBase}: ${combinedProp}`;

                    if (isException) exceptions.push(groupedCond);
                    else conditions.push(groupedCond);
                }

                if (conditions.length > 0) {
                    conditions.forEach((c, idx) => {
                        tokens.push({ type: 'variable', val: c });
                        if (idx < conditions.length - 1) tokens.push({ type: 'operator', val: 'AND' });
                    });
                }

                if (exceptions.length > 0) {
                    if (tokens.length > 0) {
                        if (tokens[tokens.length - 1].val === 'AND') tokens.pop();
                        tokens.push({ type: 'operator', val: 'AND NOT' });
                    }
                    else {
                        tokens.push({ type: 'operator', val: 'NOT' });
                    }
                    
                    if (exceptions.length > 1) tokens.push({ type: 'operator', val: '(' });
                    exceptions.forEach((e, idx) => {
                        tokens.push({ type: 'variable', val: e });
                        if (idx < exceptions.length - 1) tokens.push({ type: 'operator', val: 'OR' });
                    });
                    if (exceptions.length > 1) tokens.push({ type: 'operator', val: ')' });
                }
            }

            newPolicies[pName].rules.push({ 
                id: window.generateId(), 
                name: rName, 
                enabled: ruleObj.Disabled === false || ruleObj.Disabled === undefined,
                priority: typeof ruleObj.Priority === 'number' ? ruleObj.Priority : undefined,
                tokens: tokens,
                actions: actions,
                stopProcessing: stopProcessing,
                workloads: workloads
            });
        });
    });

    return {
        policies: Object.values(newPolicies),
        variables: localVariables
    };
};

window.parseVisualizerJSON = function(rawText) {
    const data = JSON.parse(rawText);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error("Expected a JSON object with 'policies' and 'variables' fields.");
    }
    if (!Array.isArray(data.policies)) {
        throw new Error("Missing required field: 'policies' must be an array.");
    }
    if (!Array.isArray(data.variables)) {
        throw new Error("Missing required field: 'variables' must be an array.");
    }
    data.policies.forEach((p, pi) => {
        if (!p || typeof p !== 'object') throw new Error(`Item at policies[${pi}] must be an object.`);
        if (!p.name || typeof p.name !== 'string') throw new Error(`Policy at index ${pi} is missing a 'name' field.`);
        if (!Array.isArray(p.rules)) throw new Error(`Policy "${p.name}" is missing a 'rules' array.`);
        p.rules.forEach((r, ri) => {
            if (!r || typeof r !== 'object') throw new Error(`Item at rules[${ri}] in policy "${p.name}" must be an object.`);
            if (!r.name || typeof r.name !== 'string') throw new Error(`Rule ${ri} in policy "${p.name}" is missing a 'name' field.`);
            if (!Array.isArray(r.tokens)) throw new Error(`Rule "${r.name}" in policy "${p.name}" is missing a 'tokens' array.`);
        });
    });
    return { policies: data.policies, variables: data.variables };
};

window.serializeVisualizerJSON = function(policies, variables) {
    return JSON.stringify({ variables, policies }, null, 2);
};

// ---------------------------------------------------------------------------
// Export to Microsoft Purview PowerShell JSON format (reverse of parsePurviewJSON)

window.serializePurviewJSON = function(policies) {
    // Build reverse lookup: display name → PowerShell property name
    const reverseMap = {};
    for (const [ps, display] of Object.entries(window.psPropertyMap)) {
        if (!reverseMap[display]) reverseMap[display] = ps;
    }

    function conditionTokenToAstNode(token) {
        const val = token.val;
        const colonIdx = val.indexOf(':');

        if (colonIdx === -1) {
            const psName = reverseMap[val] || val;
            return { ConditionName: psName, Value: [true] };
        }

        const base = val.substring(0, colonIdx).trim();
        const props = val.substring(colonIdx + 1).trim().split(/,\s*/).map(p => p.trim()).filter(Boolean);
        const psName = reverseMap[base] || base;

        if (base === 'Content contains') {
            const valueObjs = props.map(p => ({ name: p }));
            const node = { ConditionName: psName, Value: valueObjs };
            if (token.targetContext && token.targetContext !== 'Both') {
                node.Target = token.targetContext;
            }
            return node;
        }

        return { ConditionName: psName, Value: props };
    }

    function flattenOp(node, opType) {
        if (node.type !== opType) return [node];
        return [...flattenOp(node.left, opType), ...flattenOp(node.right, opType)];
    }

    function treeNodeToAst(node) {
        if (!node) return null;
        if (node.type === 'leaf') return conditionTokenToAstNode(node.token);
        if (node.type === 'not') {
            return { Operator: 'Not', SubConditions: [treeNodeToAst(node.operand)] };
        }
        if (node.type === 'and' || node.type === 'or') {
            const op = node.type === 'and' ? 'And' : 'Or';
            const children = flattenOp(node, node.type);
            return { Operator: op, SubConditions: children.map(treeNodeToAst) };
        }
        return null;
    }

    function postfixToTree(postfix) {
        const stack = [];
        for (const token of postfix) {
            if (token.type === 'variable') {
                stack.push({ type: 'leaf', token });
            } else if (token.val === 'NOT') {
                const operand = stack.pop();
                stack.push({ type: 'not', operand });
            } else if (token.val === 'AND' || token.val === 'OR') {
                const right = stack.pop();
                const left = stack.pop();
                stack.push({ type: token.val.toLowerCase(), left, right });
            } else if (token.val === 'AND NOT') {
                const right = stack.pop();
                const left = stack.pop();
                stack.push({ type: 'and', left, right: { type: 'not', operand: right } });
            }
        }
        return stack[0] || null;
    }

    function tokensToConditionAst(tokens) {
        if (!tokens || tokens.length === 0) return null;
        const relevant = tokens.filter(t => t.type === 'variable' || t.type === 'operator');
        if (relevant.length === 0) return null;
        if (relevant.length === 1 && relevant[0].type === 'variable') {
            return conditionTokenToAstNode(relevant[0]);
        }
        const postfix = window.infixToPostfix(relevant);
        const tree = postfixToTree(postfix);
        return treeNodeToAst(tree);
    }

    const output = policies.map((policy, _pIdx) => {
        return {
            PolicyName: policy.name,
            Rules: (policy.rules || []).map((rule, rIdx) => {
                const workloads = [];
                if (!rule.workloads || rule.workloads.email !== false) workloads.push('Exchange');
                if (rule.workloads && rule.workloads.endpoint) workloads.push('EndpointDevices');

                const actions = rule.actions || {};
                const ruleObj = {
                    Name: rule.name,
                    DisplayName: rule.name,
                    Disabled: rule.enabled === false,
                    Priority: rule.priority !== undefined ? rule.priority : rIdx,
                    StopPolicyProcessing: !!rule.stopProcessing,
                    Workload: workloads.join(',') || 'Exchange',
                    BlockAccess: !!actions.block,
                    NotifyUser: actions.notify ? ['Owner'] : [],
                    NotifyAllowOverride: !!actions.override,
                    GenerateAlert: actions.monitor ? ['SiteAdmin'] : [],
                    GenerateIncidentReport: actions.monitor ? ['SiteAdmin'] : []
                };

                if (rule.tokens && rule.tokens.length > 0) {
                    try {
                        const conditionAst = tokensToConditionAst(rule.tokens);
                        if (conditionAst) {
                            ruleObj.AdvancedRule = JSON.stringify({ Version: '1.0', Condition: conditionAst });
                        }
                    } catch (_e) {
                        // Leave AdvancedRule unset if token expression is invalid
                    }
                }

                return ruleObj;
            })
        };
    });

    return JSON.stringify(output, null, 2);
};
