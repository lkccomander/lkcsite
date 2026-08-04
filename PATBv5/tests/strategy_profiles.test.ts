import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { getTrade4LikeConfig, loadConfig } from "../src/config/toml";

async function run(): Promise<void> {
    const projectRoot = resolve(__dirname, "..");
    const configPath = resolve(projectRoot, "trade.toml");

    (globalThis as any).__CONFIG__ = undefined;
    const config = loadConfig(configPath);

    assert.equal(
        config.strategy,
        "trade_5x_close31_paper",
        "the existing close31 PAPER profile must remain the active control",
    );

    const control = config.trade_5x_close31_paper;
    const experiment = config.trade_5x_close31_down_paper;
    const relaxed = config.trade_5x_close31_down_paper_relaxed;
    assert.ok(control, "missing trade_5x_close31_paper control profile");
    assert.ok(experiment, "missing trade_5x_close31_down_paper experiment profile");
    assert.ok(relaxed, "missing trade_5x_close31_down_paper_relaxed experiment profile");

    const {
        paper_disable_up_entries: controlDisablesUp,
        ...controlSettings
    } = control;
    const {
        paper_disable_up_entries: experimentDisablesUp,
        ...experimentSettings
    } = experiment;

    assert.equal(controlDisablesUp, false);
    assert.equal(experimentDisablesUp, false);
    assert.deepEqual(
        experimentSettings,
        controlSettings,
        "variant A should mirror the close31 PAPER control so we can isolate future changes",
    );
    assert.equal(relaxed.paper_disable_up_entries, false);
    assert.equal(relaxed.entry_time_ratio, 0.06);
    assert.equal(relaxed.latest_entry_seconds_before_close, 12);
    assert.equal(relaxed.down_min_mc_convergence, 0.60);
    assert.equal(relaxed.max_allowed_spread, 0.03);
    assert.equal(relaxed.min_entry_price, 0.43);
    assert.equal(relaxed.max_entry_price, 0.87);
    assert.equal(getTrade4LikeConfig(config), control);

    const tempDir = await mkdtemp(join(tmpdir(), "patbv5-strategy-profile-"));
    try {
        const rawConfig = await readFile(configPath, "utf8");
        const experimentPath = join(tempDir, "trade.toml");
        await writeFile(
            experimentPath,
            rawConfig.replace(
                /^strategy\s*=\s*"[^"]+"/m,
                'strategy = "trade_5x_close31_down_paper"',
            ),
            "utf8",
        );

        (globalThis as any).__CONFIG__ = undefined;
        const experimentConfig = loadConfig(experimentPath);
        assert.equal(experimentConfig.strategy, "trade_5x_close31_down_paper");
        assert.equal(
            getTrade4LikeConfig(experimentConfig),
            experimentConfig.trade_5x_close31_down_paper,
        );

        const relaxedPath = join(tempDir, "trade-relaxed.toml");
        await writeFile(
            relaxedPath,
            rawConfig.replace(
                /^strategy\s*=\s*"[^"]+"/m,
                'strategy = "trade_5x_close31_down_paper_relaxed"',
            ),
            "utf8",
        );

        (globalThis as any).__CONFIG__ = undefined;
        const relaxedConfig = loadConfig(relaxedPath);
        assert.equal(relaxedConfig.strategy, "trade_5x_close31_down_paper_relaxed");
        assert.equal(
            getTrade4LikeConfig(relaxedConfig),
            relaxedConfig.trade_5x_close31_down_paper_relaxed,
        );
    } finally {
        (globalThis as any).__CONFIG__ = undefined;
        await rm(tempDir, { recursive: true, force: true });
    }
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
