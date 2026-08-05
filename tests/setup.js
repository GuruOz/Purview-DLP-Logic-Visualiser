import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { beforeEach } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

/**
 * Load a browser script into the jsdom global environment.
 * Wraps the script in a function that receives browser globals as named parameters,
 * so window.* assignments in the script target globalThis (jsdom's window).
 */
function loadScript(file) {
    const code = readFileSync(join(root, file), 'utf-8');
    // Pass jsdom's globals explicitly so scripts that reference them as free variables work.
    // window.* assignments inside the script target globalThis which is jsdom's window.
    Function(
        'window', 'document', 'localStorage', 'sessionStorage',
        'console', 'setTimeout', 'clearTimeout', 'URL', 'URLSearchParams',
        'btoa', 'atob', 'encodeURIComponent', 'decodeURIComponent', 'DOMParser',
        code
    )(
        globalThis,
        globalThis.document,
        globalThis.localStorage,
        globalThis.sessionStorage,
        globalThis.console,
        globalThis.setTimeout,
        globalThis.clearTimeout,
        globalThis.URL,
        globalThis.URLSearchParams,
        globalThis.btoa,
        globalThis.atob,
        globalThis.encodeURIComponent,
        globalThis.decodeURIComponent,
        globalThis.DOMParser
    );
}

// Load in dependency order
loadScript('js/logger.js');
loadScript('js/constants.js');
loadScript('js/state.js');
loadScript('js/evaluator.js');
loadScript('js/parser.js');
loadScript('js/har-extract.js');
loadScript('js/har-parser.js');
loadScript('js/policy-csv.js');
loadScript('js/conflict-detector.js');
loadScript('js/nl-generator.js');
loadScript('js/summary-ui.js');
loadScript('js/simulator-ui.js');

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.policies = [];
    window.variables = [];
    window.historyTimeline = [];
    window.historyPointer = -1;
    window.activePolicyIndex = 0;
    window.activeRuleIndex = 0;
    window.simulatorState = {};
    window.dlpLogs = [];
    window.lastLocalStorageAction = '';
    window.nlSettings = {
        mode: 'static',
        enableAITrace: false,
        aiProvider: 'openai',
        aiApiKey: ''
    };
});

