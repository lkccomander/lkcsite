//this is index.ts
import { ClobClient } from "@polymarket/clob-client-v2";
import type { MomentumSignal } from "../signals/momentum";
import { Market, type MarketRuntimeConfig } from "../types";

interface ShadowSignalRecord {
    signalId: string;
    reason: string;
    rejectedAt: string;
    preferredSide: Market;
    preferredEntryPrice: number | null;
    upBuyPrice: number;
    upSellPrice: number;
    downBuyPrice: number;
    downSellPrice: number;
    feedAgeMs: number | null;
    feedLatencyMs: number | null;
    feedRttMs: number | null;
}

interface EntrySignalRecord {
    side: Market.Up | Market.Down;
    signalPrice: number;
    signalTimestamp: string;
    marketSlug: string;
    momentumDirection?: MomentumSignal["direction"];
    momentumScore?: number;
    momentumConfidence?: number;
    mcConvergence?: number;
    mcSimulatedDirection?: "UP" | "DOWN";
    mcBullPaths?: number;
    mcBearPaths?: number;
}

interface ExternalPricePoint {
    priceUsd: number;
    fetchedAt: string;
}

interface ExecutedEntryRecord {
    side: Market.Up | Market.Down;
    executedAt: string;
    marketSlug: string;
    entryPrice: number;
    shares: number;
    costBasisUsd: number;
    feeUsd: number;
    rebateUsd: number;
    makerMode: boolean;
}

interface PendingEntryReconciliationRecord {
    blockedAt: string;
    side: "UP" | "DOWN";
    marketSlug: string;
    tokenId: string;
    orderId: string;
    requestedUsd: number | null;
    entryPrice: number | null;
    decisionTimestamp: string | null;
    providerOrderStatus: string | null;
    providerFilledSize: number | null;
    providerRemainingSize: number | null;
    providerAvgPrice: number | null;
    lastCheckedAt: string | null;
    source?: string;
}

export interface PendingExitReconciliationRecord {
    blockedAt: string;
    side: "UP" | "DOWN";
    marketSlug: string;
    tokenId: string;
    requestedSize: number;
    limitPrice: number;
    submittedAt: string;
    knownOrderId: string | null;
    exitReason: string;
    errorContext: string | null;
    submitError: string;
    providerOrderStatus: string | null;
    lastCheckedAt: string | null;
}

export type PositionState =
    | "NONE"
    | "OPEN"
    | "ENTRY_RECONCILING"
    | "EXIT_PENDING"
    | "EXIT_PARTIAL"
    | "CLOSED"
    | "ERROR";

export interface ExitOrderRecord {
    orderId: string;
    tokenId: string;
    marketSlug: string;
    side: Market.Up | Market.Down;
    price: number;
    requestedSize: number;
    filledSize: number;
    remainingSize: number;
    status: string;
    exitReason: string;
    errorContext: string | null;
    createdAt: string;
    lastCheckedAt: string | null;
    repriceAttempts: number;
}

export class Trade {
    usd!: number;
    share!: number;
    holdingStatus!: Market;
    upBuyPrice!: number;
    downBuyPrice!: number;
    upSellPrice!: number;
    downSellPrice!: number;

    prevUpBuyPrice!: [number, number];
    prevDownBuyPrice!: [number, number];

    prevUpTokenBalance!: number;
    prevDownTokenBalance!: number;

    hasBought!: boolean; // Track if we've already made a buy order
    quitMarket!: boolean;
    marketTime!: number;
    remainingTime!: number;
    lastStatusLogAt!: number;
    observedMarketTicks!: number;
    marketTransitionGraceUntilMs!: number;
    lastDecisionSnapshotSource!: string;
    latestFeedAgeMs!: number | null;
    latestFeedLatencyMs!: number | null;
    latestFeedRttMs!: number | null;
    latestFeedWsConnected!: boolean;
    latestFeedSnapshotSource!: string;
    latestFeedFallbackCount!: number;
    latestFeedLastFallbackReason!: string | null;
    latestFeedLastFallbackAt!: string | null;
    latestFeedMsSinceLastFallback!: number | null;
    latestFeedWasInFallbackRecently!: boolean;
    latestExternalPriceUsd!: number | null;
    latestExternalPriceSource!: string | null;
    latestExternalPriceFetchedAt!: string | null;
    externalPriceHistory!: ExternalPricePoint[];
    priceTicks!: number[];
    priceTickTimestamps!: number[];
    shadowSignals!: ShadowSignalRecord[];
    marketSlug!: string;
    pendingEntrySignal!: EntrySignalRecord | null;
    pendingEntryReconciliation!: PendingEntryReconciliationRecord | null;
    pendingExitReconciliation!: PendingExitReconciliationRecord | null;
    lastExecutedEntry!: ExecutedEntryRecord | null;
    pendingExitReason!: string | null;
    pendingExitErrorContext!: string | null;
    positionState!: PositionState;
    openExitOrders!: Record<string, ExitOrderRecord>;

    id!: string;
    amount!: number;
    status!: string;
    upTokenId: string;
    downTokenId: string;
    tickSize: MarketRuntimeConfig["tickSize"];
    negRisk: boolean;
    minOrderSize: number | null;
    priceToBeat: number | null;
    finalPrice: number | null;
    priceToBeatSource: string | null;

    authorizedClob: ClobClient | null

    constructor(
        usd: number,
        marketSlug: string,
        upTokenId: string,
        downTokenId: string,
        authorizedClob: ClobClient | null,
        runtimeConfig: MarketRuntimeConfig
    ) {
        this.usd = usd;
        this.marketSlug = marketSlug;
        this.upTokenId = upTokenId;
        this.downTokenId = downTokenId;
        this.tickSize = runtimeConfig.tickSize;
        this.negRisk = runtimeConfig.negRisk;
        this.minOrderSize = runtimeConfig.minOrderSize;
        this.priceToBeat = runtimeConfig.priceToBeat;
        this.finalPrice = runtimeConfig.finalPrice;
        this.priceToBeatSource = runtimeConfig.priceToBeatSource;

        this.share = 0;
        this.holdingStatus = Market.None;
        this.upBuyPrice = 0;
        this.downBuyPrice = 0;
        this.upSellPrice = 0;
        this.downSellPrice = 0;
        this.prevUpBuyPrice = [0, 0];
        this.prevDownBuyPrice = [0, 0];
        this.prevUpTokenBalance = 0;
        this.prevDownTokenBalance = 0;
        this.hasBought = false;
        this.quitMarket = false;
        this.marketTime = parseInt(globalThis.__CONFIG__.market.market_period) * 60;
        this.remainingTime = this.marketTime;
        this.lastStatusLogAt = 0;
        this.observedMarketTicks = 0;
        this.marketTransitionGraceUntilMs = 0;
        this.lastDecisionSnapshotSource = "unknown";
        this.latestFeedAgeMs = null;
        this.latestFeedLatencyMs = null;
        this.latestFeedRttMs = null;
        this.latestFeedWsConnected = false;
        this.latestFeedSnapshotSource = "unknown";
        this.latestFeedFallbackCount = 0;
        this.latestFeedLastFallbackReason = null;
        this.latestFeedLastFallbackAt = null;
        this.latestFeedMsSinceLastFallback = null;
        this.latestFeedWasInFallbackRecently = false;
        this.latestExternalPriceUsd = null;
        this.latestExternalPriceSource = null;
        this.latestExternalPriceFetchedAt = null;
        this.externalPriceHistory = [];
        this.priceTicks = [];
        this.priceTickTimestamps = [];
        this.shadowSignals = [];
        this.pendingEntrySignal = null;
        this.pendingEntryReconciliation = null;
        this.pendingExitReconciliation = null;
        this.lastExecutedEntry = null;
        this.pendingExitReason = null;
        this.pendingExitErrorContext = null;
        this.positionState = "NONE";
        this.openExitOrders = {};

        this.authorizedClob = authorizedClob;
    }
}

// Import modules that extend Trade prototype (after class definition)
import { attachDecisionMethods } from "./decision";
import { attachPricesMethods } from "./prices";
import { attachTradeMethods } from "./trade";

attachDecisionMethods(Trade);
attachPricesMethods(Trade);
attachTradeMethods(Trade);
