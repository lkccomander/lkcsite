#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from secret_utils import hydrate_runtime_secrets, load_env_file


ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
DEFAULT_NODE_PATH = Path("/mnt/c/Program Files/nodejs/node.exe")
HOST = "https://clob.polymarket.com"
CHAIN_ID = 137
NODE_MODULES_ROOT = ROOT / "node_modules"


def wsl_to_windows_path(path: Path) -> str:
    raw = str(path)
    if raw.startswith("/mnt/") and len(raw) > 6:
        drive = raw[5].upper()
        remainder = raw[6:].replace("/", "\\")
        return f"{drive}:{remainder}"
    return raw


def windows_to_wsl_path(raw: str) -> str:
    value = (raw or "").strip()
    if len(value) >= 3 and value[1:3] == ":\\":
        drive = value[0].lower()
        remainder = value[3:].replace("\\", "/")
        return f"/mnt/{drive}/{remainder}"
    return value


def find_node_path() -> str | None:
    env_node = os.environ.get("NODE_EXE", "").strip()
    if env_node:
        normalized = windows_to_wsl_path(env_node)
        if Path(normalized).exists():
            return normalized
        if Path(env_node).exists():
            return env_node
        return env_node
    if DEFAULT_NODE_PATH.exists():
        return str(DEFAULT_NODE_PATH)
    return None


def find_powershell_path() -> str:
    return shutil.which("powershell.exe") or shutil.which("pwsh") or "powershell.exe"


def configured_signature_type() -> int:
    return int(os.environ.get("POLYMARKET_SIGNATURE_TYPE", "3") or "3")


def resolve_funder_address() -> str:
    signature_type = configured_signature_type()
    explicit_funder = (
        os.environ.get("POLYMARKET_FUNDER_ADDRESS", "").strip()
        or os.environ.get("DEPOSIT_WALLET_ADDRESS", "").strip()
    )
    legacy_proxy = os.environ.get("PROXY_WALLET_ADDRESS", "").strip()
    if explicit_funder:
        return explicit_funder
    if signature_type == 3:
        return ""
    return legacy_proxy


def build_node_script() -> str:
    clob_client_path = json.dumps(wsl_to_windows_path(NODE_MODULES_ROOT / "@polymarket" / "clob-client-v2"))
    ethers_path = json.dumps(wsl_to_windows_path(NODE_MODULES_ROOT / "ethers"))
    payload = {
        "host": HOST,
        "chainId": CHAIN_ID,
        "signatureType": configured_signature_type(),
    }
    payload_json = json.dumps(payload)
    return f"""
const fs = require("fs");
const {{ ClobClient }} = require({clob_client_path});
const {{ Wallet }} = require({ethers_path});

const cfg = {payload_json};
const runtime = JSON.parse(fs.readFileSync(0, "utf8") || "{{}}");
const privateKey = normalizePrivateKey(runtime.privateKey || process.env.POLYMARKET_PRIVATE_KEY || "");
const explicitFunder = runtime.funder || process.env.POLYMARKET_FUNDER_ADDRESS || process.env.DEPOSIT_WALLET_ADDRESS || "";
const legacyProxy = process.env.PROXY_WALLET_ADDRESS || "";
const funder = explicitFunder || (cfg.signatureType === 3 ? "" : legacyProxy);

function normalizePrivateKey(value) {{
  const trimmed = String(value || "").trim();
  if (/^0x[0-9a-fA-F]{{64}}$/.test(trimmed)) {{
    return trimmed;
  }}
  if (/^[0-9a-fA-F]{{64}}$/.test(trimmed)) {{
    return `0x${{trimmed}}`;
  }}
  return trimmed;
}}

function wrapSigner(privateKey) {{
  const baseWallet = new Wallet(privateKey);
  return Object.assign(baseWallet, {{
    _signTypedData(domain, types, value) {{
      return this.signTypedData(domain, types, value);
    }},
    walletClient: {{
      account: {{
        address: baseWallet.address,
      }},
    }},
  }});
}}

(async () => {{
  const signer = wrapSigner(privateKey);
  const client = new ClobClient({{
    host: cfg.host,
    chain: cfg.chainId,
    signer,
    signatureType: cfg.signatureType,
    funderAddress: funder,
  }});

  let creds;
  let authSource = "";
  try {{
    creds = await client.deriveApiKey();
    authSource = "derive";
  }} catch (deriveError) {{
    try {{
      creds = await client.createApiKey();
      authSource = "create";
    }} catch (createError) {{
      const deriveMessage = String(deriveError && deriveError.stack ? deriveError.stack : deriveError);
      const createMessage = String(createError && createError.stack ? createError.stack : createError);
      throw new Error(
        "Both deriveApiKey and createApiKey failed.\\n\\n" +
        "[deriveApiKey]\\n" + deriveMessage + "\\n\\n" +
        "[createApiKey]\\n" + createMessage
      );
    }}
  }}

  process.stdout.write(JSON.stringify({{
    ok: true,
    apiKey: creds.key,
    secret: creds.secret,
    passphrase: creds.passphrase,
    authSource,
    funder,
    signerAddress: await signer.getAddress(),
  }}));
}})().catch((error) => {{
  process.stderr.write(String(error && error.stack ? error.stack : error));
  process.exit(1);
}});
""".strip()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Derive Polymarket CLOB API credentials for the configured signer/funder.")
    parser.add_argument(
        "--store",
        action="store_true",
        help="Store the derived credentials in Windows SecretStore instead of printing secret values.",
    )
    parser.add_argument(
        "--vault",
        default=os.environ.get("RABBITHAT_SECRET_VAULT", "botv4"),
        help="SecretStore vault name used with --store.",
    )
    parser.add_argument(
        "--prefix",
        default=os.environ.get("RABBITHAT_SECRET_PREFIX", "botv4_"),
        help="SecretStore secret name prefix used with --store.",
    )
    return parser.parse_args(argv)


def credential_fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]


def safe_summary(creds: dict, stored: bool) -> dict:
    return {
        "ok": True,
        "stored": stored,
        "authSource": creds.get("authSource", ""),
        "signerAddress": creds.get("signerAddress", ""),
        "funder": creds.get("funder", ""),
        "apiKey": {
            "length": len(str(creds.get("apiKey", ""))),
            "fingerprint": credential_fingerprint(str(creds.get("apiKey", ""))),
        },
        "secret": {
            "length": len(str(creds.get("secret", ""))),
            "fingerprint": credential_fingerprint(str(creds.get("secret", ""))),
        },
        "passphrase": {
            "length": len(str(creds.get("passphrase", ""))),
            "fingerprint": credential_fingerprint(str(creds.get("passphrase", ""))),
        },
    }


def store_in_secretstore(creds: dict, vault: str, prefix: str) -> None:
    store_script = ROOT / "scripts" / "store_polymarket_api_creds.ps1"
    proc = subprocess.run(
        [
            find_powershell_path(),
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            wsl_to_windows_path(store_script),
            "-VaultName",
            vault,
            "-Prefix",
            prefix,
        ],
        input=json.dumps(creds),
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or f"SecretStore write exit code {proc.returncode}")
    if proc.stdout.strip():
        print(proc.stdout.strip(), file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    load_env_file(ENV_PATH)
    hydrate_runtime_secrets(["POLYMARKET_PRIVATE_KEY"])

    private_key = os.environ.get("POLYMARKET_PRIVATE_KEY", "").strip()
    funder = resolve_funder_address()
    if not private_key:
        raise RuntimeError("POLYMARKET_PRIVATE_KEY is missing from the secret provider or process environment")
    if not funder:
        raise RuntimeError("POLYMARKET_FUNDER_ADDRESS or DEPOSIT_WALLET_ADDRESS is missing from process environment or non-secret config")
    if os.environ.get("POLYMARKET_SIGNATURE_TYPE", "").strip() == "":
        os.environ["POLYMARKET_SIGNATURE_TYPE"] = "3"

    node_path = find_node_path()
    if not node_path:
        raise RuntimeError("Node executable not found. Set NODE_EXE or install Node at C:\\Program Files\\nodejs\\node.exe")
    if not NODE_MODULES_ROOT.exists():
        raise RuntimeError(f"node_modules path not found: {NODE_MODULES_ROOT}")

    proc = subprocess.run(
        [node_path, "-e", build_node_script()],
        input=json.dumps({
            "privateKey": private_key,
            "funder": funder,
        }),
        capture_output=True,
        text=True,
        env=os.environ.copy(),
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or f"node exit code {proc.returncode}")

    creds = json.loads(proc.stdout.strip())
    if args.store:
        store_in_secretstore(creds, args.vault, args.prefix)
        print(json.dumps(safe_summary(creds, stored=True), indent=2))
    else:
        print(proc.stdout.strip())
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise
