import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef, type ReactNode } from "react";
import { useAppStore, type AppPage, type AppTheme } from "@/store/app-store";
import { useChatStore, formatChatMessageForDisplay, resolveMessageRole } from "@/store/chat-store";
import { useGatewayChat } from "@/hooks/use-gateway-chat";
import { buildChatModelOptions, normalizeChatModelOverrideValue } from "@/chat/model-option";
import { buildSessionPickOptions } from "@/chat/session-display";
import { EditAgentPage } from "@/agents/edit-agent-page";
import { ChannelsPage, type ChannelsPageHandle } from "@/channels/channels-page";
import { CronPage, type CronPageHandle } from "@/cron/cron-page";
import { ModelsPage, type ModelsPageHandle } from "@/models/models-page";
import { InstalledSkillsPage } from "@/skills/installed-skills-page";
import { MarketSkillsPage } from "@/skills/market-skills-page";
import { tImpl, translateLiteral, type TranslationKey, type SupportedLocale } from "@/i18n/messages";
import { LOCALE_LABELS } from "@/i18n/messages";
import {
  MessageSquare,
  LayoutGrid,
  Plus,
  Users,
  Radio,
  Clock,
  Brain,
  Star,
  ShoppingBag,
  Settings2,
  ChevronRight,
  Search,
} from "lucide-react";

const ICON_SIZE = 14;

function IconChevron() {
  return <ChevronRight size={11} strokeWidth={2} />;
}

function NavIconChat() {
  return <MessageSquare size={ICON_SIZE} strokeWidth={1.8} />;
}

function NavIconGrid() {
  return <LayoutGrid size={ICON_SIZE} strokeWidth={1.8} />;
}

function NavIconOps() {
  return <Plus size={ICON_SIZE} strokeWidth={1.8} />;
}

function NavIconUser() {
  return <Users size={ICON_SIZE} strokeWidth={1.8} />;
}

function NavIconChannel() {
  return <Radio size={ICON_SIZE} strokeWidth={1.8} />;
}

function NavIconClock() {
  return <Clock size={ICON_SIZE} strokeWidth={1.8} />;
}

function NavIconModel() {
  return <Brain size={ICON_SIZE} strokeWidth={1.8} />;
}

function NavIconStar() {
  return <Star size={ICON_SIZE} strokeWidth={1.8} />;
}

function NavIconMarket() {
  return <ShoppingBag size={ICON_SIZE} strokeWidth={1.8} />;
}

function NavIconSettings() {
  return <Settings2 size={ICON_SIZE} strokeWidth={1.8} />;
}

function IconSidebarToggle({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ transition: "transform .2s" }}>
      <rect x="1.5" y="2" width="13" height="12" rx="2" />
      <line x1="5.5" y1="2" x2="5.5" y2="14" />
      {collapsed
        ? <path d="M8.5 6.5L11 8l-2.5 1.5" strokeLinejoin="round" />
        : <path d="M11 6.5L8.5 8 11 9.5" strokeLinejoin="round" />
      }
    </svg>
  );
}

function IconSearch() {
  return <Search size={14} strokeWidth={1.8} />;
}

function formatLastAction(at: string | undefined, message: string | undefined, locale: SupportedLocale) {
  if (!message) return translateLiteral("暂无", locale);
  try {
    return `${message} · ${new Date(at ?? "").toLocaleString()}`;
  } catch {
    return message;
  }
}

function gatewayLoadingKey(phase: "start" | "restart" | "stop" | null): TranslationKey {
  if (phase === "start") return "overview.starting";
  if (phase === "restart") return "overview.restarting";
  if (phase === "stop") return "overview.stopping";
  return "common.processing";
}

function resolveMessageTimestampMs(message: unknown): number | null {
  if (!message || typeof message !== "object") return null;
  const row = message as Record<string, unknown>;
  const candidates = [row.timestamp, row.createdAt, row.ts, row.time];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value < 1_000_000_000_000 ? value * 1000 : value;
    }
    if (typeof value === "string" && value.trim()) {
      const asNum = Number(value);
      if (Number.isFinite(asNum) && asNum > 0) {
        return asNum < 1_000_000_000_000 ? asNum * 1000 : asNum;
      }
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function formatMessageTimeLabel(message: unknown, locale: SupportedLocale): string {
  const ms = resolveMessageTimestampMs(message);
  if (ms == null) return "";
  const localeTag =
    locale === "zh-CN" ? "zh-CN" :
    locale === "zh-TW" ? "zh-TW" :
    locale === "es" ? "es-ES" :
    locale === "de" ? "de-DE" :
    locale === "ja" ? "ja-JP" :
    "en-US";
  return new Date(ms).toLocaleTimeString(localeTag, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function GatewayControlButtons(props: {
  pending: boolean;
  phase: "start" | "restart" | "stop" | null;
  t: (key: TranslationKey, args?: string[]) => string;
  showStart?: boolean;
  onStart?: () => void;
  onRestart: () => void;
  onStop: () => void;
}) {
  const { pending, phase, t, showStart, onStart, onRestart, onStop } = props;
  return (
    <div className="oc-gateway-control-row">
      {pending ? (
        <div className="oc-gateway-loading" role="status" aria-live="polite">
          <span className="oc-spinner" aria-hidden />
          <span className="oc-gateway-loading-text">{t(gatewayLoadingKey(phase))}</span>
        </div>
      ) : null}
      <div className="oc-gateway-btns">
        {showStart ? (
          <button type="button" className="oc-bs" disabled={pending} onClick={onStart}>
            {t("common.start")}
          </button>
        ) : null}
        <button type="button" className="oc-bs" disabled={pending} onClick={onRestart}>
          {t("common.restart")}
        </button>
        <button type="button" className="oc-bd" disabled={pending} onClick={onStop}>
          {t("common.stop")}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const page = useAppStore((s) => s.page);
  const setPage = useAppStore((s) => s.setPage);
  const status = useAppStore((s) => s.status);
  const refreshStatus = useAppStore((s) => s.refreshStatus);
  const controlGateway = useAppStore((s) => s.controlGateway);
  const checkUpdates = useAppStore((s) => s.checkUpdates);
  const updateOpenClaw = useAppStore((s) => s.updateOpenClaw);
  const installOpenClaw = useAppStore((s) => s.installOpenClaw);
  const setupOpenClaw = useAppStore((s) => s.setupOpenClaw);
  const uninstallOpenClaw = useAppStore((s) => s.uninstallOpenClaw);
  const hasElectronApi = useAppStore((s) => s.hasElectronApi);
  const gatewayActionPending = useAppStore((s) => s.gatewayActionPending);
  const gatewayActionPhase = useAppStore((s) => s.gatewayActionPhase);
  const gatewayCall = useAppStore((s) => s.gatewayCall);
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  const [envTask, setEnvTask] = useState<
    | { phase: "idle" }
    | { phase: "installing" }
    | { phase: "settingUp" }
    | { phase: "done" }
    | { phase: "installFailed"; message?: string }
    | { phase: "setupFailed"; message?: string }
  >({ phase: "idle" });
  const [envBootstrapping, setEnvBootstrapping] = useState(true);

  const t = useCallback(
    (key: TranslationKey, args?: string[]) => tImpl(key, locale, args),
    [locale],
  );
  const openExternal = useCallback(async (url: string) => {
    try {
      if (window.api?.openExternal) {
        const res = await window.api.openExternal(url);
        if (!res?.ok && res?.error) window.alert(t("env.openFailed", [res.error]));
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      window.alert(t("env.openFailed", [String((e as Error)?.message ?? e)]));
    }
  }, [t]);
  const copyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      window.alert(t("env.commandCopied"));
    } catch {
      window.prompt(t("env.copyCommandPrompt"), text);
    }
  }, [t]);

  const envTaskPending = envTask.phase === "installing" || envTask.phase === "settingUp";
  const envTaskStatusText =
    envTask.phase === "installing" ? t("env.installing") :
    envTask.phase === "settingUp" ? t("env.settingUp") :
    envTask.phase === "done" ? t("env.setupDone") :
    envTask.phase === "installFailed" ? (envTask.message || t("env.installFailed")) :
    envTask.phase === "setupFailed" ? (envTask.message || t("env.setupFailed")) :
    "";

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      root.setAttribute("data-theme", resolved);
    };
    applyTheme();
    if (theme !== "system") return;
    const onChange = () => applyTheme();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, [theme]);

  useEffect(() => {
    const root = appRootRef.current;
    if (!root) return;

    const textBase = new WeakMap<Text, string>();
    const attrBase = new WeakMap<Element, Record<string, string>>();
    const attrKeys = ["placeholder", "title", "aria-label"] as const;

    const shouldSkip = (el: Element | null): boolean => {
      let cur: Element | null = el;
      while (cur) {
        const tag = cur.tagName.toLowerCase();
        if (tag === "code" || tag === "pre" || tag === "textarea" || tag === "script" || tag === "style") return true;
        if (cur.hasAttribute("data-no-i18n")) return true;
        cur = cur.parentElement;
      }
      return false;
    };

    const patchText = (n: Text) => {
      const p = n.parentElement;
      if (!p || shouldSkip(p)) return;
      if (!textBase.has(n)) textBase.set(n, n.nodeValue ?? "");
      const base = textBase.get(n) ?? "";
      const next = translateLiteral(base, locale);
      if (n.nodeValue !== next) n.nodeValue = next;
    };

    const patchAttrs = (el: Element) => {
      if (shouldSkip(el)) return;
      if (!attrBase.has(el)) {
        const init: Record<string, string> = {};
        for (const key of attrKeys) {
          const v = (el as HTMLElement).getAttribute?.(key);
          if (v != null) init[key] = v;
        }
        attrBase.set(el, init);
      }
      const base = attrBase.get(el) ?? {};
      for (const key of attrKeys) {
        if (!(key in base)) continue;
        const next = translateLiteral(base[key], locale);
        if ((el as HTMLElement).getAttribute?.(key) !== next) (el as HTMLElement).setAttribute?.(key, next);
      }
    };

    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) return patchText(node as Text);
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as Element;
      patchAttrs(el);
      for (const c of Array.from(el.childNodes)) walk(c);
    };

    walk(root);

    const obs = new MutationObserver((records) => {
      for (const rec of records) {
        if (rec.type === "characterData") {
          patchText(rec.target as Text);
          continue;
        }
        if (rec.type === "attributes" && rec.target.nodeType === Node.ELEMENT_NODE) {
          patchAttrs(rec.target as Element);
        }
        for (const n of Array.from(rec.addedNodes)) walk(n);
      }
    });
    obs.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder", "title", "aria-label"],
    });
    return () => obs.disconnect();
  }, [locale]);

  useEffect(() => {
    const nativeAlert = window.alert.bind(window);
    const nativeConfirm = window.confirm.bind(window);
    const nativePrompt = window.prompt.bind(window);

    window.alert = ((message?: unknown) => {
      const value = typeof message === "string" ? translateLiteral(message, locale) : message;
      nativeAlert(value as string);
    }) as typeof window.alert;

    window.confirm = ((message?: string) => {
      const value = typeof message === "string" ? translateLiteral(message, locale) : message;
      return nativeConfirm(value);
    }) as typeof window.confirm;

    window.prompt = ((message?: string, defaultValue?: string) => {
      const value = typeof message === "string" ? translateLiteral(message, locale) : message;
      return nativePrompt(value, defaultValue);
    }) as typeof window.prompt;

    return () => {
      window.alert = nativeAlert;
      window.confirm = nativeConfirm;
      window.prompt = nativePrompt;
    };
  }, [locale]);

  const gatewayConnected = useChatStore((s) => s.gatewayConnected);
  const gatewayClient = useChatStore((s) => s.gatewayClient);
  const chatSending = useChatStore((s) => s.chatSending);
  const sendViaGateway = useChatStore((s) => s.sendViaGateway);
  const chatMessages = useChatStore((s) => s.chatMessages);
  const chatStream = useChatStore((s) => s.chatStream);
  const patchSessionModel = useChatStore((s) => s.patchSessionModel);
  const modelCatalog = useChatStore((s) => s.modelCatalog);
  const sessionKey = useChatStore((s) => s.sessionKey);
  const setSessionKey = useChatStore((s) => s.setSessionKey);
  const chatModelOverrides = useChatStore((s) => s.chatModelOverrides);
  const chatLastError = useChatStore((s) => s.lastError);
  const chatLoading = useChatStore((s) => s.chatLoading);
  const sessionsResult = useChatStore((s) => s.sessionsResult);
  const sessionsLoading = useChatStore((s) => s.sessionsLoading);
  const sessionsLoadError = useChatStore((s) => s.sessionsError);
  const refreshSessionsList = useChatStore((s) => s.refreshSessionsList);
  const loadHistoryFromGateway = useChatStore((s) => s.loadHistoryFromGateway);

  const [chatInput, setChatInput] = useState("");
  const [fallbackChatSending, setFallbackChatSending] = useState(false);
  const appRootRef = useRef<HTMLDivElement>(null);
  const chatScrollAreaRef = useRef<HTMLDivElement>(null);
  const cronRef = useRef<CronPageHandle>(null);
  const channelsRef = useRef<ChannelsPageHandle>(null);
  const modelsRef = useRef<ModelsPageHandle>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("oc-sidebar-collapsed") === "1"; } catch { return false; }
  });
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem("oc-sidebar-collapsed", next ? "1" : "0"); } catch { /* */ }
      return next;
    });
  }, []);

  const [editAgentId, setEditAgentId] = useState<string | null>(null);

  const [agentsRpc, setAgentsRpc] = useState<unknown[]>([]);
  const [agentsRpcLoading, setAgentsRpcLoading] = useState(false);
  const [agentsRpcErr, setAgentsRpcErr] = useState<string | null>(null);
  const [defaultAgentId, setDefaultAgentId] = useState<string | null>(null);

  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [addAgentName, setAddAgentName] = useState("");
  const [addAgentWorkspace, setAddAgentWorkspace] = useState("");
  const [addAgentCopyAuth, setAddAgentCopyAuth] = useState(false);
  const [addAgentLoading, setAddAgentLoading] = useState(false);
  const [addAgentErr, setAddAgentErr] = useState<string | null>(null);

  const [deleteAgentTarget, setDeleteAgentTarget] = useState<{ id: string; title: string } | null>(null);
  const [deleteAgentLoading, setDeleteAgentLoading] = useState(false);
  const [deleteAgentErr, setDeleteAgentErr] = useState<string | null>(null);

  const loadAgentsRpc = useCallback(async () => {
    setAgentsRpcLoading(true);
    setAgentsRpcErr(null);
    try {
      if (!hasElectronApi) return;
      if (!gatewayClient || !gatewayConnected) {
        setAgentsRpcErr(t("errors.gatewayWsNotConnectedAgents"));
        setAgentsRpc([]);
        return;
      }
      const res = await gatewayClient.request<{ agents?: unknown[]; defaultId?: string; mainKey?: string }>("agents.list", {});
      setAgentsRpc(Array.isArray(res?.agents) ? res.agents : []);
      setDefaultAgentId(String(res?.defaultId ?? res?.mainKey ?? "").trim() || null);
    } catch (e) {
      setAgentsRpcErr(String((e as Error)?.message ?? e));
      setAgentsRpc([]);
    } finally {
      setAgentsRpcLoading(false);
    }
  }, [gatewayClient, gatewayConnected, hasElectronApi, t]);

  const handleAddAgent = useCallback(async () => {
    const name = addAgentName.trim();
    if (!name) { setAddAgentErr(t("errors.agentNameRequired")); return; }
    setAddAgentLoading(true);
    setAddAgentErr(null);
    try {
      const api = (window as unknown as { api?: { addAgent?: (p: { name: string; workspace?: string; copyAuth?: boolean }) => Promise<{ ok: boolean; error?: string; result?: unknown }> } }).api;
      if (!api?.addAgent) { setAddAgentErr(t("errors.addAgentUnsupported")); return; }
      const ws = addAgentWorkspace.trim() || undefined;
      const res = await api.addAgent({ name, workspace: ws, copyAuth: addAgentCopyAuth });
      if (!res.ok) { setAddAgentErr(res.error ?? t("errors.addAgentFailed")); return; }
      setAddAgentOpen(false);
      setAddAgentName("");
      setAddAgentWorkspace("");
      setAddAgentCopyAuth(false);
      const newEntry = (res.result && typeof res.result === "object" ? res.result : { id: name, name }) as Record<string, unknown>;
      setAgentsRpc((prev) => [...prev, newEntry]);
      setTimeout(() => { void loadAgentsRpc(); }, 1200);
    } catch (e) {
      setAddAgentErr(String((e as Error)?.message ?? e));
    } finally {
      setAddAgentLoading(false);
    }
  }, [addAgentName, addAgentWorkspace, addAgentCopyAuth, loadAgentsRpc, t]);

  const handleDeleteAgent = useCallback(async () => {
    if (!deleteAgentTarget) return;
    setDeleteAgentLoading(true);
    setDeleteAgentErr(null);
    try {
      const api = (window as unknown as { api?: { deleteAgent?: (p: { id: string }) => Promise<{ ok: boolean; error?: string }> } }).api;
      if (!api?.deleteAgent) { setDeleteAgentErr(t("errors.deleteAgentUnsupported")); return; }
      const res = await api.deleteAgent({ id: deleteAgentTarget.id });
      if (!res.ok) { setDeleteAgentErr(res.error ?? t("errors.deleteAgentFailed")); return; }
      // 乐观删除：立即从本地列表移除，无需等待网关刷新
      const deletedId = deleteAgentTarget.id;
      setAgentsRpc((prev) => prev.filter((r) => {
        const row = r as { id?: string };
        return String(row.id ?? "") !== deletedId;
      }));
      setDeleteAgentTarget(null);
      // 延迟后再刷一次，确保网关已重载配置
      setTimeout(() => { void loadAgentsRpc(); }, 1200);
    } catch (e) {
      setDeleteAgentErr(String((e as Error)?.message ?? e));
    } finally {
      setDeleteAgentLoading(false);
    }
  }, [deleteAgentTarget, loadAgentsRpc, t]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await refreshStatus(true);
      } finally {
        // if (alive) setEnvBootstrapping(false);
      }
    })();
    return () => { alive = false; };
  }, [refreshStatus]);

  useEffect(() => {
    if (!hasElectronApi || page !== "chat") return;
    void refreshSessionsList();
    void loadHistoryFromGateway();
  }, [hasElectronApi, page, refreshSessionsList, loadHistoryFromGateway]);

  useEffect(() => {
    if (!hasElectronApi || page !== "agents" || !gatewayConnected) return;
    void loadAgentsRpc();
  }, [hasElectronApi, page, gatewayConnected, loadAgentsRpc]);

  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text) return;
    if (gatewayConnected && chatSending) return;
    if (!gatewayConnected && fallbackChatSending) return;

    if (gatewayConnected) {
      setChatInput("");
      await sendViaGateway(text);
      return;
    }

    if (!window.api?.chat) {
      window.alert(t("errors.notElectronOrDisconnected"));
      return;
    }
    setChatInput("");
    setFallbackChatSending(true);
    const now = Date.now();
    try {
      useChatStore.setState((s) => ({
        chatMessages: [
          ...s.chatMessages,
          { role: "user", content: [{ type: "text", text }], timestamp: now },
        ],
      }));
      const res = await window.api.chat({
        message: text,
        sessionKey: sessionKey.trim() || undefined,
      });
      useChatStore.setState((s) => ({
        chatMessages: [
          ...s.chatMessages,
          {
            role: "assistant",
            content: [{ type: "text", text: String(res?.reply ?? "") }],
            timestamp: Date.now(),
          },
        ],
      }));
    } catch (e) {
      useChatStore.setState((s) => ({
        chatMessages: [
          ...s.chatMessages,
          {
            role: "assistant",
            content: [{ type: "text", text: t("errors.sendFailed", [String((e as Error)?.message ?? e)]) }],
            timestamp: Date.now(),
          },
        ],
      }));
    } finally {
      setFallbackChatSending(false);
    }
  }, [chatInput, gatewayConnected, chatSending, fallbackChatSending, sendViaGateway, sessionKey, t]);

  const running = status?.gateway.running ?? gatewayConnected;
  const port = status?.gateway.port ?? 18789;

  useGatewayChat({
    hasElectronApi,
    // WebSocket 维护 running/uptimeText/port；因此不要依赖轮询结果来决定是否连接。
    gatewayRunning: hasElectronApi,
    gatewayPort: port,
  });

  useLayoutEffect(() => {
    if (page !== "chat") return;
    const el = chatScrollAreaRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [page, sessionKey, chatMessages, chatStream, chatLoading]);

  const sessionPickOptions = useMemo(
    () => buildSessionPickOptions(sessionsResult, sessionKey, true),
    [sessionsResult, sessionKey],
  );

  const modelOptions = useMemo(
    () => buildChatModelOptions(modelCatalog, sessionsResult, sessionKey, chatModelOverrides[sessionKey]),
    [modelCatalog, sessionsResult, sessionKey, chatModelOverrides],
  );

  const sessionRow = sessionsResult?.sessions.find((r) => r.key === sessionKey);
  const hasExplicitModelOverride = Object.prototype.hasOwnProperty.call(chatModelOverrides, sessionKey);
  const effectiveModelRaw = hasExplicitModelOverride
    ? (chatModelOverrides[sessionKey] ?? "")
    : (sessionRow?.model ?? sessionsResult?.defaults?.model ?? "");

  const currentModelPick = normalizeChatModelOverrideValue(
    modelCatalog,
    effectiveModelRaw,
    sessionsResult?.defaults ?? null,
  );

  const sendingUi = gatewayConnected ? chatSending : fallbackChatSending;
  const version = status?.versions.openclaw ?? "—";
  const env = status?.env;
  const nodeNotInstalled = Boolean(hasElectronApi && env && !env.nodeInstalled);
  const nodeVersionIssue = Boolean(hasElectronApi && env && env.nodeInstalled && !env.nodeCompatible);
  const nodeMissing = nodeNotInstalled || nodeVersionIssue;
  // const openclawMissing = Boolean(env && !nodeMissing && !env.openclawInstalled);
  const openclawMissing = Boolean(hasElectronApi && env && !nodeMissing && !env.openclawInstalled);
  const subLineOps = running
    ? `${t("app.portPrefix")} ${port} · ${t("app.running")} ${status?.gateway.uptimeText ?? ""}`
    : `${t("app.portPrefix")} ${port} · ${status?.gateway.uptimeText ?? t("app.notRunning")}`;

  const NavBtn = ({ id, icon, label }: { id: AppPage; icon: ReactNode; label: string }) => (
    <button type="button" className={`oc-ni ${page === id ? "on" : ""}`} onClick={() => setPage(id)} title={sidebarCollapsed ? label : undefined}>
      {icon}
      {!sidebarCollapsed && <span className="oc-ni-label">{label}</span>}
    </button>
  );

  return (
    <div className="oc-app" ref={appRootRef}>
      <aside className={`oc-sidebar ${sidebarCollapsed ? "oc-sidebar-collapsed" : ""}`}>
        <div className="oc-logo">
          <div className="oc-logo-left">
            <div className="oc-logo-icon">🦀</div>
            {!sidebarCollapsed && (
              <div>
                <div className="oc-logo-name">OpenClaw</div>
                <div className="oc-logo-sub">{t("app.manager")}</div>
              </div>
            )}
          </div>
          <button type="button" className="oc-sidebar-toggle" onClick={toggleSidebar} title={sidebarCollapsed ? t("sidebar.expand") : t("sidebar.collapse")}>
            <IconSidebarToggle collapsed={sidebarCollapsed} />
          </button>
        </div>
        <div className="oc-nav-body">
          <div className="oc-nav-group">
            <NavBtn id="chat" icon={<NavIconChat />} label={t("nav.chat")} />
          </div>
          <div className="oc-nav-div" />
          <div className="oc-nav-group">
            {!sidebarCollapsed && <div className="oc-nav-group-label">{t("section.control")}</div>}
            <NavBtn id="overview" icon={<NavIconGrid />} label={t("nav.overview")} />
          </div>
          <div className="oc-nav-div" />
          <div className="oc-nav-group">
            {!sidebarCollapsed && <div className="oc-nav-group-label">{t("section.config")}</div>}
            <NavBtn id="agents" icon={<NavIconUser />} label={t("nav.agents")} />
            <NavBtn id="channels" icon={<NavIconChannel />} label={t("nav.channels")} />
            <NavBtn id="cron" icon={<NavIconClock />} label={t("nav.cron")} />
            <NavBtn id="models" icon={<NavIconModel />} label={t("nav.models")} />
          </div>
          <div className="oc-nav-div" />
          <div className="oc-nav-group">
            {!sidebarCollapsed && <div className="oc-nav-group-label">{t("section.skills")}</div>}
            <NavBtn id="installed" icon={<NavIconStar />} label={t("nav.installed")} />
            <NavBtn id="market" icon={<NavIconMarket />} label={t("nav.market")} />
          </div>
        </div>
        <div className="oc-nav-foot">
          <button type="button" className={`oc-ni ${page === "settings" ? "on" : ""}`} onClick={() => setPage("settings")} title={sidebarCollapsed ? t("nav.settings") : undefined}>
            <NavIconSettings />
            {!sidebarCollapsed && <span className="oc-ni-label">{t("nav.settings")}</span>}
          </button>
          {!sidebarCollapsed && (
            <div className="oc-ver">
              <div className="oc-vdot" />
              {status?.versions.manager ?? "v0.1.0"}
            </div>
          )}
        </div>
      </aside>

      <main className="oc-main">
        {!hasElectronApi && (
          <div
            style={{
              padding: "8px 20px",
              fontSize: 12,
              background: "#FFF8E0",
              color: "#946200",
              borderBottom: "0.5px solid #E5E7EB"
            }}
          >
            {t("warning.noElectronApi")}
          </div>
        )}
        {(nodeMissing || openclawMissing || envTask.phase !== "idle") && (
        // {!envBootstrapping && (nodeMissing || openclawMissing || envTask.phase !== "idle") && (
          <div
            style={{
              padding: "10px 16px",
              background: "#FEF3C7",
              color: "#92400E",
              borderBottom: "1px solid #F59E0B",
              display: "flex",
              gap: 12,
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>
              <div style={{ fontWeight: 700 }}>
                {nodeNotInstalled
                  ? t("env.nodeMissingTitle")
                  : nodeVersionIssue
                    ? t("env.nodeLowTitle")
                    : t("env.openclawMissingTitle")}
              </div>
              <div>
                {envTask.phase !== "idle"
                  ? envTaskStatusText
                  : nodeNotInstalled
                    ? t("env.nodeMissingDesc")
                    : nodeVersionIssue
                      ? t("env.nodeLowDesc")
                      : t("env.openclawMissingDesc")}
                {env?.nodeVersion ? ` ${t("env.nodeDetected", [env.nodeVersion])}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {nodeMissing ? (
                  <button type="button" className="oc-bp" onClick={() => void openExternal("https://nodejs.org/en/download")}>
                    {t("env.nodeInstall")}
                  </button>
                ) : (
                <>
                  {envTask.phase !== "idle" ? (
                    <div className="oc-gateway-loading" role="status" aria-live="polite">
                      {envTaskPending ? <span className="oc-spinner" aria-hidden /> : null}
                      <span data-no-i18n className="oc-gateway-loading-text">{envTaskStatusText}</span>
                    </div>
                  ) : null}
                  <button type="button" className="oc-bs" disabled={envTaskPending} onClick={() => void copyText("npm install -g openclaw@latest")}>
                    {t("env.copyCommand")}
                  </button>
                  <button
                    type="button"
                    className="oc-bp"
                    data-no-i18n
                    disabled={envTaskPending}
                    onClick={async () => {
                      if (envTaskPending) return;
                      setEnvTask({ phase: "installing" });
                      try {
                        // 让 React 先把“安装中...”渲染出来，再开始 IPC 安装流程（避免看不到 loading）
                        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
                        const installRes = await installOpenClaw();
                        // console.log('installRes', installRes);
                        if (!installRes.ok) {
                          setEnvTask({ phase: "installFailed", message: installRes.message || t("env.installFailed") });
                          return;
                        }

                        setEnvTask({ phase: "settingUp" });
                        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
                        const setupRes = await setupOpenClaw();
                        if (!setupRes.ok) {
                          setEnvTask({ phase: "setupFailed", message: setupRes.message || t("env.setupFailed") });
                          return;
                        }

                        try {
                          await refreshStatus(true);
                        } catch {
                          // ignore
                        }
                        setEnvTask({ phase: "done" });
                      } finally {
                        // no-op: 状态在上面按成功/失败落位；这里不要覆盖
                      }
                    }}
                  >
                    {t("env.openclawInstall")}
                  </button>
                </>
              )}
              <button type="button" className="oc-bs" disabled={envTaskPending} onClick={() => void refreshStatus(true)}>
                {t("env.recheck")}
              </button>
            </div>
          </div>
        )}

        {page === "chat" && (
          <div className="oc-chat-root">
            {hasElectronApi && !running ? (
              <div
                style={{
                  padding: "8px 20px",
                  fontSize: 12,
                  background: "#FFF4E5",
                  color: "#9a5b00",
                  borderBottom: "0.5px solid #E5E7EB"
                }}
              >
                {t("chat.gatewayNotRunning")}
              </div>
            ) : null}
            {hasElectronApi && running && !gatewayConnected ? (
              <div
                style={{
                  padding: "8px 20px",
                  fontSize: 12,
                  background: "#EFF6FF",
                  color: "#1e40af",
                  borderBottom: "0.5px solid #E5E7EB"
                }}
              >
                {t("chat.connectingWs")}
              </div>
            ) : null}
            {sessionsLoadError ? (
              <div
                style={{
                  padding: "6px 20px",
                  fontSize: 12,
                  background: "#FFF7ED",
                  color: "#9a3412",
                  borderBottom: "0.5px solid #E5E7EB"
                }}
              >
                {t("chat.sessionLoadError", [sessionsLoadError])}
              </div>
            ) : null}
            {chatLastError ? (
              <div
                style={{
                  padding: "6px 20px",
                  fontSize: 12,
                  background: "#FEF2F2",
                  color: "#b91c1c",
                  borderBottom: "0.5px solid #E5E7EB"
                }}
              >
                {chatLastError}
              </div>
            ) : null}
            <div className="oc-topbar">
              <div className="oc-bc">
                OpenClaw <IconChevron /> <b>{t("chat.title")}</b>
                {gatewayConnected ? (
                  <span style={{ marginLeft: 8, fontSize: 11, color: "var(--color-text-secondary)" }}>{t("chat.connectedWs")}</span>
                ) : null}
                {chatLoading ? (
                  <span style={{ marginLeft: 8, fontSize: 11, color: "var(--color-text-secondary)" }}>{t("chat.syncingHistory")}</span>
                ) : null}
              </div>
              <div className="oc-tr" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
                  {t("chat.session")}
                  <select
                    className="oc-inptxt"
                    style={{ minWidth: 180, padding: "4px 8px" }}
                    value={sessionKey}
                    title={sessionKey}
                    disabled={!hasElectronApi || sessionsLoading}
                    onChange={(e) => setSessionKey(e.target.value)}
                  >
                    {sessionPickOptions.length === 0 ? (
                      <option value={sessionKey}>{sessionsLoading ? t("chat.loadingSessions") : sessionKey || t("chat.noSessions")}</option>
                    ) : (
                      sessionPickOptions.map((o) => (
                        <option key={o.key} value={o.key} title={o.title}>
                          {o.label}
                        </option>
                      ))
                    )}
                  </select>
                </label>
                <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
                  {t("chat.model")}
                  <select
                    className="oc-inptxt"
                    style={{ minWidth: 200, padding: "4px 8px" }}
                    value={currentModelPick}
                    disabled={!hasElectronApi || chatSending || chatLoading}
                    onChange={(e) => void patchSessionModel(e.target.value)}
                  >
                    <option value="">
                      {modelCatalog.length === 0 && !running ? t("chat.modelStartGateway") : t("chat.modelDefault")}
                    </option>
                    {currentModelPick &&
                    !modelOptions.some((o) => o.value === currentModelPick) ? (
                      <option value={currentModelPick} key={`orphan-${currentModelPick}`}>
                        {currentModelPick}
                      </option>
                    ) : null}
                    {modelOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                {/* <div className="oc-srch-tb">
                  <IconSearch />
                  搜索历史消息
                </div> */}
              </div>
            </div>
            <div ref={chatScrollAreaRef} className="oc-chat-area" style={{ flex: 1 }}>
              {chatMessages.map((m, i) => {
                const role = resolveMessageRole(m);
                const timeLabel = formatMessageTimeLabel(m, locale);
                const avatarLabel = role === "user" ? t("chat.avatar.user") : role === "assistant" ? t("chat.avatar.assistant") : "?";
                return (
                  <div key={i} className={`oc-chat-msg ${role === "user" ? "user" : "assistant"}`}>
                    <div className="oc-chat-avatar">{avatarLabel}</div>
                    <div className="oc-chat-bubble-wrap">
                      <div className="oc-chat-bubble">
                        <div className="oc-chat-text">{formatChatMessageForDisplay(m)}</div>
                      </div>
                      {timeLabel ? <div className="oc-chat-time">{timeLabel}</div> : null}
                    </div>
                  </div>
                );
              })}
              {chatStream && String(chatStream).trim() ? (
                <div className="oc-chat-msg assistant">
                  <div className="oc-chat-avatar">{t("chat.avatar.assistant")}</div>
                  <div className="oc-chat-bubble">
                    <div className="oc-chat-text">{chatStream}</div>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="oc-inp-area">
              <div className="oc-inpbox">
                <input
                  className="oc-inptxt"
                  placeholder={sendingUi ? t("chat.waitingReply") : t("chat.placeholder")}
                  value={chatInput}
                  disabled={sendingUi}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendChat();
                    }
                  }}
                />
                <button
                  type="button"
                  className="oc-bp"
                  style={{ padding: "6px 12px" }}
                  disabled={sendingUi}
                  onClick={() => void sendChat()}
                >
                  {sendingUi ? t("chat.sending") : t("chat.send")}
                </button>
              </div>
            </div>
          </div>
        )}

        {page === "overview" && (
          <>
            <div className="oc-topbar">
              <div className="oc-bc">
                {t("section.control")} <IconChevron /> <b>{t("overview.title")}</b>
              </div>
            </div>
            <div className="oc-page">
              <div className="oc-card">
                <div className="oc-sbanner">
                  <div className="oc-srun">
                    <div className={running ? "oc-dot-g" : "oc-dot-r"} />
                    <div>
                      <div data-no-i18n className={`oc-srunt ${running ? "ok" : "err"}`}>{running ? t("overview.gatewayRunning") : t("overview.gatewayNotRunning")}</div>
                      <div data-no-i18n className="oc-sruns">{subLineOps}</div>
                    </div>
                  </div>
                  <GatewayControlButtons
                    pending={gatewayActionPending}
                    phase={gatewayActionPhase}
                    t={t}
                    showStart
                    onStart={() => void controlGateway("start")}
                    onRestart={() => void controlGateway("restart")}
                    onStop={() => void controlGateway("stop")}
                  />
                </div>
                <div className="oc-vrow">
                  <div>
                    <div className="oc-vinfo">{t("overview.recentAction")}</div>
                    <div className="oc-vsub">
                      {formatLastAction(status?.gateway.lastAction?.at, status?.gateway.lastAction?.message, locale)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="oc-stat-grid">
                <div className="oc-stc">
                  <div className="oc-stl">{t("overview.agentLabel")}</div>
                  <div className="oc-stv">{status?.stats.agentsConfigured ?? "—"}</div>
                  <div className="oc-sts">{t("overview.agentSuffix")}</div>
                </div>
                <div className="oc-stc">
                  <div className="oc-stl">{t("overview.channelLabel")}</div>
                  <div className="oc-stv">{status?.stats.channelsConnected ?? "—"}</div>
                  <div className="oc-sts">{t("overview.channelConnected")}</div>
                </div>
                <div className="oc-stc">
                  <div className="oc-stl">{t("overview.installedSkills")}</div>
                  <div className="oc-stv">{status?.stats.installedSkills ?? "—"}</div>
                  <div className="oc-sts">{t("overview.countSuffix")}</div>
                </div>
                <div className="oc-stc">
                  <div className="oc-stl">{t("overview.currentModel")}</div>
                  <div className="oc-stv" style={{ fontSize: 14, marginTop: 5 }}>
                    {status?.stats.currentModel?.name ?? "—"}
                  </div>
                  <div className="oc-sts">{status?.stats.currentModel?.id ?? ""}</div>
                </div>
              </div>

              <div className="oc-card">
                <div className="oc-ch">{t("overview.version")}</div>
                <div className="oc-vrow">
                  <div>
                    <div className="oc-vinfo">
                      {t("overview.currentVersion", [version])}
                      {status?.update?.hasUpdate ? <span className="oc-updbadge">{t("overview.hasUpdate")}</span> : null}
                    </div>
                    <div className="oc-vsub">
                      {status?.update?.checkedAt
                        ? status.update.hasUpdate
                          ? t("overview.latestUpgrade", [String(status.update.latestVersion ?? "")])
                          : t("overview.isLatest")
                        : t("overview.checkForUpdatesHint")}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 7 }}>
                    <button type="button" className="oc-bs" onClick={() => void checkUpdates()}>
                      {t("overview.checkUpdates")}
                    </button>
                    {status?.update?.hasUpdate && (
                      <button type="button" className="oc-bp" onClick={() => void updateOpenClaw()}>
                        {t("overview.updateNow")}
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="oc-dz">
                <div className="oc-dzt">{t("overview.dangerZone")}</div>
                <div className="oc-dzd">{t("overview.uninstallDesc")}</div>
                <button type="button" className="oc-bd" onClick={() => void uninstallOpenClaw()}>
                  {t("overview.uninstall")}
                </button>
              </div>
            </div>
          </>
        )}

        {page === "agents" && (
          <>
            <div className="oc-topbar">
              <div className="oc-bc">
                {t("section.config")} <IconChevron /> <b>{t("agents.title")}</b>
              </div>
              <div className="oc-tr">
                <button
                  type="button"
                  className="oc-bs"
                  disabled={agentsRpcLoading || !gatewayConnected}
                  onClick={() => void loadAgentsRpc()}
                >
                  {t("agents.refresh")}
                </button>
                <button type="button" className="oc-bp" onClick={() => { setAddAgentName(""); setAddAgentWorkspace(""); setAddAgentCopyAuth(false); setAddAgentErr(null); setAddAgentOpen(true); }}>
                  {t("agents.add")}
                </button>
              </div>
            </div>
            <div className="oc-page" style={{ padding: 0, gap: 0 }}>
              <div className="oc-card" style={{ borderRadius: 0, border: "none", background: "transparent" }}>
                {!hasElectronApi ? (
                  <div className="oc-rsub" style={{ padding: 12 }}>
                    {t("agents.fetchNote")}
                  </div>
                ) : !gatewayConnected ? (
                  <div className="oc-rsub" style={{ padding: 12 }}>
                    {t("agents.connectingNote")}
                  </div>
                ) : agentsRpcLoading ? (
                  <div className="oc-rsub" style={{ padding: 12 }}>
                    {t("agents.loadingNote")}
                  </div>
                ) : agentsRpcErr ? (
                  <div className="oc-rsub" style={{ padding: 12, color: "#b45309" }}>
                    {agentsRpcErr}
                  </div>
                ) : agentsRpc.length === 0 ? (
                  <div className="oc-rsub" style={{ padding: 12 }}>{t("agents.emptyNote")}</div>
                ) : (
                  agentsRpc.map((raw, idx) => {
                    const row = raw as {
                      id?: string;
                      name?: string;
                      identityName?: string;
                      identityEmoji?: string;
                      identity?: { name?: string; emoji?: string };
                    };
                    const id = String(row.id ?? "").trim() || `agent-${idx}`;
                    const title =
                      (row.identity?.name && String(row.identity.name).trim()) ||
                      (row.identityName && String(row.identityName).trim()) ||
                      (typeof row.name === "string" && row.name.trim()) ||
                      id;
                    const emoji = row.identity?.emoji?.trim() || row.identityEmoji?.trim() || "🤖";
                    const isDefault = defaultAgentId ? id === defaultAgentId : idx === 0;
                    return (
                      <div key={id} className="oc-row">
                        <div className="oc-rl">
                          <div className="oc-av" style={{ background: "#FFE8E8" }}>
                            {emoji}
                          </div>
                          <div>
                            <div className="oc-rname">
                              {title}
                              {isDefault && (
                                <span style={{ marginLeft: 6, fontSize: 11, color: "#888", fontWeight: 400, border: "1px solid #ddd", borderRadius: 4, padding: "1px 5px" }}>
                                  {t("agents.default")}
                                </span>
                              )}
                            </div>
                            <div className="oc-rsub">{t("agents.idLabel", [id])}</div>
                          </div>
                        </div>
                        <div className="oc-rr">
                          <button
                            type="button"
                            className="oc-bs"
                            onClick={() => {
                              setEditAgentId(id);
                              setPage("edit-agent");
                            }}
                          >
                            {t("agents.edit")}
                          </button>
                          {!isDefault && (
                            <button
                              type="button"
                              className="oc-bs"
                              style={{ color: "#b45309" }}
                              onClick={() => { setDeleteAgentErr(null); setDeleteAgentTarget({ id, title }); }}
                            >
                              {t("agents.delete")}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            {deleteAgentTarget && (
              <div
                style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
                onClick={(e) => { if (e.target === e.currentTarget && !deleteAgentLoading) setDeleteAgentTarget(null); }}
              >
                <div className="oc-card" style={{ width: 340, padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{t("agents.deleteTitle")}</div>
                  <div style={{ fontSize: 14, lineHeight: 1.6 }}>
                    {t("agents.deleteConfirm", [deleteAgentTarget.title])}
                  </div>
                  {deleteAgentErr && (
                    <div style={{ fontSize: 13, color: "#b45309", background: "#fef3c7", borderRadius: 6, padding: "6px 10px" }}>
                      {deleteAgentErr}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button type="button" className="oc-bs" disabled={deleteAgentLoading} onClick={() => setDeleteAgentTarget(null)}>
                      {t("agents.cancel")}
                    </button>
                    <button
                      type="button"
                      className="oc-bp"
                      disabled={deleteAgentLoading}
                      style={{ background: "#dc2626", borderColor: "#dc2626" }}
                      onClick={() => void handleDeleteAgent()}
                    >
                      {deleteAgentLoading ? t("agents.deleting") : t("agents.confirmDelete")}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {addAgentOpen && (
              <div
                style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
                onClick={(e) => { if (e.target === e.currentTarget) setAddAgentOpen(false); }}
              >
                <div className="oc-card" style={{ width: 400, padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{t("agents.addTitle")}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <label style={{ fontWeight: 600 }}>{t("agents.nameLabel")}</label>
                    <input
                      className="oc-inptxt"
                      type="text"
                      placeholder={t("agents.namePlaceholder")}
                      value={addAgentName}
                      disabled={addAgentLoading}
                      autoFocus
                      onChange={(e) => setAddAgentName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void handleAddAgent(); }}
                      style={{ width: "100%", boxSizing: "border-box" }}
                    />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <label style={{ fontWeight: 600 }}>{t("agents.workspaceLabel")}</label>
                    <input
                      className="oc-inptxt"
                      type="text"
                      placeholder={t("agents.workspaceDefault", [addAgentName.trim() ? `~/.openclaw/workspace-${addAgentName.trim()}` : "~/.openclaw/workspace-<name>"])}
                      value={addAgentWorkspace}
                      disabled={addAgentLoading}
                      onChange={(e) => setAddAgentWorkspace(e.target.value)}
                      style={{ width: "100%", boxSizing: "border-box" }}
                    />
                    <div style={{ fontSize: 12, color: "var(--oc-sub, #aaa)" }}>{t("agents.workspaceHint")}</div>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: addAgentLoading ? "default" : "pointer" }}>
                    <input
                      type="checkbox"
                      checked={addAgentCopyAuth}
                      disabled={addAgentLoading}
                      onChange={(e) => setAddAgentCopyAuth(e.target.checked)}
                    />
                    {t("agents.copyAuth")}
                  </label>
                  {addAgentErr && (
                    <div style={{ fontSize: 13, color: "#b45309", background: "#fef3c7", borderRadius: 6, padding: "6px 10px" }}>
                      {addAgentErr}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button type="button" className="oc-bs" disabled={addAgentLoading} onClick={() => setAddAgentOpen(false)}>
                      {t("agents.cancel")}
                    </button>
                    <button type="button" className="oc-bp" disabled={addAgentLoading || !addAgentName.trim()} onClick={() => void handleAddAgent()}>
                      {addAgentLoading ? t("agents.creating") : t("agents.create")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {page === "edit-agent" && (
          <>
            <EditAgentPage
              agentId={editAgentId}
              agentsRpc={agentsRpc}
              hasElectronApi={hasElectronApi}
              onBack={() => {
                setEditAgentId(null);
                setPage("agents");
              }}
            />
          </>
        )}

        {page === "channels" && (
          <>
            <div className="oc-topbar">
              <div className="oc-bc">
                {t("section.config")} <IconChevron /> <b>{t("channels.title")}</b>
              </div>
              <div className="oc-tr">
                <button
                  type="button"
                  className="oc-bs"
                  disabled={!gatewayConnected}
                  onClick={() => { channelsRef.current?.refresh(); channelsRef.current?.refreshPlugins(); }}
                >
                  {t("common.refresh")}
                </button>
                <button
                  type="button"
                  className="oc-bp"
                  disabled={channelsRef.current?.saveDisabled ?? true}
                  onClick={() => channelsRef.current?.save()}
                >
                  {t("channels.save")}
                </button>
              </div>
            </div>
            <ChannelsPage ref={channelsRef} hasElectronApi={hasElectronApi} />
          </>
        )}

        {page === "cron" && (
          <>
            <div className="oc-topbar">
              <div className="oc-bc">
                {t("section.config")} <IconChevron /> <b>{t("cron.title")}</b>
              </div>
              <div className="oc-tr">
                <button
                  type="button"
                  className="oc-bs"
                  disabled={!gatewayConnected}
                  onClick={() => cronRef.current?.refresh()}
                >
                  {t("common.refresh")}
                </button>
                <button
                  type="button"
                  className="oc-bp"
                  disabled={!gatewayConnected}
                  onClick={() => cronRef.current?.openCreate()}
                >
                  {t("cron.create")}
                </button>
              </div>
            </div>
            <CronPage
              ref={cronRef}
              hasElectronApi={hasElectronApi}
              gatewayConnected={gatewayConnected}
              gatewayClient={gatewayClient}
              gatewayCall={gatewayCall}
            />
          </>
        )}

        {page === "models" && (
          <div className="oc-models-root">
            <div className="oc-topbar">
              <div className="oc-bc">
                {t("section.config")} <IconChevron /> <b>{t("models.title")}</b>
              </div>
              <div className="oc-tr">
                <button
                  type="button"
                  className="oc-bs"
                  disabled={!gatewayConnected}
                  onClick={() => modelsRef.current?.refresh()}
                >
                  {t("common.refresh")}
                </button>
              </div>
            </div>
            <ModelsPage
              ref={modelsRef}
              locale={locale}
              hasElectronApi={hasElectronApi}
              gatewayConnected={gatewayConnected}
              gatewayClient={gatewayClient}
              gatewayCall={gatewayCall}
            />
          </div>
        )}

        {page === "installed" && (
          <InstalledSkillsPage
            locale={locale}
            hasElectronApi={hasElectronApi}
            gatewayConnected={gatewayConnected}
            gatewayClient={gatewayClient}
            gatewayCall={gatewayCall}
          />
        )}

        {page === "market" && (
          <MarketSkillsPage
            locale={locale}
            hasElectronApi={hasElectronApi}
            gatewayConnected={gatewayConnected}
            gatewayClient={gatewayClient}
            gatewayCall={gatewayCall}
          />
        )}

        {page === "settings" && (
          <>
            <div className="oc-topbar">
              <div className="oc-bc">
                <b>{t("settings.title")}</b>
              </div>
            </div>
            <div className="oc-page">
              <div className="oc-card">
                <div className="oc-ch">{t("settings.appearance")}</div>
                <div className="oc-srow">
                  <div>
                    <div className="oc-slbl">{t("settings.language")}</div>
                    <div className="oc-sdesc">{t("settings.languageDesc")}</div>
                  </div>
                  <select
                    style={{ width: 150, padding: "6px 10px", borderRadius: 8, border: "0.5px solid var(--color-border-secondary)" }}
                    value={locale}
                    onChange={(e) => setLocale(e.target.value as SupportedLocale)}
                  >
                    {(Object.keys(LOCALE_LABELS) as SupportedLocale[]).map((loc) => (
                      <option key={loc} value={loc}>{LOCALE_LABELS[loc]}</option>
                    ))}
                  </select>
                </div>
                <div className="oc-srow">
                  <div>
                    <div className="oc-slbl">{t("settings.theme")}</div>
                    <div className="oc-sdesc">{t("settings.themeDesc")}</div>
                  </div>
                  <select
                    style={{ width: 130, padding: "6px 10px", borderRadius: 8, border: "0.5px solid var(--color-border-secondary)" }}
                    value={theme}
                    onChange={(e) => setTheme(e.target.value as AppTheme)}
                  >
                    <option value="system">{t("settings.themeSystem")}</option>
                    <option value="light">{t("settings.themeLight")}</option>
                    <option value="dark">{t("settings.themeDark")}</option>
                  </select>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
