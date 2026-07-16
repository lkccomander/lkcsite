import assert from "node:assert/strict";

import { PolymarketMarketFeed } from "../src/feed";

function run(): void {
    const feed = new PolymarketMarketFeed({
        slug: "test-market",
        upTokenId: "up-token",
        downTokenId: "down-token",
    }) as any;
    const now = Date.now();

    feed.lastPongReceivedAtMs = now;
    assert.equal(
        feed.shouldForceReconnectForUnresponsiveWebsocket(now),
        false,
        "fresh pongs must prevent stale-book reconnect churn",
    );

    feed.lastPongReceivedAtMs = now - 13_000;
    assert.equal(
        feed.shouldForceReconnectForUnresponsiveWebsocket(now),
        true,
        "a websocket without pongs beyond the timeout must reconnect",
    );
}

run();
process.exit(0);
