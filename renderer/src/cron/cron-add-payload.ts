/**
 * 构建网关 cron.add 载荷，与 OpenClaw CronAddParamsSchema 及官方测试用例对齐。
 * @see OpenClaw: agentTurn + sessionTarget isolated + wakeMode next-heartbeat
 */

export type CronScheduleKind = "at" | "every" | "cron";

/** 与 CronDeliverySchema.mode 对应：发布摘要 → announce；仅内部执行 → none */
export type CronFormDeliveryMode = "announce" | "none";

export type CronCreateFormInput = {
  name: string;
  agentId: string;
  enabled: boolean;
  scheduleKind: CronScheduleKind;
  /** datetime-local 值，如 2026-03-30T14:30 */
  scheduleAtLocal: string;
  everyValue: number;
  everyUnit: "minutes" | "hours";
  cronExpr: string;
  cronTz: string;
  message: string;
  /** 运行结果摘要投递方式 */
  deliveryMode: CronFormDeliveryMode;
  /** 频道：last 或网关已注册的 channel id（如 telegram） */
  deliveryChannel: string;
  /** 可选收件人：聊天 ID、电话、用户 ID 等 */
  deliveryTo: string;
};

export type CronAddBuildResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string };

export function defaultCronCreateForm(): CronCreateFormInput {
  return {
    name: "",
    agentId: "",
    enabled: true,
    scheduleKind: "every",
    scheduleAtLocal: "",
    everyValue: 60,
    everyUnit: "minutes",
    cronExpr: "0 * * * *",
    cronTz: "",
    message: "",
    deliveryMode: "announce",
    deliveryChannel: "last",
    deliveryTo: "",
  };
}

function buildSchedule(form: CronCreateFormInput): { ok: true; schedule: Record<string, unknown> } | { ok: false; error: string } {
  if (form.scheduleKind === "at") {
    const raw = form.scheduleAtLocal.trim();
    if (!raw) return { ok: false, error: "请选择单次运行时间。" };
    const ms = new Date(raw).getTime();
    if (!Number.isFinite(ms)) return { ok: false, error: "单次运行时间无效。" };
    return { ok: true, schedule: { kind: "at", at: new Date(ms).toISOString() } };
  }
  if (form.scheduleKind === "every") {
    const n = Number(form.everyValue);
    if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "间隔数值须为正数。" };
    const mult = form.everyUnit === "hours" ? 3600_000 : 60_000;
    const everyMs = Math.floor(n * mult);
    if (everyMs < 1) return { ok: false, error: "间隔过短。" };
    return { ok: true, schedule: { kind: "every", everyMs } };
  }
  const expr = form.cronExpr.trim();
  if (!expr) return { ok: false, error: "请填写 Cron 表达式。" };
  const tz = form.cronTz.trim();
  const schedule: Record<string, unknown> = { kind: "cron", expr };
  if (tz) schedule.tz = tz;
  return { ok: true, schedule };
}

/**
 * 由「新建任务」表单构建 cron.add 参数；不含 sessionKey。
 */
export function buildCronAddPayload(form: CronCreateFormInput): CronAddBuildResult {
  const name = form.name.trim();
  if (!name) return { ok: false, error: "任务名称不能为空。" };
  const agentId = form.agentId.trim();
  if (!agentId) return { ok: false, error: "请选择或填写智能体 agentId。" };
  const message = form.message.trim();
  if (!message) return { ok: false, error: "消息内容不能为空。" };

  const sch = buildSchedule(form);
  if (!sch.ok) return sch;

  const deliveryToRaw = form.deliveryTo.trim();
  if (form.deliveryMode === "none") {
    const payload: Record<string, unknown> = {
      name,
      enabled: form.enabled,
      agentId,
      schedule: sch.schedule,
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: { kind: "agentTurn", message },
      delivery: { mode: "none" },
    };
    return { ok: true, payload };
  }

  const chRaw = form.deliveryChannel.trim().toLowerCase();
  const channelId = chRaw === "" || chRaw === "last" ? "last" : form.deliveryChannel.trim();

  const delivery: Record<string, unknown> = { mode: "announce" };
  delivery.channel = channelId.toLowerCase() === "last" ? "last" : channelId;
  if (deliveryToRaw) delivery.to = deliveryToRaw;

  const payload: Record<string, unknown> = {
    name,
    enabled: form.enabled,
    agentId,
    schedule: sch.schedule,
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payload: { kind: "agentTurn", message },
    delivery,
  };

  return { ok: true, payload };
}
