import assert from "node:assert/strict";

import { PolymarketMarketFeed } from "../src/feed";

async function run(): Promise<void> {
    const feed = new PolymarketMarketFeed({
        slug: "test-market",
        upTokenId: "up-token",
        downTokenId: "down-token",
    }) as any;

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
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
