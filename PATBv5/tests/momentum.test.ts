import assert from "node:assert/strict";

import {
    __resetMomentumModuleState,
    __setMomentumFetchImplementation,
    computeMomentumSignal,
    getMomentumSignal,
} from "../src/signals/momentum";

type MockResponse = {
    ok: boolean;
    status?: number;
    statusText?: string;
    json: () => Promise<unknown>;
};

function makeKline(close: number, volume: number): [number, string, string, string, string, string] {
    return [0, "0", "0", "0", String(close), String(volume)];
}

async function run(): Promise<void> {
    const upSignal = computeMomentumSignal(
        [
            makeKline(100, 100),
            makeKline(101, 110),
            makeKline(102, 120),
            makeKline(103, 130),
            makeKline(105, 200),
        ],
        [
            makeKline(95, 100),
            makeKline(97, 105),
            makeKline(100, 110),
            makeKline(104, 120),
        ],
        105,
    );
    assert.equal(upSignal.direction, "UP");
    assert.ok(upSignal.score > 0.0015);
    assert.ok(upSignal.volRatio > 1.1);

    const downSignal = computeMomentumSignal(
        [
            makeKline(110, 100),
            makeKline(109, 110),
            makeKline(108, 120),
            makeKline(107, 130),
            makeKline(104, 200),
        ],
        [
            makeKline(116, 100),
            makeKline(113, 105),
            makeKline(109, 110),
            makeKline(104, 120),
        ],
        104,
    );
    assert.equal(downSignal.direction, "DOWN");
    assert.ok(downSignal.score < -0.0015);

    const neutralSignal = computeMomentumSignal(
        [
            makeKline(100, 100),
            makeKline(100.02, 101),
            makeKline(100.03, 100),
            makeKline(100.01, 101),
            makeKline(100.04, 102),
        ],
        [
            makeKline(100, 100),
            makeKline(100.01, 101),
            makeKline(100.02, 99),
            makeKline(100.03, 98),
        ],
        100.04,
    );
    assert.equal(neutralSignal.direction, "NEUTRAL");

    __resetMomentumModuleState();
    let callCount = 0;
    __setMomentumFetchImplementation(async (url: string | URL | Request): Promise<Response> => {
        callCount += 1;
        const text = String(url);
        let payload: unknown;
        if (text.includes("interval=1m")) {
            payload = Array.from({ length: 20 }, (_, index) => makeKline(100 + index, index < 15 ? 100 : 200));
        } else if (text.includes("interval=5m")) {
            payload = [
                makeKline(95, 100),
                makeKline(98, 110),
                makeKline(101, 120),
                makeKline(105, 130),
            ];
        } else {
            payload = { symbol: "BTCUSDT", price: "105" };
        }
        const response: MockResponse = {
            ok: true,
            json: async () => payload,
        };
        return response as Response;
    });
    const first = await getMomentumSignal();
    const second = await getMomentumSignal();
    assert.equal(callCount, 3);
    assert.deepEqual(second, first);

    __resetMomentumModuleState();
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
