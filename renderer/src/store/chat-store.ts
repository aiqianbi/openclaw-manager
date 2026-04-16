import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { GatewayBrowserClient } from "@/gateway/gateway-browser-client";
import { GatewayRequestError } from "@/gateway/gateway-browser-client";
import { generateUUID } from "@/gateway/uuid";
import { applyChatEvent, filterSilentAssistantMessages, type ChatEventPayload } from "@/chat/chat-event";
import { extractText } from "@/chat/message-extract";
import { buildAgentMainSessionKey } from "@/chat/session-key";
import type { ModelCatalogEntry } from "@/types/model-catalog";
import type { GatewaySessionRow, SessionsListResult } from "@/types/sessions";
import type { OpenClawApi } from "@/types/electron-api";

type ChatStoreState = {
  gatewayClient: GatewayBrowserClient | null;
  gatewayConnected: boolean;
  sessionKey: string;
  chatMessages: unknown[];
  modelCatalog: ModelCatalogEntry[];
  sessionsResult: SessionsListResult | null;
  sessionsLoading: boolean;
  sessionsError: string | null;
  /** sessionKey -> 与 Control UI 一致的 qualified model 值；缺省表示用服务端会话默认 */
  chatModelOverrides: Record<string, string>;
  chatLoading: boolean;
  chatSending: boolean;
  chatRunId: string | null;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  lastError: string | null;

  setGatewayClient: (c: GatewayBrowserClient | null) => void;
  setGatewayConnected: (v: boolean) => void;
  setSessionKey: (key: string) => void;
  setModelCatalog: (models: ModelCatalogEntry[]) => void;
  setChatModelForSession: (sessionKey: string, qualifiedModel: string) => void;
  applyGatewayChatEvent: (payload: unknown) => void;
  replaceMessagesFromHistory: (messages: unknown[]) => void;
  clearStreamingState: () => void;
  refreshSessionsList: () => Promise<void>;
  loadHistoryFromGateway: () => Promise<void>;
  sendViaGateway: (text: string) => Promise<void>;
  patchSessionModel: (qualifiedModel: string) => Promise<void>;
};

function coerceSessionsListResult(raw: unknown): SessionsListResult {
  if (!raw || typeof raw !== "object") {
    return { sessions: [] };
  }
  const o = raw as Record<string, unknown>;
  const rawSessions = Array.isArray(o.sessions) ? o.sessions : [];
  const sessions: GatewaySessionRow[] = [];
  for (const item of rawSessions) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const key = typeof r.key === "string" ? r.key : "";
    if (!key) continue;
    const kind = r.kind;
    const k =
      kind === "direct" || kind === "group" || kind === "global" || kind === "unknown" ? kind : "unknown";
    sessions.push({
      key,
      spawnedBy: typeof r.spawnedBy === "string" ? r.spawnedBy : undefined,
      kind: k,
      label: typeof r.label === "string" ? r.label : undefined,
      displayName: typeof r.displayName === "string" ? r.displayName : undefined,
      surface: typeof r.surface === "string" ? r.surface : undefined,
      subject: typeof r.subject === "string" ? r.subject : undefined,
      room: typeof r.room === "string" ? r.room : undefined,
      space: typeof r.space === "string" ? r.space : undefined,
      updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : null,
      sessionId: typeof r.sessionId === "string" ? r.sessionId : undefined,
      model: typeof r.model === "string" ? r.model : undefined,
      modelProvider: typeof r.modelProvider === "string" ? r.modelProvider : undefined,
      contextTokens: typeof r.contextTokens === "number" ? r.contextTokens : undefined,
    });
  }
  const defRaw = o.defaults;
  let defaults: SessionsListResult["defaults"];
  if (defRaw && typeof defRaw === "object") {
    const d = defRaw as Record<string, unknown>;
    defaults = {
      modelProvider: typeof d.modelProvider === "string" ? d.modelProvider : undefined,
      model: typeof d.model === "string" ? d.model : undefined,
      contextTokens: typeof d.contextTokens === "number" ? d.contextTokens : null,
    };
  }
  return {
    ts: typeof o.ts === "number" ? o.ts : undefined,
    path: typeof o.path === "string" ? o.path : undefined,
    count: typeof o.count === "number" ? o.count : undefined,
    defaults,
    sessions,
  };
}

async function gatewayCallIpc(method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
  const api = window.api as OpenClawApi | undefined;
  if (!api?.gatewayCall) {
    throw new Error("gatewayCall 仅在 Electron 中可用");
  }
  const r = await api.gatewayCall({ method, params, timeoutMs });
  if (!r.ok) {
    throw new Error(r.error ?? `${method} 失败`);
  }
  return r.result;
}

function coerceChatPayload(raw: unknown): ChatEventPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const runId = typeof o.runId === "string" ? o.runId : "";
  const sessionKey = typeof o.sessionKey === "string" ? o.sessionKey : "";
  const state = o.state;
  if (!runId || !sessionKey || (state !== "delta" && state !== "final" && state !== "aborted" && state !== "error")) {
    return null;
  }
  return {
    runId,
    sessionKey,
    state,
    message: o.message,
    errorMessage: typeof o.errorMessage === "string" ? o.errorMessage : undefined,
  };
}

export const useChatStore = create<ChatStoreState>()(
  persist(
    (set, get) => ({
      gatewayClient: null,
      gatewayConnected: false,
      sessionKey: buildAgentMainSessionKey(""),
      chatMessages: [],
      modelCatalog: [],
      sessionsResult: null,
      sessionsLoading: false,
      sessionsError: null,
      chatModelOverrides: {},
      chatLoading: false,
      chatSending: false,
      chatRunId: null,
      chatStream: null,
      chatStreamStartedAt: null,
      lastError: null,

      setGatewayClient: (c) => set({ gatewayClient: c }),
      setGatewayConnected: (v) => set({ gatewayConnected: v }),

      setSessionKey: (key) => {
        const k = typeof key === "string" ? key : "";
        set({
          sessionKey: k,
          chatStream: null,
          chatStreamStartedAt: null,
          chatRunId: null,
          lastError: null,
        });
      },

      setModelCatalog: (models) => set({ modelCatalog: models }),

      setChatModelForSession: (sessionKey, qualifiedModel) =>
        set((s) => {
          const next = { ...s.chatModelOverrides };
          const t = qualifiedModel.trim();
          if (!t) delete next[sessionKey];
          else next[sessionKey] = qualifiedModel;
          return { chatModelOverrides: next };
        }),

      applyGatewayChatEvent: (raw) => {
        const payload = coerceChatPayload(raw);
        if (!payload) return;
        const s = get();
        const slice = applyChatEvent(
          {
            sessionKey: s.sessionKey,
            chatMessages: s.chatMessages,
            chatRunId: s.chatRunId,
            chatStream: s.chatStream,
            chatStreamStartedAt: s.chatStreamStartedAt,
            lastError: s.lastError,
          },
          payload,
        );
        set({
          chatMessages: slice.chatMessages,
          chatRunId: slice.chatRunId,
          chatStream: slice.chatStream,
          chatStreamStartedAt: slice.chatStreamStartedAt,
          lastError: slice.lastError,
          chatSending: payload.state === "final" || payload.state === "aborted" || payload.state === "error" ? false : s.chatSending,
        });
      },

      replaceMessagesFromHistory: (messages) =>
        set({
          chatMessages: filterSilentAssistantMessages(messages),
          chatStream: null,
          chatStreamStartedAt: null,
          chatRunId: null,
        }),

      clearStreamingState: () =>
        set({ chatStream: null, chatStreamStartedAt: null, chatRunId: null, chatSending: false }),

      refreshSessionsList: async () => {
        const { gatewayClient, gatewayConnected } = get();
        set({ sessionsLoading: true, sessionsError: null });
        try {
          const params = { includeGlobal: true, includeUnknown: true };
          let raw: unknown;
          if (gatewayClient?.connected && gatewayConnected) {
            raw = await gatewayClient.request<unknown>("sessions.list", params);
          } else {
            raw = await gatewayCallIpc("sessions.list", params, 45000);
          }
          const parsed = coerceSessionsListResult(raw);
          set({ sessionsResult: parsed, sessionsLoading: false });
        } catch (e) {
          set({ sessionsError: String(e), sessionsLoading: false });
        }
      },

      loadHistoryFromGateway: async () => {
        const { gatewayClient, gatewayConnected, sessionKey } = get();
        const sk = typeof sessionKey === "string" ? sessionKey.trim() : "";
        if (!sk) return;
        set({ chatLoading: true, lastError: null });
        try {
          let messages: unknown[] = [];
          const params = { sessionKey: sk, limit: 200 };
          if (gatewayClient?.connected && gatewayConnected) {
            const res = await gatewayClient.request<{ messages?: unknown[] }>("chat.history", params);
            messages = Array.isArray(res.messages) ? res.messages : [];
          } else {
            const raw = await gatewayCallIpc("chat.history", params, 60000);
            const res = raw as { messages?: unknown[] };
            messages = Array.isArray(res?.messages) ? res.messages : [];
          }
          get().replaceMessagesFromHistory(messages);
        } catch (err) {
          set({ lastError: String(err) });
        } finally {
          set({ chatLoading: false });
        }
      },

      sendViaGateway: async (message) => {
        const msg = message.trim();
        if (!msg) return;
        const { gatewayClient, gatewayConnected, sessionKey } = get();
        if (!gatewayClient?.connected || !gatewayConnected) {
          set({ lastError: "网关 WebSocket 未连接" });
          return;
        }
        const now = Date.now();
        const runId = generateUUID();
        set((s) => ({
          chatMessages: [
            ...s.chatMessages,
            {
              role: "user",
              content: [{ type: "text", text: msg }],
              timestamp: now,
            },
          ],
          chatSending: true,
          lastError: null,
          chatRunId: runId,
          chatStream: "",
          chatStreamStartedAt: now,
        }));
        try {
          await gatewayClient.request("chat.send", {
            sessionKey,
            message: msg,
            deliver: false,
            idempotencyKey: runId,
          });
        } catch (err) {
          const text =
            err instanceof GatewayRequestError ? `${err.gatewayCode}: ${err.message}` : String(err);
          set((s) => ({
            chatSending: false,
            chatRunId: null,
            chatStream: null,
            chatStreamStartedAt: null,
            lastError: text,
            chatMessages: [
              ...s.chatMessages,
              {
                role: "assistant",
                content: [{ type: "text", text: `Error: ${text}` }],
                timestamp: Date.now(),
              },
            ],
          }));
        }
      },

      patchSessionModel: async (qualifiedModel) => {
        const { gatewayClient, gatewayConnected, sessionKey } = get();
        const trimmed = qualifiedModel.trim();
        const prevEntry = get().chatModelOverrides[sessionKey];
        const prev = prevEntry !== undefined ? prevEntry : "__omit__";
        get().setChatModelForSession(sessionKey, qualifiedModel);
        try {
          const body = { key: sessionKey, model: trimmed ? qualifiedModel : null };
          if (gatewayClient?.connected && gatewayConnected) {
            await gatewayClient.request("sessions.patch", body);
          } else {
            await gatewayCallIpc("sessions.patch", body, 45000);
          }
          await get().refreshSessionsList();
        } catch (err) {
          set((s) => {
            const next = { ...s.chatModelOverrides };
            if (prev === "__omit__") delete next[sessionKey];
            else next[sessionKey] = prev;
            return {
              chatModelOverrides: next,
              lastError: `设置模型失败：${String(err)}`,
            };
          });
        }
      },
    }),
    {
      name: "openclaw-manager-chat-v1",
      partialize: (s) => ({
        sessionKey: s.sessionKey,
        chatModelOverrides: s.chatModelOverrides,
      }),
      merge: (persistedState, currentState) => {
        const p = persistedState as Partial<Pick<ChatStoreState, "sessionKey" | "chatModelOverrides">> & {
          chatAgentId?: string;
        };
        let sessionKey = typeof p.sessionKey === "string" ? p.sessionKey : "";
        if (!sessionKey.trim() && p.chatAgentId) {
          sessionKey = buildAgentMainSessionKey(p.chatAgentId);
        }
        if (!sessionKey.trim()) {
          sessionKey = buildAgentMainSessionKey("");
        }
        return {
          ...currentState,
          sessionKey,
          chatModelOverrides:
            p.chatModelOverrides && typeof p.chatModelOverrides === "object" ? p.chatModelOverrides : currentState.chatModelOverrides,
        };
      },
    },
  ),
);

/** 展示单条消息（用户 / 助手） */
export function formatChatMessageForDisplay(message: unknown): string {
  const text = extractText(message);
  if (text) return text;
  const m = message as Record<string, unknown>;
  if (typeof m.text === "string") return m.text;
  return JSON.stringify(message);
}

export function resolveMessageRole(message: unknown): "user" | "assistant" | "unknown" {
  if (!message || typeof message !== "object") return "unknown";
  const role = String((message as { role?: string }).role ?? "").toLowerCase();
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  return "unknown";
}
