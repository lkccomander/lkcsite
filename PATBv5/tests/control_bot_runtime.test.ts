import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBotRuntimeControl, readControlledRunConfig } from "../src/control/botRuntimeControl";
import { ControlRuntimeStore, createControlPaths } from "../src/control/runtimeStore";

async function run(): Promise<void> {
  assert.equal(readControlledRunConfig({}), null);
  assert.throws(
    () => readControlledRunConfig({ CODEX_CONTROL_RUN_ID: "bad", CODEX_CONTROL_DIR: "C:\\runtime" }),
    /valid UUID/i,
  );

  const root = await mkdtemp(join(tmpdir(), "patbv5-bot-control-"));
  try {
    const store = new ControlRuntimeStore(createControlPaths(root));
    await store.ensure();
    let stopCalls = 0;
    const control = createBotRuntimeControl({
      store,
      runId: "11111111-1111-4111-8111-111111111111",
      mode: "PAPER",
      sessionId: "session-one",
      bot: { pid: 4242, startedAt: "2026-07-16T20:00:00.000Z" },
      now: () => Date.parse("2026-07-16T20:00:01.000Z"),
      onStop: async () => { stopCalls += 1; },
      autoStart: false,
    });

    await control.publish("RUNNING");
    assert.equal((await store.readHeartbeat())?.status, "RUNNING");

    await store.writeStopRequest({ schemaVersion: 1, runId: "stale-run", requestedAt: "2026-07-16T20:00:02.000Z" });
    assert.equal(await control.pollStopRequest(), false);
    assert.equal(stopCalls, 0);

    await store.writeStopRequest({ schemaVersion: 1, runId: control.runId, requestedAt: "2026-07-16T20:00:03.000Z" });
    assert.equal(await control.pollStopRequest(), true);
    assert.equal(await control.pollStopRequest(), false);
    assert.equal(stopCalls, 1);
    assert.equal((await store.readHeartbeat())?.status, "STOPPING");

    await control.publish("SHUTDOWN_COMPLETE");
    await control.close();
    assert.equal((await store.readHeartbeat())?.status, "SHUTDOWN_COMPLETE");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
