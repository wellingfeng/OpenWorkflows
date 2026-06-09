import type { WorkspaceTreeEntry } from '@/lib/tauri';

export const PROJECT_FILE_DRAG_MIME =
  'application/x-freeultracode-project-file-paths';
export const PROJECT_FILE_DRAG_END_EVENT =
  'freeultracode:project-file-drag-end';

export interface ProjectFileDragEndDetail {
  paths: string[];
  clientX: number;
  clientY: number;
}

interface ProjectFileDragPayload {
  paths: string[];
  entries: Array<{
    path: string;
    relativePath: string;
    name: string;
    kind: WorkspaceTreeEntry['kind'];
  }>;
  startedAtMs: number;
}

const ACTIVE_PROJECT_FILE_DRAG_TTL_MS = 60_000;

let activeProjectFileDragPayload: ProjectFileDragPayload | null = null;
let lastProjectFileDragPoint: { clientX: number; clientY: number } | null = null;

function dragPointFromEvent(
  event: { clientX?: number; clientY?: number } | undefined,
): { clientX: number; clientY: number } | null {
  const clientX = event?.clientX;
  const clientY = event?.clientY;
  if (
    typeof clientX !== 'number' ||
    typeof clientY !== 'number' ||
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY)
  ) {
    return null;
  }
  // Some WebView dragend events report (0, 0) after a cancelled or external
  // drop. Keep the last non-zero drag point instead of treating that as a hit.
  if (clientX === 0 && clientY === 0) return null;
  return { clientX, clientY };
}

function projectFileDragPayloadFromEntry(
  entry: WorkspaceTreeEntry,
): ProjectFileDragPayload {
  return {
    paths: [entry.path],
    entries: [
      {
        path: entry.path,
        relativePath: entry.relativePath,
        name: entry.name,
        kind: entry.kind,
      },
    ],
    startedAtMs: Date.now(),
  };
}

function activeProjectFilePaths(): string[] {
  if (!activeProjectFileDragPayload) return [];
  if (
    Date.now() - activeProjectFileDragPayload.startedAtMs >
    ACTIVE_PROJECT_FILE_DRAG_TTL_MS
  ) {
    activeProjectFileDragPayload = null;
    lastProjectFileDragPoint = null;
    return [];
  }
  return activeProjectFileDragPayload.paths;
}

export function setProjectFileDragData(
  dataTransfer: DataTransfer,
  entry: WorkspaceTreeEntry,
): void {
  const payload = projectFileDragPayloadFromEntry(entry);
  activeProjectFileDragPayload = payload;
  lastProjectFileDragPoint = null;

  try {
    dataTransfer.effectAllowed = 'copy';
  } catch {
    // Some embedded WebViews expose a restricted DataTransfer during dragstart.
  }
  try {
    dataTransfer.setData(PROJECT_FILE_DRAG_MIME, JSON.stringify(payload));
  } catch {
    // Active in-memory payload below keeps same-window project drags working.
  }
  try {
    dataTransfer.setData('text/plain', entry.path);
  } catch {
    // Best-effort fallback for environments that strip custom MIME types.
  }
}

export function clearProjectFileDragData(): void {
  activeProjectFileDragPayload = null;
  lastProjectFileDragPoint = null;
}

export function updateProjectFileDragPoint(
  event: { clientX?: number; clientY?: number },
): void {
  if (!activeProjectFileDragPayload) return;
  const point = dragPointFromEvent(event);
  if (point) lastProjectFileDragPoint = point;
}

export function finishProjectFileDrag(
  event?: { clientX?: number; clientY?: number },
): void {
  if (event) updateProjectFileDragPoint(event);
  const paths = activeProjectFilePaths();
  const point = lastProjectFileDragPoint;
  clearProjectFileDragData();

  if (
    paths.length === 0 ||
    !point ||
    typeof window === 'undefined' ||
    typeof CustomEvent === 'undefined'
  ) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<ProjectFileDragEndDetail>(PROJECT_FILE_DRAG_END_EVENT, {
      detail: {
        paths,
        clientX: point.clientX,
        clientY: point.clientY,
      },
    }),
  );
}

export function hasProjectFileDragData(dataTransfer: DataTransfer): boolean {
  return (
    Array.from(dataTransfer.types).includes(PROJECT_FILE_DRAG_MIME) ||
    activeProjectFilePaths().length > 0
  );
}

export function projectFilePathsFromDataTransfer(
  dataTransfer: DataTransfer,
): string[] {
  let raw = '';
  try {
    raw = dataTransfer.getData(PROJECT_FILE_DRAG_MIME);
  } catch {
    return activeProjectFilePaths();
  }
  if (!raw) return activeProjectFilePaths();

  try {
    const parsed = JSON.parse(raw) as { paths?: unknown };
    if (!Array.isArray(parsed.paths)) return activeProjectFilePaths();
    const paths = parsed.paths
      .map((path) => (typeof path === 'string' ? path.trim() : ''))
      .filter(Boolean);
    return paths.length > 0 ? paths : activeProjectFilePaths();
  } catch {
    return activeProjectFilePaths();
  }
}
