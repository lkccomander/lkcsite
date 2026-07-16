import assert from "node:assert/strict";

import {
    aggregateMatchingSellFills,
    findMatchingOpenSellOrder,
} from "../src/trade/policy/exitReconciliation";

function run(): void {
    const request = {
        tokenId: "DOWN_TOKEN",
        requestedSize: 6,
        submittedAt: "2026-07-16T18:36:40.000Z",
    };
    const fill = aggregateMatchingSellFills([
        { id: "fill-1", asset_id: "DOWN_TOKEN", side: "SELL", size: "2", price: "0.87", match_time: "2026-07-16T18:36:41.000Z" },
        { id: "fill-2", asset_id: "DOWN_TOKEN", side: "SELL", size: "4", price: "0.906", match_time: "2026-07-16T18:36:42.000Z", transaction_hash: "0xtx" },
        { id: "unrelated", asset_id: "UP_TOKEN", side: "SELL", size: "99", price: "0.01", match_time: "2026-07-16T18:36:42.000Z" },
        { id: "fill-2", asset_id: "DOWN_TOKEN", side: "SELL", size: "4", price: "0.906", match_time: "2026-07-16T18:36:42.000Z", transaction_hash: "0xtx" },
    ], request);
    assert.ok(fill);
    assert.equal(fill.filledSize, 6);
    assert.equal(fill.averagePrice, 0.894);
    assert.deepEqual(fill.tradeIds, ["fill-1", "fill-2"]);
    assert.deepEqual(fill.transactionHashes, ["0xtx"]);

    const makerFill = aggregateMatchingSellFills([{
        id: "trade-maker",
        asset_id: "UP_TOKEN",
        side: "BUY",
        size: "6",
        price: "0.894",
        match_time: "2026-07-16T18:36:43.000Z",
        trader_side: "MAKER",
        transaction_hash: "0xmaker",
        maker_orders: [{
            order_id: "maker-sell-order",
            asset_id: "DOWN_TOKEN",
            side: "SELL",
            matched_amount: "6",
            price: "0.894",
        }],
    }], request);
    assert.ok(makerFill);
    assert.equal(makerFill.filledSize, 6);
    assert.equal(makerFill.averagePrice, 0.894);

    assert.equal(aggregateMatchingSellFills([
        { id: "old", asset_id: "DOWN_TOKEN", side: "SELL", size: "6", price: "0.9", match_time: "2026-07-16T18:30:00.000Z" },
    ], request), null);

    const open = findMatchingOpenSellOrder([
        { id: "buy", asset_id: "DOWN_TOKEN", side: "BUY", status: "live", original_size: "6", size_matched: "0", price: "0.75", created_at: 1784227000 },
        { id: "sell", asset_id: "DOWN_TOKEN", side: "SELL", status: "live", original_size: "6", size_matched: "1", price: "0.87", created_at: 1784227001 },
    ], request);
    assert.ok(open);
    assert.equal(open.orderId, "sell");
    assert.equal(open.filledSize, 1);
    assert.equal(open.remainingSize, 5);
}

run();
