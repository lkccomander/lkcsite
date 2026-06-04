import { createHash } from "crypto";
import { execFile } from "child_process";
import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import type { Config } from "../config/toml";

export type VersionContext = {
  strategyVersionId: string;
  strategyConfigHash: string;
  botBuildVersionId: string;
  repoId: string;
  gitCommit: string;
  gitBranch: string;
  gitDirty: boolean;
};

type StrategyRegistryRecord = {
  id: string;
  strategyName: string;
  configHash: string;
  configSnapshot: Record<string, unknown>;
  createdAt: string;
  status: string;
};

type BotBuildRegistryRecord = {
  id: string;
  repoId: string;
  gitCommit: string;
  gitBranch: string;
  gitDirty: boolean;
  buildTimestamp: string;
};

type RepoRegistryRecord = {
  id: string;
  gitCommit: string;
  gitBranch: string;
  gitDirty: boolean;
  repoUrl: string;
  capturedAt: string;
};

type GitMetadata = {
  repoUrl: string;
  gitCommit: string;
  gitBranch: string;
  gitDirty: boolean;
};

const WORKSPACE_ROOT = resolve(__dirname, "..", "..", "..");
const EVALUATION_ROOT = resolve(WORKSPACE_ROOT, "PATBv5", "polydb", "evaluation");
const STRATEGY_VERSIONS_DIR = resolve(EVALUATION_ROOT, "strategy_versions");
const BOT_BUILDS_DIR = resolve(EVALUATION_ROOT, "bot_builds");
const REPOS_DIR = resolve(EVALUATION_ROOT, "repos");

function execGit(args: string[]): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile("git", args, { cwd: WORKSPACE_ROOT, windowsHide: true }, (error, stdout) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise(stdout.trim());
    });
  });
}

function sanitizeIdPart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSort);
  }

  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      output[key] = stableSort(input[key]);
    }
    return output;
  }

  return value;
}

function buildEffectiveConfigSnapshot(config: Config): Record<string, unknown> {
  const strategyName = config.strategy;
  const activeStrategy = (config as Record<string, unknown>)[strategyName];

  return stableSort({
    strategy: config.strategy,
    trade_usd: config.trade_usd,
    max_retries: config.max_retries,
    market: config.market,
    [strategyName]: activeStrategy ?? null,
  }) as Record<string, unknown>;
}

function buildConfigHash(snapshot: Record<string, unknown>): string {
  const serialized = JSON.stringify(snapshot);
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
}

async function ensureVersionDirs(): Promise<void> {
  await Promise.all([
    mkdir(STRATEGY_VERSIONS_DIR, { recursive: true }),
    mkdir(BOT_BUILDS_DIR, { recursive: true }),
    mkdir(REPOS_DIR, { recursive: true }),
  ]);
}

async function readJsonDirectory<T>(dir: string): Promise<T[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const jsonFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  const results = await Promise.all(
    jsonFiles.map(async (entry) => {
      const raw = await readFile(resolve(dir, entry.name), "utf8");
      return JSON.parse(raw) as T;
    })
  );
  return results;
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function captureGitMetadata(): Promise<GitMetadata> {
  try {
    const [repoUrl, gitCommit, gitBranch, gitStatus] = await Promise.all([
      execGit(["remote", "get-url", "origin"]).catch(() => "unknown"),
      execGit(["rev-parse", "HEAD"]).catch(() => "unknown"),
      execGit(["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "unknown"),
      execGit(["status", "--porcelain"]).catch(() => "dirty"),
    ]);

    return {
      repoUrl,
      gitCommit,
      gitBranch,
      gitDirty: gitStatus.length > 0 || gitCommit === "unknown",
    };
  } catch {
    return {
      repoUrl: "unknown",
      gitCommit: "unknown",
      gitBranch: "unknown",
      gitDirty: true,
    };
  }
}

function buildRepoId(git: GitMetadata): string {
  if (git.repoUrl === "unknown") {
    return "unknown_repo";
  }

  const repoName = sanitizeIdPart(
    git.repoUrl
      .split("/")
      .pop()
      ?.replace(/\.git$/i, "") ?? "repo"
  );
  const branch = sanitizeIdPart(git.gitBranch);
  return `${repoName}-${branch}`;
}

async function ensureRepoRegistryRecord(git: GitMetadata, repoId: string): Promise<void> {
  const record: RepoRegistryRecord = {
    id: repoId,
    gitCommit: git.gitCommit,
    gitBranch: git.gitBranch,
    gitDirty: git.gitDirty,
    repoUrl: git.repoUrl,
    capturedAt: new Date().toISOString(),
  };

  await writeJsonFile(resolve(REPOS_DIR, `${repoId}.json`), record);
}

async function ensureStrategyVersion(config: Config): Promise<{
  strategyVersionId: string;
  strategyConfigHash: string;
}> {
  const strategyName = config.strategy;
  const configSnapshot = buildEffectiveConfigSnapshot(config);
  const configHash = buildConfigHash(configSnapshot);
  const existingRecords = await readJsonDirectory<StrategyRegistryRecord>(STRATEGY_VERSIONS_DIR);
  const existingMatch = existingRecords.find(
    (record) => record.strategyName === strategyName && record.configHash === configHash
  );

  if (existingMatch) {
    return {
      strategyVersionId: existingMatch.id,
      strategyConfigHash: configHash,
    };
  }

  const nextSequence = existingRecords
    .filter((record) => record.strategyName === strategyName)
    .map((record) => Number(record.id.match(/_v(\d+)$/)?.[1] ?? "0"))
    .reduce((max, value) => Math.max(max, value), 0) + 1;

  const strategyVersionId = `${strategyName}_v${String(nextSequence).padStart(3, "0")}`;
  const record: StrategyRegistryRecord = {
    id: strategyVersionId,
    strategyName,
    configHash,
    configSnapshot,
    createdAt: new Date().toISOString(),
    status: "PAPER_TESTING",
  };

  await writeJsonFile(resolve(STRATEGY_VERSIONS_DIR, `${strategyVersionId}.json`), record);

  return {
    strategyVersionId,
    strategyConfigHash: configHash,
  };
}

async function ensureBotBuildVersion(git: GitMetadata, repoId: string): Promise<string> {
  if (git.gitCommit === "unknown") {
    return "unknown_bot_build";
  }

  const existingRecords = await readJsonDirectory<BotBuildRegistryRecord>(BOT_BUILDS_DIR);
  const existingMatch = existingRecords.find((record) => record.gitCommit === git.gitCommit);
  if (existingMatch) {
    return existingMatch.id;
  }

  const now = new Date();
  const datePart = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("_");
  const sameDayCount = existingRecords.filter((record) => record.id.includes(`build_${datePart}_`)).length;
  const id = `bot_v5_build_${datePart}_${String(sameDayCount + 1).padStart(3, "0")}`;

  const record: BotBuildRegistryRecord = {
    id,
    repoId,
    gitCommit: git.gitCommit,
    gitBranch: git.gitBranch,
    gitDirty: git.gitDirty,
    buildTimestamp: now.toISOString(),
  };

  await writeJsonFile(resolve(BOT_BUILDS_DIR, `${id}.json`), record);
  return id;
}

export async function initializeVersionContext(config: Config): Promise<VersionContext> {
  await ensureVersionDirs();

  const git = await captureGitMetadata();
  const repoId = buildRepoId(git);
  await ensureRepoRegistryRecord(git, repoId);

  const strategy = await ensureStrategyVersion(config);
  const botBuildVersionId = await ensureBotBuildVersion(git, repoId);

  return {
    strategyVersionId: strategy.strategyVersionId,
    strategyConfigHash: strategy.strategyConfigHash,
    botBuildVersionId,
    repoId,
    gitCommit: git.gitCommit,
    gitBranch: git.gitBranch,
    gitDirty: git.gitDirty,
  };
}
