export const CRYPTO_TAKER_FEE_RATE = 0.072;
export const MAKER_PRICE_STEP = 0.01;

function roundTo(value: number, decimalPlaces: number): number {
    const factor = 10 ** decimalPlaces;
    return Math.round(value * factor) / factor;
}

export function clampPrice(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0.01, Math.min(0.99, Math.round(value * 100) / 100));
}

export function takerFeeRate(price: number): number {
    if (!Number.isFinite(price) || price <= 0 || price >= 1) {
        return 0;
    }
    return CRYPTO_TAKER_FEE_RATE * (1 - price);
}

export function protocolFeeFactor(price: number): number {
    if (!Number.isFinite(price) || price <= 0 || price >= 1) {
        return 0;
    }
    return CRYPTO_TAKER_FEE_RATE * price * (1 - price);
}

export function takerFeeUsd(price: number, notionalUsd: number, decimalPlaces: number): number {
    if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) {
        return 0;
    }
    return roundTo(notionalUsd * takerFeeRate(price), decimalPlaces);
}

export function makerRebateUsd(notionalUsd: number, rebateBps: number, decimalPlaces: number): number {
    if (!Number.isFinite(notionalUsd) || notionalUsd <= 0 || !Number.isFinite(rebateBps) || rebateBps <= 0) {
        return 0;
    }
    return roundTo(notionalUsd * (rebateBps / 10000), decimalPlaces);
}

export function passiveMakerBuyPrice(askPrice: number, bidPrice: number): number {
    if (!Number.isFinite(askPrice) || askPrice <= 0) {
        return 0;
    }
    if (!Number.isFinite(bidPrice) || bidPrice <= 0 || bidPrice >= askPrice) {
        return clampPrice(askPrice);
    }
    const insidePrice = bidPrice + MAKER_PRICE_STEP;
    if (insidePrice >= askPrice) {
        return clampPrice((askPrice + bidPrice) / 2);
    }
    return clampPrice(insidePrice);
}

export function passiveMakerSellPrice(bidPrice: number, askPrice: number): number {
    if (!Number.isFinite(bidPrice) || bidPrice <= 0) {
        return 0;
    }
    if (!Number.isFinite(askPrice) || askPrice <= 0 || askPrice <= bidPrice) {
        return clampPrice(bidPrice);
    }
    const insidePrice = askPrice - MAKER_PRICE_STEP;
    if (insidePrice <= bidPrice) {
        return clampPrice((askPrice + bidPrice) / 2);
    }
    return clampPrice(insidePrice);
}

export function midMarketPrice(askPrice: number, bidPrice: number): number | null {
    if (!Number.isFinite(askPrice) || !Number.isFinite(bidPrice) || askPrice <= 0 || bidPrice <= 0) {
        return null;
    }
    return clampPrice((askPrice + bidPrice) / 2);
}

export function feeAdjustedEdgeUsd(entryPrice: number, exitPrice: number): number {
    if (!Number.isFinite(entryPrice) || !Number.isFinite(exitPrice) || entryPrice <= 0 || exitPrice <= 0) {
        return Number.NEGATIVE_INFINITY;
    }

    const entryNotionalUsd = 1;
    const entryFeeUsd = entryNotionalUsd * takerFeeRate(entryPrice);
    const sharesBought = entryNotionalUsd / entryPrice;
    const grossExitUsd = sharesBought * exitPrice;
    const exitFeeUsd = grossExitUsd * takerFeeRate(exitPrice);
    const netExitUsd = grossExitUsd - exitFeeUsd;
    return netExitUsd - (entryNotionalUsd + entryFeeUsd);
}
