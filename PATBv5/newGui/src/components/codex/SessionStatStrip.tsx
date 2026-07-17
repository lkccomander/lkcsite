import React from "react";
import { formatCurrency, formatPercent } from "../../lib/formatters";
import type { SessionSummary } from "../../types";

interface SessionStatStripProps {
  summary: SessionSummary;
  strategyLabel: string;
}

function formatSignedCurrency(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatCurrency(value)}`;
}

function formatNullableCurrency(value: number | null): string {
  return value == null ? "—" : formatCurrency(value);
}

export function SessionStatStrip({ summary, strategyLabel }: SessionStatStripProps) {
  const pnlTone = summary.realizedPnl > 0 ? "positive" : summary.realizedPnl < 0 ? "negative" : "neutral";

  return (
    <section className="codex-stat-strip" aria-label="Active session statistics">
      <div className={`codex-stat codex-stat--pnl ${pnlTone}`}>
        <span className="codex-stat__label">SESSION P&amp;L</span>
        <strong className="codex-stat__value">{formatSignedCurrency(summary.realizedPnl)}</strong>
      </div>
      <div className="codex-stat">
        <span className="codex-stat__label">SETTLED TRADES</span>
        <strong className="codex-stat__value">{summary.settledTrades}</strong>
        <span className="codex-stat__detail">{summary.wins}W / {summary.losses}L</span>
      </div>
      <div className="codex-stat">
        <span className="codex-stat__label">WIN RATE</span>
        <strong className="codex-stat__value">{summary.winRate == null ? "—" : formatPercent(summary.winRate)}</strong>
        <span className="codex-stat__detail">{strategyLabel}</span>
      </div>
      <div className="codex-stat">
        <span className="codex-stat__label">STARTING BALANCE</span>
        <strong className="codex-stat__value">{formatNullableCurrency(summary.startingBalance)}</strong>
      </div>
      <div className="codex-stat">
        <span className="codex-stat__label">CURRENT BALANCE</span>
        <strong className="codex-stat__value">{formatNullableCurrency(summary.currentBalance)}</strong>
      </div>
    </section>
  );
}
