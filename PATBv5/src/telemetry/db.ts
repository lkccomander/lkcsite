import { appendFile, copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "fs/promises";
import os from "os";
import { basename, dirname, resolve } from "path";
import { randomUUID } from "crypto";
import { readOptionalConfigEnv } from "../config/secrets";

export type TelemetryEventType =
    | "bot.startup"
    | "bot.startup_config"
    | "live_balance.checkpoint"
    | "operator.manual_trade_requested"
    | "operator.manual_trade_rejected"
    | "operator.manual_trade_executed"
    | "signal.momentum"
    | "signal.montecarlo"
    | "paper_balance.checkpoint"
    | "collateral.guard_started"
    | "collateral.egress_allowed"
    | "collateral.egress_blocked"
    | "collateral.guard_error"
    | "collateral.guard_unavailable"
    | "market.selected"
    | "market.external_reference"
    | "market.tokens_resolved"
    | "market.fetch_failed"
    | "market.snapshot_rejected"
    | "feed.connected"
    | "feed.subscription"
    | "feed.transition"
    | "feed.disconnected"
    | "feed.reconnect_scheduled"
    | "feed.reconnect_forced"
    | "feed.error"
    | "feed.book_update_ignored"
    | "feed.rtt"
    | "feed.tick"
    | "feed.stale"
    | "feed.fallback"
    | "feed.fallback_recovered"
    | "feed.summary"
    | "trade.signal_rejected"
    | "trade.signal_accepted"
    | "trade.shadow_pnl"
    | "trade.entry_posted"
    | "trade.entry_filled"
    | "trade.entry_timeout"
    | "trade.entry_order_status_after_timeout"
    | "trade.exit_attempt"
    | "trade.exit_pending"
    | "trade.exit_partial"
    | "trade.exit_filled"
    | "trade.exit_failed"
    | "trade.exit_submission_uncertain"
    | "trade.exit_skipped_existing_live_order"
    | "trade.exit_skipped_stale_snapshot"
    | "trade.exit_balance_reserved_by_live_order"
    | "trade.position_resolved"
    | "trade.position_unresolved"
    | "exit.stop_loss_eval"
    | "exit.sl_spread_wait"
    | "exit.sl_spread_wait_result"
    | "exit.sl_cancelled_recovered"
    | "simulated_order_flow"
    | "live_trade.buy"
    | "live_trade.sell"
    | "paper_trade.buy"
    | "paper_trade.sell"
    | "bot.shutdown"
    | "bot.error";

export interface TelemetryEvent<TPayload = Record<string, unknown>> {
    type: TelemetryEventType;
    payload: TPayload;
    timestamp: string;
    botId?: string;
    originHost?: string;
    sessionId?: string;
    sessionStartedAt?: string;
    versionContext?: Record<string, unknown>;
}

export interface TelemetrySession {
    botId: string;
    id: string;
    originHost: string | null;
    startedAt: string;
    mode: "PAPER" | "LIVE";
    sessionPath: string;
}

export interface TelemetrySessionTarget {
    botId: string;
    sessionId: string;
    sessionStartedAt: string;
    sessionPath: string;
    originHost: string | null;
    versionContext: Record<string, unknown> | null;
}

interface PersistedPaperBalance {
    botId: string | null;
    balance: number;
    updatedAt: string;
    sessionId: string | null;
    sessionStartedAt: string | null;
}

export interface TelemetryRetentionConfig {
    rotateBytes: number;
    maxTotalBytes: number;
    warnings: string[];
}

const DEFAULT_TELEMETRY_ROTATE_BYTES = 256 * 1024 * 1024;
const DEFAULT_TELEMETRY_MAX_TOTAL_BYTES = 5 * 1024 * 1024 * 1024;

export function resolveTelemetryRetentionConfig(input: {
    rotateBytes?: string;
    maxTotalBytes?: string;
}): TelemetryRetentionConfig {
    const warnings: string[] = [];

    const parseLimit = (name: string, raw: string | undefined, fallback: number): number => {
        if (raw === undefined || raw.trim().length === 0) {
            return fallback;
        }

        const value = Number(raw);
        if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(value) || value <= 0) {
            warnings.push(`Invalid ${name}=${raw}; using ${fallback}`);
            return fallback;
        }

        return value;
    };

    const rotateBytes = parseLimit(
        "TELEMETRY_ROTATE_BYTES",
        input.rotateBytes,
        DEFAULT_TELEMETRY_ROTATE_BYTES
    );
    let maxTotalBytes = parseLimit(
        "TELEMETRY_MAX_TOTAL_BYTES",
        input.maxTotalBytes,
        DEFAULT_TELEMETRY_MAX_TOTAL_BYTES
    );

    if (maxTotalBytes < rotateBytes) {
        maxTotalBytes = Math.max(DEFAULT_TELEMETRY_MAX_TOTAL_BYTES, rotateBytes);
        warnings.push(
            `TELEMETRY_MAX_TOTAL_BYTES must be at least TELEMETRY_ROTATE_BYTES; using ${maxTotalBytes}`
        );
    }

    return { rotateBytes, maxTotalBytes, warnings };
}

const DEFAULT_BOT_ID = "polymarket-bot-v5";
const BOT_ID = readOptionalConfigEnv("BOT_ID")
    || readOptionalConfigEnv("BOT_INSTANCE_ID")
    || DEFAULT_BOT_ID;

const configuredTelemetryRoot = readOptionalConfigEnv("TELEMETRY_ROOT")
    || readOptionalConfigEnv("BOT_TELEMETRY_ROOT");
const TELEMETRY_ROOT = configuredTelemetryRoot
    ? resolve(configuredTelemetryRoot)
    : resolve(
        __dirname,
        "..",
        "..",
        "..",
        "polydb",
        "telemetry"
    );
const TELEMETRY_DB_PATH = resolve(TELEMETRY_ROOT, "events.jsonl");
const TELEMETRY_SESSIONS_DIR = resolve(TELEMETRY_ROOT, "sessions");
const COMPLETED_SESSION_SHARE_DIR = readOptionalConfigEnv("TELEMETRY_COMPLETED_SESSIONS_DIR");
const LEGACY_PAPER_BALANCE_STATE_PATH = resolve(TELEMETRY_ROOT, "paper-balance.json");
const telemetryRetentionConfig = resolveTelemetryRetentionConfig({
    rotateBytes: readOptionalConfigEnv("TELEMETRY_ROTATE_BYTES"),
    maxTotalBytes: readOptionalConfigEnv("TELEMETRY_MAX_TOTAL_BYTES"),
});
for (const warning of telemetryRetentionConfig.warnings) {
    console.warn(`Telemetry retention configuration: ${warning}`);
}

let telemetryReady: Promise<void> | null = null;
let telemetrySession: TelemetrySession | null = null;
let telemetryVersionContext: Record<string, unknown> | null = null;
let telemetryOriginHost: string | null = resolveOriginHost();
let telemetryWriteQueue: Promise<void> = Promise.resolve();
let lastArchiveTimestampMs = 0;

const MANAGED_ARCHIVE_PATTERN = /^events\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.jsonl$/;

async function ensureTelemetryStore(): Promise<void> {
    if (!telemetryReady) {
        telemetryReady = Promise.all([
            mkdir(dirname(TELEMETRY_DB_PATH), { recursive: true }),
            mkdir(TELEMETRY_SESSIONS_DIR, { recursive: true }),
        ]).then(() => undefined);
    }

    await telemetryReady;
}

function toSessionTimestamp(isoTimestamp: string): string {
    return isoTimestamp.replace(/[:.]/g, "-");
}

function isMissingFileError(error: unknown): boolean {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function getFileSize(path: string): Promise<number> {
    try {
        return (await stat(path)).size;
    } catch (error) {
        if (isMissingFileError(error)) {
            return 0;
        }
        throw error;
    }
}

function nextManagedArchivePath(): string {
    const timestampMs = Math.max(Date.now(), lastArchiveTimestampMs + 1);
    lastArchiveTimestampMs = timestampMs;
    const timestamp = toSessionTimestamp(new Date(timestampMs).toISOString());
    return resolve(TELEMETRY_ROOT, `events.${timestamp}.jsonl`);
}

async function pruneManagedArchives(activeSize: number): Promise<void> {
    const names = (await readdir(TELEMETRY_ROOT))
        .filter((name) => MANAGED_ARCHIVE_PATTERN.test(name))
        .sort();
    const archives: Array<{ path: string; size: number }> = [];

    for (const name of names) {
        const path = resolve(TELEMETRY_ROOT, name);
        archives.push({ path, size: await getFileSize(path) });
    }

    let totalSize = activeSize + archives.reduce((total, archive) => total + archive.size, 0);
    for (const archive of archives) {
        if (totalSize <= telemetryRetentionConfig.maxTotalBytes) {
            break;
        }
        await unlink(archive.path);
        totalSize -= archive.size;
    }
}

async function appendSerializedTelemetryEvent(
    serialized: string,
    targetSessionPath?: string | null,
): Promise<void> {
    await ensureTelemetryStore();

    const eventSize = Buffer.byteLength(serialized, "utf8");
    if (eventSize > telemetryRetentionConfig.maxTotalBytes) {
        throw new Error(
            `Telemetry event is ${eventSize} bytes, above TELEMETRY_MAX_TOTAL_BYTES=${telemetryRetentionConfig.maxTotalBytes}`
        );
    }

    const activeSize = await getFileSize(TELEMETRY_DB_PATH);
    if (activeSize > telemetryRetentionConfig.maxTotalBytes) {
        throw new Error(
            `Telemetry migration required: ${TELEMETRY_DB_PATH} is ${activeSize} bytes, above the managed limit of ${telemetryRetentionConfig.maxTotalBytes}`
        );
    }

    let rotated = false;
    if (activeSize > 0 && activeSize + eventSize > telemetryRetentionConfig.rotateBytes) {
        await rename(TELEMETRY_DB_PATH, nextManagedArchivePath());
        rotated = true;
    }

    await appendFile(TELEMETRY_DB_PATH, serialized, "utf8");

    const sessionPath = targetSessionPath === undefined
        ? telemetrySession?.sessionPath ?? null
        : targetSessionPath;
    if (sessionPath) {
        await mkdir(dirname(sessionPath), { recursive: true });
        await appendFile(sessionPath, serialized, "utf8");
    }

    if (rotated) {
        try {
            await pruneManagedArchives(eventSize);
        } catch (error) {
            console.warn("Telemetry archive pruning failed; will retry after a later rotation:", error);
        }
    }
}

function enqueueTelemetryWrite(operation: () => Promise<void>): Promise<void> {
    const result = telemetryWriteQueue.then(operation);
    telemetryWriteQueue = result.catch(() => undefined);
    return result;
}

function roundCurrency(value: number): number {
    return Math.round(value * 100) / 100;
}

function getPaperBalanceStatePath(botId: string): string {
    return resolve(TELEMETRY_ROOT, `paper-balance.${botId}.json`);
}

function resolveOriginHost(): string | null {
    try {
        const host = os.hostname().trim();
        return host.length > 0 ? host : null;
    } catch {
        return null;
    }
}

export async function startTelemetrySession(mode: "PAPER" | "LIVE"): Promise<TelemetrySession> {
    await ensureTelemetryStore();

    const startedAt = new Date().toISOString();
    const id = randomUUID();
    const sessionPath = resolve(
        TELEMETRY_SESSIONS_DIR,
        `${toSessionTimestamp(startedAt)}__${id}.jsonl`
    );

    telemetrySession = {
        botId: BOT_ID,
        id,
        originHost: telemetryOriginHost,
        startedAt,
        mode,
        sessionPath,
    };

    return telemetrySession;
}

export function getTelemetrySession(): TelemetrySession | null {
    return telemetrySession;
}

export function getTelemetryBotId(): string {
    return BOT_ID;
}

export function setTelemetryVersionContext(versionContext: Record<string, unknown> | null): void {
    telemetryVersionContext = versionContext;
}

export function getTelemetryVersionContext(): Record<string, unknown> | null {
    return telemetryVersionContext;
}

export async function writeTelemetryEvent<TPayload = Record<string, unknown>>(
    type: TelemetryEventType,
    payload: TPayload
): Promise<void> {
    const event: TelemetryEvent<TPayload> = {
        type,
        payload,
        timestamp: new Date().toISOString(),
        botId: telemetrySession?.botId ?? BOT_ID,
        originHost: telemetrySession?.originHost ?? telemetryOriginHost ?? undefined,
        sessionId: telemetrySession?.id,
        sessionStartedAt: telemetrySession?.startedAt,
        versionContext: telemetryVersionContext ?? undefined,
    };

    const serialized = `${JSON.stringify(event)}\n`;
    await enqueueTelemetryWrite(() => appendSerializedTelemetryEvent(serialized));
}

export async function writeTelemetryEventToSession<TPayload = Record<string, unknown>>(
    type: TelemetryEventType,
    payload: TPayload,
    target: TelemetrySessionTarget,
): Promise<void> {
    const event: TelemetryEvent<TPayload> = {
        type,
        payload,
        timestamp: new Date().toISOString(),
        botId: target.botId,
        originHost: target.originHost ?? undefined,
        sessionId: target.sessionId,
        sessionStartedAt: target.sessionStartedAt,
        versionContext: target.versionContext ?? undefined,
    };

    const serialized = `${JSON.stringify(event)}\n`;
    await enqueueTelemetryWrite(() => appendSerializedTelemetryEvent(serialized, target.sessionPath));
}

export async function writeTelemetryEventSafe<TPayload = Record<string, unknown>>(
    type: TelemetryEventType,
    payload: TPayload
): Promise<void> {
    try {
        await writeTelemetryEvent(type, payload);
    } catch (error) {
        console.error("Telemetry write failed:", error);
    }
}

export function getTelemetryDbPath(): string {
    return TELEMETRY_DB_PATH;
}

export function getTelemetrySessionsDir(): string {
    return TELEMETRY_SESSIONS_DIR;
}

/** Best-effort archival of a closed session. Failure must never block shutdown. */
export async function archiveCompletedTelemetrySession(): Promise<string | null> {
    const session = telemetrySession;
    if (!session || !COMPLETED_SESSION_SHARE_DIR) return null;
    const target = resolve(COMPLETED_SESSION_SHARE_DIR, basename(session.sessionPath));
    if (target === session.sessionPath) return target;
    await mkdir(dirname(target), { recursive: true });
    await copyFile(session.sessionPath, target);
    return target;
}

export function __resetTelemetryModuleState(): void {
    telemetryReady = null;
    telemetrySession = null;
    telemetryVersionContext = null;
    telemetryOriginHost = resolveOriginHost();
    telemetryWriteQueue = Promise.resolve();
    lastArchiveTimestampMs = 0;
}

export function __setTelemetryOriginHostForTests(originHost: string | null): void {
    telemetryOriginHost = originHost && originHost.trim().length > 0 ? originHost.trim() : null;
    if (telemetrySession) {
        telemetrySession.originHost = telemetryOriginHost;
    }
}

export async function loadPersistedPaperBalance(defaultBalance: number): Promise<number> {
    try {
        const raw = await readFile(getPaperBalanceStatePath(BOT_ID), "utf8");
        const parsed = JSON.parse(raw) as PersistedPaperBalance;
        const balance = Number(parsed.balance);
        return Number.isFinite(balance) && balance >= 0 ? roundCurrency(balance) : defaultBalance;
    } catch {
        try {
            const raw = await readFile(LEGACY_PAPER_BALANCE_STATE_PATH, "utf8");
            const parsed = JSON.parse(raw) as PersistedPaperBalance;
            const legacyBotId = parsed.botId?.trim();
            if (legacyBotId && legacyBotId != BOT_ID) {
                return defaultBalance;
            }
            const balance = Number(parsed.balance);
            return Number.isFinite(balance) && balance >= 0 ? roundCurrency(balance) : defaultBalance;
        } catch {
            return defaultBalance;
        }
    }
}

export async function savePersistedPaperBalance(balance: number): Promise<void> {
    await ensureTelemetryStore();

    const roundedBalance = roundCurrency(balance);
    const snapshot: PersistedPaperBalance = {
        botId: telemetrySession?.botId ?? BOT_ID,
        balance: roundedBalance,
        updatedAt: new Date().toISOString(),
        sessionId: telemetrySession?.id ?? null,
        sessionStartedAt: telemetrySession?.startedAt ?? null,
    };

    await writeFile(getPaperBalanceStatePath(BOT_ID), JSON.stringify(snapshot, null, 2), "utf8");
}
