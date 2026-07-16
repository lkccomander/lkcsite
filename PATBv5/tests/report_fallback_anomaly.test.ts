import assert from "node:assert/strict";

import { detectAnomalies } from "../src/report/anomalies";
import type { SessionReport } from "../src/report/types";

function run(): void {
    const report = {
        trades: [],
        rejectionBreakdown: [],
        rejectionPayloads: {},
        entryLatencyGateBreakdown: { age: 0, latency: 0, rtt: 0, unknown: 0 },
        feedWindows: [{
            slug: "test-spike",
            status: "SPIKE",
            fallbacks: 25,
            rttAvg: 100,
            rttMax: 200,
            rttP95: 150,
            start: "2026-07-15T00:00:00.000Z",
            end: "2026-07-15T00:05:00.000Z",
            reconnectEvents: 10,
            fallbackReasons: {},
        }],
        shadowEventCount: 0,
        shadowResolvedEventCount: 0,
        shadowWinRate: 0,
    } as unknown as SessionReport;

    const anomaly = detectAnomalies(report).find((candidate) => candidate.priority === 7);
    assert.ok(anomaly, "expected high fallback pressure to remain visible");
    assert.doesNotMatch(anomaly.title, /close_1006/);
    assert.doesNotMatch(anomaly.detail, /close_1006/);
}

run();
process.exit(0);
