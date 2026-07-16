import assert from "node:assert/strict";
import {
    clampPrice,
    feeAdjustedEdgeUsd,
    makerRebateUsd,
    midMarketPrice,
    passiveMakerBuyPrice,
    passiveMakerSellPrice,
    protocolFeeFactor,
    takerFeeRate,
    takerFeeUsd,
} from "../src/trade/policy/executionPricing";

function assertApprox(actual: number, expected: number, tolerance = 1e-12): void {
    assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, received ${actual}`);
}

async function run(): Promise<void> {
    assert.equal(takerFeeRate(Number.NaN), 0);
    assert.equal(takerFeeRate(0), 0);
    assert.equal(takerFeeRate(1), 0);
    assertApprox(takerFeeRate(0.01), 0.07128);
    assertApprox(takerFeeRate(0.5), 0.036);
    assertApprox(takerFeeRate(0.99), 0.00072);

    assert.equal(protocolFeeFactor(Number.POSITIVE_INFINITY), 0);
    assert.equal(protocolFeeFactor(0), 0);
    assert.equal(protocolFeeFactor(1), 0);
    assertApprox(protocolFeeFactor(0.01), 0.0007128);
    assertApprox(protocolFeeFactor(0.5), 0.018);
    assertApprox(protocolFeeFactor(0.99), 0.0007128);

    assert.equal(takerFeeUsd(0.5, 0, 5), 0);
    assert.equal(takerFeeUsd(0.5, Number.NaN, 5), 0);
    assert.equal(takerFeeUsd(0, 5, 5), 0);
    assert.equal(takerFeeUsd(0.5, 5, 5), 0.18);

    assert.equal(makerRebateUsd(0, 7, 5), 0);
    assert.equal(makerRebateUsd(1, 0, 5), 0);
    assert.equal(makerRebateUsd(1, Number.NaN, 5), 0);
    assert.equal(makerRebateUsd(1.23456, 7, 4), 0.0009);
    assert.equal(makerRebateUsd(1.23456, 7, 5), 0.00086);

    assert.equal(clampPrice(Number.NaN), 0);
    assert.equal(clampPrice(0), 0.01);
    assert.equal(clampPrice(0.555), 0.56);
    assert.equal(clampPrice(1.5), 0.99);

    assert.equal(passiveMakerBuyPrice(0, 0.59), 0);
    assert.equal(passiveMakerBuyPrice(0.62, 0), 0.62);
    assert.equal(passiveMakerBuyPrice(0.62, 0.63), 0.62);
    assert.equal(passiveMakerBuyPrice(0.62, 0.59), 0.6);
    assert.equal(passiveMakerBuyPrice(0.6, 0.59), 0.6);

    assert.equal(passiveMakerSellPrice(0, 0.62), 0);
    assert.equal(passiveMakerSellPrice(0.59, 0), 0.59);
    assert.equal(passiveMakerSellPrice(0.59, 0.58), 0.59);
    assert.equal(passiveMakerSellPrice(0.59, 0.62), 0.61);
    assert.equal(passiveMakerSellPrice(0.59, 0.6), 0.6);

    assert.equal(midMarketPrice(0, 0.58), null);
    assert.equal(midMarketPrice(0.62, Number.NaN), null);
    assert.equal(midMarketPrice(0.62, 0.58), 0.6);

    const expectedEdge = (0.8 / 0.5) * (1 - takerFeeRate(0.8)) - (1 + takerFeeRate(0.5));
    assertApprox(feeAdjustedEdgeUsd(0.5, 0.8), expectedEdge);
    assert.equal(feeAdjustedEdgeUsd(0, 0.8), Number.NEGATIVE_INFINITY);
    assert.equal(feeAdjustedEdgeUsd(0.5, Number.NaN), Number.NEGATIVE_INFINITY);
    assert.equal(feeAdjustedEdgeUsd(1, 1), 0);
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
