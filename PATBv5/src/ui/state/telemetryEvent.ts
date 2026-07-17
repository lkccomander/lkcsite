export type JsonRecord = Record<string, unknown>;

export interface TelemetryEvent {
  type: string;
  payload: JsonRecord;
  timestamp: string;
  botId?: string;
  sessionId?: string;
  sessionStartedAt?: string;
}
