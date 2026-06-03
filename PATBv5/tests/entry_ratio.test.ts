import assert from "node:assert/strict";

import { getEntryPriceRatioForSide, selectPreferredEntrySide } from "../src/trade/decision";
import { Market } from "../src/types";

async function run(): Promise<void> {
    const assertApprox = (actual: number | null, expected: number): void => {
        assert.ok(actual !== null);
        assert.ok(Math.abs(actual - expected) < 0.0000001, `expected ${expected}, received ${actual}`);
    };

    assertApprox(getEntryPriceRatioForSide(Market.Up, 0.55, 0.45), 0.1);
    assertApprox(getEntryPriceRatioForSide(Market.Down, 0.32, 0.68), 0.36);

    const upRatio = getEntryPriceRatioForSide(Market.Up, 0.17, 0.84);
    const downRatio = getEntryPriceRatioForSide(Market.Down, 0.17, 0.84);

    assertApprox(upRatio, 0.66);
    assertApprox(downRatio, 0.68);
    assert.notEqual(upRatio, downRatio);

    const prefersTradableTighterSpread = selectPreferredEntrySide(0.69, 0.99, 0.01, 0.98, 0.05);
    assert.equal(prefersTradableTighterSpread.preferredSide, Market.Up);
    assert.equal(prefersTradableTighterSpread.preferredPrice, 0.69);
    assert.equal(prefersTradableTighterSpread.preferredSpread, 0.01);

    const bothSidesTooWideFallsBackToBestPrice = selectPreferredEntrySide(0.99, 0.99, 0.98, 0.98, 0.05);
    assert.equal(bothSidesTooWideFallsBackToBestPrice.preferredSide, Market.Up);
    assert.equal(bothSidesTooWideFallsBackToBestPrice.preferredSpread, 0.98);
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
