import { formatUnits, getAddress, Interface, isAddress, JsonRpcProvider, type Log } from "ethers";
import {
    COLLATERAL_GUARD_ALLOWED_RECIPIENTS,
    COLLATERAL_GUARD_CONFIRMATION_BLOCKS,
    COLLATERAL_GUARD_MAX_BLOCK_RANGE,
    COLLATERAL_GUARD_POLL_MS,
} from "../config";
import { writeTelemetryEventSafe } from "../telemetry";
import { RPC_URL } from "./clob";

export const PUSD_COLLATERAL_TOKEN = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB";

type Address = `0x${string}`;
type Hex = `0x${string}`;

const ERC20_INTERFACE = new Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const TRANSFER_TOPIC = ERC20_INTERFACE.getEvent("Transfer")?.topicHash;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const LOG_RETRY_ATTEMPTS = 3;
const LOG_RETRY_BASE_DELAY_MS = 350;

// Polymarket CLOB/adapter contracts. Normal trades may transfer pUSD directly
// to counterparties, but the top-level transaction must target one of these.
const DEFAULT_ALLOWED_RECIPIENTS = [
    "0xE111180000d2663C0091e4f400237545B87B996B",
    "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
    "0xe2222d279d744050d28e00520010520000310F59",
];

export interface CollateralEgressViolation {
    amountPusd: string;
    rawAmount: string;
    blockNumber: string;
    logIndex: number;
    txHash: Hex;
    from: Address;
    to: Address;
    transactionTarget: Address | null;
    allowedRecipients: string[];
}

export class CollateralEgressViolationError extends Error {
    details: CollateralEgressViolation;

    constructor(details: CollateralEgressViolation) {
        super(
            `Collateral guard blocked unexpected pUSD transfer: ${details.amountPusd} pUSD ` +
            `from ${details.from} to ${details.to} in ${details.txHash}`
        );
        this.name = "CollateralEgressViolationError";
        this.details = details;
    }
}

export function isCollateralEgressViolation(error: unknown): error is CollateralEgressViolationError {
    return error instanceof CollateralEgressViolationError || (
        error instanceof Error && error.name === "CollateralEgressViolationError"
    );
}

export class CollateralEgressGuard {
    private readonly funder: Address;
    private readonly token: Address;
    private readonly allowedRecipients: Set<string>;
    private readonly provider: JsonRpcProvider;
    private readonly pollMs: number;
    private readonly confirmationBlocks: number;
    private readonly maxBlockRange: number;
    private readonly transactionTargetCache = new Map<string, Address | null>();
    private lastScannedBlock: number | null = null;
    private lastPollAtMs = 0;

    constructor(funderAddress: string) {
        if (!TRANSFER_TOPIC) {
            throw new Error("Unable to initialize ERC20 Transfer topic");
        }

        this.funder = normalizeAddress(funderAddress, "POLYMARKET_FUNDER_ADDRESS");
        this.token = normalizeAddress(PUSD_COLLATERAL_TOKEN, "pUSD collateral token");
        this.allowedRecipients = new Set(
            [...DEFAULT_ALLOWED_RECIPIENTS, ...COLLATERAL_GUARD_ALLOWED_RECIPIENTS]
                .map((address) => normalizeAddress(address, "COLLATERAL_GUARD_ALLOWED_RECIPIENTS").toLowerCase())
        );
        this.provider = new JsonRpcProvider(RPC_URL, 137);
        this.pollMs = Math.max(250, COLLATERAL_GUARD_POLL_MS);
        this.confirmationBlocks = Math.max(0, COLLATERAL_GUARD_CONFIRMATION_BLOCKS);
        this.maxBlockRange = Math.max(1, COLLATERAL_GUARD_MAX_BLOCK_RANGE);
    }

    getAllowedRecipients(): string[] {
        return [...this.allowedRecipients];
    }

    async start(): Promise<void> {
        const latestBlock = await this.provider.getBlockNumber();
        this.lastScannedBlock = this.getSafeToBlock(latestBlock);
        this.lastPollAtMs = Date.now();
        await writeTelemetryEventSafe("collateral.guard_started", {
            funderAddress: this.funder,
            pUsdToken: this.token,
            startBlock: this.lastScannedBlock.toString(),
            latestBlock: latestBlock.toString(),
            pollMs: this.pollMs,
            confirmationBlocks: this.confirmationBlocks,
            allowedRecipients: this.getAllowedRecipients(),
        });
    }

    async assertSafe(reason: string, force = false): Promise<void> {
        const now = Date.now();
        if (!force && now - this.lastPollAtMs < this.pollMs) {
            return;
        }

        this.lastPollAtMs = now;
        if (this.lastScannedBlock == null) {
            await this.start();
            return;
        }

        const latestBlock = await this.provider.getBlockNumber();
        const safeToBlock = this.getSafeToBlock(latestBlock);
        if (safeToBlock <= this.lastScannedBlock) {
            return;
        }

        try {
            await this.scanRange(this.lastScannedBlock + 1, safeToBlock, reason);
            this.lastScannedBlock = safeToBlock;
        } catch (error) {
            if (isCollateralEgressViolation(error)) {
                throw error;
            }

            await writeTelemetryEventSafe("collateral.guard_error", {
                reason,
                funderAddress: this.funder,
                fromBlock: String(this.lastScannedBlock + 1),
                toBlock: safeToBlock.toString(),
                latestBlock: latestBlock.toString(),
                confirmationBlocks: this.confirmationBlocks,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    private getSafeToBlock(latestBlock: number): number {
        return Math.max(0, latestBlock - this.confirmationBlocks);
    }

    private async scanRange(fromBlock: number, toBlock: number, reason: string): Promise<void> {
        for (let rangeStart = fromBlock; rangeStart <= toBlock; rangeStart += this.maxBlockRange) {
            const rangeEnd = Math.min(rangeStart + this.maxBlockRange - 1, toBlock);
            const logs = await this.getTransferLogs(rangeStart, rangeEnd);

            for (const log of logs) {
                const parsed = ERC20_INTERFACE.parseLog(log);
                const to = parsed?.args.to ? normalizeAddress(parsed.args.to, "transfer recipient") : normalizeAddress(ZERO_ADDRESS, "transfer recipient");
                const rawAmount = parsed?.args.value ?? 0n;
                const payload = {
                    reason,
                    amountPusd: formatUnits(rawAmount, 6),
                    rawAmount: rawAmount.toString(),
                    blockNumber: String(log.blockNumber ?? "unknown"),
                    logIndex: log.index ?? -1,
                    txHash: log.transactionHash as Hex,
                    from: this.funder,
                    to,
                    transactionTarget: await this.getTransactionTarget(log.transactionHash),
                    allowedRecipients: this.getAllowedRecipients(),
                };

                const recipientAllowed = this.allowedRecipients.has(to.toLowerCase());
                const transactionTargetAllowed =
                    payload.transactionTarget !== null &&
                    this.allowedRecipients.has(payload.transactionTarget.toLowerCase());

                if (!recipientAllowed && !transactionTargetAllowed) {
                    await writeTelemetryEventSafe("collateral.egress_blocked", payload);
                    throw new CollateralEgressViolationError(payload);
                }

                await writeTelemetryEventSafe("collateral.egress_allowed", {
                    ...payload,
                    allowedBy: recipientAllowed ? "recipient" : "transaction_target",
                });
            }
        }
    }

    private async getTransferLogs(fromBlock: number, toBlock: number): Promise<Log[]> {
        try {
            return await this.getTransferLogsWithRetry(fromBlock, toBlock);
        } catch (error) {
            if (fromBlock >= toBlock || !isTransientRpcError(error)) {
                throw error;
            }

            const midBlock = Math.floor((fromBlock + toBlock) / 2);
            const leftLogs = await this.getTransferLogs(fromBlock, midBlock);
            const rightLogs = await this.getTransferLogs(midBlock + 1, toBlock);
            return [...leftLogs, ...rightLogs];
        }
    }

    private async getTransferLogsWithRetry(fromBlock: number, toBlock: number): Promise<Log[]> {
        let lastError: unknown;
        for (let attempt = 1; attempt <= LOG_RETRY_ATTEMPTS; attempt += 1) {
            try {
                return await this.provider.getLogs({
                    address: this.token,
                    topics: [
                        TRANSFER_TOPIC,
                        addressTopic(this.funder),
                    ],
                    fromBlock,
                    toBlock,
                });
            } catch (error) {
                lastError = error;
                if (!isTransientRpcError(error) || attempt >= LOG_RETRY_ATTEMPTS) {
                    break;
                }
                await delay(LOG_RETRY_BASE_DELAY_MS * attempt);
            }
        }

        throw lastError;
    }

    private async getTransactionTarget(txHash: string): Promise<Address | null> {
        const normalizedTxHash = txHash.toLowerCase();
        if (this.transactionTargetCache.has(normalizedTxHash)) {
            return this.transactionTargetCache.get(normalizedTxHash) ?? null;
        }

        const tx = await this.provider.getTransaction(txHash);
        const target = tx?.to ? normalizeAddress(tx.to, "transaction target") : null;
        this.transactionTargetCache.set(normalizedTxHash, target);
        return target;
    }
}

function normalizeAddress(value: string, label: string): Address {
    const trimmed = value.trim();
    if (!isAddress(trimmed)) {
        throw new Error(`${label} is not a valid address: ${value}`);
    }

    return getAddress(trimmed) as Address;
}

function addressTopic(address: Address): string {
    return `0x${address.toLowerCase().slice(2).padStart(64, "0")}`;
}

function isTransientRpcError(error: unknown): boolean {
    const value = error as {
        code?: string | number;
        message?: string;
        shortMessage?: string;
        error?: { code?: string | number; message?: string };
    };
    const code = String(value?.code ?? value?.error?.code ?? "").toLowerCase();
    const message = `${value?.message ?? ""} ${value?.shortMessage ?? ""} ${value?.error?.message ?? ""}`.toLowerCase();

    return (
        code === "unknown_error" ||
        code === "server_error" ||
        code === "timeout" ||
        code === "-32002" ||
        message.includes("timed out") ||
        message.includes("timeout") ||
        message.includes("econnreset") ||
        message.includes("rate limit")
    );
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
