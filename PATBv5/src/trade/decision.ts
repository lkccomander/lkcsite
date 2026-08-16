import { randomUUID } from "node:crypto";
import { PAPER_TRADING } from "../config";
import { GLOBAL_TX_PROCESS, TxProcess } from "../constant";
import { getTrade4LikeConfig } from "../config/toml";
import { getFeedHealth } from "../signals/feedgate";
import { getMomentumSignal } from "../signals/momentum";
import { runMonteCarlo } from "../signals/montecarlo";
import { Market } from "../types";
import { writeTelemetryEventSafe } from "../telemetry";
import { evaluateEntryTiming } from "./policy/entryTiming";
import {
    clampPrice,
    feeAdjustedEdgeUsd,
    makerRebateUsd as calculateMakerRebateUsd,
    midMarketPrice,
    passiveMakerBuyPrice,
    takerFeeRate,
} from "./policy/executionPricing";
import {
    calculateShadowPnlUsd,
    shadowExitPriceForSide,
    type ShadowSettlement,
} from "./policy/shadowSettlement";

export function getEntryPriceRatioForSide(
    side: Market.Up | Market.Down,
    upBuyPrice: number,
    downBuyPrice: number,
): number | null {
    const selectedPrice = side === Market.Up ? upBuyPrice : downBuyPrice;
    if (!Number.isFinite(selectedPrice) || selectedPrice <= 0) {
        return null;
    }
    return Math.abs(selectedPrice - 0.5) / 0.5;
}

type EntrySideCandidate = {
    preferredSide: Market.Up | Market.Down;
    preferredPrice: number;
    preferredSpread: number | null;
};

export function selectPreferredEntrySide(
    upBuyPrice: number,
    downBuyPrice: number,
    upSpread: number | null,
    downSpread: number | null,
    maxAllowedSpread: number,
): EntrySideCandidate {
    const candidates: EntrySideCandidate[] = [
        {
            preferredSide: Market.Up,
            preferredPrice: upBuyPrice,
            preferredSpread: upSpread,
        },
        {
            preferredSide: Market.Down,
            preferredPrice: downBuyPrice,
            preferredSpread: downSpread,
        },
    ];

    const byBestPriceDesc = (left: EntrySideCandidate, right: EntrySideCandidate): number =>
        right.preferredPrice - left.preferredPrice;

    const spreadEligibleCandidates = candidates
        .filter((candidate) =>
            Number.isFinite(candidate.preferredPrice)
            && candidate.preferredPrice > 0
            && candidate.preferredSpread !== null
            && Number.isFinite(candidate.preferredSpread)
            && candidate.preferredSpread < maxAllowedSpread)
        .sort(byBestPriceDesc);

    if (spreadEligibleCandidates.length > 0) {
        return spreadEligibleCandidates[0];
    }

    return [...candidates].sort(byBestPriceDesc)[0];
}

type RejectionDiagnosticContextArgs = {
    trade: {
        remainingTime: number;
        observedMarketTicks: number;
        lastDecisionSnapshotSource: string | null;
        latestFeedLatencyMs: number | null;
        latestFeedRttMs: number | null;
        latestFeedAgeMs: number | null;
        latestFeedWsConnected: boolean | null;
        priceTickTimestamps?: number[] | null;
    };
    currentTimeRatio: number;
    entryPriceRatio: number | null;
    entryPriceRatioMin: number;
    entryPriceRatioMax: number;
    preferredSpread: number | null;
};

export function buildRejectionDiagnosticContext({
    trade,
    currentTimeRatio,
    entryPriceRatio,
    entryPriceRatioMin,
    entryPriceRatioMax,
    preferredSpread,
}: RejectionDiagnosticContextArgs): Record<string, unknown> {
    const ticksLast10s = Array.isArray(trade.priceTickTimestamps)
        ? trade.priceTickTimestamps.filter((timestamp) => Number.isFinite(timestamp) && (Date.now() - timestamp) <= 10_000).length
        : trade.observedMarketTicks;

    return {
        secondsToClose: trade.remainingTime,
        currentTimeRatio: Math.round(currentTimeRatio * 10000) / 10000,
        decisionSnapshotSource: trade.lastDecisionSnapshotSource,
        feedLatencyMs: trade.latestFeedLatencyMs,
        feedRttMs: trade.latestFeedRttMs,
        feedAgeMs: trade.latestFeedAgeMs,
        feedWsConnected: trade.latestFeedWsConnected,
        feedTicksLast10s: ticksLast10s,
        entryPriceRatio: entryPriceRatio === null ? null : Math.round(entryPriceRatio * 10000) / 10000,
        entryPriceRatioMin,
        entryPriceRatioMax,
        preferredSpread,
    };
}

// Declare module augmentation to add cancel method to Trade class
declare module "./index" {
    interface Trade {
        make_trading_decision(): void;
        emitShadowPnlTelemetry(settlement: ShadowSettlement): Promise<void>;
        recordEntrySignal(side: Market.Up | Market.Down, context?: Record<string, unknown>): void;
        setPendingExitIntent(reason: string, errorContext?: string | null): void;
        reconcilePendingEntryState(): Promise<boolean>;
    }
}

// Function to attach methods to Trade class (called from index.ts)
export function attachDecisionMethods(TradeClass: new (...args: any[]) => any) {
    const MAX_STOP_LOSS_SPREAD = 0.20;
    const sleepMs = async (ms: number): Promise<void> => {
        await new Promise((resolve) => setTimeout(resolve, ms));
    };
    const roundMetric = (value: number): number => Math.round(value * 10000) / 10000;
    const sideLabel = (value: unknown): "UP" | "DOWN" | null => {
        if (value === Market.Up || value === "UP") {
            return "UP";
        }
        if (value === Market.Down || value === "DOWN") {
            return "DOWN";
        }
        return null;
    };
    const normalizedSpread = (bestAsk: number, bestBid: number): number | null => {
        if (!Number.isFinite(bestAsk) || !Number.isFinite(bestBid) || bestAsk <= 0 || bestBid <= 0) {
            return null;
        }
        return roundMetric(bestAsk - bestBid);
    };
    const computeBtcTrendSnapshot = (trade: any, nowMs: number = Date.now()) => {
        const currentBtcPrice = Number(trade.latestExternalPriceUsd);
        const currentBtc = Number.isFinite(currentBtcPrice) && currentBtcPrice > 0 ? currentBtcPrice : null;

        const externalPriceAtOrBefore = (targetTimestampMs: number): number | null => {
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

        const toDelta = (previous: number | null): number | null =>
            currentBtc !== null && previous !== null && previous > 0
                ? roundMetric((currentBtc - previous) / previous)
                : null;

        const btcDelta5s = toDelta(currentBtc !== null ? externalPriceAtOrBefore(nowMs - 5_000) : null);
        const btcDelta15s = toDelta(currentBtc !== null ? externalPriceAtOrBefore(nowMs - 15_000) : null);
        const btcDelta30s = toDelta(currentBtc !== null ? externalPriceAtOrBefore(nowMs - 30_000) : null);
        const btcTrendDirection =
            btcDelta30s === null ? "FLAT" :
            btcDelta30s > 0 ? "UP" :
            btcDelta30s < 0 ? "DOWN" :
            "FLAT";

        return {
            btcDelta5s,
            btcDelta15s,
            btcDelta30s,
            btcTrendDirection,
        };
    };
    const snapshotInvalidReason = (
        askPrice: number,
        bidPrice: number,
        spread: number | null,
    ): "invalid_bid_ask_snapshot" | "negative_spread" | "spread_formula_inconsistent" | null => {
        if (!Number.isFinite(askPrice) || !Number.isFinite(bidPrice) || askPrice <= 0 || bidPrice <= 0) {
            return "invalid_bid_ask_snapshot";
        }
        if (bidPrice > askPrice) {
            return "negative_spread";
        }
        const rawSpread = askPrice - bidPrice;
        if (spread === null || !Number.isFinite(spread) || Math.abs(spread - roundMetric(rawSpread)) > 0.0001) {
            return "spread_formula_inconsistent";
        }
        return null;
    };
    const makerRebateUsd = (notionalUsd: number): number => {
        const rebateBps = Number(getTrade4LikeConfig(globalThis.__CONFIG__)?.maker_rebate_bps ?? 0);
        return calculateMakerRebateUsd(notionalUsd, rebateBps, 4);
    };
    const estimateAcceptedSignal = (
        trade: any,
        preferredSide: Market,
        preferredPrice: number,
        takeProfitPrice: number,
    ): Record<string, unknown> => {
        const makerMode = Boolean(getTrade4LikeConfig(globalThis.__CONFIG__)?.use_passive_maker_orders);
        const askPriceAtDecision = preferredSide === Market.Up ? trade.upBuyPrice : trade.downBuyPrice;
        const bidPriceAtDecision = preferredSide === Market.Up ? trade.upSellPrice : trade.downSellPrice;
        const executionPrice = makerMode
            ? passiveMakerBuyPrice(askPriceAtDecision, bidPriceAtDecision)
            : preferredPrice;
        const midPrice = midMarketPrice(askPriceAtDecision, bidPriceAtDecision);
        const feeUsd = makerMode ? 0 : roundMetric(takerFeeRate(executionPrice));
        const rebateUsd = makerMode ? makerRebateUsd(1) : 0;
        const netEdgeAfterFees = roundMetric(feeAdjustedEdgeUsd(executionPrice, takeProfitPrice) + rebateUsd);
        const slippageVsMid = midPrice === null ? null : roundMetric(executionPrice - midPrice);

        return {
            preferredSide,
            makerMode,
            executionPrice,
            askPriceAtDecision,
            bidPriceAtDecision,
            midPriceAtDecision: midPrice,
            feeUsd,
            rebateUsd,
            netEdgeAfterFees,
            slippageVsMid,
        };
    };
    const isTrade2EmergencyExit = (trade: any, trade2: any, upPriceRatio: number): boolean => {
        const emergencySwapPrice = trade2.emergency_swap_price;
        if (!emergencySwapPrice) {
            return false;
        }
        const [emergencyMin, emergencyMax] = emergencySwapPrice;
        return upPriceRatio >= emergencyMin && upPriceRatio <= emergencyMax;
    };
    const isTrade34EmergencyExit = (trade: any, emergencySwapPrice: unknown): boolean => {
        if (!Array.isArray(emergencySwapPrice) || emergencySwapPrice.length < 2) {
            return false;
        }
        const [emergencyMin, emergencyMax] = emergencySwapPrice as [unknown, unknown];
        if (!Number.isFinite(emergencyMin) || !Number.isFinite(emergencyMax)) {
            return false;
        }
        const preferredPrice = trade.upBuyPrice >= trade.downBuyPrice ? trade.upBuyPrice : trade.downBuyPrice;
        return preferredPrice >= emergencyMin && preferredPrice <= emergencyMax;
    };

    const emitSignalRejected = async (trade: any, reason: string, extra: Record<string, unknown> = {}): Promise<void> => {
        const activeTradeConfig = getTrade4LikeConfig(globalThis.__CONFIG__);
        const requireRejectReason = ![
            "trade_4",
            "trade_5x",
            "trade_5x_close31_paper",
            "trade_5x_close31_down_paper",
            "trade_5x_close31_down_paper_relaxed",
            "trade_5x_close31_down_paper_learning",
        ].includes(globalThis.__CONFIG__.strategy)
            || activeTradeConfig?.require_reject_reason !== false;
        if (!requireRejectReason) {
            return;
        }

        const upMidPrice = (trade.upBuyPrice > 0 && trade.upSellPrice > 0)
            ? roundMetric((trade.upBuyPrice + trade.upSellPrice) / 2)
            : null;
        const downMidPrice = (trade.downBuyPrice > 0 && trade.downSellPrice > 0)
            ? roundMetric((trade.downBuyPrice + trade.downSellPrice) / 2)
            : null;
        const upSpread = normalizedSpread(trade.upBuyPrice, trade.upSellPrice);
        const downSpread = normalizedSpread(trade.downBuyPrice, trade.downSellPrice);
        const inferredSide = trade.upBuyPrice >= trade.downBuyPrice ? "UP" : "DOWN";
        const intendedSide = sideLabel(extra.intendedSide)
            ?? sideLabel(extra.selectedSide)
            ?? sideLabel(extra.preferredSide)
            ?? sideLabel(extra.requestedSide)
            ?? sideLabel(extra.side)
            ?? inferredSide;
        const selectedSide = sideLabel(extra.selectedSide)
            ?? sideLabel(extra.preferredSide)
            ?? sideLabel(extra.requestedSide)
            ?? sideLabel(extra.side)
            ?? intendedSide;
        const spreadChecked = typeof extra.spreadChecked === "number"
            ? extra.spreadChecked
            : intendedSide === "UP"
                ? upSpread
                : downSpread;
        const selectedEntryPrice = intendedSide === "UP" ? trade.upBuyPrice : trade.downBuyPrice;
        const entryPriceChecked = typeof extra.entryPriceChecked === "number"
            ? extra.entryPriceChecked
            : selectedEntryPrice;

        await writeTelemetryEventSafe("trade.signal_rejected", {
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
            upMidPrice,
            downMidPrice,
            upSpread,
            downSpread,
            intendedSide,
            selectedSide,
            spreadChecked,
            entryPriceChecked,
            ...extra,
        });

        const preferredSide = trade.upBuyPrice >= trade.downBuyPrice ? Market.Up : Market.Down;
        const preferredEntryPrice = preferredSide === Market.Up ? trade.upBuyPrice : trade.downBuyPrice;
        trade.shadowSignals.push({
            signalId: randomUUID(),
            reason,
            rejectedAt: new Date().toISOString(),
            preferredSide,
            preferredEntryPrice: Number.isFinite(preferredEntryPrice) && preferredEntryPrice > 0 ? preferredEntryPrice : null,
            upBuyPrice: trade.upBuyPrice,
            upSellPrice: trade.upSellPrice,
            downBuyPrice: trade.downBuyPrice,
            downSellPrice: trade.downSellPrice,
            feedAgeMs: trade.latestFeedAgeMs,
            feedLatencyMs: trade.latestFeedLatencyMs,
            feedRttMs: trade.latestFeedRttMs,
        });
    };

    const emitSignalAccepted = async (trade: any, payload: Record<string, unknown>): Promise<void> => {
        await writeTelemetryEventSafe("trade.signal_accepted", {
            strategy: globalThis.__CONFIG__.strategy,
            decisionSource: trade.lastDecisionSnapshotSource,
            remainingTime: trade.remainingTime,
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
            ...payload,
        });
    };
    const getDynamicStopPrice = (trade: any): number | null => {
        const trade4 = getTrade4LikeConfig(globalThis.__CONFIG__);
        if (!trade4) {
            return null;
        }

        const offset = Number(trade4.stop_loss_offset);
        const entryPrice = Number(trade.lastExecutedEntry?.entryPrice);
        if (Number.isFinite(offset) && offset > 0 && Number.isFinite(entryPrice) && entryPrice > 0) {
            return Math.max(0.01, roundMetric(entryPrice - offset));
        }

        const fallbackStop = Number(trade4.stop_loss_price);
        return Number.isFinite(fallbackStop) && fallbackStop > 0 ? fallbackStop : null;
    };
    const emitStopLossEval = async (
        trade: any,
        side: Market.Up | Market.Down,
        stopLossTriggerPrice: number,
        currentSpread: number | null,
    ): Promise<void> => {
        const trade4 = getTrade4LikeConfig(globalThis.__CONFIG__);
        const maxStopLossSpread = Number(trade4?.stop_loss_max_spread ?? 0.035);
        const sideLabel = side === Market.Up ? "UP" : "DOWN";
        const currentSellPrice = side === Market.Up ? Number(trade.upSellPrice) : Number(trade.downSellPrice);
        const entryPrice = Number(trade.lastExecutedEntry?.entryPrice);
        const slippageEstimate = Number.isFinite(currentSellPrice) && Number.isFinite(stopLossTriggerPrice)
            ? roundMetric(stopLossTriggerPrice - currentSellPrice)
            : null;
        const shouldWaitDueToSpread =
            currentSpread !== null &&
            Number.isFinite(currentSpread) &&
            Number.isFinite(maxStopLossSpread) &&
            currentSpread > maxStopLossSpread;

        await writeTelemetryEventSafe("exit.stop_loss_eval", {
            strategy: globalThis.__CONFIG__.strategy,
            marketSlug: trade.marketSlug,
            side: sideLabel,
            entryPrice: Number.isFinite(entryPrice) ? entryPrice : null,
            currentPrice: Number.isFinite(currentSellPrice) ? currentSellPrice : null,
            stopPrice: stopLossTriggerPrice,
            spread: currentSpread,
            secondsBeforeClose: Math.max(0, Number(trade.remainingTime) || 0),
            feedLatencyMs: trade.latestFeedLatencyMs,
            feedRttMs: trade.latestFeedRttMs,
            feedAgeMs: trade.latestFeedAgeMs,
            slippageEstimate,
            shouldWaitDueToSpread,
            timestamp: new Date().toISOString(),
        });
    };
    const maybeDelayStopLossExit = async (
        trade: any,
        side: Market.Up | Market.Down,
        stopLossTriggerPrice: number,
        currentSpread: number | null,
    ): Promise<boolean> => {
        const trade4 = getTrade4LikeConfig(globalThis.__CONFIG__);
        if (!trade4) {
            return false;
        }

        const maxStopLossSpread = Number(trade4.stop_loss_max_spread ?? 0.035);
        const waitMs = Number(trade4.stop_loss_spread_wait_ms ?? 2000);
        if (!Number.isFinite(maxStopLossSpread) || maxStopLossSpread <= 0) {
            return false;
        }
        if (currentSpread === null || !Number.isFinite(currentSpread) || currentSpread <= maxStopLossSpread) {
            return false;
        }

        const sideLabel = side === Market.Up ? "UP" : "DOWN";
        const currentSellPrice = side === Market.Up ? trade.upSellPrice : trade.downSellPrice;
        await writeTelemetryEventSafe("exit.sl_spread_wait", {
            strategy: globalThis.__CONFIG__.strategy,
            marketSlug: trade.marketSlug,
            side: sideLabel,
            spread: currentSpread,
            waitingMs: waitMs,
            maxAllowedSpread: maxStopLossSpread,
            stopLossTriggerPrice,
            currentSellPrice,
            priceBeforeWait: currentSellPrice,
            feedLatencyMs: trade.latestFeedLatencyMs,
            feedRttMs: trade.latestFeedRttMs,
            feedAgeMs: trade.latestFeedAgeMs,
            feedSnapshotSource: trade.latestFeedSnapshotSource,
            timestamp: new Date().toISOString(),
        });

        await sleepMs(waitMs);

        const refreshedSellPrice = side === Market.Up ? Number(trade.upSellPrice) : Number(trade.downSellPrice);
        const refreshedSpread = side === Market.Up
            ? normalizedSpread(trade.upBuyPrice, trade.upSellPrice)
            : normalizedSpread(trade.downBuyPrice, trade.downSellPrice);
        const recovered = Number.isFinite(refreshedSellPrice) && refreshedSellPrice >= stopLossTriggerPrice;

        await writeTelemetryEventSafe("exit.sl_spread_wait_result", {
            strategy: globalThis.__CONFIG__.strategy,
            marketSlug: trade.marketSlug,
            side: sideLabel,
            priceBeforeWait: currentSellPrice,
            priceAfterWait: Number.isFinite(refreshedSellPrice) ? refreshedSellPrice : null,
            recovered,
            executed: !recovered,
            spreadAfterWait: refreshedSpread,
            stopLossTriggerPrice,
            timestamp: new Date().toISOString(),
        });

        if (recovered) {
            await writeTelemetryEventSafe("exit.sl_cancelled_recovered", {
                strategy: globalThis.__CONFIG__.strategy,
                marketSlug: trade.marketSlug,
                side: sideLabel,
                refreshedPrice: refreshedSellPrice,
                refreshedSpread,
                stopLossTriggerPrice,
            });
            return true;
        }

        return false;
    };

    const attemptEntry = async (trade: any, side: Market.Up | Market.Down, context: Record<string, unknown> = {}): Promise<void> => {
        trade.recordEntrySignal(side, context);
        if (side === Market.Up) {
            await trade.buyUpToken();
            return;
        }
        await trade.buyDownToken();
    };

    TradeClass.prototype.recordEntrySignal = function (side: Market.Up | Market.Down, context: Record<string, unknown> = {}): void {
        const signalPrice = side === Market.Up ? this.upBuyPrice : this.downBuyPrice;
        if (!Number.isFinite(signalPrice) || signalPrice <= 0) {
            return;
        }

        this.pendingEntrySignal = {
            side,
            signalPrice,
            signalTimestamp: new Date().toISOString(),
            marketSlug: this.marketSlug,
            ...context,
        };
    };
    TradeClass.prototype.setPendingExitIntent = function (reason: string, errorContext: string | null = null): void {
        this.pendingExitReason = reason;
        this.pendingExitErrorContext = errorContext;
    };

    TradeClass.prototype.emitShadowPnlTelemetry = async function (settlement: ShadowSettlement): Promise<void> {
        if (!Array.isArray(this.shadowSignals) || !this.shadowSignals.length) {
            return;
        }

        const finalUpExitPrice = shadowExitPriceForSide(settlement, Market.Up);
        const finalDownExitPrice = shadowExitPriceForSide(settlement, Market.Down);

        for (const signal of this.shadowSignals) {
            const finalExitPrice = signal.preferredSide === Market.Up ? finalUpExitPrice : finalDownExitPrice;
            const rawHypotheticalPnlUsd = calculateShadowPnlUsd(signal.preferredEntryPrice, finalExitPrice);
            const hypotheticalPnlUsd = rawHypotheticalPnlUsd === null
                ? null
                : roundMetric(rawHypotheticalPnlUsd);

            await writeTelemetryEventSafe("trade.shadow_pnl", {
                strategy: globalThis.__CONFIG__.strategy,
                signalId: signal.signalId,
                reason: signal.reason,
                rejectedAt: signal.rejectedAt,
                preferredSide: signal.preferredSide,
                preferredEntryPrice: signal.preferredEntryPrice,
                finalExitPrice,
                hypotheticalPnlUsd,
                upBuyPriceAtRejection: signal.upBuyPrice,
                upSellPriceAtRejection: signal.upSellPrice,
                downBuyPriceAtRejection: signal.downBuyPrice,
                downSellPriceAtRejection: signal.downSellPrice,
                finalUpSellPrice: finalUpExitPrice,
                finalDownSellPrice: finalDownExitPrice,
                settlementStatus: settlement.status,
                settlementSource: settlement.source,
                settlementReason: settlement.reason,
                settlementDetail: settlement.status === "unresolved" ? settlement.detail ?? null : null,
                winningOutcome: settlement.winner,
                feedAgeMsAtRejection: signal.feedAgeMs,
                feedLatencyMsAtRejection: signal.feedLatencyMs,
                feedRttMsAtRejection: signal.feedRttMs,
            });
        }

        this.shadowSignals = [];
    };

    TradeClass.prototype.make_trading_decision = async function (): Promise<void> {
        await this.reconcileOpenExitOrders();
        if (this.pendingEntryReconciliation?.orderId) {
            const reconciled = await this.reconcilePendingEntryState();
            if (!reconciled && this.pendingEntryReconciliation?.orderId) {
                console.warn(`⛔ Entry reconciliation pending | orderId=${this.pendingEntryReconciliation.orderId} | providerStatus=${this.pendingEntryReconciliation.providerOrderStatus ?? "unknown"}`);
                await writeTelemetryEventSafe("trade.signal_rejected", {
                    strategy: globalThis.__CONFIG__.strategy,
                    reason: "entry_reconciliation_pending",
                    decisionSource: this.lastDecisionSnapshotSource,
                    remainingTime: this.remainingTime,
                    secondsToClose: this.remainingTime,
                    observedMarketTicks: this.observedMarketTicks,
                    holdingStatus: this.holdingStatus,
                    feedAgeMs: this.latestFeedAgeMs,
                    feedLatencyMs: this.latestFeedLatencyMs,
                    feedRttMs: this.latestFeedRttMs,
                    feedWsConnected: this.latestFeedWsConnected,
                    feedSnapshotSource: this.latestFeedSnapshotSource,
                    feedFallbackCount: this.latestFeedFallbackCount,
                    feedLastFallbackReason: this.latestFeedLastFallbackReason,
                    externalPriceUsd: this.latestExternalPriceUsd,
                    externalPriceSource: this.latestExternalPriceSource,
                    externalPriceFetchedAt: this.latestExternalPriceFetchedAt,
                    priceToBeat: this.priceToBeat,
                    finalPrice: this.finalPrice,
                    priceToBeatSource: this.priceToBeatSource,
                    upBuyPrice: this.upBuyPrice,
                    upSellPrice: this.upSellPrice,
                    downBuyPrice: this.downBuyPrice,
                    downSellPrice: this.downSellPrice,
                    orderId: this.pendingEntryReconciliation.orderId,
                    providerOrderStatus: this.pendingEntryReconciliation.providerOrderStatus ?? null,
                    blockedAt: this.pendingEntryReconciliation.blockedAt ?? null,
                    tokenId: this.pendingEntryReconciliation.tokenId ?? null,
                    positionState: this.positionState,
                    marketSlug: this.marketSlug,
                });
                return;
            }
        }

        let remaining_time_ratio =
            (this.marketTime - this.remainingTime) / this.marketTime;

        let up_price_ratio = Math.abs(this.upBuyPrice - 0.5) / 0.5;

        if (this.prevUpBuyPrice[0] || this.prevUpBuyPrice[1]) {
            Market.None;
        }

        if (GLOBAL_TX_PROCESS.current === TxProcess.Working) {
            console.log("Trading is already in progress");
            return;
        };

        const upSpread = normalizedSpread(this.upBuyPrice, this.upSellPrice);
        const downSpread = normalizedSpread(this.downBuyPrice, this.downSellPrice);
        const upSnapshotReason = snapshotInvalidReason(this.upBuyPrice, this.upSellPrice, upSpread);
        const downSnapshotReason = snapshotInvalidReason(this.downBuyPrice, this.downSellPrice, downSpread);

        if (upSnapshotReason || downSnapshotReason) {
            await writeTelemetryEventSafe("market.snapshot_rejected", {
                strategy: globalThis.__CONFIG__.strategy,
                reason: upSnapshotReason ?? downSnapshotReason,
                decisionSource: this.lastDecisionSnapshotSource,
                marketSlug: this.marketSlug,
                upBuyPrice: this.upBuyPrice,
                upSellPrice: this.upSellPrice,
                downBuyPrice: this.downBuyPrice,
                downSellPrice: this.downSellPrice,
                upSpread,
                downSpread,
                upSnapshotReason,
                downSnapshotReason,
                feedAgeMs: this.latestFeedAgeMs,
                feedLatencyMs: this.latestFeedLatencyMs,
                feedRttMs: this.latestFeedRttMs,
                feedSnapshotSource: this.latestFeedSnapshotSource,
                feedLastFallbackReason: this.latestFeedLastFallbackReason,
            });
            return;
        }

        switch (globalThis.__CONFIG__.strategy) {
            case "trade_1": {
                const trade1 = globalThis.__CONFIG__.trade_1!;
                const exitTime = remaining_time_ratio > trade1.exit_time_ratio;
                const exitPrice = up_price_ratio > trade1.exit_price_ratio;
                if (exitTime || exitPrice) {
                    switch (this.holdingStatus) {
                        case Market.Up:
                            this.setPendingExitIntent(exitTime ? "timeout" : "take_profit");
                            await this.sellUpToken();
                            break;
                        case Market.Down:
                            this.setPendingExitIntent(exitTime ? "timeout" : "take_profit");
                            await this.sellDownToken();
                            break;
                        default:
                            break;
                    }
                }
                break;
            }

            case "trade_2":
                const trade2 = globalThis.__CONFIG__.trade_2!;
                const exitRanges = trade2.exit_price_ratio_range;
                const inExitRange = exitRanges.some(([min, max]) => up_price_ratio >= min && up_price_ratio <= max);
                const [entry_price_ratio_min, entry_price_ratio_max] = trade2.entry_price_ratio;
                const entry_time_ratio = trade2.entry_time_ratio;
                const inEntryPriceRange = up_price_ratio >= entry_price_ratio_min && up_price_ratio <= entry_price_ratio_max;

                switch (this.holdingStatus) {
                    case Market.Up:
                        if (inExitRange) {
                            this.setPendingExitIntent(isTrade2EmergencyExit(this, trade2, up_price_ratio) ? "emergency_swap" : "timeout");
                            const sellSuccess = await this.sellUpToken();

                            if (sellSuccess) {
                                // Check if in emergency swap price range to immediately buy opposite token
                                const emergencySwapPrice = trade2.emergency_swap_price;
                                if (emergencySwapPrice) {
                                    const [emergencyMin, emergencyMax] = emergencySwapPrice;
                                    const inEmergencySwapRange = up_price_ratio >= emergencyMin && up_price_ratio <= emergencyMax;
                                    if (inEmergencySwapRange) {
                                        console.log("🔄 Emergency swap: buying down token after successful sell");
                                        await attemptEntry(this, Market.Down);
                                    }
                                }
                            } else {
                                console.warn("⚠️  Sell failed, skipping emergency swap buy");
                            }
                        }
                        break;
                    case Market.Down:
                        if (inExitRange) {
                            this.setPendingExitIntent(isTrade2EmergencyExit(this, trade2, up_price_ratio) ? "emergency_swap" : "timeout");
                            const sellSuccess = await this.sellDownToken();

                            // Only proceed with emergency buy if sell was successful
                            if (sellSuccess) {
                                // Check if in emergency swap price range to immediately buy opposite token
                                const emergencySwapPrice = trade2.emergency_swap_price;
                                if (emergencySwapPrice) {
                                    const [emergencyMin, emergencyMax] = emergencySwapPrice;
                                    const inEmergencySwapRange = up_price_ratio >= emergencyMin && up_price_ratio <= emergencyMax;
                                    if (inEmergencySwapRange) {
                                        console.log("🔄 Emergency swap: buying up token after successful sell");
                                        await attemptEntry(this, Market.Up);
                                    }
                                }
                            } else {
                                console.warn("⚠️  Sell failed, skipping emergency swap buy");
                            }
                        }
                        break;

                    default:
                        // Only buy if we haven't bought yet
                        // Check if price ratio is within entry range and time ratio is met
                        if (!this.hasBought && remaining_time_ratio > entry_time_ratio && inEntryPriceRange) {
                            if (this.upBuyPrice > this.downBuyPrice) {
                                await attemptEntry(this, Market.Up);
                            } else {
                                await attemptEntry(this, Market.Down);
                            }
                        }
                        break;
                }



                break;
            case "trade_3": {
                const trade3 = globalThis.__CONFIG__.trade_3!;
                const [entryRatioMin, entryRatioMax] = trade3.entry_price_ratio;
                const inEntryRatioRange = up_price_ratio >= entryRatioMin && up_price_ratio <= entryRatioMax;
                const elapsedTimeReached = remaining_time_ratio > trade3.entry_time_ratio;
                const secondsToClose = this.remainingTime;
                const inTimeWindow =
                    secondsToClose >= trade3.min_seconds_to_close &&
                    secondsToClose <= trade3.max_seconds_to_close;

                const maybeEmergencySwap = async () => {
                    const emergencySwapPrice = trade3.emergency_swap_price;
                    if (!emergencySwapPrice) {
                        return;
                    }

                    const [emergencyMin, emergencyMax] = emergencySwapPrice;
                    const currentHeldPrice = this.upBuyPrice > this.downBuyPrice ? this.upBuyPrice : this.downBuyPrice;
                    const inEmergencySwapRange =
                        currentHeldPrice >= emergencyMin && currentHeldPrice <= emergencyMax;

                    if (!inEmergencySwapRange) {
                        return;
                    }

                    if (this.upBuyPrice > this.downBuyPrice) {
                        console.log("🔄 Trade 3 emergency swap: buying UP after successful exit");
                        await attemptEntry(this, Market.Up);
                    } else {
                        console.log("🔄 Trade 3 emergency swap: buying DOWN after successful exit");
                        await attemptEntry(this, Market.Down);
                    }
                };

                switch (this.holdingStatus) {
                    case Market.Up: {
                        if (this.upSellPrice <= trade3.stop_loss_price) {
                            this.setPendingExitIntent(isTrade34EmergencyExit(this, trade3.emergency_swap_price) ? "emergency_swap" : "stop_loss");
                            const sellSuccess = await this.sellUpToken();
                            if (sellSuccess) {
                                await maybeEmergencySwap();
                            }
                            break;
                        }

                        if (this.upSellPrice >= trade3.take_profit_price && secondsToClose > trade3.min_seconds_to_close) {
                            this.setPendingExitIntent("take_profit");
                            await this.sellUpToken();
                            break;
                        }

                        if (secondsToClose <= trade3.min_seconds_to_close && this.upSellPrice < trade3.hold_to_end_price) {
                            this.setPendingExitIntent("timeout");
                            await this.sellUpToken();
                        }
                        break;
                    }
                    case Market.Down: {
                        if (this.downSellPrice <= trade3.stop_loss_price) {
                            this.setPendingExitIntent(isTrade34EmergencyExit(this, trade3.emergency_swap_price) ? "emergency_swap" : "stop_loss");
                            const sellSuccess = await this.sellDownToken();
                            if (sellSuccess) {
                                await maybeEmergencySwap();
                            }
                            break;
                        }

                        if (this.downSellPrice >= trade3.take_profit_price && secondsToClose > trade3.min_seconds_to_close) {
                            this.setPendingExitIntent("take_profit");
                            await this.sellDownToken();
                            break;
                        }

                        if (secondsToClose <= trade3.min_seconds_to_close && this.downSellPrice < trade3.hold_to_end_price) {
                            this.setPendingExitIntent("timeout");
                            await this.sellDownToken();
                        }
                        break;
                    }
                    default: {
                        if (this.hasBought) {
                            break;
                        }

                        if (!elapsedTimeReached || !inEntryRatioRange || !inTimeWindow) {
                            break;
                        }

                        const preferredSide = this.upBuyPrice >= this.downBuyPrice ? Market.Up : Market.Down;
                        const preferredPrice = preferredSide === Market.Up ? this.upBuyPrice : this.downBuyPrice;
                        const inEntryPriceWindow =
                            preferredPrice >= trade3.min_entry_price &&
                            preferredPrice <= trade3.max_entry_price;

                        if (!inEntryPriceWindow) {
                            break;
                        }

                        if (preferredSide === Market.Up) {
                        await attemptEntry(this, Market.Up);
                    } else {
                        await attemptEntry(this, Market.Down);
                    }
                        break;
                    }
                }

                break;
            }
            case "trade_4":
            case "trade_5x":
            case "trade_5x_close31_paper":
            case "trade_5x_close31_down_paper":
            case "trade_5x_close31_down_paper_relaxed": {
            case "trade_5x_close31_down_paper_learning": {
                const trade4 = getTrade4LikeConfig(globalThis.__CONFIG__)!;
                const [entryRatioMin, entryRatioMax] = trade4.entry_price_ratio;
                const secondsToClose = this.remainingTime;
                const graceActive = Date.now() < this.marketTransitionGraceUntilMs;
                const timing = evaluateEntryTiming({
                    marketTimeSeconds: this.marketTime,
                    secondsToClose,
                    entryTimeRatio: trade4.entry_time_ratio,
                    minSecondsToClose: trade4.min_seconds_to_close,
                    maxSecondsToClose: trade4.max_seconds_to_close,
                    latestEntrySecondsBeforeClose: trade4.latest_entry_seconds_before_close,
                });
                const feedTooOld =
                    this.latestFeedAgeMs !== null &&
                    Number.isFinite(this.latestFeedAgeMs) &&
                    this.latestFeedAgeMs > trade4.max_feed_age_ms;
                const rttTooHigh =
                    this.latestFeedRttMs !== null &&
                    Number.isFinite(this.latestFeedRttMs) &&
                    this.latestFeedRttMs > trade4.max_rtt_ms;
                const upSpread = normalizedSpread(this.upBuyPrice, this.upSellPrice);
                const downSpread = normalizedSpread(this.downBuyPrice, this.downSellPrice);
                const feedHealth = getFeedHealth({
                    latencyMs: this.latestFeedLatencyMs,
                    rttMs: this.latestFeedRttMs,
                    ageMs: this.latestFeedAgeMs,
                    wsConnected: this.latestFeedWsConnected,
                    snapshotSource: this.lastDecisionSnapshotSource,
                    msSinceLastFallback: this.latestFeedMsSinceLastFallback,
                    tickTimestamps: Array.isArray(this.priceTickTimestamps) ? this.priceTickTimestamps : [],
                }, {
                    requireWebsocket: Boolean(trade4.require_websocket),
                    rejectOnMissingWebsocket: Boolean(trade4.reject_on_missing_websocket),
                    recentWsFallbackCooldownMs: Number(trade4.recent_ws_fallback_cooldown_ms ?? 2000),
                    maxEntryFeedLatencyMs: Number(trade4.max_entry_feed_latency_ms ?? 400),
                    maxEntryFeedRttMs: Number(trade4.max_entry_feed_rtt_ms ?? 400),
                    maxEntryFeedAgeMs: Number(trade4.max_entry_feed_age_ms ?? 500),
                });

                const maybeEmergencySwap = async () => {
                    const emergencySwapPrice = trade4.emergency_swap_price;
                    if (!emergencySwapPrice) {
                        return;
                    }

                    const [emergencyMin, emergencyMax] = emergencySwapPrice;
                    const preferredSide = this.upBuyPrice >= this.downBuyPrice ? Market.Up : Market.Down;
                    const preferredPrice = preferredSide === Market.Up ? this.upBuyPrice : this.downBuyPrice;
                    const inEmergencySwapRange =
                        preferredPrice >= emergencyMin && preferredPrice <= emergencyMax;

                    if (!inEmergencySwapRange) {
                        return;
                    }

                    if (preferredSide === Market.Up) {
                        console.log("🔄 Trade 4 emergency swap: buying UP after successful exit");
                        await attemptEntry(this, Market.Up);
                    } else {
                        console.log("🔄 Trade 4 emergency swap: buying DOWN after successful exit");
                        await attemptEntry(this, Market.Down);
                    }
                };

                switch (this.holdingStatus) {
                    case Market.Up: {
                        const stopLossTriggerPrice = getDynamicStopPrice(this);
                        if (secondsToClose <= trade4.forced_exit_seconds_before_close) {
                            this.setPendingExitIntent("forced_exit");
                            await this.sellUpToken();
                            break;
                        }

                        const upStopLossSpreadValid = upSpread !== null && upSpread >= 0 && upSpread <= MAX_STOP_LOSS_SPREAD;
                        if (upStopLossSpreadValid && stopLossTriggerPrice !== null && this.upSellPrice <= stopLossTriggerPrice) {
                            await emitStopLossEval(this, Market.Up, stopLossTriggerPrice, upSpread);
                            const cancelled = await maybeDelayStopLossExit(this, Market.Up, stopLossTriggerPrice, upSpread);
                            if (cancelled) {
                                break;
                            }
                            this.setPendingExitIntent(isTrade34EmergencyExit(this, trade4.emergency_swap_price) ? "emergency_swap" : "stop_loss");
                            const sellSuccess = await this.sellUpToken();
                            if (sellSuccess) {
                                await maybeEmergencySwap();
                            }
                            break;
                        }

                        if (this.upSellPrice >= trade4.take_profit_price && secondsToClose > trade4.min_seconds_to_close) {
                            this.setPendingExitIntent("take_profit");
                            await this.sellUpToken();
                            break;
                        }

                        if (
                            typeof trade4.hold_to_end_price === "number" &&
                            secondsToClose <= trade4.min_seconds_to_close &&
                            this.upSellPrice < trade4.hold_to_end_price
                        ) {
                            this.setPendingExitIntent("timeout");
                            await this.sellUpToken();
                        }
                        break;
                    }
                    case Market.Down: {
                        const stopLossTriggerPrice = getDynamicStopPrice(this);
                        if (secondsToClose <= trade4.forced_exit_seconds_before_close) {
                            this.setPendingExitIntent("forced_exit");
                            await this.sellDownToken();
                            break;
                        }

                        const downStopLossSpreadValid = downSpread !== null && downSpread >= 0 && downSpread <= MAX_STOP_LOSS_SPREAD;
                        if (downStopLossSpreadValid && stopLossTriggerPrice !== null && this.downSellPrice <= stopLossTriggerPrice) {
                            await emitStopLossEval(this, Market.Down, stopLossTriggerPrice, downSpread);
                            const cancelled = await maybeDelayStopLossExit(this, Market.Down, stopLossTriggerPrice, downSpread);
                            if (cancelled) {
                                break;
                            }
                            this.setPendingExitIntent(isTrade34EmergencyExit(this, trade4.emergency_swap_price) ? "emergency_swap" : "stop_loss");
                            const sellSuccess = await this.sellDownToken();
                            if (sellSuccess) {
                                await maybeEmergencySwap();
                            }
                            break;
                        }

                        if (this.downSellPrice >= trade4.take_profit_price && secondsToClose > trade4.min_seconds_to_close) {
                            this.setPendingExitIntent("take_profit");
                            await this.sellDownToken();
                            break;
                        }

                        if (
                            typeof trade4.hold_to_end_price === "number" &&
                            secondsToClose <= trade4.min_seconds_to_close &&
                            this.downSellPrice < trade4.hold_to_end_price
                        ) {
                            this.setPendingExitIntent("timeout");
                            await this.sellDownToken();
                        }
                        break;
                    }
                    default: {
                        if (this.hasBought) {
                            break;
                        }

                        if (graceActive) {
                            await emitSignalRejected(this, "market_transition_grace", {
                                graceRemainingMs: Math.max(0, this.marketTransitionGraceUntilMs - Date.now()),
                            });
                            break;
                        }

                        if (!feedHealth.healthy && feedHealth.rejectReason !== null) {
                            await emitSignalRejected(this, feedHealth.rejectReason, {
                                feedHealth,
                                feedLatencyMs: feedHealth.latencyMs,
                                feedRttMs: feedHealth.rttMs,
                                feedAgeMs: feedHealth.ageMs,
                                feedTicksLast10s: feedHealth.ticksLast10s,
                                feedFallbackActive: feedHealth.fallbackActive,
                                feedLastFallbackAgoMs: feedHealth.lastFallbackAgo,
                                feedHealthy: feedHealth.healthy,
                                maxEntryFeedLatencyMs: trade4.max_entry_feed_latency_ms,
                                maxEntryFeedRttMs: trade4.max_entry_feed_rtt_ms,
                                maxEntryFeedAgeMs: trade4.max_entry_feed_age_ms,
                                recentWsFallbackCooldownMs: trade4.recent_ws_fallback_cooldown_ms,
                            });
                            break;
                        }

                        if (feedTooOld) {
                            await emitSignalRejected(this, "max_feed_age_ms", {
                                feedAgeMs: this.latestFeedAgeMs,
                                maxFeedAgeMs: trade4.max_feed_age_ms,
                                decisionSnapshotSource: this.lastDecisionSnapshotSource,
                            });
                            break;
                        }

                        if (rttTooHigh) {
                            await emitSignalRejected(this, "latency_too_high", {
                                feedRttMs: this.latestFeedRttMs,
                                maxRttMs: trade4.max_rtt_ms,
                                decisionSnapshotSource: this.lastDecisionSnapshotSource,
                            });
                            break;
                        }

                        if (!timing.elapsedTimeReached) {
                            await emitSignalRejected(this, "entry_time_ratio", {
                                currentTimeRatio: roundMetric(timing.elapsedRatio),
                                requiredTimeRatio: trade4.entry_time_ratio,
                            });
                            break;
                        }

                        const {
                            preferredSide,
                            preferredPrice,
                            preferredSpread,
                        } = selectPreferredEntrySide(
                            this.upBuyPrice,
                            this.downBuyPrice,
                            upSpread,
                            downSpread,
                            trade4.max_allowed_spread,
                        );
                        const intendedSide = preferredSide === Market.Up ? "UP" : "DOWN";
                        const preferredEntryRatio = getEntryPriceRatioForSide(preferredSide, this.upBuyPrice, this.downBuyPrice);
                        const inEntryRatioRange =
                            preferredEntryRatio !== null &&
                            preferredEntryRatio >= entryRatioMin &&
                            preferredEntryRatio <= entryRatioMax;
                        const enforceEntryRatio = ![
                            "trade_5x",
                            "trade_5x_close31_paper",
                            "trade_5x_close31_down_paper",
                            "trade_5x_close31_down_paper_relaxed",
                            "trade_5x_close31_down_paper_learning",
                        ].includes(globalThis.__CONFIG__.strategy);
                        const rejectionDiagnosticContext = buildRejectionDiagnosticContext({
                            trade: this,
                            currentTimeRatio: timing.elapsedRatio,
                            entryPriceRatio: preferredEntryRatio,
                            entryPriceRatioMin: entryRatioMin,
                            entryPriceRatioMax: entryRatioMax,
                            preferredSpread,
                        });

                        if (enforceEntryRatio && !inEntryRatioRange) {
                            await emitSignalRejected(this, "entry_price_ratio", {
                                intendedSide,
                                selectedSide: intendedSide,
                                currentEntryRatio: preferredEntryRatio === null ? null : roundMetric(preferredEntryRatio),
                                requiredEntryRatioMin: trade4.entry_price_ratio[0],
                                requiredEntryRatioMax: trade4.entry_price_ratio[1],
                                entryPriceChecked: preferredPrice,
                            });
                            break;
                        }

                        if (timing.pastLatestEntryCutoff) {
                            await emitSignalRejected(this, "latest_entry_seconds_before_close", {
                                secondsToClose,
                                latestEntrySecondsBeforeClose: trade4.latest_entry_seconds_before_close,
                            });
                            break;
                        }

                        if (!timing.withinSecondsToCloseWindow) {
                            await emitSignalRejected(this, "seconds_to_close_window", {
                                secondsToClose,
                                minSecondsToClose: trade4.min_seconds_to_close,
                                maxSecondsToClose: trade4.max_seconds_to_close,
                            });
                            break;
                        }

                        if (this.observedMarketTicks < trade4.min_observed_markets_before_trade) {
                            await emitSignalRejected(this, "min_observed_markets_before_trade", {
                                observedMarketTicks: this.observedMarketTicks,
                                requiredObservedTicks: trade4.min_observed_markets_before_trade,
                            });
                            break;
                        }
                        const spreadTooWide = preferredSpread === null || preferredSpread >= trade4.max_allowed_spread;

                        if (spreadTooWide) {
                            await emitSignalRejected(this, "spread_too_wide", {
                                intendedSide,
                                selectedSide: intendedSide,
                                preferredSide,
                                preferredSpread,
                                spreadChecked: preferredSpread,
                                upSpread,
                                downSpread,
                                maxAllowedSpread: trade4.max_allowed_spread,
                            });
                            break;
                        }

                        const activeMinEntryPrice =
                            preferredSide === Market.Up
                                ? trade4.up_min_entry_price ?? trade4.min_entry_price
                                : trade4.down_min_entry_price ?? trade4.min_entry_price;
                        const activeMaxEntryPrice =
                            preferredSide === Market.Up
                                ? trade4.up_max_entry_price ?? trade4.max_entry_price
                                : trade4.down_max_entry_price ?? trade4.max_entry_price;
                        const inEntryPriceWindow =
                            preferredPrice >= activeMinEntryPrice &&
                            preferredPrice <= activeMaxEntryPrice;

                        if (!inEntryPriceWindow) {
                            const entryPriceWindowStatus =
                                preferredPrice < activeMinEntryPrice
                                    ? "below_min_entry_price"
                                    : "above_max_entry_price";
                            await emitSignalRejected(this, "entry_price_window", {
                                intendedSide,
                                selectedSide: intendedSide,
                                preferredSide,
                                preferredPrice,
                                entryPriceChecked: preferredPrice,
                                entryPriceWindowStatus,
                                minEntryPrice: activeMinEntryPrice,
                                maxEntryPrice: activeMaxEntryPrice,
                                sharedMinEntryPrice: trade4.min_entry_price,
                                sharedMaxEntryPrice: trade4.max_entry_price,
                                ...rejectionDiagnosticContext,
                            });
                            break;
                        }

                        if (PAPER_TRADING && intendedSide === "UP" && Boolean(trade4.paper_disable_up_entries)) {
                            await emitSignalRejected(this, "paper_up_entries_disabled", {
                                preferredSide,
                                preferredPrice,
                                intendedSide,
                                paperDisableUpEntries: true,
                            });
                            break;
                        }

                        if (trade4.require_fee_adjusted_edge) {
                            const expectedEdgeUsd = feeAdjustedEdgeUsd(preferredPrice, trade4.take_profit_price);
                            if (expectedEdgeUsd < trade4.min_fee_adjusted_edge) {
                                console.log(
                                    `⏭️  Trade 4 skipped | feeAdjustedEdge=$${expectedEdgeUsd.toFixed(4)} < minEdge=$${trade4.min_fee_adjusted_edge.toFixed(4)}`
                                );
                                await emitSignalRejected(this, "min_fee_adjusted_edge", {
                                    preferredSide,
                                    preferredPrice,
                                    expectedFeeAdjustedEdge: roundMetric(expectedEdgeUsd),
                                    minFeeAdjustedEdge: trade4.min_fee_adjusted_edge,
                                    takeProfitPrice: trade4.take_profit_price,
                                });
                                break;
                            }
                        }

                        const momentum = await getMomentumSignal();
                        const requireDirectionalMomentum =
                            intendedSide === "UP"
                                ? Boolean(trade4.up_require_directional_momentum)
                                : Boolean(trade4.down_require_directional_momentum);

                        if (requireDirectionalMomentum && momentum.direction !== intendedSide) {
                            await emitSignalRejected(this, "directional_momentum_required", {
                                preferredSide,
                                preferredPrice,
                                intendedSide,
                                requiredMomentumDirection: intendedSide,
                                observedMomentumDirection: momentum.direction,
                                momentumDirection: momentum.direction,
                                momentumScore: momentum.score,
                                momentumConfidence: momentum.confidence,
                                momentumDelta1m: momentum.delta1m,
                                momentumDelta5m: momentum.delta5m,
                                momentumVolRatio: momentum.volRatio,
                                momentumFetchedAt: new Date(momentum.fetchedAt).toISOString(),
                                momentumLatencyMs: momentum.latencyMs,
                            });
                            break;
                        }

                        if (momentum.direction !== "NEUTRAL" && momentum.direction !== intendedSide) {
                            await emitSignalRejected(this, "momentum_mismatch", {
                                preferredSide,
                                preferredPrice,
                                intendedSide,
                                momentumDirection: momentum.direction,
                                momentumScore: momentum.score,
                                momentumConfidence: momentum.confidence,
                                momentumDelta1m: momentum.delta1m,
                                momentumDelta5m: momentum.delta5m,
                                momentumVolRatio: momentum.volRatio,
                                momentumFetchedAt: new Date(momentum.fetchedAt).toISOString(),
                                momentumLatencyMs: momentum.latencyMs,
                            });
                            break;
                        }

                        const upRequiresBtcMomentum = Boolean(trade4.up_requires_btc_momentum);
                        if (intendedSide === "UP" && upRequiresBtcMomentum) {
                            const minBtcDelta1m = Number(trade4.up_min_btc_delta1m ?? 0.001);
                            const minMomentumConfidence = Number(trade4.up_min_momentum_confidence ?? 0.6);
                            const btcRising = momentum.delta1m > minBtcDelta1m;
                            const confidentEnough = momentum.confidence >= minMomentumConfidence;
                            if (!btcRising || !confidentEnough) {
                                await emitSignalRejected(this, "up_bias_filter", {
                                    preferredSide,
                                    preferredPrice,
                                    preferredSpread,
                                    intendedSide,
                                    upRequiresBtcMomentum,
                                    requiredDelta1m: minBtcDelta1m,
                                    observedDelta1m: momentum.delta1m,
                                    btcDelta1m: momentum.delta1m,
                                    upMinBtcDelta1m: minBtcDelta1m,
                                    requiredMomentumConfidence: minMomentumConfidence,
                                    observedMomentumConfidence: momentum.confidence,
                                    momentumConfidence: momentum.confidence,
                                    upMinMomentumConfidence: minMomentumConfidence,
                                    btcRising,
                                    confidentEnough,
                                    momentumDirection: momentum.direction,
                                    momentumScore: momentum.score,
                                    momentumDelta1m: momentum.delta1m,
                                    momentumDelta5m: momentum.delta5m,
                                    momentumVolRatio: momentum.volRatio,
                                    momentumFetchedAt: new Date(momentum.fetchedAt).toISOString(),
                                    momentumLatencyMs: momentum.latencyMs,
                                    ...rejectionDiagnosticContext,
                                });
                                break;
                            }
                        }

                        const mc = runMonteCarlo(
                            preferredPrice,
                            secondsToClose,
                            Array.isArray(this.priceTicks) ? this.priceTicks : [],
                        );
                        await writeTelemetryEventSafe("signal.montecarlo", {
                            marketSlug: this.marketSlug,
                            side: preferredSide === Market.Up ? "UP" : "DOWN",
                            currentPrice: mc.currentPrice,
                            convergence: mc.convergence,
                            simulatedDirection: mc.simulatedDirection,
                            bullPaths: mc.bullPaths,
                            bearPaths: mc.bearPaths,
                            meanExitPrice: mc.meanExitPrice,
                            volatility: mc.volatility,
                            N: mc.N,
                            computeMs: mc.computeMs,
                            timeRemainingSeconds: secondsToClose,
                            observedTicks: Array.isArray(this.priceTicks) ? this.priceTicks.length : 0,
                        });

                        const minMcConvergence =
                            intendedSide === "UP"
                                ? Number(trade4.up_min_mc_convergence ?? 0.7)
                                : Number(trade4.down_min_mc_convergence ?? 0.62);
                        const requireMcDirectionAgreement =
                            intendedSide === "UP"
                                ? Boolean(trade4.up_require_mc_direction_agreement)
                                : Boolean(trade4.down_require_mc_direction_agreement);

                        if (mc.convergence < minMcConvergence) {
                            await emitSignalRejected(this, "low_convergence", {
                                preferredSide,
                                preferredPrice,
                                intendedSide,
                                mcConvergence: mc.convergence,
                                minMcConvergence,
                                upMinMcConvergence: trade4.up_min_mc_convergence ?? 0.7,
                                downMinMcConvergence: trade4.down_min_mc_convergence ?? 0.62,
                                mcSimulatedDirection: mc.simulatedDirection,
                                mcBullPaths: mc.bullPaths,
                                mcBearPaths: mc.bearPaths,
                                mcMeanExitPrice: mc.meanExitPrice,
                                mcVolatility: mc.volatility,
                                mcN: mc.N,
                                mcComputeMs: mc.computeMs,
                            });
                            break;
                        }

                        if (requireMcDirectionAgreement && mc.simulatedDirection !== intendedSide) {
                            await emitSignalRejected(this, "mc_direction_mismatch", {
                                preferredSide,
                                preferredPrice,
                                intendedSide,
                                requireMcDirectionAgreement,
                                mcConvergence: mc.convergence,
                                mcSimulatedDirection: mc.simulatedDirection,
                                mcBullPaths: mc.bullPaths,
                                mcBearPaths: mc.bearPaths,
                                mcMeanExitPrice: mc.meanExitPrice,
                                mcVolatility: mc.volatility,
                                mcN: mc.N,
                                mcComputeMs: mc.computeMs,
                            });
                            break;
                        }

                        const btcTrendSnapshot = computeBtcTrendSnapshot(this);
                        const downBlockNeutralMomentum = Boolean(trade4.down_block_neutral_momentum);
                        if (intendedSide === "DOWN" && downBlockNeutralMomentum && momentum.direction === "NEUTRAL") {
                            await emitSignalRejected(this, "down_blocked_neutral_momentum", {
                                intendedSide,
                                momentumDirection: momentum.direction,
                                momentumScore: momentum.score,
                                momentumConfidence: momentum.confidence,
                                mcDirection: mc.simulatedDirection,
                                mcConvergence: mc.convergence,
                                btcTrendDirection: btcTrendSnapshot.btcTrendDirection,
                                btcDelta30s: btcTrendSnapshot.btcDelta30s,
                                entryPrice: preferredPrice,
                                secondsToClose,
                            });
                            break;
                        }

                        const downBlockIfBtcTrendUp = Boolean(trade4.down_block_if_btc_trend_up);
                        if (intendedSide === "DOWN" && downBlockIfBtcTrendUp) {
                            if (btcTrendSnapshot.btcTrendDirection === "UP") {
                                await emitSignalRejected(this, "down_blocked_btc_trend_up", {
                                    intendedSide,
                                    btcTrendDirection: btcTrendSnapshot.btcTrendDirection,
                                    btcDelta30s: btcTrendSnapshot.btcDelta30s,
                                    btcDelta15s: btcTrendSnapshot.btcDelta15s,
                                    btcDelta5s: btcTrendSnapshot.btcDelta5s,
                                    mcDirection: mc.simulatedDirection,
                                    mcConvergence: mc.convergence,
                                    momentumDirection: momentum.direction,
                                    momentumConfidence: momentum.confidence,
                                });
                                break;
                            }
                        }

                        const acceptedSignal = estimateAcceptedSignal(
                            this,
                            preferredSide,
                            preferredPrice,
                            trade4.take_profit_price,
                        );
                        await emitSignalAccepted(this, {
                            ...acceptedSignal,
                            momentumDirection: momentum.direction,
                            momentumScore: momentum.score,
                            momentumConfidence: momentum.confidence,
                            momentumDelta1m: momentum.delta1m,
                            momentumDelta5m: momentum.delta5m,
                            momentumVolRatio: momentum.volRatio,
                            momentumFetchedAt: new Date(momentum.fetchedAt).toISOString(),
                            momentumLatencyMs: momentum.latencyMs,
                            mcConvergence: mc.convergence,
                            mcSimulatedDirection: mc.simulatedDirection,
                            mcBullPaths: mc.bullPaths,
                            mcBearPaths: mc.bearPaths,
                            mcMeanExitPrice: mc.meanExitPrice,
                            mcVolatility: mc.volatility,
                            mcN: mc.N,
                            mcComputeMs: mc.computeMs,
                        });

                        if (preferredSide === Market.Up) {
                            await attemptEntry(this, Market.Up, {
                                momentumDirection: momentum.direction,
                                momentumScore: momentum.score,
                                momentumConfidence: momentum.confidence,
                                mcConvergence: mc.convergence,
                                mcSimulatedDirection: mc.simulatedDirection,
                                mcBullPaths: mc.bullPaths,
                                mcBearPaths: mc.bearPaths,
                            });
                        } else {
                            await attemptEntry(this, Market.Down, {
                                momentumDirection: momentum.direction,
                                momentumScore: momentum.score,
                                momentumConfidence: momentum.confidence,
                                mcConvergence: mc.convergence,
                                mcSimulatedDirection: mc.simulatedDirection,
                                mcBullPaths: mc.bullPaths,
                                mcBearPaths: mc.bearPaths,
                            });
                        }
                        break;
                    }
                }

                break;
            }
            default:
                break;
        }


    };
}
