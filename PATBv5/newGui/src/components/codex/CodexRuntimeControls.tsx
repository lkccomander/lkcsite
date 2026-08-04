import React from "react";
import type { BotControlHookState } from "../../hooks/useBotControl";

export type CodexRuntimeControlsProps = BotControlHookState;

function displayValue(value: string | number | null): string {
  return value == null || value === "" ? "—" : String(value);
}

export function CodexRuntimeControls({
  status,
  loading,
  pendingAction,
  error,
  start,
  stop,
  forceStop,
  refresh,
}: CodexRuntimeControlsProps) {
  const stateLabel = status?.state ?? (loading ? "CONNECTING" : "UNAVAILABLE");
  const latestError = error ?? status?.error ?? null;
  const activeRun = status?.activeRun ?? null;
  const logLines = (status?.logTail ?? []).slice(-20);
  const actionPending = pendingAction !== null;

  return (
    <section
      className="codex-control"
      aria-labelledby="codex-control-title"
      aria-busy={actionPending}
    >
      <header className="codex-control__header">
        <div>
          <h2 id="codex-control-title">BOT RUNTIME CONTROL</h2>
          <p>LOOPBACK CONTROLLER · SINGLE RUN</p>
        </div>
        <strong className="codex-control__state" data-state={status?.state ?? "UNAVAILABLE"} aria-live="polite">
          {stateLabel}
        </strong>
      </header>

      <div className="codex-control-actions" aria-label="Bot runtime actions">
        {status?.canStart ? (
          <div className="codex-control-actions__start">
            <button
              type="button"
              className="codex-control-button codex-control-button--paper"
              disabled={actionPending}
              onClick={() => void start("PAPER")}
            >
              START PAPER
            </button>
            <button
              type="button"
              className="codex-control-button codex-control-button--live"
              disabled={actionPending}
              onClick={() => void start("LIVE")}
            >
              START LIVE
            </button>
          </div>
        ) : null}
        {status?.canStop ? (
          <button
            type="button"
            className="codex-control-button codex-control-button--stop"
            disabled={actionPending}
            onClick={() => void stop()}
          >
            STOP
          </button>
        ) : null}
        {status?.canForceStop ? (
          <button
            type="button"
            className="codex-control-button codex-control-button--force"
            disabled={actionPending}
            onClick={() => void forceStop()}
          >
            FORCE STOP
          </button>
        ) : null}
        <button
          type="button"
          className="codex-control-button codex-control-button--refresh"
          disabled={actionPending}
          onClick={() => void refresh()}
        >
          REFRESH CONTROL
        </button>
      </div>

      {pendingAction ? (
        <p className="codex-control__pending" aria-live="polite">ACTION PENDING · {pendingAction.toUpperCase()}</p>
      ) : null}

      {activeRun ? (
        <dl className="codex-control-meta">
          <div><dt>MODE</dt><dd>{activeRun.requestedMode}</dd></div>
          <div><dt>MODE SOURCE</dt><dd>{activeRun.modeSource}</dd></div>
          <div><dt>RUN ID</dt><dd>{activeRun.runId}</dd></div>
          <div><dt>SESSION ID</dt><dd>{displayValue(activeRun.sessionId)}</dd></div>
          <div><dt>WRAPPER PID</dt><dd>{displayValue(activeRun.wrapperPid)}</dd></div>
          <div><dt>BOT PID</dt><dd>{displayValue(activeRun.botPid)}</dd></div>
          <div><dt>REQUESTED AT</dt><dd>{activeRun.requestedAt}</dd></div>
          <div><dt>HEARTBEAT</dt><dd>{displayValue(activeRun.heartbeatUpdatedAt)}</dd></div>
        </dl>
      ) : null}

      {latestError ? <div className="codex-control-error" role="alert">{latestError}</div> : null}

      <details className="codex-control-logs">
        <summary>RUNTIME LOG · LAST {logLines.length} LINES</summary>
        <pre>{logLines.length > 0 ? logLines.join("\n") : "NO RUNTIME LOG ENTRIES"}</pre>
      </details>
    </section>
  );
}
