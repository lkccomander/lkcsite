import assert from "assert/strict";
import { stat } from "fs/promises";
import { runIsolatedTest } from "../scripts/run_isolated_test";

async function run(): Promise<void> {
    const result = await runIsolatedTest("tests/fixtures/isolated_test_probe.ts", [], "ignore");
    assert.equal(result.exitCode, 0);
    await assert.rejects(stat(result.telemetryRoot), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    console.log("isolated test runner tests passed");
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
