export function normalizeWorkspacePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return '';

  let end = trimmed.length;
  while (end > 1 && /[/\\]/.test(trimmed[end - 1])) {
    const candidate = trimmed.slice(0, end - 1);
    if (/^[A-Za-z]:$/.test(candidate)) break;
    end -= 1;
    if (/^[/\\]{2}[^/\\]+[/\\][^/\\]+$/.test(candidate)) break;
  }

  return trimmed.slice(0, end);
}

export function workspacePathKey(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  const slashPath = normalized.replace(/\\/g, '/');
  const windowsLike =
    /^[A-Za-z]:/.test(slashPath) ||
    slashPath.startsWith('//') ||
    normalized.includes('\\');

  return windowsLike ? slashPath.toLowerCase() : slashPath;
}

export function uniqueWorkspaceHistory(
  paths: readonly unknown[],
  limit = Number.POSITIVE_INFINITY,
): string[] {
  const max = Math.max(0, Math.floor(limit));
  if (max === 0) return [];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of paths) {
    if (typeof raw !== 'string') continue;
    const path = normalizeWorkspacePath(raw);
    if (!path) continue;
    const key = workspacePathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(path);
    if (result.length >= max) break;
  }
  return result;
}

export function workspaceHistoryWithRecent(
  path: string,
  history: readonly unknown[],
  limit: number,
): string[] {
  return uniqueWorkspaceHistory([path, ...history], limit);
}
