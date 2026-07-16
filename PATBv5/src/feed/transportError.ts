export type TransportErrorCategory = "tls_certificate_policy" | "tls_certificate" | "socket_error";

export interface TransportErrorDetails {
    category: TransportErrorCategory;
    message: string;
    errorName: string | null;
    errorCode: string | null;
    causeCode: string | null;
}

const ORDINARY_RECONNECT_BACKOFF_MS = [250, 500, 1000, 2000, 4000, 8000] as const;
const TLS_POLICY_BASE_DELAY_MS = 60_000;
const TLS_POLICY_MAX_DELAY_MS = 15 * 60_000;

function stringField(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

export function classifyTransportError(error: unknown): TransportErrorDetails {
    const record = typeof error === "object" && error !== null
        ? error as Record<string, unknown>
        : {};
    const cause = typeof record.cause === "object" && record.cause !== null
        ? record.cause as Record<string, unknown>
        : {};
    const message = error instanceof Error ? error.message : String(error);
    const errorCode = stringField(record.code);
    const causeCode = stringField(cause.code);
    const searchable = [message, errorCode, causeCode].filter(Boolean).join(" ").toLowerCase();

    let category: TransportErrorCategory = "socket_error";
    if (
        searchable.includes("ee certificate key too weak")
        || searchable.includes("ee_key_too_small")
        || searchable.includes("ca key too small")
    ) {
        category = "tls_certificate_policy";
    } else if (
        searchable.includes("certificate")
        || searchable.includes("cert_")
        || searchable.includes("unable_to_verify")
        || searchable.includes("self_signed")
    ) {
        category = "tls_certificate";
    }

    return {
        category,
        message,
        errorName: error instanceof Error ? error.name : stringField(record.name),
        errorCode,
        causeCode,
    };
}

export function reconnectDelayFor(category: TransportErrorCategory, attempt: number): number {
    const normalizedAttempt = Math.max(1, Math.floor(attempt));
    if (category === "tls_certificate_policy" || category === "tls_certificate") {
        return Math.min(
            TLS_POLICY_MAX_DELAY_MS,
            TLS_POLICY_BASE_DELAY_MS * 2 ** Math.min(4, normalizedAttempt - 1),
        );
    }
    return ORDINARY_RECONNECT_BACKOFF_MS[
        Math.min(normalizedAttempt - 1, ORDINARY_RECONNECT_BACKOFF_MS.length - 1)
    ];
}
