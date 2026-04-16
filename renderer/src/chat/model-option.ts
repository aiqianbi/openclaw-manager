import type { ModelCatalogEntry } from "@/types/model-catalog";
import type { GatewaySessionRow, SessionsListResult } from "@/types/sessions";

export function buildQualifiedChatModelValue(model: string, provider?: string | null): string {
  const trimmedModel = model.trim();
  if (!trimmedModel) {
    return "";
  }
  const trimmedProvider = provider?.trim();
  return trimmedProvider ? `${trimmedProvider}/${trimmedModel}` : trimmedModel;
}

export function buildChatModelOption(entry: ModelCatalogEntry): { value: string; label: string } {
  const provider = entry.provider?.trim();
  return {
    value: buildQualifiedChatModelValue(entry.id, provider),
    label: provider ? `${entry.id} · ${provider}` : entry.id,
  };
}

function stripProviderPrefix(value: string): string {
  return value.includes("/") ? value.split("/").slice(1).join("/") : value;
}

/** Match Control UI resolveServerChatModelValue */
export function resolveServerChatModelValue(entry: ModelCatalogEntry, raw: string | null | undefined): string {
  const modelRaw = raw?.trim() ?? "";
  if (!modelRaw) {
    return "";
  }
  const provider = entry.provider?.trim() ?? "";
  const entryValue = buildQualifiedChatModelValue(entry.id, provider);
  if (modelRaw === entry.id || modelRaw === entryValue) {
    return entryValue;
  }
  if (provider && modelRaw === `${provider}/${entry.id}`) {
    return entryValue;
  }
  if (!provider && modelRaw.includes("/")) {
    const stripped = stripProviderPrefix(modelRaw);
    if (stripped === entry.id) {
      return entryValue;
    }
  }
  return entryValue;
}

/** Align with Control UI normalizeChatModelOverrideValue */
export function normalizeChatModelOverrideValue(
  catalog: ModelCatalogEntry[],
  raw: string | null | undefined,
  defaults?: { model?: string | null } | null,
): string {
  const candidate = raw?.trim() ?? "";
  if (!candidate) {
    const fallback = defaults?.model?.trim() ?? "";
    return fallback;
  }
  for (const entry of catalog) {
    const resolved = resolveServerChatModelValue(entry, candidate);
    if (resolved && (candidate === entry.id || candidate === resolved)) {
      return resolved;
    }
    const entryValue = buildQualifiedChatModelValue(entry.id, entry.provider);
    if (candidate === entry.id || candidate === entryValue) {
      return entryValue;
    }
    const provider = entry.provider?.trim();
    if (provider && candidate === `${provider}/${entry.id}`) {
      return entryValue;
    }
  }
  return candidate;
}

export type ChatModelSelectOption = { value: string; label: string };

/** Catalog options + defaults + current session model override (Control UI pattern). */
export function buildChatModelOptions(
  catalog: ModelCatalogEntry[],
  sessionsResult: SessionsListResult | null,
  sessionKey: string,
  modelOverride: string | null | undefined,
): ChatModelSelectOption[] {
  const base = catalog.map((e) => buildChatModelOption(e));
  const extras: ChatModelSelectOption[] = [];
  const seen = new Set(base.map((o) => o.value));

  const pushExtra = (raw: string | null | undefined, labelPrefix: string) => {
    const trimmed = raw?.trim() ?? "";
    if (!trimmed) return;
    const normalized = normalizeChatModelOverrideValue(catalog, trimmed, sessionsResult?.defaults ?? null);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    extras.push({ value: normalized, label: `${labelPrefix}: ${normalized}` });
  };

  pushExtra(sessionsResult?.defaults?.model, "Default");
  if (sessionKey) {
    const row = sessionsResult?.sessions.find((s) => s.key === sessionKey);
    pushExtra(row?.model, "Session");
    pushExtra(modelOverride, "Override");
  } else {
    pushExtra(modelOverride, "Override");
  }

  return [...extras, ...base];
}
