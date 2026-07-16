import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
    pollForGammaSettlement,
    type PollOptions,
    type ResolvedShadowSettlement,
    type ShadowSettlement,
} from "./shadowSettlement";

export interface PendingShadowSignal {
    signalId: string;
    reason: string;
    rejectedAt: string;
    preferredSide: "UP" | "DOWN";
    preferredEntryPrice: number | null;
    upBuyPrice: number;
    upSellPrice: number;
    downBuyPrice: number;
    downSellPrice: number;
    feedAgeMs: number | null;
    feedLatencyMs: number | null;
    feedRttMs: number | null;
}

export interface ShadowSettlementOriginSession {
    botId: string;
    sessionId: string;
    sessionStartedAt: string;
    sessionPath: string;
    originHost: string | null;
    versionContext: Record<string, unknown> | null;
}

export interface PendingShadowSettlementBatch {
    schemaVersion: 1;
    batchId: string;
    marketSlug: string;
    strategy: string;
    queuedAt: string;
    originSession: ShadowSettlementOriginSession;
    signals: PendingShadowSignal[];
    emittedSignalIds: string[];
}

export interface ReconcileShadowSettlementDependencies {
    fetchMarket: () => Promise<unknown>;
    emitResolvedSignal: (context: {
        batch: PendingShadowSettlementBatch;
        signal: PendingShadowSignal;
        settlement: ResolvedShadowSettlement;
    }) => Promise<void>;
    pollOptions?: PollOptions;
}

export type ShadowSettlementReconcileResult =
    | {
        status: "pending";
        batch: PendingShadowSettlementBatch;
        settlement: ShadowSettlement;
    }
    | {
        status: "resolved";
        batchId: string;
        emittedCount: number;
        settlement: ResolvedShadowSettlement;
    };

function assertSafeBatchId(batchId: string): void {
    if (!/^[a-zA-Z0-9._-]+$/.test(batchId)) {
        throw new Error(`Invalid shadow settlement batch id: ${batchId}`);
    }
}

function batchPath(directory: string, batchId: string): string {
    assertSafeBatchId(batchId);
    return join(directory, `${batchId}.json`);
}

function validateBatch(value: unknown, source: string): PendingShadowSettlementBatch {
    if (!value || typeof value !== "object") {
        throw new Error(`Invalid shadow settlement batch in ${source}`);
    }

    const batch = value as Partial<PendingShadowSettlementBatch>;
    if (
        batch.schemaVersion !== 1
        || typeof batch.batchId !== "string"
        || typeof batch.marketSlug !== "string"
        || typeof batch.strategy !== "string"
        || typeof batch.queuedAt !== "string"
        || !batch.originSession
        || !Array.isArray(batch.signals)
        || !Array.isArray(batch.emittedSignalIds)
    ) {
        throw new Error(`Invalid shadow settlement batch schema in ${source}`);
    }

    assertSafeBatchId(batch.batchId);
    const signalIds = batch.signals.map((signal) => signal.signalId);
    if (signalIds.some((signalId) => typeof signalId !== "string" || !signalId)) {
        throw new Error(`Shadow settlement batch ${batch.batchId} contains an invalid signal id`);
    }
    if (new Set(signalIds).size !== signalIds.length) {
        throw new Error(`Shadow settlement batch ${batch.batchId} contains duplicate signal ids`);
    }

    return batch as PendingShadowSettlementBatch;
}

async function readPendingBatch(directory: string, batchId: string): Promise<PendingShadowSettlementBatch> {
    const path = batchPath(directory, batchId);
    const raw = await readFile(path, "utf8");
    return validateBatch(JSON.parse(raw), path);
}

export async function persistPendingShadowSettlementBatch(
    directory: string,
    value: PendingShadowSettlementBatch,
): Promise<void> {
    const batch = validateBatch(value, "memory");
    await mkdir(directory, { recursive: true });

    const path = batchPath(directory, batch.batchId);
    const temporaryPath = join(directory, `.${batch.batchId}.${process.pid}.${randomUUID()}.tmp`);
    await writeFile(temporaryPath, `${JSON.stringify(batch, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
}

export async function listPendingShadowSettlementBatches(
    directory: string,
): Promise<PendingShadowSettlementBatch[]> {
    await mkdir(directory, { recursive: true });
    const names = await readdir(directory);
    const batches: PendingShadowSettlementBatch[] = [];

    for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
        const path = join(directory, name);
        const raw = await readFile(path, "utf8");
        batches.push(validateBatch(JSON.parse(raw), path));
    }

    return batches.sort((left, right) => left.queuedAt.localeCompare(right.queuedAt));
}

export async function reconcilePendingShadowSettlementBatch(
    directory: string,
    requestedBatch: PendingShadowSettlementBatch,
    dependencies: ReconcileShadowSettlementDependencies,
): Promise<ShadowSettlementReconcileResult> {
    const batch = await readPendingBatch(directory, requestedBatch.batchId);
    const settlement = await pollForGammaSettlement(
        dependencies.fetchMarket,
        dependencies.pollOptions,
    );

    if (settlement.status !== "resolved") {
        return { status: "pending", batch, settlement };
    }

    const emittedSignalIds = new Set(batch.emittedSignalIds);
    let emittedCount = 0;

    for (const signal of batch.signals) {
        if (emittedSignalIds.has(signal.signalId)) {
            continue;
        }

        await dependencies.emitResolvedSignal({ batch, signal, settlement });
        emittedSignalIds.add(signal.signalId);
        batch.emittedSignalIds = [...emittedSignalIds];
        await persistPendingShadowSettlementBatch(directory, batch);
        emittedCount += 1;
    }

    await rm(batchPath(directory, batch.batchId), { force: true });
    return {
        status: "resolved",
        batchId: batch.batchId,
        emittedCount,
        settlement,
    };
}
