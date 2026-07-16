import { connect as connectTls } from "node:tls";
import WebSocket = require("ws");

import { classifyTransportError, type TransportErrorCategory } from "./transportError";

const CLOB_HOST = "clob.polymarket.com";
const WS_HOST = "ws-subscriptions-clob.polymarket.com";
const WS_URL = `wss://${WS_HOST}/ws/market`;
const PROBE_TIMEOUT_MS = 10_000;

export interface TlsProbeResult {
    authorized: boolean;
    protocol: string | null;
    cipher: string | null;
    issuer: string | null;
    validTo: string | null;
    bits: number | null;
}

export interface WebSocketProbeResult {
    opened: boolean;
    error?: string;
}

export interface FeedReadinessProbes {
    tls(host: string): Promise<TlsProbeResult>;
    websocket(url: string): Promise<WebSocketProbeResult>;
}

export interface FeedReadinessCheck {
    name: string;
    endpoint: string;
    ok: boolean;
    message: string;
    category: TransportErrorCategory | "ok";
    details?: TlsProbeResult | WebSocketProbeResult;
}

export interface FeedReadinessResult {
    ok: boolean;
    checks: FeedReadinessCheck[];
}

function issuerLabel(issuer: Record<string, unknown> | undefined): string | null {
    if (!issuer) return null;
    return [issuer.O, issuer.CN].filter((value) => typeof value === "string").join(" / ") || null;
}

export function probeTls(host: string): Promise<TlsProbeResult> {
    return new Promise((resolve, reject) => {
        const socket = connectTls({
            host,
            port: 443,
            servername: host,
            rejectUnauthorized: true,
        });
        const timer = setTimeout(() => {
            socket.destroy(new Error(`TLS probe timed out after ${PROBE_TIMEOUT_MS}ms`));
        }, PROBE_TIMEOUT_MS);

        socket.once("secureConnect", () => {
            clearTimeout(timer);
            const certificate = socket.getPeerCertificate();
            const result: TlsProbeResult = {
                authorized: socket.authorized,
                protocol: socket.getProtocol(),
                cipher: socket.getCipher()?.name ?? null,
                issuer: issuerLabel(certificate.issuer as Record<string, unknown> | undefined),
                validTo: certificate.valid_to ?? null,
                bits: typeof certificate.bits === "number" ? certificate.bits : null,
            };
            socket.end();
            resolve(result);
        });
        socket.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

export function probeWebSocket(url: string): Promise<WebSocketProbeResult> {
    return new Promise((resolve) => {
        const socket = new WebSocket(url);
        let settled = false;
        const finish = (result: WebSocketProbeResult) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
                socket.terminate();
            } catch {
                // Probe cleanup is best effort.
            }
            resolve(result);
        };
        const timer = setTimeout(
            () => finish({ opened: false, error: `WebSocket probe timed out after ${PROBE_TIMEOUT_MS}ms` }),
            PROBE_TIMEOUT_MS,
        );
        socket.once("open", () => finish({ opened: true }));
        socket.once("error", (error) => finish({ opened: false, error: error.message }));
    });
}

export const defaultFeedReadinessProbes: FeedReadinessProbes = {
    tls: probeTls,
    websocket: probeWebSocket,
};

async function tlsCheck(host: string, probes: FeedReadinessProbes): Promise<FeedReadinessCheck> {
    try {
        const details = await probes.tls(host);
        const ok = details.authorized && details.protocol !== null && details.cipher !== null;
        return {
            name: "tls",
            endpoint: host,
            ok,
            category: ok ? "ok" : "tls_certificate",
            message: ok
                ? `${details.protocol} ${details.cipher}; issuer=${details.issuer ?? "unknown"}; bits=${details.bits ?? "unknown"}`
                : "TLS connection did not provide an authorized certificate and negotiated cipher.",
            details,
        };
    } catch (error) {
        const classified = classifyTransportError(error);
        return {
            name: "tls",
            endpoint: host,
            ok: false,
            category: classified.category,
            message: classified.message,
        };
    }
}

async function websocketCheck(probes: FeedReadinessProbes): Promise<FeedReadinessCheck> {
    try {
        const details = await probes.websocket(WS_URL);
        return {
            name: "websocket",
            endpoint: WS_URL,
            ok: details.opened,
            category: details.opened ? "ok" : "socket_error",
            message: details.opened ? "WebSocket opened successfully." : details.error ?? "WebSocket did not open.",
            details,
        };
    } catch (error) {
        const classified = classifyTransportError(error);
        return {
            name: "websocket",
            endpoint: WS_URL,
            ok: false,
            category: classified.category,
            message: classified.message,
        };
    }
}

export async function runFeedReadiness(
    probes: FeedReadinessProbes = defaultFeedReadinessProbes,
): Promise<FeedReadinessResult> {
    const checks = await Promise.all([
        tlsCheck(CLOB_HOST, probes),
        tlsCheck(WS_HOST, probes),
        websocketCheck(probes),
    ]);
    return { ok: checks.every((check) => check.ok), checks };
}
