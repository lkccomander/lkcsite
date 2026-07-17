import assert from "node:assert/strict";
import { buildLiveTerminalState } from "../src/ui/state/liveTerminalState";

async function run(): Promise<void> {
  const state = await buildLiveTerminalState();
  assert.equal(state.meta.sourceMode, "mock");
  assert.equal(state.sessionSummary.runtimeMode, "UNKNOWN");
  assert.equal(state.sessionSummary.settledTrades, 0);
  assert.deepEqual(state.activityFeed, []);
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
