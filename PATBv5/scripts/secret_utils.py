import os
import subprocess
from pathlib import Path


ORIGINAL_ENV = dict(os.environ)
SECRET_COMMAND_ENV = "RABBITHAT_SECRET_COMMAND"
SECRET_PREFIX_ENV = "RABBITHAT_SECRET_PREFIX"
ALLOW_DOTENV_SECRETS_ENV = "RABBITHAT_ALLOW_DOTENV_SECRETS"
SECRET_KEY_NAMES = {
    "NIM_API_KEY",
    "POSTGRES_PASSWORD",
    "POLYMARKET_PRIVATE_KEY",
    "POLYMARKET_API_KEY",
    "POLYMARKET_API_SECRET",
    "POLYMARKET_API_PASSPHRASE",
    "BUILDER_API_KEY",
    "BUILDER_SECRET",
    "BUILDER_PASS_PHRASE",
    "RELAYER_API_KEY",
}
SECRET_KEY_SUFFIXES = ("_PASSWORD", "_PRIVATE_KEY", "_API_KEY", "_API_SECRET", "_TOKEN", "_PASSPHRASE")


def load_env_file(path: Path) -> None:
    if not path.exists():
        return

    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or os.environ.get(key, "").strip():
            continue

        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]

        values[key] = value

    load_dotenv_secrets = allow_dotenv_secrets(values)
    for key, value in values.items():
        if is_secret_key(key) and not load_dotenv_secrets:
            continue
        os.environ[key] = value


def is_secret_key(key: str) -> bool:
    normalized = key.upper()
    return normalized in SECRET_KEY_NAMES or normalized.endswith(SECRET_KEY_SUFFIXES)


def allow_dotenv_secrets(values: dict[str, str] | None = None) -> bool:
    raw = os.environ.get(ALLOW_DOTENV_SECRETS_ENV, "")
    if values and not raw:
        raw = values.get(ALLOW_DOTENV_SECRETS_ENV, "")
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def read_optional_secret(key: str) -> str:
    return read_secret(key, required=False) or ""


def read_required_secret(key: str) -> str:
    value = read_secret(key, required=True)
    if not value:
        raise RuntimeError(
            f"{key} is not set. Store it in your secret manager via {SECRET_COMMAND_ENV}, "
            "or export it as a real process environment variable. Plain .env secrets are disabled by default."
        )
    return value


def hydrate_runtime_secrets(keys: list[str]) -> None:
    for key in keys:
        value = read_optional_secret(key)
        if value:
            os.environ[key] = value


def read_secret(key: str, required: bool = False) -> str | None:
    provider_errors: list[str] = []
    value = _read_secret_from_command(key, provider_errors)
    if value:
        return value

    value = ORIGINAL_ENV.get(key, "").strip()
    if value:
        return value

    if allow_dotenv_secrets():
        value = os.environ.get(key, "").strip()
        if value:
            return value

    if required and provider_errors:
        raise RuntimeError(f"{key} could not be loaded from {SECRET_COMMAND_ENV}: {'; '.join(provider_errors)}")
    return None


def _read_secret_from_command(key: str, errors: list[str]) -> str | None:
    command = os.environ.get(SECRET_COMMAND_ENV, "").strip()
    if not command:
        return None

    secret_name = f"{os.environ.get(SECRET_PREFIX_ENV, '').strip()}{key}"
    child_env = os.environ.copy()
    child_env.update(
        {
            "RABBITHAT_SECRET_KEY": key,
            "RABBITHAT_SECRET_NAME": secret_name,
            "SECRET_KEY": key,
            "SECRET_NAME": secret_name,
        }
    )

    try:
        proc = subprocess.run(
            command,
            capture_output=True,
            env=child_env,
            shell=True,
            text=True,
            timeout=15,
        )
    except Exception as exc:
        errors.append(str(exc))
        return None

    if proc.returncode != 0:
        errors.append(proc.stderr.strip() or f"exit code {proc.returncode}")
        return None

    value = proc.stdout.strip()
    return value or None
