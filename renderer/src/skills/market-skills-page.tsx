import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GatewayBrowserClient } from "@/gateway/gateway-browser-client";
import type { GatewayCallResult } from "@/types/electron-api";
import { listPublicSkillsPageV4, type ClawHubListPublicPageV4Args, type ClawHubSkillItem } from "./clawhub-client";
import { translateLiteral, type SupportedLocale } from "@/i18n/messages";

type MarketSkillsPageProps = {
  locale: SupportedLocale;
  hasElectronApi: boolean;
  gatewayConnected: boolean;
  gatewayClient: GatewayBrowserClient | null;
  gatewayCall: (method: string, params?: unknown, timeoutMs?: number) => Promise<GatewayCallResult>;
};

type InstalledSkillIndex = {
  skillKeys: Set<string>;
  byNameLower: Map<string, string>;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function safeString(v: unknown): string {
  if (typeof v === "string") return v;
  return v == null ? "" : String(v);
}

function normalizeSearch(s: string): string {
  return s.trim().toLowerCase();
}

function pickFromNested(obj: Record<string, unknown>, nestedKeys: string[], picker: (o: Record<string, unknown>) => string): string {
  for (const nk of nestedKeys) {
    const v = obj[nk];
    if (isObject(v)) {
      const got = picker(v);
      if (got) return got;
    }
  }
  return "";
}

function pickFirstString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    const s = safeString(v).trim();
    if (s) return s;
  }
  // 常见 ClawHub/Convex 嵌套：skill / owner / user / stats / meta
  const nested = pickFromNested(obj, ["skill", "plugin", "meta", "data"], (o) => pickFirstString(o, keys));
  if (nested) return nested;
  return "";
}

function pickFirstNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    const n = typeof v === "number" ? v : Number.isFinite(Number(v)) ? Number(v) : NaN;
    if (Number.isFinite(n)) return n;
  }
  for (const nk of ["stats", "skill", "meta", "data"]) {
    const v = obj[nk];
    if (isObject(v)) {
      const inner = pickFirstNumber(v, keys);
      if (inner != null) return inner;
    }
  }
  return null;
}

function pickArray(obj: Record<string, unknown>, keys: string[]): unknown[] {
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

function formatCompact(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(n));
}

function formatAuthor(v: unknown): string {
  const s = safeString(v).trim();
  if (s && s !== "[object Object]") return s;
  if (isObject(v)) {
    const name =
      pickFirstString(v, ["name", "login", "username", "displayName", "handle"]) ||
      pickFromNested(v, ["user", "owner", "profile"], (o) => pickFirstString(o, ["name", "login", "username", "displayName", "handle"]));
    return name || "";
  }
  return "";
}

function normalizeCliVersion(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return undefined;
  // 与 main.js 中的最小校验对齐（避免传入 [object Object] / 空格等）
  if (!/^[a-z0-9][a-z0-9._+-]{0,63}$/i.test(s)) return undefined;
  return s;
}

function buildInstalledIndex(skillsStatusResult: unknown): InstalledSkillIndex {
  const idx: InstalledSkillIndex = { skillKeys: new Set(), byNameLower: new Map() };
  const raw = skillsStatusResult as any;
  const arr = raw && Array.isArray(raw.skills) ? raw.skills : [];
  for (const e of arr) {
    const key = safeString(e?.skillKey).trim();
    if (key) idx.skillKeys.add(key);
    const name = safeString(e?.name).trim();
    if (name) idx.byNameLower.set(name.toLowerCase(), key || name);
  }
  return idx;
}

function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: any;
  children: any;
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
      <div className="oc-modal-panel" style={{ width: "min(980px, 100%)" }}>
        <div className="oc-modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>{title}</div>
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

async function gatewayRequestOrThrow(
  gatewayConnected: boolean,
  gatewayClient: GatewayBrowserClient | null,
  method: string,
  params: unknown,
  timeoutMs?: number,
): Promise<any> {
  if (!gatewayConnected) throw new Error("网关 WebSocket 未连接");
  if (!gatewayClient) throw new Error("网关 WebSocket client 未就绪");
  const req = gatewayClient.request(method, params);
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

function openExternal(url: string) {
  try {
    window.open(url, "_blank", "noreferrer");
  } catch {
    // ignore
  }
}

export function MarketSkillsPage(props: MarketSkillsPageProps) {
  const { locale, hasElectronApi, gatewayConnected, gatewayClient, gatewayCall } = props;
  const canUseGateway = hasElectronApi && gatewayConnected;
  const rootRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ClawHubListPublicPageV4Args["sort"]>("downloads");
  const [dir, setDir] = useState<ClawHubListPublicPageV4Args["dir"]>("desc");
  const [highlightedOnly, setHighlightedOnly] = useState(false);
  const [nonSuspiciousOnly, setNonSuspiciousOnly] = useState(false);

  const [items, setItems] = useState<ClawHubSkillItem[]>([]);
  const [nextCursor, setNextCursor] = useState<unknown | undefined>(undefined);
  const [rawMeta, setRawMeta] = useState<{ valueKeys: string; sampleKeys: string } | null>(null);

  const [installedIdx, setInstalledIdx] = useState<InstalledSkillIndex>({ skillKeys: new Set(), byNameLower: new Map() });

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsItem, setDetailsItem] = useState<ClawHubSkillItem | null>(null);

  const [installingId, setInstallingId] = useState<string | null>(null);

  const queryKey = useMemo(() => {
    return JSON.stringify({ sort, dir, highlightedOnly, nonSuspiciousOnly });
  }, [sort, dir, highlightedOnly, nonSuspiciousOnly]);

  const lastQueryKeyRef = useRef<string>("");

  const extractMeta = useCallback((rawValue: unknown, pageItems: ClawHubSkillItem[]) => {
    const keys = isObject(rawValue) ? Object.keys(rawValue).slice(0, 16).join(", ") : typeof rawValue;
    const sample = pageItems[0] && isObject(pageItems[0]) ? Object.keys(pageItems[0]).slice(0, 18).join(", ") : "";
    setRawMeta({ valueKeys: keys, sampleKeys: sample });
  }, []);

  const loadInstalledIndex = useCallback(async () => {
    if (!canUseGateway) return;
    try {
      const wsRes = await gatewayRequestOrThrow(gatewayConnected, gatewayClient, "skills.status", {}, 45_000);
      setInstalledIdx(buildInstalledIndex(wsRes));
      return;
    } catch {
      // ignore, try fallback
    }
    try {
      const r = await gatewayCall("skills.status", {}, 45_000);
      if (r.ok) {
        setInstalledIdx(buildInstalledIndex(r.result));
      }
    } catch {
      // ignore
    }
  }, [canUseGateway, gatewayCall, gatewayClient, gatewayConnected]);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await listPublicSkillsPageV4(
        { sort, dir, highlightedOnly, nonSuspiciousOnly, numItems: 25 },
        { timeoutMs: 25_000 },
      );
      setItems(res.items);
      setNextCursor(res.nextCursor);
      extractMeta(res.rawValue, res.items);
      lastQueryKeyRef.current = queryKey;
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
      setItems([]);
      setNextCursor(undefined);
      setRawMeta(null);
    } finally {
      setLoading(false);
    }
  }, [dir, extractMeta, highlightedOnly, nonSuspiciousOnly, queryKey, sort]);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    if (items.length === 0) return;
    if (nextCursor == null) return;
    setLoadingMore(true);
    setErr(null);
    try {
      const res = await listPublicSkillsPageV4(
        { sort, dir, highlightedOnly, nonSuspiciousOnly, numItems: 25, cursor: nextCursor },
        { timeoutMs: 25_000 },
      );
      setItems((prev) => [...prev, ...(res.items ?? [])]);
      setNextCursor(res.nextCursor);
      extractMeta(res.rawValue, res.items);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setLoadingMore(false);
    }
  }, [dir, extractMeta, highlightedOnly, items.length, loadingMore, nextCursor, nonSuspiciousOnly, sort]);

  useEffect(() => {
    void loadFirstPage();
    void loadInstalledIndex();
  }, [loadFirstPage, loadInstalledIndex]);

  useEffect(() => {
    if (lastQueryKeyRef.current && lastQueryKeyRef.current !== queryKey) {
      void loadFirstPage();
    }
  }, [queryKey, loadFirstPage]);

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

  const filtered = useMemo(() => {
    const s = normalizeSearch(search);
    if (!s) return items;
    return items.filter((it) => {
      if (!isObject(it)) return false;
      const name = pickFirstString(it, ["name", "title", "displayName"]);
      const desc = pickFirstString(it, ["description", "summary", "tagline"]);
      const authorObj = (it as any).author ?? (it as any).owner ?? (it as any).user ?? (it as any).publisher ?? (it as any).org ?? null;
      const author = formatAuthor(authorObj);
      const tags = pickArray(it, ["tags", "categories", "keywords"]).map((x) => safeString(x)).join(" ");
      return [name, desc, author, tags].join(" ").toLowerCase().includes(s);
    });
  }, [items, search]);

  const openDetails = useCallback((it: ClawHubSkillItem) => {
    setDetailsItem(it);
    setDetailsOpen(true);
  }, []);

  const resolveId = useCallback((it: ClawHubSkillItem): string => {
    if (!isObject(it)) return "";
    const id = pickFirstString(it, ["skillKey", "key", "id", "_id", "slug", "name"]);
    return id || "unknown";
  }, []);

  const computeInstalled = useCallback(
    (it: ClawHubSkillItem): boolean => {
      if (!isObject(it)) return false;
      const key = pickFirstString(it, ["skillKey", "key"]);
      if (key && installedIdx.skillKeys.has(key)) return true;
      const name = pickFirstString(it, ["name", "title", "displayName"]);
      if (name && installedIdx.byNameLower.has(name.toLowerCase())) return true;
      return false;
    },
    [installedIdx],
  );

  const installOne = useCallback(
    async (it: ClawHubSkillItem) => {
      if (!canUseGateway) {
        window.alert("安装仅在 Electron 且网关已连接时可用。");
        return;
      }
      const id = resolveId(it);
      if (!id) return;
      if (installingId) return;
      setInstallingId(id);
      try {
        // 尽量从条目里抽取可安装信息（字段名以实际为准）
        const o = isObject(it) ? it : {};
        const homepage =
          pickFirstString(o, ["homepage", "url", "permalink", "link"]) || "https://clawhub.ai/skills";
        const repo = pickFirstString(o, ["repo", "repository", "github", "gitUrl"]);
        const skillKey = pickFirstString(o, ["skillKey", "key", "slug", "name"]);
        const versionRaw: unknown =
          (o as any).version ??
          (o as any).latestVersion ??
          (isObject((o as any).skill) ? ((o as any).skill as any).version ?? ((o as any).skill as any).latestVersion : undefined);
        const version = normalizeCliVersion(versionRaw);

        const tryMethods = ["skills.install", "skills.add", "skills.ensure", "skills.market.install"];
        let ok = false;
        let lastError: unknown = null;

        for (const method of tryMethods) {
          try {
            await gatewayRequestOrThrow(
              gatewayConnected,
              gatewayClient,
              method,
              { skillKey, repo, version, source: "clawhub", homepage, raw: it },
              180_000,
            );
            ok = true;
            break;
          } catch (e) {
            lastError = e;
          }
        }

        if (!ok) {
          // fallback：走 clawhub install <slug>
          const api = (window as any)?.api;
          const slug = String(skillKey || "").trim();
          if (!api?.skillsInstall || !slug) {
            try {
              const msg =
                `当前网关未暴露可用的安装 RPC（已尝试：${tryMethods.join(", ")}）。\n\n` +
                `并且 Manager 未启用 CLI 安装回退（skillsInstall）。\n` +
                `你可以先打开 ClawHub 详情页手动安装。\n\n` +
                `错误：${String((lastError as any)?.message ?? lastError ?? "")}`;
              window.alert(msg);
            } finally {
              if (homepage) openExternal(homepage);
            }
            return;
          }

          const cliRes = await api.skillsInstall({ slug, version, force: false });
          if (!cliRes?.ok) {
            const tip =
              `CLI 安装失败：${String(cliRes?.error ?? "未知错误")}\n\n` +
              `你也可以在终端执行：clawhub install ${slug}` +
              (version ? ` --version ${version}` : "");
            window.alert(tip);
            return;
          }
        }

        await loadInstalledIndex();
      } finally {
        setInstallingId(null);
      }
    },
    [canUseGateway, gatewayClient, gatewayConnected, installingId, loadInstalledIndex, resolveId],
  );

  return (
    <div ref={rootRef} className="oc-models-root">
      <div className="oc-topbar">
        <div className="oc-bc">
          技能 <span style={{ opacity: 0.8 }}>&gt;</span> <b>技能市场</b>
        </div>
        <div className="oc-tr">
          <div className="oc-search">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="4"/><path d="M10.5 10.5l2.5 2.5"/></svg>
            <input
              value={search}
              onChange={(e) => setSearch((e.target as HTMLInputElement).value)}
              placeholder="搜索市场技能…"
            />
          </div>
          <button type="button" className="oc-bs" disabled={loading} onClick={() => void loadFirstPage()}>
            刷新
          </button>
        </div>
      </div>

      <div className="oc-mktab" style={{ borderBottom: "0.5px solid var(--color-border-tertiary)", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div className="oc-rsub" style={{ paddingLeft: 12 }}>
            排序
          </div>
          <select
            value={String(sort)}
            onChange={(e) => setSort((e.target as HTMLSelectElement).value)}
            style={{ padding: "6px 10px", borderRadius: 8, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" }}
          >
            <option value="downloads">Downloads</option>
            <option value="installs">Installs</option>
            <option value="stars">Stars</option>
            <option value="updated">Updated</option>
            <option value="newest">Newest</option>
          </select>

          <select
            value={dir}
            onChange={(e) => setDir((e.target as HTMLSelectElement).value as any)}
            style={{ padding: "6px 10px", borderRadius: 8, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" }}
          >
            <option value="desc">Desc</option>
            <option value="asc">Asc</option>
          </select>

          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "0 8px", userSelect: "none" }}>
            <input type="checkbox" checked={highlightedOnly} onChange={(e) => setHighlightedOnly((e.target as HTMLInputElement).checked)} />
            <span className="oc-rsub">仅高亮</span>
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "0 8px", userSelect: "none" }}>
            <input type="checkbox" checked={nonSuspiciousOnly} onChange={(e) => setNonSuspiciousOnly((e.target as HTMLInputElement).checked)} />
            <span className="oc-rsub">隐藏可疑</span>
          </label>
        </div>

        <div style={{ marginLeft: "auto", paddingRight: 12 }} className="oc-rsub">
          {rawMeta ? (
            <span title={`value.keys: ${rawMeta.valueKeys}\nitem.keys: ${rawMeta.sampleKeys}`}>
              {filtered.length}/{items.length} 条
            </span>
          ) : (
            <span>{filtered.length}/{items.length} 条</span>
          )}
        </div>
      </div>

      <div className="oc-models-scroll" style={{ padding: "12px 16px 16px" }}>
        {loading && items.length === 0 ? (
          <div className="oc-rsub" style={{ padding: 20 }}>
            加载中…
          </div>
        ) : null}

        {err ? (
          <div className="oc-banner oc-banner--warn" style={{ marginTop: 12 }}>
            {err}
          </div>
        ) : null}

        {!loading && filtered.length === 0 ? (
          <div className="oc-rsub" style={{ padding: 24, textAlign: "center" }}>
            暂无结果。你可以调整筛选或点击「刷新」。
          </div>
        ) : null}

        {filtered.map((it, i) => {
          const o = isObject(it) ? it : {};
          const name =
            pickFirstString(o, ["name", "title", "displayName", "skillName"]) ||
            pickFromNested(o, ["skill"], (sk) => pickFirstString(sk, ["name", "title", "displayName", "skillName"])) ||
            `Skill #${i + 1}`;
          const desc =
            pickFirstString(o, ["description", "summary", "tagline"]) ||
            pickFromNested(o, ["skill"], (sk) => pickFirstString(sk, ["description", "summary", "tagline"]));
          const author = formatAuthor((o as any).author ?? (o as any).owner ?? (o as any).user ?? (o as any).publisher ?? (o as any).org ?? null);
          const homepage = pickFirstString(o, ["homepage", "url", "permalink", "link"]);
          const downloads = pickFirstNumber(o, ["downloads", "downloadCount", "downloadsTotal"]);
          const stars = pickFirstNumber(o, ["stars", "starCount", "starsTotal"]);
          const suspicious = Boolean((o as any).suspicious ?? (o as any).isSuspicious ?? false);
          const highlighted = Boolean((o as any).highlighted ?? (o as any).isHighlighted ?? false);

          const id = resolveId(it);
          const isInstalled = computeInstalled(it);
          const busy = installingId === id;
          const anyInstalling = installingId != null;

          return (
            <div key={`${id}-${i}`} className="oc-card" style={{ padding: 0, overflow: "visible" }}>
              <div className="oc-sbanner" style={{ padding: "12px 16px", borderBottom: "0.5px solid var(--color-border-tertiary)", gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.2 }}>{name}</div>
                    {highlighted ? <div className="oc-tag" style={{ background: "#E3F2FF" }}>高亮</div> : null}
                    {suspicious ? <div className="oc-tag" style={{ background: "#fee8e8", color: "#c0392b" }}>可疑</div> : null}
                    {isInstalled ? <div className="oc-tag" style={{ background: "#e8f8f0", color: "#1e8a50" }}>已安装</div> : null}
                  </div>
                  <div className="oc-rsub" style={{ marginTop: 6 }}>
                    {desc || "—"}
                  </div>
                  <div className="oc-rsub" style={{ marginTop: 6 }}>
                    {author ? `作者：${author}` : null}
                  </div>
                </div>

                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div className="oc-tag" title="Downloads" style={{ background: "var(--color-background-secondary)", color: "var(--color-text-tertiary)" }}>
                    ⬇ {formatCompact(downloads)}
                  </div>
                  <div className="oc-tag" title="Stars" style={{ background: "var(--color-background-secondary)", color: "var(--color-text-tertiary)" }}>
                    ★ {formatCompact(stars)}
                  </div>
                </div>
              </div>

              <div style={{ padding: "10px 16px", display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
                {homepage ? (
                  <button type="button" className="oc-bs" onClick={() => openExternal(homepage)}>
                    打开
                  </button>
                ) : null}
                {/* <button type="button" className="oc-bs" onClick={() => openDetails(it)}>
                  详情
                </button> */}
                <button
                  type="button"
                  className="oc-bp"
                  disabled={!canUseGateway || anyInstalling || busy || isInstalled}
                  onClick={() => void installOne(it)}
                  title={
                    !canUseGateway
                      ? "需要 Electron + 网关连接"
                      : anyInstalling
                        ? "已有安装任务进行中，请稍候"
                        : ""
                  }
                >
                  {isInstalled ? "已安装" : busy ? "安装中…" : "安装"}
                </button>
              </div>
            </div>
          );
        })}

        <div style={{ padding: "14px 0", display: "flex", justifyContent: "center" }}>
          <button type="button" className="oc-bs" disabled={loadingMore || nextCursor == null} onClick={() => void loadMore()}>
            {nextCursor == null ? "没有更多" : loadingMore ? "加载中…" : "加载更多"}
          </button>
        </div>
      </div>

      <Modal
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title={
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontWeight: 800 }}>{detailsItem && isObject(detailsItem) ? pickFirstString(detailsItem, ["name", "title", "displayName"]) : "详情"}</span>
            <span className="oc-rsub" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {detailsItem && isObject(detailsItem) ? pickFirstString(detailsItem, ["description", "summary", "tagline"]) : ""}
            </span>
          </div>
        }
      >
        {detailsItem ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="oc-card" style={{ padding: 12 }}>
              <div className="oc-slbl">原始字段（便于你调试映射）</div>
              <pre style={{ marginTop: 8, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {JSON.stringify(detailsItem, null, 2)}
              </pre>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

