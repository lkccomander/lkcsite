import { execSync } from "child_process";
import { config as loadDotEnv } from "dotenv";
import { resolve } from "path";

export const ENV_PATH = resolve(__dirname, "..", "..", ".env");

const ORIGINAL_ENV = { ...process.env };

loadDotEnv({ path: ENV_PATH });

const SECRET_COMMAND_ENV = "RABBITHAT_SECRET_COMMAND";
const SECRET_PREFIX_ENV = "RABBITHAT_SECRET_PREFIX";
const ALLOW_DOTENV_SECRETS_ENV = "RABBITHAT_ALLOW_DOTENV_SECRETS";
const SECRET_COMMAND_TIMEOUT_MS_ENV = "RABBITHAT_SECRET_TIMEOUT_MS";

export function readConfigEnv(key: string): string | undefined {
  const value = process.env[key];
  return value == null || value.trim() === "" ? undefined : value.trim();
}

export function readOptionalConfigEnv(key: string): string {
  return readConfigEnv(key) ?? "";
}

export function readRequiredConfigEnv(key: string): string {
  const value = readConfigEnv(key);
  if (!value) {
    throw new Error(`${key} is not set. Expected it in process env or non-secret config at ${ENV_PATH}`);
  }
  return value;
}

export function readOptionalSecret(key: string): string {
  return readSecret(key, false) ?? "";
}

export function readRequiredSecret(key: string): string {
  const value = readSecret(key, true);
  if (!value) {
    throw new Error(
      `${key} is not set. Store it in your secret manager via ${SECRET_COMMAND_ENV}, ` +
      "or export it as a real process environment variable. Plain .env secrets are disabled by default."
    );
  }
  return value;
}

function readSecret(key: string, required: boolean): string | undefined {
  const providerErrorMessages: string[] = [];
  const fromProvider = readSecretFromCommand(key, providerErrorMessages);
  if (fromProvider) {
    return fromProvider;
  }

  const fromProcessEnv = ORIGINAL_ENV[key]?.trim();
  if (fromProcessEnv) {
    return fromProcessEnv;
  }

  if (allowDotenvSecrets()) {
    const fromDotEnv = process.env[key]?.trim();
    if (fromDotEnv) {
      return fromDotEnv;
    }
  }

  if (required && providerErrorMessages.length > 0) {
    throw new Error(`${key} could not be loaded from ${SECRET_COMMAND_ENV}: ${providerErrorMessages.join("; ")}`);
  }

  return undefined;
}

function readSecretFromCommand(key: string, errors: string[]): string | undefined {
  const command = readConfigEnv(SECRET_COMMAND_ENV);
  if (!command) {
    return undefined;
  }

  const secretName = `${readOptionalConfigEnv(SECRET_PREFIX_ENV)}${key}`;
  try {
    const output = execSync(command, {
      encoding: "utf8",
      env: {
        ...process.env,
        RABBITHAT_SECRET_KEY: key,
        RABBITHAT_SECRET_NAME: secretName,
        SECRET_KEY: key,
        SECRET_NAME: secretName,
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: readSecretCommandTimeoutMs(),
      windowsHide: true,
    });
    const value = output.trim();
    return value || undefined;
  } catch (error: any) {
    const stderr = error?.stderr ? String(error.stderr).trim() : "";
    const message = stderr || error?.message || String(error);
    errors.push(message);
    return undefined;
  }
}

function readSecretCommandTimeoutMs(): number {
  const raw = readConfigEnv(SECRET_COMMAND_TIMEOUT_MS_ENV);
  if (!raw) {
    return 30000;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 30000;
  }

  return parsed;
}

function allowDotenvSecrets(): boolean {
  const value = readConfigEnv(ALLOW_DOTENV_SECRETS_ENV);
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
