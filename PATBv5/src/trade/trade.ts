import { AssetType, OrderType, Side } from "@polymarket/clob-client-v2";
import { PAPER_TRADING } from "../config";
import { getTrade4LikeConfig } from "../config/toml";
import { getFeedHealth } from "../signals/feedgate";
import { writeTelemetryEventSafe } from "../telemetry";
import { Market } from "../types";
import { GLOBAL_TX_PROCESS, TxProcess } from "../constant";
import { retryWithInstantRetry } from "../utils/retry";
import { playCliAlertSound } from "../utils/cliAlert";
import {
    clampPrice,
    CRYPTO_TAKER_FEE_RATE,
    MAKER_PRICE_STEP,
    makerRebateUsd as calculateMakerRebateUsd,
    midMarketPrice,
    passiveMakerBuyPrice,
    passiveMakerSellPrice,
    protocolFeeFactor,
    takerFeeRate,
    takerFeeUsd as calculateTakerFeeUsd,
} from "./policy/executionPricing";

declare module "./index" {
    interface Trade {
        make_trading_decision(): void;
        buyUpToken(): Promise<void>;
        buyDownToken(): Promise<void>;
        sellUpToken(): Promise<boolean>;
        sellDownToken(): Promise<boolean>;
        updateTokenBalances(): Promise<void>;
        waitForBalance(tokenType: "up" | "down", timeoutMs?: number): Promise<void>;
        validateExecutionSafety(side: "UP" | "DOWN", executionPrice: number): Promise<boolean>;
        recordExecutedEntry(side: "UP" | "DOWN", entryPrice: number, executedAt?: string, details?: Record<string, unknown>): void;
        recordExternalPricePoint(priceUsd: number, fetchedAt: string): void;
        reconcilePendingEntryState(): Promise<boolean>;
        hydrateOpenEntryOrders(): Promise<void>;
        getExitOrderStatus(orderId: string): Promise<{
            status: "live" | "matched" | "partial" | "canceled" | "expired" | "rejected" | "unknown";
            filledSize?: number;
            remainingSize?: number;
            avgPrice?: number;
        }>;
        hydrateOpenExitOrders(): Promise<void>;
        reconcileOpenExitOrders(): Promise<void>;
    }
}

// Function to attach methods to Trade class (called from index.ts)
export function attachTradeMethods(TradeClass: new (...args: any[]) => any) {
    const roundCurrency = (value: number): number => Math.round(value * 100) / 100;
    const roundFeeUsd = (value: number): number => Math.round(value * 100000) / 100000;
    const MAX_LIVE_SELL_SPREAD = 0.20;
    const EXIT_SKIP_TELEMETRY_COOLDOWN_MS = 15_000;
    const POSITION_DUST_THRESHOLD_SHARES = 0.05;

    const takerFeeUsd = (price: number, notionalUsd: number): number =>
        calculateTakerFeeUsd(price, notionalUsd, 5);

    const makerRebateUsd = (_price: number, notionalUsd: number): number => {
        const rebateBps = Number(getTrade4LikeConfig(globalThis.__CONFIG__)?.maker_rebate_bps ?? 0);
        return calculateMakerRebateUsd(notionalUsd, rebateBps, 5);
    };

    const affordablePaperTradeAmount = (availableUsd: number, targetTradeUsd: number, price: number): number => {
        const feeRate = takerFeeRate(price);
        const cappedTradeUsd = Math.min(targetTradeUsd, availableUsd);
        if (!Number.isFinite(cappedTradeUsd) || cappedTradeUsd <= 0) {
            return 0;
        }
        return roundCurrency(cappedTradeUsd / (1 + feeRate));
    };

    const playCliTradeSound = (action: "buy" | "sell"): void => {
        playCliAlertSound(action);
    };

    const getTradeAmount = (trade: any): number => {
        const configuredTradeAmount = Number(globalThis.__CONFIG__.trade_usd);
        if (!Number.isFinite(configuredTradeAmount) || configuredTradeAmount <= 0) {
            return 0;
        }
        return roundCurrency(Math.min(configuredTradeAmount, trade.usd));
    };

    const ensureLiveClient = (trade: any): void => {
        if (!trade.authorizedClob) {
            throw new Error("Live trading client is not configured");
        }
    };
    const getLiveOrderOptions = (trade: any) => ({
        tickSize: trade.tickSize,
        negRisk: trade.negRisk,
    });
    const canPlaceLiveOrder = (
        trade: any,
        shareSize: number,
        side: "UP" | "DOWN",
        action: "buy" | "sell",
        price: number,
        usdAmount?: number,
    ): boolean => {
        const minOrderSize = trade.minOrderSize;
        if (!Number.isFinite(minOrderSize) || minOrderSize === null || minOrderSize <= 0) {
            return true;
        }
        if (shareSize >= minOrderSize) {
            return true;
        }

        const valueLabel = usdAmount !== undefined ? ` | usd=$${usdAmount.toFixed(2)}` : "";
        console.log(
            `⏭️  Skipping live ${side} ${action}: estimated size ${shareSize.toFixed(4)} is below market minimum ${minOrderSize.toFixed(4)} | price=${price.toFixed(2)}${valueLabel}`
        );
        return false;
    };
    const emitSimulatedOrderFlow = async (
        trade: any,
        payload: Record<string, unknown>,
    ): Promise<void> => {
        await writeTelemetryEventSafe("simulated_order_flow", {
            strategy: globalThis.__CONFIG__.strategy,
            decisionSource: trade.lastDecisionSnapshotSource,
            feedAgeMs: trade.latestFeedAgeMs,
            feedLatencyMs: trade.latestFeedLatencyMs,
            feedRttMs: trade.latestFeedRttMs,
            externalPriceUsd: trade.latestExternalPriceUsd,
            externalPriceSource: trade.latestExternalPriceSource,
            externalPriceFetchedAt: trade.latestExternalPriceFetchedAt,
            ...payload,
        });
    };
    const safeTelemetryNumber = (value: number | null | undefined, fallback = -1): number =>
        Number.isFinite(value) ? Number(value) : fallback;
    const deriveBuyTelemetrySource = (trade: any): "websocket" | "fallback" | "rest" => {
        if (trade.latestFeedSnapshotSource === "websocket" && trade.latestFeedWsConnected) {
            return "websocket";
        }
        if (trade.latestFeedSnapshotSource === "rest" && trade.latestFeedLastFallbackReason) {
            return "fallback";
        }
        return "rest";
    };
    const externalPriceAtOrBefore = (trade: any, targetTimestampMs: number): number | null => {
        const history = Array.isArray(trade.externalPriceHistory) ? trade.externalPriceHistory : [];
        for (let index = history.length - 1; index >= 0; index -= 1) {
            const point = history[index];
            const pointTimestampMs = Date.parse(String(point?.fetchedAt ?? ""));
            if (!Number.isFinite(pointTimestampMs)) {
                continue;
            }
            if (pointTimestampMs <= targetTimestampMs) {
                const priceUsd = Number(point?.priceUsd);
                return Number.isFinite(priceUsd) && priceUsd > 0 ? priceUsd : null;
            }
        }
        return null;
    };
    const computeExternalBtcDeltas = (trade: any, executionTimestamp: string) => {
        const executionTimestampMs = Date.parse(executionTimestamp);
        const currentBtcPrice = Number(trade.latestExternalPriceUsd);
        const current = Number.isFinite(currentBtcPrice) && currentBtcPrice > 0 ? currentBtcPrice : null;
        const price5sAgo = Number.isFinite(executionTimestampMs) ? externalPriceAtOrBefore(trade, executionTimestampMs - 5_000) : null;
        const price15sAgo = Number.isFinite(executionTimestampMs) ? externalPriceAtOrBefore(trade, executionTimestampMs - 15_000) : null;
        const price30sAgo = Number.isFinite(executionTimestampMs) ? externalPriceAtOrBefore(trade, executionTimestampMs - 30_000) : null;
        const toDelta = (previous: number | null): number | null =>
            current !== null && previous !== null && previous > 0
                ? roundFeeUsd((current - previous) / previous)
                : null;
        const btcDelta5s = toDelta(price5sAgo);
        const btcDelta15s = toDelta(price15sAgo);
        const btcDelta30s = toDelta(price30sAgo);
        const btcTrendDirection =
            btcDelta30s === null ? "FLAT" :
            btcDelta30s > 0 ? "UP" :
            btcDelta30s < 0 ? "DOWN" :
            "FLAT";

        return {
            externalBtcPriceAtEntry: current,
            btcPrice5sAgo: price5sAgo,
            btcPrice15sAgo: price15sAgo,
            btcPrice30sAgo: price30sAgo,
            btcDelta5s,
            btcDelta15s,
            btcDelta30s,
            btcTrendDirection,
        };
    };
    const buildBuyTelemetryPayload = (
        trade: any,
        payload: {
            side: "UP" | "DOWN";
            entryPrice: number;
            decisionTimestamp: string;
            executionTimestamp: string;
            entrySignal?: Record<string, unknown> | null;
            [key: string]: unknown;
        },
    ): Record<string, unknown> => {
        const decisionAtMs = Date.parse(payload.decisionTimestamp);
        const executionAtMs = Date.parse(payload.executionTimestamp);
        const decisionToExecutionMs =
            Number.isFinite(decisionAtMs) && Number.isFinite(executionAtMs)
                ? Math.max(0, executionAtMs - decisionAtMs)
                : -1;
        const btcTelemetry = computeExternalBtcDeltas(trade, payload.executionTimestamp);
        const trade4 = getTrade4LikeConfig(globalThis.__CONFIG__);
        const entrySignal = payload.entrySignal && typeof payload.entrySignal === "object"
            ? payload.entrySignal
            : null;
        const feedHealth = trade4 ? getFeedHealth({
            latencyMs: trade.latestFeedLatencyMs,
            rttMs: trade.latestFeedRttMs,
            ageMs: trade.latestFeedAgeMs,
            wsConnected: trade.latestFeedWsConnected,
            snapshotSource: trade.latestFeedSnapshotSource,
            msSinceLastFallback: trade.latestFeedMsSinceLastFallback,
            tickTimestamps: Array.isArray(trade.priceTickTimestamps) ? trade.priceTickTimestamps : [],
        }, {
            requireWebsocket: Boolean(trade4.require_websocket),
            rejectOnMissingWebsocket: Boolean(trade4.reject_on_missing_websocket),
            recentWsFallbackCooldownMs: Number(trade4.recent_ws_fallback_cooldown_ms ?? 2000),
            maxEntryFeedLatencyMs: Number(trade4.max_entry_feed_latency_ms ?? 400),
            maxEntryFeedRttMs: Number(trade4.max_entry_feed_rtt_ms ?? 400),
            maxEntryFeedAgeMs: Number(trade4.max_entry_feed_age_ms ?? 500),
        }) : null;

        return {
            momentumDirection: payload.momentumDirection ?? entrySignal?.momentumDirection ?? trade.pendingEntrySignal?.momentumDirection ?? null,
            momentumScore: payload.momentumScore ?? entrySignal?.momentumScore ?? trade.pendingEntrySignal?.momentumScore ?? null,
            momentumConfidence: payload.momentumConfidence ?? entrySignal?.momentumConfidence ?? trade.pendingEntrySignal?.momentumConfidence ?? null,
            mcConvergence: payload.mcConvergence ?? entrySignal?.mcConvergence ?? trade.pendingEntrySignal?.mcConvergence ?? null,
            mcSimulatedDirection: payload.mcSimulatedDirection ?? entrySignal?.mcSimulatedDirection ?? trade.pendingEntrySignal?.mcSimulatedDirection ?? null,
            mcBullPaths: payload.mcBullPaths ?? entrySignal?.mcBullPaths ?? trade.pendingEntrySignal?.mcBullPaths ?? null,
            mcBearPaths: payload.mcBearPaths ?? entrySignal?.mcBearPaths ?? trade.pendingEntrySignal?.mcBearPaths ?? null,
            feedTicksLast10s: feedHealth?.ticksLast10s ?? null,
            feedFallbackActive: feedHealth?.fallbackActive ?? null,
            feedLastFallbackAgoMs: feedHealth?.lastFallbackAgo ?? null,
            feedHealthy: feedHealth?.healthy ?? null,
            strategy: globalThis.__CONFIG__.strategy,
            marketSlug: trade.marketSlug,
            side: payload.side,
            tradeSide: payload.side,
            entryPrice: payload.entryPrice,
            ...btcTelemetry,
            feedLatencyMs: safeTelemetryNumber(trade.latestFeedLatencyMs),
            feedRttMs: safeTelemetryNumber(trade.latestFeedRttMs),
            feedAgeMs: safeTelemetryNumber(trade.latestFeedAgeMs),
            wsConnected: Boolean(trade.latestFeedWsConnected),
            wasInFallbackRecently: Boolean(trade.latestFeedWasInFallbackRecently),
            lastWsFallbackAt: trade.latestFeedLastFallbackAt,
            msSinceLastWsFallback: safeTelemetryNumber(trade.latestFeedMsSinceLastFallback),
            source: deriveBuyTelemetrySource(trade),
            decisionTimestamp: payload.decisionTimestamp,
            executionTimestamp: payload.executionTimestamp,
            decisionToExecutionMs,
            secondsBeforeClose: Math.max(0, Number(trade.remainingTime) || 0),
            decisionSource: trade.lastDecisionSnapshotSource,
            feedSnapshotSource: trade.latestFeedSnapshotSource,
            feedFallbackCount: trade.latestFeedFallbackCount,
            feedLastFallbackReason: trade.latestFeedLastFallbackReason,
            externalPriceUsd: trade.latestExternalPriceUsd,
            externalPriceSource: trade.latestExternalPriceSource,
            externalPriceFetchedAt: trade.latestExternalPriceFetchedAt,
            positionState: trade.positionState,
            holdingStatus: trade.holdingStatus,
            ...payload,
        };
    };
    const sleepMs = async (ms: number): Promise<void> => {
        await new Promise((resolve) => setTimeout(resolve, ms));
    };
    const decisionToExecutionMs = (decisionTimestamp: string, executionTimestamp: string): number => {
        const decisionAtMs = Date.parse(decisionTimestamp);
        const executionAtMs = Date.parse(executionTimestamp);
        if (!Number.isFinite(decisionAtMs) || !Number.isFinite(executionAtMs)) {
            return -1;
        }
        return Math.max(0, executionAtMs - decisionAtMs);
    };
    const normalizeExitReason = (reason: string | null | undefined): string => {
        switch (reason) {
            case "market_close":
                return "timeout";
            case "manual_exit":
                return "manual";
            case "emergency_exit":
                return "emergency_swap";
            default:
                return reason ?? "unknown_error";
        }
    };
    const sideToMarket = (side: "UP" | "DOWN"): Market.Up | Market.Down =>
        side === "UP" ? Market.Up : Market.Down;
    const marketToExecutionSide = (side: Market.Up | Market.Down): "UP" | "DOWN" =>
        side === Market.Up ? "UP" : "DOWN";
    const buildSignalRejectedPayload = (
        trade: any,
        reason: string,
        extra: Record<string, unknown> = {},
    ): Record<string, unknown> => {
        const upSpread = Number.isFinite(trade.upBuyPrice) && Number.isFinite(trade.upSellPrice)
            ? Math.round((trade.upBuyPrice - trade.upSellPrice) * 10000) / 10000
            : null;
        const downSpread = Number.isFinite(trade.downBuyPrice) && Number.isFinite(trade.downSellPrice)
            ? Math.round((trade.downBuyPrice - trade.downSellPrice) * 10000) / 10000
            : null;
        const inferredSide = trade.upBuyPrice >= trade.downBuyPrice ? "UP" : "DOWN";
        const rawSide = extra.intendedSide ?? extra.selectedSide ?? extra.requestedSide ?? extra.side;
        const normalizedSide = rawSide === Market.Up || rawSide === "UP"
            ? "UP"
            : rawSide === Market.Down || rawSide === "DOWN"
                ? "DOWN"
                : inferredSide;
        const entryPriceChecked = typeof extra.entryPriceChecked === "number"
            ? extra.entryPriceChecked
            : normalizedSide === "UP"
                ? trade.upBuyPrice
                : trade.downBuyPrice;
        const spreadChecked = typeof extra.spreadChecked === "number"
            ? extra.spreadChecked
            : normalizedSide === "UP"
                ? upSpread
                : downSpread;

        return {
            strategy: globalThis.__CONFIG__.strategy,
            reason,
            decisionSource: trade.lastDecisionSnapshotSource,
            remainingTime: trade.remainingTime,
            secondsToClose: trade.remainingTime,
            observedMarketTicks: trade.observedMarketTicks,
            holdingStatus: trade.holdingStatus,
            feedAgeMs: trade.latestFeedAgeMs,
            feedLatencyMs: trade.latestFeedLatencyMs,
            feedRttMs: trade.latestFeedRttMs,
            feedWsConnected: trade.latestFeedWsConnected,
            feedSnapshotSource: trade.latestFeedSnapshotSource,
            feedFallbackCount: trade.latestFeedFallbackCount,
            feedLastFallbackReason: trade.latestFeedLastFallbackReason,
            externalPriceUsd: trade.latestExternalPriceUsd,
            externalPriceSource: trade.latestExternalPriceSource,
            externalPriceFetchedAt: trade.latestExternalPriceFetchedAt,
            priceToBeat: trade.priceToBeat,
            finalPrice: trade.finalPrice,
            priceToBeatSource: trade.priceToBeatSource,
            upBuyPrice: trade.upBuyPrice,
            upSellPrice: trade.upSellPrice,
            downBuyPrice: trade.downBuyPrice,
            downSellPrice: trade.downSellPrice,
            intendedSide: normalizedSide,
            selectedSide: normalizedSide,
            upSpread,
            downSpread,
            spreadChecked,
            entryPriceChecked,
            ...extra,
        };
    };
    const resolveExitReason = (trade: any): string => normalizeExitReason(trade.pendingExitReason);
    const resolveExitErrorContext = (trade: any): string | null => trade.pendingExitErrorContext ?? null;
    const getCurrentEntryPrice = (trade: any, side: "UP" | "DOWN"): number =>
        side === "UP" ? Number(trade.upBuyPrice) : Number(trade.downBuyPrice);
    const toRoundedSize = (value: unknown): number => {
        const parsed = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) {
            return 0;
        }
        return Math.round(parsed * 1_000_000) / 1_000_000;
    };
    const exitOrderKey = (marketSlug: string, tokenId: string, side: Market.Up | Market.Down): string =>
        `${marketSlug}:${tokenId}:${side}`;
    const getExitTokenId = (trade: any, side: Market.Up | Market.Down): string =>
        side === Market.Up ? trade.upTokenId : trade.downTokenId;
    const getExitPrice = (trade: any, side: Market.Up | Market.Down): number =>
        side === Market.Up ? Number(trade.upSellPrice) : Number(trade.downSellPrice);
    const getExistingExitOrder = (trade: any, side: Market.Up | Market.Down, tokenId = getExitTokenId(trade, side)) =>
        trade.openExitOrders?.[exitOrderKey(trade.marketSlug, tokenId, side)] ?? null;
    const isForcedExitWindow = (trade: any): boolean => {
        const trade4 = getTrade4LikeConfig(globalThis.__CONFIG__);
        return Boolean(trade4 && Number.isFinite(trade.remainingTime) && trade.remainingTime <= trade4.forced_exit_seconds_before_close);
    };
    const getBlockingExitOrder = (trade: any) => {
        const orders = Object.values(trade.openExitOrders ?? {}) as Array<Record<string, any>>;
        return orders.find((order) => order.marketSlug === trade.marketSlug) ?? null;
    };
    const removeExitOrder = (trade: any, order: { marketSlug?: string; tokenId?: string; side?: Market.Up | Market.Down } | null | undefined): void => {
        if (!order?.marketSlug || !order?.tokenId || !order?.side) {
            return;
        }
        delete trade.openExitOrders[exitOrderKey(order.marketSlug, order.tokenId, order.side)];
    };
    const upsertExitOrder = (trade: any, order: Record<string, any>): void => {
        trade.openExitOrders[exitOrderKey(order.marketSlug, order.tokenId, order.side)] = order;
    };
    const clearPositionIfDust = (trade: any): void => {
        if (trade.holdingStatus === Market.Up || trade.holdingStatus === Market.Down) {
            if (Number(trade.share) <= POSITION_DUST_THRESHOLD_SHARES) {
                trade.share = 0;
                trade.holdingStatus = Market.None;
            }
        }
    };
    const markPositionClosed = (trade: any): void => {
        trade.share = 0;
        trade.holdingStatus = Market.None;
        trade.positionState = "CLOSED";
    };
    const shouldEmitExitSkipTelemetry = (trade: any, order: Record<string, any>): boolean => {
        const now = Date.now();
        const lastSkipTelemetryAt = Date.parse(String(order.lastSkipTelemetryAt ?? ""));
        if (Number.isFinite(lastSkipTelemetryAt) && now - lastSkipTelemetryAt < EXIT_SKIP_TELEMETRY_COOLDOWN_MS) {
            upsertExitOrder(trade, order);
            return false;
        }
        order.lastSkipTelemetryAt = new Date(now).toISOString();
        upsertExitOrder(trade, order);
        return true;
    };
    const syncPositionStateFromHoldings = (trade: any): void => {
        const openOrders = Object.values(trade.openExitOrders ?? {}) as Array<Record<string, any>>;
        if (openOrders.length > 0) {
            const hasPartial = openOrders.some((order) => Number(order.filledSize) > 0);
            trade.positionState = hasPartial ? "EXIT_PARTIAL" : "EXIT_PENDING";
            return;
        }

        if ((trade.holdingStatus === Market.Up || trade.holdingStatus === Market.Down) && trade.share > 0) {
            trade.positionState = "OPEN";
            return;
        }

        trade.positionState = trade.hasBought ? "CLOSED" : "NONE";
    };
    const clearPendingEntryReconciliation = (trade: any): void => {
        trade.pendingEntryReconciliation = null;
        syncPositionStateFromHoldings(trade);
    };
    const isPendingEntryReconciliationActive = (trade: any): boolean =>
        Boolean(trade.pendingEntryReconciliation?.orderId);
    const emitExitEvent = async (type: "trade.exit_attempt" | "trade.exit_pending" | "trade.exit_partial" | "trade.exit_filled" | "trade.exit_failed" | "trade.exit_skipped_existing_live_order" | "trade.exit_skipped_stale_snapshot" | "trade.exit_balance_reserved_by_live_order", trade: any, payload: Record<string, unknown>): Promise<void> => {
        await writeTelemetryEventSafe(type, {
            strategy: globalThis.__CONFIG__.strategy,
            decisionSource: trade.lastDecisionSnapshotSource,
            positionState: trade.positionState,
            holdingStatus: trade.holdingStatus,
            feedAgeMs: trade.latestFeedAgeMs,
            feedLatencyMs: trade.latestFeedLatencyMs,
            feedRttMs: trade.latestFeedRttMs,
            marketSlug: trade.marketSlug,
            ...payload,
        });
        if (type === "trade.exit_failed") {
            playCliAlertSound("error");
        }
    };
    const shouldSkipLiveSellForStaleSnapshot = async (
        trade: any,
        side: "UP" | "DOWN",
        askPrice: number,
        bidPrice: number,
    ): Promise<boolean> => {
        const spread = askPrice - bidPrice;
        const staleSnapshot =
            !Number.isFinite(askPrice) ||
            !Number.isFinite(bidPrice) ||
            askPrice <= 0 ||
            bidPrice <= 0 ||
            spread < 0 ||
            spread > MAX_LIVE_SELL_SPREAD;

        if (!staleSnapshot) {
            return false;
        }

        const printableSpread = Number.isFinite(spread) ? spread.toFixed(2) : "n/a";
        console.warn(
            `Skipping live ${side} sell: stale snapshot | spread=${printableSpread} | askPrice=${askPrice} | bidPrice=${bidPrice}`
        );
        await emitExitEvent("trade.exit_skipped_stale_snapshot", trade, {
            side,
            askPrice,
            bidPrice,
            spread: Number.isFinite(spread) ? spread : null,
            maxAllowedSpread: MAX_LIVE_SELL_SPREAD,
        });
        return true;
    };
    const emitEntryFilledEvent = async (
        trade: any,
        payload: Record<string, unknown>,
    ): Promise<void> => {
        await writeTelemetryEventSafe("trade.entry_filled", {
            ...buildBuyTelemetryPayload(trade, payload as any),
        });
    };
    const emitEntryPostedEvent = async (
        trade: any,
        payload: Record<string, unknown>,
    ): Promise<void> => {
        await writeTelemetryEventSafe("trade.entry_posted", {
            ...buildBuyTelemetryPayload(trade, payload as any),
        });
    };
    const emitEntryTimeoutEvent = async (
        trade: any,
        payload: Record<string, unknown>,
    ): Promise<void> => {
        await writeTelemetryEventSafe("trade.entry_timeout", {
            ...buildBuyTelemetryPayload(trade, payload as any),
        });
    };
    const getLiveEntryOrderStatus = async (
        trade: any,
        orderId: string,
    ): Promise<{
        status: "live" | "matched" | "partial" | "canceled" | "expired" | "rejected" | "unknown";
        filledSize?: number;
        remainingSize?: number;
        avgPrice?: number;
    }> => {
        if (!orderId) {
            return { status: "unknown" };
        }
        ensureLiveClient(trade);
        try {
            const order = await trade.authorizedClob.getOrder(orderId);
            return deriveExitStatusFromOpenOrder(order);
        } catch {
            try {
                const openOrders = await trade.authorizedClob.getOpenOrders({ id: orderId }, true);
                if (Array.isArray(openOrders) && openOrders.length > 0) {
                    return deriveExitStatusFromOpenOrder(openOrders[0]);
                }
            } catch {
                // Fallback below.
            }
            return { status: "unknown" };
        }
    };
    const cancelLiveEntryOrderIfOpen = async (
        trade: any,
        orderId: string,
        context: Record<string, unknown> = {},
    ): Promise<{
        status: "live" | "matched" | "partial" | "canceled" | "expired" | "rejected" | "unknown";
        filledSize?: number;
        remainingSize?: number;
        avgPrice?: number;
    }> => {
        if (!orderId) {
            return { status: "unknown" };
        }

        const initialStatus = await getLiveEntryOrderStatus(trade, orderId);
        if (initialStatus.status !== "live" && initialStatus.status !== "partial") {
            return initialStatus;
        }

        try {
            ensureLiveClient(trade);
            await trade.authorizedClob.cancelOrder({ orderID: orderId });
        } catch (error) {
            await writeTelemetryEventSafe("trade.entry_order_status_after_timeout", {
                strategy: globalThis.__CONFIG__.strategy,
                marketSlug: trade.marketSlug,
                orderId,
                reason: "entry_cancel_failed",
                errorMessage: error instanceof Error ? error.message : String(error),
                providerOrderStatus: initialStatus.status,
                ...context,
            });
            return initialStatus;
        }

        let latestStatus = initialStatus;
        for (let attempt = 0; attempt < 5; attempt += 1) {
            await sleepMs(250);
            latestStatus = await getLiveEntryOrderStatus(trade, orderId);
            if (latestStatus.status !== "live" && latestStatus.status !== "partial") {
                break;
            }
        }

        await writeTelemetryEventSafe("trade.entry_order_status_after_timeout", {
            strategy: globalThis.__CONFIG__.strategy,
            marketSlug: trade.marketSlug,
            orderId,
            reason: "entry_cancel_after_timeout",
            providerOrderStatus: latestStatus.status,
            providerFilledSize: latestStatus.filledSize ?? null,
            providerRemainingSize: latestStatus.remainingSize ?? null,
            providerAvgPrice: latestStatus.avgPrice ?? null,
            ...context,
        });
        return latestStatus;
    };
    const reconcilePendingEntryState = async (trade: any): Promise<boolean> => {
        const pending = trade.pendingEntryReconciliation;
        if (!pending?.orderId) {
            clearPendingEntryReconciliation(trade);
            return true;
        }

        await trade.updateTokenBalances();
        const hasHoldings = (trade.holdingStatus === Market.Up || trade.holdingStatus === Market.Down) && Number(trade.share) > 0;
        if (hasHoldings) {
            await writeTelemetryEventSafe("trade.position_resolved", {
                strategy: globalThis.__CONFIG__.strategy,
                marketSlug: pending.marketSlug ?? trade.marketSlug,
                reason: "entry_timeout_balance_detected",
                sideBefore: pending.side ?? null,
                orderId: pending.orderId,
                tokenId: pending.tokenId ?? null,
                holdingStatusAfter: trade.holdingStatus,
                sharesAfter: trade.share,
                positionStateAfter: trade.positionState,
                resolvedAfterMs: Date.now() - Date.parse(String(pending.blockedAt ?? new Date().toISOString())),
                providerOrderStatus: pending.providerOrderStatus ?? null,
            });
            clearPendingEntryReconciliation(trade);
            return true;
        }

        const status = await getLiveEntryOrderStatus(trade, String(pending.orderId));
        trade.pendingEntryReconciliation = {
            ...pending,
            providerOrderStatus: status.status,
            providerFilledSize: status.filledSize ?? null,
            providerRemainingSize: status.remainingSize ?? null,
            providerAvgPrice: status.avgPrice ?? null,
            lastCheckedAt: new Date().toISOString(),
        };

        const noOpenExitOrders = Object.keys(trade.openExitOrders ?? {}).length === 0;
        const terminalNoFill = ["canceled", "expired", "rejected"].includes(status.status);
        if (terminalNoFill && noOpenExitOrders) {
            trade.hasBought = false;
            trade.pendingEntrySignal = null;
            syncPositionStateFromHoldings(trade);
            await writeTelemetryEventSafe("trade.position_resolved", {
                strategy: globalThis.__CONFIG__.strategy,
                marketSlug: pending.marketSlug ?? trade.marketSlug,
                reason: "entry_timeout_reconciled_no_fill",
                sideBefore: pending.side ?? null,
                orderId: pending.orderId,
                tokenId: pending.tokenId ?? null,
                holdingStatusAfter: trade.holdingStatus,
                sharesAfter: trade.share,
                positionStateAfter: trade.positionState,
                resolvedAfterMs: Date.now() - Date.parse(String(pending.blockedAt ?? new Date().toISOString())),
                providerOrderStatus: status.status,
                providerFilledSize: status.filledSize ?? null,
                providerRemainingSize: status.remainingSize ?? null,
                providerAvgPrice: status.avgPrice ?? null,
            });
            clearPendingEntryReconciliation(trade);
            return true;
        }

        trade.positionState = "ERROR";
        return false;
    };
    const buildSellTelemetryPayload = (
        trade: any,
        payload: {
            side: "UP" | "DOWN";
            exitPrice: number;
            shares: number;
            cashBefore: number | null;
            cashAfter: number | null;
            feeUsd: number;
            rebateUsd: number;
            reason?: string;
            errorContext?: string | null;
            [key: string]: unknown;
        },
    ): Record<string, unknown> => {
        const entry = trade.lastExecutedEntry;
        const entryPrice = entry?.entryPrice ?? null;
        const entryExecutedAtMs = entry?.executedAt ? Date.parse(entry.executedAt) : NaN;
        const holdSeconds = Number.isFinite(entryExecutedAtMs)
            ? Math.max(0, Math.round(((Date.now() - entryExecutedAtMs) / 1000) * 1000) / 1000)
            : null;
        const grossProceeds = roundCurrency(payload.shares * payload.exitPrice);
        const netProceeds = roundCurrency(grossProceeds - payload.feeUsd + payload.rebateUsd);
        const costBasisUsd = entry?.costBasisUsd ?? (entryPrice !== null ? roundCurrency(payload.shares * entryPrice) : null);
        const pnlUsd = costBasisUsd !== null ? roundCurrency(netProceeds - costBasisUsd) : null;
        const pnlPct = costBasisUsd && costBasisUsd > 0 && pnlUsd !== null
            ? roundFeeUsd((pnlUsd / costBasisUsd) * 100)
            : null;

        return {
            strategy: globalThis.__CONFIG__.strategy,
            marketSlug: trade.marketSlug,
            side: payload.side,
            tokenId: payload.tokenId ?? null,
            reason: normalizeExitReason(payload.reason ?? resolveExitReason(trade)),
            errorContext: payload.errorContext ?? resolveExitErrorContext(trade),
            entryPrice,
            exitPrice: payload.exitPrice,
            pnlUsd,
            realizedTradePnl: pnlUsd,
            pnlPct,
            holdSeconds,
            secondsBeforeClose: Math.max(0, Number(trade.remainingTime) || 0),
            shares: payload.shares,
            cashBefore: payload.cashBefore,
            cashAfter: payload.cashAfter,
            feeUsd: payload.feeUsd,
            rebateUsd: payload.rebateUsd,
            decisionSource: trade.lastDecisionSnapshotSource,
            feedAgeMs: trade.latestFeedAgeMs,
            feedLatencyMs: trade.latestFeedLatencyMs,
            feedRttMs: trade.latestFeedRttMs,
            feedWsConnected: trade.latestFeedWsConnected,
            feedSnapshotSource: trade.latestFeedSnapshotSource,
            feedFallbackCount: trade.latestFeedFallbackCount,
            feedLastFallbackReason: trade.latestFeedLastFallbackReason,
            externalPriceUsd: trade.latestExternalPriceUsd,
            externalPriceSource: trade.latestExternalPriceSource,
            externalPriceFetchedAt: trade.latestExternalPriceFetchedAt,
            grossProceeds,
            netProceeds,
            costBasisUsd,
            ...payload,
        };
    };
    const clearPendingExitIntent = (trade: any): void => {
        trade.pendingExitReason = null;
        trade.pendingExitErrorContext = null;
    };
    const isBalanceReservedError = (error: any): boolean => {
        const text = String(error?.message ?? error?.error ?? error?.data?.error ?? "").toLowerCase();
        return text.includes("not enough balance") || text.includes("allowance");
    };
    const deriveExitStatusFromOpenOrder = (order: any) => {
        const statusRaw = String(order?.status ?? "unknown").toLowerCase();
        const originalSize = toRoundedSize(order?.original_size);
        const filledSize = toRoundedSize(order?.size_matched);
        const remainingSize = originalSize > 0 ? Math.max(0, toRoundedSize(originalSize - filledSize)) : undefined;

        let status: "live" | "matched" | "partial" | "canceled" | "expired" | "rejected" | "unknown" = "unknown";
        if (statusRaw === "live") {
            status = filledSize > 0 ? "partial" : "live";
        } else if (statusRaw === "matched" || statusRaw === "filled") {
            status = "matched";
        } else if (statusRaw === "partial" || statusRaw === "partially_filled") {
            status = "partial";
        } else if (statusRaw === "canceled" || statusRaw === "cancelled") {
            status = "canceled";
        } else if (statusRaw === "expired") {
            status = "expired";
        } else if (statusRaw === "rejected" || statusRaw === "failed") {
            status = "rejected";
        }

        return {
            status,
            filledSize,
            remainingSize,
            avgPrice: toRoundedSize(order?.price),
        };
    };
    const placeLiveExitOrder = async (
        trade: any,
        side: "UP" | "DOWN",
        tokenId: string,
        makerMode: boolean,
        limitPrice: number,
        actualBalance: number,
        rawBalance: number,
    ): Promise<any> => {
        ensureLiveClient(trade);
        const maxRetries = globalThis.__CONFIG__?.max_retries || 3;
        let lastError: any;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const result = makerMode
                    ? await trade.authorizedClob.createAndPostOrder({
                        tokenID: tokenId,
                        price: limitPrice,
                        side: Side.SELL,
                        size: actualBalance,
                    }, getLiveOrderOptions(trade), OrderType.GTC)
                    : await trade.authorizedClob.createAndPostMarketOrder({
                        tokenID: tokenId,
                        amount: rawBalance,
                        side: Side.SELL,
                    }, getLiveOrderOptions(trade), OrderType.FAK);

                const statusText = String(result?.status ?? "").toLowerCase();
                const orderId = String(result?.orderID ?? result?.orderId ?? "");
                if (!result?.success && !(orderId && statusText === "live")) {
                    throw new Error(`❌ Error selling ${side.toLowerCase()} token: ${result?.error ?? result?.errorMsg ?? "unknown error"}`);
                }

                if (attempt > 0) {
                    console.log(`✅ Sell ${side} Token succeeded on retry attempt ${attempt}`);
                }
                return result;
            } catch (error: any) {
                lastError = error;
                if (error?.status === 401 || error?.data?.error?.includes("Unauthorized")) {
                    throw error;
                }
                if (attempt < maxRetries) {
                    console.log(`🔄 Sell ${side} Token failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying instantly...`);
                    continue;
                }
            }
        }

        throw lastError;
    };
    const registerAcceptedExitOrder = async (
        trade: any,
        side: Market.Up | Market.Down,
        tokenId: string,
        requestedSize: number,
        price: number,
        order: any,
        exitReason: string,
        errorContext: string | null,
        repriceAttempts = 0,
    ): Promise<void> => {
        const orderId = String(order?.orderID ?? order?.orderId ?? "");
        const statusText = String(order?.status ?? "").toLowerCase();
        const matchedSize = toRoundedSize(order?.size_matched ?? 0);
        const remainingSize = Math.max(0, toRoundedSize(requestedSize - matchedSize));

        if (!orderId) {
            return;
        }

        if (statusText === "live") {
            upsertExitOrder(trade, {
                orderId,
                tokenId,
                marketSlug: trade.marketSlug,
                side,
                price,
                requestedSize,
                filledSize: matchedSize,
                remainingSize: remainingSize > 0 ? remainingSize : requestedSize,
                status: matchedSize > 0 ? "partial" : "live",
                exitReason,
                errorContext,
                createdAt: new Date().toISOString(),
                lastCheckedAt: null,
                repriceAttempts,
                lastSkipTelemetryAt: null,
            });
            trade.positionState = matchedSize > 0 ? "EXIT_PARTIAL" : "EXIT_PENDING";

            await emitExitEvent("trade.exit_pending", trade, {
                orderId,
                side,
                tokenId,
                price,
                requestedSize,
                remainingSize: remainingSize > 0 ? remainingSize : requestedSize,
            });
        }
    };
    const cancelExistingExitOrder = async (
        trade: any,
        order: Record<string, any>,
    ): Promise<"cancelled" | "filled" | "still_live"> => {
        ensureLiveClient(trade);
        await trade.authorizedClob.cancelOrder({ orderID: order.orderId });

        for (let attempt = 0; attempt < 5; attempt++) {
            await sleepMs(250);
            const status = await trade.getExitOrderStatus(order.orderId);
            if (status.status === "matched") {
                removeExitOrder(trade, order);
                await trade.updateTokenBalances();
                syncPositionStateFromHoldings(trade);
                return "filled";
            }
            if (status.status === "canceled" || status.status === "expired" || status.status === "rejected" || status.status === "unknown") {
                removeExitOrder(trade, order);
                await trade.updateTokenBalances();
                syncPositionStateFromHoldings(trade);
                return "cancelled";
            }
        }

        return "still_live";
    };
    const maybeRepriceForcedExitOrder = async (
        trade: any,
        side: Market.Up | Market.Down,
        existingOrder: Record<string, any>,
    ): Promise<boolean | null> => {
        const trade4 = getTrade4LikeConfig(globalThis.__CONFIG__);
        if (!trade4?.exit_reprice_enabled || !isForcedExitWindow(trade)) {
            return null;
        }

        const existingAttempts = Number(existingOrder.repriceAttempts ?? 0);
        if (existingAttempts >= trade4.exit_reprice_max_attempts) {
            return null;
        }

        const createdAtMs = Date.parse(existingOrder.createdAt ?? "");
        if (Number.isFinite(createdAtMs) && Date.now() - createdAtMs < trade4.exit_reprice_after_ms) {
            return null;
        }

        const cancelResult = await cancelExistingExitOrder(trade, existingOrder);
        if (cancelResult === "filled") {
            return true;
        }
        if (cancelResult !== "cancelled") {
            return false;
        }

        await trade.updateTokenBalances();
        const tokenId = getExitTokenId(trade, side);
        if ((side === Market.Up && trade.holdingStatus !== Market.Up) || (side === Market.Down && trade.holdingStatus !== Market.Down) || trade.share <= 0) {
            syncPositionStateFromHoldings(trade);
            return true;
        }

        ensureLiveClient(trade);
        const tokenBalance = await trade.authorizedClob.getBalanceAllowance({
            asset_type: AssetType.CONDITIONAL,
            token_id: tokenId,
        });
        const actualBalance = parseFloat(tokenBalance.balance) / 1e6;
        const rawBalance = parseFloat(tokenBalance.balance);
        if (!Number.isFinite(actualBalance) || actualBalance <= 0 || !Number.isFinite(rawBalance) || rawBalance <= 0) {
            syncPositionStateFromHoldings(trade);
            return false;
        }

        const makerMode = Boolean(getTrade4LikeConfig(globalThis.__CONFIG__)?.use_passive_maker_orders);
        const currentBid = getExitPrice(trade, side);
        const reprice = makerMode
            ? clampPrice(Math.max(0.01, currentBid - MAKER_PRICE_STEP))
            : currentBid;

        await emitExitEvent("trade.exit_attempt", trade, {
            side,
            tokenId,
            price: reprice,
            size: actualBalance,
            availableBalance: actualBalance,
            rawBalance: tokenBalance.balance,
            repriceAttempt: existingAttempts + 1,
            repricedFromOrderId: existingOrder.orderId,
        });

        const order = await placeLiveExitOrder(trade, marketToExecutionSide(side), tokenId, makerMode, reprice, actualBalance, rawBalance);
        const orderStatus = String(order?.status ?? "").toLowerCase();
        const orderId = String(order?.orderID ?? order?.orderId ?? "");

        if (orderId && orderStatus === "live") {
            await registerAcceptedExitOrder(
                trade,
                side,
                tokenId,
                actualBalance,
                reprice,
                order,
                existingAttempts > 0 ? "exit_reprice" : existingOrder.exitReason,
                existingOrder.errorContext ?? null,
                existingAttempts + 1,
            );
            return false;
        }

        await sleepMs(500);
        await trade.updateTokenBalances();
        trade.positionState = "CLOSED";
        return true;
    };

    TradeClass.prototype.recordExecutedEntry = function (
        side: "UP" | "DOWN",
        entryPrice: number,
        executedAt: string = new Date().toISOString(),
        details: Record<string, unknown> = {},
    ): void {
        this.lastExecutedEntry = {
            side: sideToMarket(side),
            executedAt,
            marketSlug: this.marketSlug,
            entryPrice,
            shares: Number(details.shares ?? this.share ?? 0),
            costBasisUsd: Number(details.costBasisUsd ?? 0),
            feeUsd: Number(details.feeUsd ?? 0),
            rebateUsd: Number(details.rebateUsd ?? 0),
            makerMode: Boolean(details.makerMode),
        };
        this.pendingEntrySignal = null;
        this.positionState = "OPEN";
    };
    TradeClass.prototype.recordExternalPricePoint = function (priceUsd: number, fetchedAt: string): void {
        if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
            return;
        }

        const fetchedAtMs = Date.parse(fetchedAt);
        if (!Number.isFinite(fetchedAtMs)) {
            return;
        }

        if (!Array.isArray(this.externalPriceHistory)) {
            this.externalPriceHistory = [];
        }

        const lastPoint = this.externalPriceHistory[this.externalPriceHistory.length - 1];
        if (lastPoint?.fetchedAt === fetchedAt && lastPoint?.priceUsd === priceUsd) {
            return;
        }

        this.externalPriceHistory.push({ priceUsd, fetchedAt });
        const cutoffMs = fetchedAtMs - 60_000;
        this.externalPriceHistory = this.externalPriceHistory.filter((point: { fetchedAt: string }) => {
            const pointTimestampMs = Date.parse(point.fetchedAt);
            return Number.isFinite(pointTimestampMs) && pointTimestampMs >= cutoffMs;
        });
    };

    TradeClass.prototype.getExitOrderStatus = async function (orderId: string): Promise<{
        status: "live" | "matched" | "partial" | "canceled" | "expired" | "rejected" | "unknown";
        filledSize?: number;
        remainingSize?: number;
        avgPrice?: number;
    }> {
        ensureLiveClient(this);

        try {
            const order = await this.authorizedClob.getOrder(orderId);
            return deriveExitStatusFromOpenOrder(order);
        } catch (error) {
            try {
                const openOrders = await this.authorizedClob.getOpenOrders({ id: orderId }, true);
                if (Array.isArray(openOrders) && openOrders.length > 0) {
                    return deriveExitStatusFromOpenOrder(openOrders[0]);
                }
            } catch {
                // Fallback below.
            }

            return { status: "unknown" };
        }
    };

    TradeClass.prototype.reconcileOpenExitOrders = async function (): Promise<void> {
        if (PAPER_TRADING || !this.authorizedClob) {
            return;
        }

        const openOrders = Object.values(this.openExitOrders ?? {}) as Array<Record<string, any>>;
        if (!openOrders.length) {
            syncPositionStateFromHoldings(this);
            return;
        }

        for (const openOrder of openOrders) {
            const status = await this.getExitOrderStatus(openOrder.orderId);
            openOrder.lastCheckedAt = new Date().toISOString();

            if (status.status === "live") {
                openOrder.status = "live";
                openOrder.filledSize = toRoundedSize(status.filledSize);
                openOrder.remainingSize = toRoundedSize(status.remainingSize ?? openOrder.requestedSize);
                upsertExitOrder(this, openOrder);
                this.positionState = "EXIT_PENDING";
                continue;
            }

            if (status.status === "partial") {
                const previousFilled = toRoundedSize(openOrder.filledSize);
                openOrder.status = "partial";
                openOrder.filledSize = toRoundedSize(status.filledSize);
                openOrder.remainingSize = toRoundedSize(status.remainingSize ?? Math.max(0, openOrder.requestedSize - openOrder.filledSize));
                openOrder.price = Number.isFinite(status.avgPrice) ? Number(status.avgPrice) : openOrder.price;
                upsertExitOrder(this, openOrder);
                this.positionState = "EXIT_PARTIAL";

                if (openOrder.filledSize !== previousFilled) {
                    await emitExitEvent("trade.exit_partial", this, {
                        orderId: openOrder.orderId,
                        side: openOrder.side,
                        tokenId: openOrder.tokenId,
                        filledSize: openOrder.filledSize,
                        remainingSize: openOrder.remainingSize,
                        avgPrice: openOrder.price,
                    });
                }
                continue;
            }

            await this.updateTokenBalances();
            clearPositionIfDust(this);

            if (status.status === "matched") {
                const exitPrice = Number.isFinite(status.avgPrice) ? Number(status.avgPrice) : Number(openOrder.price ?? 0);
                if (this.holdingStatus !== Market.Up && this.holdingStatus !== Market.Down) {
                    this.positionState = "CLOSED";
                }
                await writeTelemetryEventSafe("live_trade.sell", buildSellTelemetryPayload(this, {
                    side: openOrder.side === Market.Up ? "UP" : "DOWN",
                    tokenId: openOrder.tokenId,
                    reason: openOrder.repriceAttempts > 0 ? "exit_reprice" : openOrder.exitReason,
                    errorContext: openOrder.errorContext ?? null,
                    exitPrice,
                    shares: toRoundedSize(status.filledSize ?? openOrder.requestedSize),
                    cashBefore: null,
                    cashAfter: null,
                    feeUsd: 0,
                    rebateUsd: 0,
                    orderId: openOrder.orderId,
                }));
                removeExitOrder(this, openOrder);
                syncPositionStateFromHoldings(this);
                await emitExitEvent("trade.exit_filled", this, {
                    orderId: openOrder.orderId,
                    side: openOrder.side,
                    tokenId: openOrder.tokenId,
                    filledSize: toRoundedSize(status.filledSize ?? openOrder.requestedSize),
                    avgPrice: Number.isFinite(status.avgPrice) ? status.avgPrice : openOrder.price,
                    pnlEstimate: null,
                });
                clearPendingExitIntent(this);
                continue;
            }

            if (status.status === "canceled" || status.status === "expired" || status.status === "rejected" || status.status === "unknown") {
                removeExitOrder(this, openOrder);
                syncPositionStateFromHoldings(this);
                continue;
            }
        }

        syncPositionStateFromHoldings(this);
    };

    TradeClass.prototype.hydrateOpenExitOrders = async function (): Promise<void> {
        if (PAPER_TRADING || !this.authorizedClob) {
            return;
        }

        ensureLiveClient(this);
        let openOrders: any[] = [];
        try {
            const response = await this.authorizedClob.getOpenOrders({}, true);
            openOrders = Array.isArray(response) ? response : [];
        } catch (error) {
            await writeTelemetryEventSafe("trade.exit_failed", {
                strategy: globalThis.__CONFIG__.strategy,
                reason: "hydrate_open_exit_orders_failed",
                marketSlug: this.marketSlug,
                errorMessage: error instanceof Error ? error.message : String(error),
            });
            return;
        }

        let hydratedCount = 0;
        for (const order of openOrders) {
            const status = String(order?.status ?? "").toLowerCase();
            const orderSide = String(order?.side ?? "").toUpperCase();
            const tokenId = String(order?.asset_id ?? order?.token_id ?? order?.tokenID ?? "");
            const orderId = String(order?.id ?? order?.orderID ?? order?.orderId ?? "");
            const side =
                tokenId === this.upTokenId ? Market.Up :
                tokenId === this.downTokenId ? Market.Down :
                null;

            if (status !== "live" || orderSide !== "SELL" || !side || !orderId) {
                continue;
            }

            const requestedSize = toRoundedSize(order?.original_size ?? order?.size ?? 0);
            const filledSize = toRoundedSize(order?.size_matched ?? 0);
            const remainingSize = requestedSize > 0 ? Math.max(0, toRoundedSize(requestedSize - filledSize)) : requestedSize;
            upsertExitOrder(this, {
                orderId,
                tokenId,
                marketSlug: this.marketSlug,
                side,
                price: Number(order?.price ?? 0),
                requestedSize,
                filledSize,
                remainingSize,
                status: filledSize > 0 ? "partial" : "live",
                createdAt: order?.created_at ? new Date(Number(order.created_at) * 1000).toISOString() : new Date().toISOString(),
                lastCheckedAt: new Date().toISOString(),
                repriceAttempts: 0,
                lastSkipTelemetryAt: null,
            });
            hydratedCount += 1;
        }

        if (hydratedCount > 0) {
            await this.updateTokenBalances();
            syncPositionStateFromHoldings(this);
            console.log(`↩️  Hydrated ${hydratedCount} open exit order(s) from CLOB`);
        }
    };

    TradeClass.prototype.hydrateOpenEntryOrders = async function (): Promise<void> {
        if (PAPER_TRADING || !this.authorizedClob) {
            return;
        }

        ensureLiveClient(this);
        let openOrders: any[] = [];
        try {
            const response = await this.authorizedClob.getOpenOrders({}, true);
            openOrders = Array.isArray(response) ? response : [];
        } catch (error) {
            await writeTelemetryEventSafe("trade.entry_order_status_after_timeout", {
                strategy: globalThis.__CONFIG__.strategy,
                reason: "hydrate_open_entry_orders_failed",
                marketSlug: this.marketSlug,
                errorMessage: error instanceof Error ? error.message : String(error),
            });
            return;
        }

        let hydratedCount = 0;
        for (const order of openOrders) {
            const status = String(order?.status ?? "").toLowerCase();
            const orderSide = String(order?.side ?? "").toUpperCase();
            const tokenId = String(order?.asset_id ?? order?.token_id ?? order?.tokenID ?? "");
            const orderId = String(order?.id ?? order?.orderID ?? order?.orderId ?? "");
            const side =
                tokenId === this.upTokenId ? "UP" :
                tokenId === this.downTokenId ? "DOWN" :
                null;

            if (status !== "live" || orderSide !== "BUY" || !side || !orderId) {
                continue;
            }

            const requestedSize = toRoundedSize(order?.original_size ?? order?.size ?? 0);
            const price = Number(order?.price ?? 0);
            const nowIso = new Date().toISOString();
            this.pendingEntryReconciliation = {
                blockedAt: nowIso,
                side,
                marketSlug: this.marketSlug,
                tokenId,
                orderId,
                requestedUsd: Number.isFinite(price) && requestedSize > 0 ? roundCurrency(price * requestedSize) : null,
                entryPrice: Number.isFinite(price) ? price : null,
                decisionTimestamp: null,
                providerOrderStatus: "live",
                providerFilledSize: toRoundedSize(order?.size_matched ?? 0),
                providerRemainingSize: requestedSize,
                providerAvgPrice: Number.isFinite(price) ? price : null,
                lastCheckedAt: nowIso,
                source: "startup_open_entry_order_hydration",
            };
            this.positionState = "ERROR";
            hydratedCount += 1;

            const finalStatus = await cancelLiveEntryOrderIfOpen(this, orderId, {
                side,
                tokenId,
                source: "startup_open_entry_order_hydration",
            });
            this.pendingEntryReconciliation = {
                ...this.pendingEntryReconciliation,
                providerOrderStatus: finalStatus.status,
                providerFilledSize: finalStatus.filledSize ?? this.pendingEntryReconciliation.providerFilledSize ?? null,
                providerRemainingSize: finalStatus.remainingSize ?? this.pendingEntryReconciliation.providerRemainingSize ?? null,
                providerAvgPrice: finalStatus.avgPrice ?? this.pendingEntryReconciliation.providerAvgPrice ?? null,
                lastCheckedAt: new Date().toISOString(),
            };
            await reconcilePendingEntryState(this);
            if (isPendingEntryReconciliationActive(this)) {
                break;
            }
        }

        if (hydratedCount > 0) {
            console.log(`↩️  Hydrated ${hydratedCount} open entry order(s) from CLOB`);
        }
    };

    TradeClass.prototype.validateExecutionSafety = async function (side: "UP" | "DOWN", executionPrice: number): Promise<boolean> {
        const trade4 = getTrade4LikeConfig(globalThis.__CONFIG__);
        if (!trade4) {
            return true;
        }

        await this.reconcileOpenExitOrders();
        if (isPendingEntryReconciliationActive(this)) {
            const reconciled = await reconcilePendingEntryState(this);
            if (!reconciled && isPendingEntryReconciliationActive(this)) {
                await writeTelemetryEventSafe("trade.signal_rejected", buildSignalRejectedPayload(this, "entry_reconciliation_pending", {
                    requestedSide: sideToMarket(side),
                    orderId: this.pendingEntryReconciliation?.orderId ?? null,
                    providerOrderStatus: this.pendingEntryReconciliation?.providerOrderStatus ?? null,
                    blockedAt: this.pendingEntryReconciliation?.blockedAt ?? null,
                    tokenId: this.pendingEntryReconciliation?.tokenId ?? null,
                    marketSlug: this.marketSlug,
                    positionState: this.positionState,
                }));
                return false;
            }
        }

        const blockingExitOrder = getBlockingExitOrder(this);
        if (blockingExitOrder) {
            await writeTelemetryEventSafe("trade.signal_rejected", buildSignalRejectedPayload(this, "exit_pending", {
                requestedSide: sideToMarket(side),
                exitOrderId: blockingExitOrder.orderId,
                exitOrderStatus: blockingExitOrder.status,
                positionState: this.positionState,
                exitOrderSide: blockingExitOrder.side,
                marketSlug: this.marketSlug,
            }));
            return false;
        }

        const requestedSide = sideToMarket(side);
        const nowMs = Date.now();
        const executionTimestamp = new Date(nowMs).toISOString();

        if (
            trade4.prevent_opposite_side_reentry &&
            this.lastExecutedEntry &&
            this.lastExecutedEntry.marketSlug === this.marketSlug &&
            this.lastExecutedEntry.side !== requestedSide
        ) {
            const lastExecutedAtMs = Date.parse(this.lastExecutedEntry.executedAt);
            const elapsedSeconds = Number.isFinite(lastExecutedAtMs)
                ? Math.max(0, (nowMs - lastExecutedAtMs) / 1000)
                : Number.POSITIVE_INFINITY;

            if (elapsedSeconds < trade4.opposite_side_cooldown_seconds) {
                await writeTelemetryEventSafe("trade.signal_rejected", buildSignalRejectedPayload(this, "opposite_side_cooldown", {
                    lastSide: this.lastExecutedEntry.side,
                    requestedSide,
                    cooldownSeconds: trade4.opposite_side_cooldown_seconds,
                    elapsedSeconds: Math.round(elapsedSeconds * 1000) / 1000,
                    marketSlug: this.marketSlug,
                }));
                return false;
            }
        }

        if (!trade4.reject_if_price_moves_against_us_fast) {
            return true;
        }

        const signal = this.pendingEntrySignal;
        if (!signal || signal.marketSlug !== this.marketSlug || signal.side !== requestedSide) {
            this.pendingEntrySignal = {
                side: requestedSide,
                signalPrice: getCurrentEntryPrice(this, side),
                signalTimestamp: executionTimestamp,
                marketSlug: this.marketSlug,
            };
            return true;
        }

        const delta = requestedSide === Market.Up
            ? executionPrice - signal.signalPrice
            : signal.signalPrice - executionPrice;

        if (delta > trade4.max_price_change_after_signal) {
            await writeTelemetryEventSafe("trade.signal_rejected", buildSignalRejectedPayload(this, "price_moved_against_signal", {
                signalPrice: signal.signalPrice,
                executionPrice,
                delta: roundFeeUsd(delta),
                maxAllowedDelta: trade4.max_price_change_after_signal,
                side: requestedSide,
                marketSlug: this.marketSlug,
                signalTimestamp: signal.signalTimestamp,
                executionTimestamp,
                entryPriceChecked: executionPrice,
            }));
            return false;
        }

        return true;
    };
    TradeClass.prototype.reconcilePendingEntryState = async function (): Promise<boolean> {
        return reconcilePendingEntryState(this);
    };
    const maybeProtectLateFilledEntry = async (
        trade: any,
        payload: {
            side: "UP" | "DOWN";
            decisionTimestamp: string;
            executionTimestamp: string;
        },
    ): Promise<boolean> => {
        if (PAPER_TRADING) {
            return false;
        }

        const trade4 = getTrade4LikeConfig(globalThis.__CONFIG__);
        if (!trade4) {
            return false;
        }

        const elapsedMs = decisionToExecutionMs(payload.decisionTimestamp, payload.executionTimestamp);
        const maxEntryFillDelayMs = Number(trade4.max_entry_fill_delay_ms ?? 12000);
        if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs <= maxEntryFillDelayMs) {
            return false;
        }

        const remainingSeconds = Math.max(0, Number(trade.remainingTime) || 0);
        const detail = `decisionToExecutionMs=${elapsedMs} > maxEntryFillDelayMs=${maxEntryFillDelayMs} | remainingSeconds=${remainingSeconds}`;
        console.warn(`⚠️  Late fill guard triggered | side=${payload.side} | ${detail}`);
        await writeTelemetryEventSafe("feed.error", {
            slug: trade.marketSlug,
            source: "late_fill_guard",
            side: payload.side,
            decisionTimestamp: payload.decisionTimestamp,
            executionTimestamp: payload.executionTimestamp,
            decisionToExecutionMs: elapsedMs,
            maxEntryFillDelayMs,
            remainingSeconds,
        });

        trade.pendingExitReason = "late_fill_guard";
        trade.pendingExitErrorContext = detail;
        GLOBAL_TX_PROCESS.current = TxProcess.Idle;
        if (payload.side === "UP") {
            await trade.sellUpToken();
        } else {
            await trade.sellDownToken();
        }
        return true;
    };
    const simulatePaperMakerLifecycle = async (
        trade: any,
        payload: {
            side: "UP" | "DOWN";
            action: "buy" | "sell";
            askPrice: number;
            bidPrice: number;
            executionPrice: number;
            midPrice: number | null;
            feeUsd: number;
            rebateUsd: number;
            slippageVsMid: number | null;
        },
    ): Promise<{
        filled: boolean;
        orderPlacedAt: string;
        orderFilledAt: string | null;
        orderCancelledAt: string | null;
        simulatedFillDelayMs: number;
        estimatedQueuePosition: number;
        cancelReason: string | null;
    }> => {
        const spread = Math.max(0, roundFeeUsd(payload.askPrice - payload.bidPrice));
        const estimatedQueuePosition = spread >= 0.02 ? 1 : spread >= 0.01 ? 2 : 3;
        const simulatedFillDelayMs = Math.max(
            60,
            Math.min(250, Math.round(70 + (estimatedQueuePosition * 45) + ((trade.latestFeedRttMs ?? 0) * 0.15))),
        );
        const orderPlacedAt = new Date().toISOString();

        await emitSimulatedOrderFlow(trade, {
            side: payload.side,
            action: payload.action,
            makerMode: true,
            orderStatus: "placed",
            orderPlacedAt,
            orderFilledAt: null,
            orderCancelledAt: null,
            simulatedFillDelayMs,
            estimatedQueuePosition,
            price: payload.executionPrice,
            feeUsd: payload.feeUsd,
            rebateUsd: payload.rebateUsd,
            midPriceAtDecision: payload.midPrice,
            slippageVsMid: payload.slippageVsMid,
        });

        await sleepMs(simulatedFillDelayMs);

        let cancelReason: string | null = null;
        if (trade.latestFeedAgeMs !== null && trade.latestFeedAgeMs > 1500) {
            cancelReason = "stale_feed_before_fill";
        } else if (trade.latestFeedRttMs !== null && trade.latestFeedRttMs > 600) {
            cancelReason = "rtt_too_high_for_fill";
        } else if (spread < 0.01) {
            cancelReason = "spread_too_tight_no_fill";
        }

        if (cancelReason) {
            const orderCancelledAt = new Date().toISOString();
            await emitSimulatedOrderFlow(trade, {
                side: payload.side,
                action: payload.action,
                makerMode: true,
                orderStatus: "cancelled",
                orderPlacedAt,
                orderFilledAt: null,
                orderCancelledAt,
                simulatedFillDelayMs,
                estimatedQueuePosition,
                cancelReason,
                price: payload.executionPrice,
                feeUsd: payload.feeUsd,
                rebateUsd: payload.rebateUsd,
                midPriceAtDecision: payload.midPrice,
                slippageVsMid: payload.slippageVsMid,
            });
            return {
                filled: false,
                orderPlacedAt,
                orderFilledAt: null,
                orderCancelledAt,
                simulatedFillDelayMs,
                estimatedQueuePosition,
                cancelReason,
            };
        }

        const orderFilledAt = new Date().toISOString();
        await emitSimulatedOrderFlow(trade, {
            side: payload.side,
            action: payload.action,
            makerMode: true,
            orderStatus: "filled",
            orderPlacedAt,
            orderFilledAt,
            orderCancelledAt: null,
            simulatedFillDelayMs,
            estimatedQueuePosition,
            price: payload.executionPrice,
            feeUsd: payload.feeUsd,
            rebateUsd: payload.rebateUsd,
            midPriceAtDecision: payload.midPrice,
            slippageVsMid: payload.slippageVsMid,
        });

        return {
            filled: true,
            orderPlacedAt,
            orderFilledAt,
            orderCancelledAt: null,
            simulatedFillDelayMs,
            estimatedQueuePosition,
            cancelReason: null,
        };
    };

    // Method to check token balances and update state
    TradeClass.prototype.updateTokenBalances = async function (): Promise<void> {
        if (PAPER_TRADING) {
            return;
        }

        try {
            ensureLiveClient(this);

            // Check up token balance
            const upBalance = await this.authorizedClob.getBalanceAllowance({
                asset_type: AssetType.CONDITIONAL,
                token_id: this.upTokenId,
            });

            // Check down token balance
            const downBalance = await this.authorizedClob.getBalanceAllowance({
                asset_type: AssetType.CONDITIONAL,
                token_id: this.downTokenId,
            });

            // Check USD (COLLATERAL) balance
            const usdBalance = await this.authorizedClob.getBalanceAllowance({
                asset_type: AssetType.COLLATERAL,
            });

            // Update balances (convert from string to number, balance is in wei, divide by 1e6 for USD)
            const upBalanceNum = parseFloat(upBalance.balance) / 1e6;
            const downBalanceNum = parseFloat(downBalance.balance) / 1e6;
            const usdBalanceNum = parseFloat(usdBalance.balance) / 1e6;

            // Update state based on balances
            if (upBalanceNum > 0) {
                this.share = upBalanceNum;
                this.holdingStatus = Market.Up;
                this.usd = usdBalanceNum;
            } else if (downBalanceNum > 0) {
                this.share = downBalanceNum;
                this.holdingStatus = Market.Down;
                this.usd = usdBalanceNum;
            } else {
                this.share = 0;
                this.holdingStatus = Market.None;
                this.usd = usdBalanceNum;
            }

            clearPositionIfDust(this);
            syncPositionStateFromHoldings(this);

            console.log(`📊 Balance updated | Up: ${upBalanceNum.toFixed(4)} | Down: ${downBalanceNum.toFixed(4)} | USD: $${usdBalanceNum.toFixed(2)}`);
        } catch (error: any) {
            console.error("❌ Error updating token balances:", error);
            this.positionState = "ERROR";
        }
    };

    // Method to poll balance every 1 second until balance is received
    TradeClass.prototype.waitForBalance = async function (tokenType: "up" | "down", timeoutMs: number = 60000): Promise<void> {
        if (PAPER_TRADING) {
            return;
        }

        const startTime = Date.now();
        const pollInterval = 1000; // 1 second
        
        console.log(`⏳ Waiting for ${tokenType} token balance...`);
        
        while (Date.now() - startTime < timeoutMs) {
            try {
                await this.updateTokenBalances();
                
                const hasBalance = tokenType === "up" 
                    ? (this.holdingStatus === Market.Up && this.share > 0)
                    : (this.holdingStatus === Market.Down && this.share > 0);
                
                if (hasBalance) {
                    console.log(`✅ ${tokenType.toUpperCase()} token balance received!`);
                    return;
                }
                
                // Wait 1 second before next check
                await new Promise(resolve => setTimeout(resolve, pollInterval));
            } catch (error: any) {
                console.error(`❌ Error while waiting for balance:`, error);
                // Continue polling even if one check fails
                await new Promise(resolve => setTimeout(resolve, pollInterval));
            }
        }
        
        throw new Error(`⏱️  Timeout: ${tokenType} token balance not received within ${timeoutMs / 1000} seconds`);
    };

    TradeClass.prototype.buyUpToken = async function (): Promise<void> {
        // Only allow one buy per market
        if (this.hasBought) {
            console.log("⏭️  Already bought in this market, skipping");
            return;
        }

        if (!this.upTokenId || !this.upBuyPrice || this.upBuyPrice <= 0 || isNaN(this.upBuyPrice)) {
            console.error("Cannot buy up token: missing tokenId or invalid price");
            return;
        }

        // Ensure price is a valid number
        const price = Number(this.upBuyPrice);
        if (isNaN(price) || !isFinite(price) || price <= 0) {
            console.error("Cannot buy up token: invalid price value");
            return;
        }

        // Calculate size based on available USD and trade_usd config
        const tradeAmount = getTradeAmount(this);

        if (!tradeAmount || isNaN(tradeAmount) || tradeAmount <= 0) {
            console.error("Cannot buy up token: invalid trade amount or insufficient USD");
            return;
        }

        const roundedTradeAmount = PAPER_TRADING
            ? affordablePaperTradeAmount(this.usd, tradeAmount, price)
            : roundCurrency(tradeAmount);

        const size = Math.floor(roundedTradeAmount / price);

        if (size <= 0 || isNaN(size) || !isFinite(size) || roundedTradeAmount <= 0) {
            console.error("Cannot buy up token: insufficient funds or invalid size");
            return;
        }

        try {
            GLOBAL_TX_PROCESS.current = TxProcess.Working;

            if (PAPER_TRADING) {
                const makerMode = Boolean(getTrade4LikeConfig(globalThis.__CONFIG__)?.use_passive_maker_orders);
                const entrySignal = this.pendingEntrySignal ? { ...this.pendingEntrySignal } : null;
                const executionPrice = makerMode
                    ? passiveMakerBuyPrice(this.upBuyPrice, this.upSellPrice)
                    : price;
                const momentumDirection = entrySignal?.momentumDirection ?? null;
                const momentumScore = entrySignal?.momentumScore ?? null;
                const momentumConfidence = entrySignal?.momentumConfidence ?? null;
                const mcConvergence = entrySignal?.mcConvergence ?? null;
                const mcSimulatedDirection = entrySignal?.mcSimulatedDirection ?? null;
                const mcBullPaths = entrySignal?.mcBullPaths ?? null;
                const mcBearPaths = entrySignal?.mcBearPaths ?? null;
                const decisionTimestamp = entrySignal?.signalTimestamp ?? new Date().toISOString();
                const midPrice = midMarketPrice(this.upBuyPrice, this.upSellPrice);
                const sharesBought = roundedTradeAmount / executionPrice;
                const feeUsd = makerMode ? 0 : takerFeeUsd(executionPrice, roundedTradeAmount);
                const rebateUsd = makerMode ? makerRebateUsd(executionPrice, roundedTradeAmount) : 0;
                const totalCostUsd = roundCurrency(roundedTradeAmount + feeUsd - rebateUsd);
                const slippageVsMid = midPrice === null ? null : roundFeeUsd(executionPrice - midPrice);

                if (!Number.isFinite(sharesBought) || sharesBought <= 0) {
                    console.error("Cannot buy up token: invalid simulated share size");
                    return;
                }

                if (totalCostUsd > this.usd) {
                    console.error("Cannot buy up token: insufficient simulated cash after fee");
                    return;
                }

                if (!(await this.validateExecutionSafety("UP", executionPrice))) {
                    console.log("⏭️  Skipping UP buy: execution safety validation failed");
                    return;
                }

                const cashBefore = this.usd;
                let orderPlacedAt: string | null = null;
                let orderFilledAt: string | null = null;
                let simulatedFillDelayMs = 0;
                let estimatedQueuePosition: number | null = null;
                if (makerMode) {
                    const lifecycle = await simulatePaperMakerLifecycle(this, {
                        side: "UP",
                        action: "buy",
                        askPrice: this.upBuyPrice,
                        bidPrice: this.upSellPrice,
                        executionPrice,
                        midPrice,
                        feeUsd,
                        rebateUsd,
                        slippageVsMid,
                    });
                    if (!lifecycle.filled) {
                        console.log(`⏭️  Paper maker UP buy canceled | reason=${lifecycle.cancelReason}`);
                        return;
                    }
                    orderPlacedAt = lifecycle.orderPlacedAt;
                    orderFilledAt = lifecycle.orderFilledAt;
                    simulatedFillDelayMs = lifecycle.simulatedFillDelayMs;
                    estimatedQueuePosition = lifecycle.estimatedQueuePosition;
                } else {
                    orderPlacedAt = new Date().toISOString();
                    orderFilledAt = orderPlacedAt;
                }
                this.usd = roundCurrency(this.usd - totalCostUsd);
                this.share = sharesBought;
                this.holdingStatus = Market.Up;
                this.hasBought = true;
                const executionTimestamp = orderFilledAt ?? new Date().toISOString();
                this.recordExecutedEntry("UP", executionPrice, executionTimestamp, {
                    shares: sharesBought,
                    costBasisUsd: totalCostUsd,
                    feeUsd,
                    rebateUsd,
                    makerMode,
                });

                console.log(`📝 Paper buy filled | side=UP | mode=${makerMode ? "MAKER" : "TAKER"} | usd=$${roundedTradeAmount.toFixed(2)} | fee=$${feeUsd.toFixed(2)} | rebate=$${rebateUsd.toFixed(2)} | price=${executionPrice.toFixed(2)} | shares=${sharesBought.toFixed(4)} | cashLeft=$${this.usd.toFixed(2)}`);
                if (!makerMode) {
                    await emitSimulatedOrderFlow(this, {
                        side: "UP",
                        action: "buy",
                        makerMode,
                        orderStatus: "filled",
                        orderPlacedAt,
                        orderFilledAt,
                        orderCancelledAt: null,
                        simulatedFillDelayMs,
                        estimatedQueuePosition,
                        price: executionPrice,
                        feeUsd,
                        rebateUsd,
                        midPriceAtDecision: midPrice,
                        slippageVsMid,
                    });
                }
                await writeTelemetryEventSafe("paper_trade.buy", {
                    ...buildBuyTelemetryPayload(this, {
                    entrySignal,
                    side: "UP",
                    entryPrice: executionPrice,
                    decisionTimestamp,
                    executionTimestamp,
                    tokenId: this.upTokenId,
                    usd: roundedTradeAmount,
                    feeUsd,
                    rebateUsd,
                    feeRate: takerFeeRate(executionPrice),
                    platformFeeRate: CRYPTO_TAKER_FEE_RATE,
                    feeFactor: protocolFeeFactor(executionPrice),
                    totalCostUsd,
                    makerMode,
                    decisionSource: this.lastDecisionSnapshotSource,
                    momentumDirection,
                    momentumScore,
                    momentumConfidence,
                    mcConvergence,
                    mcSimulatedDirection,
                    mcBullPaths,
                    mcBearPaths,
                    price: executionPrice,
                    askPriceAtDecision: this.upBuyPrice,
                    bidPriceAtDecision: this.upSellPrice,
                    midPriceAtDecision: midPrice,
                    slippageVsMid,
                    shares: sharesBought,
                    cashBefore,
                    cashAfter: this.usd,
                    orderPlacedAt,
                    orderFilledAt: executionTimestamp,
                    simulatedFillDelayMs,
                    estimatedQueuePosition,
                    }),
                });
                playCliTradeSound("buy");
                return;
            }
            
            const maxRetries = globalThis.__CONFIG__?.max_retries || 3;
            ensureLiveClient(this);
            const makerMode = Boolean(getTrade4LikeConfig(globalThis.__CONFIG__)?.use_passive_maker_orders);
            const entrySignal = this.pendingEntrySignal ? { ...this.pendingEntrySignal } : null;
            const momentumDirection = entrySignal?.momentumDirection ?? null;
            const momentumScore = entrySignal?.momentumScore ?? null;
            const momentumConfidence = entrySignal?.momentumConfidence ?? null;
            const mcConvergence = entrySignal?.mcConvergence ?? null;
            const mcSimulatedDirection = entrySignal?.mcSimulatedDirection ?? null;
            const mcBullPaths = entrySignal?.mcBullPaths ?? null;
            const mcBearPaths = entrySignal?.mcBearPaths ?? null;
            const initialPassivePrice = passiveMakerBuyPrice(this.upBuyPrice, this.upSellPrice);
            const initialExecutionPrice = makerMode ? initialPassivePrice : Number(this.upBuyPrice);
            const initialSize = Math.max(1, Math.floor(roundedTradeAmount / Math.max(initialPassivePrice, 0.01)));
            if (!canPlaceLiveOrder(this, initialSize, "UP", "buy", initialExecutionPrice, roundedTradeAmount)) {
                return;
            }
            const order = await retryWithInstantRetry(
                async () => {
                    const currentPrice = Number(this.upBuyPrice);
                    const currentPassivePrice = passiveMakerBuyPrice(this.upBuyPrice, this.upSellPrice);
                    const currentExecutionPrice = makerMode ? currentPassivePrice : currentPrice;
                    const currentSize = Math.max(1, Math.floor(roundedTradeAmount / Math.max(currentPassivePrice, 0.01)));

                    if (!(await this.validateExecutionSafety("UP", currentExecutionPrice))) {
                        throw new Error("Cannot buy up token: execution safety validation failed");
                    }

                    if (!canPlaceLiveOrder(this, currentSize, "UP", "buy", currentExecutionPrice, roundedTradeAmount)) {
                        throw new Error("Cannot buy up token: size fell below market minimum");
                    }

                    const result = makerMode
                        ? await this.authorizedClob.createAndPostOrder({
                            tokenID: this.upTokenId,
                            price: currentPassivePrice,
                            side: Side.BUY,
                            size: currentSize,
                        }, getLiveOrderOptions(this), OrderType.GTC)
                        : await this.authorizedClob.createAndPostMarketOrder({
                            tokenID: this.upTokenId,
                            amount: roundedTradeAmount,
                            price: currentPrice,
                            side: Side.BUY,
                        }, getLiveOrderOptions(this), OrderType.FAK);

                    if (!result.success) {
                        throw new Error("❌ Error buying up token: " + result.error);
                    }

                    return result;
                },
                maxRetries,
                "Buy Up Token"
            );

            console.log("✅ Order posted successfully:", order);

            // Mark as bought
            this.hasBought = true;
            const decisionTimestamp = this.pendingEntrySignal?.signalTimestamp ?? new Date().toISOString();
            const orderId = String(order?.orderID ?? order?.orderId ?? "");
            const postedAt = new Date().toISOString();
            await emitEntryPostedEvent(this, {
                entrySignal,
                side: "UP",
                tokenId: this.upTokenId,
                entryPrice: initialExecutionPrice,
                decisionTimestamp,
                executionTimestamp: postedAt,
                shares: 0,
                orderId,
                orderStatus: String(order?.status ?? ""),
                requestedUsd: roundedTradeAmount,
                availableUsdAfterFill: this.usd,
                makerMode,
                momentumDirection,
                momentumScore,
                momentumConfidence,
                mcConvergence,
                mcSimulatedDirection,
                mcBullPaths,
                mcBearPaths,
            });

            // Poll balance every 1 second until up token balance is received
            try {
                await this.waitForBalance("up");
            } catch (error: any) {
                const timeoutAt = new Date().toISOString();
                let providerOrderStatus = await getLiveEntryOrderStatus(this, orderId);
                providerOrderStatus = await cancelLiveEntryOrderIfOpen(this, orderId, {
                    side: "UP",
                    tokenId: this.upTokenId,
                    tokenType: "up",
                    source: "entry_balance_timeout",
                });
                await emitEntryTimeoutEvent(this, {
                    entrySignal,
                    side: "UP",
                    tokenId: this.upTokenId,
                    entryPrice: initialExecutionPrice,
                    decisionTimestamp,
                    executionTimestamp: timeoutAt,
                    shares: this.share,
                    orderId,
                    orderStatus: String(order?.status ?? ""),
                    requestedUsd: roundedTradeAmount,
                    availableUsdAfterFill: this.usd,
                    makerMode,
                    momentumDirection,
                    momentumScore,
                    momentumConfidence,
                    mcConvergence,
                    mcSimulatedDirection,
                    mcBullPaths,
                    mcBearPaths,
                    timeoutMs: 60000,
                    tokenType: "up",
                    errorMessage: error?.message ?? String(error),
                    providerOrderStatus: providerOrderStatus.status,
                    providerFilledSize: providerOrderStatus.filledSize ?? null,
                    providerRemainingSize: providerOrderStatus.remainingSize ?? null,
                    providerAvgPrice: providerOrderStatus.avgPrice ?? null,
                });
                this.pendingEntryReconciliation = {
                    blockedAt: timeoutAt,
                    side: "UP",
                    marketSlug: this.marketSlug,
                    tokenId: this.upTokenId,
                    orderId,
                    requestedUsd: roundedTradeAmount,
                    entryPrice: initialExecutionPrice,
                    decisionTimestamp,
                    providerOrderStatus: providerOrderStatus.status,
                    providerFilledSize: providerOrderStatus.filledSize ?? null,
                    providerRemainingSize: providerOrderStatus.remainingSize ?? null,
                    providerAvgPrice: providerOrderStatus.avgPrice ?? null,
                    lastCheckedAt: timeoutAt,
                };
                this.positionState = "ERROR";
                playCliAlertSound("critical");
                await writeTelemetryEventSafe("trade.entry_order_status_after_timeout", {
                    ...buildBuyTelemetryPayload(this, {
                        entrySignal,
                        side: "UP",
                        tokenId: this.upTokenId,
                        entryPrice: initialExecutionPrice,
                        decisionTimestamp,
                        executionTimestamp: timeoutAt,
                        shares: this.share,
                        orderId,
                        orderStatus: String(order?.status ?? ""),
                        requestedUsd: roundedTradeAmount,
                        availableUsdAfterFill: this.usd,
                        makerMode,
                        momentumDirection,
                        momentumScore,
                        momentumConfidence,
                        mcConvergence,
                        mcSimulatedDirection,
                        mcBullPaths,
                        mcBearPaths,
                        timeoutMs: 60000,
                        tokenType: "up",
                        providerOrderStatus: providerOrderStatus.status,
                        providerFilledSize: providerOrderStatus.filledSize ?? null,
                        providerRemainingSize: providerOrderStatus.remainingSize ?? null,
                        providerAvgPrice: providerOrderStatus.avgPrice ?? null,
                    }),
                });
                const reconciled = await reconcilePendingEntryState(this);
                if (reconciled && !isPendingEntryReconciliationActive(this)) {
                    return;
                }
                throw error;
            }
            const executionTimestamp = new Date().toISOString();
            const entryPrice = makerMode ? initialPassivePrice : Number(this.upBuyPrice);
            this.recordExecutedEntry("UP", entryPrice, executionTimestamp, {
                shares: this.share,
                costBasisUsd: roundedTradeAmount,
                feeUsd: 0,
                rebateUsd: 0,
                makerMode,
            });
            await emitEntryFilledEvent(this, {
                side: Market.Up,
                tokenId: this.upTokenId,
                entryPrice,
                decisionTimestamp,
                executionTimestamp,
                shares: this.share,
                orderId,
                orderStatus: String(order?.status ?? ""),
                requestedUsd: roundedTradeAmount,
                availableUsdAfterFill: this.usd,
                makerMode,
                momentumDirection,
                momentumScore,
                momentumConfidence,
            });
            await writeTelemetryEventSafe("live_trade.buy", buildBuyTelemetryPayload(this, {
                entrySignal,
                side: "UP",
                tokenId: this.upTokenId,
                entryPrice,
                decisionTimestamp,
                executionTimestamp,
                shares: this.share,
                orderId,
                orderStatus: String(order?.status ?? ""),
                requestedUsd: roundedTradeAmount,
                availableUsdAfterFill: this.usd,
                makerMode,
                momentumDirection,
                momentumScore,
                momentumConfidence,
                mcConvergence,
                mcSimulatedDirection,
                mcBullPaths,
                mcBearPaths,
            }));
            if (await maybeProtectLateFilledEntry(this, {
                side: "UP",
                decisionTimestamp,
                executionTimestamp,
            })) {
                return;
            }
            playCliTradeSound("buy");
        } catch (error: any) {
            console.error("❌ Error buying up token:", error);
            if (error?.status === 401 || error?.data?.error?.includes("Unauthorized")) {
                console.error("⚠️  API authentication failed. Please check your API credentials in your secret provider or process environment.");
            }
        } finally {
            GLOBAL_TX_PROCESS.current = TxProcess.Idle;
        }
    };

    TradeClass.prototype.buyDownToken = async function (): Promise<void> {
        // Only allow one buy per market
        if (this.hasBought) {
            console.log("⏭️  Already bought in this market, skipping");
            return;
        }

        if (!this.downTokenId || !this.downBuyPrice || this.downBuyPrice <= 0 || isNaN(this.downBuyPrice)) {
            console.error("Cannot buy down token: missing tokenId or invalid price");
            return;
        }

        // Ensure price is a valid number
        const price = Number(this.downBuyPrice);
        if (isNaN(price) || !isFinite(price) || price <= 0) {
            console.error("Cannot buy down token: invalid price value");
            return;
        }

        // Calculate size based on available USD and trade_usd config
        const tradeAmount = getTradeAmount(this);

        if (!tradeAmount || isNaN(tradeAmount) || tradeAmount <= 0) {
            console.error("Cannot buy down token: invalid trade amount or insufficient USD");
            return;
        }

        const roundedTradeAmount = PAPER_TRADING
            ? affordablePaperTradeAmount(this.usd, tradeAmount, price)
            : roundCurrency(tradeAmount);

        const size = Math.floor(roundedTradeAmount / price);

        if (size <= 0 || isNaN(size) || !isFinite(size) || roundedTradeAmount <= 0) {
            console.error("Cannot buy down token: insufficient funds or invalid size");
            return;
        }

        console.log("buying down token", { tokenID: this.downTokenId, price: price, size });
        try {
            GLOBAL_TX_PROCESS.current = TxProcess.Working;

            if (PAPER_TRADING) {
                const makerMode = Boolean(getTrade4LikeConfig(globalThis.__CONFIG__)?.use_passive_maker_orders);
                const entrySignal = this.pendingEntrySignal ? { ...this.pendingEntrySignal } : null;
                const executionPrice = makerMode
                    ? passiveMakerBuyPrice(this.downBuyPrice, this.downSellPrice)
                    : price;
                const momentumDirection = entrySignal?.momentumDirection ?? null;
                const momentumScore = entrySignal?.momentumScore ?? null;
                const momentumConfidence = entrySignal?.momentumConfidence ?? null;
                const mcConvergence = entrySignal?.mcConvergence ?? null;
                const mcSimulatedDirection = entrySignal?.mcSimulatedDirection ?? null;
                const mcBullPaths = entrySignal?.mcBullPaths ?? null;
                const mcBearPaths = entrySignal?.mcBearPaths ?? null;
                const decisionTimestamp = entrySignal?.signalTimestamp ?? new Date().toISOString();
                const midPrice = midMarketPrice(this.downBuyPrice, this.downSellPrice);
                const sharesBought = roundedTradeAmount / executionPrice;
                const feeUsd = makerMode ? 0 : takerFeeUsd(executionPrice, roundedTradeAmount);
                const rebateUsd = makerMode ? makerRebateUsd(executionPrice, roundedTradeAmount) : 0;
                const totalCostUsd = roundCurrency(roundedTradeAmount + feeUsd - rebateUsd);
                const slippageVsMid = midPrice === null ? null : roundFeeUsd(executionPrice - midPrice);

                if (!Number.isFinite(sharesBought) || sharesBought <= 0) {
                    console.error("Cannot buy down token: invalid simulated share size");
                    return;
                }

                if (totalCostUsd > this.usd) {
                    console.error("Cannot buy down token: insufficient simulated cash after fee");
                    return;
                }

                if (!(await this.validateExecutionSafety("DOWN", executionPrice))) {
                    console.log("⏭️  Skipping DOWN buy: execution safety validation failed");
                    return;
                }

                const cashBefore = this.usd;
                let orderPlacedAt: string | null = null;
                let orderFilledAt: string | null = null;
                let simulatedFillDelayMs = 0;
                let estimatedQueuePosition: number | null = null;
                if (makerMode) {
                    const lifecycle = await simulatePaperMakerLifecycle(this, {
                        side: "DOWN",
                        action: "buy",
                        askPrice: this.downBuyPrice,
                        bidPrice: this.downSellPrice,
                        executionPrice,
                        midPrice,
                        feeUsd,
                        rebateUsd,
                        slippageVsMid,
                    });
                    if (!lifecycle.filled) {
                        console.log(`⏭️  Paper maker DOWN buy canceled | reason=${lifecycle.cancelReason}`);
                        return;
                    }
                    orderPlacedAt = lifecycle.orderPlacedAt;
                    orderFilledAt = lifecycle.orderFilledAt;
                    simulatedFillDelayMs = lifecycle.simulatedFillDelayMs;
                    estimatedQueuePosition = lifecycle.estimatedQueuePosition;
                } else {
                    orderPlacedAt = new Date().toISOString();
                    orderFilledAt = orderPlacedAt;
                }
                this.usd = roundCurrency(this.usd - totalCostUsd);
                this.share = sharesBought;
                this.holdingStatus = Market.Down;
                this.hasBought = true;
                const executionTimestamp = orderFilledAt ?? new Date().toISOString();
                this.recordExecutedEntry("DOWN", executionPrice, executionTimestamp, {
                    shares: sharesBought,
                    costBasisUsd: totalCostUsd,
                    feeUsd,
                    rebateUsd,
                    makerMode,
                });

                console.log(`📝 Paper buy filled | side=DOWN | mode=${makerMode ? "MAKER" : "TAKER"} | usd=$${roundedTradeAmount.toFixed(2)} | fee=$${feeUsd.toFixed(2)} | rebate=$${rebateUsd.toFixed(2)} | price=${executionPrice.toFixed(2)} | shares=${sharesBought.toFixed(4)} | cashLeft=$${this.usd.toFixed(2)}`);
                if (!makerMode) {
                    await emitSimulatedOrderFlow(this, {
                        side: "DOWN",
                        action: "buy",
                        makerMode,
                        orderStatus: "filled",
                        orderPlacedAt,
                        orderFilledAt,
                        orderCancelledAt: null,
                        simulatedFillDelayMs,
                        estimatedQueuePosition,
                        price: executionPrice,
                        feeUsd,
                        rebateUsd,
                        midPriceAtDecision: midPrice,
                        slippageVsMid,
                    });
                }
                await writeTelemetryEventSafe("paper_trade.buy", {
                    ...buildBuyTelemetryPayload(this, {
                    entrySignal,
                    side: "DOWN",
                    entryPrice: executionPrice,
                    decisionTimestamp,
                    executionTimestamp,
                    tokenId: this.downTokenId,
                    usd: roundedTradeAmount,
                    feeUsd,
                    rebateUsd,
                    feeRate: takerFeeRate(executionPrice),
                    platformFeeRate: CRYPTO_TAKER_FEE_RATE,
                    feeFactor: protocolFeeFactor(executionPrice),
                    totalCostUsd,
                    makerMode,
                    decisionSource: this.lastDecisionSnapshotSource,
                    momentumDirection,
                    momentumScore,
                    momentumConfidence,
                    mcConvergence,
                    mcSimulatedDirection,
                    mcBullPaths,
                    mcBearPaths,
                    price: executionPrice,
                    askPriceAtDecision: this.downBuyPrice,
                    bidPriceAtDecision: this.downSellPrice,
                    midPriceAtDecision: midPrice,
                    slippageVsMid,
                    shares: sharesBought,
                    cashBefore,
                    cashAfter: this.usd,
                    orderPlacedAt,
                    orderFilledAt: executionTimestamp,
                    simulatedFillDelayMs,
                    estimatedQueuePosition,
                    }),
                });
                playCliTradeSound("buy");
                return;
            }
            
            const maxRetries = globalThis.__CONFIG__?.max_retries || 3;
            ensureLiveClient(this);
            const makerMode = Boolean(getTrade4LikeConfig(globalThis.__CONFIG__)?.use_passive_maker_orders);
            const entrySignal = this.pendingEntrySignal ? { ...this.pendingEntrySignal } : null;
            const momentumDirection = entrySignal?.momentumDirection ?? null;
            const momentumScore = entrySignal?.momentumScore ?? null;
            const momentumConfidence = entrySignal?.momentumConfidence ?? null;
            const mcConvergence = entrySignal?.mcConvergence ?? null;
            const mcSimulatedDirection = entrySignal?.mcSimulatedDirection ?? null;
            const mcBullPaths = entrySignal?.mcBullPaths ?? null;
            const mcBearPaths = entrySignal?.mcBearPaths ?? null;
            const initialPassivePrice = passiveMakerBuyPrice(this.downBuyPrice, this.downSellPrice);
            const initialExecutionPrice = makerMode ? initialPassivePrice : Number(this.downBuyPrice);
            const initialSize = Math.max(1, Math.floor(roundedTradeAmount / Math.max(initialPassivePrice, 0.01)));
            if (!canPlaceLiveOrder(this, initialSize, "DOWN", "buy", initialExecutionPrice, roundedTradeAmount)) {
                return;
            }
            const order = await retryWithInstantRetry(
                async () => {
                    const currentPrice = Number(this.downBuyPrice);
                    const currentPassivePrice = passiveMakerBuyPrice(this.downBuyPrice, this.downSellPrice);
                    const currentExecutionPrice = makerMode ? currentPassivePrice : currentPrice;
                    const currentSize = Math.max(1, Math.floor(roundedTradeAmount / Math.max(currentPassivePrice, 0.01)));

                    if (!(await this.validateExecutionSafety("DOWN", currentExecutionPrice))) {
                        throw new Error("Cannot buy down token: execution safety validation failed");
                    }

                    if (!canPlaceLiveOrder(this, currentSize, "DOWN", "buy", currentExecutionPrice, roundedTradeAmount)) {
                        throw new Error("Cannot buy down token: size fell below market minimum");
                    }

                    const result = makerMode
                        ? await this.authorizedClob.createAndPostOrder({
                            tokenID: this.downTokenId,
                            price: currentPassivePrice,
                            side: Side.BUY,
                            size: currentSize,
                        }, getLiveOrderOptions(this), OrderType.GTC)
                        : await this.authorizedClob.createAndPostMarketOrder({
                            tokenID: this.downTokenId,
                            amount: roundedTradeAmount,
                            price: currentPrice,
                            side: Side.BUY,
                        }, getLiveOrderOptions(this), OrderType.FAK);

                    if (!result.success) {
                        throw new Error("❌ Error buying down token: " + result.error);
                    }

                    return result;
                },
                maxRetries,
                "Buy Down Token"
            );

            console.log("✅ Order posted successfully:", order);

            // Mark as bought
            this.hasBought = true;
            const decisionTimestamp = this.pendingEntrySignal?.signalTimestamp ?? new Date().toISOString();
            const orderId = String(order?.orderID ?? order?.orderId ?? "");
            const postedAt = new Date().toISOString();
            await emitEntryPostedEvent(this, {
                entrySignal,
                side: "DOWN",
                tokenId: this.downTokenId,
                entryPrice: initialExecutionPrice,
                decisionTimestamp,
                executionTimestamp: postedAt,
                shares: 0,
                orderId,
                orderStatus: String(order?.status ?? ""),
                requestedUsd: roundedTradeAmount,
                availableUsdAfterFill: this.usd,
                makerMode,
                momentumDirection,
                momentumScore,
                momentumConfidence,
                mcConvergence,
                mcSimulatedDirection,
                mcBullPaths,
                mcBearPaths,
            });

            // Poll balance every 1 second until down token balance is received
            try {
                await this.waitForBalance("down");
            } catch (error: any) {
                const timeoutAt = new Date().toISOString();
                let providerOrderStatus = await getLiveEntryOrderStatus(this, orderId);
                providerOrderStatus = await cancelLiveEntryOrderIfOpen(this, orderId, {
                    side: "DOWN",
                    tokenId: this.downTokenId,
                    tokenType: "down",
                    source: "entry_balance_timeout",
                });
                await emitEntryTimeoutEvent(this, {
                    entrySignal,
                    side: "DOWN",
                    tokenId: this.downTokenId,
                    entryPrice: initialExecutionPrice,
                    decisionTimestamp,
                    executionTimestamp: timeoutAt,
                    shares: this.share,
                    orderId,
                    orderStatus: String(order?.status ?? ""),
                    requestedUsd: roundedTradeAmount,
                    availableUsdAfterFill: this.usd,
                    makerMode,
                    momentumDirection,
                    momentumScore,
                    momentumConfidence,
                    mcConvergence,
                    mcSimulatedDirection,
                    mcBullPaths,
                    mcBearPaths,
                    timeoutMs: 60000,
                    tokenType: "down",
                    errorMessage: error?.message ?? String(error),
                    providerOrderStatus: providerOrderStatus.status,
                    providerFilledSize: providerOrderStatus.filledSize ?? null,
                    providerRemainingSize: providerOrderStatus.remainingSize ?? null,
                    providerAvgPrice: providerOrderStatus.avgPrice ?? null,
                });
                this.pendingEntryReconciliation = {
                    blockedAt: timeoutAt,
                    side: "DOWN",
                    marketSlug: this.marketSlug,
                    tokenId: this.downTokenId,
                    orderId,
                    requestedUsd: roundedTradeAmount,
                    entryPrice: initialExecutionPrice,
                    decisionTimestamp,
                    providerOrderStatus: providerOrderStatus.status,
                    providerFilledSize: providerOrderStatus.filledSize ?? null,
                    providerRemainingSize: providerOrderStatus.remainingSize ?? null,
                    providerAvgPrice: providerOrderStatus.avgPrice ?? null,
                    lastCheckedAt: timeoutAt,
                };
                this.positionState = "ERROR";
                playCliAlertSound("critical");
                await writeTelemetryEventSafe("trade.entry_order_status_after_timeout", {
                    ...buildBuyTelemetryPayload(this, {
                        entrySignal,
                        side: "DOWN",
                        tokenId: this.downTokenId,
                        entryPrice: initialExecutionPrice,
                        decisionTimestamp,
                        executionTimestamp: timeoutAt,
                        shares: this.share,
                        orderId,
                        orderStatus: String(order?.status ?? ""),
                        requestedUsd: roundedTradeAmount,
                        availableUsdAfterFill: this.usd,
                        makerMode,
                        momentumDirection,
                        momentumScore,
                        momentumConfidence,
                        mcConvergence,
                        mcSimulatedDirection,
                        mcBullPaths,
                        mcBearPaths,
                        timeoutMs: 60000,
                        tokenType: "down",
                        providerOrderStatus: providerOrderStatus.status,
                        providerFilledSize: providerOrderStatus.filledSize ?? null,
                        providerRemainingSize: providerOrderStatus.remainingSize ?? null,
                        providerAvgPrice: providerOrderStatus.avgPrice ?? null,
                    }),
                });
                const reconciled = await reconcilePendingEntryState(this);
                if (reconciled && !isPendingEntryReconciliationActive(this)) {
                    return;
                }
                throw error;
            }
            const executionTimestamp = new Date().toISOString();
            const entryPrice = makerMode ? initialPassivePrice : Number(this.downBuyPrice);
            this.recordExecutedEntry("DOWN", entryPrice, executionTimestamp, {
                shares: this.share,
                costBasisUsd: roundedTradeAmount,
                feeUsd: 0,
                rebateUsd: 0,
                makerMode,
            });
            await emitEntryFilledEvent(this, {
                side: Market.Down,
                tokenId: this.downTokenId,
                entryPrice,
                decisionTimestamp,
                executionTimestamp,
                shares: this.share,
                orderId,
                orderStatus: String(order?.status ?? ""),
                requestedUsd: roundedTradeAmount,
                availableUsdAfterFill: this.usd,
                makerMode,
                momentumDirection,
                momentumScore,
                momentumConfidence,
            });
            await writeTelemetryEventSafe("live_trade.buy", buildBuyTelemetryPayload(this, {
                entrySignal,
                side: "DOWN",
                tokenId: this.downTokenId,
                entryPrice,
                decisionTimestamp,
                executionTimestamp,
                shares: this.share,
                orderId,
                orderStatus: String(order?.status ?? ""),
                requestedUsd: roundedTradeAmount,
                availableUsdAfterFill: this.usd,
                makerMode,
                momentumDirection,
                momentumScore,
                momentumConfidence,
                mcConvergence,
                mcSimulatedDirection,
                mcBullPaths,
                mcBearPaths,
            }));
            if (await maybeProtectLateFilledEntry(this, {
                side: "DOWN",
                decisionTimestamp,
                executionTimestamp,
            })) {
                return;
            }
            playCliTradeSound("buy");
        } catch (error: any) {
            console.error("❌ Error buying down token:", error);
            if (error?.status === 401 || error?.data?.error?.includes("Unauthorized")) {
                console.error("⚠️  API authentication failed. Please check your API credentials in your secret provider or process environment.");
            }
        } finally {
            GLOBAL_TX_PROCESS.current = TxProcess.Idle;
        }
    };

    TradeClass.prototype.sellUpToken = async function (): Promise<boolean> {
        if (!this.upTokenId || !this.upSellPrice || this.upSellPrice <= 0 || isNaN(this.upSellPrice)) {
            console.error("Cannot sell up token: missing tokenId or invalid price");
            clearPendingExitIntent(this);
            return false;
        }

        if (PAPER_TRADING) {
            if (this.holdingStatus !== Market.Up || this.share <= 0) {
                console.error("Cannot sell up token: no simulated UP position available");
                clearPendingExitIntent(this);
                return false;
            }

            const makerMode = Boolean(getTrade4LikeConfig(globalThis.__CONFIG__)?.use_passive_maker_orders);
            const executionPrice = makerMode
                ? passiveMakerSellPrice(this.upSellPrice, this.upBuyPrice)
                : this.upSellPrice;
            const proceeds = roundCurrency(this.share * executionPrice);
            const feeUsd = makerMode ? 0 : takerFeeUsd(executionPrice, proceeds);
            const rebateUsd = makerMode ? makerRebateUsd(executionPrice, proceeds) : 0;
            const netProceeds = roundCurrency(proceeds - feeUsd + rebateUsd);
            const midPrice = midMarketPrice(this.upBuyPrice, this.upSellPrice);
            const slippageVsMid = midPrice === null ? null : roundFeeUsd(executionPrice - midPrice);
            const cashBefore = this.usd;
            let orderPlacedAt: string | null = null;
            let orderFilledAt: string | null = null;
            let simulatedFillDelayMs = 0;
            let estimatedQueuePosition: number | null = null;
            if (makerMode) {
                const lifecycle = await simulatePaperMakerLifecycle(this, {
                    side: "UP",
                    action: "sell",
                    askPrice: this.upBuyPrice,
                    bidPrice: this.upSellPrice,
                    executionPrice,
                    midPrice,
                    feeUsd,
                    rebateUsd,
                    slippageVsMid,
                });
                if (!lifecycle.filled) {
                    console.log(`⏭️  Paper maker UP sell canceled | reason=${lifecycle.cancelReason}`);
                    return false;
                }
                orderPlacedAt = lifecycle.orderPlacedAt;
                orderFilledAt = lifecycle.orderFilledAt;
                simulatedFillDelayMs = lifecycle.simulatedFillDelayMs;
                estimatedQueuePosition = lifecycle.estimatedQueuePosition;
            } else {
                orderPlacedAt = new Date().toISOString();
                orderFilledAt = orderPlacedAt;
            }
            this.usd = roundCurrency(this.usd + netProceeds);
            console.log(`📝 Paper sell filled | side=UP | mode=${makerMode ? "MAKER" : "TAKER"} | price=${executionPrice.toFixed(2)} | shares=${this.share.toFixed(4)} | proceeds=$${proceeds.toFixed(2)} | fee=$${feeUsd.toFixed(2)} | rebate=$${rebateUsd.toFixed(2)} | cash=$${this.usd.toFixed(2)}`);
            if (!makerMode) {
                await emitSimulatedOrderFlow(this, {
                    side: "UP",
                    action: "sell",
                    makerMode,
                    orderStatus: "filled",
                    orderPlacedAt,
                    orderFilledAt,
                    orderCancelledAt: null,
                    simulatedFillDelayMs,
                    estimatedQueuePosition,
                    price: executionPrice,
                    feeUsd,
                    rebateUsd,
                    midPriceAtDecision: midPrice,
                    slippageVsMid,
                });
            }
            await writeTelemetryEventSafe("paper_trade.sell", {
                ...buildSellTelemetryPayload(this, {
                side: "UP",
                exitPrice: executionPrice,
                tokenId: this.upTokenId,
                shares: this.share,
                proceeds,
                feeUsd,
                rebateUsd,
                feeRate: takerFeeRate(executionPrice),
                platformFeeRate: CRYPTO_TAKER_FEE_RATE,
                feeFactor: protocolFeeFactor(executionPrice),
                netProceeds,
                makerMode,
                decisionSource: this.lastDecisionSnapshotSource,
                askPriceAtDecision: this.upBuyPrice,
                bidPriceAtDecision: this.upSellPrice,
                midPriceAtDecision: midPrice,
                slippageVsMid,
                cashBefore,
                cashAfter: this.usd,
                orderPlacedAt,
                orderFilledAt,
                simulatedFillDelayMs,
                estimatedQueuePosition,
                }),
            });
            playCliTradeSound("sell");
            this.share = 0;
            this.holdingStatus = Market.None;
            this.positionState = "CLOSED";
            clearPendingExitIntent(this);
            return true;
        }

        await this.reconcileOpenExitOrders();

        const existingExitOrder = getExistingExitOrder(this, Market.Up, this.upTokenId);
        if (existingExitOrder) {
            const repriced = await maybeRepriceForcedExitOrder(this, Market.Up, existingExitOrder);
            if (repriced !== null) {
                return repriced;
            }
            if (shouldEmitExitSkipTelemetry(this, existingExitOrder)) {
                await emitExitEvent("trade.exit_skipped_existing_live_order", this, {
                    existingOrderId: existingExitOrder.orderId,
                    side: Market.Up,
                    tokenId: this.upTokenId,
                });
            }
            return false;
        }

        // Refresh balance from API before selling to get accurate balance
        await this.updateTokenBalances();

        // Verify we're still holding up token after balance refresh
        if (this.holdingStatus !== Market.Up || this.share <= 0) {
            console.error("Cannot sell up token: no shares available or not holding up token");
            return false;
        }

        // Get the actual balance from API to ensure we have the exact amount
        ensureLiveClient(this);
        const upBalance = await this.authorizedClob.getBalanceAllowance({
            asset_type: AssetType.CONDITIONAL,
            token_id: this.upTokenId,
        });

        // Convert balance from wei to human-readable (divide by 1e6) for validation
        const actualBalance = parseFloat(upBalance.balance) / 1e6;

        if (actualBalance <= 0 || isNaN(actualBalance) || !isFinite(actualBalance)) {
            console.error("Cannot sell up token: invalid balance from API");
            return false;
        }

        // For SELL orders, use the raw balance (in wei) as the API expects it in this format
        // The raw balance is the exact amount the API needs
        const rawBalance = parseFloat(upBalance.balance);
        
        if (rawBalance <= 0 || isNaN(rawBalance) || !isFinite(rawBalance)) {
            console.error("Cannot sell up token: invalid raw balance from API");
            return false;
        }

        // Use raw balance for the amount parameter (API expects wei format)
        const size = rawBalance;

        // Ensure price is a valid number
        const price = Number(this.upSellPrice);
        if (isNaN(price) || !isFinite(price) || price <= 0) {
            console.error("Cannot sell up token: invalid price value");
            return false;
        }

        const makerMode = Boolean(getTrade4LikeConfig(globalThis.__CONFIG__)?.use_passive_maker_orders);
        const passivePrice = passiveMakerSellPrice(this.upSellPrice, this.upBuyPrice);
        const orderPrice = makerMode ? passivePrice : price;
        if (await shouldSkipLiveSellForStaleSnapshot(this, "UP", Number(this.upBuyPrice), price)) {
            return false;
        }

        console.log("selling up token", { 
            tokenID: this.upTokenId, 
            bidPrice: price,
            askPrice: this.upBuyPrice,
            orderPrice,
            makerMode,
            size, 
            actualBalance, 
            rawBalance: upBalance.balance,
            share: this.share 
        });
        try {
            GLOBAL_TX_PROCESS.current = TxProcess.Working;
            if (!canPlaceLiveOrder(this, actualBalance, "UP", "sell", orderPrice)) {
                return false;
            }

            await emitExitEvent("trade.exit_attempt", this, {
                side: Market.Up,
                tokenId: this.upTokenId,
                price: orderPrice,
                size: actualBalance,
                availableBalance: actualBalance,
                rawBalance: upBalance.balance,
            });

            const order = await placeLiveExitOrder(this, "UP", this.upTokenId, makerMode, passivePrice, actualBalance, size);

            console.log("✅ Order posted successfully:", order);

            const orderStatus = String(order?.status ?? "").toLowerCase();
            if (String(order?.orderID ?? order?.orderId ?? "") && orderStatus === "live") {
                await registerAcceptedExitOrder(
                    this,
                    Market.Up,
                    this.upTokenId,
                    actualBalance,
                    orderPrice,
                    order,
                    resolveExitReason(this),
                    resolveExitErrorContext(this),
                );
                return false;
            }

            // Wait a bit for the order to settle, then check balances
            await new Promise(resolve => setTimeout(resolve, 2000));
            await this.updateTokenBalances();

            // Verify the sell was successful by checking that we no longer hold the token
            if (this.holdingStatus === Market.Up && this.share > 0) {
                console.warn("⚠️  Sell order posted but tokens still held. May need more time to settle.");
                // Still return true as the order was posted successfully
                return true;
            }

            console.log("✅ Sell confirmed: tokens successfully sold");
            markPositionClosed(this);
            await writeTelemetryEventSafe("live_trade.sell", buildSellTelemetryPayload(this, {
                side: "UP",
                tokenId: this.upTokenId,
                exitPrice: orderPrice,
                shares: actualBalance,
                cashBefore: null,
                cashAfter: null,
                feeUsd: 0,
                rebateUsd: 0,
                orderId: String(order?.orderID ?? order?.orderId ?? ""),
            }));
            await emitExitEvent("trade.exit_filled", this, {
                side: Market.Up,
                tokenId: this.upTokenId,
                filledSize: actualBalance,
                avgPrice: orderPrice,
                orderId: String(order?.orderID ?? order?.orderId ?? ""),
                pnlEstimate: null,
            });
            playCliTradeSound("sell");
            clearPendingExitIntent(this);
            return true;
        } catch (error: any) {
            console.error("❌ Error selling up token:", error);
            const reservedOrder = getExistingExitOrder(this, Market.Up, this.upTokenId);
            if (reservedOrder && isBalanceReservedError(error)) {
                this.positionState = reservedOrder.filledSize > 0 ? "EXIT_PARTIAL" : "EXIT_PENDING";
                await emitExitEvent("trade.exit_balance_reserved_by_live_order", this, {
                    orderId: reservedOrder.orderId,
                    side: Market.Up,
                    tokenId: this.upTokenId,
                    attemptedSize: actualBalance,
                });
                return false;
            }
            await emitExitEvent("trade.exit_failed", this, {
                side: Market.Up,
                tokenId: this.upTokenId,
                reason: "order_submit_failed",
                errorMessage: String(error?.message ?? error),
            });
            if (error?.status === 401 || error?.data?.error?.includes("Unauthorized")) {
                console.error("⚠️  API authentication failed. Please check your API credentials in your secret provider or process environment.");
            }
            this.positionState = "ERROR";
            this.pendingExitReason = "unknown_error";
            this.pendingExitErrorContext = String(error?.message ?? error);
            return false;
        } finally {
            GLOBAL_TX_PROCESS.current = TxProcess.Idle;
        }
    };

    TradeClass.prototype.sellDownToken = async function (): Promise<boolean> {
        if (!this.downTokenId || !this.downSellPrice || this.downSellPrice <= 0 || isNaN(this.downSellPrice)) {
            console.error("Cannot sell down token: missing tokenId or invalid price");
            clearPendingExitIntent(this);
            return false;
        }

        if (PAPER_TRADING) {
            if (this.holdingStatus !== Market.Down || this.share <= 0) {
                console.error("Cannot sell down token: no simulated DOWN position available");
                clearPendingExitIntent(this);
                return false;
            }

            const makerMode = Boolean(getTrade4LikeConfig(globalThis.__CONFIG__)?.use_passive_maker_orders);
            const executionPrice = makerMode
                ? passiveMakerSellPrice(this.downSellPrice, this.downBuyPrice)
                : this.downSellPrice;
            const proceeds = roundCurrency(this.share * executionPrice);
            const feeUsd = makerMode ? 0 : takerFeeUsd(executionPrice, proceeds);
            const rebateUsd = makerMode ? makerRebateUsd(executionPrice, proceeds) : 0;
            const netProceeds = roundCurrency(proceeds - feeUsd + rebateUsd);
            const midPrice = midMarketPrice(this.downBuyPrice, this.downSellPrice);
            const slippageVsMid = midPrice === null ? null : roundFeeUsd(executionPrice - midPrice);
            const cashBefore = this.usd;
            let orderPlacedAt: string | null = null;
            let orderFilledAt: string | null = null;
            let simulatedFillDelayMs = 0;
            let estimatedQueuePosition: number | null = null;
            if (makerMode) {
                const lifecycle = await simulatePaperMakerLifecycle(this, {
                    side: "DOWN",
                    action: "sell",
                    askPrice: this.downBuyPrice,
                    bidPrice: this.downSellPrice,
                    executionPrice,
                    midPrice,
                    feeUsd,
                    rebateUsd,
                    slippageVsMid,
                });
                if (!lifecycle.filled) {
                    console.log(`⏭️  Paper maker DOWN sell canceled | reason=${lifecycle.cancelReason}`);
                    return false;
                }
                orderPlacedAt = lifecycle.orderPlacedAt;
                orderFilledAt = lifecycle.orderFilledAt;
                simulatedFillDelayMs = lifecycle.simulatedFillDelayMs;
                estimatedQueuePosition = lifecycle.estimatedQueuePosition;
            } else {
                orderPlacedAt = new Date().toISOString();
                orderFilledAt = orderPlacedAt;
            }
            this.usd = roundCurrency(this.usd + netProceeds);
            console.log(`📝 Paper sell filled | side=DOWN | mode=${makerMode ? "MAKER" : "TAKER"} | price=${executionPrice.toFixed(2)} | shares=${this.share.toFixed(4)} | proceeds=$${proceeds.toFixed(2)} | fee=$${feeUsd.toFixed(2)} | rebate=$${rebateUsd.toFixed(2)} | cash=$${this.usd.toFixed(2)}`);
            if (!makerMode) {
                await emitSimulatedOrderFlow(this, {
                    side: "DOWN",
                    action: "sell",
                    makerMode,
                    orderStatus: "filled",
                    orderPlacedAt,
                    orderFilledAt,
                    orderCancelledAt: null,
                    simulatedFillDelayMs,
                    estimatedQueuePosition,
                    price: executionPrice,
                    feeUsd,
                    rebateUsd,
                    midPriceAtDecision: midPrice,
                    slippageVsMid,
                });
            }
            await writeTelemetryEventSafe("paper_trade.sell", {
                ...buildSellTelemetryPayload(this, {
                side: "DOWN",
                exitPrice: executionPrice,
                tokenId: this.downTokenId,
                shares: this.share,
                proceeds,
                feeUsd,
                rebateUsd,
                feeRate: takerFeeRate(executionPrice),
                platformFeeRate: CRYPTO_TAKER_FEE_RATE,
                feeFactor: protocolFeeFactor(executionPrice),
                netProceeds,
                makerMode,
                decisionSource: this.lastDecisionSnapshotSource,
                askPriceAtDecision: this.downBuyPrice,
                bidPriceAtDecision: this.downSellPrice,
                midPriceAtDecision: midPrice,
                slippageVsMid,
                cashBefore,
                cashAfter: this.usd,
                orderPlacedAt,
                orderFilledAt,
                simulatedFillDelayMs,
                estimatedQueuePosition,
                }),
            });
            playCliTradeSound("sell");
            this.share = 0;
            this.holdingStatus = Market.None;
            this.positionState = "CLOSED";
            clearPendingExitIntent(this);
            return true;
        }

        await this.reconcileOpenExitOrders();

        const existingExitOrder = getExistingExitOrder(this, Market.Down, this.downTokenId);
        if (existingExitOrder) {
            const repriced = await maybeRepriceForcedExitOrder(this, Market.Down, existingExitOrder);
            if (repriced !== null) {
                return repriced;
            }
            if (shouldEmitExitSkipTelemetry(this, existingExitOrder)) {
                await emitExitEvent("trade.exit_skipped_existing_live_order", this, {
                    existingOrderId: existingExitOrder.orderId,
                    side: Market.Down,
                    tokenId: this.downTokenId,
                });
            }
            return false;
        }

        // Refresh balance from API before selling to get accurate balance
        await this.updateTokenBalances();

        // Verify we're still holding down token after balance refresh
        if (this.holdingStatus !== Market.Down || this.share <= 0) {
            console.error("Cannot sell down token: no shares available or not holding down token");
            return false;
        }

        // Get the actual balance from API to ensure we have the exact amount
        ensureLiveClient(this);
        const downBalance = await this.authorizedClob.getBalanceAllowance({
            asset_type: AssetType.CONDITIONAL,
            token_id: this.downTokenId,
        });

        // Convert balance from wei to human-readable (divide by 1e6) for validation
        const actualBalance = parseFloat(downBalance.balance) / 1e6;

        if (actualBalance <= 0 || isNaN(actualBalance) || !isFinite(actualBalance)) {
            console.error("Cannot sell down token: invalid balance from API");
            return false;
        }

        // For SELL orders, use the raw balance (in wei) as the API expects it in this format
        // The raw balance is the exact amount the API needs
        const rawBalance = parseFloat(downBalance.balance);
        
        if (rawBalance <= 0 || isNaN(rawBalance) || !isFinite(rawBalance)) {
            console.error("Cannot sell down token: invalid raw balance from API");
            return false;
        }

        // Use raw balance for the amount parameter (API expects wei format)
        const size = rawBalance;

        // Ensure price is a valid number
        const price = Number(this.downSellPrice);
        if (isNaN(price) || !isFinite(price) || price <= 0) {
            console.error("Cannot sell down token: invalid price value");
            return false;
        }

        const makerMode = Boolean(getTrade4LikeConfig(globalThis.__CONFIG__)?.use_passive_maker_orders);
        const passivePrice = passiveMakerSellPrice(this.downSellPrice, this.downBuyPrice);
        const orderPrice = makerMode ? passivePrice : price;
        if (await shouldSkipLiveSellForStaleSnapshot(this, "DOWN", Number(this.downBuyPrice), price)) {
            return false;
        }

        console.log("selling down token", { 
            tokenID: this.downTokenId, 
            bidPrice: price,
            askPrice: this.downBuyPrice,
            orderPrice,
            makerMode,
            size, 
            actualBalance, 
            rawBalance: downBalance.balance,
            share: this.share 
        });
        try {
            GLOBAL_TX_PROCESS.current = TxProcess.Working;
            if (!canPlaceLiveOrder(this, actualBalance, "DOWN", "sell", orderPrice)) {
                return false;
            }

            await emitExitEvent("trade.exit_attempt", this, {
                side: Market.Down,
                tokenId: this.downTokenId,
                price: orderPrice,
                size: actualBalance,
                availableBalance: actualBalance,
                rawBalance: downBalance.balance,
            });

            const order = await placeLiveExitOrder(this, "DOWN", this.downTokenId, makerMode, passivePrice, actualBalance, size);

            console.log("✅ Order posted successfully:", order);

            const orderStatus = String(order?.status ?? "").toLowerCase();
            if (String(order?.orderID ?? order?.orderId ?? "") && orderStatus === "live") {
                await registerAcceptedExitOrder(
                    this,
                    Market.Down,
                    this.downTokenId,
                    actualBalance,
                    orderPrice,
                    order,
                    resolveExitReason(this),
                    resolveExitErrorContext(this),
                );
                return false;
            }

            // Wait a bit for the order to settle, then check balances
            await new Promise(resolve => setTimeout(resolve, 2000));
            await this.updateTokenBalances();

            // Verify the sell was successful by checking that we no longer hold the token
            if (this.holdingStatus === Market.Down && this.share > 0) {
                console.warn("⚠️  Sell order posted but tokens still held. May need more time to settle.");
                // Still return true as the order was posted successfully
                return true;
            }

            console.log("✅ Sell confirmed: tokens successfully sold");
            markPositionClosed(this);
            await writeTelemetryEventSafe("live_trade.sell", buildSellTelemetryPayload(this, {
                side: "DOWN",
                tokenId: this.downTokenId,
                exitPrice: orderPrice,
                shares: actualBalance,
                cashBefore: null,
                cashAfter: null,
                feeUsd: 0,
                rebateUsd: 0,
                orderId: String(order?.orderID ?? order?.orderId ?? ""),
            }));
            await emitExitEvent("trade.exit_filled", this, {
                side: Market.Down,
                tokenId: this.downTokenId,
                filledSize: actualBalance,
                avgPrice: orderPrice,
                orderId: String(order?.orderID ?? order?.orderId ?? ""),
                pnlEstimate: null,
            });
            playCliTradeSound("sell");
            clearPendingExitIntent(this);
            return true;
        } catch (error: any) {
            console.error("❌ Error selling down token:", error);
            const reservedOrder = getExistingExitOrder(this, Market.Down, this.downTokenId);
            if (reservedOrder && isBalanceReservedError(error)) {
                this.positionState = reservedOrder.filledSize > 0 ? "EXIT_PARTIAL" : "EXIT_PENDING";
                await emitExitEvent("trade.exit_balance_reserved_by_live_order", this, {
                    orderId: reservedOrder.orderId,
                    side: Market.Down,
                    tokenId: this.downTokenId,
                    attemptedSize: actualBalance,
                });
                return false;
            }
            await emitExitEvent("trade.exit_failed", this, {
                side: Market.Down,
                tokenId: this.downTokenId,
                reason: "order_submit_failed",
                errorMessage: String(error?.message ?? error),
            });
            if (error?.status === 401 || error?.data?.error?.includes("Unauthorized")) {
                console.error("⚠️  API authentication failed. Please check your API credentials in your secret provider or process environment.");
            }
            this.positionState = "ERROR";
            this.pendingExitReason = "unknown_error";
            this.pendingExitErrorContext = String(error?.message ?? error);
            return false;
        } finally {
            GLOBAL_TX_PROCESS.current = TxProcess.Idle;
        }
    };
}
