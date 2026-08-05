# Purview Playground

> Build, visualize, and battle-test Microsoft Purview DLP policy logic — right in your browser.

An interactive browser tool for building, visualizing, and testing Microsoft Purview Data Loss Prevention policy logic — without touching a live tenant.

## What is this?

Microsoft Purview DLP policies can contain deeply nested AND/OR/NOT logic across multiple workloads (Exchange, SharePoint, Endpoint, and more). Understanding exactly when a rule will fire — or why it is not firing — is difficult from the Compliance portal alone.

This tool gives Purview engineers a visual rule builder where they can compose conditions using boolean operators, evaluate them against simulated events, inspect a full truth table, and generate a plain-English explanation of what each rule does. The entire thing runs in the browser with no server required; you can share a workspace with a colleague via a single URL.

## Features

- **Visual rule builder** — drag-and-drop conditions onto a canvas and connect them with AND, OR, NOT, and AND NOT operators; duplicate any rule or whole policy with one click to build variations quickly
- **Boolean logic evaluator** — evaluates infix token expressions (converted to postfix internally) with correct operator precedence across nested groups
- **Truth table** — exhaustively enumerates all condition combinations and shows which trigger the rule; export the full table (combinations, logic trace, explanation, result) to CSV
- **Event simulator** — set individual condition values to true/false and immediately see whether each rule fires and which actions are triggered (Monitor, Notify, Override, Block); copy the run as a plain-text report or download it as a `.txt` file
- **Conflict detector** — automatically flags logical contradictions (e.g. a condition AND NOT itself) in a rule's token expression
- **Natural language explanation** — generates a plain-English summary of each rule; supports three modes: two built-in static templates, plus AI-generated explanations via OpenAI, Anthropic, Google Gemini, or DeepSeek
- **Rule summary page** — cross-policy view of all rules with selectable export targets, plus per-rule one-click buttons to copy a rule's raw boolean expression or its plain-English explanation to the clipboard
- **PDF export** — exports the current rule summary to a PDF for documentation or review
- **Markdown runbook export** — exports selected rules from the summary page as a `.md` runbook (status, workloads, actions, logic, and explanation per rule) for wikis or repos
- **Workspace file backup** — download the entire workspace as a timestamped `.json` file and load it back later, independent of the browser's local storage
- **URL sharing** — serializes the entire workspace state into the URL so you can share an exact configuration with a link
- **PowerShell JSON import** — paste the JSON output of `Get-DlpComplianceRule` (from the Security & Compliance PowerShell module) to reverse-engineer an existing policy into the visual builder
- **Purview portal HAR import** — load your tenant's real DLP policies and rules straight from a browser HAR capture of the DLP policy page (F12 → Network → *Save all as HAR*), without needing PowerShell or admin credentials; parsed fully locally in a Web Worker
- **PowerShell JSON export** — generate a JSON payload compatible with `New-DlpComplianceRule` / `Set-DlpComplianceRule`
- **Dark mode** — full light/dark theme toggle, persisted per browser
- **No build step** — plain HTML, CSS (Tailwind via CDN), and vanilla JavaScript; open `index.html` and it works

## Quick Start

1. **Open the tool** — visit [https://guruoz.github.io/microsoft-purview-playground/](https://guruoz.github.io/microsoft-purview-playground/)
2. **Build a rule** — drag a condition from the left-hand panel onto the canvas, then add AND/OR/NOT operators to compose the logic; or click "Load Example" to start from a pre-built scenario
3. **Run the simulator** — navigate to the **Simulator** tab, toggle conditions on or off, and observe which rules fire and what actions are applied

## Usage

### Building Rules

Open `index.html` (the Rule Builder). Each policy can contain multiple rules. Within a rule:

- Drag condition tiles from the condition palette on the left onto the rule canvas
- Use the operator buttons (AND, OR, NOT, AND NOT, parentheses) to connect conditions
- Rules are evaluated left-to-right with standard boolean precedence: NOT > AND > OR
- Nested groups can be created with parentheses by dragging the `(` and `)` tokens
- The conflict detector will warn you inline if an expression contains a logical contradiction

### Running the Simulator

Navigate to the **Simulator** tab (`simulator.html`). The simulator reads the current workspace state (shared via `localStorage`).

- Each condition in each rule is listed with a true/false toggle
- After toggling, click **Run Simulation** to evaluate all rules simultaneously
- Results show per-rule: matched (yes/no), applicable actions, and which conditions contributed

### Importing from Purview

1. Export a rule from PowerShell:
   ```powershell
   Get-DlpComplianceRule -Identity "Your Rule Name" | ConvertTo-Json -Depth 20
   ```
2. In the Rule Builder, click **Import / Export**, paste the JSON into the text area, and click **Import Purview PowerShell JSON**
3. The parser maps PowerShell property names to the visualizer's condition vocabulary and reconstructs the full boolean expression

### Importing from a Purview portal HAR

No PowerShell or admin rights needed — anyone with portal access can capture their tenant's real configuration:

1. In the Purview portal, open the **Data loss prevention → Policies** page and press **F12** (DevTools)
2. Switch to the **Network** tab and **refresh** the page so the DLP API calls are captured
3. **Click into a rule you care about** (open it for editing) before saving — the portal then fetches that rule's *complete* definition (`Get-DlpComplianceRule`), which the importer uses in preference to the Lite summary: real condition values, correct actions, and the rule's exact policy (no fuzzy matching needed for it). Clicking into more rules captures more full detail
4. Right-click anywhere in the request list and choose **Save all as HAR**
5. In the Rule Builder, click **Import / Export → Import from HAR…** and pick the `.har` file
6. A preview lists every rule under the policy it matched (unmatched rules under `Unmatched Rules (from HAR)`); tick the ones to import (all are selected by default) and click **Import Selected** — the workspace is replaced in one undoable step

Notes:

- The capture is parsed **entirely locally in a Web Worker** — nothing is uploaded. **A HAR contains bearer tokens, cookies and tenant data: never share or commit the file.**
- If you open `index.html` straight from disk (`file://`), browsers forbid Workers on that opaque origin — the import then falls back to main-thread parsing (same logic, still fully local), so very large captures may briefly pause the page. Serving the folder (e.g. `npx http-server` or GitHub Pages) keeps the responsive worker path.
- Rules are grouped into policies by matching on the leading policy code — `G006`, `HTA001`, `SPF003`, `MHA001A`, … (agency-style codes are handled as well as G-codes, with a guard so near-duplicate families like G075/G076 are never crossed). Rules whose code has no matching policy are collected into an `Unmatched Rules (from HAR)` policy for manual filing
- **Priority:** the portal fetches rules with `filter=Lite`, which zeroes every rule's `Priority` field — the capture contains no real priority data (even the full `Get-DlpComplianceRule` invoked when you edit a rule returns 0). Imported rules therefore keep their capture order and receive a 1-based ordinal (their position within the policy), which is exported as the PowerShell `Priority`; PowerShell JSON import reads `Priority` too. Re-order rules in the builder to set the order you actually want
- **Policy priorities from the portal CSV export** — in the Purview portal (DLP → Policies), click **Export** and save the CSV, then in the Playground use **Import / Export → Load Policy CSV…**. Policies are matched by name (case/punctuation-insensitive), reordered to the tenant's real evaluation order, given their real On/Off state, and the priority badge shows the portal value. The CSV is policy-level: it carries the tenant-wide policy priority, not per-rule priority (that still isn't available anywhere in the portal's browser traffic). CSV policies with no matching workspace policy are reported in the summary — rename the workspace policy to the portal's name to pick them up
- Keyword lists (`textScan`) and `Item.ContentFileType` IDs are **not recoverable** from the capture (the portal never sends them to the browser); these conditions render with a visible `(not in capture)` marker and a warning
- The portal sends rules with `filter=Lite`, which strips PowerShell condition fields — this is why HAR import reads the rules' `RuleXml` rather than reusing the PowerShell JSON parser
- Policy↔rule grouping is **inferred**, not authoritative: spot-check imported rules against your tenant

### Exporting to PowerShell

1. Build or import your policy in the Rule Builder
2. Click **Import / Export** and then **Export to Purview JSON**
3. Copy the generated JSON and use it as the `-AdvancedRule` parameter value with `New-DlpComplianceRule` or `Set-DlpComplianceRule`

## Known Limitations

> **Important:** This tool models the logical structure of DLP policy rules, not the full Microsoft Purview enforcement engine. Simulation results are indicative only and should not be treated as authoritative.
>
> Factors outside this tool's scope include: policy-level settings (priority, scoped locations, adaptive protection integration), SIT (Sensitive Information Type) confidence levels and instance counts, DLP enforcement modes (Audit, Warn, Block), transport rule interactions, and tenant-specific configuration. Always validate policy behaviour in a test tenant before production deployment.

## Development

The project uses [Vitest](https://vitest.dev/) for unit tests and [ESLint](https://eslint.org/) for linting. Node.js is only required for the development toolchain; the app itself has no runtime dependencies.

```bash
# Install dev dependencies
npm install

# Run the test suite
npm test

# Run tests in watch mode
npm run test:watch

# Lint the JavaScript source
npm run lint
```

Tests live in the `tests/` directory and cover the evaluator, parser, state management, and conflict detector.

To run the app locally, open `index.html` directly in a browser — no local server is required for basic use. If you need `localStorage` sharing between pages to work reliably across all browsers, serve the files from a local HTTP server:

```bash
npx serve .
```

## Contributing

1. Fork the repository on GitHub: [https://github.com/GuruOz/microsoft-purview-playground](https://guruoz.github.io/microsoft-purview-playground/)
2. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. Make your changes, add or update tests as appropriate, and verify `npm test` and `npm run lint` pass cleanly
4. Open a pull request against `main` with a clear description of the change and the problem it solves

Bug reports and feature requests are welcome via [GitHub Issues](https://github.com/GuruOz/microsoft-purview-playground/issues).

## License

MIT

## Disclaimer

Purview Playground is a community tool and is **not affiliated with, endorsed by, or supported by Microsoft**. "Microsoft Purview" is a trademark of Microsoft Corporation, used here descriptively to indicate compatibility.
