import assert from "node:assert/strict";

import { PolymarketMarketFeed } from "../src/feed";

async function run(): Promise<void> {
    const feed = new PolymarketMarketFeed({
        slug: "test-market",
        upTokenId: "up-token",
        downTokenId: "down-token",
    }) as any;

    const baseline = Date.now() - 8_000;
    feed.stateByAsset["up-token"] = {
        buyPrice: 0.61,
        sellPrice: 0.59,
        marketTimestampMs: baseline,
        receivedAtMs: baseline,
        lastEventType: "book",
        websocketMessageCount: 10,
        firstWebsocketSeenAtMs: baseline - 2_000,
    };
    feed.stateByAsset["down-token"] = {
        buyPrice: 0.41,
        sellPrice: 0.39,
        marketTimestampMs: baseline,
        receivedAtMs: baseline,
        lastEventType: "book",
        websocketMessageCount: 10,
        firstWebsocketSeenAtMs: baseline - 2_000,
    };

    await feed.handleMessage(JSON.stringify([
        {
            asset_id: "up-token",
            event_type: "book",
            bids: [],
            asks: [{ price: 0.62 }],
            timestamp: Date.now(),
        },
        {
            asset_id: "down-token",
            event_type: "book",
            bids: [{ price: 0.38 }],
            asks: [],
            timestamp: Date.now(),
        },
    ]));

    const snapshot = feed.buildWebsocketSnapshot();
    assert.ok(snapshot, "expected partial book updates to preserve a websocket snapshot");
    assert.ok(snapshot.staleMs < 1_000, `expected partial updates to refresh snapshot freshness, got ${snapshot.staleMs}ms`);
    assert.equal(feed.stateByAsset["up-token"].buyPrice, 0.62);
    assert.equal(feed.stateByAsset["up-token"].sellPrice, 0.59);
    assert.equal(feed.stateByAsset["down-token"].buyPrice, 0.41);
    assert.equal(feed.stateByAsset["down-token"].sellPrice, 0.38);
    assert.equal(feed.hasReceivedBothSidesOverWebsocket(), true);
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
