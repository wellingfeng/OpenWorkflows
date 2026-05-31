import type { CSSProperties } from 'react';
import type { NodeRunState } from '@/store/types';

/**
 * Shared visual language for per-node run state on the blueprint canvas.
 *
 * Status palette (design doc · runtime visualization):
 *   - idle:    default border, no badge (visually transparent).
 *   - running: amber border with a soft pulse + ◐ badge.
 *   - success: green border + ✓ badge.
 *   - error:   red border + ✕ badge.
 *   - interrupted: muted red border + ! badge.
 *
 * Returning `null` for idle lets callers skip badge rendering entirely while
 * keeping their own selection/type-accent border intact.
 */

export interface RunStateVisual {
  /** Border color override; merge with selection accent at the call site. */
  borderColor: string;
  /** Optional outer ring used for the running pulse. */
  boxShadow?: string;
  /** Glyph rendered inside the corner badge. */
  badge: string;
  /** Tailwind-compatible CSS for the badge chip. */
  badgeStyle: CSSProperties;
  /** Optional CSS animation name applied to the wrapper for `running`. */
  animation?: string;
}

/** Tokens — keep in sync with src/styles/global.css design tokens. */
const COLORS = {
  running: 'var(--status-running)',
  runningContrast: 'var(--status-running-contrast)',
  success: 'var(--status-success)',
  successContrast: 'var(--status-success-contrast)',
  error: 'var(--status-error)',
  errorContrast: 'var(--status-error-contrast)',
  interrupted: 'var(--status-interrupted)',
  interruptedContrast: 'var(--status-interrupted-contrast)',
} as const;

/**
 * Map a run state to its visual chrome. Returns `null` for `idle` / undefined
 * so callers can short-circuit cheaply.
 */
export function runStateVisual(
  state: NodeRunState | undefined,
): RunStateVisual | null {
  if (!state || state === 'idle') return null;
  if (state === 'running') {
    return {
      borderColor: COLORS.running,
      boxShadow: `0 0 0 2px ${COLORS.running}`,
      badge: '◐',
      badgeStyle: {
        background: COLORS.running,
        color: COLORS.runningContrast,
        animation: 'omc-pulse 1.1s ease-in-out infinite',
      },
      animation: 'omc-pulse 1.1s ease-in-out infinite',
    };
  }
  if (state === 'success') {
    return {
      borderColor: COLORS.success,
      boxShadow: `0 0 0 1px ${COLORS.success}`,
      badge: '✓',
      badgeStyle: {
        background: COLORS.success,
        color: COLORS.successContrast,
      },
    };
  }
  if (state === 'interrupted') {
    return {
      borderColor: COLORS.interrupted,
      boxShadow: `0 0 0 1px ${COLORS.interrupted}`,
      badge: '!',
      badgeStyle: {
        background: COLORS.interrupted,
        color: COLORS.interruptedContrast,
      },
    };
  }
  // error
  return {
    borderColor: COLORS.error,
    boxShadow: `0 0 0 1px ${COLORS.error}`,
    badge: '✕',
    badgeStyle: {
      background: COLORS.error,
      color: COLORS.errorContrast,
    },
  };
}

/** Common style for the corner badge — small chip at the top-right. */
export const BADGE_BASE_STYLE: CSSProperties = {
  position: 'absolute',
  top: -8,
  right: -8,
  width: 18,
  height: 18,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '50%',
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1,
  pointerEvents: 'none',
  boxShadow: '0 0 0 1px rgba(0,0,0,0.6)',
};
