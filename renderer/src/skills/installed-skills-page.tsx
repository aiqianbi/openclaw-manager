import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GatewayBrowserClient } from "@/gateway/gateway-browser-client";
import type { GatewayCallResult } from "@/types/electron-api";
import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { translateLiteral, type SupportedLocale } from "@/i18n/messages";

type InstalledSkillsPageProps = {
  locale: SupportedLocale;
  hasElectronApi: boolean;
  gatewayConnected: boolean;
  gatewayClient: GatewayBrowserClient | null;
  gatewayCall: (method: string, params?: unknown, timeoutMs?: number) => Promise<GatewayCallResult>;
};

type SkillsMissing = {
  bins?: string[];
  anyBins?: string[];
  env?: string[];
  config?: string[];
  os?: string[];
};

type SkillsRequirements = unknown;

type SkillsInstallOption = unknown;

type SkillStatusEntry = {
  name: string;
  description: string;
  source: string;
  bundled: boolean;
  filePath?: string;
  baseDir?: string;
  skillKey: string;
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  disabled: boolean;
  blockedByAllowlist: boolean;
  eligible: boolean;
  requirements: SkillsRequirements;
  missing: SkillsMissing;
  configChecks?: unknown;
  install?: SkillsInstallOption[];
};

type SkillsStatusReport = {
  workspaceDir?: string;
  managedSkillsDir?: string;
  skills: SkillStatusEntry[];
};

function safeString(v: unknown): string {
  if (typeof v === "string") return v;
  return v == null ? "" : String(v);
}

function normalizeSearch(s: string): string {
  return s.trim().toLowerCase();
}

function joinNonEmpty(parts: Array<string | undefined | null>, sep = " · "): string {
  return parts.map((p) => (p == null ? "" : String(p).trim())).filter(Boolean).join(sep);
}

function toneByEntry(e: SkillStatusEntry): { label: string; tone: "ok" | "warn" | "err" | "muted" } {
  if (e.eligible) return { label: "就绪", tone: "ok" };
  if (e.disabled) return { label: "已禁用", tone: "warn" };
  if (e.blockedByAllowlist) return { label: "白名单阻止", tone: "warn" };
  return { label: "缺少条件", tone: "err" };
}

function renderList(tokens: string[] | undefined): string {
  const arr = Array.isArray(tokens) ? tokens.filter(Boolean).map((x) => safeString(x).trim()).filter(Boolean) : [];
  if (arr.length === 0) return "—";
  return arr.join(", ");
}

function ToggleLike({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        cursor: disabled ? "not-allowed" : "pointer",
        userSelect: "none",
      }}
      title={checked ? "启用" : "禁用"}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
        style={{
          width: 42,
          height: 22,
          accentColor: "#ff6b6b",
        }}
      />
    </label>
  );
}

function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="oc-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="oc-modal-panel" style={{ width: "min(920px, 100%)" }}>
        <div className="oc-modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            {title}
          </div>
          <button type="button" className="oc-bs" onClick={onClose}
            style={{ width: 30, height: 30, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, flexShrink: 0 }}>
            关闭
          </button>
        </div>
        <div className="oc-modal-body">
          {children}
        </div>
      </div>
    </div>
  );
}

export function InstalledSkillsPage(props: InstalledSkillsPageProps) {
  const { locale, hasElectronApi, gatewayConnected, gatewayClient, gatewayCall } = props;
  const rootRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [report, setReport] = useState<SkillsStatusReport>({ skills: [] });

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"all" | "bundled" | "market">("all");

  const [batchBusy, setBatchBusy] = useState(false);
  const [updatingSkillKey, setUpdatingSkillKey] = useState<string | null>(null);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsSkill, setDetailsSkill] = useState<SkillStatusEntry | null>(null);

  const canUse = hasElectronApi && gatewayConnected;

  async function gatewayRequestOrThrow(method: string, params: unknown, timeoutMs?: number): Promise<any> {
    if (!gatewayConnected) {
      throw new Error("网关 WebSocket 未连接");
    }
    if (!gatewayClient) {
      throw new Error("网关 WebSocket client 未就绪");
    }
    const req = gatewayClient.request(method, params);
    if (!timeoutMs || !(Number.isFinite(timeoutMs) && timeoutMs > 0)) {
      return req;
    }
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

  const loadSkillsStatus = useCallback(async () => {
    if (!canUse) return;
    setLoading(true);
    setErr(null);
    try {
      // 优先走 WebSocket（最快、且不会经过 CLI 输出截断）
      const wsRes = await gatewayRequestOrThrow("skills.status", {}, 45_000);
      const raw = wsRes as any;
      const skills = raw && Array.isArray(raw.skills) ? raw.skills : null;
      if (!skills) {
        const keys = raw && typeof raw === "object" ? Object.keys(raw).slice(0, 12).join(", ") : String(raw);
        setErr(`skills.status 返回结构不正确（ws.keys: ${keys}）。请检查网关输出/日志，或点击刷新重试。`);
        setReport({ skills: [] });
        return;
      }
      setReport({ skills });
    } catch (e) {
      // fallback：若 WS 不可用，再尝试 gatewayCall（CLI 路径），便于兼容某些环境
      try {
        const r = await gatewayCall("skills.status", {}, 45_000);
        if (!r.ok) {
          setErr(r.error ?? String((e as Error)?.message ?? e));
          setReport({ skills: [] });
          return;
        }
        const raw = r.result as any;
        const skills = raw && Array.isArray(raw.skills) ? raw.skills : null;
        if (!skills) {
          const keys = raw && typeof raw === "object" ? Object.keys(raw).slice(0, 12).join(", ") : String(raw);
          setErr(`skills.status 返回为空或结构不正确（fallback keys: ${keys}）。`);
          setReport({ skills: [] });
          return;
        }
        setReport({ skills });
      } catch (e2) {
        setErr(String((e2 as Error)?.message ?? e2 ?? (e as Error)?.message ?? e));
        setReport({ skills: [] });
      }
      setReport({ skills: [] });
    } finally {
      setLoading(false);
    }
  }, [canUse, gatewayCall, gatewayClient, gatewayConnected]);

  useEffect(() => {
    void loadSkillsStatus();
  }, [loadSkillsStatus]);

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

  const skillsWithKeys = useMemo(() => {
    return (report.skills ?? []).filter((s) => safeString(s?.skillKey ?? s?.name).trim().length > 0);
  }, [report.skills]);

  const filtered = useMemo(() => {
    const s = normalizeSearch(search);
    let list = skillsWithKeys;
    if (tab === "bundled") list = list.filter((x) => x.bundled);
    if (tab === "market") list = list.filter((x) => !x.bundled);
    if (!s) return list;
    return list.filter((x) =>
      [x.name, x.description, x.source].join(" ").toLowerCase().includes(s),
    );
  }, [search, skillsWithKeys, tab]);

  const counts = useMemo(() => {
    const total = skillsWithKeys.length;
    const bundled = skillsWithKeys.filter((s) => s.bundled).length;
    return { total, bundled, market: total - bundled };
  }, [skillsWithKeys]);

  const visibleSkillKeys = useMemo(() => {
    // MVP：直接取过滤后全部条目（因为我们未引入分页）。
    return filtered.map((e) => e.skillKey);
  }, [filtered]);

  const refresh = useCallback(() => {
    void loadSkillsStatus();
  }, [loadSkillsStatus]);

  const toggleSkill = useCallback(
    async (entry: SkillStatusEntry, enabled: boolean) => {
      if (!canUse) return;
      if (!entry?.skillKey) return;
      if (updatingSkillKey) return;
      setUpdatingSkillKey(entry.skillKey);
      try {
        try {
          await gatewayRequestOrThrow("skills.update", { skillKey: entry.skillKey, enabled }, 60_000);
        } catch {
          const r = await gatewayCall("skills.update", { skillKey: entry.skillKey, enabled }, 60_000);
          if (!r.ok) {
            window.alert(r.error ?? "skills.update 失败");
            return;
          }
        }
        await refresh();
      } finally {
        setUpdatingSkillKey(null);
      }
    },
    [canUse, gatewayCall, refresh, updatingSkillKey, gatewayConnected, gatewayClient],
  );

  const batchToggle = useCallback(
    async (enabled: boolean) => {
      if (!canUse) return;
      if (batchBusy) return;
      if (visibleSkillKeys.length === 0) return;
      setBatchBusy(true);
      try {
        // MVP：逐个顺序调用，降低并发带来的控制面压力
        for (const key of visibleSkillKeys) {
          try {
            await gatewayRequestOrThrow("skills.update", { skillKey: key, enabled }, 60_000);
          } catch {
            const r = await gatewayCall("skills.update", { skillKey: key, enabled }, 60_000);
            if (!r.ok) {
              window.alert(r.error ?? "skills.update 批量失败");
              break;
            }
          }
        }
        await refresh();
      } finally {
        setBatchBusy(false);
      }
    },
    [batchBusy, canUse, gatewayCall, refresh, visibleSkillKeys, gatewayConnected, gatewayClient],
  );

  const openDetails = useCallback((entry: SkillStatusEntry) => {
    setDetailsSkill(entry);
    setDetailsOpen(true);
  }, []);

  return (
    <div ref={rootRef} className="oc-models-root">
      <div className="oc-topbar">
        <div className="oc-bc">
          技能 <span style={{ opacity: 0.8 }}>&gt;</span> <b>已安装</b>
        </div>
        <div className="oc-tr">
          <div className="oc-search">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="4"/><path d="M10.5 10.5l2.5 2.5"/></svg>
            <input
              value={search}
              onChange={(e) => setSearch((e.target as HTMLInputElement).value)}
              placeholder="搜索技能…"
            />
          </div>
          <button
            type="button"
            className="oc-bs"
            disabled={!canUse || loading}
            onClick={() => refresh()}
            title="刷新"
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <RefreshCw size={16} aria-hidden />
              刷新
            </span>
          </button>
        </div>
      </div>

      <div className="oc-mktab" style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
        <button
          type="button"
          className={`oc-mkt ${tab === "all" ? "on" : ""}`}
          onClick={() => setTab("all")}
        >
          全部（{counts.total}）
        </button>
        <button
          type="button"
          className={`oc-mkt ${tab === "bundled" ? "on" : ""}`}
          onClick={() => setTab("bundled")}
        >
          内置（{counts.bundled}）
        </button>
        <button
          type="button"
          className={`oc-mkt ${tab === "market" ? "on" : ""}`}
          onClick={() => setTab("market")}
        >
          市场（{counts.market}）
        </button>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="oc-bp"
            disabled={!canUse || batchBusy || visibleSkillKeys.length === 0}
            onClick={() => void batchToggle(true)}
            title="对当前过滤可见的技能逐个启用"
          >
            批量启动可见页
          </button>
          <button
            type="button"
            className="oc-bs"
            disabled={!canUse || batchBusy || visibleSkillKeys.length === 0}
            onClick={() => void batchToggle(false)}
            title="对当前过滤可见的技能逐个禁用"
          >
            批量禁用可见页
          </button>
        </div>
      </div>

      <div className="oc-models-scroll" style={{ padding: "12px 16px 16px" }}>
        {!canUse ? (
          <div className="oc-card" style={{ padding: 14 }}>
            <div className="oc-rsub">
              {hasElectronApi ? "正在连接网关 WebSocket…" : "当前环境非 Electron：仅展示占位界面。"}
            </div>
          </div>
        ) : null}

        {canUse && loading && skillsWithKeys.length === 0 ? (
          <div className="oc-rsub" style={{ padding: 20 }}>
            加载中…
          </div>
        ) : null}

        {canUse && err ? (
          <div className="oc-banner oc-banner--warn" style={{ marginTop: 12 }}>
            {err}
          </div>
        ) : null}

        {canUse && !loading && filtered.length === 0 ? (
          <div className="oc-rsub" style={{ padding: 24, textAlign: "center" }}>
            暂无技能。点击「刷新」或检查你的 `openclaw.json` 以及运行环境。
          </div>
        ) : null}

        {canUse
          ? filtered.map((entry) => {
              const enabled = !entry.disabled;
              const tone = toneByEntry(entry);
              const disabledByUpdate = updatingSkillKey === entry.skillKey;
              const desc = safeString(entry.description);

              const statusPillTone: { bg: string; fg: string; border?: string } = (() => {
                if (tone.tone === "ok") return { bg: "#e8f8f0", fg: "#1e8a50" };
                if (tone.tone === "warn") return { bg: "#fff3e0", fg: "#946200" };
                if (tone.tone === "err") return { bg: "#fee8e8", fg: "#c0392b" };
                return { bg: "var(--color-background-secondary)", fg: "var(--color-text-tertiary)" };
              })();

              return (
                <div key={entry.skillKey} className="oc-card" style={{ padding: 0, overflow: "visible" }}>
                  <div
                    className="oc-sbanner"
                    style={{
                      padding: "12px 16px",
                      borderBottom: "0.5px solid var(--color-border-tertiary)",
                      gap: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 12,
                          background: entry.bundled ? "#E3F2FF" : "#F3E8FF",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          fontSize: 18,
                        }}
                      >
                        {safeString(entry.emoji) ? entry.emoji : "📦"}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.2 }}>
                          {entry.name}
                        </div>
                        <div className="oc-rsub" style={{ marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {joinNonEmpty([desc, entry.source])}
                        </div>
                      </div>
                    </div>

                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <div
                        className="oc-tag"
                        style={{
                          background: statusPillTone.bg,
                          color: statusPillTone.fg,
                          border: statusPillTone.border,
                        }}
                      >
                        {tone.label}
                      </div>
                      <ToggleLike
                        checked={enabled}
                        disabled={disabledByUpdate}
                        onChange={(next) => void toggleSkill(entry, next)}
                      />
                    </div>
                  </div>

                  <div style={{ padding: "10px 16px", display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                    <button type="button" className="oc-bs" onClick={() => openDetails(entry)}>
                      详情
                    </button>
                    {!entry.bundled && (
                      <button
                        type="button"
                        className="oc-bs"
                        onClick={() => void toggleSkill(entry, false)}
                        disabled={!enabled || disabledByUpdate}
                        title="MVP：卸载退化为禁用（enabled=false）"
                      >
                        卸载
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          : null}

        <div style={{ height: 20 }} />
      </div>

      <Modal
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>{detailsSkill?.emoji ? detailsSkill.emoji : "📦"}</span>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontWeight: 800 }}>{detailsSkill?.name ?? ""}</span>
              <span className="oc-rsub">{detailsSkill?.description ?? ""}</span>
            </div>
          </div>
        }
      >
        {detailsSkill ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="oc-card" style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div>
                  <div className="oc-slbl">状态</div>
                  <div className="oc-rsub" style={{ marginTop: 4 }}>
                    eligible: {String(detailsSkill.eligible)}
                    {" · "}
                    disabled: {String(detailsSkill.disabled)}
                    {" · "}
                    blockedByAllowlist: {String(detailsSkill.blockedByAllowlist)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div className="oc-tag" style={{ background: detailsSkill.bundled ? "#E3F2FF" : "#F3E8FF" }}>
                    {detailsSkill.bundled ? "内置" : "市场/本地"}
                  </div>
                  <div className="oc-tag" style={{ background: "var(--color-background-secondary)", color: "var(--color-text-tertiary)" }}>
                    {safeString(detailsSkill.source) || "—"}
                  </div>
                </div>
              </div>
            </div>

            <div className="oc-card" style={{ padding: 12 }}>
              <div className="oc-slbl">缺失要求（missing）</div>
              <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                <div>
                  <div className="oc-rsub">bins</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-primary)", marginTop: 4 }}>{renderList(detailsSkill.missing?.bins)}</div>
                </div>
                <div>
                  <div className="oc-rsub">anyBins</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-primary)", marginTop: 4 }}>{renderList(detailsSkill.missing?.anyBins)}</div>
                </div>
                <div>
                  <div className="oc-rsub">env</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-primary)", marginTop: 4 }}>{renderList(detailsSkill.missing?.env)}</div>
                </div>
                <div>
                  <div className="oc-rsub">config</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-primary)", marginTop: 4 }}>{renderList(detailsSkill.missing?.config)}</div>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div className="oc-rsub">os</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-primary)", marginTop: 4 }}>{renderList(detailsSkill.missing?.os)}</div>
                </div>
              </div>
            </div>

            <div className="oc-card" style={{ padding: 12 }}>
              <div className="oc-slbl">路径/元信息</div>
              <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                <div>
                  <div className="oc-rsub">skillKey</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-primary)", marginTop: 4 }}>{detailsSkill.skillKey}</div>
                </div>
                <div>
                  <div className="oc-rsub">homepage</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-primary)", marginTop: 4 }}>
                    {detailsSkill.homepage ? (
                      <a href={detailsSkill.homepage} target="_blank" rel="noreferrer">
                        {detailsSkill.homepage}
                      </a>
                    ) : (
                      "—"
                    )}
                  </div>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div className="oc-rsub">filePath / baseDir</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-primary)", marginTop: 4 }}>
                    {joinNonEmpty([detailsSkill.filePath, detailsSkill.baseDir]) || "—"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

