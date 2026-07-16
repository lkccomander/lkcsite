import WebSocket = require("ws");

import { getPrices } from "../services";
import { writeTelemetryEventSafe } from "../telemetry";
import type {
    MarketFeed,
    MarketFeedSnapshotListener,
    MarketFeedStats,
    PriceSnapshot,
} from "./types";

const WS_MARKET_ENDPOINT = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
const FEED_STALE_MS = 2500;
const FEED_CONNECT_TIMEOUT_MS = 5000;
const FEED_STARTUP_GRACE_MS = 10000;
const FEED_TICK_TELEMETRY_INTERVAL_MS = 1000;
const FEED_FORCE_WEBSOCKET_WAIT_MS = 18000;
const FEED_RESUBSCRIBE_COOLDOWN_MS = 1000;
const FEED_PING_INTERVAL_MS = 5000;
const FEED_PONG_TIMEOUT_MS = 12000;
const FEED_FALLBACK_DEBOUNCE_MS = 5000;
const FEED_WEBSOCKET_SNAPSHOT_GRACE_MS = 2000;
const FEED_RECONNECT_BACKOFF_MS = [250, 500, 1000, 2000, 4000, 8000];
const FEED_RECONNECT_STABLE_RESET_MS = 10000;
const FEED_FORCE_RECONNECT_WAITING_FOR_BOTH_SIDES_MS = 9000;
const FEED_LOW_MESSAGE_COUNT_GRACE = 2;

interface FeedState {
    buyPrice: number;
    sellPrice: number;
    marketTimestampMs: number | null;
    receivedAtMs: number;
    lastEventType: string | null;
    websocketMessageCount: number;
    firstWebsocketSeenAtMs: number | null;
}

interface MarketFeedOptions {
    slug: string;
    upTokenId: string;
    downTokenId: string;
}

interface ActiveFallbackState {
    startedAtMs: number;
    reason: string;
    reconnectAttempt: number;
}

interface SnapshotTelemetryShape {
    source: "websocket" | "rest";
    staleMs: number;
    latencyMs: number | null;
    marketTimestampMs: number | null;
    receivedAt: string;
    upBuyPrice: number;
    upSellPrice: number;
    downBuyPrice: number;
    downSellPrice: number;
}

function toFiniteNumber(value: unknown): number {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function parseTimestampMs(value: unknown): number | null {
    const parsed = toFiniteNumber(value);
    return parsed > 0 ? parsed : null;
}

function emptyFeedState(): FeedState {
    return {
        buyPrice: 0,
        sellPrice: 0,
        marketTimestampMs: null,
        receivedAtMs: 0,
        lastEventType: null,
        websocketMessageCount: 0,
        firstWebsocketSeenAtMs: null,
    };
}

function buildSnapshot(
    upState: FeedState,
    downState: FeedState,
    source: "websocket" | "rest",
): PriceSnapshot | null {
    if (upState.buyPrice <= 0 || upState.sellPrice <= 0 || downState.buyPrice <= 0 || downState.sellPrice <= 0) {
        return null;
    }

    const now = Date.now();
    const receivedAtValues = [upState.receivedAtMs, downState.receivedAtMs].filter((value) => value > 0);
    const snapshotReceivedAtMs = receivedAtValues.length > 0 ? Math.min(...receivedAtValues) : 0;
    const marketLatencySamples = [
        upState.marketTimestampMs !== null && upState.receivedAtMs > 0
            ? Math.max(0, upState.receivedAtMs - upState.marketTimestampMs)
            : null,
        downState.marketTimestampMs !== null && downState.receivedAtMs > 0
            ? Math.max(0, downState.receivedAtMs - downState.marketTimestampMs)
            : null,
    ].filter((value): value is number => value !== null);
    const marketTimestampValues = [upState.marketTimestampMs, downState.marketTimestampMs]
        .filter((value): value is number => value !== null);
    const marketTimestampMs = marketTimestampValues.length > 0 ? Math.min(...marketTimestampValues) : null;
    const staleMs = snapshotReceivedAtMs > 0 ? Math.max(0, now - snapshotReceivedAtMs) : FEED_STALE_MS + 1;
    const latencyMs = marketLatencySamples.length > 0 ? Math.max(...marketLatencySamples) : null;

    return {
        upBuyPrice: upState.buyPrice,
        upSellPrice: upState.sellPrice,
        downBuyPrice: downState.buyPrice,
        downSellPrice: downState.sellPrice,
        source,
        receivedAt: new Date(snapshotReceivedAtMs || now).toISOString(),
        marketTimestampMs,
        latencyMs,
        staleMs,
    };
}

function hasValidQuote(buyPrice: number, sellPrice: number): boolean {
    return buyPrice > 0 && sellPrice > 0;
}

function hasAnyValidQuote(buyPrice: number, sellPrice: number): boolean {
    return buyPrice > 0 || sellPrice > 0;
}

export class PolymarketMarketFeed implements MarketFeed {
    private readonly slug: string;
    private readonly upTokenId: string;
    private readonly downTokenId: string;
    private readonly stateByAsset: Record<string, FeedState>;
    private readonly listeners = new Set<MarketFeedSnapshotListener>();
    private readonly stats: {
        connectedCount: number;
        disconnectedCount: number;
        reconnectAttemptCount: number;
        errorCount: number;
        tickCount: number;
        websocketTickCount: number;
        restTickCount: number;
        fallbackCount: number;
        staleCount: number;
        latencySumMs: number;
        latencySamples: number;
        maxLatencyMs: number | null;
        lastLatencyMs: number | null;
        rttSumMs: number;
        rttSamples: number;
        maxRttMs: number | null;
        lastRttMs: number | null;
        lastFallbackReason: string | null;
        lastFallbackAtMs: number | null;
        wsDisconnectedAtMs: number | null;
        wsReconnectedAtMs: number | null;
        lastEventType: string | null;
        lastSnapshotSource: "websocket" | "rest" | null;
        connectedAtMs: number | null;
        sessionConnectedMs: number;
    };
    private ws: WebSocket | null = null;
    private wsConnected = false;
    private connectPromise: Promise<void> | null = null;
    private lastConnectedAtMs = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private stopped = false;
    private lastTickTelemetryAt = 0;
    private lastStaleTelemetryAt = 0;
    private lastFallbackReason = "";
    private lastFallbackAt = 0;
    private lastSubscriptionRefreshAt = 0;
    private pingInterval: NodeJS.Timeout | null = null;
    private lastPongReceivedAtMs = 0;
    private pendingReconnectReason: string | null = null;
    private lastReconnectScheduledAtMs: number | null = null;
    private activeFallback: ActiveFallbackState | null = null;

    constructor(options: MarketFeedOptions) {
        this.slug = options.slug;
        this.upTokenId = options.upTokenId;
        this.downTokenId = options.downTokenId;
        this.stateByAsset = {
            [this.upTokenId]: emptyFeedState(),
            [this.downTokenId]: emptyFeedState(),
        };
        this.stats = {
            connectedCount: 0,
            disconnectedCount: 0,
            reconnectAttemptCount: 0,
            errorCount: 0,
            tickCount: 0,
            websocketTickCount: 0,
            restTickCount: 0,
            fallbackCount: 0,
            staleCount: 0,
            latencySumMs: 0,
            latencySamples: 0,
            maxLatencyMs: null,
            lastLatencyMs: null,
            rttSumMs: 0,
            rttSamples: 0,
            maxRttMs: null,
            lastRttMs: null,
            lastFallbackReason: null,
            lastFallbackAtMs: null,
            wsDisconnectedAtMs: null,
            wsReconnectedAtMs: null,
            lastEventType: null,
            lastSnapshotSource: null,
            connectedAtMs: null,
            sessionConnectedMs: 0,
        };
    }

    subscribe(listener: MarketFeedSnapshotListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    getStats(): MarketFeedStats {
        const liveConnectedMs = this.wsConnected && this.stats.connectedAtMs ? Date.now() - this.stats.connectedAtMs : 0;
        const averageLatencyMs = this.stats.latencySamples > 0
            ? Math.round((this.stats.latencySumMs / this.stats.latencySamples) * 100) / 100
            : null;
        const averageRttMs = this.stats.rttSamples > 0
            ? Math.round((this.stats.rttSumMs / this.stats.rttSamples) * 100) / 100
            : null;

        return {
            slug: this.slug,
            wsConnected: this.wsConnected,
            wsDisconnectedAt: this.stats.wsDisconnectedAtMs ? new Date(this.stats.wsDisconnectedAtMs).toISOString() : null,
            wsReconnectedAt: this.stats.wsReconnectedAtMs ? new Date(this.stats.wsReconnectedAtMs).toISOString() : null,
            connectedCount: this.stats.connectedCount,
            disconnectedCount: this.stats.disconnectedCount,
            reconnectAttemptCount: this.stats.reconnectAttemptCount,
            errorCount: this.stats.errorCount,
            tickCount: this.stats.tickCount,
            websocketTickCount: this.stats.websocketTickCount,
            restTickCount: this.stats.restTickCount,
            fallbackCount: this.stats.fallbackCount,
            staleCount: this.stats.staleCount,
            averageLatencyMs,
            maxLatencyMs: this.stats.maxLatencyMs,
            lastLatencyMs: this.stats.lastLatencyMs,
            averageRttMs,
            maxRttMs: this.stats.maxRttMs,
            lastRttMs: this.stats.lastRttMs,
            lastFallbackReason: this.stats.lastFallbackReason,
            lastFallbackAt: this.stats.lastFallbackAtMs ? new Date(this.stats.lastFallbackAtMs).toISOString() : null,
            msSinceLastFallback: this.stats.lastFallbackAtMs ? Math.max(0, Date.now() - this.stats.lastFallbackAtMs) : null,
            lastEventType: this.stats.lastEventType,
            lastSnapshotSource: this.stats.lastSnapshotSource,
            sessionConnectedMs: this.stats.sessionConnectedMs + liveConnectedMs,
        };
    }

    async emitSummaryTelemetry(reason: string): Promise<void> {
        const stats = this.getStats();
        await writeTelemetryEventSafe("feed.summary", {
            reason,
            slug: stats.slug,
            wsConnected: stats.wsConnected,
            wsDisconnectedAt: stats.wsDisconnectedAt,
            wsReconnectedAt: stats.wsReconnectedAt,
            connectedCount: stats.connectedCount,
            disconnectedCount: stats.disconnectedCount,
            reconnectAttemptCount: stats.reconnectAttemptCount,
            errorCount: stats.errorCount,
            tickCount: stats.tickCount,
            websocketTickCount: stats.websocketTickCount,
            restTickCount: stats.restTickCount,
            fallbackCount: stats.fallbackCount,
            staleCount: stats.staleCount,
            averageLatencyMs: stats.averageLatencyMs,
            maxLatencyMs: stats.maxLatencyMs,
            lastLatencyMs: stats.lastLatencyMs,
            averageRttMs: stats.averageRttMs,
            maxRttMs: stats.maxRttMs,
            lastRttMs: stats.lastRttMs,
            lastFallbackReason: stats.lastFallbackReason,
            lastFallbackAt: stats.lastFallbackAt,
            msSinceLastFallback: stats.msSinceLastFallback,
            lastEventType: stats.lastEventType,
            lastSnapshotSource: stats.lastSnapshotSource,
            sessionConnectedMs: stats.sessionConnectedMs,
        });
    }

    async start(): Promise<void> {
        if (this.connectPromise) {
            return this.connectPromise;
        }

        this.stopped = false;
        this.connectPromise = new Promise<void>((resolve) => {
            let settled = false;
            let opened = false;
            const socket = new WebSocket(WS_MARKET_ENDPOINT);
            this.ws = socket;
            let reconnectScheduled = false;

            const settle = () => {
                if (settled) {
                    return;
                }
                settled = true;
                resolve();
            };
            const scheduleReconnect = (reason: string) => {
                if (reconnectScheduled || this.stopped) {
                    return;
                }
                reconnectScheduled = true;
                this.connectPromise = null;
                this.scheduleReconnect(reason);
            };

            const timeout = setTimeout(() => {
                this.stats.errorCount += 1;
                this.pendingReconnectReason = "connect_timeout";
                void writeTelemetryEventSafe("feed.error", {
                    slug: this.slug,
                    source: "websocket",
                    error: `connect timeout after ${FEED_CONNECT_TIMEOUT_MS}ms`,
                });
                if (this.ws === socket) {
                    this.ws = null;
                }
                this.wsConnected = false;
                scheduleReconnect("connect_timeout");
                try {
                    socket.terminate();
                } catch {
                    try {
                        socket.close();
                    } catch {
                        // ignore close failure
                    }
                }
                settle();
            }, FEED_CONNECT_TIMEOUT_MS);

            socket.on("open", () => {
                opened = true;
                this.wsConnected = true;
                const now = Date.now();
                this.lastConnectedAtMs = now;
                this.lastPongReceivedAtMs = now;
                this.stats.connectedCount += 1;
                this.stats.connectedAtMs = this.lastConnectedAtMs;
                this.stats.wsReconnectedAtMs = now;
                this.pendingReconnectReason = null;
                this.stats.reconnectAttemptCount = 0;
                // Preserve the last valid websocket book across reconnects so a brief
                // resubscribe gap does not immediately become a long subscription_missing window.
                this.sendSubscription("initial_open");
                this.startPingLoop();
                void this.maybeRecoverFromCachedSnapshotOnReconnect();
                // Let the websocket startup grace window absorb initial book delivery
                // instead of recording an immediate REST fallback on every connect.
                void writeTelemetryEventSafe("feed.connected", {
                    slug: this.slug,
                    source: "websocket",
                    assetIds: [this.upTokenId, this.downTokenId],
                    reconnectAttemptCount: this.stats.reconnectAttemptCount,
                    wsReconnectedAt: new Date(now).toISOString(),
                });
                clearTimeout(timeout);
                settle();
            });

            socket.on("message", (raw) => {
                void this.handleMessage(raw.toString());
            });

            socket.on("pong", (data) => {
                void this.handlePong(data);
            });

            socket.on("error", (error) => {
                this.stats.errorCount += 1;
                this.pendingReconnectReason = "socket_error";
                void writeTelemetryEventSafe("feed.error", {
                    slug: this.slug,
                    source: "websocket",
                    error: error instanceof Error ? error.message : String(error),
                });
                clearTimeout(timeout);
                if (!opened) {
                    if (this.ws === socket) {
                        this.ws = null;
                    }
                    this.wsConnected = false;
                    scheduleReconnect("socket_error");
                }
                settle();
            });

            socket.on("close", (code, reason) => {
                this.stopPingLoop();
                clearTimeout(timeout);
                this.captureConnectedDuration();
                this.wsConnected = false;
                this.stats.disconnectedCount += 1;
                this.stats.wsDisconnectedAtMs = Date.now();
                if (this.ws === socket) {
                    this.ws = null;
                }
                void writeTelemetryEventSafe("feed.disconnected", {
                    slug: this.slug,
                    source: "websocket",
                    code,
                    reason: reason.toString(),
                    reconnectAttemptCount: this.stats.reconnectAttemptCount,
                    wsDisconnectedAt: new Date(this.stats.wsDisconnectedAtMs).toISOString(),
                });
                settle();
                scheduleReconnect(this.pendingReconnectReason ?? (opened ? `close_${code}` : "preopen_close"));
            });
        });

        await this.connectPromise;
    }

    private async maybeRecoverFromCachedSnapshotOnReconnect(): Promise<void> {
        const activeFallback = this.activeFallback;
        if (!activeFallback || (activeFallback.reason !== "ws_closed" && activeFallback.reason !== "reconnect_pending")) {
            return;
        }

        const snapshot = this.buildWebsocketSnapshot();
        if (!snapshot) {
            return;
        }

        if (snapshot.staleMs > this.getEffectiveStaleThresholdMs(snapshot)) {
            return;
        }

        await this.maybeEmitFallbackRecovered("reconnect_open_cached_snapshot", snapshot);
    }

    async stop(): Promise<void> {
        if (!this.ws) {
            return;
        }

        const socket = this.ws;
        this.ws = null;
        this.stopped = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.stopPingLoop();
        this.captureConnectedDuration();
        this.wsConnected = false;
        this.connectPromise = null;

        await new Promise<void>((resolve) => {
            socket.once("close", () => resolve());
            socket.close();
            setTimeout(() => resolve(), 1000);
        });
    }

    async getLatestSnapshot(): Promise<PriceSnapshot | null> {
        const websocketSnapshot = this.buildWebsocketSnapshot();
        const websocketReady = this.hasReceivedBothSidesOverWebsocket();
        const effectiveStaleThresholdMs = this.getEffectiveStaleThresholdMs(websocketSnapshot);

        if (websocketSnapshot && websocketSnapshot.staleMs <= effectiveStaleThresholdMs) {
            return websocketSnapshot;
        }

        if (websocketSnapshot && websocketSnapshot.staleMs > effectiveStaleThresholdMs) {
            await this.emitStaleTelemetry(websocketSnapshot.staleMs);
            if (this.wsConnected) {
                if (this.shouldForceReconnectForUnresponsiveWebsocket(Date.now())) {
                    this.forceReconnect("websocket_unresponsive");
                } else {
                    this.refreshSubscriptionIfNeeded("stale_snapshot");
                }
            }
        }

        const connectedForMs = this.wsConnected ? Date.now() - this.lastConnectedAtMs : 0;
        const startupGraceActive = this.wsConnected && connectedForMs < FEED_STARTUP_GRACE_MS;
        if (!websocketReady && this.wsConnected) {
            if (connectedForMs >= FEED_FORCE_RECONNECT_WAITING_FOR_BOTH_SIDES_MS) {
                this.forceReconnect("waiting_for_both_sides_timeout");
            } else {
                this.refreshSubscriptionIfNeeded("waiting_for_both_sides");
            }
        }

        if (!websocketSnapshot && (startupGraceActive || (this.wsConnected && !websocketReady && connectedForMs < FEED_FORCE_WEBSOCKET_WAIT_MS))) {
            return null;
        }

        if (
            websocketSnapshot &&
            this.wsConnected &&
            websocketReady &&
            websocketSnapshot.staleMs > effectiveStaleThresholdMs &&
            websocketSnapshot.staleMs <= effectiveStaleThresholdMs + FEED_WEBSOCKET_SNAPSHOT_GRACE_MS
        ) {
            return websocketSnapshot;
        }

        return this.fetchRestSnapshot(websocketSnapshot ? "stale_websocket" : "missing_websocket");
    }

    private buildWebsocketSnapshot(): PriceSnapshot | null {
        if (!this.wsConnected) {
            return null;
        }
        return buildSnapshot(
            this.stateByAsset[this.upTokenId],
            this.stateByAsset[this.downTokenId],
            "websocket",
        );
    }

    private getEffectiveStaleThresholdMs(snapshot?: PriceSnapshot | null): number {
        const connectedForMs = this.wsConnected ? Date.now() - this.lastConnectedAtMs : 0;
        if (this.wsConnected && connectedForMs < FEED_STARTUP_GRACE_MS) {
            return FEED_STALE_MS + FEED_WEBSOCKET_SNAPSHOT_GRACE_MS;
        }

        if (!snapshot) {
            return FEED_STALE_MS;
        }

        const upState = this.stateByAsset[this.upTokenId];
        const downState = this.stateByAsset[this.downTokenId];
        const minMessageCount = Math.min(upState.websocketMessageCount, downState.websocketMessageCount);
        if (this.wsConnected && minMessageCount <= FEED_LOW_MESSAGE_COUNT_GRACE) {
            return FEED_STALE_MS + FEED_WEBSOCKET_SNAPSHOT_GRACE_MS;
        }

        return FEED_STALE_MS;
    }

    private shouldForceReconnectForUnresponsiveWebsocket(now: number): boolean {
        return this.lastPongReceivedAtMs > 0
            && now - this.lastPongReceivedAtMs >= FEED_PONG_TIMEOUT_MS;
    }

    private async handleMessage(rawMessage: string): Promise<void> {
        let parsed: unknown;
        try {
            parsed = JSON.parse(rawMessage);
        } catch {
            return;
        }

        const messages = Array.isArray(parsed) ? parsed : [parsed];
        for (const message of messages) {
            await this.handleEvent(message as Record<string, unknown>);
        }
    }

    private async handleEvent(message: Record<string, unknown>): Promise<void> {
        const eventType = String(message.event_type || "");
        const assetId = String(message.asset_id || "");

        if (!assetId || !(assetId in this.stateByAsset)) {
            return;
        }

        const previousState = this.stateByAsset[assetId];
        const websocketMessageCount = previousState.websocketMessageCount + 1;
        const firstWebsocketSeenAtMs = previousState.firstWebsocketSeenAtMs ?? Date.now();

        if (eventType === "best_bid_ask") {
            const buyPrice = toFiniteNumber(message.best_ask);
            const sellPrice = toFiniteNumber(message.best_bid);
            if (!hasValidQuote(buyPrice, sellPrice)) {
                const nextState = this.buildPartialQuoteState(previousState, buyPrice, sellPrice, parseTimestampMs(message.timestamp));
                if (nextState) {
                    this.stateByAsset[assetId] = {
                        ...nextState,
                        websocketMessageCount,
                        firstWebsocketSeenAtMs,
                        lastEventType: eventType,
                    };
                    await this.handleSnapshotUpdate("best_bid_ask");
                    return;
                }
                await this.ignoreInvalidBookUpdate(assetId, eventType, previousState, websocketMessageCount, firstWebsocketSeenAtMs, {
                    bestBid: sellPrice,
                    bestAsk: buyPrice,
                });
                return;
            }
            this.stateByAsset[assetId] = {
                buyPrice,
                sellPrice,
                marketTimestampMs: parseTimestampMs(message.timestamp),
                receivedAtMs: Date.now(),
                lastEventType: eventType,
                websocketMessageCount,
                firstWebsocketSeenAtMs,
            };
            await this.handleSnapshotUpdate("best_bid_ask");
            return;
        }

        if (eventType === "book") {
            const bids = Array.isArray(message.bids) ? message.bids : [];
            const asks = Array.isArray(message.asks) ? message.asks : [];
            const bestBid = bids.length ? toFiniteNumber((bids[0] as Record<string, unknown>).price) : 0;
            const bestAsk = asks.length ? toFiniteNumber((asks[0] as Record<string, unknown>).price) : 0;
            if (!hasValidQuote(bestAsk, bestBid)) {
                const nextState = this.buildPartialQuoteState(previousState, bestAsk, bestBid, parseTimestampMs(message.timestamp));
                if (nextState) {
                    this.stateByAsset[assetId] = {
                        ...nextState,
                        websocketMessageCount,
                        firstWebsocketSeenAtMs,
                        lastEventType: eventType,
                    };
                    await this.handleSnapshotUpdate("book");
                    return;
                }
                await this.ignoreInvalidBookUpdate(assetId, eventType, previousState, websocketMessageCount, firstWebsocketSeenAtMs, {
                    bidsCount: bids.length,
                    asksCount: asks.length,
                    bestBid,
                    bestAsk,
                });
                return;
            }
            this.stateByAsset[assetId] = {
                buyPrice: bestAsk,
                sellPrice: bestBid,
                marketTimestampMs: parseTimestampMs(message.timestamp),
                receivedAtMs: Date.now(),
                lastEventType: eventType,
                websocketMessageCount,
                firstWebsocketSeenAtMs,
            };
            await this.handleSnapshotUpdate("book");
        }
    }

    private buildPartialQuoteState(
        previousState: FeedState,
        nextBuyPrice: number,
        nextSellPrice: number,
        marketTimestampMs: number | null,
    ): FeedState | null {
        if (!hasAnyValidQuote(nextBuyPrice, nextSellPrice)) {
            return null;
        }

        const buyPrice = nextBuyPrice > 0 ? nextBuyPrice : previousState.buyPrice;
        const sellPrice = nextSellPrice > 0 ? nextSellPrice : previousState.sellPrice;
        if (!hasValidQuote(buyPrice, sellPrice)) {
            return null;
        }

        return {
            buyPrice,
            sellPrice,
            marketTimestampMs,
            receivedAtMs: Date.now(),
            lastEventType: previousState.lastEventType,
            websocketMessageCount: previousState.websocketMessageCount,
            firstWebsocketSeenAtMs: previousState.firstWebsocketSeenAtMs,
        };
    }

    private async ignoreInvalidBookUpdate(
        assetId: string,
        eventType: string,
        previousState: FeedState,
        websocketMessageCount: number,
        firstWebsocketSeenAtMs: number,
        details: Record<string, unknown>,
    ): Promise<void> {
        this.stateByAsset[assetId] = {
            ...previousState,
            websocketMessageCount,
            firstWebsocketSeenAtMs,
            lastEventType: eventType,
        };
        this.stats.lastEventType = `${eventType}_ignored`;
        await writeTelemetryEventSafe("feed.book_update_ignored", {
            slug: this.slug,
            source: "websocket",
            marketSlug: this.slug,
            assetId,
            eventType,
            preservedBuyPrice: previousState.buyPrice,
            preservedSellPrice: previousState.sellPrice,
            previousReceivedAt: previousState.receivedAtMs > 0 ? new Date(previousState.receivedAtMs).toISOString() : null,
            websocketMessageCount,
            details,
        });
    }

    private async handleSnapshotUpdate(eventType: string): Promise<void> {
        this.stats.lastEventType = eventType;
        const snapshot = this.buildWebsocketSnapshot();
        if (!snapshot) {
            return;
        }

        await this.maybeEmitFallbackRecovered(eventType, snapshot);

        this.recordSnapshot(snapshot, "websocket", eventType);
        await this.emitTickTelemetry(eventType, snapshot);
        await this.notifyListeners(snapshot, "websocket");
    }

    private async maybeEmitFallbackRecovered(
        eventType: string,
        snapshot?: PriceSnapshot | null,
        recoverySource: "websocket" | "rest" = "websocket",
    ): Promise<void> {
        const activeFallback = this.activeFallback;
        if (!activeFallback) {
            return;
        }
        if (!snapshot || snapshot.staleMs > this.getEffectiveStaleThresholdMs(snapshot)) {
            return;
        }
        // Clear first so overlapping updates cannot emit duplicate recoveries
        // for the same fallback window while telemetry I/O is still in flight.
        this.activeFallback = null;

        const now = Date.now();
        const fallbackDurationMs = Math.max(0, now - activeFallback.startedAtMs);
        const diagnostics = this.buildFallbackDiagnostics(now, activeFallback.reason);
        await writeTelemetryEventSafe("feed.fallback_recovered", {
            slug: this.slug,
            marketSlug: this.slug,
            source: recoverySource,
            reason: activeFallback.reason,
            wsConnected: this.wsConnected,
            msSinceLastWsMessage: recoverySource === "websocket" ? 0 : diagnostics.msSinceLastWsMessage,
            msSinceLastReconnectAttempt: this.lastReconnectScheduledAtMs !== null
                ? Math.max(0, now - this.lastReconnectScheduledAtMs)
                : null,
            reconnectAttempt: activeFallback.reconnectAttempt,
            fallbackDurationMs,
            recovered: true,
            recoveryEventType: eventType,
            recoveredAt: new Date(now).toISOString(),
            recoverySource: snapshot?.source ?? recoverySource,
            recoverySnapshot: snapshot ? this.snapshotTelemetryShape(snapshot) : null,
            diagnostics: {
                ...diagnostics,
                recovered: true,
            },
        });
    }

    private async fetchRestSnapshot(reason: string): Promise<PriceSnapshot | null> {
        const now = Date.now();
        const fallbackReason = this.deriveFallbackReason(reason);
        const diagnostics = this.buildFallbackDiagnostics(now, fallbackReason);
        if (!this.activeFallback) {
            this.activeFallback = {
                startedAtMs: now,
                reason: fallbackReason,
                reconnectAttempt: this.stats.reconnectAttemptCount,
            };
        } else {
            this.activeFallback.reason = fallbackReason;
            this.activeFallback.reconnectAttempt = this.stats.reconnectAttemptCount;
        }
        const fallbackDurationMs = Math.max(0, now - this.activeFallback.startedAtMs);

        if (this.lastFallbackReason !== fallbackReason || now - this.lastFallbackAt >= FEED_FALLBACK_DEBOUNCE_MS) {
            this.lastFallbackReason = fallbackReason;
            this.lastFallbackAt = now;
            this.stats.fallbackCount += 1;
            this.stats.lastFallbackReason = fallbackReason;
            this.stats.lastFallbackAtMs = now;
            await writeTelemetryEventSafe("feed.fallback", {
                slug: this.slug,
                marketSlug: this.slug,
                source: "rest",
                reason: fallbackReason,
                wsConnected: this.wsConnected,
                msSinceLastWsMessage: diagnostics.msSinceLastWsMessage,
                msSinceLastReconnectAttempt: diagnostics.msSinceLastReconnectAttempt,
                reconnectAttempt: this.stats.reconnectAttemptCount,
                fallbackDurationMs,
                recovered: false,
                diagnostics,
            });
        }

        let prices: Awaited<ReturnType<typeof getPrices>>;
        try {
            prices = await getPrices(this.upTokenId, this.downTokenId);
        } catch (error) {
            this.stats.errorCount += 1;
            this.activeFallback = {
                startedAtMs: Date.now(),
                reason: fallbackReason,
                reconnectAttempt: this.stats.reconnectAttemptCount,
            };
            await writeTelemetryEventSafe("feed.error", {
                slug: this.slug,
                source: "rest_fallback",
                error: error instanceof Error ? error.message : String(error),
                reason: fallbackReason,
                wsConnected: this.wsConnected,
                reconnectAttempt: this.stats.reconnectAttemptCount,
            });
            return null;
        }
        const receivedAtMs = Date.now();

        const upState: FeedState = {
            buyPrice: toFiniteNumber(prices[this.upTokenId]?.BUY),
            sellPrice: toFiniteNumber(prices[this.upTokenId]?.SELL),
            marketTimestampMs: null,
            receivedAtMs,
            lastEventType: "rest_fallback",
            websocketMessageCount: this.stateByAsset[this.upTokenId].websocketMessageCount,
            firstWebsocketSeenAtMs: this.stateByAsset[this.upTokenId].firstWebsocketSeenAtMs,
        };
        const downState: FeedState = {
            buyPrice: toFiniteNumber(prices[this.downTokenId]?.BUY),
            sellPrice: toFiniteNumber(prices[this.downTokenId]?.SELL),
            marketTimestampMs: null,
            receivedAtMs,
            lastEventType: "rest_fallback",
            websocketMessageCount: this.stateByAsset[this.downTokenId].websocketMessageCount,
            firstWebsocketSeenAtMs: this.stateByAsset[this.downTokenId].firstWebsocketSeenAtMs,
        };

        const snapshot = buildSnapshot(upState, downState, "rest");
        if (snapshot) {
            await this.maybeEmitFallbackRecovered("rest_fallback", snapshot, "rest");
            this.recordSnapshot(snapshot, "rest", "rest_fallback");
            await this.emitTickTelemetry("rest_fallback", snapshot);
            await this.notifyListeners(snapshot, "rest");
        }
        return snapshot;
    }

    private recordSnapshot(snapshot: PriceSnapshot, trigger: "websocket" | "rest", eventType: string): void {
        this.stats.tickCount += 1;
        this.stats.lastEventType = eventType;
        this.stats.lastSnapshotSource = snapshot.source;

        if (trigger === "websocket") {
            this.stats.websocketTickCount += 1;
        } else {
            this.stats.restTickCount += 1;
        }

        if (snapshot.latencyMs !== null) {
            this.stats.lastLatencyMs = snapshot.latencyMs;
            this.stats.latencySumMs += snapshot.latencyMs;
            this.stats.latencySamples += 1;
            this.stats.maxLatencyMs = this.stats.maxLatencyMs === null
                ? snapshot.latencyMs
                : Math.max(this.stats.maxLatencyMs, snapshot.latencyMs);
        }
    }

    private async notifyListeners(snapshot: PriceSnapshot, trigger: "websocket" | "rest"): Promise<void> {
        if (!this.listeners.size) {
            return;
        }

        for (const listener of [...this.listeners]) {
            try {
                await listener(snapshot, trigger);
            } catch (error) {
                this.stats.errorCount += 1;
                await writeTelemetryEventSafe("feed.error", {
                    slug: this.slug,
                    source: "listener",
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }

    private deriveFallbackReason(rawReason: string): string {
        const websocketReady = this.hasReceivedBothSidesOverWebsocket();
        if (rawReason === "stale_websocket") {
            return "stale_snapshot";
        }
        if (rawReason === "missing_websocket") {
            if (!this.wsConnected && this.reconnectTimer) {
                return "reconnect_pending";
            }
            if (!this.wsConnected) {
                return "ws_closed";
            }
            if (!websocketReady) {
                return "subscription_missing";
            }
            return "missing_snapshot";
        }
        return "unknown";
    }

    private buildFallbackDiagnostics(now = Date.now(), fallbackReason?: string): Record<string, unknown> {
        const upState = this.stateByAsset[this.upTokenId];
        const downState = this.stateByAsset[this.downTokenId];
        const websocketSnapshot = this.buildWebsocketSnapshot();
        const upAgeMs = upState.receivedAtMs > 0 ? now - upState.receivedAtMs : null;
        const downAgeMs = downState.receivedAtMs > 0 ? now - downState.receivedAtMs : null;
        const newestWsMessageAtMs = Math.max(upState.receivedAtMs || 0, downState.receivedAtMs || 0);
        const msSinceLastWsMessage = newestWsMessageAtMs > 0 ? Math.max(0, now - newestWsMessageAtMs) : null;
        const msSinceLastReconnectAttempt = this.lastReconnectScheduledAtMs !== null
            ? Math.max(0, now - this.lastReconnectScheduledAtMs)
            : null;

        return {
            reason: fallbackReason ?? "unknown",
            marketSlug: this.slug,
            wsConnected: this.wsConnected,
            msSinceLastWsMessage,
            msSinceLastReconnectAttempt,
            reconnectAttempt: this.stats.reconnectAttemptCount,
            fallbackDurationMs: this.activeFallback ? Math.max(0, now - this.activeFallback.startedAtMs) : 0,
            recovered: false,
            upTokenId: this.upTokenId,
            downTokenId: this.downTokenId,
            bothSidesReady:
                upState.buyPrice > 0 &&
                upState.sellPrice > 0 &&
                downState.buyPrice > 0 &&
                downState.sellPrice > 0,
            upReady: upState.buyPrice > 0 && upState.sellPrice > 0,
            downReady: downState.buyPrice > 0 && downState.sellPrice > 0,
            upAgeMs,
            downAgeMs,
            upLastEventType: upState.lastEventType,
            downLastEventType: downState.lastEventType,
            upWebsocketMessageCount: upState.websocketMessageCount,
            downWebsocketMessageCount: downState.websocketMessageCount,
            upFirstWebsocketSeenAtMs: upState.firstWebsocketSeenAtMs,
            downFirstWebsocketSeenAtMs: downState.firstWebsocketSeenAtMs,
            startupGraceActive: this.wsConnected && Date.now() - this.lastConnectedAtMs < FEED_STARTUP_GRACE_MS,
            staleThresholdMs: FEED_STALE_MS,
            websocketSnapshotGraceMs: FEED_WEBSOCKET_SNAPSHOT_GRACE_MS,
            websocketSnapshotPresent: Boolean(websocketSnapshot),
            websocketSnapshotStaleMs: websocketSnapshot?.staleMs ?? null,
            websocketSnapshotLatencyMs: websocketSnapshot?.latencyMs ?? null,
            websocketSnapshotMarketTimestampMs: websocketSnapshot?.marketTimestampMs ?? null,
            websocketSnapshotReceivedAt: websocketSnapshot?.receivedAt ?? null,
            lastSnapshotSource: this.stats.lastSnapshotSource,
        };
    }

    private snapshotTelemetryShape(snapshot: PriceSnapshot): SnapshotTelemetryShape {
        return {
            source: snapshot.source,
            staleMs: snapshot.staleMs,
            latencyMs: snapshot.latencyMs,
            marketTimestampMs: snapshot.marketTimestampMs,
            receivedAt: snapshot.receivedAt,
            upBuyPrice: snapshot.upBuyPrice,
            upSellPrice: snapshot.upSellPrice,
            downBuyPrice: snapshot.downBuyPrice,
            downSellPrice: snapshot.downSellPrice,
        };
    }

    private hasReceivedBothSidesOverWebsocket(): boolean {
        const upState = this.stateByAsset[this.upTokenId];
        const downState = this.stateByAsset[this.downTokenId];
        return (
            upState.receivedAtMs > 0 &&
            downState.receivedAtMs > 0 &&
            upState.buyPrice > 0 &&
            upState.sellPrice > 0 &&
            downState.buyPrice > 0 &&
            downState.sellPrice > 0
        );
    }

    private sendSubscription(reason: string): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }
        this.ws.send(
            JSON.stringify({
                type: "market",
                assets_ids: [this.upTokenId, this.downTokenId],
                custom_feature_enabled: true,
            }),
        );
        void writeTelemetryEventSafe("feed.subscription", {
            slug: this.slug,
            source: "websocket_subscription",
            reason,
            assetIds: [this.upTokenId, this.downTokenId],
        });
    }

    private startPingLoop(): void {
        this.stopPingLoop();
        this.sendPing();
        this.pingInterval = setInterval(() => {
            this.sendPing();
        }, FEED_PING_INTERVAL_MS);
    }

    private stopPingLoop(): void {
        if (!this.pingInterval) {
            return;
        }
        clearInterval(this.pingInterval);
        this.pingInterval = null;
    }

    private sendPing(): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        const sentAtMs = Date.now();
        try {
            this.ws.ping(String(sentAtMs));
        } catch (error) {
            this.stats.errorCount += 1;
            void writeTelemetryEventSafe("feed.error", {
                slug: this.slug,
                source: "websocket_ping",
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private async handlePong(data: Buffer): Promise<void> {
        const sentAtMs = Number(data.toString());
        if (!Number.isFinite(sentAtMs) || sentAtMs <= 0) {
            return;
        }

        this.lastPongReceivedAtMs = Date.now();
        const rttMs = Math.max(0, Date.now() - sentAtMs);
        this.stats.lastRttMs = rttMs;
        this.stats.rttSumMs += rttMs;
        this.stats.rttSamples += 1;
        this.stats.maxRttMs = this.stats.maxRttMs === null ? rttMs : Math.max(this.stats.maxRttMs, rttMs);

        await writeTelemetryEventSafe("feed.rtt", {
            slug: this.slug,
            source: "websocket",
            rttMs,
            sentAt: new Date(sentAtMs).toISOString(),
            receivedAt: new Date().toISOString(),
            pingIntervalMs: FEED_PING_INTERVAL_MS,
        });
    }

    private refreshSubscriptionIfNeeded(reason: string): void {
        if (!this.wsConnected) {
            return;
        }
        const now = Date.now();
        if (now - this.lastSubscriptionRefreshAt < FEED_RESUBSCRIBE_COOLDOWN_MS) {
            return;
        }
        this.lastSubscriptionRefreshAt = now;
        this.sendSubscription(reason);
    }

    private async emitTickTelemetry(eventType: string, snapshotOverride?: PriceSnapshot | null): Promise<void> {
        const now = Date.now();
        if (now - this.lastTickTelemetryAt < FEED_TICK_TELEMETRY_INTERVAL_MS) {
            return;
        }

        const snapshot = snapshotOverride ?? this.buildWebsocketSnapshot();

        if (!snapshot) {
            return;
        }

        this.lastTickTelemetryAt = now;
        await writeTelemetryEventSafe("feed.tick", {
            slug: this.slug,
            source: snapshot.source,
            eventType,
            latencyMs: snapshot.latencyMs,
            staleMs: snapshot.staleMs,
            marketTimestampMs: snapshot.marketTimestampMs,
            receivedAt: snapshot.receivedAt,
            prices: {
                upBuyPrice: snapshot.upBuyPrice,
                upSellPrice: snapshot.upSellPrice,
                downBuyPrice: snapshot.downBuyPrice,
                downSellPrice: snapshot.downSellPrice,
            },
        });
    }

    private async emitStaleTelemetry(staleMs: number): Promise<void> {
        const now = Date.now();
        if (now - this.lastStaleTelemetryAt < FEED_TICK_TELEMETRY_INTERVAL_MS) {
            return;
        }
        this.lastStaleTelemetryAt = now;
        this.stats.staleCount += 1;
        await writeTelemetryEventSafe("feed.stale", {
            slug: this.slug,
            source: "websocket",
            staleMs,
            thresholdMs: FEED_STALE_MS,
        });
    }

    private captureConnectedDuration(): void {
        if (!this.stats.connectedAtMs) {
            return;
        }
        const connectedForMs = Date.now() - this.stats.connectedAtMs;
        this.stats.sessionConnectedMs += Date.now() - this.stats.connectedAtMs;
        if (connectedForMs >= FEED_RECONNECT_STABLE_RESET_MS) {
            this.stats.reconnectAttemptCount = 0;
        }
        this.stats.connectedAtMs = null;
    }

    private forceReconnect(reason: string): void {
        if (this.stopped || this.reconnectTimer || !this.ws) {
            return;
        }

        this.pendingReconnectReason = reason;
        void writeTelemetryEventSafe("feed.reconnect_forced", {
            slug: this.slug,
            source: "websocket",
            reason,
            wsConnected: this.wsConnected,
            reconnectAttemptCount: this.stats.reconnectAttemptCount,
        });

        try {
            this.ws.close();
        } catch (error) {
            this.stats.errorCount += 1;
            void writeTelemetryEventSafe("feed.error", {
                slug: this.slug,
                source: "websocket_force_reconnect",
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private scheduleReconnect(reason: string): void {
        if (this.stopped || this.reconnectTimer) {
            return;
        }
        this.stats.reconnectAttemptCount += 1;
        this.lastReconnectScheduledAtMs = Date.now();
        const delayMs = FEED_RECONNECT_BACKOFF_MS[
            Math.min(this.stats.reconnectAttemptCount - 1, FEED_RECONNECT_BACKOFF_MS.length - 1)
        ];
        void writeTelemetryEventSafe("feed.reconnect_scheduled", {
            slug: this.slug,
            source: "websocket",
            reason,
            reconnectAttemptCount: this.stats.reconnectAttemptCount,
            reconnectDelayMs: delayMs,
        });
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.start();
        }, delayMs);
    }
}
