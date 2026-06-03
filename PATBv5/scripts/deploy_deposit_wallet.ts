import { BuilderApiKeyCreds, BuilderConfig } from "@polymarket/builder-signing-sdk";
import { RelayClient } from "@polymarket/builder-relayer-client";
import { createPublicClient, createWalletClient, erc20Abi, formatUnits, getContract, Hex, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

import { readOptionalConfigEnv, readRequiredSecret } from "../src/config/secrets";

const CHAIN_ID = 137;
const DEFAULT_RELAYER_URL = "https://relayer-v2.polymarket.com";
const DEFAULT_POLYGON_RPC_URL = "https://polygon-bor-rpc.publicnode.com";
const PUSD_COLLATERAL_TOKEN = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB";

function normalizePrivateKey(value: string): Hex {
  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed as Hex;
  }
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return `0x${trimmed}` as Hex;
  }
  return trimmed as Hex;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const deploy = hasFlag("--deploy");
  const privateKey = normalizePrivateKey(readRequiredSecret("POLYMARKET_PRIVATE_KEY"));
  const builderCreds: BuilderApiKeyCreds = {
    key: readRequiredSecret("BUILDER_API_KEY"),
    secret: readRequiredSecret("BUILDER_SECRET"),
    passphrase: readRequiredSecret("BUILDER_PASS_PHRASE"),
  };

  const relayerUrl = readOptionalConfigEnv("POLYMARKET_RELAYER_URL") || DEFAULT_RELAYER_URL;
  const rpcUrl = readOptionalConfigEnv("POLYGON_RPC_URL") || DEFAULT_POLYGON_RPC_URL;
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({
    account,
    chain: polygon,
    transport: http(rpcUrl),
  });
  const publicClient = createPublicClient({
    chain: polygon,
    transport: http(rpcUrl),
  });
  const builderConfig = new BuilderConfig({
    localBuilderCreds: builderCreds,
  });
  const relayer = new RelayClient(relayerUrl, CHAIN_ID, wallet, builderConfig);
  const depositWallet = await relayer.deriveDepositWalletAddress();
  const deployedViaRelayer = await relayer.getDeployed(depositWallet, "WALLET").catch(() => false);
  const code = await publicClient.getBytecode({ address: depositWallet as `0x${string}` });
  const deployedOnchain = Boolean(code && code !== "0x");
  const pUsd = getContract({
    address: PUSD_COLLATERAL_TOKEN,
    abi: erc20Abi,
    client: publicClient,
  });
  const balance = await pUsd.read.balanceOf([depositWallet as `0x${string}`]);

  console.log(`Signer: ${account.address}`);
  console.log(`Deposit wallet: ${depositWallet}`);
  console.log(`Relayer deployed: ${deployedViaRelayer ? "yes" : "no"}`);
  console.log(`Onchain deployed: ${deployedOnchain ? "yes" : "no"}`);
  console.log(`pUSD balance: ${formatUnits(balance, 6)}`);

  if (!deploy) {
    console.log("");
    console.log("Dry run only. Re-run with --deploy to submit WALLET-CREATE through the relayer.");
    return;
  }

  if (deployedViaRelayer || deployedOnchain) {
    console.log("Deposit wallet is already deployed. Nothing to submit.");
    return;
  }

  console.log("Submitting WALLET-CREATE to Polymarket relayer...");
  const response = await relayer.deployDepositWallet();
  console.log(`Transaction ID: ${response.transactionID}`);
  console.log(`Initial state: ${response.state}`);
  const confirmed = await response.wait();
  if (!confirmed) {
    throw new Error("Relayer transaction did not confirm before polling timed out");
  }

  console.log(`Final state: ${confirmed.state}`);
  console.log(`Transaction hash: ${confirmed.transactionHash}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
