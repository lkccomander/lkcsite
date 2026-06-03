import crypto from "crypto";
import { BuilderApiKeyCreds, BuilderConfig } from "@polymarket/builder-signing-sdk";

import { readOptionalConfigEnv, readRequiredSecret } from "../src/config/secrets";

const DEFAULT_RELAYER_URL = "https://relayer-v2.polymarket.com";

function fingerprint(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function looksBase64(value: string): boolean {
  if (!value || value.length % 4 !== 0) {
    return false;
  }
  try {
    const decoded = Buffer.from(value, "base64");
    return decoded.length > 0 && decoded.toString("base64").replace(/=+$/, "") === value.replace(/=+$/, "");
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const creds: BuilderApiKeyCreds = {
    key: readRequiredSecret("BUILDER_API_KEY"),
    secret: readRequiredSecret("BUILDER_SECRET"),
    passphrase: readRequiredSecret("BUILDER_PASS_PHRASE"),
  };
  const relayerUrl = (readOptionalConfigEnv("POLYMARKET_RELAYER_URL") || DEFAULT_RELAYER_URL).replace(/\/+$/, "");
  const body = JSON.stringify({
    type: "WALLET-CREATE",
    from: "0x0000000000000000000000000000000000000000",
    to: "0x0000000000000000000000000000000000000000",
  });
  const builderConfig = new BuilderConfig({ localBuilderCreds: creds });
  const headers = await builderConfig.generateBuilderHeaders("POST", "/submit", body);

  console.log("Builder credential diagnostics:");
  console.log(`- key length: ${creds.key.length}, fingerprint: ${fingerprint(creds.key)}`);
  console.log(`- secret length: ${creds.secret.length}, base64-like: ${looksBase64(creds.secret) ? "yes" : "no"}, fingerprint: ${fingerprint(creds.secret)}`);
  console.log(`- passphrase length: ${creds.passphrase.length}, fingerprint: ${fingerprint(creds.passphrase)}`);
  console.log(`- relayer URL: ${relayerUrl}`);
  console.log(`- generated headers: ${headers ? "yes" : "no"}`);

  const response = await fetch(`${relayerUrl}/submit`, {
    method: "POST",
    headers: {
      ...(headers ?? {}),
      "Content-Type": "application/json",
    },
    body,
  });
  const text = await response.text();
  console.log(`- signed /submit probe HTTP: ${response.status} ${response.statusText}`);
  console.log(`- signed /submit probe body: ${text.slice(0, 300)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
