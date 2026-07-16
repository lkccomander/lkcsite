import assert from "node:assert/strict";
import {
    calculateShadowPnlUsd,
    pollForGammaSettlement,
    resolveGammaBinarySettlement,
    shadowExitPriceForSide,
} from "../src/trade/policy/shadowSettlement";

async function run(): Promise<void> {
    const up = resolveGammaBinarySettlement({
        closed: true,
        umaResolutionStatus: "resolved",
        outcomes: '["Up", "Down"]',
        outcomePrices: '["1", "0"]',
    });
    assert.equal(up.status, "resolved");
    assert.equal(up.winner, "UP");
    assert.equal(up.upPrice, 1);
    assert.equal(up.downPrice, 0);
    assert.equal(shadowExitPriceForSide(up, "Up"), 1);
    assert.equal(shadowExitPriceForSide(up, "Down"), 0);
    assert.equal(calculateShadowPnlUsd(0.5, null), null);
    assert.equal(calculateShadowPnlUsd(0.5, 0), -1.036);
    assert.ok((calculateShadowPnlUsd(0.5, 1) ?? 0) > 0.9);

    const down = resolveGammaBinarySettlement({
        closed: true,
        active: false,
        outcomes: ["Up", "Down"],
        outcomePrices: [0, 1],
    });
    assert.equal(down.status, "resolved");
    assert.equal(down.winner, "DOWN");
    assert.equal(shadowExitPriceForSide(down, "Up"), 0);
    assert.equal(shadowExitPriceForSide(down, "Down"), 1);

    const bothLow = resolveGammaBinarySettlement({
        closed: true,
        outcomes: '["Up", "Down"]',
        outcomePrices: '["0.01", "0.01"]',
    });
    assert.equal(bothLow.status, "unresolved");
    assert.equal(bothLow.reason, "non_terminal_outcome_prices");
    assert.equal(shadowExitPriceForSide(bothLow, "Up"), null);

    const notClosed = resolveGammaBinarySettlement({
        closed: false,
        outcomes: '["Up", "Down"]',
        outcomePrices: '["1", "0"]',
    });
    assert.equal(notClosed.status, "unresolved");
    assert.equal(notClosed.reason, "market_not_resolved");

    const malformed = resolveGammaBinarySettlement({
        closed: true,
        outcomes: '["Up"]',
        outcomePrices: '["1", "0"]',
    });
    assert.equal(malformed.status, "unresolved");
    assert.equal(malformed.reason, "invalid_outcome_mapping");

    let calls = 0;
    const polled = await pollForGammaSettlement(
        async () => {
            calls += 1;
            return calls === 1
                ? { closed: false, outcomes: '["Up", "Down"]', outcomePrices: '["0.5", "0.5"]' }
                : { closed: true, outcomes: '["Up", "Down"]', outcomePrices: '["0", "1"]' };
        },
        { attempts: 3, intervalMs: 0, sleepFn: async () => undefined },
    );
    assert.equal(calls, 2);
    assert.equal(polled.status, "resolved");
    assert.equal(polled.winner, "DOWN");

    let timeoutCalls = 0;
    const timedOut = await pollForGammaSettlement(
        async () => {
            timeoutCalls += 1;
            return { closed: false, outcomes: '["Up", "Down"]', outcomePrices: '["0.5", "0.5"]' };
        },
        { attempts: 3, intervalMs: 0, sleepFn: async () => undefined },
    );
    assert.equal(timeoutCalls, 3);
    assert.equal(timedOut.status, "unresolved");
    assert.equal(timedOut.reason, "settlement_poll_timeout");
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
