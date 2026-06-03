import {
    ENV_PATH,
    readOptionalConfigEnv,
    readOptionalSecret,
    readRequiredConfigEnv,
    readRequiredSecret,
    readConfigEnv,
} from "./secrets";

const PAPER_MODE_DUMMY_PRIVATE_KEY = "0x0000000000000000000000000000000000000000000000000000000000000001";

export const PAPER_TRADING = parseBooleanEnv(readConfigEnv("PAPER_TRADING"), false);
export const PAPER_STARTING_USD = parseNumberEnv(readConfigEnv("PAPER_STARTING_USD"), 100);
export const POLYMARKET_SIGNATURE_TYPE = parseIntegerEnv(readConfigEnv("POLYMARKET_SIGNATURE_TYPE"), 3);
export const POLYMARKET_API_KEY = readOptionalSecret("POLYMARKET_API_KEY");
export const POLYMARKET_API_SECRET = readOptionalSecret("POLYMARKET_API_SECRET");
export const POLYMARKET_API_PASSPHRASE = readOptionalSecret("POLYMARKET_API_PASSPHRASE");
export const COLLATERAL_GUARD_ENABLED = parseBooleanEnv(readConfigEnv("COLLATERAL_GUARD_ENABLED"), true);
export const COLLATERAL_GUARD_POLL_MS = parseIntegerEnv(readConfigEnv("COLLATERAL_GUARD_POLL_MS"), 2500);
export const COLLATERAL_GUARD_CONFIRMATION_BLOCKS = parseIntegerEnv(readConfigEnv("COLLATERAL_GUARD_CONFIRMATION_BLOCKS"), 3);
export const COLLATERAL_GUARD_MAX_BLOCK_RANGE = parseIntegerEnv(readConfigEnv("COLLATERAL_GUARD_MAX_BLOCK_RANGE"), 5000);
export const COLLATERAL_GUARD_ALLOWED_RECIPIENTS = parseStringListEnv(readConfigEnv("COLLATERAL_GUARD_ALLOWED_RECIPIENTS"));
export const POLYGON_RPC_URL =
    readOptionalConfigEnv("POLYGON_RPC_URL")
    || readOptionalConfigEnv("RPC_URL")
    || readOptionalConfigEnv("POLYGON_MAINNET_RPC_URL");

const configuredPrivateKey = PAPER_TRADING
    ? readOptionalSecret("POLYMARKET_PRIVATE_KEY") || PAPER_MODE_DUMMY_PRIVATE_KEY
    : readRequiredSecret("POLYMARKET_PRIVATE_KEY");
export const POLYMARKET_PRIVATE_KEY = normalizePrivateKey(configuredPrivateKey);

const explicitFunderAddress =
    readOptionalConfigEnv("POLYMARKET_FUNDER_ADDRESS")
    || readOptionalConfigEnv("DEPOSIT_WALLET_ADDRESS");
const legacyProxyWalletAddress = readOptionalConfigEnv("PROXY_WALLET_ADDRESS");
const configuredFunderAddress =
    explicitFunderAddress
    || (POLYMARKET_SIGNATURE_TYPE === 3 ? "" : legacyProxyWalletAddress);

export const PROXY_WALLET_ADDRESS = PAPER_TRADING
    ? configuredFunderAddress || legacyProxyWalletAddress
    : requireFunderAddress(configuredFunderAddress);
export const POLYMARKET_FUNDER_ADDRESS = PROXY_WALLET_ADDRESS;

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
    if (value == null || value.trim() === "") {
        return defaultValue;
    }

    switch (value.trim().toLowerCase()) {
        case "1":
        case "true":
        case "yes":
        case "on":
            return true;
        case "0":
        case "false":
        case "no":
        case "off":
            return false;
        default:
            throw new Error(`Invalid boolean value "${value}" in ${ENV_PATH}`);
    }
}

function parseNumberEnv(value: string | undefined, defaultValue: number): number {
    if (value == null || value.trim() === "") {
        return defaultValue;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`Invalid numeric value "${value}" in ${ENV_PATH}`);
    }

    return parsed;
}

function parseIntegerEnv(value: string | undefined, defaultValue: number): number {
    if (value == null || value.trim() == "") {
        return defaultValue;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`Invalid integer value "${value}" in ${ENV_PATH}`);
    }

    return parsed;
}

function requireFunderAddress(value: string): string {
    if (value) {
        return value;
    }

    if (POLYMARKET_SIGNATURE_TYPE === 3) {
        throw new Error(
            "POLYMARKET_SIGNATURE_TYPE=3 requires POLYMARKET_FUNDER_ADDRESS or DEPOSIT_WALLET_ADDRESS " +
            `to be set to the deposit wallet address. Legacy PROXY_WALLET_ADDRESS is ignored for type 3 in ${ENV_PATH}.`
        );
    }

    return readRequiredConfigEnv("PROXY_WALLET_ADDRESS");
}

function normalizePrivateKey(value: string): string {
    const trimmed = value.trim();
    if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
        return trimmed;
    }
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        return `0x${trimmed}`;
    }
    return trimmed;
}

function parseStringListEnv(value: string | undefined): string[] {
    if (value == null || value.trim() === "") {
        return [];
    }

    const trimmed = value.trim();
    if (trimmed.startsWith("[")) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.map((entry) => String(entry).trim()).filter(Boolean);
            }
        } catch {
            throw new Error(`Invalid JSON array value "${value}" in ${ENV_PATH}`);
        }
    }

    return trimmed
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}
