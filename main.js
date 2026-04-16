const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const http = require("http");
const { randomUUID } = require("crypto");

const NODE_MIN_VERSION = { major: 22, minor: 16, patch: 0 };
const NODE_RECOMMENDED_MAJOR = 24;
const WINDOWS_SHELL_EXTENSIONS = new Set([".cmd", ".bat", ".com"]);
// Windows：npm 全局的 `openclaw.cmd` 若用 `shell=true` 会经 cmd.exe，易闪控制台窗口；
// 解析为 `node <…/node_modules/openclaw/…>` 直接 spawn（无 shell）。
// 其它 `.cmd` 仍可能需 `shell=true`；gateway JSON 参数需避免经 cmd 丢引号。
// We still block cmd metacharacters that can change execution flow.
const WINDOWS_UNSAFE_SHELL_ARG_PATTERN = /[\r\n&|<>^%!]/;
/** OpenClaw Gateway 默认端口（由 openclaw 自身决定；界面仅展示，无法通过本管理器“改端口”生效） */
const DEFAULT_GATEWAY_PORT = 18789;
/** 早期占位错误默认值，迁移到 DEFAULT_GATEWAY_PORT */
const LEGACY_WRONG_DEFAULT_PORT = 3456;

/** OpenClaw SecretInput：`${ENV}` 模板（与 CLI 中 parseEnvTemplateSecretRef 一致） */
const OPENCLAW_ENV_TEMPLATE_RE = /^\$\{([A-Z][A-Z0-9_]{0,127})\}$/;

/**
 * OpenClaw 状态目录：优先 `OPENCLAW_HOME`，否则 `~/.openclaw`（Windows 为 `%USERPROFILE%\.openclaw`）。
 */
function getOpenClawStateDir() {
  const fromEnv = String(process.env.OPENCLAW_HOME ?? "").trim();
  if (fromEnv) {
    return fromEnv;
  }
  return path.join(os.homedir(), ".openclaw");
}

/**
 * 将 openclaw.json 中的 SecretInput（明文字符串、${ENV}、或 `{ source:"env", provider, id }`）解析为字符串。
 * `file` / `exec` 来源无法在 Manager 内简解析，跳过（与 CLI 行为一致时可再扩展）。
 */
function resolveOpenClawSecretInput(raw) {
  if (raw == null) {
    return undefined;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return undefined;
    }
    const m = OPENCLAW_ENV_TEMPLATE_RE.exec(trimmed);
    if (m) {
      const v = String(process.env[m[1]] ?? "").trim();
      return v || undefined;
    }
    return trimmed;
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const src = raw.source;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (src === "env" && id) {
      const v = String(process.env[id] ?? "").trim();
      return v || undefined;
    }
  }
  return undefined;
}

/**
 * 读取 `openclaw.json` 中 `gateway.auth` 的 token/password（供渲染进程 WebSocket `connect` 与 CLI 一致）。
 */
function readOpenClawJsonGatewayAuth() {
  try {
    const cfgPath = path.join(getOpenClawStateDir(), "openclaw.json");
    if (!fs.existsSync(cfgPath)) {
      return { token: undefined, password: undefined, configPort: null };
    }
    const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return { token: undefined, password: undefined, configPort: null };
    }
    const gw = parsed.gateway;
    const auth = gw && typeof gw === "object" ? gw.auth : null;
    const token = auth && typeof auth === "object" ? resolveOpenClawSecretInput(auth.token) : undefined;
    const password =
      auth && typeof auth === "object" ? resolveOpenClawSecretInput(auth.password) : undefined;
    const configPort =
      gw && typeof gw === "object" && typeof gw.port === "number" && gw.port > 0 && gw.port < 65536
        ? gw.port
        : null;
    return { token, password, configPort };
  } catch {
    return { token: undefined, password: undefined, configPort: null };
  }
}

/**
 * 读取全局 openclaw.json 的默认 workspace（用于 skills install/update 等“active workspace”操作）。
 * 注意：Manager 自身的工作目录并不等于 OpenClaw workspace。
 */
function readOpenClawDefaultWorkspaceDir() {
  try {
    const cfgPath = path.join(getOpenClawStateDir(), "openclaw.json");
    if (!fs.existsSync(cfgPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    const ws = parsed?.agents?.defaults?.workspace;
    const s = typeof ws === "string" ? ws.trim() : "";
    if (!s) return null;
    if (!path.isAbsolute(s)) return null;
    if (!fs.existsSync(s)) return null;
    return s;
  } catch {
    return null;
  }
}

function preferredOpenClawHomeDir() {
  // Manager UI 以用户主目录的 ~/.openclaw 为准，避免被历史/外部 OPENCLAW_HOME 污染导致 plugins.allow 不一致。
  return path.join(os.homedir(), ".openclaw");
}

function envFlag(name) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function getDebugOnboardingOptions() {
  return {
    forceOnboarding: envFlag("OPENCLAW_FORCE_ONBOARDING"),
    mockNodeMissing: envFlag("OPENCLAW_MOCK_NODE_MISSING"),
    mockOpenClawMissing: envFlag("OPENCLAW_MOCK_OPENCLAW_MISSING"),
    mockNodeVersion: String(process.env.OPENCLAW_MOCK_NODE_VERSION ?? "").trim()
  };
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

function getStateFile() {
  return path.join(app.getPath("userData"), "state.json");
}

function loadState() {
  const fallback = {
    gatewayRunning: true,
    gatewayStartedAt: Date.now() - 1000 * 60 * 60 * 3 - 1000 * 60 * 24, // mock: 3h 24m
    openclawVersion: "v2026.3.13",
    managerVersion: "v0.1.0",
    gatewayPort: DEFAULT_GATEWAY_PORT,
    lastGatewayAction: null,
    update: {
      latestVersion: null,
      checkedAt: null,
      hasUpdate: false
    },
    agents: [],
    stats: {
      agentsConfigured: 3,
      channelsConnected: 2,
      installedSkills: 12,
      currentModel: { name: "DeepSeek", id: "deepseek-chat" }
    },
    env: {
      nodeInstalled: false,
      nodeVersion: null,
      nodePath: null,
      nodeCompatible: false,
      nodeRecommended: false,
      openclawInstalled: false,
      openclawVersion: null,
      openclawPath: null
    },
    onboarding: {
      completed: false,
      modelConfigured: false,
      firstAgentCreated: false,
      completedAt: null
    }
  };

  const file = getStateFile();
  try {
    if (!fs.existsSync(file)) {
      return fallback;
    }
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    const migratedPort =
      parsed.gatewayPort === LEGACY_WRONG_DEFAULT_PORT
        ? DEFAULT_GATEWAY_PORT
        : parsed.gatewayPort;
    return {
      ...fallback,
      ...parsed,
      gatewayPort: migratedPort ?? fallback.gatewayPort,
      stats: {
        ...fallback.stats,
        ...(parsed.stats ?? {}),
        currentModel: {
          ...fallback.stats.currentModel,
          ...((parsed.stats && parsed.stats.currentModel) ?? {})
        }
      },
      env: {
        ...fallback.env,
        ...(parsed.env ?? {})
      },
      onboarding: {
        ...fallback.onboarding,
        ...(parsed.onboarding ?? {})
      },
      update: {
        ...fallback.update,
        ...(parsed.update ?? {})
      },
      agents: Array.isArray(parsed.agents) ? parsed.agents : fallback.agents
    };
  } catch {
    // If parsing fails, fall back to a known-safe mock.
    return fallback;
  }
}

function saveState(state) {
  const file = getStateFile();
  try {
    fs.writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
  } catch {
    // ignore
  }
}

let state = null;
let mainWindow = null;
let hotReloadWatchers = [];
let hotReloadRestarting = false;

/** 子进程文本输出累计上限，避免日志洪泛占满内存 */
const RUN_OUTPUT_CAP = 65536;
/** `plugins list --json` 含各插件 configJsonSchema，体量常超 64KiB；截断会导致 JSON 无法解析、Electron 中列表恒为空 */
const PLUGINS_LIST_OUTPUT_CAP = 8 * 1024 * 1024;
/** 仅周期性 getStatus 时节流环境检测，避免每 2s 反复 spawn node/openclaw --version */
const ENV_REFRESH_TTL_MS = 60_000;
let lastEnvRefreshAt = 0;
/** `gateway start|restart` 若长期不退出，视为前台常驻进程：unref，不 SIGKILL（避免误杀网关 */
const GATEWAY_DAEMON_STALL_MS = 3500;
const GATEWAY_STOP_TIMEOUT_MS = 90000;

let probeChain = Promise.resolve();
/** 网关 start/stop/restart 正在执行：新请求直接拒绝，避免排队导致「点一次执行多次 CLI」 */
let managerGatewayControlBusy = false;

/** 轮询用：避免每 2s 都 spawn openclaw；probe 含 discover 很重 */
let gatewayCheckCache = { ts: 0, result: /** @type {boolean | null} */ (null) };
const GATEWAY_CHECK_CACHE_MS = 12000;

function invalidateGatewayProbeCache() {
  gatewayCheckCache = { ts: 0, result: null };
}

function appendCapped(current, chunk, cap = RUN_OUTPUT_CAP) {
  return (String(current) + chunk.toString("utf8")).slice(-cap);
}

function resolveSpawn(command, args, opts) {
  const env = opts?.env ?? process.env;
  let executable = command;
  let useShell = Boolean(opts?.shell);
  /** @type {string[] | undefined} */
  let spawnArgPrefix;

  if (process.platform === "win32") {
    if (!path.extname(String(executable || ""))) {
      const resolved = tryResolveExecutableSync(String(executable || ""));
      if (resolved) executable = resolved;
    }
    const ext = path.extname(String(executable || "")).toLowerCase();
    if (WINDOWS_SHELL_EXTENSIONS.has(ext)) {
      useShell = true;
    }
    const npmDirect = tryWindowsNpmDirectNodeSpawn(String(command || ""), String(executable || ""));
    if (npmDirect) {
      executable = npmDirect.nodeExe;
      spawnArgPrefix = [npmDirect.scriptPath];
      useShell = false; // 既然直接用 node 跑 JS，就不需要 shell 了
    } else {
      // 3. 原有的 OpenClaw 处理
      const oc = tryWindowsOpenClawDirectNodeSpawn(String(command || ""), String(executable || ""));
      if (oc) {
        executable = oc.nodeExe;
        spawnArgPrefix = [oc.scriptPath];
        useShell = false;
      }
    }
    // const oc = tryWindowsOpenClawDirectNodeSpawn(String(command || ""), String(executable || ""));
    // if (oc) {
    //   executable = oc.nodeExe;
    //   spawnArgPrefix = [oc.scriptPath];
    //   useShell = false;
    // }
    if (useShell) {
      const unsafeArg = (args ?? []).find((a) =>
        WINDOWS_UNSAFE_SHELL_ARG_PATTERN.test(String(a))
      );
      if (unsafeArg) {
        throw new Error(
          `不安全的 Windows shell 参数：${String(unsafeArg)}。请移除 shell 元字符（& | < > ^ % !）。`
        );
      }
    }
  }

  return { executable, useShell, env, cwd: opts?.cwd, spawnArgPrefix };
}

function formatCommandForLog(cmd, args) {
  const safeArgs = (args ?? []).map((a) => String(a)).join(" ");
  return `${cmd} ${safeArgs}`.trim();
}

function extractJson(text) {
  const raw = String(text ?? "");
  const noAnsi = raw.replace(/\x1b\[[\d;?]*[ -/]*[@-~]/g, "");
  const cleaned = noAnsi.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
  // 关键：清理会改变字符串长度，因此索引必须基于 cleaned 计算
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  const slice = cleaned.slice(first, last + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

/** 与官方 CLI `openclaw gateway call` 对齐的允许列表（避免任意 RPC 被渲染进程滥用） */
const GATEWAY_RPC_ALLOW = new Set([
  "health",
  "channels.status",
  "agents.list",
  "models.list",
  // agent edit (Files / Tools / Skills)
  "agents.files.list",
  "agents.files.get",
  "agents.files.set",
  "skills.status",
  "skills.update",
  "tools.catalog",
  "config.get",
  "config.schema",
  "config.set",
  "config.patch",
  "config.apply",
  "config.openFile",
  "sessions.usage",
  "usage.cost",
  // optional: some config changes may require an explicit update step
  "update.run",
  "cron.status",
  "cron.list",
  "cron.add",
  "cron.update",
  "cron.remove",
  "cron.run",
  "cron.runs",
  "chat.send",
  "chat.history",
  "agent.wait",
  "sessions.patch",
  "sessions.list",
  "node.pair.list",
  "node.pair.approve",
  "node.pair.reject",
  "node.pair.verify"
]);

function parseCliJsonOutput(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;

  // 兼容：某些情况下 --json 输出可能混入 ANSI/控制字符
  const noAnsi = raw.replace(/\x1b\[[\d;?]*[ -/]*[@-~]/g, "");
  // 保留常见 JSON 空白（\n \r \t），移除其余控制字符
  const cleaned = noAnsi.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    return extractJson(cleaned);
  }
}

/**
 * `plugins list --json`：优先解析 stdout，避免 stderr 日志里的 `{...}` 干扰 extractJson 的首尾大括号切片。
 */
function parsePluginsListCliOutput(res) {
  const stdout = String(res.stdout ?? "").trim();
  const merged = `${res.stdout ?? ""}\n${res.stderr ?? ""}`.trim();
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
  let parsed =
    (stdout && parseCliJsonOutput(stdout)) ||
    parseCliJsonOutput(merged);
  let o = asObj(parsed);
  if (o && Array.isArray(o.plugins)) return o;
  const inner = o?.data;
  if (asObj(inner) && Array.isArray(inner.plugins)) {
    return { ...o, plugins: inner.plugins };
  }
  for (const blob of [stdout && extractJson(stdout), extractJson(merged)]) {
    const c = asObj(blob);
    if (c && Array.isArray(c.plugins)) return c;
  }
  return parsed;
}

function isSafeChannelKey(v) {
  return /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(String(v ?? "").trim());
}

function isSafeAccountId(v) {
  return /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(String(v ?? "").trim());
}

function isSafePairingCode(v) {
  return /^[A-Z2-9]{4,16}$/.test(String(v ?? "").trim().toUpperCase());
}

/** @type {Map<string, { child: import('child_process').ChildProcess; wc: import('electron').WebContents; sentQr: boolean; buf: string; killTimer?: NodeJS.Timeout | null }>} */
const channelsLoginSessions = new Map();

function notifyChannelsLogin(wc, payload) {
  try {
    if (wc && !wc.isDestroyed()) {
      wc.send("manager:channelsLoginEvent", payload);
    }
  } catch {
    // ignore
  }
}

/** 去掉 ANSI 颜色/光标序列，便于从 CLI 输出里匹配 URL、JSON（微信等插件常带着色）。 */
function stripAnsiForQrParse(s) {
  return String(s ?? "").replace(/\x1b\[[\d;?]*[ -/]*[@-~]/g, "");
}

function tryExtractQrDataUrl(accumulated) {
  const s = stripAnsiForQrParse(accumulated);
  const inline = s.match(/data:image\/[a-zA-Z+.-]+;base64,[A-Za-z0-9+/=\s]+/);
  if (inline) return inline[0].replace(/\s/g, "");
  const jsonQr = s.match(/"qr"\s*:\s*"(data:image[^"]+)"/);
  if (jsonQr) return jsonQr[1].replace(/\\n/g, "").replace(/\s/g, "");
  const b64 = s.match(/"qrBase64"\s*:\s*"([A-Za-z0-9+/=]+)"|"imageBase64"\s*:\s*"([A-Za-z0-9+/=]+)"/);
  if (b64) {
    const payload = b64[1] || b64[2];
    if (payload) return `data:image/png;base64,${payload}`;
  }
  const lines = s.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim().replace(/^["']|["']$/g, "");
    if (/\.(png|jpg|jpeg|webp)$/i.test(t) && t.length < 4096 && !/[<>|*?]/.test(t)) {
      try {
        if (fs.existsSync(t)) {
          const buf = fs.readFileSync(t);
          const ext = path.extname(t).toLowerCase();
          const mime =
            ext === ".png"
              ? "image/png"
              : ext === ".jpg" || ext === ".jpeg"
                ? "image/jpeg"
                : ext === ".webp"
                  ? "image/webp"
                  : "image/png";
          return `data:${mime};base64,${buf.toString("base64")}`;
        }
      } catch {
        // ignore
      }
    }
  }
  return null;
}

function trimUrlTrailingPunct(u) {
  let x = String(u ?? "").trim();
  while (/[),.;:'"`\]}>]+$/.test(x)) x = x.replace(/[),.;:'"`\]}>]+$/g, "");
  return x.trim();
}

/** 常见误匹配（日志里的包/registry 链接），不作为扫码载荷。 */
function isLikelyNoiseQrUrl(u) {
  try {
    const { hostname } = new URL(u);
    const h = hostname.toLowerCase();
    if (h === "registry.npmjs.org" || h === "www.npmjs.com") return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * 从 CLI 合并输出中取可生成二维码的字符串：pairingCode、qr:/pairing: 行、或最后的 https 链接。
 * 微信插件等在 TTY 上打印 ASCII 码，同时用 runtime.log 打出 https 扫码链接；原正则不允许 ?&，无法匹配完整 URL。
 */
function tryPickQrPayloadString(accumulated) {
  const s = stripAnsiForQrParse(accumulated);
  const m = s.match(/"pairingCode"\s*:\s*"([^"]+)"/i);
  if (m && m[1] && m[1].length >= 8) return m[1];
  const m2 = s.match(/(?:qr|pairing)\s*[:=]\s*([A-Za-z0-9._~+/={}:?&|#%-]{12,4000})/i);
  if (m2 && m2[1]) return m2[1].trim();
  const urlRe = /https?:\/\/[^\s"'<>\[\](){}|\\^`]+/gi;
  const found = s.match(urlRe);
  if (found && found.length > 0) {
    for (let i = found.length - 1; i >= 0; i -= 1) {
      const raw = trimUrlTrailingPunct(found[i]);
      if (raw.length < 12 || raw.length > 4096) continue;
      if (isLikelyNoiseQrUrl(raw)) continue;
      return raw;
    }
  }
  return null;
}

async function maybeGenerateQrDataUrl(payload) {
  let qrcodeMod = null;
  try {
    qrcodeMod = require("qrcode");
  } catch {
    return null;
  }
  try {
    return await qrcodeMod.toDataURL(String(payload), {
      margin: 1,
      width: 320,
      errorCorrectionLevel: "M"
    });
  } catch {
    return null;
  }
}

/**
 * 载荷为 http(s) 时：若指向图片则拉取为 data URL；否则用 qrcode 把 URL 字符串编码成二维码（与微信插件 qrcode-terminal 行为一致）。
 */
async function tryUrlOrPayloadToQrDataUrl(payload) {
  const p = String(payload ?? "").trim();
  if (!p.startsWith("http://") && !p.startsWith("https://")) {
    return maybeGenerateQrDataUrl(p);
  }
  const lower = p.toLowerCase();
  const looksLikeImageUrl = /\.(png|jpe?g|gif|webp|bmp)(\?|#|$)/i.test(lower);
  if (looksLikeImageUrl && typeof fetch === "function") {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(p, { signal: ctrl.signal, redirect: "follow" });
      clearTimeout(timer);
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (res.ok && ct.startsWith("image/")) {
        const ab = await res.arrayBuffer();
        if (ab.byteLength > 0 && ab.byteLength <= 4 * 1024 * 1024) {
          const b64 = Buffer.from(ab).toString("base64");
          const mime = ct.split(";")[0].trim() || "image/png";
          return `data:${mime};base64,${b64}`;
        }
      }
    } catch {
      // fall through to encode URL as QR
    }
  }
  return maybeGenerateQrDataUrl(p);
}

function readConfiguredChannelsFromFile() {
  try {
    const cfgPath = path.join(getOpenClawStateDir(), "openclaw.json");
    if (!fs.existsSync(cfgPath)) return [];
    const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    const channels = parsed?.channels;
    if (!channels || typeof channels !== "object" || Array.isArray(channels)) return [];
    return Object.keys(channels).map((k) => String(k).trim().toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

async function runOpenClawPairingCli(payload) {
  const startedAt = Date.now();
  await refreshEnvIfNeeded({ force: false });
  if (!state?.env?.openclawInstalled) {
    throw new Error("未检测到 OpenClaw，无法执行配对命令。");
  }
  const action = String(payload?.action ?? "").trim().toLowerCase();
  if (action !== "list" && action !== "approve") {
    throw new Error(`不支持的 pairing 操作：${action}`);
  }

  const channel = String(payload?.channel ?? "").trim().toLowerCase();
  if (!isSafeChannelKey(channel)) {
    throw new Error("channel 非法，仅允许字母/数字/.-_，且不能为空。");
  }
  const configured = readConfiguredChannelsFromFile();
  if (configured.length && !configured.includes(channel)) {
    throw new Error(`channel「${channel}」不在当前 openclaw.json 的 channels 配置中。`);
  }

  // 使用显式 --channel，避免与「首个参数是 code 还是 channel」的双义性（与 `openclaw pairing --help` 一致）
  const args =
    action === "list"
      ? ["pairing", "list", "--channel", channel, "--json"]
      : ["pairing", "approve", "--channel", channel];
  const account = String(payload?.accountId ?? "").trim();
  if (account) {
    if (!isSafeAccountId(account)) {
      throw new Error("accountId 非法，仅允许字母/数字/.-_。");
    }
    args.push("--account", account);
  }
  if (action === "approve") {
    const code = String(payload?.code ?? "").trim().toUpperCase();
    if (!isSafePairingCode(code)) {
      throw new Error("配对码格式非法（应为大写字母数字，长度 4-16）。");
    }
    args.push(code);
    if (payload?.notify === true) {
      args.push("--notify");
    }
  }

  const timeoutMs = action === "approve" ? 60000 : 30000;
  const res = await runCommand("openclaw", args, { timeoutMs });
  const merged = `${res.stdout || ""}\n${res.stderr || ""}`.trim();
  const parsed = parseCliJsonOutput(merged);
  if (res.code !== 0) {
    throw new Error(String(res.stderr || "").trim() || `pairing ${action} 失败（退出码 ${res.code ?? "未知"}）`);
  }
  return {
    code: res.code,
    result: parsed ?? { ok: true, output: merged },
    stderr: String(res.stderr || "").trim(),
    elapsedMs: Date.now() - startedAt
  };
}

async function runOpenClawPluginCli(payload) {
  const startedAt = Date.now();
  await refreshEnvIfNeeded({ force: false });
  if (!state?.env?.openclawInstalled) {
    throw new Error("未检测到 OpenClaw，无法执行插件命令。");
  }
  const action = String(payload?.action ?? "").trim().toLowerCase();
  const allowed = new Set(["list", "install", "enable", "disable"]);
  if (!allowed.has(action)) {
    throw new Error(`不支持的 plugins 操作：${action}`);
  }
  const args = ["plugins", action];
  if (action === "list") {
    args.push("--json");
  } else {
    const pluginId = String(payload?.pluginId ?? "").trim();
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(pluginId)) {
      throw new Error("pluginId 非法，仅允许字母/数字/.-_。");
    }
    args.push(pluginId);
  }
  const timeoutMs = action === "install" ? 120000 : 100000;
  const res = await runCommand("openclaw", args, {
    timeoutMs,
    outputCap: action === "list" ? PLUGINS_LIST_OUTPUT_CAP : undefined
  });
  const merged = `${res.stdout || ""}\n${res.stderr || ""}`.trim();
  const parsed =
    action === "list" ? parsePluginsListCliOutput(res) : parseCliJsonOutput(merged);
  if (res.code !== 0) {
    throw new Error(String(res.stderr || "").trim() || `plugins ${action} 失败（退出码 ${res.code ?? "未知"}）`);
  }
  return {
    code: res.code,
    result: parsed ?? { ok: true, output: merged },
    stderr: String(res.stderr || "").trim(),
    elapsedMs: Date.now() - startedAt
  };
}

async function runOpenClawGatewayRpc(method, params, opts) {
  const timeoutMs = typeof opts?.timeoutMs === "number" && opts.timeoutMs > 0 ? opts.timeoutMs : 60000;
  // skills.status 的 JSON 可能非常大（列出很多 skill entries），避免 runCommand 默认截断导致 JSON 不完整。
  const outputCap =
    method === "skills.status" || method.startsWith("skills.")
      ? Math.max(2 * 1024 * 1024, RUN_OUTPUT_CAP)
      : RUN_OUTPUT_CAP;
  if (!GATEWAY_RPC_ALLOW.has(method)) {
    throw new Error(`不允许的 Gateway 方法：${method}`);
  }
  await refreshEnvIfNeeded({ force: false });
  if (!state?.env?.openclawInstalled) {
    throw new Error("未检测到 OpenClaw，无法调用网关。请先安装并确保 `openclaw` 可用。");
  }
  const paramStr = JSON.stringify(params ?? {});
  // 若仍回退到 `openclaw.cmd` + cmd.exe，需按 cmd 规则包裹 `--params`；直接 `node … openclaw.mjs` 时传原始 JSON 即可。
  let paramArg = paramStr;
  if (process.platform === "win32") {
    let exe = "openclaw";
    if (!path.extname(exe)) {
      const r = tryResolveExecutableSync("openclaw");
      if (r) exe = r;
    }
    if (!tryWindowsOpenClawDirectNodeSpawn("openclaw", exe)) {
      paramArg = `"${paramStr.replace(/"/g, '""')}"`;
    }
  }
  const res = await runCommand(
    "openclaw",
    ["gateway", "call", method, "--params", paramArg, "--json", "--timeout", String(timeoutMs)],
    { timeoutMs: timeoutMs + 5000, outputCap }
  );
  // 某些情况下 `--json` 输出可能混在 stdout/stderr 中。
  // 为了兼容打包/不同终端环境，合并两端再做解析。
  const mergedOutput = `${res.stdout || ""}\n${res.stderr || ""}`.trim();
  const parsed = parseCliJsonOutput(mergedOutput);
  if (res.code !== 0 && parsed == null) {
    const err = String(res.stderr || "").trim();
    throw new Error(err || `gateway call 失败（退出码 ${res.code ?? "未知"}）`);
  }
  return { code: res.code, result: parsed, stderr: String(res.stderr || "").trim() };
}

/** 与网关 session key `agent:<id>:main` 对齐的 id 规范化（简化版） */
function normalizeAgentIdForSession(raw) {
  let s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!s) return "";
  s = s.replace(/\s+/g, "-");
  s = s.replace(/[^a-z0-9_-]+/g, "-");
  s = s.replace(/^-+|-+$/g, "");
  if (!s) return "";
  return s.length > 64 ? s.slice(0, 64) : s;
}

function buildAgentMainSessionKey(agentIdRaw) {
  const id = normalizeAgentIdForSession(agentIdRaw) || "main";
  return `agent:${id}:main`;
}

function extractTextFromContentBlocks(content) {
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n\n").trim();
}

/** 从 chat.history 的 messages 中取最后一条助手可见文本 */
function extractLastAssistantTextFromHistory(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || typeof m !== "object") continue;
    const role = String(m.role ?? "").toLowerCase();
    if (role !== "assistant") continue;
    if (typeof m.text === "string" && m.text.trim()) return m.text.trim();
    const fromContent = extractTextFromContentBlocks(m.content);
    if (fromContent) return fromContent;
  }
  return "";
}

function extractAgentCliReplyJson(parsed) {
  if (!parsed || typeof parsed !== "object") return "";
  const top = parsed;
  const r = top.result !== undefined ? top.result : top;
  if (typeof r === "string") return r;
  if (typeof r.text === "string") return r.text;
  if (typeof r.output === "string") return r.output;
  if (typeof r.summary === "string") return r.summary;
  const payloads = r.payloads;
  if (Array.isArray(payloads)) {
    const textParts = payloads.map((p) => (p && typeof p.text === "string" ? p.text : null)).filter(Boolean);
    if (textParts.length) return textParts.join("\n");
  }
  return "";
}

/**
 * 与 Control UI 一致：chat.send → agent.wait → chat.history。
 * 失败时由调用方回退到 `openclaw agent` CLI。
 */
async function chatViaGateway(userMessage, agentIdRaw, sessionKeyOverride) {
  await refreshEnvIfNeeded({ force: true });
  if (!state?.env?.openclawInstalled) {
    throw new Error("未检测到 OpenClaw");
  }

  const fallbackId = normalizeAgentIdForSession(state.defaultAgentId) || "main";
  const chosen = normalizeAgentIdForSession(agentIdRaw) || fallbackId;
  const skOpt = sessionKeyOverride && String(sessionKeyOverride).trim();
  const sessionKey = skOpt || buildAgentMainSessionKey(chosen);
  const runId = randomUUID();

  const sendRes = await runOpenClawGatewayRpc(
    "chat.send",
    {
      sessionKey,
      message: userMessage,
      deliver: false,
      idempotencyKey: runId
    },
    { timeoutMs: 120000 }
  );
  if (sendRes.code !== 0) {
    throw new Error(sendRes.stderr || "chat.send 调用失败");
  }

  const waitRes = await runOpenClawGatewayRpc(
    "agent.wait",
    { runId, timeoutMs: 120000 },
    { timeoutMs: 130000 }
  );
  if (waitRes.code !== 0) {
    throw new Error(waitRes.stderr || "agent.wait 调用失败");
  }
  const wr = waitRes.result;
  if (wr && typeof wr === "object") {
    if (wr.status === "error") {
      return { reply: String(wr.error ?? "智能体运行出错") };
    }
    if (wr.status === "timeout") {
      return { reply: "等待回复超时。请确认网关与模型可用后重试。" };
    }
  }

  const histRes = await runOpenClawGatewayRpc(
    "chat.history",
    { sessionKey, limit: 100 },
    { timeoutMs: 60000 }
  );
  if (histRes.code !== 0 || histRes.result == null) {
    return { reply: "消息已发送，但无法读取会话历史（chat.history）。请稍后在 OpenClaw 控制端查看。" };
  }
  const messages = histRes.result.messages;
  const text = extractLastAssistantTextFromHistory(Array.isArray(messages) ? messages : []);
  if (!text) {
    return { reply: "未从历史记录中解析到助手回复。请确认网关已连接模型且会话正常。" };
  }
  return { reply: text };
}

async function chatViaAgentCli(userMessage, agentId) {
  const res = await runCommand(
    "openclaw",
    ["agent", "--agent", agentId, "--message", userMessage, "--thinking", "off", "--json"],
    { timeoutMs: 120000 }
  );
  const parsed = extractJson(res.stdout);
  if (res.code !== 0 && !parsed) {
    const err = String(res.stderr || "").trim();
    throw new Error(err || "OpenClaw 未返回可解析结果");
  }
  const replyText =
    extractAgentCliReplyJson(parsed) ||
    "未收到回复（请稍后重试）。";
  return { reply: replyText };
}

function pickPortFromObject(o, depth = 0) {
  if (!o || typeof o !== "object" || depth > 5) return null;
  const keys = ["port", "listenPort", "httpPort", "wsPort", "gatewayPort", "gatewayHttpPort"];
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && v > 0 && v < 65536) return v;
    if (typeof v === "string" && /^\d{1,5}$/.test(v)) {
      const n = Number(v);
      if (n > 0 && n < 65536) return n;
    }
  }
  const nest = ["gateway", "listen", "server", "http", "ws", "addrs", "local"];
  for (const k of nest) {
    if (o[k] && typeof o[k] === "object") {
      const p = pickPortFromObject(o[k], depth + 1);
      if (p != null) return p;
    }
  }
  if (typeof o.url === "string") {
    try {
      const u = new URL(o.url);
      const n = Number(u.port);
      if (n > 0) return n;
    } catch {
      // ignore
    }
  }
  return null;
}

function extractGatewayPort(parsed, text) {
  if (parsed && typeof parsed === "object") {
    const p = pickPortFromObject(parsed);
    if (p != null) return p;
  }
  const t = String(text);
  const urlm =
    t.match(/wss?:\/\/[^/:\s]+:(\d{2,5})\b/i) || t.match(/https?:\/\/[^/:\s]+:(\d{2,5})\b/i);
  if (urlm) {
    const n = Number(urlm[1]);
    if (n > 0 && n < 65536) return n;
  }
  const lm = t.match(/127\.0\.0\.1:(\d{2,5})\b/) || t.match(/localhost:(\d{2,5})\b/i);
  if (lm) {
    const n = Number(lm[1]);
    if (n > 0 && n < 65536) return n;
  }
  const pm = t.match(/(?:port|端口)\s*[:：]?\s*(\d{2,5})\b/i);
  if (pm) {
    const n = Number(pm[1]);
    if (n > 0 && n < 65536) return n;
  }
  return null;
}

function syncGatewayPortFromCli(parsed, text) {
  if (!state) return;
  const port = extractGatewayPort(parsed, text);
  if (port != null && port !== state.gatewayPort) {
    state.gatewayPort = port;
    saveState(state);
  }
}

function parseSemver(versionText) {
  const normalized = String(versionText ?? "")
    .replace(/\x1b\[[\d;?]*[ -/]*[@-~]/g, "")
    .trim()
    .replace(/^v/i, "");
  const m = normalized.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    raw: `${m[1]}.${m[2]}.${m[3]}`
  };
}

function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function isNodeCompatible(versionText) {
  const sem = parseSemver(versionText);
  if (!sem) return false;
  return compareSemver(sem, NODE_MIN_VERSION) >= 0;
}

function isNodeRecommended(versionText) {
  const sem = parseSemver(versionText);
  if (!sem) return false;
  return sem.major >= NODE_RECOMMENDED_MAJOR;
}

function runCommand(command, args, opts) {
  const timeoutMs = opts?.timeoutMs ?? 20000;
  const outputCap =
    typeof opts?.outputCap === "number" && opts.outputCap > 0 ? opts.outputCap : RUN_OUTPUT_CAP;

  return new Promise((resolve, reject) => {
    let sp;
    try {
      sp = resolveSpawn(command, args, opts);
    } catch (e) {
      reject(e);
      return;
    }

    const spawnArgs = sp.spawnArgPrefix ? [...sp.spawnArgPrefix, ...args] : args;
    const child = spawn(sp.executable, spawnArgs, {
      env: sp.env,
      cwd: sp.cwd,
      shell: sp.useShell,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      const chunk = d.toString();
      // 实时打印到控制台，以便监控进度
      process.stdout.write(chunk);
      stdout = appendCapped(stdout, d, outputCap);
    });
    child.stderr.on("data", (d) => {
      const chunk = d.toString();
      // 实时打印到控制台，以便监控进度
      process.stdout.write(chunk);
      stderr = appendCapped(stderr, d, outputCap);
    });

    let settled = false;
    /** Windows：子进程已退出但管道句柄可能被 npm/脚本子进程继承，`close` 长期不触发；`exit` 仍会触发。 */
    let exitFallbackTimer = null;
    const clearExitFallback = () => {
      if (exitFallbackTimer) {
        clearTimeout(exitFallbackTimer);
        exitFallbackTimer = null;
      }
    };
    const finish = (code) => {
      if (settled) return;
      settled = true;
      // 强制销毁流，防止句柄泄露导致进程挂起
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      clearExitFallback();
      resolve({ code: typeof code === "number" ? code : 1, stdout, stderr });
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      clearExitFallback();
      reject(err);
    };

    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        fail(
          new Error(
            `命令超时（${timeoutMs}ms）：${formatCommandForLog(command, spawnArgs)}`
          )
        );
      }, timeoutMs);
    }

    child.on("error", (err) => {
      fail(err);
    });

    child.on("close", (code) => {
      clearExitFallback();
      finish(code ?? 1);
    });

    child.on("exit", (code) => {
      if (settled) return;
      const c = typeof code === "number" ? code : 1;
      finish(c);
      // exitFallbackTimer = setTimeout(() => {
      //   exitFallbackTimer = null;
      //   finish(c);
      // }, 2000);
    });
  });
}

/**
 * Manager 直接 spawn 的网关守护进程子进程引用（仅 Windows `gateway run` 模式使用）。
 * 不用 detached，网关随 Manager 生命周期一起退出。
 * @type {import('child_process').ChildProcess | null}
 */
let managedGatewayChild = null;

function killManagedGateway() {
  const child = managedGatewayChild;
  if (!child) return false;
  managedGatewayChild = null;
  try { child.kill("SIGTERM"); } catch {}
  setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 4000);
  return true;
}

/**
 * Windows：`openclaw gateway start/restart` 内部走 schtasks，会弹 CMD 窗口。
 * 改为 Manager 直接 spawn `openclaw gateway run`（前台模式）：
 *   - detached: false  — 不设 DETACHED_PROCESS，让 CREATE_NO_WINDOW 生效
 *   - windowsHide: true — 设置 CREATE_NO_WINDOW，所有子孙进程都无控制台窗口
 *   - stdio: ignore + unref — 不阻塞 Electron 事件循环
 * 网关生命周期跟随 Manager：关闭 Manager 时网关自动停止。
 * 非 Windows 平台仍走原来的 `gateway start/stop/restart` 流程。
 */
async function runOpenClawGatewayAction(action) {
  // if (process.platform === "win32") {
  //   return runOpenClawGatewayActionWindows(action);
  // }
  return runOpenClawGatewayActionDefault(action);
}

async function runOpenClawGatewayActionDefault(action) {
  if (action === "stop") {
    const killed = killManagedGateway();
    if (!killed) {
      try {
        await runCommand("openclaw", ["gateway", "stop"], { timeoutMs: GATEWAY_STOP_TIMEOUT_MS });
      } catch {}
    }
    return { code: 0, stdout: "", stderr: "", detached: false };
  }

  if (action === "restart") {
    killManagedGateway();
    await new Promise((r) => setTimeout(r, 1000)); // 重启间隔稍微拉长一点点
  }

  const args = ["gateway", "run"];
  let sp;
  try {
    sp = resolveSpawn("openclaw", args, {});
  } catch (e) {
    return Promise.reject(e);
  }

  const spawnArgs = sp.spawnArgPrefix ? [...sp.spawnArgPrefix, ...args] : args;

  return new Promise((resolve, reject) => {
    const child = spawn(sp.executable, spawnArgs, {
      env: { ...sp.env, OPENCLAW_NO_RESPAWN: "1" },
      cwd: sp.cwd,
      shell: false,
      windowsHide: true,
      detached: false,
      // 关键：stdout 设置为 pipe 才能读取日志
      stdio: ["ignore", "pipe", "pipe"] 
    });

    managedGatewayChild = child;
    let isResolved = false;
    // 监听日志输出
    child.stdout.on("data", (data) => {
      // const log = data.toString();
      const log = data.toString().replace(/\x1B\[[0-9;]*[JKmsu]/g, '');
      process.stdout.write(log);

      // 匹配日志中的就绪关键字
      if (log.includes("[gateway] ready") && !isResolved) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        isResolved = true;
        resolve({ code: 0, stdout: "Gateway started successfully", stderr: "", detached: false });
      }
    });

    // 监听错误输出（某些启动失败的信息会在这里）
    // child.stderr.on("data", (data) => {
    //   console.error(`[Gateway Error]: ${data.toString()}`);
    // });

    // 监听退出事件
    child.on("exit", (code, signal) => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (managedGatewayChild === child) managedGatewayChild = null;
      
      if (!isResolved) {
        isResolved = true;
        reject(new Error(`网关进程意外退出 (Exit Code: ${code}, Signal: ${signal})`));
      }
    });

    // 监听启动失败（比如可执行文件路径不对）
    child.on("error", (err) => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (!isResolved) {
        isResolved = true;
        reject(err);
      }
    });

    // 安全保护：如果 60 秒还没 ready，强制结束，防止死等
    let timer = null;
    timer = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        // 如果 60 秒都没启动成功，可能卡住了，杀掉进程并返回失败
        child.kill();
        reject(new Error("网关启动超时 (120s)"));
      }
    }, 120000);
  });
}

// async function runOpenClawGatewayActionWindows(action) {
//   if (action === "stop") {
//     const killed = killManagedGateway();
//     if (!killed) {
//       try {
//         await runCommand("openclaw", ["gateway", "stop"], { timeoutMs: GATEWAY_STOP_TIMEOUT_MS });
//       } catch {}
//     }
//     return { code: 0, stdout: "", stderr: "", detached: false };
//   }

//   if (action === "restart") {
//     killManagedGateway();
//     await new Promise((r) => setTimeout(r, 800));
//   }

//   const args = ["gateway", "run"];
//   let sp;
//   try {
//     sp = resolveSpawn("openclaw", args, {});
//   } catch (e) {
//     return Promise.reject(e);
//   }

//   const spawnArgs = sp.spawnArgPrefix ? [...sp.spawnArgPrefix, ...args] : args;
//   const child = spawn(sp.executable, spawnArgs, {
//     env: { ...sp.env, OPENCLAW_NO_RESPAWN: "1" },
//     cwd: sp.cwd,
//     shell: false,
//     windowsHide: true,
//     detached: false,
//     stdio: ["ignore", "ignore", "ignore"]
//   });

//   child.unref();
//   managedGatewayChild = child;

//   child.on("exit", () => {
//     if (managedGatewayChild === child) managedGatewayChild = null;
//   });

//   return { code: 0, stdout: "", stderr: "", detached: false };
// }

// async function runOpenClawGatewayActionDefault(action) {
//   const args = ["gateway", action];
//   let sp;
//   try {
//     sp = resolveSpawn("openclaw", args, {});
//   } catch (e) {
//     return Promise.reject(e);
//   }

//   const daemonMode = action === "start" || action === "restart";

//   return new Promise((resolve, reject) => {
//     const spawnArgs = sp.spawnArgPrefix ? [...sp.spawnArgPrefix, ...args] : args;
//     const child = spawn(sp.executable, spawnArgs, {
//       env: sp.env,
//       cwd: sp.cwd,
//       shell: sp.useShell,
//       windowsHide: true,
//       stdio: ["ignore", "ignore", "ignore"]
//     });

//     let settled = false;
//     let stallTimer = null;
//     let killTimer = null;

//     const cleanup = () => {
//       if (stallTimer) {
//         clearTimeout(stallTimer);
//         stallTimer = null;
//       }
//       if (killTimer) {
//         clearTimeout(killTimer);
//         killTimer = null;
//       }
//     };

//     const finishErr = (err) => {
//       if (settled) return;
//       settled = true;
//       cleanup();
//       reject(err);
//     };

//     const finishOk = (payload) => {
//       if (settled) return;
//       settled = true;
//       cleanup();
//       resolve(payload);
//     };

//     child.on("error", finishErr);

//     child.on("close", (code) => {
//       if (settled) return;
//       if (daemonMode && stallTimer) {
//         clearTimeout(stallTimer);
//         stallTimer = null;
//       }
//       if (!daemonMode && killTimer) {
//         clearTimeout(killTimer);
//         killTimer = null;
//       }
//       if (code === 0) {
//         finishOk({ code, stdout: "", stderr: "", detached: false });
//       } else {
//         finishErr(
//           new Error(
//             `openclaw gateway ${action} 失败（退出码 ${code ?? "未知"}）。可在终端执行：openclaw gateway status`
//           )
//         );
//       }
//     });

//     if (daemonMode) {
//       stallTimer = setTimeout(() => {
//         if (settled) return;
//         settled = true;
//         cleanup();
//         try {
//           child.removeAllListeners("close");
//           child.unref();
//         } catch {}
//         resolve({ code: 0, stdout: "", stderr: "", detached: true });
//       }, GATEWAY_DAEMON_STALL_MS);
//     } else {
//       killTimer = setTimeout(() => {
//         if (settled) return;
//         try {
//           child.kill("SIGTERM");
//         } catch {}
//         setTimeout(() => {
//           try {
//             child.kill("SIGKILL");
//           } catch {}
//         }, 4000);
//         finishErr(new Error(`停止网关超时（${GATEWAY_STOP_TIMEOUT_MS}ms）`));
//       }, GATEWAY_STOP_TIMEOUT_MS);
//     }
//   });
// }

function tryResolveExecutableSync(name) {
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const pathValue = process.env[pathKey] || process.env.PATH || "";
  const paths = pathValue.split(path.delimiter).filter(Boolean);
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];

  for (const p of paths) {
    for (const ext of exts) {
      const candidate = path.join(p, process.platform === "win32" ? `${name}${ext}` : name);
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        // ignore
      }
    }
  }
  return null;
}

/**
 * 从 npm 全局目录（与 `openclaw.cmd` 同层）解析 openclaw 包入口脚本。
 */
function tryReadOpenClawScriptBesideCmdShim(cmdPath,pkgName) {
  const shimDir = path.dirname(cmdPath);
  const pkgRoot = path.join(shimDir, "node_modules", pkgName);
  const pkgJsonPath = path.join(pkgRoot, "package.json");
  if (!fs.existsSync(pkgJsonPath)) return null;
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  } catch {
    return null;
  }
  const bin = pkg?.bin;
  let rel = null;
  if (typeof bin === "string") rel = bin;
  else if (bin && typeof bin === "object") {
    if (typeof bin.openclaw === "string") rel = bin.openclaw;
    else if (typeof bin.npm === "string") rel = bin.npm;
    else {
      const first = Object.values(bin).find((v) => typeof v === "string");
      if (first) rel = /** @type {string} */ (first);
    }
  }
  if (!rel) return null;
  const scriptPath = path.join(pkgRoot, String(rel).replace(/^\.\//, ""));
  return fs.existsSync(scriptPath) ? scriptPath : null;
}

/**
 * 从 npm 生成的 `.cmd` 中解析 `"%dp0%\node_modules\openclaw\....mjs"` 一类路径。
 */
function tryParseOpenClawScriptFromCmdShimText(cmdPath) {
  try {
    const text = fs.readFileSync(cmdPath, "utf8");
    const m = text.match(/"%dp0%\\([^"]+)"/i);
    if (!m) return null;
    const rel = m[1].replace(/\//g, "\\");
    const scriptPath = path.normalize(path.join(path.dirname(cmdPath), rel));
    return fs.existsSync(scriptPath) ? scriptPath : null;
  } catch {
    return null;
  }
}

function nodeExeForNpmCmdShim(cmdPath) {
  const beside = path.join(path.dirname(cmdPath), "node.exe");
  if (fs.existsSync(beside)) return beside;
  return tryResolveExecutableSync("node") || "node";
}

/**
 * Windows：若即将通过 `npm.cmd` 启动，则改为 `node.exe` + `npm-cli.js`。
 */
function tryWindowsNpmDirectNodeSpawn(command, resolvedExecutable) {
  if (process.platform !== "win32") return null;
  const ext = path.extname(resolvedExecutable).toLowerCase();
  if (!WINDOWS_SHELL_EXTENSIONS.has(ext)) return null;
  const base = path.basename(resolvedExecutable, ext).toLowerCase();
  const cmdLow = String(command).toLowerCase().replace(/\\/g, "/");
  const isNpm =
    base === "npm" ||
    cmdLow === "npm" ||
    cmdLow.endsWith("/npm.cmd") ||
    cmdLow.endsWith("/npm.bat");
  if (!isNpm) return null;
  const scriptPath =
    tryReadOpenClawScriptBesideCmdShim(resolvedExecutable,"npm") ||
    tryParseOpenClawScriptFromCmdShimText(resolvedExecutable);
  if (!scriptPath) return null;
  return { nodeExe: nodeExeForNpmCmdShim(resolvedExecutable), scriptPath };
}

/**
 * Windows：若即将通过 `openclaw.cmd` + shell 启动，则改为 `node` + 包内脚本（不经 cmd.exe）。
 * @returns {{ nodeExe: string, scriptPath: string } | null}
 */
function tryWindowsOpenClawDirectNodeSpawn(command, resolvedExecutable) {
  if (process.platform !== "win32") return null;
  const ext = path.extname(resolvedExecutable).toLowerCase();
  if (!WINDOWS_SHELL_EXTENSIONS.has(ext)) return null;
  const base = path.basename(resolvedExecutable, ext).toLowerCase();
  const cmdLow = String(command).toLowerCase().replace(/\\/g, "/");
  const isOpenClaw =
    base === "openclaw" ||
    cmdLow === "openclaw" ||
    cmdLow.endsWith("/openclaw.cmd") ||
    cmdLow.endsWith("/openclaw.bat");
  if (!isOpenClaw) return null;
  const scriptPath =
    tryReadOpenClawScriptBesideCmdShim(resolvedExecutable,"openclaw") ||
    tryParseOpenClawScriptFromCmdShimText(resolvedExecutable);
  if (!scriptPath) return null;
  return { nodeExe: nodeExeForNpmCmdShim(resolvedExecutable), scriptPath };
}

async function detectNode() {
  const debug = getDebugOnboardingOptions();

  if (debug.mockNodeMissing) {
    return { installed: false, version: null, path: null };
  }

  const seen = new Set();
  const candidates = [];

  const normalizeKey = (p) =>
    process.platform === "win32" ? p.toLowerCase() : p;

  const pushCandidate = (p) => {
    if (!p) return;
    const s = String(p).trim();
    if (!s) return;
    const key = normalizeKey(s);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(s);
  };

  // ---------- 工具函数 ----------
  const isValidNodeVersion = (text) => {
    return /^v?\d+\.\d+\.\d+/.test(text);
  };

  const cleanVersion = (text) => {
    const t = text.trim();
    if (!t) return null;
    return t.startsWith("v") ? t : `v${t}`;
  };

  const tryNode = async (cmd) => {
    try {
      const res = await runCommand(cmd, ["--version"], { timeoutMs: 1500 });
      const out = String(res.stdout || "").trim();

      if (res.code === 0 && isValidNodeVersion(out)) {
        return {
          installed: true,
          version: debug.mockNodeVersion || cleanVersion(out),
          path: cmd
        };
      }
    } catch {}
    return null;
  };

  // ---------- 1️⃣ 快速路径 ----------
  const quick = await tryNode("node");
  if (quick) return quick;

  // ---------- 2️⃣ 系统级查找（关键） ----------
  if (process.platform === "win32") {
    try {
      const res = await runCommand("where", ["node"], { timeoutMs: 2000 });
      if (res.code === 0) {
        String(res.stdout || "")
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach(pushCandidate);
      }
    } catch {}
  } else {
    // macOS / Linux
    try {
      const res = await runCommand("which", ["-a", "node"], { timeoutMs: 2000 });
      if (res.code === 0) {
        String(res.stdout || "")
          .split(/\n/)
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach(pushCandidate);
      }
    } catch {}
  }

  // ---------- 3️⃣ 常见路径兜底 ----------
  if (process.platform === "win32") {
    pushCandidate("C:\\Program Files\\nodejs\\node.exe");
    pushCandidate("C:\\Program Files (x86)\\nodejs\\node.exe");
  } else {
    pushCandidate("/usr/local/bin/node");
    pushCandidate("/opt/homebrew/bin/node");
    pushCandidate("/usr/bin/node");
  }

  // ---------- 4️⃣ 遍历验证 ----------
  for (const candidate of candidates) {
    const result = await tryNode(candidate);
    if (result) return result;
  }

  // ---------- 5️⃣ 最终失败 ----------
  return {
    installed: false,
    version: null,
    path: null
  };
}

async function detectOpenClaw() {
  const debug = getDebugOnboardingOptions();
  if (debug.mockOpenClawMissing) {
    return { installed: false, version: null, path: null };
  }

  const guessedPath = tryResolveExecutableSync("openclaw");
  const cmd = guessedPath || "openclaw";
  try {
    const res = await runCommand(cmd, ["--version"], { timeoutMs: 5000 });
    const text = String(res.stdout || res.stderr || "").trim();
    if (res.code === 0 && text) {
      return {
        installed: true,
        version: text,
        path: cmd
      };
    }
    return {
      installed: false,
      version: null,
      path: null
    };
  } catch {
    return {
      installed: false,
      version: null,
      path: null
    };
  }
}

function getOnboardingSteps() {
  const env = state?.env ?? {};
  const onboarding = state?.onboarding ?? {};
  const firstAgentCreated =
    Boolean(onboarding.firstAgentCreated) || (Array.isArray(state?.agents) && state.agents.length > 0);
  return [
    {
      id: "install_node",
      title: "安装 Node.js",
      description: "需要 Node.js 22.16+，推荐 Node.js 24",
      done: Boolean(env.nodeInstalled && env.nodeCompatible)
    },
    {
      id: "install_openclaw",
      title: "安装 OpenClaw",
      description: "检测 openclaw 命令是否可用",
      done: Boolean(env.openclawInstalled)
    },
    {
      id: "config_model",
      title: "配置模型",
      description: "填写 API Key 并完成连接测试",
      done: Boolean(onboarding.modelConfigured)
    },
    {
      id: "create_agent",
      title: "创建首个智能体",
      description: "至少创建并保存一个智能体",
      done: Boolean(firstAgentCreated)
    }
  ];
}

function buildOnboardingState() {
  const debug = getDebugOnboardingOptions();
  // const steps = getOnboardingSteps();
  const pending = steps.find((s) => !s.done);
  const canEnterMain = pending == null && !debug.forceOnboarding;
  const currentStepId = pending ? pending.id : null;
  return {
    completed: canEnterMain || Boolean(state?.onboarding?.completed),
    canEnterMain,
    currentStepId,
    requirements: {
      nodeMin: "22.16.0",
      nodeRecommendedMajor: NODE_RECOMMENDED_MAJOR
    },
    debug,
    env: state.env,
    steps
  };
}

function friendlyNodeError(env) {
  if (!env.nodeInstalled) {
    return "未检测到 Node.js。请先安装 Node.js 24（或至少 22.16+），然后点击重试。";
  }
  if (!env.nodeCompatible) {
    return `Node.js 版本过低（当前 ${env.nodeVersion ?? "未知"}）。请升级到 22.16+，推荐 24。`;
  }
  return "";
}

async function refreshEnvIfNeeded(opts = {}) {
  if (!state) state = loadState();
  const force = Boolean(opts.force);
  const now = Date.now();
  if (!force && lastEnvRefreshAt > 0 && now - lastEnvRefreshAt < ENV_REFRESH_TTL_MS) {
    return;
  }
  lastEnvRefreshAt = now;

  const node = await detectNode();
  const openclaw = await detectOpenClaw();

  state.env = {
    ...state.env,
    nodeInstalled: node.installed,
    nodeVersion: node.version,
    nodePath: node.path,
    nodeCompatible: isNodeCompatible(node.version),
    nodeRecommended: isNodeRecommended(node.version),
    openclawInstalled: openclaw.installed,
    openclawVersion: openclaw.version,
    openclawPath: openclaw.path
  };

  // 未安装 OpenClaw 时，不应显示网关运行中（避免 mock 默认值误导用户）
  if (!openclaw.installed) {
    state.gatewayRunning = false;
  }

  if (openclaw.version) state.openclawVersion = openclaw.version;
  saveState(state);
}

async function refreshDefaultAgentIdIfNeeded() {
  if (!state) state = loadState();
  if (state.defaultAgentId) return;
  if (!state.env?.openclawInstalled) return;

  try {
    const res = await runCommand("openclaw", ["agents", "list", "--json"], { timeoutMs: 10000 });
    const parsed = extractJson(res.stdout);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const def = parsed.find((a) => a && a.isDefault) ?? parsed[0];
      if (def?.id) {
        state.defaultAgentId = String(def.id);
        saveState(state);
      }
    }
  } catch {
    // ignore; UI 会走兜底 agent id
  }
}

function interpretGatewayJson(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  if (typeof parsed.ok === "boolean") return parsed.ok;
  if (typeof parsed.healthy === "boolean") return parsed.healthy;
  if (typeof parsed.running === "boolean") return parsed.running;
  if (typeof parsed.reachable === "boolean") return parsed.reachable;
  const g = parsed.gateway;
  if (g && typeof g === "object" && typeof g.running === "boolean") return g.running;
  const p = parsed.probe;
  if (p && typeof p === "object" && typeof p.ok === "boolean") return p.ok;
  const h = parsed.health;
  if (h && typeof h === "object" && typeof h.ok === "boolean") return h.ok;
  return null;
}

function interpretGatewayTextHeuristic(text, code) {
  const s = String(text).toLowerCase();
  if (!s.trim()) return null;
  if (/\bnot\s+running\b|\bstopped\b|\bunreachable\b|\bunhealthy\b|\bis\s+down\b|\bno\s+gateway\b/.test(s)) {
    return false;
  }
  if (code !== 0 && /\b(error|failed)\b/.test(s)) return false;
  if (/\brunning\b|\bhealthy\b|\breachable\b|\bup\b|\bstarted\b/.test(s)) return true;
  return null;
}

/**
 * 直接通过 HTTP 请求网关 health 端点判断网关是否运行。
 * 不 spawn 任何子进程，彻底避免 Windows 上的 CMD 窗口闪烁。
 */
function fetchGatewayHealthHttp(port) {
  return new Promise((resolve) => {
    const url = `http://127.0.0.1:${port}/health`;
    const req = http.get(url, { timeout: 4000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 500) {
          try {
            const parsed = JSON.parse(data);
            const ok = interpretGatewayJson(parsed);
            if (ok !== null) { resolve(ok); return; }
          } catch {}
          resolve(res.statusCode >= 200 && res.statusCode < 300);
        } else {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

/**
 * 优先走 HTTP（零进程、无闪烁），失败时回退到 CLI 子进程。
 */
async function fetchGatewayRunningLight() {
  const port = state?.gatewayPort ?? DEFAULT_GATEWAY_PORT;
  const httpResult = await fetchGatewayHealthHttp(port);
  if (httpResult !== null) return httpResult;

  const sequences = [
    [
      ["gateway", "health", "--json"],
      ["gateway", "health"]
    ],
    [
      ["gateway", "status", "--json"],
      ["gateway", "status"]
    ],
    [["gateway", "probe", "--json", "--timeout", "1200"]]
  ];
  for (const seq of sequences) {
    for (const args of seq) {
      try {
        const timeoutMs = args[1] === "probe" ? 9000 : args.includes("--json") ? 7000 : 6000;
        const res = await runCommand("openclaw", args, { timeoutMs });
        const text = `${res.stdout || ""}\n${res.stderr || ""}`;
        const parsed = extractJson(res.stdout) || extractJson(res.stderr) || extractJson(text);
        let ok = interpretGatewayJson(parsed);
        if (ok === null) ok = interpretGatewayTextHeuristic(text, res.code);
        if (ok !== null) {
          syncGatewayPortFromCli(parsed, text);
          return ok;
        }
        syncGatewayPortFromCli(parsed, text);
        if (args[1] === "health" && res.code !== 0) return false;
      } catch {
        // 试下一种
      }
    }
  }
  return null;
}

async function probeGatewayOkImpl(opts = {}) {
  const bypassCache = Boolean(opts.bypassCache);
  if (!state.env?.openclawInstalled) return false;

  const now = Date.now();
  if (
    !bypassCache &&
    gatewayCheckCache.result !== null &&
    now - gatewayCheckCache.ts < GATEWAY_CHECK_CACHE_MS
  ) {
    return gatewayCheckCache.result;
  }

  const result = await fetchGatewayRunningLight();
  if (result !== null) {
    gatewayCheckCache = { ts: Date.now(), result };
  }
  return result;
}

async function probeGatewayOk(opts = {}) {
  const bypassCache = Boolean(opts.force);
  const prev = probeChain;
  let release;
  probeChain = new Promise((r) => {
    release = r;
  });
  await prev;
  try {
    return await probeGatewayOkImpl({ bypassCache });
  } finally {
    release();
  }
}

function getStatus() {
  const uptimeMs = state.gatewayRunning ? Date.now() - state.gatewayStartedAt : 0;
  return {
    gateway: {
      running: state.gatewayRunning,
      uptimeText: state.gatewayRunning ? formatUptime(uptimeMs) : "未运行",
      port: state.gatewayPort ?? DEFAULT_GATEWAY_PORT,
      lastAction: state.lastGatewayAction
    },
    versions: {
      openclaw: state.openclawVersion,
      manager: state.managerVersion
    },
    update: state.update,
    stats: state.stats,
    env: state.env
  };
}

function formatErrorMessage(err) {
  return String(err?.message ?? err ?? "未知错误");
}

function isSafeExternalHttpUrl(raw) {
  try {
    const u = new URL(String(raw ?? "").trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

async function checkOpenClawUpdate() {
  // MVP：若有真实 openclaw 则尝试读取当前版本并给出“可更新”的模拟最新版本。
  await refreshEnvIfNeeded();
  const currentText = String(state.openclawVersion ?? "v0.0.0");
  const currentParsed = parseSemver(currentText);
  let latestVersion = null;
  let hasUpdate = false;

  // 从 npm registry 查询真实最新版本
  try {
    const https = require("https");
    latestVersion = await new Promise((resolve, reject) => {
      const req = https.get("https://registry.npmjs.org/openclaw/latest", {
        headers: { "Accept": "application/json" },
        timeout: 10000
      }, (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          try { resolve(JSON.parse(body).version || null); }
          catch { resolve(null); }
        });
      });
      req.on("error", () => resolve(null));
      req.on("timeout", () => { req.destroy(); resolve(null); });
    });
  } catch (_) { /* registry 查询失败 */ }

  // 兜底：npm view 命令
  if (!latestVersion) {
    try {
      const res = await runCommand("npm", ["view", "openclaw", "version"], { timeoutMs: 15000 });
      if (res.code === 0 && res.stdout) {
        const raw = res.stdout.trim().replace(/^"|"$/g, "");
        if (/^\d+\.\d+\.\d+/.test(raw)) latestVersion = raw;
      }
    } catch (_) { /* ignore */ }
  }

  if (latestVersion && currentParsed) {
    const latestParsed = parseSemver(latestVersion);
    if (latestParsed) {
      hasUpdate = compareSemver(latestParsed, currentParsed) > 0;
    }
  }

  state.update = {
    latestVersion: latestVersion ?? currentText,
    checkedAt: new Date().toISOString(),
    hasUpdate
  };
  saveState(state);
  return state.update;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });

  const useUiDevServer = envFlag("OPENCLAW_UI_DEV");
  const uiDevUrl = String(process.env.OPENCLAW_UI_DEV_URL || "http://127.0.0.1:5173");
  const uiDistHtml = path.join(__dirname, "renderer", "dist", "index.html");
  if (useUiDevServer) {
    win.loadURL(uiDevUrl);
  } else if (fs.existsSync(uiDistHtml)) {
    win.loadFile(uiDistHtml);
  } else {
    // 兜底：在 React UI 尚未 build 时仍可打开参考静态页
    win.loadFile(path.join(__dirname, "UI", "ui.html"));
  }
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
}

function startHotReloadIfNeeded() {
  // 仅开发场景启用；可通过 OPENCLAW_HOT_RELOAD=0 关闭
  if (app.isPackaged) return;
  const enabled = !["0", "false", "off"].includes(
    String(process.env.OPENCLAW_HOT_RELOAD ?? "1").trim().toLowerCase()
  );
  if (!enabled) return;
  if (hotReloadWatchers.length > 0) return;

  const watchTargets = [
    path.join(__dirname, "renderer", "index.html"),
    path.join(__dirname, "renderer", "src"),
    path.join(__dirname, "main.js"),
    path.join(__dirname, "preload.js")
  ];

  const scheduleRelaunch = () => {
    if (hotReloadRestarting) return;
    hotReloadRestarting = true;
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 120);
  };

  watchTargets.forEach((target) => {
    try {
      const watcher = fs.watch(target, { persistent: true }, (eventType) => {
        if (eventType !== "change" && eventType !== "rename") return;
        const base = path.basename(target);
        if (target.includes(path.join("renderer", "index.html")) || target.includes(path.join("renderer", "src"))) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.reloadIgnoringCache();
          }
          return;
        }
        scheduleRelaunch();
      });
      hotReloadWatchers.push(watcher);
    } catch {
      // ignore watcher creation failures in constrained environments
    }
  });
}

ipcMain.handle("manager:getStatus", async (_event, payload) => {
  if (!state) state = loadState();
  const forceEnv = Boolean(payload?.forceEnv);
  await refreshEnvIfNeeded({ force: forceEnv });
  await refreshDefaultAgentIdIfNeeded();

  // 轻量 health/status（带缓存）；避免高频 `gateway probe`（discover 很重）
  if (state.env?.openclawInstalled) {
    try {
      const wasRunning = state.gatewayRunning;
      const ok = await probeGatewayOk();
      if (ok !== null) {
        state.gatewayRunning = ok;
        if (ok && !wasRunning) state.gatewayStartedAt = Date.now();
        if (!ok && wasRunning) state.gatewayRunning = false;
        saveState(state);
      }
    } catch {
      // probe 失败时保留当前状态（不会把用户误导为未运行）
    }
  }

  return getStatus();
});

ipcMain.handle("manager:openExternal", async (_event, payload) => {
  const url = typeof payload === "string" ? payload : payload?.url;
  if (!isSafeExternalHttpUrl(url)) {
    return { ok: false, error: "非法链接，仅允许 http/https。" };
  }
  try {
    await shell.openExternal(String(url));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: formatErrorMessage(e) };
  }
});

ipcMain.handle("manager:getOnboardingState", async () => {
  if (!state) state = loadState();
  await refreshEnvIfNeeded();
  await refreshDefaultAgentIdIfNeeded();
  return buildOnboardingState();
});

ipcMain.handle("manager:retryOnboardingStep", async (_event, payload) => {
  if (!state) state = loadState();
  await refreshEnvIfNeeded({ force: true });

  const stepId = String(payload?.stepId ?? "").trim();
  if (stepId === "install_node") {
    if (!state.env.nodeInstalled || !state.env.nodeCompatible) {
      return { ok: false, message: friendlyNodeError(state.env), onboarding: buildOnboardingState() };
    }
    return { ok: true, message: "Node.js 环境检测通过。", onboarding: buildOnboardingState() };
  }

  if (stepId === "install_openclaw") {
    if (!state.env.openclawInstalled) {
      return {
        ok: false,
        message: "未检测到 OpenClaw。请完成安装并确保 `openclaw --version` 可执行，然后点击重试。",
        onboarding: buildOnboardingState()
      };
    }
    return { ok: true, message: "OpenClaw 环境检测通过。", onboarding: buildOnboardingState() };
  }

  if (stepId === "config_model") {
    const provider = String(payload?.provider ?? "").trim();
    const modelId = String(payload?.modelId ?? payload?.model ?? "").trim();
    const apiKey = String(payload?.apiKey ?? "").trim();
    const ok = Boolean(provider) && Boolean(modelId) && apiKey.length > 0;
    if (!ok) {
      return { ok: false, message: "请填写服务商、模型和 API Key。", onboarding: buildOnboardingState() };
    }
    state.onboarding.modelConfigured = true;
    saveState(state);
    return { ok: true, message: "模型配置完成。", onboarding: buildOnboardingState() };
  }

  if (stepId === "create_agent") {
    const name = String(payload?.agent?.name ?? "").trim();
    if (!name) {
      return { ok: false, message: "请先填写智能体名称。", onboarding: buildOnboardingState() };
    }
    const agent = payload.agent;
    state.agents = Array.isArray(state.agents) ? state.agents : [];
    const idx = state.agents.findIndex((a) => String(a?.name ?? "") === name);
    if (idx >= 0) state.agents[idx] = agent;
    else state.agents.push(agent);
    state.onboarding.firstAgentCreated = true;
    saveState(state);
    return { ok: true, message: "首个智能体创建完成。", onboarding: buildOnboardingState() };
  }

  return { ok: false, message: "未知步骤。", onboarding: buildOnboardingState() };
});

ipcMain.handle("manager:finishOnboarding", async () => {
  if (!state) state = loadState();
  await refreshEnvIfNeeded({ force: true });
  const onboarding = buildOnboardingState();
  if (!onboarding.canEnterMain) {
    return { ok: false, message: "仍有未完成步骤，请先完成引导。", onboarding };
  }
  state.onboarding.completed = true;
  state.onboarding.completedAt = new Date().toISOString();
  saveState(state);
  return { ok: true, onboarding: buildOnboardingState() };
});

ipcMain.handle("manager:controlGateway", async (_event, action) => {
  if (managerGatewayControlBusy) {
    return {
      ...getStatus(),
      error: "网关操作正在进行，请稍候再试。",
    };
  }
  managerGatewayControlBusy = true;
  try {
    if (!state) state = loadState();
    await refreshEnvIfNeeded({ force: true });
    if (!state.env?.openclawInstalled) {
      return {
        ...getStatus(),
        error: "未检测到 OpenClaw。请先安装 OpenClaw 并确保 `openclaw` 命令可用。"
      };
    }

    const act = String(action || "").trim();
    if (!["start", "stop", "restart"].includes(act)) {
      return { ...getStatus(), error: `未知操作：${act}` };
    }

    invalidateGatewayProbeCache();

    const tryProbe = async () => {
      try {
        return await probeGatewayOk({ force: true });
      } catch {
        return null;
      }
    };

    // const waitFor = async (expectOk, { attempts = 5, delayMs = 1000 } = {}) => {
    //   for (let i = 0; i < attempts; i += 1) {
    //     const ok = await tryProbe();
    //     if (ok === null) {
    //       await new Promise((r) => setTimeout(r, delayMs));
    //       continue;
    //     }
    //     if (Boolean(ok) === Boolean(expectOk)) return ok;
    //     await new Promise((r) => setTimeout(r, delayMs));
    //   }
    //   return null;
    // };

    const failProbe = (label) => {
      const msg = `已执行${label}，但健康检查仍未确认。请稍候刷新，或终端运行：openclaw gateway status / openclaw gateway health`;
      state.lastGatewayAction = {
        action: act,
        ok: false,
        at: new Date().toISOString(),
        message: msg
      };
      saveState(state);
      return { ...getStatus(), error: msg };
    };

    try {
      if (act === "restart") {
        const result = await runOpenClawGatewayAction("restart");
        if (!result || result.code !== 0) return failProbe("重启");
        // const ok = await waitFor(true);
        // if (ok === null) return failProbe("重启");
        state.gatewayRunning = true;
        state.gatewayStartedAt = Date.now();
        state.lastGatewayAction = {
          action: "restart",
          ok: true,
          at: new Date().toISOString(),
          message: "网关已重启"
        };
        saveState(state);
        return getStatus();
      }

      if (act === "stop") {
        const result = await runOpenClawGatewayAction("stop");
        if (!result || result.code !== 0) return failProbe("停止");
        // await runOpenClawGatewayAction("stop");
        // const ok = await waitFor(false);
        // if (ok === null) return failProbe("停止");
        state.gatewayRunning = false;
        state.lastGatewayAction = {
          action: "stop",
          ok: true,
          at: new Date().toISOString(),
          message: "网关已停止"
        };
        saveState(state);
        return getStatus();
      }

      if (act === "start") {
        const result = await runOpenClawGatewayAction("start");
        if (!result || result.code !== 0) return failProbe("启动");
        // await runOpenClawGatewayAction("start");
        // const ok = await waitFor(true);
        // if (ok === null) return failProbe("启动");
        state.gatewayRunning = true;
        state.gatewayStartedAt = Date.now();
        state.lastGatewayAction = {
          action: "start",
          ok: true,
          at: new Date().toISOString(),
          message: "网关已启动"
        };
        saveState(state);
        return getStatus();
      }
    } catch (e) {
      state.lastGatewayAction = {
        action: String(act || "unknown"),
        ok: false,
        at: new Date().toISOString(),
        message: `网关操作失败：${formatErrorMessage(e)}`
      };
      saveState(state);
      return {
        ...getStatus(),
        error: `网关操作失败：${formatErrorMessage(e)}`
      };
    }

    return getStatus();
  } finally {
    managerGatewayControlBusy = false;
  }
});

ipcMain.handle("manager:checkUpdates", async () => {
  if (!state) state = loadState();
  try {
    const update = await checkOpenClawUpdate();
    return {
      ok: true,
      message: update.hasUpdate
        ? `发现新版本 ${update.latestVersion}。`
        : "当前已是最新版本。",
      status: getStatus()
    };
  } catch (e) {
    return {
      ok: false,
      message: `检查更新失败：${formatErrorMessage(e)}`,
      status: getStatus()
    };
  }
});

ipcMain.handle("manager:updateOpenClaw", async () => {
  if (!state) state = loadState();
  await refreshEnvIfNeeded({ force: true });
  if (!state.env?.openclawInstalled) {
    return { ok: false, message: "未检测到 OpenClaw，无法升级。", status: getStatus() };
  }

  try {
    const res = await runCommand("openclaw", ["update", "--yes", "--json", "--no-restart"], { timeoutMs: 300000 });
    if (res.code !== 0) {
      return { ok: false, message: `升级失败：${res.stderr || `退出码 ${res.code}`}`, status: getStatus() };
    }

    // 刷新本地版本信息
    await refreshEnvIfNeeded({ force: true });
    const update = await checkOpenClawUpdate();
    if (update.latestVersion) {
      state.openclawVersion = update.latestVersion;
      state.update.hasUpdate = false;
    }
    state.lastGatewayAction = {
      action: "update",
      ok: true,
      at: new Date().toISOString(),
      message: `OpenClaw 已升级到 ${state.openclawVersion}`
    };
    saveState(state);
    return { ok: true, message: state.lastGatewayAction.message, status: getStatus() };
  } catch (e) {
    return { ok: false, message: `升级失败：${formatErrorMessage(e)}`, status: getStatus() };
  }
});

ipcMain.handle("manager:installOpenClaw", async () => {
  if (!state) state = loadState();
  await refreshEnvIfNeeded({ force: true });
  if (state.env?.openclawInstalled) {
    return { ok: false, message: "OpenClaw 已安装，无需重复安装。", status: getStatus() };
  }
  try {
    // 与全局 runCommand 一致：Windows 上 resolveSpawn 会定位 npm.cmd 并用 shell 执行；并对 exit 做兜底，避免仅监听 close 时卡住。
    const res = await runCommand("npm", ["install", "-g", "openclaw@latest","--registry=https://registry.npmmirror.com"], {
      timeoutMs: 12 * 60 * 1000
    });
    if (res.code !== 0) {
      const stripAnsi = (s) => String(s ?? "").replace(/\x1b\[[\d;?]*[ -/]*[@-~]/g, "");
      throw new Error(stripAnsi(res.stderr) || `npm install 退出码 ${res.code}`);
    }
    state.env.openclawInstalled = true;
    saveState(state);
    await refreshEnvIfNeeded({ force: true });
    return { ok: true, message: "OpenClaw 安装完成。", status: getStatus() };
  } catch (e) {
    return { ok: false, message: `安装失败：${formatErrorMessage(e)}`, status: getStatus() };
  }
});

ipcMain.handle("manager:setupOpenClaw", async () => {
  if (!state) state = loadState();
  // 注意：Windows 上全局 npm 安装完成后，当前进程 PATH 可能尚未包含新的 openclaw.cmd。
  // 因此这里不以 env 探测为强依赖，而是尽量通过 npm prefix 解析到绝对路径再执行。
  // await refreshEnvIfNeeded({ force: true });

  try {
    let cmd = "openclaw";
    // if (process.platform === "win32") {
    //   try {
    //     const prefixRes = await new Promise((resolve, reject) => {
    //       const child = spawn("cmd", ["/c", "npm", "config", "get", "prefix"], {
    //         env: process.env,
    //         windowsHide: true,
    //         stdio: ["ignore", "pipe", "pipe"]
    //       });
    //       let stdout = "";
    //       let stderr = "";
    //       child.stdout.on("data", (d) => { stdout += String(d); });
    //       child.stderr.on("data", (d) => { stderr += String(d); });
    //       const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("npm prefix 解析超时")); }, 8000);
    //       child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    //       child.on("error", (err) => { clearTimeout(timer); reject(err); });
    //     });
    //     if (prefixRes.code === 0) {
    //       const prefix = String(prefixRes.stdout ?? "").trim().split(/\r?\n/)[0]?.trim();
    //       if (prefix && path.isAbsolute(prefix)) {
    //         const candidate = path.join(prefix, "openclaw.cmd");
    //         if (fs.existsSync(candidate)) {
    //           cmd = candidate;
    //         }
    //       }
    //     }
    //   } catch {
    //     // ignore
    //   }
    // }

    const res = await runCommand(cmd, ["setup"], { timeoutMs: 300000 });
    if (res.code !== 0) {
      return { ok: false, message: `设置失败：${res.stderr || `退出码 ${res.code}`}`, status: getStatus() };
    }
    // await refreshEnvIfNeeded({ force: true });
    return { ok: true, message: "设置完成。", status: getStatus() };
  } catch (e) {
    return { ok: false, message: `设置失败：${formatErrorMessage(e)}`, status: getStatus() };
  }
});

ipcMain.handle("manager:uninstallOpenClaw", async () => {
  if (!state) state = loadState();
  await refreshEnvIfNeeded({ force: true });
  if (!state.env?.openclawInstalled) {
    return { ok: false, message: "未检测到 OpenClaw，无需卸载。", status: getStatus() };
  }

  try {
    await runCommand("openclaw", ["uninstall", "--yes"], { timeoutMs: 120000 });
    state.env.openclawInstalled = false;
    state.env.openclawVersion = null;
    state.openclawVersion = "未安装";
    state.gatewayRunning = false;
    state.lastGatewayAction = {
      action: "uninstall",
      ok: true,
      at: new Date().toISOString(),
      message: "OpenClaw 已卸载"
    };
    saveState(state);
    return { ok: true, message: "OpenClaw 卸载完成。", status: getStatus() };
  } catch (e) {
    return { ok: false, message: `卸载失败：${formatErrorMessage(e)}`, status: getStatus() };
  }
});

ipcMain.handle("manager:getGatewayConnectInfo", async () => {
  if (!state) state = loadState();
  const fromFile = readOpenClawJsonGatewayAuth();
  const port =
    (typeof fromFile.configPort === "number" ? fromFile.configPort : null) ??
    state.gatewayPort ??
    DEFAULT_GATEWAY_PORT;
  const token =
    String(process.env.OPENCLAW_GATEWAY_TOKEN ?? "").trim() || fromFile.token || undefined;
  const password =
    String(process.env.OPENCLAW_GATEWAY_PASSWORD ?? "").trim() || fromFile.password || undefined;
  return {
    wsUrl: `ws://127.0.0.1:${port}`,
    token,
    password,
  };
});

ipcMain.handle("manager:gatewayCall", async (_event, payload) => {
  const method = String(payload?.method ?? "").trim();
  const params = payload?.params;
  const timeoutMs = typeof payload?.timeoutMs === "number" ? payload.timeoutMs : undefined;
  if (!method) {
    return { ok: false, error: "缺少 method。", result: null };
  }
  if (!state) state = loadState();
  try {
    const raw = await runOpenClawGatewayRpc(method, params, { timeoutMs });
    return {
      ok: raw.code === 0,
      code: raw.code,
      result: raw.result,
      stderr: raw.stderr || undefined,
      error: raw.code !== 0 ? raw.stderr || `网关调用失败（退出码 ${raw.code}）` : undefined
    };
  } catch (e) {
    return { ok: false, error: formatErrorMessage(e), result: null };
  }
});

const HTTP_FETCH_ALLOW_HOSTS = new Set([
  "wry-manatee-359.convex.cloud",
]);

ipcMain.handle("manager:httpFetch", async (_event, payload) => {
  try {
    const url = String(payload?.url ?? "").trim();
    const method = String(payload?.method ?? "").trim().toUpperCase();
    const timeoutMs =
      typeof payload?.timeoutMs === "number" && payload.timeoutMs > 0 ? payload.timeoutMs : 25_000;

    if (!url) return { ok: false, error: "缺少 url。" };
    let u;
    try {
      u = new URL(url);
    } catch {
      return { ok: false, error: "非法 url。" };
    }
    if (u.protocol !== "https:") {
      return { ok: false, error: "仅允许 https。" };
    }
    const host = String(u.hostname ?? "").toLowerCase();
    if (!HTTP_FETCH_ALLOW_HOSTS.has(host)) {
      return { ok: false, error: `禁止访问的域名：${host}` };
    }
    if (method !== "POST") {
      return { ok: false, error: "仅允许 POST。" };
    }

    const headersIn = payload?.headers && typeof payload.headers === "object" ? payload.headers : {};
    const headers = {};
    for (const [k, v] of Object.entries(headersIn)) {
      const key = String(k ?? "").trim().toLowerCase();
      const val = String(v ?? "").trim();
      if (!key || !val) continue;
      if (key === "content-type" || key === "accept") {
        headers[key] = val;
      }
    }
    if (!headers["content-type"]) headers["content-type"] = "application/json";
    if (!headers["accept"]) headers["accept"] = "application/json";

    const body = typeof payload?.body === "string" ? payload.body : "";

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: "POST", headers, body, signal: ac.signal });
      const bodyText = await res.text();
      const outHeaders = {};
      try {
        for (const [k, v] of res.headers.entries()) {
          const kk = String(k ?? "").toLowerCase();
          if (!kk) continue;
          if (kk === "content-type" || kk === "cache-control") outHeaders[kk] = String(v ?? "");
        }
      } catch {}
      return {
        ok: true,
        status: res.status,
        bodyText,
        headers: outHeaders,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return { ok: false, error: formatErrorMessage(e) };
  }
});

ipcMain.handle("manager:channelsLoginStart", async (event, payload) => {
  if (!state) state = loadState();
  const wc = event.sender;
  await refreshEnvIfNeeded({ force: false });
  if (!state?.env?.openclawInstalled) {
    return { ok: false, error: "未检测到 OpenClaw，无法执行 channels login。" };
  }
  const channel = String(payload?.channel ?? "").trim().toLowerCase();
  if (!isSafeChannelKey(channel)) {
    return { ok: false, error: "非法 channel（仅允许字母/数字/.-_）。" };
  }
  const accountRaw = String(payload?.accountId ?? "").trim();
  if (accountRaw && !isSafeAccountId(accountRaw)) {
    return { ok: false, error: "非法 accountId。" };
  }
  const verbose = payload?.verbose === true;
  for (const [sid, sess] of channelsLoginSessions) {
    if (sess.wc === wc) {
      try {
        sess.child.kill("SIGTERM");
      } catch {}
      if (sess.killTimer) clearTimeout(sess.killTimer);
      if (sess.genTimer) clearTimeout(sess.genTimer);
      channelsLoginSessions.delete(sid);
    }
  }

  const args = ["channels", "login", "--channel", channel];
  if (accountRaw) {
    args.push("--account", accountRaw);
  }
  if (verbose) {
    args.push("--verbose");
  }
  const sessionId = randomUUID();
  let sp;
  try {
    sp = resolveSpawn("openclaw", args, {});
  } catch (e) {
    return { ok: false, error: formatErrorMessage(e) };
  }
  const spawnArgs = sp.spawnArgPrefix ? [...sp.spawnArgPrefix, ...args] : args;
  const child = spawn(sp.executable, spawnArgs, {
    env: sp.env,
    cwd: sp.cwd,
    shell: sp.useShell,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  /** @type {{ child: import('child_process').ChildProcess; wc: import('electron').WebContents; sentQr: boolean; buf: string; killTimer?: NodeJS.Timeout | null; genTimer?: NodeJS.Timeout | null }} */
  const sess = { child, wc, sentQr: false, buf: "", killTimer: null, genTimer: null };
  const onChunk = (chunk) => {
    sess.buf = appendCapped(sess.buf, chunk);
    const qr = tryExtractQrDataUrl(sess.buf);
    if (qr && !sess.sentQr) {
      sess.sentQr = true;
      notifyChannelsLogin(wc, { sessionId, kind: "qr", dataUrl: qr });
      return;
    }
    const maybePayload = tryPickQrPayloadString(sess.buf);
    if (maybePayload && !sess.sentQr) {
      if (sess.genTimer) clearTimeout(sess.genTimer);
      sess.genTimer = setTimeout(() => {
        void (async () => {
          const live = channelsLoginSessions.get(sessionId);
          if (!live || live.sentQr) return;
          const latest = tryPickQrPayloadString(live.buf);
          const payload = latest || maybePayload;
          const url = await tryUrlOrPayloadToQrDataUrl(payload);
          if (url && !live.sentQr) {
            live.sentQr = true;
            notifyChannelsLogin(wc, { sessionId, kind: "qr", dataUrl: url });
          }
        })();
      }, 700);
    }
  };
  child.stdout.on("data", onChunk);
  child.stderr.on("data", onChunk);

  child.on("close", (code) => {
    const cur = channelsLoginSessions.get(sessionId);
    if (cur?.killTimer) clearTimeout(cur.killTimer);
    if (cur?.genTimer) clearTimeout(cur.genTimer);
    const rawBuf = cur?.buf ? String(cur.buf).trim() : "";
    const outputTail = rawBuf.length > 6000 ? rawBuf.slice(-6000) : rawBuf;
    channelsLoginSessions.delete(sessionId);
    notifyChannelsLogin(wc, {
      sessionId,
      kind: "exit",
      code: code ?? -1,
      ...(outputTail ? { outputTail } : {})
    });
  });
  child.on("error", (err) => {
    const cur = channelsLoginSessions.get(sessionId);
    if (cur?.killTimer) clearTimeout(cur.killTimer);
    if (cur?.genTimer) clearTimeout(cur.genTimer);
    channelsLoginSessions.delete(sessionId);
    notifyChannelsLogin(wc, { sessionId, kind: "error", message: formatErrorMessage(err) });
  });

  sess.killTimer = setTimeout(() => {
    try {
      child.kill("SIGTERM");
    } catch {}
  }, 600000);

  channelsLoginSessions.set(sessionId, sess);
  return { ok: true, sessionId };
});

ipcMain.handle("manager:channelsLoginCancel", async (event, payload) => {
  const sid = String(payload?.sessionId ?? "").trim();
  const wc = event.sender;
  const sess = channelsLoginSessions.get(sid);
  if (sess && sess.wc === wc) {
    if (sess.killTimer) clearTimeout(sess.killTimer);
    if (sess.genTimer) clearTimeout(sess.genTimer);
    try {
      sess.child.kill("SIGTERM");
    } catch {}
    channelsLoginSessions.delete(sid);
  }
  return { ok: true };
});

ipcMain.handle("manager:pairingCli", async (_event, payload) => {
  if (!state) state = loadState();
  try {
    const raw = await runOpenClawPairingCli(payload ?? {});
    return {
      ok: true,
      code: raw.code,
      result: raw.result,
      stderr: raw.stderr || undefined,
      elapsedMs: raw.elapsedMs
    };
  } catch (e) {
    return { ok: false, error: formatErrorMessage(e), result: null };
  }
});

ipcMain.handle("manager:pluginCli", async (_event, payload) => {
  if (!state) state = loadState();
  try {
    const raw = await runOpenClawPluginCli(payload ?? {});
    return {
      ok: true,
      code: raw.code,
      result: raw.result,
      stderr: raw.stderr || undefined,
      elapsedMs: raw.elapsedMs
    };
  } catch (e) {
    return { ok: false, error: formatErrorMessage(e), result: null };
  }
});

ipcMain.handle("manager:pluginsList", async () => {
  if (!state) state = loadState();
  try {
    const raw = await runOpenClawPluginCli({ action: "list" });
    return {
      ok: true,
      code: raw.code,
      result: raw.result,
      stderr: raw.stderr || undefined,
      elapsedMs: raw.elapsedMs
    };
  } catch (e) {
    return { ok: false, error: formatErrorMessage(e), result: null };
  }
});

function isSafeSkillSlug(v) {
  const s = String(v ?? "").trim();
  // ClawHub slug 通常是 a-z0-9-_.，这里放宽到常见安全字符，避免注入与路径穿越。
  return /^[a-z0-9][a-z0-9._/-]{0,127}$/i.test(s) && !s.includes("..") && !s.includes("\\");
}

let skillsInstallBusy = false;
let clawHubRateLimitedAt = 0;
const CLAWHUB_RATE_LIMIT_COOLDOWN_MS = 120_000;

ipcMain.handle("manager:skillsInstall", async (_event, payload) => {
  if (!state) state = loadState();
  if (clawHubRateLimitedAt && Date.now() - clawHubRateLimitedAt < CLAWHUB_RATE_LIMIT_COOLDOWN_MS) {
    const leftMs = CLAWHUB_RATE_LIMIT_COOLDOWN_MS - (Date.now() - clawHubRateLimitedAt);
    const leftSec = Math.max(1, Math.ceil(leftMs / 1000));
    return {
      ok: false,
      error: `ClawHub 限流中（429）。请等待约 ${leftSec}s 后重试。`,
    };
  }
  if (skillsInstallBusy) {
    return { ok: false, error: "已有安装任务进行中，请稍候再试。" };
  }
  skillsInstallBusy = true;
  try {
    await refreshEnvIfNeeded({ force: true });
    if (!state.env?.openclawInstalled) {
      return { ok: false, error: "未检测到 OpenClaw，无法执行 clawhub install。" };
    }

    const slug = String(payload?.slug ?? "").trim();
    const version = String(payload?.version ?? "").trim();
    const force = payload?.force === true;
    if (!slug) return { ok: false, error: "缺少 slug。" };
    if (!isSafeSkillSlug(slug)) return { ok: false, error: "非法 slug。" };

    const workspaceDir = readOpenClawDefaultWorkspaceDir();
    const cwd = workspaceDir || undefined;
    if (!cwd) {
      return { ok: false, error: "未找到 OpenClaw workspace（agents.defaults.workspace）。" };
    }

    const args = ["install", slug, "--workdir", cwd, "--dir", "skills"];
    if (force) args.push("--force");
    if (version) {
      if (!/^[a-z0-9][a-z0-9._+-]{0,63}$/i.test(version)) return { ok: false, error: "非法 version。" };
      args.push("--version", version);
    }

    const env = { ...process.env };

    const t0 = Date.now();
    const res = await runCommand("clawhub", args, { timeoutMs: 6 * 60 * 1000, outputCap: 2 * 1024 * 1024, cwd, env });
    const elapsedMs = Date.now() - t0;
    const stripAnsi = (s) => String(s ?? "").replace(/\x1b\[[\d;?]*[ -/]*[@-~]/g, "");
    const stderrClean = stripAnsi(res.stderr);
    if (/\(429\)|rate limit exceeded/i.test(stderrClean)) {
      clawHubRateLimitedAt = Date.now();
    }
    return {
      ok: res.code === 0,
      code: res.code,
      stdout: res.stdout ? stripAnsi(res.stdout) : undefined,
      stderr: res.stderr ? stderrClean : undefined,
      elapsedMs,
      error: res.code === 0 ? undefined : (stderrClean || `clawhub install 失败（退出码 ${res.code}）`),
    };
  } catch (e) {
    return { ok: false, error: formatErrorMessage(e) };
  } finally {
    skillsInstallBusy = false;
  }
});

ipcMain.handle("manager:pluginToggle", async (_event, payload) => {
  if (!state) state = loadState();
  try {
    const action = String(payload?.action ?? "").trim().toLowerCase();
    const pluginId = String(payload?.pluginId ?? "").trim();
    if (!["install", "enable", "disable"].includes(action)) {
      return { ok: false, error: `不支持的插件操作：${action}`, result: null };
    }
    const raw = await runOpenClawPluginCli({ action, pluginId });
    return {
      ok: true,
      code: raw.code,
      result: raw.result,
      stderr: raw.stderr || undefined,
      elapsedMs: raw.elapsedMs
    };
  } catch (e) {
    return { ok: false, error: formatErrorMessage(e), result: null };
  }
});

ipcMain.handle("manager:chat", async (_event, payload) => {
  const message = String(payload?.message ?? "").trim();
  if (!message) return { reply: "你还没有输入消息。" };

  if (!state) state = loadState();

  try {
    await refreshEnvIfNeeded({ force: true });
    if (!state.env?.openclawInstalled) {
      return { reply: "未检测到 OpenClaw。请先安装 OpenClaw 并确保 `openclaw` 命令可用。" };
    }

    await refreshDefaultAgentIdIfNeeded();

    const rawAgentId = String(payload?.agentId ?? state.defaultAgentId ?? "Assistant").trim();
    const sessionKeyOpt = String(payload?.sessionKey ?? "").trim();

    try {
      return await chatViaGateway(message, rawAgentId, sessionKeyOpt || undefined);
    } catch (gwErr) {
      const gwMsg = String(gwErr?.message ?? gwErr ?? "");
      try {
        return await chatViaAgentCli(message, rawAgentId);
      } catch (cliErr) {
        const cliMsg = String(cliErr?.message ?? cliErr ?? "");
        return {
          reply:
            `网关聊天不可用：${gwMsg}\n\nCLI 回退也失败：${cliMsg}\n\n` +
            `请确认：1）已执行 openclaw gateway start 且网关健康；2）智能体 ID「${rawAgentId}」在配置中存在；3）模型可用。`
        };
      }
    }
  } catch (e) {
    const raw = String(e?.message ?? e ?? "");

    if (/Unknown agent id/i.test(raw)) {
      return { reply: `找不到智能体：${raw}\n\n下一步：请先在 OpenClaw 配置里确认智能体是否存在，然后再重试。` };
    }
    if (/gateway/i.test(raw) && /unreachable|unavailable|reach/i.test(raw)) {
      return { reply: `网关当前不可用。\n\n下一步：先启动网关（` + "`openclaw gateway start`" + `），再重试。` };
    }
    return { reply: `聊天失败：${raw}\n\n下一步：请检查网关是否运行、以及智能体/模型配置是否正确。` };
  }
});

ipcMain.handle("manager:saveAgent", async (_event, payload) => {
  if (!state) state = loadState();

  const agent = payload?.agent ?? payload ?? {};
  if (!agent || typeof agent !== "object" || !String(agent.name ?? "").trim()) {
    return { ok: false, message: "缺少智能体名称（name）。" };
  }

  state.agents = Array.isArray(state.agents) ? state.agents : [];
  const name = String(agent.name).trim();
  const idx = state.agents.findIndex((a) => String(a?.name ?? "") === name);
  if (idx >= 0) state.agents[idx] = agent;
  else state.agents.push(agent);
  state.onboarding.firstAgentCreated = true;

  saveState(state);
  return { ok: true, agent };
});

ipcMain.handle("manager:deleteAgent", async (_event, payload) => {
  const id = String(payload?.id ?? "").trim();
  if (!id) return { ok: false, error: "智能体 ID 不能为空。" };
  const fs = require("fs");

  // 先从 openclaw.json 读取该智能体的目录路径，以便 CLI 删除后清理
  let workspaceDir = "";
  let agentDir = "";
  try {
    const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const entry = (cfg?.agents?.list ?? []).find((a) => String(a?.id ?? "") === id);
      if (entry) {
        workspaceDir = String(entry.workspace ?? "").trim();
        agentDir = String(entry.agentDir ?? "").trim();
      }
    }
  } catch (_) { /* 读取失败不影响删除流程 */ }

  // 如果没从配置找到，使用默认推断路径
  if (!workspaceDir) workspaceDir = path.join(os.homedir(), ".openclaw", `workspace-${id}`);
  if (!agentDir) agentDir = path.join(os.homedir(), ".openclaw", "agents", id);

  try {
    const res = await runCommand(
      "openclaw",
      ["agents", "delete", id, "--force", "--json"],
      { timeoutMs: 30000 }
    );
    if (res.code !== 0) {
      return { ok: false, error: res.stderr || `退出码 ${res.code}` };
    }

    // CLI 完成后清理残留目录
    const dirsToRemove = new Set();
    if (workspaceDir) dirsToRemove.add(workspaceDir);
    if (agentDir) {
      dirsToRemove.add(agentDir);
      // agentDir 通常是 .openclaw/agents/<id>/agent，也清理父目录 .openclaw/agents/<id>
      const agentParent = path.dirname(agentDir);
      if (agentParent !== path.join(os.homedir(), ".openclaw", "agents")) {
        dirsToRemove.add(agentParent);
      }
    }
    for (const dir of dirsToRemove) {
      try {
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      } catch (_) { /* 单个目录删除失败不阻塞 */ }
    }

    return { ok: true, result: extractJson(res.stdout) ?? res.stdout };
  } catch (e) {
    return { ok: false, error: formatErrorMessage(e) };
  }
});

ipcMain.handle("manager:addAgent", async (_event, payload) => {
  const name = String(payload?.name ?? "").trim();
  if (!name) return { ok: false, error: "智能体名称不能为空。" };
  const workspaceDir = String(payload?.workspace ?? "").trim() ||
    path.join(os.homedir(), ".openclaw", `workspace-${name}`);
  const copyAuth = Boolean(payload?.copyAuth);
  try {
    const res = await runCommand(
      "openclaw",
      ["agents", "add", name, "--workspace", workspaceDir, "--non-interactive", "--json"],
      { timeoutMs: 30000 }
    );
    if (res.code !== 0) {
      return { ok: false, error: res.stderr || `退出码 ${res.code}` };
    }
    if (copyAuth) {
      try {
        const mainAuthPath = path.join(os.homedir(), ".openclaw", "agents", "main", "agent", "auth-profiles.json");
        const newAuthPath = path.join(os.homedir(), ".openclaw", "agents", name, "agent", "auth-profiles.json");
        const fs = require("fs");
        if (fs.existsSync(mainAuthPath)) {
          const newAuthDir = path.dirname(newAuthPath);
          if (!fs.existsSync(newAuthDir)) fs.mkdirSync(newAuthDir, { recursive: true });
          fs.copyFileSync(mainAuthPath, newAuthPath);
        }
      } catch (_copyErr) {
        // auth profile 复制失败不影响 agent 创建
      }
    }
    return { ok: true, result: extractJson(res.stdout) ?? res.stdout };
  } catch (e) {
    return { ok: false, error: formatErrorMessage(e) };
  }
});

ipcMain.handle("manager:testModelConnection", async (_event, payload) => {
  if (!state) state = loadState();

  const provider = String(payload?.provider ?? "").trim();
  const modelId = String(payload?.modelId ?? payload?.model ?? "").trim();
  const apiKey = String(payload?.apiKey ?? "").trim();

  const ok = Boolean(provider) && Boolean(modelId) && apiKey.length > 0;
  if (ok) {
    const displayName =
      provider.toLowerCase() === "deepseek"
        ? "DeepSeek"
        : provider.toLowerCase() === "anthropic"
          ? "Anthropic"
          : provider.charAt(0).toUpperCase() + provider.slice(1);

    state.stats.currentModel = { name: displayName, id: modelId };
    state.onboarding.modelConfigured = true;
    saveState(state);
  }

  return {
    ok,
    message: ok ? "连接成功（示例）" : "连接失败（示例）：请检查 API Key 与模型选择"
  };
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  state = loadState();
  createWindow();
  startHotReloadIfNeeded();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  hotReloadWatchers.forEach((w) => {
    try {
      w.close();
    } catch {
      // ignore
    }
  });
  hotReloadWatchers = [];
});
