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
        "trade_5x_close31_down_paper_learning",
        "the paper learning profile must be the active strategy for tracing",
    );

    const control = config.trade_5x_close31_paper;
    const experiment = config.trade_5x_close31_down_paper;
    const relaxed = config.trade_5x_close31_down_paper_relaxed;
    const learning = config.trade_5x_close31_down_paper_learning;
    assert.ok(control, "missing trade_5x_close31_paper control profile");
    assert.ok(experiment, "missing trade_5x_close31_down_paper experiment profile");
    assert.ok(relaxed, "missing trade_5x_close31_down_paper_relaxed experiment profile");
    assert.ok(learning, "missing trade_5x_close31_down_paper_learning profile");

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
    assert.deepEqual(relaxed.entry_price_ratio, [0.10, 0.36]);
    assert.equal(relaxed.min_entry_price, 0.43);
    assert.equal(relaxed.max_entry_price, 0.87);
    assert.equal(relaxed.max_entry_feed_latency_ms, 400);
    assert.equal(relaxed.max_entry_feed_rtt_ms, 650);
    assert.equal(relaxed.max_entry_feed_age_ms, 700);
    assert.equal(relaxed.max_feed_age_ms, 500);
    assert.equal(relaxed.down_min_mc_convergence, 0.60);
    assert.equal(relaxed.max_allowed_spread, 0.03);
    assert.equal(relaxed.down_block_neutral_momentum, true);
    assert.equal(relaxed.up_require_directional_momentum, true);
    assert.equal(relaxed.up_require_mc_direction_agreement, true);
    assert.equal(relaxed.up_min_btc_delta1m, 0.0005);
    assert.equal(relaxed.up_min_momentum_confidence, 0.35);
    assert.equal(relaxed.up_min_mc_convergence, 0.70);
    assert.equal(learning.paper_disable_up_entries, false);
    assert.equal(learning.entry_time_ratio, 0.06);
    assert.equal(learning.latest_entry_seconds_before_close, 12);
    assert.deepEqual(learning.entry_price_ratio, [0.08, 0.46]);
    assert.equal(learning.min_entry_price, 0.40);
    assert.equal(learning.max_entry_price, 0.90);
    assert.equal(learning.max_entry_feed_latency_ms, 500);
    assert.equal(learning.max_entry_feed_rtt_ms, 750);
    assert.equal(learning.max_entry_feed_age_ms, 900);
    assert.equal(learning.max_feed_age_ms, 650);
    assert.equal(learning.down_min_mc_convergence, 0.60);
    assert.equal(learning.max_allowed_spread, 0.04);
    assert.equal(learning.down_block_neutral_momentum, false);
    assert.equal(learning.up_require_directional_momentum, false);
    assert.equal(learning.up_require_mc_direction_agreement, false);
    assert.equal(learning.up_min_btc_delta1m, 0.0003);
    assert.equal(learning.up_min_momentum_confidence, 0.20);
    assert.equal(learning.up_min_mc_convergence, 0.65);
    assert.equal(getTrade4LikeConfig(config), learning);

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

        const learningPath = join(tempDir, "trade-learning.toml");
        await writeFile(
            learningPath,
            rawConfig.replace(
                /^strategy\s*=\s*"[^"]+"/m,
                'strategy = "trade_5x_close31_down_paper_learning"',
            ),
            "utf8",
        );

        (globalThis as any).__CONFIG__ = undefined;
        const learningConfig = loadConfig(learningPath);
        assert.equal(learningConfig.strategy, "trade_5x_close31_down_paper_learning");
        assert.equal(
            getTrade4LikeConfig(learningConfig),
            learningConfig.trade_5x_close31_down_paper_learning,
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
