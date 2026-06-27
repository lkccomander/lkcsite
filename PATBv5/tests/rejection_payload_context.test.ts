import assert from "node:assert/strict";

import { buildRejectionDiagnosticContext } from "../src/trade/decision";

async function run(): Promise<void> {
    const now = Date.now();
    const context = buildRejectionDiagnosticContext({
        trade: {
            remainingTime: 52,
            observedMarketTicks: 11,
            lastDecisionSnapshotSource: "websocket",
            latestFeedLatencyMs: 180,
            latestFeedRttMs: 95,
            latestFeedAgeMs: 140,
            latestFeedWsConnected: true,
            priceTickTimestamps: [now - 1000, now - 2500, now - 11_000],
        },
        currentTimeRatio: 0.08391,
        entryPriceRatio: 0.35678,
        entryPriceRatioMin: 0.1,
        entryPriceRatioMax: 0.36,
        preferredSpread: 0.02,
    });

    assert.equal(context.secondsToClose, 52);
    assert.equal(context.currentTimeRatio, 0.0839);
    assert.equal(context.decisionSnapshotSource, "websocket");
    assert.equal(context.feedLatencyMs, 180);
    assert.equal(context.feedRttMs, 95);
    assert.equal(context.feedAgeMs, 140);
    assert.equal(context.feedWsConnected, true);
    assert.equal(context.feedTicksLast10s, 2);
    assert.equal(context.entryPriceRatio, 0.3568);
    assert.equal(context.entryPriceRatioMin, 0.1);
    assert.equal(context.entryPriceRatioMax, 0.36);
    assert.equal(context.preferredSpread, 0.02);
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
