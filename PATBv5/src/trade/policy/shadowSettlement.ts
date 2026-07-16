export type ShadowSettlementWinner = "UP" | "DOWN";

export interface ResolvedShadowSettlement {
    status: "resolved";
    source: "gamma_market_outcome_prices";
    reason: "terminal_outcome_prices";
    winner: ShadowSettlementWinner;
    upPrice: number;
    downPrice: number;
}

export interface UnresolvedShadowSettlement {
    status: "unresolved";
    source: "gamma_market_outcome_prices";
    reason: string;
    winner: null;
    upPrice: number | null;
    downPrice: number | null;
    detail?: string;
}

export type ShadowSettlement = ResolvedShadowSettlement | UnresolvedShadowSettlement;

export interface PollOptions {
    attempts?: number;
    intervalMs?: number;
    sleepFn?: (ms: number) => Promise<void>;
}

function unresolved(
    reason: string,
    upPrice: number | null = null,
    downPrice: number | null = null,
    detail?: string,
): UnresolvedShadowSettlement {
    return {
        status: "unresolved",
        source: "gamma_market_outcome_prices",
        reason,
        winner: null,
        upPrice,
        downPrice,
        ...(detail ? { detail } : {}),
    };
}

function parseArray(value: unknown): unknown[] | null {
    if (Array.isArray(value)) {
        return value;
    }
    if (typeof value !== "string") {
        return null;
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export function resolveGammaBinarySettlement(market: unknown): ShadowSettlement {
    if (typeof market !== "object" || market === null) {
        return unresolved("invalid_market_payload");
    }

    const record = market as Record<string, unknown>;
    const resolutionStatus = String(record.umaResolutionStatus ?? "").toLowerCase();
    if (record.closed !== true && resolutionStatus !== "resolved") {
        return unresolved("market_not_resolved");
    }

    const outcomes = parseArray(record.outcomes);
    const prices = parseArray(record.outcomePrices);
    if (!outcomes || !prices || outcomes.length !== prices.length || outcomes.length < 2) {
        return unresolved("invalid_outcome_mapping");
    }

    const normalizedLabels = outcomes.map((value) => String(value).trim().toUpperCase());
    const upIndex = normalizedLabels.indexOf("UP");
    const downIndex = normalizedLabels.indexOf("DOWN");
    if (upIndex < 0 || downIndex < 0 || upIndex === downIndex) {
        return unresolved("invalid_outcome_mapping");
    }

    const upPrice = Number(prices[upIndex]);
    const downPrice = Number(prices[downIndex]);
    if (!Number.isFinite(upPrice) || !Number.isFinite(downPrice)) {
        return unresolved("invalid_outcome_prices");
    }

    const upWon = upPrice >= 0.95 && downPrice <= 0.05;
    const downWon = downPrice >= 0.95 && upPrice <= 0.05;
    if (upWon === downWon) {
        return unresolved("non_terminal_outcome_prices", upPrice, downPrice);
    }

    return {
        status: "resolved",
        source: "gamma_market_outcome_prices",
        reason: "terminal_outcome_prices",
        winner: upWon ? "UP" : "DOWN",
        upPrice,
        downPrice,
    };
}

export function shadowExitPriceForSide(settlement: ShadowSettlement, side: unknown): number | null {
    if (settlement.status !== "resolved") {
        return null;
    }
    const normalizedSide = String(side).toUpperCase();
    if (normalizedSide === "UP") {
        return settlement.winner === "UP" ? 1 : 0;
    }
    if (normalizedSide === "DOWN") {
        return settlement.winner === "DOWN" ? 1 : 0;
    }
    return null;
}

export function calculateShadowPnlUsd(entryPrice: number | null, exitPrice: number | null): number | null {
    if (
        entryPrice === null
        || exitPrice === null
        || !Number.isFinite(entryPrice)
        || !Number.isFinite(exitPrice)
        || entryPrice <= 0
        || exitPrice < 0
    ) {
        return null;
    }
    if (exitPrice === 0) {
        return -(1 + takerFeeRate(entryPrice));
    }
    return feeAdjustedEdgeUsd(entryPrice, exitPrice);
}

export async function pollForGammaSettlement(
    fetchMarket: () => Promise<unknown>,
    options: PollOptions = {},
): Promise<ShadowSettlement> {
    const attempts = Math.max(1, Math.floor(options.attempts ?? 10));
    const intervalMs = Math.max(0, options.intervalMs ?? 5000);
    const sleepFn = options.sleepFn ?? (async (ms: number) => {
        await new Promise((resolve) => setTimeout(resolve, ms));
    });
    let lastReason = "market_not_resolved";

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            const settlement = resolveGammaBinarySettlement(await fetchMarket());
            if (settlement.status === "resolved") {
                return settlement;
            }
            lastReason = settlement.reason;
        } catch (error) {
            lastReason = error instanceof Error ? error.message : String(error);
        }

        if (attempt + 1 < attempts) {
            await sleepFn(intervalMs);
        }
    }

    return unresolved("settlement_poll_timeout", null, null, lastReason);
}
import { feeAdjustedEdgeUsd, takerFeeRate } from "./executionPricing";
