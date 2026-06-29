import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "patbv5-telemetry-origin-"));
process.env.TELEMETRY_ROOT = tempRoot;
process.env.BOT_ID = "telemetry-origin-test-bot";

async function run(): Promise<void> {
    const telemetry = await import("../src/telemetry");

    telemetry.__resetTelemetryModuleState();
    telemetry.__setTelemetryOriginHostForTests("pi-test-host");

    const session = await telemetry.startTelemetrySession("PAPER");
    await telemetry.writeTelemetryEvent("bot.startup", { ok: true });

    const sessionLines = fs.readFileSync(session.sessionPath, "utf8").trim().split(/\r?\n/);
    assert.equal(sessionLines.length, 1);
    const sessionEvent = JSON.parse(sessionLines[0]) as { originHost?: string; botId?: string };
    assert.equal(sessionEvent.originHost, "pi-test-host");
    assert.equal(sessionEvent.botId, "telemetry-origin-test-bot");

    const dbLines = fs.readFileSync(telemetry.getTelemetryDbPath(), "utf8").trim().split(/\r?\n/);
    assert.equal(dbLines.length, 1);
    const dbEvent = JSON.parse(dbLines[0]) as { originHost?: string };
    assert.equal(dbEvent.originHost, "pi-test-host");

    telemetry.__resetTelemetryModuleState();
    telemetry.__setTelemetryOriginHostForTests(null);

    const fallbackSession = await telemetry.startTelemetrySession("LIVE");
    await telemetry.writeTelemetryEvent("bot.shutdown", { ok: true });

    const fallbackLines = fs.readFileSync(fallbackSession.sessionPath, "utf8").trim().split(/\r?\n/);
    assert.equal(fallbackLines.length, 1);
    const fallbackEvent = JSON.parse(fallbackLines[0]) as { originHost?: string };
    assert.equal("originHost" in fallbackEvent, false);
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
