import { TerminalState } from "../types";
import { buildMockTerminalState } from "./mockTerminalState";
import { buildLiveTerminalState } from "./liveTerminalState";

export async function getTerminalState(requestedMode: "mock" | "live"): Promise<TerminalState> {
  if (requestedMode === "live") {
    return buildLiveTerminalState();
  }

  return buildMockTerminalState(requestedMode);
}
