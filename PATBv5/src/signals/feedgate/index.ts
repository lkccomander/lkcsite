export type FeedGateReason =
    | "missing_websocket"
    | "entry_latency_gate"
    | "feed_ticks_too_low"
    | "recent_ws_fallback";

export type SellReason =
    | "take_profit"
    | "stop_loss"
    | "forced_exit"
    | "timeout"
    | "manual"
    | "feed_degraded"
    | "emergency_swap"
    | "session_stop_loss";

export interface FeedGateState {
    latencyMs: number | null;
    rttMs: number | null;
    ageMs: number | null;
    wsConnected: boolean | null;
    snapshotSource: string | null;
    msSinceLastFallback: number | null;
    tickTimestamps: number[];
}

export interface FeedGateConfig {
    requireWebsocket: boolean;
    rejectOnMissingWebsocket: boolean;
    recentWsFallbackCooldownMs: number;
    maxEntryFeedLatencyMs: number;
    maxEntryFeedRttMs: number;
    maxEntryFeedAgeMs: number;
    minTicksLast10s?: number;
}

export interface FeedHealth {
    latencyMs: number | null;
    rttMs: number | null;
    ticksLast10s: number;
    fallbackActive: boolean;
    lastFallbackAgo: number;
    healthy: boolean;
    rejectReason: FeedGateReason | null;
    ageMs: number | null;
    wsConnected: boolean | null;
    lastFallbackAt: string | null;
    msSinceLastFallback: number | null;
}

const TEN_SECONDS_MS = 10_000;
const NEVER_FALLBACK_MS = Number.POSITIVE_INFINITY;

function countRecentTicks(tickTimestamps: number[], nowMs: number): number {
    return tickTimestamps.filter((timestamp) => Number.isFinite(timestamp) && nowMs - timestamp <= TEN_SECONDS_MS).length;
}

export function getFeedHealth(feedState: FeedGateState, config: FeedGateConfig): FeedHealth {
    const nowMs = Date.now();
    const ticksLast10s = countRecentTicks(feedState.tickTimestamps, nowMs);
    const fallbackActive = feedState.snapshotSource === "rest";
    const lastFallbackAgo = Number.isFinite(feedState.msSinceLastFallback ?? NaN)
        ? Math.max(0, Number(feedState.msSinceLastFallback))
        : NEVER_FALLBACK_MS;
    const minTicksLast10s = Number.isFinite(config.minTicksLast10s) ? Number(config.minTicksLast10s) : 2;

    let rejectReason: FeedGateReason | null = null;

    if (config.requireWebsocket && config.rejectOnMissingWebsocket) {
        if (!feedState.wsConnected || feedState.snapshotSource !== "websocket" || fallbackActive) {
            rejectReason = "missing_websocket";
        }
    }

    if (!rejectReason && lastFallbackAgo <= config.recentWsFallbackCooldownMs) {
        rejectReason = "recent_ws_fallback";
    }

    if (!rejectReason && (
        (feedState.latencyMs !== null && feedState.latencyMs > config.maxEntryFeedLatencyMs)
        || (feedState.rttMs !== null && feedState.rttMs > config.maxEntryFeedRttMs)
        || (feedState.ageMs !== null && feedState.ageMs > config.maxEntryFeedAgeMs)
    )) {
        rejectReason = "entry_latency_gate";
    }

    if (!rejectReason && ticksLast10s < minTicksLast10s) {
        rejectReason = "feed_ticks_too_low";
    }

    const lastFallbackAt = Number.isFinite(lastFallbackAgo)
        ? new Date(nowMs - lastFallbackAgo).toISOString()
        : null;

    return {
        latencyMs: feedState.latencyMs,
        rttMs: feedState.rttMs,
        ticksLast10s,
        fallbackActive,
        lastFallbackAgo,
        healthy: rejectReason === null,
        rejectReason,
        ageMs: feedState.ageMs,
        wsConnected: feedState.wsConnected,
        lastFallbackAt,
        msSinceLastFallback: Number.isFinite(lastFallbackAgo) ? lastFallbackAgo : null,
    };
}
