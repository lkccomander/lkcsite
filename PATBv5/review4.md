Implementation Status - 2026-05-05

The actionable fixes from this review have been applied.

Completed:
- `inExitRange` was removed from normal UP/DOWN exit conditions, so `exit_price_ratio_range` no longer causes immediate post-buy sells.
- Relative stop loss is implemented through `lastExecutedEntry.entryPrice - stop_loss_offset`.
- Entry spread rejection now checks only the preferred side's spread.
- Raw `upBalance`, `downBalance`, and `usdBalance` object logs were removed from `updateTokenBalances`.
- `trade.toml` now validates again even though `max_seconds_to_close`, `stop_loss_price`, and `hold_to_end_price` were removed from the TOML:
  - `max_seconds_to_close` defaults to `Infinity`
  - `stop_loss_price` defaults to `0.40`
  - `hold_to_end_price` is optional
- Validation passed:
  - config parse
  - `npm run build`
  - `npm test`

Remaining:
- `entry_price_ratio` and `stop_loss_offset` still need live telemetry validation.
- Toxic book-level filtering is still a separate strategy-quality improvement.

Now I have the complete picture. There are two findings from trade.ts that change everything.

Critical Finding: exit_price_ratio_range is a silent immediate-sell bug
In decision.ts the exit check is:
tsif ((this.upSellPrice >= trade4.take_profit_price || inExitRange) && secondsToClose > trade4.min_seconds_to_close) {
    await this.sellUpToken();
And inExitRange is computed as:
tsconst inExitRange = exitRanges.some(([min, max]) => up_price_ratio >= min && up_price_ratio <= max);
Where up_price_ratio = Math.abs(this.upBuyPrice - 0.5) / 0.5.
With your config exit_price_ratio_range = [[0.0, 0.52], [0.86, 1.0]], the first range [0.0, 0.52] means ratio between 0 and 0.52 — which translates to buy prices between 0.24 and 0.76. That is the normal operating range of every 5-minute market.
Result: inExitRange = true on virtually every tick. If the bot ever executes a buy, the very next decision tick will trigger an immediate sell — locking in only the round-trip fee as a loss. The bot has never traded, so this has never been observed. But it would fire the moment the entry filters are fixed.

Good Finding: lastExecutedEntry.entryPrice already exists
In trade.ts, recordExecutedEntry already does:
tsthis.lastExecutedEntry = { side, executedAt, marketSlug, entryPrice };
So the stop loss offset change needs no new tracking — just use this.lastExecutedEntry?.entryPrice directly in decision.ts.

All Changes to decision.ts
Change 1 — Remove dead code block (~line 324):
ts// DELETE these 3 lines:
if (this.prevUpBuyPrice[0] || this.prevUpBuyPrice[1]) {
    Market.None;
}
Change 2 — Remove inExitRange from exit conditions (both UP and DOWN cases):
ts// REMOVE this variable entirely — the values in config are not ratio space,
// and [0.0, 0.52] maps to prices 0.24–0.76 which fires on every normal tick
const inExitRange = exitRanges.some(([min, max]) => up_price_ratio >= min && up_price_ratio <= max);
ts// UP case — BEFORE:
if ((this.upSellPrice >= trade4.take_profit_price || inExitRange) && secondsToClose > trade4.min_seconds_to_close) {

// UP case — AFTER:
if (this.upSellPrice >= trade4.take_profit_price && secondsToClose > trade4.min_seconds_to_close) {
ts// DOWN case — BEFORE:
if ((this.downSellPrice >= trade4.take_profit_price || inExitRange) && secondsToClose > trade4.min_seconds_to_close) {

// DOWN case — AFTER:
if (this.downSellPrice >= trade4.take_profit_price && secondsToClose > trade4.min_seconds_to_close) {
Change 3 — Relative stop loss using existing lastExecutedEntry:
Replace both stop loss checks in the UP and DOWN cases:
ts// UP case — BEFORE:
if (this.upSellPrice <= trade4.stop_loss_price) {

// UP case — AFTER:
const upEntryPrice = this.lastExecutedEntry?.entryPrice ?? null;
const upStopFloor = (upEntryPrice && Number.isFinite(upEntryPrice) && trade4.stop_loss_offset)
    ? upEntryPrice - trade4.stop_loss_offset
    : (trade4.stop_loss_price ?? 0.50);
if (this.upSellPrice <= upStopFloor) {
ts// DOWN case — BEFORE:
if (this.downSellPrice <= trade4.stop_loss_price) {

// DOWN case — AFTER:
const downEntryPrice = this.lastExecutedEntry?.entryPrice ?? null;
const downStopFloor = (downEntryPrice && Number.isFinite(downEntryPrice) && trade4.stop_loss_offset)
    ? downEntryPrice - trade4.stop_loss_offset
    : (trade4.stop_loss_price ?? 0.50);
if (this.downSellPrice <= downStopFloor) {
Change 4 — Spread check: only block on the preferred side's spread
Currently spreadTooWide blocks entry if EITHER side has a wide spread. But the non-preferred side (e.g. DOWN when price has moved UP) will almost always be illiquid. Move the spread check to after preferredSide is determined:
ts// REMOVE the early spread computation from the top of trade_4 case:
// DELETE: const spreadTooWide = upSpread === null || downSpread === null || ...

// Then AFTER preferredSide is determined, ADD:
const preferredSpread = preferredSide === Market.Up ? upSpread : downSpread;
const spreadTooWide = preferredSpread === null || preferredSpread >= trade4.max_allowed_spread;
This requires moving the spreadTooWide check after the preferredSide line. The block becomes:
tsconst preferredSide = this.upBuyPrice >= this.downBuyPrice ? Market.Up : Market.Down;
const preferredPrice = preferredSide === Market.Up ? this.upBuyPrice : this.downBuyPrice;
const preferredSpread = preferredSide === Market.Up ? upSpread : downSpread;
const spreadTooWide = preferredSpread === null || preferredSpread >= trade4.max_allowed_spread;

if (spreadTooWide) {
    await emitSignalRejected(this, "spread_too_wide", { ... });
    break;
}

const inEntryPriceWindow = preferredPrice >= trade4.min_entry_price && ...

One trade.ts Issue: Console logs in updateTokenBalances
tsconsole.log("upBalance", upBalance);
console.log("downBalance", downBalance);
console.log("usdBalance", usdBalance);
These three lines log raw API response objects on every balance poll — which fires every second in waitForBalance. In a live session this floods the log with unstructured API objects. Remove them; the structured log below already captures what matters:
ts// Keep this one:
console.log(`📊 Balance updated | Up: ${upBalanceNum.toFixed(4)} | Down: ...`);
// Delete the three raw object logs above it.

Updated trade.toml (only the changed keys)
toml# exit_price_ratio_range is now only used for the inExitRange check which is removed.
# Keep in config for emergency_swap reference but it no longer drives exit timing.
exit_price_ratio_range  = [[0.0, 0.45], [0.86, 1.0]]

# New: relative stop loss. decision.ts now computes stop = entryPrice - stop_loss_offset
stop_loss_offset        = 0.10
stop_loss_price         = 0.40  # hard floor fallback if lastExecutedEntry is null

Priority Order for These Fixes
Fix these in order before re-enabling live trading:

inExitRange removal — without this, every buy immediately sells
entry_price_ratio = [0.10, 0.36] — without this, bot never buys
max_rtt_ms = 500 — reduces 91 unnecessary latency rejections per session
Relative stop loss — improves risk management once trades execute
Spread check preferred-side-only — reduces rejections after ratio fix
