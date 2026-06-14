import { writeTelemetryEventSafe } from "../../telemetry";

const BINANCE_BASE_URL = "https://api.binance.com/api/v3";
const BINANCE_SYMBOL = "BTCUSDT";
const CACHE_TTL_MS = 8_000;
const SCORE_THRESHOLD = 0.0015;
const VOLUME_CONFIRMATION_THRESHOLD = 1.1;
const CONFIDENCE_NORMALIZER = 0.005;

type FetchLike = typeof fetch;

type BinanceKline = [
    number,
    string,
    string,
    string,
    string,
    string,
    ...unknown[],
];

interface BinanceTickerPrice {
    symbol?: string;
    price?: string;
}

interface RawMomentumSnapshot {
    latestOneMinuteClose: number;
    fiveMinutesAgoClose: number;
    latestFiveMinuteClose: number;
    fifteenMinutesAgoClose: number;
    latestVolume: number;
    averagePriorVolume: number;
    delta1m: number;
    delta5m: number;
    volRatio: number;
}

export interface MomentumSignal {
    direction: "UP" | "DOWN" | "NEUTRAL";
    score: number;
    confidence: number;
    delta1m: number;
    delta5m: number;
    volRatio: number;
    fetchedAt: number;
    latencyMs: number;
}

interface MomentumCacheEntry {
    expiresAt: number;
    value: MomentumSignal;
}

let momentumFetch: FetchLike = fetch;
let momentumCache: MomentumCacheEntry | null = null;

function roundMetric(value: number, digits = 6): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function neutralSignal(latencyMs: number, fetchedAt: number): MomentumSignal {
    return {
        direction: "NEUTRAL",
        score: 0,
        confidence: 0,
        delta1m: 0,
        delta5m: 0,
        volRatio: 1,
        fetchedAt,
        latencyMs,
    };
}

async function fetchJson<T>(url: string): Promise<T> {
    const response = await momentumFetch(url);
    if (!response.ok) {
        throw new Error(`Momentum request failed: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
}

function extractClose(klines: BinanceKline[], fromEndIndex: number): number {
    const candle = klines[klines.length - 1 - fromEndIndex];
    const close = Number(candle?.[4]);
    if (!Number.isFinite(close) || close <= 0) {
        throw new Error(`Momentum candle close missing at index ${fromEndIndex}`);
    }
    return close;
}

function extractVolume(klines: BinanceKline[], fromEndIndex: number): number {
    const candle = klines[klines.length - 1 - fromEndIndex];
    const volume = Number(candle?.[5]);
    if (!Number.isFinite(volume) || volume < 0) {
        throw new Error(`Momentum candle volume missing at index ${fromEndIndex}`);
    }
    return volume;
}

function calculateVolumeRatio(oneMinuteKlines: BinanceKline[]): number {
    const latestVolume = extractVolume(oneMinuteKlines, 0);
    const priorVolumes = [1, 2, 3, 4].map((index) => extractVolume(oneMinuteKlines, index));
    const averagePriorVolume = priorVolumes.reduce((sum, value) => sum + value, 0) / priorVolumes.length;
    if (!Number.isFinite(averagePriorVolume) || averagePriorVolume <= 0) {
        return 1;
    }
    return latestVolume / averagePriorVolume;
}

function buildRawMomentumSnapshot(
    oneMinuteKlines: BinanceKline[],
    fiveMinuteKlines: BinanceKline[],
    currentPrice?: number | null,
): RawMomentumSnapshot {
    const latestOneMinuteClose = currentPrice && Number.isFinite(currentPrice) && currentPrice > 0
        ? currentPrice
        : extractClose(oneMinuteKlines, 0);
    const fiveMinutesAgoClose = extractClose(oneMinuteKlines, 4);
    const latestFiveMinuteClose = currentPrice && Number.isFinite(currentPrice) && currentPrice > 0
        ? currentPrice
        : extractClose(fiveMinuteKlines, 0);
    const fifteenMinutesAgoClose = extractClose(fiveMinuteKlines, 3);
    const latestVolume = extractVolume(oneMinuteKlines, 0);
    const priorVolumes = [1, 2, 3, 4].map((index) => extractVolume(oneMinuteKlines, index));
    const averagePriorVolume = priorVolumes.reduce((sum, value) => sum + value, 0) / priorVolumes.length;
    const volRatio = !Number.isFinite(averagePriorVolume) || averagePriorVolume <= 0
        ? 1
        : latestVolume / averagePriorVolume;
    const delta1m = (latestOneMinuteClose - fiveMinutesAgoClose) / fiveMinutesAgoClose;
    const delta5m = (latestFiveMinuteClose - fifteenMinutesAgoClose) / fifteenMinutesAgoClose;

    return {
        latestOneMinuteClose,
        fiveMinutesAgoClose,
        latestFiveMinuteClose,
        fifteenMinutesAgoClose,
        latestVolume,
        averagePriorVolume,
        delta1m,
        delta5m,
        volRatio,
    };
}

export function computeMomentumSignal(
    oneMinuteKlines: BinanceKline[],
    fiveMinuteKlines: BinanceKline[],
    currentPrice?: number | null,
): Omit<MomentumSignal, "latencyMs" | "fetchedAt"> {
    if (oneMinuteKlines.length < 5) {
        throw new Error(`Momentum requires at least 5 one-minute candles, received ${oneMinuteKlines.length}`);
    }
    if (fiveMinuteKlines.length < 4) {
        throw new Error(`Momentum requires at least 4 five-minute candles, received ${fiveMinuteKlines.length}`);
    }

    const raw = buildRawMomentumSnapshot(oneMinuteKlines, fiveMinuteKlines, currentPrice);
    const { delta1m, delta5m, volRatio } = raw;
    const score = (delta1m * 0.4) + (delta5m * 0.6);

    let direction: MomentumSignal["direction"] = "NEUTRAL";
    if (score > SCORE_THRESHOLD && volRatio > VOLUME_CONFIRMATION_THRESHOLD) {
        direction = "UP";
    } else if (score < -SCORE_THRESHOLD && volRatio > VOLUME_CONFIRMATION_THRESHOLD) {
        direction = "DOWN";
    }

    return {
        direction,
        score: roundMetric(score),
        confidence: roundMetric(Math.min(Math.abs(score) / CONFIDENCE_NORMALIZER, 1), 4),
        delta1m: roundMetric(delta1m),
        delta5m: roundMetric(delta5m),
        volRatio: roundMetric(volRatio, 4),
    };
}

export async function getMomentumSignal(): Promise<MomentumSignal> {
    const now = Date.now();
    if (momentumCache && momentumCache.expiresAt > now) {
        return momentumCache.value;
    }

    const startedAt = now;

    try {
        const [oneMinuteKlines, fiveMinuteKlines, ticker] = await Promise.all([
            fetchJson<BinanceKline[]>(`${BINANCE_BASE_URL}/klines?symbol=${BINANCE_SYMBOL}&interval=1m&limit=20`),
            fetchJson<BinanceKline[]>(`${BINANCE_BASE_URL}/klines?symbol=${BINANCE_SYMBOL}&interval=5m&limit=4`),
            fetchJson<BinanceTickerPrice>(`${BINANCE_BASE_URL}/ticker/price?symbol=${BINANCE_SYMBOL}`),
        ]);

        const currentPrice = Number(ticker?.price);
        const fetchedAt = Date.now();
        const latencyMs = Math.max(0, fetchedAt - startedAt);
        const raw = buildRawMomentumSnapshot(
            oneMinuteKlines,
            fiveMinuteKlines,
            Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : null,
        );
        console.log(
            `Momentum raw | symbol=${ticker?.symbol ?? BINANCE_SYMBOL} | currentPrice=${raw.latestOneMinuteClose.toFixed(2)} | `
            + `oneMinuteClose5mAgo=${raw.fiveMinutesAgoClose.toFixed(2)} | fiveMinuteClose15mAgo=${raw.fifteenMinutesAgoClose.toFixed(2)} | `
            + `delta1m=${roundMetric(raw.delta1m)} | delta5m=${roundMetric(raw.delta5m)} | volRatio=${roundMetric(raw.volRatio, 4)}`
        );
        const computed = computeMomentumSignal(
            oneMinuteKlines,
            fiveMinuteKlines,
            Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : null,
        );
        const signal: MomentumSignal = {
            ...computed,
            fetchedAt,
            latencyMs,
        };

        momentumCache = {
            value: signal,
            expiresAt: fetchedAt + CACHE_TTL_MS,
        };

        await writeTelemetryEventSafe("signal.momentum", {
            symbol: ticker?.symbol ?? BINANCE_SYMBOL,
            ...signal,
            rawFieldsAvailable: true,
            rawLatestOneMinuteClose: roundMetric(raw.latestOneMinuteClose, 2),
            rawFiveMinutesAgoClose: roundMetric(raw.fiveMinutesAgoClose, 2),
            rawLatestFiveMinuteClose: roundMetric(raw.latestFiveMinuteClose, 2),
            rawFifteenMinutesAgoClose: roundMetric(raw.fifteenMinutesAgoClose, 2),
            rawLatestVolume: roundMetric(raw.latestVolume, 4),
            rawAveragePriorVolume: roundMetric(raw.averagePriorVolume, 4),
            rawDelta1m: roundMetric(raw.delta1m),
            rawDelta5m: roundMetric(raw.delta5m),
            rawVolRatio: roundMetric(raw.volRatio, 4),
        });

        return signal;
    } catch (error) {
        const fetchedAt = Date.now();
        const latencyMs = Math.max(0, fetchedAt - startedAt);
        const fallbackSignal = neutralSignal(latencyMs, fetchedAt);

        momentumCache = {
            value: fallbackSignal,
            expiresAt: fetchedAt + CACHE_TTL_MS,
        };

        await writeTelemetryEventSafe("signal.momentum", {
            symbol: BINANCE_SYMBOL,
            ...fallbackSignal,
            error: error instanceof Error ? error.message : String(error),
            degraded: true,
            rawFieldsAvailable: false,
            rawLatestOneMinuteClose: null,
            rawFiveMinutesAgoClose: null,
            rawLatestFiveMinuteClose: null,
            rawFifteenMinutesAgoClose: null,
            rawLatestVolume: null,
            rawAveragePriorVolume: null,
            rawDelta1m: null,
            rawDelta5m: null,
            rawVolRatio: null,
        });
        console.warn(`Momentum signal unavailable; using neutral fallback: ${error instanceof Error ? error.message : String(error)}`);

        return fallbackSignal;
    }
}

export function __setMomentumFetchImplementation(nextFetch: FetchLike): void {
    momentumFetch = nextFetch;
}

export function __resetMomentumModuleState(): void {
    momentumFetch = fetch;
    momentumCache = null;
}
