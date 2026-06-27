import { TerminalState } from "../types";
import { buildLiveTerminalState } from "./liveTerminalState";

export async function getTerminalState(requestedMode: "mock" | "live"): Promise<TerminalState> {
  void requestedMode;
  return buildLiveTerminalState();
}
