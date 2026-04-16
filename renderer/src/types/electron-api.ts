export type ManagerGatewayLastAction = {
  action: string;
  ok: boolean;
  at: string;
  message: string;
} | null;

export type ManagerStatus = {
  gateway: {
    running: boolean;
    uptimeText: string;
    port: number;
    lastAction: ManagerGatewayLastAction;
  };
  versions: {
    openclaw: string;
    manager: string;
  };
  update: {
    latestVersion: string | null;
    checkedAt: string | null;
    hasUpdate: boolean;
  };
  stats: {
    agentsConfigured: number;
    channelsConnected: number;
    installedSkills: number;
    currentModel: { name: string; id: string };
  };
  env?: {
    nodeInstalled: boolean;
    nodeVersion: string | null;
    nodePath: string | null;
    nodeCompatible: boolean;
    nodeRecommended: boolean;
    openclawInstalled: boolean;
    openclawVersion: string | null;
    openclawPath: string | null;
  };
  error?: string;
};

export type GatewayCallResult = {
  ok: boolean;
  result?: unknown;
  error?: string;
  code?: number;
  stderr?: string;
};

export type PairingCliResult = {
  ok: boolean;
  result?: unknown;
  error?: string;
  code?: number;
  stderr?: string;
  elapsedMs?: number;
};

export type SkillsInstallCliResult = {
  ok: boolean;
  code?: number;
  stdout?: string;
  stderr?: string;
  elapsedMs?: number;
  error?: string;
};

export type ChannelsLoginStartResult = {
  ok: boolean;
  sessionId?: string;
  error?: string;
};

export type ChannelsLoginEvent =
  | { kind: "qr"; sessionId: string; dataUrl: string }
  | { kind: "exit"; sessionId: string; code: number; /** CLI 输出尾部，便于排查退出码非 0 */ outputTail?: string }
  | { kind: "error"; sessionId: string; message: string };

export type PluginCliResult = {
  ok: boolean;
  result?: unknown;
  error?: string;
  code?: number;
  stderr?: string;
  elapsedMs?: number;
};

export type PluginsListResult = PluginCliResult;
export type PluginToggleResult = PluginCliResult;

export type GatewayConnectInfo = {
  wsUrl: string;
  token?: string;
  password?: string;
};

export type OpenClawApi = {
  getStatus: (payload?: { forceEnv?: boolean }) => Promise<ManagerStatus>;
  openExternal?: (payload: string | { url: string }) => Promise<{ ok: boolean; error?: string }>;
  getGatewayConnectInfo?: () => Promise<GatewayConnectInfo>;
  controlGateway: (action: "start" | "stop" | "restart") => Promise<ManagerStatus & { error?: string }>;
  checkUpdates: () => Promise<{ ok: boolean; message?: string; status?: ManagerStatus }>;
  updateOpenClaw: () => Promise<{ ok: boolean; message?: string; status?: ManagerStatus }>;
  installOpenClaw: () => Promise<{ ok: boolean; message?: string; status?: ManagerStatus }>;
  setupOpenClaw?: () => Promise<{ ok: boolean; message?: string; status?: ManagerStatus }>;
  uninstallOpenClaw: () => Promise<{ ok: boolean; message?: string; status?: ManagerStatus }>;
  chat: (payload: { message: string; agentId?: string; sessionKey?: string }) => Promise<{ reply: string }>;
  /** 通过 `openclaw gateway call` 调用允许的网关 RPC（与 Control UI 同源能力） */
  gatewayCall: (payload: { method: string; params?: unknown; timeoutMs?: number }) => Promise<GatewayCallResult>;
  /**
   * 受限的 HTTP 代理（仅白名单域名），用于在 Renderer 直连遇到 CORS/网络策略限制时兜底。
   * 注意：这是“最小能力”，不提供任意网络访问。
   */
  httpFetch?: (payload: {
    url: string;
    method: "POST";
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  }) => Promise<{ ok: boolean; status?: number; bodyText?: string; headers?: Record<string, string>; error?: string }>;
  skillsInstall?: (payload: { slug: string; version?: string; force?: boolean }) => Promise<SkillsInstallCliResult>;
  pairingCli?: (payload: {
    action: "list" | "approve";
    channel: string;
    accountId?: string;
    code?: string;
    notify?: boolean;
  }) => Promise<PairingCliResult>;
  /** 运行 `openclaw channels login`，通过 onEvent 接收二维码等事件 */
  channelsLoginStart?: (payload: {
    channel: string;
    accountId?: string;
    verbose?: boolean;
  }) => Promise<ChannelsLoginStartResult>;
  channelsLoginCancel?: (payload: { sessionId: string }) => Promise<{ ok: boolean }>;
  channelsLoginOnEvent?: (callback: (ev: ChannelsLoginEvent) => void) => () => void;
  pluginCli?: (payload: {
    action: "list" | "install" | "enable" | "disable";
    pluginId?: string;
  }) => Promise<PluginCliResult>;
  pluginsList?: () => Promise<PluginsListResult>;
  pluginToggle?: (payload: {
    action: "install" | "enable" | "disable";
    pluginId: string;
  }) => Promise<PluginToggleResult>;
  getOnboardingState: () => Promise<unknown>;
  retryOnboardingStep: (payload: unknown) => Promise<unknown>;
  finishOnboarding: () => Promise<unknown>;
  saveAgent: (payload: unknown) => Promise<unknown>;
  addAgent?: (payload: { name: string; workspace?: string; copyAuth?: boolean }) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
  deleteAgent?: (payload: { id: string }) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
  testModelConnection: (payload: unknown) => Promise<unknown>;
};
