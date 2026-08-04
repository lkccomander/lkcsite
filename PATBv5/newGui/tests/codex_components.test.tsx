import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MAX_ACTIVITY_FEED_ITEMS } from "../src/lib/activityFeed";
import { CodexMasthead } from "../src/components/codex/CodexMasthead";
import { SessionStatStrip } from "../src/components/codex/SessionStatStrip";
import { LiveSessionPnl } from "../src/components/codex/LiveSessionPnl";
import { CodexLiveView } from "../src/components/codex/CodexLiveView";
import mockTerminalState from "../../src/ui/state/mockTerminalState";
import type { BotControlHookState } from "../src/hooks/useBotControl";
import type { ControlStatus, SessionSummary } from "../src/types";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

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

const stoppedControlStatus: ControlStatus = {
  state: "STOPPED",
  canStart: true,
  canStop: false,
  canForceStop: false,
  activeRun: null,
  error: null,
  logTail: [],
};

const control: BotControlHookState = {
  status: stoppedControlStatus,
  loading: false,
  pendingAction: null,
  error: null,
  start: async () => undefined,
  stop: async () => undefined,
  forceStop: async () => undefined,
  refresh: async () => undefined,
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
assert.match(chart, /points="0\.00,238\.00 37\.04,12\.00 74\.07,102\.40"/);
assert.match(chart, /class="codex-live-pnl__point"/);
assert.match(chart, /cx="74\.07"/);
assert.doesNotMatch(chart, /FORCE STOP/);

const originalNow = Date.now;
Date.now = () => Date.parse("2026-07-18T19:00:00.000Z");
const stoppingStatus: ControlStatus = {
  ...stoppedControlStatus,
  state: "STOPPING",
  canStart: false,
  activeRun: {
    runId: "11111111-1111-4111-8111-111111111111",
    requestedMode: "LIVE",
    modeSource: "CONTROL_OVERRIDE",
    requestedAt: "2026-07-18T18:59:00.000Z",
    stopRequestedAt: "2026-07-18T19:00:00.000Z",
    forceEligibleAt: "2026-07-18T19:00:30.000Z",
    wrapperPid: 400,
    botPid: 401,
    sessionId: "session-live",
    heartbeatUpdatedAt: "2026-07-18T19:00:00.000Z",
  },
};
const countdownChart = renderToStaticMarkup(<LiveSessionPnl summary={summary} controlStatus={stoppingStatus} />);
assert.match(countdownChart, /FORCE STOP IN 00:30/);

Date.now = () => Date.parse("2026-07-18T19:00:31.000Z");
const readyChart = renderToStaticMarkup(<LiveSessionPnl summary={summary} controlStatus={stoppingStatus} />);
assert.match(readyChart, /FORCE STOP READY/);
Date.now = originalNow;

const unavailable = { ...summary, runtimeMode: "UNKNOWN" as const, status: "stale" as const, winRate: null, settledTrades: 0, wins: 0, losses: 0, pnlHistory: [{ time: summary.startedAt, value: 0 }] };
const unavailableMasthead = renderToStaticMarkup(<CodexMasthead summary={unavailable} generatedAt="2026-07-16T21:03:00.000Z" />);
assert.match(unavailableMasthead, /MODE UNKNOWN/);
assert.match(unavailableMasthead, /STALE/);
assert.match(unavailableMasthead, /data-status="stale"/);
const unavailableStats = renderToStaticMarkup(<SessionStatStrip summary={unavailable} strategyLabel="TRADE_5X" />);
assert.match(unavailableStats, /—/);
const flatChart = renderToStaticMarkup(<LiveSessionPnl summary={unavailable} />);
assert.match(flatChart, /0,125 1000,125/);

const offlineMasthead = renderToStaticMarkup(<CodexMasthead summary={null} generatedAt={null} />);
assert.match(offlineMasthead, />CODEX</);
assert.match(offlineMasthead, /VERSION 5\.6 SOL/);
assert.match(offlineMasthead, /MODE UNKNOWN/);
assert.match(offlineMasthead, /SYNCING TELEMETRY/);
assert.match(offlineMasthead, /NO ACTIVE SESSION/);

async function runCompositionTests(): Promise<void> {
  const baseState = await mockTerminalState.buildMockTerminalState("live");
  const feedEvents = Array.from({ length: MAX_ACTIVITY_FEED_ITEMS + 12 }, (_, index) => ({
    id: `feed-event-${index}`,
    timestamp: `2026-07-16T21:0${Math.floor(index / 10)}:${String(index % 10)}.000Z`,
    category: "trade" as const,
    action: "BUY" as const,
    market: "BTC MARKET",
    detail: `event-${index}`,
    amountUsd: null,
    pnlUsd: null,
    tone: "info" as const,
  }));
  const liveState = {
    ...baseState,
    meta: { ...baseState.meta, sourceMode: "live" as const, status: "ok" as const },
    sessionSummary: summary,
    activityFeed: feedEvents,
  };
  const liveMarkup = renderToStaticMarkup(<CodexLiveView data={liveState} error={null} stale={false} control={control} />);
  assert.match(liveMarkup, /CODEX/);
  assert.match(liveMarkup, /START PAPER/);
  assert.match(liveMarkup, /TRADE FEED/);
  assert.match(liveMarkup, /BTC MARKET/);
  assert.equal((liveMarkup.match(/class="codex-event"/g) ?? []).length, MAX_ACTIVITY_FEED_ITEMS);
  assert.match(liveMarkup, /event-0/);
  assert.doesNotMatch(liveMarkup, /event-30/);

  const retainedErrorMarkup = renderToStaticMarkup(<CodexLiveView data={liveState} error="poll failed" stale={true} control={control} />);
  assert.match(retainedErrorMarkup, /POLL FAILED/i);
  assert.match(retainedErrorMarkup, /CODEX/);

  const mockMarkup = renderToStaticMarkup(<CodexLiveView data={{ ...liveState, meta: { ...liveState.meta, sourceMode: "mock" } }} error={null} stale={false} control={control} />);
  assert.match(mockMarkup, /SYNCING TELEMETRY/);
  assert.match(mockMarkup, /START LIVE/);
  assert.doesNotMatch(mockMarkup, /SESSION P&amp;L/);
  assert.ok(mockMarkup.indexOf("CODEX") < mockMarkup.indexOf("VERSION 5.6 SOL"));
  assert.ok(mockMarkup.indexOf("VERSION 5.6 SOL") < mockMarkup.indexOf("BOT RUNTIME CONTROL"));
  assert.equal((mockMarkup.match(/>CODEX</g) ?? []).length, 1);

  const errorMarkup = renderToStaticMarkup(<CodexLiveView data={null} error="Terminal API failed: 500" stale={false} control={control} />);
  assert.match(errorMarkup, /TERMINAL API FAILED: 500/i);
  assert.match(errorMarkup, /START PAPER/);
  assert.ok(errorMarkup.indexOf("CODEX") < errorMarkup.indexOf("VERSION 5.6 SOL"));
  assert.ok(errorMarkup.indexOf("VERSION 5.6 SOL") < errorMarkup.indexOf("BOT RUNTIME CONTROL"));
  assert.equal((errorMarkup.match(/>CODEX</g) ?? []).length, 1);
}

void runCompositionTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
