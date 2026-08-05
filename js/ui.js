let activeDropdownIndex = -1;

function getActiveDropdownIndex() { return activeDropdownIndex; }
function setActiveDropdownIndex(val) { activeDropdownIndex = val; }

function showToast(message, type = 'error') {
    const existing = document.getElementById('dlpToast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'dlpToast';
    toast.className = `fixed bottom-4 right-4 z-50 flex items-center justify-between gap-3 px-4 py-3 rounded-lg shadow-lg border transition-all transform translate-y-0 opacity-100 duration-300 min-w-[300px] max-w-md ${
        type === 'error' 
            ? 'bg-red-50 dark:bg-red-900/90 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200' 
            : 'bg-green-50 dark:bg-green-900/90 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
    }`;
    
    const msgSpan = document.createElement('span');
    msgSpan.className = 'text-sm font-semibold';
    msgSpan.textContent = message;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'text-lg leading-none font-bold opacity-60 hover:opacity-100 focus:outline-none';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = () => toast.remove();
    toast.appendChild(msgSpan);
    toast.appendChild(closeBtn);
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Recursively structures the nested parentheses matching JSON indentation structures
function chunkTokensIntoLines(tokens) {
    let lines = [];
    let currentLine = [];
    let currentIndent = 0;

    tokens.forEach((token, originalIndex) => {
        let enrichedToken = { ...token, originalIndex };

        if (token.val === '(') {
            if (currentLine.length > 0) {
                lines.push({ indent: currentIndent, tokens: currentLine });
            }
            lines.push({ indent: currentIndent, tokens: [enrichedToken] });
            currentIndent++;
            currentLine = [];
        } else if (token.val === ')') {
            if (currentLine.length > 0) {
                lines.push({ indent: currentIndent, tokens: currentLine });
            }
            currentIndent = Math.max(0, currentIndent - 1);
            lines.push({ indent: currentIndent, tokens: [enrichedToken] });
            currentLine = [];
        } else {
            currentLine.push(enrichedToken);
        }
    });

    if (currentLine.length > 0) {
        lines.push({ indent: currentIndent, tokens: currentLine });
    }
    return lines;
}




function renderPolicies() {
    const container = document.getElementById('policiesContainer');
    if (!container) return;
    container.innerHTML = '';

    if (policies.length === 0) {
        container.innerHTML = '<div class="text-gray-500 italic p-4 text-center border-2 border-dashed rounded dark:border-gray-700">No policies configured.</div>';
        return;
    }

    policies.forEach((policy, pIndex) => {
        const pDiv = document.createElement('div');
        pDiv.className = `p-4 rounded shadow-sm border-2 relative transition-colors ${policy.enabled ? 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-400 dark:border-indigo-600' : 'bg-indigo-50/40 dark:bg-indigo-950/10 border-indigo-300 dark:border-indigo-800 opacity-60'}`;

        let pHeader = `
            <div class="flex flex-wrap justify-between items-center gap-2 mb-4">
                <div class="flex flex-wrap items-center gap-3">
                    <div class="flex flex-col">
                        <button data-action="move-policy-up" data-pindex="${pIndex}" aria-label="Move policy up" class="text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white leading-none" ${pIndex === 0 ? 'disabled class="opacity-30"' : ''}>&#9650;</button>
                        <button data-action="move-policy-down" data-pindex="${pIndex}" aria-label="Move policy down" class="text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white leading-none" ${pIndex === policies.length - 1 ? 'disabled class="opacity-30"' : ''}>&#9660;</button>
                    </div>
                    <span class="text-[10px] font-bold uppercase tracking-widest bg-indigo-600 text-white px-1.5 py-0.5 rounded shrink-0">Policy</span>
                    <h2 class="font-bold text-lg outline-none focus:bg-white dark:focus:bg-gray-700 focus:ring-2 focus:ring-indigo-300 rounded px-1 min-w-[100px] max-w-full break-words dark:text-white" contenteditable="true" data-type="policy" data-pindex="${pIndex}">${window.escapeHtml(policy.name)}</h2>
                    <span class="text-xs bg-indigo-100 dark:bg-indigo-900/40 px-2 py-1 rounded text-indigo-700 dark:text-indigo-300 font-mono">Priority ${policy.priority !== undefined ? policy.priority : pIndex}</span>
                    <label class="flex items-center gap-1 text-sm font-normal ml-4 cursor-pointer dark:text-gray-300"><input type="checkbox" data-action="toggle-policy" data-pindex="${pIndex}" ${policy.enabled ? 'checked' : ''}> Enabled</label>
                </div>
                <div class="flex gap-2">
                    <button data-action="add-rule" data-pindex="${pIndex}" class="text-sm bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 px-3 py-1 rounded hover:bg-amber-200 dark:hover:bg-amber-900/50 font-medium shadow-sm">Add Rule</button>
                    <button data-action="duplicate-policy" data-pindex="${pIndex}" class="text-sm bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 px-3 py-1 rounded hover:bg-indigo-200 dark:hover:bg-indigo-900/50 font-medium shadow-sm">Duplicate</button>
                    <button data-action="delete-policy" data-pindex="${pIndex}" class="text-sm bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-3 py-1 rounded hover:bg-red-200 dark:hover:bg-red-900/50 font-medium shadow-sm">Delete Policy</button>
                </div>
            </div>
            <div class="space-y-4 pl-6 border-l-2 border-indigo-400 dark:border-indigo-600">
        `;
        pDiv.innerHTML = pHeader;

        const rulesContainer = document.createElement('div');
        rulesContainer.className = 'space-y-4';

        const policyConflicts = (typeof window.detectPolicyConflicts === 'function')
            ? window.detectPolicyConflicts(policy.rules)
            : {};

        policy.rules.forEach((rule, rIndex) => {
            const isActive = (pIndex === activePolicyIndex && rIndex === activeRuleIndex);
            const isRuleEnabled = policy.enabled && rule.enabled;
            const ruleIssues = policyConflicts[rIndex] || [];

            const rDiv = document.createElement('div');
            let rClass = 'p-4 rounded shadow-sm border-2 transition-all cursor-pointer ';
            if (isActive) rClass += 'bg-amber-100 dark:bg-amber-950/50 border-amber-500 ring-1 ring-amber-400 ';
            else if (!isRuleEnabled) rClass += 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 opacity-60 ';
            else rClass += 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700 ';

            rDiv.className = rClass;
            rDiv.dataset.pindex = pIndex;
            rDiv.dataset.rindex = rIndex;

            let warningBadgesHtml = '';
            ruleIssues.forEach(issue => {
                if (issue.type === 'unreachable') {
                    const escaped = issue.vars.map(v => window.escapeHtml(v)).join(', ');
                    warningBadgesHtml += `<span class="text-[10px] bg-red-600 text-white border border-red-700 px-1.5 py-0.5 rounded font-bold shadow-sm" title="Condition appears both positively and negated: ${escaped}">&#9888; Unreachable</span>`;
                } else if (issue.type === 'duplicate') {
                    warningBadgesHtml += `<span class="text-[10px] bg-red-600 text-white border border-red-700 px-1.5 py-0.5 rounded font-bold shadow-sm" title="Identical logic to Rule ${issue.duplicateOf}">&#9888; Duplicate of Rule ${issue.duplicateOf}</span>`;
                }
            });

            let rHeader = `
                <div class="flex flex-wrap justify-between items-center gap-2 mb-2">
                    <div class="flex items-center gap-3 flex-wrap">
                        <div class="flex flex-col">
                            <button data-action="move-rule-up" data-pindex="${pIndex}" data-rindex="${rIndex}" aria-label="Move rule up" class="text-gray-400 hover:text-black dark:hover:text-white leading-none text-xs" ${rIndex === 0 ? 'disabled class="opacity-30"' : ''}>&#9650;</button>
                            <button data-action="move-rule-down" data-pindex="${pIndex}" data-rindex="${rIndex}" aria-label="Move rule down" class="text-gray-400 hover:text-black dark:hover:text-white leading-none text-xs" ${rIndex === policy.rules.length - 1 ? 'disabled class="opacity-30"' : ''}>&#9660;</button>
                        </div>
                        <span class="text-[10px] font-bold uppercase tracking-widest bg-amber-600 text-white px-1.5 py-0.5 rounded shrink-0">Rule</span>
                        <h3 class="font-semibold outline-none focus:bg-white dark:focus:bg-gray-600 focus:ring-2 focus:ring-amber-300 rounded px-1 min-w-[100px] max-w-full break-words dark:text-white" contenteditable="true" data-type="rule" data-pindex="${pIndex}" data-rindex="${rIndex}">${window.escapeHtml(rule.name)}</h3>
                        <span class="text-xs font-mono ${isActive ? 'text-amber-700 dark:text-amber-400 font-bold' : 'text-gray-500 dark:text-gray-400'}">Priority ${rIndex} ${isActive ? '(Editing)' : ''}</span>
                        ${warningBadgesHtml}

                        <div class="flex gap-3 ml-2 border-l border-gray-300 dark:border-gray-600 pl-3" onclick="event.stopPropagation()">
                            <label class="flex items-center gap-1 text-xs font-semibold cursor-pointer dark:text-gray-300"><input type="checkbox" data-action="toggle-rule" data-pindex="${pIndex}" data-rindex="${rIndex}" ${rule.enabled ? 'checked' : ''}> Enabled</label>
                            <label class="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 cursor-pointer"><input type="checkbox" data-action="toggle-workload" data-workload="email" data-pindex="${pIndex}" data-rindex="${rIndex}" ${rule.workloads.email ? 'checked' : ''}> Email</label>
                            <label class="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 cursor-pointer"><input type="checkbox" data-action="toggle-workload" data-workload="endpoint" data-pindex="${pIndex}" data-rindex="${rIndex}" ${rule.workloads.endpoint ? 'checked' : ''}> Endpoint</label>
                        </div>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <button data-action="explain-nl" data-pindex="${pIndex}" data-rindex="${rIndex}" class="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-semibold border-r border-gray-300 dark:border-gray-600 pr-2">Explain using Natural Language</button>
                        <button data-action="duplicate-rule" data-pindex="${pIndex}" data-rindex="${rIndex}" class="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-semibold">Duplicate</button>
                        <button data-action="clear-logic" data-pindex="${pIndex}" data-rindex="${rIndex}" class="text-xs text-red-600 dark:text-red-400 hover:underline font-semibold border-l border-gray-300 dark:border-gray-600 pl-2">Clear Logic</button>
                        <button data-action="delete-rule" data-pindex="${pIndex}" data-rindex="${rIndex}" class="text-xs text-red-600 dark:text-red-400 hover:underline font-semibold border-l border-red-200 dark:border-red-800 pl-2">Delete Rule</button>
                    </div>
                </div>
                <div class="mt-2 mb-3 p-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded flex flex-wrap gap-4 items-center text-sm" onclick="event.stopPropagation()">
                    <span class="font-semibold text-gray-700 dark:text-gray-300">Actions:</span>
                    <label class="flex items-center gap-1 cursor-pointer dark:text-gray-300"><input type="checkbox" data-action="toggle-rule-action" data-ruleaction="monitor" data-pindex="${pIndex}" data-rindex="${rIndex}" ${rule.actions.monitor ? 'checked' : ''}> Monitor</label>
                    <label class="flex items-center gap-1 cursor-pointer dark:text-gray-300"><input type="checkbox" data-action="toggle-rule-action" data-ruleaction="notify" data-pindex="${pIndex}" data-rindex="${rIndex}" ${rule.actions.notify ? 'checked' : ''}> Notify</label>
                    <label class="flex items-center gap-1 cursor-pointer dark:text-gray-300"><input type="checkbox" data-action="toggle-rule-action" data-ruleaction="override" data-pindex="${pIndex}" data-rindex="${rIndex}" ${rule.actions.override ? 'checked' : ''}> Override</label>
                    <label class="flex items-center gap-1 cursor-pointer dark:text-gray-300"><input type="checkbox" data-action="toggle-rule-action" data-ruleaction="block" data-pindex="${pIndex}" data-rindex="${rIndex}" ${rule.actions.block ? 'checked' : ''}> Block</label>
                    <div class="border-l border-gray-300 dark:border-gray-600 h-4 mx-2 hidden sm:block"></div>
                    <label class="flex items-center gap-1 text-red-600 dark:text-red-400 font-semibold cursor-pointer"><input type="checkbox" data-action="toggle-stopprocessing" data-pindex="${pIndex}" data-rindex="${rIndex}" ${rule.stopProcessing ? 'checked' : ''}> Stop Processing</label>
                </div>
            `;
            
            let hasServerCondition = false;
            rule.tokens.forEach(token => {
                if (token.type === 'variable') {
                    let base = token.val.split(/:\s*(.*)/)[0];
                    if (window.getConditionContext(base) === 'server') {
                        hasServerCondition = true;
                    }
                }
            });
            if (rule.workloads.email && hasServerCondition) {
                rHeader += `<div class="text-xs text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-700 p-2 rounded mt-2 mb-2 font-semibold">&#9888; Contains Server-side only conditions. Will be deferred from Client-side pass in Exchange DLP.</div>`;
            }

            rDiv.innerHTML = rHeader;

            const dz = document.createElement('div');
            dz.className = 'drop-zone bg-slate-50 dark:bg-slate-900 border border-gray-300 dark:border-gray-700 rounded p-4 flex flex-col gap-1 min-h-[90px] font-mono shadow-inner relative';
            dz.dataset.action = 'drop-zone';
            dz.dataset.pindex = pIndex;
            dz.dataset.rindex = rIndex;

            if (rule.tokens.length === 0) {
                dz.innerHTML = '<span class="text-gray-400 dark:text-gray-500 text-sm pointer-events-none p-4 text-center w-full">Drag operators and conditions here to build structured nested logic...</span>';
            } else {
                const lines = chunkTokensIntoLines(rule.tokens);
                
                lines.forEach(line => {
                    const lineDiv = document.createElement('div');
                    lineDiv.className = 'flex flex-wrap gap-2 items-center w-full relative py-1.5';
                    lineDiv.style.paddingLeft = `${line.indent * 28 + 12}px`;
                    
                    for (let i = 0; i < line.indent; i++) {
                        const guide = document.createElement('div');
                        guide.className = 'absolute top-0 bottom-0 border-l border-dashed border-gray-300 dark:border-gray-700/80 pointer-events-none';
                        guide.style.left = `${i * 28 + 18}px`;
                        lineDiv.appendChild(guide);
                    }

                    line.tokens.forEach(token => {
                        const el = document.createElement('div');
                        let defaultBorder = '';
                        
                        if (token.val === '(' || token.val === ')') {
                            const bracketColorClasses = [
                                'text-pink-500 dark:text-pink-400 border-pink-300 dark:border-pink-700/80 bg-pink-500/5 dark:bg-pink-500/10 font-bold',
                                'text-purple-500 dark:text-purple-400 border-purple-300 dark:border-purple-700/80 bg-purple-500/5 dark:bg-purple-500/10 font-bold',
                                'text-teal-500 dark:text-teal-400 border-teal-300 dark:border-teal-700/80 bg-teal-500/5 dark:bg-teal-500/10 font-bold',
                                'text-green-500 dark:text-green-400 border-green-300 dark:border-green-700/80 bg-green-500/5 dark:bg-green-500/10 font-bold'
                            ];
                            const activeClass = bracketColorClasses[line.indent % bracketColorClasses.length];
                            el.className = `expression-item px-3.5 py-1 rounded-md text-sm font-mono flex items-center shadow-sm border cursor-grab active:cursor-grabbing z-10 ${activeClass}`;
                            defaultBorder = activeClass.split(' ').find(c => c.startsWith('border-'));
                            
                            const textSpan = document.createElement('span');
                            textSpan.innerText = token.val;
                            textSpan.className = 'pointer-events-none';
                            el.appendChild(textSpan);
                        } else if (token.type === 'variable' && token.val.includes(':')) {
                            // Split into base condition name and properties array
                            let parts = token.val.split(/:\s*(.*)/);
                            let base = parts[0];
                            let propsStr = parts[1] || '';
                            let props = propsStr.split(/,\s*/).filter(p => p.trim() !== '');

                            el.className = 'expression-item px-3 py-1.5 rounded-md text-sm font-mono flex flex-wrap items-center gap-1.5 shadow-sm border cursor-grab active:cursor-grabbing z-10 bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-300 border-blue-300 dark:border-blue-800';
                            
                            // Base text label
                            const baseSpan = document.createElement('span');
                            baseSpan.className = 'font-semibold pointer-events-none mr-0.5';
                            baseSpan.innerText = base + ':';
                            el.appendChild(baseSpan);

                            if (base === 'Content contains') {
                                const targetSelect = document.createElement('select');
                                targetSelect.className = 'ml-1 mr-1 text-xs bg-white dark:bg-gray-800 border border-blue-300 dark:border-blue-700 rounded px-1 py-0.5 outline-none cursor-pointer font-sans text-gray-700 dark:text-gray-300';
                                ['Both', 'Message', 'Attachment'].forEach(opt => {
                                    const option = document.createElement('option');
                                    option.value = opt;
                                    option.innerText = opt === 'Both' ? 'Msg+Att' : opt;
                                    if ((token.targetContext || 'Both') === opt) option.selected = true;
                                    targetSelect.appendChild(option);
                                });
                                targetSelect.onchange = (e) => {
                                    e.stopPropagation();
                                    token.targetContext = e.target.value;
                                    if (token.originalIndex !== undefined && window.policies[pIndex] && window.policies[pIndex].rules[rIndex]) {
                                        window.policies[pIndex].rules[rIndex].tokens[token.originalIndex].targetContext = e.target.value;
                                    }
                                    window.saveState();
                                    // No need to full re-render, the state is updated for the simulator
                                };
                                targetSelect.onmousedown = (e) => e.stopPropagation();
                                targetSelect.onclick = (e) => e.stopPropagation();
                                el.appendChild(targetSelect);
                            }

                            // Render individual property pills
                            props.forEach((prop, propIdx) => {
                                const pill = document.createElement('span');
                                pill.className = 'inline-flex items-center gap-1 bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700/80 px-2 py-0.5 rounded text-xs text-blue-800 dark:text-blue-200 font-sans shadow-sm select-none hover:bg-blue-100/50 dark:hover:bg-gray-700 transition-all';
                                
                                const propText = document.createElement('span');
                                propText.innerText = prop;
                                propText.className = 'cursor-pointer hover:underline';
                                propText.title = 'Click to edit property';
                                propText.onclick = (e) => {
                                    e.stopPropagation();
                                    window.editProperty(pIndex, rIndex, token.originalIndex, propIdx);
                                };
                                pill.appendChild(propText);

                                const removePropBtn = document.createElement('button');
                                removePropBtn.innerHTML = '&times;';
                                removePropBtn.className = 'font-bold opacity-60 hover:opacity-100 text-sm leading-none ml-1 outline-none';
                                removePropBtn.title = 'Remove property';
                                removePropBtn.setAttribute('aria-label', 'Remove property');
                                removePropBtn.onclick = (e) => {
                                    e.stopPropagation();
                                    window.removeProperty(pIndex, rIndex, token.originalIndex, propIdx);
                                };
                                pill.appendChild(removePropBtn);

                                el.appendChild(pill);
                            });

                            // Add property helper chip
                            const addPropBtn = document.createElement('button');
                            addPropBtn.innerHTML = '+ Add';
                            addPropBtn.className = 'inline-flex items-center bg-blue-100 dark:bg-blue-900/50 hover:bg-blue-200 dark:hover:bg-blue-900/80 border border-dashed border-blue-300 dark:border-blue-700 px-2 py-0.5 rounded text-xs text-blue-700 dark:text-blue-400 font-bold transition-all outline-none';
                            addPropBtn.onclick = (e) => {
                                e.stopPropagation();
                                window.addProperty(pIndex, rIndex, token.originalIndex);
                            };
                            el.appendChild(addPropBtn);
                            
                            const ctxBadgeWrapper = document.createElement('div');
                            ctxBadgeWrapper.innerHTML = window.renderContextBadge(window.getConditionContext(base));
                            el.appendChild(ctxBadgeWrapper.firstChild);
                        } else {
                            el.className = 'expression-item px-3 py-1 rounded-md text-sm font-mono flex items-center shadow-sm border cursor-grab active:cursor-grabbing z-10 ';
                            
                            if (token.type === 'operator') {
                                if (token.val === 'NOT' || token.val === 'AND NOT') { 
                                    el.classList.add('bg-red-700', 'text-white'); 
                                    defaultBorder = 'border-red-800'; 
                                } else { 
                                    el.classList.add('bg-gray-800', 'dark:bg-gray-700', 'text-white'); 
                                    defaultBorder = 'border-gray-900 dark:border-gray-800'; 
                                }
                            } else {
                                el.classList.add('bg-blue-50', 'dark:bg-blue-950/40', 'text-blue-900', 'dark:text-blue-300'); 
                                defaultBorder = 'border-blue-300 dark:border-blue-800';
                            }
                            el.classList.add(...defaultBorder.split(' '));

                            const textSpan = document.createElement('span');
                            textSpan.innerText = token.val;
                            textSpan.className = 'pointer-events-none';
                            el.appendChild(textSpan);
                            
                            if (token.type === 'variable') {
                                const ctxBadgeWrapper = document.createElement('div');
                                ctxBadgeWrapper.innerHTML = window.renderContextBadge(window.getConditionContext(token.val));
                                el.appendChild(ctxBadgeWrapper.firstChild);
                            }
                        }
                        
                        const delBtn = document.createElement('button');
                        delBtn.innerHTML = '&times;';
                        delBtn.setAttribute('aria-label', `Remove ${token.type === 'variable' ? token.val : token.val + ' operator'}`);
                        delBtn.className = 'ml-2 font-bold opacity-60 hover:opacity-100 px-1 text-lg leading-none outline-none';
                        delBtn.dataset.action = 'delete-token';
                        delBtn.dataset.pindex = pIndex;
                        delBtn.dataset.rindex = rIndex;
                        delBtn.dataset.tindex = token.originalIndex;
                        el.appendChild(delBtn);
                        
                        el.draggable = true;
                        el.dataset.type = token.type;
                        el.dataset.val = token.val;
                        el.dataset.source = "builder";
                        el.dataset.pindex = pIndex;
                        el.dataset.rindex = rIndex;
                        el.dataset.tindex = token.originalIndex;
                        
                        lineDiv.appendChild(el);
                    });
                    dz.appendChild(lineDiv);
                });
            }
            rDiv.appendChild(dz);
            rulesContainer.appendChild(rDiv);
        });
        pDiv.appendChild(rulesContainer);
        container.appendChild(pDiv);
    });
}

function populateDropdown() {
    const categoryEl = document.getElementById('conditionCategory');
    const dropdown = document.getElementById('conditionDropdownList');
    if (!categoryEl || !dropdown) return;

    const category = categoryEl.value;
    dropdown.innerHTML = '';
    activeDropdownIndex = -1;
    
    purviewConditions[category].forEach(cond => {
        const opt = document.createElement('div');
        opt.className = 'p-2 text-sm cursor-pointer hover:bg-blue-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-0 condition-option text-gray-700 dark:text-gray-300 transition-colors flex justify-between items-center';
        opt.innerHTML = `<span>${cond.base}</span>${cond.context ? window.renderContextBadge(cond.context) : ''}`;
        opt.dataset.action = 'select-condition';
        opt.dataset.value = cond.base;
        dropdown.appendChild(opt);
    });
}

function showDropdown() {
    const dropdown = document.getElementById('conditionDropdownList');
    if (dropdown) {
        dropdown.classList.remove('hidden');
        filterDropdown();
    }
}

function filterDropdown() {
    const searchInput = document.getElementById('conditionSearchInput');
    const dropdown = document.getElementById('conditionDropdownList');
    if (!searchInput || !dropdown) return;

    const searchStr = searchInput.value.toLowerCase();
    const options = dropdown.querySelectorAll('.condition-option');
    let hasVisible = false;
    activeDropdownIndex = -1;
    
    options.forEach(opt => {
        if (opt.innerText.toLowerCase().includes(searchStr)) {
            opt.style.display = 'block';
            opt.classList.remove('bg-blue-100', 'dark:bg-gray-600'); 
            hasVisible = true;
        } else {
            opt.style.display = 'none';
        }
    });
    if (hasVisible) dropdown.classList.remove('hidden');
    else dropdown.classList.add('hidden');
}

function togglePropertyInput() {
    const categoryEl = document.getElementById('conditionCategory');
    const searchInput = document.getElementById('conditionSearchInput');
    const input = document.getElementById('conditionProperty');
    if (!categoryEl || !searchInput || !input) return;

    const category = categoryEl.value;
    const baseVal = searchInput.value.trim();
    const config = purviewConditions[category].find(c => c.base === baseVal);
    
    if (config && config.requiresProp) {
        input.style.display = 'block';
        input.placeholder = config.placeholder || "Enter property value (comma separated)...";
        input.focus();
    } else {
        input.style.display = 'none';
        input.value = '';
    }
}

function updateDropdownHighlight(visibleOptions) {
    visibleOptions.forEach((opt, idx) => {
        if (idx === activeDropdownIndex) {
            opt.classList.add('bg-blue-100', 'dark:bg-gray-600');
            opt.classList.remove('hover:bg-blue-50', 'dark:hover:bg-gray-700');
            opt.scrollIntoView({ block: 'nearest' });
        } else {
            opt.classList.remove('bg-blue-100', 'dark:bg-gray-600');
            opt.classList.add('hover:bg-blue-50', 'dark:hover:bg-gray-700');
        }
    });
}

function filterConditionPool() {
    const searchInput = document.getElementById('poolSearchInput');
    if (!searchInput) return;

    const term = searchInput.value.toLowerCase();
    const items = document.querySelectorAll('.pool-item-container');
    items.forEach(item => {
        const text = item.querySelector('.drag-item').innerText.toLowerCase();
        item.style.display = text.includes(term) ? 'flex' : 'none';
    });
}

function renderVariables() {
    const box = document.getElementById('variablesBox');
    if (!box) return;
    box.innerHTML = '';

    variables.forEach((v, idx) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'pool-item-container flex justify-between items-stretch bg-blue-50 dark:bg-gray-800 text-blue-900 dark:text-blue-300 border border-blue-200 dark:border-gray-700 rounded shadow-sm text-sm overflow-hidden shrink-0';
        
        const dragHandle = document.createElement('div');
        dragHandle.className = 'drag-item px-3 py-2 flex-grow min-w-0 hover:bg-blue-100 dark:hover:bg-gray-700 transition-colors break-words cursor-pointer flex flex-col justify-center';
        dragHandle.draggable = true;
        let base = v.split(/:\s*(.*)/)[0];
        let context = window.getConditionContext(base);
        dragHandle.innerHTML = `<div class="flex items-center justify-between gap-1"><span class="break-words min-w-0">${window.escapeHtml(v)}</span><span class="shrink-0">${window.renderContextBadge(context)}</span></div>`;
        dragHandle.dataset.type = 'variable';
        dragHandle.dataset.val = v;
        dragHandle.dataset.source = 'pool';

        const btnGroup = document.createElement('div');
        btnGroup.className = 'flex items-stretch shrink-0';

        const addBtn = document.createElement('button');
        addBtn.className = 'px-3 py-2 hover:bg-green-100 dark:hover:bg-green-900/30 border-l border-blue-200 dark:border-gray-600 text-green-700 dark:text-green-400 transition-colors text-xs font-bold';
        addBtn.textContent = '+ Add';
        addBtn.title = "Add to active rule";
        addBtn.setAttribute('aria-label', `Add condition to rule: ${v}`);
        addBtn.dataset.action = 'add-to-rule';
        addBtn.dataset.val = v;

        const editBtn = document.createElement('button');
        editBtn.className = 'px-3 py-2 hover:bg-blue-200 dark:hover:bg-gray-700 font-bold border-l border-blue-200 dark:border-gray-600 text-blue-600 dark:text-blue-400 transition-colors';
        editBtn.innerHTML = '&#9998;';
        editBtn.title = "Edit condition";
        editBtn.setAttribute('aria-label', `Edit condition: ${v}`);
        editBtn.dataset.action = 'edit-pool';
        editBtn.dataset.index = idx;

        const delBtn = document.createElement('button');
        delBtn.className = 'px-3 py-2 hover:bg-red-100 dark:hover:bg-gray-700 font-bold border-l border-blue-200 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:text-red-700 dark:hover:text-red-400 transition-colors';
        delBtn.innerHTML = '&times;';
        delBtn.title = "Remove from pool";
        delBtn.setAttribute('aria-label', `Remove condition: ${v}`);
        delBtn.dataset.action = 'delete-pool';
        delBtn.dataset.index = idx;

        btnGroup.appendChild(addBtn);
        btnGroup.appendChild(editBtn);
        btnGroup.appendChild(delBtn);

        wrapper.appendChild(dragHandle);
        wrapper.appendChild(btnGroup);
        box.appendChild(wrapper);
    });
    filterConditionPool();
}

function renderHistoryUI() {
    const container = document.getElementById('historyTimelineContainer');
    if (!container) return;

    container.innerHTML = '';

    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    if (undoBtn) undoBtn.disabled = (historyPointer <= 0);
    if (redoBtn) redoBtn.disabled = (historyPointer >= historyTimeline.length - 1);

    historyTimeline.forEach((entry, idx) => {
        const isActive = (idx === historyPointer);
        
        const item = document.createElement('div');
        item.className = `relative flex flex-col gap-0.5 p-2 rounded border cursor-pointer transition-all duration-200 text-xs shadow-sm ${
            isActive 
                ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-400 dark:border-blue-800 text-blue-900 dark:text-blue-300 font-semibold ring-1 ring-blue-400' 
                : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500 text-gray-700 dark:text-gray-300'
        }`;

        item.dataset.action = 'jump-history';
        item.dataset.index = idx;

        const dot = document.createElement('div');
        dot.className = `absolute -left-[21px] top-4 w-2.5 h-2.5 rounded-full border-2 transition-all ${
            isActive
                ? 'bg-blue-500 border-blue-500 shadow-sm scale-110'
                : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600'
        }`;
        item.appendChild(dot);

        const header = document.createElement('div');
        header.className = 'flex justify-between items-center w-full gap-2';
        
        const desc = document.createElement('span');
        desc.className = 'break-words leading-tight flex-grow font-semibold';
        desc.innerText = entry.description;

        const time = document.createElement('span');
        time.className = 'text-[10px] text-gray-400 dark:text-gray-500 shrink-0 font-mono';
        time.innerText = entry.timestamp;

        header.appendChild(desc);
        header.appendChild(time);
        item.appendChild(header);

        const footer = document.createElement('div');
        footer.className = 'flex justify-between items-center text-[10px] mt-1';
        
        const pCount = entry.state.policies.length;
        let rCount = 0;
        entry.state.policies.forEach(p => rCount += p.rules.length);
        const vCount = entry.state.variables.length;

        const stats = document.createElement('span');
        stats.className = 'text-gray-400 dark:text-gray-500';
        stats.innerText = `${pCount} Policy${pCount === 1 ? '' : 'ies'} · ${rCount} Rule${rCount === 1 ? '' : 's'} · ${vCount} Condition${vCount === 1 ? '' : 's'}`;
        
        footer.appendChild(stats);
        item.appendChild(footer);

        container.appendChild(item);
    });

    const activeElem = container.querySelector('.ring-1');
    if (activeElem) {
        activeElem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function generateTable() {
    const errorMsg = document.getElementById('errorMsg');
    const titleEl = document.getElementById('truthTableTitle');
    const thead = document.getElementById('tableHead');
    const tbody = document.getElementById('tableBody');
    if (!thead || !tbody || !titleEl) return;
    
    errorMsg.classList.add('hidden');
    const csvBtn = document.getElementById('downloadCsvBtn');
    if (csvBtn) csvBtn.classList.add('hidden');

    if (policies.length === 0 || !policies[activePolicyIndex] || !policies[activePolicyIndex].rules[activeRuleIndex]) {
        titleEl.innerText = 'Truth Table Evaluation';
        thead.innerHTML = '';
        tbody.innerHTML = '<tr><td class="p-4 text-gray-500 italic text-center">No active rule selected.</td></tr>';
        return;
    }

    const activePolicy = policies[activePolicyIndex];
    const activeRule = activePolicy.rules[activeRuleIndex];
    titleEl.innerText = `Truth Table Evaluation: ${activePolicy.name} \u2192 ${activeRule.name}`;

    if (!activePolicy.enabled || !activeRule.enabled) {
        thead.innerHTML = '';
        tbody.innerHTML = `<tr><td class="p-4 text-red-500 italic text-center font-semibold text-sm">The active rule or its parent policy is disabled. Logic will not evaluate.</td></tr>`;
        return;
    }

    if (activeRule.tokens.length === 0) {
        thead.innerHTML = '';
        tbody.innerHTML = `<tr><td class="p-4 text-gray-500 italic text-center">The active rule has no conditions configured.</td></tr>`;
        return;
    }

    let allVarsSet = new Set();
    activeRule.tokens.forEach(t => { if (t.type === 'variable') allVarsSet.add(t.val); });
    
    let postfix;
    try {
        postfix = infixToPostfix(activeRule.tokens);
    } catch(e) { 
        errorMsg.innerText = "Error: " + e.message;
        errorMsg.classList.remove('hidden');
        return;
    }

    let uniqueVars = Array.from(allVarsSet);
    const generateAllBtn = document.getElementById('generateAllAITracesBtn');
    
    if (uniqueVars.length > 12) {
        if (generateAllBtn) generateAllBtn.classList.add('hidden');
        errorMsg.innerText = "Error: Too many unique conditions in this rule. Truth table capped to prevent browser crash.";
        errorMsg.classList.remove('hidden');
        return;
    }

    let headHtml = '<tr>';
    uniqueVars.forEach(v => {
        let formattedV = window.escapeHtml(v).replace(/,\s*/g, ',<br>');
        headHtml += `<th scope="col" class="border border-gray-300 dark:border-gray-600 p-2 text-xs font-semibold whitespace-nowrap min-w-[150px] text-center bg-gray-50 dark:bg-gray-800 align-top">${formattedV}</th>`;
    });
    headHtml += `<th scope="col" class="border border-gray-300 dark:border-gray-600 p-2 bg-blue-50 dark:bg-gray-800 text-xs font-semibold align-top text-center w-full">Evaluation Trace</th>`;
    headHtml += `<th scope="col" class="border border-gray-300 dark:border-gray-600 p-2 bg-gray-800 dark:bg-gray-600 text-white font-bold text-center w-20 text-xs align-top">FINAL</th></tr>`;
    thead.innerHTML = headHtml;

    let bodyHtml = '';
    const numRows = Math.pow(2, uniqueVars.length);

    for (let i = 0; i < numRows; i++) {
        let currentValues = {};
        bodyHtml += '<tr>';
        
        for (let j = 0; j < uniqueVars.length; j++) {
            let bit = (i >> (uniqueVars.length - 1 - j)) & 1;
            let val = bit === 1;
            currentValues[uniqueVars[j]] = val;
            
            let token = activeRule.tokens.find(t => t.type === 'variable' && t.val === uniqueVars[j]);
            if (token) {
                window.expandTokenSimVars(token).forEach(k => {
                    currentValues[k] = val;
                });
            }
            
            let cellClass = val ? "truth-t" : "truth-f";
            bodyHtml += `<td class="border border-gray-300 dark:border-gray-700 p-2 text-center text-sm w-24 ${cellClass}">${val ? 'T' : 'F'}</td>`;
        }
        
        let result = evaluatePostfix(postfix, currentValues);
        let trace = generateEvaluationTrace(activeRule.tokens, currentValues);
        
        let explHtml = '';
        let staticExpl = window.generateStaticTraceExplanation(activeRule.tokens, currentValues, result);
        explHtml += `<div class="mt-2 text-xs text-gray-500 dark:text-gray-400 break-words leading-relaxed">${window.escapeHtml(staticExpl)}</div>`;
        
        if (window.nlSettings && window.nlSettings.enableAITrace) {
            let rawTrace = trace.replace(/<[^>]+>/g, '');
            explHtml += `<div class="mt-2"><button onclick="window.handleAITraceExplanation(this)" data-raw-trace="${window.escapeHtml(rawTrace)}" data-cv="${window.escapeHtml(JSON.stringify(currentValues))}" data-res="${result}" class="text-xs text-indigo-600 dark:text-indigo-400 hover:underline border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 px-2 py-1 rounded">Explain with AI</button></div>`;
        }
        
        bodyHtml += `<td class="border border-gray-300 dark:border-gray-700 p-2 font-mono text-xs w-full break-words leading-relaxed">${trace}${explHtml}</td>`;
        
        let resClass = result ? "truth-t text-lg" : "truth-f text-lg";
        bodyHtml += `<td class="border border-gray-300 dark:border-gray-700 p-2 text-center w-20 ${resClass}">${result ? 'T' : 'F'}</td>`;
        bodyHtml += '</tr>';
    }
    
    tbody.innerHTML = bodyHtml;
    if (csvBtn) csvBtn.classList.remove('hidden');

    if (window.nlSettings && window.nlSettings.enableAITrace && numRows > 0) {
        if (generateAllBtn) generateAllBtn.classList.remove('hidden');
    } else {
        if (generateAllBtn) generateAllBtn.classList.add('hidden');
    }
}

// Export the active rule's truth table as a CSV file. Recomputes rows from the
// rule tokens (same enumeration as generateTable) so the CSV matches the UI but
// carries plain-text traces/explanations rather than HTML.
window.downloadTruthTableCSV = function() {
    if (policies.length === 0 || !policies[activePolicyIndex] || !policies[activePolicyIndex].rules[activeRuleIndex]) {
        window.showToast('No active rule to export.');
        return;
    }
    const activePolicy = policies[activePolicyIndex];
    const activeRule = activePolicy.rules[activeRuleIndex];

    if (!activePolicy.enabled || !activeRule.enabled) {
        window.showToast('The active rule or its policy is disabled — nothing to export.');
        return;
    }
    if (activeRule.tokens.length === 0) {
        window.showToast('The active rule has no conditions to export.');
        return;
    }

    const allVarsSet = new Set();
    activeRule.tokens.forEach(t => { if (t.type === 'variable') allVarsSet.add(t.val); });
    const uniqueVars = Array.from(allVarsSet);

    if (uniqueVars.length > 12) {
        window.showToast('Too many unique conditions to export.');
        return;
    }

    let postfix;
    try {
        postfix = infixToPostfix(activeRule.tokens);
    } catch (e) {
        window.showToast('Cannot export: ' + e.message);
        return;
    }

    // RFC-4180 style escaping: wrap in quotes and double any internal quotes.
    const esc = (val) => {
        const s = String(val ?? '');
        return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const header = [...uniqueVars, 'Logic Trace', 'Explanation', 'Result'];
    const rows = [header.map(esc).join(',')];

    const numRows = Math.pow(2, uniqueVars.length);
    for (let i = 0; i < numRows; i++) {
        const currentValues = {};
        const cells = [];
        for (let j = 0; j < uniqueVars.length; j++) {
            const bit = (i >> (uniqueVars.length - 1 - j)) & 1;
            const val = bit === 1;
            currentValues[uniqueVars[j]] = val;
            const token = activeRule.tokens.find(t => t.type === 'variable' && t.val === uniqueVars[j]);
            if (token) {
                window.expandTokenSimVars(token).forEach(k => { currentValues[k] = val; });
            }
            cells.push(val ? 'T' : 'F');
        }
        const result = evaluatePostfix(postfix, currentValues);
        const trace = generateEvaluationTrace(activeRule.tokens, currentValues).replace(/<[^>]+>/g, '');
        const expl = window.generateStaticTraceExplanation
            ? window.generateStaticTraceExplanation(activeRule.tokens, currentValues, result)
            : '';
        cells.push(trace, expl, result ? 'TRUE' : 'FALSE');
        rows.push(cells.map(esc).join(','));
    }

    // Prepend UTF-8 BOM so Excel reads accented characters correctly.
    const csv = '﻿' + rows.join('\r\n');
    const safeName = `${activePolicy.name}-${activeRule.name}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'truth-table';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}-truth-table.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    window.showToast('Truth table exported as CSV.', 'success');
};

window.handleAITraceExplanation = async function(btn) {
    const rawTrace = btn.dataset.rawTrace;
    const currentValues = JSON.parse(btn.dataset.cv);
    const finalResult = btn.dataset.res === 'true';
    const rule = window.policies[window.activePolicyIndex].rules[window.activeRuleIndex];
    
    btn.innerHTML = 'Generating...';
    btn.disabled = true;
    
    try {
        const expl = await window.generateAITraceExplanation(rule, rawTrace, currentValues, finalResult);
        const container = btn.parentElement;
        
        let formattedExpl = window.escapeHtml(expl);
        // Add color coding to True, False, and NOT
        formattedExpl = formattedExpl.replace(/\b(True)\b/g, '<span class="text-green-600 dark:text-green-400 font-bold">$1</span>');
        formattedExpl = formattedExpl.replace(/\b(False)\b/g, '<span class="text-red-600 dark:text-red-400 font-bold">$1</span>');
        formattedExpl = formattedExpl.replace(/\b(NOT)\b/g, '<span class="text-red-600 dark:text-red-400 font-bold">$1</span>');
        
        container.innerHTML = `
            <div class="mt-3 p-3 bg-indigo-50/50 dark:bg-indigo-900/10 border border-indigo-200 dark:border-indigo-800 rounded shadow-sm relative">
                <div class="absolute -top-2.5 left-2 bg-white dark:bg-gray-800 px-1 flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-indigo-500 dark:text-indigo-400">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                    AI Generated
                </div>
                <div class="text-xs text-gray-700 dark:text-gray-300 break-words leading-relaxed whitespace-pre-wrap">${formattedExpl}</div>
            </div>`;
    } catch(err) {
        btn.innerHTML = 'Explain with AI';
        btn.disabled = false;
        alert(err.message);
        throw err; // throw so generateAll can handle failure
    }
};

window.generateAllAITraces = async function() {
    const generateAllBtn = document.getElementById('generateAllAITracesBtn');
    if (!generateAllBtn) return;
    
    const originalText = generateAllBtn.innerText;
    generateAllBtn.innerText = 'Generating All...';
    generateAllBtn.disabled = true;
    generateAllBtn.classList.add('opacity-50');
    
    try {
        const tableBody = document.getElementById('tableBody');
        if (!tableBody) return;
        const traceBtns = Array.from(tableBody.querySelectorAll('button')).filter(b => b.innerText.includes('Explain with AI') || b.innerText.includes('Generating...'));
        
        const promises = traceBtns.map(tBtn => {
            if (!tBtn.disabled || tBtn.innerText.includes('Explain')) {
                return window.handleAITraceExplanation(tBtn).catch(e => {
                    console.error("Failed to generate trace explanation", e);
                });
            }
            return Promise.resolve();
        });
        
        await Promise.allSettled(promises);
    } finally {
        generateAllBtn.classList.add('hidden');
        generateAllBtn.innerText = originalText;
        generateAllBtn.disabled = false;
        generateAllBtn.classList.remove('opacity-50');
    }
};

window.getActiveDropdownIndex = getActiveDropdownIndex;
window.setActiveDropdownIndex = setActiveDropdownIndex;
window.showToast = showToast;
window.chunkTokensIntoLines = chunkTokensIntoLines;
window.renderPolicies = renderPolicies;
window.populateDropdown = populateDropdown;
window.showDropdown = showDropdown;
window.filterDropdown = filterDropdown;
window.togglePropertyInput = togglePropertyInput;
window.updateDropdownHighlight = updateDropdownHighlight;
window.filterConditionPool = filterConditionPool;
window.renderVariables = renderVariables;
window.renderHistoryUI = renderHistoryUI;
window.generateTable = generateTable;
