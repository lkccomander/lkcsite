import assert from "node:assert/strict";

process.env.PAPER_TRADING = "false";
process.env.POLYMARKET_PRIVATE_KEY =
    process.env.POLYMARKET_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";
process.env.PROXY_WALLET_ADDRESS =
    process.env.PROXY_WALLET_ADDRESS || "0x0000000000000000000000000000000000000001";
process.env.POLYMARKET_SIGNATURE_TYPE = process.env.POLYMARKET_SIGNATURE_TYPE || "0";

const { Trade } = require("../src/trade") as typeof import("../src/trade");
const { Market } = require("../src/types") as typeof import("../src/types");

type BalanceResponse = { balance: string };

const runtimeConfig = {
    tickSize: "0.01" as const,
    negRisk: false,
    minOrderSize: null,
};

globalThis.__CONFIG__ = {
    strategy: "trade_4",
    trade_usd: 5,
    max_retries: 0,
    market: {
        market_coin: "btc",
        market_period: "5",
    },
    trade_4: {
        entry_price_ratio: [0.1, 0.28],
        entry_time_ratio: 0.35,
        min_seconds_to_close: 80,
        max_seconds_to_close: 230,
        max_entry_price: 0.74,
        min_entry_price: 0.52,
        stop_loss_price: 0.5,
        take_profit_price: 0.86,
        emergency_swap_price: [0, 0.06],
        hold_to_end_price: 0.9,
        max_trades_per_market: 1,
        max_open_positions: 1,
        cooldown_after_loss_markets: 4,
        daily_stop_loss_usd: 6,
        session_stop_loss_usd: 3,
        exit_price_ratio_range: [[0, 0.52], [0.86, 1]],
        require_fee_adjusted_edge: true,
        min_fee_adjusted_edge: 0.02,
        min_observed_markets_before_trade: 5,
        require_websocket: true,
        reject_on_missing_websocket: true,
        max_feed_age_ms: 900,
        max_rtt_ms: 300,
        max_allowed_spread: 0.04,
        latest_entry_seconds_before_close: 80,
        forced_exit_seconds_before_close: 25,
        exit_reprice_enabled: true,
        exit_reprice_after_ms: 1500,
        exit_reprice_max_attempts: 2,
        max_market_transition_grace_ms: 1000,
        require_reject_reason: true,
        use_passive_maker_orders: true,
        maker_rebate_bps: 0,
        reject_if_price_moves_against_us_fast: true,
        max_price_change_after_signal: 0.025,
        prevent_opposite_side_reentry: true,
        opposite_side_cooldown_seconds: 120,
    },
};

function usdWei(amount: number): string {
    return String(Math.round(amount * 1e6));
}

function makeTrade(client: any): InstanceType<typeof Trade> {
    const trade = new Trade(100, "btc-5m-test", "UP_TOKEN", "DOWN_TOKEN", client, runtimeConfig);
    trade.upBuyPrice = 0.66;
    trade.upSellPrice = 0.64;
    trade.downBuyPrice = 0.34;
    trade.downSellPrice = 0.32;
    trade.holdingStatus = Market.Up;
    trade.share = 2;
    trade.hasBought = true;
    trade.positionState = "OPEN";
    trade.remainingTime = 20;
    return trade;
}

function buildClient(options: {
    upBalances: BalanceResponse[];
    downBalances?: BalanceResponse[];
    collateralBalances?: BalanceResponse[];
    createAndPostOrder?: (...args: any[]) => Promise<any>;
    createAndPostMarketOrder?: (...args: any[]) => Promise<any>;
    getOrder?: (orderId: string) => Promise<any>;
    getOpenOrders?: (...args: any[]) => Promise<any[]>;
    cancelOrder?: (...args: any[]) => Promise<any>;
}) {
    let upBalanceIndex = 0;
    let downBalanceIndex = 0;
    let collateralBalanceIndex = 0;
    const downBalances = options.downBalances ?? [{ balance: usdWei(0) }];
    const collateralBalances = options.collateralBalances ?? [{ balance: usdWei(100) }];
    const calls = {
        createAndPostOrder: 0,
        cancelOrder: 0,
    };
    return {
        calls,
        async getBalanceAllowance(payload: { asset_type: string; token_id?: string }) {
            if (payload.asset_type === "COLLATERAL") {
                const value = collateralBalances[Math.min(collateralBalanceIndex, collateralBalances.length - 1)] ?? { balance: usdWei(100) };
                collateralBalanceIndex += 1;
                return value;
            }
            const isUp = payload.token_id === "UP_TOKEN";
            const queue = isUp ? options.upBalances : downBalances;
            const index = isUp ? upBalanceIndex : downBalanceIndex;
            const value = queue[Math.min(index, queue.length - 1)] ?? { balance: "0" };
            if (isUp) {
                upBalanceIndex += 1;
            } else {
                downBalanceIndex += 1;
            }
            return value;
        },
        async createAndPostOrder(...args: any[]) {
            calls.createAndPostOrder += 1;
            if (!options.createAndPostOrder) {
                return { success: true, status: "matched", orderID: "matched-order" };
            }
            return options.createAndPostOrder(...args);
        },
        async createAndPostMarketOrder(...args: any[]) {
            if (!options.createAndPostMarketOrder) {
                return { success: true, status: "matched", orderID: "market-order" };
            }
            return options.createAndPostMarketOrder(...args);
        },
        async getOrder(orderId: string) {
            if (!options.getOrder) {
                throw new Error(`missing getOrder mock for ${orderId}`);
            }
            return options.getOrder(orderId);
        },
        async getOpenOrders(...args: any[]) {
            if (!options.getOpenOrders) {
                return [];
            }
            return options.getOpenOrders(...args);
        },
        async cancelOrder(...args: any[]) {
            calls.cancelOrder += 1;
            if (!options.cancelOrder) {
                return { success: true };
            }
            return options.cancelOrder(...args);
        },
    };
}

async function testSellMatchedClosesPosition() {
    const client = buildClient({
        upBalances: [
            { balance: usdWei(2) },
            { balance: usdWei(2) },
            { balance: usdWei(0) },
        ],
        createAndPostOrder: async () => ({ success: true, status: "matched", orderID: "matched-order" }),
    });
    const trade = makeTrade(client);

    const result = await trade.sellUpToken();
    assert.equal(result, true);
    assert.equal(trade.positionState, "CLOSED");
    assert.equal(Object.keys(trade.openExitOrders).length, 0);
}

async function testSellLiveCreatesPendingExit() {
    const client = buildClient({
        upBalances: [
            { balance: usdWei(2) },
            { balance: usdWei(2) },
        ],
        createAndPostOrder: async () => ({ success: true, status: "live", orderID: "live-order", size_matched: "0" }),
        getOrder: async () => ({
            id: "live-order",
            status: "live",
            market: "btc-5m-test",
            asset_id: "UP_TOKEN",
            side: "SELL",
            original_size: "2",
            size_matched: "0",
            price: "0.64",
        }),
    });
    const trade = makeTrade(client);

    const result = await trade.sellUpToken();
    assert.equal(result, false);
    assert.equal(trade.positionState, "EXIT_PENDING");
    assert.ok(trade.openExitOrders["btc-5m-test:UP_TOKEN:Up"]);
    assert.equal(client.calls.createAndPostOrder, 1);
}

async function testReconcilePartialExit() {
    const client = buildClient({
        upBalances: [{ balance: usdWei(2) }],
        getOrder: async () => ({
            id: "live-order",
            status: "live",
            market: "btc-5m-test",
            asset_id: "UP_TOKEN",
            side: "SELL",
            original_size: "2",
            size_matched: "1",
            price: "0.64",
        }),
    });
    const trade = makeTrade(client);
    trade.openExitOrders["btc-5m-test:UP_TOKEN:Up"] = {
        orderId: "live-order",
        tokenId: "UP_TOKEN",
        marketSlug: "btc-5m-test",
        side: Market.Up,
        price: 0.64,
        requestedSize: 2,
        filledSize: 0,
        remainingSize: 2,
        status: "live",
        createdAt: new Date(Date.now() - 5000).toISOString(),
        lastCheckedAt: null,
        repriceAttempts: 0,
    };

    await trade.reconcileOpenExitOrders();
    assert.equal(trade.positionState, "EXIT_PARTIAL");
    assert.equal(trade.openExitOrders["btc-5m-test:UP_TOKEN:Up"].filledSize, 1);
    assert.equal(trade.openExitOrders["btc-5m-test:UP_TOKEN:Up"].remainingSize, 1);
}

async function testDuplicateExitIsSkipped() {
    const client = buildClient({
        upBalances: [{ balance: usdWei(2) }],
        getOrder: async () => ({
            id: "live-order",
            status: "live",
            market: "btc-5m-test",
            asset_id: "UP_TOKEN",
            side: "SELL",
            original_size: "2",
            size_matched: "0",
            price: "0.64",
        }),
    });
    const trade = makeTrade(client);
    trade.remainingTime = 40;
    trade.openExitOrders["btc-5m-test:UP_TOKEN:Up"] = {
        orderId: "live-order",
        tokenId: "UP_TOKEN",
        marketSlug: "btc-5m-test",
        side: Market.Up,
        price: 0.64,
        requestedSize: 2,
        filledSize: 0,
        remainingSize: 2,
        status: "live",
        createdAt: new Date().toISOString(),
        lastCheckedAt: null,
        repriceAttempts: 0,
    };

    const result = await trade.sellUpToken();
    assert.equal(result, false);
    assert.equal(client.calls.createAndPostOrder, 0);
}

async function testStaleSnapshotSkipsLiveSell() {
    const client = buildClient({
        upBalances: [{ balance: usdWei(2) }],
    });
    const trade = makeTrade(client);
    trade.upBuyPrice = 0.99;
    trade.upSellPrice = 0.01;

    const result = await trade.sellUpToken();
    assert.equal(result, false);
    assert.equal(client.calls.createAndPostOrder, 0);
}

async function testBalanceErrorCanBeTreatedAsReserved() {
    let tradeRef: InstanceType<typeof Trade>;
    const client = buildClient({
        upBalances: [
            { balance: usdWei(2) },
            { balance: usdWei(2) },
        ],
        createAndPostOrder: async () => {
            tradeRef.openExitOrders["btc-5m-test:UP_TOKEN:Up"] = {
                orderId: "race-live-order",
                tokenId: "UP_TOKEN",
                marketSlug: "btc-5m-test",
                side: Market.Up,
                price: 0.64,
                requestedSize: 2,
                filledSize: 0,
                remainingSize: 2,
                status: "live",
                createdAt: new Date().toISOString(),
                lastCheckedAt: null,
                repriceAttempts: 0,
            };
            throw new Error("not enough balance / allowance: the balance is not enough -> balance: 0");
        },
    });
    const trade = makeTrade(client);
    tradeRef = trade;

    const result = await trade.sellUpToken();
    assert.equal(result, false);
    assert.equal(trade.positionState, "EXIT_PENDING");
}

async function testForcedExitRepriceCancelsAndReposts() {
    let getOrderCalls = 0;
    const client = buildClient({
        upBalances: [
            { balance: usdWei(2) },
            { balance: usdWei(2) },
            { balance: usdWei(2) },
            { balance: usdWei(2) },
        ],
        createAndPostOrder: async () => ({ success: true, status: "live", orderID: "repriced-order", size_matched: "0" }),
        getOrder: async () => {
            getOrderCalls += 1;
            if (getOrderCalls === 1) {
                return {
                    id: "old-live-order",
                    status: "live",
                    market: "btc-5m-test",
                    asset_id: "UP_TOKEN",
                    side: "SELL",
                    original_size: "2",
                    size_matched: "0",
                    price: "0.64",
                };
            }
            if (getOrderCalls === 2) {
                return {
                    id: "old-live-order",
                    status: "canceled",
                    market: "btc-5m-test",
                    asset_id: "UP_TOKEN",
                    side: "SELL",
                    original_size: "2",
                    size_matched: "0",
                    price: "0.64",
                };
            }
            return {
                id: "repriced-order",
                status: "live",
                market: "btc-5m-test",
                asset_id: "UP_TOKEN",
                side: "SELL",
                original_size: "2",
                size_matched: "0",
                price: "0.63",
            };
        },
        cancelOrder: async () => ({ success: true }),
    });
    const trade = makeTrade(client);
    trade.remainingTime = 20;
    trade.openExitOrders["btc-5m-test:UP_TOKEN:Up"] = {
        orderId: "old-live-order",
        tokenId: "UP_TOKEN",
        marketSlug: "btc-5m-test",
        side: Market.Up,
        price: 0.64,
        requestedSize: 2,
        filledSize: 0,
        remainingSize: 2,
        status: "live",
        createdAt: new Date(Date.now() - 3000).toISOString(),
        lastCheckedAt: null,
        repriceAttempts: 0,
    };

    const result = await trade.sellUpToken();
    assert.equal(result, false);
    assert.equal(client.calls.cancelOrder, 1);
    assert.equal(client.calls.createAndPostOrder, 1);
    assert.equal(trade.openExitOrders["btc-5m-test:UP_TOKEN:Up"].orderId, "repriced-order");
    assert.equal(trade.openExitOrders["btc-5m-test:UP_TOKEN:Up"].repriceAttempts, 1);
}

async function testEntryBlockedByExitPending() {
    const client = buildClient({
        upBalances: [{ balance: usdWei(2) }],
        getOrder: async () => ({
            id: "live-order",
            status: "live",
            market: "btc-5m-test",
            asset_id: "UP_TOKEN",
            side: "SELL",
            original_size: "2",
            size_matched: "0",
            price: "0.64",
        }),
    });
    const trade = makeTrade(client);
    trade.openExitOrders["btc-5m-test:UP_TOKEN:Up"] = {
        orderId: "live-order",
        tokenId: "UP_TOKEN",
        marketSlug: "btc-5m-test",
        side: Market.Up,
        price: 0.64,
        requestedSize: 2,
        filledSize: 0,
        remainingSize: 2,
        status: "live",
        createdAt: new Date().toISOString(),
        lastCheckedAt: null,
        repriceAttempts: 0,
    };

    const allowed = await trade.validateExecutionSafety("DOWN", 0.33);
    assert.equal(allowed, false);
}

async function main() {
    await testSellMatchedClosesPosition();
    await testSellLiveCreatesPendingExit();
    await testReconcilePartialExit();
    await testDuplicateExitIsSkipped();
    await testStaleSnapshotSkipsLiveSell();
    await testBalanceErrorCanBeTreatedAsReserved();
    await testForcedExitRepriceCancelsAndReposts();
    await testEntryBlockedByExitPending();
    console.log("check3 lifecycle harness passed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
