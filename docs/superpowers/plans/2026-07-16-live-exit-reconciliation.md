# Live Exit Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile ambiguous LIVE SELL submissions from authoritative open-order and trade history data, emitting actual fill telemetry without risking duplicate orders.

**Architecture:** Add pure provider-record matching and fill aggregation helpers in a focused module. The Trade runtime stores uncertain exit context, applies a bounded submit timeout, reconciles through the CLOB client, and blocks entries until the outcome becomes filled or pending.

**Tech Stack:** TypeScript, Node.js timers, `@polymarket/clob-client-v2`, existing trade lifecycle and JSONL telemetry.

## Global Constraints

- Never infer fill price from zero token balance alone.
- Never resubmit an exit after an ambiguous submit response.
- Use provider trade prices for realized PnL when fills are available.
- Do not change strategy thresholds.
- Preserve matched and live-order behavior.

---

### Task 1: Pure exit reconciliation matching

**Files:**
- Create: `PATBv5/src/trade/policy/exitReconciliation.ts`
- Create: `PATBv5/tests/exit_reconciliation.test.ts`
- Modify: `PATBv5/package.json`

**Interfaces:**
- Produces `aggregateMatchingSellFills(trades, request): ReconciledFill | null`.
- Produces `findMatchingOpenSellOrder(orders, request): MatchingOpenOrder | null`.
- Request includes token ID, requested size, submitted timestamp, and rounding tolerance.

- [ ] Write failing tests for one fill, multiple weighted fills, unrelated trades, and a matching open SELL.
- [ ] Run `npm run test:exit-reconciliation`; expect missing-module failure.
- [ ] Implement deterministic filtering, deduplication, size aggregation, and weighted average price.
- [ ] Run the focused test; expect exit 0.

### Task 2: Runtime uncertainty state and submit timeout

**Files:**
- Modify: `PATBv5/src/trade/index.ts`
- Modify: `PATBv5/src/trade/trade.ts`
- Modify: `PATBv5/scripts/check3_lifecycle_harness.ts`

**Interfaces:**
- Adds `PendingExitReconciliationRecord` and `Trade.pendingExitReconciliation`.
- Adds runtime reconciliation that consumes Task 1 helpers.
- Emits `trade.exit_submission_uncertain`, `trade.exit_pending`, `trade.exit_filled`, and `live_trade.sell`.

- [ ] Extend the harness client with `getTrades` and telemetry-observable runtime state.
- [ ] Add a failing test where submit rejects ambiguously and `getTrades` returns two fills totaling the requested size at a weighted average price.
- [ ] Add a failing test where the provider returns a matching open SELL.
- [ ] Add a failing test where neither query confirms an outcome and execution safety blocks another entry.
- [ ] Implement bounded submit handling and classify authentication failures as deterministic.
- [ ] On ambiguity, persist reconciliation state before querying provider sources.
- [ ] Resolve complete fills using provider-derived price, close position, emit both fill events exactly once, and clear state.
- [ ] Register matching open orders through the existing exit-order lifecycle.
- [ ] Keep unresolved submissions in `ERROR` and reject new entries.
- [ ] Run `npm run test:lifecycle`; expect exit 0.

### Task 3: Repeated reconciliation and duplicate prevention

**Files:**
- Modify: `PATBv5/src/trade/trade.ts`
- Modify: `PATBv5/scripts/check3_lifecycle_harness.ts`

**Interfaces:**
- `Trade.reconcilePendingExitSubmission(): Promise<boolean>` returns true only when uncertainty is resolved.

- [ ] Add a failing repeated-call test proving one provider fill produces one sell telemetry lifecycle and no second SELL submit.
- [ ] Invoke pending reconciliation from `validateExecutionSafety` before evaluating a new entry.
- [ ] Retain `ERROR` while unresolved and clear it only after authoritative resolution.
- [ ] Run lifecycle and execution-pricing tests; expect exit 0.

### Task 4: Verification

**Files:**
- Modify only when verification identifies a defect.

- [ ] Run `npm run test:exit-reconciliation`, `npm run test:lifecycle`, and `npm run test:execution-pricing`.
- [ ] Run `npm run build`.
- [ ] Run every `test:all` group in bounded parallel batches and require all exit codes to be zero.
- [ ] Run `git diff --check` and confirm generated evaluation metadata remains outside implementation commits.
- [ ] Commit focused implementation and test files with `fix: reconcile ambiguous live exits`.
