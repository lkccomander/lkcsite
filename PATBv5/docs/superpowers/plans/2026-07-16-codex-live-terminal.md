# CODEX Live Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate `/terminal-v5/codex` real-time operator view with accurate active-session telemetry, the approved CODEX / VERSION 5.6 SOL visual system, and the existing advanced diagnostic panels below it.

**Architecture:** Add a pure active-session telemetry builder behind the existing `TerminalState` API, keeping all legacy fields intact. The React client dispatches between the unchanged legacy page and a new CODEX page based on the Vite base-relative path; both pages share the existing one-second polling hook and advanced panels.

**Tech Stack:** Node.js 20+, TypeScript, React 18 client, Vite 5, ReactDOM server rendering for component contract tests, existing isolated `tsx` test runner, SVG for the P&L curve, CSS custom properties.

## Global Constraints

- Existing UI remains available and behaviorally unchanged at `/terminal-v5`.
- New view is available at `/terminal-v5/codex` with the default `UI_ROUTE_BASE`.
- Fixed visible copy is exactly `CODEX` and `VERSION 5.6 SOL`.
- Active-session metrics use the complete latest `sessionId`; capped display lists must not cap summary calculations.
- Runtime mode comes only from explicit `bot.startup.payload.mode`; missing mode is `UNKNOWN`, never inferred as LIVE.
- No database change, React Router dependency, second polling loop, historical-session browser, or bot execution control.
- New CSS is scoped under `.codex-live`; legacy global styles are not rewritten.
- LIVE/PAPER/UNKNOWN and freshness are always visible in text, not color alone.
- Motion is limited to P&L updates, new-row opacity, and status crossfades; reduced motion is at most 150 ms opacity-only.
- The live CODEX view never displays generated mock values as if they were live telemetry.

## File Structure

### Backend and shared contract

- Create `src/ui/state/telemetryEvent.ts`: shared raw telemetry event shape.
- Create `src/ui/state/activeSessionReader.ts`: incremental reader for the newest per-session telemetry file.
- Create `src/ui/state/sessionTelemetry.ts`: pure selection, summary, realized-trade, and activity normalization logic.
- Modify `src/ui/types.ts`: authoritative backend `SessionSummary` and `ActivityEvent` interfaces.
- Modify `src/ui/state/liveTerminalState.ts`: integrate the pure builder while preserving legacy response fields.
- Modify `src/ui/state/mockTerminalState.ts`: satisfy the extended contract explicitly as mock data.

### Client

- Modify `newGui/src/types.ts`: mirror the API contract.
- Create `newGui/src/lib/route.ts`: base-aware view resolution.
- Create `newGui/src/lib/activityFeed.ts`: pure feed filtering and tab-key logic.
- Create `newGui/src/pages/LegacyTerminalPage.tsx`: existing `App` body, unchanged.
- Create `newGui/src/pages/CodexLivePage.tsx`: polling and top-level state boundary.
- Create `newGui/src/components/codex/CodexLiveView.tsx`: presentational page composition.
- Create `newGui/src/components/codex/CodexMasthead.tsx`: identity and safety rail.
- Create `newGui/src/components/codex/SessionStatStrip.tsx`: P&L, settled trades, win rate.
- Create `newGui/src/components/codex/LiveSessionPnl.tsx`: session-scoped SVG P&L curve.
- Create `newGui/src/components/codex/CodexActivityFeed.tsx`: accessible activity tabs and rows.
- Create `newGui/src/components/codex/CodexLiveHealth.tsx`: feed and safety details.
- Create `newGui/src/components/codex/AdvancedTelemetryStack.tsx`: existing advanced panels in the approved order.
- Modify `newGui/src/App.tsx`: base-aware page dispatch only.
- Modify `newGui/src/main.tsx`: import CODEX tokens and scoped stylesheet.
- Create `newGui/tokens.css`: portable CODEX design tokens.
- Create `newGui/src/styles/codex.css`: scoped layout, states, responsiveness, and reduced motion.
- Create `.hallmark/log.json`: record the studied-DNA Stat-Led terminal system.

### Tests

- Create `tests/ui_active_session_reader.test.ts`: full-session loading, append updates, and session rollover.
- Create `tests/ui_session_telemetry.test.ts`: summary, isolation, balance, mode, and activity mapping.
- Create `tests/ui_live_empty_state.test.ts`: prove an empty live source remains visibly mock/unavailable.
- Create `tests/ui_codex_route.test.ts`: Vite-base-relative path dispatch.
- Create `tests/ui_codex_activity.test.ts`: filter and keyboard navigation helpers.
- Create `newGui/tests/codex_components.test.tsx`: server-rendered copy, metrics, safety, empty state, and semantic roles using the client package's React 18 runtime.
- Modify `package.json`: focused UI test commands and inclusion in `test:all`.

---

### Task 1: Read the complete active session incrementally

**Files:**
- Create: `PATBv5/src/ui/state/telemetryEvent.ts`
- Create: `PATBv5/src/ui/state/activeSessionReader.ts`
- Create: `PATBv5/tests/ui_active_session_reader.test.ts`
- Modify: `PATBv5/package.json`

**Interfaces:**
- Consumes: the `polydb/telemetry/sessions` directory and the configured bot ID.
- Produces: `createActiveSessionReader(sessionsDir, botId): () => Promise<TelemetryEvent[]>`.

- [ ] **Step 1: Write the failing incremental reader test**

Create `tests/ui_active_session_reader.test.ts`:

```ts
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createActiveSessionReader } from "../src/ui/state/activeSessionReader";

async function run(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "patbv5-active-session-"));
  const sessionsDir = join(root, "sessions");
  mkdirSync(sessionsDir);
  try {
    const firstPath = join(sessionsDir, "2026-07-16T20-00-00-000Z__one.jsonl");
    const initial = Array.from({ length: 5001 }, (_, index) => ({
      type: index === 0 ? "bot.startup" : "feed.tick",
      timestamp: new Date(Date.parse("2026-07-16T20:00:00.000Z") + index).toISOString(),
      botId: "bot-v5",
      sessionId: "one",
      payload: index === 0 ? { mode: "LIVE" } : { sequence: index },
    }));
    writeFileSync(firstPath, `${initial.map((event) => JSON.stringify(event)).join("\n")}\n`);

    const readActiveSession = createActiveSessionReader(sessionsDir, "bot-v5");
    assert.equal((await readActiveSession()).length, 5001);

    appendFileSync(firstPath, `${JSON.stringify({ type: "feed.summary", timestamp: "2026-07-16T20:10:00.000Z", botId: "bot-v5", sessionId: "one", payload: {} })}\n`);
    assert.equal((await readActiveSession()).length, 5002);

    const secondPath = join(sessionsDir, "2026-07-16T21-00-00-000Z__two.jsonl");
    writeFileSync(secondPath, `${JSON.stringify({ type: "bot.startup", timestamp: "2026-07-16T21:00:00.000Z", botId: "bot-v5", sessionId: "two", payload: { mode: "PAPER" } })}\n`);
    const rolled = await readActiveSession();
    assert.equal(rolled.length, 1);
    assert.equal(rolled[0].sessionId, "two");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run and verify the missing module failure**

Run: `npx tsx tests/ui_active_session_reader.test.ts`  
Expected: FAIL with missing `activeSessionReader` module.

- [ ] **Step 3: Define the raw event boundary and implement the cached append reader**

Create `src/ui/state/telemetryEvent.ts`:

```ts
export type JsonRecord = Record<string, unknown>;

export interface TelemetryEvent {
  type: string;
  payload: JsonRecord;
  timestamp: string;
  botId?: string;
  sessionId?: string;
  sessionStartedAt?: string;
}
```

Create `src/ui/state/activeSessionReader.ts`:

```ts
import { open, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { TelemetryEvent } from "./telemetryEvent";

export function createActiveSessionReader(sessionsDir: string, botId: string): () => Promise<TelemetryEvent[]> {
  let activePath: string | null = null;
  let offset = 0;
  let remainder = "";
  let events: TelemetryEvent[] = [];

  return async () => {
    let names: string[];
    try {
      names = (await readdir(sessionsDir)).filter((name) => name.endsWith(".jsonl")).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const latestName = names.at(-1);
    if (!latestName) return [];
    const latestPath = resolve(sessionsDir, latestName);
    const size = (await stat(latestPath)).size;
    if (activePath !== latestPath || size < offset) {
      activePath = latestPath;
      offset = 0;
      remainder = "";
      events = [];
    }
    if (size === offset) return [...events];

    const file = await open(latestPath, "r");
    try {
      const buffer = Buffer.alloc(size - offset);
      await file.read(buffer, 0, buffer.length, offset);
      offset = size;
      const lines = `${remainder}${buffer.toString("utf8")}`.split(/\r?\n/);
      remainder = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        try {
          const event = JSON.parse(line) as TelemetryEvent;
          if (event.botId === botId) events.push(event);
        } catch {
          continue;
        }
      }
      return [...events];
    } finally {
      await file.close();
    }
  };
}
```

- [ ] **Step 4: Add and run the focused reader script**

Add:

```json
"test:ui-session-reader": "tsx tests/ui_active_session_reader.test.ts"
```

Run: `npm run test:ui-session-reader`  
Expected: PASS and confirm 5001 events are retained, proving the old 4000-event cap is gone for active-session summaries.

- [ ] **Step 5: Commit the reader**

```bash
git add PATBv5/src/ui/state/telemetryEvent.ts PATBv5/src/ui/state/activeSessionReader.ts PATBv5/tests/ui_active_session_reader.test.ts PATBv5/package.json
git commit -m "feat: read complete active telemetry session"
```

---

### Task 2: Build the active-session telemetry contract

**Files:**
- Create: `PATBv5/src/ui/state/sessionTelemetry.ts`
- Modify: `PATBv5/src/ui/types.ts`
- Modify: `PATBv5/newGui/src/types.ts`
- Create: `PATBv5/tests/ui_session_telemetry.test.ts`
- Modify: `PATBv5/package.json`

**Interfaces:**
- Consumes: raw JSONL-shaped `TelemetryEvent[]` in chronological order.
- Produces: `buildActiveSessionTelemetry(events, nowMs): ActiveSessionTelemetry` with `sessionEvents`, `realizedTrades`, `sessionSummary`, and `activityFeed`.

- [ ] **Step 1: Write the failing session telemetry test**

Create `tests/ui_session_telemetry.test.ts` with explicit old- and current-session fixtures:

```ts
import assert from "node:assert/strict";
import { buildActiveSessionTelemetry, type TelemetryEvent } from "../src/ui/state/sessionTelemetry";

const events: TelemetryEvent[] = [
  { type: "bot.startup", timestamp: "2026-07-16T20:00:00.000Z", sessionId: "old", sessionStartedAt: "2026-07-16T20:00:00.000Z", payload: { mode: "PAPER", paperStartingUsd: 100 } },
  { type: "paper_trade.sell", timestamp: "2026-07-16T20:01:00.000Z", sessionId: "old", payload: { side: "UP", pnlUsd: 20, price: 0.8 } },
  { type: "paper_balance.checkpoint", timestamp: "2026-07-16T20:02:00.000Z", sessionId: "old", payload: { balance: 120 } },
  { type: "bot.startup", timestamp: "2026-07-16T21:00:00.000Z", sessionId: "current", sessionStartedAt: "2026-07-16T21:00:00.000Z", payload: { mode: "LIVE" } },
  { type: "live_trade.sell", timestamp: "2026-07-16T21:01:00.000Z", sessionId: "current", payload: { side: "DOWN", pnlUsd: 5, price: 0.75 } },
  { type: "trade.exit_filled", timestamp: "2026-07-16T21:02:00.000Z", sessionId: "current", payload: { side: "UP", realizedTradePnl: -2, exitPrice: 0.61 } },
  { type: "trade.signal_rejected", timestamp: "2026-07-16T21:02:30.000Z", sessionId: "current", payload: { reason: "min_fee_adjusted_edge", market: "btc-updown-5m" } },
  { type: "feed.summary", timestamp: "2026-07-16T21:03:00.000Z", sessionId: "current", payload: { averageLatencyMs: 312, tickCount: 90 } },
];

const result = buildActiveSessionTelemetry(events, Date.parse("2026-07-16T21:03:01.000Z"));
assert.equal(result.sessionSummary.sessionId, "current");
assert.equal(result.sessionSummary.runtimeMode, "LIVE");
assert.equal(result.sessionSummary.realizedPnl, 3);
assert.equal(result.sessionSummary.settledTrades, 2);
assert.equal(result.sessionSummary.wins, 1);
assert.equal(result.sessionSummary.losses, 1);
assert.equal(result.sessionSummary.winRate, 50);
assert.deepEqual(result.sessionSummary.pnlHistory.map((point) => point.value), [0, 5, 3]);
assert.equal(result.sessionSummary.startingBalance, null);
assert.equal(result.sessionSummary.currentBalance, null);
assert.equal(result.sessionSummary.dataAgeSeconds, 1);
assert.deepEqual(result.activityFeed.map((event) => event.action), ["FEED", "REJECT", "FILL", "SELL"]);
assert.equal(result.activityFeed.length, 4);
assert.ok(result.sessionEvents.every((event) => event.sessionId === "current"));

const paper = buildActiveSessionTelemetry([
  { type: "bot.startup", timestamp: "2026-07-16T22:00:00.000Z", sessionId: "paper", payload: { mode: "PAPER", paperStartingUsd: 500 } },
  { type: "paper_balance.checkpoint", timestamp: "2026-07-16T22:01:00.000Z", sessionId: "paper", payload: { balance: 504 } },
], Date.parse("2026-07-16T22:01:02.000Z"));
assert.equal(paper.sessionSummary.startingBalance, 500);
assert.equal(paper.sessionSummary.currentBalance, 504);

const unknown = buildActiveSessionTelemetry([
  { type: "feed.summary", timestamp: "2026-07-16T23:00:00.000Z", sessionId: "unknown", payload: {} },
], Date.parse("2026-07-16T23:00:30.000Z"));
assert.equal(unknown.sessionSummary.runtimeMode, "UNKNOWN");
assert.equal(unknown.sessionSummary.status, "stale");
assert.equal(unknown.sessionSummary.winRate, null);

const empty = buildActiveSessionTelemetry([], Date.parse("2026-07-16T23:30:00.000Z"));
assert.equal(empty.sessionSummary.runtimeMode, "UNKNOWN");
assert.equal(empty.sessionSummary.status, "stale");
assert.deepEqual(empty.activityFeed, []);
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `npx tsx tests/ui_session_telemetry.test.ts`  
Expected: FAIL with `Cannot find module '../src/ui/state/sessionTelemetry'`.

- [ ] **Step 3: Add the shared API types to both type files**

Add the following exact interfaces after `PnLPoint` in `src/ui/types.ts` and `newGui/src/types.ts`, then add `sessionSummary` and `activityFeed` to both `TerminalState` interfaces:

```ts
export type SessionRuntimeMode = "PAPER" | "LIVE" | "UNKNOWN";
export type SessionStatus = "ok" | "degraded" | "stale";

export interface SessionSummary {
  sessionId: string;
  startedAt: string;
  runtimeMode: SessionRuntimeMode;
  startingBalance: number | null;
  currentBalance: number | null;
  realizedPnl: number;
  settledTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  pnlHistory: PnLPoint[];
  dataAgeSeconds: number;
  status: SessionStatus;
}

export type ActivityCategory = "trade" | "settlement" | "rejection" | "gate" | "feed";
export type ActivityAction = "BUY" | "SELL" | "FILL" | "SETTLED" | "REJECT" | "GATE" | "FEED";

export interface ActivityEvent {
  id: string;
  timestamp: string;
  category: ActivityCategory;
  action: ActivityAction;
  market: string | null;
  detail: string;
  amountUsd: number | null;
  pnlUsd: number | null;
  tone: TapeTone;
}
```

Add to `TerminalState`:

```ts
sessionSummary: SessionSummary;
activityFeed: ActivityEvent[];
```

- [ ] **Step 4: Implement the pure session builder**

Create `src/ui/state/sessionTelemetry.ts`. Keep all numeric parsing defensive, select the session from the newest event carrying a `sessionId`, and return feed rows newest first. The exported surface must be:

```ts
import type { ActivityEvent, PnLPoint, SessionRuntimeMode, SessionSummary, TradeRow } from "../types";
import type { TelemetryEvent } from "./telemetryEvent";
export type { TelemetryEvent } from "./telemetryEvent";
export interface RealizedTradeRecord {
  id: string;
  timestamp: string;
  side: TradeRow["side"];
  price: number;
  pnl: number | null;
  confidence: number;
  status: TradeRow["status"];
  label: string;
}
export interface ActiveSessionTelemetry {
  sessionEvents: TelemetryEvent[];
  realizedTrades: RealizedTradeRecord[];
  sessionSummary: SessionSummary;
  activityFeed: ActivityEvent[];
}

export function buildActiveSessionTelemetry(events: TelemetryEvent[], nowMs = Date.now()): ActiveSessionTelemetry;
```

Implement these exact rules inside that function:

```ts
if (events.length === 0) {
  const now = new Date(nowMs).toISOString();
  return {
    sessionEvents: [],
    realizedTrades: [],
    sessionSummary: {
      sessionId: "unknown",
      startedAt: now,
      runtimeMode: "UNKNOWN",
      startingBalance: null,
      currentBalance: null,
      realizedPnl: 0,
      settledTrades: 0,
      wins: 0,
      losses: 0,
      winRate: null,
      pnlHistory: [{ time: now, value: 0 }],
      dataAgeSeconds: 0,
      status: "stale",
    },
    activityFeed: [],
  };
}
const latestSessionId = [...events].reverse().find((event) => event.sessionId)?.sessionId ?? "unknown";
const sessionEvents = events.filter((event) => event.sessionId === latestSessionId);
const startedAt = sessionEvents[0]?.sessionStartedAt ?? sessionEvents[0]?.timestamp ?? new Date(nowMs).toISOString();
const startup = sessionEvents.find((event) => event.type === "bot.startup");
const declaredMode = typeof startup?.payload.mode === "string" ? startup.payload.mode.toUpperCase() : "";
const runtimeMode: SessionRuntimeMode = declaredMode === "PAPER" || declaredMode === "LIVE" ? declaredMode : "UNKNOWN";
const realizedTrades = buildRealizedTradeRecords(sessionEvents);
const settled = realizedTrades.filter((trade) => trade.status === "WIN" || trade.status === "LOSS");
const wins = settled.filter((trade) => trade.status === "WIN").length;
const losses = settled.filter((trade) => trade.status === "LOSS").length;
const realizedPnl = round(settled.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0), 2);
let runningPnl = 0;
const pnlHistory: PnLPoint[] = [{ time: startedAt, value: 0 }];
for (const trade of settled) {
  runningPnl = round(runningPnl + (trade.pnl ?? 0), 2);
  pnlHistory.push({ time: trade.timestamp, value: runningPnl });
}
const checkpoints = sessionEvents.filter((event) => event.type === "paper_balance.checkpoint");
const startingBalance = asNumber(startup?.payload.paperStartingUsd) ?? asNumber(checkpoints[0]?.payload.balance);
const currentBalance = asNumber(checkpoints.at(-1)?.payload.balance) ?? startingBalance;
const latestTimestamp = sessionEvents.at(-1)?.timestamp ?? startedAt;
const dataAgeSeconds = Math.max(0, Math.round((nowMs - Date.parse(latestTimestamp)) / 1000));
const status = dataAgeSeconds > 20 ? "stale" : dataAgeSeconds > 6 ? "degraded" : "ok";
```

Add these concrete helpers above the exported builder:

```ts
function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function asNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildRealizedTradeRecords(events: TelemetryEvent[]): RealizedTradeRecord[] {
  return events
    .filter((event) => ["paper_trade.buy", "paper_trade.sell", "live_trade.buy", "live_trade.sell", "trade.entry_filled", "trade.exit_filled"].includes(event.type))
    .map((event, index) => {
      const side = (asString(event.payload.side)?.toUpperCase() === "DOWN" ? "DOWN" : "UP") as TradeRow["side"];
      const price = asNumber(event.payload.entryPrice) ?? asNumber(event.payload.exitPrice) ?? asNumber(event.payload.price) ?? 0;
      const pnl = asNumber(event.payload.pnlUsd) ?? asNumber(event.payload.realizedTradePnl);
      const confidence = Math.max(50, Math.min(99, 100 - (asNumber(event.payload.feedLatencyMs) ?? 0) / 35 - (asNumber(event.payload.feedRttMs) ?? 0) / 45));
      const isExit = event.type.includes("sell") || event.type === "trade.exit_filled";
      const status: TradeRow["status"] = !isExit || pnl == null ? "OPEN" : pnl >= 0 ? "WIN" : "LOSS";
      return {
        id: `${event.type}-${event.timestamp}-${index}`,
        timestamp: event.timestamp,
        side,
        price,
        pnl: isExit ? pnl : null,
        confidence: round(confidence, 1),
        status,
        label: isExit ? "FILLED EXIT" : "FILLED ENTRY",
      };
    });
}

function toActivityEvent(event: TelemetryEvent, index: number): ActivityEvent | null {
  const market = asString(event.payload.market) ?? asString(event.payload.slug);
  const amountUsd = asNumber(event.payload.amountUsd) ?? asNumber(event.payload.tradeUsd);
  const pnlUsd = asNumber(event.payload.pnlUsd) ?? asNumber(event.payload.realizedTradePnl) ?? asNumber(event.payload.hypotheticalPnlUsd);
  const detail = asString(event.payload.reason) ?? asString(event.payload.decisionSource) ?? event.type.replace(/[._]/g, " ");
  const base = { id: `${event.type}-${event.timestamp}-${index}`, timestamp: event.timestamp, market, detail, amountUsd, pnlUsd };
  if (["paper_trade.buy", "live_trade.buy", "trade.entry_filled"].includes(event.type)) return { ...base, category: "trade", action: "BUY", tone: "info" };
  if (["paper_trade.sell", "live_trade.sell"].includes(event.type)) return { ...base, category: "trade", action: "SELL", tone: pnlUsd == null ? "warning" : pnlUsd >= 0 ? "positive" : "negative" };
  if (event.type === "trade.exit_filled") return { ...base, category: "settlement", action: "FILL", tone: pnlUsd == null ? "warning" : pnlUsd >= 0 ? "positive" : "negative" };
  if (event.type === "trade.shadow_pnl") return { ...base, category: "settlement", action: "SETTLED", tone: (pnlUsd ?? 0) >= 0 ? "positive" : "negative" };
  if (event.type === "trade.signal_rejected") return { ...base, category: "rejection", action: "REJECT", tone: "negative" };
  if (event.type.includes("gate")) return { ...base, category: "gate", action: "GATE", tone: "warning" };
  if (event.type.startsWith("feed.")) return { ...base, category: "feed", action: "FEED", tone: "warning" };
  return null;
}
```

Finish `buildActiveSessionTelemetry` with an explicit typed summary and newest-first activity list:

```ts
const sessionSummary: SessionSummary = {
  sessionId: latestSessionId,
  startedAt,
  runtimeMode,
  startingBalance,
  currentBalance,
  realizedPnl,
  settledTrades: settled.length,
  wins,
  losses,
  winRate: settled.length ? round((wins / settled.length) * 100, 1) : null,
  pnlHistory,
  dataAgeSeconds,
  status,
};
const activityFeed = sessionEvents
  .map(toActivityEvent)
  .filter((event): event is ActivityEvent => event !== null)
  .reverse();
return { sessionEvents, realizedTrades, sessionSummary, activityFeed };
```

- [ ] **Step 5: Add and run the focused test script**

Add to `package.json`:

```json
"test:ui-session": "tsx tests/ui_session_telemetry.test.ts"
```

Run: `npm run test:ui-session`  
Expected: PASS with exit code 0.

- [ ] **Step 6: Commit the session contract**

```bash
git add PATBv5/src/ui/types.ts PATBv5/src/ui/state/sessionTelemetry.ts PATBv5/newGui/src/types.ts PATBv5/tests/ui_session_telemetry.test.ts PATBv5/package.json
git commit -m "feat: add active session telemetry contract"
```

---

### Task 3: Integrate session telemetry without changing legacy fields

**Files:**
- Modify: `PATBv5/src/ui/state/liveTerminalState.ts`
- Modify: `PATBv5/src/ui/state/mockTerminalState.ts`
- Create: `PATBv5/tests/ui_terminal_contract.test.ts`
- Create: `PATBv5/tests/ui_live_empty_state.test.ts`
- Modify: `PATBv5/package.json`

**Interfaces:**
- Consumes: `createActiveSessionReader()` from Task 1 and `buildActiveSessionTelemetry(events, nowMs)` from Task 2.
- Produces: every `TerminalState` response contains `sessionSummary` and `activityFeed`; legacy properties retain their current calculations.

- [ ] **Step 1: Write the failing terminal contract test**

Create `tests/ui_terminal_contract.test.ts`:

```ts
import assert from "node:assert/strict";
import { buildMockTerminalState } from "../src/ui/state/mockTerminalState";

async function run(): Promise<void> {
  const state = await buildMockTerminalState("live");
  assert.equal(state.meta.sourceMode, "mock");
  assert.ok(state.sessionSummary);
  assert.ok(Array.isArray(state.sessionSummary.pnlHistory));
  assert.ok(Array.isArray(state.activityFeed));
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run it and verify the contract failure**

Run: `npx tsx tests/ui_terminal_contract.test.ts`  
Expected: FAIL at TypeScript/build time or assertion because the mock state does not yet include the two new fields.

Also create `tests/ui_live_empty_state.test.ts`:

```ts
import assert from "node:assert/strict";
import { buildLiveTerminalState } from "../src/ui/state/liveTerminalState";

async function run(): Promise<void> {
  const state = await buildLiveTerminalState();
  assert.equal(state.meta.sourceMode, "mock");
  assert.equal(state.sessionSummary.runtimeMode, "UNKNOWN");
  assert.equal(state.sessionSummary.settledTrades, 0);
  assert.deepEqual(state.activityFeed, []);
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 3: Refactor live state to use the pure builder**

In `liveTerminalState.ts`:

1. Import `dirname` and `resolve` from `node:path`, `createActiveSessionReader` from `./activeSessionReader`, `TelemetryEvent` from `./telemetryEvent`, and `buildActiveSessionTelemetry` plus `buildRealizedTradeRecords` from `./sessionTelemetry`.
2. Remove only the local `TelemetryEvent`, `RealizedTradeRecord`, and `buildRealizedTradeRecords` declarations. Keep `readRecentTelemetryEvents`, `TELEMETRY_TAIL_BYTES`, and `TELEMETRY_MAX_EVENTS` for the legacy response calculations. Start the reader with this missing-file guard:

```ts
let file;
try {
  file = await open(getTelemetryDbPath(), "r");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
  throw error;
}
```
3. Create the module-level active-session reader and use both sources inside `buildLiveTerminalState`:

```ts
const readActiveSessionEvents = createActiveSessionReader(
  resolve(dirname(getTelemetryDbPath()), "sessions"),
  getTelemetryBotId(),
);

// inside buildLiveTerminalState
const recentEvents = await readRecentTelemetryEvents(botId);
const completeSessionEvents = await readActiveSessionEvents();
const events = recentEvents.length ? recentEvents : completeSessionEvents;
```

4. Immediately after the existing legacy `sessionEvents` selection, create the new summary from the complete source while keeping legacy trade calculations on the existing capped source:

```ts
const activeSession = buildActiveSessionTelemetry(
  completeSessionEvents,
  Date.now(),
);
const realizedTrades = buildRealizedTradeRecords(sessionEvents);
```

5. Keep the current legacy `header`, `wallet`, `recentTrades`, and `pnlHistory` assignments intact. They continue using `sessionEvents` from the recent-tail source; only `sessionSummary` and `activityFeed` use the complete per-session file.
6. Add these fields to the returned object:

```ts
sessionSummary: activeSession.sessionSummary,
activityFeed: activeSession.activityFeed,
```

7. Replace the unsafe runtime inference with the explicit summary mode when populating the legacy header:

```ts
const runtimeMode = activeSession.sessionSummary.runtimeMode === "UNKNOWN"
  ? base.header.runtimeMode
  : activeSession.sessionSummary.runtimeMode;
```

The legacy field remains two-valued for compatibility; only the new safety rail exposes `UNKNOWN`.

8. In the no-events branch, do not relabel generated base data as live. Keep `sourceMode: "mock"`, `runtimeMode: "UNKNOWN"`, zero settled trades, and an empty activity feed so `CodexLiveView` takes its safe syncing branch.

- [ ] **Step 4: Extend mock state explicitly**

In `mockTerminalState.ts`, build the mock arrays once and add:

```ts
sessionSummary: {
  sessionId: "mock",
  startedAt: now.toISOString(),
  runtimeMode: liveRequested ? "UNKNOWN" : "PAPER",
  startingBalance: paperBalance,
  currentBalance: paperBalance,
  realizedPnl: 0,
  settledTrades: 0,
  wins: 0,
  losses: 0,
  winRate: null,
  pnlHistory: [{ time: now.toISOString(), value: 0 }],
  dataAgeSeconds: 0,
  status: liveRequested ? "degraded" : "ok",
},
activityFeed: [],
```

The empty activity feed is intentional: the CODEX live page must not present generated events as live.

- [ ] **Step 5: Add and run the integration script**

Add to `package.json`:

```json
"test:ui-contract": "tsx tests/ui_terminal_contract.test.ts",
"test:ui-empty-live": "tsx scripts/run_isolated_test.ts tests/ui_live_empty_state.test.ts"
```

Run: `npm run test:ui-session && npm run test:ui-contract && npm run test:ui-empty-live && npm run build`  
Expected: all commands PASS.

- [ ] **Step 6: Commit the integration**

```bash
git add PATBv5/src/ui/state/liveTerminalState.ts PATBv5/src/ui/state/mockTerminalState.ts PATBv5/tests/ui_terminal_contract.test.ts PATBv5/tests/ui_live_empty_state.test.ts PATBv5/package.json
git commit -m "feat: expose session telemetry in terminal state"
```

---

### Task 4: Add base-aware page routing while preserving the legacy page

**Files:**
- Create: `PATBv5/newGui/src/lib/route.ts`
- Create: `PATBv5/newGui/src/pages/LegacyTerminalPage.tsx`
- Modify: `PATBv5/newGui/src/App.tsx`
- Create: `PATBv5/tests/ui_codex_route.test.ts`
- Modify: `PATBv5/package.json`

**Interfaces:**
- Produces: `resolveTerminalView(pathname, baseUrl): "legacy" | "codex"`.
- Preserves: current terminal composition in `LegacyTerminalPage`.

- [ ] **Step 1: Write the failing route test**

```ts
import assert from "node:assert/strict";
import { resolveTerminalView } from "../newGui/src/lib/route";

assert.equal(resolveTerminalView("/terminal-v5", "/terminal-v5/"), "legacy");
assert.equal(resolveTerminalView("/terminal-v5/", "/terminal-v5/"), "legacy");
assert.equal(resolveTerminalView("/terminal-v5/codex", "/terminal-v5/"), "codex");
assert.equal(resolveTerminalView("/custom/codex", "/custom/"), "codex");
assert.equal(resolveTerminalView("/terminal-v5/unknown", "/terminal-v5/"), "legacy");
```

- [ ] **Step 2: Run and verify the missing module failure**

Run: `npx tsx tests/ui_codex_route.test.ts`  
Expected: FAIL with `Cannot find module '../newGui/src/lib/route'`.

- [ ] **Step 3: Implement exact route normalization**

Create `newGui/src/lib/route.ts`:

```ts
export type TerminalView = "legacy" | "codex";

export function resolveTerminalView(pathname: string, baseUrl: string): TerminalView {
  const normalizedBase = `/${baseUrl.replace(/^\/+|\/+$/g, "")}`;
  const normalizedPath = `/${pathname.replace(/^\/+|\/+$/g, "")}`;
  const relativePath = normalizedPath === normalizedBase
    ? "/"
    : normalizedPath.startsWith(`${normalizedBase}/`)
      ? normalizedPath.slice(normalizedBase.length)
      : normalizedPath;
  return relativePath === "/codex" ? "codex" : "legacy";
}
```

- [ ] **Step 4: Move the existing page without behavior changes**

Create `newGui/src/pages/LegacyTerminalPage.tsx` with the current composition under the new export:

```tsx
import { useMemo } from "react";
import { HeaderBar } from "../components/HeaderBar";
import { LiveTape } from "../components/LiveTape";
import { WalletPanel } from "../components/WalletPanel";
import { MarketPanel } from "../components/MarketPanel";
import { BestTradePanel } from "../components/BestTradePanel";
import { ExecutionCycle } from "../components/ExecutionCycle";
import { ForceGraphPanel } from "../components/ForceGraphPanel";
import { PnlChart } from "../components/PnlChart";
import { RecentTrades } from "../components/RecentTrades";
import { LiveAnalytics } from "../components/LiveAnalytics";
import { useTerminalData } from "../hooks/useTerminalData";
import { useTradeActionSound } from "../hooks/useTradeActionSound";

export function LegacyTerminalPage() {
  const { data, loading, error, stale } = useTerminalData();
  useTradeActionSound(data?.liveTape ?? []);
  const statusLabel = useMemo(() => {
    if (loading) return "SYNCING";
    if (error) return "FAULT";
    if (stale || data?.meta.status === "degraded") return "DEGRADED";
    return "LOCKED";
  }, [data?.meta.status, error, loading, stale]);

  if (!data) {
    return (
      <main className="loading-shell">
        <div className="loading-panel">
          <div className="panel-kicker">PATBv5 TERMINAL GUI</div>
          <h1>{loading ? "Booting terminal shell..." : "State unavailable"}</h1>
          <p>{error || "Waiting for telemetry state."}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="terminal-app">
      <div className="atmosphere-grid" />
      <HeaderBar data={data.header} balance={data.wallet.balance} />
      <div className="mode-rack panel">
        <div className="mode-controls"><span className="mode-button active">LIVE FEED</span></div>
        <div className="mode-status">
          <span className={`badge ${statusLabel === "FAULT" ? "danger" : statusLabel === "DEGRADED" ? "warning" : "positive"}`}>{statusLabel}</span>
          <span>{data.meta.note || "Terminal state online"}</span>
        </div>
      </div>
      <LiveTape items={data.liveTape} />
      <section className="dashboard-grid">
        <WalletPanel data={data.wallet} />
        <MarketPanel candles={data.btcChart} volumeBars={data.btcVolume} orderBook={data.orderBook} btcPrice={data.header.btcPrice} btcChange={data.header.btcChange} />
        <BestTradePanel data={data.bestTrade} />
        <ExecutionCycle data={data.executionCycle} />
        <ForceGraphPanel data={data.forceGraph} />
        <PnlChart points={data.pnlHistory} />
        <RecentTrades trades={data.recentTrades} />
        <LiveAnalytics data={data.analytics} />
      </section>
    </main>
  );
}
```

Do not rename CSS classes or change current copy in this task. This is a mechanical move verified by the client build.

- [ ] **Step 5: Dispatch without introducing an incomplete CODEX page**

Keep `App.tsx` rendering `LegacyTerminalPage` until Task 7 composes the CODEX page. Add the resolver call now and assert that only the legacy branch is reachable until `CodexLivePage` exists:

```tsx
import { LegacyTerminalPage } from "./pages/LegacyTerminalPage";
import { resolveTerminalView } from "./lib/route";

function App() {
  void resolveTerminalView(window.location.pathname, import.meta.env.BASE_URL);
  return <LegacyTerminalPage />;
}

export default App;
```

- [ ] **Step 6: Add and run the route test script**

Add:

```json
"test:ui-route": "tsx tests/ui_codex_route.test.ts"
```

Run: `npm run test:ui-route && npm run ui:build`  
Expected: both PASS and the Vite base remains `/terminal-v5/`.

- [ ] **Step 7: Commit the routing foundation**

```bash
git add PATBv5/newGui/src/lib/route.ts PATBv5/newGui/src/pages/LegacyTerminalPage.tsx PATBv5/newGui/src/App.tsx PATBv5/tests/ui_codex_route.test.ts PATBv5/package.json
git commit -m "refactor: isolate terminal pages"
```

---

### Task 5: Build the CODEX masthead, metrics, and P&L primitives

**Files:**
- Create: `PATBv5/newGui/src/components/codex/CodexMasthead.tsx`
- Create: `PATBv5/newGui/src/components/codex/SessionStatStrip.tsx`
- Create: `PATBv5/newGui/src/components/codex/LiveSessionPnl.tsx`
- Create: `PATBv5/newGui/tests/codex_components.test.tsx`
- Modify: `PATBv5/package.json`

**Interfaces:**
- Consumes: `SessionSummary`, `TerminalMeta`, strategy label.
- Produces: semantic, fetch-free presentational components.

- [ ] **Step 1: Write failing server-render component tests**

Use `renderToStaticMarkup` from the root React dev dependency:

```tsx
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
const unavailableStats = renderToStaticMarkup(<SessionStatStrip summary={unavailable} strategyLabel="TRADE_5X" />);
assert.match(unavailableStats, /—/);
const flatChart = renderToStaticMarkup(<LiveSessionPnl summary={unavailable} />);
assert.match(flatChart, /0,125 1000,125/);
```

- [ ] **Step 2: Run and verify missing component failures**

Run: `npx tsx newGui/tests/codex_components.test.tsx`  
Expected: FAIL on the first missing component import.

- [ ] **Step 3: Implement `CodexMasthead`**

Render a `<header>` with `.codex-wordmark`, fixed `.codex-version`, and a safety rail. Status copy is exact:

```ts
const statusCopy = summary.status === "ok" ? "TELEMETRY LOCKED" : summary.status.toUpperCase();
const modeCopy = summary.runtimeMode === "LIVE" ? "LIVE TRADING" : summary.runtimeMode === "PAPER" ? "PAPER TRADING" : "MODE UNKNOWN";
```

The top-level safety element uses `aria-live="polite"`; the wordmark does not.

- [ ] **Step 4: Implement `SessionStatStrip`**

Use the existing `formatCurrency` and `formatPercent`. Prefix non-negative P&L with `+`. Render an em dash for null win rate and null balances. Include wins/losses beneath settled trades and the strategy label beneath win rate.

- [ ] **Step 5: Implement `LiveSessionPnl`**

Create a deterministic SVG polyline with a neutral baseline for fewer than two points:

```ts
function toPolyline(points: SessionSummary["pnlHistory"], width = 1000, height = 250): string {
  if (points.length < 2) return `0,${height / 2} ${width},${height / 2}`;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  return points.map((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = height - ((point.value - min) / span) * (height - 24) - 12;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}
```

Render `<svg role="img" aria-label="Live session profit and loss curve">` and the current signed P&L as visible text outside the SVG.

- [ ] **Step 6: Add and run the component test script**

Add:

```json
"test:ui-components": "tsx newGui/tests/codex_components.test.tsx"
```

Run: `npm run test:ui-components && npm run ui:build`  
Expected: PASS.

- [ ] **Step 7: Commit the visual primitives**

```bash
git add PATBv5/newGui/src/components/codex/CodexMasthead.tsx PATBv5/newGui/src/components/codex/SessionStatStrip.tsx PATBv5/newGui/src/components/codex/LiveSessionPnl.tsx PATBv5/newGui/tests/codex_components.test.tsx PATBv5/package.json
git commit -m "feat: add codex session overview"
```

---

### Task 6: Add the activity feed and live health panel

**Files:**
- Create: `PATBv5/newGui/src/lib/activityFeed.ts`
- Create: `PATBv5/newGui/src/components/codex/CodexActivityFeed.tsx`
- Create: `PATBv5/newGui/src/components/codex/CodexLiveHealth.tsx`
- Create: `PATBv5/tests/ui_codex_activity.test.ts`
- Modify: `PATBv5/package.json`

**Interfaces:**
- Produces: `filterActivityFeed(events, filter)` and `nextFeedTab(current, key)`.
- Consumes: `ActivityEvent[]`, current filter, `TerminalState.analytics`, strategy label.

- [ ] **Step 1: Write failing pure behavior tests**

```ts
import assert from "node:assert/strict";
import { filterActivityFeed, nextFeedTab } from "../newGui/src/lib/activityFeed";
import type { ActivityEvent } from "../newGui/src/types";

const base = { timestamp: "2026-07-16T21:00:00.000Z", market: null, detail: "event", amountUsd: null, pnlUsd: null };
const events: ActivityEvent[] = [
  { ...base, id: "trade", category: "trade", action: "BUY", tone: "info" },
  { ...base, id: "reject", category: "rejection", action: "REJECT", tone: "negative" },
  { ...base, id: "feed", category: "feed", action: "FEED", tone: "warning" },
];

assert.deepEqual(filterActivityFeed(events, "trades").map((event) => event.id), ["trade", "reject"]);
assert.deepEqual(filterActivityFeed(events, "all").map((event) => event.id), ["trade", "reject", "feed"]);
assert.equal(nextFeedTab("trades", "ArrowRight"), "all");
assert.equal(nextFeedTab("all", "ArrowLeft"), "trades");
assert.equal(nextFeedTab("all", "Home"), "trades");
assert.equal(nextFeedTab("trades", "End"), "all");
```

- [ ] **Step 2: Run and verify the missing helper failure**

Run: `npx tsx tests/ui_codex_activity.test.ts`  
Expected: FAIL with missing `activityFeed` module.

- [ ] **Step 3: Implement feed filtering and tab navigation**

```ts
import type { ActivityEvent } from "../types";

export type ActivityFilter = "trades" | "all";

export function filterActivityFeed(events: ActivityEvent[], filter: ActivityFilter): ActivityEvent[] {
  return filter === "all" ? events : events.filter((event) => event.category !== "feed");
}

export function nextFeedTab(current: ActivityFilter, key: string): ActivityFilter {
  if (key === "Home") return "trades";
  if (key === "End") return "all";
  if (key === "ArrowLeft" || key === "ArrowRight") return current === "trades" ? "all" : "trades";
  return current;
}
```

- [ ] **Step 4: Implement `CodexActivityFeed`**

Use two `<button role="tab">` controls inside `role="tablist"`. Store the active filter in local state, set `aria-selected`, and on `ArrowLeft`, `ArrowRight`, `Home`, or `End`, call `nextFeedTab`, update state, and focus the selected tab. Render the filtered events in an ordered list with `<time dateTime={event.timestamp}>`; missing amount/P&L renders `—`. Empty output reads `NO SESSION ACTIVITY YET`.

- [ ] **Step 5: Implement `CodexLiveHealth`**

Render data age, runtime mode, strategy, feed RTT, and latency. Find analytics values by labels `FEED RTT` and `LATENCY`; when absent show an em dash. Do not infer websocket lock from color: render summary status as text.

- [ ] **Step 6: Add and run the activity test script**

Add:

```json
"test:ui-activity": "tsx tests/ui_codex_activity.test.ts"
```

Run: `npm run test:ui-activity && npm run ui:build`  
Expected: PASS.

- [ ] **Step 7: Commit activity and health components**

```bash
git add PATBv5/newGui/src/lib/activityFeed.ts PATBv5/newGui/src/components/codex/CodexActivityFeed.tsx PATBv5/newGui/src/components/codex/CodexLiveHealth.tsx PATBv5/tests/ui_codex_activity.test.ts PATBv5/package.json
git commit -m "feat: add codex activity feed"
```

---

### Task 7: Compose the CODEX live page and activate the route

**Files:**
- Create: `PATBv5/newGui/src/components/codex/AdvancedTelemetryStack.tsx`
- Create: `PATBv5/newGui/src/components/codex/CodexLiveView.tsx`
- Create: `PATBv5/newGui/src/pages/CodexLivePage.tsx`
- Modify: `PATBv5/newGui/src/App.tsx`
- Extend: `PATBv5/newGui/tests/codex_components.test.tsx`

**Interfaces:**
- `CodexLiveView({ data, error, stale })` is fetch-free and testable.
- `CodexLivePage()` owns the single `useTerminalData()` call.
- `AdvancedTelemetryStack({ data })` reuses existing market, execution, force-graph, recent-trade, and analytics components.

- [ ] **Step 1: Extend component tests with live, mock, and error boundaries**

Import `buildMockTerminalState` and create the complete state from the existing builder, then override only the fields that distinguish an authoritative live response:

```tsx
import { buildMockTerminalState } from "../../src/ui/state/mockTerminalState";
import { CodexLiveView } from "../src/components/codex/CodexLiveView";

async function runCompositionTests(): Promise<void> {
  const baseState = await buildMockTerminalState("live");
  const liveState = {
    ...baseState,
    meta: { ...baseState.meta, sourceMode: "live" as const, status: "ok" as const },
    sessionSummary: summary,
    activityFeed: [],
  };
const liveMarkup = renderToStaticMarkup(<CodexLiveView data={liveState} error={null} stale={false} />);
assert.match(liveMarkup, /CODEX/);
assert.match(liveMarkup, /TRADE FEED/);
assert.match(liveMarkup, /BTC MARKET/);

const retainedErrorMarkup = renderToStaticMarkup(<CodexLiveView data={liveState} error="poll failed" stale={true} />);
assert.match(retainedErrorMarkup, /POLL FAILED/i);
assert.match(retainedErrorMarkup, /CODEX/);

const mockMarkup = renderToStaticMarkup(<CodexLiveView data={{ ...liveState, meta: { ...liveState.meta, sourceMode: "mock" } }} error={null} stale={false} />);
assert.match(mockMarkup, /SYNCING TELEMETRY/);
assert.doesNotMatch(mockMarkup, /SESSION P&amp;L/);

const errorMarkup = renderToStaticMarkup(<CodexLiveView data={null} error="Terminal API failed: 500" stale={false} />);
assert.match(errorMarkup, /TERMINAL API FAILED: 500/i);

}

void runCompositionTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run and verify missing composition failures**

Run: `npm run test:ui-components`  
Expected: FAIL on missing `CodexLiveView`.

- [ ] **Step 3: Implement the advanced stack**

`AdvancedTelemetryStack` renders these existing components in this exact order and passes existing props unchanged:

```tsx
<section className="codex-advanced-grid" aria-label="Advanced telemetry">
  <MarketPanel candles={data.btcChart} volumeBars={data.btcVolume} orderBook={data.orderBook} btcPrice={data.header.btcPrice} btcChange={data.header.btcChange} />
  <ExecutionCycle data={data.executionCycle} />
  <ForceGraphPanel data={data.forceGraph} />
  <RecentTrades trades={data.recentTrades} />
  <LiveAnalytics data={data.analytics} />
</section>
```

- [ ] **Step 4: Implement the presentational state boundary**

`CodexLiveView` behavior is exact:

```tsx
if (!data) {
  return <main className="codex-live codex-state-shell" aria-live="polite"><h1>CODEX</h1><p>{error ?? "SYNCING TELEMETRY"}</p></main>;
}
if (data.meta.sourceMode !== "live") {
  return <main className="codex-live codex-state-shell" aria-live="polite"><h1>CODEX</h1><p>SYNCING TELEMETRY</p><span>LIVE SOURCE NOT AVAILABLE</span></main>;
}
```

For live data, render masthead, stats, P&L, a two-column activity/health region, then the advanced stack. If `error` exists with retained data, show it in a fault banner without hiding the snapshot. Pass `stale || data.sessionSummary.status === "stale"` to the masthead presentation.

- [ ] **Step 5: Implement the polling wrapper and activate the route**

```tsx
// pages/CodexLivePage.tsx
import { CodexLiveView } from "../components/codex/CodexLiveView";
import { useTerminalData } from "../hooks/useTerminalData";

export function CodexLivePage() {
  const { data, error, stale } = useTerminalData();
  return <CodexLiveView data={data} error={error} stale={stale} />;
}
```

Replace `App.tsx` with:

```tsx
import { resolveTerminalView } from "./lib/route";
import { CodexLivePage } from "./pages/CodexLivePage";
import { LegacyTerminalPage } from "./pages/LegacyTerminalPage";

function App() {
  const view = resolveTerminalView(window.location.pathname, import.meta.env.BASE_URL);
  return view === "codex" ? <CodexLivePage /> : <LegacyTerminalPage />;
}

export default App;
```

- [ ] **Step 6: Run component, route, and build checks**

Run: `npm run test:ui-components && npm run test:ui-route && npm run ui:build`  
Expected: PASS.

- [ ] **Step 7: Commit the composed view**

```bash
git add PATBv5/newGui/src/components/codex/AdvancedTelemetryStack.tsx PATBv5/newGui/src/components/codex/CodexLiveView.tsx PATBv5/newGui/src/pages/CodexLivePage.tsx PATBv5/newGui/src/App.tsx PATBv5/newGui/tests/codex_components.test.tsx
git commit -m "feat: compose codex live terminal"
```

---

### Task 8: Apply the approved visual system and complete verification

**Files:**
- Create: `PATBv5/newGui/tokens.css`
- Create: `PATBv5/newGui/src/styles/codex.css`
- Modify: `PATBv5/newGui/src/main.tsx`
- Create: `PATBv5/.hallmark/log.json`
- Modify: `PATBv5/package.json`

**Interfaces:**
- Produces: scoped `.codex-live` layout and tokens used by every CODEX component.
- Does not modify: `theme.css`, `layout.css`, or `effects.css` rules for the legacy page.

- [ ] **Step 1: Create portable CODEX tokens**

Create `newGui/tokens.css` with this first-line Hallmark stamp and token set:

```css
/* Hallmark · macrostructure: Stat-Led · theme: studied-DNA (source: image) · studied: yes · DNA-source: user reference */
:root {
  --color-codex-coal: oklch(12% 0.012 55);
  --color-codex-char: oklch(15% 0.015 55);
  --color-codex-plate: oklch(18% 0.02 55);
  --color-codex-rule: oklch(68% 0.12 52 / 18%);
  --color-codex-rule-strong: oklch(68% 0.12 52 / 42%);
  --color-codex-ember: oklch(68% 0.2 52);
  --color-codex-phosphor: oklch(78% 0.15 60);
  --color-codex-settled: oklch(77% 0.15 154);
  --color-codex-fault: oklch(66% 0.18 25);
  --color-codex-bone: oklch(84% 0.045 70);
  --color-codex-ash: oklch(52% 0.025 65);
  --font-codex-display: "Jersey 10", Impact, sans-serif;
  --font-codex-data: "IBM Plex Mono", Consolas, monospace;
  --space-codex-1: 4px;
  --space-codex-2: 8px;
  --space-codex-3: 12px;
  --space-codex-4: 16px;
  --space-codex-5: 20px;
  --space-codex-6: 24px;
  --text-codex-label: 0.6875rem;
  --text-codex-data: 0.8125rem;
  --text-codex-metric: clamp(2rem, 4vw, 3.25rem);
  --ease-codex-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-codex-fast: 120ms;
  --dur-codex-state: 180ms;
  --rule-codex: 1px;
  --radius-codex: 0;
}
```

- [ ] **Step 2: Implement the scoped layout and states**

Create `newGui/src/styles/codex.css`. Its first non-empty line must be the same Hallmark stamp. Include these complete structural rules, then add component-local selectors required by the final rendered class names:

```css
/* Hallmark · macrostructure: Stat-Led · theme: studied-DNA (source: image) · studied: yes · DNA-source: user reference */
.codex-live {
  min-height: 100vh;
  padding: var(--space-codex-4);
  background: var(--color-codex-coal);
  color: var(--color-codex-bone);
  font-family: var(--font-codex-data);
}
.codex-shell { border: var(--rule-codex) solid var(--color-codex-rule); background: var(--color-codex-char); }
.codex-chrome { display: flex; min-height: 28px; align-items: center; padding: 0 var(--space-codex-3); border-bottom: 1px solid var(--color-codex-rule); color: var(--color-codex-ash); }
.codex-masthead { padding: clamp(2rem, 6vw, 4.5rem) var(--space-codex-5); text-align: center; border-bottom: 1px solid var(--color-codex-rule); }
.codex-wordmark { color: var(--color-codex-ember); font-family: var(--font-codex-display); font-size: clamp(4rem, 12vw, 10rem); line-height: 0.8; letter-spacing: 0.06em; text-shadow: 0 0 8px oklch(68% 0.2 52 / 55%); }
.codex-version { margin-top: var(--space-codex-6); color: var(--color-codex-phosphor); font-size: var(--text-codex-label); letter-spacing: 0.36em; }
.codex-safety { display: grid; grid-template-columns: 1fr auto 1fr; gap: var(--space-codex-3); padding: var(--space-codex-3) var(--space-codex-4); border-bottom: 1px solid var(--color-codex-rule); color: var(--color-codex-ash); font-size: var(--text-codex-label); }
.codex-safety[data-status="ok"] { color: var(--color-codex-settled); }
.codex-safety[data-status="degraded"] { color: var(--color-codex-phosphor); }
.codex-safety[data-status="stale"] { color: var(--color-codex-fault); }
.codex-stat-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-bottom: 1px solid var(--color-codex-rule); }
.codex-stat { padding: var(--space-codex-6); border-right: 1px solid var(--color-codex-rule); background: var(--color-codex-plate); }
.codex-stat:last-child { border-right: 0; }
.codex-stat strong { display: block; margin-top: var(--space-codex-2); color: var(--color-codex-phosphor); font-size: var(--text-codex-metric); font-variant-numeric: tabular-nums; }
.codex-pnl { min-height: 320px; padding: var(--space-codex-5); border-bottom: 1px solid var(--color-codex-rule); }
.codex-pnl svg { width: 100%; height: 250px; }
.codex-pnl polyline { fill: none; stroke: var(--color-codex-ember); stroke-width: 3; vector-effect: non-scaling-stroke; }
.codex-activity-region { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(260px, 0.75fr); border-bottom: 1px solid var(--color-codex-rule); }
.codex-activity, .codex-health { padding: var(--space-codex-5); }
.codex-activity { border-right: 1px solid var(--color-codex-rule); }
.codex-tabs { display: flex; gap: var(--space-codex-5); }
.codex-tab { border: 0; border-bottom: 1px solid transparent; background: transparent; color: var(--color-codex-ash); padding: var(--space-codex-2) 0; }
.codex-tab[aria-selected="true"] { border-color: var(--color-codex-ember); color: var(--color-codex-bone); }
.codex-event { display: grid; grid-template-columns: 80px 110px minmax(180px, 1fr) 90px 90px; gap: var(--space-codex-2); padding: var(--space-codex-3) var(--space-codex-2); border-bottom: 1px dotted var(--color-codex-rule); animation: codex-row-in var(--dur-codex-state) var(--ease-codex-out); }
.codex-event[data-tone="positive"] { color: var(--color-codex-settled); }
.codex-event[data-tone="negative"] { color: var(--color-codex-fault); }
.codex-event[data-tone="warning"] { color: var(--color-codex-phosphor); }
.codex-advanced-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-codex-3); padding-top: var(--space-codex-3); }
.codex-advanced-grid .panel { border-color: var(--color-codex-rule); box-shadow: none; }
.codex-fault-banner { padding: var(--space-codex-3) var(--space-codex-4); border: 1px solid var(--color-codex-fault); color: var(--color-codex-fault); }
.codex-tab:focus-visible { outline: 2px solid var(--color-codex-phosphor); outline-offset: 4px; }
@keyframes codex-row-in { from { opacity: 0; } to { opacity: 1; } }
@media (max-width: 850px) {
  .codex-safety, .codex-stat-strip, .codex-activity-region { grid-template-columns: 1fr; }
  .codex-stat, .codex-activity { border-right: 0; border-bottom: 1px solid var(--color-codex-rule); }
  .codex-event { grid-template-columns: 64px 90px 1fr; }
  .codex-event__amount, .codex-event__pnl { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .codex-event { animation-duration: 150ms; }
}
```

- [ ] **Step 3: Import styles without disturbing the legacy order**

Append these imports after the existing three imports in `newGui/src/main.tsx`:

```ts
import "../tokens.css";
import "./styles/codex.css";
```

- [ ] **Step 4: Record Hallmark design memory**

Create `PATBv5/.hallmark/log.json`:

```json
[
  {
    "date": "2026-07-16",
    "macrostructure": "Stat-Led",
    "theme": "studied-DNA",
    "enrichment": "none",
    "brief": "CODEX live telemetry terminal with amber masthead, session P&L, activity feed, and advanced diagnostics"
  }
]
```

- [ ] **Step 5: Consolidate focused UI tests into the main suite**

Add:

```json
"test:ui-codex": "npm run test:ui-session-reader && npm run test:ui-session && npm run test:ui-contract && npm run test:ui-empty-live && npm run test:ui-route && npm run test:ui-components && npm run test:ui-activity"
```

Insert `npm run test:ui-codex` into `test:all` before report tests.

- [ ] **Step 6: Run automated verification**

Run from `PATBv5`:

```bash
npm run test:ui-codex
npm run build
npm run ui:build
```

Expected: every command exits 0; Vite emits `newGui/dist/index.html` and hashed assets.

- [ ] **Step 7: Verify both routes and live safety behavior**

Start the built UI with `npm run start:ui`, then verify:

```powershell
curl.exe -I http://localhost:4175/terminal-v5
curl.exe -I http://localhost:4175/terminal-v5/codex
curl.exe http://localhost:4175/terminal-v5/api/state?mode=live
```

Expected: both pages return HTTP 200; the API response includes `sessionSummary` and `activityFeed`. In the browser, `/terminal-v5` retains the current green terminal and `/terminal-v5/codex` shows CODEX / VERSION 5.6 SOL. When the API reports `sourceMode: mock`, the CODEX page shows `SYNCING TELEMETRY` instead of metrics.

- [ ] **Step 8: Perform visual and accessibility checks**

At desktop and a viewport below 850 px, verify:

- masthead, safety rail, metric hierarchy, P&L, feed, health, and advanced panels follow the approved mockup;
- LIVE/PAPER/UNKNOWN and stale status are visible as text;
- tab focus is visible and arrow keys change tabs;
- no horizontal overflow appears;
- reduced-motion mode removes spatial animation;
- muted text remains legible and no glow is applied to body text.

- [ ] **Step 9: Run the Hallmark slop test and fix every failure**

Load `C:/Projects/lkcsite/.agents/skills/hallmark/references/slop-test.md`, evaluate all 58 gates for the terminal genre, and adjust `codex.css` until the result is `58 / 58`.

- [ ] **Step 10: Update the codebase graph**

Run from `C:\Projects\lkcsite`:

```powershell
graphify . --backend nvidia --update
```

Expected: `graphify-out/graph.json` and `graphify-out/GRAPH_REPORT.md` include `buildActiveSessionTelemetry`, `CodexLivePage`, and the CODEX components.

- [ ] **Step 11: Commit the finished terminal**

```bash
git add PATBv5/newGui/tokens.css PATBv5/newGui/src/styles/codex.css PATBv5/newGui/src/main.tsx PATBv5/.hallmark/log.json PATBv5/package.json graphify-out/graph.json graphify-out/GRAPH_REPORT.md
git commit -m "style: finish codex live terminal"
```

---

## Final Verification Checklist

- [ ] `npm run test:ui-codex`
- [ ] `npm run build`
- [ ] `npm run ui:build`
- [ ] `/terminal-v5` unchanged
- [ ] `/terminal-v5/codex` direct navigation and refresh succeed
- [ ] real active-session P&L, counts, win rate, and activity only
- [ ] no cross-session checkpoints or capped-summary calculations
- [ ] LIVE/PAPER/UNKNOWN, degraded, stale, and retained-data error states verified
- [ ] desktop and narrow viewport verified
- [ ] keyboard tabs and focus ring verified
- [ ] Hallmark slop test `58 / 58`
- [ ] Graphify outputs updated
