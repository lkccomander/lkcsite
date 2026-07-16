import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseTelemetry } from "../src/report/parser";

async function run(): Promise<void> {
    const tempDir = mkdtempSync(join(tmpdir(), "patbv5-shadow-report-"));
    try {
        const file = join(tempDir, "shadow.jsonl");
        const events = [
            { type: "trade.shadow_pnl", payload: { settlementStatus: "resolved", hypotheticalPnlUsd: 0.5 } },
            { type: "trade.shadow_pnl", payload: { settlementStatus: "resolved", hypotheticalPnlUsd: -1.0 } },
            { type: "trade.shadow_pnl", payload: { settlementStatus: "unresolved", hypotheticalPnlUsd: null } },
        ];
        writeFileSync(file, events.map((event) => JSON.stringify(event)).join("\n") + "\n");

        const report = await parseTelemetry([file], 100);
        assert.equal(report.shadowEventCount, 3);
        assert.equal(report.shadowResolvedEventCount, 2);
        assert.equal(report.shadowUnresolvedEventCount, 1);
        assert.equal(report.shadowWinCount, 1);
        assert.equal(report.shadowTotalHypothetical, -0.5);
        assert.equal(report.shadowWinRate, 50);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
