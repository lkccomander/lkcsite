import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseTelemetry } from "../src/report/parser";

async function run(): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), "patbv5-report-feed-events-"));
    const file = join(dir, "events.jsonl");
    try {
        const events = [
            { type: "feed.fallback", timestamp: "2026-07-16T09:00:00.000Z", payload: { slug: "market-1", reason: "stale_snapshot" } },
            { type: "feed.reconnect_scheduled", timestamp: "2026-07-16T09:00:01.000Z", payload: { slug: "market-1", reason: "socket_error", reconnectCategory: "tls_certificate_policy" } },
            { type: "feed.reconnect_forced", timestamp: "2026-07-16T09:00:02.000Z", payload: { slug: "market-1", reason: "websocket_unresponsive" } },
            { type: "feed.disconnected", timestamp: "2026-07-16T09:00:03.000Z", payload: { slug: "market-1", code: 1006 } },
            { type: "feed.error", timestamp: "2026-07-16T09:00:04.000Z", payload: { slug: "market-1", source: "websocket", error: "EE certificate key too weak" } },
            { type: "feed.summary", timestamp: "2026-07-16T09:05:00.000Z", payload: { slug: "market-1", fallbackCount: 99, averageRttMs: 150, maxRttMs: 300, p95RttMs: 200 } },
        ];
        writeFileSync(file, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);

        const report = await parseTelemetry([file]);
        assert.equal(report.fallbackCount, 1, "raw fallbacks must outrank cumulative summary values");
        assert.equal(report.reconnectScheduledCount, 1);
        assert.equal(report.forcedReconnectCount, 1);
        assert.equal(report.disconnectCount, 1);
        assert.deepEqual(report.fallbackReasons, { stale_snapshot: 1 });
        assert.deepEqual(report.disconnectCodes, { "1006": 1 });
        assert.deepEqual(report.websocketErrorCategories, { tls_certificate_policy: 1 });

        assert.equal(report.feedWindows.length, 1);
        const window = report.feedWindows[0];
        assert.equal(window.fallbacks, 1);
        assert.equal(window.reconnectEvents, 1);
        assert.equal(window.scheduledReconnects, 1);
        assert.equal(window.forcedReconnects, 1);
        assert.equal(window.disconnects, 1);
        assert.deepEqual(window.fallbackReasons, { stale_snapshot: 1 });
        assert.deepEqual(window.disconnectCodes, { "1006": 1 });
        assert.deepEqual(window.websocketErrorCategories, { tls_certificate_policy: 1 });
        assert.equal(window.rttAvg, 150);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

void run().then(
    () => process.exit(0),
    (error) => {
        console.error(error);
        process.exit(1);
    },
);
