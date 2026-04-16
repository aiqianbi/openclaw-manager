export type PluginItem = {
  id?: string;
  enabled?: boolean;
  status?: string;
  channelIds?: string[];
  name?: string;
  description?: string;
};

function tryParseJsonLoose(text: string): unknown {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) return null;
    try {
      return JSON.parse(raw.slice(first, last + 1));
    } catch {
      return null;
    }
  }
}

/** 兼容主进程 / CLI 多种 JSON 形状：result.plugins、result.data.plugins、result.output 字符串等 */
export function normalizePluginsFromResult(result: unknown): PluginItem[] {
  if (result == null) return [];
  if (Array.isArray(result)) {
    return result.length && result.every((x) => x && typeof x === "object") ? (result as PluginItem[]) : [];
  }
  if (typeof result !== "object") return [];
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.plugins)) return r.plugins as PluginItem[];
  const data = r.data;
  if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).plugins)) {
    return (data as { plugins: PluginItem[] }).plugins;
  }
  if (typeof r.output === "string") {
    const j = tryParseJsonLoose(r.output);
    if (j && typeof j === "object" && Array.isArray((j as Record<string, unknown>).plugins)) {
      return (j as { plugins: PluginItem[] }).plugins;
    }
  }
  return [];
}
