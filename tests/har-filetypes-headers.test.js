// Tests for two condition values that rendered wrong on real captures:
//
//  1. Content file types arrive as bare GUIDs. Nothing NAMES them in any API response —
//     the portal hardcodes the table in a JS bundle (mip.js) as
//     {id:"<guid>",name:"Spreadsheet",format:"Excel, CSV, TSV"}. Scraped from the
//     capture, the rule reads in plain English instead of showing five GUIDs.
//  2. Header conditions carry a MAP of header name → values rather than a flat array:
//     HeaderContainsWords → {"x-cdlp-device": ["OutlookWindows", "OutlookWebApp"]}.
//     That object hit an Array-only branch and stringified to "[object Object]",
//     losing both the header name and every value.

const entry = (url, text) => ({ request: { url }, response: { content: { text } } });

// The real bundle shape, minified exactly as the portal ships it.
const MIP_BUNDLE =
    'var x=1,he=[' +
    '{id:"29b89383-a6f8-47ad-b594-3b364698b921",name:"Word processing",format:"Word, PDF",publisher:"Microsoft Corporation"},' +
    '{id:"abae71fd-17b1-4716-963f-e0cdbe8ddf9b",name:"Spreadsheet",format:"Excel, CSV, TSV",publisher:"Microsoft Corporation"},' +
    '{id:"6256dc0f-9add-4dd2-8798-5139664ed8dc",name:"Mail",format:"Outlook, OST, MSG",publisher:"Microsoft Corporation"}' +
    '];';

const bundleEntry = () => entry('https://res.cdn.microsoft.com/scc/mip.js', MIP_BUNDLE);

const fileTypeXml = guids =>
    '<rule name="R" id="r1" enabled="true" mode="Enforce" severity="Low" isAdvancedRule="True">' +
    '<version requiredMinVersion="1.0.65.0"><condition>' +
    '<is property="Item.ContentFileType" type="System.Collections.Generic.IEnumerable`1[System.Guid]">' +
    guids.map(g => `<value>${g}</value>`).join('') +
    '</is></condition></version></rule>';

// ---------------------------------------------------------------------------
describe('extractDlpPayloads – content file-type table', () => {
    test('scrapes the file-type table out of the portal JS bundle', () => {
        const { fileTypes } = window.extractDlpPayloads([bundleEntry()]);
        expect(Object.keys(fileTypes)).toHaveLength(3);
        expect(fileTypes['abae71fd-17b1-4716-963f-e0cdbe8ddf9b'])
            .toEqual({ name: 'Spreadsheet', format: 'Excel, CSV, TSV' });
    });

    test('a bundle without the table contributes nothing and does not throw', () => {
        const { fileTypes } = window.extractDlpPayloads([entry('https://x/app.js', 'var a=1;function b(){}')]);
        expect(Object.keys(fileTypes)).toHaveLength(0);
    });

    test('script bundles are never mistaken for API responses', () => {
        const payload = window.extractDlpPayloads([bundleEntry()]);
        expect(payload.rules).toEqual([]);
        expect(payload.policies).toEqual([]);
    });
});

describe('parseRuleXml – content file types', () => {
    const catalogs = () => ({ fileTypes: window.extractDlpPayloads([bundleEntry()]).fileTypes });

    test('names the GUIDs and keeps the format list', () => {
        const xml = fileTypeXml(['29b89383-a6f8-47ad-b594-3b364698b921', 'abae71fd-17b1-4716-963f-e0cdbe8ddf9b']);
        const result = window.parseRuleXml(xml, {}, [], catalogs());
        expect(result.tokens[0].val).toBe('File type is: Word processing (Word, PDF), Spreadsheet (Excel, CSV, TSV)');
    });

    test('a fully resolved file-type condition is no longer degraded', () => {
        const xml = fileTypeXml(['6256dc0f-9add-4dd2-8798-5139664ed8dc']);
        const result = window.parseRuleXml(xml, {}, [], catalogs());
        expect(result.tokens[0].degraded).toBeUndefined();
        expect(result.warnings.some(w => w.type === 'file-type')).toBe(false);
    });

    test('an unknown GUID still degrades, and names the ones it can', () => {
        const xml = fileTypeXml(['abae71fd-17b1-4716-963f-e0cdbe8ddf9b', '00000000-0000-0000-0000-000000000000']);
        const result = window.parseRuleXml(xml, {}, [], catalogs());
        expect(result.tokens[0].val).toContain('Spreadsheet (Excel, CSV, TSV)');
        expect(result.tokens[0].degraded).toBe('file-type');
        expect(result.warnings.some(w => w.type === 'file-type')).toBe(true);
    });

    test('with no table in the capture, behaviour is the previous placeholder', () => {
        const xml = fileTypeXml(['abae71fd-17b1-4716-963f-e0cdbe8ddf9b']);
        const result = window.parseRuleXml(xml, {}, []);
        expect(result.tokens[0].val).toContain('unknown file type');
        expect(result.tokens[0].degraded).toBe('file-type');
    });
});

describe('parseAdvancedRuleAST – header conditions', () => {
    const withCondition = cond => JSON.stringify([{
        PolicyName: 'P',
        Rules: [{ Name: 'R', AdvancedRule: JSON.stringify({ Version: '1.0', Condition: cond }) }]
    }]);

    const headerCondition = {
        ConditionName: 'HeaderContainsWords',
        Value: { 'x-cdlp-device': ['OutlookWindows', 'OutlookWebApp'] }
    };

    test('a header map renders header and values, never "[object Object]"', () => {
        const parsed = window.parsePurviewJSON(withCondition(headerCondition), []);
        const val = parsed.policies[0].rules[0].tokens.find(t => t.type === 'variable').val;
        expect(val).not.toContain('[object Object]');
        expect(val).toBe('Header contains words or phrases: x-cdlp-device: OutlookWindows, x-cdlp-device: OutlookWebApp');
    });

    test('each header value becomes its own pooled variable', () => {
        // parsePurviewJSON copies the incoming pool and returns it as .variables.
        const { variables } = window.parsePurviewJSON(withCondition(headerCondition), []);
        expect(variables).toContain('Header contains words or phrases: x-cdlp-device: OutlookWindows');
        expect(variables).toContain('Header contains words or phrases: x-cdlp-device: OutlookWebApp');
    });

    test('a single non-array header value still renders', () => {
        const parsed = window.parsePurviewJSON(
            withCondition({ ConditionName: 'HeaderContainsWords', Value: { 'x-test': 'OnlyOne' } }), []);
        const val = parsed.policies[0].rules[0].tokens.find(t => t.type === 'variable').val;
        expect(val).toBe('Header contains words or phrases: x-test: OnlyOne');
    });

    test('file-type GUIDs resolve through the resolver on the full-detail path', () => {
        const cond = { ConditionName: 'ContentFileTypeMatches', Value: ['abae71fd-17b1-4716-963f-e0cdbe8ddf9b'] };
        const resolvers = { fileType: g => (g === 'abae71fd-17b1-4716-963f-e0cdbe8ddf9b' ? 'Spreadsheet (Excel, CSV, TSV)' : g) };
        const parsed = window.parsePurviewJSON(withCondition(cond), [], resolvers);
        const val = parsed.policies[0].rules[0].tokens.find(t => t.type === 'variable').val;
        expect(val).toContain('Spreadsheet (Excel, CSV, TSV)');
        expect(val).not.toContain('abae71fd');
    });

    test('a resolver is not applied to conditions that are not file types', () => {
        const cond = { ConditionName: 'RecipientDomainIs', Value: ['abae71fd-17b1-4716-963f-e0cdbe8ddf9b'] };
        const resolvers = { fileType: () => 'WRONG' };
        const parsed = window.parsePurviewJSON(withCondition(cond), [], resolvers);
        const val = parsed.policies[0].rules[0].tokens.find(t => t.type === 'variable').val;
        expect(val).toContain('abae71fd-17b1-4716-963f-e0cdbe8ddf9b');
        expect(val).not.toContain('WRONG');
    });
});

describe('buildWorkspaceFromHar – file types end to end', () => {
    test('a rule imported from RuleXml shows named file types', () => {
        const payload = window.extractDlpPayloads([
            bundleEntry(),
            entry('https://x/apiproxy/di/find/DlpComplianceRule', JSON.stringify({
                DataType: 'DlpComplianceRule', ResultCode: 'Success', RecordCount: 1,
                ResultData: [{ Name: 'G028-Test-Alert', RuleXml: fileTypeXml(['29b89383-a6f8-47ad-b594-3b364698b921']) }]
            }))
        ]);
        const result = window.buildWorkspaceFromHar(payload, []);
        const rule = result.policies.flatMap(p => p.rules).find(r => r.name === 'G028-Test-Alert');
        expect(rule.tokens.find(t => t.type === 'variable').val).toBe('File type is: Word processing (Word, PDF)');
    });
});
