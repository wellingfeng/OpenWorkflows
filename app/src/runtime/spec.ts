/**
 * CONTRACT: coerce node params into run specs + per-spec gateway overrides.
 * Moved from store/useStore.ts (`specList` / `runSpecGatewayOverride` /
 * `consensusStrategy` / `clampSamples`). Gateway-override resolution is delegated
 * to the injected {@link RunGateway} so the engine stays pure.
 */
import type { ConsensusStrategy, NodeGatewayOverride } from '../core/ir';
import type { RunGateway, RunSpec } from './types';

/** Coerce a params array into RunSpec[] (objects or legacy string[]). */
export function specList(value: unknown, gateway: RunGateway): RunSpec[] {
  if (!Array.isArray(value)) return [];
  return value.map((v): RunSpec => {
    if (typeof v === 'string') return { prompt: v };
    const o = (v ?? {}) as Record<string, unknown>;
    return {
      prompt: String(o.prompt ?? ''),
      label: typeof o.label === 'string' ? o.label : undefined,
      agentType: typeof o.agentType === 'string' ? o.agentType : undefined,
      model: typeof o.model === 'string' ? o.model : undefined,
      gateway: gateway.nodeGatewayOverride(o),
    };
  });
}

export function runSpecGatewayOverride(
  spec: RunSpec,
  gateway: RunGateway,
): NodeGatewayOverride | undefined {
  const override = spec.gateway ? { ...spec.gateway } : undefined;
  if (override?.modelClass) return override;
  if (!spec.model) return override;
  return {
    ...(override ?? {}),
    modelClass: gateway.modelClassFromModelId(spec.model),
  };
}

/** Coerce an arbitrary value into a known ConsensusStrategy (default multi-lens). */
export function consensusStrategy(value: unknown): ConsensusStrategy {
  return value === 'adversarial' ||
    value === 'tournament' ||
    value === 'self-consistency'
    ? value
    : 'multi-lens';
}

/** Clamp a consensus samples value to the supported 2..7 range. */
export function clampSamples(value: unknown, fallback: number): number {
  const n =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.floor(value)
      : fallback;
  return Math.min(7, Math.max(2, n || 3));
}
