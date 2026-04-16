const CLAWHUB_CONVEX_QUERY_URL = "https://wry-manatee-359.convex.cloud/api/query";

export type ClawHubSortKey = "downloads" | "installs" | "stars" | "updated" | "newest" | string;
export type ClawHubSortDir = "asc" | "desc";

export type ClawHubListPublicPageV4Args = {
  dir: ClawHubSortDir;
  highlightedOnly: boolean;
  nonSuspiciousOnly: boolean;
  numItems: number;
  sort: ClawHubSortKey;
  // ClawHub/Convex 实际可能支持 cursor/offset；若后续确认字段名，再补齐即可
  cursor?: unknown;
};

export type ClawHubSkillItem = Record<string, unknown>;

export type ClawHubPublicSkillsPage = {
  items: ClawHubSkillItem[];
  nextCursor?: unknown;
  rawValue: unknown;
};

type ConvexHttpSuccess = { status: "success"; value: unknown; logLines?: string[] };
type ConvexHttpError = { status: "error"; errorMessage?: string; errorData?: unknown; logLines?: string[] };

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function pickArrayCandidate(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v;
  if (!isObject(v)) return null;
  const candidates: unknown[] = [
    v.items,
    v.skills,
    v.results,
    v.rows,
    v.data,
    v.page,
    v.list,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
    if (isObject(c)) {
      const inner = pickArrayCandidate(c);
      if (inner) return inner;
    }
  }
  return null;
}

function pickNextCursor(v: unknown): unknown | undefined {
  if (!isObject(v)) return undefined;
  return v.nextCursor ?? v.cursor ?? v.next ?? v.continuation ?? undefined;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) return promise;
  let timer: number | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(`${label} 超时（${timeoutMs}ms）`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer != null) window.clearTimeout(timer);
  });
}

async function fetchJsonDirect(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const ac = new AbortController();
  const t = window.setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(input, { ...init, signal: ac.signal });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`ClawHub 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 240)}`);
    }
    if (!res.ok) {
      throw new Error(`ClawHub HTTP ${res.status}：${text.slice(0, 240)}`);
    }
    return parsed;
  } finally {
    window.clearTimeout(t);
  }
}

async function fetchJsonViaElectronProxy(url: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const api = (window as any)?.api;
  if (!api?.httpFetch) {
    throw new Error("httpFetch 不可用（非 Electron 或未实现代理）");
  }
  const res: any = await withTimeout(
    api.httpFetch({
      url,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs,
    }),
    timeoutMs + 1500,
    "ClawHub 代理请求",
  );
  if (!res || typeof res !== "object" || res.ok !== true) {
    throw new Error((res && (res.error || res.message)) || "ClawHub 代理请求失败");
  }
  const text = String(res.bodyText ?? "");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`ClawHub 代理返回非 JSON：${text.slice(0, 240)}`);
  }
}

export async function listPublicSkillsPageV4(args: ClawHubListPublicPageV4Args, opts?: { timeoutMs?: number; preferProxy?: boolean }): Promise<ClawHubPublicSkillsPage> {
  const timeoutMs = typeof opts?.timeoutMs === "number" && opts.timeoutMs > 0 ? opts.timeoutMs : 25_000;
  const payload = {
    path: "skills:listPublicPageV4",
    format: "convex_encoded_json",
    args: [args],
  };

  const tryDirectFirst = opts?.preferProxy ? false : true;
  let raw: unknown;
  let lastErr: unknown = null;

  const attempt = async (mode: "direct" | "proxy") => {
    if (mode === "direct") {
      return await fetchJsonDirect(
        CLAWHUB_CONVEX_QUERY_URL,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
        timeoutMs,
      );
    }
    return await fetchJsonViaElectronProxy(CLAWHUB_CONVEX_QUERY_URL, payload, timeoutMs);
  };

  for (const mode of (tryDirectFirst ? (["direct", "proxy"] as const) : (["proxy", "direct"] as const))) {
    try {
      raw = await attempt(mode);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) {
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  const top = raw as any;
  const status = top && typeof top === "object" ? top.status : null;
  if (status === "error") {
    const e = top as ConvexHttpError;
    throw new Error(e.errorMessage || "ClawHub Convex 查询失败");
  }
  const value: unknown =
    status === "success" ? (top as ConvexHttpSuccess).value : isObject(top) && "value" in top ? (top as any).value : raw;

  const items = pickArrayCandidate(value) ?? [];
  const nextCursor = pickNextCursor(value);

  return { items: items as ClawHubSkillItem[], nextCursor, rawValue: value };
}

