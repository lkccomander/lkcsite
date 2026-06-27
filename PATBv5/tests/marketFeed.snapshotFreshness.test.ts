import assert from "node:assert/strict";

import { PolymarketMarketFeed } from "../src/feed";

async function run(): Promise<void> {
    const feed = new PolymarketMarketFeed({
        slug: "test-market",
        upTokenId: "up-token",
        downTokenId: "down-token",
    }) as any;

    const now = Date.now();
    feed.stateByAsset["up-token"] = {
        buyPrice: 0.55,
        sellPrice: 0.54,
        marketTimestampMs: now - 40,
        receivedAtMs: now - 40,
        lastEventType: "book",
        websocketMessageCount: 10,
        firstWebsocketSeenAtMs: now - 5_000,
    };
    feed.stateByAsset["down-token"] = {
        buyPrice: 0.46,
        sellPrice: 0.45,
        marketTimestampMs: now - 7_000,
        receivedAtMs: now - 3_500,
        lastEventType: "book",
        websocketMessageCount: 10,
        firstWebsocketSeenAtMs: now - 5_000,
    };

    const snapshot = feed.buildWebsocketSnapshot();
    assert.ok(snapshot);
    assert.equal(snapshot.source, "websocket");
    assert.ok(
        snapshot.staleMs >= 3_000,
        `expected stale snapshot to reflect the oldest side, got ${snapshot.staleMs}ms`,
    );
    assert.ok(
        snapshot.latencyMs !== null && snapshot.latencyMs >= 3_000,
        `expected latency to reflect the slowest side, got ${snapshot.latencyMs}ms`,
    );
    assert.equal(feed.hasReceivedBothSidesOverWebsocket(), true);
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
