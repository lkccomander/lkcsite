import assert from "node:assert/strict";

import { PolymarketMarketFeed } from "../src/feed";

async function run(): Promise<void> {
    const feed = new PolymarketMarketFeed({
        slug: "test-market",
        upTokenId: "up-token",
        downTokenId: "down-token",
    }) as any;

    feed.wsConnected = true;
    feed.stats.connectedAtMs = Date.now() - 100;
    feed.stopped = true;
    assert.equal(feed.recordSocketClose(1005, "market_transition"), true);
    assert.equal(feed.getStats().disconnectedCount, 0, "expected an intentional close to stay out of failure metrics");
    assert.equal(feed.getStats().intentionalCloseCount, 1, "expected intentional close telemetry to be counted separately");
    feed.stopped = false;

    let closeCalls = 0;
    feed.wsConnected = true;
    feed.ws = {
        close: () => {
            closeCalls += 1;
        },
    };

    feed.forceReconnect("stale_snapshot_timeout");
    assert.equal(closeCalls, 1, "expected forced reconnect to close the websocket");
    assert.equal(feed.pendingReconnectReason, "stale_snapshot_timeout");

    feed.forceReconnect("stale_snapshot_timeout");
    assert.equal(closeCalls, 1, "expected forced reconnect cooldown to suppress reconnect loops");

    feed.reconnectTimer = {};
    feed.forceReconnect("waiting_for_both_sides_timeout");
    assert.equal(closeCalls, 1, "expected forced reconnect to stop when reconnect is already pending");

    const snapshotAt = Date.now();
    feed.stateByAsset["up-token"] = {
        buyPrice: 0.61,
        sellPrice: 0.59,
        marketTimestampMs: snapshotAt - 100,
        receivedAtMs: snapshotAt - 100,
        lastEventType: "book",
        websocketMessageCount: 10,
        firstWebsocketSeenAtMs: snapshotAt - 1_000,
    };
    feed.stateByAsset["down-token"] = {
        buyPrice: 0.41,
        sellPrice: 0.39,
        marketTimestampMs: snapshotAt - 100,
        receivedAtMs: snapshotAt - 100,
        lastEventType: "book",
        websocketMessageCount: 10,
        firstWebsocketSeenAtMs: snapshotAt - 1_000,
    };

    feed.wsConnected = true;
    const snapshot = feed.buildWebsocketSnapshot();
    assert.ok(snapshot, "expected a valid websocket snapshot before reconnect");

    feed.wsConnected = false;
    assert.equal(feed.buildWebsocketSnapshot(), null, "expected snapshots to stay unavailable while disconnected");

    feed.wsConnected = true;
    const snapshotAfterReconnect = feed.buildWebsocketSnapshot();
    assert.ok(snapshotAfterReconnect, "expected last valid websocket snapshot to survive reconnect");

    let forcedReconnectReason: string | null = null;
    feed.forceReconnect = (reason: string) => {
        forcedReconnectReason = reason;
    };
    feed.refreshSubscriptionIfNeeded = () => {
        throw new Error("expected stale snapshot path to force reconnect before refresh");
    };
    const staleAt = Date.now() - 13_000;
    feed.lastConnectedAtMs = Date.now() - 20_000;
    feed.lastPongReceivedAtMs = Date.now() - 13_000;
    feed.wsConnected = true;
    feed.stateByAsset["up-token"] = {
        buyPrice: 0.61,
        sellPrice: 0.59,
        marketTimestampMs: staleAt,
        receivedAtMs: staleAt,
        lastEventType: "book",
        websocketMessageCount: 10,
        firstWebsocketSeenAtMs: staleAt - 1_000,
    };
    feed.stateByAsset["down-token"] = {
        buyPrice: 0.41,
        sellPrice: 0.39,
        marketTimestampMs: staleAt,
        receivedAtMs: staleAt,
        lastEventType: "book",
        websocketMessageCount: 10,
        firstWebsocketSeenAtMs: staleAt - 1_000,
    };

    await feed.getLatestSnapshot();
    assert.equal(
        forcedReconnectReason,
        "websocket_unresponsive",
        "expected stale websocket snapshots to force reconnect once both pong and message flow are stale",
    );

    let refreshReason: string | null = null;
    forcedReconnectReason = null;
    feed.forceReconnect = (reason: string) => {
        forcedReconnectReason = reason;
    };
    feed.refreshSubscriptionIfNeeded = (reason: string) => {
        refreshReason = reason;
    };
    const partiallyFreshAt = Date.now();
    feed.lastConnectedAtMs = partiallyFreshAt - 20_000;
    feed.lastPongReceivedAtMs = partiallyFreshAt - 13_000;
    feed.stateByAsset["up-token"] = {
        buyPrice: 0.61,
        sellPrice: 0.59,
        marketTimestampMs: partiallyFreshAt - 6_500,
        receivedAtMs: partiallyFreshAt - 6_500,
        lastEventType: "book",
        websocketMessageCount: 12,
        firstWebsocketSeenAtMs: partiallyFreshAt - 20_000,
    };
    feed.stateByAsset["down-token"] = {
        buyPrice: 0.41,
        sellPrice: 0.39,
        marketTimestampMs: partiallyFreshAt - 250,
        receivedAtMs: partiallyFreshAt - 250,
        lastEventType: "book",
        websocketMessageCount: 12,
        firstWebsocketSeenAtMs: partiallyFreshAt - 20_000,
    };

    await feed.getLatestSnapshot();
    assert.equal(
        forcedReconnectReason,
        null,
        "expected active websocket messages to suppress forced reconnect even when pong is stale",
    );
    assert.equal(
        refreshReason,
        "stale_snapshot",
        "expected stale snapshots with active message flow to request a subscription refresh",
    );

    let waitingRefreshReason: string | null = null;
    forcedReconnectReason = null;
    feed.stateByAsset["up-token"] = {
        buyPrice: 0.61,
        sellPrice: 0.59,
        marketTimestampMs: snapshotAt - 100,
        receivedAtMs: snapshotAt - 100,
        lastEventType: "book",
        websocketMessageCount: 10,
        firstWebsocketSeenAtMs: snapshotAt - 1_000,
    };
    feed.stateByAsset["down-token"] = {
        buyPrice: 0,
        sellPrice: 0,
        marketTimestampMs: null,
        receivedAtMs: 0,
        lastEventType: null,
        websocketMessageCount: 0,
        firstWebsocketSeenAtMs: null,
    };
    feed.lastConnectedAtMs = Date.now() - 12_000;
    feed.refreshSubscriptionIfNeeded = (reason: string) => {
        waitingRefreshReason = reason;
    };

    const noSnapshot = await feed.getLatestSnapshot();
    assert.equal(noSnapshot, null, "expected feed to keep waiting for both sides before full websocket wait expires");
    assert.equal(forcedReconnectReason, null, "expected no forced reconnect before the full websocket wait window expires");
    assert.equal(waitingRefreshReason, "waiting_for_both_sides");

    waitingRefreshReason = null;
    feed.lastConnectedAtMs = Date.now() - 19_000;
    await feed.getLatestSnapshot();
    assert.equal(
        forcedReconnectReason,
        "waiting_for_both_sides_timeout",
        "expected reconnect only after the full websocket wait window expires",
    );
    assert.equal(waitingRefreshReason, null);

    const silentMarketAt = Date.now();
    feed.lastForcedReconnectAtMs = null;
    feed.lastPongReceivedAtMs = silentMarketAt - 250;
    feed.consecutiveStaleSubscriptionRefreshes = 3;
    feed.stateByAsset["up-token"] = {
        buyPrice: 0.61,
        sellPrice: 0.59,
        marketTimestampMs: silentMarketAt - 5_000,
        receivedAtMs: silentMarketAt - 5_000,
        lastEventType: "book",
        websocketMessageCount: 12,
        firstWebsocketSeenAtMs: silentMarketAt - 20_000,
    };
    feed.stateByAsset["down-token"] = {
        buyPrice: 0.41,
        sellPrice: 0.39,
        marketTimestampMs: silentMarketAt - 5_000,
        receivedAtMs: silentMarketAt - 5_000,
        lastEventType: "book",
        websocketMessageCount: 12,
        firstWebsocketSeenAtMs: silentMarketAt - 20_000,
    };
    assert.equal(
        feed.shouldForceReconnectForUnresponsiveWebsocket(silentMarketAt),
        true,
        "expected a connected socket with fresh pongs but stale market flow to force reconnect",
    );
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
