## 0. Progress Update - 2026-05-05

The bot is materially more mature than it was in the earlier review.

Completed today:

1. **Execution safety is now materially stronger.**  
   The bot now blocks stale entries, blocks opposite-side re-entry during cooldown, and blocks BUY while an exit is still pending or partial.

2. **SELL lifecycle management is now implemented.**  
   Live exits are tracked explicitly, duplicate SELL spam is prevented, reserved-balance errors are interpreted correctly when caused by a live order, and forced exits can now cancel/reprice safely instead of stacking duplicate exits.

3. **Spread semantics are now normalized.**  
   The code now consistently treats:
   - `buyPrice = bestAsk`
   - `sellPrice = bestBid`
   - `spread = bestAsk - bestBid`
   
   Negative spread is now treated as invalid snapshot telemetry rather than a formula artifact.

4. **Feed handling is less noisy.**  
   Websocket fallback now has debounce and a short grace window before dropping to REST, which should reduce `missing_websocket` burst spam and improve operator observability.

5. **Operator visibility is improved.**  
   The GUI now exposes:
   - live signal feed
   - external reference feed
   - feed monitoring
   - feed health badge with `GREEN / YELLOW / RED / UNKNOWN`

6. **Lifecycle validation now exists.**  
   A local harness covers the core `check3` scenarios and `npm test` now passes.

7. **`review4` execution fixes are applied.**  
   The config/schema mismatch caused by removed TOML keys is fixed with parser defaults, `inExitRange` no longer triggers exits, entry spread validation now checks only the preferred side, and noisy raw balance-response logs were removed.

What still matters most:
- participation quality
- market qualification quality
- whether the current `trade_4` window actually produces valid LIVE entries with acceptable slippage and spread

## 1. Assessment: Safety Works, Participation Still Does Not
The current v3 bot appears operationally safer than before, but the main strategic problem remains: it is still at high risk of **non-participation** in LIVE mode. The safety system is now stronger, the external reference fetch is no longer blocking the decision loop, latency handling is less brittle than before, and the sell lifecycle is now substantially safer. However, the entry geometry still looks mismatched to observed market behavior.

This means the bot may now be "technically healthier" while still being "strategically dead." If telemetry still shows 0 LIVE executions across many sessions, the next tuning target is not infrastructure first, but **entry logic and market qualification logic**.

---

## 2. Top 5 Current Weaknesses

1. **`entry_price_ratio` still appears misaligned with market reality.**  
   This was loosened from the older restrictive values, and the current test config now uses `entry_price_ratio = [0.05, 0.30]`. Even so, the strategic question remains unresolved: does that band actually match the part of the order book where live fills are both available and economically valid?

2. **Toxic orderbook tiers can still pollute price interpretation.**  
   Spread semantics are now normalized and negative snapshots are rejected, which removes one class of false diagnostics. Even so, pathological quotes like `0.99 / 0.01` can still represent toxic or untradeable liquidity, so market qualification is still a strategic concern rather than a solved problem.

3. **The entry/stop-loss geometry is too tight for noisy 5-minute markets.**  
   This now uses a relative stop model via `entryPrice - stop_loss_offset`, with the current config using `stop_loss_offset = 0.10`. That is much better than a fixed floor, but the offset still needs evidence-based tuning against actual fills.

4. **Latency is improved, but still not "free."**  
   The bot no longer blocks decisions on Coinbase fetches, `max_rtt_ms` is now `500`, and fallback handling is less noisy than before. That said, websocket RTT, REST fallback, startup grace periods, and feed completeness rules can still reject otherwise valid entries. The issue is no longer "hard latency paralysis" so much as "latency-sensitive gating under unstable feed conditions."

5. **Shadow PnL exists, but it is not yet driving systematic tuning.**  
   `trade.shadow_pnl` is implemented and emitted, but the workflow still does not appear to be using that shadow data to tighten or loosen `entry_price_ratio`, entry windows, or stop geometry based on evidence.

---

## 3. What Changed Since The Earlier Review

1. **External reference fetching is no longer a blocking decision-path problem.**  
   Coinbase spot reference refresh is now asynchronous and cached, so a slow HTTP response should no longer stall the core decision loop.

2. **RTT tolerance has been loosened.**  
   The previous environment was too strict at `180 ms`. The current config uses `max_rtt_ms = 300`, which is more realistic for live internet conditions.

3. **Execution quality protection is stronger.**  
   The bot now includes stale-execution rejection and opposite-side cooldown protection, which reduces bad late fills and flip-churn.

4. **SELL lifecycle safety is stronger.**  
   The bot now tracks pending/partial exits, reconciles live exit orders, avoids duplicate SELL spam, and supports controlled forced-exit repricing.

5. **Feed observability is stronger.**  
   The GUI now exposes signal, external-reference, and feed-health views, making it much easier to distinguish websocket instability from true latency or strategy gating.

6. **The immediate-sell bug from `exit_price_ratio_range` is removed.**  
   `exit_price_ratio_range` no longer participates in the normal take-profit exit condition, so entries should not immediately round-trip out just because the ratio is in a normal market range.

7. **Config parsing is aligned with the current TOML.**  
   Removed TOML keys are now represented as parser defaults or optional fields, so `trade.toml` validates again.

These are meaningful improvements, but they do not solve the deeper issue of whether the strategy can find valid, tradable setups under current entry constraints.

---

## 4. Top 5 Recommended Adjustments

1. **Rebase `entry_price_ratio` onto observed telemetry, not theory.**  
   If live ratios are mostly in the `0.08–0.22` region, temporarily widen or shift the allowed range to match reality and collect new evidence. Without this, the bot may never trade.

2. **Filter toxic book levels before computing strategic signals.**  
   Add guardrails that ignore clearly pathological levels such as `buy > 0.90` or `sell < 0.10` when those levels are obviously inconsistent with executable liquidity.

3. **Tune entry/stop-loss spacing from fills.**  
   The stop-loss model is now relative to entry, but the offset should be tuned from actual execution telemetry. A `0.10` offset may be safer than the old fixed floor, but it can still be too tight or too wide depending on fill quality and time-to-close.

4. **Use shadow PnL as a tuning tool, not just telemetry.**  
   Run controlled sessions with looser ratio bounds and compare hypothetical PnL against current strict filters. That will tell you whether the bot is over-filtering or correctly avoiding bad trades.

5. **Monitor feed-health rejection reasons separately from strategy rejections.**  
   Now that latency and fallback telemetry are surfaced more clearly, distinguish:
   - strategy rejecting trades because the edge is not there
   - infrastructure rejecting trades because feed quality is insufficient

That separation matters. Otherwise, it is too easy to mistake infrastructure caution for strategic weakness, or vice versa.

---

## 5. Bottom Line

The current v3 bot is in a better execution-safety state than before, but the most likely remaining blocker is still **entry qualification mismatch**, not core runtime instability.

If the bot still shows 0 LIVE executions after the recent runtime fixes, the next priority should be:

1. loosen and re-measure `entry_price_ratio`
2. filter toxic orderbook artifacts
3. tune relative stop geometry
4. use shadow PnL to tune from evidence

The immediate question is no longer "is the bot too stale to trade?" It is now: **"does the strategy define realistic entry conditions for the market it is actually observing?"**
