import { appendFile, mkdir, readFile, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { randomUUID } from "crypto";
import { readOptionalConfigEnv } from "../config/secrets";

export type TelemetryEventType =
    | "bot.startup"
    | "bot.startup_config"
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
    | "feed.disconnected"
    | "feed.reconnect_scheduled"
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
    | "trade.entry_filled"
    | "trade.exit_attempt"
    | "trade.exit_pending"
    | "trade.exit_partial"
    | "trade.exit_filled"
    | "trade.exit_failed"
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
    sessionId?: string;
    sessionStartedAt?: string;
    versionContext?: Record<string, unknown>;
}

interface TelemetrySession {
    botId: string;
    id: string;
    startedAt: string;
    mode: "PAPER" | "LIVE";
    sessionPath: string;
}

interface PersistedPaperBalance {
    botId: string | null;
    balance: number;
    updatedAt: string;
    sessionId: string | null;
    sessionStartedAt: string | null;
}

const DEFAULT_BOT_ID = "polymarket-bot-v5";
const BOT_ID = readOptionalConfigEnv("BOT_ID")
    || readOptionalConfigEnv("BOT_INSTANCE_ID")
    || DEFAULT_BOT_ID;

const TELEMETRY_ROOT = resolve(
    __dirname,
    "..",
    "..",
    "..",
    "polydb",
    "telemetry"
);
const TELEMETRY_DB_PATH = resolve(TELEMETRY_ROOT, "events.jsonl");
const TELEMETRY_SESSIONS_DIR = resolve(TELEMETRY_ROOT, "sessions");
const LEGACY_PAPER_BALANCE_STATE_PATH = resolve(TELEMETRY_ROOT, "paper-balance.json");

let telemetryReady: Promise<void> | null = null;
let telemetrySession: TelemetrySession | null = null;
let telemetryVersionContext: Record<string, unknown> | null = null;

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

function roundCurrency(value: number): number {
    return Math.round(value * 100) / 100;
}

function getPaperBalanceStatePath(botId: string): string {
    return resolve(TELEMETRY_ROOT, `paper-balance.${botId}.json`);
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
    await ensureTelemetryStore();

    const event: TelemetryEvent<TPayload> = {
        type,
        payload,
        timestamp: new Date().toISOString(),
        botId: telemetrySession?.botId ?? BOT_ID,
        sessionId: telemetrySession?.id,
        sessionStartedAt: telemetrySession?.startedAt,
        versionContext: telemetryVersionContext ?? undefined,
    };

    const serialized = `${JSON.stringify(event)}\n`;
    await appendFile(TELEMETRY_DB_PATH, serialized, "utf8");

    if (telemetrySession) {
        await appendFile(telemetrySession.sessionPath, serialized, "utf8");
    }
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
