# PATBv5 Baseline and Test Harness Design

Date: 2026-07-09
Status: Proposed for implementation

## Purpose

Create a trustworthy engineering baseline for PATBv5 before restructuring its trading core. The milestone will preserve the current uncommitted runtime and GUI work, verify that each project builds, make every existing deterministic test reachable from one command, and document any failures without starting the bot or performing network trading operations.

## Scope

This milestone includes:

- inventorying the current dirty worktree without modifying or staging existing user changes;
- building the PATBv5 TypeScript runtime, the independent Evaluator package, and the React terminal GUI;
- running the existing deterministic lifecycle, feed, momentum, Monte Carlo, entry-ratio, rejection-payload, and report tests;
- adding a single default test command that runs the complete deterministic suite sequentially and stops on the first failure;
- adding narrowly scoped characterization tests only where current exported seams permit testing without modifying the dirty trading-runtime files;
- recording baseline results and any deferred coverage gaps.

This milestone excludes:

- live-mode execution, credential checks, wallet operations, or order placement;
- running the bot against Polymarket or external feeds;
- changing strategy configuration or expected trading behavior;
- decomposing `Trade`, `attachTradeMethods`, `attachDecisionMethods`, or `main`;
- rewriting existing tests around a new test framework.

## Approaches Considered

### A. Unify the existing script tests first (selected)

Keep the current `tsx`-based tests and expose them through explicit package scripts. Compose those scripts under one default `npm test` command. This is the smallest change, does not introduce a dependency, and provides immediate coverage visibility.

Trade-off: the suite remains script-oriented and will not initially provide rich test discovery, filtering, or coverage reports.

### B. Adopt a test framework immediately

Convert the suite to Vitest or Node's test runner before establishing the baseline.

Trade-off: this would improve reporting, but it expands the change surface and could mix harness-migration failures with real runtime failures. It is inappropriate while core files already contain substantial uncommitted work.

### C. Refactor the trading core before testing it

Extract decision and execution services first, then test the new interfaces.

Trade-off: this produces cleaner seams eventually, but it changes the highest-risk code before a reliable regression baseline exists.

## Selected Design

### Worktree protection

Before editing, capture the current modified and untracked paths. Implementation changes must not stage, revert, format, or overwrite those paths unless the user explicitly approves an overlapping edit. The initial harness change should be limited to `PATBv5/package.json`, new non-conflicting test files if useful, and a baseline-results document.

Because `PATBv5/package.json` is currently unmodified, it is the safest integration point for the unified command. If it becomes dirty before implementation, stop and reassess rather than merging blindly.

### Build baseline

Run these local, deterministic build checks:

1. PATBv5 TypeScript build.
2. Evaluator TypeScript build.
3. `PATBv5/newGui` TypeScript and Vite build.

Build output is diagnostic only and must not be staged. A build failure is recorded before any attempt to fix it. Fixes are outside this milestone unless they are caused by the new test-harness change.

### Test orchestration

Give each existing deterministic test file an explicit descriptive package script. The default `npm test` script will invoke them sequentially through nested `npm run` commands, using only cross-platform npm syntax and the existing local `tsx` dependency.

The lifecycle harness remains part of the suite but no longer represents the entire default test command. Any script that performs credential checks, deployment, live-readiness checks, report serving, UI serving, or external network access is excluded.

Sequential execution is intentional because several tests manipulate module or global state. Parallel execution can be considered only after those dependencies are isolated.

### Characterization coverage

The first milestone may add tests for already-exported pure behavior, such as entry-price ratio and preferred-side selection. It must not duplicate production gate formulas inside tests merely to claim coverage.

Composite decision gates—entry timing, seconds-to-close, fee-adjusted edge, and fallback cooldown—are recorded as deferred gaps if they cannot be exercised through an existing public seam. Their next milestone will first extract a pure, typed gate evaluator and then test that evaluator before wiring it back into runtime behavior.

### Baseline report

Record:

- current Git commit and dirty-state warning;
- build result for each package;
- result for each deterministic test script;
- failures that predate the harness change;
- tests intentionally excluded and why;
- deferred characterization gaps.

The report must distinguish observed results from recommendations and must not claim runtime or live readiness.

## Error Handling

- Stop a build or test command when it exceeds a reasonable timeout and record the timeout.
- Treat missing dependencies as a baseline failure; do not install or upgrade packages without separate approval.
- Do not fix pre-existing failures silently.
- If a test unexpectedly attempts network, wallet, credential, or order activity, terminate it and remove it from the deterministic suite pending review.
- If implementation overlaps a currently modified user file other than the agreed package manifest, pause for direction.

## Success Criteria

The milestone is complete when:

1. The existing worktree changes remain intact and unstaged.
2. PATBv5, Evaluator, and the GUI each have a recorded build result.
3. One command from `PATBv5` runs every approved deterministic test sequentially.
4. The command returns a nonzero exit code if any included test fails.
5. No bot, server, browser, live feed, credential flow, or order path is started.
6. Baseline results and deferred coverage gaps are documented honestly.

## Follow-up Milestone

After this baseline is accepted, extract shared fee, pricing, entry-window, and feed-gate calculations into typed pure modules. Add table-driven tests for complete gate combinations, then begin decomposing entry lifecycle, exit lifecycle, and reconciliation behavior one boundary at a time.
