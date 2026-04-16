import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { GatewayCallResult, ManagerStatus } from "../types/electron-api";
import { translateLiteral, type SupportedLocale } from "../i18n/messages";
import { getSafeLocalStorage } from "../gateway/local-storage";

export type AppPage =
  | "chat"
  | "overview"
  | "agents"
  | "edit-agent"
  | "channels"
  | "cron"
  | "models"
  | "installed"
  | "market"
  | "settings";

export type AppTheme = "system" | "light" | "dark";

type GatewayActionPhase = "start" | "restart" | "stop" | null;

const LOCALE_STORAGE_KEY = "oc-locale";
const THEME_STORAGE_KEY = "oc-theme";
const DEFAULT_LOCALE: SupportedLocale = "zh-CN";
const DEFAULT_THEME: AppTheme = "system";

function getStoredLocale(): SupportedLocale {
  const storage = getSafeLocalStorage();
  try {
    const stored = storage?.getItem(LOCALE_STORAGE_KEY);
    if (stored && ["en", "zh-CN", "zh-TW", "es", "de", "ja"].includes(stored)) {
      return stored as SupportedLocale;
    }
  } catch { /* */ }
  return DEFAULT_LOCALE;
}

function getStoredTheme(): AppTheme {
  const storage = getSafeLocalStorage();
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY);
    if (stored === "system" || stored === "light" || stored === "dark") {
      return stored;
    }
  } catch { /* */ }
  return DEFAULT_THEME;
}

function tr(locale: SupportedLocale, text: string): string {
  return translateLiteral(text, locale);
}

type AppStore = {
  page: AppPage;
  status: ManagerStatus | null;
  hasElectronApi: boolean;
  /** 网关启动/重启/停止进行中（IPC 较慢时用于 UI loading） */
  gatewayActionPending: boolean;
  gatewayActionPhase: GatewayActionPhase;
  /** 当前语言设置 */
  locale: SupportedLocale;
  theme: AppTheme;
  setPage: (page: AppPage) => void;
  setLocale: (locale: SupportedLocale) => void;
  setTheme: (theme: AppTheme) => void;
  refreshStatus: (forceEnv?: boolean) => Promise<void>;
  /**
   * 由 WebSocket 事件维护的网关运行时信息。
   * 为了”彻底对齐”，这三个字段应尽量避免被 IPC 轮询覆盖。
   */
  setGatewayRuntime: (runtime: Partial<ManagerStatus['gateway']>) => void;
  controlGateway: (action: 'start' | 'stop' | 'restart') => Promise<void>;
  checkUpdates: () => Promise<void>;
  updateOpenClaw: () => Promise<void>;
  installOpenClaw: () => Promise<{ ok: boolean; message?: string }>;
  setupOpenClaw: () => Promise<{ ok: boolean; message?: string }>;
  uninstallOpenClaw: () => Promise<void>;
  gatewayCall: (method: string, params?: unknown, timeoutMs?: number) => Promise<GatewayCallResult>;
};

function pickStatus(res: ManagerStatus | undefined): ManagerStatus | null {
  if (!res || typeof res !== "object") return null;
  return res;
}

/** 同步互斥：在 zustand pending 刷到 UI 前拦截连点，确保每次点击最多触发一轮 IPC */
let gatewayControlSyncLock = false;

const DEFAULT_MANAGER_STATUS: ManagerStatus = {
  gateway: {
    running: false,
    uptimeText: "未运行",
    port: 18789,
    lastAction: null,
  },
  versions: {
    openclaw: "—",
    manager: "v0.1.0",
  },
  update: {
    latestVersion: null,
    checkedAt: null,
    hasUpdate: false,
  },
  stats: {
    agentsConfigured: 0,
    channelsConnected: 0,
    installedSkills: 0,
    currentModel: { name: "", id: "" },
  },
  env: {
    nodeInstalled: true,
    nodeVersion: null,
    nodePath: null,
    nodeCompatible: true,
    nodeRecommended: false,
    openclawInstalled: true,
    openclawVersion: null,
    openclawPath: null,
  },
};

export const useAppStore = create<AppStore>((set, get) => ({
  page: "overview",
  status: null,
  hasElectronApi: true,
  gatewayActionPending: false,
  gatewayActionPhase: null,
  locale: getStoredLocale(),
  theme: getStoredTheme(),

  setPage: (page) => set({ page }),

  setLocale: (locale) => {
    const storage = getSafeLocalStorage();
    try {
      storage?.setItem(LOCALE_STORAGE_KEY, locale);
    } catch { /* */ }
    set({ locale });
  },

  setTheme: (theme) => {
    const storage = getSafeLocalStorage();
    try {
      storage?.setItem(THEME_STORAGE_KEY, theme);
    } catch { /* */ }
    set({ theme });
  },

  refreshStatus: async (forceEnv = false) => {
    const api = window.api;
    set({ hasElectronApi: Boolean(api?.getStatus) });
    if (!api?.getStatus) {
      return;
    }
  
    try {
      const data = await api.getStatus({ forceEnv });
      const polled = pickStatus(data);
      if (!polled) return;

      set({ status: polled }); 
    } catch (e) {
      console.error("刷新状态失败:", e);
    }
  },
  // refreshStatus: async (forceEnv = false) => {
  //   const api = window.api;
  //   set({ hasElectronApi: Boolean(api?.getStatus) });
  //   if (!api?.getStatus) {
  //     return;
  //   }
  //   try {
  //     const data = await api.getStatus({ forceEnv });
  //     const polled = pickStatus(data);
  //     if (!polled) return;

  //     const prev = get().status;
  //     if (!prev) {
  //       set({ status: polled });
  //       return;
  //     }

  //     // “彻底对齐”：WebSocket 维护 running/uptimeText/port；IPC 只更新其他字段。
  //     const mergedGateway = {
  //       ...polled.gateway,
  //       running: prev.gateway.running,
  //       uptimeText: prev.gateway.uptimeText,
  //       port: prev.gateway.port,
  //     };
  //     set({ status: { ...polled, gateway: mergedGateway } });
  //   } catch {
  //     // 保留上次状态
  //   }
  // },

  setGatewayRuntime: (runtime) => {
    set((state) => {
      const base = state.status ?? DEFAULT_MANAGER_STATUS;
      return {
        status: {
          ...base,
          gateway: {
            ...base.gateway,
            ...runtime,
          },
        },
      };
    });
  },

  controlGateway: async (action) => {
    const api = window.api;
    if (!api?.controlGateway) {
      window.alert(tr(get().locale, "网关控制仅在 Electron 中可用。请运行：pnpm run renderer:dev 与 pnpm run dev:electron-react。"));
      return;
    }
    if (gatewayControlSyncLock || get().gatewayActionPending) return;
    gatewayControlSyncLock = true;
    try {
      if (action === "stop" || action === "restart") {
        const ok = window.confirm(tr(get().locale, action === "stop" ? "确定要停止网关吗？" : "确定要重启网关吗？"));
        if (!ok) return;
      }
      set({ gatewayActionPending: true, gatewayActionPhase: action });
      try {
        const res = await api.controlGateway(action);
        if (res?.error) window.alert(tr(get().locale, res.error));
        set({ status: pickStatus(res) ?? get().status });
        // await get().refreshStatus();
      } catch (e) {
        window.alert(tr(get().locale, `操作失败：${String((e as Error)?.message ?? e)}`));
      } finally {
        set({ gatewayActionPending: false, gatewayActionPhase: null });
      }
    } finally {
      gatewayControlSyncLock = false;
    }
  },

  checkUpdates: async () => {
    if (!window.api?.checkUpdates) {
      window.alert(tr(get().locale, "检查更新仅在 Electron 中可用。"));
      return;
    }
    try {
      const res = await window.api.checkUpdates();
      window.alert(tr(get().locale, res?.message ?? "检查完成"));
      if (res?.status) set({ status: res.status });
    } catch (e) {
      window.alert(tr(get().locale, `检查失败：${String((e as Error)?.message ?? e)}`));
    }
  },

  updateOpenClaw: async () => {
    if (!window.api?.updateOpenClaw) return;
    if (!window.confirm(tr(get().locale, "确定执行 OpenClaw 升级吗？"))) return;
    try {
      const res = await window.api.updateOpenClaw();
      window.alert(tr(get().locale, res?.message ?? "升级完成"));
      if (res?.status) set({ status: res.status });
    } catch (e) {
      window.alert(tr(get().locale, `升级失败：${String((e as Error)?.message ?? e)}`));
    }
  },

  installOpenClaw: async () => {
    if (!window.api?.installOpenClaw) {
      return { ok: false, message: tr(get().locale, "安装功能不可用（缺少 Electron API）") };
    }
    try {
      const res = await window.api.installOpenClaw();
      if (res?.status) set({ status: res.status });
      return { ok: Boolean(res?.ok), message: res?.message };
    } catch (e) {
      return { ok: false, message: tr(get().locale, `安装异常：${String((e as Error)?.message ?? e)}`) };
    }
  },

  setupOpenClaw: async () => {
    if (!window.api?.setupOpenClaw) {
      return { ok: false, message: tr(get().locale, "设置功能不可用（缺少 Electron API）") };
    }
    try {
      const res = await window.api.setupOpenClaw();
      if (res?.status) set({ status: res.status });
      return { ok: Boolean(res?.ok), message: res?.message };
    } catch (e) {
      return { ok: false, message: tr(get().locale, `设置异常：${String((e as Error)?.message ?? e)}`) };
    }
  },

  uninstallOpenClaw: async () => {
    if (!window.api?.uninstallOpenClaw) return;
    if (!window.confirm(tr(get().locale, "此操作将卸载 OpenClaw。确定继续吗？"))) return;
    if (!window.confirm(tr(get().locale, "请再次确认：真的要卸载 OpenClaw 吗？"))) return;
    try {
      const res = await window.api.uninstallOpenClaw();
      window.alert(tr(get().locale, res?.message ?? "已执行"));
      if (res?.status) set({ status: res.status });
    } catch (e) {
      window.alert(tr(get().locale, `卸载失败：${String((e as Error)?.message ?? e)}`));
    }
  },

  gatewayCall: async (method, params, timeoutMs) => {
    const api = window.api;
    if (!api?.gatewayCall) {
      return { ok: false, error: "gatewayCall 仅在 Electron 中可用。" };
    }
    try {
      return await api.gatewayCall({ method, params, timeoutMs });
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  }
}));
