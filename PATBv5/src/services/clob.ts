import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Chain, SignatureTypeV2 } from "@polymarket/clob-client-v2";
import { POLYGON_RPC_URL, POLYMARKET_FUNDER_ADDRESS, POLYMARKET_PRIVATE_KEY, POLYMARKET_SIGNATURE_TYPE } from "../config";

export const HOST = "https://clob.polymarket.com";
export const CHAIN_ID = Chain.POLYGON;
export const DEFAULT_POLYGON_RPC_URL = "https://polygon-bor-rpc.publicnode.com";
export const RPC_URL = POLYGON_RPC_URL || DEFAULT_POLYGON_RPC_URL;
export const ACCOUNT = privateKeyToAccount(POLYMARKET_PRIVATE_KEY as `0x${string}`);
export const SIGNER = createWalletClient({
  account: ACCOUNT,
  chain: undefined,
  transport: http(RPC_URL),
});
export const PUBLIC_CLIENT = createPublicClient({
  chain: undefined,
  transport: http(RPC_URL),
});
export const SIGNER_ADDRESS = ACCOUNT.address;

// FUNDER is the address that holds trading funds. For deposit-wallet mode
// (signature type 3 / POLY_1271), this must be the deposit wallet address.
export const FUNDER = POLYMARKET_FUNDER_ADDRESS;
const hasDistinctFunder =
  FUNDER.trim().length > 0
  && FUNDER.toLowerCase() !== SIGNER_ADDRESS.toLowerCase();
const supportedSignatureTypes = new Set<number>([
  SignatureTypeV2.EOA,
  SignatureTypeV2.POLY_PROXY,
  SignatureTypeV2.POLY_GNOSIS_SAFE,
  SignatureTypeV2.POLY_1271,
]);

if (!supportedSignatureTypes.has(POLYMARKET_SIGNATURE_TYPE)) {
  throw new Error(`Unsupported POLYMARKET_SIGNATURE_TYPE=${POLYMARKET_SIGNATURE_TYPE}`);
}

export const SIGNATURE_TYPE = (
  hasDistinctFunder && POLYMARKET_SIGNATURE_TYPE === SignatureTypeV2.EOA
    ? SignatureTypeV2.POLY_PROXY
    : POLYMARKET_SIGNATURE_TYPE
); // Values: 0 = EOA, 1 = Poly proxy, 2 = Gnosis Safe, 3 = deposit wallet / POLY_1271
export const SIGNATURE_TYPE_SOURCE = (
  hasDistinctFunder && POLYMARKET_SIGNATURE_TYPE === SignatureTypeV2.EOA
    ? "auto_proxy_from_distinct_funder"
    : "env"
);

const PRICE_FETCH_TIMEOUT_MS = 4000;

export const getPrices = async (upTokenId: string, downTokenId: string) => {
    const response = await fetch("https://clob.polymarket.com/prices", {
        method: "POST",
        signal: AbortSignal.timeout(PRICE_FETCH_TIMEOUT_MS),
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify([
            {
                token_id: upTokenId,
                side: "BUY",
            },
            {
                token_id: upTokenId,
                side: "SELL",
            },
            {
                token_id: downTokenId,
                side: "BUY",
            },
            {
                token_id: downTokenId,
                side: "SELL",
            },
        ]),
    });
    if (!response.ok) {
        throw new Error(`Price request failed: ${response.status} ${response.statusText}`);
    }
    const prices = await response.json();
    return prices;
}
