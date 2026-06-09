import type {
  ProjectEngineKind,
  ProjectEnvironmentScan,
  ProjectMcpProbeResult,
  ProjectMcpServerSuggestion,
} from '@/lib/tauri';
import type { HistoryMetadata, WorkspaceSummary } from '@/store/history/types';

export const PROJECT_SETTINGS_METADATA_KEY = 'projectSettings';
export const PROJECT_SETTINGS_SCHEMA_VERSION = 1;

export type ProjectMcpTransport = 'stdio' | 'streamable-http' | string;
export type ProjectMcpServerSource = 'suggested' | 'custom';

export interface ProjectMcpServerConfig {
  id: string;
  label: string;
  description?: string;
  source: ProjectMcpServerSource;
  enabled: boolean;
  transport: ProjectMcpTransport;
  command?: string;
  args: string[];
  env: Record<string, string>;
  url?: string;
  requiresUserApproval?: boolean;
  lastProbe?: ProjectMcpProbeResult;
}

export interface ProjectSkillSettings {
  enabledRootIds: string[];
  disabledSkillNames: string[];
  recommendedSkillIds: string[];
}

export type ProjectGameExpertEngine = 'auto' | 'unity' | 'unreal' | 'godot';

export interface ProjectGameFeatureSettings {
  meshGeneration: boolean;
  rigging: boolean;
  gameExperts: boolean;
  gameExpertEngine: ProjectGameExpertEngine;
}

export interface ProjectAutomationSettings {
  autoDetect: boolean;
  autoConfigureRecommendedMcp: boolean;
  autoStartMcp: boolean;
  allowThirdPartyInstall: boolean;
}

export interface ProjectSettings {
  schemaVersion: 1;
  engine: ProjectEngineKind | 'auto';
  mcp: {
    enabled: boolean;
    servers: ProjectMcpServerConfig[];
  };
  skills: ProjectSkillSettings;
  gameFeatures: ProjectGameFeatureSettings;
  automation: ProjectAutomationSettings;
  updatedAt?: string;
}

export type ProjectHealthTone =
  | 'none'
  | 'detected'
  | 'configured'
  | 'connected'
  | 'failed';

export interface ProjectHealth {
  tone: ProjectHealthTone;
  label: string;
  detail: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function isProjectGameExpertEngine(value: unknown): value is ProjectGameExpertEngine {
  return value === 'unity' || value === 'unreal' || value === 'godot' || value === 'auto';
}

export function isGameProjectEngine(
  engine: ProjectEngineKind | 'auto',
): engine is Extract<ProjectEngineKind, 'unreal' | 'unity' | 'godot'> {
  return engine === 'unreal' || engine === 'unity' || engine === 'godot';
}

export function gameFeatureDefaultsForEngine(
  engine: ProjectEngineKind | 'auto',
): ProjectGameFeatureSettings {
  const enabled = isGameProjectEngine(engine);
  return {
    meshGeneration: enabled,
    rigging: enabled,
    gameExperts: enabled,
    gameExpertEngine: enabled ? engine : 'auto',
  };
}

function normalizeServer(value: unknown): ProjectMcpServerConfig | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  if (!id) return null;
  return {
    id,
    label:
      typeof value.label === 'string' && value.label.trim()
        ? value.label.trim()
        : id,
    description:
      typeof value.description === 'string' ? value.description : undefined,
    source: value.source === 'custom' ? 'custom' : 'suggested',
    enabled: value.enabled === true,
    transport:
      typeof value.transport === 'string' && value.transport.trim()
        ? value.transport.trim()
        : 'stdio',
    command: typeof value.command === 'string' ? value.command : undefined,
    args: stringArray(value.args),
    env: stringMap(value.env),
    url: typeof value.url === 'string' ? value.url : undefined,
    requiresUserApproval: value.requiresUserApproval === true,
    lastProbe: isRecord(value.lastProbe)
      ? (value.lastProbe as unknown as ProjectMcpProbeResult)
      : undefined,
  };
}

export function emptyProjectSettings(): ProjectSettings {
  return {
    schemaVersion: PROJECT_SETTINGS_SCHEMA_VERSION,
    engine: 'auto',
    mcp: {
      enabled: true,
      servers: [],
    },
    skills: {
      enabledRootIds: ['codex', 'agents', 'claude'],
      disabledSkillNames: [],
      recommendedSkillIds: [],
    },
    gameFeatures: gameFeatureDefaultsForEngine('unknown'),
    automation: {
      autoDetect: true,
      autoConfigureRecommendedMcp: false,
      autoStartMcp: false,
      allowThirdPartyInstall: false,
    },
  };
}

export function projectSettingsFromMetadata(
  metadata?: HistoryMetadata,
): ProjectSettings {
  const defaults = emptyProjectSettings();
  const raw = metadata?.[PROJECT_SETTINGS_METADATA_KEY];
  if (!isRecord(raw)) return defaults;
  const mcp = isRecord(raw.mcp) ? raw.mcp : {};
  const skills = isRecord(raw.skills) ? raw.skills : {};
  const gameFeatures = isRecord(raw.gameFeatures) ? raw.gameFeatures : {};
  const automation = isRecord(raw.automation) ? raw.automation : {};
  return {
    schemaVersion: PROJECT_SETTINGS_SCHEMA_VERSION,
    engine:
      raw.engine === 'unreal' ||
      raw.engine === 'unity' ||
      raw.engine === 'godot' ||
      raw.engine === 'unknown'
        ? raw.engine
        : 'auto',
    mcp: {
      enabled: mcp.enabled !== false,
      servers: Array.isArray(mcp.servers)
        ? mcp.servers
            .map(normalizeServer)
            .filter((server): server is ProjectMcpServerConfig => server != null)
        : [],
    },
    skills: {
      enabledRootIds: stringArray(skills.enabledRootIds).length
        ? stringArray(skills.enabledRootIds)
        : defaults.skills.enabledRootIds,
      disabledSkillNames: stringArray(skills.disabledSkillNames),
      recommendedSkillIds: stringArray(skills.recommendedSkillIds),
    },
    gameFeatures: {
      meshGeneration: gameFeatures.meshGeneration === true,
      rigging: gameFeatures.rigging === true,
      gameExperts: gameFeatures.gameExperts === true,
      gameExpertEngine: isProjectGameExpertEngine(gameFeatures.gameExpertEngine)
        ? gameFeatures.gameExpertEngine
        : defaults.gameFeatures.gameExpertEngine,
    },
    automation: {
      autoDetect: automation.autoDetect !== false,
      autoConfigureRecommendedMcp:
        automation.autoConfigureRecommendedMcp === true,
      autoStartMcp: automation.autoStartMcp === true,
      allowThirdPartyInstall: automation.allowThirdPartyInstall === true,
    },
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
  };
}

export function projectSettingsPatch(
  settings: ProjectSettings,
): HistoryMetadata {
  return {
    [PROJECT_SETTINGS_METADATA_KEY]: {
      ...settings,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function serverFromSuggestion(
  suggestion: ProjectMcpServerSuggestion,
): ProjectMcpServerConfig {
  return {
    id: suggestion.id,
    label: suggestion.label,
    description: suggestion.description,
    source: 'suggested',
    enabled: true,
    transport: suggestion.transport,
    command: suggestion.command,
    args: suggestion.args,
    env: suggestion.env,
    requiresUserApproval: suggestion.requiresUserApproval,
  };
}

export function mergeRecommendedMcpServers(
  settings: ProjectSettings,
  scan: ProjectEnvironmentScan,
): ProjectSettings {
  const existingIds = new Set(settings.mcp.servers.map((server) => server.id));
  const additions = scan.suggestedMcpServers
    .filter((server) => !existingIds.has(server.id))
    .map(serverFromSuggestion);
  const next = {
    ...settings,
    engine: scan.engine.engine,
    mcp: {
      ...settings.mcp,
      enabled: true,
      servers: [...settings.mcp.servers, ...additions],
    },
  };
  return settingsWithDetectedGameFeatures(next, scan);
}

export function settingsWithDetectedGameFeatures(
  settings: ProjectSettings,
  scan: Pick<ProjectEnvironmentScan, 'engine'>,
): ProjectSettings {
  if (!settings.automation.autoDetect) return settings;
  return {
    ...settings,
    engine: scan.engine.engine,
    gameFeatures: gameFeatureDefaultsForEngine(scan.engine.engine),
  };
}

export function projectEngineLabel(engine: ProjectEngineKind | 'auto'): string {
  switch (engine) {
    case 'unreal':
      return 'Unreal Engine';
    case 'unity':
      return 'Unity';
    case 'godot':
      return 'Godot';
    case 'unknown':
      return '未识别';
    default:
      return '自动';
  }
}

export function projectHealth(
  workspace: WorkspaceSummary,
  scan?: ProjectEnvironmentScan | null,
): ProjectHealth {
  const settings = projectSettingsFromMetadata(workspace.metadata);
  const enabledServers = settings.mcp.enabled
    ? settings.mcp.servers.filter((server) => server.enabled)
    : [];
  const connected = enabledServers.find((server) => server.lastProbe?.ok);
  if (connected) {
    return {
      tone: 'connected',
      label: 'MCP 已连接',
      detail: `${connected.label}：${connected.lastProbe?.message ?? ''}`,
    };
  }
  const failed = enabledServers.find((server) => server.lastProbe && !server.lastProbe.ok);
  if (failed) {
    return {
      tone: 'failed',
      label: 'MCP 失败',
      detail: `${failed.label}：${failed.lastProbe?.message ?? ''}`,
    };
  }
  if (enabledServers.length > 0) {
    return {
      tone: 'configured',
      label: 'MCP 已配置',
      detail: `${enabledServers.length} 个项目 MCP server 待探测`,
    };
  }
  if (scan?.engine.engine && scan.engine.engine !== 'unknown') {
    return {
      tone: 'detected',
      label: `检测到 ${scan.engine.label}`,
      detail: '可在项目设置里应用推荐 MCP 配置',
    };
  }
  return {
    tone: 'none',
    label: '无项目 MCP',
    detail: '未识别 UE / Unity / Godot 项目',
  };
}
