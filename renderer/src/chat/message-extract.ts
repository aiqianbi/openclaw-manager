function stripThinkingTags(text: string): string {
  return text.replace(/<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/gi, "").trim();
}

export function extractRawText(message: unknown): string | null {
  const m = message as Record<string, unknown>;
  const content = m.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((p) => {
        const item = p as Record<string, unknown>;
        if (item.type === "text" && typeof item.text === "string") {
          return item.text;
        }
        return null;
      })
      .filter((v): v is string => typeof v === "string");
    if (parts.length > 0) {
      return parts.join("\n");
    }
  }
  if (typeof m.text === "string") {
    return m.text;
  }
  return null;
}

export function extractText(message: unknown): string | null {
  const m = message as Record<string, unknown>;
  const role = typeof m.role === "string" ? m.role : "";
  const raw = extractRawText(message);
  if (!raw) {
    return null;
  }
  if (role === "assistant") {
    return stripThinkingTags(raw);
  }
  return raw;
}
