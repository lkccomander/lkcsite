import assert from "assert/strict";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const telemetryRoot = join(tmpdir(), `patbv5-telemetry-rotation-${process.pid}-${Date.now()}`);
process.env.TELEMETRY_ROOT = telemetryRoot;
process.env.TELEMETRY_ROTATE_BYTES = "800";
process.env.TELEMETRY_MAX_TOTAL_BYTES = "2048";

const telemetry = require("../src/telemetry/db") as typeof import("../src/telemetry/db");

const managedArchivePattern = /^events\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.jsonl$/;

async function resetStore(): Promise<void> {
    telemetry.__resetTelemetryModuleState();
    await rm(telemetryRoot, { recursive: true, force: true });
    await mkdir(telemetryRoot, { recursive: true });
}

async function readEvents(path: string): Promise<Array<Record<string, unknown>>> {
    const raw = await readFile(path, "utf8");
    return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function testRotationPruningAndLegacyPreservation(): Promise<void> {
    await resetStore();
    const legacyPath = join(telemetryRoot, "events.legacy-2026-07-12T00-00-00-000Z.jsonl");
    const unrelatedPath = join(telemetryRoot, "operator-notes.jsonl");
    await writeFile(legacyPath, "legacy\n", "utf8");
    await writeFile(unrelatedPath, "unrelated\n", "utf8");

    for (let index = 0; index < 20; index += 1) {
        await telemetry.writeTelemetryEvent("bot.error", {
            index,
            detail: "x".repeat(260),
        });
    }

    const names = await readdir(telemetryRoot);
    const managedArchives = names.filter((name) => managedArchivePattern.test(name));
    assert.ok(managedArchives.length > 0, "expected at least one managed archive");
    assert.ok(names.includes("events.jsonl"), "active events.jsonl should remain present");
    assert.ok(names.includes("events.legacy-2026-07-12T00-00-00-000Z.jsonl"));
    assert.ok(names.includes("operator-notes.jsonl"));

    const managedPaths = [join(telemetryRoot, "events.jsonl"), ...managedArchives.map((name) => join(telemetryRoot, name))];
    const sizes = await Promise.all(managedPaths.map(async (path) => (await stat(path)).size));
    assert.ok(sizes.reduce((total, size) => total + size, 0) <= 2048, "managed telemetry should stay within the total cap");

    for (const path of managedPaths) {
        await readEvents(path);
    }
}

async function testConcurrentWritesRemainComplete(): Promise<void> {
    await resetStore();
    const expected = 8;
    await Promise.all(Array.from({ length: expected }, (_, index) => (
        telemetry.writeTelemetryEvent("bot.error", { concurrentIndex: index })
    )));

    const names = await readdir(telemetryRoot);
    const eventPaths = names
        .filter((name) => name === "events.jsonl" || managedArchivePattern.test(name))
        .map((name) => join(telemetryRoot, name));
    const events = (await Promise.all(eventPaths.map(readEvents))).flat();
    const indexes = events
        .map((event) => (event.payload as { concurrentIndex?: number }).concurrentIndex)
        .filter((value): value is number => typeof value === "number")
        .sort((left, right) => left - right);
    assert.deepEqual(indexes, Array.from({ length: expected }, (_, index) => index));
}

async function testQueueRecoversAfterOversizedFileError(): Promise<void> {
    await resetStore();
    const activePath = join(telemetryRoot, "events.jsonl");
    await writeFile(activePath, "x".repeat(2049), "utf8");

    await assert.rejects(
        telemetry.writeTelemetryEvent("bot.error", { phase: "blocked" }),
        /migration required/i
    );
    assert.equal((await stat(activePath)).size, 2049, "oversized file must remain untouched");

    await rm(activePath);
    await telemetry.writeTelemetryEvent("bot.error", { phase: "recovered" });
    const events = await readEvents(activePath);
    assert.equal((events[0].payload as { phase?: string }).phase, "recovered");
}

async function testInvalidRetentionConfigurationFallsBack(): Promise<void> {
    assert.deepEqual(
        telemetry.resolveTelemetryRetentionConfig({
            rotateBytes: "invalid",
            maxTotalBytes: "-1",
        }),
        {
            rotateBytes: 256 * 1024 * 1024,
            maxTotalBytes: 5 * 1024 * 1024 * 1024,
            warnings: [
                "Invalid TELEMETRY_ROTATE_BYTES=invalid; using 268435456",
                "Invalid TELEMETRY_MAX_TOTAL_BYTES=-1; using 5368709120",
            ],
        }
    );
}

async function testHistoricalSessionWriteDoesNotPolluteActiveSession(): Promise<void> {
    await resetStore();
    const activeSession = await telemetry.startTelemetrySession("PAPER");
    const historicalSessionPath = join(telemetryRoot, "sessions", "historical-session.jsonl");

    await telemetry.writeTelemetryEventToSession(
        "trade.shadow_pnl",
        { signalId: "signal-1", settlementStatus: "resolved" },
        {
            botId: "polymarket-bot-v5",
            sessionId: "historical-session",
            sessionStartedAt: "2026-07-15T00:00:00.000Z",
            sessionPath: historicalSessionPath,
            originHost: "test-host",
            versionContext: null,
        },
    );

    const historicalEvents = await readEvents(historicalSessionPath);
    assert.equal(historicalEvents.length, 1);
    assert.equal(historicalEvents[0].sessionId, "historical-session");
    assert.equal((historicalEvents[0].payload as { signalId?: string }).signalId, "signal-1");
    await assert.rejects(readFile(activeSession.sessionPath, "utf8"), /ENOENT/);

    const managedEvents = await readEvents(join(telemetryRoot, "events.jsonl"));
    assert.equal(managedEvents.length, 1);
    assert.equal(managedEvents[0].sessionId, "historical-session");
}

async function testFeedTickTelemetryIsThrottled(): Promise<void> {
    await resetStore();

    await telemetry.writeTelemetryEvent("feed.tick", { seq: 1 });
    await telemetry.writeTelemetryEvent("feed.tick", { seq: 2 });
    await telemetry.writeTelemetryEvent("feed.tick", { seq: 3 });

    const events = await readEvents(join(telemetryRoot, "events.jsonl"));
    assert.equal(events.length, 1, "expected feed.tick writes inside the throttle window to collapse");
    assert.equal((events[0].payload as { seq?: number }).seq, 1);
}

async function run(): Promise<void> {
    try {
        await testRotationPruningAndLegacyPreservation();
        await testConcurrentWritesRemainComplete();
        await testQueueRecoversAfterOversizedFileError();
        await testInvalidRetentionConfigurationFallsBack();
        await testHistoricalSessionWriteDoesNotPolluteActiveSession();
        await testFeedTickTelemetryIsThrottled();
        console.log("telemetry rotation tests passed");
    } finally {
        telemetry.__resetTelemetryModuleState();
        await rm(telemetryRoot, { recursive: true, force: true });
    }
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
