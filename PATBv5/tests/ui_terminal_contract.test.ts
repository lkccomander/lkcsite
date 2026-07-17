import assert from "node:assert/strict";
import { buildMockTerminalState } from "../src/ui/state/mockTerminalState";

async function run(): Promise<void> {
  const state = await buildMockTerminalState("live");
  assert.equal(state.meta.sourceMode, "mock");
  assert.ok(state.sessionSummary);
  assert.ok(Array.isArray(state.sessionSummary.pnlHistory));
  assert.ok(Array.isArray(state.activityFeed));
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
