import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

import { loadConfig } from "../src/config/toml";
import { initializeVersionContext } from "../src/telemetry/versioning";

async function run(): Promise<void> {
    const projectRoot = resolve(__dirname, "..");
    const configPath = resolve(projectRoot, "trade.toml");
    const config = loadConfig(configPath);
    const knownPaths = [
        join(projectRoot, "polydb", "evaluation", "bot_builds", "bot_v5_build_2026_08_05_001.json"),
        join(projectRoot, "PATBv5", "polydb", "evaluation", "bot_builds", "bot_v5_build_2026_08_05_001.json"),
    ];

    await access(knownPaths[0]);
    await assert.rejects(access(knownPaths[1]), /ENOENT/);

    const context = await initializeVersionContext(config);
    assert.notEqual(context.gitCommit, "unknown", "git commit should resolve inside PATBv5");
    assert.notEqual(context.botBuildVersionId, "unknown_bot_build", "bot build id should be persisted");
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
