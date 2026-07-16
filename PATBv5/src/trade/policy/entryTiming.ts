export interface EntryTimingInput {
    marketTimeSeconds: number;
    secondsToClose: number;
    entryTimeRatio: number;
    minSecondsToClose: number;
    maxSecondsToClose: number;
    latestEntrySecondsBeforeClose: number;
}

export interface EntryTimingEvaluation {
    elapsedRatio: number;
    elapsedTimeReached: boolean;
    pastLatestEntryCutoff: boolean;
    withinSecondsToCloseWindow: boolean;
}

export function evaluateEntryTiming(input: EntryTimingInput): EntryTimingEvaluation {
    const elapsedRatio = (input.marketTimeSeconds - input.secondsToClose) / input.marketTimeSeconds;

    return {
        elapsedRatio,
        elapsedTimeReached: elapsedRatio > input.entryTimeRatio,
        pastLatestEntryCutoff: input.secondsToClose <= input.latestEntrySecondsBeforeClose,
        withinSecondsToCloseWindow:
            input.secondsToClose >= input.minSecondsToClose
            && input.secondsToClose <= input.maxSecondsToClose,
    };
}
