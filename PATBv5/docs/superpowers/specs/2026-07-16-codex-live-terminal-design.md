# CODEX Live Terminal Design

Date: 2026-07-16  
Status: Approved for implementation planning

## Objective

Add a separate, real-time operator view to the existing PATBv5 terminal UI. The new view adopts the design DNA of the supplied retro trading-terminal reference while using only PATBv5 telemetry and preserving the existing dashboard unchanged.

The new page lives at `/codex`. The existing page remains at `/`.

## Approved product decisions

- The page monitors only the active session in real time. It is not a historical session viewer.
- The primary identity is `CODEX`.
- The fixed subtitle is `VERSION 5.6 SOL`.
- The first viewport follows the approved reference-first layout: masthead, safety state, three session metrics, live P&L curve, then activity feed.
- Existing advanced panels continue below the first viewport.
- The original dashboard remains visually and behaviorally unchanged.
- The page reuses the existing live telemetry request and one-second polling loop. It does not add a database or a second polling channel.

## Design DNA

### Structure

The closest Hallmark macrostructure is **Stat-Led**, adapted for an operational terminal rather than a marketing page. The masthead establishes identity, but session metrics and the P&L trace carry the information hierarchy.

Desktop order:

1. Minimal window chrome and telemetry timestamp
2. `CODEX` masthead
3. `VERSION 5.6 SOL`
4. Safety rail: telemetry health, LIVE/PAPER/UNKNOWN, session identifier, and data age
5. Three-metric strip: session P&L, settled trades, and win rate
6. Live session P&L curve
7. Activity area with `TRADE FEED` and `ALL LOGS`
8. Live health summary
9. BTC market and order book
10. Execution cycle and diagnostic gates
11. Force graph
12. Recent trades and analytics

Below 850 px, the metric strip, activity area, and advanced panels collapse to one column without changing their semantic order.

### Visual system

The interface should feel like a dense, vigilant command console used by an operator who needs to verify profit, execution mode, and feed health in seconds.

Depth uses borders and small same-hue surface shifts only. The new page does not use floating cards, large radii, decorative gradients, or dramatic shadows.

Suggested tokens:

| Role | Token | Value |
| --- | --- | --- |
| Canvas | `--codex-coal` | `oklch(12% 0.012 55)` |
| Base surface | `--codex-char` | `oklch(15% 0.015 55)` |
| Raised surface | `--codex-plate` | `oklch(18% 0.020 55)` |
| Primary accent | `--codex-ember` | `oklch(68% 0.20 52)` |
| Highlight | `--codex-phosphor` | `oklch(78% 0.15 60)` |
| Success/settled | `--codex-settled` | `oklch(77% 0.15 154)` |
| Fault/loss | `--codex-fault` | `oklch(66% 0.18 25)` |
| Primary text | `--codex-bone` | `oklch(84% 0.045 70)` |
| Muted text | `--codex-ash` | `oklch(52% 0.025 65)` |

Typography roles:

- Masthead: pixel-display role, with `Jersey 10` as the preferred candidate and a heavy system fallback.
- Telemetry, labels, controls, and tables: `IBM Plex Mono`, then `Consolas`, then monospace.
- Numeric values use tabular figures.
- `CODEX` may use a restrained amber underglow. Body text and metrics do not glow.

Spacing uses a 4 px base. Corners remain square. Borders stay quiet until hover, focus, warning, or fault states require emphasis.

### Motion and interaction

Motion is informational and limited to three primitives:

- P&L path updates when a new point arrives.
- New feed rows enter with a short opacity transition.
- Health-state changes crossfade between semantic colors.

There is no decorative pulsing. With `prefers-reduced-motion: reduce`, all three become immediate or opacity-only transitions of at most 150 ms.

`TRADE FEED` and `ALL LOGS` are real tab controls with keyboard navigation and visible focus. The page does not auto-scroll the browser when new events arrive. The activity list keeps its newest event at the top.

## Application architecture

### Route isolation

`newGui/src/App.tsx` becomes a small path dispatcher:

- `/` renders the current terminal page.
- `/codex` renders `CodexLivePage`.

No router dependency is required. The UI server must serve the same built `index.html` for `/codex` so direct navigation and refresh work.

The current `App` body should move to a legacy page component with behavior preserved. Shared panels remain shared components.

All new styles are scoped beneath `.codex-live`. Existing theme, layout, and effect styles must not be rewritten or globally overridden.

### New view components

- `CodexLivePage`: page composition and state boundaries
- `CodexMasthead`: identity, timestamp, and safety rail
- `SessionStatStrip`: the three canonical session metrics
- `LiveSessionPnl`: cumulative realized session P&L curve
- `CodexActivityFeed`: normalized activity with the two approved filters
- `CodexLiveHealth`: websocket, latency, strategy, and risk-guard summary
- `AdvancedTelemetryStack`: composes existing market, execution, force-graph, trades, and analytics panels

Components consume a single `TerminalState`; they do not fetch independently.

## Telemetry contract

The current contract contains fields named `pnl30d` and `trades30d`, while the live-state builder derives portions of them from the active session and portions from limited recent data. The CODEX page must not relabel those fields as complete session metrics.

Add an explicit, backwards-compatible session contract:

```ts
type SessionRuntimeMode = "PAPER" | "LIVE" | "UNKNOWN";

interface SessionSummary {
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
  status: "ok" | "degraded" | "stale";
}

type ActivityCategory =
  | "trade"
  | "settlement"
  | "rejection"
  | "gate"
  | "feed";

interface ActivityEvent {
  id: string;
  timestamp: string;
  category: ActivityCategory;
  action: "BUY" | "SELL" | "FILL" | "SETTLED" | "REJECT" | "GATE" | "FEED";
  market: string | null;
  detail: string;
  amountUsd: number | null;
  pnlUsd: number | null;
  tone: TapeTone;
}
```

`TerminalState` gains:

```ts
sessionSummary: SessionSummary;
activityFeed: ActivityEvent[];
```

Existing fields remain in place for the original dashboard.

### Session calculation rules

1. Select the newest telemetry session and filter every calculation to that exact `sessionId`.
2. Build metrics from all realized trade records in the selected session, not only the rows shown in `recentTrades`.
3. `settledTrades = wins + losses`.
4. `winRate = wins / settledTrades * 100`; when no trades are settled it is `null`, displayed as an em dash.
5. `realizedPnl` is the sum of realized P&L for all settled records in the session.
6. The P&L curve starts at zero and accumulates realized session P&L in chronological order. It must not include checkpoints from another session.
7. Balance values are optional. Use session-scoped balance telemetry when present; otherwise return `null` and display an em dash.
8. Runtime mode comes only from explicit telemetry for the active session. Absence of a PAPER marker must never be interpreted as LIVE. When authoritative mode data is unavailable, return `UNKNOWN`.
9. `dataAgeSeconds` is based on the newest event in the active session.
10. The activity feed is normalized from real telemetry events and sorted newest first. The live response may cap it to a practical upper bound, but summary calculations use the full session.

### Feed filters

`TRADE FEED` includes trade, fill, settlement, rejection, and gate events. `ALL LOGS` includes those categories plus feed and health events.

Every feed row preserves the source event timestamp and a stable event-derived identifier. Missing amounts or P&L render as an em dash. The live page never substitutes mock values when live telemetry is empty.

## Loading, empty, stale, and error behavior

- Initial load with no snapshot: show `SYNCING TELEMETRY` in the terminal shell.
- Successful snapshot with no settled trades: show zero trades, an em dash for win rate, zero P&L, and a neutral chart baseline.
- Poll failure after previous success: retain the last snapshot and expose the real error while the data-age counter continues.
- Degraded data: amber safety state.
- Stale data: red safety state and `STALE`; no part of the screen may imply that execution data is current.
- Unknown runtime mode: show `MODE UNKNOWN` in amber. Do not infer LIVE.
- Initial API failure with no snapshot: show a fault panel with the returned error message and continue polling.

## Accessibility

- Semantic headings and regions identify masthead, metrics, P&L, activity, and advanced diagnostics.
- Tabs use `role="tablist"`, `role="tab"`, `aria-selected`, arrow-key navigation, and visible `:focus-visible` treatment.
- Color is not the only indicator for LIVE/PAPER, stale, win/loss, or health state; text labels are always present.
- Body text and muted text must remain readable against the dark surfaces.
- Rapid activity updates are not announced wholesale to screen readers. Only the high-level telemetry status may use a polite live region.

## Verification strategy

### State-builder tests

- Summary includes all settled trades in the active session even when `recentTrades` is capped.
- Events and checkpoints from older sessions do not affect metrics or the P&L curve.
- Win/loss counts, realized P&L, and win rate are correct.
- No settled trades produces `winRate: null` and a neutral P&L baseline.
- Explicit PAPER and LIVE modes pass through correctly.
- Missing mode produces `UNKNOWN`, never an inferred LIVE state.
- Activity mapping covers trade, settlement, rejection, gate, and feed categories.
- Balance fields remain null when the session has no authoritative balance telemetry.

### UI tests

- `/` renders the existing terminal page.
- `/codex` renders the new CODEX page.
- Direct navigation and refresh on `/codex` return the UI shell.
- Initial loading, empty, degraded, stale, retained-data error, and initial-fault states render correctly.
- Tabs filter events and support keyboard navigation.
- LIVE, PAPER, and UNKNOWN labels are visually and textually distinct.
- The responsive layout preserves information order below 850 px.

### Build checks

- Root TypeScript build succeeds.
- `newGui` TypeScript/Vite build succeeds.
- Existing UI/state tests remain green.
- The final page receives a desktop and narrow-viewport visual pass against the approved mockup.

## Acceptance criteria

The feature is complete when:

- The existing dashboard is unchanged at `/`.
- `/codex` presents the approved CODEX / VERSION 5.6 SOL hierarchy.
- All headline metrics and chart points come from the complete active session.
- The activity feed contains normalized real telemetry rather than placeholder values.
- LIVE/PAPER/UNKNOWN, freshness, degraded, and stale states are always explicit.
- Advanced telemetry panels remain available below the activity area.
- Direct route refresh, responsive behavior, accessibility states, tests, and both builds pass.

## Explicit non-goals

- Historical session browsing
- Database changes
- Bot execution controls
- Strategy configuration editing
- Changes to the existing dashboard design
- Reproduction of third-party branding, copy, or fictional values from the reference
