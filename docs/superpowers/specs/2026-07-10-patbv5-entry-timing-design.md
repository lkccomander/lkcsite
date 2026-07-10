# PATBv5 Entry-Timing Evaluator Design

Date: 2026-07-10
Status: Proposed for implementation

## Purpose

Extract the time-based entry calculations for `trade_4`, `trade_5x`, and `trade_5x_open_paper` into a small typed pure module. The extraction must preserve current trading decisions, rejection reasons, rejection priority, telemetry payloads, and configuration semantics exactly.

## Current Semantics

The current decision path computes elapsed market time as:

```text
(marketTime - remainingTime) / marketTime
```

It then applies three independent timing facts:

1. `elapsedTimeReached` is true only when the elapsed ratio is strictly greater than `entry_time_ratio`.
2. `pastLatestEntryCutoff` is true when seconds to close is less than or equal to `latest_entry_seconds_before_close`.
3. `withinSecondsToCloseWindow` is true when seconds to close is inclusively between `min_seconds_to_close` and `max_seconds_to_close`.

These checks are not adjacent in the decision function. Price, spread, and other gates occur between them. Their current locations determine which rejection reason is emitted first.

## Approaches Considered

### A. Return independent timing facts (selected)

Create one pure evaluator that returns the three booleans above. Compute the facts once, then use each fact at the same location where its corresponding inline expression is currently checked.

This removes calculation ambiguity while preserving the existing rejection ordering.

### B. Return one rejection reason

Have the evaluator return `entry_time_ratio`, `latest_entry_seconds_before_close`, `seconds_to_close_window`, or `null`.

This is compact, but calling it at one location would move checks across other gates and could change telemetry classification. Recreating the current interleaving inside the evaluator would couple it to unrelated decision logic.

### C. Test the prototype method without extraction

Construct a synthetic `Trade`, stub telemetry and signal dependencies, and exercise `make_trading_decision()` directly.

This avoids a production edit but creates a large brittle fixture around global configuration, prototype attachment, telemetry, momentum, Monte Carlo, and mutable state. It would not establish a reusable typed boundary.

## Selected Module

Add `PATBv5/src/trade/policy/entryTiming.ts` with this conceptual API:

```ts
export interface EntryTimingInput {
  marketTimeSeconds: number;
  secondsToClose: number;
  entryTimeRatio: number;
  minSecondsToClose: number;
  maxSecondsToClose: number;
  latestEntrySecondsBeforeClose: number;
}

export interface EntryTimingEvaluation {
  elapsedRatio: number;
  elapsedTimeReached: boolean;
  pastLatestEntryCutoff: boolean;
  withinSecondsToCloseWindow: boolean;
}

export function evaluateEntryTiming(input: EntryTimingInput): EntryTimingEvaluation;
```

The implementation uses the same JavaScript arithmetic and comparison operators as the current inline code. It will not clamp, round, normalize, or reject values. Configuration validation remains the responsibility of the existing Zod schema.

## Runtime Integration

`decision.ts` will import `evaluateEntryTiming` and call it once inside the existing `trade_4`/`trade_5x`/`trade_5x_open_paper` branch.

The integration will make only these substitutions:

- `remaining_time_ratio` becomes `timing.elapsedRatio` for this branch;
- `elapsedTimeReached` becomes `timing.elapsedTimeReached`;
- `secondsToClose <= latest_entry_seconds_before_close` becomes `timing.pastLatestEntryCutoff`;
- `inTimeWindow` becomes `timing.withinSecondsToCloseWindow`.

Each rejection block stays in its current position. Rejection strings and telemetry payload field names remain unchanged. Other strategies retain their existing calculations.

Because `decision.ts` already contains uncommitted user work, implementation must use a targeted patch around the import, the branch-local calculations, and the three condition references. No formatting or unrelated cleanup is allowed.

## Tests

Add `PATBv5/tests/entry_timing.test.ts` with table-driven assertions covering:

- elapsed ratio below, equal to, and above `entryTimeRatio`;
- latest-entry cutoff below, equal to, and above the configured boundary;
- seconds-to-close below minimum, equal to minimum, inside the window, equal to maximum, and above maximum;
- `Number.POSITIVE_INFINITY` as the maximum seconds-to-close value;
- representative five-minute market values, including `marketTimeSeconds = 300`, `entryTimeRatio = 0.08`, and `secondsToClose = 276`;
- returned elapsed ratio without rounding.

Add an explicit package script for the new test and include it in `test:all`. The test remains deterministic and does not import the runtime entry point, access telemetry storage, or use external services.

## Error Handling and Compatibility

- The evaluator is synchronous and cannot throw for ordinary numeric inputs.
- No new runtime validation is introduced in this milestone.
- Existing behavior for `NaN`, infinity, zero, or otherwise invalid runtime values follows native JavaScript comparisons, matching the inline expressions being replaced.
- No configuration keys or defaults change.
- No paper/live behavior branches change.

## Verification

Implementation is complete when:

1. The new table-driven test passes.
2. The complete deterministic `npm test` suite passes.
3. `npm run build` passes for PATBv5.
4. Evaluator and GUI builds still pass.
5. The production diff is limited to the new pure module and targeted substitutions in `decision.ts`.
6. Existing uncommitted work remains unstaged and otherwise untouched.

## Deferred Work

Fee, rebate, passive-price, feed-health, and spread calculations remain unchanged. They should receive separate specs and implementation milestones after this entry-timing extraction is verified.
