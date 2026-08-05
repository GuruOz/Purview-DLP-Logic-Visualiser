// Tests for js/policy-csv.js
// Covers: parsePolicyCsv (BOM/header/quotes/mode mapping) and applyPolicyCsv
// (priority ordering, enabled state, name matching, unmatched reporting).

const mkPolicy = (name, extra = {}) => ({ id: name, name, enabled: true, rules: [], ...extra });

const CSV_WITH_BOM = '\uFEFFName,Priority,Mode,Policy sync status,Last modified\n' +
    'G001-Email To External-Block,17,On,[object Object],2026-07-23T08:14:23.000Z\n' +
    'G004-Email to External-Affirm,19,On,[object Object],2026-06-17T10:09:02.000Z\n' +
    'Singapore DLP Policy - External,2,Off,[object Object],2022-08-03T06:21:01.000Z\n' +
    'TECH-GPE_EPS-M365CopilotRestrictCCE_DLP,11,In simulation without notifications,[object Object],2026-05-26T10:56:06.000Z\n' +
    '"G002-Email To External-Not Classified-Affirm (To be deleted)",3,On,[object Object],2026-07-30T08:31:24.000Z';

// ---------------------------------------------------------------------------
describe('parsePolicyCsv', () => {
    test('parses BOM-prefixed export with header, priorities and modes', () => {
        const rows = window.parsePolicyCsv(CSV_WITH_BOM);
        expect(rows).toHaveLength(5);
        expect(rows[0]).toEqual({ name: 'G001-Email To External-Block', priority: 17, enabled: true, mode: 'On' });
        expect(rows[1].priority).toBe(19);
        expect(rows[2]).toMatchObject({ name: 'Singapore DLP Policy - External', priority: 2, enabled: false });
        // "In simulation without notifications" is not Off — treated as enabled.
        expect(rows[3]).toMatchObject({ name: 'TECH-GPE_EPS-M365CopilotRestrictCCE_DLP', priority: 11, enabled: true });
        // Quoted field with comma survives.
        expect(rows[4].name).toBe('G002-Email To External-Not Classified-Affirm (To be deleted)');
        expect(rows[4].priority).toBe(3);
    });

    test('skips the header and malformed rows without priority', () => {
        const rows = window.parsePolicyCsv('Name,Priority,Mode\nnot-a-priority,Off\n\nG001-X,5,On\n');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual({ name: 'G001-X', priority: 5, enabled: true, mode: 'On' });
    });

    test('maps Disable/Off to disabled and Enable/On to enabled', () => {
        const rows = window.parsePolicyCsv('Name,Priority,Mode\nA,1,Disable\nB,2,Enable\nC,3,Off\nD,4,On\n');
        expect(rows.map(r => r.enabled)).toEqual([false, true, false, true]);
    });

    test('returns [] for non-string input', () => {
        expect(window.parsePolicyCsv(null)).toEqual([]);
        expect(window.parsePolicyCsv('')).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
describe('applyPolicyCsv', () => {
    const workspace = [
        mkPolicy('G004-Email to External-Affirm', { enabled: true }),
        mkPolicy('G001-Email To External-Block', { enabled: true }),
        mkPolicy('Singapore DLP Policy - External', { enabled: true }),
        mkPolicy('Extra Policy Not In CSV', { enabled: true })
    ];

    test('reorders policies to CSV priority and applies enabled state', () => {
        const rows = window.parsePolicyCsv(CSV_WITH_BOM);
        const result = window.applyPolicyCsv(workspace, rows);

        // CSV-only policies are reported, not added — only matched policies reorder.
        expect(result.policies.map(p => p.name)).toEqual([
            'Singapore DLP Policy - External', // priority 2
            'G001-Email To External-Block', // priority 17
            'G004-Email to External-Affirm', // priority 19
            'Extra Policy Not In CSV' // not in CSV → keeps position at the end
        ]);
        expect(result.matchedCount).toBe(3);
        expect(result.unmatchedNames).toEqual([
            'TECH-GPE_EPS-M365CopilotRestrictCCE_DLP',
            'G002-Email To External-Not Classified-Affirm (To be deleted)'
        ]);
        expect(result.policies.find(p => p.name === 'Singapore DLP Policy - External')).toMatchObject({ priority: 2, enabled: false });
        expect(result.policies.find(p => p.name === 'G001-Email To External-Block')).toMatchObject({ priority: 17, enabled: true });
        expect(result.policies.find(p => p.name === 'G004-Email to External-Affirm')).toMatchObject({ priority: 19, enabled: true });
        expect(result.policies.find(p => p.name === 'Extra Policy Not In CSV').priority).toBeUndefined();
    });

    test('reports CSV policies that match no workspace policy', () => {
        const rows = window.parsePolicyCsv('Name,Priority,Mode\nNoSuch Policy,1,On\nG001-Email To External-Block,2,Off\n');
        const result = window.applyPolicyCsv(workspace, rows);
        expect(result.matchedCount).toBe(1);
        expect(result.unmatchedNames).toEqual(['NoSuch Policy']);
        expect(result.policies[0].name).toBe('G001-Email To External-Block');
        expect(result.policies[0].enabled).toBe(false);
    });

    test('does not mutate the input policy array', () => {
        const rows = window.parsePolicyCsv(CSV_WITH_BOM);
        const before = JSON.stringify(workspace);
        window.applyPolicyCsv(workspace, rows);
        expect(JSON.stringify(workspace)).toBe(before);
    });

    test('tolerates empty inputs', () => {
        expect(window.applyPolicyCsv([], [])).toEqual({ policies: [], matchedCount: 0, unmatchedNames: [] });
        expect(window.applyPolicyCsv(workspace, []).policies).toEqual(workspace);
    });
});
