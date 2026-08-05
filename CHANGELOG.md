# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.10.0] - 2026-08-05

### Added
- **Import rules from a Purview portal HAR capture** — open the DLP policy page in the Purview portal, press F12, refresh, and *Save all as HAR* in the Network tab; the new **Import from HAR…** button in the Import / Export modal loads your tenant's real policies, rules and sensitive information types into the workspace
  - The 99 MB-class capture is parsed in a **Web Worker** so the page stays responsive, with progress shown in the modal; when the page is opened directly from disk (`file://`) where Workers are forbidden, the same extraction logic runs on the main thread instead
  - **Sensitivity labels show the portal's names**: RuleXml and `AdvancedRule` both identify a label by Purview's *internal* name (`Non Sensitive_2` — the numeric suffix is Purview's own disambiguation), which is what the rule canvas used to display. The capture's sensitivity label catalog is now read from `/di/find/Label` and used to render the portal's `Parent/Child` name instead — `SECRET/NON-SENSITIVE`. The parent is not decoration: in a real tenant 8 distinct labels all display as `NON-SENSITIVE`, so without it the condition is ambiguous. Resolution prefers the label GUID over the name, covers both the Lite RuleXml path and the full-detail `AdvancedRule` path, and falls back to the internal name with a warning when a capture has no label catalog
  - **Endpoint DLP rules get their real actions**: action detection only ever looked at the Exchange fields (`BlockAccess`, `NotifyUser`, `NotifyAllowOverride`, `GenerateAlert`), and an endpoint rule sets none of them — on a real capture `BlockAccess` is literally `false` on a rule named `-Block`, because the verdict lives in `EndpointDlpRestrictions`. Every web-upload, printer, removable-media and cloud-app rule therefore imported with only **Monitor** ticked: **31 of 45** full-detail rules had the wrong action set. Those restrictions are now read (both the simple `setting`/`value` shape and the nested per-destination `action` shape used by `CloudEgress`), mapping `Block` → Block, `Warn` and a required business justification → Override, and the endpoint policy tip → Notify. `Audit` deliberately maps to nothing extra, since it is plain logging already covered by Monitor. Verified against the tenant's own naming convention: all 40 suffixed rules (`-Block`, `-Affirm`, `-Monitor`, `-Alert`) now match their name's intent, where previously no endpoint `-Block` rule showed Block
  - **Content file types are named instead of shown as GUIDs**: `Item.ContentFileType` / `ContentFileTypeMatches` reference GUIDs that no API response names, so a rule read `Content File Type Matches: 29b89383-a6f8-…, abae71fd-17b1-…`. The portal hardcodes the table in a JS bundle (`mip.js`), and that bundle is in the capture — it is now scraped, so the condition reads `Word processing (Word, PDF), Spreadsheet (Excel, CSV, TSV), Presentation (PowerPoint), Mail (Outlook, OST, MSG)`. Fully resolved file-type conditions are no longer flagged as degraded (12 fewer degraded rules on a real capture). Scraping a minified bundle is a heuristic, so it degrades safely: if Microsoft renames those keys the GUID is shown exactly as before
  - **Header conditions no longer render as `[object Object]`**: `HeaderContainsWords` carries a *map* of header name → values (`{"x-cdlp-device": ["OutlookWindows", "OutlookWebApp"]}`) rather than the flat array every other condition uses, and the object fell through to a string coercion that destroyed both the header name and its values. It now renders `x-cdlp-device: OutlookWindows, x-cdlp-device: OutlookWebApp`, with each pair pooled as its own simulator variable
  - **Damaged captures still import**: DevTools can emit a torn line inside a long `_initiator.stack.callFrames` array, which fails a whole-file `JSON.parse` and would otherwise lose every entry over one bad one. The reader now falls back to splitting `log.entries` on newline-anchored entry boundaries — a literal newline never appears inside a JSON string, so the split survives the unbalanced quotes a torn line leaves behind, where a quote/brace scanner desyncs and silently swallows the entries that follow. Only the damaged entry is dropped, and the skipped count is shown in the preview so a missing rule is never silent (on a real 127 MB capture: 941 of 942 entries recovered)
  - RuleXml (the only condition source the portal's `Lite` API returns) is parsed into the visualizer's token model; sensitivity labels and SIT GUIDs are resolved through the captured SIT catalog; actions and `Halt` map to the existing monitor/notify/override/block model
  - Rules are grouped into policies by **code-anchored fuzzy name matching**; the matcher now handles agency-style codes (`HTA001`, `SPF003`, `MHA001A`, …) alongside G-codes, uses a lower similarity bar for same-code variants, and guards near-duplicate code families (G075 is never filed under G076). Verified on two real tenant captures: 27/32 and 123/148 rules matched, with no false matches; genuinely policy-less rules (e.g. the `NGEP-DEV-*` family) land in an `Unmatched Rules (from HAR)` policy
- **Priority** — the portal's `Lite` API zeroes every rule's `Priority` field, so imported rules keep their capture order and receive a 1-based ordinal per policy; the ordinal is exported as the PowerShell `Priority`, and PowerShell JSON import now reads `Priority` back too
- **Full rule detail from edited rules** — when the capture contains `InvokeCommand` responses (the portal fetches a rule's complete definition when you click into it for editing), those rules are imported in preference to the Lite summary: real `AdvancedRule` conditions (including values the Lite `RuleXml` omits), correct actions and workload, and **authoritative policy placement** via `ParentPolicyName`/policy GUID with no fuzzy matching
- **Policy priorities from the portal CSV export** — new **Load Policy CSV…** button applies the real tenant-wide policy evaluation order and On/Off state from the portal's DLP policies export (`Name,Priority,Mode,…`): policies are matched by name (case/punctuation-insensitive), reordered by the CSV priority, and the policy card badge shows the portal value. Policy-level only — per-rule priority still does not exist in any portal browser data
  - Unrecoverable data (keyword lists and `Item.ContentFileType` IDs, which the portal never sends to the browser) renders as visibly marked placeholders with warnings — never silently dropped
  - Parsing is **100% local** — nothing is uploaded; the UI warns that HAR files contain bearer tokens and tenant data and must not be shared
- **Tests** — `tests/har-parser.test.js` (32 cases): RuleXml boolean walk, `containsDataClassification` label/SIT shapes, target contexts, actions, placeholders, malformed-XML errors, G-code matching, end-to-end workspace assembly, rule-selection filtering and a serialize/parse round-trip
- **Rule selection on import** — after extraction a preview dialog lists every rule under the policy it matched (all selected by default); tick the ones you want and the import commits only those, so you can pull a handful of rules out of a large tenant capture

## [1.9.1] - 2026-06-20

### Changed
- **Warning colours separated from the new amber Rules** so nothing blends together: rule conflict badges ("Unreachable" / "Duplicate of Rule …") are now a solid, high-visibility **red** instead of pale yellow; the "Contains server-side only conditions" deferral notice is now **purple** (matching the "deferred to server" indicator in the simulator) instead of orange, which read almost identically to the amber rule card
- The outermost nesting-bracket colour in the rule canvas changed from amber to **pink**, since amber brackets on an amber rule card were hard to read; the depth cycle is now pink → purple → teal → green

## [1.9.0] - 2026-06-20

### Changed
- **Higher-contrast colour scheme for Policies vs Rules** (light and dark): Policies keep the indigo identity (now with a deeper border), while Rules switch from blue to **amber** so the two containers are immediately distinguishable instead of reading as the same colour. Applied consistently to the Rule Builder and the Rule Summary page (which previously rendered both as neutral grey), including matching "Policy" / "Rule" badges and the hierarchy caption. Blue is now reserved for conditions/logic tokens, sharpening the separation between a rule and the conditions inside it

## [1.8.0] - 2026-06-20

### Added
- **Simulator results export**: after running a simulation, two new buttons in the Evaluation Trace header let you **Copy** the result as a plain-text report or **Download** it as a timestamped `.txt` file. The report captures the channel, the conditions set to True, the user-override choice, every policy/rule outcome per phase (match / no-match / skipped / deferred / disabled, with actions and halt reasons), and the final bundled outcome — a snapshot of exactly what was evaluated, independent of later input changes

### Changed
- The clipboard helper is now shared across pages (`window.copyToClipboard` in `state.js`), powering both the Rule Summary copy buttons and the new Simulator export

## [1.7.0] - 2026-06-20

### Added
- **Copy rule logic / copy plain-English**: each rule on the Rule Summary page now has two one-click "Copy" buttons — one copies the raw boolean expression, the other copies the generated plain-English explanation — so a single rule can be dropped into a ticket, chat, or doc without exporting the whole runbook. The explanation's copy button appears once its text finishes generating; buttons flash "Copied!" and fall back to a manual prompt if the clipboard API is blocked
- The summary card now labels its two sections ("Logic" and "Plain English") for clarity

## [1.6.0] - 2026-06-20

### Added
- **Workspace file backup**: download the current workspace as a timestamped `.json` file, and load one back from disk — durable backup/restore that does not depend on copy-paste or share links (Import / Export dialog)
- **Truth table CSV export**: a "Download CSV" button on the truth table exports every condition combination, the logic trace, a plain-English explanation, and the final result as an Excel-friendly CSV (UTF-8 BOM, RFC-4180 escaping)
- **Markdown runbook export**: the Rule Summary page can export selected rules as a `.md` runbook — per rule it records status, workloads, actions, stop-processing, the raw logic, and the plain-English explanation, ready to drop into a wiki or repo
- **Duplicate rule / duplicate policy**: one-click "Duplicate" buttons clone a rule or an entire policy (with fresh IDs and a "(copy)" name) directly below the original, so variations can be built without rebuilding logic from scratch
- **Three new example templates**: GDPR – EU Personal Data (Email), HIPAA – Protected Health Information (Email + Endpoint), and Source Code Exfiltration (Endpoint), bringing the gallery to six ready-to-explore scenarios

### Changed
- The "Load Example" gallery is now rendered from the `DLP_EXAMPLES` data array, so cards can no longer drift out of sync with the underlying examples; gallery cards are keyboard-accessible

## [1.5.0] - 2026-06-13

### Added
- **Import/Export format guide**: the modal now shows a colour-coded legend explaining the difference between Purview PowerShell format (purple) and Visualizer workspace format (blue) — first-time users know exactly which button to use
- **Policy & Rule visual hierarchy**: Policies now have an indigo badge and indigo-tinted background; Rules have a blue badge and blue-bordered card, making the containment relationship immediately obvious
- Hierarchy caption below the "Policy & Rule Hierarchy" heading explains that Policies are enforcement containers, Rules are evaluated in priority order, and the first match triggers actions

### Changed
- Policy cards use an indigo border and background (was grey) to visually separate them from Rule cards
- Rule cards use a blue border (was grey) and gain a "Rule" badge alongside each Policy's "Policy" badge

## [1.4.0] - 2026-06-13

### Added
- Shared header component (`js/nav.js`): consistent brand mark, the **"Purview Playground"** product name, and icon-equipped navigation on every page
- Simulator: a **"Conditions set to True"** summary row above the condition list, with one-click removal chips
- Prominent **production-safety warning** when exporting to Purview PowerShell JSON (back up first, review carefully, use at your own risk)

### Changed
- Every page now shows the "Purview Playground" product name in its header, with the page name as a subtitle
- Navigation links across all pages now share consistent icons for a cohesive look

### Fixed
- Condition pool: the "+ Add" and edit (pencil) buttons are no longer pushed out of view by long condition names — the label now wraps and the actions stay visible

## [1.3.0] - 2026-06-13

### Changed
- **AI Regex Builder moved to its own page** (`regex.html`, linked in the main nav) so it is no longer buried in Settings
- The Regex Tester is now a standalone panel with its own manual pattern input, decoupled from the AI chat — no auto-population, the chat and tester are independent

### Added
- "Ignore case" toggle in the Regex Tester (adds the equivalent of the .NET `(?i)` flag)
- Match details: the tester now lists the matched substrings, and hints when a non-match is likely a case-sensitivity issue
- "Send to tester" button on each AI-generated regex to push it into the tester with one click

### Fixed
- Regex Tester is now reachable without first using the AI chat (previously the test field was hidden inside the chat refine row)

## [1.2.0] - 2026-06-13

### Changed
- **Project renamed to Purview Playground** (formerly Purview DLP Logic Visualizer)
- Simulator conditions now use explicit True/False toggles instead of checkboxes, so negated conditions ("NOT attachment is password protected") are an active choice rather than something left unchecked
- Page headers and policy/rule rows wrap on narrow screens — no more horizontal scrolling on mobile

### Added
- **Rule Trigger Helper** in the simulator: one click computes and applies a combination of inputs that makes a chosen rule match, including conditions that must be False
- **AI Regex Builder** on the Settings page: describe what you want to match, get a .NET-compatible regex for Purview conditions, refine it through chat, and test it live against sample strings
- Microsoft non-affiliation disclaimer in the README

## [1.1.0] - 2026-06-12

### Added
- Progressive Web App support: manifest, icons, and offline-capable service worker
- Share links compressed with gzip (`CompressionStream`), producing much shorter URLs; legacy links still work

## [1.0.0] - 2026-06-12

### Added
- PowerShell JSON export: convert visual rule tokens back to Purview `AdvancedRule` AST format for use with `New-DlpComplianceRule`
- Rule conflict detection: yellow warning badges on rules that are logically unreachable (`A AND NOT A`) or exact duplicates within a policy
- SharePoint/OneDrive and Teams workload categories in the condition pool
- Additional PowerShell property mappings for SharePoint (`SPContent*`, `SiteURL*`) and Teams (`TeamsMessage*`) conditions
- Three built-in example policies accessible via the "Load Example" button
- Content Security Policy meta tag on all pages; whitelists only Tailwind CDN and the four AI provider endpoints
- Unit test suite: 99 tests across evaluator, state, parser, and conflict-detector modules (Vitest + jsdom)
- CI pipeline: lint and tests run on every push and pull request to `main`
- ESLint v9 flat config with zero warnings across all JS files
- Prettier configuration for consistent formatting
- GitHub Pages automated deployment on push to `main`
- Input validation on imported JSON with actionable error messages
- Version number displayed in the application footer

### Fixed
- `NOT` operator precedence corrected to 3 (was 2), fixing evaluation of `A AND NOT B` with separate `AND` and `NOT` tokens
- XSS vulnerabilities: all user-controlled strings escaped via `escapeHtml()` before insertion into `innerHTML` across `ui.js`, `simulator-ui.js`, `summary-ui.js`, `app.js`, `evaluator.js`, and `settings-ui.js`
- AI provider API keys moved from `localStorage` to `sessionStorage` — no longer persisted to disk across browser sessions

### Security
- CSP blocks all external script sources except whitelisted CDNs
- `escapeHtml()` using `document.createTextNode` prevents HTML injection in rule names, condition values, and error messages
- API keys stored in session memory only; never included in exported JSON or share links
