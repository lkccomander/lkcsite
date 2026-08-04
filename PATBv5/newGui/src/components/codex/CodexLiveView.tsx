import React from "react";
import type { TerminalState } from "../../types";
import type { BotControlHookState } from "../../hooks/useBotControl";
import { AdvancedTelemetryStack } from "./AdvancedTelemetryStack";
import { CodexActivityFeed } from "./CodexActivityFeed";
import { CodexLiveHealth } from "./CodexLiveHealth";
import { CodexMasthead } from "./CodexMasthead";
import { CodexRuntimeControls } from "./CodexRuntimeControls";
import { LiveSessionPnl } from "./LiveSessionPnl";
import { SessionStatStrip } from "./SessionStatStrip";

interface CodexLiveViewProps {
  data: TerminalState | null;
  error: string | null;
  stale: boolean;
  control: BotControlHookState;
}

export function CodexLiveView({ data, error, stale, control }: CodexLiveViewProps) {
  const liveData = data?.meta.sourceMode === "live" ? data : null;
  const mastheadStale = stale || liveData?.sessionSummary.status === "stale";
  const mastheadSummary = liveData
    ? (mastheadStale ? { ...liveData.sessionSummary, status: "stale" as const } : liveData.sessionSummary)
    : null;

  return (
    <main className="codex-live">
      <div className="codex-shell">
        <div className="codex-chrome">
          <span>{liveData ? "ACTIVE SESSION" : "RUNTIME CONTROL"}</span>
          <span>{liveData?.sessionSummary.sessionId ?? "TELEMETRY OFFLINE"}</span>
        </div>
        <CodexMasthead summary={mastheadSummary} generatedAt={liveData?.meta.generatedAt ?? null} />
        <CodexRuntimeControls {...control} />
        {liveData ? (
          <>
            {error ? <div className="codex-fault-banner" role="alert">{error}</div> : null}
            <SessionStatStrip summary={liveData.sessionSummary} strategyLabel={liveData.header.strategyLabel} />
            <LiveSessionPnl summary={liveData.sessionSummary} controlStatus={control.status} />
            <section className="codex-activity-region" aria-label="Session activity and live health">
              <CodexActivityFeed events={liveData.activityFeed} />
              <CodexLiveHealth summary={liveData.sessionSummary} analytics={liveData.analytics} strategyLabel={liveData.header.strategyLabel} />
            </section>
          </>
        ) : (
          <section className="codex-state-shell" aria-live="polite">
            <p>{error ?? (data ? "LIVE SOURCE NOT AVAILABLE" : "TELEMETRY SOURCE NOT AVAILABLE")}</p>
          </section>
        )}
      </div>
      {liveData ? <AdvancedTelemetryStack data={liveData} /> : null}
    </main>
  );
}
