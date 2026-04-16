import type { GatewaySessionRow, SessionsListResult } from "@/types/sessions";

const CHANNEL_LABELS: Record<string, string> = {
  bluebubbles: "iMessage",
  telegram: "Telegram",
  discord: "Discord",
  signal: "Signal",
  slack: "Slack",
  whatsapp: "WhatsApp",
  matrix: "Matrix",
  email: "Email",
  sms: "SMS",
};

const KNOWN_CHANNEL_KEYS = Object.keys(CHANNEL_LABELS);

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type SessionKeyInfo = {
  prefix: string;
  fallbackName: string;
};

/** 自 Control UI `parseSessionKey` 精简移植 */
export function parseSessionKey(key: string): SessionKeyInfo {
  const normalized = key.toLowerCase();
  if (key === "main" || key === "agent:main:main") {
    return { prefix: "", fallbackName: "Main Session" };
  }
  if (key.includes(":subagent:")) {
    return { prefix: "Subagent:", fallbackName: "Subagent:" };
  }
  if (normalized.startsWith("cron:") || key.includes(":cron:")) {
    return { prefix: "Cron:", fallbackName: "Cron Job:" };
  }
  const directMatch = key.match(/^agent:[^:]+:([^:]+):direct:(.+)$/);
  if (directMatch) {
    const channel = directMatch[1];
    const identifier = directMatch[2];
    const channelLabel = CHANNEL_LABELS[channel] ?? capitalize(channel);
    return { prefix: "", fallbackName: `${channelLabel} · ${identifier}` };
  }
  const groupMatch = key.match(/^agent:[^:]+:([^:]+):group:(.+)$/);
  if (groupMatch) {
    const channel = groupMatch[1];
    const channelLabel = CHANNEL_LABELS[channel] ?? capitalize(channel);
    return { prefix: "", fallbackName: `${channelLabel} Group` };
  }
  for (const ch of KNOWN_CHANNEL_KEYS) {
    if (key === ch || key.startsWith(`${ch}:`)) {
      return { prefix: "", fallbackName: `${CHANNEL_LABELS[ch]} Session` };
    }
  }
  return { prefix: "", fallbackName: key };
}

export function resolveSessionDisplayName(key: string, row?: GatewaySessionRow): string {
  const label = row?.label?.trim() || "";
  const displayName = row?.displayName?.trim() || "";
  const { prefix, fallbackName } = parseSessionKey(key);

  const applyTypedPrefix = (name: string): string => {
    if (!prefix) {
      return name;
    }
    const prefixPattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i");
    return prefixPattern.test(name) ? name : `${prefix} ${name}`;
  };

  if (label && label !== key) {
    return applyTypedPrefix(label);
  }
  if (displayName && displayName !== key) {
    return applyTypedPrefix(displayName);
  }
  return fallbackName;
}

export function isCronSessionKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith("cron:")) {
    return true;
  }
  if (!normalized.startsWith("agent:")) {
    return false;
  }
  const parts = normalized.split(":").filter(Boolean);
  if (parts.length < 3) {
    return false;
  }
  const rest = parts.slice(2).join(":");
  return rest.startsWith("cron:");
}

/** 与 Control UI 一致：默认隐藏非当前会话的 Cron 会话条目 */
export function filterSessionsForChatPicker(
  rows: GatewaySessionRow[],
  currentKey: string,
  hideCron: boolean,
): GatewaySessionRow[] {
  return rows.filter((row) => {
    if (row.key === currentKey) {
      return true;
    }
    if (row.kind === "global" || row.kind === "unknown") {
      return false;
    }
    if (hideCron && isCronSessionKey(row.key)) {
      return false;
    }
    return true;
  });
}

export type SessionPickOption = { key: string; label: string; title: string };

export function buildSessionPickOptions(
  sessions: SessionsListResult | null,
  currentKey: string,
  hideCron = true,
): SessionPickOption[] {
  const rows = sessions?.sessions ?? [];
  const filtered = filterSessionsForChatPicker(rows, currentKey, hideCron);
  const byKey = new Map(filtered.map((r) => [r.key, r]));
  const keys = new Set<string>();
  for (const r of filtered) {
    keys.add(r.key);
  }
  if (currentKey && !keys.has(currentKey)) {
    keys.add(currentKey);
    byKey.set(currentKey, { key: currentKey, kind: "direct", updatedAt: null });
  }
  const ordered = [...keys];
  return ordered.map((key) => {
    const row = byKey.get(key);
    return {
      key,
      label: resolveSessionDisplayName(key, row),
      title: key,
    };
  });
}
