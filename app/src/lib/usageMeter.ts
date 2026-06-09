import type { GatewaySelection } from '@/core/ir';
import { estimateTokenCount } from '@/lib/contextUsage';
import type { ResolvedGatewayRoute } from '@/lib/modelGateway/types';

export interface ModelUsageReport {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface UsageMeterCall {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  cachePercent: number;
  estimated: boolean;
  providerLabel: string;
  modelLabel: string;
  updatedAt: number;
}

export interface UsageMeterSnapshot {
  version: 1;
  totals: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens: number;
  };
  lastCall: UsageMeterCall;
}

export interface UsageMeterContext {
  workspaceId?: string | null;
  sessionId?: string | null;
}

type UsageRoute = Partial<
  Pick<
    ResolvedGatewayRoute,
    | 'selection'
    | 'baseUrl'
    | 'model'
    | 'providerName'
    | 'channelName'
    | 'label'
  >
> & {
  selection?: GatewaySelection;
};

const LEGACY_USAGE_STORAGE_KEY = 'fuc_usage_meter_v1';
const USAGE_STORAGE_KEY = 'fuc_usage_meter_by_session_v1';
const USAGE_GLOBAL_CONTEXT_KEY = '__global__';
const USAGE_DEFAULT_WORKSPACE_KEY = '__default_workspace__';
const USAGE_CHANGE_EVENT = 'fuc:usage-meter-changed';

const ZERO_CALL: UsageMeterCall = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  cachePercent: 0,
  estimated: true,
  providerLabel: '',
  modelLabel: '',
  updatedAt: 0,
};

const EMPTY_SNAPSHOT: UsageMeterSnapshot = {
  version: 1,
  totals: {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
  },
  lastCall: ZERO_CALL,
};

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function emitChange(eventName: string): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(eventName));
    }
  } catch {
    /* ignore */
  }
}

function numberFrom(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function cleanUsage(report: ModelUsageReport): Required<ModelUsageReport> {
  const inputTokens = Math.round(report.inputTokens ?? 0);
  const outputTokens = Math.round(report.outputTokens ?? 0);
  const totalTokens = Math.round(report.totalTokens ?? inputTokens + outputTokens);
  return {
    inputTokens: Math.max(0, inputTokens),
    outputTokens: Math.max(0, outputTokens),
    totalTokens: Math.max(0, totalTokens),
    cacheReadInputTokens: Math.max(0, Math.round(report.cacheReadInputTokens ?? 0)),
    cacheCreationInputTokens: Math.max(
      0,
      Math.round(report.cacheCreationInputTokens ?? 0),
    ),
  };
}

function parseSnapshot(value: unknown): UsageMeterSnapshot {
  if (typeof value !== 'object' || value === null) return EMPTY_SNAPSHOT;
  const raw = value as Partial<UsageMeterSnapshot>;
  const totals = raw.totals ?? EMPTY_SNAPSHOT.totals;
  const last = raw.lastCall ?? ZERO_CALL;
  return {
    version: 1,
    totals: {
      calls: numberFrom(totals.calls) ?? 0,
      inputTokens: numberFrom(totals.inputTokens) ?? 0,
      outputTokens: numberFrom(totals.outputTokens) ?? 0,
      totalTokens: numberFrom(totals.totalTokens) ?? 0,
      cachedInputTokens: numberFrom(totals.cachedInputTokens) ?? 0,
    },
    lastCall: {
      inputTokens: numberFrom(last.inputTokens) ?? 0,
      outputTokens: numberFrom(last.outputTokens) ?? 0,
      totalTokens: numberFrom(last.totalTokens) ?? 0,
      cachedInputTokens: numberFrom(last.cachedInputTokens) ?? 0,
      cacheCreationInputTokens: numberFrom(last.cacheCreationInputTokens) ?? 0,
      cachePercent: numberFrom(last.cachePercent) ?? 0,
      estimated: last.estimated !== false,
      providerLabel: typeof last.providerLabel === 'string' ? last.providerLabel : '',
      modelLabel: typeof last.modelLabel === 'string' ? last.modelLabel : '',
      updatedAt: numberFrom(last.updatedAt) ?? 0,
    },
  };
}

function usageContextKey(context?: UsageMeterContext): string {
  const sessionId = context?.sessionId?.trim();
  if (!sessionId) return USAGE_GLOBAL_CONTEXT_KEY;
  const workspaceId =
    context?.workspaceId?.trim() || USAGE_DEFAULT_WORKSPACE_KEY;
  return `${workspaceId}:${sessionId}`;
}

function readUsageSnapshotMap(): Record<string, UsageMeterSnapshot> {
  const raw = storage()?.getItem(USAGE_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
        key,
        parseSnapshot(value),
      ]),
    );
  } catch {
    return {};
  }
}

function readLegacyUsageSnapshot(): UsageMeterSnapshot | null {
  const raw = storage()?.getItem(LEGACY_USAGE_STORAGE_KEY);
  if (!raw) return null;
  try {
    return parseSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

function saveUsageSnapshot(
  snapshot: UsageMeterSnapshot,
  context?: UsageMeterContext,
): void {
  const store = storage();
  if (!store) return;
  try {
    const map = readUsageSnapshotMap();
    map[usageContextKey(context)] = snapshot;
    store.setItem(USAGE_STORAGE_KEY, JSON.stringify(map));
    emitChange(USAGE_CHANGE_EVENT);
  } catch {
    /* ignore quota/private mode */
  }
}

export function readUsageMeterSnapshot(
  context?: UsageMeterContext,
): UsageMeterSnapshot {
  const key = usageContextKey(context);
  const snapshot = readUsageSnapshotMap()[key];
  if (snapshot) return snapshot;
  if (key === USAGE_GLOBAL_CONTEXT_KEY) {
    return readLegacyUsageSnapshot() ?? EMPTY_SNAPSHOT;
  }
  return EMPTY_SNAPSHOT;
}

export function subscribeUsageMeter(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === USAGE_STORAGE_KEY ||
      event.key === LEGACY_USAGE_STORAGE_KEY
    ) {
      listener();
    }
  };
  window.addEventListener(USAGE_CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(USAGE_CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function mergeUsageReports(
  current: ModelUsageReport | null | undefined,
  next: ModelUsageReport | null | undefined,
): ModelUsageReport | null {
  if (!next) return current ?? null;
  if (!current) return next;
  return {
    inputTokens: next.inputTokens ?? current.inputTokens,
    outputTokens: next.outputTokens ?? current.outputTokens,
    totalTokens: next.totalTokens ?? current.totalTokens,
    cacheReadInputTokens:
      next.cacheReadInputTokens ?? current.cacheReadInputTokens,
    cacheCreationInputTokens:
      next.cacheCreationInputTokens ?? current.cacheCreationInputTokens,
  };
}

export function usageReportFromOpenAI(value: unknown): ModelUsageReport | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const promptDetails =
    typeof raw.prompt_tokens_details === 'object' &&
    raw.prompt_tokens_details !== null
      ? (raw.prompt_tokens_details as Record<string, unknown>)
      : {};
  const inputDetails =
    typeof raw.input_tokens_details === 'object' &&
    raw.input_tokens_details !== null
      ? (raw.input_tokens_details as Record<string, unknown>)
      : {};
  const report: ModelUsageReport = {
    inputTokens: numberFrom(raw.prompt_tokens) ?? numberFrom(raw.input_tokens),
    outputTokens:
      numberFrom(raw.completion_tokens) ?? numberFrom(raw.output_tokens),
    totalTokens: numberFrom(raw.total_tokens),
    cacheReadInputTokens:
      numberFrom(promptDetails.cached_tokens) ??
      numberFrom(inputDetails.cached_tokens) ??
      numberFrom(promptDetails.cache_read_input_tokens) ??
      numberFrom(raw.cache_read_input_tokens),
    cacheCreationInputTokens: numberFrom(raw.cache_creation_input_tokens),
  };
  return Object.values(report).some((item) => item !== undefined) ? report : null;
}

export function usageReportFromCodex(value: unknown): ModelUsageReport | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const inputTokens =
    numberFrom(raw.input_tokens) ?? numberFrom(raw.inputTokens);
  const outputTokens =
    numberFrom(raw.output_tokens) ?? numberFrom(raw.outputTokens);
  const report: ModelUsageReport = {
    inputTokens,
    outputTokens,
    totalTokens:
      numberFrom(raw.total_tokens) ??
      numberFrom(raw.totalTokens) ??
      (inputTokens !== undefined || outputTokens !== undefined
        ? (inputTokens ?? 0) + (outputTokens ?? 0)
        : undefined),
    cacheReadInputTokens:
      numberFrom(raw.cached_input_tokens) ??
      numberFrom(raw.cachedInputTokens) ??
      numberFrom(raw.cache_read_input_tokens),
    cacheCreationInputTokens:
      numberFrom(raw.cache_creation_input_tokens) ??
      numberFrom(raw.cacheCreationInputTokens),
  };
  return Object.values(report).some((item) => item !== undefined) ? report : null;
}

export function usageReportFromAnthropic(value: unknown): ModelUsageReport | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const report: ModelUsageReport = {
    inputTokens: numberFrom(raw.input_tokens),
    outputTokens: numberFrom(raw.output_tokens),
    cacheReadInputTokens:
      numberFrom(raw.cache_read_input_tokens) ?? numberFrom(raw.cache_read_tokens),
    cacheCreationInputTokens:
      numberFrom(raw.cache_creation_input_tokens) ??
      numberFrom(raw.cache_creation_tokens),
  };
  const input = report.inputTokens ?? 0;
  const output = report.outputTokens ?? 0;
  if (input || output) report.totalTokens = input + output;
  return Object.values(report).some((item) => item !== undefined) ? report : null;
}

export function estimateUsageForText(
  inputText: string,
  outputText: string,
): ModelUsageReport {
  const inputTokens = estimateTokenCount(inputText);
  const outputTokens = estimateTokenCount(outputText);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

export function estimateGatewayUsage(
  system: string,
  userContent: string,
  outputText: string,
): ModelUsageReport {
  const input = [system, userContent].filter((part) => part.trim()).join('\n\n');
  return estimateUsageForText(input, outputText);
}

function providerLabel(route: UsageRoute): string {
  return route.providerName || route.channelName || route.selection?.adapter || '';
}

function modelLabel(route: UsageRoute): string {
  return route.model || route.selection?.modelOverride || route.selection?.modelClass || '';
}

export function recordModelUsageForRoute(
  route: UsageRoute,
  report: ModelUsageReport,
  options: { estimated?: boolean; context?: UsageMeterContext } = {},
): UsageMeterSnapshot {
  const usage = cleanUsage(report);
  const cachedInputTokens = Math.min(
    usage.inputTokens,
    usage.cacheReadInputTokens + usage.cacheCreationInputTokens,
  );
  const updatedAt = Date.now();
  const call: UsageMeterCall = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    cachePercent:
      usage.inputTokens > 0 ? (cachedInputTokens / usage.inputTokens) * 100 : 0,
    estimated: options.estimated === true,
    providerLabel: providerLabel(route),
    modelLabel: modelLabel(route),
    updatedAt,
  };
  const current = readUsageMeterSnapshot(options.context);
  const next: UsageMeterSnapshot = {
    version: 1,
    totals: {
      calls: current.totals.calls + 1,
      inputTokens: current.totals.inputTokens + call.inputTokens,
      outputTokens: current.totals.outputTokens + call.outputTokens,
      totalTokens: current.totals.totalTokens + call.totalTokens,
      cachedInputTokens: current.totals.cachedInputTokens + call.cachedInputTokens,
    },
    lastCall: call,
  };
  saveUsageSnapshot(next, options.context);
  return next;
}

export function recordEstimatedModelUsageForSelection(
  selection: GatewaySelection,
  prompt: string,
  outputText: string,
  route: Omit<UsageRoute, 'selection'> = {},
  options: { context?: UsageMeterContext } = {},
): UsageMeterSnapshot {
  return recordModelUsageForRoute(
    { ...route, selection },
    estimateUsageForText(prompt, outputText),
    { estimated: true, context: options.context },
  );
}
