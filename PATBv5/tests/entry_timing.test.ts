import assert from "node:assert/strict";
import { evaluateEntryTiming, type EntryTimingInput } from "../src/trade/policy/entryTiming";

const baseInput: EntryTimingInput = {
    marketTimeSeconds: 300,
    secondsToClose: 276,
    entryTimeRatio: 0.08,
    minSecondsToClose: 45,
    maxSecondsToClose: 240,
    latestEntrySecondsBeforeClose: 15,
};

function evaluate(overrides: Partial<EntryTimingInput> = {}) {
    return evaluateEntryTiming({ ...baseInput, ...overrides });
}

async function run(): Promise<void> {
    const elapsedCases = [
        { secondsToClose: 277, expected: false },
        { secondsToClose: 276, expected: false },
        { secondsToClose: 275, expected: true },
    ];
    for (const testCase of elapsedCases) {
        assert.equal(
            evaluate({ secondsToClose: testCase.secondsToClose }).elapsedTimeReached,
            testCase.expected,
            `unexpected elapsed-time result at ${testCase.secondsToClose}s to close`,
        );
    }

    const latestEntryCases = [
        { secondsToClose: 16, expected: false },
        { secondsToClose: 15, expected: true },
        { secondsToClose: 14, expected: true },
    ];
    for (const testCase of latestEntryCases) {
        assert.equal(
            evaluate({ secondsToClose: testCase.secondsToClose }).pastLatestEntryCutoff,
            testCase.expected,
            `unexpected latest-entry result at ${testCase.secondsToClose}s to close`,
        );
    }

    const secondsWindowCases = [
        { secondsToClose: 44, expected: false },
        { secondsToClose: 45, expected: true },
        { secondsToClose: 120, expected: true },
        { secondsToClose: 240, expected: true },
        { secondsToClose: 241, expected: false },
    ];
    for (const testCase of secondsWindowCases) {
        assert.equal(
            evaluate({ secondsToClose: testCase.secondsToClose }).withinSecondsToCloseWindow,
            testCase.expected,
            `unexpected seconds-window result at ${testCase.secondsToClose}s to close`,
        );
    }

    assert.equal(
        evaluate({ secondsToClose: 10_000, maxSecondsToClose: Number.POSITIVE_INFINITY }).withinSecondsToCloseWindow,
        true,
    );

    const unrounded = evaluate({ secondsToClose: 275 });
    assert.equal(unrounded.elapsedRatio, 25 / 300);
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
