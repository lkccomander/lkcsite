import { VersionContext } from "../types";

const UNKNOWN_VERSION_CONTEXT: VersionContext = {
  strategyVersionId: "unknown_strategy_version",
  strategyConfigHash: "unknown_config_hash",
  botBuildVersionId: "unknown_bot_build",
  repoId: "unknown_repo",
  gitCommit: "unknown",
  gitBranch: "unknown",
  gitDirty: true,
};

export function normalizeVersionContext(
  input: Partial<VersionContext> | null | undefined
): VersionContext {
  return {
    strategyVersionId: input?.strategyVersionId || UNKNOWN_VERSION_CONTEXT.strategyVersionId,
    strategyConfigHash: input?.strategyConfigHash || UNKNOWN_VERSION_CONTEXT.strategyConfigHash,
    botBuildVersionId: input?.botBuildVersionId || UNKNOWN_VERSION_CONTEXT.botBuildVersionId,
    repoId: input?.repoId || UNKNOWN_VERSION_CONTEXT.repoId,
    gitCommit: input?.gitCommit || UNKNOWN_VERSION_CONTEXT.gitCommit,
    gitBranch: input?.gitBranch || UNKNOWN_VERSION_CONTEXT.gitBranch,
    gitDirty: typeof input?.gitDirty === "boolean" ? input.gitDirty : UNKNOWN_VERSION_CONTEXT.gitDirty,
  };
}
