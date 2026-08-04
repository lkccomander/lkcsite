import assert from "node:assert/strict";
import { createShutdownCoordinator } from "../src/control/shutdownCoordinator";

async function run(): Promise<void> {
  let calls = 0;
  let observedReason = "";
  const requestShutdown = createShutdownCoordinator(async (reason) => {
    calls += 1;
    observedReason = reason;
    await Promise.resolve();
  });
  await Promise.all([requestShutdown("CONTROL_STOP"), requestShutdown("SIGINT"), requestShutdown("SIGTERM")]);
  assert.equal(calls, 1);
  assert.equal(observedReason, "CONTROL_STOP");
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
