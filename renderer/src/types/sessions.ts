/** 与 Control UI / 网关 `sessions.list` 对齐（精简字段） */
export type GatewaySessionRow = {
  key: string;
  spawnedBy?: string;
  kind: "direct" | "group" | "global" | "unknown";
  label?: string;
  displayName?: string;
  surface?: string;
  subject?: string;
  room?: string;
  space?: string;
  updatedAt: number | null;
  sessionId?: string;
  model?: string;
  modelProvider?: string;
  contextTokens?: number;
};

export type GatewaySessionsDefaults = {
  modelProvider?: string;
  model?: string;
  contextTokens?: number | null;
};

export type SessionsListResult = {
  ts?: number;
  path?: string;
  count?: number;
  defaults?: GatewaySessionsDefaults;
  sessions: GatewaySessionRow[];
};
