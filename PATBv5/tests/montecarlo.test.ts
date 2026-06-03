import assert from "node:assert/strict";

import {
    __resetMonteCarloModuleState,
    __setMonteCarloRandomSource,
    estimateVolatility,
    runMonteCarlo,
} from "../src/signals/montecarlo";

async function run(): Promise<void> {
    const defaultVolatility = estimateVolatility([0.6, 0.61, 0.62]);
    assert.equal(defaultVolatility, 0.008);

    const measuredVolatility = estimateVolatility([0.50, 0.52, 0.48, 0.55, 0.53, 0.57, 0.51, 0.58, 0.54, 0.6, 0.56]);
    assert.ok(measuredVolatility > 0);
    assert.notEqual(measuredVolatility, 0.008);

    const randomValues = [0.9, 0.25, 0.9, 0.25, 0.9, 0.25, 0.9, 0.25];
    let index = 0;
    __setMonteCarloRandomSource(() => {
        const value = randomValues[index % randomValues.length];
        index += 1;
        return value;
    });

    const upResult = runMonteCarlo(0.65, 60, [0.60, 0.61, 0.62, 0.63, 0.64, 0.65, 0.66, 0.67, 0.66, 0.68], 20);
    assert.equal(upResult.N, 20);
    assert.equal(upResult.simulatedDirection, "UP");
    assert.equal(upResult.bullPaths + upResult.bearPaths, 20);
    assert.ok(upResult.meanExitPrice >= 0.5);

    index = 0;
    __setMonteCarloRandomSource(() => {
        const value = randomValues[index % randomValues.length];
        index += 1;
        return value;
    });
    const downResult = runMonteCarlo(0.35, 60, [0.40, 0.39, 0.38, 0.37, 0.36, 0.35, 0.34, 0.33, 0.32, 0.31], 20);
    assert.equal(downResult.simulatedDirection, "DOWN");
    assert.ok(downResult.meanExitPrice <= 0.5);

    __resetMonteCarloModuleState();
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
