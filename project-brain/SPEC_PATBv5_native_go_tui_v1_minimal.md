# PATBv5 Native Go TUI v1 Minimal Spec

## 1. Objective

Create a **native Go terminal dashboard** for `PATBv5` that reads one telemetry JSONL session in real time and renders a **single read-only view**.

This v1 is for:

- realtime monitoring
- PAPER validation
- feed debugging
- readiness visibility

This v1 is **not** for:

- editing config
- controlling the bot
- placing or canceling orders
- replacing every existing review script

---

## 2. Scope

This version must stay intentionally small.

Included in v1:

- single dashboard view
- realtime JSONL tailing
- `--telemetry-file <path>`
- `--session-id latest`
- header summary
- feed health summary
- trades/signals summary
- simple readiness summary
- latest important events
- explicit warning if LIVE events are detected

Not included in v1:

- multi-view navigation
- auto-switch to newer session
- previous/next session browsing
- bucket analysis tables
- gateway `/health` integration
- theme system
- emoji support
- compact mode
- spread/slippage metrics unless later proven reliable from telemetry

---

## 3. Stack

Use:

- Go
- Bubble Tea
- Lip Gloss

Do not use:

- web UI
- browser UI
- Python TUI
- Node/Ink

Reason:

- standalone Windows binary
- low runtime overhead
- stable terminal rendering
- easy distribution as `patbv5-tui.exe`

---

## 4. Binary

Binary name:

```text
patbv5-tui
```

Supported CLI:

```powershell
patbv5-tui --telemetry-file "C:\Projects\lkcsite\polydb\telemetry\sessions\...\session.jsonl"
patbv5-tui --session-id latest
patbv5-tui --session-id latest --refresh-ms 2000
```

Rules:

- if `--telemetry-file` is provided, use it directly
- else if `--session-id latest` is provided, resolve the newest session JSONL file
- else fail with a clear usage error

Default:

```text
--refresh-ms 2000
```

No other flags are required in v1.

---

## 5. Project Location

Place the tool inside the existing repo:

```text
tools/patbv5-tui/
```

Suggested structure:

```text
tools/patbv5-tui/
  cmd/
    patbv5-tui/
      main.go
  internal/
    args/
      args.go
    sessions/
      resolver.go
    telemetry/
      reader.go
      parser.go
      types.go
    metrics/
      aggregator.go
      readiness.go
    ui/
      app.go
      model.go
      view.go
      format.go
  testdata/
    empty.jsonl
    malformed.jsonl
    no-trades.jsonl
    fallback-heavy.jsonl
    live-warning.jsonl
  go.mod
  go.sum
  README.md
```

---

## 6. Data Source

Primary input:

```text
polydb/telemetry/sessions/*.jsonl
```

The TUI reads one session file only.

For v1:

- `latest` means the newest JSONL file found under `polydb/telemetry/sessions`
- the TUI does not auto-switch if a newer file appears later

This keeps behavior deterministic and light.

---

## 7. Realtime Reader

The reader must behave like a safe JSONL `tail -f`.

Required behavior:

- open file read-only
- read from beginning on startup
- keep `lastOffset`
- read appended bytes on each tick
- parse only complete newline-terminated lines
- hold incomplete final line in memory
- skip malformed JSON safely
- count parse warnings
- never write or lock the file

Implementation model:

```go
lastOffset int64
partialLineBuffer string
parseWarningCount int
```

Loop behavior:

```text
1. Read appended bytes from last offset.
2. Append to partial buffer.
3. Split on newline.
4. Parse only complete lines.
5. Keep final incomplete fragment buffered.
6. Send parsed events to aggregator.
7. Redraw dashboard.
```

---

## 8. Safety

This tool is strictly read-only.

It must never:

- place orders
- cancel orders
- enable LIVE
- modify config
- write to telemetry
- delete telemetry
- stop or start the bot

The only allowed runtime actions are:

- reading telemetry files
- resolving a session file path
- rendering terminal output

---

## 9. Single-View Layout

The UI is one fixed dashboard view.

Recommended sections:

1. Header
2. Feed Health
3. Trades and Signals
4. Readiness
5. Recent Important Events

Example shape:

```text
PATBv5 Native TUI v1        Mode: PAPER        Verdict: NOT READY
Session: f12246b8...        Refresh: 2s        Parse warnings: 0
File: ...\2026-06-18T05-09-49-598Z__f12246b8....jsonl

Feed
Fallbacks: 607   Recoveries: 114   PerMarket: 11.9
AvgRecoveryMs: 3266.9   MaxRecoveryMs: 106944
Top reasons: subscription_missing=276 stale_snapshot=169 reconnect_pending=81 ws_closed=81

Trades / Signals
Paper buys: 0   Paper sells: 0   Live buys: 0   Live sells: 0
Momentum events: 811   MonteCarlo events: 3460
Top rejects: up_bias_filter=14568 entry_price_window=8955 down_blocked_neutral_momentum=2209

Readiness
[PASS] Momentum events present
[PASS] Monte Carlo events present
[FAIL] Fallback events per market <= 2
[FAIL] Avg fallback recovery <= 1000ms
[FAIL] Max fallback recovery <= 5000ms

Recent events
09:15:24 feed.error EE certificate key too weak
09:15:24 feed.disconnected close_1006
09:15:24 feed.reconnect_scheduled socket_error
```

---

## 10. Header Section

Show:

- bot id if available
- session id
- telemetry file path
- strategy version id if available
- bot build version id if available
- mode: `PAPER`, `LIVE`, or `UNKNOWN`
- refresh interval
- parse warning count
- overall readiness verdict

Mode rules:

- if any `live_trade.*` event appears, mark mode warning clearly
- if only `paper_trade.*` appears, show `PAPER`
- otherwise `UNKNOWN`

---

## 11. Feed Section

Only include metrics already derivable from current telemetry.

Show:

- fallback events
- fallback recoveries
- fallback events per market
- average fallback recovery ms
- max fallback recovery ms
- fallback reason breakdown
- latest RTT if present
- latest feed error if present

Important reasons to surface:

- `subscription_missing`
- `stale_snapshot`
- `reconnect_pending`
- `ws_closed`
- `missing_snapshot`

Optional if present in telemetry:

- `feed.error`
- `feed.disconnected`
- `feed.reconnect_scheduled`
- `feed.reconnect_forced`

---

## 12. Trades and Signals Section

Show:

- paper buys
- paper sells
- live buys
- live sells
- total trades
- accepted signals
- rejected signals
- momentum event count
- monte carlo event count
- top rejection reasons

Do not attempt in v1:

- slippage averages
- spread averages
- advanced bucket rollups

Those are deferred until field derivation is proven.

---

## 13. Readiness Section

The v1 readiness panel is a **simple telemetry-derived operator summary**, not a full replacement for every existing TS review script.

Allowed readiness checks in v1:

- momentum events present
- monte carlo events present
- fallback events per market <= 2
- avg fallback recovery <= 1000ms
- max fallback recovery <= 5000ms
- unresolved positions count == 0 if such events exist
- exit failures count == 0 if such events exist
- no live trades detected

Verdict rules:

- `READY` if all non-skipped checks pass
- `NOT READY` if any non-skipped check fails
- `UNKNOWN` if there is not enough telemetry to evaluate core checks

Important limitation:

- this verdict must be labeled clearly as **TUI readiness v1**
- it must not claim to be the canonical replacement for existing `validate:signals` or `check:live-readiness`

---

## 14. Recent Events Section

Show the latest 20-30 important events in a compact normalized form.

Prioritize:

- `startup_config`
- `signal.accepted`
- `signal.rejected`
- `paper_trade.buy`
- `paper_trade.sell`
- `live_trade.buy`
- `live_trade.sell`
- `feed.fallback`
- `feed.fallback_recovered`
- `feed.disconnected`
- `feed.reconnect_scheduled`
- `feed.reconnect_forced`
- `feed.error`
- `exit_failed`
- `position_unresolved`

Unknown events must not crash rendering.

---

## 15. Event Parsing

The parser must be defensive.

Rules:

- unknown event names are allowed
- missing fields must not crash the app
- malformed lines increment parse warnings
- keep enough raw event data to render recent events

The parser must be based on actual PATBv5 telemetry already observed, not assumed event names from a future schema.

---

## 16. Tests

Minimum fixtures:

- `empty.jsonl`
- `malformed.jsonl`
- `no-trades.jsonl`
- `fallback-heavy.jsonl`
- `live-warning.jsonl`

Minimum test coverage:

- reads full historical file on startup
- ingests appended lines without restart
- ignores malformed JSON without crashing
- holds partial final line until completed
- computes fallback metrics correctly
- computes readiness verdict correctly for a known sample
- shows LIVE warning when `live_trade.*` is present

---

## 17. Implementation Order

Build in this order:

1. CLI args
2. session resolver
3. realtime JSONL reader
4. parser for current telemetry events
5. in-memory metrics aggregator
6. readiness summary
7. single-view Bubble Tea UI
8. fixtures and tests
9. README

Do not start from visual polish.

The metrics and reader correctness come first.

---

## 18. Acceptance Criteria

This v1 is accepted when:

- `patbv5-tui --telemetry-file <path>` works
- `patbv5-tui --session-id latest` works
- the dashboard updates while the bot is still writing the file
- partial lines do not crash the tool
- malformed lines do not crash the tool
- parse warning count is visible
- PAPER/LIVE/UNKNOWN is visible
- LIVE warning is explicit if live trades appear
- feed fallback metrics are visible
- rejected signal breakdown is visible
- readiness summary is visible
- recent important events are visible
- the tool remains read-only

---

## 19. Non-Goals

Not goals for v1:

- replacing the full browser UI
- matching every advanced review script output
- adding strategy controls
- supporting complex multi-session operations
- adding speculative metrics without trusted telemetry backing

---

## 20. Final Direction

The correct v1 is:

- native
- realtime
- read-only
- one screen
- low overhead
- useful for current PATBv5 debugging

If later versions are needed, add them only after this minimal version proves stable and truthful against real telemetry.
