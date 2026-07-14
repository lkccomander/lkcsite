# PATBv5 Report Accuracy Fixes Design

Date: 2026-07-14

## Status

Approved for implementation.

## Objective

Make generated PATBv5 session reports accurate enough to support operational review before any strategy recommendation is acted on.

This change fixes four confirmed defects:

1. Reports silently analyze only the last 50,000 events while presenting results as session-level evidence.
2. Momentum telemetry is parsed from field names that do not match emitted `signal.momentum` payloads.
3. Fully unresolved shadow outcomes render as favorable green zeroes instead of unavailable evidence.
4. Generated report commands use `--telemetry-file`, while the report CLI accepts `--file`.

## Evidence and Root Causes

### Tail scope

The reviewed report analyzed 50,000 events and showed four completed trades with net PnL of $0.59. The complete telemetry file contained eleven completed trades with net PnL of $3.72.

The report CLI initializes `tail` to 50,000 and passes it to `parseTelemetry`, which calls `readLastLines`. The report header mentions the event count, but session-level metrics, gates, and Actions do not identify themselves as tail-only.

### Momentum parsing

Emitted `signal.momentum` payloads use:

- `direction`
- `score`
- `confidence`

The parser reads:

- `momentumDirection`
- `momentumScore`
- `momentumConfidence`

As a result, the reviewed report displayed 233 momentum events as entirely `NEUTRAL`, with zero score and confidence, despite non-zero source values.

### Unresolved shadow presentation

When no shadow outcome is resolved, derived numeric fields remain zero. The Signals panel styles a zero would-win rate and zero hypothetical PnL as green. Those zeroes represent missing authoritative outcomes, not favorable evidence.

### Report command flag

The shared Actions command helper always emits `--telemetry-file`. That flag is valid for analysis and validation scripts but not for the report CLI, which accepts `--file`.

## Chosen Approach

### Full-session reports by default

The report CLI will analyze complete input files unless the user explicitly passes `--tail N`.

- `tail` becomes optional rather than defaulting to 50,000.
- `parseTelemetry` accepts an optional tail limit.
- Without a tail limit, the parser reads the complete JSONL stream.
- With `--tail N`, existing tail-slice behavior remains available.
- The report model records whether the result is full-session or tail-scoped so the header and guidance can identify explicit slices.

Full-session parsing must be streaming or line-oriented. It must not require loading the entire telemetry file into one in-memory string.

### Momentum field compatibility

For `signal.momentum`, the parser will prefer current emitter fields and retain legacy aliases:

```text
direction          -> fallback momentumDirection
score              -> fallback momentumScore
confidence         -> fallback momentumConfidence
```

Numeric parsing will use nullish checks rather than truthiness so legitimate zero values remain valid.

The Actions success rule for signal telemetry will require usable momentum evidence, not only a non-zero event count. A momentum stream whose events all fell back because expected fields were absent must be reported as incomplete evidence.

### Shadow outcome availability state

The Signals panel will distinguish three states:

1. No shadow events.
2. Shadow events exist but none are resolved.
3. Some or all shadow events are resolved.

When none are resolved:

- would-win rate renders as `N/A`
- total hypothetical PnL renders as `N/A`
- styling is critical or neutral, never green
- explanatory text states that authoritative settlement is required

When at least one event is resolved, numeric metrics may render, accompanied by resolved and unresolved coverage.

### Command generation by script contract

The command helper will select the correct flag:

- `report` uses `--file`
- `validate:signals`, `analyze:trades`, and other telemetry scripts use `--telemetry-file`

Commands remain deterministic and derived from the first analyzed telemetry file.

## Component Changes

### `src/report/index.ts`

- Make `--tail` optional.
- Pass an undefined limit for full-session parsing.
- Preserve explicit `--tail N` behavior.

### `src/report/parser.ts`

- Add complete-file line-oriented reading.
- Preserve bounded tail reading for explicit limits.
- Parse current and legacy momentum field names.
- Track enough scope and momentum-field coverage metadata for accurate presentation and Actions.

### `src/report/types.ts`

- Add minimal report-scope metadata.
- Add momentum evidence-coverage metadata if required by the parser and Actions rules.

### `src/report/template.tsx`

- Label explicit tail slices.
- Render unresolved shadow metrics as unavailable.
- Prevent favorable styling when no authoritative outcome exists.

### `src/report/actions.ts`

- Generate the report CLI command with `--file`.
- Avoid declaring signal telemetry healthy when required momentum fields were not parsed.

## Error Handling

- Malformed JSON lines continue to be skipped without aborting a report.
- Missing files retain the existing error path.
- Invalid or non-positive `--tail` values fail with a clear CLI error rather than silently selecting unexpected scope.
- Missing momentum fields increment evidence-gap metadata and do not create fabricated zero-value observations.
- A full-session report with no events produces the existing empty-data behavior.

## Testing Strategy

Regression tests will be added before implementation for:

1. Full-session default reads events that would be excluded by a small tail.
2. Explicit tail mode still reads only the requested final events.
3. Current momentum payload fields populate direction, score range, and confidence average.
4. Legacy momentum field aliases remain supported.
5. Missing momentum fields do not generate a healthy telemetry claim.
6. Fully unresolved shadow outcomes render `N/A` and do not use favorable styling.
7. Partially resolved shadow outcomes retain numeric values and coverage text.
8. Report Actions commands use `--file`; analysis commands use `--telemetry-file`.

Existing report tabs, Actions, shadow-PnL, build, and full-suite tests must continue to pass.

## Artifact Verification

After automated tests:

1. Regenerate a report from the reviewed telemetry session without `--tail`.
2. Confirm the report includes all eleven completed trades and full-session net PnL of $3.72.
3. Confirm momentum values match the emitted telemetry fields.
4. Confirm unresolved shadow metrics display as unavailable and non-green.
5. Confirm generated commands contain valid flags.
6. Confirm all five static tabs and the inline controller remain present.

## Scope Boundaries

Included:

- full-session default scope
- explicit tail opt-in
- momentum parsing compatibility
- shadow availability presentation
- generated command correctness
- regression coverage and artifact verification

Excluded:

- strategy threshold changes
- feed fallback remediation
- shadow settlement implementation changes
- report redesign beyond accuracy-related labels and states
- unrelated telemetry or trading-engine changes

## Success Criteria

- Default reports describe the complete supplied session files.
- Explicit tail reports are clearly identified as slices.
- Momentum metrics reflect current emitted payload fields.
- Missing or unresolved evidence cannot appear as favorable zeroes.
- Every generated command uses the target script's supported CLI option.
- The reviewed session regenerates with eleven completed trades and $3.72 net PnL.
- Focused tests, TypeScript build, and full PATBv5 tests pass.
