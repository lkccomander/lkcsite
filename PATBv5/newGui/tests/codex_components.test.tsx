import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CodexMasthead } from "../src/components/codex/CodexMasthead";
import { SessionStatStrip } from "../src/components/codex/SessionStatStrip";
import { LiveSessionPnl } from "../src/components/codex/LiveSessionPnl";
import type { SessionSummary } from "../src/types";

const summary: SessionSummary = {
  sessionId: "c2a04a71",
  startedAt: "2026-07-16T21:00:00.000Z",
  runtimeMode: "LIVE",
  startingBalance: 500,
  currentBalance: 503,
  realizedPnl: 3,
  settledTrades: 2,
  wins: 1,
  losses: 1,
  winRate: 50,
  pnlHistory: [
    { time: "2026-07-16T21:00:00.000Z", value: 0 },
    { time: "2026-07-16T21:01:00.000Z", value: 5 },
    { time: "2026-07-16T21:02:00.000Z", value: 3 },
  ],
  dataAgeSeconds: 1,
  status: "ok",
};

const masthead = renderToStaticMarkup(<CodexMasthead summary={summary} generatedAt="2026-07-16T21:03:00.000Z" />);
assert.match(masthead, />CODEX</);
assert.match(masthead, /VERSION 5\.6 SOL/);
assert.match(masthead, /LIVE TRADING/);
assert.match(masthead, /TELEMETRY LOCKED/);
assert.match(masthead, /class="codex-safety"/);
assert.match(masthead, /data-status="ok"/);

const stats = renderToStaticMarkup(<SessionStatStrip summary={summary} strategyLabel="TRADE_5X · BTC UP\/DOWN 5MIN" />);
assert.match(stats, /\+\$3\.00/);
assert.match(stats, /SETTLED TRADES/);
assert.match(stats, /50\.0%/);

const chart = renderToStaticMarkup(<LiveSessionPnl summary={summary} />);
assert.match(chart, /role="img"/);
assert.match(chart, /polyline/);

const unavailable = { ...summary, runtimeMode: "UNKNOWN" as const, status: "stale" as const, winRate: null, settledTrades: 0, wins: 0, losses: 0, pnlHistory: [{ time: summary.startedAt, value: 0 }] };
const unavailableMasthead = renderToStaticMarkup(<CodexMasthead summary={unavailable} generatedAt="2026-07-16T21:03:00.000Z" />);
assert.match(unavailableMasthead, /MODE UNKNOWN/);
assert.match(unavailableMasthead, /STALE/);
assert.match(unavailableMasthead, /data-status="stale"/);
const unavailableStats = renderToStaticMarkup(<SessionStatStrip summary={unavailable} strategyLabel="TRADE_5X" />);
assert.match(unavailableStats, /—/);
const flatChart = renderToStaticMarkup(<LiveSessionPnl summary={unavailable} />);
assert.match(flatChart, /0,125 1000,125/);
