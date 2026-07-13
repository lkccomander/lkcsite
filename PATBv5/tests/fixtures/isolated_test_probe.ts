import assert from "assert/strict";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

async function run(): Promise<void> {
    const telemetryRoot = process.env.TELEMETRY_ROOT;
    assert.ok(telemetryRoot, "isolated runner must set TELEMETRY_ROOT");
    assert.equal(process.env.BOT_TELEMETRY_ROOT, telemetryRoot);
    await mkdir(telemetryRoot, { recursive: true });
    await writeFile(join(telemetryRoot, "probe.txt"), "isolated", "utf8");
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
