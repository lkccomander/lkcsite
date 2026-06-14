import { AssetType, ClobClient } from "@polymarket/clob-client-v2";
import { formatUnits } from "viem";
import { FUNDER, PUBLIC_CLIENT, SIGNER_ADDRESS } from "./clob";
import { writeTelemetryEventSafe } from "../telemetry";

const COLLATERAL_DECIMALS = 6;
const CONDITIONAL_TOKEN_DECIMALS = 6;

function toFixedNumber(value: string | bigint, decimals: number): number {
    const numeric = Number.parseFloat(formatUnits(BigInt(value), decimals));
    return Number.isFinite(numeric) ? numeric : 0;
}

async function fetchConditionalBalance(
    client: ClobClient,
    tokenId: string | null | undefined,
): Promise<number | null> {
    if (!tokenId) {
        return null;
    }

    const balance = await client.getBalanceAllowance({
        asset_type: AssetType.CONDITIONAL,
        token_id: tokenId,
    });

    return toFixedNumber(balance.balance, CONDITIONAL_TOKEN_DECIMALS);
}

async function fetchCollateralBalanceUsd(client: ClobClient): Promise<number | null> {
    const balance = await client.getBalanceAllowance({
        asset_type: AssetType.COLLATERAL,
    });

    return toFixedNumber(balance.balance, COLLATERAL_DECIMALS);
}

async function fetchPolygonGasBalance(): Promise<number | null> {
    const address = FUNDER || SIGNER_ADDRESS;
    if (!address) {
        return null;
    }

    const balance = await PUBLIC_CLIENT.getBalance({
        address: address as `0x${string}`,
    });

    return Number.parseFloat(formatUnits(balance, 18));
}

export interface LiveBalanceCheckpointOptions {
    client: ClobClient | null | undefined;
    reason: string;
    marketSlug?: string | null;
    upTokenId?: string | null;
    downTokenId?: string | null;
}

export async function writeLiveBalanceCheckpoint({
    client,
    reason,
    marketSlug = null,
    upTokenId = null,
    downTokenId = null,
}: LiveBalanceCheckpointOptions): Promise<void> {
    if (!client) {
        return;
    }

    try {
        const [collateralBalanceUsd, upTokenBalance, downTokenBalance, polygonGasBalance] = await Promise.all([
            fetchCollateralBalanceUsd(client),
            fetchConditionalBalance(client, upTokenId),
            fetchConditionalBalance(client, downTokenId),
            fetchPolygonGasBalance(),
        ]);

        await writeTelemetryEventSafe("live_balance.checkpoint", {
            reason,
            marketSlug,
            signerAddress: SIGNER_ADDRESS || null,
            funderAddress: FUNDER || null,
            collateralBalanceUsd,
            upTokenId,
            upTokenBalance,
            downTokenId,
            downTokenBalance,
            polygonGasBalance,
        });
    } catch (error) {
        await writeTelemetryEventSafe("live_balance.checkpoint", {
            reason,
            marketSlug,
            signerAddress: SIGNER_ADDRESS || null,
            funderAddress: FUNDER || null,
            collateralBalanceUsd: null,
            upTokenId,
            upTokenBalance: null,
            downTokenId,
            downTokenBalance: null,
            polygonGasBalance: null,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
