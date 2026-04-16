export type SupportedLocale = "en" | "zh-CN" | "zh-TW" | "es" | "de" | "ja";

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: "English",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  es: "Español",
  de: "Deutsch",
  ja: "日本語",
};

const messages = {
  "sidebar.collapse": { en: "Collapse sidebar", "zh-CN": "折叠侧边栏", "zh-TW": "折疊側邊欄", es: "Colapsar barra lateral", de: "Seitenleiste einklappen", ja: "サイドバーを折りたたむ" },
  "sidebar.expand": { en: "Expand sidebar", "zh-CN": "展开侧边栏", "zh-TW": "展開側邊欄", es: "Expandir barra lateral", de: "Seitenleiste ausklappen", ja: "サイドバーを展開" },

  "nav.chat": { en: "Chat", "zh-CN": "聊天", "zh-TW": "聊天", es: "Chat", de: "Chat", ja: "チャット" },
  "nav.overview": { en: "Overview", "zh-CN": "概览", "zh-TW": "概覽", es: "Resumen", de: "Übersicht", ja: "概要" },
  "nav.agents": { en: "Agents", "zh-CN": "智能体", "zh-TW": "智能體", es: "Agentes", de: "Agenten", ja: "エージェント" },
  "nav.channels": { en: "Channels", "zh-CN": "频道", "zh-TW": "頻道", es: "Canales", de: "Kanäle", ja: "チャンネル" },
  "nav.cron": { en: "Cron", "zh-CN": "定时任务", "zh-TW": "定時任務", es: "Tareas programadas", de: "Zeitgesteuerte Aufgaben", ja: "定期タスク" },
  "nav.models": { en: "Models", "zh-CN": "模型", "zh-TW": "模型", es: "Modelos", de: "Modelle", ja: "モデル" },
  "nav.installed": { en: "Installed", "zh-CN": "已安装", "zh-TW": "已安裝", es: "Instalados", de: "Installiert", ja: "インストール済み" },
  "nav.market": { en: "Skill Market", "zh-CN": "技能市场", "zh-TW": "技能市場", es: "Mercado de habilidades", de: "Skill-Markt", ja: "スキルマーケット" },
  "nav.settings": { en: "Settings", "zh-CN": "设置", "zh-TW": "設置", es: "Configuración", de: "Einstellungen", ja: "設定" },

  "section.control": { en: "Control", "zh-CN": "控制", "zh-TW": "控制", es: "Control", de: "Steuerung", ja: "控制" },
  "section.config": { en: "Config", "zh-CN": "配置", "zh-TW": "配置", es: "Configuración", de: "Konfiguration", ja: "設定" },
  "section.skills": { en: "Skills", "zh-CN": "技能", "zh-TW": "技能", es: "Habilidades", de: "Fertigkeiten", ja: "スキル" },

  "settings.title": { en: "Settings", "zh-CN": "设置", "zh-TW": "設置", es: "Configuración", de: "Einstellungen", ja: "設定" },
  "settings.appearance": { en: "Appearance", "zh-CN": "外观", "zh-TW": "外觀", es: "Apariencia", de: "Darstellung", ja: "外観" },
  "settings.language": { en: "Language", "zh-CN": "语言", "zh-TW": "語言", es: "Idioma", de: "Sprache", ja: "言語" },
  "settings.languageDesc": { en: "Select display language", "zh-CN": "选择应用显示语言", "zh-TW": "選擇應用顯示語言", es: "Seleccionar idioma de visualización", de: "Anzeigesprache auswählen", ja: "表示言語を選択" },
  "settings.theme": { en: "Theme", "zh-CN": "主题", "zh-TW": "主題", es: "Tema", de: "Thema", ja: "テーマ" },
  "settings.themeDesc": { en: "Select application display theme", "zh-CN": "选择应用显示主题", "zh-TW": "選擇應用顯示主題", es: "Seleccionar tema de visualización de la aplicación", de: "Anzeigethema der Anwendung auswählen", ja: "表示テーマを選択" },
  "settings.themeSystem": { en: "System", "zh-CN": "跟随系统", "zh-TW": "跟隨系統", es: "Seguir sistema", de: "System folgen", ja: "システム" },
  "settings.themeLight": { en: "Light", "zh-CN": "浅色", "zh-TW": "淺色", es: "Claro", de: "Hell", ja: "ライト" },
  "settings.themeDark": { en: "Dark", "zh-CN": "深色", "zh-TW": "深色", es: "Oscuro", de: "Dunkel", ja: "ダーク" },

  "chat.send": { en: "Send", "zh-CN": "发送", "zh-TW": "發送", es: "Enviar", de: "Senden", ja: "送信" },

  "common.start": { en: "Start", "zh-CN": "启动", "zh-TW": "啟動", es: "Iniciar", de: "Starten", ja: "開始" },
  "common.restart": { en: "Restart", "zh-CN": "重启", "zh-TW": "重啟", es: "Reiniciar", de: "Neustarten", ja: "再起動" },
  "common.stop": { en: "Stop", "zh-CN": "停止", "zh-TW": "停止", es: "Detener", de: "Stoppen", ja: "停止" },
  "common.refresh": { en: "Refresh", "zh-CN": "刷新", "zh-TW": "重新整理", es: "Actualizar", de: "Aktualisieren", ja: "更新" },
  "common.processing": { en: "Processing...", "zh-CN": "处理中...", "zh-TW": "處理中...", es: "Procesando...", de: "Verarbeitung...", ja: "処理中..." },
  "common.loading": { en: "Loading...", "zh-CN": "加载中...", "zh-TW": "載入中...", es: "Cargando...", de: "Lädt...", ja: "読み込み中..." },

  "overview.starting": { en: "Starting gateway...", "zh-CN": "正在启动网关...", "zh-TW": "正在啟動網關...", es: "Iniciando gateway...", de: "Gateway wird gestartet...", ja: "ゲートウェイを起動中..." },
  "overview.restarting": { en: "Restarting gateway...", "zh-CN": "正在重启网关...", "zh-TW": "正在重啟網關...", es: "Reiniciando gateway...", de: "Gateway wird neu gestartet...", ja: "ゲートウェイを再起動中..." },
  "overview.stopping": { en: "Stopping gateway...", "zh-CN": "正在停止网关...", "zh-TW": "正在停止網關...", es: "Deteniendo gateway...", de: "Gateway wird gestoppt...", ja: "ゲートウェイを停止中..." },

  "app.manager": { en: "Manager", "zh-CN": "管理器" },
  "app.noData": { en: "No data", "zh-CN": "暂无" },
  "app.versionPrefix": { en: "Version", "zh-CN": "版本" },
  "app.portPrefix": { en: "Port", "zh-CN": "端口" },
  "app.running": { en: "Running", "zh-CN": "已运行" },
  "app.notRunning": { en: "Not running", "zh-CN": "未运行" },

  "warning.noElectronApi": { en: "Electron bridge not detected (window.api). Browser preview is for display only; gateway control requires Electron.", "zh-CN": "未检测到 Electron 桥接（window.api）。浏览器预览仅展示界面；网关控制请在 Electron 中打开。" },
  "env.nodeMissingTitle": { en: "Node.js not detected or version too low", "zh-CN": "未检测到 Node.js 或版本过低", "zh-TW": "未偵測到 Node.js 或版本過低", es: "Node.js no detectado o versión demasiado baja", de: "Node.js nicht erkannt oder Version zu niedrig", ja: "Node.js が未検出、またはバージョンが低すぎます" },
  "env.nodeMissingDesc": { en: "OpenClaw Manager requires Node.js 22.16+ (Node.js 24 recommended).", "zh-CN": "OpenClaw Manager 需要 Node.js 22.16+（推荐 Node.js 24）。", "zh-TW": "OpenClaw Manager 需要 Node.js 22.16+（建議 Node.js 24）。", es: "OpenClaw Manager requiere Node.js 22.16+ (se recomienda Node.js 24).", de: "OpenClaw Manager benötigt Node.js 22.16+ (Node.js 24 empfohlen).", ja: "OpenClaw Manager には Node.js 22.16+（推奨: Node.js 24）が必要です。" },
  "env.nodeLowTitle": { en: "Node.js version is too low", "zh-CN": "Node.js 版本过低", "zh-TW": "Node.js 版本過低", es: "La versión de Node.js es demasiado baja", de: "Node.js-Version ist zu niedrig", ja: "Node.js のバージョンが低すぎます" },
  "env.nodeLowDesc": { en: "Please upgrade Node.js to 22.16+ (Node.js 24 recommended).", "zh-CN": "请升级 Node.js 到 22.16+（推荐 Node.js 24）。", "zh-TW": "請升級 Node.js 到 22.16+（建議 Node.js 24）。", es: "Actualice Node.js a 22.16+ (se recomienda Node.js 24).", de: "Bitte Node.js auf 22.16+ aktualisieren (Node.js 24 empfohlen).", ja: "Node.js を 22.16+ にアップグレードしてください（推奨: Node.js 24）。" },
  "env.nodeDetected": { en: "Detected: {0}", "zh-CN": "检测到：{0}", "zh-TW": "偵測到：{0}", es: "Detectado: {0}", de: "Erkannt: {0}", ja: "検出: {0}" },
  "env.nodeInstall": { en: "Install Node.js", "zh-CN": "安装 Node.js", "zh-TW": "安裝 Node.js", es: "Instalar Node.js", de: "Node.js installieren", ja: "Node.js をインストール" },
  "env.openclawMissingTitle": { en: "OpenClaw command not detected", "zh-CN": "未检测到 OpenClaw 命令", "zh-TW": "未偵測到 OpenClaw 指令", es: "Comando OpenClaw no detectado", de: "OpenClaw-Befehl nicht erkannt", ja: "OpenClaw コマンドが見つかりません" },
  "env.openclawMissingDesc": { en: "Install OpenClaw globally, then click Recheck.", "zh-CN": "请先全局安装 OpenClaw，然后点击“重新检测”。", "zh-TW": "請先全域安裝 OpenClaw，然後點擊「重新檢測」。", es: "Instale OpenClaw globalmente y luego haga clic en Recheck.", de: "Installieren Sie OpenClaw global und klicken Sie dann auf Erneut prüfen.", ja: "OpenClaw をグローバルにインストールしてから「再チェック」を押してください。" },
  "env.openclawInstall": { en: "Install OpenClaw", "zh-CN": "安装 OpenClaw", "zh-TW": "安裝 OpenClaw", es: "Instalar OpenClaw", de: "OpenClaw installieren", ja: "OpenClaw をインストール" },
  "env.copyCommand": { en: "Copy install command", "zh-CN": "复制安装命令", "zh-TW": "複製安裝命令", es: "Copiar comando de instalación", de: "Installationsbefehl kopieren", ja: "インストールコマンドをコピー" },
  "env.commandCopied": { en: "Command copied to clipboard.", "zh-CN": "命令已复制到剪贴板。", "zh-TW": "命令已複製到剪貼簿。", es: "Comando copiado al portapapeles.", de: "Befehl in die Zwischenablage kopiert.", ja: "コマンドをクリップボードにコピーしました。" },
  "env.copyCommandPrompt": { en: "Copy this command manually:", "zh-CN": "请手动复制这条命令：", "zh-TW": "請手動複製這條命令：", es: "Copie este comando manualmente:", de: "Bitte diesen Befehl manuell kopieren:", ja: "このコマンドを手動でコピーしてください:" },
  "env.installing": { en: "Installing...", "zh-CN": "安装中...", "zh-TW": "安裝中...", es: "Instalando...", de: "Wird installiert...", ja: "インストール中..." },
  "env.installFailed": { en: "Installation failed", "zh-CN": "安装失败", "zh-TW": "安裝失敗", es: "Instalación fallida", de: "Installation fehlgeschlagen", ja: "インストールに失敗しました" },
  "env.installSuccessRecheck": { en: "Installed successfully. Please recheck.", "zh-CN": "安装成功请重新检测", "zh-TW": "安裝成功請重新檢測", es: "Instalado correctamente. Vuelva a comprobar.", de: "Installation erfolgreich. Bitte erneut prüfen.", ja: "インストール成功。再チェックしてください。" },
  "env.settingUp": { en: "Setting up...", "zh-CN": "设置中...", "zh-TW": "設定中...", es: "Configurando...", de: "Wird eingerichtet...", ja: "セットアップ中..." },
  "env.setupFailed": { en: "Setup failed", "zh-CN": "设置失败", "zh-TW": "設定失敗", es: "La configuración falló", de: "Einrichtung fehlgeschlagen", ja: "セットアップに失敗しました" },
  "env.setupDone": { en: "Setup completed", "zh-CN": "设置完成", "zh-TW": "設定完成", es: "Configuración completada", de: "Einrichtung abgeschlossen", ja: "セットアップ完了" },
  "env.recheck": { en: "Recheck", "zh-CN": "重新检测", "zh-TW": "重新檢測", es: "Revisar de nuevo", de: "Erneut prüfen", ja: "再チェック" },
  "env.openFailed": { en: "Open failed: {0}", "zh-CN": "打开失败：{0}", "zh-TW": "開啟失敗：{0}", es: "Error al abrir: {0}", de: "Öffnen fehlgeschlagen: {0}", ja: "開くのに失敗しました: {0}" },
  "chat.title": { en: "Chat", "zh-CN": "聊天" },
  "chat.gatewayNotRunning": { en: "Gateway not running: please start the OpenClaw gateway first (Overview page). After connecting, streaming events will be received via WebSocket consistent with Control UI; fallback to IPC when not connected.", "zh-CN": "网关未运行：请先启动 OpenClaw 网关（「概览」页）。连接后将通过 WebSocket 接收与 Control UI 一致的流式事件；未连接时可回退 IPC。" },
  "chat.connectingWs": { en: "Connecting to gateway WebSocket… If it fails, check gateway.auth in ~/.openclaw/openclaw.json, or env vars OPENCLAW_GATEWAY_TOKEN / OPENCLAW_GATEWAY_PASSWORD.", "zh-CN": "正在连接网关 WebSocket… 若失败请检查 ~/.openclaw/openclaw.json 中 gateway.auth，或环境变量 OPENCLAW_GATEWAY_TOKEN / OPENCLAW_GATEWAY_PASSWORD。" },
  "chat.sessionLoadError": { en: "Session list: {0}", "zh-CN": "会话列表：{0}" },
  "chat.connectedWs": { en: "WS connected", "zh-CN": "WS 已连接" },
  "chat.syncingHistory": { en: "Syncing history…", "zh-CN": "同步历史中…" },
  "chat.session": { en: "Session", "zh-CN": "会话" },
  "chat.loadingSessions": { en: "Loading sessions…", "zh-CN": "加载会话…" },
  "chat.noSessions": { en: "(No sessions)", "zh-CN": "（无会话）" },
  "chat.model": { en: "Model", "zh-CN": "模型" },
  "chat.modelStartGateway": { en: "Loads after gateway starts", "zh-CN": "启动网关后加载" },
  "chat.modelDefault": { en: "Default (follows session)", "zh-CN": "默认（跟随会话）" },
  "chat.searchHistory": { en: "Search history", "zh-CN": "搜索历史消息" },
  "chat.placeholder": { en: "Send a message…", "zh-CN": "发送消息…" },
  "chat.waitingReply": { en: "Waiting for reply…", "zh-CN": "正在等待回复…" },
  "chat.sending": { en: "Sending…", "zh-CN": "发送中…" },
  "chat.avatar.user": { en: "You", "zh-CN": "你" },
  "chat.avatar.assistant": { en: "AI", "zh-CN": "助" },

  "overview.title": { en: "Overview", "zh-CN": "概览" },
  "overview.gatewayRunning": { en: "Gateway running", "zh-CN": "网关运行中" },
  "overview.gatewayNotRunning": { en: "Gateway not running", "zh-CN": "网关未运行" },
  "overview.recentAction": { en: "Recent action", "zh-CN": "最近操作" },
  "overview.agentLabel": { en: "Agents", "zh-CN": "智能体" },
  "overview.agentSuffix": { en: "configured", "zh-CN": "个已配置" },
  "overview.channelLabel": { en: "Channels", "zh-CN": "频道" },
  "overview.channelConnected": { en: "connected", "zh-CN": "已连接" },
  "overview.installedSkills": { en: "Installed skills", "zh-CN": "已安装技能" },
  "overview.countSuffix": { en: "items", "zh-CN": "个" },
  "overview.currentModel": { en: "Current model", "zh-CN": "当前模型" },
  "overview.version": { en: "OpenClaw Version", "zh-CN": "OpenClaw 版本" },
  "overview.currentVersion": { en: "Current version {0}", "zh-CN": "当前版本 {0}" },
  "overview.hasUpdate": { en: "New version available", "zh-CN": "有新版本" },
  "overview.latestUpgrade": { en: "Latest {0} · Upgrade available", "zh-CN": "最新 {0} · 可升级" },
  "overview.isLatest": { en: "Up to date", "zh-CN": "当前已是最新版本" },
  "overview.checkForUpdatesHint": { en: "Click Check for Updates to get the latest version", "zh-CN": "点击检查更新获取最新版本" },
  "overview.checkUpdates": { en: "Check for Updates", "zh-CN": "检查更新" },
  "overview.updateNow": { en: "Update Now", "zh-CN": "一键更新" },
  "overview.dangerZone": { en: "Danger Zone", "zh-CN": "危险操作" },
  "overview.uninstallDesc": { en: "After uninstalling, OpenClaw program will be removed. Configuration data is retained and can be restored on next install.", "zh-CN": "卸载后移除 OpenClaw 程序，配置数据保留，下次安装可恢复。" },
  "overview.uninstall": { en: "Uninstall OpenClaw", "zh-CN": "卸载 OpenClaw" },

  "agents.title": { en: "Agents", "zh-CN": "智能体" },
  "agents.refresh": { en: "Refresh", "zh-CN": "刷新" },
  "agents.add": { en: "+ Add", "zh-CN": "+ 新增" },
  "agents.fetchNote": { en: "Agent list can only be fetched from gateway in Electron (agents.list).", "zh-CN": "仅在 Electron 中可从网关拉取智能体列表（agents.list）。" },
  "agents.connectingNote": { en: "Connecting to gateway WebSocket… Agent list will load automatically after connection.", "zh-CN": "正在连接网关 WebSocket… 连接成功后将自动加载智能体列表。" },
  "agents.loadingNote": { en: "Loading agents from gateway…", "zh-CN": "正在从网关加载智能体…" },
  "agents.emptyNote": { en: "No agent data yet. Make sure the gateway is running and agents are configured.", "zh-CN": "暂无智能体数据。请确认网关已启动且已配置 agents。" },
  "agents.default": { en: "Default", "zh-CN": "默认" },
  "agents.idLabel": { en: "ID: {0}", "zh-CN": "ID：{0}" },
  "agents.edit": { en: "Edit", "zh-CN": "编辑" },
  "agents.delete": { en: "Delete", "zh-CN": "删除" },
  "agents.deleteTitle": { en: "Delete Agent", "zh-CN": "删除智能体" },
  "agents.deleteConfirm": { en: "Are you sure you want to delete agent {0}? This will remove its working directory and all configurations. This action cannot be undone.", "zh-CN": "确定要删除智能体 {0} 吗？此操作将删除其工作目录和所有配置，不可撤销。" },
  "agents.cancel": { en: "Cancel", "zh-CN": "取消" },
  "agents.deleting": { en: "Deleting…", "zh-CN": "删除中…" },
  "agents.confirmDelete": { en: "Confirm Delete", "zh-CN": "确认删除" },
  "agents.addTitle": { en: "Add Agent", "zh-CN": "新增智能体" },
  "agents.nameLabel": { en: "Agent Name", "zh-CN": "智能体名称" },
  "agents.namePlaceholder": { en: "Enter name (letters, numbers, hyphens only)", "zh-CN": "请输入名称（仅字母、数字、连字符）" },
  "agents.workspaceLabel": { en: "Workspace", "zh-CN": "工作目录（Workspace）" },
  "agents.workspaceDefault": { en: "Default: {0}", "zh-CN": "默认：{0}" },
  "agents.workspaceHint": { en: "Leave blank for default path", "zh-CN": "留空则使用默认路径" },
  "agents.copyAuth": { en: "Copy authentication from \"main\"", "zh-CN": "从“main”复制认证配置文件" },
  "agents.creating": { en: "Creating…", "zh-CN": "创建中…" },
  "agents.create": { en: "Create", "zh-CN": "确定" },

  "channels.title": { en: "Channels", "zh-CN": "频道" },
  "channels.save": { en: "Save", "zh-CN": "保存" },
  "cron.title": { en: "Cron Tasks", "zh-CN": "定时任务" },
  "cron.create": { en: "+ New Task", "zh-CN": "+ 新建任务" },
  "models.title": { en: "Models", "zh-CN": "模型" },

  "errors.gatewayWsNotConnectedAgents": { en: "Gateway WebSocket not connected; cannot fetch agents list (agents.list).", "zh-CN": "网关 WebSocket 未连接，无法获取智能体列表（agents.list）。" },
  "errors.agentNameRequired": { en: "Please enter agent name.", "zh-CN": "请输入智能体名称。" },
  "errors.addAgentUnsupported": { en: "Current environment does not support adding agents (Electron only).", "zh-CN": "当前环境不支持新增智能体（仅 Electron 可用）。" },
  "errors.addAgentFailed": { en: "Add failed.", "zh-CN": "新增失败。" },
  "errors.deleteAgentUnsupported": { en: "Current environment does not support deleting agents (Electron only).", "zh-CN": "当前环境不支持删除智能体（仅 Electron 可用）。" },
  "errors.deleteAgentFailed": { en: "Delete failed.", "zh-CN": "删除失败。" },
  "errors.notElectronOrDisconnected": { en: "Not running in Electron environment, or gateway is not connected (cannot use WebSocket and IPC).", "zh-CN": "当前不在 Electron 环境，或网关未连接（无法走 WebSocket 与 IPC）。" },
  "errors.sendFailed": { en: "Send failed: {0}", "zh-CN": "发送失败：{0}" },
};

export type TranslationKey = keyof typeof messages;
type LocaleValueMap = Partial<Record<SupportedLocale, string>>;

function tImpl(key: TranslationKey, locale: SupportedLocale, args?: string[]): string {
  const entry = messages[key] as Record<string, string>;
  if (!entry) return key;
  let value = entry[locale] ?? entry.en ?? key;
  if (args) {
    args.forEach((arg, i) => {
      value = value.replace(`{${i}}`, arg);
    });
  }
  return value;
}

const literalMap: Record<string, LocaleValueMap> = {
  "返回": { en: "Back", "zh-TW": "返回", es: "Volver", de: "Zurück", ja: "戻る" },
  "刷新": { en: "Refresh", "zh-TW": "重新整理", es: "Actualizar", de: "Aktualisieren", ja: "更新" },
  "保存": { en: "Save", "zh-TW": "儲存", es: "Guardar", de: "Speichern", ja: "保存" },
  "保存中…": { en: "Saving...", "zh-TW": "儲存中…", es: "Guardando...", de: "Speichert...", ja: "保存中..." },
  "保存中...": { en: "Saving...", "zh-TW": "儲存中...", es: "Guardando...", de: "Speichert...", ja: "保存中..." },
  "加载中…": { en: "Loading...", "zh-TW": "載入中…", es: "Cargando...", de: "Lädt...", ja: "読み込み中..." },
  "加载中...": { en: "Loading...", "zh-TW": "載入中...", es: "Cargando...", de: "Lädt...", ja: "読み込み中..." },
  "发送": { en: "Send", "zh-TW": "發送", es: "Enviar", de: "Senden", ja: "送信" },
  "发送中…": { en: "Sending...", "zh-TW": "發送中…", es: "Enviando...", de: "Sendet...", ja: "送信中..." },
  "发送中...": { en: "Sending...", "zh-TW": "發送中...", es: "Enviando...", de: "Sendet...", ja: "送信中..." },
  "聊天": { en: "Chat", "zh-TW": "聊天", es: "Chat", de: "Chat", ja: "チャット" },
  "概览": { en: "Overview", "zh-TW": "概覽", es: "Resumen", de: "Übersicht", ja: "概要" },
  "智能体": { en: "Agents", "zh-TW": "智能體", es: "Agentes", de: "Agenten", ja: "エージェント" },
  "频道": { en: "Channels", "zh-TW": "頻道", es: "Canales", de: "Kanäle", ja: "チャンネル" },
  "定时任务": { en: "Cron Tasks", "zh-TW": "定時任務", es: "Tareas programadas", de: "Zeitgesteuerte Aufgaben", ja: "定期タスク" },
  "模型": { en: "Models", "zh-TW": "模型", es: "Modelos", de: "Modelle", ja: "モデル" },
  "技能": { en: "Skills", "zh-TW": "技能", es: "Habilidades", de: "Skills", ja: "スキル" },
  "已安装": { en: "Installed", "zh-TW": "已安裝", es: "Installed", de: "Installiert", ja: "インストール済み" },
  "技能市场": { en: "Skill Market", "zh-TW": "技能市場", es: "Mercado de habilidades", de: "Skill-Markt", ja: "スキルマーケット" },
  "设置": { en: "Settings", "zh-TW": "設置", es: "Configuración", de: "Einstellungen", ja: "設定" },
  "关闭": { en: "Close", "zh-TW": "關閉", es: "Cerrar", de: "Schließen", ja: "閉じる" },
  "详情": { en: "Details", "zh-TW": "詳情", es: "Detalles", de: "Details", ja: "詳細" },
  "打开": { en: "Open", "zh-TW": "開啟", es: "Abrir", de: "Öffnen", ja: "開く" },
  "安装": { en: "Install", "zh-TW": "安裝", es: "Instalar", de: "Installieren", ja: "インストール" },
  "安装中…": { en: "Installing...", "zh-TW": "安裝中…", es: "Instalando...", de: "Installiert...", ja: "インストール中..." },
  "安装中...": { en: "Installing...", "zh-TW": "安裝中...", es: "Instalando...", de: "Installiert...", ja: "インストール中..." },
  "没有更多": { en: "No more", "zh-TW": "沒有更多", es: "No hay más", de: "Keine weiteren", ja: "これ以上ありません" },
  "加载更多": { en: "Load more", "zh-TW": "載入更多", es: "Cargar más", de: "Mehr laden", ja: "さらに読み込む" },
  "高亮": { en: "Highlighted", "zh-TW": "高亮", es: "Destacado", de: "Hervorgehoben", ja: "ハイライト" },
  "可疑": { en: "Suspicious", "zh-TW": "可疑", es: "Sospechoso", de: "Verdächtig", ja: "疑わしい" },
  "作者": { en: "Author", "zh-TW": "作者", es: "Autor", de: "Autor", ja: "作者" },

  "网关 WebSocket 未连接": { en: "Gateway WebSocket not connected", "zh-TW": "網關 WebSocket 未連接", es: "Gateway WebSocket no conectado", de: "Gateway-WebSocket nicht verbunden", ja: "Gateway WebSocket が未接続です" },
  "网关 WebSocket client 未就绪": { en: "Gateway WebSocket client not ready", "zh-TW": "網關 WebSocket client 未就緒", es: "Cliente WebSocket de gateway no listo", de: "Gateway-WebSocket-Client nicht bereit", ja: "Gateway WebSocket クライアントが未準備です" },
  "网关控制仅在 Electron 中可用。请运行：pnpm run renderer:dev 与 pnpm run dev:electron-react。": { en: "Gateway control is available only in Electron. Please run: pnpm run renderer:dev and pnpm run dev:electron-react.", "zh-TW": "網關控制僅在 Electron 中可用。請執行：pnpm run renderer:dev 與 pnpm run dev:electron-react。", es: "El control del gateway solo está disponible en Electron. Ejecute: pnpm run renderer:dev y pnpm run dev:electron-react.", de: "Gateway-Steuerung ist nur in Electron verfügbar. Bitte ausführen: pnpm run renderer:dev und pnpm run dev:electron-react.", ja: "Gateway 制御は Electron でのみ利用できます。pnpm run renderer:dev と pnpm run dev:electron-react を実行してください。" },
  "AI 模型提供商": { en: "AI model providers", "zh-TW": "AI 模型供應商", es: "Proveedores de modelos AI", de: "KI-Modellanbieter", ja: "AI モデルプロバイダー" },
  "添加提供商": { en: "Add provider", "zh-TW": "新增供應商", es: "Agregar proveedor", de: "Anbieter hinzufügen", ja: "プロバイダーを追加" },
  "最近 Token 消耗": { en: "Recent token usage", "zh-TW": "近期 Token 使用量", es: "Uso reciente de tokens", de: "Aktueller Token-Verbrauch", ja: "最近のトークン使用量" },
  "按模型": { en: "By model", "zh-TW": "按模型", es: "Por modelo", de: "Nach Modell", ja: "モデル別" },
  "按时间": { en: "By time", "zh-TW": "按時間", es: "Por tiempo", de: "Nach Zeit", ja: "時間別" },
  "天": { en: "days", "zh-TW": "天", es: "días", de: "Tage", ja: "日" },
  "全部": { en: "All", "zh-TW": "全部", es: "Todos", de: "Alle", ja: "すべて" },
  "输入": { en: "Input", "zh-TW": "輸入", es: "Entrada", de: "Eingabe", ja: "入力" },
  "输出": { en: "Output", "zh-TW": "輸出", es: "Salida", de: "Ausgabe", ja: "出力" },
  "缓存": { en: "Cache", "zh-TW": "快取", es: "Caché", de: "Cache", ja: "キャッシュ" },
  "加载用量中…": { en: "Loading usage...", "zh-TW": "載入使用量中…", es: "Cargando uso...", de: "Nutzung wird geladen...", ja: "使用量を読み込み中..." },
  "加载用量中...": { en: "Loading usage...", "zh-TW": "載入使用量中...", es: "Cargando uso...", de: "Nutzung wird geladen...", ja: "使用量を読み込み中..." },
  "未知模型": { en: "Unknown model", "zh-TW": "未知模型", es: "Modelo desconocido", de: "Unbekanntes Modell", ja: "不明なモデル" },
  "添加模型提供商": { en: "Add model provider", "zh-TW": "新增模型供應商", es: "Agregar proveedor de modelos", de: "Modellanbieter hinzufügen", ja: "モデルプロバイダーを追加" },
  "合并写入 models.providers": { en: "Merge into models.providers", "zh-TW": "合併寫入 models.providers", es: "Combinar en models.providers", de: "In models.providers zusammenführen", ja: "models.providers にマージして書き込み" },
  "提供商 ID": { en: "Provider ID", "zh-TW": "供應商 ID", es: "ID del proveedor", de: "Anbieter-ID", ja: "プロバイダー ID" },
  "模型 ID": { en: "Model ID", "zh-TW": "模型 ID", es: "ID del modelo", de: "Modell-ID", ja: "モデル ID" },
  "模型显示名（可选）": { en: "Model display name (optional)", "zh-TW": "模型顯示名稱（可選）", es: "Nombre visible del modelo (opcional)", de: "Anzeigename des Modells (optional)", ja: "モデル表示名（任意）" },
  "默认同模型 ID": { en: "Defaults to model ID", "zh-TW": "預設同模型 ID", es: "Predeterminado al ID del modelo", de: "Standard ist die Modell-ID", ja: "既定はモデル ID" },
  "状态": { en: "Status", "zh-TW": "狀態", es: "Estado", de: "Status", ja: "状態" },
  "就绪": { en: "Ready", "zh-TW": "就緒", es: "Listo", de: "Bereit", ja: "準備完了" },
  "已禁用": { en: "Disabled", "zh-TW": "已停用", es: "Deshabilitado", de: "Deaktiviert", ja: "無効" },
  "白名单阻止": { en: "Blocked by allowlist", "zh-TW": "白名單阻止", es: "Bloqueado por allowlist", de: "Durch Allowlist blockiert", ja: "許可リストでブロック" },
  "缺少条件": { en: "Missing requirements", "zh-TW": "缺少條件", es: "Faltan requisitos", de: "Anforderungen fehlen", ja: "要件不足" },
  "搜索技能…": { en: "Search skills...", "zh-TW": "搜尋技能…", es: "Buscar habilidades...", de: "Skills suchen...", ja: "スキルを検索..." },
  "搜索技能...": { en: "Search skills...", "zh-TW": "搜尋技能...", es: "Buscar habilidades...", de: "Skills suchen...", ja: "スキルを検索..." },
  "搜索市场技能…": { en: "Search market skills...", "zh-TW": "搜尋市場技能…", es: "Buscar habilidades del mercado...", de: "Marketplace-Skills suchen...", ja: "マーケットのスキルを検索..." },
  "搜索市场技能...": { en: "Search market skills...", "zh-TW": "搜尋市場技能...", es: "Buscar habilidades del mercado...", de: "Marketplace-Skills suchen...", ja: "マーケットのスキルを検索..." },
  "排序": { en: "Sort", "zh-TW": "排序", es: "Ordenar", de: "Sortieren", ja: "並び替え" },
  "仅高亮": { en: "Highlighted only", "zh-TW": "僅高亮", es: "Solo destacados", de: "Nur hervorgehoben", ja: "ハイライトのみ" },
  "隐藏可疑": { en: "Hide suspicious", "zh-TW": "隱藏可疑", es: "Ocultar sospechosos", de: "Verdächtige ausblenden", ja: "疑わしい項目を非表示" },
  "条": { en: "items", "zh-TW": "條", es: "elementos", de: "Einträge", ja: "件" },
  "作者：": { en: "Author: ", "zh-TW": "作者：", es: "Autor: ", de: "Autor: ", ja: "作者: " },
  "任务总数": { en: "Total tasks", "zh-TW": "任務總數", es: "Total de tareas", de: "Aufgaben gesamt", ja: "タスク総数" },
  "已暂停": { en: "Paused", "zh-TW": "已暫停", es: "Pausado", de: "Pausiert", ja: "一時停止" },
  "失败": { en: "Failed", "zh-TW": "失敗", es: "Fallido", de: "Fehlgeschlagen", ja: "失敗" },
  "立即运行": { en: "Run now", "zh-TW": "立即執行", es: "Ejecutar ahora", de: "Jetzt ausführen", ja: "今すぐ実行" },
  "调度器状态": { en: "Scheduler status", "zh-TW": "排程器狀態", es: "Estado del programador", de: "Scheduler-Status", ja: "スケジューラー状態" },
  "新建定时任务": { en: "New cron task", "zh-TW": "新建定時任務", es: "Nueva tarea programada", de: "Neue Cron-Aufgabe", ja: "新しい定期タスク" },
  "任务名称": { en: "Task name", "zh-TW": "任務名稱", es: "Nombre de la tarea", de: "Aufgabenname", ja: "タスク名" },
  "从列表选择…": { en: "Select from list...", "zh-TW": "從清單選擇…", es: "Seleccionar de la lista...", de: "Aus Liste wählen...", ja: "リストから選択..." },
  "从列表选择...": { en: "Select from list...", "zh-TW": "從清單選擇...", es: "Seleccionar de la lista...", de: "Aus Liste wählen...", ja: "リストから選択..." },
  "调度": { en: "Schedule", "zh-TW": "排程", es: "Programación", de: "Zeitplan", ja: "スケジュール" },
  "单次": { en: "Once", "zh-TW": "單次", es: "Una vez", de: "Einmalig", ja: "単発" },
  "固定间隔": { en: "Fixed interval", "zh-TW": "固定間隔", es: "Intervalo fijo", de: "Fester Intervall", ja: "固定間隔" },
  "本地时间": { en: "Local time", "zh-TW": "本地時間", es: "Hora local", de: "Lokale Zeit", ja: "ローカル時間" },
  "分钟": { en: "minutes", "zh-TW": "分鐘", es: "minutos", de: "Minuten", ja: "分" },
  "小时": { en: "hours", "zh-TW": "小時", es: "horas", de: "Stunden", ja: "時間" },
  "投递": { en: "Delivery", "zh-TW": "投遞", es: "Entrega", de: "Zustellung", ja: "配信" },
  "结果投递": { en: "Result delivery", "zh-TW": "結果投遞", es: "Entrega de resultados", de: "Ergebniszustellung", ja: "結果配信" },
  "发布摘要（默认）": { en: "Publish summary (default)", "zh-TW": "發布摘要（預設）", es: "Publicar resumen (predeterminado)", de: "Zusammenfassung veröffentlichen (Standard)", ja: "要約を配信（既定）" },
  "不发布（仅内部）": { en: "Do not publish (internal only)", "zh-TW": "不發布（僅內部）", es: "No publicar (solo interno)", de: "Nicht veröffentlichen (nur intern)", ja: "配信しない（内部のみ）" },
};

const literalTable: Record<string, LocaleValueMap> = (() => {
  const out: Record<string, LocaleValueMap> = {};
  for (const key of Object.keys(messages) as TranslationKey[]) {
    const item = messages[key] as Record<string, string | undefined>;
    const zh = item["zh-CN"];
    if (!zh || !zh.trim()) continue;
    out[zh] = {
      en: item.en,
      "zh-CN": item["zh-CN"],
      "zh-TW": item["zh-TW"],
      es: item.es,
      de: item.de,
      ja: item.ja,
    };
  }
  for (const [zh, row] of Object.entries(literalMap)) {
    out[zh] = { ...(out[zh] ?? {}), ...row, "zh-CN": zh };
  }
  return out;
})();

const exactLiteralTable: Record<string, LocaleValueMap> = (() => {
  const out: Record<string, LocaleValueMap> = { ...literalTable };
  for (const key of Object.keys(messages) as TranslationKey[]) {
    const item = messages[key] as Record<string, string | undefined>;
    const en = item.en?.trim();
    if (!en) continue;
    out[en] = {
      en: item.en,
      "zh-CN": item["zh-CN"],
      "zh-TW": item["zh-TW"],
      es: item.es,
      de: item.de,
      ja: item.ja,
    };
  }
  for (const [zh, row] of Object.entries(literalMap)) {
    const en = row.en?.trim();
    if (!en) continue;
    out[en] = { ...row, "zh-CN": zh };
  }
  return out;
})();

function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

function translateByTokens(text: string, locale: SupportedLocale): string {
  const tokenMap: Array<[string, LocaleValueMap]> = [
    ["未运行", { en: "Not running", "zh-TW": "未運行", es: "No en ejecución", de: "Nicht laufend", ja: "未実行" }],
    ["运行中", { en: "Running", "zh-TW": "運行中", es: "En ejecución", de: "Laufend", ja: "実行中" }],
    ["已连接", { en: "Connected", "zh-TW": "已連接", es: "Conectado", de: "Verbunden", ja: "接続済み" }],
    ["已修改", { en: "Modified", "zh-TW": "已修改", es: "Modificado", de: "Geändert", ja: "変更済み" }],
    ["未修改", { en: "Unchanged", "zh-TW": "未修改", es: "Sin cambios", de: "Unverändert", ja: "未変更" }],
    ["新增", { en: "Add", "zh-TW": "新增", es: "Agregar", de: "Hinzufügen", ja: "追加" }],
    ["编辑", { en: "Edit", "zh-TW": "編輯", es: "Editar", de: "Bearbeiten", ja: "編集" }],
    ["删除", { en: "Delete", "zh-TW": "刪除", es: "Eliminar", de: "Löschen", ja: "削除" }],
    ["取消", { en: "Cancel", "zh-TW": "取消", es: "Cancelar", de: "Abbrechen", ja: "キャンセル" }],
    ["确认", { en: "Confirm", "zh-TW": "確認", es: "Confirmar", de: "Bestätigen", ja: "確認" }],
    ["创建", { en: "Create", "zh-TW": "創建", es: "Crear", de: "Erstellen", ja: "作成" }],
    ["默认", { en: "Default", "zh-TW": "預設", es: "Predeterminado", de: "Standard", ja: "デフォルト" }],
    ["配置", { en: "Config", "zh-TW": "配置", es: "Config", de: "Konfig", ja: "設定" }],
    ["加载", { en: "Loading", "zh-TW": "載入", es: "Cargando", de: "Lädt", ja: "読み込み" }],
    ["保存", { en: "Save", "zh-TW": "儲存", es: "Guardar", de: "Speichern", ja: "保存" }],
    ["刷新", { en: "Refresh", "zh-TW": "重新整理", es: "Actualizar", de: "Aktualisieren", ja: "更新" }],
    ["发送", { en: "Send", "zh-TW": "發送", es: "Enviar", de: "Senden", ja: "送信" }],
    ["启动", { en: "Start", "zh-TW": "啟動", es: "Iniciar", de: "Starten", ja: "開始" }],
    ["重启", { en: "Restart", "zh-TW": "重啟", es: "Reiniciar", de: "Neustarten", ja: "再起動" }],
    ["停止", { en: "Stop", "zh-TW": "停止", es: "Detener", de: "Stoppen", ja: "停止" }],
    ["网关", { en: "Gateway", "zh-TW": "網關", es: "Gateway", de: "Gateway", ja: "ゲートウェイ" }],
    ["智能体", { en: "Agent", "zh-TW": "智能體", es: "Agente", de: "Agent", ja: "エージェント" }],
    ["技能", { en: "Skill", "zh-TW": "技能", es: "Habilidad", de: "Skill", ja: "スキル" }],
    ["频道", { en: "Channel", "zh-TW": "頻道", es: "Canal", de: "Kanal", ja: "チャンネル" }],
    ["模型", { en: "Model", "zh-TW": "模型", es: "Modelo", de: "Modell", ja: "モデル" }],
    ["提供商", { en: "Provider", "zh-TW": "供應商", es: "Proveedor", de: "Anbieter", ja: "プロバイダー" }],
    ["市场", { en: "Market", "zh-TW": "市場", es: "Mercado", de: "Markt", ja: "マーケット" }],
    ["运行", { en: "Run", "zh-TW": "運行", es: "Ejecutar", de: "Ausführen", ja: "実行" }],
    ["任务", { en: "Task", "zh-TW": "任務", es: "Tarea", de: "Aufgabe", ja: "タスク" }],
    ["定时", { en: "Scheduled", "zh-TW": "定時", es: "Programada", de: "Geplant", ja: "定期" }],
    ["总数", { en: "Total", "zh-TW": "總數", es: "Total", de: "Gesamt", ja: "合計" }],
    ["已配置", { en: "Configured", "zh-TW": "已配置", es: "Configurado", de: "Konfiguriert", ja: "設定済み" }],
    ["可用", { en: "Available", "zh-TW": "可用", es: "Disponible", de: "Verfügbar", ja: "利用可能" }],
    ["待配置", { en: "Pending config", "zh-TW": "待配置", es: "Pendiente de configuración", de: "Konfiguration ausstehend", ja: "設定待ち" }],
    ["仅在", { en: "Only in", "zh-TW": "僅在", es: "Solo en", de: "Nur in", ja: "のみ" }],
    ["当前", { en: "Current", "zh-TW": "當前", es: "Actual", de: "Aktuell", ja: "現在" }],
    ["路径", { en: "Path", "zh-TW": "路徑", es: "Ruta", de: "Pfad", ja: "パス" }],
    ["缺失", { en: "Missing", "zh-TW": "缺失", es: "Falta", de: "Fehlend", ja: "不足" }],
  ];

  let out = text;
  for (const [zh, row] of tokenMap) {
    const to = row[locale] ?? row.en;
    if (to && out.includes(zh)) out = out.split(zh).join(to);
  }
  return out;
}

function translateByTemplates(text: string, locale: SupportedLocale): string {
  const pick = (en: string, tw: string, es: string, de: string, ja: string) => {
    if (locale === "zh-TW") return tw;
    if (locale === "es") return es;
    if (locale === "de") return de;
    if (locale === "ja") return ja;
    return en;
  };

  let out = text;

  out = out.replace(/^会话列表：(.+)$/u, (_m, g1) => pick(`Session list: ${g1}`, `會話列表：${g1}`, `Lista de sesiones: ${g1}`, `Sitzungsliste: ${g1}`, `セッション一覧: ${g1}`));
  out = out.replace(/^操作失败：(.+)$/u, (_m, g1) => pick(`Operation failed: ${g1}`, `操作失敗：${g1}`, `Operación fallida: ${g1}`, `Vorgang fehlgeschlagen: ${g1}`, `操作失敗: ${g1}`));
  out = out.replace(/^发送失败：(.+)$/u, (_m, g1) => pick(`Send failed: ${g1}`, `發送失敗：${g1}`, `Error al enviar: ${g1}`, `Senden fehlgeschlagen: ${g1}`, `送信失敗: ${g1}`));
  out = out.replace(/^检查失败：(.+)$/u, (_m, g1) => pick(`Check failed: ${g1}`, `檢查失敗：${g1}`, `Comprobación fallida: ${g1}`, `Prüfung fehlgeschlagen: ${g1}`, `チェック失敗: ${g1}`));
  out = out.replace(/^升级失败：(.+)$/u, (_m, g1) => pick(`Upgrade failed: ${g1}`, `升級失敗：${g1}`, `Actualización fallida: ${g1}`, `Upgrade fehlgeschlagen: ${g1}`, `アップグレード失敗: ${g1}`));
  out = out.replace(/^卸载失败：(.+)$/u, (_m, g1) => pick(`Uninstall failed: ${g1}`, `解除安裝失敗：${g1}`, `Desinstalación fallida: ${g1}`, `Deinstallation fehlgeschlagen: ${g1}`, `アンインストール失敗: ${g1}`));

  out = out.replace(/^默认：(.+)$/u, (_m, g1) => pick(`Default: ${g1}`, `預設：${g1}`, `Predeterminado: ${g1}`, `Standard: ${g1}`, `デフォルト: ${g1}`));
  out = out.replace(/^ID：(.+)$/u, (_m, g1) => pick(`ID: ${g1}`, `ID：${g1}`, `ID: ${g1}`, `ID: ${g1}`, `ID: ${g1}`));
  out = out.replace(/^编辑：(.+)$/u, (_m, g1) => pick(`Editing: ${g1}`, `編輯：${g1}`, `Editando: ${g1}`, `Bearbeiten: ${g1}`, `編集中: ${g1}`));
  out = out.replace(/^总 token:\s*(.+)$/u, (_m, g1) => pick(`Total tokens: ${g1}`, `總 token: ${g1}`, `Token total: ${g1}`, `Gesamt-Token: ${g1}`, `合計トークン: ${g1}`));
  out = out.replace(/^每\s*(\d+)\s*小时$/u, (_m, g1) => pick(`Every ${g1} hours`, `每 ${g1} 小時`, `Cada ${g1} horas`, `Alle ${g1} Stunden`, `${g1} 時間ごと`));
  out = out.replace(/^每\s*(\d+)\s*分钟$/u, (_m, g1) => pick(`Every ${g1} minutes`, `每 ${g1} 分鐘`, `Cada ${g1} minutos`, `Alle ${g1} Minuten`, `${g1} 分ごと`));
  out = out.replace(/^单次\s*·\s*(.+)$/u, (_m, g1) => pick(`One-time · ${g1}`, `單次 · ${g1}`, `Una vez · ${g1}`, `Einmalig · ${g1}`, `単発 · ${g1}`));
  out = out.replace(/^间隔\s*·\s*—$/u, () => pick("Interval · —", "間隔 · —", "Intervalo · —", "Intervall · —", "間隔 · —"));
  out = out.replace(/^确定删除定时任务「(.+)」？$/u, (_m, g1) => pick(`Delete cron task "${g1}"?`, `確定刪除定時任務「${g1}」？`, `¿Eliminar la tarea programada "${g1}"?`, `Cron-Aufgabe "${g1}" löschen?`, `定期タスク「${g1}」を削除しますか？`));
  out = out.replace(/^仅显示 targeting this agent 的 jobs：(\d+)$/u, (_m, g1) => pick(`Only jobs targeting this agent: ${g1}`, `僅顯示 targeting this agent 的 jobs：${g1}`, `Solo jobs targeting this agent: ${g1}`, `Nur Jobs targeting this agent: ${g1}`, `このエージェント対象のジョブのみ: ${g1}`));

  out = out.replace(/暂无([^。.!?]{1,16})[。.!?]?/gu, (_m, g1) => {
    const tail = translateLiteral(String(g1), locale);
    return pick(`No ${tail}.`, `暫無${tail}。`, `Sin ${tail}.`, `Keine ${tail}.`, `${tail}がありません。`);
  });
  out = out.replace(/请选择([^…]{1,20})…?/gu, (_m, g1) => {
    const tail = translateLiteral(String(g1), locale);
    return pick(`Please select ${tail}...`, `請選擇${tail}...`, `Seleccione ${tail}...`, `Bitte ${tail} auswählen...`, `${tail}を選択してください...`);
  });

  out = out.replace(/^共\s*(\d+)\s*条记录$/u, (_m, n) => pick(`Total ${n} records`, `共 ${n} 條記錄`, `Total ${n} registros`, `Insgesamt ${n} Einträge`, `合計 ${n} 件`));

  return out;
}

export function translateLiteral(text: string, locale: SupportedLocale): string {
  if (!text || locale === "zh-CN") return text;

  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  if (!m) return text;
  const lead = m[1] ?? "";
  const core = (m[2] ?? "").trim();
  const tail = m[3] ?? "";
  if (!core) return text;

  const exact = exactLiteralTable[core];
  if (exact) {
    return `${lead}${exact[locale] ?? exact.en ?? core}${tail}`;
  }

  if (!hasChinese(core)) return text;

  let out = core;
  out = translateByTokens(out, locale);
  out = translateByTemplates(out, locale);

  return `${lead}${out}${tail}`;
}

export { tImpl };
