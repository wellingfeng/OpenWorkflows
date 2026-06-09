import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import {
  Bone,
  Box,
  Check,
  FileText,
  Gamepad2,
  Info,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Terminal,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  mergeRecommendedMcpServers,
  projectEngineLabel,
  projectHealth,
  projectSettingsFromMetadata,
  projectSettingsPatch,
  settingsWithDetectedGameFeatures,
  type ProjectMcpServerConfig,
  type ProjectSettings,
} from '@/lib/projectSettings';
import {
  loadThreeDGenerationSettings,
  saveThreeDGenerationSettings,
} from '@/lib/threeDGeneration';
import {
  openLocalPath,
  probeProjectMcpServer,
  scanProjectEnvironment,
  type ProjectEnvironmentScan,
  type ProjectMcpProbeResult,
} from '@/lib/tauri';
import { historyStore } from '@/store/history/store';
import type { WorkspaceRecord, WorkspaceSummary } from '@/store/history/types';
import { useStore } from '@/store/useStore';

type ProjectSettingsTab = 'overview' | 'game' | 'mcp' | 'skills' | 'automation';

const tabs: { id: ProjectSettingsTab; label: string; Icon: LucideIcon }[] = [
  { id: 'overview', label: '概览', Icon: Info },
  { id: 'game', label: '游戏功能', Icon: Gamepad2 },
  { id: 'mcp', label: 'MCP配置', Icon: Terminal },
  { id: 'skills', label: 'Skill', Icon: Box },
  { id: 'automation', label: '权限/自动化', Icon: SlidersHorizontal },
];

interface ProjectSettingsModalProps {
  workspace: WorkspaceSummary;
  onClose: () => void;
  onWorkspaceUpdated?: (workspace: WorkspaceSummary) => void;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function workspaceSummaryFromRecord(record: WorkspaceRecord): WorkspaceSummary {
  return {
    id: record.id,
    path: record.path,
    name: record.name,
    updatedAt: record.updatedAt,
    sessionCount: record.sessionCount,
    lastActiveSessionId: record.lastActiveSessionId,
    metadata: record.metadata,
  };
}

function formatTime(ms?: number | null): string {
  if (!ms) return '未探测';
  return new Date(ms).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function syncProjectGameFeaturesToRuntime(settings: ProjectSettings): void {
  const currentThreeD = loadThreeDGenerationSettings();
  saveThreeDGenerationSettings({
    ...currentThreeD,
    enabled: settings.gameFeatures.meshGeneration,
    rigging: {
      ...currentThreeD.rigging,
      enabled: settings.gameFeatures.rigging,
    },
  });

  useStore.getState().setGameExpertSettings({
    enabled: settings.gameFeatures.gameExperts,
    engine: settings.gameFeatures.gameExpertEngine,
  });
}

function fieldId(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function SettingsRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-semibold text-fg">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-fg-faint">{hint}</span> : null}
    </label>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-md border border-border-soft bg-bg-alt px-3 py-2.5">
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-fg">{label}</span>
        {hint ? <span className="mt-1 block text-[11px] text-fg-faint">{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
      />
    </label>
  );
}

function ProbeBadge({ result }: { result?: ProjectMcpProbeResult }) {
  if (!result) {
    return (
      <span className="rounded border border-border-soft bg-bg-alt px-2 py-0.5 text-[11px] text-fg-faint">
        未探测
      </span>
    );
  }
  return (
    <span
      className={cn(
        'rounded border px-2 py-0.5 text-[11px]',
        result.ok
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
          : 'border-red-500/40 bg-red-500/10 text-red-300',
      )}
      title={result.message}
    >
      {result.ok ? '已连接' : '失败'}
    </span>
  );
}

export default function ProjectSettingsModal({
  workspace,
  onClose,
  onWorkspaceUpdated,
}: ProjectSettingsModalProps) {
  const [tab, setTab] = useState<ProjectSettingsTab>('overview');
  const [record, setRecord] = useState<WorkspaceRecord | null>(null);
  const [scan, setScan] = useState<ProjectEnvironmentScan | null>(null);
  const [settings, setSettings] = useState<ProjectSettings>(() =>
    projectSettingsFromMetadata(workspace.metadata),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const workspacePath = record?.path || workspace.path || '';
  const health = useMemo(
    () =>
      projectHealth(
        {
          ...workspace,
          metadata: record?.metadata ?? workspace.metadata,
        },
        scan,
      ),
    [record?.metadata, scan, workspace],
  );

  const updateMcp = useCallback(
    (patch: Partial<ProjectSettings['mcp']>) => {
      setSettings((current) => ({
        ...current,
        mcp: { ...current.mcp, ...patch },
      }));
      setDirty(true);
    },
    [],
  );

  const updateAutomation = useCallback(
    (patch: Partial<ProjectSettings['automation']>) => {
      setSettings((current) => {
        const next = {
          ...current,
          automation: { ...current.automation, ...patch },
        };
        return patch.autoDetect === true && scan
          ? settingsWithDetectedGameFeatures(next, scan)
          : next;
      });
      setDirty(true);
    },
    [scan],
  );

  const updateGameFeatures = useCallback(
    (patch: Partial<ProjectSettings['gameFeatures']>) => {
      setSettings((current) => ({
        ...current,
        gameFeatures: { ...current.gameFeatures, ...patch },
      }));
      setDirty(true);
    },
    [],
  );

  const updateSkills = useCallback(
    (patch: Partial<ProjectSettings['skills']>) => {
      setSettings((current) => ({
        ...current,
        skills: { ...current.skills, ...patch },
      }));
      setDirty(true);
    },
    [],
  );

  const updateServer = useCallback(
    (serverId: string, patch: Partial<ProjectMcpServerConfig>) => {
      setSettings((current) => ({
        ...current,
        mcp: {
          ...current.mcp,
          servers: current.mcp.servers.map((server) =>
            server.id === serverId ? { ...server, ...patch } : server,
          ),
        },
      }));
      setDirty(true);
    },
    [],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setStatus(null);
    try {
      const latestRecord = await historyStore.getWorkspace(workspace.id);
      setRecord(latestRecord);
      const baseSettings = projectSettingsFromMetadata(
        latestRecord?.metadata ?? workspace.metadata,
      );
      let nextScan: ProjectEnvironmentScan | null = null;
      if ((latestRecord?.path || workspace.path || '').trim()) {
        nextScan = await scanProjectEnvironment(latestRecord?.path || workspace.path);
        setScan(nextScan);
      } else {
        setScan(null);
      }
      const nextSettings = nextScan
        ? settingsWithDetectedGameFeatures(baseSettings, nextScan)
        : baseSettings;
      setSettings(nextSettings);
      syncProjectGameFeaturesToRuntime(nextSettings);
      setDirty(false);
    } catch (err) {
      setStatus(`检测失败：${describeError(err)}`);
    } finally {
      setLoading(false);
    }
  }, [workspace.id, workspace.metadata, workspace.path]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const persistSettings = useCallback(
    async (next: ProjectSettings) => {
      setSaving(true);
      try {
        const nextRecord = await historyStore.patchWorkspaceMetadata(
          workspace.id,
          projectSettingsPatch(next),
        );
        const summary = workspaceSummaryFromRecord(nextRecord);
        setRecord(nextRecord);
        const savedSettings = projectSettingsFromMetadata(nextRecord.metadata);
        setSettings(savedSettings);
        syncProjectGameFeaturesToRuntime(savedSettings);
        useStore.setState((state) => ({
          workspaces: state.workspaces.map((item) =>
            item.id === summary.id ? summary : item,
          ),
        }));
        onWorkspaceUpdated?.(summary);
        setDirty(false);
        setStatus('已保存');
      } catch (err) {
        setStatus(`保存失败：${describeError(err)}`);
      } finally {
        setSaving(false);
      }
    },
    [onWorkspaceUpdated, workspace.id],
  );

  const applyRecommended = useCallback(async () => {
    if (!scan) return;
    const next = mergeRecommendedMcpServers(settings, scan);
    setSettings(next);
    await persistSettings(next);
    setStatus('推荐 MCP 配置已应用');
  }, [persistSettings, scan, settings]);

  const addCustomServer = useCallback(() => {
    const id = `custom-${Date.now().toString(36)}`;
    updateMcp({
      servers: [
        ...settings.mcp.servers,
        {
          id,
          label: '自定义 MCP',
          source: 'custom',
          enabled: true,
          transport: 'stdio',
          command: '',
          args: [],
          env: {},
        },
      ],
    });
  }, [settings.mcp.servers, updateMcp]);

  const removeServer = useCallback(
    (serverId: string) => {
      updateMcp({
        servers: settings.mcp.servers.filter((server) => server.id !== serverId),
      });
    },
    [settings.mcp.servers, updateMcp],
  );

  const probeEnabledServers = useCallback(async () => {
    const enabledServers = settings.mcp.enabled
      ? settings.mcp.servers.filter((server) => server.enabled)
      : [];
    if (!workspacePath.trim() || enabledServers.length === 0) {
      setStatus('没有可探测的 MCP server');
      return;
    }
    setProbing(true);
    setStatus('探测中...');
    const results: ProjectMcpProbeResult[] = [];
    for (const server of enabledServers) {
      const result = await probeProjectMcpServer(workspacePath, {
        id: server.id,
        transport: server.transport,
        command: server.command,
        args: server.args,
        env: server.env,
        url: server.url,
      }).catch((err): ProjectMcpProbeResult => ({
        serverId: server.id,
        ok: false,
        status: 'probe-error',
        message: describeError(err),
        toolsCount: null,
        checkedAtMs: Date.now(),
      }));
      results.push(result);
    }
    const resultById = new Map(results.map((result) => [result.serverId, result]));
    const next: ProjectSettings = {
      ...settings,
      mcp: {
        ...settings.mcp,
        servers: settings.mcp.servers.map((server) => {
          const result = resultById.get(server.id);
          return result ? { ...server, lastProbe: result } : server;
        }),
      },
    };
    setSettings(next);
    await persistSettings(next);
    const okCount = results.filter((result) => result.ok).length;
    setStatus(`探测完成：${okCount}/${results.length} 已连接`);
    setProbing(false);
  }, [persistSettings, settings, workspacePath]);

  const content = (() => {
    if (tab === 'overview') {
      const detectedEngine = scan?.engine.engine ?? 'unknown';
      return (
        <div className="grid gap-4">
          <section className="rounded-md border border-border bg-panel-2 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-fg-faint">项目类型</div>
                <div className="mt-1 flex items-center gap-2 text-lg font-semibold text-fg">
                  <Gamepad2 size={18} className="text-accent" />
                  {scan?.engine.label ?? '检测中'}
                </div>
                <div className="mt-1 text-xs text-fg-faint">
                  {scan?.engine.version ?? projectEngineLabel(detectedEngine)}
                </div>
              </div>
              <span
                className={cn(
                  'rounded border px-2 py-1 text-xs',
                  health.tone === 'connected'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : health.tone === 'failed'
                      ? 'border-red-500/40 bg-red-500/10 text-red-300'
                      : health.tone === 'configured'
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                        : health.tone === 'detected'
                          ? 'border-sky-500/40 bg-sky-500/10 text-sky-300'
                          : 'border-border-soft bg-bg-alt text-fg-faint',
                )}
                title={health.detail}
              >
                {health.label}
              </span>
            </div>
            <div className="mt-4 grid gap-2 text-xs text-fg-dim">
              <div className="truncate" title={workspacePath}>
                工作区：{workspacePath || '未指定'}
              </div>
              <div>标记：{scan?.engine.markers.join('、') || '无'}</div>
              <div>推荐 MCP：{scan?.suggestedMcpServers.length ?? 0}</div>
            </div>
          </section>

          <section className="grid gap-3 rounded-md border border-border bg-panel-2 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-fg">项目 MCP</div>
                <div className="mt-1 text-xs text-fg-faint">{health.detail}</div>
              </div>
              <button
                type="button"
                onClick={() => setTab('mcp')}
                className="rounded-md border border-border bg-bg-alt px-3 py-1.5 text-xs text-fg-dim hover:border-accent hover:text-fg"
              >
                配置
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded border border-border-soft bg-bg-alt p-3">
                <div className="text-[11px] text-fg-faint">已配置</div>
                <div className="mt-1 text-lg font-semibold text-fg">
                  {settings.mcp.servers.length}
                </div>
              </div>
              <div className="rounded border border-border-soft bg-bg-alt p-3">
                <div className="text-[11px] text-fg-faint">已启用</div>
                <div className="mt-1 text-lg font-semibold text-fg">
                  {settings.mcp.servers.filter((server) => server.enabled).length}
                </div>
              </div>
              <div className="rounded border border-border-soft bg-bg-alt p-3">
                <div className="text-[11px] text-fg-faint">已连接</div>
                <div className="mt-1 text-lg font-semibold text-fg">
                  {settings.mcp.servers.filter((server) => server.lastProbe?.ok).length}
                </div>
              </div>
            </div>
          </section>
        </div>
      );
    }

    if (tab === 'game') {
      const detectedEngine = scan?.engine.engine ?? 'unknown';
      const autoMode = settings.automation.autoDetect;
      return (
        <div className="grid gap-4">
          <section className="rounded-md border border-border bg-panel-2 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-fg">游戏相关能力</div>
                <div className="mt-1 text-xs leading-relaxed text-fg-faint">
                  当前检测：{scan?.engine.label ?? '未识别'}。自动检测开启时，
                  UE / Unity / Godot 项目会默认开启 Mesh、骨骼绑定和游戏专家；
                  非游戏项目默认关闭。
                </div>
              </div>
              <span
                className={cn(
                  'rounded border px-2 py-0.5 text-[11px]',
                  detectedEngine === 'unknown'
                    ? 'border-border-soft bg-bg-alt text-fg-faint'
                    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
                )}
              >
                {autoMode ? '自动检测' : '手动设置'}
              </span>
            </div>
          </section>

          <ToggleRow
            label="Mesh 渠道"
            hint="控制当前项目是否启用 3D 模型生成入口。"
            checked={settings.gameFeatures.meshGeneration}
            onChange={(checked) => updateGameFeatures({ meshGeneration: checked })}
          />
          <ToggleRow
            label="骨骼绑定"
            hint="控制当前项目是否启用自动绑骨流程。"
            checked={settings.gameFeatures.rigging}
            onChange={(checked) => updateGameFeatures({ rigging: checked })}
          />
          <ToggleRow
            label="游戏专家"
            hint="控制当前项目是否启用游戏专家，并在游戏项目中自动选择对应引擎。"
            checked={settings.gameFeatures.gameExperts}
            onChange={(checked) => updateGameFeatures({ gameExperts: checked })}
          />

          <div className="grid gap-3 rounded-md border border-border bg-panel-2 p-4">
            <SettingsRow
              label="游戏专家引擎"
              hint="自动检测开启时会跟随项目类型；非游戏项目使用自动。"
            >
              <select
                value={settings.gameFeatures.gameExpertEngine}
                onChange={(event) => {
                  const gameExpertEngine = event.currentTarget
                    .value as ProjectSettings['gameFeatures']['gameExpertEngine'];
                  updateGameFeatures({
                    gameExpertEngine,
                  });
                }}
                className="h-9 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-accent"
              >
                <option value="auto">自动</option>
                <option value="unity">Unity</option>
                <option value="unreal">Unreal / UE</option>
                <option value="godot">Godot</option>
              </select>
            </SettingsRow>
            <div className="flex flex-wrap gap-2 text-[11px] text-fg-faint">
              <span className="inline-flex items-center gap-1 rounded border border-border-soft bg-bg-alt px-2 py-1">
                <Box size={12} />
                Mesh：{settings.gameFeatures.meshGeneration ? '开启' : '关闭'}
              </span>
              <span className="inline-flex items-center gap-1 rounded border border-border-soft bg-bg-alt px-2 py-1">
                <Bone size={12} />
                骨骼：{settings.gameFeatures.rigging ? '开启' : '关闭'}
              </span>
              <span className="inline-flex items-center gap-1 rounded border border-border-soft bg-bg-alt px-2 py-1">
                <Gamepad2 size={12} />
                专家：{settings.gameFeatures.gameExperts ? '开启' : '关闭'}
              </span>
            </div>
          </div>
        </div>
      );
    }

    if (tab === 'mcp') {
      return (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ToggleRow
              label="启用项目 MCP"
              checked={settings.mcp.enabled}
              onChange={(checked) => updateMcp({ enabled: checked })}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={applyRecommended}
                disabled={!scan || scan.suggestedMcpServers.length === 0 || saving}
                className="rounded-md border border-border bg-bg-alt px-3 py-1.5 text-xs text-fg-dim hover:border-accent hover:text-fg disabled:opacity-50"
              >
                应用推荐配置
              </button>
              <button
                type="button"
                onClick={addCustomServer}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-alt px-3 py-1.5 text-xs text-fg-dim hover:border-accent hover:text-fg"
              >
                <Plus size={13} />
                新增
              </button>
            </div>
          </div>

          <div className="grid gap-3">
            {settings.mcp.servers.length === 0 ? (
              <div className="rounded-md border border-border-soft bg-bg-alt p-4 text-sm text-fg-faint">
                当前项目未配置 MCP。
              </div>
            ) : (
              settings.mcp.servers.map((server) => {
                const commandId = fieldId('mcp-command', server.id);
                const argsId = fieldId('mcp-args', server.id);
                return (
                  <section
                    key={server.id}
                    className="grid gap-3 rounded-md border border-border bg-panel-2 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="flex min-w-0 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={server.enabled}
                          onChange={(event) =>
                            updateServer(server.id, {
                              enabled: event.currentTarget.checked,
                            })
                          }
                          className="h-4 w-4 shrink-0 accent-accent"
                        />
                        <span className="truncate text-sm font-semibold text-fg">
                          {server.label}
                        </span>
                      </label>
                      <div className="flex items-center gap-2">
                        <ProbeBadge result={server.lastProbe} />
                        <button
                          type="button"
                          title="删除"
                          aria-label="删除"
                          onClick={() => removeServer(server.id)}
                          className="flex h-7 w-7 items-center justify-center rounded border border-border-soft bg-bg-alt text-fg-faint hover:border-red-400 hover:text-red-300"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    {server.description ? (
                      <div className="text-xs text-fg-faint">{server.description}</div>
                    ) : null}
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                      <SettingsRow label="命令">
                        <input
                          id={commandId}
                          value={server.command ?? ''}
                          onChange={(event: ChangeEvent<HTMLInputElement>) =>
                            updateServer(server.id, { command: event.currentTarget.value })
                          }
                          className="w-full rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-accent"
                        />
                      </SettingsRow>
                      <SettingsRow label="参数" hint="空格分隔；工作区可用 {workspace}">
                        <input
                          id={argsId}
                          value={server.args.join(' ')}
                          onChange={(event: ChangeEvent<HTMLInputElement>) =>
                            updateServer(server.id, {
                              args: event.currentTarget.value
                                .split(' ')
                                .map((item) => item.trim())
                                .filter(Boolean),
                            })
                          }
                          className="w-full rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-accent"
                        />
                      </SettingsRow>
                    </div>
                    <div className="text-[11px] text-fg-faint">
                      最近探测：{formatTime(server.lastProbe?.checkedAtMs)}
                      {server.lastProbe ? ` · ${server.lastProbe.message}` : ''}
                    </div>
                  </section>
                );
              })
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={probeEnabledServers}
              disabled={probing || saving}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-alt px-3 py-1.5 text-xs text-fg-dim hover:border-accent hover:text-fg disabled:opacity-50"
            >
              <Terminal size={13} />
              {probing ? '探测中...' : '探测已启用 MCP'}
            </button>
          </div>
        </div>
      );
    }

    if (tab === 'skills') {
      const enabledRootIds = new Set(settings.skills.enabledRootIds);
      return (
        <div className="grid gap-4">
          <div className="grid gap-3">
            {(scan?.skillRoots ?? []).map((root) => (
              <section
                key={root.id}
                className="rounded-md border border-border bg-panel-2 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={enabledRootIds.has(root.id)}
                      onChange={(event) => {
                        const next = new Set(enabledRootIds);
                        if (event.currentTarget.checked) next.add(root.id);
                        else next.delete(root.id);
                        updateSkills({ enabledRootIds: [...next] });
                      }}
                      className="h-4 w-4 accent-accent"
                    />
                    <span className="text-sm font-semibold text-fg">{root.label}</span>
                  </label>
                  <span
                    className={cn(
                      'rounded border px-2 py-0.5 text-[11px]',
                      root.exists
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-border-soft bg-bg-alt text-fg-faint',
                    )}
                  >
                    {root.exists ? `${root.skillCount} 个` : '未创建'}
                  </span>
                </div>
                <div className="mt-2 truncate font-mono text-[11px] text-fg-faint" title={root.path}>
                  {root.path}
                </div>
                {root.skills.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {root.skills.map((skill) => (
                      <span
                        key={skill}
                        className="rounded border border-border-soft bg-bg-alt px-2 py-0.5 text-[11px] text-fg-dim"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                ) : null}
              </section>
            ))}
          </div>
          <div className="rounded-md border border-border-soft bg-bg-alt p-3 text-xs text-fg-faint">
            当前引擎：{scan?.engine.label ?? '未识别'}；推荐 Skill 会跟随项目配置保存。
          </div>
        </div>
      );
    }

    return (
      <div className="grid gap-3">
        <ToggleRow
          label="自动检测项目类型"
          checked={settings.automation.autoDetect}
          onChange={(checked) => updateAutomation({ autoDetect: checked })}
        />
        <ToggleRow
          label="自动写入推荐 MCP 配置"
          hint="只写项目配置，不安装第三方依赖。"
          checked={settings.automation.autoConfigureRecommendedMcp}
          onChange={(checked) =>
            updateAutomation({ autoConfigureRecommendedMcp: checked })
          }
        />
        <ToggleRow
          label="允许自动启动项目 MCP"
          checked={settings.automation.autoStartMcp}
          onChange={(checked) => updateAutomation({ autoStartMcp: checked })}
        />
        <ToggleRow
          label="允许第三方依赖安装"
          hint="涉及 npm、uvx、插件安装时仍需确认。"
          checked={settings.automation.allowThirdPartyInstall}
          onChange={(checked) =>
            updateAutomation({ allowThirdPartyInstall: checked })
          }
        />
      </div>
    );
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-settings-title"
        className="flex h-[min(840px,calc(100vh-2rem))] w-[min(1080px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shrink-0 border-b border-border-soft bg-bg-alt px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-bg">
              <SettingsIcon size={18} strokeWidth={2.2} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="project-settings-title" className="truncate text-base font-semibold text-fg">
                项目设置 · {record?.name ?? workspace.name}
              </h2>
              <p className="mt-1 truncate text-xs text-fg-faint" title={workspacePath}>
                {workspacePath || '未指定工作区'}
              </p>
            </div>
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              title="重新检测"
              aria-label="重新检测"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-panel-2 text-fg-faint transition-colors hover:border-accent hover:text-fg disabled:opacity-50"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : undefined} />
            </button>
            <button
              type="button"
              onClick={onClose}
              title="关闭"
              aria-label="关闭"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-panel-2 text-fg-faint transition-colors hover:border-accent hover:text-fg"
            >
              <X size={15} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex flex-1 flex-col bg-border-soft sm:flex-row">
          <nav className="w-full shrink-0 overflow-y-auto border-b border-border-soft bg-bg-alt p-3 sm:w-52 sm:border-b-0 sm:border-r">
            <div role="tablist" aria-orientation="vertical" className="grid gap-1">
              {tabs.map((item) => {
                const active = item.id === tab;
                const Icon = item.Icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTab(item.id)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-left text-sm font-medium transition-colors',
                      active
                        ? 'border-accent bg-accent/15 text-fg'
                        : 'border-transparent text-fg-dim hover:bg-border-soft hover:text-fg',
                    )}
                  >
                    <Icon size={15} className={active ? 'text-accent' : 'text-fg-faint'} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>

          <main className="min-h-0 flex-1 overflow-y-auto bg-panel p-4 sm:p-5">
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm text-fg-faint">
                检测中...
              </div>
            ) : (
              content
            )}
          </main>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft bg-bg-alt px-5 py-3">
          <div className="min-w-0 flex-1 truncate text-xs text-fg-faint">
            {status ?? (dirty ? '有未保存修改' : '配置已同步')}
          </div>
          <div className="flex flex-wrap gap-2">
            {workspacePath ? (
              <button
                type="button"
                onClick={() => void openLocalPath(workspacePath, { reveal: true })}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-panel-2 px-3 py-1.5 text-xs text-fg-dim hover:border-accent hover:text-fg"
              >
                <FileText size={13} />
                打开位置
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void persistSettings(settings)}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-1.5 rounded-md border border-accent bg-accent/15 px-3 py-1.5 text-xs font-semibold text-fg hover:bg-accent/25 disabled:border-border disabled:bg-panel-2 disabled:text-fg-faint"
            >
              <Check size={13} />
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
