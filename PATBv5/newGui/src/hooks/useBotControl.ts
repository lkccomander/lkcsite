import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchControlBootstrap,
  forceStopControlledBot,
  startControlledBot,
  stopControlledBot,
} from "../lib/controlApi";
import type { ControlStatus, RequestedMode } from "../types";

export type BotControlAction = "start-paper" | "start-live" | "stop" | "force-stop";

export interface BotControlHookState {
  status: ControlStatus | null;
  loading: boolean;
  pendingAction: BotControlAction | null;
  error: string | null;
  start(mode: RequestedMode): Promise<void>;
  stop(): Promise<void>;
  forceStop(): Promise<void>;
  refresh(): Promise<void>;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

export function useBotControl(): BotControlHookState {
  const [status, setStatus] = useState<ControlStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<BotControlAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const csrfTokenRef = useRef<string | null>(null);
  const pendingActionRef = useRef<BotControlAction | null>(null);
  const mountedRef = useRef(true);
  const bootstrapRequestRef = useRef<Promise<void> | null>(null);
  const bootstrapAbortRef = useRef<AbortController | null>(null);

  const refresh = useCallback((): Promise<void> => {
    if (bootstrapRequestRef.current) {
      return bootstrapRequestRef.current;
    }

    const abortController = new AbortController();
    bootstrapAbortRef.current = abortController;
    let activeRequest: Promise<void> | null = null;
    const request = (async (): Promise<void> => {
      try {
        const bootstrap = await fetchControlBootstrap(abortController.signal);
        if (!mountedRef.current || abortController.signal.aborted) return;
        csrfTokenRef.current = bootstrap.csrfToken;
        setStatus(bootstrap.status);
        setLoading(false);
        setError(null);
      } catch (refreshError) {
        if (isAbortError(refreshError) || !mountedRef.current) return;
        setLoading(false);
        setError(messageFor(refreshError));
      } finally {
        if (bootstrapRequestRef.current === activeRequest) bootstrapRequestRef.current = null;
        if (bootstrapAbortRef.current === abortController) bootstrapAbortRef.current = null;
      }
    })();
    activeRequest = request;
    bootstrapRequestRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    let active = true;
    let timer: number | null = null;
    mountedRef.current = true;
    const poll = async (): Promise<void> => {
      if (!active) return;
      if (pendingActionRef.current === null) await refresh();
      if (active) timer = window.setTimeout(() => void poll(), 1_000);
    };
    void poll();

    return () => {
      active = false;
      mountedRef.current = false;
      if (timer != null) window.clearTimeout(timer);
      bootstrapAbortRef.current?.abort();
      bootstrapAbortRef.current = null;
      bootstrapRequestRef.current = null;
    };
  }, [refresh]);

  const runAction = useCallback(async (
    action: BotControlAction,
    request: (csrfToken: string) => Promise<ControlStatus>,
  ): Promise<void> => {
    if (pendingActionRef.current !== null) {
      return;
    }

    const csrfToken = csrfTokenRef.current;
    if (csrfToken == null) {
      if (mountedRef.current) {
        setError("CONTROL SESSION NOT READY");
      }
      return;
    }

    bootstrapAbortRef.current?.abort();
    pendingActionRef.current = action;
    setPendingAction(action);
    try {
      const nextStatus = await request(csrfToken);
      if (mountedRef.current) {
        setStatus(nextStatus);
        setError(null);
      }
    } catch (actionError) {
      if (mountedRef.current) {
        setError(messageFor(actionError));
      }
    } finally {
      pendingActionRef.current = null;
      if (mountedRef.current) {
        setPendingAction(null);
      }
    }
  }, []);

  const start = useCallback(async (mode: RequestedMode): Promise<void> => {
    const action = mode === "PAPER" ? "start-paper" : "start-live";
    await runAction(action, (csrfToken) => startControlledBot(mode, csrfToken));
  }, [runAction]);

  const stop = useCallback(async (): Promise<void> => {
    await runAction("stop", stopControlledBot);
  }, [runAction]);

  const forceStop = useCallback(async (): Promise<void> => {
    await runAction("force-stop", forceStopControlledBot);
  }, [runAction]);

  return { status, loading, pendingAction, error, start, stop, forceStop, refresh };
}
