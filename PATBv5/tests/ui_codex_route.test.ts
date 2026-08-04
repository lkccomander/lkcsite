import assert from "node:assert/strict";
import { resolveTerminalView } from "../newGui/src/lib/route";
import { getUiRouteBase } from "../src/ui/server";

assert.equal(resolveTerminalView("/terminal-v5", "/terminal-v5/"), "legacy");
assert.equal(resolveTerminalView("/terminal-v5/", "/terminal-v5/"), "legacy");
assert.equal(resolveTerminalView("/terminal-v5/codex", "/terminal-v5/"), "codex");
assert.equal(resolveTerminalView("/custom/codex", "/custom/"), "codex");
assert.equal(resolveTerminalView("/terminal-v5/unknown", "/terminal-v5/"), "legacy");

const previousRouteBase = process.env.UI_ROUTE_BASE;
try {
  delete process.env.UI_ROUTE_BASE;
  assert.equal(getUiRouteBase(), "/terminal-v5");
  process.env.UI_ROUTE_BASE = "/terminal-v5/";
  assert.equal(getUiRouteBase(), "/terminal-v5");
  process.env.UI_ROUTE_BASE = "/custom";
  assert.throws(() => getUiRouteBase(), /fixed to \/terminal-v5/i);
} finally {
  if (previousRouteBase == null) delete process.env.UI_ROUTE_BASE;
  else process.env.UI_ROUTE_BASE = previousRouteBase;
}
