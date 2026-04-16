import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Plus, RefreshCw, Settings2 } from "lucide-react";
import type { GatewayBrowserClient } from "@/gateway/gateway-browser-client";
import type { GatewayCallResult } from "@/types/electron-api";
import type { ModelCatalogEntry } from "@/types/model-catalog";
import { translateLiteral, type SupportedLocale } from "@/i18n/messages";

const REDACTED = "__OPENCLAW_REDACTED__";

type ModelsPageProps = {
  locale: SupportedLocale;
  hasElectronApi: boolean;
  gatewayConnected: boolean;
  gatewayClient: GatewayBrowserClient | null;
  gatewayCall: (method: string, params?: unknown, timeoutMs?: number) => Promise<GatewayCallResult>;
};

type ConfigGetPayload = {
  hash?: string | null;
  config?: Record<string, unknown> | null;
};

type UsageTotals = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
};

type SessionModelUsageRow = {
  provider?: string;
  model?: string;
  count?: number;
  totals?: UsageTotals;
};

type SessionsUsagePayload = {
  aggregates?: {
    byModel?: SessionModelUsageRow[];
  };
};

type CostDailyRow = UsageTotals & { date: string };

type UsageCostPayload = {
  daily?: CostDailyRow[];
};

function safeString(v: unknown): string {
  if (typeof v === "string") return v;
  return v == null ? "" : String(v);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function toYmdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dateRangeForPreset(preset: "7d" | "30d" | "all"): { startDate: string; endDate: string } {
  const end = new Date();
  const endDate = toYmdUtc(end);
  if (preset === "all") {
    return { startDate: "2000-01-01", endDate };
  }
  const days = preset === "7d" ? 7 : 30;
  const start = new Date(end.getTime() - (days - 1) * 86400_000);
  return { startDate: toYmdUtc(start), endDate };
}

function displayTitleCase(key: string): string {
  if (!key) return key;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function authLabel(auth: unknown): string {
  const a = typeof auth === "string" ? auth.toLowerCase() : "";
  if (a === "aws-sdk") return "AWS SDK";
  if (a === "oauth") return "OAuth";
  if (a === "token") return "Token";
  return "API 密钥";
}

function providerNeedsApiKeyWarning(p: Record<string, unknown>): boolean {
  const auth = typeof p.auth === "string" ? p.auth.toLowerCase() : "";
  if (auth === "aws-sdk" || auth === "oauth") return false;

  const key = p.apiKey;
  if (key === undefined || key === null) return true;
  if (typeof key === "string") {
    if (key === REDACTED) return false;
    return key.trim() === "";
  }
  if (typeof key === "object" && key !== null) return false;
  return true;
}

function formatTokenInt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("zh-CN");
}

type Segments = { input: number; output: number; cache: number };

function tokenSegments(t: UsageTotals | undefined): Segments {
  const input = t?.input ?? 0;
  const output = t?.output ?? 0;
  const cache = (t?.cacheRead ?? 0) + (t?.cacheWrite ?? 0);
  return { input, output, cache };
}

function StackedTokenBar(props: { totals: UsageTotals | undefined }) {
  const { input, output, cache } = tokenSegments(props.totals);
  const total = input + output + cache;
  const pct = (x: number) => (total > 0 ? Math.max(0.35, (x / total) * 100) : 0);
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        height: 14,
        borderRadius: 6,
        overflow: "hidden",
        display: "flex",
        background: "var(--color-background-secondary)",
      }}
    >
      <div style={{ width: `${pct(input)}%`, background: "#2563eb", minWidth: total ? undefined : 0 }} title="输入" />
      <div style={{ width: `${pct(output)}%`, background: "#7c3aed", minWidth: 0 }} title="输出" />
      <div style={{ width: `${pct(cache)}%`, background: "#ea580c", minWidth: 0 }} title="缓存" />
    </div>
  );
}

const defaultAddForm = () => ({
  providerKey: "",
  baseUrl: "",
  modelId: "",
  modelName: "",
  apiKey: "",
});

export type ModelsPageHandle = {
  refresh: () => void;
  loading: boolean;
  canUse: boolean;
};

export const ModelsPage = forwardRef<ModelsPageHandle, ModelsPageProps>(function ModelsPage(props, ref) {
  const { locale, hasElectronApi, gatewayConnected, gatewayClient, gatewayCall } = props;
  const canUse = hasElectronApi && gatewayConnected;
  const rootRef = useRef<HTMLDivElement>(null);

  const [configHash, setConfigHash] = useState<string | null>(null);
  const [providers, setProviders] = useState<Record<string, unknown>>({});
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [catalogByQualified, setCatalogByQualified] = useState<Record<string, string>>({});

  const [usageView, setUsageView] = useState<"model" | "time">("model");
  const [rangePreset, setRangePreset] = useState<"7d" | "30d" | "all">("30d");
  const [byModelRows, setByModelRows] = useState<SessionModelUsageRow[]>([]);
  const [dailyRows, setDailyRows] = useState<CostDailyRow[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageErr, setUsageErr] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(defaultAddForm);
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    if (!gatewayClient || !gatewayConnected) return;
    try {
      const res = await gatewayClient.request<{ models?: ModelCatalogEntry[] }>("models.list", {});
      const list = Array.isArray(res?.models) ? res.models : [];
      const map: Record<string, string> = {};
      for (const m of list) {
        const id = safeString(m?.id).trim();
        const name = safeString(m?.name).trim();
        const prov = safeString(m?.provider).trim().toLowerCase();
        if (id) map[id.toLowerCase()] = name || id;
        if (id && prov) map[`${prov}/${id}`.toLowerCase()] = name || id;
      }
      setCatalogByQualified(map);
    } catch {
      setCatalogByQualified({});
    }
  }, [gatewayClient, gatewayConnected]);

  const refreshConfig = useCallback(async () => {
    if (!canUse) return;
    setLoading(true);
    setLoadErr(null);
    try {
      const r = await gatewayCall("config.get", {}, 45000);
      if (!r.ok) {
        setLoadErr(r.error ?? "config.get 失败");
        setConfigHash(null);
        setProviders({});
        return;
      }
      const payload = r.result as ConfigGetPayload | undefined;
      const hash = typeof payload?.hash === "string" ? payload.hash : null;
      setConfigHash(hash);
      const cfg = payload?.config && isObject(payload.config) ? payload.config : null;
      const models = cfg && isObject(cfg.models) ? cfg.models : null;
      const prov = models && isObject(models.providers) ? models.providers : {};
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(prov)) {
        if (isObject(v)) next[k] = v;
      }
      setProviders(next);
    } finally {
      setLoading(false);
    }
  }, [canUse, gatewayCall]);

  const refreshUsage = useCallback(async () => {
    if (!canUse) return;
    const { startDate, endDate } = dateRangeForPreset(rangePreset);
    setUsageLoading(true);
    setUsageErr(null);
    try {
      if (usageView === "model") {
        const r = await gatewayCall(
          "sessions.usage",
          { startDate, endDate, mode: "utc", limit: 200 },
          120_000,
        );
        if (!r.ok) {
          setUsageErr(r.error ?? "sessions.usage 失败");
          setByModelRows([]);
          return;
        }
        const data = r.result as SessionsUsagePayload | undefined;
        const raw = Array.isArray(data?.aggregates?.byModel) ? data!.aggregates!.byModel! : [];
        const sorted = [...raw].sort(
          (a, b) => (b.totals?.totalTokens ?? 0) - (a.totals?.totalTokens ?? 0),
        );
        setByModelRows(sorted);
      } else {
        const r = await gatewayCall("usage.cost", { startDate, endDate, mode: "utc" }, 120_000);
        if (!r.ok) {
          setUsageErr(r.error ?? "usage.cost 失败");
          setDailyRows([]);
          return;
        }
        const data = r.result as UsageCostPayload | undefined;
        const daily = Array.isArray(data?.daily) ? data!.daily! : [];
        setDailyRows(daily);
      }
    } finally {
      setUsageLoading(false);
    }
  }, [canUse, gatewayCall, rangePreset, usageView]);

  useImperativeHandle(ref, () => ({
    refresh: () => { void refreshConfig(); void loadCatalog(); void refreshUsage(); },
    loading,
    canUse,
  }), [refreshConfig, loadCatalog, refreshUsage, loading, canUse]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    void refreshConfig();
  }, [refreshConfig]);

  useEffect(() => {
    void refreshUsage();
  }, [refreshUsage]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const textBase = new WeakMap<Text, string>();
    const attrBase = new WeakMap<Element, Record<string, string>>();
    const skip = (el: Element | null): boolean => {
      let cur: Element | null = el;
      while (cur) {
        const tag = cur.tagName.toLowerCase();
        if (tag === "code" || tag === "pre" || tag === "textarea" || tag === "script" || tag === "style") return true;
        if (cur.hasAttribute("data-no-i18n")) return true;
        cur = cur.parentElement;
      }
      return false;
    };
    const tr = (raw: string): string => {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
      if (!m) return raw;
      const core = (m[2] ?? "").trim();
      if (!core) return raw;
      return `${m[1] ?? ""}${translateLiteral(core, locale)}${m[3] ?? ""}`;
    };
    const patchText = (n: Text) => {
      const p = n.parentElement;
      if (!p || skip(p)) return;
      if (!textBase.has(n)) textBase.set(n, n.nodeValue ?? "");
      const next = tr(textBase.get(n) ?? "");
      if (n.nodeValue !== next) n.nodeValue = next;
    };
    const patchAttrs = (el: Element) => {
      if (skip(el)) return;
      const keys = ["placeholder", "title", "aria-label"] as const;
      if (!attrBase.has(el)) {
        const init: Record<string, string> = {};
        for (const k of keys) {
          const v = (el as HTMLElement).getAttribute?.(k);
          if (v != null) init[k] = v;
        }
        attrBase.set(el, init);
      }
      const base = attrBase.get(el) ?? {};
      for (const k of keys) {
        if (!(k in base)) continue;
        const next = tr(base[k]);
        if ((el as HTMLElement).getAttribute?.(k) !== next) (el as HTMLElement).setAttribute?.(k, next);
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
        if (rec.type === "characterData") patchText(rec.target as Text);
        if (rec.type === "attributes" && rec.target.nodeType === Node.ELEMENT_NODE) patchAttrs(rec.target as Element);
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

  const providerEntries = useMemo(() => {
    return Object.entries(providers).sort(([a], [b]) => a.localeCompare(b));
  }, [providers]);

  function resolveModelLabel(providerKey: string, modelId: string): string {
    const q1 = `${providerKey}/${modelId}`.toLowerCase();
    const q2 = modelId.toLowerCase();
    return catalogByQualified[q1] ?? catalogByQualified[q2] ?? modelId;
  }

  const recordCount =
    usageView === "model" ? byModelRows.length : dailyRows.length;

  function openAddModal() {
    setAddForm(defaultAddForm());
    setAddErr(null);
    setAddOpen(true);
  }

  async function submitAddProvider() {
    const providerKey = addForm.providerKey.trim().toLowerCase().replace(/\s+/g, "");
    const baseUrl = addForm.baseUrl.trim();
    const modelId = addForm.modelId.trim();
    const modelName = addForm.modelName.trim() || modelId;
    const apiKey = addForm.apiKey.trim();
    if (!providerKey) {
      setAddErr("请填写提供商 ID（英文，用作配置键）。");
      return;
    }
    if (!/^[a-z][a-z0-9_-]*$/i.test(providerKey)) {
      setAddErr("提供商 ID 仅允许字母、数字、下划线、连字符，且以字母开头。");
      return;
    }
    if (!baseUrl) {
      setAddErr("请填写 Base URL。");
      return;
    }
    if (!modelId) {
      setAddErr("请填写模型 ID。");
      return;
    }
    if (!apiKey) {
      setAddErr("请填写 API Key。");
      return;
    }
    if (!configHash) {
      setAddErr("缺少配置 hash，请先刷新页面再试。");
      return;
    }
    setAddBusy(true);
    setAddErr(null);
    try {
      const patch = {
        models: {
          providers: {
            [providerKey]: {
              baseUrl,
              apiKey,
              models: [
                {
                  id: modelId,
                  name: modelName,
                  reasoning: false,
                  input: ["text"],
                },
              ],
            },
          },
        },
      };
      const raw = JSON.stringify(patch);
      const r = await gatewayCall("config.patch", { raw, baseHash: configHash }, 120_000);
      if (!r.ok) {
        setAddErr(r.error ?? "config.patch 失败");
        return;
      }
      setAddOpen(false);
      await refreshConfig();
      await loadCatalog();
      void refreshUsage();
    } finally {
      setAddBusy(false);
    }
  }

  return (
    <>
      <div ref={rootRef} className="oc-models-scroll" style={{ padding: "12px 16px 16px", maxWidth: 1320, margin: "0 auto", width: "100%" }}>

        {!canUse ? (
          <div className="oc-card" style={{ marginTop: 12, padding: 14 }}>
            <div className="oc-rsub">
              {hasElectronApi ? "请先连接网关 WebSocket 后再管理模型配置。" : "模型页仅在 Electron 与已连接网关时可用。"}
            </div>
          </div>
        ) : null}

        {canUse && loadErr ? (
          <div className="oc-banner oc-banner--warn" style={{ marginTop: 12 }}>{loadErr}</div>
        ) : null}

        {canUse ? (
          <>
            <div className="oc-card" style={{ marginTop: 14, padding: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "12px 16px",
                  borderBottom: "0.5px solid var(--color-border-secondary)",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 15 }}>AI 模型提供商</div>
                <button type="button" className="oc-bp" onClick={openAddModal} disabled={loading}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, verticalAlign: "middle" }}>
                    <Plus size={18} aria-hidden />
                    添加提供商
                  </span>
                </button>
              </div>
              {loading && providerEntries.length === 0 ? (
                <div className="oc-rsub" style={{ padding: 20 }}>加载中…</div>
              ) : providerEntries.length === 0 ? (
                <div className="oc-rsub" style={{ padding: 24, textAlign: "center" }}>
                  暂无提供商。点击「添加提供商」或使用 openclaw.json 配置 <code>models.providers</code>。
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {providerEntries.map(([key, raw]) => {
                    const p = isObject(raw) ? raw : {};
                    const modelsArr = Array.isArray(p.models) ? p.models : [];
                    const first = modelsArr[0] && isObject(modelsArr[0]) ? modelsArr[0] : null;
                    const mid = first ? safeString(first.id) : "";
                    const api = safeString(p.api).trim();
                    const typeLabel = api ? api : "自定义";
                    const warn = providerNeedsApiKeyWarning(p);
                    const summary = mid ? `${key}/${mid}` : "—";
                    return (
                      <div
                        key={key}
                        style={{
                          display: "flex",
                          gap: 12,
                          padding: "14px 16px",
                          borderBottom: "0.5px solid var(--color-border-secondary)",
                          alignItems: "flex-start",
                        }}
                      >
                        <div
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 999,
                            background: "var(--color-background-secondary)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            color: "var(--color-text-secondary)",
                          }}
                        >
                          <Settings2 size={20} aria-hidden />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 15 }}>{displayTitleCase(key)}</div>
                          <div className="oc-rsub" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.45 }}>
                            {typeLabel} · {authLabel(p.auth)} · {summary}
                          </div>
                          {safeString(p.baseUrl) ? (
                            <div className="oc-rsub" style={{ fontSize: 11, marginTop: 4, wordBreak: "break-all" }}>
                              {safeString(p.baseUrl)}
                            </div>
                          ) : null}
                          {warn ? (
                            <div style={{ color: "#b91c1c", fontSize: 12, marginTop: 8 }}>
                              该提供商尚未配置 API Key（或当前无法从配置中识别密钥来源）。
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="oc-card" style={{ marginTop: 14, padding: 0 }}>
              <div style={{ padding: "12px 16px", borderBottom: "0.5px solid var(--color-border-secondary)" }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>最近 Token 消耗</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10, alignItems: "center" }}>
                  <div style={{ display: "inline-flex", borderRadius: 8, overflow: "hidden", border: "0.5px solid var(--color-border-tertiary)" }}>
                    <button
                      type="button"
                      className="oc-bs"
                      style={{
                        borderRadius: 0,
                        background: usageView === "model" ? "var(--color-background-secondary)" : "transparent",
                        fontWeight: usageView === "model" ? 600 : 400,
                      }}
                      disabled={usageLoading}
                      onClick={() => setUsageView("model")}
                    >
                      按模型
                    </button>
                    <button
                      type="button"
                      className="oc-bs"
                      style={{
                        borderRadius: 0,
                        borderLeft: "0.5px solid var(--color-border-tertiary)",
                        background: usageView === "time" ? "var(--color-background-secondary)" : "transparent",
                        fontWeight: usageView === "time" ? 600 : 400,
                      }}
                      disabled={usageLoading}
                      onClick={() => setUsageView("time")}
                    >
                      按时间
                    </button>
                  </div>
                  <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                    {(
                      [
                        ["7d", "7 天"],
                        ["30d", "30 天"],
                        ["all", "全部"],
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        className={rangePreset === k ? "oc-bp" : "oc-bs"}
                        disabled={usageLoading}
                        onClick={() => setRangePreset(k)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--color-text-secondary)" }}>
                    共 {recordCount} 条记录
                  </div>
                </div>
                <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 11, flexWrap: "wrap" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: "#2563eb" }} /> 输入
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: "#7c3aed" }} /> 输出
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: "#ea580c" }} /> 缓存
                  </span>
                </div>
              </div>

              {usageErr ? (
                <div className="oc-rsub" style={{ padding: 12, color: "#b45309" }}>{usageErr}</div>
              ) : null}

              {usageLoading && recordCount === 0 && !usageErr ? (
                <div className="oc-rsub" style={{ padding: 20 }}>加载用量中…</div>
              ) : null}

              {!usageLoading && recordCount === 0 && !usageErr ? (
                <div className="oc-rsub" style={{ padding: 24, textAlign: "center" }}>所选范围内暂无 Token 记录。</div>
              ) : null}

              <div style={{ padding: "8px 16px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
                {usageView === "model"
                  ? byModelRows.map((row, idx) => {
                      const prov = safeString(row.provider);
                      const mod = safeString(row.model);
                      const labelBase = mod || "未知模型";
                      const title =
                        prov && mod ? `${resolveModelLabel(prov, mod)} (${prov}/${mod})` : resolveModelLabel(prov, mod) || labelBase;
                      const total = row.totals?.totalTokens ?? 0;
                      return (
                        <div key={`${prov}/${mod}/${idx}`}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>{labelBase}</div>
                            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
                              总 token: {formatTokenInt(total)}
                            </div>
                          </div>
                          <StackedTokenBar totals={row.totals} />
                          <div style={{ fontSize: 11, marginTop: 6, color: "var(--color-text-secondary)" }}>{title}</div>
                        </div>
                      );
                    })
                  : dailyRows.map((row) => {
                      const segs = tokenSegments(row);
                      const total = row.totalTokens ?? segs.input + segs.output + segs.cache;
                      return (
                        <div key={row.date}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>{row.date}</div>
                            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
                              总 token: {formatTokenInt(total)}
                            </div>
                          </div>
                          <StackedTokenBar totals={row} />
                        </div>
                      );
                    })}
              </div>
            </div>
          </>
        ) : null}
      </div>

      {addOpen ? (
        <div
          className="oc-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !addBusy) setAddOpen(false);
          }}
        >
          <div className="oc-modal-panel" style={{ width: "min(480px, 100%)" }}>
            <div className="oc-modal-header">
              <div>
                <div className="oc-modal-title">添加模型提供商</div>
                <div className="oc-rsub" style={{ fontSize: 11, marginTop: 2 }}>
                  合并写入 <code>models.providers</code>
                </div>
              </div>
            </div>
            <div className="oc-modal-body">
              {addErr ? <div className="oc-banner oc-banner--warn">{addErr}</div> : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>提供商 ID</span>
                <input
                  className="oc-inptxt"
                  disabled={addBusy}
                  value={addForm.providerKey}
                  placeholder="例如：deepseek"
                  onChange={(e) => setAddForm((f) => ({ ...f, providerKey: e.target.value }))}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>Base URL</span>
                <input
                  className="oc-inptxt"
                  disabled={addBusy}
                  value={addForm.baseUrl}
                  placeholder="https://api.example.com/v1"
                  onChange={(e) => setAddForm((f) => ({ ...f, baseUrl: e.target.value }))}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>模型 ID</span>
                <input
                  className="oc-inptxt"
                  disabled={addBusy}
                  value={addForm.modelId}
                  placeholder="例如：deepseek-chat"
                  onChange={(e) => setAddForm((f) => ({ ...f, modelId: e.target.value }))}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>模型显示名（可选）</span>
                <input
                  className="oc-inptxt"
                  disabled={addBusy}
                  value={addForm.modelName}
                  placeholder="默认同模型 ID"
                  onChange={(e) => setAddForm((f) => ({ ...f, modelName: e.target.value }))}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>API Key</span>
                <input
                  className="oc-inptxt"
                  type="password"
                  disabled={addBusy}
                  value={addForm.apiKey}
                  placeholder="sk-…"
                  onChange={(e) => setAddForm((f) => ({ ...f, apiKey: e.target.value }))}
                />
              </label>
            </div>
            </div>
            <div className="oc-modal-footer">
              <button type="button" className="oc-bs" disabled={addBusy} onClick={() => setAddOpen(false)}>
                取消
              </button>
              <button type="button" className="oc-bp" disabled={addBusy || !canUse} onClick={() => void submitAddProvider()}>
                {addBusy ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
});
