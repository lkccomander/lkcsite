export const CONTROL_SCHEMA_VERSION = 1 as const;
export const GRACEFUL_STOP_TIMEOUT_MS = 30_000;
export const HEARTBEAT_INTERVAL_MS = 1_000;
export const STOP_POLL_INTERVAL_MS = 250;
export const HEARTBEAT_STALE_MS = 5_000;

export type RequestedMode = "PAPER" | "LIVE";
export type ControllerState = "STOPPED" | "STARTING" | "PAPER" | "LIVE" | "STOPPING" | "FINALIZING" | "ERROR";
export type BotRuntimeState = "RUNNING" | "STOPPING" | "SHUTDOWN_COMPLETE";
export type WrapperOutcome = "COMPLETE" | "ERROR" | "UNCLEAN";

export interface ProcessIdentity { pid: number; startedAt: string; }
export interface ActiveRunRecord {
  schemaVersion: 1;
  runId: string;
  requestedMode: RequestedMode;
  modeSource: "CONTROL_OVERRIDE";
  requestedAt: string;
  wrapper: ProcessIdentity | null;
  stopRequestedAt: string | null;
  forceEligibleAt: string | null;
  logPath: string;
}
export interface BotHeartbeat {
  schemaVersion: 1;
  runId: string;
  mode: RequestedMode;
  sessionId: string;
  bot: ProcessIdentity;
  status: BotRuntimeState;
  updatedAt: string;
}
export interface StopRequest { schemaVersion: 1; runId: string; requestedAt: string; }
export interface WrapperResult {
  schemaVersion: 1;
  runId: string;
  outcome: WrapperOutcome;
  botExitCode: number;
  finalExitCode: number;
  persistenceSucceeded: boolean;
  completedAt: string;
  error: string | null;
}
export interface PersistedControllerState {
  schemaVersion: 1;
  lastRunId: string | null;
  lastOutcome: WrapperOutcome | null;
  lastError: string | null;
  updatedAt: string;
}
export interface ControlAuditRecord {
  schemaVersion: 1;
  timestamp: string;
  action: string;
  outcome: "accepted" | "rejected" | "completed" | "failed" | "recovered";
  runId: string | null;
  sessionId: string | null;
  detail: string | null;
}
export interface ControlRunView {
  runId: string;
  requestedMode: RequestedMode;
  modeSource: "CONTROL_OVERRIDE";
  requestedAt: string;
  wrapperPid: number | null;
  botPid: number | null;
  sessionId: string | null;
  heartbeatUpdatedAt: string | null;
}
export interface ControlStatus {
  state: ControllerState;
  canStart: boolean;
  canStop: boolean;
  canForceStop: boolean;
  activeRun: ControlRunView | null;
  error: string | null;
  logTail: string[];
}
export interface SpawnRunRequest {
  repoRoot: string;
  controlDir: string;
  runId: string;
  mode: RequestedMode;
  logPath: string;
}
export interface WrapperHandle {
  identity: ProcessIdentity;
  completion: Promise<{ exitCode: number; signal: string | null }>;
}
export type ProcessInspection = "alive" | "absent" | "identity_mismatch";
export interface RuntimeProcessAdapter {
  currentIdentity(): Promise<ProcessIdentity>;
  spawnRun(request: SpawnRunRequest): Promise<WrapperHandle>;
  inspect(identity: ProcessIdentity): Promise<ProcessInspection>;
  forceKillTree(identity: ProcessIdentity): Promise<void>;
}
