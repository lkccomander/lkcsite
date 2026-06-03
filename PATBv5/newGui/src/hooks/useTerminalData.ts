import { useEffect, useRef, useState } from "react";
import { fetchTerminalState } from "../lib/api";
import { TerminalState } from "../types";

interface TerminalDataState {
  data: TerminalState | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
}

export function useTerminalData(mode: "mock" | "live") {
  const [state, setState] = useState<TerminalDataState>({
    data: null,
    loading: true,
    error: null,
    stale: false,
  });
  const lastSuccessRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const nextData = await fetchTerminalState(mode);
        if (!active) {
          return;
        }

        lastSuccessRef.current = Date.now();
        setState({
          data: nextData,
          loading: false,
          error: null,
          stale: nextData.meta.stale,
        });
      } catch (error) {
        if (!active) {
          return;
        }

        const stale = lastSuccessRef.current != null && Date.now() - lastSuccessRef.current > 6000;
        setState((current) => ({
          data: current.data,
          loading: current.data == null,
          error: error instanceof Error ? error.message : String(error),
          stale,
        }));
      }
    };

    void load();
    const interval = window.setInterval(() => {
      void load();
    }, 1000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [mode]);

  return state;
}
