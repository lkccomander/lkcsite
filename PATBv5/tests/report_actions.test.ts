import assert from "node:assert/strict";

import { buildReportActions } from "../src/report/actions";
import { TradeRecord } from "../src/report/types";
import { buildReportFixture } from "./report_fixture";

function trade(overrides: Partial<TradeRecord> = {}): TradeRecord {
    return {
        tokenId: "token-1",
        side: "UP",
        entryPrice: 0.5,
        exitPrice: 0.6,
        holdSeconds: 30,
        grossPnl: 1,
        sellReason: "take_profit",
        mcConvergence: 0.7,
        mcSimulatedDirection: "UP",
        momentumDirection: "UP",
        momentumScore: 0.001,
        momentumConfidence: 0.5,
        momentumDelta1m: 0.001,
        feedLatencyMs: 20,
        feedRttMs: 40,
        makerMode: true,
        feeUsd: 0,
        btcAtEntry: 100000,
        btcAtExit: 100100,
        missingFields: [],
        shares: 10,
        cashBefore: 100,
        cashAfter: 101,
        rebateUsd: 0,
        decisionSource: "rules",
        feedAgeMs: 20,
        feedSnapshotSource: "ws",
        positionState: "closed",
        holdingStatus: "closed",
        exitPriceActual: 0.6,
        sharesSold: 10,
        avgPrice: 0.6,
        ...overrides,
    };
}

function ids(items: Array<{ id: string }>): string[] {
    return items.map((item) => item.id);
}

function run(): void {
    const healthy = buildReportActions(buildReportFixture({
        buys: 2,
        sells: 2,
        trades: [trade(), trade({ tokenId: "token-2", grossPnl: 2 })],
        netPnl: 3,
        momEventCount: 20,
        momUsableEventCount: 20,
        mcEventCount: 20,
        shadowEventCount: 10,
        shadowResolvedEventCount: 10,
        shadowUnresolvedEventCount: 0,
        gateChecks: [
            { id: "feed_fallbacks", label: "Feed fallbacks", pass: true, note: "0" },
            { id: "signal_events", label: "Signal events", pass: true, note: "present" },
        ],
    }));

    assert.ok(ids(healthy.whatWentWell).includes("matched-trade-lifecycle"));
    assert.ok(ids(healthy.whatWentWell).includes("positive-paper-pnl"));
    assert.ok(ids(healthy.whatWentWell).includes("signal-telemetry-present"));
    assert.ok(ids(healthy.whatWentWell).includes("shadow-labels-resolved"));

    const unhealthy = buildReportActions(buildReportFixture({
        fallbackCount: 437,
        momEventCount: 1913,
        mcEventCount: 7254,
        shadowEventCount: 80421,
        shadowResolvedEventCount: 0,
        shadowUnresolvedEventCount: 80421,
        gateChecks: [
            { id: "feed_fallbacks", label: "Feed fallbacks", pass: false, note: "437 fallbacks" },
        ],
    }));

    assert.ok(ids(unhealthy.problems).includes("unresolved-shadow-outcomes"));
    assert.ok(ids(unhealthy.problems).includes("failed-gate-feed_fallbacks"));
    assert.ok(ids(unhealthy.recommendations).includes("repair-shadow-settlement"));
    assert.ok(ids(unhealthy.recommendations).includes("stabilize-feed"));
    assert.ok(unhealthy.nextSteps.some((item) => item.command?.includes("test:shadow-settlement")));
    assert.ok(unhealthy.nextSteps.some((item) => item.command?.includes("validate:signals")));

    const insufficient = buildReportActions(buildReportFixture());
    assert.ok(ids(insufficient.problems).includes("insufficient-trade-sample"));
    assert.ok(ids(insufficient.recommendations).includes("collect-paper-evidence"));
    assert.equal(insufficient.whatWentWell.length, 0, "empty evidence must not produce vacuous wins");
}

run();
