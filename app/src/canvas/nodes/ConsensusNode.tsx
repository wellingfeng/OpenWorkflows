import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { ConsensusStrategy, IRAgentSpec } from '@/core/ir';
import type { FlowNodeData } from '@/canvas/irToFlow';
import { t } from '@/lib/i18n';
import { DataIn, DataOut, ExecIn, ExecOut } from './handles';
import { NodeNumberBadge } from './NodeNumberBadge';
import { BADGE_BASE_STYLE, runStateVisual } from './runStateStyles';

/**
 * Consensus node — Claude-Code-style "win by adversarial verification": fan out
 * N voters over one target, cross-validate, then vote for a single answer.
 *
 * Pins: exec in/out (▶), data in (target/context ●), data out (chosen answer ●).
 *
 * Accent token: `--accent-2` (shared with parallel; the ⚖ strategy chip
 * differentiates "vote on one target" from parallel's "run N different tasks").
 */

const STRATEGY_LABEL: Record<ConsensusStrategy, string> = {
  adversarial: '对抗验证',
  'multi-lens': '多视角审查',
  tournament: '方案竞标',
  'self-consistency': '自一致投票',
};

function ConsensusNodeImpl({ data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const params = d.params ?? {};
  const voters: string[] = Array.isArray(params.voters)
    ? (params.voters as (string | IRAgentSpec)[]).map((v) =>
        typeof v === 'string' ? v : v.label || v.agentType || v.prompt || 'voter',
      )
    : [];
  const strategy = (params.strategy as ConsensusStrategy) ?? 'multi-lens';
  const count =
    strategy === 'self-consistency'
      ? Math.min(7, Math.max(2, Number(params.samples) || 3))
      : voters.length;
  const quorum =
    typeof params.quorum === 'number' && params.quorum > 0
      ? params.quorum
      : Math.ceil(count / 2);

  const run = runStateVisual(d.runState);
  const borderColor =
    run?.borderColor ?? (selected ? 'var(--accent-2)' : 'var(--border)');
  const boxShadow =
    run?.boxShadow ?? (selected ? '0 0 0 1px var(--accent-2)' : undefined);

  return (
    <div
      className="relative min-w-[180px] overflow-visible rounded-md border bg-panel font-sans shadow-md"
      style={{ borderColor, boxShadow }}
    >
      <NodeNumberBadge value={d.numberLabel} accent="var(--accent-2)" />

      {/* Header */}
      <div
        className="flex items-center gap-2 rounded-t-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide"
        style={{ background: 'var(--panel-2)', color: 'var(--accent-2)' }}
      >
        <span aria-hidden>⚖</span>
        <span>{t(d.locale, 'nodeType.consensus')}</span>
        <span className="ml-auto font-mono text-[10px] normal-case text-fg-dim">
          {STRATEGY_LABEL[strategy]} · {count}选{quorum}
        </span>
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        <div className="text-sm font-medium text-fg">{d.label}</div>
        {voters.length > 0 ? (
          <div className="mt-1.5 flex flex-col gap-1">
            {voters.map((v, i) => (
              <div
                key={i}
                className="rounded border px-2 py-0.5 font-mono text-[10px] text-fg-dim"
                style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-alt)' }}
              >
                {v}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-1 font-mono text-[10px] text-fg-faint">
            {strategy === 'self-consistency' ? `×${count} 自一致` : 'voters[] → vote'}
          </div>
        )}
      </div>

      {/* Pins */}
      <ExecIn id="exec_in" top={26} />
      <ExecOut id="exec_out" top={26} />
      <DataIn id="data_in" top={62} />
      <DataOut id="data_out" top={62} />

      {/* Run-state corner badge */}
      {run && (
        <div
          aria-label={`run-state-${d.runState}`}
          style={{ ...BADGE_BASE_STYLE, ...run.badgeStyle }}
        >
          {run.badge}
        </div>
      )}
    </div>
  );
}

export default memo(ConsensusNodeImpl);
