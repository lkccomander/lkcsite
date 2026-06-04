import { resolve } from "path";

export const WORKSPACE_ROOT = resolve(__dirname, "..", "..");
export const TELEMETRY_ROOT = resolve(WORKSPACE_ROOT, "polydb", "telemetry");
export const TELEMETRY_SESSIONS_DIR = resolve(TELEMETRY_ROOT, "sessions");
export const EVALUATION_ROOT = resolve(WORKSPACE_ROOT, "PATBv5", "polydb", "evaluation");
export const SESSION_EVALUATIONS_DIR = resolve(EVALUATION_ROOT, "session_evaluations");
export const SCOREBOARDS_DIR = resolve(EVALUATION_ROOT, "scoreboards");
export const DIAGNOSTICS_DIR = resolve(EVALUATION_ROOT, "diagnostics");
