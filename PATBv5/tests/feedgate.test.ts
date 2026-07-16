import assert from "node:assert/strict";
import { resolve } from "node:path";

import { loadConfig } from "../src/config/toml";
import { getFeedHealth } from "../src/signals/feedgate";

async function run(): Promise<void> {
    const now = Date.now();
    const baseState = {
        latencyMs: 120,
        rttMs: 90,
        ageMs: 80,
        wsConnected: true,
        snapshotSource: "websocket",
        msSinceLastFallback: 10_000,
        tickTimestamps: [now - 1000, now - 3000, now - 7000],
    };
    const baseConfig = {
        requireWebsocket: true,
        rejectOnMissingWebsocket: true,
        recentWsFallbackCooldownMs: 5000,
        maxEntryFeedLatencyMs: 400,
        maxEntryFeedRttMs: 400,
        maxEntryFeedAgeMs: 500,
    };

    const healthy = getFeedHealth(baseState, baseConfig);
    assert.equal(healthy.healthy, true);
    assert.equal(healthy.rejectReason, null);
    assert.equal(healthy.ticksLast10s, 3);

    const missingWs = getFeedHealth({ ...baseState, wsConnected: false }, baseConfig);
    assert.equal(missingWs.healthy, false);
    assert.equal(missingWs.rejectReason, "missing_websocket");

    const recentFallback = getFeedHealth({ ...baseState, msSinceLastFallback: 4500 }, baseConfig);
    assert.equal(recentFallback.rejectReason, "recent_ws_fallback");

    const cooldownElapsed = getFeedHealth({ ...baseState, msSinceLastFallback: 5500 }, baseConfig);
    assert.equal(cooldownElapsed.rejectReason, null);

    const latencyRejected = getFeedHealth({ ...baseState, latencyMs: 900 }, baseConfig);
    assert.equal(latencyRejected.rejectReason, "entry_latency_gate");

    const tooFewTicks = getFeedHealth({ ...baseState, tickTimestamps: [now - 11_000] }, baseConfig);
    assert.equal(tooFewTicks.rejectReason, "feed_ticks_too_low");

    (globalThis as any).__CONFIG__ = undefined;
    const loadedConfig = loadConfig(resolve(__dirname, "..", "trade.toml"));
    assert.equal(loadedConfig.trade_5x.recent_ws_fallback_cooldown_ms, 5000);
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
