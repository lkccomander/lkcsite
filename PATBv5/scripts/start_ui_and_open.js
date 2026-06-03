#!/usr/bin/env node

const http = require("http");
const { spawn } = require("child_process");

const DEFAULT_PORT = 4175;
const MAX_PORT_ATTEMPTS = 10;
const ROUTE_BASE = "/terminal-v5";

function requestUiState(port) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        host: "127.0.0.1",
        port,
        path: `${ROUTE_BASE}/api/state?mode=mock`,
        timeout: 1500,
      },
      (response) => {
        response.resume();
        if (response.statusCode === 200) {
          resolve(`http://localhost:${port}${ROUTE_BASE}`);
          return;
        }
        reject(new Error(`Unexpected status ${response.statusCode ?? "unknown"} on port ${port}`));
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error(`Timed out waiting for port ${port}`));
    });
    request.on("error", reject);
  });
}

async function findRunningUiUrl() {
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const port = DEFAULT_PORT + offset;
    try {
      return await requestUiState(port);
    } catch {
      // Keep scanning nearby ports until a live PATBv5 UI responds.
    }
  }

  throw new Error("No running PATBv5 UI server found on ports 4175-4184.");
}

function openBrowser(url) {
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

async function main() {
  const url = await findRunningUiUrl();
  process.stdout.write(`[launcher] Opening existing PATBv5 UI at ${url}\n`);
  openBrowser(url);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
