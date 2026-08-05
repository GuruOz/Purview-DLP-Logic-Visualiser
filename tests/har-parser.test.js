// Tests for js/har-parser.js
// Covers: parseRuleXml (RuleXml → tokens), harConditionToken (predicate mapping),
// matchRuleToPolicy (G-code-anchored fuzzy matching), buildWorkspaceFromHar (end-to-end).

const mkVar = (val, opts = {}) => ({ type: 'variable', val, ...opts });
const mkOp = (val) => ({ type: 'operator', val });

const SIT_MAP = {
    '11111111-2222-3333-4444-555555555555': 'Credit Card Number',
    'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee': 'WOG-Credit Card'
};

// Wrap a condition body in the real portal RuleXml shape:
// <rule><version><condition>…</condition><action …/></version></rule>
function ruleXml(conditionBody, actions = '') {
    return `<rule name="Test Rule" id="r1" enabled="true" mode="Enforce" severity="Low" isAdvancedRule="True">` +
        `<version requiredMinVersion="1.0.65.0"><condition>${conditionBody}</condition>${actions}</version></rule>`;
}

// ---------------------------------------------------------------------------
describe('parseRuleXml – condition mapping', () => {
    test('single `is` predicate becomes one variable token', () => {
        const xml = ruleXml(
            '<is property="Item.SharedWithDomains" type="System.Collections.Generic.List`1[Microsoft.Office.CompliancePolicy.Domain]" Workload="Exchange">' +
            '<value>gmail.com</value><value>onmicrosoft.com</value></is>'
        );
        const result = window.parseRuleXml(xml, SIT_MAP);
        expect(result.tokens).toEqual([
            mkVar('Recipient domain is: gmail.com, onmicrosoft.com', { targetContext: 'Both' })
        ]);
        expect(result.warnings).toEqual([]);
    });

    test('nested <and><and>… collapses to no redundant parens', () => {
        const xml = ruleXml(
            '<and><and><is property="Item.ContentIsNotLabeled" /></and></and>'
        );
        const result = window.parseRuleXml(xml, SIT_MAP);
        expect(result.tokens).toEqual([
            mkVar('Content is not labeled', { targetContext: 'Both' })
        ]);
    });

    test('<and> with multiple children is parenthesised', () => {
        const xml = ruleXml(
            '<and>' +
            '<is property="Item.SharedWithDomains"><value>gmail.com</value></is>' +
            '<is property="Item.SharedWithDomains"><value>onmicrosoft.com</value></is>' +
            '</and>'
        );
        const result = window.parseRuleXml(xml, SIT_MAP);
        expect(result.tokens).toEqual([
            mkOp('('),
            mkVar('Recipient domain is: gmail.com', { targetContext: 'Both' }),
            mkOp('AND'),
            mkVar('Recipient domain is: onmicrosoft.com', { targetContext: 'Both' }),
            mkOp(')')
        ]);
    });

    test('<not> as first sibling renders NOT, as non-first sibling folds to AND NOT', () => {
        const xml = ruleXml(
            '<and>' +
            '<not><is property="Item.ContentIsNotLabeled" /></not>' +
            '<is property="Item.SharedWithDomains"><value>gmail.com</value></is>' +
            '</and>'
        );
        const result = window.parseRuleXml(xml, SIT_MAP);
        expect(result.tokens).toEqual([
            mkOp('('),
            mkOp('NOT'),
            mkOp('('),
            mkVar('Content is not labeled', { targetContext: 'Both' }),
            mkOp(')'),
            mkOp('AND'),
            mkVar('Recipient domain is: gmail.com', { targetContext: 'Both' }),
            mkOp(')')
        ]);
    });

    test('<or> inside <and> is parenthesised correctly', () => {
        const xml = ruleXml(
            '<and>' +
            '<or>' +
            '<is property="Item.ContentIsNotLabeled" />' +
            '<is property="Item.ContentIsPasswordProtected" />' +
            '</or>' +
            '<is property="Item.SharedWithDomains"><value>gmail.com</value></is>' +
            '</and>'
        );
        const result = window.parseRuleXml(xml, SIT_MAP);
        expect(result.tokens).toEqual([
            mkOp('('),
            mkOp('('),
            mkVar('Content is not labeled', { targetContext: 'Both' }),
            mkOp('OR'),
            mkVar('Attachment is password protected', { targetContext: 'Both' }),
            mkOp(')'),
            mkOp('AND'),
            mkVar('Recipient domain is: gmail.com', { targetContext: 'Both' }),
            mkOp(')')
        ]);
    });

    test('unknown element produces a fallback token and a warning, never a silent drop', () => {
        const xml = ruleXml('<someFutureElement property="Item.FancyThing" />');
        const result = window.parseRuleXml(xml, SIT_MAP);
        expect(result.tokens.length).toBe(1);
        expect(result.tokens[0].val).toContain('Fancy Thing');
        expect(result.warnings.some(w => w.type === 'unknown-condition')).toBe(true);
    });

    test('malformed XML throws a descriptive Error and returns no partial tokens', () => {
        const bad = '<rule><version><condition><is property="Item.SharedWithDomains"></condition></version></rule>';
        expect(() => window.parseRuleXml(bad, SIT_MAP)).toThrow(/Could not parse rule XML/);
    });
});

// ---------------------------------------------------------------------------
describe('parseRuleXml – containsDataClassification', () => {
    test('label form: header keyValues groups are skipped, tagNames comma-joined', () => {
        const xml = ruleXml(
            '<containsDataClassification property="Item.ClassificationDiscovered" type="System.Collections.Generic.IDictionary`2[System.Guid,Microsoft.Office.CompliancePolicy.ComplianceData.ClassificationResult]">' +
            '<keyValues><keyValue key="operator" value="And" /></keyValues>' +
            '<keyValues><keyValue key="operator" value="Or" /><keyValue key="name" value="Default" /></keyValues>' +
            '<keyValues><keyValue key="tagName" value="SENSITIVE NORMAL" /><keyValue key="tagType" value="Sensitivity" /><keyValue key="tagId" value="6dff8ff2-e5ae-460d-8b55-d3adab07d4fe" /><keyValue key="groupName" value="Default" /></keyValues>' +
            '<keyValues><keyValue key="tagName" value="SENSITIVE HIGH" /><keyValue key="tagType" value="Sensitivity" /><keyValue key="tagId" value="5260e8dd-2186-4703-bd49-9c737abb9b44" /></keyValues>' +
            '</containsDataClassification>'
        );
        const result = window.parseRuleXml(xml, SIT_MAP);
        expect(result.tokens).toEqual([
            mkVar('Content contains: SENSITIVE NORMAL, SENSITIVE HIGH', { targetContext: 'Both' })
        ]);
        expect(result.warnings).toEqual([]);
    });

    test('SIT form: GUIDs resolve through the sitMap', () => {
        const xml = ruleXml(
            '<containsDataClassification property="Item.ClassificationDiscovered" type="System.Collections.Generic.IDictionary`2[System.Guid,Microsoft.Office.CompliancePolicy.ComplianceData.ClassificationResult]">' +
            '<keyValues><keyValue key="id" value="11111111-2222-3333-4444-555555555555" /><keyValue key="minCount" value="1" /><keyValue key="maxCount" value="5" /><keyValue key="minConfidence" value="75" /></keyValues>' +
            '<keyValues><keyValue key="id" value="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" /><keyValue key="minCount" value="1" /><keyValue key="maxCount" value="10" /><keyValue key="minConfidence" value="65" /></keyValues>' +
            '</containsDataClassification>'
        );
        const result = window.parseRuleXml(xml, SIT_MAP);
        expect(result.tokens).toEqual([
            mkVar('Content contains: Credit Card Number, WOG-Credit Card', { targetContext: 'Both' })
        ]);
        expect(result.warnings).toEqual([]);
    });

    test('unresolved SIT GUID renders a placeholder and a warning', () => {
        const xml = ruleXml(
            '<containsDataClassification property="Item.ClassificationDiscovered" type="System.Collections.Generic.IDictionary`2[System.Guid,Microsoft.Office.CompliancePolicy.ComplianceData.ClassificationResult]">' +
            '<keyValues><keyValue key="id" value="deadbeef-0000-0000-0000-000000000000" /><keyValue key="minCount" value="1" /></keyValues>' +
            '</containsDataClassification>'
        );
        const result = window.parseRuleXml(xml, SIT_MAP);
        expect(result.tokens[0].val).toBe('Content contains: Unresolved SIT (deadbeef)');
        expect(result.warnings.some(w => w.type === 'unresolved-sit')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
describe('parseRuleXml – targetContext and actions', () => {
    test('ExtendedItem.ExMessage.Document maps to Attachment context', () => {
        const xml = ruleXml('<is property="ExtendedItem.ExMessage.Document.IsNotLabeled" />');
        const result = window.parseRuleXml(xml, SIT_MAP);
        expect(result.tokens[0]).toMatchObject({ val: 'Content is not labeled', targetContext: 'Attachment' });
    });

    test('textScan SubjectOrBody maps to Message context', () => {
        const xml = ruleXml('<textScan target="ExtendedItem.ExMessage.SubjectOrBody" type="System.String" processorId="5eb48ea2-a619-4e2a-82a7-b49e9b5297f7" suppl="keywordMatch"></textScan>');
        const result = window.parseRuleXml(xml, SIT_MAP);
        expect(result.tokens[0]).toMatchObject({ targetContext: 'Message' });
        expect(result.tokens[0].val).toContain('(keyword list not in capture)');
    });

    test('all six action names map to the four booleans; Halt sets stopProcessing', () => {
        const xml = ruleXml(
            '<is property="Item.SharedWithDomains"><value>gmail.com</value></is>',
            '<action name="GenerateAlert" /><action name="NotifyUser" /><action name="NotifyEndpointUser" />' +
            '<action name="BlockAccess" /><action name="EndpointRestrictAccess" /><action name="Halt" />'
        );
        const result = window.parseRuleXml(xml, SIT_MAP);
        expect(result.actions).toEqual({ monitor: true, notify: true, override: true, block: true });
        expect(result.stopProcessing).toBe(true);
    });

    test('rule enabled attribute is honoured', () => {
        const xml = ruleXml('<is property="Item.ContentIsNotLabeled" />')
            .replace('enabled="true"', 'enabled="false"');
        const result = window.parseRuleXml(xml, SIT_MAP);
        expect(result.enabled).toBe(false);
    });
});

// ---------------------------------------------------------------------------
describe('parseRuleXml – placeholders never silently drop', () => {
    test('textScan produces a keyword-list marker and warning', () => {
        const xml = ruleXml('<textScan target="Item.DisplayName" processorId="63f7bc22-87b5-4bce-bc1f-7a6f838c35cb" suppl="keywordMatch" evalExtendedStream="False"></textScan>');
        const result = window.parseRuleXml(xml, SIT_MAP);
        expect(result.tokens[0].val).toBe('Document name contains words: (keyword list not in capture)');
        expect(result.tokens[0].degraded).toBe('keyword-list');
        expect(result.warnings.some(w => w.type === 'keyword-list')).toBe(true);
    });

    test('Header textScan maps to header vocabulary', () => {
        const xml = ruleXml('<textScan target="ExtendedItem.ExMessage.Header:x-cdlp-device" type="System.String" processorId="2abc6d3d-778f-4c7d-bd31-b2ce019512d2" suppl="keywordMatch"></textScan>');
        const result = window.parseRuleXml(xml, SIT_MAP);
        expect(result.tokens[0].val).toBe('Header contains words or phrases: (keyword list not in capture)');
    });

    test('ContentFileType GUIDs render as placeholders with a warning', () => {
        const xml = ruleXml(
            '<is property="Item.ContentFileType" type="System.Collections.Generic.IEnumerable`1[System.Guid]">' +
            '<value>29b89383-a6f8-47ad-b594-3b364698b921</value>' +
            '<value>abae71fd-17b1-4716-963f-e0cdbe8ddf9b</value></is>'
        );
        const result = window.parseRuleXml(xml, SIT_MAP);
        expect(result.tokens[0].val).toBe(
            'File type is: (unknown file type 29b89383), (unknown file type abae71fd)'
        );
        expect(result.tokens[0].degraded).toBe('file-type');
        expect(result.warnings.some(w => w.type === 'file-type')).toBe(true);
    });

    test('numericMatch uses lhsValue against RecipientCount', () => {
        const xml = ruleXml('<numericMatch lhsValue="2" rhsTarget="ExtendedItem.ExMessage.RecipientCount" operation="lessThan" />');
        const result = window.parseRuleXml(xml, SIT_MAP);
        expect(result.tokens[0].val).toBe('Unique recipient count over: 2');
        expect(result.warnings).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
describe('matchRuleToPolicy – G-code anchored fuzzy matching', () => {
    test('exact name match wins with score 1.0', () => {
        const match = window.matchRuleToPolicy('G006-Email To External-Monitor', ['G006-Email To External-Monitor - AIP', 'G006-Email To External-Monitor']);
        expect(match.name).toBe('G006-Email To External-Monitor');
        expect(match.score).toBe(1.0);
    });

    test('the - AIP variant is NOT collapsed with its base policy', () => {
        const match = window.matchRuleToPolicy('G006-Email To External-Monitor - AIP', ['G006-Email To External-Monitor - AIP', 'G006-Email To External-Monitor']);
        expect(match.name).toBe('G006-Email To External-Monitor - AIP');
    });

    test('G075 against a list containing only G076 returns null (no code anchor)', () => {
        expect(window.matchRuleToPolicy('G075-Email iOS/macOS-Exclusion', ['G076-Email from iOS/macOS-Exclusion'])).toBeNull();
    });

    test('no-code name falls back to global similarity', () => {
        const match = window.matchRuleToPolicy('teams hover test', ['Teams file hover test', 'G001-Email To External-Block']);
        expect(match.name).toBe('Teams file hover test');
    });

    test('agency-style codes (HTA001) anchor like G-codes', () => {
        const match = window.matchRuleToPolicy('HTA001-Email To External-Block', ['HTA001-Email to External-Block']);
        expect(match.name).toBe('HTA001-Email to External-Block');
    });

    test('same-code variants match at the lower anchored bar', () => {
        const match = window.matchRuleToPolicy('G009-Web Uploads-Block -- Secret to SGDCS & GCC intranet', ['G009-Web Uploads-Block']);
        expect(match.name).toBe('G009-Web Uploads-Block');
    });

    test('prefix-related codes (MHA001A vs MHA001) are allowed to match', () => {
        const match = window.matchRuleToPolicy('MHA001A-Email To External-Block', ['MHA001-Email To External-Block']);
        expect(match.name).toBe('MHA001-Email To External-Block');
    });

    test('non-prefix code families (MAS002 vs MAS001) are blocked, not misfiled', () => {
        expect(window.matchRuleToPolicy('MAS002-Email Protection-BLOCK', ['MAS001-Email Protection-BLOCK'])).toBeNull();
    });

    test('low-similarity no-code name is rejected', () => {
        expect(window.matchRuleToPolicy('073 catch all for troubleshooting', ['G001-Email To External-Block', 'G002-Email To External-Not Classified-Affirm'])).toBeNull();
    });
});

// ---------------------------------------------------------------------------
describe('buildWorkspaceFromHar – end-to-end', () => {
    const policies = [
        { Name: 'G006-Email To External-Monitor', Mode: 'Enable', Workload: 'Exchange', EndpointDlpLocation: [] },
        { Name: 'G001-Email To External-Block', Mode: 'Disable', Workload: 'Exchange, SharePoint', EndpointDlpLocation: [{ DisplayName: 'All' }] }
    ];

    const sits = [
        { Id: '11111111-2222-3333-4444-555555555555', Name: 'Credit Card Number' },
        { Id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', Name: 'WOG-Credit Card' }
    ];

    const rules = [
        {
            Name: 'G006-Email To External-Monitor',
            RuleXml: ruleXml(
                '<containsDataClassification property="Item.ClassificationDiscovered" type="System.Collections.Generic.IDictionary`2[System.Guid,Microsoft.Office.CompliancePolicy.ComplianceData.ClassificationResult]">' +
                '<keyValues><keyValue key="id" value="11111111-2222-3333-4444-555555555555" /><keyValue key="minCount" value="1" /></keyValues>' +
                '<keyValues><keyValue key="id" value="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" /><keyValue key="minCount" value="1" /></keyValues>' +
                '</containsDataClassification>',
                '<action name="GenerateAlert" />'
            )
        },
        {
            Name: 'G001-Email To External-Block',
            RuleXml: ruleXml(
                '<is property="Item.SharedWithDomains" Workload="Exchange"><value>gmail.com</value></is>',
                '<action name="BlockAccess" /><action name="NotifyUser" />'
            )
        },
        {
            Name: 'G075-Email iOS/macOS-Exclusion',
            RuleXml: ruleXml(
                '<is property="Item.ContentExtensions"><value>zip</value><value>7z</value></is>',
                '<action name="BlockAccess" />'
            )
        }
    ];

    test('groups rules into policies, buckets unmatched, inherits workloads and enabled', () => {
        const result = window.buildWorkspaceFromHar({ rules, policies, sits }, []);

        expect(result.policies).toHaveLength(3); // 2 matched + unmatched bucket
        const byName = Object.fromEntries(result.policies.map(p => [p.name, p]));

        const g006 = byName['G006-Email To External-Monitor'];
        expect(g006).toBeDefined();
        expect(g006.enabled).toBe(true); // Mode 'Enable'
        expect(g006.rules).toHaveLength(1);
        expect(g006.rules[0].tokens).toEqual([
            mkVar('Content contains: Credit Card Number, WOG-Credit Card', { targetContext: 'Both' })
        ]);
        expect(g006.rules[0].actions.monitor).toBe(true);
        // Workload 'Exchange' → email only
        expect(g006.rules[0].workloads).toEqual({ email: true, endpoint: false });

        const g001 = byName['G001-Email To External-Block'];
        expect(g001.enabled).toBe(false); // Mode 'Disable'
        // EndpointDlpLocation non-empty → endpoint inherited
        expect(g001.rules[0].workloads).toEqual({ email: true, endpoint: true });
        expect(g001.rules[0].actions.block).toBe(true);

        const unmatched = byName['Unmatched Rules (from HAR)'];
        expect(unmatched.rules).toHaveLength(1);
        expect(unmatched.rules[0].name).toBe('G075-Email iOS/macOS-Exclusion');
        expect(unmatched.rules[0].workloads).toEqual({ email: true, endpoint: true });
    });

    test('populates the variables pool with individual conditions, deduplicated', () => {
        const result = window.buildWorkspaceFromHar({ rules, policies, sits }, []);
        expect(result.variables).toContain('Content contains: Credit Card Number');
        expect(result.variables).toContain('Content contains: WOG-Credit Card');
        expect(result.variables).toContain('Recipient domain is: gmail.com');
        // Deduplicated against pre-existing pool entries
        const again = window.buildWorkspaceFromHar({ rules, policies, sits }, result.variables);
        expect(again.variables).toEqual(result.variables);
    });

    test('report describes matched/unmatched/degraded counts', () => {
        const result = window.buildWorkspaceFromHar({ rules, policies, sits }, []);
        const report = result.report;
        expect(report.ruleCount).toBe(3);
        expect(report.matchedCount).toBe(2);
        expect(report.unmatchedCount).toBe(1);
        expect(report.unmatchedNames).toEqual(['G075-Email iOS/macOS-Exclusion']);
        expect(report.policyCount).toBe(3);
        expect(report.degradedConditions).toBe(0);
    });

    test('imports only the selected rules', () => {
        const result = window.buildWorkspaceFromHar({ rules, policies, sits }, [], ['G006-Email To External-Monitor']);
        expect(result.policies).toHaveLength(1);
        expect(result.policies[0].name).toBe('G006-Email To External-Monitor');
        expect(result.policies[0].rules).toHaveLength(1);
        expect(result.report.ruleCount).toBe(1);
        expect(result.report.totalRules).toBe(3);
        expect(result.report.unmatchedCount).toBe(0);
        // Variables pool only picks up conditions from the selected rule.
        expect(result.variables).toContain('Content contains: Credit Card Number');
        expect(result.variables).not.toContain('Recipient domain is: gmail.com');
    });

    test('selecting only an unmatched rule yields just the unmatched bucket', () => {
        const result = window.buildWorkspaceFromHar({ rules, policies, sits }, [], ['G075-Email iOS/macOS-Exclusion']);
        expect(result.policies).toHaveLength(1);
        expect(result.policies[0].name).toBe('Unmatched Rules (from HAR)');
        expect(result.policies[0].rules).toHaveLength(1);
        expect(result.report.unmatchedCount).toBe(1);
        expect(result.report.matchedCount).toBe(0);
    });

    test('empty selection produces no policies and zero imported rules', () => {
        const result = window.buildWorkspaceFromHar({ rules, policies, sits }, [], []);
        expect(result.policies).toEqual([]);
        expect(result.report.ruleCount).toBe(0);
        expect(result.report.totalRules).toBe(3);
    });

    test('rules get a 1-based priority ordinal in capture order within their policy', () => {
        const twoRules = [
            { Name: 'G006-Email To External-Monitor', RuleXml: ruleXml('<is property="Item.SharedWithDomains"><value>a.com</value></is>') },
            { Name: 'G006-Email To External-Monitor 2', RuleXml: ruleXml('<is property="Item.SharedWithDomains"><value>b.com</value></is>') }
        ];
        const result = window.buildWorkspaceFromHar({ rules: twoRules, policies: [policies[0]], sits }, []);
        expect(result.policies).toHaveLength(1);
        expect(result.policies[0].rules.map(r => r.name)).toEqual(['G006-Email To External-Monitor', 'G006-Email To External-Monitor 2']);
        expect(result.policies[0].rules.map(r => r.priority)).toEqual([1, 2]);
    });

    test('full-detail (clicked-into) rules override Lite: AdvancedRule conditions + authoritative policy', () => {
        const fullRule = {
            Name: 'G006-Email To External-Monitor',
            DisplayName: 'G006-Email To External-Monitor',
            Disabled: false,
            Workload: 'Exchange, SharePoint, OneDriveForBusiness',
            Policy: 'aaaaaaaa-0000-0000-0000-000000000000',
            ParentPolicyName: 'G006-Email To External-Monitor',
            AdvancedRule: JSON.stringify({
                Version: '1.0',
                Condition: {
                    Operator: 'And',
                    SubConditions: [
                        {
                            ConditionName: 'ContentContainsSensitiveInformation',
                            Value: [{ Groups: [{ Name: 'Cards', Operator: 'Or', Sensitivetypes: [{ Name: 'Credit Card Number' }] }], Operator: 'And', Target: 'Message' }]
                        },
                        {
                            Operator: 'Not',
                            SubConditions: [{
                                Operator: 'And',
                                SubConditions: [{ ConditionName: 'RecipientDomainIs', Value: ['gmail.com', 'onmicrosoft.com', 'gov.sg', 'hotmail.com'] }]
                            }]
                        }
                    ]
                }
            })
        };

        const result = window.buildWorkspaceFromHar({
            rules, policies, sits,
            fullRules: [{ rule: fullRule, policyGuid: 'aaaaaaaa-0000-0000-0000-000000000000' }],
            fullPolicies: [{ Guid: 'aaaaaaaa-0000-0000-0000-000000000000', DisplayName: 'G006-Email To External-Monitor' }]
        }, []);

        expect(result.report.fullDetailCount).toBe(1);
        const g006 = result.policies.find(p => p.name === 'G006-Email To External-Monitor');
        const rule = g006.rules.find(rr => rr.name === 'G006-Email To External-Monitor');
        // AdvancedRule wins over RuleXml: real condition names + the 4th domain the Lite
        // RuleXml omits, with the Content contains node's Target context preserved.
        expect(rule.tokens).toEqual([
            mkOp('('),
            mkVar('Content contains: Credit Card Number', { targetContext: 'Message' }),
            mkOp('AND NOT'),
            mkOp('('),
            mkVar('Recipient domain is: gmail.com, onmicrosoft.com, gov.sg, hotmail.com', { targetContext: 'Both' }),
            mkOp(')'),
            mkOp(')')
        ]);
        // Full rule carries its own real Workload (Lite reports 'None').
        expect(rule.workloads).toEqual({ email: true, endpoint: false });
        // Authoritative policy: ParentPolicyName used, no fuzzy match needed.
        expect(g006.rules.map(rr => rr.name)).toEqual(['G006-Email To External-Monitor']);
    });
});

// ---------------------------------------------------------------------------
describe('extractDlpPayloads (shared worker / file:// fallback logic)', () => {
    function entry(url, body) {
        return {
            request: { url },
            response: { content: { text: JSON.stringify(body) } }
        };
    }

    test('returns empty arrays when nothing matches', () => {
        expect(window.extractDlpPayloads([])).toEqual({ rules: [], policies: [], sits: [], labels: [], fileTypes: {}, fullRules: [], fullPolicies: [] });
        expect(window.extractDlpPayloads([entry('https://x/other', { DataType: 'DlpComplianceRule', ResultCode: 'Success', ResultData: [] })])).toEqual({ rules: [], policies: [], sits: [], labels: [], fileTypes: {}, fullRules: [], fullPolicies: [] });
    });

    test('buckets by DataType and keeps the highest RecordCount per Success', () => {
        const entries = [
            entry('https://x/apiproxy/di/find/DlpA', { DataType: 'DlpComplianceRule', RecordCount: 32, ResultCode: 'Success', ResultData: [{ Name: 'R1' }] }),
            entry('https://x/apiproxy/di/find/DlpB', { DataType: 'DlpComplianceRule', RecordCount: 1, ResultCode: 'Success', ResultData: [{ Name: 'R2' }] }),
            entry('https://x/apiproxy/di/find/DlpC', { DataType: 'DlpCompliancePolicy', RecordCount: 27, ResultCode: 'Success', ResultData: [{ Name: 'P1' }] }),
            entry('https://x/apiproxy/di/find/DlpD', { DataType: 'DlpSensitiveInformationType', RecordCount: 331, ResultCode: 'Success', ResultData: [{ Id: 'a', Name: 'SIT' }] })
        ];
        const result = window.extractDlpPayloads(entries);
        expect(result.rules).toHaveLength(1);
        expect(result.rules[0].Name).toBe('R1');
        expect(result.policies).toHaveLength(1);
        expect(result.sits).toHaveLength(1);
    });

    test('ignores non-Success envelopes and non-array ResultData (e.g. NoContent)', () => {
        const entries = [
            entry('https://x/apiproxy/di/find/DlpA', { DataType: 'DlpCompliancePolicy', RecordCount: -1, ResultCode: 'NoContent', ResultData: [] }),
            entry('https://x/apiproxy/di/find/DlpB', { DataType: 'DlpEdmSchema', RecordCount: -1, ResultCode: 204, ResultData: [] }),
            entry('https://x/apiproxy/di/find/DlpC', { DataType: 'DlpComplianceRule', RecordCount: 32, ResultCode: 'Success', ResultData: [{ Name: 'R1' }] })
        ];
        const result = window.extractDlpPayloads(entries);
        expect(result.policies).toEqual([]);
        expect(result.rules).toHaveLength(1);
    });

    test('a "__proto__" DataType cannot pollute the bucket object', () => {
        const before = Object.prototype.hacked;
        const entries = [
            entry('https://x/apiproxy/di/find/DlpA', { DataType: '__proto__', RecordCount: 5, ResultCode: 'Success', ResultData: [{ Name: 'X' }] }),
            entry('https://x/apiproxy/di/find/DlpB', { DataType: 'DlpComplianceRule', RecordCount: 2, ResultCode: 'Success', ResultData: [{ Name: 'R1' }] })
        ];
        const result = window.extractDlpPayloads(entries);
        expect(result.rules).toHaveLength(1);
        expect(Object.prototype.hacked).toBe(before);
    });

    test('non-JSON response text is skipped without throwing', () => {
        const entries = [
            { request: { url: 'https://x/apiproxy/di/find/DlpA' }, response: { content: { text: 'not json' } } },
            { request: { url: 'https://x/apiproxy/di/find/DlpB' }, response: { content: {} } }
        ];
        expect(window.extractDlpPayloads(entries)).toEqual({ rules: [], policies: [], sits: [], labels: [], fileTypes: {}, fullRules: [], fullPolicies: [] });
    });

    test('extracts full rules and policies from InvokeCommand (portal PowerShell bridge)', () => {
        const entries = [
            {
                request: { url: 'https://purview.microsoft.com/apiproxy/admin/Beta/t/InvokeCommand', postData: { text: JSON.stringify({ CmdletInput: { CmdletName: 'Get-DlpComplianceRule', Parameters: { policy: 'GUID-1' } } }) } },
                response: { content: { text: JSON.stringify({ value: [{ Name: 'Full Rule 1', AdvancedRule: '{}' }] }) } }
            },
            {
                request: { url: 'https://purview.microsoft.com/apiproxy/admin/Beta/t/InvokeCommand', postData: { text: JSON.stringify({ CmdletInput: { CmdletName: 'Get-DlpCompliancePolicy', Parameters: { Identity: 'GUID-1' } } }) } },
                response: { content: { text: JSON.stringify({ value: [{ Guid: 'GUID-1', DisplayName: 'Full Policy 1' }] }) } }
            }
        ];
        const result = window.extractDlpPayloads(entries);
        expect(result.fullRules).toHaveLength(1);
        expect(result.fullRules[0].rule.Name).toBe('Full Rule 1');
        expect(result.fullRules[0].policyGuid).toBe('GUID-1');
        expect(result.fullPolicies).toHaveLength(1);
        expect(result.fullPolicies[0].DisplayName).toBe('Full Policy 1');
    });

});

// ---------------------------------------------------------------------------
describe('parseRuleXml → serializePurviewJSON → parsePurviewJSON round-trip', () => {
    test('tokens from RuleXml survive a full export/import cycle', () => {
        const xml = ruleXml(
            '<and>' +
            '<is property="Item.SharedWithDomains"><value>gmail.com</value></is>' +
            '<not><is property="Item.ContentIsNotLabeled" /></not>' +
            '</and>',
            '<action name="BlockAccess" /><action name="NotifyUser" /><action name="Halt" />'
        );
        const parsed = window.parseRuleXml(xml, SIT_MAP);
        const rule = {
            id: 'r1',
            name: 'Round Trip Rule',
            enabled: parsed.enabled,
            tokens: parsed.tokens,
            actions: parsed.actions,
            stopProcessing: parsed.stopProcessing,
            workloads: { email: true, endpoint: false }
        };
        const policies = [{ id: 'p1', name: 'Round Trip Policy', enabled: true, rules: [rule] }];

        const exported = window.serializePurviewJSON(policies);
        const reimported = window.parsePurviewJSON(exported, []);

        expect(reimported.policies[0].name).toBe('Round Trip Policy');
        const reRule = reimported.policies[0].rules[0];
        expect(reRule.stopProcessing).toBe(true);
        expect(reRule.actions.block).toBe(true);
        expect(reRule.actions.notify).toBe(true);

        const varTokens = reRule.tokens.filter(t => t.type === 'variable').map(t => t.val);
        expect(varTokens).toContain('Recipient domain is: gmail.com');
        expect(varTokens).toContain('Content is not labeled');
        // Boolean structure preserved: the NOT branch survives as AND NOT
        const ops = reRule.tokens.filter(t => t.type === 'operator').map(t => t.val);
        expect(ops).toContain('AND NOT');
    });

    test('priority survives serializePurviewJSON → parsePurviewJSON', () => {
        const rule = {
            id: 'r1',
            name: 'Priority Rule',
            enabled: true,
            priority: 3,
            tokens: [mkVar('Content contains: Credit Card Number', { targetContext: 'Both' })],
            actions: { monitor: true, notify: false, override: false, block: false },
            stopProcessing: false,
            workloads: { email: true, endpoint: false }
        };
        const exported = window.serializePurviewJSON([{ id: 'p1', name: 'Priority Policy', enabled: true, rules: [rule] }]);
        expect(JSON.parse(exported)[0].Rules[0].Priority).toBe(3);
        const reimported = window.parsePurviewJSON(exported, []);
        expect(reimported.policies[0].rules[0].priority).toBe(3);
    });
});
