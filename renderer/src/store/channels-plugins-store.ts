import { create } from "zustand";
import { normalizePluginsFromResult, type PluginItem } from "@/channels/plugin-result-normalize";

type ChannelsPluginsStore = {
  plugins: PluginItem[];
  pluginsLoading: boolean;
  pluginErr: string | null;
  /** 本会话内已完成过一次自动拉取后，进入频道页不再重复请求（除非 force 或「刷新插件」） */
  pluginsSessionFetched: boolean;
  setPluginErr: (err: string | null) => void;
  loadPlugins: (opts?: { force?: boolean }) => Promise<void>;
};

export const useChannelsPluginsStore = create<ChannelsPluginsStore>((set, get) => ({
  plugins: [],
  pluginsLoading: false,
  pluginErr: null,
  pluginsSessionFetched: false,

  setPluginErr: (err) => set({ pluginErr: err }),

  loadPlugins: async (opts) => {
    const force = Boolean(opts?.force);
    const { pluginsSessionFetched, pluginsLoading } = get();
    if (!force && pluginsSessionFetched) return;
    if (pluginsLoading && !force) return;

    const api = window.api;
    if (!api?.pluginsList && !api?.pluginCli) {
      set({
        pluginErr: "当前版本未暴露插件列表 IPC（manager:pluginsList）。",
        plugins: [],
        pluginsSessionFetched: true,
      });
      return;
    }

    set({ pluginsLoading: true, pluginErr: null });
    try {
      const res = api.pluginsList ? await api.pluginsList() : await api.pluginCli!({ action: "list" });
      if (!res?.ok) throw new Error(res?.error ?? "读取插件列表失败。");
      // console.log('插件列表：',res);
      const next = normalizePluginsFromResult(res.result);
      set({ plugins: next, pluginsSessionFetched: true, pluginErr: null });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      set((state) => ({
        pluginErr: msg,
        pluginsSessionFetched: true,
        plugins: state.plugins,
      }));
    } finally {
      set({ pluginsLoading: false });
    }
  },
}));
