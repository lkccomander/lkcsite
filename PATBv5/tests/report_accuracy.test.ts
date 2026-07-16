import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildReportActions } from "../src/report/actions";
import { parseTelemetry } from "../src/report/parser";
import { renderReportHtml } from "../src/report/renderer";
import { buildReportFixture } from "./report_fixture";

function writeEvents(file: string, events: unknown[]): void {
    writeFileSync(file, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

async function run(): Promise<void> {
    const tempDir = mkdtempSync(join(tmpdir(), "patbv5-report-accuracy-"));

    try {
        const scopeFile = join(tempDir, "scope.jsonl");
        const scopeEvents = [
            {
                type: "bot.startup",
                sessionId: "full-session",
                payload: { strategy: "trade_5x", mode: "PAPER" },
            },
            ...Array.from({ length: 50_000 }, (_, index) => ({
                type: "diagnostic.noop",
                sessionId: "tail-session",
                payload: { index },
            })),
        ];
        writeEvents(scopeFile, scopeEvents);

        const fullReport = await parseTelemetry([scopeFile]);
        assert.equal(fullReport.totalEvents, 50_001, "default parsing must include the complete file");
        assert.equal(fullReport.strategy, "trade_5x", "full parsing must retain early-session metadata");
        assert.equal((fullReport as any).analysisScope, "full");
        assert.equal((fullReport as any).tailLines, null);

        const tailReport = await parseTelemetry([scopeFile], 2);
        assert.equal(tailReport.totalEvents, 2, "explicit tail mode must remain bounded");
        assert.equal(tailReport.strategy, "", "explicit tail mode may exclude early metadata");
        assert.equal((tailReport as any).analysisScope, "tail");
        assert.equal((tailReport as any).tailLines, 2);
        assert.match(renderReportHtml(tailReport), /TAIL SLICE · LAST 2 EVENTS/);

        const momentumFile = join(tempDir, "momentum.jsonl");
        writeEvents(momentumFile, [
            {
                type: "signal.momentum",
                payload: { direction: "DOWN", score: -0.25, confidence: 0.75 },
            },
            {
                type: "signal.momentum",
                payload: { momentumDirection: "UP", momentumScore: 0.1, momentumConfidence: 0.5 },
            },
            { type: "signal.momentum", payload: {} },
            { type: "signal.montecarlo", payload: { convergence: 0.7 } },
        ]);

        const momentumReport = await parseTelemetry([momentumFile]);
        assert.equal(momentumReport.momEventCount, 3);
        assert.equal((momentumReport as any).momUsableEventCount, 2);
        assert.equal((momentumReport as any).momMissingFieldEventCount, 1);
        assert.deepEqual(momentumReport.momDirections, { DOWN: 1, UP: 1 });
        assert.equal(momentumReport.momScoreMin, -0.25);
        assert.equal(momentumReport.momScoreMax, 0.1);
        assert.equal(momentumReport.momConfAvg, 0.625);

        const incompleteActions = buildReportActions(momentumReport);
        assert.ok(
            !incompleteActions.whatWentWell.some((item) => item.id === "signal-telemetry-present"),
            "incomplete momentum payloads must not produce a telemetry success claim",
        );
        assert.ok(
            incompleteActions.problems.some((item) => item.id === "incomplete-momentum-telemetry"),
            "missing momentum fields must become an explicit evidence problem",
        );

        const unresolvedHtml = renderReportHtml(buildReportFixture({
            shadowEventCount: 10,
            shadowResolvedEventCount: 0,
            shadowUnresolvedEventCount: 10,
        }));
        const shadowStart = unresolvedHtml.indexOf("Shadow PnL");
        const shadowEnd = unresolvedHtml.indexOf("</section>", shadowStart);
        const shadowSection = unresolvedHtml.slice(shadowStart, shadowEnd);
        assert.ok((shadowSection.match(/N\/A/g) ?? []).length >= 2, "unresolved shadow metrics must render as N/A");
        assert.match(shadowSection, /No authoritative shadow outcomes are available/);

        const commandActions = buildReportActions(buildReportFixture({
            anomalies: [{
                priority: 1,
                type: "BUG",
                severity: "red",
                title: "Example anomaly",
                detail: "Inspect the source telemetry.",
            }],
        }));
        const reportCommand = commandActions.recommendations.find((item) => item.id.startsWith("resolve-anomaly-"))?.command;
        const analysisCommand = commandActions.recommendations.find((item) => item.id === "collect-paper-evidence")?.command;
        assert.match(reportCommand ?? "", /^npm run report -- --file /);
        assert.doesNotMatch(reportCommand ?? "", /--telemetry-file/);
        assert.match(analysisCommand ?? "", /^npm run analyze:trades -- --telemetry-file /);

    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
