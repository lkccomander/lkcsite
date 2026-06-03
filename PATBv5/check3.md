## Project

Polymarket CLOB bot v3.

## Status Update - 2026-05-05

This spec is now implemented in code.

Completed today:
- explicit `positionState` machine added with `NONE`, `OPEN`, `EXIT_PENDING`, `EXIT_PARTIAL`, `CLOSED`, `ERROR`
- in-memory `openExitOrders` registry added per `marketSlug/tokenId/side`
- `SELL status=live` is now treated as accepted, not immediate failure
- duplicate SELL protection added for normal exits, stop loss, take profit, and forced exits
- `getExitOrderStatus(orderId)` and `reconcileOpenExitOrders()` implemented using the Polymarket SDK
- reserved-balance interpretation added for `not enough balance / allowance` after a live exit
- exit telemetry added:
  - `trade.exit_attempt`
  - `trade.exit_pending`
  - `trade.exit_partial`
  - `trade.exit_filled`
  - `trade.exit_failed`
  - `trade.exit_skipped_existing_live_order`
  - `trade.exit_balance_reserved_by_live_order`
- spread semantics normalized to:
  - `buyPrice = bestAsk`
  - `sellPrice = bestBid`
  - `spread = bestAsk - bestBid`
- negative-spread snapshots now emit `market.snapshot_rejected`
- forced-exit cancel/reprice flow added with config:
  - `exit_reprice_enabled`
  - `exit_reprice_after_ms`
  - `exit_reprice_max_attempts`
- BUY guard during pending exit is active and now rejects with:
  - `trade.signal_rejected`
  - `reason = "exit_pending"`
- regression harness added in `scripts/check3_lifecycle_harness.ts`
  - `npm test` passes
  - `npm run build` passes
- follow-up `review4` fixes applied:
  - `inExitRange` removed from normal exit trigger
  - spread rejection moved to preferred-side-only entry validation
  - `trade.toml` schema compatibility restored with defaults/optional fields
  - raw balance API object logs removed from live balance polling
  - config parse, build, and lifecycle harness all pass

Implementation note:
- validation was added as a repo-local lifecycle harness rather than a full external test framework.

## Problem observed

A SELL order can return `status = "live"`. When this happens, Polymarket reserves/locks the token balance for that live order. The bot currently treats this too close to a failed sell and can submit another SELL too quickly. The retry then fails with:

`not enough balance / allowance: the balance is not enough -> balance: 0, order amount: ...`

That is not necessarily a real missing-balance condition. It often means the available balance is zero because the previous live SELL order already reserved the tokens.

Relevant files:
- `src/trade/trade.ts`
- `src/trade/decision.ts`
- `src/utils/retry.ts`
- any CLOB/order helper files used by `buyUpToken`, `buyDownToken`, `sellUpToken`, `sellDownToken`

## Goal

Fix the SELL lifecycle so the bot handles:
- `live`
- `matched`
- `partial`
- `failed`
- `canceled`
- `expired`

correctly, without duplicate exits or false balance failures.

---

## 1. Add explicit position and exit-order state

Implement a clear position state machine.

### Position states

- `NONE`
- `OPEN`
- `EXIT_PENDING`
- `EXIT_PARTIAL`
- `CLOSED`
- `ERROR`

### Rules

- After a successful BUY fill:
  - state = `OPEN`

- After a SELL response with `status = "matched"` and no remaining position:
  - state = `CLOSED`

- After a SELL response with `status = "live"`:
  - state = `EXIT_PENDING`
  - store:
    - `orderId`
    - `tokenId`
    - `marketSlug`
    - `side`
    - `price`
    - `requestedSize`
    - `remainingSize`
    - `timestamp`

- After reconciliation shows partial fill with remaining quantity still live:
  - state = `EXIT_PARTIAL`
  - update:
    - `filledSize`
    - `remainingSize`

- While state is `EXIT_PENDING` or `EXIT_PARTIAL`:
  - do not submit another SELL for the same token / market / side
  - do not submit an opposite-side BUY
  - do not retry SELL immediately
  - monitor order status instead

- If live SELL later fully fills:
  - state = `CLOSED`

- If live SELL is canceled / expired / rejected and position still exists:
  - state returns to `OPEN`
  - strategy may decide whether to submit a new exit order

---

## 2. Fix SELL retry behavior

Current bad behavior:

`SELL live order -> bot thinks sell failed -> retries instantly -> balance error`

### New behavior

If post-order response has:
- `success === true`
- `status === "live"`
- `orderId` present

Then:
- treat it as **accepted**, not failed
- do **not** retry immediately
- mark state `EXIT_PENDING`
- emit telemetry:
  - `trade.exit_pending`

Only retry if:
- request failed **before** order was accepted
- status is explicitly `rejected` / `failed`
- no `orderId` exists
- network error occurred and there is no order confirmation

Do **not** retry if `orderId` exists and status is `live`.

---

## 3. Add open exit-order registry

Create an in-memory registry:

```text
openExitOrders[marketSlug/tokenId/side] = {
  orderId,
  tokenId,
  marketSlug,
  side,
  price,
  requestedSize,
  filledSize,
  remainingSize,
  status,
  createdAt,
  lastCheckedAt
}
```

Before submitting a new SELL:
- check if an open exit order already exists
- if yes, skip new SELL and emit:
  - `trade.exit_skipped_existing_live_order`

This must apply to:
- normal exits
- stop loss exits
- take profit exits
- forced exits near close

---

## 4. Add order reconciliation with explicit contract

Add a function:

`reconcileOpenExitOrders()`

It should:
- periodically check live order status from CLOB
- detect:
  - `matched`
  - `live`
  - `partial`
  - `canceled`
  - `expired`
  - `rejected`
- update position state
- update balances after status changes
- remove closed/canceled/expired orders from registry

### Important implementation requirement

Do **not** implement this section with vague fallback logic.

Before coding the state machine, define the exact source of truth for remote order status:
- preferred: SDK method that returns open order / order status by `orderId`
- fallback: direct CLOB open-order / order-status endpoint wrapper

The implementation must expose a single internal interface like:

```ts
getExitOrderStatus(orderId): Promise<{
  status: "live" | "matched" | "partial" | "canceled" | "expired" | "rejected" | "unknown";
  filledSize?: number;
  remainingSize?: number;
  avgPrice?: number;
}>
```

If the SDK does not expose enough information, add a wrapper with a clear TODO and consistent return shape. Do not bury this ambiguity inside sell logic.

---

## 5. Fix balance interpretation

When sell fails with:

`not enough balance / allowance`

Before treating it as fatal:
- check whether a matching live exit order already exists for the same token / market / side
- if yes:
  - treat balance as reserved by live order
  - mark state `EXIT_PENDING` or `EXIT_PARTIAL`
  - do not retry
  - emit telemetry:
    - `trade.exit_balance_reserved_by_live_order`

---

## 6. Improve telemetry

Add events:

### `trade.exit_attempt`
Fields:
- `side`
- `tokenId`
- `marketSlug`
- `price`
- `size`
- `availableBalance`
- `rawBalance`
- `positionState`

### `trade.exit_pending`
Fields:
- `orderId`
- `side`
- `tokenId`
- `marketSlug`
- `price`
- `requestedSize`
- `remainingSize`

### `trade.exit_partial`
Fields:
- `orderId`
- `side`
- `tokenId`
- `marketSlug`
- `filledSize`
- `remainingSize`
- `avgPrice`

### `trade.exit_filled`
Fields:
- `orderId`
- `side`
- `tokenId`
- `marketSlug`
- `filledSize`
- `avgPrice`
- `pnlEstimate`

### `trade.exit_failed`
Fields:
- `side`
- `tokenId`
- `marketSlug`
- `reason`
- `errorMessage`
- `positionState`

### `trade.exit_skipped_existing_live_order`
Fields:
- `existingOrderId`
- `side`
- `tokenId`
- `marketSlug`

### `trade.exit_balance_reserved_by_live_order`
Fields:
- `orderId`
- `side`
- `tokenId`
- `marketSlug`
- `attemptedSize`

---

## 7. Fix spread validation and snapshot sanity

Observed bad log example:

`down=0.99/0.01 spread=-0.98`

### Important correction

In the current codebase, negative spread may be caused by inconsistent spread formulas, not only by corrupt data.

The code must first normalize the meaning of:
- `buyPrice` = best ask
- `sellPrice` = best bid

Then spread must be defined consistently as:

`spread = bestAsk - bestBid`

### Required sanity checks

- `bestBid <= bestAsk`
- `spread = bestAsk - bestBid`
- if `spread < 0`:
  - reject snapshot
  - emit telemetry:
    - `market.snapshot_rejected`
    - `reason = "negative_spread"`

- if `spread > max_allowed_spread`:
  - reject trade / exit unless forced-exit mode is active

- never make trading decisions from snapshots with negative spread

### Scope note

Before implementing these checks, normalize spread calculation everywhere it appears:
- trading decisions
- telemetry
- console logging

Do not patch only one file and leave contradictory spread semantics elsewhere.

---

## 8. Forced exit logic

If `forced_exit_seconds_before_close` is triggered:
- submit one exit order
- if it returns `live`:
  - mark `EXIT_PENDING`
  - do not spam retries
- if it remains live too close to close:
  - optionally cancel and reprice lower if configured
  - but only after:
    - checking order status
    - canceling previous order first
    - receiving cancel confirmation

Add safe config support if missing:

```toml
exit_reprice_enabled = true
exit_reprice_after_ms = 1500
exit_reprice_max_attempts = 2
```

Behavior:
- cancel old live exit order
- wait for cancel confirmation
- only then submit new SELL
- never submit duplicate SELL while previous order is live

---

## 9. Safety guard before BUY

Before every BUY:
- if `positionState == EXIT_PENDING` or `positionState == EXIT_PARTIAL`
  - reject BUY
  - emit:
    - `trade.signal_rejected`
    - `reason = "exit_pending"`

This prevents buying the opposite side while old tokens are still locked in a live SELL order.

---

## 10. Tests / validation

Add or update tests if the project has a test framework.

### Required test cases

#### A. SELL returns matched
Expected:
- position `CLOSED`
- no retry

#### B. SELL returns live
Expected:
- position `EXIT_PENDING`
- open order stored
- no retry

#### C. SELL returns partial
Expected:
- position `EXIT_PARTIAL`
- registry updated with `filledSize` and `remainingSize`
- no duplicate SELL

#### D. SELL live then retry attempted
Expected:
- retry skipped
- telemetry `trade.exit_skipped_existing_live_order`

#### E. Balance error after live SELL
Expected:
- interpreted as reserved balance if matching live order exists
- no fatal crash

#### F. Negative spread snapshot
Input:
- `bid = 0.99`
- `ask = 0.01`
Expected:
- snapshot rejected
- no trade decision

#### G. EXIT_PENDING then opposite BUY signal
Expected:
- signal rejected with reason `exit_pending`

---

## 11. Keep strategy logic unchanged

Do not redesign `trade_4` strategy logic.
Do not change config thresholds unless required to support the new lifecycle fields.
Focus on execution correctness, order lifecycle correctness, and duplicate-exit prevention.

---

## Deliverables

- modified code
- concise summary of changes
- exact files changed
- explanation of how live SELL orders are now handled
- explanation of how duplicate SELL orders are prevented
