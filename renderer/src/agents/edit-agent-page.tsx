import { useCallback, useEffect, useMemo, useState } from "react";
import { useChatStore } from "@/store/chat-store";
import type { GatewayBrowserClient } from "@/gateway/gateway-browser-client";

type AgentIdentity = {
  id: string;
  name?: string;
  emoji?: string;
};

type EditAgentPageProps = {
  agentId: string | null;
  agentsRpc: unknown[];
  hasElectronApi: boolean;
  onBack: () => void;
};

type Panel = "files" | "tools" | "skills" | "channels" | "cron";

type ConfigSnapshot = {
  hash?: string | null;
  raw?: string | null;
  config?: Record<string, unknown> | null;
};

function normalizeToolName(name: string): string {
  const aliases: Record<string, string> = {
    bash: "exec",
    "apply-patch": "apply_patch",
  };
  const normalized = name.trim().toLowerCase();
  return aliases[normalized] ?? normalized;
}

function safeString(v: unknown): string {
  if (typeof v === "string") return v;
  return v == null ? "" : String(v);
}

function findAgentIndex(configObj: Record<string, unknown>, agentId: string): number {
  const list = (configObj as any)?.agents?.list;
  if (!Array.isArray(list)) return -1;
  const idx = list.findIndex((entry: any) => safeString(entry?.id).trim() === agentId.trim());
  return typeof idx === "number" ? idx : -1;
}

function ensureAgentIndex(configObj: Record<string, unknown>, agentId: string): number {
  const agents = (configObj as any).agents ?? ((configObj as any).agents = {});
  if (!Array.isArray(agents.list)) {
    agents.list = [];
  }
  const idx = findAgentIndex(configObj, agentId);
  if (idx >= 0) return idx;
  agents.list.push({ id: agentId });
  return agents.list.length - 1;
}

function serializeConfig(configObj: Record<string, unknown>): string {
  // For now we only support JSON serialization; config.set will validate server-side.
  return JSON.stringify(configObj, null, 2);
}

async function gatewayRequestOrThrow(
  client: GatewayBrowserClient | null,
  connected: boolean,
  method: string,
  params: unknown,
  timeoutMs?: number,
): Promise<any> {
  if (!connected) {
    throw new Error("网关 WebSocket 未连接");
  }
  if (!client) {
    throw new Error("网关 WebSocket client 未就绪");
  }

  const reqPromise = client.request(method, params);
  if (!timeoutMs || !(Number.isFinite(timeoutMs) && timeoutMs > 0)) {
    return reqPromise;
  }

  let timer: number | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => {
        reject(new Error(`${method} 超时（${timeoutMs}ms）`));
      }, timeoutMs);
    });
    return await Promise.race([reqPromise, timeoutPromise]);
  } finally {
    if (timer != null) window.clearTimeout(timer);
  }
}

export function EditAgentPage(props: EditAgentPageProps) {
  const { agentId, agentsRpc, hasElectronApi, onBack } = props;
  const gatewayClient = useChatStore((s) => s.gatewayClient);
  const gatewayConnected = useChatStore((s) => s.gatewayConnected);

  const agent: AgentIdentity | null = useMemo(() => {
    if (!agentId) return null;
    const raw = agentsRpc.find((r) => safeString((r as any)?.id).trim() === agentId.trim());
    if (!raw) {
      return { id: agentId, emoji: "🤖" };
    }
    const id = safeString((raw as any)?.id).trim();
    const name =
      safeString((raw as any)?.identity?.name).trim() || safeString((raw as any)?.name).trim() || id;
    const emoji = safeString((raw as any)?.identity?.emoji).trim() || "🤖";
    return { id, name, emoji };
  }, [agentId, agentsRpc]);

  const [panel, setPanel] = useState<Panel>("files");

  useEffect(() => {
    if (!agentId) return;
    setPanel("files");
  }, [agentId]);

  // ---------------- Files ----------------
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [filesList, setFilesList] = useState<any>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [fileDrafts, setFileDrafts] = useState<Record<string, string>>({});
  const [fileSaving, setFileSaving] = useState(false);

  const allFiles = (filesList?.files as any[]) ?? [];

  const loadFiles = useCallback(async () => {
    if (!hasElectronApi || !gatewayConnected || !agentId) return;
    setFilesLoading(true);
    setFilesError(null);
    try {
      const res = await gatewayRequestOrThrow(gatewayClient, gatewayConnected, "agents.files.list", { agentId }, 45000);
      setFilesList(res);
      const nextActive =
        activeFile && Array.isArray(res?.files) && res.files.some((f: any) => f?.name === activeFile)
          ? activeFile
          : res?.files?.[0]?.name ?? null;
      setActiveFile(nextActive);
    } catch (e) {
      setFilesError(String(e));
      setFilesList(null);
      setActiveFile(null);
    } finally {
      setFilesLoading(false);
    }
  }, [activeFile, agentId, gatewayClient, gatewayConnected, hasElectronApi]);

  const loadFileContent = useCallback(
    async (name: string, opts?: { preserveDraft?: boolean }) => {
      if (!hasElectronApi || !gatewayConnected || !agentId) return;
      const preserveDraft = opts?.preserveDraft ?? true;
      setFilesError(null);
      try {
        const res = await gatewayRequestOrThrow(
          gatewayClient,
          gatewayConnected,
          "agents.files.get",
          { agentId, name },
          45000,
        );
        const content = res?.file?.content ?? "";
        setFilesList((prev: any) => {
          if (!prev?.files || !Array.isArray(prev.files)) return prev;
          const nextFiles = prev.files.map((f: any) => (f?.name === name ? { ...f, ...res.file } : f));
          return { ...prev, files: nextFiles };
        });

        setFileContents((s) => ({ ...s, [name]: content }));
        if (!preserveDraft || !(name in fileDrafts)) {
          setFileDrafts((s) => ({ ...s, [name]: content }));
        }
      } catch (e) {
        setFilesError(String(e));
      }
    },
    [agentId, fileDrafts, gatewayClient, gatewayConnected, hasElectronApi],
  );

  useEffect(() => {
    if (!hasElectronApi || !gatewayConnected || !agentId) return;
    if (panel !== "files") return;
    void loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, agentId, hasElectronApi, gatewayConnected]);

  useEffect(() => {
    if (!activeFile || panel !== "files") return;
    if (fileContents[activeFile] != null) return;
    void loadFileContent(activeFile);
  }, [activeFile, fileContents, loadFileContent, panel]);

  const activeDraft = activeFile ? fileDrafts[activeFile] ?? "" : "";
  const activeBase = activeFile ? fileContents[activeFile] ?? "" : "";
  const activeDirty = activeFile ? activeDraft !== activeBase : false;

  const saveActiveFile = useCallback(async () => {
    if (!hasElectronApi || !gatewayConnected || !agentId || !activeFile) return;
    setFileSaving(true);
    try {
      await gatewayRequestOrThrow(
        gatewayClient,
        gatewayConnected,
        "agents.files.set",
        { agentId, name: activeFile, content: activeDraft },
        60000,
      );
      // Reload file list + content to keep server state consistent
      await loadFiles();
      await loadFileContent(activeFile, { preserveDraft: false });
    } catch (e) {
      setFilesError(String(e));
    } finally {
      setFileSaving(false);
    }
  }, [
    activeDraft,
    activeFile,
    agentId,
    gatewayClient,
    gatewayConnected,
    hasElectronApi,
    loadFileContent,
    loadFiles
  ]);

  // ---------------- Tools ----------------
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [toolsCatalogResult, setToolsCatalogResult] = useState<any>(null);

  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configDirty, setConfigDirty] = useState(false);
  const [configSnapshot, setConfigSnapshot] = useState<ConfigSnapshot | null>(null);
  const [configObj, setConfigObj] = useState<Record<string, unknown>>({});

  const loadConfig = useCallback(async () => {
    if (!hasElectronApi || !gatewayConnected || !agentId) return;
    setConfigLoading(true);
    try {
      const res = await gatewayRequestOrThrow(gatewayClient, gatewayConnected, "config.get", {}, 45000);
      const snapshot: ConfigSnapshot = {
        hash: res?.hash ?? null,
        raw: typeof res?.raw === "string" ? res.raw : null,
        config: res?.config && typeof res.config === "object" ? (res.config as Record<string, unknown>) : null,
      };
      setConfigSnapshot(snapshot);
      setConfigObj((snapshot.config ?? {}) as Record<string, unknown>);
      setConfigDirty(false);
    } catch (e) {
      setConfigSnapshot(null);
      setConfigObj({});
      setConfigDirty(false);
      throw e;
    } finally {
      setConfigLoading(false);
    }
  }, [agentId, gatewayClient, gatewayConnected, hasElectronApi]);

  const saveConfig = useCallback(async () => {
    if (!hasElectronApi || !gatewayConnected || !configSnapshot?.hash) return;
    setConfigSaving(true);
    try {
      const baseHash = configSnapshot.hash;
      const raw = serializeConfig(configObj);
      await gatewayRequestOrThrow(
        gatewayClient,
        gatewayConnected,
        "config.set",
        { raw, baseHash },
        60000,
      );
      await loadConfig();
      setConfigDirty(false);
    } catch (e) {
      throw e;
    } finally {
      setConfigSaving(false);
    }
  }, [configObj, configSnapshot?.hash, gatewayClient, gatewayConnected, hasElectronApi, loadConfig]);

  const loadToolsCatalog = useCallback(async () => {
    if (!hasElectronApi || !gatewayConnected || !agentId) return;
    setToolsLoading(true);
    setToolsError(null);
    try {
      const res = await gatewayRequestOrThrow(
        gatewayClient,
        gatewayConnected,
        "tools.catalog",
        { agentId, includePlugins: true },
        60000,
      );
      setToolsCatalogResult(res);
    } catch (e) {
      setToolsCatalogResult(null);
      setToolsError(String(e));
    } finally {
      setToolsLoading(false);
    }
  }, [agentId, gatewayClient, gatewayConnected, hasElectronApi]);

  useEffect(() => {
    if (!hasElectronApi || !gatewayConnected || !agentId) return;
    if (panel !== "tools") return;
    void (async () => {
      try {
        await loadConfig();
      } catch {
        // handled by UI state; keep going
      }
      await loadToolsCatalog();
    })();
  }, [agentId, hasElectronApi, gatewayConnected, loadConfig, loadToolsCatalog, panel]);

  const allToolIdsNormalized = useMemo(() => {
    const groups = (toolsCatalogResult?.groups as any[]) ?? [];
    const ids: string[] = [];
    for (const g of groups) {
      for (const t of g?.tools ?? []) {
        const id = safeString(t?.id).trim();
        if (id) ids.push(normalizeToolName(id));
      }
    }
    return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
  }, [toolsCatalogResult]);

  const toolsAllowlist = useMemo(() => {
    if (!agentId) return undefined;
    const idx = findAgentIndex(configObj, agentId);
    if (idx < 0) return undefined;
    const entry = (configObj as any)?.agents?.list?.[idx];
    const allow = entry?.tools?.allow;
    if (!Array.isArray(allow)) return undefined;
    const set = new Set(allow.map((x: any) => normalizeToolName(safeString(x))));
    return set;
  }, [agentId, configObj]);

  const toolGroups = useMemo(() => {
    const groups = (toolsCatalogResult?.groups as any[]) ?? [];
    if (!groups.length) {
      // fallback: treat as single group
      const flatTools = (toolsCatalogResult?.tools as any[]) ?? [];
      return flatTools.length ? [{ id: "all", label: "All tools", tools: flatTools }] : [];
    }
    return groups;
  }, [toolsCatalogResult]);

  const [toolsSaveError, setToolsSaveError] = useState<string | null>(null);

  const toggleTool = useCallback(
    (toolId: string, enabled: boolean) => {
      if (!agentId) return;
      const normalized = normalizeToolName(toolId);
      setConfigObj((prev) => {
        const next = { ...prev } as Record<string, unknown>;
        const idx = ensureAgentIndex(next, agentId);
        const entry = (next as any).agents.list[idx];
        entry.tools = entry.tools ?? {};

        const existingAllow = entry.tools.allow;
        const hasAllow = Array.isArray(existingAllow);
        if (!hasAllow) {
          // inherit mode: all enabled by default
          if (enabled) {
            return next;
          }
          // disabling one creates explicit allowlist = all except disabled
          entry.tools.allow = allToolIdsNormalized.filter((id) => id !== normalized);
        } else {
          const set = new Set(existingAllow.map((x: any) => normalizeToolName(safeString(x))));
          if (enabled) set.add(normalized);
          else set.delete(normalized);
          entry.tools.allow = Array.from(set);

          // if allowlist ends up enabling everything, remove allow to return to inherit
          if (set.size === allToolIdsNormalized.length) {
            delete entry.tools.allow;
          }
        }
        return next;
      });
      setConfigDirty(true);
      setToolsSaveError(null);
    },
    [allToolIdsNormalized.length, agentId],
  );

  const enableAllTools = useCallback(() => {
    if (!agentId) return;
    setConfigObj((prev) => {
      const next = { ...prev } as Record<string, unknown>;
      const idx = ensureAgentIndex(next, agentId);
      const entry = (next as any).agents.list[idx];
      entry.tools = entry.tools ?? {};
      delete entry.tools.allow;
      return next;
    });
    setConfigDirty(true);
    setToolsSaveError(null);
  }, [agentId]);

  const disableAllTools = useCallback(() => {
    if (!agentId) return;
    setConfigObj((prev) => {
      const next = { ...prev } as Record<string, unknown>;
      const idx = ensureAgentIndex(next, agentId);
      const entry = (next as any).agents.list[idx];
      entry.tools = entry.tools ?? {};
      entry.tools.allow = [];
      return next;
    });
    setConfigDirty(true);
    setToolsSaveError(null);
  }, [agentId]);

  // ---------------- Skills ----------------
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [skillsReport, setSkillsReport] = useState<any>(null);
  const [skillsFilter, setSkillsFilter] = useState("");

  const [skillsSaveError, setSkillsSaveError] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    if (!hasElectronApi || !gatewayConnected || !agentId) return;
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      const res = await gatewayRequestOrThrow(gatewayClient, gatewayConnected, "skills.status", { agentId }, 45000);
      setSkillsReport(res);
    } catch (e) {
      setSkillsReport(null);
      setSkillsError(String(e));
    } finally {
      setSkillsLoading(false);
    }
  }, [agentId, gatewayClient, gatewayConnected, hasElectronApi]);

  useEffect(() => {
    if (!hasElectronApi || !gatewayConnected || !agentId) return;
    if (panel !== "skills") return;
    void (async () => {
      try {
        await loadConfig();
      } catch {
        // ignore
      }
      await loadSkills();
    })();
  }, [agentId, hasElectronApi, gatewayConnected, loadConfig, loadSkills, panel]);

  const allSkills = useMemo(() => {
    const list = (skillsReport?.skills as any[]) ?? [];
    return list
      .map((s) => ({
        name: safeString(s?.name).trim(),
        description: safeString(s?.description).trim(),
        source: safeString(s?.source).trim(),
        emoji: safeString(s?.emoji).trim(),
      }))
      .filter((s) => s.name);
  }, [skillsReport]);

  const skillsAllowlist = useMemo(() => {
    if (!agentId) return undefined;
    const idx = findAgentIndex(configObj, agentId);
    if (idx < 0) return undefined;
    const entry = (configObj as any)?.agents?.list?.[idx];
    const skills = entry?.skills;
    if (!Array.isArray(skills)) return undefined;
    return new Set(skills.map((x: any) => safeString(x).trim()).filter(Boolean));
  }, [agentId, configObj]);

  const filteredSkills = useMemo(() => {
    const f = skillsFilter.trim().toLowerCase();
    if (!f) return allSkills;
    return allSkills.filter((s) => [s.name, s.description, s.source].join(" ").toLowerCase().includes(f));
  }, [allSkills, skillsFilter]);

  const toggleSkill = useCallback(
    (skillName: string, enabled: boolean) => {
      if (!agentId) return;
      const normalized = skillName.trim();
      if (!normalized) return;
      setConfigObj((prev) => {
        const next = { ...prev } as Record<string, unknown>;
        const idx = ensureAgentIndex(next, agentId);
        const entry = (next as any).agents.list[idx];
        const existing = entry.skills;
        const hasAllow = Array.isArray(existing);
        const all = allSkills.map((s) => s.name).filter(Boolean);

        if (!hasAllow) {
          // inherit mode: all skills enabled
          if (enabled) return next;
          entry.skills = all.filter((x) => x !== normalized);
        } else {
          const set = new Set(existing.map((x: any) => safeString(x).trim()).filter(Boolean));
          if (enabled) set.add(normalized);
          else set.delete(normalized);
          entry.skills = Array.from(set);
          if (set.size === all.length) {
            delete entry.skills;
          }
        }
        return next;
      });
      setConfigDirty(true);
      setSkillsSaveError(null);
    },
    [allSkills, agentId],
  );

  const enableAllSkills = useCallback(() => {
    if (!agentId) return;
    setConfigObj((prev) => {
      const next = { ...prev } as Record<string, unknown>;
      const idx = ensureAgentIndex(next, agentId);
      const entry = (next as any).agents.list[idx];
      delete entry.skills;
      return next;
    });
    setConfigDirty(true);
    setSkillsSaveError(null);
  }, [agentId]);

  const disableAllSkills = useCallback(() => {
    if (!agentId) return;
    setConfigObj((prev) => {
      const next = { ...prev } as Record<string, unknown>;
      const idx = ensureAgentIndex(next, agentId);
      const entry = (next as any).agents.list[idx];
      entry.skills = [];
      return next;
    });
    setConfigDirty(true);
    setSkillsSaveError(null);
  }, [agentId]);

  // ---------------- Channels ----------------
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsErr, setChannelsErr] = useState<string | null>(null);
  const [channelsSnap, setChannelsSnap] = useState<any>(null);

  const loadChannels = useCallback(async () => {
    if (!hasElectronApi || !gatewayConnected) return;
    setChannelsLoading(true);
    setChannelsErr(null);
    try {
      const r = await gatewayRequestOrThrow(
        gatewayClient,
        gatewayConnected,
        "channels.status",
        { probe: false, timeoutMs: 8000 },
        45000,
      );
      setChannelsSnap(r ?? null);
    } catch (e) {
      setChannelsErr(String((e as Error)?.message ?? e));
      setChannelsSnap(null);
    } finally {
      setChannelsLoading(false);
    }
  }, [gatewayClient, gatewayConnected, hasElectronApi]);

  useEffect(() => {
    if (!hasElectronApi || !gatewayConnected) return;
    if (panel !== "channels") return;
    void loadChannels();
  }, [hasElectronApi, gatewayConnected, loadChannels, panel]);

  // ---------------- Cron ----------------
  const [cronLoading, setCronLoading] = useState(false);
  const [cronErr, setCronErr] = useState<string | null>(null);
  const [cronStatus, setCronStatus] = useState<any>(null);
  const [cronJobs, setCronJobs] = useState<any[]>([]);

  const loadCron = useCallback(async () => {
    if (!hasElectronApi || !gatewayConnected) return;
    setCronLoading(true);
    setCronErr(null);
    try {
      const st = await gatewayRequestOrThrow(gatewayClient, gatewayConnected, "cron.status", {}, 45000);
      setCronStatus(st ?? null);

      const list = await gatewayRequestOrThrow(
        gatewayClient,
        gatewayConnected,
        "cron.list",
        { includeDisabled: true, limit: 200, offset: 0 },
        60000,
      );
      const payload = list as any;
      setCronJobs(Array.isArray(payload?.jobs) ? payload.jobs : []);
    } catch (e) {
      setCronErr(String((e as Error)?.message ?? e));
      setCronStatus(null);
      setCronJobs([]);
    } finally {
      setCronLoading(false);
    }
  }, [gatewayClient, gatewayConnected, hasElectronApi]);

  useEffect(() => {
    if (!hasElectronApi || !gatewayConnected) return;
    if (panel !== "cron") return;
    void loadCron();
  }, [hasElectronApi, gatewayConnected, loadCron, panel]);

  const agentCronJobs = useMemo(() => {
    if (!agentId) return [];
    return cronJobs.filter((j) => safeString(j?.agentId).trim() === agentId.trim());
  }, [agentId, cronJobs]);

  const runCronNow = useCallback(
    async (jobId: string) => {
      if (!hasElectronApi || !gatewayConnected) return;
      if (!jobId) return;
      try {
        await gatewayRequestOrThrow(
          gatewayClient,
          gatewayConnected,
          "cron.run",
          { id: jobId, mode: "force" },
          120000,
        );
        await loadCron();
      } catch (e) {
        setCronErr(String((e as Error)?.message ?? e));
      }
    },
    [gatewayClient, gatewayConnected, hasElectronApi, loadCron],
  );

  // ---------------- Save actions (tools/skills) ----------------
  const onConfigSave = useCallback(async () => {
    if (!configDirty) return;
    try {
      setToolsSaveError(null);
      setSkillsSaveError(null);
      await saveConfig();
    } catch (e) {
      const msg = String(e);
      if (panel === "tools") setToolsSaveError(msg);
      if (panel === "skills") setSkillsSaveError(msg);
    }
  }, [configDirty, panel, saveConfig]);

  const saveDisabled = !configDirty || configLoading || configSaving;

  // ---------------- Render ----------------
  if (!hasElectronApi) {
    return (
      <div className="oc-page" style={{ padding: 20 }}>
        <div className="oc-rsub">仅在 Electron 中可编辑智能体。</div>
        <div style={{ marginTop: 12 }}>
          <button type="button" className="oc-bs" onClick={onBack}>
            返回
          </button>
        </div>
      </div>
    );
  }

  if (!agentId || !agent) {
    return (
      <div className="oc-page" style={{ padding: 20 }}>
        <div className="oc-rsub">未选择智能体。</div>
        <div style={{ marginTop: 12 }}>
          <button type="button" className="oc-bs" onClick={onBack}>
            返回
          </button>
        </div>
      </div>
    );
  }

  const fileEditorDisabled = fileSaving || filesLoading || !activeFile;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "0", flex: 1 }}>
      <div className="oc-topbar">
        <button
          type="button"
          className="oc-bc"
          style={{ cursor: "pointer", border: "none", background: "none" }}
          onClick={onBack}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 2L4 6.5 9 11" />
          </svg>
          返回
        </button>
        <div style={{ fontWeight: 500, color: "var(--color-text-primary)", marginLeft: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <div className="oc-av" style={{ width: 24, height: 24, background: "#FFE8E8" }}>
            {agent.emoji ?? "🤖"}
          </div>
          <div>
            {agent.name}
            <div className="oc-rsub" style={{ fontSize: 11, marginTop: 2 }}>ID：{agent.id}</div>
          </div>
        </div>
        <div className="oc-tr">
          {(panel === "tools" || panel === "skills") && (
            <button type="button" className="oc-bp" disabled={saveDisabled} onClick={() => void onConfigSave()}>
              {configSaving ? "保存中…" : configDirty ? "保存" : "保存"}
            </button>
          )}
        </div>
      </div>

      <div className="oc-page" style={{ padding: 0 }}>
        <div className="oc-card" style={{ borderRadius: 0 }}>
          <div style={{ display: "flex", gap: 10, padding: "14px 16px", borderBottom: "0.5px solid var(--color-border-tertiary)", flexWrap: "wrap" }}>
            <button type="button" className={`oc-tab-btn ${panel === "files" ? "on" : ""}`} onClick={() => setPanel("files")}>
              Files
            </button>
            <button type="button" className={`oc-tab-btn ${panel === "tools" ? "on" : ""}`} onClick={() => setPanel("tools")}>
              Tools
            </button>
            <button type="button" className={`oc-tab-btn ${panel === "skills" ? "on" : ""}`} onClick={() => setPanel("skills")}>
              Skills
            </button>
            <button type="button" className={`oc-tab-btn ${panel === "channels" ? "on" : ""}`} onClick={() => setPanel("channels")}>
              Channels
            </button>
            <button type="button" className={`oc-tab-btn ${panel === "cron" ? "on" : ""}`} onClick={() => setPanel("cron")}>
              Cron Jobs
            </button>
          </div>

          <div style={{ padding: 16, minHeight: 0, flex: 1 }}>
            {panel === "files" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="oc-topbar" style={{ height: "auto", padding: 0, background: "transparent", border: "none" }}>
                  <div className="oc-bc">
                    <b>Files</b>
                    <span className="oc-rsub" style={{ marginLeft: 10 }}>{filesList?.workspace ? `Workspace: ${filesList.workspace}` : ""}</span>
                  </div>
                  <div className="oc-tr">
                    <button type="button" className="oc-bs" disabled={!hasElectronApi || filesLoading} onClick={() => void loadFiles()}>
                      {filesLoading ? "加载中…" : "刷新"}
                    </button>
                  </div>
                </div>

                {filesError ? (
                  <div className="oc-rsub" style={{ color: "#b45309" }}>{filesError}</div>
                ) : null}

                <div style={{ display: "flex", gap: 16, minHeight: 0 }}>
                  <div style={{ width: 280, borderRight: "0.5px solid var(--color-border-tertiary)", paddingRight: 16 }}>
                    <div className="oc-rsub" style={{ marginBottom: 8 }}>Core Files</div>
                    {filesLoading ? <div className="oc-rsub">加载中…</div> : null}
                    {!filesLoading && allFiles.length === 0 ? (
                      <div className="oc-rsub">暂无文件。</div>
                    ) : null}
                    {allFiles.map((f) => {
                      const name = safeString(f?.name).trim();
                      const missing = Boolean(f?.missing);
                      const updatedAtMs = f?.updatedAtMs;
                      const selected = activeFile === name;
                      return (
                        <button
                          key={name}
                          type="button"
                          className={`oc-agent-file-row ${selected ? "on" : ""}`}
                          onClick={() => {
                            setActiveFile(name);
                            void loadFileContent(name, { preserveDraft: true });
                          }}
                          style={{ width: "100%" }}
                        >
                          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            <div className="oc-av" style={{ width: 26, height: 26, background: missing ? "#FFF1F2" : "#EFF6FF", color: "#111827" }}>
                              {missing ? "!" : "F"}
                            </div>
                            <div style={{ textAlign: "left" }}>
                              <div className="oc-rname" style={{ margin: 0 }}>{name}</div>
                              <div className="oc-rsub" style={{ fontSize: 11, marginTop: 2 }}>
                                {missing ? "missing" : updatedAtMs ? `updated: ${new Date(updatedAtMs).toLocaleString()}` : ""}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <div>
                        <div className="oc-ch" style={{ margin: 0 }}>{activeFile ? `编辑：${activeFile}` : "请选择文件"}</div>
                        <div className="oc-rsub" style={{ fontSize: 11, marginTop: 4 }}>
                          {activeDirty ? "已修改（未保存）" : "未修改"}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="oc-bs"
                          disabled={fileEditorDisabled || !activeDirty}
                          onClick={() => {
                            if (!activeFile) return;
                            setFileDrafts((s) => ({ ...s, [activeFile]: activeBase }));
                          }}
                        >
                          Reset
                        </button>
                        <button
                          type="button"
                          className="oc-bp"
                          disabled={fileEditorDisabled || !activeDirty}
                          onClick={() => void saveActiveFile()}
                        >
                          {fileSaving ? "保存中…" : "Save"}
                        </button>
                      </div>
                    </div>

                    <textarea
                      value={activeDraft}
                      disabled={!activeFile}
                      onChange={(e) => {
                        const next = e.target.value;
                        if (!activeFile) return;
                        setFileDrafts((s) => ({ ...s, [activeFile]: next }));
                      }}
                      style={{
                        width: "100%",
                        minHeight: 380,
                        borderRadius: 12,
                        border: "0.5px solid var(--color-border-secondary)",
                        background: "var(--color-background-secondary)",
                        padding: 12,
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        outline: "none",
                        resize: "vertical",
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {panel === "tools" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {toolsError ? <div className="oc-rsub" style={{ color: "#b45309" }}>{toolsError}</div> : null}
                {toolsLoading ? <div className="oc-rsub">加载工具目录中…</div> : null}

                {configLoading ? <div className="oc-rsub">加载配置中…</div> : null}
                <div className="oc-card" style={{ padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div>
                      <div className="oc-ch" style={{ margin: 0 }}>Tools</div>
                      <div className="oc-rsub" style={{ fontSize: 11, marginTop: 4 }}>
                        {configDirty ? "已修改，请点击保存" : "当前配置未修改"}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="oc-bs" disabled={configLoading || configSaving} onClick={enableAllTools}>
                        Enable All
                      </button>
                      <button type="button" className="oc-bs" disabled={configLoading || configSaving} onClick={disableAllTools}>
                        Disable All
                      </button>
                    </div>
                  </div>
                  {toolsSaveError ? <div className="oc-rsub" style={{ color: "#b45309", marginTop: 8 }}>{toolsSaveError}</div> : null}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {toolGroups.length === 0 && !toolsLoading ? (
                    <div className="oc-rsub">工具列表为空（或网关未返回 tools.catalog）。</div>
                  ) : null}
                  {toolGroups.map((g: any) => {
                    const label = safeString(g?.label).trim() || safeString(g?.id).trim();
                    const tools = (g?.tools as any[]) ?? [];
                    if (!tools.length) return null;
                    return (
                      <div key={safeString(g?.id)} className="oc-card" style={{ padding: 12 }}>
                        <div className="oc-ch" style={{ margin: 0 }}>{label}</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                          {tools.map((t: any) => {
                            const id = safeString(t?.id).trim();
                            const norm = normalizeToolName(id);
                            const checked = toolsAllowlist === undefined ? true : toolsAllowlist.has(norm);
                            const title = safeString(t?.label).trim() || id;
                            const desc = safeString(t?.description).trim();
                            return (
                              <label key={id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={configLoading || configSaving}
                                  onChange={(e) => toggleTool(id, (e.target as HTMLInputElement).checked)}
                                />
                                <div style={{ display: "flex", flexDirection: "column" }}>
                                  <div style={{ fontWeight: 500 }}>{title}</div>
                                  {desc ? <div className="oc-rsub" style={{ fontSize: 11, marginTop: 2 }}>{desc}</div> : null}
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {panel === "skills" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {skillsError ? <div className="oc-rsub" style={{ color: "#b45309" }}>{skillsError}</div> : null}
                {skillsLoading ? <div className="oc-rsub">加载技能状态中…</div> : null}

                <div className="oc-card" style={{ padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div>
                      <div className="oc-ch" style={{ margin: 0 }}>Skills</div>
                      <div className="oc-rsub" style={{ fontSize: 11, marginTop: 4 }}>
                        {configDirty ? "已修改，请点击保存" : "当前配置未修改"}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="oc-bs" disabled={configLoading || configSaving} onClick={enableAllSkills}>
                        Enable All
                      </button>
                      <button type="button" className="oc-bs" disabled={configLoading || configSaving} onClick={disableAllSkills}>
                        Disable All
                      </button>
                    </div>
                  </div>
                  <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <input
                      className="oc-inptxt"
                      style={{ minWidth: 260 }}
                      placeholder="Filter skills..."
                      value={skillsFilter}
                      disabled={skillsLoading || configLoading || configSaving}
                      onChange={(e) => setSkillsFilter(e.target.value)}
                    />
                    <div className="oc-rsub" style={{ fontSize: 11 }}>
                      {filteredSkills.length} shown
                    </div>
                  </div>
                  {skillsSaveError ? <div className="oc-rsub" style={{ color: "#b45309", marginTop: 8 }}>{skillsSaveError}</div> : null}
                </div>

                <div className="oc-card" style={{ padding: 12 }}>
                  {filteredSkills.length === 0 ? (
                    <div className="oc-rsub">暂无技能。</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {filteredSkills.map((s) => {
                        const checked = skillsAllowlist === undefined ? true : skillsAllowlist.has(s.name);
                        return (
                          <label key={s.name} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={configLoading || configSaving}
                              onChange={(e) => toggleSkill(s.name, (e.target as HTMLInputElement).checked)}
                            />
                            <div style={{ display: "flex", flexDirection: "column" }}>
                              <div style={{ fontWeight: 500 }}>
                                {s.emoji ? `${s.emoji} ` : ""}{s.name}
                                {s.source ? <span className="oc-rsub" style={{ fontSize: 11, marginLeft: 8 }}>({s.source})</span> : null}
                              </div>
                              {s.description ? <div className="oc-rsub" style={{ fontSize: 11, marginTop: 4 }}>{s.description}</div> : null}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {panel === "channels" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="oc-card" style={{ padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div>
                      <div className="oc-ch" style={{ margin: 0 }}>Channels</div>
                      <div className="oc-rsub" style={{ fontSize: 11, marginTop: 4 }}>
                        gateway-wide 状态（与 agent context 一起展示）
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="oc-bs" disabled={channelsLoading} onClick={() => void loadChannels()}>
                        {channelsLoading ? "刷新中…" : "Refresh"}
                      </button>
                    </div>
                  </div>
                  {channelsErr ? <div className="oc-rsub" style={{ color: "#b45309", marginTop: 8 }}>{channelsErr}</div> : null}
                </div>

                {!channelsSnap ? (
                  <div className="oc-rsub">暂无 channels.snapshot。</div>
                ) : (
                  <div className="oc-card" style={{ padding: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {(() => {
                        const snap = channelsSnap as { channels?: Record<string, any> } | null;
                        const ch = snap?.channels;
                        const keys = ch && typeof ch === "object" ? Object.keys(ch) : [];
                        if (keys.length === 0) return <div className="oc-rsub">暂无频道数据。</div>;
                        const emojiOf = (key: string) =>
                          key === "telegram" ? "✈️" : key === "whatsapp" ? "💬" : key === "discord" ? "🎮" : "🔗";
                        return keys.map((key) => {
                          const entry = ch![key] ?? {};
                          const configured = Boolean(entry.configured);
                          const linked = Boolean(entry.linked);
                          const ok = configured && linked !== false;
                          return (
                            <div key={key} className="oc-row">
                              <div className="oc-rl">
                                <div className="oc-av" style={{ background: "#E3F2FF", fontSize: 17 }}>
                                  {emojiOf(key)}
                                </div>
                                <div>
                                  <div className="oc-rname">{key.replace(/^\w/, (c) => c.toUpperCase())}</div>
                                  <div className="oc-rsub" style={{ fontSize: 11, marginTop: 2 }}>
                                    configured: {String(configured)} · linked: {String(linked)}
                                  </div>
                                </div>
                              </div>
                              <div className="oc-rr">
                                <span className={`oc-tag ${ok ? "oc-tg" : "oc-tr2"}`}>{ok ? "可用" : "待配置"}</span>
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}

            {panel === "cron" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="oc-card" style={{ padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div>
                      <div className="oc-ch" style={{ margin: 0 }}>Cron Jobs</div>
                      <div className="oc-rsub" style={{ fontSize: 11, marginTop: 4 }}>
                        仅显示 targeting this agent 的 jobs：{agentCronJobs.length}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" className="oc-bs" disabled={cronLoading} onClick={() => void loadCron()}>
                        {cronLoading ? "刷新中…" : "Refresh"}
                      </button>
                    </div>
                  </div>
                  {cronErr ? <div className="oc-rsub" style={{ color: "#b45309", marginTop: 8 }}>{cronErr}</div> : null}
                </div>

                {!cronLoading && agentCronJobs.length === 0 ? (
                  <div className="oc-rsub">暂无针对该智能体的定时任务。</div>
                ) : null}

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {agentCronJobs.map((job) => {
                    const id = safeString(job?.id).trim();
                    const name = safeString(job?.name).trim() || id;
                    const enabled = job?.enabled !== false;
                    const schedule = job?.schedule;
                    return (
                      <div key={id || name} className="oc-row" style={{ alignItems: "flex-start" }}>
                        <div className="oc-rl" style={{ flex: 1 }}>
                          <div className="oc-av" style={{ background: "#E0F2FE" }}>{enabled ? "⏰" : "⛔"}</div>
                          <div>
                            <div className="oc-rname">{name}</div>
                            <div className="oc-rsub" style={{ fontSize: 11, marginTop: 4 }}>
                              id: {id || "—"} · enabled: {String(enabled)}
                            </div>
                            {schedule != null ? (
                              <pre
                                style={{
                                  marginTop: 8,
                                  fontSize: 10,
                                  maxHeight: 100,
                                  overflow: "auto",
                                  background: "var(--color-background-secondary)",
                                  padding: 8,
                                  borderRadius: 8,
                                }}
                              >
                                {JSON.stringify(schedule, null, 2)}
                              </pre>
                            ) : null}
                          </div>
                        </div>
                        <div className="oc-rr" style={{ alignItems: "flex-start" }}>
                          <button
                            type="button"
                            className="oc-bs"
                            disabled={!enabled}
                            onClick={() => void runCronNow(id)}
                          >
                            Run Now
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

