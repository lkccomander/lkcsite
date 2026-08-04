import type { ControlStatus, RequestedMode } from "../types";

const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) || "/terminal-v5/api").replace(/\/$/, "");
const CONTROL_API_BASE = `${API_BASE}/control`;

export interface ControlBootstrap {
  csrfToken: string;
  status: ControlStatus;
}

interface ControlStatusResponse {
  status: ControlStatus;
}

function errorMessage(error: unknown, status: number): string {
  if (typeof error === "object" && error !== null && "error" in error && typeof error.error === "string") {
    return error.error;
  }
  return `Control API failed: ${status}`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  const response = await fetch(`${CONTROL_API_BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers,
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // A non-JSON error still receives the stable status-based message below.
  }
  if (!response.ok) {
    throw new Error(errorMessage(payload, response.status));
  }
  return payload as T;
}

function mutationHeaders(csrfToken: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-Codex-CSRF": csrfToken,
  };
}

export function fetchControlBootstrap(signal?: AbortSignal): Promise<ControlBootstrap> {
  return requestJson<ControlBootstrap>("/bootstrap", { signal });
}

export async function fetchControlStatus(): Promise<ControlStatus> {
  const response = await requestJson<ControlStatusResponse>("/status");
  return response.status;
}

export async function startControlledBot(mode: RequestedMode, csrfToken: string): Promise<ControlStatus> {
  const response = await requestJson<ControlStatusResponse>("/start", {
    method: "POST",
    headers: mutationHeaders(csrfToken),
    body: JSON.stringify({ mode }),
  });
  return response.status;
}

export async function stopControlledBot(csrfToken: string): Promise<ControlStatus> {
  const response = await requestJson<ControlStatusResponse>("/stop", {
    method: "POST",
    headers: mutationHeaders(csrfToken),
    body: JSON.stringify({}),
  });
  return response.status;
}

export async function forceStopControlledBot(csrfToken: string): Promise<ControlStatus> {
  const response = await requestJson<ControlStatusResponse>("/force", {
    method: "POST",
    headers: mutationHeaders(csrfToken),
    body: JSON.stringify({}),
  });
  return response.status;
}
