/**
 * CONTRACT: pure clock/duration formatting for run log lines. Moved from
 * store/useStore.ts (`formatClock` / `formatDuration`).
 */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const sec = String(seconds).padStart(2, '0');
  const min = String(minutes).padStart(2, '0');
  if (hours > 0) return `${hours}h ${min}m ${sec}s`;
  if (minutes > 0) return `${minutes}m ${sec}s`;
  return `${seconds}s`;
}
