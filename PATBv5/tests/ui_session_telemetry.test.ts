import assert from "node:assert/strict";
import { buildActiveSessionTelemetry, type TelemetryEvent } from "../src/ui/state/sessionTelemetry";

const events: TelemetryEvent[] = [
  { type: "bot.startup", timestamp: "2026-07-16T20:00:00.000Z", sessionId: "old", sessionStartedAt: "2026-07-16T20:00:00.000Z", payload: { mode: "PAPER", paperStartingUsd: 100 } },
  { type: "paper_trade.sell", timestamp: "2026-07-16T20:01:00.000Z", sessionId: "old", payload: { side: "UP", pnlUsd: 20, price: 0.8 } },
  { type: "paper_balance.checkpoint", timestamp: "2026-07-16T20:02:00.000Z", sessionId: "old", payload: { balance: 120 } },
  { type: "bot.startup", timestamp: "2026-07-16T21:00:00.000Z", sessionId: "current", sessionStartedAt: "2026-07-16T21:00:00.000Z", payload: { mode: "LIVE" } },
  { type: "live_trade.sell", timestamp: "2026-07-16T21:01:00.000Z", sessionId: "current", payload: { side: "DOWN", pnlUsd: 5, price: 0.75 } },
  { type: "trade.exit_filled", timestamp: "2026-07-16T21:02:00.000Z", sessionId: "current", payload: { side: "UP", realizedTradePnl: -2, exitPrice: 0.61 } },
  { type: "trade.signal_rejected", timestamp: "2026-07-16T21:02:30.000Z", sessionId: "current", payload: { reason: "min_fee_adjusted_edge", market: "btc-updown-5m" } },
  { type: "feed.summary", timestamp: "2026-07-16T21:03:00.000Z", sessionId: "current", payload: { averageLatencyMs: 312, tickCount: 90 } },
];

const result = buildActiveSessionTelemetry(events, Date.parse("2026-07-16T21:03:01.000Z"));
assert.equal(result.sessionSummary.sessionId, "current");
assert.equal(result.sessionSummary.runtimeMode, "LIVE");
assert.equal(result.sessionSummary.realizedPnl, 3);
assert.equal(result.sessionSummary.settledTrades, 2);
assert.equal(result.sessionSummary.wins, 1);
assert.equal(result.sessionSummary.losses, 1);
assert.equal(result.sessionSummary.winRate, 50);
assert.deepEqual(result.sessionSummary.pnlHistory.map((point) => point.value), [0, 5, 3]);
assert.equal(result.sessionSummary.startingBalance, null);
assert.equal(result.sessionSummary.currentBalance, null);
assert.equal(result.sessionSummary.dataAgeSeconds, 1);
assert.deepEqual(result.activityFeed.map((event) => event.action), ["FEED", "REJECT", "FILL", "SELL"]);
assert.equal(result.activityFeed.length, 4);
assert.ok(result.sessionEvents.every((event) => event.sessionId === "current"));

const paper = buildActiveSessionTelemetry([
  { type: "bot.startup", timestamp: "2026-07-16T22:00:00.000Z", sessionId: "paper", payload: { mode: "PAPER", paperStartingUsd: 500 } },
  { type: "paper_balance.checkpoint", timestamp: "2026-07-16T22:01:00.000Z", sessionId: "paper", payload: { balance: 504 } },
], Date.parse("2026-07-16T22:01:02.000Z"));
assert.equal(paper.sessionSummary.startingBalance, 500);
assert.equal(paper.sessionSummary.currentBalance, 504);

const unknown = buildActiveSessionTelemetry([
  { type: "feed.summary", timestamp: "2026-07-16T23:00:00.000Z", sessionId: "unknown", payload: {} },
], Date.parse("2026-07-16T23:00:30.000Z"));
assert.equal(unknown.sessionSummary.runtimeMode, "UNKNOWN");
assert.equal(unknown.sessionSummary.status, "stale");
assert.equal(unknown.sessionSummary.winRate, null);

const empty = buildActiveSessionTelemetry([], Date.parse("2026-07-16T23:30:00.000Z"));
assert.equal(empty.sessionSummary.runtimeMode, "UNKNOWN");
assert.equal(empty.sessionSummary.status, "stale");
assert.deepEqual(empty.activityFeed, []);
