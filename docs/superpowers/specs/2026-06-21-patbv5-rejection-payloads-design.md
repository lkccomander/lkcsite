# PATBv5 Rejection Payload Enrichment Design

## Goal

Add richer telemetry for the two dominant `trade.signal_rejected` reasons in `trade_5x`:

- `entry_price_window`
- `up_bias_filter`

Also update the report/anomaly path so it can inspect real rejection payload fields instead of assuming they are missing.

## Scope

In scope:

- Extend the rejection payloads emitted from `PATBv5/src/trade/decision.ts`
- Preserve raw payload data for selected rejection reasons in the report/parser path
- Replace the stale `up_bias_filter` anomaly assumption with a field-presence check
- Add focused tests for payload content and anomaly behavior

Out of scope:

- Broad report schema redesign
- New report UI sections
- Config tuning for `trade_5x`
- Changes to rejection logic beyond telemetry detail

## Current Problem

Recent sessions show that `entry_price_window` and `up_bias_filter` are the largest rejection buckets, but the current analysis path does not preserve enough structured context to explain why they fired across sessions. The anomaly detector in `PATBv5/src/report/anomalies.ts` also assumes `up_bias_filter` payload values are missing, which is stale and produces a misleading finding.

## Design

### 1. Enrich `entry_price_window` rejection payloads

Keep existing fields and add decision-context fields needed for later tuning:

- `secondsToClose`
- `currentTimeRatio`
- `decisionSnapshotSource`
- `feedLatencyMs`
- `feedRttMs`
- `feedAgeMs`
- `feedWsConnected`
- `feedTicksLast10s`
- `entryPriceRatio`
- `entryPriceRatioMin`
- `entryPriceRatioMax`
- `preferredSpread`

This payload should answer:

- Which side was selected
- What price was checked
- What configured window was applied
- Whether the decision happened with healthy enough feed context
- What the price-ratio context looked like at the same moment

### 2. Enrich `up_bias_filter` rejection payloads

Keep existing momentum fields and add explicit pass/fail context:

- `secondsToClose`
- `currentTimeRatio`
- `decisionSnapshotSource`
- `feedLatencyMs`
- `feedRttMs`
- `feedAgeMs`
- `feedWsConnected`
- `feedTicksLast10s`
- `entryPriceRatio`
- `entryPriceRatioMin`
- `entryPriceRatioMax`
- `btcRising`
- `confidentEnough`

This payload should answer:

- Whether the reject was caused by BTC delta, confidence, or both
- What thresholds were active
- What side/price context was being considered at decision time

### 3. Preserve raw rejection payloads in the report path

Keep the existing rejection bucket counts unchanged. Add a narrow structure to the session report/parser that stores raw payloads for selected rejection reasons, starting with:

- `entry_price_window`
- `up_bias_filter`

This should be minimal and diagnostics-oriented, not a full typed event archive.

## 4. Fix anomaly detection

Update `PATBv5/src/report/anomalies.ts` so the `up_bias_filter` anomaly:

- inspects captured raw rejection payloads
- flags an anomaly only when required fields are actually absent
- does not emit the stale finding when payloads already contain the expected observed values

Required fields for the `up_bias_filter` anomaly check:

- `observedDelta1m`
- `observedMomentumConfidence`

## Testing

Add focused tests for:

1. `entry_price_window` or `up_bias_filter` rejection payload enrichment
   - verifies the emitted payload includes the new decision-context fields

2. anomaly detection
   - emits the anomaly when `up_bias_filter` payloads are missing required observed fields
   - does not emit the anomaly when those fields are present

## Risks

- Small report type changes may affect existing parser/test assumptions
- Payload growth increases telemetry size slightly, but only on already-emitted rejection events
- The anomaly fix depends on the parser preserving the raw fields without dropping them

## Success Criteria

- New sessions contain richer `entry_price_window` and `up_bias_filter` rejection payloads
- Report parsing retains those raw payload values for anomaly inspection
- The stale `up_bias_filter` anomaly only appears when data is truly missing
- Focused tests cover both enrichment and anomaly behavior
