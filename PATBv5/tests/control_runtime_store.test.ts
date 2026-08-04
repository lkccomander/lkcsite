import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ControlRuntimeStore, createControlPaths } from "../src/control/runtimeStore";
import type { ActiveRunRecord } from "../src/control/contracts";

async function run(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "patbv5-control-store-"));
  try {
    const paths = createControlPaths(root);
    const store = new ControlRuntimeStore(paths);
    await store.ensure();

    await store.acquireControllerLock({ pid: 100, startedAt: "2026-07-16T20:00:00.000Z" });
    await assert.rejects(
      store.acquireControllerLock({ pid: 101, startedAt: "2026-07-16T20:00:01.000Z" }),
      /controller lock already exists/i,
    );

    const active: ActiveRunRecord = {
      schemaVersion: 1,
      runId: "11111111-1111-4111-8111-111111111111",
      requestedMode: "PAPER",
      modeSource: "CONTROL_OVERRIDE",
      requestedAt: "2026-07-16T20:01:00.000Z",
      wrapper: null,
      stopRequestedAt: null,
      forceEligibleAt: null,
      logPath: join(paths.logsDir, "run.log"),
    };
    await store.createActiveRun(active);
    await assert.rejects(store.createActiveRun(active), /active run already exists/i);
    assert.deepEqual(await store.readActiveRun(), active);

    await store.writeStopRequest({ schemaVersion: 1, runId: active.runId, requestedAt: "2026-07-16T20:02:00.000Z" });
    assert.equal((await store.readStopRequest())?.runId, active.runId);
    await store.clearStopRequest(active.runId);
    assert.equal(await store.readStopRequest(), null);

    await store.appendAudit({
      schemaVersion: 1,
      timestamp: "2026-07-16T20:02:01.000Z",
      action: "stop.requested",
      outcome: "accepted",
      runId: active.runId,
      sessionId: null,
      detail: null,
    });
    const audit = await readFile(paths.audit, "utf8");
    assert.match(audit, /stop\.requested/);

    await writeFile(paths.controllerState, "\n", "utf8");
    assert.equal(await store.readControllerState(), null);

    const longLogPath = join(paths.logsDir, "long-run.log");
    await writeFile(longLogPath, [
      "x".repeat(300 * 1024),
      "tail-start",
      "API KEY = must-not-leak",
      "private-key: must-not-leak",
      "visible-one",
      "visible-two",
    ].join("\n"), "utf8");
    const logTail = await store.readLogTail(longLogPath);
    assert.deepEqual(logTail, ["tail-start", "visible-one", "visible-two"]);
    assert.doesNotMatch(logTail.join("\n"), /must-not-leak/);

    assert.equal(await store.clearActiveRun("different-run"), false);
    assert.equal(await store.clearActiveRun(active.runId), true);
    assert.equal(await store.readActiveRun(), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
