import js from '@eslint/js';

// Browser + app globals shared across all JS files
const browserGlobals = {
    window: 'readonly',
    document: 'readonly',
    localStorage: 'readonly',
    sessionStorage: 'readonly',
    navigator: 'readonly',
    fetch: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    clearInterval: 'readonly',
    console: 'readonly',
    alert: 'readonly',
    confirm: 'readonly',
    prompt: 'readonly',
    URL: 'readonly',
    URLSearchParams: 'readonly',
    Blob: 'readonly',
    FileReader: 'readonly',
    CSS: 'readonly',
    Event: 'readonly',
    btoa: 'readonly',
    atob: 'readonly',
    encodeURIComponent: 'readonly',
    decodeURIComponent: 'readonly',
    TextEncoder: 'readonly',
    TextDecoder: 'readonly',
    CompressionStream: 'readonly',
    DecompressionStream: 'readonly',
    Response: 'readonly',
    DOMParser: 'readonly',
    Worker: 'readonly',
    importScripts: 'readonly',
    self: 'readonly',
};

// Functions set on window.* in one script and called bare (without window. prefix) in another.
// This is the established cross-file communication pattern for this vanilla JS codebase.
const appGlobals = {
    purviewConditions: 'readonly',
    policies: 'readonly',
    variables: 'readonly',
    activePolicyIndex: 'readonly',
    activeRuleIndex: 'readonly',
    simulatorState: 'readonly',
    historyTimeline: 'readonly',
    historyPointer: 'readonly',
    // evaluator.js
    getPrecedence: 'readonly',
    infixToPostfix: 'readonly',
    evaluatePostfix: 'readonly',
    generateEvaluationTrace: 'readonly',
    generateDetailedEvaluationHtml: 'readonly',
    expandTokenSimVars: 'readonly',
    findTriggerAssignment: 'readonly',
    evaluatePolicyChain: 'readonly',
    // state.js
    generateId: 'readonly',
    saveState: 'readonly',
    loadState: 'readonly',
    shareState: 'readonly',
    _compressStateStr: 'readonly',
    _decompressStateStr: 'readonly',
    undo: 'readonly',
    redo: 'readonly',
    jumpToHistory: 'readonly',
    setPolicies: 'readonly',
    setVariables: 'readonly',
    setActivePolicyIndex: 'readonly',
    setActiveRuleIndex: 'readonly',
    escapeHtml: 'readonly',
    // ui.js
    showToast: 'readonly',
    renderPolicies: 'readonly',
    renderVariables: 'readonly',
    renderHistoryUI: 'readonly',
    generateTable: 'readonly',
    renderContextBadge: 'readonly',
    getConditionContext: 'readonly',
    populateDropdown: 'readonly',
    showDropdown: 'readonly',
    filterDropdown: 'readonly',
    togglePropertyInput: 'readonly',
    filterConditionPool: 'readonly',
    getActiveDropdownIndex: 'readonly',
    setActiveDropdownIndex: 'readonly',
    updateDropdownHighlight: 'readonly',
    chunkTokensIntoLines: 'readonly',
    // app.js
    showNaturalLanguageExplanation: 'readonly',
    addTokenFromClick: 'readonly',
    addPolicy: 'readonly',
    toggleModal: 'readonly',
    importPurviewJSON: 'readonly',
    importVisualizerJSON: 'readonly',
    exportVisualizerJSON: 'readonly',
    exportToPurviewJSON: 'readonly',
    // simulator-ui.js
    runSimulation: 'readonly',
    updateSimulatorVariables: 'readonly',
    filterSimulatorVariables: 'readonly',
    resetSimulatorInputs: 'readonly',
    updateScrollHint: 'readonly',
    simSortAlpha: 'writable',
    ResizeObserver: 'readonly',
    // regex-builder.js
    callAIChat: 'readonly',
    extractRegexFromReply: 'readonly',
    startRegexChat: 'readonly',
    sendRegexRefinement: 'readonly',
    clearRegexChat: 'readonly',
    // parser.js
    parsePurviewJSON: 'readonly',
    parseVisualizerJSON: 'readonly',
    serializeVisualizerJSON: 'readonly',
    serializePurviewJSON: 'readonly',
    // har-parser.js
    buildWorkspaceFromHar: 'readonly',
    parseRuleXml: 'readonly',
    harConditionToken: 'readonly',
    matchRuleToPolicy: 'readonly',
    // har-import.js
    startHarImport: 'readonly',
    // policy-csv.js
    parsePolicyCsv: 'readonly',
    applyPolicyCsv: 'readonly',
    loadPolicyCsvFile: 'readonly',
    // logger.js
    logEvent: 'readonly',
    dlpLogs: 'readonly',
    downloadLogs: 'readonly',
    // observer pattern
    subscribe: 'readonly',
    notifyObservers: 'readonly',
    // conflict-detector.js
    detectRuleIssues: 'readonly',
    detectPolicyConflicts: 'readonly',
    // version.js
    APP_VERSION: 'readonly',
};

export default [
    {
        ...js.configs.recommended,
        files: ['js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: { ...browserGlobals, ...appGlobals }
        },
        rules: {
            'no-unused-vars': ['warn', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
            'no-undef': 'warn',
            'eqeqeq': ['warn', 'always', { null: 'ignore' }],
            'no-console': 'off',
            'no-prototype-builtins': 'off',
            'no-var': 'warn',
        }
    }
];
