# PATBv5 Shadow Settlement and Metadata Reliability Design

Date: 2026-07-11

## Problem

The July 10-11 PAPER session observed 102 BTC five-minute markets and emitted 77,090 `trade.shadow_pnl` events. Of those, 35,361 used closing prices where both UP and DOWN were near zero. The current implementation emits shadow P&L at the market boundary from the last order-book sell prices, so it can assign an impossible binary outcome before the market has resolved.

The same session emitted 1,011 `polymarket_page_metadata_refresh` failures. The failure is reproducible as Node/Undici `UND_ERR_HEADERS_OVERFLOW`. A native Node HTTPS request configured with a 64 KiB header limit succeeds against the same public page.

This change applies to future sessions only. It does not rewrite historical JSONL files.

## Goals

- Calculate shadow P&L only from an authoritative, internally consistent binary outcome.
- Continue processing the next market while the previous market resolution is pending.
- Emit explicit unresolved settlement telemetry instead of fabricated P&L.
- Eliminate the reproduced page-fetch header overflow.
- Preserve structured network failure details in telemetry.
- Leave entry strategy gates and trading behavior unchanged.

## Design

### 1. Pure settlement policy

Add a focused settlement-policy module under `src/trade/policy/`. It will:

- Parse Gamma `outcomes` and `outcomePrices`, which may be JSON-encoded strings or arrays.
- Match outcome labels case-insensitively to UP and DOWN.
- Accept a result only when the market is closed/resolved and prices are terminal and complementary: one outcome at least 0.95 and the other at most 0.05.
- Return a typed result containing status, winner, source, terminal prices, and diagnostic reason.
- Return `unresolved` for missing, ambiguous, non-terminal, or malformed data.
- Convert a resolved winner into binary shadow exit prices of 1 for the winner and 0 for the loser.

This pure boundary keeps API parsing and P&L calculation testable without network access.

### 2. Gamma resolution polling

Extend the Gamma service with a market-by-slug resolution lookup that reuses the existing public Gamma endpoint. At market close, detach a bounded resolution task for that market:

- Poll every 5 seconds for up to 45 seconds.
- Stop immediately after a valid terminal outcome is returned.
- Do not block selection or processing of the next five-minute market.
- Catch all task failures so a background rejection cannot terminate the bot.
- On timeout or repeated failure, emit unresolved shadow telemetry with the last diagnostic reason.

Each closing trade object remains dedicated to its completed market, so its captured shadow signals can be emitted safely after the next active trade is created.

### 3. Shadow telemetry emission

Change `emitShadowPnlTelemetry` to accept a settlement result instead of reading current book prices as settlement. For each shadow signal:

- Resolved: use the winner's binary exit price and compute fee-adjusted hypothetical P&L.
- Unresolved: set `finalExitPrice` and `hypotheticalPnlUsd` to `null`.
- Always include `settlementStatus`, `settlementSource`, `settlementReason`, `winningOutcome`, and terminal UP/DOWN prices.
- Clear the captured signals exactly once after emission.

The existing report parser already excludes null P&L from totals. Tests will lock in that unresolved records cannot become synthetic losses.

### 4. Reliable page metadata request

Replace the page request inside `getMarketPageMetadata` with a small native HTTPS text-request helper configured with:

- 64 KiB `maxHeaderSize`.
- A finite request timeout.
- A stable user agent and HTML accept header.
- Response-size protection and non-2xx status errors.
- Structured errors retaining name, code, cause code, status, URL, and message.

The existing 30-second refresh backoff remains. The refresh telemetry will include the structured diagnostic fields so future failures are actionable.

### 5. Error handling

- Page metadata remains optional; its failure must not stop trading or the WebSocket feed.
- Gamma resolution failures affect only shadow analytics.
- Unresolved outcomes are honest missing data, not losses and not wins.
- No external reference price will be treated as an authoritative resolved outcome.

## Tests

Add regression tests before implementation for:

- Resolved UP and resolved DOWN Gamma payloads.
- String-encoded and array-encoded outcomes/prices.
- Both outcomes low, both high, non-terminal, malformed, or mismatched arrays.
- Unresolved settlement producing null exit price and null P&L.
- Resolved settlement producing complementary 1/0 exit prices.
- Structured preservation of header-overflow and HTTP error details.
- Polling success, timeout, and retry behavior using injected fakes and zero-delay test timing.

Then run the targeted tests, TypeScript build, and the existing full test suite. Finally, perform a read-only public endpoint probe confirming the native HTTPS request no longer raises `UND_ERR_HEADERS_OVERFLOW`.

## Success Criteria

- Future `trade.shadow_pnl` events never report both final outcome prices near zero as a resolved result.
- Every non-null hypothetical P&L has `settlementStatus=resolved` and an authoritative Gamma-derived winner.
- Unresolved outcomes have null P&L and a diagnostic reason.
- The exact Polymarket page that reproduced the error succeeds through the new request helper.
- Network telemetry contains machine-readable error codes when failures occur.
- The bot advances to the next market without waiting for settlement polling.
- Build and tests pass without changing strategy configuration or entry gates.

## Files in Scope

- `PATBv5/src/services/gamma.ts`
- `PATBv5/src/index.ts`
- `PATBv5/src/trade/decision.ts`
- A new settlement policy module under `PATBv5/src/trade/policy/`
- Focused new tests under `PATBv5/tests/`
- `PATBv5/package.json` only if a targeted test script is added

Edits to currently modified files will be minimal and preserve all unrelated working-tree changes.
