# Feed TLS and Report Priorities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent TLS certificate incidents from causing rapid reconnect churn and make report feed metrics and Actions agree with raw telemetry.

**Architecture:** Isolate transport-error classification and reconnect-delay selection in a pure module used by the market feed and readiness command. Extend the report parser with raw event counters and per-slug accumulator state, then render and analyze those normalized fields without trusting incomplete summary payloads.

**Tech Stack:** Node.js 24, TypeScript, `ws`, Node TLS/HTTPS APIs, existing JSONL telemetry and isolated TypeScript test runner.

## Global Constraints

- TLS certificate and hostname verification must remain enabled.
- Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0` or lower OpenSSL security levels.
- Do not change PAPER/live strategy thresholds from this single session.
- Readiness probes must not require or emit credentials.
- Existing report fixtures and older telemetry must remain renderable with zero/default values.

---

### Task 1: Secure TLS incident classification and reconnect delay

**Files:**
- Create: `PATBv5/src/feed/transportError.ts`
- Modify: `PATBv5/src/feed/marketFeed.ts`
- Create: `PATBv5/tests/feed_transport_error.test.ts`
- Modify: `PATBv5/package.json`

**Interfaces:**
- Produces: `classifyTransportError(error: unknown): TransportErrorDetails` and `reconnectDelayFor(category, attempt): number`.
- `TransportErrorDetails` contains `category`, `message`, `errorName`, `errorCode`, and `causeCode`.
- Market feed telemetry consumes these fields and uses category `tls_certificate_policy` for the circuit breaker.

- [ ] **Step 1: Write the failing classifier and delay tests**

```ts
assert.equal(classifyTransportError(new Error("EE certificate key too weak")).category, "tls_certificate_policy");
assert.equal(reconnectDelayFor("tls_certificate_policy", 1), 60_000);
assert.equal(reconnectDelayFor("socket_error", 1), 250);
```

- [ ] **Step 2: Run the test and verify missing-module failure**

Run: `npm run test:feed-transport-error`
Expected: FAIL because `src/feed/transportError.ts` does not exist.

- [ ] **Step 3: Implement pure classification and capped delays**

```ts
export type TransportErrorCategory = "tls_certificate_policy" | "tls_certificate" | "socket_error";
export function reconnectDelayFor(category: TransportErrorCategory, attempt: number): number {
  if (category === "tls_certificate_policy") return Math.min(15 * 60_000, 60_000 * 2 ** Math.min(3, attempt - 1));
  return [250, 500, 1000, 2000, 4000, 8000][Math.min(attempt - 1, 5)];
}
```

- [ ] **Step 4: Integrate classification into WebSocket error handling**

Store the last transport category, emit structured `feed.error` fields, pass the category to `scheduleReconnect`, emit `reconnectCategory` and `reconnectDelayMs`, and reset the category on `open`. Do not pass insecure TLS options to `WebSocket`.

- [ ] **Step 5: Run focused feed tests**

Run: `npm run test:feed-transport-error && npm run test:feed-reconnect && npm run test:feed-fallback`
Expected: all commands exit 0.

- [ ] **Step 6: Commit the independently testable transport change**

```powershell
git add PATBv5/src/feed/transportError.ts PATBv5/src/feed/marketFeed.ts PATBv5/tests/feed_transport_error.test.ts PATBv5/package.json
git commit -m "fix: back off certificate policy reconnects"
```

### Task 2: Credential-free feed readiness command

**Files:**
- Create: `PATBv5/src/feed/readiness.ts`
- Create: `PATBv5/scripts/check_feed_readiness.ts`
- Create: `PATBv5/tests/feed_readiness.test.ts`
- Modify: `PATBv5/package.json`

**Interfaces:**
- Consumes: `classifyTransportError` from Task 1.
- Produces: `runFeedReadiness(probes?: FeedReadinessProbes): Promise<FeedReadinessResult>` with injectable TLS and WebSocket probes.

- [ ] **Step 1: Write failing readiness tests with injected probes**

```ts
const passed = await runFeedReadiness({ tls: async () => validTls, websocket: async () => ({ opened: true }) });
assert.equal(passed.ok, true);
const failed = await runFeedReadiness({ tls: async () => { throw new Error("EE certificate key too weak"); }, websocket: async () => ({ opened: false }) });
assert.equal(failed.ok, false);
assert.equal(failed.checks[0].category, "tls_certificate_policy");
```

- [ ] **Step 2: Run and verify failure**

Run: `npm run test:feed-readiness`
Expected: FAIL because readiness interfaces are absent.

- [ ] **Step 3: Implement secure probes and CLI**

Use `tls.connect({ host, port: 443, servername: host, rejectUnauthorized: true })`, collect authorization/protocol/cipher/issuer/expiry/bits, and open the public WebSocket for at most 10 seconds. The CLI prints PASS/FAIL per endpoint and sets exit code 1 on failure.

- [ ] **Step 4: Add scripts and run deterministic tests**

Add `feed:readiness` and `test:feed-readiness` scripts. Run `npm run test:feed-readiness` and expect exit 0.

- [ ] **Step 5: Run the live credential-free readiness command**

Run: `npm run feed:readiness`
Expected: authorized TLS 1.3 checks and a successful WebSocket open, or a safe non-zero failure with structured diagnostics.

- [ ] **Step 6: Commit readiness support**

```powershell
git add PATBv5/src/feed/readiness.ts PATBv5/scripts/check_feed_readiness.ts PATBv5/tests/feed_readiness.test.ts PATBv5/package.json
git commit -m "feat: add feed tls readiness check"
```

### Task 3: Raw feed-event accounting in reports

**Files:**
- Modify: `PATBv5/src/report/types.ts`
- Modify: `PATBv5/src/report/parser.ts`
- Modify: `PATBv5/tests/report_fixture.ts`
- Create: `PATBv5/tests/report_feed_events.test.ts`
- Modify: `PATBv5/package.json`

**Interfaces:**
- Produces session counters `reconnectScheduledCount`, `forcedReconnectCount`, `disconnectCount`, `disconnectCodes`, `websocketErrorCategories`, and `fallbackReasons`.
- Extends `FeedWindow` with the same window-relevant counters.

- [ ] **Step 1: Write a failing JSONL parser test**

The fixture must contain one event of each relevant type for one slug and assert exact session/window counts, including `close_1006`, `websocket_unresponsive`, `stale_snapshot`, and `tls_certificate_policy`.

- [ ] **Step 2: Run and verify missing-field failure**

Run: `npm run test:report-feed-events`
Expected: FAIL because counters are undefined.

- [ ] **Step 3: Add typed counters and non-enumerable accumulator state**

Add zero/default values to `SessionReport` and fixtures. Use a per-slug accumulator keyed by `payload.slug || "unknown"`; raw events increment counters, while `feed.summary` supplies RTT metadata without overwriting raw totals.

- [ ] **Step 4: Finalize windows after parsing**

Merge summary RTT fields with raw counters, set status from raw fallbacks, sort windows by start time, and preserve compatibility when only summary events exist.

- [ ] **Step 5: Run parser and accuracy tests**

Run: `npm run test:report-feed-events && npm run test:report-accuracy && npm run test:report-rejection-payloads`
Expected: all exit 0.

- [ ] **Step 6: Commit report accounting**

```powershell
git add PATBv5/src/report/types.ts PATBv5/src/report/parser.ts PATBv5/tests/report_fixture.ts PATBv5/tests/report_feed_events.test.ts PATBv5/package.json
git commit -m "fix: report raw feed recovery events"
```

### Task 4: Accurate feed presentation and aggregated Actions

**Files:**
- Modify: `PATBv5/src/report/anomalies.ts`
- Modify: `PATBv5/src/report/actions.ts`
- Modify: `PATBv5/src/report/template.tsx`
- Modify: `PATBv5/tests/report_actions.test.ts`
- Modify: `PATBv5/tests/report_static_tabs.test.ts`

**Interfaces:**
- Consumes: normalized counters from Task 3.
- Produces one side-aware convergence Action, one aggregated fast-stop Action, and feed evidence naming dominant error/reason.

- [ ] **Step 1: Write failing Action aggregation tests**

```ts
assert.equal(actions.problems.filter(x => x.id.includes("convergence")).length, 1);
assert.match(actions.problems.find(x => x.id === "fast-stop-losses")?.evidence ?? "", /3 stop-losses.*\$-2\.91/);
assert.match(actions.problems.find(x => x.id === "feed-transport-incident")?.evidence ?? "", /tls_certificate_policy/);
```

- [ ] **Step 2: Run and verify failure**

Run: `npm run test:report-actions`
Expected: FAIL on duplicate/per-trade behavior.

- [ ] **Step 3: Aggregate anomaly evidence**

Group losing trades by side for the 0.62–0.68 band; emit at most one anomaly per side and describe observed loss count/range without prescribing a global threshold. Aggregate all sub-15-second stop losses with count, total PnL, and hold range.

- [ ] **Step 4: Render normalized feed metrics**

Show scheduled/forced reconnects, disconnects, dominant close code, dominant fallback reason, and dominant WebSocket error category in the feed section. Keep defaults at zero/unknown for old reports.

- [ ] **Step 5: Run Actions and rendering tests**

Run: `npm run test:report-actions && npm run test:report-tabs && npm run test:report-accuracy`
Expected: all exit 0.

- [ ] **Step 6: Commit presentation and Actions**

```powershell
git add PATBv5/src/report/anomalies.ts PATBv5/src/report/actions.ts PATBv5/src/report/template.tsx PATBv5/tests/report_actions.test.ts PATBv5/tests/report_static_tabs.test.ts
git commit -m "fix: aggregate report recovery actions"
```

### Task 5: Captured-session reconciliation and full verification

**Files:**
- Modify only if verification finds a defect in Tasks 1–4.

**Interfaces:**
- Consumes all previous deliverables.
- Produces a regenerated report whose embedded JSON reconciles with raw telemetry.

- [ ] **Step 1: Build and run focused tests**

Run: `npm run build` plus all new and existing feed/report tests.
Expected: exit 0.

- [ ] **Step 2: Run the complete suite**

Run: `npm run test:all`
Expected: exit 0. If the sequential runner exceeds the environment timeout, run the same named scripts in bounded parallel batches and require every exit code to be 0.

- [ ] **Step 3: Regenerate the captured session report**

Run: `npm run report -- --file "C:\Projects\lkcsite\polydb\telemetry\sessions\2026-07-16T02-12-48-910Z__3c5e6729-8640-4a83-a89e-8fc1e2e8a783.jsonl"`
Expected: a new HTML path under `PATBv5/polydb/reports`.

- [ ] **Step 4: Reconcile embedded JSON**

Parse the report-data block and independently aggregate the same source JSONL. Require equality at the report cutoff for scheduled reconnects, forced reconnects, disconnects, fallback reasons, and TLS categories.

- [ ] **Step 5: Verify repository scope**

Run: `git diff --check` and `git status --short`. Ensure the pre-existing evaluation metadata changes remain outside implementation commits unless intentionally generated by the required versioning workflow.

- [ ] **Step 6: Commit final verification corrections only when Step 4 required code changes**

```powershell
git add PATBv5/src/feed PATBv5/src/report PATBv5/scripts/check_feed_readiness.ts PATBv5/tests PATBv5/package.json
git commit -m "test: verify feed recovery reporting"
```

If reconciliation required no changes, skip this commit and preserve the clean implementation history from Tasks 1–4.
