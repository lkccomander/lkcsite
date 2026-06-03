import { TerminalState } from "../types";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || "/terminal-v5/api";

export async function fetchTerminalState(mode: "mock" | "live"): Promise<TerminalState> {
  const response = await fetch(`${API_BASE}/state?mode=${mode}`, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Terminal API failed: ${response.status}`);
  }

  return response.json() as Promise<TerminalState>;
}
