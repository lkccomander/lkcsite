# PATBv5 Shared Execution-Pricing Design

Date: 2026-07-10
Status: Proposed for implementation

## Purpose

Create one typed, pure source of truth for order pricing and fee arithmetic currently duplicated between `src/trade/decision.ts` and `src/trade/trade.ts`. Strategy estimation and actual paper/live execution must use the same formulas without changing any existing price, fee, rebate, edge, rounding, telemetry, or order behavior.

## Current Behavior

The two files independently define these identical formulas:

- price clamping to `0.01..0.99` with two-decimal rounding;
- effective taker fee rate: `0.072 * (1 - price)`;
- passive maker buy price;
- mid-market price;
- maker rebate arithmetic, with different final precision.

Execution additionally defines protocol fee factor, rounded taker fee USD, and passive maker sell price. Decision additionally defines fee-adjusted round-trip edge. These functions belong in the same pure pricing model because they build on the shared constants and fee semantics, even though they are not currently duplicated.

One difference is intentional and must remain:

- decision telemetry rounds maker rebates and displayed fee estimates to four decimals;
- execution accounting rounds fee and rebate USD values to five decimals.

The execution-side `makerRebateUsd(price, notionalUsd)` signature receives `price` but does not use it. Removing that argument from every call site would create unnecessary churn in a large dirty file.

## Approaches Considered

### A. Pure shared arithmetic with compatibility adapters (selected)

Extract the arithmetic into a dependency-free module. Pass rebate basis points and decimal precision explicitly. Keep small local adapters in decision and execution code to read configuration and preserve their current function signatures and rounding precision.

This centralizes formulas while minimizing changes to dirty runtime files.

### B. Make execution behavior canonical everywhere

Move execution helpers into a shared file and make decision estimation use execution's five-decimal rounding.

This is simpler, but it changes decision telemetry and can change threshold behavior near configured edge boundaries.

### C. Extract only price selection

Share clamping and maker/mid prices but leave fee and rebate arithmetic duplicated.

This has the smallest diff, but it leaves the highest-value drift risk unresolved: strategy acceptance and execution accounting could still disagree about costs.

## Selected Module

Add `PATBv5/src/trade/policy/executionPricing.ts` with pure exports conceptually equivalent to:

```ts
export function clampPrice(value: number): number;
export function takerFeeRate(price: number): number;
export function protocolFeeFactor(price: number): number;
export function takerFeeUsd(price: number, notionalUsd: number, decimalPlaces: number): number;
export function makerRebateUsd(notionalUsd: number, rebateBps: number, decimalPlaces: number): number;
export function passiveMakerBuyPrice(askPrice: number, bidPrice: number): number;
export function passiveMakerSellPrice(bidPrice: number, askPrice: number): number;
export function midMarketPrice(askPrice: number, bidPrice: number): number | null;
export function feeAdjustedEdgeUsd(entryPrice: number, exitPrice: number): number;
```

The constants `0.072` and `0.01` remain internal to the module. A private decimal-rounding helper reproduces the current `Math.round(value * factor) / factor` behavior.

The module must not import configuration, telemetry, `Trade`, or any runtime service.

## Decision Integration

First integrate `decision.ts` independently:

- import shared clamping, fee rate, maker buy price, mid price, and edge functions;
- remove their local duplicate implementations;
- retain the existing local `roundMetric` because it serves unrelated diagnostics;
- retain a small local rebate adapter that reads `maker_rebate_bps` and calls the shared rebate function with four decimal places;
- keep all current call sites, rejection thresholds, and final `roundMetric` calls unchanged.

Run the new pricing test, the complete suite, and the PATBv5 build before touching `trade.ts`.

## Execution Integration

Then integrate `trade.ts`:

- import shared clamping, fee rate, protocol factor, taker fee, maker buy/sell price, and mid-price functions;
- remove their local duplicate implementations and constants;
- retain `roundCurrency` and `roundFeeUsd` because they have broader non-pricing consumers;
- retain a two-argument local rebate adapter for call-site compatibility; name the unused price parameter `_price`, read current rebate basis points, and delegate to the shared rebate function with five decimal places;
- leave every buy, sell, retry, reconciliation, and telemetry call site otherwise unchanged.

`trade.ts` already contains extensive uncommitted user work. Patches must be limited to imports and the top helper block. No formatting or unrelated refactoring is allowed.

## Tests

Add `PATBv5/tests/execution_pricing.test.ts` with table-driven coverage for:

- invalid, zero, boundary, and representative prices for taker rate and protocol factor;
- exact values at prices `0.01`, `0.50`, and `0.99`;
- taker fee calculation for valid and invalid notionals;
- maker rebate calculation for invalid basis points and notionals;
- explicit proof that four-decimal and five-decimal rebate results remain different where the raw value crosses their rounding boundaries;
- clamping below `0.01`, above `0.99`, non-finite values, and ordinary two-decimal rounding;
- maker buy and sell behavior for valid spreads, crossed books, missing sides, and one-tick spreads;
- valid and invalid mid-market prices;
- fee-adjusted edge for valid prices and `Number.NEGATIVE_INFINITY` for invalid inputs.

Add `test:execution-pricing` to the unified deterministic suite. The test imports only the pure module and uses no configuration, telemetry, files, network, or runtime entry point.

## Compatibility Rules

- Preserve the exact current formulas; do not replace them with external documentation or alternate fee models.
- Preserve strict invalid-price checks: non-finite, `<= 0`, and `>= 1` return zero for fee functions.
- Preserve two-decimal price clamping.
- Preserve four-decimal decision rounding and five-decimal execution rounding.
- Preserve `Number.NEGATIVE_INFINITY` for non-finite, zero, or negative edge-price inputs; retain the current edge behavior for prices greater than or equal to one.
- Preserve every existing telemetry field and call-site argument.
- Do not change strategy configuration, paper/live branches, order types, sizes, or retry behavior.

## Verification

Implementation is complete when:

1. The new pricing test passes before runtime integration.
2. Decision integration passes the complete suite and PATBv5 build.
3. Execution integration passes the complete suite again.
4. PATBv5, Evaluator, and GUI builds all pass.
5. Final diff review confirms only the shared module, its test, package scripts, imports, duplicate helper removal, and compatibility adapters changed.
6. Existing uncommitted work remains unstaged and otherwise untouched.

## Deferred Work

This milestone does not extract general currency/metric formatting, feed gates, spread policy, position state, entry lifecycle, exit lifecycle, or reconciliation. Those remain separate changes with separate verification boundaries.
