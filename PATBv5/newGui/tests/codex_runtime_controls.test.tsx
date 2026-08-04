import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CodexRuntimeControls } from "../src/components/codex/CodexRuntimeControls";
import type { ControlRunView, ControlStatus } from "../src/types";

const base: ControlStatus = {
  state: "STOPPED",
  canStart: true,
  canStop: false,
  canForceStop: false,
  activeRun: null,
  error: null,
  logTail: [],
};

const activeRun: ControlRunView = {
  runId: "11111111-1111-4111-8111-111111111111",
  requestedMode: "LIVE",
  modeSource: "CONTROL_OVERRIDE",
  requestedAt: "2026-07-16T20:00:00.000Z",
  stopRequestedAt: null,
  forceEligibleAt: null,
  wrapperPid: 400,
  botPid: 401,
  sessionId: "session-live",
  heartbeatUpdatedAt: "2026-07-16T20:00:01.000Z",
};

const render = (status: ControlStatus, pendingAction: "start-live" | null = null) => renderToStaticMarkup(
  <CodexRuntimeControls
    status={status}
    loading={false}
    pendingAction={pendingAction}
    error={null}
    start={async () => undefined}
    stop={async () => undefined}
    forceStop={async () => undefined}
    refresh={async () => undefined}
  />,
);

const stopped = render(base);
assert.match(stopped, /START PAPER/);
assert.match(stopped, /START LIVE/);
assert.doesNotMatch(stopped, />STOP</);

const live = render({ ...base, state: "LIVE", canStart: false, canStop: true, activeRun });
assert.match(live, /LIVE/);
assert.match(live, />STOP</);
assert.doesNotMatch(live, /START PAPER/);
assert.match(live, /CONTROL_OVERRIDE/);
assert.match(live, /11111111-1111-4111-8111-111111111111/);
assert.match(live, /session-live/);
assert.match(live, />400</);
assert.match(live, />401</);
assert.match(live, /2026-07-16T20:00:01.000Z/);

const waiting = render({ ...base, state: "STOPPING", canStart: false, canStop: false, canForceStop: false, activeRun });
assert.match(waiting, /STOPPING/);
assert.doesNotMatch(waiting, /FORCE STOP/);

const force = render({ ...base, state: "STOPPING", canStart: false, canStop: false, canForceStop: true, activeRun });
assert.match(force, /FORCE STOP/);

const finalizing = render({ ...base, state: "FINALIZING", canStart: false, canStop: false, canForceStop: false, activeRun });
assert.match(finalizing, /FINALIZING/);
assert.doesNotMatch(finalizing, /FORCE STOP/);

const fault = render({ ...base, state: "ERROR", canStart: false, canStop: true, activeRun, error: "heartbeat stale" });
assert.match(fault, /heartbeat stale/i);
assert.match(fault, /role="alert"/);
assert.match(fault, /CONTROL_OVERRIDE/);
assert.match(fault, /session-live/);

const logs = render({
  ...base,
  logTail: ["oldest-entry", ...Array.from({ length: 20 }, (_, index) => `recent-${index + 1}`)],
});
assert.doesNotMatch(logs, /oldest-entry/);
assert.match(logs, /recent-1/);
assert.match(logs, /recent-20/);
assert.match(logs, /<details/);
assert.doesNotMatch(logs, /<details[^>]*open/);

const pending = render(base, "start-live");
assert.match(pending, /aria-busy="true"/);
assert.match(pending, /disabled=""/);
assert.match(pending, /ACTION PENDING · START-LIVE/);

const hookSource = readFileSync(new URL("../src/hooks/useBotControl.ts", import.meta.url), "utf8");
assert.match(hookSource, /pendingActionRef\.current !== null/);
assert.match(hookSource, /fetchControlBootstrap/);
assert.match(hookSource, /1_000/);
assert.match(hookSource, /bootstrapRequestRef/);
assert.match(hookSource, /AbortController/);
assert.match(hookSource, /setTimeout/);
assert.doesNotMatch(hookSource, /setInterval/);
assert.doesNotMatch(hookSource, /\bconfirm\s*\(/);
assert.doesNotMatch(hookSource, /readiness/i);

const apiSource = readFileSync(new URL("../src/lib/controlApi.ts", import.meta.url), "utf8");
assert.match(apiSource, /Accept/);
assert.match(apiSource, /Content-Type/);
assert.match(apiSource, /X-Codex-CSRF/);
assert.match(apiSource, /\/bootstrap/);
assert.match(apiSource, /\/start/);
assert.match(apiSource, /\/stop/);
assert.match(apiSource, /\/force/);
