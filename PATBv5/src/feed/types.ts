export type MarketFeedSource = "websocket" | "rest";

export interface PriceSnapshot {
    upBuyPrice: number;
    upSellPrice: number;
    downBuyPrice: number;
    downSellPrice: number;
    source: MarketFeedSource;
    receivedAt: string;
    marketTimestampMs: number | null;
    latencyMs: number | null;
    staleMs: number;
}

export interface MarketFeedStats {
    slug: string;
    wsConnected: boolean;
    wsDisconnectedAt: string | null;
    wsReconnectedAt: string | null;
    connectedCount: number;
    disconnectedCount: number;
    intentionalCloseCount: number;
    reconnectAttemptCount: number;
    errorCount: number;
    tickCount: number;
    websocketTickCount: number;
    restTickCount: number;
    fallbackCount: number;
    staleCount: number;
    averageLatencyMs: number | null;
    maxLatencyMs: number | null;
    lastLatencyMs: number | null;
    averageRttMs: number | null;
    maxRttMs: number | null;
    lastRttMs: number | null;
    lastFallbackReason: string | null;
    lastFallbackAt: string | null;
    msSinceLastFallback: number | null;
    lastEventType: string | null;
    lastSnapshotSource: MarketFeedSource | null;
    sessionConnectedMs: number;
}

export type MarketFeedSnapshotListener = (snapshot: PriceSnapshot, trigger: "websocket" | "rest") => void | Promise<void>;

export interface MarketFeed {
    start(): Promise<void>;
    stop(): Promise<void>;
    getLatestSnapshot(): Promise<PriceSnapshot | null>;
    subscribe(listener: MarketFeedSnapshotListener): () => void;
    getStats(): MarketFeedStats;
    emitSummaryTelemetry(reason: string): Promise<void>;
}
