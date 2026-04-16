/**
 * OpenClaw 聊天渠道目录（与官方文档对齐的静态元数据）。
 * @see https://docs.openclaw.ai/zh-CN/channels
 */

export type ChannelPluginMode = "none" | "bundled" | "optional_npm";

export type ChannelCredentialType =
  | "bot_token"
  | "oauth_app"
  | "webhook"
  | "cli_daemon"
  | "baileys"
  | "signal_cli"
  | "gateway_only"
  | "custom";

export type ChannelDeviceLink = "none" | "openclaw_channels_login" | "signal_cli_link" | "other";

export type ChannelQrSource = "openclaw_channels_login" | "signal_cli_link" | "none";

export type ChannelConfigShape = "channel" | "gateway_only";

export type ChannelPairingSource = "pairing_index" | "feishu_doc" | "channel_doc";

export type ChannelCatalogEntry = {
  id: string;
  titleZh: string;
  summaryZh: string;
  docUrlZh: string;
  docEnglishOnly?: boolean;
  pluginMode: ChannelPluginMode;
  /** 独立安装时的 npm 包名（若已知） */
  npmPackage?: string;
  /** 传给 `openclaw plugins install <id>` 的插件 id，默认等于 id */
  pluginIdHint?: string;
  credentialType: ChannelCredentialType;
  deviceLink: ChannelDeviceLink;
  deviceLinkOtherHint?: string;
  deviceLinkExpectsQr: boolean;
  qrSource: ChannelQrSource;
  /** `openclaw channels login` 命令说明（展示用） */
  channelsLoginCliHint?: string;
  /**
   * 传给 `openclaw channels login --channel` 的实参；与目录 `id` 不一致时填写（如微信插件注册为 `openclaw-weixin`）。
   * 缺省使用目录 `id`。
   */
  channelsLoginChannelArg?: string;
  configShape: ChannelConfigShape;
  pairing: {
    dmPolicyDefault: string;
    /** `openclaw pairing list|approve` 使用的 channel 参数；null 表示不适用（如 WebChat） */
    openclawPairingChannel: string | null;
    pairingSource?: ChannelPairingSource;
    notes?: string;
  };
  tags: string[];
  /** 添加渠道向导要点 */
  quickStartBullets: string[];
};

function e(partial: ChannelCatalogEntry): ChannelCatalogEntry {
  return partial;
}

export const CHANNEL_CATALOG: ChannelCatalogEntry[] = [
  e({
    id: "telegram",
    titleZh: "Telegram",
    summaryZh: "BotFather 获取 botToken；多账户使用 accounts.*",
    docUrlZh: "https://docs.openclaw.ai/zh-CN/channels/telegram",
    pluginMode: "none",
    credentialType: "bot_token",
    deviceLink: "none",
    deviceLinkExpectsQr: false,
    qrSource: "none",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "pairing",
      openclawPairingChannel: "telegram",
      pairingSource: "pairing_index",
      notes: "陌生 DM 需 pairing 短码批准。",
    },
    tags: ["has_openclaw_pairing"],
    quickStartBullets: [
      "在 BotFather 创建 Bot 并取得 botToken。",
      "将 token 写入 channels.telegram.accounts.* 或环境变量。",
      "若启用 pairing：引导用户发消息后会出现在待批准列表。",
    ],
  }),
  e({
    id: "whatsapp",
    titleZh: "WhatsApp",
    summaryZh: "Baileys/Web 会话；关联设备需终端扫码（channels login）",
    docUrlZh: "https://docs.openclaw.ai/zh-CN/channels/whatsapp",
    pluginMode: "none",
    credentialType: "baileys",
    deviceLink: "openclaw_channels_login",
    deviceLinkExpectsQr: true,
    qrSource: "openclaw_channels_login",
    channelsLoginCliHint: "openclaw channels login --channel whatsapp [--account <id>]",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "pairing",
      openclawPairingChannel: "whatsapp",
      pairingSource: "pairing_index",
      notes: "设备关联（扫码）与私信 pairing 码是两套流程。",
    },
    tags: ["qr_device_link", "has_openclaw_pairing"],
    quickStartBullets: [
      "在配置中启用 channels.whatsapp。",
      "运行 openclaw channels login 关联 Web 会话（本应用可展示二维码）。",
      "需要时用 openclaw pairing approve 批准陌生 DM。",
    ],
  }),
  e({
    id: "signal",
    titleZh: "Signal",
    summaryZh: "signal-cli / httpUrl；链设备多为 signal-cli link 扫码",
    docUrlZh: "https://docs.openclaw.ai/zh-CN/channels/signal",
    pluginMode: "none",
    credentialType: "signal_cli",
    deviceLink: "signal_cli_link",
    deviceLinkExpectsQr: true,
    qrSource: "signal_cli_link",
    channelsLoginCliHint: "若 OpenClaw 封装了 channels login，可优先尝试；否则在本机终端执行官方 signal-cli link。",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "pairing",
      openclawPairingChannel: "signal",
      pairingSource: "pairing_index",
    },
    tags: ["qr_device_link", "has_openclaw_pairing"],
    quickStartBullets: [
      "安装并配置 signal-cli（或网关 httpUrl 模式）。",
      "链设备：在终端运行 signal-cli link 扫描 App 内二维码。",
      "配置 channels.signal 后可用 pairing 审批陌生会话（若启用）。",
    ],
  }),
  e({
    id: "discord",
    titleZh: "Discord",
    summaryZh: "Discord 开发者门户创建 Application / Bot Token",
    docUrlZh: "https://docs.openclaw.ai/channels/discord",
    docEnglishOnly: true,
    pluginMode: "none",
    credentialType: "bot_token",
    deviceLink: "none",
    deviceLinkExpectsQr: false,
    qrSource: "none",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "open",
      openclawPairingChannel: "discord",
      pairingSource: "pairing_index",
      notes: "具体 dmPolicy 以子文档与配置为准。",
    },
    tags: ["has_openclaw_pairing"],
    quickStartBullets: [
      "在 Discord Developer Portal 创建应用并复制 Bot Token。",
      "写入 channels.discord（或 accounts 结构，以 schema 为准）。",
    ],
  }),
  e({
    id: "slack",
    titleZh: "Slack",
    summaryZh: "Bolt / Bot Token（见子文档）",
    docUrlZh: "https://docs.openclaw.ai/channels/slack",
    docEnglishOnly: true,
    pluginMode: "none",
    credentialType: "oauth_app",
    deviceLink: "none",
    deviceLinkExpectsQr: false,
    qrSource: "none",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "open",
      openclawPairingChannel: "slack",
      pairingSource: "pairing_index",
    },
    tags: ["has_openclaw_pairing"],
    quickStartBullets: ["按 Slack 子文档创建 App 并配置 OAuth / Token。", "将凭据写入 channels.slack。"],
  }),
  e({
    id: "imessage",
    titleZh: "iMessage（旧版）",
    summaryZh: "旧版 imsg CLI 路线；官方总览建议新部署使用 BlueBubbles",
    docUrlZh: "https://docs.openclaw.ai/zh-CN/channels/imessage",
    pluginMode: "none",
    credentialType: "cli_daemon",
    deviceLink: "other",
    deviceLinkOtherHint: "依子文档的 macOS / CLI 要求。",
    deviceLinkExpectsQr: false,
    qrSource: "none",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "open",
      openclawPairingChannel: "imessage",
      pairingSource: "pairing_index",
    },
    tags: ["has_openclaw_pairing"],
    quickStartBullets: ["阅读子文档确认弃用说明与替代方案（BlueBubbles）。"],
  }),
  e({
    id: "bluebubbles",
    titleZh: "BlueBubbles",
    summaryZh: "macOS 伺服 REST API（iMessage 生态）",
    docUrlZh: "https://docs.openclaw.ai/channels/bluebubbles",
    docEnglishOnly: true,
    pluginMode: "none",
    credentialType: "webhook",
    deviceLink: "none",
    deviceLinkExpectsQr: false,
    qrSource: "none",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "open",
      openclawPairingChannel: null,
      pairingSource: "channel_doc",
      notes: "DM/安全策略以 BlueBubbles 子文档为准。",
    },
    tags: [],
    quickStartBullets: ["部署 BlueBubbles Server 并配置 REST。", "将服务器地址与密钥写入 channels.bluebubbles。"],
  }),
  e({
    id: "feishu",
    titleZh: "飞书",
    summaryZh: "多数版本捆绑插件；appId/appSecret + accounts.*",
    docUrlZh: "https://docs.openclaw.ai/zh-CN/channels/feishu",
    pluginMode: "bundled",
    npmPackage: "@openclaw/feishu",
    credentialType: "oauth_app",
    deviceLink: "none",
    deviceLinkExpectsQr: false,
    qrSource: "none",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "pairing",
      openclawPairingChannel: "feishu",
      pairingSource: "feishu_doc",
      notes: "飞书在子文档中明确列出 pairing 命令（不一定出现在配对总览列表中）。",
    },
    tags: ["has_openclaw_pairing"],
    quickStartBullets: [
      "在飞书开放平台创建企业自建应用，取得 appId / appSecret。",
      "使用官方 accounts.* 结构配置多账号（勿长期停留在扁平 appId 字段）。",
      "启用 pairing 时：openclaw pairing list feishu / approve feishu <CODE>。",
    ],
  }),
  e({
    id: "googlechat",
    titleZh: "Google Chat",
    summaryZh: "HTTP Webhook 应用",
    docUrlZh: "https://docs.openclaw.ai/zh-CN/channels/googlechat",
    pluginMode: "none",
    credentialType: "webhook",
    deviceLink: "none",
    deviceLinkExpectsQr: false,
    qrSource: "none",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "open",
      openclawPairingChannel: "googlechat",
      pairingSource: "channel_doc",
    },
    tags: ["has_openclaw_pairing"],
    quickStartBullets: ["按子文档在 Google Chat 配置 Webhook App。", "将 webhook 信息写入配置。"],
  }),
  e({
    id: "line",
    titleZh: "LINE",
    summaryZh: "插件；Messaging API Channel",
    docUrlZh: "https://docs.openclaw.ai/channels/line",
    docEnglishOnly: true,
    pluginMode: "optional_npm",
    credentialType: "bot_token",
    deviceLink: "none",
    deviceLinkExpectsQr: false,
    qrSource: "none",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "open",
      openclawPairingChannel: "line",
      pairingSource: "channel_doc",
    },
    tags: ["requires_plugin", "has_openclaw_pairing"],
    quickStartBullets: ["安装 LINE 官方插件。", "配置 Messaging API 凭据。"],
  }),
  e({
    id: "matrix",
    titleZh: "Matrix",
    summaryZh: "插件渠道",
    docUrlZh: "https://docs.openclaw.ai/channels/matrix",
    docEnglishOnly: true,
    pluginMode: "optional_npm",
    credentialType: "custom",
    deviceLink: "none",
    deviceLinkExpectsQr: false,
    qrSource: "none",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "open",
      openclawPairingChannel: "matrix",
      pairingSource: "channel_doc",
    },
    tags: ["requires_plugin", "has_openclaw_pairing"],
    quickStartBullets: ["安装 Matrix 插件。", "按子文档填写 homeserver / token。"],
  }),
  e({
    id: "mattermost",
    titleZh: "Mattermost",
    summaryZh: "插件渠道",
    docUrlZh: "https://docs.openclaw.ai/channels/mattermost",
    docEnglishOnly: true,
    pluginMode: "optional_npm",
    credentialType: "bot_token",
    deviceLink: "none",
    deviceLinkExpectsQr: false,
    qrSource: "none",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "open",
      openclawPairingChannel: "mattermost",
      pairingSource: "channel_doc",
    },
    tags: ["requires_plugin", "has_openclaw_pairing"],
    quickStartBullets: ["安装 Mattermost 插件。", "配置 Bot Token 与站点 URL。"],
  }),
  e({
    id: "msteams",
    titleZh: "Microsoft Teams",
    summaryZh: "插件；Azure Bot / Bot Framework",
    docUrlZh: "https://docs.openclaw.ai/channels/msteams",
    docEnglishOnly: true,
    pluginMode: "optional_npm",
    credentialType: "oauth_app",
    deviceLink: "none",
    deviceLinkExpectsQr: false,
    qrSource: "none",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "open",
      openclawPairingChannel: "msteams",
      pairingSource: "channel_doc",
    },
    tags: ["requires_plugin", "has_openclaw_pairing"],
    quickStartBullets: ["安装 Teams 插件。", "在 Azure 注册 Bot 并配置终结点。"],
  }),
  e({
    id: "nextcloud-talk",
    titleZh: "Nextcloud Talk",
    summaryZh: "插件渠道",
    docUrlZh: "https://docs.openclaw.ai/channels/nextcloud-talk",
    docEnglishOnly: true,
    pluginMode: "optional_npm",
    credentialType: "custom",
    deviceLink: "none",
    deviceLinkExpectsQr: false,
    qrSource: "none",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "open",
      openclawPairingChannel: "nextcloud-talk",
      pairingSource: "channel_doc",
    },
    tags: ["requires_plugin", "has_openclaw_pairing"],
    quickStartBullets: ["安装 nextcloud-talk 插件。", "配置 Nextcloud 基础 URL 与凭据。"],
  }),
  e({
    id: "nostr",
    titleZh: "Nostr",
    summaryZh: "插件渠道",
    docUrlZh: "https://docs.openclaw.ai/channels/nostr",
    docEnglishOnly: true,
    pluginMode: "optional_npm",
    credentialType: "custom",
    deviceLink: "none",
    deviceLinkExpectsQr: false,
    qrSource: "none",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "open",
      openclawPairingChannel: "nostr",
      pairingSource: "channel_doc",
    },
    tags: ["requires_plugin", "has_openclaw_pairing"],
    quickStartBullets: ["安装 Nostr 插件。", "按子文档配置密钥与 relay。"],
  }),
  e({
    id: "tlon",
    titleZh: "Tlon",
    summaryZh: "插件渠道",
    docUrlZh: "https://docs.openclaw.ai/channels/tlon",
    docEnglishOnly: true,
    pluginMode: "optional_npm",
    credentialType: "custom",
    deviceLink: "none",
    deviceLinkExpectsQr: false,
    qrSource: "none",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "open",
      openclawPairingChannel: "tlon",
      pairingSource: "channel_doc",
    },
    tags: ["requires_plugin", "has_openclaw_pairing"],
    quickStartBullets: ["安装 Tlon 插件。", "按子文档完成鉴权。"],
  }),
  e({
    id: "twitch",
    titleZh: "Twitch",
    summaryZh: "插件；IRC / 聊天接口",
    docUrlZh: "https://docs.openclaw.ai/channels/twitch",
    docEnglishOnly: true,
    pluginMode: "optional_npm",
    credentialType: "oauth_app",
    deviceLink: "none",
    deviceLinkExpectsQr: false,
    qrSource: "none",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "open",
      openclawPairingChannel: "twitch",
      pairingSource: "channel_doc",
    },
    tags: ["requires_plugin", "has_openclaw_pairing"],
    quickStartBullets: ["安装 Twitch 插件。", "取得 OAuth / IRC 凭据。"],
  }),
  e({
    id: "zalo",
    titleZh: "Zalo OA",
    summaryZh: "插件；Zalo Bot API",
    docUrlZh: "https://docs.openclaw.ai/channels/zalo",
    docEnglishOnly: true,
    pluginMode: "optional_npm",
    credentialType: "bot_token",
    deviceLink: "none",
    deviceLinkExpectsQr: false,
    qrSource: "none",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "open",
      openclawPairingChannel: "zalo",
      pairingSource: "channel_doc",
    },
    tags: ["requires_plugin", "has_openclaw_pairing"],
    quickStartBullets: ["安装 Zalo 官方插件。", "在 Zalo 开发者门户配置 OA。"],
  }),
  e({
    id: "zalouser",
    titleZh: "Zalo 个人版",
    summaryZh: "插件 @openclaw/zalouser；依赖 zca；channels login 扫码",
    docUrlZh: "https://docs.openclaw.ai/zh-CN/channels/zalouser",
    pluginMode: "optional_npm",
    npmPackage: "@openclaw/zalouser",
    credentialType: "cli_daemon",
    deviceLink: "openclaw_channels_login",
    deviceLinkExpectsQr: true,
    qrSource: "openclaw_channels_login",
    channelsLoginCliHint: "openclaw channels login --channel zalouser [--account <id>]",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "pairing",
      openclawPairingChannel: "zalouser",
      pairingSource: "pairing_index",
    },
    tags: ["requires_plugin", "qr_device_link", "has_openclaw_pairing"],
    quickStartBullets: [
      "安装 @openclaw/zalouser 插件并确保 zca 在 PATH。",
      "运行 openclaw channels login --channel zalouser 完成扫码关联。",
      "默认 dmPolicy 常为 pairing，可用 openclaw pairing 审批陌生会话。",
    ],
  }),
  e({
    id: "weixin",
    titleZh: "微信",
    summaryZh: "插件 @tencent-weixin/openclaw-weixin；支持 openclaw channels login 扫码关联时与 WhatsApp 等同理展示入口（以插件/CLI 实际能力为准）",
    docUrlZh: "https://developers.weixin.qq.com/doc/offiaccount/Getting_Started/Overview.html",
    docEnglishOnly: true,
    pluginMode: "optional_npm",
    npmPackage: "@tencent-weixin/openclaw-weixin",
    pluginIdHint: "openclaw-weixin",
    credentialType: "custom",
    deviceLink: "openclaw_channels_login",
    deviceLinkExpectsQr: true,
    qrSource: "openclaw_channels_login",
    channelsLoginChannelArg: "openclaw-weixin",
    channelsLoginCliHint: "openclaw channels login --channel openclaw-weixin [--account <id>]",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "open",
      openclawPairingChannel: "weixin",
      pairingSource: "channel_doc",
    },
    tags: ["requires_plugin", "qr_device_link"],
    quickStartBullets: [
      "将 openclaw-weixin 写入 plugins.allow 后安装并启用插件。",
      "若插件实现了 channels login：可在本应用「扫码登录」或终端执行上方 CLI；否则请在微信公众平台配置凭据与回调。",
    ],
  }),
  e({
    id: "qqbot",
    titleZh: "QQ 机器人",
    summaryZh: "插件 openclaw-qqbot；需在 plugins.allow 放行",
    docUrlZh: "https://bot.q.qq.com/wiki/develop/api/",
    docEnglishOnly: true,
    pluginMode: "optional_npm",
    pluginIdHint: "openclaw-qqbot",
    credentialType: "bot_token",
    deviceLink: "none",
    deviceLinkExpectsQr: false,
    qrSource: "none",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "open",
      openclawPairingChannel: "qqbot",
      pairingSource: "channel_doc",
    },
    tags: ["requires_plugin"],
    quickStartBullets: ["将 openclaw-qqbot 写入 plugins.allow 后安装插件，并按 QQ 机器人文档配置。"],
  }),
  e({
    id: "dingtalk",
    titleZh: "钉钉",
    summaryZh: "插件 @soimy/dingtalk；需在 plugins.allow 放行并完成 channels.dingtalk 配置",
    docUrlZh: "https://open.dingtalk.com/document/",
    docEnglishOnly: true,
    pluginMode: "optional_npm",
    npmPackage: "@soimy/dingtalk",
    pluginIdHint: "dingtalk",
    credentialType: "custom",
    deviceLink: "none",
    deviceLinkExpectsQr: false,
    qrSource: "none",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "open",
      openclawPairingChannel: "dingtalk",
      pairingSource: "channel_doc",
    },
    tags: ["requires_plugin"],
    quickStartBullets: ["将 dingtalk 插件写入 plugins.allow 后安装，并按钉钉开放平台文档配置机器人/应用。"],
  }),
  e({
    id: "wecom",
    titleZh: "企业微信",
    summaryZh: "插件 @wecom/wecom（腾讯企业微信团队）；需在 plugins.allow 放行",
    docUrlZh: "https://developer.work.weixin.qq.com/document/path/90665",
    docEnglishOnly: true,
    pluginMode: "optional_npm",
    npmPackage: "@wecom/wecom",
    pluginIdHint: "wecom",
    credentialType: "custom",
    deviceLink: "none",
    deviceLinkExpectsQr: false,
    qrSource: "none",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "open",
      openclawPairingChannel: "wecom",
      pairingSource: "channel_doc",
    },
    tags: ["requires_plugin"],
    quickStartBullets: ["将 wecom 插件写入 plugins.allow 后安装，并按企业微信开发者文档配置。"],
  }),
  e({
    id: "webchat",
    titleZh: "WebChat",
    summaryZh: "Gateway WebSocket 控制 UI 聊天页；无需 channels.webchat.*",
    docUrlZh: "https://docs.openclaw.ai/web/webchat",
    pluginMode: "none",
    credentialType: "gateway_only",
    deviceLink: "none",
    deviceLinkExpectsQr: false,
    qrSource: "none",
    configShape: "gateway_only",
    pairing: {
      dmPolicyDefault: "n/a",
      openclawPairingChannel: null,
      pairingSource: "channel_doc",
      notes: "非 IM Bot DM 模型；会话由网关 chat.* 管理。",
    },
    tags: [],
    quickStartBullets: [
      "使用本机 gateway.auth（token/password）连接 WebSocket。",
      "打开官方 WebChat / Control UI 文档中的聊天入口。",
      "不要臆造 channels.webchat 配置段。",
    ],
  }),
  e({
    id: "irc",
    titleZh: "IRC",
    summaryZh: "扩展渠道（总览未列；见英文档）",
    docUrlZh: "https://docs.openclaw.ai/channels/irc.md",
    docEnglishOnly: true,
    pluginMode: "optional_npm",
    credentialType: "custom",
    deviceLink: "none",
    deviceLinkExpectsQr: false,
    qrSource: "none",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "open",
      openclawPairingChannel: "irc",
      pairingSource: "channel_doc",
    },
    tags: ["requires_plugin"],
    quickStartBullets: ["参见英文 IRC 文档安装插件与网络参数。"],
  }),
  e({
    id: "synology-chat",
    titleZh: "Synology Chat",
    summaryZh: "扩展渠道（llms 索引）",
    docUrlZh: "https://docs.openclaw.ai/channels/synology-chat.md",
    docEnglishOnly: true,
    pluginMode: "optional_npm",
    credentialType: "webhook",
    deviceLink: "none",
    deviceLinkExpectsQr: false,
    qrSource: "none",
    configShape: "channel",
    pairing: {
      dmPolicyDefault: "open",
      openclawPairingChannel: null,
      pairingSource: "channel_doc",
    },
    tags: ["requires_plugin"],
    quickStartBullets: ["按 Synology Chat 官方文档配置入站 Webhook。"],
  }),
];

const CATALOG_BY_ID: Record<string, ChannelCatalogEntry> = Object.fromEntries(
  CHANNEL_CATALOG.map((c) => [c.id.toLowerCase(), c]),
);

export const ALL_CATALOG_IDS: string[] = CHANNEL_CATALOG.map((c) => c.id).sort((a, b) => a.localeCompare(b));

/** 插件安装 id：与历史 channels-page 一致，默认同渠道 slug */
export const PROVIDER_PLUGIN_MAP: Record<string, string> = Object.fromEntries(
  CHANNEL_CATALOG.map((c) => [c.id, c.pluginIdHint ?? c.id]),
);

/**
 * 列表行与详情弹窗：是否展示「关联设备 / 登录」（channels login、signal-cli link 等扫码链设备流程）。
 * 与 `deviceLink: "none" | "other"`、`gateway_only` 类渠道区分，此类渠道不显示该分栏。
 */
export function channelHasDeviceLinkTab(cat: ChannelCatalogEntry | undefined): boolean {
  if (!cat) return false;
  return Boolean(cat.deviceLinkExpectsQr || cat.deviceLink === "signal_cli_link");
}

export function getCatalogEntry(providerKey: string): ChannelCatalogEntry | undefined {
  return CATALOG_BY_ID[normalizeKey(providerKey)];
}

export function catalogTitleFor(providerKey: string): string {
  return getCatalogEntry(providerKey)?.titleZh ?? providerKey;
}

export function normalizeKey(k: string): string {
  return String(k ?? "")
    .trim()
    .toLowerCase();
}
