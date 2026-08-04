import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { ControlStatus, RequestedMode } from "./contracts";
import {
  ControlConflictError,
  ControlValidationError,
  ForceStopNotEligibleError,
} from "./runtimeController";
import { handleUiRequest, openBrowser as openUiBrowser } from "../ui/server";

const CONTROL_BODY_LIMIT_BYTES = 8_192;
const MAX_PORT_ATTEMPTS = 10;

class HttpRequestError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

export interface ControlApiController {
  status(): Promise<ControlStatus>;
  start(mode: RequestedMode): Promise<ControlStatus>;
  stop(): Promise<ControlStatus>;
  forceStop(): Promise<ControlStatus>;
}

export interface ControlHttpServerOptions {
  controller: ControlApiController;
  routeBase: string;
  csrfToken: string;
  serveUi?: typeof handleUiRequest;
}

function normalizeRouteBase(value: string): string {
  const normalized = value.trim().replace(/^\/+|\/+$/g, "");
  return normalized ? `/${normalized}` : "/";
}

function controlPrefix(routeBase: string): string {
  return routeBase === "/" ? "/api/control" : `${routeBase}/api/control`;
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
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function requestHeader(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name.toLowerCase()];
  return typeof value === "string" ? value : null;
}

function boundPort(server: ReturnType<typeof createServer>): number | null {
  const address = server.address();
  return address && typeof address !== "string" ? address.port : null;
}

function hasValidHost(request: IncomingMessage, port: number): boolean {
  const host = requestHeader(request, "host");
  if (!host) return false;
  try {
    const parsed = new URL(`http://${host}`);
    const validName = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    return validName
      && parsed.username === ""
      && parsed.password === ""
      && parsed.pathname === "/"
      && parsed.search === ""
      && parsed.hash === ""
      && parsed.port !== ""
      && Number(parsed.port) === port;
  } catch {
    return false;
  }
}

function hasValidOrigin(request: IncomingMessage, port: number): boolean {
  const origin = requestHeader(request, "origin");
  return origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`;
}

function hasValidCsrf(request: IncomingMessage, expectedToken: string): boolean {
  const token = requestHeader(request, "x-codex-csrf");
  if (token == null) return false;
  const actual = Buffer.from(token, "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  let oversized = false;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > CONTROL_BODY_LIMIT_BYTES) {
      oversized = true;
      continue;
    }
    chunks.push(buffer);
  }
  if (oversized) {
    throw new HttpRequestError(400, "Request body exceeds 8192 bytes.");
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpRequestError(400, "Malformed JSON request body.");
  }
}

function isRequestedMode(value: unknown): value is RequestedMode {
  return value === "PAPER" || value === "LIVE";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendControlError(response: ServerResponse, error: unknown): void {
  if (error instanceof HttpRequestError) {
    sendJson(response, error.statusCode, { error: error.message });
    return;
  }
  if (error instanceof ControlConflictError || error instanceof ForceStopNotEligibleError) {
    sendJson(response, 409, { error: error.message });
    return;
  }
  if (error instanceof ControlValidationError) {
    sendJson(response, 400, { error: error.message });
    return;
  }
  sendJson(response, 500, { error: "Control request failed." });
}

export function createControlHttpServer(options: ControlHttpServerOptions): ReturnType<typeof createServer> {
  const routeBase = normalizeRouteBase(options.routeBase);
  const prefix = controlPrefix(routeBase);
  const serveUi = options.serveUi ?? handleUiRequest;

  const server = createServer((request, response) => {
    void (async () => {
      const pathname = new URL(request.url || "/", "http://localhost").pathname;
      const port = boundPort(server);
      if (port == null || !hasValidHost(request, port)) {
        sendText(response, 403, "Forbidden Host.");
        return;
      }
      const isControlRoute = pathname === prefix || pathname.startsWith(`${prefix}/`);
      if (!isControlRoute) {
        const handled = await serveUi(request, response, routeBase);
        if (!handled && !response.writableEnded) sendText(response, 404, "Not found");
        return;
      }

      try {
        if (request.method === "GET" && pathname === `${prefix}/bootstrap`) {
          sendJson(response, 200, {
            csrfToken: options.csrfToken,
            status: await options.controller.status(),
          });
          return;
        }
        if (request.method === "GET" && pathname === `${prefix}/status`) {
          sendJson(response, 200, { status: await options.controller.status() });
          return;
        }

        const mutation = request.method === "POST"
          && ["start", "stop", "force"].some((action) => pathname === `${prefix}/${action}`);
        if (!mutation) {
          throw new HttpRequestError(404, "Control route not found.");
        }
        if (!hasValidOrigin(request, port)) {
          throw new HttpRequestError(403, "Forbidden control Origin.");
        }
        const contentType = requestHeader(request, "content-type");
        if (!contentType || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
          throw new HttpRequestError(415, "Control mutations require application/json.");
        }
        if (!hasValidCsrf(request, options.csrfToken)) {
          throw new HttpRequestError(403, "Invalid control CSRF token.");
        }

        const body = await readJsonBody(request);
        let status: ControlStatus;
        if (pathname === `${prefix}/start`) {
          const mode = isRecord(body) ? body.mode : null;
          if (!isRequestedMode(mode)) {
            throw new HttpRequestError(400, "Requested mode must be PAPER or LIVE.");
          }
          status = await options.controller.start(mode);
        } else if (pathname === `${prefix}/stop`) {
          status = await options.controller.stop();
        } else {
          status = await options.controller.forceStop();
        }
        sendJson(response, 202, { status });
      } catch (error) {
        if (!response.writableEnded) sendControlError(response, error);
      }
    })().catch(() => {
      if (!response.writableEnded) sendJson(response, 500, { error: "Control request failed." });
    });
  });

  return server;
}

function listenLoopback(server: ReturnType<typeof createServer>, port: number): Promise<number> {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address() as AddressInfo;
      resolveListen(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

export async function startControlHttpServer(
  options: ControlHttpServerOptions & {
    preferredPort: number;
    openBrowser?: boolean;
    browserOpener?: (url: string) => void;
  },
): Promise<{ server: ReturnType<typeof createServer>; port: number; url: string }> {
  const server = createControlHttpServer(options);
  let activePort: number | null = null;
  let lastError: unknown = null;

  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const candidate = options.preferredPort === 0 ? 0 : options.preferredPort + offset;
    try {
      activePort = await listenLoopback(server, candidate);
      break;
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || offset === MAX_PORT_ATTEMPTS - 1) {
        throw error;
      }
    }
  }

  if (activePort == null) {
    throw lastError instanceof Error ? lastError : new Error("Control server failed to bind to loopback.");
  }
  const routeBase = normalizeRouteBase(options.routeBase);
  const routeSuffix = routeBase === "/" ? "" : routeBase;
  const url = `http://127.0.0.1:${activePort}${routeSuffix}/codex`;
  if (options.openBrowser === true) (options.browserOpener ?? openUiBrowser)(url);
  return { server, port: activePort, url };
}
