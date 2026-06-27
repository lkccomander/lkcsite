import { spawn } from "child_process";
import { createReadStream, existsSync } from "fs";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { extname, resolve } from "path";
import { getTerminalState } from "./state/getTerminalState";
import { readOptionalConfigEnv } from "../config/secrets";

const DEFAULT_UI_PORT = 4175;
const DEFAULT_UI_ROUTE = "/terminal-v5";
const MAX_UI_PORT_ATTEMPTS = 10;
const UI_BUILD_DIR = resolve(process.cwd(), "newGui", "dist");
const UI_INDEX_PATH = resolve(UI_BUILD_DIR, "index.html");

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

function getUiPort(): number {
  const raw = readOptionalConfigEnv("UI_PORT");
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_UI_PORT;
}

function getUiRouteBase(): string {
  const raw = readOptionalConfigEnv("UI_ROUTE_BASE").trim();
  if (!raw) {
    return DEFAULT_UI_ROUTE;
  }
  return raw.startsWith("/") ? raw.replace(/\/+$/, "") || "/" : `/${raw.replace(/\/+$/, "")}`;
}

function shouldOpenBrowser(): boolean {
  const raw = readOptionalConfigEnv("UI_OPEN_BROWSER").toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

function openBrowser(url: string): void {
  if (process.platform === "win32") {
    spawn("cmd.exe", ["/c", "start", "", url], {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }

  const command = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(command, [url], {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: "ignore",
  }).unref();
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendText(response: ServerResponse, statusCode: number, body: string): void {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function fallbackUiPage(routeBase: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PATBv5 Terminal GUI</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0a0a0a;
        --panel: #10100d;
        --line: #1e1e1a;
        --text: #e0e0d8;
        --muted: #6b6b60;
        --accent: #00ff88;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(0, 255, 136, 0.08), transparent 42%),
          linear-gradient(180deg, rgba(255,255,255,0.02), transparent 38%),
          var(--bg);
        color: var(--text);
        font-family: "IBM Plex Mono", "JetBrains Mono", Consolas, monospace;
      }
      .panel {
        width: min(780px, calc(100vw - 48px));
        border: 1px solid var(--line);
        background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01));
        padding: 28px;
        box-shadow: 0 0 0 1px rgba(255,255,255,0.02), 0 30px 80px rgba(0,0,0,0.45);
      }
      .eyebrow {
        color: var(--accent);
        font-size: 12px;
        letter-spacing: 0.28em;
        text-transform: uppercase;
        margin-bottom: 12px;
      }
      h1 { margin: 0 0 10px; font-size: 28px; }
      p { color: var(--muted); line-height: 1.6; }
      code {
        display: inline-block;
        margin-top: 8px;
        padding: 2px 6px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.03);
        color: var(--text);
      }
    </style>
  </head>
  <body>
    <section class="panel">
      <div class="eyebrow">PATBv5 Terminal GUI</div>
      <h1>Frontend assets are not built yet.</h1>
      <p>The API is live at <code>${routeBase}/api/state?mode=live</code>.</p>
      <p>Build the React client in <code>newGui</code> and reload this route.</p>
    </section>
  </body>
</html>`;
}

async function serveStaticAsset(assetPath: string, response: ServerResponse): Promise<void> {
  if (!existsSync(assetPath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const extension = extname(assetPath);
  response.writeHead(200, {
    "Content-Type": CONTENT_TYPES[extension] || "application/octet-stream",
    "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=300",
  });
  createReadStream(assetPath).pipe(response);
}

async function handleUiRequest(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  const routeBase = getUiRouteBase();
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const pathname = requestUrl.pathname;

  if (pathname === `${routeBase}/api/state`) {
    try {
      const state = await getTerminalState("live");
      sendJson(response, 200, state);
    } catch (error) {
      sendJson(response, 500, {
        error: "Failed to build terminal state",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (!pathname.startsWith(routeBase)) {
    return false;
  }

  const relativePath = pathname.slice(routeBase.length).replace(/^\/+/, "");
  if (!existsSync(UI_INDEX_PATH)) {
    sendText(response, 200, fallbackUiPage(routeBase));
    return true;
  }

  if (!relativePath) {
    await serveStaticAsset(UI_INDEX_PATH, response);
    return true;
  }

  const assetPath = resolve(UI_BUILD_DIR, relativePath);
  if (!assetPath.startsWith(UI_BUILD_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return true;
  }

  if (existsSync(assetPath)) {
    await serveStaticAsset(assetPath, response);
    return true;
  }

  await serveStaticAsset(UI_INDEX_PATH, response);
  return true;
}

let uiServerStarted = false;

async function listenOnPort(server: ReturnType<typeof createServer>, port: number): Promise<number> {
  return new Promise<number>((resolvePromise, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolvePromise(port);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port);
  });
}

export async function startUiServer(): Promise<void> {
  if (uiServerStarted) {
    return;
  }

  const preferredPort = getUiPort();
  const routeBase = getUiRouteBase();

  const server = createServer((request, response) => {
    void handleUiRequest(request, response)
      .then((handled) => {
        if (!handled && !response.writableEnded) {
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Not found");
        }
      })
      .catch((error) => {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(error instanceof Error ? error.message : String(error));
      });
  });

  let activePort: number | null = null;
  let lastError: unknown = null;
  for (let offset = 0; offset < MAX_UI_PORT_ATTEMPTS; offset += 1) {
    const candidatePort = preferredPort + offset;
    try {
      activePort = await listenOnPort(server, candidatePort);
      break;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      lastError = err;
      if (err?.code !== "EADDRINUSE" || offset === MAX_UI_PORT_ATTEMPTS - 1) {
        throw err;
      }
    }
  }

  if (activePort === null) {
    throw lastError instanceof Error ? lastError : new Error("UI server failed to bind to any port");
  }

  uiServerStarted = true;
  const uiUrl = `http://localhost:${activePort}${routeBase}`;
  if (activePort !== preferredPort) {
    console.warn(`UI port ${preferredPort} in use, using ${activePort} instead.`);
  }
  console.log(`UI server listening at ${uiUrl}`);
  if (shouldOpenBrowser()) {
    console.log(`Opening browser at ${uiUrl}`);
    openBrowser(uiUrl);
  }
}
