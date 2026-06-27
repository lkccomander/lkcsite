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

async function run(): Promise<void> {
    await testDisconnectedFeedDoesNotBuildWebsocketSnapshot();
    await testRestFallbackFailureResetsActiveFallbackWindow();
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
