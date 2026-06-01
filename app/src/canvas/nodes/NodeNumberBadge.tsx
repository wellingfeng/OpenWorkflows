import type { CSSProperties } from 'react';

interface NodeNumberBadgeProps {
  value?: number;
  accent?: string;
}

export function NodeNumberBadge({ value, accent = 'var(--accent)' }: NodeNumberBadgeProps) {
  if (!Number.isInteger(value) || value == null || value <= 0) return null;
  return (
    <span
      aria-label={`node number ${value}`}
      className="pointer-events-none absolute -left-3 -top-2 z-10 flex h-5 min-w-5 select-none items-center justify-center whitespace-nowrap rounded-full border bg-panel px-1.5 font-mono text-[10px] font-bold leading-none tabular-nums shadow-[0_0_0_1px_var(--bg),0_3px_8px_rgba(0,0,0,0.35)]"
      style={
        {
          borderColor: accent,
          color: accent,
        } satisfies CSSProperties
      }
      title={`#${value}`}
    >
      #{value}
    </span>
  );
}
