import { useCallback, useEffect, useImperativeHandle, useMemo, useState, forwardRef } from "react";
import { Clock, Play, Pause, XCircle, Plus, RefreshCw } from "lucide-react";
import type { GatewayBrowserClient } from "@/gateway/gateway-browser-client";
import type { GatewayCallResult } from "@/types/electron-api";
import {
  buildCronAddPayload,
  defaultCronCreateForm,
  type CronCreateFormInput,
  type CronFormDeliveryMode,
  type CronScheduleKind,
} from "./cron-add-payload";

export type CronPageHandle = {
  refresh: () => void;
  openCreate: () => void;
  loading: boolean;
  createBusy: boolean;
  canUseGateway: boolean;
};

type CronPageProps = {
  hasElectronApi: boolean;
  gatewayConnected: boolean;
  gatewayClient: GatewayBrowserClient | null;
  gatewayCall: (method: string, params?: unknown, timeoutMs?: number) => Promise<GatewayCallResult>;
};

function safeString(v: unknown): string {
  if (typeof v === "string") return v;
  return v == null ? "" : String(v);
}

type CronJobRow = {
  id?: string;
  name?: string;
  enabled?: boolean;
  schedule?: unknown;
  state?: {
    runningAtMs?: number;
    lastRunStatus?: string;
    lastStatus?: string;
  };
};

function scheduleSummary(schedule: unknown): string {
  if (!schedule || typeof schedule !== "object") return "—";
  const s = schedule as Record<string, unknown>;
  const kind = safeString(s.kind).toLowerCase();
  if (kind === "at") return `单次 · ${safeString(s.at) || "—"}`;
  if (kind === "every") {
    const ms = typeof s.everyMs === "number" ? s.everyMs : Number(s.everyMs);
    if (!Number.isFinite(ms)) return "间隔 · —";
    if (ms >= 3600_000 && ms % 3600_000 === 0) return `每 ${ms / 3600_000} 小时`;
    if (ms >= 60_000 && ms % 60_000 === 0) return `每 ${ms / 60_000} 分钟`;
    return `每 ${ms} ms`;
  }
  if (kind === "cron") {
    const expr = safeString(s.expr);
    const tz = safeString(s.tz);
    return tz ? `${expr} (${tz})` : expr || "cron";
  }
  return JSON.stringify(schedule);
}

function jobStatusLabel(job: CronJobRow): { text: string; tone: "ok" | "warn" | "err" | "muted" } {
  const st = job.state;
  if (st?.runningAtMs != null && Number(st.runningAtMs) > 0) {
    return { text: "运行中", tone: "ok" };
  }
  if (job.enabled === false) return { text: "已暂停", tone: "warn" };
  const ls = safeString(st?.lastRunStatus || st?.lastStatus);
  if (ls === "error") return { text: "失败", tone: "err" };
  if (ls === "ok") return { text: "正常", tone: "ok" };
  if (ls === "skipped") return { text: "跳过", tone: "muted" };
  return { text: "待调度", tone: "muted" };
}

export const CronPage = forwardRef<CronPageHandle, CronPageProps>(function CronPage(props, ref) {
  const { hasElectronApi, gatewayConnected, gatewayClient, gatewayCall } = props;

  const [cronStatus, setCronStatus] = useState<unknown>(null);
  const [cronJobs, setCronJobs] = useState<unknown[]>([]);
  const [cronLoading, setCronLoading] = useState(false);
  const [cronErr, setCronErr] = useState<string | null>(null);

  const [agentsList, setAgentsList] = useState<unknown[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [deliveryChannelSuggestions, setDeliveryChannelSuggestions] = useState<string[]>(["last"]);
  const [deliveryChannelsLoading, setDeliveryChannelsLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CronCreateFormInput>(() => defaultCronCreateForm());
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);

  const canUseGateway = hasElectronApi && gatewayConnected;

  const loadCron = useCallback(async () => {
    if (!canUseGateway) return;
    setCronLoading(true);
    setCronErr(null);
    try {
      const st = await gatewayCall("cron.status", {}, 45000);
      if (st.ok) setCronStatus(st.result ?? null);
      else setCronErr(st.error ?? "cron.status 失败");

      const list = await gatewayCall(
        "cron.list",
        { includeDisabled: true, limit: 200, offset: 0 },
        60000,
      );
      if (!list.ok) {
        setCronErr((prev) => prev ?? list.error ?? "cron.list 失败");
        setCronJobs([]);
        return;
      }
      const payload = list.result as { jobs?: unknown[] } | undefined;
      setCronJobs(Array.isArray(payload?.jobs) ? payload.jobs : []);
    } finally {
      setCronLoading(false);
    }
  }, [canUseGateway, gatewayCall]);

  useImperativeHandle(ref, () => ({
    refresh: () => void loadCron(),
    openCreate: () => openCreateModal(),
    loading: cronLoading,
    createBusy,
    canUseGateway,
  }), [loadCron, cronLoading, createBusy, canUseGateway]);

  const loadAgents = useCallback(async () => {
    if (!gatewayClient || !gatewayConnected) {
      setAgentsList([]);
      return;
    }
    setAgentsLoading(true);
    try {
      const res = await gatewayClient.request<{ agents?: unknown[] }>("agents.list", {});
      setAgentsList(Array.isArray(res?.agents) ? res.agents : []);
    } catch {
      setAgentsList([]);
    } finally {
      setAgentsLoading(false);
    }
  }, [gatewayClient, gatewayConnected]);

  const loadDeliveryChannelOptions = useCallback(async () => {
    if (!canUseGateway) {
      setDeliveryChannelSuggestions(["last"]);
      return;
    }
    setDeliveryChannelsLoading(true);
    try {
      const r = await gatewayCall("channels.status", {}, 25_000);
      if (!r.ok) {
        setDeliveryChannelSuggestions(["last"]);
        return;
      }
      const order = (r.result as { channelOrder?: unknown } | undefined)?.channelOrder;
      const ids = Array.isArray(order)
        ? order.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        : [];
      const skip = new Set(["webchat"]);
      const rest = ids.filter((id) => !skip.has(id.trim().toLowerCase()));
      const merged = ["last", ...rest];
      const seen = new Set<string>();
      setDeliveryChannelSuggestions(
        merged.filter((v) => {
          const k = v.trim().toLowerCase();
          if (!k || seen.has(k)) return false;
          seen.add(k);
          return true;
        }),
      );
    } finally {
      setDeliveryChannelsLoading(false);
    }
  }, [canUseGateway, gatewayCall]);

  useEffect(() => {
    void loadCron();
  }, [loadCron]);

  useEffect(() => {
    if (createOpen) void loadAgents();
  }, [createOpen, loadAgents]);

  useEffect(() => {
    if (createOpen) void loadDeliveryChannelOptions();
  }, [createOpen, loadDeliveryChannelOptions]);

  const rows = useMemo(() => cronJobs as CronJobRow[], [cronJobs]);

  const agentIdOptions = useMemo(() => {
    const ids: string[] = [];
    for (const a of agentsList) {
      const id = safeString((a as { id?: unknown })?.id).trim();
      if (id) ids.push(id);
    }
    return ids;
  }, [agentsList]);

  const stats = useMemo(() => {
    const total = rows.length;
    let paused = 0;
    let running = 0;
    let failed = 0;
    for (const j of rows) {
      if (j.enabled === false) paused += 1;
      const st = j.state;
      if (st?.runningAtMs != null && Number(st.runningAtMs) > 0) running += 1;
      const ls = safeString(st?.lastRunStatus || st?.lastStatus);
      if (ls === "error") failed += 1;
    }
    return { total, paused, running, failed };
  }, [rows]);

  function openCreateModal() {
    setCreateForm(defaultCronCreateForm());
    setCreateErr(null);
    setCreateOpen(true);
  }

  function closeCreateModal() {
    setCreateOpen(false);
    setCreateErr(null);
    setCreateBusy(false);
  }

  async function submitCreate() {
    const built = buildCronAddPayload(createForm);
    if (!built.ok) {
      setCreateErr(built.error);
      return;
    }
    setCreateErr(null);
    setCreateBusy(true);
    try {
      const r = await gatewayCall("cron.add", built.payload, 120_000);
      if (!r.ok) {
        setCreateErr(r.error ?? "创建失败");
        return;
      }
      closeCreateModal();
      void loadCron();
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <>
      <div className="oc-page" style={{ padding: 0, gap: 0 }}>
        <div style={{ padding: "16px 16px 0" }}>
          {!canUseGateway ? (
            <div className="oc-card" style={{ padding: 14 }}>
              <div className="oc-rsub">
                {hasElectronApi
                  ? "请先启动网关并等待 WebSocket 连接后再管理定时任务。"
                  : "定时任务仅在 Electron 环境与已连接网关时可用。"}
              </div>
            </div>
          ) : null}

          {canUseGateway ? (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 10,
                }}
              >
                {([
                  { icon: <Clock size={18} aria-hidden />, color: "#2563eb", bg: "#eff6ff", label: "任务总数", value: stats.total },
                  { icon: <Play size={18} aria-hidden />, color: "#16a34a", bg: "#f0fdf4", label: "运行中", value: stats.running },
                  { icon: <Pause size={18} aria-hidden />, color: "#ca8a04", bg: "#fefce8", label: "已暂停", value: stats.paused },
                  { icon: <XCircle size={18} aria-hidden />, color: "#dc2626", bg: "#fef2f2", label: "失败", value: stats.failed },
                ] as const).map((card) => (
                  <div
                    key={card.label}
                    className="oc-card oc-stat-card"
                  >
                    <div className="oc-stat-card__icon" style={{ background: card.bg, color: card.color }}>
                      {card.icon}
                    </div>
                    <div>
                      <div className="oc-stat-card__label">{card.label}</div>
                      <div className="oc-stat-card__value">{card.value}</div>
                    </div>
                  </div>
                ))}
              </div>

              {cronErr ? (
                <div className="oc-banner oc-banner--warn" style={{ marginTop: 10 }}>{cronErr}</div>
              ) : null}
            </>
          ) : null}
        </div>

        {canUseGateway ? (
          <div style={{ padding: "12px 16px 16px" }}>
            <div className="oc-card" style={{ padding: 0, overflow: "hidden" }}>
              {cronLoading && rows.length === 0 ? (
                <div className="oc-rsub" style={{ padding: 20, textAlign: "center" }}>加载中…</div>
              ) : rows.length === 0 ? (
                <div className="oc-empty">
                  <div className="oc-empty__icon">
                    <Clock size={40} strokeWidth={1} aria-hidden />
                  </div>
                  <div className="oc-empty__title">暂无定时任务</div>
                  <div className="oc-empty__desc">
                    创建定时任务以自动化 AI 工作流。
                  </div>
                  <button type="button" className="oc-bp" style={{ marginTop: 16 }} onClick={openCreateModal} disabled={createBusy}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Plus size={16} aria-hidden />
                      创建第一个任务
                    </span>
                  </button>
                </div>
              ) : (
                rows.map((job, idx) => {
                  const id = safeString(job.id);
                  const name = safeString(job.name) || id || "未命名";
                  const enabled = job.enabled !== false;
                  const meta = jobStatusLabel(job);
                  const badgeStyle =
                    meta.tone === "ok"
                      ? { background: "#dcfce7", color: "#166534" }
                      : meta.tone === "warn"
                        ? { background: "#fef9c3", color: "#854d0e" }
                        : meta.tone === "err"
                          ? { background: "#fee2e2", color: "#991b1b" }
                          : { background: "var(--color-background-secondary)", color: "var(--color-text-secondary)" };
                  return (
                    <div
                      key={id || `${name}-${idx}`}
                      className="oc-row"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "14px 16px",
                        borderBottom: idx < rows.length - 1 ? "0.5px solid var(--color-border-tertiary)" : "none",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: enabled ? "#f0fdf4" : "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: enabled ? "#16a34a" : "#aaa" }}>
                          <Clock size={18} aria-hidden />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{name}</span>
                            <span
                              style={{
                                fontSize: 11,
                                padding: "1px 8px",
                                borderRadius: 999,
                                fontWeight: 600,
                                whiteSpace: "nowrap",
                                ...badgeStyle,
                              }}
                            >
                              {meta.text}
                            </span>
                          </div>
                          <div className="oc-rsub" style={{ fontSize: 12, marginTop: 3 }}>
                            {scheduleSummary(job.schedule)}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button
                          type="button"
                          className="oc-bs"
                          disabled={!id || cronLoading}
                          onClick={() =>
                            void (async () => {
                              const r = await gatewayCall("cron.update", { id, patch: { enabled: !enabled } }, 60000);
                              if (!r.ok) window.alert(r.error ?? "更新失败");
                              else void loadCron();
                            })()
                          }
                        >
                          {enabled ? "禁用" : "启用"}
                        </button>
                        <button
                          type="button"
                          className="oc-bs"
                          disabled={!id || cronLoading}
                          onClick={() =>
                            void (async () => {
                              const r = await gatewayCall("cron.run", { id, mode: "force" }, 120000);
                              if (!r.ok) window.alert(r.error ?? "运行失败");
                              else void loadCron();
                            })()
                          }
                        >
                          立即运行
                        </button>
                        <button
                          type="button"
                          className="oc-bs"
                          style={{ color: "#dc2626" }}
                          disabled={!id || cronLoading}
                          onClick={() =>
                            void (async () => {
                              if (!window.confirm(`确定删除定时任务「${name}」？`)) return;
                              const r = await gatewayCall("cron.remove", { id }, 60000);
                              if (!r.ok) window.alert(r.error ?? "删除失败");
                              else void loadCron();
                            })()
                          }
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <details style={{ marginTop: 12 }} className="oc-rsub">
              <summary style={{ cursor: "pointer", fontSize: 12 }}>调度器状态</summary>
              <pre
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  whiteSpace: "pre-wrap",
                  maxHeight: 160,
                  overflow: "auto",
                  background: "var(--color-background-secondary)",
                  padding: 10,
                  borderRadius: 8,
                }}
              >
                {JSON.stringify(cronStatus ?? {}, null, 2)}
              </pre>
            </details>
          </div>
        ) : null}
      </div>

      {createOpen ? (
        <div
          className="oc-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeCreateModal();
          }}
        >
          <div className="oc-modal-panel" style={{ width: "min(560px, 100%)" }}>
            <div className="oc-modal-header">
              <div>
                <div className="oc-modal-title">新建定时任务</div>
                <div className="oc-rsub" style={{ fontSize: 11, marginTop: 2 }}>
                  将创建一条向指定智能体发送消息的定时任务
                </div>
              </div>
              <button type="button" className="oc-bs" disabled={createBusy} onClick={closeCreateModal} title="关闭"
                style={{ width: 30, height: 30, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8 }}>
                <XCircle size={15} />
              </button>
            </div>
            <div className="oc-modal-body">

              {createErr ? (
                <div className="oc-banner oc-banner--warn">{createErr}</div>
              ) : null}

              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontWeight: 600 }}>任务名称</span>
                <input
                  className="oc-inptxt"
                  value={createForm.name}
                  disabled={createBusy}
                  placeholder="例如：每日晨报"
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: (e.target as HTMLInputElement).value }))}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontWeight: 600 }}>智能体 agentId</span>
                <select
                  className="oc-inptxt"
                  value={agentIdOptions.includes(createForm.agentId) ? createForm.agentId : ""}
                  disabled={createBusy || agentsLoading}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, agentId: (e.target as HTMLSelectElement).value }))
                  }
                >
                  <option value="">从列表选择…</option>
                  {agentsList.map((a) => {
                    const id = safeString((a as { id?: unknown })?.id).trim();
                    if (!id) return null;
                    const nm =
                      safeString((a as { identity?: { name?: unknown } })?.identity?.name).trim() ||
                      safeString((a as { name?: unknown })?.name).trim() ||
                      id;
                    return (
                      <option key={id} value={id}>
                        {nm}（{id}）
                      </option>
                    );
                  })}
                </select>
                <input
                  className="oc-inptxt"
                  placeholder="agentId（可仅手动填写，或与下拉一致）"
                  value={createForm.agentId}
                  disabled={createBusy}
                  onChange={(e) => setCreateForm((f) => ({ ...f, agentId: (e.target as HTMLInputElement).value.trim() }))}
                />
                {agentsLoading ? <span className="oc-rsub" style={{ fontSize: 11 }}>正在加载智能体列表…</span> : null}
              </label>

              <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
                <legend style={{ fontWeight: 600, marginBottom: 8 }}>调度</legend>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                  {(
                    [
                      ["at", "单次"],
                      ["every", "固定间隔"],
                      ["cron", "Cron 表达式"],
                    ] as const
                  ).map(([k, label]) => (
                    <label key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="sched"
                        checked={createForm.scheduleKind === k}
                        disabled={createBusy}
                        onChange={() => setCreateForm((f) => ({ ...f, scheduleKind: k as CronScheduleKind }))}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                {createForm.scheduleKind === "at" ? (
                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span className="oc-rsub" style={{ fontSize: 12 }}>本地时间</span>
                    <input
                      className="oc-inptxt"
                      type="datetime-local"
                      disabled={createBusy}
                      value={createForm.scheduleAtLocal}
                      onChange={(e) =>
                        setCreateForm((f) => ({ ...f, scheduleAtLocal: (e.target as HTMLInputElement).value }))
                      }
                    />
                  </label>
                ) : null}
                {createForm.scheduleKind === "every" ? (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span className="oc-rsub" style={{ fontSize: 12 }}>间隔数值</span>
                      <input
                        className="oc-inptxt"
                        type="number"
                        min={1}
                        disabled={createBusy}
                        value={createForm.everyValue}
                        onChange={(e) =>
                          setCreateForm((f) => ({
                            ...f,
                            everyValue: Number((e.target as HTMLInputElement).value) || 0,
                          }))
                        }
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span className="oc-rsub" style={{ fontSize: 12 }}>单位</span>
                      <select
                        className="oc-inptxt"
                        disabled={createBusy}
                        value={createForm.everyUnit}
                        onChange={(e) =>
                          setCreateForm((f) => ({
                            ...f,
                            everyUnit: (e.target as HTMLSelectElement).value as "minutes" | "hours",
                          }))
                        }
                      >
                        <option value="minutes">分钟</option>
                        <option value="hours">小时</option>
                      </select>
                    </label>
                  </div>
                ) : null}
                {createForm.scheduleKind === "cron" ? (
                  <>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span className="oc-rsub" style={{ fontSize: 12 }}>表达式（cron）</span>
                      <input
                        className="oc-inptxt"
                        disabled={createBusy}
                        value={createForm.cronExpr}
                        placeholder="0 * * * *"
                        onChange={(e) =>
                          setCreateForm((f) => ({ ...f, cronExpr: (e.target as HTMLInputElement).value }))
                        }
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                      <span className="oc-rsub" style={{ fontSize: 12 }}>时区 tz（可选）</span>
                      <input
                        className="oc-inptxt"
                        disabled={createBusy}
                        value={createForm.cronTz}
                        placeholder="例如 Asia/Shanghai"
                        onChange={(e) =>
                          setCreateForm((f) => ({ ...f, cronTz: (e.target as HTMLInputElement).value }))
                        }
                      />
                    </label>
                  </>
                ) : null}
              </fieldset>

              <div
                style={{
                  border: "0.5px solid var(--color-border-tertiary)",
                  borderRadius: 10,
                  padding: "12px 12px 10px",
                  background: "var(--color-background-secondary)",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13 }}>投递</div>
                <p className="oc-rsub" style={{ fontSize: 11, margin: "4px 0 10px", lineHeight: 1.45 }}>
                  选择运行摘要的发送位置。
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: "1 1 200px", minWidth: 0 }}>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>结果投递</span>
                    <select
                      className="oc-inptxt"
                      disabled={createBusy}
                      value={createForm.deliveryMode}
                      onChange={(e) =>
                        setCreateForm((f) => ({
                          ...f,
                          deliveryMode: (e.target as HTMLSelectElement).value as CronFormDeliveryMode,
                        }))
                      }
                    >
                      <option value="announce">发布摘要（默认）</option>
                      <option value="none">不发布（仅内部）</option>
                    </select>
                    <span className="oc-rsub" style={{ fontSize: 11, lineHeight: 1.4 }}>
                      发布将摘要发送到聊天；不发布则任务仅在网关内执行。
                    </span>
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: "1 1 200px", minWidth: 0 }}>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>频道</span>
                    <input
                      className="oc-inptxt"
                      list="cron-delivery-channels"
                      disabled={createBusy || createForm.deliveryMode !== "announce"}
                      value={createForm.deliveryChannel}
                      placeholder="last 或频道 id"
                      onChange={(e) =>
                        setCreateForm((f) => ({ ...f, deliveryChannel: (e.target as HTMLInputElement).value }))
                      }
                    />
                    <datalist id="cron-delivery-channels">
                      {deliveryChannelSuggestions.map((id) => (
                        <option key={id} value={id} />
                      ))}
                    </datalist>
                    <span className="oc-rsub" style={{ fontSize: 11, lineHeight: 1.4 }}>
                      {deliveryChannelsLoading ? "正在加载频道列表…" : "选择接收摘要的频道；默认 last 表示上一次活跃会话所在频道。"}
                    </span>
                  </label>
                </div>
                <label style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 10 }}>
                  <span style={{ fontWeight: 600, fontSize: 12 }}>收件人</span>
                  <input
                    className="oc-inptxt"
                    disabled={createBusy || createForm.deliveryMode !== "announce"}
                    value={createForm.deliveryTo}
                    placeholder="+1555… 或聊天 ID"
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, deliveryTo: (e.target as HTMLInputElement).value }))
                    }
                  />
                  <span className="oc-rsub" style={{ fontSize: 11, lineHeight: 1.4 }}>
                    可选收件人覆盖（聊天 ID、电话或用户 ID）。
                  </span>
                </label>
              </div>

              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontWeight: 600 }}>消息内容</span>
                <textarea
                  className="oc-inptxt"
                  disabled={createBusy}
                  rows={5}
                  value={createForm.message}
                  placeholder="将作为 agentTurn 的 message 发送给该智能体"
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, message: (e.target as HTMLTextAreaElement).value }))
                  }
                />
              </label>

              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={createForm.enabled}
                  disabled={createBusy}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, enabled: (e.target as HTMLInputElement).checked }))
                  }
                />
                <span>创建后立即启用</span>
              </label>
            </div>
            </div>
            <div className="oc-modal-footer">
              <button type="button" className="oc-bs" disabled={createBusy} onClick={closeCreateModal}>
                取消
              </button>
              <button type="button" className="oc-bp" disabled={createBusy || !canUseGateway} onClick={() => void submitCreate()}>
                {createBusy ? "提交中…" : "创建"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
});
