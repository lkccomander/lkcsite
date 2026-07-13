# PATBv5 Static Report Tabs and Actions Design

Date: 2026-07-13

## Status

Approved for implementation.

## Objective

Make every tab in the generated PATBv5 session report usable when the HTML file is opened directly, and replace the `Fixes` tab with a telemetry-driven `Actions` tab containing:

- what went well
- detected problems
- prioritized recommendations
- concrete next steps

The report must remain a self-contained static HTML artifact and must not require a server, internet connection, React hydration, or new runtime dependency.

## Root Cause

`ReportTemplate` currently stores the selected tab in React state and renders only the selected panel. The report generator calls `renderToString`, which produces non-interactive static HTML:

- React event handlers such as `onClick` are not serialized into HTML.
- The initial `overview` state causes only the Overview panel to be included.
- Trade, Signals, Feed, and Fixes buttons are present but have no browser behavior.
- Their corresponding panel markup is absent from the generated artifact.

The inspected report confirmed this failure mode: it contained five buttons, no serialized click handler, and no Trade, Signals, Feed, or Fixes panel content.

## Chosen Approach

Render every report panel on the server and add a small, dependency-free browser controller that toggles panel visibility and tab state.

This is preferred over React hydration because it preserves the existing static-artifact workflow and avoids a client bundle. It is preferred over anchor-only navigation because it retains the requested tab interaction.

## Architecture

### Server-rendered tab structure

`ReportTemplate` will render all five panels on every report generation:

1. Overview
2. Trade
3. Signals
4. Feed
5. Actions

Each tab control will have:

- a stable tab identifier
- `role="tab"`
- `aria-controls` pointing to its panel
- `aria-selected` reflecting current selection
- a `data-report-tab` attribute used by the browser controller

Each panel will have:

- a stable panel identifier
- `role="tabpanel"`
- `aria-labelledby` pointing to its tab
- a `data-report-panel` attribute
- a server-rendered active/inactive marker

Overview is the initial active panel.

### Progressive enhancement

The report will remain readable when JavaScript is unavailable:

- all panels are server-rendered
- without JavaScript, panels appear sequentially
- when JavaScript is available, an early document marker enables tab styling and hides inactive panels
- the inline controller switches panel visibility, selected styling, and ARIA state

The controller will be embedded in the generated HTML. It will not import libraries or fetch external assets.

### Tab interaction

The controller will:

- activate the clicked tab
- deactivate all sibling tabs
- show the matching panel
- hide other panels
- update `aria-selected`
- preserve keyboard focus on the selected control
- support the report's initial Overview state

Hash synchronization is excluded from the first implementation.

### Component boundaries

- `src/report/actions.ts` owns the Actions types and deterministic `SessionReport` analysis.
- `src/report/template.tsx` renders every panel and the Actions presentation.
- `src/report/renderer.tsx` owns the self-contained HTML shell, progressive-enhancement CSS, and inline tab controller.
- focused report tests verify the Actions rules and static tab contract.

The parser and report types will change only if a field required by an approved Actions rule is not already exposed. Existing uncommitted shadow-settlement fields and parsing behavior must be preserved.

## Actions Model

Recommendation logic will be separated from React layout in a pure report-analysis module. The module accepts a `SessionReport` and returns a structured Actions model.

The model will contain:

```text
whatWentWell[]
problems[]
recommendations[]
nextSteps[]
```

Every actionable item will contain:

- stable identifier
- title
- severity or priority
- evidence derived from the report
- explanation of impact
- recommended action
- verification condition

An item may additionally contain an existing project command when that command directly verifies the recommendation.

The generator must be deterministic and based only on available telemetry. It must not make network calls or use generative AI.

## Actions Content

### What went well

Positive statements appear only when supported by evidence. Candidate rules include:

- executed buys and sells are fully matched
- no explicit exit failures are present
- net PnL is positive
- signal module telemetry is present
- required trade fields are complete
- average fallback recovery passes the existing report gate or diagnostic rule

No empty collection may create a vacuous positive statement.

### Problems requiring attention

Problems come from report anomalies, failed gate checks, and directly observable data-quality conditions. Candidate rules include:

- unmatched or unresolved trade lifecycle
- missing trade fields
- unresolved shadow outcomes
- zero or insufficient trade samples
- excessive feed fallbacks
- weak feed-window status
- absent signal module data
- negative or statistically insufficient strategy evidence

### Recommendations

Recommendations will be ordered by severity:

1. Critical
2. High
3. Medium
4. Informational

Every recommendation must cite the report evidence that triggered it. Generic advice that would appear for every session is out of scope.

### Next steps

Next steps turn recommendations into verifiable actions. When an existing command can validate an action, the command is included. Examples include regenerating a full report, rerunning signal validation, or collecting another PAPER session.

A next step must state what result would close it. It must not instruct the user to enable LIVE trading.

## Empty and Partial Data Behavior

- No trades: show an explicit insufficient-sample state.
- No anomalies: state that no configured anomaly fired; do not claim the session is fully healthy.
- Missing signal telemetry: show the missing evidence and the relevant verification step.
- Unresolved outcome data: identify the unresolved count and block outcome-quality claims.
- Missing optional fields: render `N/A` without throwing.
- Empty Actions model: render an explanatory fallback rather than a blank tab.

## Scope Boundaries

Included:

- functional static tabs
- rename `Fixes` to `Actions`
- telemetry-driven What Went Well, problems, recommendations, and next steps
- accessibility state for tabs and panels
- regression tests and real-report verification
- preservation of current shadow-settlement report changes

Excluded:

- React client hydration
- a new frontend build pipeline
- replacement-checker implementation
- LIVE authorization logic
- ML model selection or training
- unrelated report redesign
- telemetry-file size optimization unless required to make the tab fix correct

## Testing Strategy

### Regression test first

Add a failing report-rendering test that proves the generated HTML includes:

- all five tab controls
- all five panel identifiers
- representative content from Trade, Signals, Feed, and Actions
- the inline tab-controller contract

The test must fail against the current conditional-rendering implementation.

### Actions unit tests

Test the pure Actions generator with fixtures for:

- healthy evidence with legitimate What Went Well items
- feed failures producing prioritized problems and next steps
- unresolved shadow outcomes blocking positive outcome claims
- zero trades producing insufficient-sample guidance
- missing telemetry producing explicit evidence gaps

### Verification

1. Run the focused report tests.
2. Run the TypeScript build.
3. Generate a report from a real session file.
4. Open the generated artifact and exercise every tab.
5. Confirm selected styling and ARIA state change correctly.
6. Confirm the report remains readable with JavaScript disabled.
7. Confirm existing shadow-settlement content is unchanged.

## Success Criteria

- Overview, Trade, Signals, Feed, and Actions all open from the static report.
- The generated HTML contains all panel content before browser interaction.
- The report remains useful without JavaScript.
- Actions contains evidence-backed What Went Well, problems, recommendations, and next steps.
- Empty or incomplete evidence cannot generate a vacuous success claim.
- No external runtime dependency or client bundle is introduced.
- Existing report behavior outside this scope remains intact.
