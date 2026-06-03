#!/usr/bin/env python3
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from secret_utils import hydrate_runtime_secrets, load_env_file


ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
LOG_PATH = ROOT / "log.md"
DEFAULT_NODE_PATH = Path("/mnt/c/Program Files/nodejs/node.exe")
GAMMA_HOST = "https://gamma-api.polymarket.com"
DATA_HOST = "https://data-api.polymarket.com"
CLOB_HOST = "https://clob.polymarket.com"
HOST = CLOB_HOST
CHAIN_ID = 137
NODE_MODULES_ROOT = ROOT / "node_modules"
LOG_TEST_SEPARATOR = "# ====================================================="

PUBLIC_API_CHECKS = [
    {
        "name": "Gamma API",
        "url": f"{GAMMA_HOST}/markets?active=true&closed=false&limit=1",
        "expect": "non_empty_list",
    },
    {
        "name": "Data API",
        "url": f"{DATA_HOST}/trades?limit=1",
        "expect": "list",
    },
    {
        "name": "CLOB API",
        "url": f"{CLOB_HOST}/time",
        "expect": "int_like",
    },
]

SENSITIVE_LOG_PATTERNS = [
    re.compile(r'("(?:POLY_SIGNATURE|POLY_API_KEY|POLY_PASSPHRASE)"\s*:\s*")[^"]+(")'),
]


def redact(value: str, keep: int = 4) -> str:
    if not value:
        return "(missing)"
    if keep <= 0:
        return "***redacted***"
    if len(value) <= keep * 2:
        return "*" * len(value)
    return f"{value[:keep]}...{value[-keep:]}"


def sanitize_log_text(value: object) -> str:
    text = str(value)
    for pattern in SENSITIVE_LOG_PATTERNS:
        text = pattern.sub(r"\1***redacted***\2", text)
    return text


def truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def parse_int_like(value: object) -> int | None:
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return None


def summarize_collateral_allowance(collateral: dict) -> str:
    direct = collateral.get("allowance")
    if direct not in {None, ""}:
        return str(direct)

    allowances = collateral.get("allowances")
    if not isinstance(allowances, dict):
        return ""

    values = [parse_int_like(value) for value in allowances.values()]
    known_values = [value for value in values if value is not None]
    if not known_values:
        return f"{len(allowances)} spender allowances reported"

    nonzero_count = sum(1 for value in known_values if value > 0)
    return f"{nonzero_count}/{len(allowances)} spender allowances nonzero"


def summarize_api_body(body: object) -> str:
    if isinstance(body, list):
        summary = f"list[{len(body)}]"
        if body and isinstance(body[0], dict):
            first = body[0]
            hints = [
                f"{key}={first[key]}"
                for key in ("id", "question", "conditionId", "proxyWallet", "side")
                if first.get(key) not in {None, ""}
            ]
            if hints:
                summary += f" first({', '.join(hints[:3])})"
        return summary

    if isinstance(body, dict):
        return f"object keys={','.join(list(body.keys())[:8])}"

    return str(body)


def body_matches_expectation(body: object, expectation: str) -> bool:
    if expectation == "non_empty_list":
        return isinstance(body, list) and len(body) > 0
    if expectation == "list":
        return isinstance(body, list)
    if expectation == "int_like":
        return parse_int_like(body) is not None
    return body is not None


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
    path_node = shutil.which("node") or shutil.which("nodejs")
    if path_node:
        return path_node
    if DEFAULT_NODE_PATH.exists():
        return str(DEFAULT_NODE_PATH)
    return None


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


def fetch_json_url(url: str) -> tuple[int, object, int, int]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "polymarket-bot-v4-connectivity-check/1.0",
            "Accept": "application/json",
        },
    )
    started_at = time.perf_counter()
    with urllib.request.urlopen(request, timeout=15) as response:
        body_bytes = response.read()
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        body_text = body_bytes.decode("utf-8")
        try:
            parsed: object = json.loads(body_text)
        except json.JSONDecodeError:
            parsed = body_text.strip()
        return response.status, parsed, elapsed_ms, len(body_bytes)


def fetch_public_api_connectivity(verbose_enabled = False) -> dict:
    checks = []
    for check in PUBLIC_API_CHECKS:
        verbose_log(verbose_enabled, f"Checking {check['name']}: {check['url']}")
        try:
            status, body, elapsed_ms, byte_count = fetch_json_url(str(check["url"]))
            ok = 200 <= status < 300 and body_matches_expectation(body, str(check["expect"]))
            result = {
                "name": check["name"],
                "url": check["url"],
                "ok": ok,
                "status": status,
                "summary": summarize_api_body(body),
                "expect": check["expect"],
                "elapsedMs": elapsed_ms,
                "bytes": byte_count,
            }
            checks.append(result)
            verbose_log(
                verbose_enabled,
                f"{check['name']} {'OK' if ok else 'FAILED'} status={status} elapsedMs={elapsed_ms} bytes={byte_count}",
            )
        except Exception as exc:
            checks.append({
                "name": check["name"],
                "url": check["url"],
                "ok": False,
                "expect": check["expect"],
                "error": str(exc),
            })
            verbose_log(verbose_enabled, f"{check['name']} FAILED error={sanitize_log_text(exc)}")

    return {
        "ok": all(bool(check.get("ok")) for check in checks),
        "checks": checks,
    }


def build_node_script() -> str:
    clob_client_path = json.dumps(wsl_to_windows_path(NODE_MODULES_ROOT / "@polymarket" / "clob-client-v2"))
    ethers_path = json.dumps(wsl_to_windows_path(NODE_MODULES_ROOT / "ethers"))
    config_env_path = json.dumps(wsl_to_windows_path(ROOT / "dist" / "config" / "env.js"))
    payload = {
        "host": HOST,
        "chainId": CHAIN_ID,
        "signatureType": configured_signature_type(),
    }
    payload_json = json.dumps(payload)
    return f"""
const {{ ClobClient, AssetType }} = require({clob_client_path});
const {{ Wallet }} = require({ethers_path});
const botEnv = require({config_env_path});

const cfg = {payload_json};
const privateKey = normalizePrivateKey(botEnv.POLYMARKET_PRIVATE_KEY || process.env.POLYMARKET_PRIVATE_KEY || "");
const explicitFunder = botEnv.POLYMARKET_FUNDER_ADDRESS || process.env.POLYMARKET_FUNDER_ADDRESS || process.env.DEPOSIT_WALLET_ADDRESS || "";
const legacyProxy = botEnv.PROXY_WALLET_ADDRESS || process.env.PROXY_WALLET_ADDRESS || "";
const funder = explicitFunder || (cfg.signatureType === 3 ? "" : legacyProxy);
const manualApiKey = botEnv.POLYMARKET_API_KEY || process.env.POLYMARKET_API_KEY || "";
const manualApiSecret = botEnv.POLYMARKET_API_SECRET || process.env.POLYMARKET_API_SECRET || "";
const manualApiPassphrase = botEnv.POLYMARKET_API_PASSPHRASE || process.env.POLYMARKET_API_PASSPHRASE || "";

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
  const signerAddress = await signer.getAddress();
  const l1 = new ClobClient({{
    host: cfg.host,
    chain: cfg.chainId,
    signer,
    signatureType: cfg.signatureType,
    funderAddress: funder,
  }});

  const serverTime = await l1.getServerTime();
  let apiCreds;
  let authSource = "manual_env";
  if (manualApiKey && manualApiSecret && manualApiPassphrase) {{
    apiCreds = {{
      key: manualApiKey,
      secret: manualApiSecret,
      passphrase: manualApiPassphrase,
    }};
  }} else {{
    authSource = "";
    try {{
      apiCreds = await l1.deriveApiKey();
      authSource = "derive";
    }} catch (deriveError) {{
      try {{
        apiCreds = await l1.createApiKey();
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
  }}
  const l2 = new ClobClient({{
    host: cfg.host,
    chain: cfg.chainId,
    signer,
    creds: apiCreds,
    signatureType: cfg.signatureType,
    funderAddress: funder,
  }});

  const apiKeys = await l2.getApiKeys();
  const closedOnly = await l2.getClosedOnlyMode();
  const collateral = await l2.getBalanceAllowance({{ asset_type: AssetType.COLLATERAL }});

  const result = {{
    ok: true,
    signerAddress,
    funderAddress: funder,
    serverTime,
    derivedApiKey: {{
      key: apiCreds.key,
      secret: apiCreds.secret,
      passphrase: apiCreds.passphrase,
    }},
    authSource,
    apiKeysCount: Array.isArray(apiKeys.apiKeys) ? apiKeys.apiKeys.length : 0,
    closedOnly,
    collateral,
  }};

  process.stdout.write(JSON.stringify(result));
}})().catch((error) => {{
  process.stderr.write(String(error && error.stack ? error.stack : error));
  process.exit(1);
}});
""".strip()


def run_authenticated_check(verbose_enabled = False) -> dict:
    node_path = find_node_path()
    if not node_path:
        raise RuntimeError("Node executable not found. Set NODE_EXE or install Node at C:\\Program Files\\nodejs\\node.exe")

    if not NODE_MODULES_ROOT.exists():
        raise RuntimeError(f"node_modules path not found: {NODE_MODULES_ROOT}")

    verbose_log(verbose_enabled, f"Running authenticated CLOB check with node={node_path}")
    script = build_node_script()
    started_at = time.perf_counter()
    proc = subprocess.run(
        [node_path, "-e", script],
        capture_output=True,
        text=True,
        env=os.environ.copy(),
    )
    elapsed_ms = int((time.perf_counter() - started_at) * 1000)
    if proc.returncode != 0:
        verbose_log(verbose_enabled, f"Authenticated CLOB check FAILED exit={proc.returncode} elapsedMs={elapsed_ms}")
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or f"node exit code {proc.returncode}")

    try:
        result = json.loads(proc.stdout.strip())
        result["_elapsedMs"] = elapsed_ms
        result["_nodePath"] = node_path
        verbose_log(verbose_enabled, f"Authenticated CLOB check OK elapsedMs={elapsed_ms}")
        return result
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Failed to parse node output as JSON: {exc}\nRaw output: {proc.stdout}") from exc


def derive_signer_address() -> str | None:
    node_path = find_node_path()
    private_key = os.environ.get("POLYMARKET_PRIVATE_KEY", "").strip()
    if not node_path or not private_key or not NODE_MODULES_ROOT.exists():
        return None

    ethers_path = json.dumps(wsl_to_windows_path(NODE_MODULES_ROOT / "ethers"))
    config_env_path = json.dumps(wsl_to_windows_path(ROOT / "dist" / "config" / "env.js"))
    script = f"""
const {{ Wallet }} = require({ethers_path});
const botEnv = require({config_env_path});
const privateKey = normalizePrivateKey(botEnv.POLYMARKET_PRIVATE_KEY || process.env.POLYMARKET_PRIVATE_KEY || "");
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
const wallet = new Wallet(privateKey);
process.stdout.write(wallet.address);
""".strip()
    proc = subprocess.run(
        [node_path, "-e", script],
        capture_output=True,
        text=True,
        env=os.environ.copy(),
    )
    if proc.returncode != 0:
        return None
    value = proc.stdout.strip()
    return value or None


def detect_cloudflare_block(message: str) -> dict | None:
    text = (message or "").lower()
    if "cloudflare" not in text and "attention required" not in text and "sorry, you have been blocked" not in text:
        return None

    ray_id = None
    marker = "cloudflare ray id:"
    idx = text.find(marker)
    if idx >= 0:
        original = message[idx + len(marker):]
        stripped = original.strip()
        if stripped:
            candidate_chars = []
            for char in stripped:
                if char.isalnum():
                    candidate_chars.append(char)
                    continue
                if candidate_chars:
                    break
            candidate = "".join(candidate_chars).strip()
            if candidate:
                ray_id = candidate

    return {
        "blocked": True,
        "provider": "Cloudflare",
        "ray_id": ray_id,
        "summary": "Authenticated Polymarket request was blocked before normal API auth completed.",
    }


def current_timestamp_utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def response_has_error(value: object) -> bool:
    return isinstance(value, dict) and bool(value.get("error") or parse_int_like(value.get("status")) in {400, 401, 403, 404, 429, 500, 502, 503, 504})


def value_mentions_invalid_api_key(value: object) -> bool:
    try:
        text = json.dumps(value).lower()
    except TypeError:
        text = str(value).lower()
    return "unauthorized/invalid api key" in text or "invalid api key" in text


def auth_check_has_invalid_api_key(auth_check: dict) -> bool:
    return (
        value_mentions_invalid_api_key(auth_check.get("closedOnly"))
        or value_mentions_invalid_api_key(auth_check.get("collateral"))
        or value_mentions_invalid_api_key(auth_check.get("error"))
    )


def validate_authenticated_check(auth_check: dict) -> list[str]:
    errors: list[str] = []

    if parse_int_like(auth_check.get("serverTime")) is None:
        errors.append("serverTime is not a valid integer response")

    if response_has_error(auth_check.get("closedOnly")):
        errors.append(f"closedOnly returned an error response: {auth_check.get('closedOnly')}")

    collateral = auth_check.get("collateral")
    if not isinstance(collateral, dict):
        errors.append("collateral response is not an object")
    elif response_has_error(collateral):
        errors.append(f"collateral returned an error response: {collateral}")
    elif parse_int_like(collateral.get("balance")) is None:
        errors.append("collateral balance is missing or not integer-like")

    if not auth_check.get("derivedApiKey", {}).get("key"):
        errors.append("authenticated API key is missing")

    if auth_check_has_invalid_api_key(auth_check):
        errors.append(
            "stored POLYMARKET_API_KEY/POLYMARKET_API_SECRET/POLYMARKET_API_PASSPHRASE "
            "were rejected; refresh them for the current signer and funder"
        )

    return errors


def verbose_log(enabled: bool, message: str) -> None:
    if enabled:
        print(f"[verbose] {current_timestamp_utc()} {message}", flush=True)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check Polymarket Gamma, Data, and CLOB connectivity for botv4.")
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Print detailed progress and include non-secret verbose details in log.md.",
    )
    return parser.parse_args(argv)


def format_markdown(report: dict) -> str:
    checked_at = report["checked_at"]
    env_summary = report["env"]
    public_check = report["public_check"]
    auth_check = report["auth_check"]
    diagnosis = report.get("diagnosis", {})
    errors = report["errors"]
    verbose_enabled = bool(report.get("verbose"))
    public_ok = bool(public_check.get("ok"))
    auth_ok = bool(auth_check.get("ok"))
    overall_ok = public_ok and auth_ok

    lines = [
        f"## Connectivity Test - {checked_at}",
        LOG_TEST_SEPARATOR,
        "",
        f"- Checked at: `{checked_at}`",
        f"- Root: `{ROOT}`",
        f"- Env file: `{ENV_PATH}`",
        "",
        "### Overall Result",
        "",
        f"- Status: `{'pass' if overall_ok else 'fail'}`",
        f"- Valid preflight: `{'yes' if overall_ok else 'no'}`",
        f"- Public APIs: `{'pass' if public_ok else 'fail'}`",
        f"- Authenticated CLOB: `{'pass' if auth_ok else 'fail'}`",
        "",
        "### Environment",
        "",
        f"- `PAPER_TRADING`: `{env_summary['paper_trading']}`",
        f"- `POLYMARKET_SIGNATURE_TYPE`: `{env_summary['signature_type']}`",
        f"- `POLYMARKET_PRIVATE_KEY`: `{env_summary['private_key']}`",
        f"- `SIGNER_ADDRESS`: `{env_summary['signer_address']}`",
        f"- `POLYMARKET_FUNDER_ADDRESS`: `{env_summary['funder_address']}`",
        f"- `PROXY_WALLET_ADDRESS` legacy: `{env_summary['legacy_proxy_wallet_address']}`",
        f"- `POLYMARKET_API_KEY`: `{env_summary['api_key']}`",
        f"- `POLYMARKET_API_SECRET`: `{env_summary['api_secret']}`",
        f"- `POLYMARKET_API_PASSPHRASE`: `{env_summary['api_passphrase']}`",
        f"- `NODE_EXE`: `{env_summary['node_exe']}`",
        "",
        "### API Connectivity",
        "",
    ]

    lines.append(f"- Overall: `{'success' if public_check.get('ok') else 'failed'}`")
    for check in public_check.get("checks", []):
        lines.append(f"- `{check.get('name', 'API')}`: `{'success' if check.get('ok') else 'failed'}`")
        lines.append(f"  - URL: `{check.get('url', '')}`")
        if check.get("ok"):
            lines.append(f"  - HTTP: `{check.get('status', '')}`")
            lines.append(f"  - Response: `{sanitize_log_text(check.get('summary', ''))}`")
        else:
            lines.append(f"  - Error: `{sanitize_log_text(check.get('error', 'unexpected response'))}`")
    lines.append("")

    lines.extend([
        "### Authenticated Connectivity",
        "",
    ])

    if auth_check.get("ok"):
        derived_api_key = auth_check.get("derivedApiKey", {})
        collateral = auth_check.get("collateral", {})
        lines.extend([
            "- Status: success",
            f"- Signer address: `{auth_check.get('signerAddress', '')}`",
            f"- Funder address: `{auth_check.get('funderAddress', '')}`",
            f"- Server time: `{auth_check.get('serverTime', '')}`",
            f"- Derived API key: `{redact(derived_api_key.get('key', ''), keep=0)}`",
            f"- Auth source: `{auth_check.get('authSource', '')}`",
            f"- API keys count: `{auth_check.get('apiKeysCount', 0)}`",
            f"- Closed only: `{json.dumps(auth_check.get('closedOnly'))}`",
            f"- Collateral balance: `{collateral.get('balance', '')}`",
            f"- Collateral allowance: `{summarize_collateral_allowance(collateral)}`",
            "",
        ])
    else:
        lines.extend([
            "- Status: failed",
            f"- Error: `{sanitize_log_text(auth_check.get('error', 'unknown error'))}`",
            "",
        ])
        if auth_check.get("validationErrors"):
            lines.append("- Validation errors:")
            for error in auth_check["validationErrors"]:
                lines.append(f"  - `{sanitize_log_text(error)}`")
            lines.append("")

    if verbose_enabled:
        lines.extend([
            "### Verbose Details",
            "",
            f"- Verbose: `true`",
            f"- Secret source: `{report.get('secret_source', 'unknown')}`",
            f"- Node modules: `{NODE_MODULES_ROOT}`",
        ])
        for check in public_check.get("checks", []):
            lines.append(
                f"- `{check.get('name', 'API')}` expectation=`{check.get('expect', '')}` "
                f"elapsedMs=`{check.get('elapsedMs', 'n/a')}` bytes=`{check.get('bytes', 'n/a')}`"
            )
        if auth_check.get("ok"):
            lines.append(f"- Auth node path: `{auth_check.get('_nodePath', '')}`")
            lines.append(f"- Auth elapsedMs: `{auth_check.get('_elapsedMs', 'n/a')}`")
        lines.append("")

    if diagnosis:
        lines.extend([
            "### Diagnosis",
            "",
        ])
        for key, value in diagnosis.items():
            lines.append(f"- `{key}`: `{value}`")
        lines.append("")

    if errors:
        lines.extend([
            "### Errors",
            "",
        ])
        for idx, error in enumerate(errors, start=1):
            lines.append(f"#### Error {idx}")
            lines.append("")
            lines.append("```text")
            lines.append(sanitize_log_text(error).rstrip())
            lines.append("```")
            lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def append_log(markdown: str) -> None:
    if not LOG_PATH.exists() or LOG_PATH.stat().st_size == 0:
        LOG_PATH.write_text("# Polymarket Connectivity Log\n\n", encoding="utf-8")

    if LOG_PATH.stat().st_size > 0:
        with LOG_PATH.open("rb") as handle:
            handle.seek(max(0, LOG_PATH.stat().st_size - 2))
            suffix = handle.read()
        if suffix != b"\n\n":
            with LOG_PATH.open("a", encoding="utf-8") as handle:
                handle.write("\n" if suffix.endswith(b"\n") else "\n\n")

    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(markdown.rstrip())
        handle.write("\n\n")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    verbose_enabled = bool(args.verbose or truthy(os.environ.get("CONNECTIVITY_VERBOSE")))

    verbose_log(verbose_enabled, f"Loading env from {ENV_PATH}")
    load_env_file(ENV_PATH)
    verbose_log(verbose_enabled, "Hydrating runtime secrets from configured provider/process env")
    hydrate_runtime_secrets([
        "POLYMARKET_PRIVATE_KEY",
        "POLYMARKET_API_KEY",
        "POLYMARKET_API_SECRET",
        "POLYMARKET_API_PASSPHRASE",
    ])
    secret_source = "secret_command" if os.environ.get("RABBITHAT_SECRET_COMMAND", "").strip() else "process_env_or_dotenv"
    verbose_log(verbose_enabled, f"Secret source={secret_source}")

    report = {
        "checked_at": current_timestamp_utc(),
        "verbose": verbose_enabled,
        "secret_source": secret_source,
        "env": {
            "paper_trading": os.environ.get("PAPER_TRADING", ""),
            "signature_type": str(configured_signature_type()),
            "private_key": redact(os.environ.get("POLYMARKET_PRIVATE_KEY", ""), keep=0),
            "signer_address": derive_signer_address() or "(unknown)",
            "funder_address": redact(resolve_funder_address(), keep=0),
            "legacy_proxy_wallet_address": redact(os.environ.get("PROXY_WALLET_ADDRESS", ""), keep=0),
            "api_key": redact(os.environ.get("POLYMARKET_API_KEY", ""), keep=0),
            "api_secret": redact(os.environ.get("POLYMARKET_API_SECRET", ""), keep=0),
            "api_passphrase": redact(os.environ.get("POLYMARKET_API_PASSPHRASE", ""), keep=0),
            "node_exe": find_node_path() or "(missing)",
        },
        "public_check": {},
        "auth_check": {},
        "diagnosis": {},
        "errors": [],
    }

    try:
        report["public_check"] = fetch_public_api_connectivity(verbose_enabled)
    except Exception as exc:
        report["public_check"] = {
            "ok": False,
            "checks": [],
            "error": str(exc),
        }
        report["errors"].append(traceback.format_exc())

    public_api_status = "reachable" if report["public_check"].get("ok") else "partial_or_unreachable"

    private_key = os.environ.get("POLYMARKET_PRIVATE_KEY", "").strip()
    funder = resolve_funder_address()

    if not private_key or not funder:
        verbose_log(verbose_enabled, "Skipping authenticated CLOB check because private key or funder is missing")
        report["auth_check"] = {
            "ok": False,
            "error": "POLYMARKET_PRIVATE_KEY or POLYMARKET_FUNDER_ADDRESS/DEPOSIT_WALLET_ADDRESS is missing from the secret provider, process environment, or non-secret config",
        }
        report["diagnosis"] = {
            "browser_session": "unknown",
            "public_api": public_api_status,
            "authenticated_bot_access": "not_tested_missing_credentials",
            "likely_issue": "missing_env_configuration",
        }
    else:
        try:
            report["auth_check"] = run_authenticated_check(verbose_enabled)
            validation_errors = validate_authenticated_check(report["auth_check"])
            if validation_errors:
                report["auth_check"]["ok"] = False
                report["auth_check"]["error"] = "Authenticated CLOB validation failed"
                report["auth_check"]["validationErrors"] = validation_errors
                invalid_api_key = auth_check_has_invalid_api_key(report["auth_check"])
                report["diagnosis"] = {
                    "browser_session": "unknown",
                    "public_api": public_api_status,
                    "authenticated_bot_access": "invalid_l2_credentials" if invalid_api_key else "failed",
                    "likely_issue": "stored_polymarket_api_credentials_invalid_or_stale" if invalid_api_key else "authenticated_clob_validation_failed",
                }
                verbose_log(verbose_enabled, f"Authenticated CLOB validation FAILED: {'; '.join(validation_errors)}")
                append_log(format_markdown(report))
                print(f"Connectivity log appended: {LOG_PATH} @ {report['checked_at']}")
                verbose_log(verbose_enabled, f"Log append complete: {LOG_PATH}")
                print("Connectivity preflight FAILED")
                return 1

            collateral_balance = parse_int_like(report["auth_check"].get("collateral", {}).get("balance"))
            likely_issue = "none"
            authenticated_access = "ok"
            if collateral_balance == 0:
                authenticated_access = "ok_no_collateral_balance"
                likely_issue = "funder_has_zero_clob_collateral_balance"
            report["diagnosis"] = {
                "browser_session": "unknown",
                "public_api": public_api_status,
                "authenticated_bot_access": authenticated_access,
                "likely_issue": likely_issue,
            }
        except Exception as exc:
            error_text = str(exc)
            cloudflare = detect_cloudflare_block(error_text)
            report["auth_check"] = {
                "ok": False,
                "error": error_text,
            }
            if cloudflare:
                report["auth_check"]["cloudflare"] = cloudflare
                report["diagnosis"] = {
                    "browser_session": "likely_ok_if_browser_login_works",
                    "public_api": public_api_status,
                    "authenticated_bot_access": "blocked_by_cloudflare",
                    "likely_issue": "request_or_ip_blocked_before_polymarket_auth",
                    "cloudflare_ray_id": cloudflare.get("ray_id") or "unknown",
                }
            else:
                lowered = error_text.lower()
                if "unauthorized/invalid api key" in lowered:
                    report["diagnosis"] = {
                        "browser_session": "not_required_for_current_failure",
                        "public_api": public_api_status,
                        "authenticated_bot_access": "invalid_l2_credentials",
                        "likely_issue": "api_key_secret_passphrase_do_not_match_signer_or_funder",
                        "signature_type": str(configured_signature_type()),
                        "signer_address": report["env"].get("signer_address", "(unknown)"),
                        "funder_address": resolve_funder_address() or "(missing)",
                    }
                else:
                    report["diagnosis"] = {
                        "browser_session": "unknown",
                        "public_api": public_api_status,
                        "authenticated_bot_access": "failed",
                        "likely_issue": "non_cloudflare_auth_or_runtime_error",
                    }
            report["errors"].append(traceback.format_exc())

    append_log(format_markdown(report))
    print(f"Connectivity log appended: {LOG_PATH} @ {report['checked_at']}")
    verbose_log(verbose_enabled, f"Log append complete: {LOG_PATH}")

    public_ok = bool(report["public_check"].get("ok"))
    auth_ok = bool(report["auth_check"].get("ok"))
    print(f"Connectivity preflight {'passed' if public_ok and auth_ok else 'FAILED'}")
    return 0 if public_ok and auth_ok else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except urllib.error.URLError as exc:
        checked_at = current_timestamp_utc()
        append_log(
            "\n".join([
                f"## Connectivity Test - {checked_at}",
                LOG_TEST_SEPARATOR,
                "",
                f"- Checked at: `{checked_at}`",
                "- Status: fatal network error",
                f"- Error: `{sanitize_log_text(exc)}`",
                "",
            ])
        )
        raise
