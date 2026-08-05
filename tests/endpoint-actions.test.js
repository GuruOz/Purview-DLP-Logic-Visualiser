// Tests for Endpoint DLP action derivation in js/parser.js.
//
// The original action checks were all Exchange-side (BlockAccess / NotifyUser /
// NotifyAllowOverride / GenerateAlert). Endpoint rules set NONE of those — on a real
// tenant capture BlockAccess is literally false on a rule named "-Block" — because the
// verdict lives inside EndpointDlpRestrictions. The result was that 31 of 45 rules
// imported with only Monitor ticked, including every web-upload blocking rule.
//
// EndpointDlpRestrictions is nested OData hash tables: arrays of {_key,_value} where a
// _value may itself be another such array. The verdict is either the restriction's own
// "value" (simple settings like Print/RemovableMedia) or an "action" on each destination
// group (grouped settings like CloudEgress, whose outer "value" reads "None").

const kv = (k, v) => ({ '@odata.type': '#Exchange.GenericHashTable', _key: k, _value: v });

// Simple shape: setting + verdict directly.
const simpleRestriction = (setting, value) => [[kv('appgroup', 'none'), kv('setting', setting), kv('value', value)]];

// Grouped shape: outer value is "None", real verdict sits on each group's action.
const groupedRestriction = (setting, groupKey, groupActions) => [[
    kv('appgroup', 'none'),
    kv('setting', setting),
    kv('defaultmessage', 'none'),
    kv(groupKey, groupActions.map((a, i) => [kv('priority', String(i + 1)), kv('action', a), kv('id', 'g' + i)])),
    kv('value', 'None')
]];

const ruleJson = rule => JSON.stringify([{ PolicyName: 'P', Rules: [Object.assign({ Name: 'R' }, rule)] }]);
const actionsOf = rule => window.parsePurviewJSON(ruleJson(rule), []).policies[0].rules[0].actions;
const fmt = a => ['monitor', 'notify', 'override', 'block'].filter(k => a[k]).join('+') || '(none)';

// ---------------------------------------------------------------------------
describe('collectEndpointVerdicts', () => {
    test('reads a verdict from a simple restriction', () => {
        expect(window.collectEndpointVerdicts(simpleRestriction('Print', 'Block')).block).toBe(true);
        expect(window.collectEndpointVerdicts(simpleRestriction('Print', 'Audit')).audit).toBe(true);
        expect(window.collectEndpointVerdicts(simpleRestriction('Print', 'Warn')).warn).toBe(true);
    });

    test('reads verdicts nested inside a destination group', () => {
        const r = groupedRestriction('CloudEgress', 'cloudEgressGroup', ['Block', 'Block']);
        const v = window.collectEndpointVerdicts(r);
        expect(v.block).toBe(true);
        expect(v.warn).toBe(false);
    });

    test('a required business justification is detected', () => {
        expect(window.collectEndpointVerdicts(simpleRestriction('RequireBusinessJustification', 'Required'))
            .requiresJustification).toBe(true);
    });

    test('missing or malformed restrictions are inert, never throwing', () => {
        [undefined, null, [], {}, 'nonsense', [[{ _key: 'setting' }]]].forEach(input => {
            expect(window.collectEndpointVerdicts(input))
                .toEqual({ block: false, warn: false, audit: false, requiresJustification: false });
        });
    });
});

describe('parsePurviewJSON – endpoint actions', () => {
    test('a blocking endpoint rule ticks Block even though BlockAccess is false', () => {
        const a = actionsOf({
            BlockAccess: false,
            GenerateAlert: ['true'],
            NotifyEndpointUser: [{ _key: 'NotificationTitle', _value: ['BLOCK – FILE UPLOAD'] }],
            EndpointDlpRestrictions: groupedRestriction('CloudEgress', 'cloudEgressGroup', ['Block'])
        });
        expect(fmt(a)).toBe('monitor+notify+block');
    });

    test('Warn maps to override — the user may proceed', () => {
        const a = actionsOf({
            GenerateAlert: ['true'],
            NotifyEndpointUser: [{ _key: 'NotificationTitle', _value: ['WARN'] }],
            EndpointDlpRestrictions: groupedRestriction('CloudEgress', 'cloudEgressGroup', ['Warn'])
        });
        expect(fmt(a)).toBe('monitor+notify+override');
    });

    test('Audit alone does not imply Block', () => {
        // Regression guard: RuleXml only says "EndpointRestrictAccess" for any restriction,
        // so deriving actions from it marked audit-only "-Alert" rules as blocking.
        const a = actionsOf({
            GenerateAlert: ['true'],
            NotifyEndpointUser: [{ _key: 'NotificationTitle', _value: ['ALERT'] }],
            EndpointDlpRestrictions: simpleRestriction('RemovableMedia', 'Audit')
        });
        expect(a.block).toBe(false);
        expect(fmt(a)).toBe('monitor+notify');
    });

    test('a required business justification is an override', () => {
        const a = actionsOf({
            GenerateAlert: ['true'],
            EndpointDlpRestrictions: simpleRestriction('RequireBusinessJustification', 'Required')
        });
        expect(a.override).toBe(true);
    });

    test('an endpoint rule with no restrictions keeps Monitor only', () => {
        expect(fmt(actionsOf({ GenerateAlert: ['true'] }))).toBe('monitor');
    });
});

describe('parsePurviewJSON – Exchange actions are unaffected', () => {
    test('the email override modifier is still detected', () => {
        // NotifyAllowOverride has no RuleXml <action> equivalent, so this must keep
        // coming from the PowerShell fields.
        const a = actionsOf({
            BlockAccess: true, BlockAccessScope: 'All',
            NotifyUser: ['LastModifier'], NotifyAllowOverride: 'WithoutJustification',
            GenerateAlert: ['true']
        });
        expect(fmt(a)).toBe('monitor+notify+override+block');
    });

    test('a plain email block rule is unchanged', () => {
        const a = actionsOf({ BlockAccess: true, NotifyUser: ['Owner'], GenerateAlert: ['true'] });
        expect(fmt(a)).toBe('monitor+notify+block');
    });

    test('a rule with no actions at all stays empty', () => {
        expect(fmt(actionsOf({ StopPolicyProcessing: true }))).toBe('(none)');
    });
});
