import React from "react";
import type { SessionSummary } from "../../types";

interface CodexMastheadProps {
  summary: SessionSummary | null;
  generatedAt: string | null;
}

export function CodexMasthead({ summary, generatedAt }: CodexMastheadProps) {
  const statusCopy = summary == null
    ? "SYNCING TELEMETRY"
    : (summary.status === "ok" ? "TELEMETRY LOCKED" : summary.status.toUpperCase());
  const modeCopy = summary?.runtimeMode === "LIVE"
    ? "LIVE TRADING"
    : (summary?.runtimeMode === "PAPER" ? "PAPER TRADING" : "MODE UNKNOWN");
  const dataStatus = summary?.status ?? "stale";
  const runtimeMode = summary?.runtimeMode ?? "UNKNOWN";

  return (
    <header className="codex-masthead">
      <div className="codex-identity">
        <div className="codex-wordmark">CODEX</div>
        <div className="codex-version">VERSION 5.6 SOL</div>
      </div>
      <div className="codex-safety" data-status={dataStatus} aria-live="polite">
        <span className={`codex-mode is-${runtimeMode.toLowerCase()}`}>{modeCopy}</span>
        <span className="codex-telemetry-status">{statusCopy}</span>
        {generatedAt ? (
          <time className="codex-generated-at" dateTime={generatedAt}>
            UPDATED {new Date(generatedAt).toISOString().slice(11, 19)} UTC
          </time>
        ) : <span className="codex-generated-at">NO ACTIVE SESSION</span>}
      </div>
    </header>
  );
}
