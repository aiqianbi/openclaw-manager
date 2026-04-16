import type { Dispatch, FC, SetStateAction } from "react";

function safeString(v: unknown): string {
  if (typeof v === "string") return v;
  return v == null ? "" : String(v);
}

/** 与需求及常见 OpenClaw 配置一致 */
export const DM_POLICY_OPTIONS = ["pairing", "allowlist", "open", "disabled"] as const;
export type DmPolicy = (typeof DM_POLICY_OPTIONS)[number];

/** 与 OpenClaw config.schema 一致（如 Feishu GroupPolicyEnum：open / allowlist / disabled，无 pairing） */
export const GROUP_POLICY_OPTIONS = ["open", "allowlist", "disabled"] as const;
export type GroupPolicy = (typeof GROUP_POLICY_OPTIONS)[number];

export function parseLineArray(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function multilineFromStringArray(arr: unknown): string {
  if (!Array.isArray(arr)) return "";
  return arr
    .map((x) => String(x).trim())
    .filter(Boolean)
    .join("\n");
}

export function normalizePolicyEnum<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  const s = safeString(value).toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T[number]) : fallback;
}

function cloneDraft(d: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(d)) as Record<string, unknown>;
}

/**
 * 合并策略字段并校验；非 allowlist 时移除 allowFrom / groupAllowFrom。
 */
export function normalizeAccountPolicyOnSave(
  draft: Record<string, unknown>,
  allowFromText: string,
  groupAllowFromText: string,
): { next: Record<string, unknown>; error: string | null } {
  const next = cloneDraft(draft);
  const dm = normalizePolicyEnum(next.dmPolicy, DM_POLICY_OPTIONS, "allowlist");
  const gp = normalizePolicyEnum(next.groupPolicy, GROUP_POLICY_OPTIONS, "allowlist");
  next.dmPolicy = dm;
  next.groupPolicy = gp;

  const af = parseLineArray(allowFromText);
  const gf = parseLineArray(groupAllowFromText);

  if (dm === "allowlist" && af.length === 0) {
    return { next: draft, error: "私信策略为 allowlist 时，allowFrom 至少填写一项（每行一个 ID）。" };
  }
  if (gp === "allowlist" && gf.length === 0) {
    return { next: draft, error: "群组策略为 allowlist 时，groupAllowFrom 至少填写一项（每行一个 ID）。" };
  }

  if (dm === "allowlist") next.allowFrom = af;
  else delete next.allowFrom;

  if (gp === "allowlist") next.groupAllowFrom = gf;
  else delete next.groupAllowFrom;

  return { next, error: null };
}

export type AccountPolicyFieldsProps = {
  accountDraftObj: Record<string, unknown>;
  setAccountDraftObj: Dispatch<SetStateAction<Record<string, unknown>>>;
  allowFromText: string;
  setAllowFromText: (v: string) => void;
  groupAllowFromText: string;
  setGroupAllowFromText: (v: string) => void;
  disabled?: boolean;
};

export const AccountPolicyFields: FC<AccountPolicyFieldsProps> = ({
  accountDraftObj,
  setAccountDraftObj,
  allowFromText,
  setAllowFromText,
  groupAllowFromText,
  setGroupAllowFromText,
  disabled = false,
}) => {
  const dm = normalizePolicyEnum(accountDraftObj.dmPolicy, DM_POLICY_OPTIONS, "allowlist");
  const gp = normalizePolicyEnum(accountDraftObj.groupPolicy, GROUP_POLICY_OPTIONS, "allowlist");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontWeight: 600 }}>私信策略 dmPolicy</div>
        <select
          className="oc-inptxt"
          disabled={disabled}
          value={dm}
          onChange={(e) =>
            setAccountDraftObj((prev) => ({ ...prev, dmPolicy: (e.target as HTMLSelectElement).value }))
          }
        >
          {DM_POLICY_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        {dm === "allowlist" ? (
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="oc-rsub" style={{ fontSize: 12 }}>
              allowFrom（必填，每行一项）
            </div>
            <textarea
              className="oc-inptxt"
              disabled={disabled}
              placeholder={"例如：+8613800138000\nuser@example.com"}
              value={allowFromText}
              onChange={(e) => setAllowFromText((e.target as HTMLTextAreaElement).value)}
              style={{ minHeight: 88, resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 12 }}
            />
          </label>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontWeight: 600 }}>群组策略 groupPolicy</div>
        <select
          className="oc-inptxt"
          disabled={disabled}
          value={gp}
          onChange={(e) =>
            setAccountDraftObj((prev) => ({ ...prev, groupPolicy: (e.target as HTMLSelectElement).value }))
          }
        >
          {GROUP_POLICY_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        {gp === "allowlist" ? (
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="oc-rsub" style={{ fontSize: 12 }}>
              groupAllowFrom（必填，每行一项）
            </div>
            <textarea
              className="oc-inptxt"
              disabled={disabled}
              placeholder={"例如：oc_123\noc_456"}
              value={groupAllowFromText}
              onChange={(e) => setGroupAllowFromText((e.target as HTMLTextAreaElement).value)}
              style={{ minHeight: 88, resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 12 }}
            />
          </label>
        ) : null}
      </div>

      <div className="oc-rsub" style={{ fontSize: 11, lineHeight: 1.5 }}>
        以上字段写入当前账号块 <code>channels.&lt;渠道&gt;.accounts.&lt;accountId&gt;</code>。
        若你还在使用频道根级的 <code>dmPolicy</code>，以 OpenClaw 实际生效规则为准。
      </div>
    </div>
  );
};
