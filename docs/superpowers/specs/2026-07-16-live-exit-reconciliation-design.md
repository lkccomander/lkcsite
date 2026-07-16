# Live Exit Reconciliation Design

## Context

The LIVE session `c2a04a71-f38a-46cb-b67a-72c9811d6563` bought 6 DOWN shares at $0.75 in market `btc-updown-5m-1784226900`. Polymarket activity shows the shares sold at an average $0.894 for approximately $5.36, increasing collateral from $711.809233 to $712.671433 (+$0.8622).

The telemetry contains `trade.exit_attempt` but no `trade.exit_filled` or `live_trade.sell`. The bot later observed no remaining token balance and continued with `holdingStatus=None`. Therefore the financial execution succeeded while the submit response or immediate confirmation path remained ambiguous.

## Goals

1. Recover the authoritative outcome of an ambiguous LIVE exit submission.
2. Emit the actual fill price and realized PnL when Polymarket confirms the trade.
3. Register a still-open exit order instead of submitting a duplicate.
4. Block new entries when neither a fill nor an open order can be confirmed.
5. Preserve existing matched and pending-order behavior.

## Non-goals

- Do not infer a fill solely from a zero token balance.
- Do not use the submitted limit price as the actual average fill price when trade history is available.
- Do not automatically resubmit an uncertain exit.
- Do not change strategy entry or exit thresholds.
- Do not backfill historical telemetry in this change.

## Design

### Submit timeout and uncertainty boundary

Wrap each LIVE exit submit attempt in a bounded timeout. A normal returned response follows the existing matched/live handling. A timeout, connection interruption, or other ambiguous transport failure enters reconciliation before any retry.

Deterministic API rejections such as authentication errors may continue to fail immediately. Once a submit could have reached Polymarket, the bot must not retry blindly because that could create duplicate SELL orders.

### Reconciliation sources

The reconciliation routine receives side, token ID, requested size, submitted limit price, submit timestamp, exit reason, and error context.

It queries:

1. `getOpenOrders({ asset_id: tokenId }, true)` for an active SELL order created at or after the submit boundary.
2. `getTrades({ asset_id: tokenId, after: submitTimestamp })` for matching SELL fills.

Trade matches must belong to the requested asset and SELL side, fall within the reconciliation window, and not exceed the requested quantity beyond rounding tolerance. Multiple fills are aggregated using size-weighted average price. Trade IDs or transaction hashes are recorded for auditability.

### Reconciliation outcomes

#### Filled

When matching trades cover the requested size, the bot:

- updates balances;
- closes the position;
- emits `live_trade.sell` using weighted average fill price and actual filled size;
- emits `trade.exit_filled` with reconciliation source, trade IDs, transaction hashes, and average price;
- clears the pending exit intent;
- returns success.

#### Pending

When a matching open SELL order exists, the bot registers it with the existing `openExitOrders` lifecycle, sets `EXIT_PENDING` or `EXIT_PARTIAL`, emits `trade.exit_pending`, and returns without resubmission.

#### Uncertain

When neither source confirms an outcome, the bot:

- sets `positionState=ERROR`;
- stores a pending exit reconciliation record;
- emits `trade.exit_submission_uncertain` with request and error context;
- blocks new entries through the existing execution-safety gate until a later reconciliation resolves it.

The bot may poll the same reconciliation record on normal lifecycle ticks. It must never interpret zero balance alone as proof of a specific fill price.

## Data model

Add a `PendingExitReconciliation` record containing:

- market slug, side, token ID, requested size, limit price;
- submitted-at timestamp and optional known order ID;
- exit reason and error context;
- last provider status and last checked timestamp;
- original submit error message.

The record is runtime state and is included in diagnostic telemetry. It does not contain credentials.

## Error handling

- Query failures keep the state uncertain and remain visible in telemetry.
- Partial fills use the existing `EXIT_PARTIAL` order lifecycle when an open remainder exists.
- Duplicate trade history rows are deduplicated by trade ID, then transaction hash plus size/price/time fallback identity.
- Reconciliation queries have their own timeout so the trading loop cannot hang indefinitely.

## Testing

Extend the lifecycle harness with deterministic cases:

1. Submit returns `matched`: existing close behavior and telemetry remain intact.
2. Submit times out, `getTrades` reports a complete fill at a better price: actual average price and PnL are emitted exactly once.
3. Submit times out, `getOpenOrders` reports a live order: position becomes `EXIT_PENDING` and no retry occurs.
4. Submit times out, neither query confirms an outcome: position becomes `ERROR`, uncertainty telemetry is emitted, and new entries are blocked.
5. Multiple trade fills aggregate to the correct size-weighted price.
6. Repeated reconciliation does not emit duplicate `live_trade.sell` events.

Run lifecycle, execution-pricing, build, and complete test coverage.

## Acceptance criteria

- An ambiguous submit cannot trigger an immediate duplicate SELL.
- Confirmed fills emit `live_trade.sell` and `trade.exit_filled` with provider-derived average price.
- A confirmed open order enters the existing pending lifecycle.
- An unconfirmed exit blocks new entries and emits `trade.exit_submission_uncertain`.
- Existing matched/live exit tests continue to pass.
- All focused tests, TypeScript build, and the complete suite pass.
