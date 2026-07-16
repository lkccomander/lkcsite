import assert from "node:assert/strict";

import { PolymarketMarketFeed } from "../src/feed";

async function testDisconnectedFeedDoesNotBuildWebsocketSnapshot(): Promise<void> {
    const feed = new PolymarketMarketFeed({
        slug: "test-market",
        upTokenId: "up-token",
        downTokenId: "down-token",
    }) as any;

    feed.wsConnected = false;
    feed.stateByAsset["up-token"] = {
        buyPrice: 0.51,
        sellPrice: 0.49,
        marketTimestampMs: Date.now(),
        receivedAtMs: Date.now(),
        lastEventType: "book",
        websocketMessageCount: 10,
        firstWebsocketSeenAtMs: Date.now(),
    };
    feed.stateByAsset["down-token"] = {
        buyPrice: 0.49,
        sellPrice: 0.51,
        marketTimestampMs: Date.now(),
        receivedAtMs: Date.now(),
        lastEventType: "book",
        websocketMessageCount: 10,
        firstWebsocketSeenAtMs: Date.now(),
    };

    assert.equal(feed.buildWebsocketSnapshot(), null);
}

async function testRestFallbackFailureResetsActiveFallbackWindow(): Promise<void> {
    const feed = new PolymarketMarketFeed({
        slug: "test-market",
        upTokenId: "up-token",
        downTokenId: "down-token",
    }) as any;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        throw new Error("rest fetch failed");
    };

    try {
        feed.wsConnected = false;
        feed.reconnectTimer = {};
        feed.activeFallback = {
            startedAtMs: Date.now() - 30_000,
            reason: "ws_closed",
            reconnectAttempt: 2,
        };

        const before = feed.activeFallback.startedAtMs;
        const snapshot = await feed.fetchRestSnapshot("missing_websocket");
        const after = feed.activeFallback.startedAtMs;

        assert.equal(snapshot, null);
        assert.ok(after >= before, "expected REST failure to roll the fallback window forward");
        assert.equal(feed.activeFallback.reason, "reconnect_pending");
    } finally {
        globalThis.fetch = originalFetch;
    }
}

async function testReconnectOpenRecoversFromCachedSnapshot(): Promise<void> {
    const feed = new PolymarketMarketFeed({
        slug: "test-market",
        upTokenId: "up-token",
        downTokenId: "down-token",
    }) as any;

    const now = Date.now();
    feed.wsConnected = true;
    feed.lastConnectedAtMs = now;
    feed.activeFallback = {
        startedAtMs: now - 2_000,
        reason: "ws_closed",
        reconnectAttempt: 1,
    };
    feed.stateByAsset["up-token"] = {
        buyPrice: 0.51,
        sellPrice: 0.49,
        marketTimestampMs: now - 200,
        receivedAtMs: now - 200,
        lastEventType: "book",
        websocketMessageCount: 10,
        firstWebsocketSeenAtMs: now - 2_000,
    };
    feed.stateByAsset["down-token"] = {
        buyPrice: 0.49,
        sellPrice: 0.51,
        marketTimestampMs: now - 180,
        receivedAtMs: now - 180,
        lastEventType: "book",
        websocketMessageCount: 10,
        firstWebsocketSeenAtMs: now - 2_000,
    };

    await feed.maybeRecoverFromCachedSnapshotOnReconnect();
    assert.equal(feed.activeFallback, null, "expected reconnect-open cached snapshot to clear ws_closed fallback");
}

async function testStaleSnapshotForcesReconnectWhenPongsStop(): Promise<void> {
    const feed = new PolymarketMarketFeed({
        slug: "test-market",
        upTokenId: "up-token",
        downTokenId: "down-token",
    }) as any;

    const now = Date.now();
    let reconnectReason: string | null = null;
    let refreshReason: string | null = null;

    feed.wsConnected = true;
    feed.lastConnectedAtMs = now - 20_000;
    feed.lastPongReceivedAtMs = now - 13_000;
    feed.forceReconnect = (reason: string) => {
        reconnectReason = reason;
    };
    feed.refreshSubscriptionIfNeeded = (reason: string) => {
        refreshReason = reason;
    };
    feed.fetchRestSnapshot = async () => null;
    feed.stateByAsset["up-token"] = {
        buyPrice: 0.51,
        sellPrice: 0.49,
        marketTimestampMs: now - 3_000,
        receivedAtMs: now - 3_000,
        lastEventType: "book",
        websocketMessageCount: 10,
        firstWebsocketSeenAtMs: now - 20_000,
    };
    feed.stateByAsset["down-token"] = {
        buyPrice: 0.49,
        sellPrice: 0.51,
        marketTimestampMs: now - 3_000,
        receivedAtMs: now - 3_000,
        lastEventType: "book",
        websocketMessageCount: 10,
        firstWebsocketSeenAtMs: now - 20_000,
    };

    await feed.getLatestSnapshot();

    assert.equal(reconnectReason, "websocket_unresponsive");
    assert.equal(refreshReason, null);
}

async function run(): Promise<void> {
    await testDisconnectedFeedDoesNotBuildWebsocketSnapshot();
    await testRestFallbackFailureResetsActiveFallbackWindow();
    await testReconnectOpenRecoversFromCachedSnapshot();
    await testStaleSnapshotForcesReconnectWhenPongsStop();
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
