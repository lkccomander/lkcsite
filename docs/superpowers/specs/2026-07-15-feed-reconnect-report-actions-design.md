# Feed reconnect and report actions design

## Objective

Address the actionable findings from session `f6c29b98-5c66-48dd-8eeb-a4402d33515f` without tuning the DOWN Monte Carlo threshold from an insufficient six-trade sample.

## Evidence and root cause

The session recorded 133 fallback events, 123 disconnect events, and 86 reconnect schedules. Only 21 disconnects used WebSocket code 1006. Another 65 reconnects were forced locally with reason `websocket_unresponsive`.

The current feed policy treats a quote snapshot older than four seconds as proof that the WebSocket is unresponsive. Order-book traffic can legitimately remain quiet while ping/pong traffic confirms that the socket is alive. This conflates quote freshness with transport health and creates repeated forced reconnects. The reconnect loop then inflates fallback pressure and makes the report's hardcoded `close_1006` label inaccurate.

The losing DOWN trade with MC convergence `0.630` satisfied the active configured threshold of `0.62`. Changing that threshold based on two DOWN trades is outside this change.

## Design

### WebSocket health and quote freshness

`PolymarketMarketFeed.getLatestSnapshot()` will continue to reject stale WebSocket snapshots for trading decisions. A stale quote will refresh the subscription and use the existing REST fallback path.

A stale quote alone will no longer force a reconnect while ping/pong traffic is healthy. A reconnect will still be forced when pong traffic exceeds the existing pong timeout. Missing initial two-sided book data will continue to use the existing startup and missing-subscription recovery paths.

This preserves the safety boundary: stale quotes and REST snapshots cannot authorize an entry when the strategy requires a current WebSocket snapshot.

### Entry cooldown

The active `[trade_5x]` configuration will change `recent_ws_fallback_cooldown_ms` from `2000` to `5000`. Other strategy sections and immutable historical strategy-version records will remain unchanged.

### Report accuracy

The feed anomaly will stop claiming that every high-fallback window is a `close_1006` spike. Its title and action will describe observed fallback pressure generically unless telemetry supplies a verified reason breakdown.

The MC threshold remains `0.62` for DOWN entries. The report may retain the observation as tuning evidence, but the implementation will not change strategy thresholds from this sample.

## Tests

Add or update focused tests that demonstrate:

1. A stale book with a recent pong refreshes/falls back without forcing a reconnect.
2. A stale book with an expired pong forces `websocket_unresponsive` reconnect.
3. A cached snapshot during reconnect startup does not cause a reconnect loop while pongs remain healthy.
4. The active `trade_5x` configuration exposes a 5000 ms recent-fallback cooldown.
5. A high-fallback report anomaly does not mislabel the cause as `close_1006`.

Run the focused feed, configuration, and report tests, followed by the relevant aggregate test scripts that terminate reliably. The existing hanging test behavior will be reported separately if it persists after the focused commands.

## Scope

This change will not modify MC convergence thresholds, entry-price ranges, momentum filters, historical telemetry, historical strategy-version JSON, or unrelated local changes.
