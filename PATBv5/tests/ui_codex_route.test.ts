import assert from "node:assert/strict";
import { resolveTerminalView } from "../newGui/src/lib/route";

assert.equal(resolveTerminalView("/terminal-v5", "/terminal-v5/"), "legacy");
assert.equal(resolveTerminalView("/terminal-v5/", "/terminal-v5/"), "legacy");
assert.equal(resolveTerminalView("/terminal-v5/codex", "/terminal-v5/"), "codex");
assert.equal(resolveTerminalView("/custom/codex", "/custom/"), "codex");
assert.equal(resolveTerminalView("/terminal-v5/unknown", "/terminal-v5/"), "legacy");
