import { extractText } from "./message-extract";

const SILENT_REPLY_PATTERN = /^\s*NO_REPLY\s*$/;

function isSilentReplyStream(text: string): boolean {
  return SILENT_REPLY_PATTERN.test(text);
}

function isAssistantSilentReply(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const entry = message as Record<string, unknown>;
  const role = typeof entry.role === "string" ? entry.role.toLowerCase() : "";
  if (role !== "assistant") {
    return false;
  }
  if (typeof entry.text === "string") {
    return isSilentReplyStream(entry.text);
  }
  const text = extractText(message);
  return typeof text === "string" && isSilentReplyStream(text);
}

export type ChatEventPayload = {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "aborted" | "error";
  message?: unknown;
  errorMessage?: string;
};

export type ChatEventSlice = {
  sessionKey: string;
  chatMessages: unknown[];
  chatRunId: string | null;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  lastError: string | null;
};

function normalizeAssistantMessage(
  message: unknown,
  options: {
    roleRequirement: "required" | "optional";
    roleCaseSensitive?: boolean;
    requireContentArray?: boolean;
    allowTextField?: boolean;
  },
): Record<string, unknown> | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const candidate = message as Record<string, unknown>;
  const roleValue = candidate.role;
  if (typeof roleValue === "string") {
    const role = options.roleCaseSensitive ? roleValue : roleValue.toLowerCase();
    if (role !== "assistant") {
      return null;
    }
  } else if (options.roleRequirement === "required") {
    return null;
  }

  if (options.requireContentArray) {
    return Array.isArray(candidate.content) ? candidate : null;
  }
  if (!("content" in candidate) && !(options.allowTextField && "text" in candidate)) {
    return null;
  }
  return candidate;
}

function normalizeAbortedAssistantMessage(message: unknown): Record<string, unknown> | null {
  return normalizeAssistantMessage(message, {
    roleRequirement: "required",
    roleCaseSensitive: true,
    requireContentArray: true,
  });
}

function normalizeFinalAssistantMessage(message: unknown): Record<string, unknown> | null {
  return normalizeAssistantMessage(message, {
    roleRequirement: "optional",
    allowTextField: true,
  });
}

/** 与 Control UI `handleChatEvent` 对齐：返回更新后的可变 slice（新对象）。 */
export function applyChatEvent(prev: ChatEventSlice, payload?: ChatEventPayload): ChatEventSlice {
  if (!payload) {
    return prev;
  }
  if (payload.sessionKey !== prev.sessionKey) {
    return prev;
  }

  let chatMessages = prev.chatMessages;
  let chatRunId = prev.chatRunId;
  let chatStream = prev.chatStream;
  let chatStreamStartedAt = prev.chatStreamStartedAt;
  let lastError = prev.lastError;

  const pushMessages = (next: unknown[]) => {
    chatMessages = next;
  };

  if (payload.runId && chatRunId && payload.runId !== chatRunId) {
    if (payload.state === "final") {
      const finalMessage = normalizeFinalAssistantMessage(payload.message);
      if (finalMessage && !isAssistantSilentReply(finalMessage)) {
        pushMessages([...chatMessages, finalMessage]);
      }
      return {
        ...prev,
        chatMessages,
        chatRunId,
        chatStream,
        chatStreamStartedAt,
        lastError,
      };
    }
    return prev;
  }

  if (payload.state === "delta") {
    const next = extractText(payload.message);
    if (typeof next === "string" && !isSilentReplyStream(next)) {
      const current = chatStream ?? "";
      if (!current || next.length >= current.length) {
        chatStream = next;
      }
    }
  } else if (payload.state === "final") {
    const finalMessage = normalizeFinalAssistantMessage(payload.message);
    if (finalMessage && !isAssistantSilentReply(finalMessage)) {
      pushMessages([...chatMessages, finalMessage]);
    } else if (chatStream?.trim() && !isSilentReplyStream(chatStream)) {
      pushMessages([
        ...chatMessages,
        {
          role: "assistant",
          content: [{ type: "text", text: chatStream }],
          timestamp: Date.now(),
        },
      ]);
    }
    chatStream = null;
    chatRunId = null;
    chatStreamStartedAt = null;
  } else if (payload.state === "aborted") {
    const normalizedMessage = normalizeAbortedAssistantMessage(payload.message);
    if (normalizedMessage && !isAssistantSilentReply(normalizedMessage)) {
      pushMessages([...chatMessages, normalizedMessage]);
    } else {
      const streamedText = chatStream ?? "";
      if (streamedText.trim() && !isSilentReplyStream(streamedText)) {
        pushMessages([
          ...chatMessages,
          {
            role: "assistant",
            content: [{ type: "text", text: streamedText }],
            timestamp: Date.now(),
          },
        ]);
      }
    }
    chatStream = null;
    chatRunId = null;
    chatStreamStartedAt = null;
  } else if (payload.state === "error") {
    chatStream = null;
    chatRunId = null;
    chatStreamStartedAt = null;
    lastError = payload.errorMessage ?? "chat error";
  }

  return {
    ...prev,
    chatMessages,
    chatRunId,
    chatStream,
    chatStreamStartedAt,
    lastError,
  };
}

export function filterSilentAssistantMessages(messages: unknown[]): unknown[] {
  return messages.filter((message) => !isAssistantSilentReply(message));
}
