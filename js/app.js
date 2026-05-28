

// Setup Event Listeners and Orchestrate Actions
function registerEventHandlers() {
    // 1. Core Click Event Delegation
    document.addEventListener('click', (e) => {
        const target = e.target;
        const action = target.dataset.action;
        
        // Handle Rule Click Activation Selection
        const ruleCard = target.closest('[data-pindex][data-rindex]');
        if (ruleCard && !action && !target.closest('button') && !target.hasAttribute('contenteditable') && !target.closest('label') && !target.closest('input')) {
            const pIdx = parseInt(ruleCard.dataset.pindex);
            const rIdx = parseInt(ruleCard.dataset.rindex);
            setActivePolicyIndex(pIdx);
            setActiveRuleIndex(rIdx);
            renderPolicies();
            generateTable();
            return;
        }

        if (!action) return;

        // Policy Actions
        if (action === 'move-policy-up' || action === 'move-policy-down') {
            const pIndex = parseInt(target.dataset.pindex);
            const dir = action === 'move-policy-up' ? -1 : 1;
            movePolicy(pIndex, dir);
        }
        else if (action === 'delete-policy') {
            const pIndex = parseInt(target.dataset.pindex);
            deletePolicy(pIndex);
        }
        else if (action === 'add-rule') {
            const pIndex = parseInt(target.dataset.pindex);
            addRule(pIndex);
        }
        
        // Rule Actions
        else if (action === 'move-rule-up' || action === 'move-rule-down') {
            const pIndex = parseInt(target.dataset.pindex);
            const rIndex = parseInt(target.dataset.rindex);
            const dir = action === 'move-rule-up' ? -1 : 1;
            moveRule(pIndex, rIndex, dir);
        }
        else if (action === 'delete-rule') {
            const pIndex = parseInt(target.dataset.pindex);
            const rIndex = parseInt(target.dataset.rindex);
            deleteRule(pIndex, rIndex);
        }
        else if (action === 'clear-logic') {
            const pIndex = parseInt(target.dataset.pindex);
            const rIndex = parseInt(target.dataset.rindex);
            clearRuleTokens(pIndex, rIndex);
        }
        
        // Form selections
        else if (action === 'select-condition') {
            const val = target.dataset.value;
            selectCondition(val);
        }
        
        // Condition Pool Actions
        else if (action === 'edit-pool') {
            const index = parseInt(target.dataset.index);
            editPoolCondition(index);
        }
        else if (action === 'delete-pool') {
            const index = parseInt(target.dataset.index);
            removeVariable(index);
        }
        
        // Timeline Action
        else if (action === 'jump-history') {
            const index = parseInt(target.dataset.index);
            jumpToHistory(index);
        }
        
        // Token actions
        else if (action === 'delete-token') {
            const pIndex = parseInt(target.dataset.pindex);
            const rIndex = parseInt(target.dataset.rindex);
            const tIndex = parseInt(target.dataset.tindex);
            removeToken(pIndex, rIndex, tIndex);
        }
    });

    // 2. Change Listeners (Checkboxes)
    document.addEventListener('change', (e) => {
        const target = e.target;
        const action = target.dataset.action;
        if (!action) return;

        const pIndex = parseInt(target.dataset.pindex);
        const rIndex = parseInt(target.dataset.rindex);

        if (action === 'toggle-policy') {
            toggleEnabled('policy', pIndex, null, target.checked);
        }
        else if (action === 'toggle-rule') {
            toggleEnabled('rule', pIndex, rIndex, target.checked);
        }
        else if (action === 'toggle-workload') {
            const workload = target.dataset.workload;
            toggleWorkload(pIndex, rIndex, workload, target.checked);
        }
        else if (action === 'toggle-rule-action') {
            const ruleAction = target.dataset.ruleaction;
            updateAction(pIndex, rIndex, ruleAction, target.checked);
        }
        else if (action === 'toggle-stopprocessing') {
            updateStopProcessing(pIndex, rIndex, target.checked);
        }
    });

    // 3. Name Blur updates (Contenteditable fields)
    document.addEventListener('blur', (e) => {
        const target = e.target;
        const type = target.dataset.type;
        if (!type) return;

        const pIndex = parseInt(target.dataset.pindex);
        const rIndex = parseInt(target.dataset.rindex);
        updateName(type, pIndex, rIndex, target);
    }, true);

    document.addEventListener('keydown', (e) => {
        const target = e.target;
        if (target.hasAttribute('contenteditable') && e.key === 'Enter') {
            e.preventDefault();
            target.blur();
        }
    });

    // 4. Dropdown dismiss triggers
    document.addEventListener('click', (e) => {
        const searchInput = document.getElementById('conditionSearchInput');
        const dropdown = document.getElementById('conditionDropdownList');
        if (searchInput && dropdown && !searchInput.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });
}

// Action Helper Delegations
function movePolicy(pIndex, dir) {
    if (pIndex + dir < 0 || pIndex + dir >= policies.length) return;
    const temp = policies[pIndex];
    policies[pIndex] = policies[pIndex + dir];
    policies[pIndex + dir] = temp;
    if (activePolicyIndex === pIndex) setActivePolicyIndex(pIndex + dir);
    else if (activePolicyIndex === pIndex + dir) setActivePolicyIndex(pIndex);
    saveState(`Moved Policy "${policies[pIndex + dir].name}" ${dir < 0 ? 'up' : 'down'}`);
    renderPolicies();
    generateTable();
}

function deletePolicy(pIndex) {
    const name = policies[pIndex]?.name || "Policy";
    policies.splice(pIndex, 1);
    if (activePolicyIndex === pIndex) { setActivePolicyIndex(0); setActiveRuleIndex(0); } 
    else if (activePolicyIndex > pIndex) { setActivePolicyIndex(activePolicyIndex - 1); }
    saveState(`Deleted Policy "${name}"`);
    renderPolicies();
    generateTable();
}

function addRule(pIndex) {
    policies[pIndex].rules.push({ 
        id: generateId(), 
        name: `Rule ${policies[pIndex].rules.length + 1}`, 
        enabled: true,
        tokens: [],
        actions: { monitor: false, notify: false, override: false, block: false },
        stopProcessing: false,
        workloads: { email: true, endpoint: true }
    });
    setActivePolicyIndex(pIndex);
    setActiveRuleIndex(policies[pIndex].rules.length - 1);
    saveState(`Created Rule "${policies[pIndex].rules[activeRuleIndex].name}"`);
    renderPolicies();
    generateTable();
}

function moveRule(pIndex, rIndex, dir) {
    const rules = policies[pIndex].rules;
    if (rIndex + dir < 0 || rIndex + dir >= rules.length) return;
    const temp = rules[rIndex];
    rules[rIndex] = rules[rIndex + dir];
    rules[rIndex + dir] = temp;
    if (activePolicyIndex === pIndex) {
        if (activeRuleIndex === rIndex) setActiveRuleIndex(rIndex + dir);
        else if (activeRuleIndex === rIndex + dir) setActiveRuleIndex(rIndex);
    }
    saveState(`Moved Rule "${rules[rIndex + dir].name}" ${dir < 0 ? 'up' : 'down'}`);
    renderPolicies();
    generateTable();
}

function deleteRule(pIndex, rIndex) {
    const name = policies[pIndex]?.rules[rIndex]?.name || "Rule";
    policies[pIndex].rules.splice(rIndex, 1);
    if (activePolicyIndex === pIndex && activeRuleIndex === rIndex) setActiveRuleIndex(Math.max(0, rIndex - 1));
    else if (activePolicyIndex === pIndex && activeRuleIndex > rIndex) setActiveRuleIndex(activeRuleIndex - 1);
    saveState(`Deleted Rule "${name}"`);
    renderPolicies();
    generateTable();
}

function clearRuleTokens(pIndex, rIndex) {
    policies[pIndex].rules[rIndex].tokens = [];
    saveState(`Cleared rule logic for "${policies[pIndex].rules[rIndex].name}"`);
    renderPolicies();
    generateTable();
}

function toggleEnabled(type, pIndex, rIndex, value) {
    if (type === 'policy') {
        policies[pIndex].enabled = value;
        saveState(`${value ? 'Enabled' : 'Disabled'} Policy "${policies[pIndex].name}"`);
    }
    if (type === 'rule') {
        policies[pIndex].rules[rIndex].enabled = value;
        saveState(`${value ? 'Enabled' : 'Disabled'} Rule "${policies[pIndex].rules[rIndex].name}"`);
    }
    renderPolicies();
    generateTable();
}

function toggleWorkload(pIndex, rIndex, type, value) {
    policies[pIndex].rules[rIndex].workloads[type] = value;
    saveState(`Updated workload settings for Rule "${policies[pIndex].rules[rIndex].name}"`);
    renderPolicies();
}

function updateAction(pIndex, rIndex, action, value) {
    policies[pIndex].rules[rIndex].actions[action] = value;
    saveState(`Updated action "${action}" for Rule "${policies[pIndex].rules[rIndex].name}"`);
}

function updateStopProcessing(pIndex, rIndex, value) {
    policies[pIndex].rules[rIndex].stopProcessing = value;
    saveState(`Updated stop processing for Rule "${policies[pIndex].rules[rIndex].name}"`);
}

function updateName(type, pIndex, rIndex, element) {
    const newName = element.innerText.trim();
    if (type === 'policy') {
        if (policies[pIndex].name === newName) return;
        policies[pIndex].name = newName;
        saveState(`Renamed Policy to "${newName}"`);
    }
    if (type === 'rule') {
        if (policies[pIndex].rules[rIndex].name === newName) return;
        policies[pIndex].rules[rIndex].name = newName;
        saveState(`Renamed Rule to "${newName}"`);
    }
    generateTable();
}

function selectCondition(baseVal) {
    document.getElementById('conditionSearchInput').value = baseVal;
    document.getElementById('conditionDropdownList').classList.add('hidden');
    togglePropertyInput();
}

function editPoolCondition(idx) {
    const oldVal = variables[idx];
    const newVal = prompt("Edit condition (comma separate multiple properties):", oldVal);
    if (newVal !== null && newVal.trim() !== "" && newVal !== oldVal) {
        const cleanVal = newVal.trim();
        variables[idx] = cleanVal;
        
        policies.forEach(p => {
            p.rules.forEach(r => {
                r.tokens.forEach(t => {
                    if (t.type === 'variable' && t.val === oldVal) {
                        t.val = cleanVal;
                    }
                });
            });
        });
        
        saveState(`Edited Pool Condition from "${oldVal}" to "${cleanVal}"`);
        renderVariables();
        renderPolicies();
        generateTable();
    }
}

function removeVariable(index) {
    const oldVal = variables[index];
    variables.splice(index, 1);
    renderVariables();
    saveState(`Removed Pool Condition: "${oldVal}"`);
}

function removeToken(pIndex, rIndex, tIndex) {
    policies[pIndex].rules[rIndex].tokens.splice(tIndex, 1);
    renderPolicies();
    generateTable();
    saveState(`Removed expression item from Rule "${policies[pIndex].rules[rIndex].name}"`);
}

// 5. Drag and Drop handlers
function allowDrop(ev) { ev.preventDefault(); }

function drag(ev) {
    const item = ev.target.closest('.drag-item, .expression-item');
    if (!item) return;

    ev.dataTransfer.setData("type", item.dataset.type);
    ev.dataTransfer.setData("val", item.dataset.val);
    ev.dataTransfer.setData("source", item.dataset.source || "pool");
    if (item.dataset.source === "builder") {
        ev.dataTransfer.setData("pIndex", item.dataset.pindex);
        ev.dataTransfer.setData("rIndex", item.dataset.rindex);
        ev.dataTransfer.setData("tIndex", item.dataset.tindex);
    }
}

function drop(ev, targetPIndex, targetRIndex) {
    ev.preventDefault();
    setActivePolicyIndex(targetPIndex);
    setActiveRuleIndex(targetRIndex);

    const source = ev.dataTransfer.getData("source");
    const targetTokens = policies[targetPIndex].rules[targetRIndex].tokens;

    // Detect if we dropped directly on an expression-item in this rule
    const el = ev.target.closest('.expression-item');
    const type = ev.dataTransfer.getData("type");
    const val = ev.dataTransfer.getData("val");

    if (type === 'variable' && val.includes(':') && el && el.dataset.tindex !== undefined) {
        let targetTIndex = parseInt(el.dataset.tindex);
        let targetToken = targetTokens[targetTIndex];

        if (targetToken && targetToken.type === 'variable') {
            let sourceParts = val.split(/:\s*(.*)/);
            let sourceBase = sourceParts[0];
            let sourcePropsStr = sourceParts[1] || '';
            let sourceProps = sourcePropsStr.split(/,\s*/).filter(p => p.trim() !== '');

            let targetParts = targetToken.val.split(/:\s*(.*)/);
            let targetBase = targetParts[0];
            let targetPropsStr = targetParts[1] || '';
            let targetProps = targetPropsStr.split(/,\s*/).filter(p => p.trim() !== '');

            if (sourceBase === targetBase) {
                // Merge properties
                sourceProps.forEach(p => {
                    if (!targetProps.includes(p)) targetProps.push(p);
                });
                targetToken.val = `${targetBase}: ${targetProps.join(', ')}`;

                // If source was another token in the builder, remove the old one
                if (source === "builder") {
                    const fromP = parseInt(ev.dataTransfer.getData("pIndex"));
                    const fromR = parseInt(ev.dataTransfer.getData("rIndex"));
                    const fromT = parseInt(ev.dataTransfer.getData("tIndex"));
                    
                    policies[fromP].rules[fromR].tokens.splice(fromT, 1);
                }

                saveState(`Merged property into existing "${targetBase}" condition via Drag and Drop`);
                renderPolicies();
                generateTable();
                return;
            }
        }
    }

    let dropIndex = targetTokens.length; 
    if (el && el.dataset.tindex !== undefined) dropIndex = parseInt(el.dataset.tindex);

    if (source === "builder") {
        const fromP = parseInt(ev.dataTransfer.getData("pIndex"));
        const fromR = parseInt(ev.dataTransfer.getData("rIndex"));
        const fromT = parseInt(ev.dataTransfer.getData("tIndex"));

        const [movedItem] = policies[fromP].rules[fromR].tokens.splice(fromT, 1);
        if (fromP === targetPIndex && fromR === targetRIndex && dropIndex > fromT) dropIndex--; 
        targetTokens.splice(dropIndex, 0, movedItem);
    } else {
        if (type && val) targetTokens.splice(dropIndex, 0, { type, val });
    }
    renderPolicies();
    generateTable();
    saveState(`Modified expression for Rule "${policies[targetPIndex].rules[targetRIndex].name}"`);
}

// Bind drag and drop events at document level to capture dynamic elements
function registerDragDrop() {
    document.addEventListener('dragstart', (e) => {
        drag(e);
    });

    document.addEventListener('dragover', (e) => {
        const dropZone = e.target.closest('[data-action="drop-zone"]');
        if (dropZone) {
            allowDrop(e);
        }
    });

    document.addEventListener('drop', (e) => {
        const dropZone = e.target.closest('[data-action="drop-zone"]');
        if (dropZone) {
            const pIdx = parseInt(dropZone.dataset.pindex);
            const rIdx = parseInt(dropZone.dataset.rindex);
            drop(e, pIdx, rIdx);
        }
    });
}

// Bootstrapping the application
window.initApp = function() {
    for (const category in purviewConditions) {
        purviewConditions[category].sort((a, b) => a.base.localeCompare(b.base));
    }
    populateDropdown();
    
    loadState();
    
    if (policies.length === 0) {
        policies.push({ 
            id: generateId(), 
            name: "Policy 1", 
            enabled: true,
            rules: [{ 
                id: generateId(), 
                name: "Rule 1", 
                enabled: true, 
                tokens: [], 
                actions: { monitor: false, notify: false, override: false, block: false }, 
                stopProcessing: false,
                workloads: { email: true, endpoint: true }
            }] 
        });
    }
    
    // Set up initial history entry if timeline is empty
    if (historyTimeline.length === 0) {
        historyTimeline.push({
            state: JSON.parse(JSON.stringify({ policies, variables })),
            description: "Initial state loaded",
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        });
        window.historyTimeline = historyTimeline;
    }
    
    renderVariables();
    renderPolicies();
    generateTable();
    renderHistoryUI();

    // Register active observer sync updates
    subscribe(() => {
        renderVariables();
        renderPolicies();
        generateTable();
        renderHistoryUI();
    });

    // Intercept form submission
    const select = document.getElementById('conditionCategory');
    if (select) {
        select.onchange = () => {
            document.getElementById('conditionSearchInput').value = '';
            document.getElementById('conditionProperty').style.display = 'none';
            document.getElementById('conditionProperty').value = '';
            populateDropdown();
        };
    }

    const searchInput = document.getElementById('conditionSearchInput');
    if (searchInput) {
        searchInput.onfocus = showDropdown;
        searchInput.oninput = filterDropdown;
        searchInput.onkeydown = (e) => {
            const dropdown = document.getElementById('conditionDropdownList');
            if (!dropdown || dropdown.classList.contains('hidden')) return;
            
            const visibleOptions = Array.from(dropdown.querySelectorAll('.condition-option')).filter(opt => opt.style.display !== 'none');
            if (visibleOptions.length === 0) return;

            let dropdownIdx = getActiveDropdownIndex();

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                dropdownIdx = (dropdownIdx + 1) % visibleOptions.length;
                setActiveDropdownIndex(dropdownIdx);
                updateDropdownHighlight(visibleOptions);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                dropdownIdx = (dropdownIdx - 1 + visibleOptions.length) % visibleOptions.length;
                setActiveDropdownIndex(dropdownIdx);
                updateDropdownHighlight(visibleOptions);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (dropdownIdx >= 0 && dropdownIdx < visibleOptions.length) {
                    visibleOptions[dropdownIdx].click();
                }
            }
        };
    }

    const propInput = document.getElementById('conditionProperty');
    if (propInput) {
        propInput.onkeydown = (e) => {
            if (e.key === 'Enter') addVariableFromUI();
        };
    }

    const addBtn = document.getElementById('addVariableBtn');
    if (addBtn) {
        addBtn.onclick = addVariableFromUI;
    }

    const poolSearch = document.getElementById('poolSearchInput');
    if (poolSearch) {
        poolSearch.oninput = filterConditionPool;
    }

    const clearPoolBtn = document.getElementById('clearPoolBtn');
    if (clearPoolBtn) {
        clearPoolBtn.onclick = () => {
            setVariables([]);
            renderVariables();
            saveState("Cleared all conditions from Pool");
        };
    }

    const undoButton = document.getElementById('undoBtn');
    if (undoButton) {
        undoButton.onclick = undo;
    }

    const redoButton = document.getElementById('redoBtn');
    if (redoButton) {
        redoButton.onclick = redo;
    }

    // Modal Import/Export Actions
    window.toggleModal = function() {
        const modal = document.getElementById('dataModal');
        modal.classList.toggle('hidden');
        document.getElementById('modalError').classList.add('hidden');
    };

    window.importPurviewJSON = function() {
        try {
            const rawText = document.getElementById('jsonPayload').value;
            const res = parsePurviewJSON(rawText, variables);
            setPolicies(res.policies);
            setVariables(res.variables);
            setActivePolicyIndex(0);
            setActiveRuleIndex(0);
            saveState("Imported Microsoft Purview JSON");
            toggleModal();
            showToast("Microsoft Purview JSON parsed successfully!", "success");
        } catch(e) {
            const err = document.getElementById('modalError');
            err.innerText = "Error parsing JSON: " + e.message;
            err.classList.remove('hidden');
        }
    };

    window.importVisualizerJSON = function() {
        try {
            const rawText = document.getElementById('jsonPayload').value;
            const res = parseVisualizerJSON(rawText);
            setPolicies(res.policies);
            setVariables(res.variables);
            setActivePolicyIndex(0);
            setActiveRuleIndex(0);
            saveState("Imported workspace state");
            toggleModal();
            showToast("Workspace imported successfully!", "success");
        } catch(e) {
            const err = document.getElementById('modalError');
            err.innerText = "Error parsing JSON: " + e.message;
            err.classList.remove('hidden');
        }
    };

    window.exportVisualizerJSON = function() {
        const payload = serializeVisualizerJSON(policies, variables);
        document.getElementById('jsonPayload').value = payload;
    };

    window.addTokenFromClick = function(type, val) {
        let pIdx = activePolicyIndex;
        let rIdx = activeRuleIndex;
        if (!(policies.length > 0 && policies[pIdx] && policies[pIdx].rules[rIdx])) {
            if (policies.length > 0 && policies[0].rules.length > 0) {
                pIdx = 0;
                rIdx = 0;
                setActivePolicyIndex(0);
                setActiveRuleIndex(0);
            } else {
                showToast("Please add a Policy and a Rule first.");
                return;
            }
        }

        const targetTokens = policies[pIdx].rules[rIdx].tokens;

        if (type === 'variable' && val.includes(':')) {
            let sourceParts = val.split(/:\s*(.*)/);
            let sourceBase = sourceParts[0];
            let sourcePropsStr = sourceParts[1] || '';
            let sourceProps = sourcePropsStr.split(/,\s*/).filter(p => p.trim() !== '');

            // Find an existing token in the active rule with the same base condition
            const existingToken = targetTokens.find(t => {
                if (t.type !== 'variable') return false;
                let tParts = t.val.split(/:\s*(.*)/);
                return tParts[0] === sourceBase;
            });

            if (existingToken) {
                let targetParts = existingToken.val.split(/:\s*(.*)/);
                let targetPropsStr = targetParts[1] || '';
                let targetProps = targetPropsStr.split(/,\s*/).filter(p => p.trim() !== '');

                sourceProps.forEach(p => {
                    if (!targetProps.includes(p)) targetProps.push(p);
                });

                existingToken.val = `${sourceBase}: ${targetProps.join(', ')}`;
                saveState(`Merged property into existing "${sourceBase}" condition`);
                renderPolicies();
                generateTable();
                return;
            }
        }

        targetTokens.push({ type, val });
        saveState(`Added expression item "${val}" to Rule "${policies[pIdx].rules[rIdx].name}"`);
        renderPolicies();
        generateTable();
    };



    window.addPolicy = function() {
        policies.push({ 
            id: generateId(), 
            name: `Policy ${policies.length + 1}`, 
            enabled: true,
            rules: [{ 
                id: generateId(), 
                name: "Rule 1", 
                enabled: true, 
                tokens: [], 
                actions: { monitor: false, notify: false, override: false, block: false }, 
                stopProcessing: false,
                workloads: { email: true, endpoint: true }
            }] 
        });
        setActivePolicyIndex(policies.length - 1);
        setActiveRuleIndex(0);
        saveState(`Created Policy "${policies[activePolicyIndex].name}"`);
    };

    // Keyboard shortcuts for Undo/Redo
    document.addEventListener('keydown', function(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.hasAttribute('contenteditable')) {
            return;
        }
        
        // Ctrl + Z
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            undo();
        }
        // Ctrl + Y or Ctrl + Shift + Z
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
            e.preventDefault();
            redo();
        }
    });

    registerEventHandlers();
    registerDragDrop();
};

function addVariableFromUI() {
    const baseVal = document.getElementById('conditionSearchInput').value.trim();
    const category = document.getElementById('conditionCategory').value;
    const config = purviewConditions[category].find(c => c.base === baseVal);
    const propVal = document.getElementById('conditionProperty').value.trim();
    
    if (!config) return showToast("Please select a valid condition from the dropdown.");

    let finalVar = baseVal;
    if (config.requiresProp) {
        if (!propVal) return showToast("Property value required.");
        finalVar += `: ${propVal}`;
    }

    if (!variables.includes(finalVar)) {
        variables.push(finalVar);
        renderVariables();
        saveState(`Added Condition to Pool: "${finalVar}"`);
        document.getElementById('conditionSearchInput').value = '';
        document.getElementById('conditionProperty').value = '';
        document.getElementById('conditionProperty').style.display = 'none';
        document.getElementById('conditionSearchInput').focus();
    }
}

window.onload = window.initApp;

window.allowDrop = allowDrop;
window.drag = drag;
window.drop = drop;

window.removeProperty = function(pIndex, rIndex, tIndex, propIdx) {
    const token = window.policies[pIndex].rules[rIndex].tokens[tIndex];
    if (!token || token.type !== 'variable') return;

    let parts = token.val.split(/:\s*(.*)/);
    let base = parts[0];
    let propsStr = parts[1] || '';
    let props = propsStr.split(/,\s*/).filter(p => p.trim() !== '');

    const removedProp = props[propIdx];
    props.splice(propIdx, 1);

    if (props.length === 0) {
        token.val = base;
    } else {
        token.val = `${base}: ${props.join(', ')}`;
    }

    window.saveState(`Removed property "${removedProp}" from "${base}"`);
    window.renderPolicies();
    window.generateTable();
};

window.addProperty = function(pIndex, rIndex, tIndex) {
    const token = window.policies[pIndex].rules[rIndex].tokens[tIndex];
    if (!token || token.type !== 'variable') return;

    let parts = token.val.split(/:\s*(.*)/);
    let base = parts[0];
    let propsStr = parts[1] || '';
    let props = propsStr.split(/,\s*/).filter(p => p.trim() !== '');

    const newProp = prompt(`Add property value for condition "${base}":`);
    if (newProp && newProp.trim() !== "") {
        const cleanProp = newProp.trim();
        if (!props.includes(cleanProp)) {
            props.push(cleanProp);
            token.val = `${base}: ${props.join(', ')}`;
            window.saveState(`Added property "${cleanProp}" to "${base}"`);
            window.renderPolicies();
            window.generateTable();
        } else {
            window.showToast("This property is already present in the condition.");
        }
    }
};

window.editProperty = function(pIndex, rIndex, tIndex, propIdx) {
    const token = window.policies[pIndex].rules[rIndex].tokens[tIndex];
    if (!token || token.type !== 'variable') return;

    let parts = token.val.split(/:\s*(.*)/);
    let base = parts[0];
    let propsStr = parts[1] || '';
    let props = propsStr.split(/,\s*/).filter(p => p.trim() !== '');

    const oldProp = props[propIdx];
    const newProp = prompt(`Edit property value:`, oldProp);
    if (newProp && newProp.trim() !== "" && newProp.trim() !== oldProp) {
        const cleanProp = newProp.trim();
        props[propIdx] = cleanProp;
        token.val = `${base}: ${props.join(', ')}`;
        window.saveState(`Edited property in "${base}" from "${oldProp}" to "${cleanProp}"`);
        window.renderPolicies();
        window.generateTable();
    }
};

