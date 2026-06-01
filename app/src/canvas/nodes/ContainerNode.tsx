import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { FlowNodeData } from '@/canvas/irToFlow';
import { t } from '@/lib/i18n';
import { ExecIn, ExecOut } from './handles';
import { NodeNumberBadge } from './NodeNumberBadge';
import { BADGE_BASE_STYLE, runStateVisual } from './runStateStyles';

/**
 * Branch/loop control node.
 *
 * The node represents the control-flow gate only. Body nodes are independent
 * React Flow nodes connected by exec edges, while `IRNode.parent` still carries
 * the semantic nesting used by the emitter.
 */
function ContainerNodeImpl({ data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const params = d.params ?? {};
  const isLoop = d.irType === 'loop';
  const keyword = isLoop ? 'while' : 'if';
  const condition = String(params.condition ?? (isLoop ? 'false' : 'true'));

  const run = runStateVisual(d.runState);
  const borderColor =
    run?.borderColor ?? (selected ? 'var(--accent-3)' : 'var(--border)');
  const boxShadow =
    run?.boxShadow ?? (selected ? '0 0 0 1px var(--accent-3)' : undefined);

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-visible rounded-md border bg-panel font-sans shadow-md"
      style={{ borderColor, boxShadow }}
    >
      <NodeNumberBadge value={d.numberLabel} accent="var(--accent-3)" />

      <div
        className="flex items-center gap-2 rounded-t-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide"
        style={{ background: 'var(--panel-2)', color: 'var(--accent-3)' }}
      >
        <span aria-hidden>{isLoop ? '↻' : '⋔'}</span>
        <span>{isLoop ? t(d.locale, 'nodeType.loop') : t(d.locale, 'nodeType.branch')}</span>
      </div>

      <div className="min-h-0 flex-1 px-3 py-2">
        <div className="truncate text-sm font-medium text-fg">
          {d.label || (isLoop ? t(d.locale, 'nodeType.loop') : t(d.locale, 'nodeType.branch'))}
        </div>
        <div className="mt-1 truncate font-mono text-[10px] text-fg-faint">
          {keyword} ({condition})
        </div>
      </div>

      <ExecIn id="exec_in" top={26} />
      <ExecOut id="exec_out" top={26} />

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

export default memo(ContainerNodeImpl);
