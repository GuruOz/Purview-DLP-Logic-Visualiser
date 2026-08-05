// Tests for sensitivity-label resolution during HAR import.
//
// RuleXml and AdvancedRule both identify a label by Purview's INTERNAL name — e.g.
// "Non Sensitive_2", where the numeric suffix is Purview's own disambiguation — while
// the portal shows "SECRET/NON-SENSITIVE". Only the capture's Label catalog
// (/di/find/Label) carries the display name and parent, and the display name alone is
// NOT enough: one real tenant has 8 distinct labels all displaying "NON-SENSITIVE"
// under different parents, so dropping the parent makes the condition ambiguous.

const LABEL_CATALOG = [
    { Guid: 'aaaa1111-0000-0000-0000-000000000000', Name: 'SECRET', DisplayName: 'SECRET', ParentLabelDisplayName: null, IsParent: true },
    { Guid: 'bbbb2222-0000-0000-0000-000000000000', Name: 'RESTRICTED', DisplayName: 'RESTRICTED', ParentLabelDisplayName: null, IsParent: true },
    // Same DisplayName, different parents — the ambiguity the parent prefix resolves.
    { Guid: '08e8b179-0000-0000-0000-000000000000', Name: 'Non Sensitive_2', DisplayName: 'NON-SENSITIVE', ParentLabelDisplayName: 'SECRET' },
    { Guid: '11111111-0000-0000-0000-000000000000', Name: 'Non Sensitive_0', DisplayName: 'NON-SENSITIVE', ParentLabelDisplayName: 'RESTRICTED' },
    { Guid: 'af765512-0000-0000-0000-000000000000', Name: 'Sensitive Normal_2', DisplayName: 'SENSITIVE NORMAL', ParentLabelDisplayName: 'SECRET' }
];

const labelGroup = (tagName, tagId) =>
    '<keyValues>' +
    `<keyValue key="tagName" value="${tagName}"/>` +
    `<keyValue key="tagId" value="${tagId}"/>` +
    '<keyValue key="tagType" value="Sensitivity"/>' +
    '<keyValue key="groupName" value="SECRET AIP"/>' +
    '</keyValues>';

const ruleXmlWithLabels = groups =>
    '<rule name="R" id="r1" enabled="true" mode="Enforce" severity="Low" isAdvancedRule="True">' +
    '<version requiredMinVersion="1.0.65.0"><condition>' +
    '<containsdataclassification>' +
    '<keyValues><keyValue key="operator" value="Or"/></keyValues>' + groups.join('') +
    '</containsdataclassification>' +
    '</condition></version></rule>';

// A Label-catalog HAR entry, served from /di/find/Label (NOT /di/find/Dlp).
const entry = (url, body) => ({
    request: { url },
    response: { content: { text: JSON.stringify(body) } }
});

const labelCatalogEntry = () => entry('https://x/apiproxy/di/find/Label', {
    DataType: 'Label', ResultCode: 'Success', RecordCount: LABEL_CATALOG.length, ResultData: LABEL_CATALOG
});

const ruleEntry = rules => entry('https://x/apiproxy/di/find/DlpComplianceRule', {
    DataType: 'DlpComplianceRule', ResultCode: 'Success', RecordCount: rules.length, ResultData: rules
});

// ---------------------------------------------------------------------------
describe('extractDlpPayloads – label catalog', () => {
    test('picks up the Label catalog, which is served from /di/find/Label', () => {
        const payload = window.extractDlpPayloads([labelCatalogEntry()]);
        expect(payload.labels).toHaveLength(LABEL_CATALOG.length);
        expect(payload.labels[0].Name).toBe('SECRET');
    });

    test('captures with no Label catalog still yield an empty array, not undefined', () => {
        expect(window.extractDlpPayloads([ruleEntry([])]).labels).toEqual([]);
    });
});

describe('parseRuleXml – sensitivity label display names', () => {
    const labelMapFrom = rows => {
        const map = Object.create(null);
        rows.forEach(l => {
            map[String(l.Guid).toLowerCase()] = l;
            map[String(l.Name).toLowerCase()] = l;
        });
        return map;
    };

    test('renders Parent/Child as the portal shows it, not the internal name', () => {
        const xml = ruleXmlWithLabels([
            labelGroup('Non Sensitive_2', '08e8b179-0000-0000-0000-000000000000'),
            labelGroup('Sensitive Normal_2', 'af765512-0000-0000-0000-000000000000')
        ]);
        const result = window.parseRuleXml(xml, {}, [], { labels: labelMapFrom(LABEL_CATALOG) });
        expect(result.tokens[0].val).toBe('Content contains: SECRET/NON-SENSITIVE, SECRET/SENSITIVE NORMAL');
    });

    test('two labels sharing a DisplayName stay distinguishable by parent', () => {
        const xml = ruleXmlWithLabels([
            labelGroup('Non Sensitive_2', '08e8b179-0000-0000-0000-000000000000'),
            labelGroup('Non Sensitive_0', '11111111-0000-0000-0000-000000000000')
        ]);
        const result = window.parseRuleXml(xml, {}, [], { labels: labelMapFrom(LABEL_CATALOG) });
        expect(result.tokens[0].val).toBe('Content contains: SECRET/NON-SENSITIVE, RESTRICTED/NON-SENSITIVE');
    });

    test('resolves by tagId even when tagName is stale', () => {
        const xml = ruleXmlWithLabels([labelGroup('Some Old Name', '08e8b179-0000-0000-0000-000000000000')]);
        const result = window.parseRuleXml(xml, {}, [], { labels: labelMapFrom(LABEL_CATALOG) });
        expect(result.tokens[0].val).toBe('Content contains: SECRET/NON-SENSITIVE');
    });

    test('a top-level label with no parent renders without a slash', () => {
        const xml = ruleXmlWithLabels([labelGroup('SECRET', 'aaaa1111-0000-0000-0000-000000000000')]);
        const result = window.parseRuleXml(xml, {}, [], { labels: labelMapFrom(LABEL_CATALOG) });
        expect(result.tokens[0].val).toBe('Content contains: SECRET');
    });

    test('falls back to the internal name and warns when the label is not in the catalog', () => {
        const xml = ruleXmlWithLabels([labelGroup('Ghost Label_9', '99999999-0000-0000-0000-000000000000')]);
        const result = window.parseRuleXml(xml, {}, [], { labels: labelMapFrom(LABEL_CATALOG) });
        expect(result.tokens[0].val).toBe('Content contains: Ghost Label_9');
        expect(result.warnings.some(w => w.type === 'unresolved-label')).toBe(true);
    });

    test('a capture with no catalog at all keeps the previous behaviour', () => {
        const xml = ruleXmlWithLabels([labelGroup('Non Sensitive_2', '08e8b179-0000-0000-0000-000000000000')]);
        const result = window.parseRuleXml(xml, {}, []); // no catalogs
        expect(result.tokens[0].val).toBe('Content contains: Non Sensitive_2');
        expect(result.warnings.some(w => w.type === 'unresolved-label')).toBe(false);
    });
});

describe('parseAdvancedRuleAST – label resolver (full-detail path)', () => {
    const advancedRule = JSON.stringify({
        Version: '1.0',
        Condition: {
            Operator: 'And',
            SubConditions: [{
                ConditionName: 'ContentContainsSensitiveInformation',
                Value: [{ Groups: [{ Name: 'SECRET AIP', Operator: 'Or', Labels: [
                    { Name: 'Non Sensitive_2', Id: '08e8b179-0000-0000-0000-000000000000', Type: 'Sensitivity' }
                ] }] }]
            }]
        }
    });

    const psJson = () => JSON.stringify([{ PolicyName: 'P', Rules: [{ Name: 'R', AdvancedRule: advancedRule }] }]);

    test('PowerShell JSON import without a resolver is unchanged', () => {
        const parsed = window.parsePurviewJSON(psJson(), []);
        const val = parsed.policies[0].rules[0].tokens.find(t => t.type === 'variable').val;
        expect(val).toContain('Non Sensitive_2');
    });

    test('HAR import passes a resolver and gets the portal display name', () => {
        const resolver = l => (l.Id === '08e8b179-0000-0000-0000-000000000000' ? 'SECRET/NON-SENSITIVE' : l.Name);
        const parsed = window.parsePurviewJSON(psJson(), [], { label: resolver });
        const val = parsed.policies[0].rules[0].tokens.find(t => t.type === 'variable').val;
        expect(val).toContain('SECRET/NON-SENSITIVE');
        expect(val).not.toContain('Non Sensitive_2');
    });
});

describe('buildWorkspaceFromHar – labels end to end', () => {
    test('a rule imported from RuleXml shows resolved label names', () => {
        const xml = ruleXmlWithLabels([
            labelGroup('Non Sensitive_2', '08e8b179-0000-0000-0000-000000000000'),
            labelGroup('Non Sensitive_0', '11111111-0000-0000-0000-000000000000')
        ]);
        const payload = window.extractDlpPayloads([
            labelCatalogEntry(),
            ruleEntry([{ Name: 'G001-Test-Block', RuleXml: xml }])
        ]);
        const result = window.buildWorkspaceFromHar(payload, []);
        const rule = result.policies.flatMap(p => p.rules).find(r => r.name === 'G001-Test-Block');
        const val = rule.tokens.find(t => t.type === 'variable').val;
        expect(val).toBe('Content contains: SECRET/NON-SENSITIVE, RESTRICTED/NON-SENSITIVE');
    });
});
