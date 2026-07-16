import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    listPendingShadowSettlementBatches,
    persistPendingShadowSettlementBatch,
    reconcilePendingShadowSettlementBatch,
    type PendingShadowSettlementBatch,
} from "../src/trade/policy/shadowSettlementQueue";

function batch(batchId: string): PendingShadowSettlementBatch {
    return {
        schemaVersion: 1,
        batchId,
        marketSlug: "btc-updown-5m-test",
        strategy: "trade_5x",
        queuedAt: "2026-07-15T00:00:00.000Z",
        originSession: {
            botId: "polymarket-bot-v5",
            sessionId: "session-test",
            sessionStartedAt: "2026-07-15T00:00:00.000Z",
            sessionPath: "C:\\telemetry\\session-test.jsonl",
            originHost: "test-host",
            versionContext: null,
        },
        signals: [
            {
                signalId: `${batchId}-signal-1`,
                reason: "entry_latency_gate",
                rejectedAt: "2026-07-15T00:01:00.000Z",
                preferredSide: "UP",
                preferredEntryPrice: 0.6,
                upBuyPrice: 0.6,
                upSellPrice: 0.59,
                downBuyPrice: 0.41,
                downSellPrice: 0.4,
                feedAgeMs: 800,
                feedLatencyMs: 0,
                feedRttMs: 170,
            },
            {
                signalId: `${batchId}-signal-2`,
                reason: "low_convergence",
                rejectedAt: "2026-07-15T00:01:01.000Z",
                preferredSide: "DOWN",
                preferredEntryPrice: 0.41,
                upBuyPrice: 0.6,
                upSellPrice: 0.59,
                downBuyPrice: 0.41,
                downSellPrice: 0.4,
                feedAgeMs: 40,
                feedLatencyMs: 0,
                feedRttMs: 168,
            },
        ],
        emittedSignalIds: [],
    };
}

async function run(): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), "patbv5-shadow-queue-"));

    try {
        const firstBatch = batch("batch-timeout");
        await persistPendingShadowSettlementBatch(directory, firstBatch);

        const loaded = await listPendingShadowSettlementBatches(directory);
        assert.equal(loaded.length, 1);
        assert.equal(loaded[0].batchId, firstBatch.batchId);
        assert.equal(loaded[0].signals.length, 2);

        const emittedAfterTimeout: string[] = [];
        const pending = await reconcilePendingShadowSettlementBatch(directory, firstBatch, {
            fetchMarket: async () => ({
                closed: false,
                outcomes: '["Up", "Down"]',
                outcomePrices: '["0.5", "0.5"]',
            }),
            emitResolvedSignal: async ({ signal }) => {
                emittedAfterTimeout.push(signal.signalId);
            },
            pollOptions: { attempts: 1, intervalMs: 0, sleepFn: async () => undefined },
        });
        assert.equal(pending.status, "pending");
        assert.deepEqual(emittedAfterTimeout, []);
        assert.equal((await listPendingShadowSettlementBatches(directory)).length, 1);

        const emittedAfterResolution: string[] = [];
        const resolved = await reconcilePendingShadowSettlementBatch(directory, firstBatch, {
            fetchMarket: async () => ({
                closed: true,
                outcomes: '["Up", "Down"]',
                outcomePrices: '["1", "0"]',
            }),
            emitResolvedSignal: async ({ signal, settlement }) => {
                assert.equal(settlement.status, "resolved");
                emittedAfterResolution.push(signal.signalId);
            },
            pollOptions: { attempts: 1, intervalMs: 0, sleepFn: async () => undefined },
        });
        assert.equal(resolved.status, "resolved");
        assert.deepEqual(emittedAfterResolution, ["batch-timeout-signal-1", "batch-timeout-signal-2"]);
        assert.equal((await listPendingShadowSettlementBatches(directory)).length, 0);

        const restartBatch = batch("batch-restart");
        await persistPendingShadowSettlementBatch(directory, restartBatch);
        const firstAttemptEmitted: string[] = [];
        await assert.rejects(
            reconcilePendingShadowSettlementBatch(directory, restartBatch, {
                fetchMarket: async () => ({
                    closed: true,
                    outcomes: ["Up", "Down"],
                    outcomePrices: [0, 1],
                }),
                emitResolvedSignal: async ({ signal }) => {
                    firstAttemptEmitted.push(signal.signalId);
                    if (signal.signalId.endsWith("signal-2")) {
                        throw new Error("simulated telemetry interruption");
                    }
                },
                pollOptions: { attempts: 1, intervalMs: 0, sleepFn: async () => undefined },
            }),
            /simulated telemetry interruption/,
        );
        assert.deepEqual(firstAttemptEmitted, ["batch-restart-signal-1", "batch-restart-signal-2"]);

        const [persistedAfterFailure] = await listPendingShadowSettlementBatches(directory);
        assert.deepEqual(persistedAfterFailure.emittedSignalIds, ["batch-restart-signal-1"]);

        const emittedAfterRestart: string[] = [];
        const recovered = await reconcilePendingShadowSettlementBatch(directory, persistedAfterFailure, {
            fetchMarket: async () => ({
                closed: true,
                outcomes: ["Up", "Down"],
                outcomePrices: [0, 1],
            }),
            emitResolvedSignal: async ({ signal }) => {
                emittedAfterRestart.push(signal.signalId);
            },
            pollOptions: { attempts: 1, intervalMs: 0, sleepFn: async () => undefined },
        });
        assert.equal(recovered.status, "resolved");
        assert.deepEqual(emittedAfterRestart, ["batch-restart-signal-2"]);
        assert.equal((await listPendingShadowSettlementBatches(directory)).length, 0);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
