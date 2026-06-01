/**
 * Typed facade over the consensus / multi-angle / voting tunables. These are the
 * same localStorage keys the run engine, the generation-consensus path, and the
 * heuristics already read — centralised here so the Settings UI and the consumers
 * stay in sync. All values are clamped to safe ranges on read and write.
 */

export interface ConsensusSettings {
  /** Generation-time consensus on/off (owf_gen_consensus). */
  genEnabled: boolean;
  /** Candidate blueprints generated per complex request (owf_gen_candidates). */
  genCandidates: number;
  /** Default fan-out / sample count for a consensus node (owf_consensus_default_samples). */
  voteSamples: number;
  /** Show the "convert to consensus" suggestion on complex agent nodes (owf_consensus_autosuggest). */
  autoSuggest: boolean;
  /** Max independent calls run at once — also caps consensus fan-out (owf_run_concurrency). */
  concurrency: number;
  /** Max concurrent calls after a route is classified as slow. */
  slowConcurrency: number;
  /** Max concurrent calls after a route is classified as standard speed. */
  standardConcurrency: number;
  /** Max concurrent calls after a route is classified as fast. */
  fastConcurrency: number;
}

export const CONSENSUS_LIMITS = {
  genCandidates: { min: 2, max: 5, def: 3 },
  voteSamples: { min: 2, max: 7, def: 3 },
  concurrency: { min: 1, max: 16, def: 10 },
  slowConcurrency: { min: 1, max: 16, def: 4 },
  standardConcurrency: { min: 1, max: 16, def: 5 },
  fastConcurrency: { min: 1, max: 16, def: 10 },
} as const;

const KEYS = {
  genEnabled: 'owf_gen_consensus',
  genCandidates: 'owf_gen_candidates',
  voteSamples: 'owf_consensus_default_samples',
  autoSuggest: 'owf_consensus_autosuggest',
  concurrency: 'owf_run_concurrency',
  slowConcurrency: 'owf_run_concurrency_slow',
  standardConcurrency: 'owf_run_concurrency_standard',
  fastConcurrency: 'owf_run_concurrency_fast',
} as const;

/** Fired after any consensus setting changes, so open UI / consumers can refresh. */
export const CONSENSUS_SETTINGS_EVENT = 'owf:consensus-settings-changed';

function ls(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readBool(key: string, def: boolean): boolean {
  const raw = ls()?.getItem(key);
  if (raw == null) return def;
  return raw !== '0';
}

function readInt(key: string, lim: { min: number; max: number; def: number }): number {
  const raw = ls()?.getItem(key);
  if (raw == null) return lim.def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return lim.def;
  return Math.min(lim.max, Math.max(lim.min, n));
}

export function getConsensusSettings(): ConsensusSettings {
  return {
    genEnabled: readBool(KEYS.genEnabled, true),
    genCandidates: readInt(KEYS.genCandidates, CONSENSUS_LIMITS.genCandidates),
    voteSamples: readInt(KEYS.voteSamples, CONSENSUS_LIMITS.voteSamples),
    autoSuggest: readBool(KEYS.autoSuggest, true),
    concurrency: readInt(KEYS.concurrency, CONSENSUS_LIMITS.concurrency),
    slowConcurrency: readInt(
      KEYS.slowConcurrency,
      CONSENSUS_LIMITS.slowConcurrency,
    ),
    standardConcurrency: readInt(
      KEYS.standardConcurrency,
      CONSENSUS_LIMITS.standardConcurrency,
    ),
    fastConcurrency: readInt(
      KEYS.fastConcurrency,
      CONSENSUS_LIMITS.fastConcurrency,
    ),
  };
}

/** Generation candidate count, clamped (used by the AI-改图 consensus path). */
export function genCandidateCount(): number {
  return readInt(KEYS.genCandidates, CONSENSUS_LIMITS.genCandidates);
}

/** Whether the convert-to-consensus suggestion chip is enabled. */
export function autoSuggestEnabled(): boolean {
  return readBool(KEYS.autoSuggest, true);
}

function limitsForSetting(key: keyof ConsensusSettings): {
  min: number;
  max: number;
  def: number;
} {
  return key === 'genCandidates'
    ? CONSENSUS_LIMITS.genCandidates
    : key === 'voteSamples'
      ? CONSENSUS_LIMITS.voteSamples
      : key === 'slowConcurrency'
        ? CONSENSUS_LIMITS.slowConcurrency
        : key === 'standardConcurrency'
          ? CONSENSUS_LIMITS.standardConcurrency
          : key === 'fastConcurrency'
            ? CONSENSUS_LIMITS.fastConcurrency
            : CONSENSUS_LIMITS.concurrency;
}

export function runConcurrencyCapForTier(
  tier: 'slow' | 'standard' | 'fast',
): number {
  const key =
    tier === 'slow'
      ? 'slowConcurrency'
      : tier === 'standard'
        ? 'standardConcurrency'
        : 'fastConcurrency';
  return readInt(KEYS[key], CONSENSUS_LIMITS[key]);
}

export function setConsensusSetting<K extends keyof ConsensusSettings>(
  key: K,
  value: ConsensusSettings[K],
): void {
  const store = ls();
  if (!store) return;
  if (key === 'genEnabled' || key === 'autoSuggest') {
    store.setItem(KEYS[key], value ? '1' : '0');
  } else {
    const lim = limitsForSetting(key);
    const n = Math.min(lim.max, Math.max(lim.min, Math.floor(value as number) || lim.def));
    store.setItem(KEYS[key], String(n));
  }
  try {
    window.dispatchEvent(new CustomEvent(CONSENSUS_SETTINGS_EVENT));
  } catch {
    /* ignore */
  }
}
