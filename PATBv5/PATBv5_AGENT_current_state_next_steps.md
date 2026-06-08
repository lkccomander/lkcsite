# PATBv5 Agent Task — Current State Check and Next Steps

## 1. Main Objective

The main objective has not changed:

```text
Build a profitable, measurable, and safe Polymarket BTC 5-minute bot before running more real money.
```

Do **not** optimize for trade frequency yet.

Current priority:

```text
1. Keep strategy frozen.
2. Fix feed/fallback reliability.
3. Keep running PAPER only.
4. Finish evaluator/versioning.
5. Do not return to LIVE until readiness passes cleanly.
```

---

## 2. Latest Batch Context

Latest batch:

```text
Batch started: 06/07/2026 00:13:47
Total sessions in batch: 34
Skipped sessions: 30
Evaluated sessions: 4
Passed script execution: 4
Failed script execution: 0
```

Important clarification:

```text
A script PASS only means the checker/analyzer/readiness scripts completed.
It does NOT mean the bot is ready for LIVE.
```

All 4 evaluated sessions ended with:

```text
LIVE readiness verdict: NOT READY
```

---

## 3. Sessions Evaluated

The 4 evaluated sessions were:

```text
c3db92a6-329f-4b87-8b70-ebde8e979945
69049ac5-4969-4c41-b903-88dbe0c9ea1e
285f315a-96d2-46f7-a6eb-67a7187dec34
cc898379-b715-4bb3-994d-e88a9f326c50
```

---

## 4. Aggregate Result

Across the 4 evaluated sessions:

```text
LIVE buys: 0
LIVE sells: 0

Paper buys: 12
Paper sells: 12

Paper trades: 12
Winning paper trades: 8
Losing paper trades: 4

Take profits: 7
Stop losses: 4
Forced exits: 1

Approx paper net PnL: +8.28

Readiness READY: 0
Readiness NOT_READY: 4
```

Interpretation:

```text
The strategy signal quality improved in PAPER.
But the system is still NOT READY for LIVE because feed/fallback recovery fails.
```

---

## 5. What Improved

The latest sessions show strong improvement in directional filtering.

Across the 12 paper trades:

```text
Side: DOWN only
BTC trend: DOWN only
Momentum direction: DOWN only
Momentum NEUTRAL trades: 0
LIVE trades: 0
```

This is exactly aligned with the current strategy direction:

```toml
allow_up_trades = false
allow_down_trades = true
down_block_neutral_momentum = true
down_block_if_btc_trend_up = true
down_require_mc_direction_agreement = false
```

Do not change these yet.

---

## 6. Per-Session Summary

### 6.1 Session `c3db92a6`

```text
Paper buys/sells: 0 / 0
Live buys/sells: 0 / 0
Trades: 0
Rejected signals: 310
Fallback events: 3
Fallback recoveries: 3330
avgFallbackRecoveryMs: 36,292.60
maxFallbackRecoveryMs: 56,688
Readiness: NOT READY
```

Important issue:

```text
Fallback events = 3 but fallback recoveries = 3330.
This looks suspicious and may indicate duplicated recovery telemetry or a recovery-counting bug.
```

### 6.2 Session `69049ac5`

```text
Paper buys/sells: 7 / 7
Live buys/sells: 0 / 0
Win rate: 71.43%
Net PnL after fees: +5.01
Take profits: 4
Stop losses: 2
Forced exits: 1

Fallback events: 560
Fallback recoveries: 1178
avgFallbackRecoveryMs: 48,372.54
maxFallbackRecoveryMs: 300,075
Readiness: NOT READY
```

Trade quality:

```text
DOWN trades: 7
BTC trend DOWN: 7
Momentum DOWN: 7
Momentum NEUTRAL: 0
MC direction UP: 7
```

This supports keeping MC direction as analysis-only for now.

### 6.3 Session `285f315a`

```text
Paper buys/sells: 3 / 3
Live buys/sells: 0 / 0
Win rate: 66.67%
Net PnL after fees: +2.62
Take profits: 2
Stop losses: 1

Fallback events: 37
Fallback recoveries: 19
avgFallbackRecoveryMs: 4,527.32
maxFallbackRecoveryMs: 16,386
Readiness: NOT READY
```

Trade quality:

```text
DOWN trades: 3
BTC trend DOWN: 3
Momentum DOWN: 3
Momentum NEUTRAL: 0
MC direction UP: 3
```

### 6.4 Session `cc898379`

```text
Paper buys/sells: 2 / 2
Live buys/sells: 0 / 0
Win rate: 50%
Net PnL after fees: +0.65
Take profits: 1
Stop losses: 1

Fallback events: 107
Fallback recoveries: 46
avgFallbackRecoveryMs: 5,770.07
maxFallbackRecoveryMs: 25,956
Readiness: NOT READY
```

Trade quality:

```text
DOWN trades: 2
BTC trend DOWN: 2
Momentum DOWN: 2
Momentum NEUTRAL: 0
MC direction UP: 2
```

---

## 7. Current Diagnosis

### 7.1 Strategy Signal State

Current signal state is promising.

The latest batch shows that this filter combination is working better:

```text
DOWN-only
BTC trend DOWN
Momentum DOWN
No neutral momentum entries
No UP trades
```

Do not loosen or retune strategy yet.

### 7.2 Feed/Fallback State

Feed is still the main blocker.

Current readiness target:

```text
avgFallbackRecoveryMs <= 1000
maxFallbackRecoveryMs <= 5000
fallbackEventsPerMarket <= 2
```

Latest sessions failed because:

```text
avgFallbackRecoveryMs is far above 1000ms
maxFallbackRecoveryMs is far above 5000ms
stale_snapshot remains frequent
reconnect_pending/ws_closed appeared in long sessions
```

Worst example:

```text
69049ac5:
avgFallbackRecoveryMs = 48,372.54ms
maxFallbackRecoveryMs = 300,075ms
```

### 7.3 Lifecycle State

Latest evaluated sessions were PAPER only:

```text
Live buys = 0
Live sells = 0
Exit failed = 0
Position unresolved = 0
Exit skipped existing live order = 0
```

This is clean for the evaluated batch, but previous LIVE sessions had lifecycle problems.

Do not assume LIVE lifecycle is fixed yet.

### 7.4 MC Direction State

MC direction remains suspicious.

In the latest 12 paper trades:

```text
Trade side: DOWN
BTC trend: DOWN
Momentum: DOWN
MC direction: UP
Result: positive aggregate PnL
```

Therefore:

```text
Do not enable down_require_mc_direction_agreement yet.
Keep MC direction as analysis-only until semantics are validated.
```

---

## 8. Immediate Instructions

### 8.1 Do Not Run LIVE

Do not run live trading.

Reason:

```text
All evaluated sessions are NOT_READY.
Feed recovery is still failing.
Previous LIVE lifecycle issues are not fully proven fixed.
```

### 8.2 Freeze Strategy

Do not tune strategy parameters right now.

Keep:

```toml
allow_up_trades = false
allow_down_trades = true

down_block_neutral_momentum = true
down_block_if_btc_trend_up = true

down_require_mc_direction_agreement = false
down_min_mc_convergence = 0.62
```

### 8.3 Fix Feed/Fallback

Focus on:

```text
stale_snapshot
reconnect_pending
ws_closed
missing_snapshot
fallback recovery duration
market subscription lifecycle
WebSocket reconnect loop
snapshot refresh/reseed timing
```

### 8.4 Investigate Recovery Counting Bug

Investigate this anomaly:

```text
Fallback events: 3
Fallback recoveries: 3330
```

Expected:

```text
Fallback recoveries should not massively exceed fallback events unless there is a clearly documented reason.
```

Possible causes:

```text
1. recovery event emitted repeatedly per tick
2. recovery not paired to a unique fallback event
3. recovery event emitted every loop while state is healthy
4. analyzer counting recovery durations incorrectly
5. session-level recovery aggregation bug
```

---

## 9. Required Telemetry Improvements

Add or verify telemetry for feed states:

```ts
feed.snapshot_state = {
  sessionId,
  marketSlug,
  tokenId,

  state: "healthy" | "stale_snapshot" | "missing_snapshot" | "ws_closed" | "reconnect_pending",

  snapshotAgeMs,
  wsAgeMs,
  rttMs,
  feedLatencyMs,

  lastSnapshotAt,
  lastWsMessageAt,
  lastReconnectAt,

  reason,
  recoveryId,
  fallbackId
}
```

Add paired fallback lifecycle events:

```ts
feed.fallback_started = {
  sessionId,
  marketSlug,
  tokenId,
  fallbackId,
  reason,
  startedAt,
  snapshotAgeMs,
  wsAgeMs
}

feed.fallback_recovered = {
  sessionId,
  marketSlug,
  tokenId,
  fallbackId,
  reason,
  recoveredAt,
  durationMs
}
```

Acceptance:

```text
Every fallback_recovered must map to exactly one fallback_started by fallbackId.
No orphan recovery events.
No repeated recovery event for the same fallbackId.
```

---

## 10. Required Analyzer Updates

Update `validate:signals`, `analyze:trades`, and `check:live-readiness` to report:

```text
fallbackStartedCount
fallbackRecoveredCount
orphanFallbackRecoveries
duplicateFallbackRecoveries
avgRecoveryMs by reason
maxRecoveryMs by reason
activeFallbacksAtSessionEnd
```

Readiness must fail if:

```text
orphanFallbackRecoveries > 0
duplicateFallbackRecoveries > 0
activeFallbacksAtSessionEnd > 0
avgFallbackRecoveryMs > 1000
maxFallbackRecoveryMs > 5000
```

---

## 11. PAPER Acceptance Criteria Before Any LIVE

Before considering LIVE again, require:

```text
At least 20 paper trades
Paper net PnL > 0
Win rate >= 40%
Take profits >= stop losses, or profit factor > 1.15

No LIVE trades
No DOWN trades while BTC trend UP
No DOWN trades with momentum NEUTRAL

avgFallbackRecoveryMs <= 1000
maxFallbackRecoveryMs <= 5000
fallbackEventsPerMarket <= 2

orphanFallbackRecoveries = 0
duplicateFallbackRecoveries = 0

LIVE readiness verdict = READY
```

---

## 12. What Not To Do

Do not:

```text
1. Do not run LIVE.
2. Do not increase trade_usd.
3. Do not enable UP trades.
4. Do not disable down_block_neutral_momentum.
5. Do not disable down_block_if_btc_trend_up.
6. Do not enforce MC direction agreement yet.
7. Do not loosen feed thresholds.
8. Do not interpret script PASS as LIVE readiness.
```

---

## 13. Next Run Plan

After feed/fallback fix:

```powershell
npm run validate:signals -- --bot-id polymarket-bot-v5 --session-id <SESSION_ID>
npm run analyze:trades -- --bot-id polymarket-bot-v5 --session-id <SESSION_ID>
npm run check:live-readiness -- --bot-id polymarket-bot-v5 --session-id <SESSION_ID>
npm run evaluate:session -- --session-id <SESSION_ID>
```

Then run a short paper batch.

Target:

```text
3 to 5 hours PAPER
20+ paper trades if market conditions allow
0 LIVE trades
Readiness READY
Fallback avg <= 1000ms
Fallback max <= 5000ms
```

---

## 14. Final Verdict

Current state:

```text
Strategy signal quality: improving
Paper result: positive in latest evaluated sessions
LIVE readiness: NOT READY
Primary blocker: feed/fallback recovery
Secondary blocker: evaluator/versioning still needed for reproducibility
MC direction: analysis-only, not a hard gate
LIVE: blocked
```

Final instruction:

```text
Do not tune for more trades.
Do not return to LIVE.
Fix feed reliability and fallback accounting first.
```
