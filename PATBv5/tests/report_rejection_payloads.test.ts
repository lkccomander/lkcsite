import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { detectAnomalies } from "../src/report/anomalies";
import { parseTelemetry } from "../src/report/parser";

async function run(): Promise<void> {
    const tempDir = mkdtempSync(join(tmpdir(), "patbv5-report-"));

    try {
        const completeFile = join(tempDir, "complete.jsonl");
        writeFileSync(completeFile, `${JSON.stringify({
            sessionId: "session-complete",
            type: "trade.signal_rejected",
            payload: {
                reason: "up_bias_filter",
                observedDelta1m: 0.0004,
                observedMomentumConfidence: 0.42,
                preferredPrice: 0.72,
            },
        })}\n`);

        const completeReport = await parseTelemetry([completeFile], 100);
        assert.equal(completeReport.rejectionCount, 1);
        assert.equal(completeReport.rejectionPayloads.up_bias_filter?.length, 1);
        assert.equal(
            completeReport.rejectionPayloads.up_bias_filter?.[0]?.payload.observedDelta1m,
            0.0004,
        );
        assert.equal(
            detectAnomalies(completeReport).some((anomaly) => anomaly.title === "up_bias_filter rejection missing evaluated values"),
            false,
        );

        const missingFile = join(tempDir, "missing.jsonl");
        writeFileSync(missingFile, `${JSON.stringify({
            sessionId: "session-missing",
            type: "trade.signal_rejected",
            payload: {
                reason: "up_bias_filter",
                preferredPrice: 0.71,
            },
        })}\n`);

        const missingReport = await parseTelemetry([missingFile], 100);
        assert.equal(missingReport.rejectionPayloads.up_bias_filter?.length, 1);
        assert.equal(
            detectAnomalies(missingReport).some((anomaly) => anomaly.title === "up_bias_filter rejection missing evaluated values"),
            true,
        );
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
