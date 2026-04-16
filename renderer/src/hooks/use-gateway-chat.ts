import { useEffect, useRef } from "react";
import { GatewayBrowserClient } from "@/gateway/gateway-browser-client";
import { useChatStore } from "@/store/chat-store";
import { useAppStore } from "@/store/app-store";
import type { ModelCatalogEntry } from "@/types/model-catalog";
import type { OpenClawApi } from "@/types/electron-api";

function formatUptime(ms: number) {
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const s = Math.floor(safeMs / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

function tryExtractPortFromWsUrl(wsUrl: string): number | undefined {
  try {
    const u = new URL(wsUrl);
    const p = Number(u.port);
    if (Number.isFinite(p) && p > 0) return p;
    return undefined;
  } catch {
    return undefined;
  }
}

async function fetchConnectInfo(api: OpenClawApi | undefined): Promise<{
  wsUrl: string;
  token?: string;
  password?: string;
} | null> {
  if (!api?.getGatewayConnectInfo) return null;
  try {
    return await api.getGatewayConnectInfo();
  } catch {
    return null;
  }
}

export function useGatewayChat(opts: {
  hasElectronApi: boolean;
  gatewayRunning: boolean;
  gatewayPort: number;
}) {
  const setGatewayClient = useChatStore((s) => s.setGatewayClient);
  const setGatewayConnected = useChatStore((s) => s.setGatewayConnected);
  const setModelCatalog = useChatStore((s) => s.setModelCatalog);
  const loadHistoryFromGateway = useChatStore((s) => s.loadHistoryFromGateway);
  const sessionKey = useChatStore((s) => s.sessionKey);
  const setGatewayRuntime = useAppStore((s) => s.setGatewayRuntime);

  const clientRef = useRef<GatewayBrowserClient | null>(null);
  const running = opts.gatewayRunning;
  const port = opts.gatewayPort;

  useEffect(() => {
    if (!opts.hasElectronApi || !running) {
      clientRef.current?.stop();
      clientRef.current = null;
      setGatewayClient(null);
      setGatewayConnected(false);
      return;
    }

    let cancelled = false;
    let startedAtMs: number | null = null;
    let portFromWs: number | undefined = undefined;
    let uptimeTimer: number | null = null;

    void (async () => {
      const info = await fetchConnectInfo(window.api as OpenClawApi | undefined);
      const wsUrl =
        info?.wsUrl?.trim() ||
        `ws://127.0.0.1:${Number.isFinite(port) && port > 0 ? port : 18789}`;
      if (cancelled) return;
      portFromWs = tryExtractPortFromWsUrl(wsUrl) ?? (Number.isFinite(port) && port > 0 ? port : undefined);

      const client = new GatewayBrowserClient({
        url: wsUrl,
        token: info?.token,
        password: info?.password,
        onHello: async (hello) => {
          if (cancelled) return;
          setGatewayConnected(true);

          const uptimeMsFromHelloRaw = (hello?.snapshot as any)?.uptimeMs;
          const uptimeMsFromHello = typeof uptimeMsFromHelloRaw === "number" && uptimeMsFromHelloRaw >= 0 ? uptimeMsFromHelloRaw : 0;
          startedAtMs = Date.now() - uptimeMsFromHello;

          // WebSocket 驱动：running/uptimeText/port 来自 hello snapshot + 当前连接。
          setGatewayRuntime({
            running: true,
            uptimeText: formatUptime(uptimeMsFromHello),
            port: portFromWs ?? 18789,
          });

          if (uptimeTimer != null) window.clearInterval(uptimeTimer);
          const tickMs = hello?.policy?.tickIntervalMs && hello.policy.tickIntervalMs > 0 ? hello.policy.tickIntervalMs : 1000;
          uptimeTimer = window.setInterval(() => {
            if (cancelled) return;
            if (startedAtMs == null) return;
            const uptimeNow = Date.now() - startedAtMs;
            setGatewayRuntime({
              running: true,
              uptimeText: formatUptime(uptimeNow),
              port: portFromWs ?? 18789,
            });
          }, tickMs);

          try {
            const result = await client.request<{ models?: ModelCatalogEntry[] }>("models.list", {});
            const models = Array.isArray(result?.models) ? result.models : [];
            setModelCatalog(models);
          } catch {
            setModelCatalog([]);
          }
          await useChatStore.getState().refreshSessionsList();
          await useChatStore.getState().loadHistoryFromGateway();
        },
        onEvent: (evt) => {
          if (evt.event === "chat") {
            useChatStore.getState().applyGatewayChatEvent(evt.payload);
          }
        },
        onClose: () => {
          setGatewayConnected(false);
          if (uptimeTimer != null) window.clearInterval(uptimeTimer);
          uptimeTimer = null;
          startedAtMs = null;
          setGatewayRuntime({
            running: false,
            uptimeText: "未运行",
            port: portFromWs ?? (Number.isFinite(port) && port > 0 ? port : 18789),
          });
        },
      });

      clientRef.current = client;
      setGatewayClient(client);
      client.start();
    })();

    return () => {
      cancelled = true;
      if (uptimeTimer != null) window.clearInterval(uptimeTimer);
      uptimeTimer = null;
      startedAtMs = null;
      clientRef.current?.stop();
      clientRef.current = null;
      setGatewayClient(null);
      setGatewayConnected(false);
    };
  }, [
    opts.hasElectronApi,
    running,
    port,
    setGatewayClient,
    setGatewayConnected,
    setModelCatalog,
    setGatewayRuntime,
  ]);

  useEffect(() => {
    if (!running) return;
    void loadHistoryFromGateway();
  }, [sessionKey, running, loadHistoryFromGateway]);
}
