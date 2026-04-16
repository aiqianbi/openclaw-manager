/** 与主进程 `buildAgentMainSessionKey` / Control UI 会话 key 对齐 */
export function normalizeAgentIdForSession(raw: string): string {
  let s = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!s) return "";
  return s.length > 64 ? s.slice(0, 64) : s;
}

export function buildAgentMainSessionKey(agentIdRaw: string): string {
  const id = normalizeAgentIdForSession(agentIdRaw) || "main";
  return `agent:${id}:main`;
}
