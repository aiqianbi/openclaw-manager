import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  Ban,
  Download,
  Link2,
  Loader2,
  MessageSquare,
  Pencil,
  Plug,
  Plus,
  QrCode,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useChatStore } from "@/store/chat-store";
import { useChannelsPluginsStore } from "@/store/channels-plugins-store";
import type { GatewayBrowserClient } from "@/gateway/gateway-browser-client";
import type { ChannelsLoginEvent } from "@/types/electron-api";
import type { PluginItem } from "./plugin-result-normalize";
import { AccountPolicyFields, multilineFromStringArray, normalizeAccountPolicyOnSave } from "./account-policy-fields";
import { ALL_CATALOG_IDS, CHANNEL_CATALOG, channelHasDeviceLinkTab, getCatalogEntry, PROVIDER_PLUGIN_MAP } from "./channel-catalog";

// type Panel = "channelConfig" | "bindings";

type ConfigGetResult = {
  hash?: string | null;
  raw?: string | null;
  config?: Record<string, unknown> | null;
};

type JsonSchema = Record<string, any>;

type FallbackField = { key: string; label: string; secret?: boolean; placeholder?: string };

// type ChannelAccountRow = {
//   provider: string;
//   accountId: string;
//   displayName: string;
//   plugin: PluginItem | null;
//   pluginInstalled: boolean;
//   pluginEnabled: boolean;
//   configured: boolean;
//   runtimeOk: boolean;
// };

function safeString(v: unknown): string {
  if (typeof v === "string") return v;
  return v == null ? "" : String(v);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function getAtPath(root: unknown, path: (string | number)[]): unknown {
  let cur: any = root;
  for (const key of path) {
    if (cur == null) return undefined;
    cur = cur[key as any];
  }
  return cur;
}

function setAtPath(root: Record<string, unknown>, path: (string | number)[], value: unknown): Record<string, unknown> {
  const next = cloneJson(root);
  let cur: any = next;
  for (let i = 0; i < path.length; i += 1) {
    const key = path[i]!;
    const isLast = i === path.length - 1;
    if (isLast) {
      cur[key as any] = value;
      break;
    }
    const nk = path[i + 1]!;
    const existing = cur[key as any];
    if (existing == null || typeof existing !== "object") {
      cur[key as any] = typeof nk === "number" ? [] : {};
    }
    cur = cur[key as any];
  }
  return next;
}

function deleteAtPath(root: Record<string, unknown>, path: (string | number)[]): Record<string, unknown> {
  const next = cloneJson(root);
  let cur: any = next;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]!;
    if (cur == null) return next;
    cur = cur[key as any];
  }
  const last = path[path.length - 1]!;
  if (cur && typeof cur === "object") {
    if (Array.isArray(cur) && typeof last === "number") {
      cur.splice(last, 1);
    } else {
      delete cur[last as any];
    }
  }
  return next;
}

// function shouldMaskSecret(fieldName: string, schema?: JsonSchema | null): boolean {
//   const n = fieldName.toLowerCase();
//   if (/(token|secret|password|apikey|api_key)/i.test(n)) return true;
//   const fmt = safeString(schema?.format).toLowerCase();
//   if (/(password|secret)/i.test(fmt)) return true;
//   return false;
// }

function pickSchemaForProvider(schema: JsonSchema | null, provider: string): JsonSchema | null {
  if (!schema || typeof schema !== "object") return null;
  const ch = schema?.properties?.channels;
  const p = ch?.properties?.[provider];
  return p && typeof p === "object" ? p : null;
}

function pickChannelsSchema(schema: JsonSchema | null): JsonSchema | null {
  const ch = schema?.properties?.channels;
  return ch && typeof ch === "object" ? ch : null;
}

// function pickBindingsSchema(schema: JsonSchema | null): JsonSchema | null {
//   const b = schema?.properties?.bindings;
//   return b && typeof b === "object" ? b : null;
// }

async function gatewayRequestOrThrow(
  client: GatewayBrowserClient | null,
  connected: boolean,
  method: string,
  params: unknown,
  timeoutMs?: number,
): Promise<any> {
  if (!connected) throw new Error("网关 WebSocket 未连接");
  if (!client) throw new Error("网关 WebSocket client 未就绪");
  const req = client.request(method, params);
  if (!timeoutMs || !(Number.isFinite(timeoutMs) && timeoutMs > 0)) return req;
  let timer: number | null = null;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(`${method} 超时（${timeoutMs}ms）`)), timeoutMs);
    });
    return await Promise.race([req, timeout]);
  } finally {
    if (timer != null) window.clearTimeout(timer);
  }
}

function serializeConfig(configObj: Record<string, unknown>): string {
  return JSON.stringify(configObj, null, 2);
}

function normalizeProviderKey(k: string): string {
  return safeString(k).trim().toLowerCase();
}

/**
 * 启用后 CLI 常在 channelIds 里回报 `openclaw-weixin` 等，与配置里的 `channels.weixin` 应对齐为同一逻辑 slug。
 */
function openclawChannelSlugToCanonicalKey(k: string): string {
  const n = normalizeProviderKey(k);
  if (!n.startsWith("openclaw-")) return n;
  const rest = n.slice("openclaw-".length);
  if (rest && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(rest)) return rest;
  return n;
}

/** 频道卡片头像：先规范 openclaw-* slug，再映射 emoji（避免 weixin 等落到默认 🔗） */
function channelAvatarEmoji(providerKeyRaw: string): string {
  const k = openclawChannelSlugToCanonicalKey(normalizeProviderKey(providerKeyRaw));
  const m: Record<string, string> = {
    telegram: "✈️",
    feishu: "🟦",
    lark: "🟦",
    whatsapp: "💬",
    discord: "🎮",
    slack: "🟪",
    weixin: "💚",
    qqbot: "🐧",
    dingtalk: "🔔",
    wecom: "🏢",
    signal: "📡",
    webchat: "🌐",
    line: "💬",
    matrix: "🕸️",
    irc: "📻",
    teams: "👔",
    googlechat: "💬",
    imessage: "💬",
    zalouser: "📱",
    bluebubbles: "💬",
    msteams: "👔",
    nostr: "🟣",
    nostrchat: "🟣",
    nostr_dm: "🟣",
    slack_legacy: "🟪",
    synology_chat: "📦",
    twitch: "🎮",
    xmpp: "💬",
  };
  return m[k] ?? "🔗";
}

/** 读取 channels.<x> 块：兼容 weixin / openclaw-weixin 等别名 */
function pickChannelsMapEntry(channelsBlock: unknown, logicalKey: string): unknown {
  if (!channelsBlock || typeof channelsBlock !== "object") return undefined;
  const block = channelsBlock as Record<string, unknown>;
  const k = normalizeProviderKey(logicalKey);
  const canon = openclawChannelSlugToCanonicalKey(k);
  const tryKeys = [k, canon, `openclaw-${canon}`, k.startsWith("openclaw-") ? k : ""].filter(Boolean);
  const seen = new Set<string>();
  for (const t of tryKeys) {
    if (seen.has(t)) continue;
    seen.add(t);
    if (Object.prototype.hasOwnProperty.call(block, t) && block[t] != null) return block[t];
  }
  return undefined;
}

/**
 * CLI `plugins list --json`：对象上**带有 `channelIds` 且为数组**（含空数组）即频道类插件；无此字段的不参与频道 UI。
 * slug 推导：非空 channelIds 优先；为空时再用目录/npm/id 等兜底（禁用/未在 allowlist 时常为空数组）。
 */
function isChannelPluginEntry(p: PluginItem): boolean {
  return Boolean(p && typeof p === "object" && "channelIds" in p && Array.isArray(p.channelIds));
}

/**
 * 从**频道类**插件元数据得到可能出现的 channels.<key> slug（仅应对 isChannelPluginEntry 为 true 的项调用，内部也会再校验）。
 */
function channelKeysFromPluginMeta(p: PluginItem): string[] {
  if (!isChannelPluginEntry(p)) return [];
  if (p.channelIds!.length > 0) {
    return Array.from(
      new Set(
        p
          .channelIds!.map((id) => openclawChannelSlugToCanonicalKey(normalizeProviderKey(safeString(id))))
          .filter(Boolean),
      ),
    );
  }
  const pid = normalizeProviderKey(safeString(p.id));
  const pkg = safeString(p.name).trim().toLowerCase();
  if (pid && getCatalogEntry(pid)) return [pid];
  for (const c of CHANNEL_CATALOG) {
    const np = c.npmPackage?.trim().toLowerCase();
    if (np && pkg && np === pkg) return [normalizeProviderKey(c.id)];
  }
  for (const [ch, plugId] of Object.entries(PROVIDER_PLUGIN_MAP)) {
    if (normalizeProviderKey(plugId) === pid) return [normalizeProviderKey(ch)];
  }
  if (pid.startsWith("openclaw-")) {
    const rest = pid.slice("openclaw-".length);
    if (rest && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(rest)) return [rest];
  }
  // 社区频道插件 id 常为简短 slug（dingtalk、wecom），与 openclaw-* 不同；描述里多带 “channel plugin”
  const desc = safeString(p.description);
  if (pid && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(pid) && /\bchannel\s+plugin\b/i.test(desc)) {
    return [pid];
  }
  return [];
}

function findPluginByChannelKey(providerRaw: string, pluginsList: PluginItem[]): PluginItem | null {
  const provider = normalizeProviderKey(providerRaw);
  if (!provider) return null;
  const channelPlugins = pluginsList.filter(isChannelPluginEntry);
  const byChannelId =
    channelPlugins.find((p) =>
      p.channelIds!.some((cid) => {
        const n = normalizeProviderKey(safeString(cid));
        const c = openclawChannelSlugToCanonicalKey(n);
        return c === provider || n === provider || c === openclawChannelSlugToCanonicalKey(provider);
      }),
    ) ?? null;
  if (byChannelId) return byChannelId;
  const mappedId = PROVIDER_PLUGIN_MAP[provider] ?? provider;
  const nMapped = normalizeProviderKey(safeString(mappedId));
  const nOpenclaw = normalizeProviderKey(`openclaw-${provider}`);
  return (
    channelPlugins.find((p) => {
      const id = normalizeProviderKey(safeString(p.id));
      return id === nMapped || id === provider || id === nOpenclaw;
    }) ?? null
  );
}

/** 传给 `openclaw plugins enable|disable|install <id>` 的插件 id */
function resolveOpenClawPluginCliId(providerRaw: string, pluginsList: PluginItem[]): string {
  const plugin = findPluginByChannelKey(providerRaw, pluginsList);
  if (plugin?.id) return normalizeProviderKey(safeString(plugin.id));
  const k = normalizeProviderKey(providerRaw);
  return normalizeProviderKey(safeString(PROVIDER_PLUGIN_MAP[k] ?? k));
}

/** 配置中已登记渠道插件（entries / allow）时视为已安装，避免仅依赖 plugins list 未返回时误显「安装」 */
function isPluginPresentInOpenClawConfig(providerRaw: string, configRoot: unknown): boolean {
  const provider = normalizeProviderKey(providerRaw);
  if (!provider) return false;
  const mappedId = normalizeProviderKey(PROVIDER_PLUGIN_MAP[provider] ?? provider);
  const plugs = getAtPath(configRoot, ["plugins"]);
  if (!isObject(plugs)) return false;
  const entries = (plugs as any).entries;
  if (isObject(entries)) {
    for (const k of Object.keys(entries)) {
      const nk = normalizeProviderKey(k);
      if (nk === provider || nk === mappedId) return true;
    }
  }
  const allow = (plugs as any).allow;
  if (Array.isArray(allow)) {
    for (const x of allow) {
      const nx = normalizeProviderKey(safeString(x));
      if (nx === provider || nx === mappedId) return true;
    }
  }
  return false;
}

function getPluginEnabledFromOpenClawConfig(providerRaw: string, configRoot: unknown): boolean | undefined {
  const provider = normalizeProviderKey(providerRaw);
  if (!provider) return undefined;
  const mappedId = normalizeProviderKey(PROVIDER_PLUGIN_MAP[provider] ?? provider);
  const entries = getAtPath(configRoot, ["plugins", "entries"]);
  if (!isObject(entries)) return undefined;
  for (const [k, v] of Object.entries(entries)) {
    const nk = normalizeProviderKey(k);
    if (nk !== provider && nk !== mappedId) continue;
    if (!isObject(v)) return undefined;
    if ("enabled" in v) return Boolean((v as any).enabled);
    return undefined;
  }
  return undefined;
}

function channelDisplayTitle(providerKeyRaw: string): string {
  const k = normalizeProviderKey(providerKeyRaw);
  const canon = openclawChannelSlugToCanonicalKey(k);
  return getCatalogEntry(canon)?.titleZh ?? getCatalogEntry(k)?.titleZh ?? canon;
}

function isEmptyValue(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

// function shallowPickString(obj: Record<string, unknown>, key: string): string {
//   const v = obj[key];
//   return typeof v === "string" ? v.trim() : "";
// }

// function schemaRequiredMissing(obj: Record<string, unknown>, schema: JsonSchema | null): string[] {
//   const req = Array.isArray(schema?.required) ? (schema!.required as string[]) : [];
//   if (!req.length) return [];
//   const missing: string[] = [];
//   for (const key of req) {
//     const val = obj[key];
//     if (isEmptyValue(val)) missing.push(key);
//   }
//   return missing;
// }

function getAccountFallbackFields(providerKeyRaw: string): FallbackField[] {
  const provider = normalizeProviderKey(providerKeyRaw);
  if (provider === "feishu") {
    return [
      { key: "name", label: "name", placeholder: "My AI assistant" },
      { key: "appId", label: "appId", placeholder: "cli_xxx" },
      { key: "appSecret", label: "appSecret", secret: true, placeholder: "xxx" },
    ];
  }
  if (provider === "telegram") {
    return [
      { key: "name", label: "name", placeholder: "My bot" },
      { key: "botToken", label: "botToken", secret: true, placeholder: "123456:ABC..." },
    ];
  }
  return [{ key: "name", label: "name", placeholder: "Account name" }];
}

export type ChannelsPageHandle = {
  refresh: () => void;
  refreshPlugins: () => void;
  save: () => void;
  loading: boolean;
  pluginsLoading: boolean;
  saving: boolean;
  saveDisabled: boolean;
  gatewayConnected: boolean;
};

export const ChannelsPage = forwardRef<ChannelsPageHandle, { hasElectronApi: boolean }>(function ChannelsPage(props, ref) {
  const { hasElectronApi } = props;
  const gatewayClient = useChatStore((s) => s.gatewayClient);
  const gatewayConnected = useChatStore((s) => s.gatewayConnected);
  const plugins = useChannelsPluginsStore((s) => s.plugins);
  // console.log('plugins:',plugins);
  const pluginsLoading = useChannelsPluginsStore((s) => s.pluginsLoading);
  const pluginErr = useChannelsPluginsStore((s) => s.pluginErr);
  const loadPlugins = useChannelsPluginsStore((s) => s.loadPlugins);
  const setPluginErr = useChannelsPluginsStore((s) => s.setPluginErr);

  // const [panel, setPanel] = useState<Panel>("channelConfig");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [schema, setSchema] = useState<JsonSchema | null>(null);
  const [configHash, setConfigHash] = useState<string | null>(null);
  const [configObj, setConfigObj] = useState<Record<string, unknown>>({});
  const [configDirty, setConfigDirty] = useState(false);
  const [autoApply, setAutoApply] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  // 节点配对（node.pair.*）已从此页移除：属 Gateway 设备接入审批，与渠道/账号无关。恢复说明见文件末尾 NODE_PAIRING_LEGACY。
  const [dmPairingLoading, setDmPairingLoading] = useState(false);
  const [dmPairingErr, setDmPairingErr] = useState<string | null>(null);
  const [dmPairingRequests, setDmPairingRequests] = useState<any[]>([]);
  const [dmPairingBusyCode, setDmPairingBusyCode] = useState<string | null>(null);
  const [dmPairingAccountId, setDmPairingAccountId] = useState("");
  const [dmPairingManualCode, setDmPairingManualCode] = useState("");
  const [pluginBusyId, setPluginBusyId] = useState<string | null>(null);

  const [channelsStatus, setChannelsStatus] = useState<any>(null);
  const [agents, setAgents] = useState<any[]>([]);

  const [activeProvider, setActiveProvider] = useState<string>("telegram");
  /** 避免 refreshAll 依赖 activeProvider 导致切换 provider 后 effect 再次拉配置、冲掉未保存草稿 */
  const activeProviderRef = useRef(activeProvider);
  activeProviderRef.current = activeProvider;

  /** 插件启用后 channelIds 常带 openclaw-weixin，与配置 slug weixin 统一为 canonical，避免标题/选中态错乱 */
  useEffect(() => {
    const raw = normalizeProviderKey(activeProvider);
    const canon = openclawChannelSlugToCanonicalKey(raw);
    if (raw && canon !== raw) setActiveProvider(canon);
  }, [activeProvider]);

  const refreshAll = useCallback(async () => {
    if (!hasElectronApi || !gatewayConnected) return;
    setLoading(true);
    setErr(null);
    try {
      const [cfg, sch, chst, ag] = await Promise.all([
        gatewayRequestOrThrow(gatewayClient, gatewayConnected, "config.get", {}, 45000) as Promise<ConfigGetResult>,
        gatewayRequestOrThrow(gatewayClient, gatewayConnected, "config.schema", {}, 45000) as Promise<any>,
        gatewayRequestOrThrow(
          gatewayClient,
          gatewayConnected,
          "channels.status",
          { probe: false, timeoutMs: 8000 },
          45000,
        ),
        gatewayRequestOrThrow(gatewayClient, gatewayConnected, "agents.list", {}, 45000),
      ]);

      const cfgObj = isObject(cfg?.config) ? (cfg.config as Record<string, unknown>) : {};
      setConfigObj(cfgObj);
      setConfigHash(safeString(cfg?.hash) || null);
      setConfigDirty(false);
      setSaveErr(null);

      setSchema(sch && typeof sch === "object" ? (sch as JsonSchema) : null);
      setChannelsStatus(chst ?? null);
      setAgents(Array.isArray((ag as any)?.agents) ? (ag as any).agents : []);

      const providersFromCfg = Object.keys(((cfgObj as any)?.channels ?? {}) as Record<string, unknown>)
        .map(normalizeProviderKey)
        .map(openclawChannelSlugToCanonicalKey);
      const providersFromSchema = Object.keys((pickChannelsSchema(sch as any)?.properties ?? {}) as Record<string, unknown>).map(
        normalizeProviderKey,
      );
      const providersFromStatus = Object.keys(((chst as any)?.channels ?? {}) as Record<string, unknown>)
        .map(normalizeProviderKey)
        .map(openclawChannelSlugToCanonicalKey);
      // 与 providers useMemo 一致：须含插件推导的频道 key，否则仅装在插件列表里的 weixin 等会被判为「不在 all」并把 activeProvider 改成 all[0]（常为 feishu）
      const pluginsSnap = useChannelsPluginsStore.getState().plugins;
      const fromPlugins = pluginsSnap.filter(isChannelPluginEntry).flatMap((p) => channelKeysFromPluginMeta(p));
      const catalogIds = ALL_CATALOG_IDS.map(normalizeProviderKey);
      const all = Array.from(
        new Set([...catalogIds, ...fromPlugins, ...providersFromCfg, ...providersFromSchema, ...providersFromStatus].filter(Boolean)),
      ).sort();
      const ap = normalizeProviderKey(activeProviderRef.current);
      const apCanon = openclawChannelSlugToCanonicalKey(ap);
      if (all.length) {
        if (!all.includes(ap)) {
          setActiveProvider(all.includes(apCanon) ? apCanon : all[0]!);
        }
      } else {
        setActiveProvider(normalizeProviderKey(ALL_CATALOG_IDS[0] ?? "telegram"));
      }
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [gatewayClient, gatewayConnected, hasElectronApi]);

  useEffect(() => {
    if (!hasElectronApi || !gatewayConnected) return;
    void refreshAll();
  }, [gatewayConnected, hasElectronApi, refreshAll]);

  /** 插件列表来自本机 openclaw CLI；全局缓存，本会话仅自动请求一次，避免每次切入频道页重复 IPC */
  useEffect(() => {
    if (!hasElectronApi) return;
    void loadPlugins({ force: false });
  }, [hasElectronApi, loadPlugins]);

  const findPluginByProvider = useCallback(
    (providerRaw: string): PluginItem | null => findPluginByChannelKey(providerRaw, plugins),
    [plugins],
  );

  const providers = useMemo(() => {
    const fromCfg = Object.keys(((configObj as any)?.channels ?? {}) as Record<string, unknown>)
      .map(normalizeProviderKey)
      .map(openclawChannelSlugToCanonicalKey);
    const fromSchema = Object.keys((pickChannelsSchema(schema)?.properties ?? {}) as Record<string, unknown>).map(normalizeProviderKey);
    const fromStatus = Object.keys(((channelsStatus as any)?.channels ?? {}) as Record<string, unknown>)
      .map(normalizeProviderKey)
      .map(openclawChannelSlugToCanonicalKey);
    const fromPlugins = plugins.filter(isChannelPluginEntry).flatMap((p) => channelKeysFromPluginMeta(p));
    const catalogIds = ALL_CATALOG_IDS.map(normalizeProviderKey);
    const all = Array.from(
      new Set([...catalogIds, ...fromPlugins, ...fromCfg, ...fromSchema, ...fromStatus].filter(Boolean)),
    ).sort();
    return all.length ? all : ALL_CATALOG_IDS.slice();
  }, [channelsStatus, configObj, plugins, schema]);

  // const filteredProviders = useMemo(() => providers, [providers]);

  // const supportedProviders = useMemo(() => {
  //   return Array.from(new Set([...ALL_CATALOG_IDS.map(normalizeProviderKey), ...providers].filter(Boolean))).sort((a, b) =>
  //     a.localeCompare(b),
  //   );
  // }, [providers]);

  /** 已在 openclaw.json 的 channels 下出现过的 provider，视为已配置，不出现在「未配置频道」网格 */
  const configuredChannelKeys = useMemo(() => {
    return new Set(
      Object.keys(((configObj as any)?.channels ?? {}) as Record<string, unknown>)
        .map(normalizeProviderKey)
        .filter(Boolean)
        .map(openclawChannelSlugToCanonicalKey),
    );
  }, [configObj]);

  // const unconfiguredProviders = useMemo(() => {
  //   return supportedProviders.filter((p) => !configuredChannelKeys.has(normalizeProviderKey(p)));
  // }, [configuredChannelKeys, supportedProviders]);

  /**
   * 截图布局：仅统计「含 channelIds 字段」的频道插件；key 优先非空 channelIds，否则 slug 兜底。
   * 已配置 / 未配置：用 config.channels 的 key（与网关 config.get / channels.status 同源 refreshAll 数据）做交/差。
   */
  const pluginChannelKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const p of plugins) {
      if (!isChannelPluginEntry(p)) continue;
      for (const k of channelKeysFromPluginMeta(p)) keys.add(k);
    }
    return Array.from(keys).sort((a, b) => a.localeCompare(b));
  }, [plugins]);

  const screenshotConfiguredChannelKeys = useMemo(
    () => pluginChannelKeys.filter((k) => configuredChannelKeys.has(k)),
    [configuredChannelKeys, pluginChannelKeys],
  );

  const screenshotUnconfiguredChannelKeys = useMemo(
    () => pluginChannelKeys.filter((k) => !configuredChannelKeys.has(k)),
    [configuredChannelKeys, pluginChannelKeys],
  );

  const providerConfigObj = useMemo(() => {
    const raw = pickChannelsMapEntry((configObj as any)?.channels, activeProvider);
    return isObject(raw) ? (raw as Record<string, unknown>) : {};
  }, [activeProvider, configObj]);

  // const providerSchema = useMemo(() => pickSchemaForProvider(schema, activeProvider), [activeProvider, schema]);
  const providerDmPolicy = useMemo(() => safeString(providerConfigObj?.dmPolicy).trim().toLowerCase(), [providerConfigObj]);
  const dmPairingChannelKey = useMemo(
    () => getCatalogEntry(normalizeProviderKey(activeProvider))?.pairing.openclawPairingChannel ?? null,
    [activeProvider],
  );
  const detailCatalogEntry = useMemo(
    () => getCatalogEntry(normalizeProviderKey(activeProvider)),
    [activeProvider],
  );
  const detailHasDeviceLoginTab = useMemo(() => channelHasDeviceLinkTab(detailCatalogEntry), [detailCatalogEntry]);

  const providerPairingAccounts = useMemo(() => {
    const acc = providerConfigObj?.accounts;
    if (!isObject(acc)) return [];
    return Object.keys(acc).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [providerConfigObj]);

  // const providerStatus = useMemo((): Record<string, any> | null => {
  //   const st = pickChannelsMapEntry((channelsStatus as any)?.channels, activeProvider);
  //   return st && typeof st === "object" ? (st as Record<string, any>) : null;
  // }, [activeProvider, channelsStatus]);
  // const providerPluginId = useMemo(
  //   () => resolveOpenClawPluginCliId(activeProvider, plugins),
  //   [activeProvider, plugins],
  // );
  // const providerPlugin = useMemo(() => {
  //   return findPluginByProvider(activeProvider);
  // }, [activeProvider, findPluginByProvider]);

  // const providerPluginInstalledUi = useMemo(
  //   () => Boolean(providerPlugin) || isPluginPresentInOpenClawConfig(activeProvider, configObj),
  //   [activeProvider, configObj, providerPlugin],
  // );
  // const providerPluginEnabledUi = useMemo(() => {
  //   if (providerPlugin) return Boolean(providerPlugin.enabled);
  //   const fromCfg = getPluginEnabledFromOpenClawConfig(activeProvider, configObj);
  //   return fromCfg !== undefined ? fromCfg : true;
  // }, [activeProvider, configObj, providerPlugin]);

  // const missingRequired = useMemo(() => schemaRequiredMissing(providerConfigObj, providerSchema), [providerConfigObj, providerSchema]);

  // const onProviderFieldChange = useCallback(
  //   (field: string, value: unknown) => {
  //     setConfigObj((prev) => setAtPath(prev, ["channels", activeProvider, field], value));
  //     setConfigDirty(true);
  //     setSaveErr(null);
  //   },
  //   [activeProvider],
  // );

  // const onProviderDeleteField = useCallback(
  //   (field: string) => {
  //     setConfigObj((prev) => deleteAtPath(prev, ["channels", activeProvider, field]));
  //     setConfigDirty(true);
  //     setSaveErr(null);
  //   },
  //   [activeProvider],
  // );

  const saveConfig = useCallback(async () => {
    if (!hasElectronApi || !gatewayConnected) return;
    if (!configDirty) return;
    if (!configHash) {
      setSaveErr("缺少 baseHash（config.get 未返回 hash），请刷新后再试。");
      return;
    }
    setSaving(true);
    setSaveErr(null);
    try {
      const raw = serializeConfig(configObj);
      await gatewayRequestOrThrow(
        gatewayClient,
        gatewayConnected,
        "config.set",
        { raw, baseHash: configHash },
        60000,
      );
      if (autoApply) {
        await gatewayRequestOrThrow(gatewayClient, gatewayConnected, "config.apply", {}, 60000);
      }
      await refreshAll();
    } catch (e) {
      setSaveErr(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  }, [autoApply, configDirty, configHash, configObj, gatewayClient, gatewayConnected, hasElectronApi, refreshAll]);

  const togglePluginEnabled = useCallback(
    async (enabled: boolean, channelKeyOverride?: string) => {
      if (!hasElectronApi) return;
      const api = window.api;
      const ch = normalizeProviderKey(safeString(channelKeyOverride ?? activeProvider));
      const pid = safeString(resolveOpenClawPluginCliId(ch, plugins)).trim();
      if (!api?.pluginToggle && !api?.pluginCli) {
        setPluginErr("当前环境未暴露 pluginToggle / pluginCli IPC。");
        return;
      }
      if (!pid) {
        setPluginErr("无法解析该渠道的插件 ID（请确认插件已在列表中，或先选中该渠道再试）。");
        return;
      }
      setPluginBusyId(pid);
      setPluginErr(null);
      try {
        const action = enabled ? "enable" : "disable";
        const res = api.pluginToggle
          ? await api.pluginToggle({ action, pluginId: pid })
          : await api.pluginCli!({ action, pluginId: pid });
        if (!res?.ok) throw new Error(res?.error ?? `插件${enabled ? "启用" : "禁用"}失败。`);
        await Promise.all([refreshAll(), loadPlugins({ force: true })]);
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        setPluginErr(msg);
      } finally {
        setPluginBusyId(null);
      }
    },
    [activeProvider, hasElectronApi, loadPlugins, plugins, refreshAll, setPluginErr],
  );

  const installPluginViaCli = useCallback(
    async (channelKeyOverride?: string) => {
      const api = window.api;
      const ch = normalizeProviderKey(safeString(channelKeyOverride ?? activeProvider));
      const pid = safeString(resolveOpenClawPluginCliId(ch, plugins)).trim();
      if (!api?.pluginToggle && !api?.pluginCli) {
        setPluginErr("当前环境未暴露 pluginToggle / pluginCli IPC。");
        return;
      }
      if (!pid) {
        setPluginErr("无法解析该渠道的插件 ID。");
        return;
      }
      setPluginBusyId(pid);
      setPluginErr(null);
      try {
        const res = api.pluginToggle
          ? await api.pluginToggle({ action: "install", pluginId: pid })
          : await api.pluginCli!({ action: "install", pluginId: pid });
        if (!res?.ok) throw new Error(res?.error ?? "插件安装失败。");
        await Promise.all([refreshAll(), loadPlugins({ force: true })]);
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        setPluginErr(msg);
      } finally {
        setPluginBusyId(null);
      }
    },
    [activeProvider, loadPlugins, plugins, refreshAll, setPluginErr],
  );

  const loadDmPairings = useCallback(async () => {
    const api = window.api;
    if (!api?.pairingCli) {
      setDmPairingErr("当前版本未暴露 pairing CLI IPC（manager:pairingCli）。");
      setDmPairingRequests([]);
      return;
    }
    if (dmPairingChannelKey == null) {
      setDmPairingErr(null);
      setDmPairingRequests([]);
      return;
    }
    setDmPairingLoading(true);
    setDmPairingErr(null);
    try {
      const res = await api.pairingCli({
        action: "list",
        channel: dmPairingChannelKey,
        accountId: dmPairingAccountId.trim() || undefined,
      });
      if (!res?.ok) throw new Error(res?.error ?? "读取配对列表失败。");
      const raw = res.result as any;
      const reqs = Array.isArray(raw?.requests) ? raw.requests : Array.isArray(raw) ? raw : [];
      setDmPairingRequests(reqs);
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      setDmPairingErr(msg);
      setDmPairingRequests([]);
    } finally {
      setDmPairingLoading(false);
    }
  }, [dmPairingAccountId, dmPairingChannelKey]);

  const resolveDmPairCode = useCallback((item: any): string => {
    const candidates = [item?.code, item?.pairingCode, item?.requestCode, item?.id];
    for (const c of candidates) {
      const v = safeString(c).trim();
      if (v) return v.toUpperCase();
    }
    return "";
  }, []);

  const approveDmPairing = useCallback(
    async (codeRaw: string) => {
      const api = window.api;
      if (!api?.pairingCli) {
        setDmPairingErr("当前版本未暴露 pairing CLI IPC（manager:pairingCli）。");
        return;
      }
      const code = codeRaw.trim().toUpperCase();
      if (!code) {
        setDmPairingErr("配对码不能为空。");
        return;
      }
      if (dmPairingChannelKey == null) {
        setDmPairingErr("当前渠道不支持 openclaw pairing CLI。");
        return;
      }
      setDmPairingBusyCode(code);
      setDmPairingErr(null);
      try {
        const res = await api.pairingCli({
          action: "approve",
          channel: dmPairingChannelKey,
          accountId: dmPairingAccountId.trim() || undefined,
          code,
          notify: true,
        });
        if (!res?.ok) throw new Error(res?.error ?? "批准配对失败。");
        setDmPairingManualCode("");
        await loadDmPairings();
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        setDmPairingErr(msg);
      } finally {
        setDmPairingBusyCode(null);
      }
    },
    [dmPairingAccountId, dmPairingChannelKey, loadDmPairings],
  );

  // ---------------- Accounts (optional) ----------------
  const providerAccountsObj = useMemo(() => {
    const raw = providerConfigObj?.accounts;
    return isObject(raw) ? (raw as Record<string, unknown>) : null;
  }, [providerConfigObj]);

  // const providerAccountsSchema = useMemo(() => {
  //   const acc = providerSchema?.properties?.accounts;
  //   return acc && typeof acc === "object" ? (acc as JsonSchema) : null;
  // }, [providerSchema]);

  // const accountItemSchema = useMemo(() => {
  //   const ap = providerAccountsSchema?.additionalProperties;
  //   return ap && typeof ap === "object" ? (ap as JsonSchema) : null;
  // }, [providerAccountsSchema]);

  // const accountIds = useMemo(() => {
  //   const keys = providerAccountsObj ? Object.keys(providerAccountsObj) : [];
  //   return keys.sort((a, b) => a.localeCompare(b));
  // }, [providerAccountsObj]);

  // const feishuFlatAppId = useMemo(() => shallowPickString(providerConfigObj, "appId"), [providerConfigObj]);
  // const feishuFlatAppSecret = useMemo(() => shallowPickString(providerConfigObj, "appSecret"), [providerConfigObj]);
  // const feishuNeedsAccountsMigration = useMemo(() => {
  //   if (normalizeProviderKey(activeProvider) !== "feishu") return false;
  //   if (providerAccountsObj) return false;
  //   return Boolean(feishuFlatAppId || feishuFlatAppSecret);
  // }, [activeProvider, feishuFlatAppId, feishuFlatAppSecret, providerAccountsObj]);

  // const migrateFeishuToAccounts = useCallback(() => {
  //   const ok = window.confirm(
  //     "将飞书 appId/appSecret 迁移到官方 accounts.main 结构？\n\n迁移后可按 accountId 绑定不同智能体（main/work 可分别绑定不同 accountId）。",
  //   );
  //   if (!ok) return;
  //   setConfigObj((prev) => {
  //     const next = cloneJson(prev);
  //     const channels = isObject((next as any).channels) ? (next as any).channels : ((next as any).channels = {});
  //     const feishu = isObject(channels.feishu) ? channels.feishu : (channels.feishu = {});
  //     const appId = typeof feishu.appId === "string" ? feishu.appId.trim() : "";
  //     const appSecret = typeof feishu.appSecret === "string" ? feishu.appSecret.trim() : "";
  //     const accounts = isObject(feishu.accounts) ? feishu.accounts : (feishu.accounts = {});
  //     const mainAcc = isObject(accounts.main) ? accounts.main : (accounts.main = {});
  //     if (appId) mainAcc.appId = appId;
  //     if (appSecret) mainAcc.appSecret = appSecret;
  //     if (!mainAcc.name) mainAcc.name = "My AI assistant";
  //     delete feishu.appId;
  //     delete feishu.appSecret;
  //     return next;
  //   });
  //   setConfigDirty(true);
  //   setSaveErr(null);
  // }, []);

  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [accountDraftId, setAccountDraftId] = useState("");
  const [accountDraftObj, setAccountDraftObj] = useState<Record<string, unknown>>({});
  const [accountErr, setAccountErr] = useState<string | null>(null);
  const [accountPolicyAllowFromText, setAccountPolicyAllowFromText] = useState("");
  const [accountPolicyGroupAllowFromText, setAccountPolicyGroupAllowFromText] = useState("");

  useEffect(() => {
    // reset when switching provider
    setEditingAccountId(null);
    setAccountDraftId("");
    setAccountDraftObj({});
    setAccountErr(null);
    setAccountPolicyAllowFromText("");
    setAccountPolicyGroupAllowFromText("");
  }, [activeProvider]);

  useEffect(() => {
    if (!editingAccountId) {
      setAccountPolicyAllowFromText("");
      setAccountPolicyGroupAllowFromText("");
    }
  }, [editingAccountId]);

  useEffect(() => {
    setDmPairingAccountId("");
    setDmPairingManualCode("");
    setDmPairingErr(null);
    setDmPairingRequests([]);
  }, [activeProvider]);

  const startAddAccount = useCallback(() => {
    setEditingAccountId("__new__");
    setAccountDraftId("");
    setAccountDraftObj({ dmPolicy: "allowlist", groupPolicy: "allowlist" });
    setAccountPolicyAllowFromText("");
    setAccountPolicyGroupAllowFromText("");
    setAccountErr(null);
  }, []);

  const startEditAccount = useCallback(
    (id: string) => {
      const existing = providerAccountsObj?.[id];
      const base = isObject(existing) ? (cloneJson(existing) as Record<string, unknown>) : {};
      const merged: Record<string, unknown> = {
        dmPolicy: "allowlist",
        groupPolicy: "allowlist",
        ...base,
      };
      setEditingAccountId(id);
      setAccountDraftId(id);
      setAccountDraftObj(merged);
      setAccountPolicyAllowFromText(multilineFromStringArray(base.allowFrom));
      setAccountPolicyGroupAllowFromText(multilineFromStringArray(base.groupAllowFrom));
      setAccountErr(null);
    },
    [providerAccountsObj],
  );

  const deleteAccount = useCallback(
    (id: string) => {
      if (!window.confirm(`确定删除账号「${id}」？`)) return;
      setConfigObj((prev) => deleteAtPath(prev, ["channels", activeProvider, "accounts", id]));
      setConfigDirty(true);
      setSaveErr(null);
      if (editingAccountId === id) {
        setEditingAccountId(null);
        setAccountDraftId("");
        setAccountDraftObj({});
        setAccountPolicyAllowFromText("");
        setAccountPolicyGroupAllowFromText("");
      }
    },
    [activeProvider, editingAccountId],
  );

  const commitAccount = useCallback(() => {
    const id = accountDraftId.trim();
    if (!id) {
      setAccountErr("accountId 不能为空。");
      return;
    }
    if (editingAccountId === "__new__" && providerAccountsObj && Object.prototype.hasOwnProperty.call(providerAccountsObj, id)) {
      setAccountErr("该 accountId 已存在。");
      return;
    }
    const { next, error } = normalizeAccountPolicyOnSave(accountDraftObj, accountPolicyAllowFromText, accountPolicyGroupAllowFromText);
    if (error) {
      setAccountErr(error);
      return;
    }
    setConfigObj((prev) => setAtPath(prev, ["channels", activeProvider, "accounts", id], next));
    setConfigDirty(true);
    setSaveErr(null);
    setEditingAccountId(null);
    setAccountDraftId("");
    setAccountDraftObj({});
    setAccountPolicyAllowFromText("");
    setAccountPolicyGroupAllowFromText("");
    setAccountErr(null);
  }, [
    accountDraftId,
    accountDraftObj,
    accountPolicyAllowFromText,
    accountPolicyGroupAllowFromText,
    activeProvider,
    editingAccountId,
    providerAccountsObj,
  ]);

  // ---------------- Bindings ----------------
  const bindings = useMemo(() => {
    const raw = (configObj as any)?.bindings;
    return Array.isArray(raw) ? (raw as any[]) : [];
  }, [configObj]);

  const [bindingDraftAgentId, setBindingDraftAgentId] = useState("");
  const [bindingDraftChannel, setBindingDraftChannel] = useState("");
  const [bindingDraftKind, setBindingDraftKind] = useState<"accountId" | "peerDm">("accountId");
  const [bindingDraftAccountId, setBindingDraftAccountId] = useState("");
  const [bindingDraftPeerId, setBindingDraftPeerId] = useState("");

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<"bindings" | "deviceLogin" | "dmPairing">("bindings");
  const [bindingDraftJson, setBindingDraftJson] = useState("");
  const [bindingErr, setBindingErr] = useState<string | null>(null);
  const channelsLoginSessionRef = useRef<string | null>(null);
  const [channelsLoginQr, setChannelsLoginQr] = useState<string | null>(null);
  const [channelsLoginPhase, setChannelsLoginPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [channelsLoginLastErr, setChannelsLoginLastErr] = useState<string | null>(null);
  const [channelsLoginAccountId, setChannelsLoginAccountId] = useState("");

  useEffect(() => {
    if (detailOpen && detailTab === "deviceLogin" && !detailHasDeviceLoginTab) {
      setDetailTab("bindings");
    }
  }, [detailOpen, detailTab, detailHasDeviceLoginTab]);

  const bindingChannelAccounts = useMemo(() => {
    const key = normalizeProviderKey(bindingDraftChannel);
    if (!key) return [];
    const ch = pickChannelsMapEntry((configObj as any)?.channels, key);
    const acc = isObject(ch) ? (ch as Record<string, unknown>).accounts : undefined;
    if (!isObject(acc)) return [];
    return Object.keys(acc).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [bindingDraftChannel, configObj]);

  // const bindingsByChannelCounts = useMemo(() => {
  //   const counts: Record<string, number> = {};
  //   for (const b of bindings) {
  //     const channel = normalizeProviderKey(safeString((b as any)?.match?.channel));
  //     if (!channel) continue;
  //     counts[channel] = (counts[channel] ?? 0) + 1;
  //   }
  //   return counts;
  // }, [bindings]);

  // const bindingSchema = useMemo(() => pickBindingsSchema(schema), [schema]);
  // const bindingSchemaHint = useMemo(() => {
  //   const items = bindingSchema?.items;
  //   const kinds: string[] = [];
  //   if (items && typeof items === "object") {
  //     const oneOf = Array.isArray(items.oneOf) ? items.oneOf : Array.isArray(items.anyOf) ? items.anyOf : null;
  //     if (oneOf) {
  //       for (const v of oneOf) {
  //         const title = safeString(v?.title).trim();
  //         if (title) kinds.push(title);
  //       }
  //     }
  //   }
  //   return kinds;
  // }, [bindingSchema]);

  const addBinding = useCallback(() => {
    setBindingErr(null);
    const agentId = bindingDraftAgentId.trim();
    const channel = bindingDraftChannel.trim();
    if (!agentId) {
      setBindingErr("请选择 agentId。");
      return;
    }
    if (!channel) {
      setBindingErr("请选择 channel。");
      return;
    }

    let bindingObj: any = null;
    if (bindingDraftJson.trim()) {
      try {
        bindingObj = JSON.parse(bindingDraftJson);
      } catch (e) {
        setBindingErr(`JSON 解析失败：${String((e as Error)?.message ?? e)}`);
        return;
      }
      const m = bindingObj?.match;
      const mChannel = normalizeProviderKey(safeString(m?.channel));
      const hasAccountId = typeof m?.accountId === "string" && m.accountId.trim().length > 0;
      const hasPeer = Boolean(m?.peer && typeof m.peer === "object" && safeString(m.peer.kind) && safeString(m.peer.id));
      if (mChannel && !hasAccountId && !hasPeer) {
        const ok = window.confirm(
          `你正在添加一个“仅按 channel=${mChannel} 匹配”的绑定。\n\n这会导致同一渠道无法同时绑定多个智能体（冲突将由顺序决定）。\n\n建议改用 accountId 或 peer(dm)。仍要继续添加吗？`,
        );
        if (!ok) return;
      }
    } else if (bindingDraftKind === "accountId") {
      const accountId = bindingDraftAccountId.trim();
      if (!accountId) {
        setBindingErr("accountId 不能为空。");
        return;
      }
      bindingObj = { agentId, match: { channel, accountId } };
    } else {
      const peerId = bindingDraftPeerId.trim();
      if (!peerId) {
        setBindingErr("peerId 不能为空。");
        return;
      }
      bindingObj = { agentId, match: { channel, peer: { kind: "dm", id: peerId } } };
    }

    setConfigObj((prev) => {
      const next = cloneJson(prev);
      const arr = Array.isArray((next as any).bindings) ? (next as any).bindings : [];
      (next as any).bindings = [...arr, bindingObj];
      return next;
    });
    setConfigDirty(true);
    setSaveErr(null);

    setBindingDraftAccountId("");
    setBindingDraftPeerId("");
    setBindingDraftJson("");
  }, [
    bindingDraftAccountId,
    bindingDraftAgentId,
    bindingDraftChannel,
    bindingDraftJson,
    bindingDraftKind,
    bindingDraftPeerId,
  ]);

  const openDetails = useCallback((provider: string, tab: "bindings" | "deviceLogin" | "dmPairing") => {
    const key = normalizeProviderKey(provider);
    setActiveProvider(key);
    setDetailTab(tab);
    setDetailOpen(true);
    if (tab === "bindings") {
      setBindingDraftChannel(key);
    }
    if (tab === "deviceLogin") {
      setChannelsLoginPhase("idle");
      setChannelsLoginQr(null);
      setChannelsLoginLastErr(null);
      channelsLoginSessionRef.current = null;
    }
  }, []);

  const cancelChannelsLogin = useCallback(async () => {
    const api = window.api;
    const sid = channelsLoginSessionRef.current;
    if (api?.channelsLoginCancel && sid) {
      try {
        await api.channelsLoginCancel({ sessionId: sid });
      } catch {
        // ignore
      }
    }
    channelsLoginSessionRef.current = null;
    setChannelsLoginPhase("idle");
    setChannelsLoginQr(null);
  }, []);

  const startChannelsLoginForActive = useCallback(async () => {
    const api = window.api;
    if (!api?.channelsLoginStart) {
      setChannelsLoginLastErr("当前版本未暴露 channelsLogin IPC。请更新 preload / main。");
      setChannelsLoginPhase("error");
      return;
    }
    const ch = normalizeProviderKey(activeProvider);
    const canon = openclawChannelSlugToCanonicalKey(ch);
    const cat = getCatalogEntry(ch) ?? getCatalogEntry(canon);
    const loginChannel = String(cat?.channelsLoginChannelArg ?? ch).trim() || ch;
    setChannelsLoginLastErr(null);
    setChannelsLoginQr(null);
    setChannelsLoginPhase("running");
    const acc = channelsLoginAccountId.trim();
    const res = await api.channelsLoginStart({
      channel: loginChannel,
      accountId: acc || undefined,
    });
    if (!res.ok || !res.sessionId) {
      setChannelsLoginPhase("error");
      setChannelsLoginLastErr(res.error ?? "启动 channels login 失败");
      return;
    }
    channelsLoginSessionRef.current = res.sessionId;
  }, [activeProvider, channelsLoginAccountId]);

  useEffect(() => {
    const api = window.api;
    if (!api?.channelsLoginOnEvent) return;
    const unsub = api.channelsLoginOnEvent((ev: ChannelsLoginEvent) => {
      if (ev.sessionId !== channelsLoginSessionRef.current) return;
      if (ev.kind === "qr") {
        setChannelsLoginQr(ev.dataUrl);
        setChannelsLoginPhase("running");
        setChannelsLoginLastErr(null);
      } else if (ev.kind === "exit") {
        setChannelsLoginPhase(ev.code === 0 ? "done" : "error");
        if (ev.code !== 0) {
          const tail = (ev.outputTail ?? "").trim();
          setChannelsLoginLastErr(
            tail
              ? `channels login 退出码 ${ev.code}（CLI 输出如下）\n${tail}`
              : `channels login 退出码 ${ev.code}。若插件不支持 channels login、或未在 allowlist、或 channel 名不对，CLI 通常如此退出；可先在终端执行：openclaw channels login --channel <渠道> 查看完整报错。`,
          );
        }
        channelsLoginSessionRef.current = null;
        void refreshAll();
      } else if (ev.kind === "error") {
        setChannelsLoginPhase("error");
        setChannelsLoginLastErr(ev.message);
        channelsLoginSessionRef.current = null;
      }
    });
    return unsub;
  }, [refreshAll]);

  useEffect(() => {
    if (detailOpen && detailTab === "deviceLogin" && detailHasDeviceLoginTab) return;
    void cancelChannelsLogin();
  }, [detailOpen, detailTab, detailHasDeviceLoginTab, cancelChannelsLogin]);

  const removeBinding = useCallback((idx: number) => {
    if (!window.confirm("确定删除该绑定规则？")) return;
    setConfigObj((prev) => deleteAtPath(prev, ["bindings", idx]));
    setConfigDirty(true);
    setSaveErr(null);
  }, []);

  // const moveBinding = useCallback((idx: number, dir: -1 | 1) => {
  //   setConfigObj((prev) => {
  //     const next = cloneJson(prev);
  //     const arr = Array.isArray((next as any).bindings) ? (next as any).bindings : [];
  //     const j = idx + dir;
  //     if (idx < 0 || idx >= arr.length) return next;
  //     if (j < 0 || j >= arr.length) return next;
  //     const copy = [...arr];
  //     const t = copy[idx];
  //     copy[idx] = copy[j];
  //     copy[j] = t;
  //     (next as any).bindings = copy;
  //     return next;
  //   });
  //   setConfigDirty(true);
  //   setSaveErr(null);
  // }, []);

  const saveDisabled = !configDirty || saving || loading;

  useImperativeHandle(ref, () => ({
    refresh: () => void refreshAll(),
    refreshPlugins: () => void loadPlugins({ force: true }),
    save: () => void saveConfig(),
    loading,
    pluginsLoading,
    saving,
    saveDisabled,
    gatewayConnected,
  }), [refreshAll, loadPlugins, saveConfig, loading, pluginsLoading, saving, saveDisabled, gatewayConnected]);

  if (!hasElectronApi) {
    return (
      <div className="oc-page" style={{ padding: 20 }}>
        <div className="oc-rsub">仅在 Electron 中可通过网关编辑频道配置。</div>
      </div>
    );
  }

  return (
    <div className="oc-page" style={{ padding: "20px 24px" }}>

      {saveErr ? <div className="oc-banner oc-banner--warn" style={{ marginTop: 6 }}>{saveErr}</div> : null}
      {err ? <div className="oc-banner oc-banner--warn">{err}</div> : null}
      {pluginsLoading ? <div className="oc-rsub" style={{ marginTop: 8 }}>正在加载插件列表（仅处理带 channelIds 字段的频道插件）…</div> : null}
      {!pluginsLoading && pluginErr ? <div className="oc-banner oc-banner--warn">{pluginErr}</div> : null}

      <div style={{ marginTop: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--color-text-primary)" }}>已配置频道</div>
          <span className="oc-tag oc-tg" style={{ fontSize: 10, padding: "1px 8px" }}>{screenshotConfiguredChannelKeys.length}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 12 }}>
          {screenshotConfiguredChannelKeys.length === 0 ? (
            <div className="oc-rsub">
              {pluginsLoading && pluginChannelKeys.length === 0
                ? "正在加载插件列表…"
                : !pluginsLoading && pluginChannelKeys.length === 0
                  ? plugins.length === 0
                    ? "未读取到插件列表。请点击「刷新插件」，或确认已安装 OpenClaw 且已暴露 pluginsList / pluginCli。"
                    : "已加载频道插件，但未能解析出任何 channels.<key>（channelIds 为空且与目录/npm/id 不匹配）。"
                  : "暂无已配置频道（插件声明的频道均未写入 channels.*）。"}
            </div>
          ) : (
            screenshotConfiguredChannelKeys.map((p) => {
              const key = normalizeProviderKey(p);
              const cat = getCatalogEntry(key);
              const plugin = findPluginByProvider(key);
              const pluginInstalledUi = Boolean(plugin) || isPluginPresentInOpenClawConfig(key, configObj);
              const pluginEnabledUi = plugin
                ? Boolean(plugin.enabled)
                : getPluginEnabledFromOpenClawConfig(key, configObj) ?? true;
              const st = pickChannelsMapEntry((channelsStatus as any)?.channels, key);
              const chPick = pickChannelsMapEntry((configObj as any)?.channels, key);
              const runtimeOk = Boolean((st as any)?.configured) && (st as any)?.linked !== false;
              const chObj = isObject(chPick) ? (chPick as Record<string, unknown>) : {};
              const accObj = isObject(chObj?.accounts) ? (chObj.accounts as Record<string, any>) : null;
              const accountRows: { id: string; name: string }[] =
                accObj && Object.keys(accObj).length
                  ? Object.keys(accObj)
                      .filter(Boolean)
                      .sort((a, b) => a.localeCompare(b))
                      .map((id) => ({ id, name: safeString((accObj as any)?.[id]?.name).trim() || id }))
                  : [{ id: "main", name: "主账号" }];

              const rowCliId = resolveOpenClawPluginCliId(key, plugins);
              const rowBusy = pluginBusyId === rowCliId;
              /** 扫码 / signal-cli 链设备：账号由终端或 channels login 建立，手动「添加账号」无意义 */
              const hideManualAddAccount = channelHasDeviceLinkTab(cat);

              return (
                <div
                  key={key}
                  className="oc-card"
                  style={{
                    padding: "16px 18px",
                    background: "var(--color-background-secondary)",
                    border: "0.5px solid var(--color-border-tertiary)",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                    transition: "box-shadow 0.15s ease, transform 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)";
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <div
                        className="oc-av"
                        style={{
                          width: 44,
                          height: 44,
                          background: "var(--color-background-tertiary)",
                          fontSize: 22,
                          border: "1px solid var(--color-border-tertiary)",
                        }}
                      >
                        {channelAvatarEmoji(key)}
                      </div>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text-primary)" }}>{channelDisplayTitle(key)}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginTop: 3, color: "var(--color-text-tertiary)" }}>
                          <code style={{ background: "var(--color-background-tertiary)", padding: "1px 5px", borderRadius: 4, fontSize: 10 }}>{key}</code>
                          <span>·</span>
                          <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: runtimeOk ? "#52c47a" : "#e74c3c", display: "inline-block" }} />
                            {runtimeOk ? "正常" : "异常"}
                          </span>
                          <span>·</span>
                          <span>插件: {pluginInstalledUi ? (pluginEnabledUi ? "已启用" : "已禁用") : "未安装"}</span>
                          {channelHasDeviceLinkTab(cat) ? <span>· 扫码</span> : ""}
                          {cat?.pairing.openclawPairingChannel ? <span>· pairing</span> : ""}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                      {!hideManualAddAccount ? (
                        <button
                          type="button"
                          className="oc-iconbtn"
                          title="添加账号"
                          aria-label="添加账号"
                          disabled={saving || loading}
                          onClick={() => {
                            setActiveProvider(key);
                            startAddAccount();
                          }}
                        >
                          <Plus aria-hidden />
                        </button>
                      ) : null}
                      <button type="button" className="oc-iconbtn" title="绑定规则" aria-label="绑定规则" disabled={saving || loading} onClick={() => openDetails(key, "bindings")}>
                        <Link2 aria-hidden />
                      </button>
                      {channelHasDeviceLinkTab(cat) ? (
                        <button type="button" className="oc-iconbtn" title="扫码登录" aria-label="扫码登录" disabled={saving || loading} onClick={() => openDetails(key, "deviceLogin")}>
                          <QrCode aria-hidden />
                        </button>
                      ) : null}
                      <button type="button" className="oc-iconbtn" title="私信配对" aria-label="私信配对" disabled={saving || loading} onClick={() => openDetails(key, "dmPairing")}>
                        <MessageSquare aria-hidden />
                      </button>
                      {!pluginInstalledUi ? (
                        <button
                          type="button"
                          className="oc-iconbtn"
                          title="安装插件"
                          aria-label="安装插件"
                          disabled={rowBusy || saving || loading}
                          onClick={() => {
                            setActiveProvider(key);
                            void installPluginViaCli(key);
                          }}
                        >
                          {rowBusy ? <Loader2 className="oc-iconbtn-spin" aria-hidden /> : <Download aria-hidden />}
                        </button>
                      ) : pluginEnabledUi ? (
                        <button
                          type="button"
                          className="oc-iconbtn"
                          title="禁用插件"
                          aria-label="禁用插件"
                          disabled={rowBusy || saving || loading}
                          onClick={() => {
                            setActiveProvider(key);
                            void togglePluginEnabled(false, key);
                          }}
                        >
                          {rowBusy ? <Loader2 className="oc-iconbtn-spin" aria-hidden /> : <Ban aria-hidden />}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="oc-iconbtn"
                          title="启用插件"
                          aria-label="启用插件"
                          disabled={rowBusy || saving || loading}
                          onClick={() => {
                            setActiveProvider(key);
                            void togglePluginEnabled(true, key);
                          }}
                        >
                          {rowBusy ? <Loader2 className="oc-iconbtn-spin" aria-hidden /> : <Plug aria-hidden />}
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: "0.5px solid var(--color-border-tertiary)", display: "flex", flexDirection: "column", gap: 8 }}>
                    {accountRows.map((acc) => (
                        <div
                          key={acc.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                            flexWrap: "wrap",
                            padding: "6px 10px",
                            borderRadius: 8,
                            background: "var(--color-background-tertiary)",
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 500,
                              fontSize: 13,
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              flex: "1 1 120px",
                              color: "var(--color-text-primary)",
                            }}
                            title={acc.name}
                          >
                            {acc.name}
                          </div>
                          <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", flexShrink: 0 }}>
                            <button
                              type="button"
                              className="oc-iconbtn"
                              title="编辑账号"
                              aria-label="编辑账号"
                              disabled={saving || loading}
                              onClick={() => {
                                setActiveProvider(key);
                                startEditAccount(acc.id);
                              }}
                              style={{ width: 28, height: 28 }}
                            >
                              <Pencil aria-hidden />
                            </button>
                            {
                              acc.id !== "main" &&
                              (
                              <button
                                type="button"
                                className="oc-iconbtn"
                                title="删除账号"
                                aria-label="删除账号"
                                disabled={saving || loading}
                                onClick={() => {
                                  setActiveProvider(key);
                                  deleteAccount(acc.id);
                                }}
                                style={{ width: 28, height: 28, borderColor: "#fecaca", background: "#fef2f2", color: "#dc2626" }}
                              >
                                <Trash2 aria-hidden />
                              </button>
                              )
                            }
                          </div>
                        </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div style={{ marginTop: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--color-text-primary)" }}>未配置频道</div>
          <span className="oc-tag oc-tgr" style={{ fontSize: 10, padding: "1px 8px" }}>{screenshotUnconfiguredChannelKeys.length}</span>
        </div>
        {screenshotUnconfiguredChannelKeys.length === 0 ? (
          <div className="oc-rsub" style={{ marginTop: 12 }}>
            {pluginsLoading && pluginChannelKeys.length === 0
              ? "正在加载插件列表…"
              : !pluginsLoading && pluginChannelKeys.length === 0
                ? plugins.length === 0
                  ? "未读取到插件列表，无法展示未配置频道。"
                  : "已加载插件，但未能解析出频道 key，无法展示未配置列表。"
                : "当前未发现更多频道插件，或均已写入 channels.*。"}
          </div>
        ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12, marginTop: 10 }}>
          {screenshotUnconfiguredChannelKeys.map((p) => {
            const key = normalizeProviderKey(p);
            const cat = getCatalogEntry(key);
            const plugin = findPluginByProvider(key);
            const pluginInstalledUi = Boolean(plugin) || isPluginPresentInOpenClawConfig(key, configObj);
            const pluginEnabledUi = plugin
              ? Boolean(plugin.enabled)
              : getPluginEnabledFromOpenClawConfig(key, configObj) ?? true;
            const desc = cat?.summaryZh ?? "参见官方文档配置该渠道";
            const rowCliId = resolveOpenClawPluginCliId(key, plugins);
            const rowBusy = pluginBusyId === rowCliId;
            return (
              <div
                key={key}
                className="oc-card"
                style={{
                  padding: "14px 16px",
                  background: "var(--color-background-secondary)",
                  border: "0.5px solid var(--color-border-tertiary)",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                  transition: "box-shadow 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)";
                }}
              >
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div
                    className="oc-av"
                    style={{
                      width: 40,
                      height: 40,
                      background: "var(--color-background-tertiary)",
                      fontSize: 20,
                      border: "1px solid var(--color-border-tertiary)",
                    }}
                  >
                    {channelAvatarEmoji(key)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)" }}>{channelDisplayTitle(key)}</div>
                      {cat?.pluginMode === "optional_npm" || cat?.tags?.includes("requires_plugin") ? (
                        <span className="oc-tag oc-tr2">插件</span>
                      ) : null}
                      {cat?.pluginMode === "bundled" ? <span className="oc-tag oc-tg">捆绑</span> : null}
                      {channelHasDeviceLinkTab(cat) ? (
                        <span className="oc-tag" style={{ background: "#fef3c7", color: "#b45309" }}>扫码</span>
                      ) : null}
                      {cat?.pairing.openclawPairingChannel ? <span className="oc-tag" style={{ background: "#ede9fe", color: "#6d28d9" }}>pairing</span> : null}
                    </div>
                    <div style={{ fontSize: 12, marginTop: 4, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>{desc}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, marginTop: 4, color: "var(--color-text-tertiary)" }}>
                      <span>插件: {pluginInstalledUi ? "已安装" : "未安装"}</span>
                      <span>·</span>
                      <span>状态: {pluginInstalledUi ? (pluginEnabledUi ? "已启用" : "已禁用") : "-"}</span>
                      {cat?.docUrlZh ? (
                        <>
                          <span>·</span>
                          <a href={cat.docUrlZh} target="_blank" rel="noreferrer" style={{ color: "#3b82f6", textDecoration: "none" }}>
                            文档{cat.docEnglishOnly ? "（英文）" : ""}
                          </a>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", flexShrink: 0 }}>
                    {!pluginInstalledUi ? (
                      <button
                        type="button"
                        className="oc-iconbtn"
                        title="安装插件"
                        aria-label="安装插件"
                        disabled={rowBusy || saving || loading}
                        onClick={() => {
                          setActiveProvider(key);
                          void installPluginViaCli(key);
                        }}
                      >
                        {rowBusy ? <Loader2 className="oc-iconbtn-spin" aria-hidden /> : <Download aria-hidden />}
                      </button>
                    ) : pluginEnabledUi ? (
                      <button
                        type="button"
                        className="oc-iconbtn"
                        title="禁用插件"
                        aria-label="禁用插件"
                        disabled={rowBusy || saving || loading}
                        onClick={() => {
                          setActiveProvider(key);
                          void togglePluginEnabled(false, key);
                        }}
                      >
                        {rowBusy ? <Loader2 className="oc-iconbtn-spin" aria-hidden /> : <Ban aria-hidden />}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="oc-iconbtn"
                        title="启用插件"
                        aria-label="启用插件"
                        disabled={rowBusy || saving || loading}
                        onClick={() => {
                          setActiveProvider(key);
                          void togglePluginEnabled(true, key);
                        }}
                      >
                        {rowBusy ? <Loader2 className="oc-iconbtn-spin" aria-hidden /> : <Plug aria-hidden />}
                      </button>
                    )}
                    <button type="button" className="oc-iconbtn" title="绑定规则" aria-label="绑定规则" disabled={saving || loading} onClick={() => openDetails(key, "bindings")}>
                      <Link2 aria-hidden />
                    </button>
                    {channelHasDeviceLinkTab(cat) ? (
                      <button type="button" className="oc-iconbtn" title="扫码登录" aria-label="扫码登录" disabled={saving || loading} onClick={() => openDetails(key, "deviceLogin")}>
                        <QrCode aria-hidden />
                      </button>
                    ) : null}
                    <button type="button" className="oc-iconbtn" title="私信配对" aria-label="私信配对" disabled={saving || loading} onClick={() => openDetails(key, "dmPairing")}>
                      <MessageSquare aria-hidden />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>

      {editingAccountId ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            zIndex: 60,
            animation: "fadeIn 0.15s ease",
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setEditingAccountId(null);
          }}
        >
          <div
            className="oc-card"
            style={{
              width: "min(680px, 100%)",
              maxHeight: "85vh",
              overflow: "auto",
              padding: 0,
              background: "var(--color-background-secondary)",
              border: "0.5px solid var(--color-border-tertiary)",
              borderRadius: 16,
              boxShadow: "0 20px 60px rgba(0,0,0,0.15), 0 4px 16px rgba(0,0,0,0.08)",
              animation: "slideUp 0.2s ease",
            }}
          >
            {/* Dialog header */}
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
              padding: "16px 20px",
              borderBottom: "0.5px solid var(--color-border-tertiary)",
              background: "var(--color-background-primary)",
              borderRadius: "16px 16px 0 0",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  className="oc-av"
                  style={{ width: 32, height: 32, background: "var(--color-background-tertiary)", fontSize: 16, border: "1px solid var(--color-border-tertiary)" }}
                >
                  {channelAvatarEmoji(activeProvider)}
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)" }}>
                    {editingAccountId === "__new__" ? "新增账号" : `编辑账号`}
                  </div>
                  <div className="oc-rsub" style={{ fontSize: 11, marginTop: 1 }}>
                    {editingAccountId === "__new__" ? `为 ${channelDisplayTitle(activeProvider)} 添加新账号` : `账号: ${editingAccountId}`}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="oc-bs"
                disabled={saving || loading}
                onClick={() => setEditingAccountId(null)}
                title="关闭"
                style={{
                  width: 30,
                  height: 30,
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 8,
                  flexShrink: 0,
                }}
              >
                <X size={15} />
              </button>
            </div>

            {/* Dialog body */}
            <div style={{ padding: "16px 20px" }}>
              {accountErr ? (
                <div style={{ padding: "8px 12px", borderRadius: 8, background: "#fef3c7", border: "0.5px solid #fde68a", color: "#92400e", fontSize: 12, marginBottom: 12 }}>
                  {accountErr}
                </div>
              ) : null}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ fontWeight: 500, fontSize: 13, color: "var(--color-text-primary)" }}>accountId</div>
                  <input
                    className="oc-inptxt"
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "0.5px solid var(--color-border-secondary)",
                      background: "var(--color-background-primary)",
                      fontSize: 13,
                      color: "var(--color-text-primary)",
                      outline: "none",
                    }}
                    value={accountDraftId}
                    disabled={editingAccountId !== "__new__" || saving || loading}
                    onChange={(e) => setAccountDraftId((e.target as HTMLInputElement).value)}
                  />
                </label>
                {getAccountFallbackFields(activeProvider).map((f) => {
                  const v = accountDraftObj[f.key];
                  const hasExisting = !isEmptyValue(v);
                  const valueText = safeString(v);
                  // const valueText = f.secret ? "" : safeString(v);
                  return (
                    <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <div style={{ fontWeight: 500, fontSize: 13, color: "var(--color-text-primary)" }}>{f.label}</div>
                      <input
                        className="oc-inptxt"
                        style={{
                          padding: "8px 12px",
                          borderRadius: 8,
                          border: "0.5px solid var(--color-border-secondary)",
                          background: "var(--color-background-primary)",
                          fontSize: 13,
                          color: "var(--color-text-primary)",
                          outline: "none",
                        }}
                        type={f.secret ? "password" : "text"}
                        disabled={saving || loading}
                        placeholder={f.secret ? (hasExisting ? "已设置（输入以覆盖）" : f.placeholder ?? "") : f.placeholder ?? ""}
                        value={valueText}
                        onChange={(e) => setAccountDraftObj((prev) => ({ ...prev, [f.key]: (e.target as HTMLInputElement).value }))}
                      />
                    </label>
                  );
                })}
                <AccountPolicyFields
                  accountDraftObj={accountDraftObj}
                  setAccountDraftObj={setAccountDraftObj}
                  allowFromText={accountPolicyAllowFromText}
                  setAllowFromText={setAccountPolicyAllowFromText}
                  groupAllowFromText={accountPolicyGroupAllowFromText}
                  setGroupAllowFromText={setAccountPolicyGroupAllowFromText}
                  disabled={saving || loading}
                />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 8 }}>
                  <button type="button" className="oc-bs" disabled={saving || loading} onClick={() => setEditingAccountId(null)}>
                    取消
                  </button>
                  <button type="button" className="oc-bp" disabled={saving || loading} onClick={commitAccount}
                    style={{ padding: "7px 20px", fontWeight: 500 }}>
                    确认
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {detailOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            zIndex: 50,
            animation: "fadeIn 0.15s ease",
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDetailOpen(false);
          }}
        >
          <div
            className="oc-card"
            style={{
              width: "min(920px, 100%)",
              maxHeight: "min(88vh, 920px)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              padding: 0,
              background: "var(--color-background-secondary)",
              border: "0.5px solid var(--color-border-tertiary)",
              borderRadius: 16,
              boxShadow: "0 20px 60px rgba(0,0,0,0.15), 0 4px 16px rgba(0,0,0,0.08)",
              animation: "slideUp 0.2s ease",
            }}
          >
            {/* Dialog header */}
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
              padding: "16px 20px",
              borderBottom: "0.5px solid var(--color-border-tertiary)",
              background: "var(--color-background-primary)",
              borderRadius: "16px 16px 0 0",
              flexShrink: 0,
            }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div
                  className="oc-av"
                  style={{
                    width: 38,
                    height: 38,
                    background: "var(--color-background-tertiary)",
                    fontSize: 20,
                    border: "1px solid var(--color-border-tertiary)",
                    flexShrink: 0,
                  }}
                >
                  {channelAvatarEmoji(activeProvider)}
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)" }}>
                    渠道详情 · {channelDisplayTitle(activeProvider)}
                  </div>
                  <div style={{ fontSize: 11, marginTop: 2, color: "var(--color-text-tertiary)" }}>
                    {detailCatalogEntry?.summaryZh ?? `${activeProvider} · 路由与官方文档驱动的接入说明`}
                  </div>
                  {detailCatalogEntry?.docUrlZh ? (
                    <a
                      href={detailCatalogEntry.docUrlZh}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 11, marginTop: 2, display: "inline-block", color: "#3b82f6", textDecoration: "none" }}
                    >
                      查看官方文档{detailCatalogEntry.docEnglishOnly ? "（英文）" : ""} →
                    </a>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                className="oc-bs"
                disabled={saving || loading}
                onClick={() => setDetailOpen(false)}
                title="关闭"
                style={{
                  width: 30,
                  height: 30,
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 8,
                  flexShrink: 0,
                }}
              >
                <X size={15} />
              </button>
            </div>

            {/* Tab bar */}
            <div style={{
              display: "flex",
              gap: 6,
              padding: "12px 20px",
              borderBottom: "0.5px solid var(--color-border-tertiary)",
              background: "var(--color-background-secondary)",
              flexShrink: 0,
            }}>
              <button type="button" className={`oc-tab-btn ${detailTab === "bindings" ? "on" : ""}`} onClick={() => setDetailTab("bindings")}>
                绑定
              </button>
              {detailHasDeviceLoginTab ? (
                <button type="button" className={`oc-tab-btn ${detailTab === "deviceLogin" ? "on" : ""}`} onClick={() => setDetailTab("deviceLogin")}>
                  关联设备 / 登录
                </button>
              ) : null}
              <button type="button" className={`oc-tab-btn ${detailTab === "dmPairing" ? "on" : ""}`} onClick={() => setDetailTab("dmPairing")}>
                私信配对
              </button>
            </div>

            {/* Dialog scrollable body */}
            <div style={{
              padding: "16px 20px",
              overflow: "auto",
              flex: 1,
              minHeight: 0,
            }}>

            {detailTab === "bindings" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div className="oc-card" style={{ padding: "14px 16px", background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 2 }}>新增绑定</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>支持 accountId / peer 两种匹配模式</div>
                  {bindingErr ? (
                    <div style={{ padding: "7px 10px", borderRadius: 8, background: "#fef3c7", border: "0.5px solid #fde68a", color: "#92400e", fontSize: 12, marginTop: 10 }}>
                      {bindingErr}
                    </div>
                  ) : null}

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>agentId</div>
                      <select
                        className="oc-inptxt"
                        style={{ minWidth: 220 }}
                        value={bindingDraftAgentId}
                        disabled={saving || loading}
                        onChange={(e) => setBindingDraftAgentId((e.target as HTMLSelectElement).value)}
                      >
                        <option value="">请选择智能体…</option>
                        {agents.map((a) => {
                          const id = safeString((a as any)?.id).trim();
                          const name = safeString((a as any)?.identity?.name).trim() || safeString((a as any)?.name).trim() || id;
                          if (!id) return null;
                          return (
                            <option key={id} value={id}>
                              {name}（{id}）
                            </option>
                          );
                        })}
                      </select>
                    </label>

                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>channel</div>
                      <select
                        className="oc-inptxt"
                        style={{ minWidth: 180 }}
                        value={bindingDraftChannel}
                        disabled={saving || loading}
                        onChange={(e) => setBindingDraftChannel((e.target as HTMLSelectElement).value)}
                      >
                        <option value="">请选择渠道…</option>
                        {providers.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>match 类型</div>
                      <select
                        className="oc-inptxt"
                        style={{ minWidth: 200 }}
                        value={bindingDraftKind}
                        disabled={saving || loading || Boolean(bindingDraftJson.trim())}
                        onChange={(e) => setBindingDraftKind((e.target as HTMLSelectElement).value as any)}
                      >
                        <option value="accountId">按 accountId（默认账号级）</option>
                        <option value="peerDm">按 peer(dm)（精确对端）</option>
                      </select>
                    </label>
                  </div>

                  {!bindingDraftJson.trim() ? (
                    <div style={{ marginTop: 10 }}>
                      {bindingDraftKind === "accountId" ? (
                        bindingChannelAccounts.length ? (
                          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                              accountId（来自 channels.{bindingDraftChannel}.accounts）
                            </div>
                            <select
                              className="oc-inptxt"
                              value={bindingDraftAccountId}
                              disabled={saving || loading}
                              onChange={(e) => setBindingDraftAccountId((e.target as HTMLSelectElement).value)}
                            >
                              <option value="">请选择账号…</option>
                              {bindingChannelAccounts.map((id) => (
                                <option key={id} value={id}>
                                  {id}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>accountId</div>
                            <input
                              className="oc-inptxt"
                              value={bindingDraftAccountId}
                              disabled={saving || loading}
                              placeholder="例如：main"
                              onChange={(e) => setBindingDraftAccountId((e.target as HTMLInputElement).value)}
                            />
                          </label>
                        )
                      ) : (
                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>peerId</div>
                          <input
                            className="oc-inptxt"
                            value={bindingDraftPeerId}
                            disabled={saving || loading}
                            placeholder="例如：用户ID/会话ID（以官方定义为准）"
                            onChange={(e) => setBindingDraftPeerId((e.target as HTMLInputElement).value)}
                          />
                        </label>
                      )}
                    </div>
                  ) : null}

                  <details style={{ marginTop: 10 }}>
                    <summary className="oc-rsub" style={{ cursor: "pointer" }}>高级：直接填写 binding JSON（覆盖上面字段）</summary>
                    <textarea
                      value={bindingDraftJson}
                      disabled={saving || loading}
                      onChange={(e) => setBindingDraftJson((e.target as HTMLTextAreaElement).value)}
                      placeholder='例如：{"agentId":"main","match":{"channel":"feishu","peer":{"kind":"dm","id":"xxx"}}}'
                      style={{
                        width: "100%",
                        minHeight: 120,
                        marginTop: 8,
                        borderRadius: 10,
                        border: "0.5px solid var(--color-border-secondary)",
                        background: "var(--color-background-secondary)",
                        padding: 10,
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        outline: "none",
                        resize: "vertical",
                      }}
                    />
                  </details>

                  <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                    <button type="button" className="oc-bp" disabled={saving || loading} onClick={addBinding}
                      style={{ padding: "7px 18px", fontWeight: 500 }}>
                      + 添加
                    </button>
                  </div>
                </div>

                <div className="oc-card" style={{ padding: "14px 16px", background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 2 }}>现有绑定</div>
                  {bindings.length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 8 }}>暂无 bindings。</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                      {bindings.map((b, idx) => {
                        const match = (b as any)?.match ?? null;
                        const channelKey = normalizeProviderKey(safeString(match?.channel));
                        if (channelKey && channelKey !== normalizeProviderKey(activeProvider)) return null;
                        const agentId = safeString((b as any)?.agentId).trim();
                        const channel = safeString(match?.channel).trim();
                        const accountId = safeString(match?.accountId).trim();
                        const peer = match?.peer;
                        const peerKind = safeString(peer?.kind).trim();
                        const peerId = safeString(peer?.id).trim();
                        const subtitle =
                          accountId
                            ? `match: { channel: ${channel || "?"}, accountId: ${accountId} }`
                            : peerKind || peerId
                              ? `match: { channel: ${channel || "?"}, peer: { kind: ${peerKind || "?"}, id: ${peerId || "?"} } }`
                              : `match: ${JSON.stringify(match ?? {})}`;
                        return (
                          <div key={idx} style={{
                            display: "flex",
                            alignItems: "flex-start",
                            justifyContent: "space-between",
                            padding: "10px 12px",
                            borderRadius: 10,
                            background: "var(--color-background-secondary)",
                            border: "0.5px solid var(--color-border-tertiary)",
                          }}>
                            <div className="oc-rl" style={{ flex: 1, minWidth: 0 }}>
                              <div className="oc-av" style={{ background: "#dbeafe", color: "#2563eb", fontSize: 12, fontWeight: 600, width: 30, height: 30 }}>{idx + 1}</div>
                              <div style={{ minWidth: 0 }}>
                                <div className="oc-rname">{agentId || "（无 agentId）"}</div>
                                <div style={{ fontSize: 11, marginTop: 3, color: "var(--color-text-tertiary)", wordBreak: "break-all" }}>{subtitle}</div>
                                <details style={{ marginTop: 6 }}>
                                  <summary style={{ fontSize: 11, color: "var(--color-text-tertiary)", cursor: "pointer" }}>查看 JSON</summary>
                                  <pre
                                    style={{
                                      marginTop: 8,
                                      fontSize: 10,
                                      maxHeight: 140,
                                      overflow: "auto",
                                      background: "var(--color-background-secondary)",
                                      padding: 8,
                                      borderRadius: 8,
                                    }}
                                  >
                                    {JSON.stringify(b, null, 2)}
                                  </pre>
                                </details>
                              </div>
                            </div>
                            <div className="oc-rr" style={{ flexWrap: "wrap", gap: 6, alignItems: "flex-start" }}>
                              <button type="button" className="oc-bd" disabled={saving || loading} onClick={() => removeBinding(idx)}>
                                删除
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {detailTab === "deviceLogin" && detailHasDeviceLoginTab && detailCatalogEntry ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div className="oc-card" style={{ padding: "14px 16px", background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 6 }}>关联设备 / 登录</div>
                  <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.6, color: "var(--color-text-secondary)" }}>
                    {detailCatalogEntry.deviceLink === "signal_cli_link" ? (
                      <>
                        Signal 链设备通常使用 <code style={{ background: "var(--color-background-tertiary)", padding: "1px 5px", borderRadius: 4, fontSize: 11 }}>signal-cli link</code>。若 CLI 在无 TTY 环境下无法输出可解析二维码，请在系统终端执行官方命令；也可尝试下方由 OpenClaw 封装同一登录流。
                      </>
                    ) : (
                      <>主进程将启动 <code style={{ background: "var(--color-background-tertiary)", padding: "1px 5px", borderRadius: 4, fontSize: 11 }}>openclaw channels login</code> 并尝试从 stdout/stderr 提取二维码图像或载荷。</>
                    )}
                  </div>
                  {detailCatalogEntry.channelsLoginCliHint ? (
                    <div className="oc-rsub" style={{ fontSize: 11, marginTop: 6, fontFamily: "var(--font-mono)" }}>
                      {detailCatalogEntry.channelsLoginCliHint}
                    </div>
                  ) : null}
                  <label style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                    <div className="oc-rsub" style={{ fontSize: 11 }}>accountId（可选）</div>
                    <input
                      className="oc-inptxt"
                      value={channelsLoginAccountId}
                      disabled={saving || loading}
                      placeholder="例如 main"
                      onChange={(e) => setChannelsLoginAccountId((e.target as HTMLInputElement).value)}
                    />
                  </label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                    <button
                      type="button"
                      className="oc-bp"
                      disabled={saving || loading || channelsLoginPhase === "running"}
                      onClick={() => void startChannelsLoginForActive()}
                      style={{ padding: "7px 18px", fontWeight: 500 }}
                    >
                      {channelsLoginPhase === "running" ? "等待扫码…" : "开始 channels login"}
                    </button>
                    <button
                      type="button"
                      className="oc-bs"
                      disabled={saving || loading || channelsLoginPhase !== "running"}
                      onClick={() => void cancelChannelsLogin()}
                    >
                      取消
                    </button>
                  </div>
                  {channelsLoginLastErr ? (
                    <div style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      background: "#fef3c7",
                      border: "0.5px solid #fde68a",
                      color: "#92400e",
                      fontSize: 12,
                      marginTop: 10,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      maxHeight: 240,
                      overflow: "auto",
                    }}>
                      {channelsLoginLastErr}
                    </div>
                  ) : null}
                  {channelsLoginQr ? (
                    <div style={{ marginTop: 16, textAlign: "center", padding: "16px 0" }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 10 }}>请使用官方 App 扫描</div>
                      <img src={channelsLoginQr} alt="登录二维码" style={{ maxWidth: 260, height: "auto", borderRadius: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }} />
                    </div>
                  ) : channelsLoginPhase === "running" ? (
                    <div style={{ marginTop: 14, padding: "14px 16px", borderRadius: 10, background: "var(--color-background-tertiary)" }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>正在解析 CLI 输出中的二维码…</div>
                      <div style={{ fontSize: 11, marginTop: 6, color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>
                        部分渠道（如微信插件）在终端打印 ASCII 码并把可扫码链接写在日志里；应用会从输出中提取 https 链接并生成图。若久无图像，请用上方命令在系统终端查看原输出。
                      </div>
                    </div>
                  ) : null}
                  {channelsLoginPhase === "done" ? (
                    <div style={{ padding: "8px 12px", borderRadius: 8, background: "#f0fdf4", border: "0.5px solid #bbf7d0", color: "#166534", fontSize: 12, marginTop: 10 }}>CLI 正常退出，已尝试刷新状态。</div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {detailTab === "dmPairing" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {dmPairingChannelKey == null ? (
                  <div className="oc-card" style={{ padding: "14px 16px", background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 12 }}>
                    <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                      当前渠道（如 WebChat）不适用 <code style={{ background: "var(--color-background-tertiary)", padding: "1px 5px", borderRadius: 4 }}>openclaw pairing</code> 私信配对模型。详见官方文档「配对」与渠道子文档。
                    </div>
                  </div>
                ) : (
                  <div className="oc-card" style={{ padding: "14px 16px", background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 2 }}>私信配对</div>
                        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                          CLI：<code style={{ background: "var(--color-background-tertiary)", padding: "1px 5px", borderRadius: 4 }}>openclaw pairing list/approve {dmPairingChannelKey}</code>
                          {providerDmPolicy === "pairing" ? (
                            <> · <span style={{ color: "#166534" }}>当前已启用</span> </>
                          ) : (
                            <> · <span style={{ color: "#b45309" }}>当前未启用</span> </>
                          )}
                          <code> dmPolicy: pairing</code>
                          {detailCatalogEntry?.pairing.notes ? <> · {detailCatalogEntry.pairing.notes}</> : null}
                        </div>
                      </div>
                      <button type="button" className="oc-bs" disabled={dmPairingLoading || saving || loading} onClick={() => void loadDmPairings()}>
                        {dmPairingLoading ? "刷新中…" : "刷新"}
                      </button>
                    </div>

                    {providerPairingAccounts.length ? (
                      <label style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                        <div className="oc-rsub" style={{ fontSize: 11 }}>accountId（可选）</div>
                        <select
                          className="oc-inptxt"
                          disabled={dmPairingLoading || saving || loading}
                          value={dmPairingAccountId}
                          onChange={(e) => setDmPairingAccountId((e.target as HTMLSelectElement).value)}
                        >
                          <option value="">默认账号（不传 --account）</option>
                          {providerPairingAccounts.map((id) => (
                            <option key={id} value={id}>
                              {id}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    {dmPairingErr ? (
                      <div style={{ padding: "7px 10px", borderRadius: 8, background: "#fef3c7", border: "0.5px solid #fde68a", color: "#92400e", fontSize: 12, marginTop: 8 }}>
                        {dmPairingErr}
                      </div>
                    ) : null}

                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 6 }}>待批准请求</div>
                      {dmPairingRequests.length === 0 ? (
                        <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>暂无待批准配对码。</div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {dmPairingRequests.map((it, idx) => {
                            const code = resolveDmPairCode(it);
                            const busy = code && dmPairingBusyCode === code;
                            return (
                              <div key={`${code || "req"}-${idx}`} style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "8px 12px",
                                borderRadius: 10,
                                background: "var(--color-background-secondary)",
                                border: "0.5px solid var(--color-border-tertiary)",
                              }}>
                                <div className="oc-rl">
                                  <div className="oc-av" style={{ background: "#f5f3ff", color: "#7c3aed", fontSize: 14, width: 30, height: 30 }}>🔐</div>
                                  <div>
                                    <div style={{ fontWeight: 600, fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--color-text-primary)" }}>{code || "未知配对码"}</div>
                                    <div style={{ fontSize: 10, marginTop: 2, color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)" }}>{JSON.stringify(it)}</div>
                                  </div>
                                </div>
                                <div className="oc-rr">
                                  <button type="button" className="oc-bp" disabled={!code || Boolean(busy) || saving || loading} onClick={() => void approveDmPairing(code)}
                                    style={{ padding: "5px 14px", fontSize: 12 }}>
                                    {busy ? "处理中…" : "批准"}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center", paddingTop: 12, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                      <input
                        className="oc-inptxt"
                        style={{
                          minWidth: 220,
                          padding: "7px 12px",
                          borderRadius: 8,
                          border: "0.5px solid var(--color-border-secondary)",
                          background: "var(--color-background-secondary)",
                          fontSize: 13,
                          color: "var(--color-text-primary)",
                          fontFamily: "var(--font-mono)",
                          outline: "none",
                        }}
                        value={dmPairingManualCode}
                        disabled={dmPairingLoading || saving || loading}
                        placeholder="手动输入配对码（如 ABCD1234）"
                        onChange={(e) => setDmPairingManualCode((e.target as HTMLInputElement).value.toUpperCase())}
                      />
                      <button
                        type="button"
                        className="oc-bp"
                        disabled={dmPairingLoading || saving || loading || !dmPairingManualCode.trim()}
                        onClick={() => void approveDmPairing(dmPairingManualCode)}
                        style={{ padding: "7px 18px", fontWeight: 500 }}
                      >
                        手动批准
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
});

/*
 * NODE_PAIRING_LEGACY（已从此组件移除，仅作说明）
 *
 * 节点配对对应网关 RPC：node.pair.list / node.pair.approve / node.pair.reject。
 * 用于审批接入 Gateway 的节点设备，与 channels.* 渠道配置、账号无直接关系。
 *
 * 若需恢复 UI：在 git 历史中检索本文件内的 loadNodePairings、actNodePairing、resolveNodePairRequestId、
 * nodePairing* 状态、详情弹窗「节点配对」Tab、已配置频道行的「节点」按钮、以及旧版布局中的节点配对卡片。
 */
