export interface MonteCarloResult {
    convergence: number;
    simulatedDirection: "UP" | "DOWN";
    bullPaths: number;
    bearPaths: number;
    meanExitPrice: number;
    currentPrice: number;
    volatility: number;
    N: number;
    computeMs: number;
}

const DEFAULT_VOLATILITY = 0.008;
const MIN_TICKS_FOR_VOLATILITY = 10;
const MAX_SIMULATION_COUNT = 2_000;
const MIN_SIMULATION_COUNT = 1;

type RandomSource = () => number;

let randomSource: RandomSource = Math.random;

function roundMetric(value: number, digits = 4): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function clampPrice(value: number): number {
    if (!Number.isFinite(value)) {
        return 0.5;
    }
    return Math.max(0.01, Math.min(0.99, value));
}

function average(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
    if (!values.length) {
        return 0;
    }
    const mean = average(values);
    const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
    return Math.sqrt(variance);
}

function randomNormal(): number {
    let u = 0;
    let v = 0;
    while (u === 0) {
        u = randomSource();
    }
    while (v === 0) {
        v = randomSource();
    }
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export function estimateVolatility(priceTicks: number[]): number {
    const finiteTicks = priceTicks.filter((tick) => Number.isFinite(tick) && tick > 0);
    if (finiteTicks.length < MIN_TICKS_FOR_VOLATILITY) {
        return DEFAULT_VOLATILITY;
    }

    const diffs: number[] = [];
    for (let index = 1; index < finiteTicks.length; index += 1) {
        diffs.push(Math.abs(finiteTicks[index] - finiteTicks[index - 1]));
    }

    if (!diffs.length) {
        return DEFAULT_VOLATILITY;
    }

    const volatility = standardDeviation(diffs);
    return Number.isFinite(volatility) && volatility > 0 ? volatility : DEFAULT_VOLATILITY;
}

export function runMonteCarlo(
    currentPrice: number,
    timeRemainingSeconds: number,
    priceTicks: number[],
    N = 1000,
): MonteCarloResult {
    const startedAt = Date.now();
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
        throw new Error(`runMonteCarlo() requires a valid currentPrice, received ${currentPrice}`);
    }
    if (!Number.isFinite(timeRemainingSeconds) || timeRemainingSeconds < 0) {
        throw new Error(`runMonteCarlo() requires valid timeRemainingSeconds, received ${timeRemainingSeconds}`);
    }

    const simulationCount = Math.max(MIN_SIMULATION_COUNT, Math.min(MAX_SIMULATION_COUNT, Math.floor(N)));
    const volatility = estimateVolatility(priceTicks);
    const steps = Math.max(1, Math.floor(timeRemainingSeconds / 5));

    let bullPaths = 0;
    let bearPaths = 0;
    let priceSum = 0;

    for (let iteration = 0; iteration < simulationCount; iteration += 1) {
        let price = clampPrice(currentPrice);
        for (let step = 0; step < steps; step += 1) {
            const shock = randomNormal() * volatility;
            price = clampPrice(price + shock);
        }

        priceSum += price;
        if (price > 0.5) {
            bullPaths += 1;
        } else {
            bearPaths += 1;
        }
    }

    const meanExitPrice = priceSum / simulationCount;
    const convergence = Math.max(bullPaths, bearPaths) / simulationCount;
    const simulatedDirection: "UP" | "DOWN" = bullPaths > bearPaths ? "UP" : "DOWN";

    return {
        convergence: roundMetric(convergence, 4),
        simulatedDirection,
        bullPaths,
        bearPaths,
        meanExitPrice: roundMetric(meanExitPrice, 4),
        currentPrice: roundMetric(currentPrice, 4),
        volatility: roundMetric(volatility, 6),
        N: simulationCount,
        computeMs: Math.max(0, Date.now() - startedAt),
    };
}

export function __setMonteCarloRandomSource(nextRandomSource: RandomSource): void {
    randomSource = nextRandomSource;
}

export function __resetMonteCarloModuleState(): void {
    randomSource = Math.random;
}
