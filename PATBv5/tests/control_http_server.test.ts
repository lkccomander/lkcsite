import assert from "node:assert/strict";
import { request } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import type { ControlStatus, RequestedMode } from "../src/control/contracts";
import { ControlConflictError } from "../src/control/runtimeController";
import { createControlHttpServer, startControlHttpServer } from "../src/control/httpServer";

const stopped: ControlStatus = {
  state: "STOPPED",
  canStart: true,
  canStop: false,
  canForceStop: false,
  activeRun: null,
  error: null,
  logTail: [],
};

interface HttpResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function call(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<HttpResult> {
  return new Promise((resolveCall, rejectCall) => {
    const req = request({
      hostname: "127.0.0.1",
      port,
      path,
      method: options.method ?? "GET",
      headers: {
        Host: `127.0.0.1:${port}`,
        ...options.headers,
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolveCall({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.once("error", rejectCall);
    if (options.body != null) req.write(options.body);
    req.end();
  });
}

function closeServer(server: ReturnType<typeof createControlHttpServer>): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

async function run(): Promise<void> {
  let unexpectedStatusError = false;
  let delegatedRouteBase = "";
  const fakeController = {
    startCalls: [] as RequestedMode[],
    async status() {
      if (unexpectedStatusError) throw new Error("password=must-not-leak");
      return stopped;
    },
    async start(mode: RequestedMode) {
      if (mode === "PAPER") throw new ControlConflictError("A bot run is already active.");
      this.startCalls.push(mode);
      return { ...stopped, state: "STARTING" as const, canStart: false };
    },
    async stop() {
      return { ...stopped, state: "STOPPING" as const, canStart: false };
    },
    async forceStop() {
      return { ...stopped, state: "ERROR" as const, error: "unclean stop" };
    },
  };
  const server = createControlHttpServer({
    controller: fakeController,
    routeBase: "/terminal-v5",
    csrfToken: "test-token",
    serveUi: async (_request, response, routeBase) => {
      delegatedRouteBase = routeBase;
      response.writeHead(204);
      response.end();
      return true;
    },
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const mutationHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    Origin: origin,
    "X-Codex-CSRF": "test-token",
  };

  try {
    const bootstrap = await call(port, "/terminal-v5/api/control/bootstrap");
    assert.equal(bootstrap.status, 200);
    assert.equal(JSON.parse(bootstrap.body).csrfToken, "test-token");
    assert.equal(bootstrap.headers["cache-control"], "no-store");
    assert.equal(bootstrap.headers["access-control-allow-origin"], undefined);

    const wrongHost = await call(port, "/terminal-v5/api/control/status", {
      headers: { Host: `localhost:${port + 1}` },
    });
    assert.equal(wrongHost.status, 403);

    delegatedRouteBase = "";
    const delegatedWrongHost = await call(port, "/terminal-v5/delegated", {
      headers: { Host: `localhost:${port + 1}` },
    });
    assert.equal(delegatedWrongHost.status, 403);
    assert.equal(delegatedWrongHost.headers["cache-control"], "no-store");
    assert.equal(delegatedRouteBase, "", "invalid Host must be rejected before UI delegation");

    const forbidden = await call(port, "/terminal-v5/api/control/start", {
      method: "POST",
      headers: { ...mutationHeaders, Origin: "https://evil.example" },
      body: JSON.stringify({ mode: "LIVE" }),
    });
    assert.equal(forbidden.status, 403);

    const missingToken = await call(port, "/terminal-v5/api/control/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: "{}",
    });
    assert.equal(missingToken.status, 403);

    const unsupported = await call(port, "/terminal-v5/api/control/stop", {
      method: "POST",
      headers: { ...mutationHeaders, "Content-Type": "text/plain" },
      body: "{}",
    });
    assert.equal(unsupported.status, 415);

    const malformed = await call(port, "/terminal-v5/api/control/start", {
      method: "POST",
      headers: mutationHeaders,
      body: "{",
    });
    assert.equal(malformed.status, 400);

    const invalidMode = await call(port, "/terminal-v5/api/control/start", {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ mode: "paper" }),
    });
    assert.equal(invalidMode.status, 400);

    const oversized = await call(port, "/terminal-v5/api/control/start", {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ mode: "LIVE", padding: "x".repeat(8_192) }),
    });
    assert.equal(oversized.status, 400);

    const conflict = await call(port, "/terminal-v5/api/control/start", {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ mode: "PAPER" }),
    });
    assert.equal(conflict.status, 409);

    const accepted = await call(port, "/terminal-v5/api/control/start", {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ mode: "LIVE" }),
    });
    assert.equal(accepted.status, 202);
    assert.deepEqual(fakeController.startCalls, ["LIVE"]);

    const stoppedResponse = await call(port, "/terminal-v5/api/control/stop", {
      method: "POST",
      headers: { ...mutationHeaders, Origin: `http://localhost:${port}` },
      body: "{}",
    });
    assert.equal(stoppedResponse.status, 202);

    const forced = await call(port, "/terminal-v5/api/control/force", {
      method: "POST",
      headers: mutationHeaders,
      body: "{}",
    });
    assert.equal(forced.status, 202);

    const unknown = await call(port, "/terminal-v5/api/control/unknown");
    assert.equal(unknown.status, 404);

    unexpectedStatusError = true;
    const unexpected = await call(port, "/terminal-v5/api/control/status");
    assert.equal(unexpected.status, 500);
    assert.doesNotMatch(unexpected.body, /must-not-leak|password/i);
    unexpectedStatusError = false;

    const delegated = await call(port, "/terminal-v5/delegated");
    assert.equal(delegated.status, 204);
    assert.equal(delegatedRouteBase, "/terminal-v5");
  } finally {
    await closeServer(server);
  }

  let openedUrl = "";
  const started = await startControlHttpServer({
    controller: fakeController,
    routeBase: "/terminal-v5",
    csrfToken: "test-token",
    serveUi: async () => false,
    preferredPort: 0,
    openBrowser: true,
    browserOpener: (url) => { openedUrl = url; },
  });
  try {
    assert.equal((started.server.address() as AddressInfo).address, "127.0.0.1");
    assert.equal(started.port, (started.server.address() as AddressInfo).port);
    assert.equal(started.url, `http://127.0.0.1:${started.port}/terminal-v5/codex`);
    assert.equal(openedUrl, started.url);
  } finally {
    await closeServer(started.server);
  }

  const root = await startControlHttpServer({
    controller: fakeController,
    routeBase: "/",
    csrfToken: "test-token",
    serveUi: async () => false,
    preferredPort: 0,
    openBrowser: false,
  });
  try {
    assert.equal(root.url, `http://127.0.0.1:${root.port}/codex`);
    assert.doesNotMatch(root.url, /\/\/codex$/);
  } finally {
    await closeServer(root.server);
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
