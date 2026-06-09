import {
  type ReactNode,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  Box,
  ChevronRight,
  Code2,
  File,
  FileDiff,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import FilePreviewDrawer from '@/components/ai/FilePreviewDrawer';
import type { FileRef } from '@/components/ai/lib/filePath';
import { t } from '@/lib/i18n';
import {
  finishProjectFileDrag,
  setProjectFileDragData,
  updateProjectFileDragPoint,
} from '@/lib/projectFileDrag';
import {
  ensureCachedSessionChangesBaseline,
  readCachedSessionChanges,
  readPersistedSessionChanges,
  refreshCachedSessionChanges,
  sessionChangesCacheKey,
} from '@/lib/sessionChanges';
import {
  listWorkspaceDirectory,
  openLocalPath,
  previewLocalFile,
  type WorkspaceChangeFile,
  type WorkspaceChangeLine,
  type WorkspaceChanges,
  type WorkspaceTreeEntry,
} from '@/lib/tauri';
import { useResizableWidth } from '@/lib/useResizableWidth';
import { useStore } from '@/store/useStore';

type ProjectPanelTab = 'files' | 'changes';
type ProjectTreeViewMode = 'tree' | 'preview';
type ProjectEngine = 'unreal' | 'unity' | 'godot' | 'generic';

type ThumbnailState =
  | { status: 'loading'; lastAccessed: number }
  | { status: 'ready'; dataUrl: string; lastAccessed: number }
  | { status: 'error'; lastAccessed: number };

type ThumbnailCache = Record<string, ThumbnailState>;
type ThumbnailVisibility = Record<string, true>;
type ProjectEntryContextMenuState =
  | null
  | {
      x: number;
      y: number;
      entry: WorkspaceTreeEntry;
    };

type DirectoryState =
  | {
      status: 'loading';
      entries: WorkspaceTreeEntry[];
    }
  | {
      status: 'ready';
      entries: WorkspaceTreeEntry[];
      truncated: boolean;
      totalEntries: number;
    }
  | {
      status: 'error';
      entries: WorkspaceTreeEntry[];
      message: string;
    };

interface WorkspaceTreeState {
  rootPath: string;
  directories: Record<string, DirectoryState>;
  expanded: Record<string, boolean>;
}

type WorkspaceTreeCache = Record<string, WorkspaceTreeState>;

type WorkspaceChangesState =
  | { status: 'idle'; snapshot: WorkspaceChanges | null; message?: undefined }
  | { status: 'loading'; snapshot: WorkspaceChanges | null; message?: undefined }
  | { status: 'ready'; snapshot: WorkspaceChanges; message?: undefined }
  | { status: 'error'; snapshot: WorkspaceChanges | null; message: string };

type WorkspaceChangeHunkStatus = 'added' | 'deleted' | 'modified';

interface WorkspaceChangeHunk {
  key: string;
  status: WorkspaceChangeHunkStatus;
  oldStart: number | null;
  oldEnd: number | null;
  newStart: number | null;
  newEnd: number | null;
  lines: WorkspaceChangeLine[];
}

const IMAGE_EXTENSIONS = new Set([
  'png',
  'apng',
  'jpg',
  'jpeg',
  'jpe',
  'jfif',
  'gif',
  'webp',
  'bmp',
  'dib',
  'ico',
  'cur',
  'svg',
  'avif',
]);

const CODE_EXTENSIONS = new Set([
  'c',
  'cc',
  'cpp',
  'cs',
  'css',
  'gd',
  'h',
  'hpp',
  'html',
  'js',
  'json',
  'jsx',
  'rs',
  'ts',
  'tsx',
  'vue',
  'xml',
  'yaml',
  'yml',
]);

const ENGINE_LABELS: Record<ProjectEngine, string> = {
  unreal: 'Unreal',
  unity: 'Unity',
  godot: 'Godot',
  generic: '项目',
};

const ENGINE_BADGES: Record<ProjectEngine, string> = {
  unreal: 'UE',
  unity: 'UNITY',
  godot: 'GODOT',
  generic: 'FILE',
};

const THUMBNAIL_CACHE_LIMIT = 96;
const THUMBNAIL_LOAD_BATCH_SIZE = 12;
const THUMBNAIL_ROOT_MARGIN = '280px 0px';
const CONTEXT_MENU_WIDTH = 176;
const CONTEXT_MENU_HEIGHT = 36;
const CONTEXT_MENU_MARGIN = 8;

function formatCachedAt(locale: string, timestamp: number): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

function changedLineCount(snapshot: WorkspaceChanges | null): number {
  return snapshot?.files.reduce((sum, file) => sum + file.lines.length, 0) ?? 0;
}

function workspaceChangeFileKey(file: WorkspaceChangeFile): string {
  return `${file.oldPath ?? ''}:${file.path}`;
}

function changeStatusLabel(status: WorkspaceChangeFile['status']): string {
  if (status === 'added') return '新增';
  if (status === 'deleted') return '删除';
  if (status === 'renamed') return '重命名';
  return '修改';
}

function changeStatusClass(status: WorkspaceChangeFile['status']): string {
  if (status === 'added') return 'border-status-success/40 text-status-success';
  if (status === 'deleted') return 'border-status-error/45 text-status-error';
  if (status === 'renamed') return 'border-accent-2/45 text-accent-2';
  return 'border-accent/45 text-accent';
}

function changeSourceLabel(source?: string): string {
  if (source === 'git') return 'Git';
  if (source === 'svn') return 'SVN';
  if (source === 'p4') return 'P4';
  return '快照';
}

function changeLineMarker(line: WorkspaceChangeLine): string {
  if (line.kind === 'added') return '+';
  if (line.kind === 'deleted') return '-';
  if (line.kind === 'replacedAdded') return '~+';
  return '~-';
}

function changeLineNumber(line: WorkspaceChangeLine): string {
  const value = line.newLine ?? line.oldLine;
  return value == null ? '' : String(value);
}

function changeLineClass(line: WorkspaceChangeLine): string {
  if (line.kind === 'added') return 'bg-status-success/10 text-status-success';
  if (line.kind === 'deleted') return 'bg-status-error/10 text-status-error';
  if (line.kind === 'replacedAdded') return 'bg-accent/10 text-accent';
  return 'bg-amber-500/10 text-amber-300';
}

function lineIsAdded(line: WorkspaceChangeLine): boolean {
  return line.kind === 'added' || line.kind === 'replacedAdded';
}

function lineIsDeleted(line: WorkspaceChangeLine): boolean {
  return line.kind === 'deleted' || line.kind === 'replacedDeleted';
}

function workspaceChangeHunkStatus(lines: WorkspaceChangeLine[]): WorkspaceChangeHunkStatus {
  const hasAdded = lines.some(lineIsAdded);
  const hasDeleted = lines.some(lineIsDeleted);
  if (hasAdded && hasDeleted) return 'modified';
  if (hasAdded) return 'added';
  return 'deleted';
}

function buildWorkspaceChangeHunks(lines: WorkspaceChangeLine[]): WorkspaceChangeHunk[] {
  const hunks: WorkspaceChangeHunk[] = [];
  let current: WorkspaceChangeLine[] = [];
  let lastOldLine: number | null = null;
  let lastNewLine: number | null = null;

  const flush = () => {
    if (current.length === 0) return;
    const oldLines = current
      .map((line) => line.oldLine ?? null)
      .filter((line): line is number => line != null);
    const newLines = current
      .map((line) => line.newLine ?? null)
      .filter((line): line is number => line != null);
    const oldStart = oldLines.length > 0 ? Math.min(...oldLines) : null;
    const oldEnd = oldLines.length > 0 ? Math.max(...oldLines) : null;
    const newStart = newLines.length > 0 ? Math.min(...newLines) : null;
    const newEnd = newLines.length > 0 ? Math.max(...newLines) : null;

    hunks.push({
      key: `${oldStart ?? ''}:${oldEnd ?? ''}:${newStart ?? ''}:${newEnd ?? ''}:${hunks.length}`,
      status: workspaceChangeHunkStatus(current),
      oldStart,
      oldEnd,
      newStart,
      newEnd,
      lines: current,
    });
    current = [];
    lastOldLine = null;
    lastNewLine = null;
  };

  for (const line of lines) {
    const oldLine = line.oldLine ?? null;
    const newLine = line.newLine ?? null;
    const oldGap = oldLine != null && lastOldLine != null && oldLine > lastOldLine + 1;
    const newGap = newLine != null && lastNewLine != null && newLine > lastNewLine + 1;
    if (current.length > 0 && (oldGap || newGap)) flush();

    current.push(line);
    if (oldLine != null) lastOldLine = oldLine;
    if (newLine != null) lastNewLine = newLine;
  }

  flush();
  return hunks;
}

function lineRange(start: number | null, end: number | null): string {
  if (start == null || end == null) return '';
  return start === end ? String(start) : `${start}-${end}`;
}

function changeHunkLabel(hunk: WorkspaceChangeHunk): string {
  const oldRange = lineRange(hunk.oldStart, hunk.oldEnd);
  const newRange = lineRange(hunk.newStart, hunk.newEnd);
  if (hunk.status === 'added') return `新增 ${newRange}`;
  if (hunk.status === 'deleted') return `删除 ${oldRange}`;
  if (oldRange && newRange) return `修改 ${oldRange} -> ${newRange}`;
  return '修改';
}

function changeHunkStatusClass(status: WorkspaceChangeHunkStatus): string {
  if (status === 'added') return 'border-status-success/40 bg-status-success/10 text-status-success';
  if (status === 'deleted') return 'border-status-error/45 bg-status-error/10 text-status-error';
  return 'border-accent/45 bg-accent/10 text-accent';
}

function directoryKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

function isImageEntry(entry: WorkspaceTreeEntry): boolean {
  return entry.kind === 'file' && IMAGE_EXTENSIONS.has(fileExtension(entry.name));
}

function thumbnailKey(entry: WorkspaceTreeEntry): string {
  return `${entry.path}::${entry.modifiedAtMs ?? ''}::${entry.sizeBytes ?? ''}`;
}

function pruneThumbnailCache(
  cache: ThumbnailCache,
  visibleThumbnails: ThumbnailVisibility,
): ThumbnailCache {
  const readyEntries = Object.entries(cache).filter(
    ([, thumbnail]) => thumbnail.status === 'ready',
  );
  if (readyEntries.length <= THUMBNAIL_CACHE_LIMIT) return cache;

  const evictable = readyEntries
    .filter(([key]) => !visibleThumbnails[key])
    .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed);
  const overflow = readyEntries.length - THUMBNAIL_CACHE_LIMIT;
  if (overflow <= 0 || evictable.length === 0) return cache;

  const next = { ...cache };
  for (const [key] of evictable.slice(0, overflow)) {
    delete next[key];
  }
  return next;
}

function detectProjectEngine(entries: WorkspaceTreeEntry[] | undefined): ProjectEngine {
  if (!entries || entries.length === 0) return 'generic';
  const names = new Set(entries.map((entry) => entry.name.toLowerCase()));
  const hasDirectory = (name: string) =>
    entries.some(
      (entry) => entry.kind === 'directory' && entry.name.toLowerCase() === name,
    );
  const hasFile = (name: string) =>
    entries.some(
      (entry) => entry.kind === 'file' && entry.name.toLowerCase() === name,
    );

  if (
    entries.some(
      (entry) =>
        entry.kind === 'file' && entry.name.toLowerCase().endsWith('.uproject'),
    )
  ) {
    return 'unreal';
  }
  if (
    hasDirectory('content') &&
    hasDirectory('config') &&
    (hasDirectory('source') || names.has('saved'))
  ) {
    return 'unreal';
  }
  if (hasFile('project.godot')) return 'godot';
  if (
    hasDirectory('assets') &&
    hasDirectory('projectsettings') &&
    (hasDirectory('packages') || hasDirectory('library'))
  ) {
    return 'unity';
  }
  return 'generic';
}

function entryPreviewLabel(entry: WorkspaceTreeEntry, engine: ProjectEngine): string {
  if (entry.kind === 'directory') {
    const lower = entry.name.toLowerCase();
    if (engine === 'unreal' && lower === 'content') return 'CONTENT';
    if (engine === 'unity' && lower === 'assets') return 'ASSETS';
    if (engine === 'godot' && lower === 'addons') return 'ADDONS';
    return 'DIR';
  }

  const ext = fileExtension(entry.name);
  if (IMAGE_EXTENSIONS.has(ext)) return ext.toUpperCase() || 'IMG';

  if (engine === 'unreal') {
    if (ext === 'umap') return 'MAP';
    if (ext === 'uasset') return 'ASSET';
    if (ext === 'uproject') return 'UPROJ';
  }
  if (engine === 'unity') {
    if (ext === 'unity') return 'SCENE';
    if (ext === 'prefab') return 'PREFAB';
    if (ext === 'mat') return 'MAT';
    if (ext === 'asset') return 'ASSET';
    if (ext === 'cs') return 'C#';
  }
  if (engine === 'godot') {
    if (ext === 'tscn' || ext === 'scn') return 'SCENE';
    if (ext === 'tres' || ext === 'res') return 'RES';
    if (ext === 'gd') return 'GD';
    if (entry.name.toLowerCase() === 'project.godot') return 'PROJECT';
  }

  if (CODE_EXTENSIONS.has(ext)) return ext.toUpperCase();
  return ext ? ext.toUpperCase() : 'FILE';
}

function previewSurface(engine: ProjectEngine, entry: WorkspaceTreeEntry): string {
  if (entry.kind === 'directory') {
    return 'linear-gradient(135deg, color-mix(in oklab, var(--accent-2) 34%, var(--panel-2)), var(--panel))';
  }
  if (isImageEntry(entry)) {
    return 'linear-gradient(135deg, color-mix(in oklab, var(--accent-3) 36%, var(--panel-2)), var(--panel))';
  }
  if (engine === 'unreal') {
    return 'linear-gradient(135deg, #111827, #334155 48%, #f59e0b)';
  }
  if (engine === 'unity') {
    return 'linear-gradient(135deg, #0f172a, #1f2937 48%, #38bdf8)';
  }
  if (engine === 'godot') {
    return 'linear-gradient(135deg, #0b1220, #1d4ed8 48%, #60a5fa)';
  }
  return 'linear-gradient(135deg, var(--panel-2), color-mix(in oklab, var(--accent) 28%, var(--panel)))';
}

function contextMenuPosition(
  event: ReactMouseEvent,
): Pick<NonNullable<ProjectEntryContextMenuState>, 'x' | 'y'> {
  if (typeof window === 'undefined') {
    return { x: event.clientX, y: event.clientY };
  }
  return {
    x: Math.max(
      CONTEXT_MENU_MARGIN,
      Math.min(
        event.clientX,
        window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_MARGIN,
      ),
    ),
    y: Math.max(
      CONTEXT_MENU_MARGIN,
      Math.min(
        event.clientY,
        window.innerHeight - CONTEXT_MENU_HEIGHT - CONTEXT_MENU_MARGIN,
      ),
    ),
  };
}

function PreviewGlyph({
  entry,
  engine,
}: {
  entry: WorkspaceTreeEntry;
  engine: ProjectEngine;
}) {
  if (entry.kind === 'directory') return <FolderOpen size={28} />;
  if (isImageEntry(entry)) return <ImageIcon size={28} />;
  if (CODE_EXTENSIONS.has(fileExtension(entry.name))) return <Code2 size={28} />;
  if (engine !== 'generic') return <Box size={29} />;
  return <FileText size={28} />;
}

function PreviewCard({
  entry,
  engine,
  thumbnail,
  thumbnailId,
  onVisibilityChange,
  onOpen,
  onDragStart,
  onDrag,
  onDragEnd,
  onContextMenu,
}: {
  entry: WorkspaceTreeEntry;
  engine: ProjectEngine;
  thumbnail?: ThumbnailState;
  thumbnailId: string;
  onVisibilityChange: (key: string, visible: boolean) => void;
  onOpen: () => void;
  onDragStart: (event: ReactDragEvent<HTMLButtonElement>) => void;
  onDrag: (event: ReactDragEvent<HTMLButtonElement>) => void;
  onDragEnd: (event: ReactDragEvent<HTMLButtonElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const dataUrl = thumbnail?.status === 'ready' ? thumbnail.dataUrl : null;
  const label = entryPreviewLabel(entry, engine);
  const imageEntry = isImageEntry(entry);

  useEffect(() => {
    if (!imageEntry) return;
    const node = cardRef.current;
    if (!node) return;

    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      onVisibilityChange(thumbnailId, true);
      return () => onVisibilityChange(thumbnailId, false);
    }

    const observer = new IntersectionObserver(
      ([observed]) => {
        onVisibilityChange(thumbnailId, observed?.isIntersecting === true);
      },
      {
        root: null,
        rootMargin: THUMBNAIL_ROOT_MARGIN,
        threshold: 0.01,
      },
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
      onVisibilityChange(thumbnailId, false);
    };
  }, [imageEntry, onVisibilityChange, thumbnailId]);

  return (
    <button
      ref={cardRef}
      type="button"
      draggable
      onDragStart={onDragStart}
      onDrag={onDrag}
      onDragEnd={onDragEnd}
      onContextMenu={onContextMenu}
      onClick={onOpen}
      title={entry.path}
      className={
        'group min-w-0 cursor-grab overflow-hidden rounded-md border border-border bg-panel-2 text-left transition-colors hover:border-accent hover:bg-panel active:cursor-grabbing ' +
        (entry.hidden ? 'opacity-65' : '')
      }
    >
      <div
        className="relative flex h-[76px] items-center justify-center overflow-hidden border-b border-border-soft text-white"
        style={{ background: previewSurface(engine, entry) }}
      >
        {dataUrl ? (
          <img
            src={dataUrl}
            alt=""
            draggable={false}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-black/10 text-white/90">
            <PreviewGlyph entry={entry} engine={engine} />
            <span className="max-w-[86%] truncate text-[10px] font-semibold tracking-normal">
              {engine === 'generic' ? entryPreviewLabel(entry, engine) : ENGINE_BADGES[engine]}
            </span>
          </div>
        )}
        {thumbnail?.status === 'loading' && (
          <Loader2 size={16} className="absolute right-1.5 top-1.5 animate-spin text-white/80" />
        )}
        <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1.5 py-0.5 text-[9px] font-medium leading-none text-white/90">
          {label}
        </span>
      </div>
      <span
        className="block h-9 overflow-hidden px-1.5 py-1 text-[11px] leading-4 text-fg-dim group-hover:text-fg"
        style={{
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 2,
        }}
      >
        {entry.name}
      </span>
    </button>
  );
}

function ProjectEntryContextMenu({
  x,
  y,
  label,
  onReveal,
}: {
  x: number;
  y: number;
  label: string;
  onReveal: () => void;
}) {
  return (
    <div
      role="menu"
      className="fixed z-[70] min-w-[176px] rounded-md border border-border bg-panel py-1 text-xs text-fg shadow-xl"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        role="menuitem"
        onClick={onReveal}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-border-soft"
      >
        <FolderOpen size={13} className="shrink-0 text-fg-faint" />
        <span className="truncate">{label}</span>
      </button>
    </div>
  );
}

function fileRefFromEntry(entry: WorkspaceTreeEntry): FileRef {
  return {
    path: entry.path,
    basename: entry.name,
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message === 'NO_BACKEND') {
    return '当前浏览器模式不能读取本机文件。请使用桌面端。';
  }
  return err instanceof Error ? err.message : String(err);
}

export default function ProjectFileTree() {
  const locale = useStore((s) => s.locale);
  const workspaces = useStore((s) => s.workspaces);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const aiEditingSessions = useStore((s) => s.aiEditingSessions);
  const chattingSessions = useStore((s) => s.chattingSessions);
  const runningSessions = useStore((s) => s.runningSessions);
  const [cache, setCache] = useState<WorkspaceTreeCache>({});
  const cacheRef = useRef(cache);
  const [previewRef, setPreviewRef] = useState<FileRef | null>(null);
  const [panelTab, setPanelTab] = useState<ProjectPanelTab>(() => {
    if (typeof window === 'undefined') return 'files';
    return window.localStorage.getItem('freeultracode.projectRightPanelTab.v1') ===
      'changes'
      ? 'changes'
      : 'files';
  });
  const [viewMode, setViewMode] = useState<ProjectTreeViewMode>(() => {
    if (typeof window === 'undefined') return 'tree';
    return window.localStorage.getItem('freeultracode.projectFileTreeView.v1') ===
      'preview'
      ? 'preview'
      : 'tree';
  });
  const [changesState, setChangesState] = useState<WorkspaceChangesState>({
    status: 'idle',
    snapshot: null,
  });
  const [selectedChangeKey, setSelectedChangeKey] = useState<string | null>(null);
  const [previewDirectories, setPreviewDirectories] = useState<Record<string, string>>({});
  const [thumbnailCache, setThumbnailCache] = useState<ThumbnailCache>({});
  const [visibleThumbnails, setVisibleThumbnails] = useState<ThumbnailVisibility>({});
  const [contextMenu, setContextMenu] = useState<ProjectEntryContextMenuState>(null);
  const visibleThumbnailsRef = useRef<ThumbnailVisibility>({});
  const changesLoadSeqRef = useRef(0);
  const activeSessionBusyRef = useRef(false);

  useEffect(() => {
    cacheRef.current = cache;
  }, [cache]);

  useEffect(() => {
    visibleThumbnailsRef.current = visibleThumbnails;
  }, [visibleThumbnails]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId),
    [activeWorkspaceId, workspaces],
  );
  const activeWorkspacePath = activeWorkspace?.path?.trim() ?? '';
  const workspaceChangesRootPath = activeWorkspacePath;
  const activeSessionBusy = useMemo(() => {
    if (!activeSessionId) return false;
    const matchesActive = (key: { workspaceId: string | null; sessionId: string | null }) =>
      key.sessionId === activeSessionId &&
      (key.workspaceId ?? null) === (activeWorkspaceId ?? null);
    return (
      aiEditingSessions.some(matchesActive) ||
      chattingSessions.some(matchesActive) ||
      runningSessions.some(matchesActive)
    );
  }, [
    activeSessionId,
    activeWorkspaceId,
    aiEditingSessions,
    chattingSessions,
    runningSessions,
  ]);
  const changesCacheKey = useMemo(
    () =>
      sessionChangesCacheKey(
        activeWorkspace?.id,
        'workspace',
        workspaceChangesRootPath,
      ),
    [activeWorkspace?.id, workspaceChangesRootPath],
  );
  const activeTree = activeWorkspace
    ? cache[activeWorkspace.id]
    : undefined;
  const rootState = activeTree?.directories[''];
  const projectEngine = useMemo(
    () => detectProjectEngine(rootState?.entries),
    [rootState?.entries],
  );
  const previewDirectory = activeWorkspace
    ? previewDirectories[activeWorkspace.id] ?? ''
    : '';
  const previewDirectoryKey = directoryKey(previewDirectory);
  const previewDirectoryState = activeTree?.directories[previewDirectoryKey];
  const previewDirectoryEntries = previewDirectoryState?.entries ?? [];

  const { width, onResizeStart } = useResizableWidth({
    storageKey: 'freeultracode.projectFileTreeWidth.v1',
    defaultWidth: 280,
    min: 220,
    max: 520,
    edge: 'left',
  });

  const loadDirectory = useCallback(
    async (
      workspaceId: string,
      rootPath: string,
      relativePath: string,
      options: { force?: boolean } = {},
    ) => {
      const key = directoryKey(relativePath);
      const current = cacheRef.current[workspaceId];
      const sameRoot = current?.rootPath === rootPath;
      const existing = sameRoot ? current?.directories[key] : undefined;
      if (!options.force && existing) return;

      setCache((prev) => {
        const previous = prev[workspaceId];
        const keepWorkspace = previous?.rootPath === rootPath && !options.force;
        const nextTree: WorkspaceTreeState = {
          rootPath,
          directories: keepWorkspace ? { ...previous.directories } : {},
          expanded: keepWorkspace ? { ...previous.expanded } : {},
        };
        nextTree.directories[key] = {
          status: 'loading',
          entries: keepWorkspace
            ? previous.directories[key]?.entries ?? []
            : [],
        };
        const next = {
          ...prev,
          [workspaceId]: nextTree,
        };
        cacheRef.current = next;
        return next;
      });

      try {
        const listing = await listWorkspaceDirectory(rootPath, key);
        setCache((prev) => {
          const previous = prev[workspaceId];
          if (!previous || previous.rootPath !== rootPath) return prev;
          const nextTree: WorkspaceTreeState = {
            ...previous,
            rootPath: listing.rootPath,
            directories: {
              ...previous.directories,
              [key]: {
                status: 'ready',
                entries: listing.entries,
                truncated: listing.truncated,
                totalEntries: listing.totalEntries,
              },
            },
          };
          const next = {
            ...prev,
            [workspaceId]: nextTree,
          };
          cacheRef.current = next;
          return next;
        });
      } catch (err) {
        setCache((prev) => {
          const previous = prev[workspaceId];
          if (!previous || previous.rootPath !== rootPath) return prev;
          const nextTree: WorkspaceTreeState = {
            ...previous,
            directories: {
              ...previous.directories,
              [key]: {
                status: 'error',
                entries: previous.directories[key]?.entries ?? [],
                message: errorMessage(err),
              },
            },
          };
          const next = {
            ...prev,
            [workspaceId]: nextTree,
          };
          cacheRef.current = next;
          return next;
        });
      }
    },
    [],
  );

  const updateViewMode = useCallback((nextMode: ProjectTreeViewMode) => {
    setViewMode(nextMode);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('freeultracode.projectFileTreeView.v1', nextMode);
    }
  }, []);

  const updatePanelTab = useCallback((nextTab: ProjectPanelTab) => {
    if (nextTab === 'changes') {
      setSelectedChangeKey(null);
    }
    setPanelTab(nextTab);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('freeultracode.projectRightPanelTab.v1', nextTab);
    }
  }, []);

  useEffect(() => {
    if (!activeWorkspace || !activeWorkspacePath) return;
    const tree = cacheRef.current[activeWorkspace.id];
    if (tree?.rootPath === activeWorkspacePath && tree.directories['']) return;
    void loadDirectory(activeWorkspace.id, activeWorkspacePath, '');
  }, [activeWorkspace, activeWorkspacePath, loadDirectory]);

  useEffect(() => {
    const snapshot = readCachedSessionChanges(changesCacheKey);
    setChangesState(snapshot ? { status: 'ready', snapshot } : { status: 'idle', snapshot: null });
    setSelectedChangeKey(null);
    if (!snapshot && workspaceChangesRootPath && changesCacheKey) {
      const seq = changesLoadSeqRef.current + 1;
      changesLoadSeqRef.current = seq;
      void readPersistedSessionChanges(workspaceChangesRootPath, changesCacheKey)
        .then((persisted) => {
          if (changesLoadSeqRef.current !== seq || !persisted) return;
          setChangesState({ status: 'ready', snapshot: persisted });
        })
        .catch(() => {});
    }
    if (workspaceChangesRootPath && changesCacheKey) {
      void ensureCachedSessionChangesBaseline(
        workspaceChangesRootPath,
        changesCacheKey,
        null,
      ).catch(() => {});
    }
  }, [workspaceChangesRootPath, changesCacheKey]);

  useEffect(() => {
    if (!selectedChangeKey) return;
    const snapshot = changesState.snapshot;
    if (!snapshot?.files.some((file) => workspaceChangeFileKey(file) === selectedChangeKey)) {
      setSelectedChangeKey(null);
    }
  }, [changesState.snapshot, selectedChangeKey]);

  useEffect(() => {
    setVisibleThumbnails({});
  }, [activeWorkspace?.id, previewDirectoryKey, viewMode]);

  useEffect(() => {
    if (viewMode !== 'preview' || !activeWorkspacePath) return;
    const imageEntries = previewDirectoryEntries.filter(
      (entry) => isImageEntry(entry) && visibleThumbnails[thumbnailKey(entry)],
    );
    const missing = imageEntries
      .filter((entry) => !thumbnailCache[thumbnailKey(entry)])
      .slice(0, THUMBNAIL_LOAD_BATCH_SIZE);
    if (missing.length === 0) return;

    setThumbnailCache((prev) => {
      const next = { ...prev };
      const now = Date.now();
      for (const entry of missing) {
        const key = thumbnailKey(entry);
        if (!next[key]) {
          next[key] = { status: 'loading', lastAccessed: now };
        }
      }
      return pruneThumbnailCache(next, visibleThumbnailsRef.current);
    });

    for (const entry of missing) {
      const key = thumbnailKey(entry);
      void previewLocalFile(entry.path, { cwd: activeWorkspacePath })
        .then((result) => {
          if (result.kind !== 'image' || !result.base64 || !result.mime) {
            throw new Error('not image');
          }
          setThumbnailCache((prev) => ({
            ...pruneThumbnailCache(
              {
                ...prev,
                [key]: {
                  status: 'ready',
                  dataUrl: `data:${result.mime};base64,${result.base64}`,
                  lastAccessed: Date.now(),
                },
              },
              visibleThumbnailsRef.current,
            ),
          }));
        })
        .catch(() => {
          setThumbnailCache((prev) => ({
            ...prev,
            [key]: { status: 'error', lastAccessed: Date.now() },
          }));
        });
    }
  }, [
    activeWorkspacePath,
    previewDirectoryEntries,
    thumbnailCache,
    visibleThumbnails,
    viewMode,
  ]);

  useEffect(() => {
    setThumbnailCache((prev) =>
      pruneThumbnailCache(prev, visibleThumbnailsRef.current),
    );
  }, [visibleThumbnails]);

  const updateThumbnailVisibility = useCallback(
    (key: string, visible: boolean) => {
      setVisibleThumbnails((prev) => {
        if (visible) {
          if (prev[key]) return prev;
          return { ...prev, [key]: true };
        }
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });

      if (visible) {
        setThumbnailCache((prev) => {
          const thumbnail = prev[key];
          if (!thumbnail) return prev;
          return {
            ...prev,
            [key]: {
              ...thumbnail,
              lastAccessed: Date.now(),
            },
          };
        });
      }
    },
    [],
  );

  const startEntryDrag = useCallback(
    (event: ReactDragEvent<HTMLElement>, entry: WorkspaceTreeEntry) => {
      setProjectFileDragData(event.dataTransfer, entry);
      updateProjectFileDragPoint(event);
    },
    [],
  );

  const trackEntryDrag = useCallback((event: ReactDragEvent<HTMLElement>) => {
    updateProjectFileDragPoint(event);
  }, []);

  const finishEntryDrag = useCallback((event: ReactDragEvent<HTMLElement>) => {
    finishProjectFileDrag(event);
  }, []);

  const openEntryContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, entry: WorkspaceTreeEntry) => {
      event.preventDefault();
      event.stopPropagation();
      setContextMenu({
        ...contextMenuPosition(event),
        entry,
      });
    },
    [],
  );

  const revealContextMenuEntry = useCallback(() => {
    if (!contextMenu) return;
    const targetPath = contextMenu.entry.path;
    setContextMenu(null);
    void openLocalPath(targetPath, {
      cwd: activeWorkspacePath || undefined,
      reveal: true,
    }).then((opened) => {
      if (!opened && typeof window !== 'undefined') {
        window.alert('当前环境不能打开系统文件浏览器。请使用桌面端。');
      }
    });
  }, [activeWorkspacePath, contextMenu]);

  const toggleDirectory = useCallback(
    (entry: WorkspaceTreeEntry) => {
      if (!activeWorkspace || !activeWorkspacePath) return;
      const key = directoryKey(entry.relativePath);
      const tree = cacheRef.current[activeWorkspace.id];
      const nextExpanded = !(tree?.expanded[key] === true);

      setCache((prev) => {
        const previous = prev[activeWorkspace.id];
        if (!previous) return prev;
        const next = {
          ...prev,
          [activeWorkspace.id]: {
            ...previous,
            expanded: {
              ...previous.expanded,
              [key]: nextExpanded,
            },
          },
        };
        cacheRef.current = next;
        return next;
      });

      if (nextExpanded && !tree?.directories[key]) {
        void loadDirectory(activeWorkspace.id, activeWorkspacePath, key);
      }
    },
    [activeWorkspace, activeWorkspacePath, loadDirectory],
  );

  const refreshActiveWorkspace = useCallback(() => {
    if (!activeWorkspace || !activeWorkspacePath) return;
    setPreviewDirectories((prev) => ({
      ...prev,
      [activeWorkspace.id]: '',
    }));
    void loadDirectory(activeWorkspace.id, activeWorkspacePath, '', {
      force: true,
    });
  }, [activeWorkspace, activeWorkspacePath, loadDirectory]);

  const refreshSessionChanges = useCallback(() => {
    if (!workspaceChangesRootPath || !changesCacheKey) return;
    const seq = changesLoadSeqRef.current + 1;
    changesLoadSeqRef.current = seq;
    setSelectedChangeKey(null);
    setChangesState((prev) => ({
      status: 'loading',
      snapshot: prev.snapshot,
    }));
    void refreshCachedSessionChanges(
      workspaceChangesRootPath,
      changesCacheKey,
      null,
    )
      .then((snapshot) => {
        if (changesLoadSeqRef.current !== seq) return;
        setChangesState({ status: 'ready', snapshot });
      })
      .catch((err) => {
        if (changesLoadSeqRef.current !== seq) return;
        setChangesState((prev) => ({
          status: 'error',
          snapshot: prev.snapshot,
          message: errorMessage(err),
        }));
      });
  }, [workspaceChangesRootPath, changesCacheKey]);

  useEffect(() => {
    if (panelTab !== 'changes') return;
    if (!workspaceChangesRootPath || !changesCacheKey) return;
    if (changesState.status !== 'idle') return;
    refreshSessionChanges();
  }, [
    workspaceChangesRootPath,
    changesCacheKey,
    changesState.status,
    panelTab,
    refreshSessionChanges,
  ]);

  useEffect(() => {
    const wasBusy = activeSessionBusyRef.current;
    activeSessionBusyRef.current = activeSessionBusy;
    if (!wasBusy || activeSessionBusy) return;
    if (!workspaceChangesRootPath || !changesCacheKey) return;
    refreshSessionChanges();
  }, [
    activeSessionBusy,
    workspaceChangesRootPath,
    changesCacheKey,
    refreshSessionChanges,
  ]);

  const openPreviewDirectory = useCallback(
    (relativePath: string) => {
      if (!activeWorkspace || !activeWorkspacePath) return;
      const key = directoryKey(relativePath);
      setPreviewDirectories((prev) => ({
        ...prev,
        [activeWorkspace.id]: key,
      }));
      if (!cacheRef.current[activeWorkspace.id]?.directories[key]) {
        void loadDirectory(activeWorkspace.id, activeWorkspacePath, key);
      }
    },
    [activeWorkspace, activeWorkspacePath, loadDirectory],
  );

  const renderDirectory = useCallback(
    (relativePath: string, level: number): ReactNode => {
      if (!activeTree) return null;
      const key = directoryKey(relativePath);
      const directory = activeTree.directories[key];

      if (!directory) return null;
      if (directory.status === 'loading' && directory.entries.length === 0) {
        return (
          <div
            className="flex h-7 items-center gap-2 px-2 text-xs text-fg-faint"
            style={{ paddingLeft: 10 + level * 14 }}
          >
            <Loader2 size={13} className="animate-spin text-accent" />
            <span>{t(locale, 'projectTree.loading')}</span>
          </div>
        );
      }
      if (directory.status === 'error' && directory.entries.length === 0) {
        return (
          <div
            className="flex items-start gap-2 px-2 py-1.5 text-xs leading-snug text-status-error"
            style={{ paddingLeft: 10 + level * 14 }}
          >
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span className="break-words">{directory.message}</span>
          </div>
        );
      }

      return (
        <>
          {directory.entries.map((entry) => {
            const entryKey = directoryKey(entry.relativePath);
            const expanded = activeTree.expanded[entryKey] === true;
            const isDirectory = entry.kind === 'directory';

            return (
              <div key={entry.path}>
                <button
                  type="button"
                  draggable
                  onDragStart={(event) => startEntryDrag(event, entry)}
                  onDrag={trackEntryDrag}
                  onDragEnd={finishEntryDrag}
                  onContextMenu={(event) => openEntryContextMenu(event, entry)}
                  onClick={() => {
                    if (isDirectory) {
                      toggleDirectory(entry);
                    } else {
                      setPreviewRef(fileRefFromEntry(entry));
                    }
                  }}
                  title={entry.path}
                  className={
                    'group flex h-7 w-full min-w-0 cursor-grab items-center gap-1.5 px-2 text-left text-xs transition-colors hover:bg-panel-2 hover:text-fg active:cursor-grabbing ' +
                    (entry.hidden ? 'text-fg-faint' : 'text-fg-dim')
                  }
                  style={{ paddingLeft: 8 + level * 14 }}
                >
                  {isDirectory ? (
                    <ChevronRight
                      size={13}
                      className={
                        'shrink-0 text-fg-faint transition-transform ' +
                        (expanded ? 'rotate-90' : '')
                      }
                    />
                  ) : (
                    <span className="w-[13px] shrink-0" />
                  )}
                  {isDirectory ? (
                    expanded ? (
                      <FolderOpen size={14} className="shrink-0 text-accent-2" />
                    ) : (
                      <Folder size={14} className="shrink-0 text-accent-2" />
                    )
                  ) : (
                    <File size={14} className="shrink-0 text-fg-faint" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                </button>
                {isDirectory && expanded && renderDirectory(entry.relativePath, level + 1)}
              </div>
            );
          })}
          {directory.status === 'ready' && directory.truncated && (
            <div
              className="px-2 py-1 text-[11px] text-fg-faint"
              style={{ paddingLeft: 10 + level * 14 }}
            >
              {t(locale, 'projectTree.truncated').replace(
                '{count}',
                String(directory.totalEntries),
              )}
            </div>
          )}
          {directory.status === 'error' && directory.entries.length > 0 && (
            <div
              className="px-2 py-1 text-[11px] text-status-error"
              style={{ paddingLeft: 10 + level * 14 }}
            >
              {directory.message}
            </div>
          )}
        </>
      );
    },
    [
      activeTree,
      finishEntryDrag,
      locale,
      openEntryContextMenu,
      startEntryDrag,
      toggleDirectory,
      trackEntryDrag,
    ],
  );

  const renderPreviewMode = useCallback((): ReactNode => {
    const directory = previewDirectoryState;
    const segments = previewDirectoryKey
      ? previewDirectoryKey.split('/').filter(Boolean)
      : [];
    let breadcrumbPath = '';
    const breadcrumbs = segments.map((segment) => {
      breadcrumbPath = directoryKey(
        breadcrumbPath ? `${breadcrumbPath}/${segment}` : segment,
      );
      return { label: segment, path: breadcrumbPath };
    });

    return (
      <div className="space-y-2 px-2 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] text-fg-faint">
          <button
            type="button"
            onClick={() => openPreviewDirectory('')}
            className="max-w-[7rem] truncate rounded px-1.5 py-0.5 hover:bg-panel-2 hover:text-fg"
            title={activeWorkspacePath}
          >
            {t(locale, 'projectTree.previewRoot')}
          </button>
          {breadcrumbs.map((crumb) => (
            <span key={crumb.path} className="flex min-w-0 items-center gap-1">
              <span>/</span>
              <button
                type="button"
                onClick={() => openPreviewDirectory(crumb.path)}
                className="max-w-[7rem] truncate rounded px-1.5 py-0.5 hover:bg-panel-2 hover:text-fg"
                title={crumb.path}
              >
                {crumb.label}
              </button>
            </span>
          ))}
          <span className="ml-auto shrink-0 rounded border border-border-soft px-1.5 py-0.5 text-[10px] text-fg-faint">
            {ENGINE_LABELS[projectEngine]}
          </span>
        </div>

        {!directory || (directory.status === 'loading' && directory.entries.length === 0) ? (
          <div className="flex h-16 items-center justify-center gap-2 text-xs text-fg-faint">
            <Loader2 size={14} className="animate-spin text-accent" />
            <span>{t(locale, 'projectTree.loading')}</span>
          </div>
        ) : directory.status === 'error' && directory.entries.length === 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-status-error/40 bg-status-error/10 p-2 text-xs leading-snug text-status-error">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span className="break-words">{directory.message}</span>
          </div>
        ) : directory.entries.length === 0 ? (
          <div className="px-2 py-8 text-center text-xs text-fg-faint">
            {t(locale, 'projectTree.previewEmpty')}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2">
            {directory.entries.map((entry) => {
              const key = thumbnailKey(entry);
              return (
                <PreviewCard
                  key={entry.path}
                  entry={entry}
                  engine={projectEngine}
                  thumbnailId={key}
                  thumbnail={isImageEntry(entry) ? thumbnailCache[key] : undefined}
                  onVisibilityChange={updateThumbnailVisibility}
                  onDragStart={(event) => startEntryDrag(event, entry)}
                  onDrag={trackEntryDrag}
                  onDragEnd={finishEntryDrag}
                  onContextMenu={(event) => openEntryContextMenu(event, entry)}
                  onOpen={() => {
                    if (entry.kind === 'directory') {
                      openPreviewDirectory(entry.relativePath);
                    } else {
                      setPreviewRef(fileRefFromEntry(entry));
                    }
                  }}
                />
              );
            })}
          </div>
        )}

        {directory?.status === 'ready' && directory.truncated && (
          <div className="px-1 text-[11px] text-fg-faint">
            {t(locale, 'projectTree.truncated').replace(
              '{count}',
              String(directory.totalEntries),
            )}
          </div>
        )}
        {directory?.status === 'error' && directory.entries.length > 0 && (
          <div className="px-1 text-[11px] text-status-error">{directory.message}</div>
        )}
      </div>
    );
  }, [
    activeWorkspacePath,
    locale,
    openEntryContextMenu,
    openPreviewDirectory,
    previewDirectoryKey,
    previewDirectoryState,
    projectEngine,
    finishEntryDrag,
    startEntryDrag,
    thumbnailCache,
    trackEntryDrag,
    updateThumbnailVisibility,
  ]);

  const renderSessionChanges = useCallback((): ReactNode => {
    if (!activeWorkspace || !workspaceChangesRootPath || !changesCacheKey) {
      return (
        <div className="px-3 py-4 text-sm leading-relaxed text-fg-faint">
          选择工作区后显示改动。
        </div>
      );
    }

    const snapshot = changesState.snapshot;
    if (changesState.status === 'loading' && !snapshot) {
      return (
        <div className="flex h-16 items-center justify-center gap-2 text-xs text-fg-faint">
          <Loader2 size={14} className="animate-spin text-accent" />
          <span>读取改动中</span>
        </div>
      );
    }

    if (changesState.status === 'error' && !snapshot) {
      return (
        <div className="px-2 py-2">
          <div className="flex items-start gap-2 rounded-md border border-status-error/40 bg-status-error/10 p-2 text-xs leading-snug text-status-error">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span className="break-words">{changesState.message}</span>
          </div>
        </div>
      );
    }

    if (!snapshot) {
      return (
        <div className="px-3 py-8 text-center text-xs leading-relaxed text-fg-faint">
          点击刷新读取当前工作区改动。
        </div>
      );
    }

    if (snapshot.files.length === 0) {
      return (
        <div className="px-3 py-8 text-center text-xs leading-relaxed text-fg-faint">
          当前工作区暂无文件改动。
        </div>
      );
    }

    const selectedFile = selectedChangeKey
      ? snapshot.files.find((file) => workspaceChangeFileKey(file) === selectedChangeKey) ?? null
      : null;
    const lineCount = changedLineCount(snapshot);
    const isVcsSnapshot = snapshot.source != null && snapshot.source !== 'snapshot';

    return (
      <div className="space-y-3 px-2 py-2">
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-fg-faint">
          <span className="truncate">
            {changeSourceLabel(snapshot.source)} · {snapshot.files.length} 个文件
            {lineCount > 0 ? ` · ${lineCount} 行` : ''}
          </span>
          <span className="ml-auto shrink-0">
            {formatCachedAt(locale, snapshot.generatedAtMs)}
          </span>
        </div>

        {changesState.status === 'error' && (
          <div className="flex items-start gap-2 rounded-md border border-status-error/40 bg-status-error/10 p-2 text-xs leading-snug text-status-error">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span className="break-words">{changesState.message}</span>
          </div>
        )}

        {selectedFile ? (
          <section className="space-y-2">
            <button
              type="button"
              onClick={() => setSelectedChangeKey(null)}
              className="text-[11px] text-fg-faint transition-colors hover:text-fg"
            >
              返回文件列表
            </button>
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg"
                title={selectedFile.path}
              >
                {selectedFile.path}
              </span>
              <span
                className={
                  'shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none ' +
                  changeStatusClass(selectedFile.status)
                }
              >
                {changeStatusLabel(selectedFile.status)}
              </span>
            </div>
            {selectedFile.oldPath && selectedFile.oldPath !== selectedFile.path && (
              <div
                className="truncate font-mono text-[10px] text-fg-faint"
                title={selectedFile.oldPath}
              >
                {selectedFile.oldPath}
              </div>
            )}
            {selectedFile.binary ? (
              <div className="rounded border border-border-soft bg-panel-2 px-2 py-1.5 text-[11px] text-fg-faint">
                二进制文件已变更，未展示行内容。
              </div>
            ) : selectedFile.lines.length === 0 ? (
              <div className="rounded border border-border-soft bg-panel-2 px-2 py-1.5 text-[11px] text-fg-faint">
                {isVcsSnapshot
                  ? '文件已变更，未读取行内容。'
                  : selectedFile.truncated
                  ? '内容未缓存或过大，无法展示行内容。'
                  : '无可展示文本行。'}
              </div>
            ) : (
              <div className="space-y-2">
                {buildWorkspaceChangeHunks(selectedFile.lines).map((hunk) => (
                  <div
                    key={hunk.key}
                    className="overflow-hidden rounded-md border border-border-soft bg-bg/55"
                  >
                    <div className="flex min-w-0 items-center gap-2 border-b border-border-soft/60 px-2 py-1.5 text-[10px] text-fg-faint">
                      <span
                        className={
                          'shrink-0 rounded border px-1.5 py-0.5 leading-none ' +
                          changeHunkStatusClass(hunk.status)
                        }
                      >
                        {changeStatusLabel(hunk.status)}
                      </span>
                      <span className="min-w-0 truncate font-mono">
                        {changeHunkLabel(hunk)}
                      </span>
                    </div>
                    <div className="overflow-x-auto py-1 font-mono text-[11px] leading-5">
                      {hunk.lines.map((line, index) => (
                        <div
                          key={`${line.oldLine ?? ''}:${line.newLine ?? ''}:${index}`}
                          className={
                            'flex min-w-max items-start gap-2 px-2 ' +
                            changeLineClass(line)
                          }
                        >
                          <span className="w-7 shrink-0 select-none text-right font-semibold">
                            {changeLineMarker(line)}
                          </span>
                          <span className="w-10 shrink-0 select-none text-right text-fg-faint">
                            {changeLineNumber(line)}
                          </span>
                          <code className="whitespace-pre pr-3">
                            {line.content || ' '}
                          </code>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {selectedFile.truncated && (
              <div className="mt-1 text-[10px] text-fg-faint">内容已截断。</div>
            )}
          </section>
        ) : (
          <div className="space-y-1.5">
            {snapshot.files.map((file) => {
              const fileKey = workspaceChangeFileKey(file);
              const hunkCount = file.binary ? 0 : buildWorkspaceChangeHunks(file.lines).length;
              return (
                <button
                  key={fileKey}
                  type="button"
                  onClick={() => setSelectedChangeKey(fileKey)}
                  className="group flex w-full min-w-0 items-center gap-2 rounded-md border border-border-soft bg-panel-2/60 px-2 py-2 text-left transition-colors hover:border-accent/45 hover:bg-panel-2"
                >
                  <span
                    className={
                      'shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none ' +
                      changeStatusClass(file.status)
                    }
                  >
                    {changeStatusLabel(file.status)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[11px] text-fg" title={file.path}>
                      {file.path}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-fg-faint">
                      {file.binary
                        ? '二进制文件'
                        : file.lines.length === 0 && file.truncated
                          ? isVcsSnapshot
                            ? '文件已变更'
                            : '内容未缓存'
                        : `${file.lines.length} 行 · ${hunkCount} 处`}
                      {!isVcsSnapshot && file.truncated ? ' · 已截断' : ''}
                    </span>
                  </span>
                  <ChevronRight
                    size={13}
                    className="shrink-0 text-fg-faint transition-colors group-hover:text-fg"
                  />
                </button>
              );
            })}
          </div>
        )}

        {snapshot.truncated && (
          <div className="text-[11px] text-fg-faint">
            改动过多，已截断显示。
          </div>
        )}
      </div>
    );
  }, [
    activeWorkspace,
    changesCacheKey,
    changesState,
    locale,
    selectedChangeKey,
    workspaceChangesRootPath,
  ]);

  const rootLoading = rootState?.status === 'loading';
  const canRefresh = Boolean(activeWorkspace && activeWorkspacePath && !rootLoading);
  const changesLoading = changesState.status === 'loading';
  const canRefreshChanges = Boolean(
    activeWorkspace && workspaceChangesRootPath && changesCacheKey && !changesLoading,
  );
  const activeSnapshot = changesState.snapshot;
  const changesRootTitle =
    activeSnapshot?.rootPath ?? workspaceChangesRootPath ?? activeWorkspacePath;

  return (
    <>
      <aside
        className="relative flex h-full shrink-0 flex-col border-l border-border bg-panel"
        style={{ width }}
      >
        <div
          onMouseDown={onResizeStart}
          title={t(locale, 'common.resizeWidth')}
          className="group absolute -left-1 bottom-0 top-0 z-20 flex w-2 cursor-col-resize items-center justify-center"
        >
          <div className="h-full w-0.5 bg-transparent transition-colors group-hover:bg-accent/40" />
        </div>

        <header className="shrink-0 border-b border-border-soft px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <div
              role="tablist"
              aria-label="右侧项目面板"
              className="flex min-w-0 flex-1 rounded-md border border-border-soft bg-panel-2 p-0.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={panelTab === 'files'}
                onClick={() => updatePanelTab('files')}
                className={
                  'flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded px-2 text-xs transition-colors hover:text-fg ' +
                  (panelTab === 'files' ? 'bg-panel text-fg' : 'text-fg-faint')
                }
              >
                <FolderOpen size={13} className="shrink-0 text-accent-2" />
                <span className="truncate">{t(locale, 'projectTree.title')}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={panelTab === 'changes'}
                onClick={() => updatePanelTab('changes')}
                className={
                  'flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded px-2 text-xs transition-colors hover:text-fg ' +
                  (panelTab === 'changes' ? 'bg-panel text-fg' : 'text-fg-faint')
                }
              >
                <FileDiff size={13} className="shrink-0 text-accent" />
                <span className="truncate">工作区改动</span>
                {activeSnapshot && activeSnapshot.files.length > 0 && (
                  <span className="shrink-0 rounded bg-accent/15 px-1 font-mono text-[10px] text-accent">
                    {activeSnapshot.files.length}
                  </span>
                )}
              </button>
            </div>
            {panelTab === 'files' && (
              <div className="ml-auto flex shrink-0 rounded-md border border-border-soft bg-panel-2 p-0.5">
              <button
                type="button"
                aria-pressed={viewMode === 'tree'}
                title={t(locale, 'projectTree.treeMode')}
                onClick={() => updateViewMode('tree')}
                className={
                  'flex h-6 w-6 items-center justify-center rounded text-fg-faint transition-colors hover:text-fg ' +
                  (viewMode === 'tree' ? 'bg-panel text-fg' : '')
                }
              >
                <List size={13} />
              </button>
              <button
                type="button"
                aria-pressed={viewMode === 'preview'}
                title={t(locale, 'projectTree.previewMode')}
                onClick={() => updateViewMode('preview')}
                className={
                  'flex h-6 w-6 items-center justify-center rounded text-fg-faint transition-colors hover:text-fg ' +
                  (viewMode === 'preview' ? 'bg-panel text-fg' : '')
                }
              >
                <LayoutGrid size={13} />
              </button>
              </div>
            )}
          </div>
          <div
            className="mt-1 truncate font-mono text-[10px] text-fg-faint"
            title={panelTab === 'changes' ? changesRootTitle : activeWorkspacePath}
          >
            {panelTab === 'changes' && activeSnapshot
              ? `${changeSourceLabel(activeSnapshot.source)} · ${formatCachedAt(locale, activeSnapshot.generatedAtMs)}`
              : activeWorkspace?.name ?? t(locale, 'projectTree.noWorkspace')}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto py-1">
          {panelTab === 'changes' ? (
            renderSessionChanges()
          ) : !activeWorkspace || !activeWorkspacePath ? (
            <div className="px-3 py-4 text-sm leading-relaxed text-fg-faint">
              {t(locale, 'projectTree.empty')}
            </div>
          ) : viewMode === 'preview' ? (
            renderPreviewMode()
          ) : (
            renderDirectory('', 0)
          )}
        </div>

        <div className="shrink-0 border-t border-border-soft p-2">
          <button
            type="button"
            disabled={panelTab === 'changes' ? !canRefreshChanges : !canRefresh}
            onClick={panelTab === 'changes' ? refreshSessionChanges : refreshActiveWorkspace}
            title={panelTab === 'changes' ? '刷新工作区改动' : t(locale, 'projectTree.refresh')}
            className="flex h-8 w-full items-center justify-center gap-2 rounded-md border border-border bg-panel-2 px-2 text-sm text-fg-dim transition-colors hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw
              size={14}
              className={
                rootLoading || changesLoading ? 'animate-spin text-accent' : 'text-fg-faint'
              }
            />
            <span>
              {panelTab === 'changes'
                ? changesLoading
                  ? '刷新中'
                  : '刷新改动'
                : rootLoading
                  ? t(locale, 'projectTree.refreshing')
                  : t(locale, 'projectTree.refresh')}
            </span>
          </button>
        </div>
      </aside>

      {contextMenu && (
        <ProjectEntryContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          label={t(locale, 'projectTree.revealInExplorer')}
          onReveal={revealContextMenuEntry}
        />
      )}

      <FilePreviewDrawer
        refData={previewRef}
        cwd={activeWorkspacePath || undefined}
        onClose={() => setPreviewRef(null)}
      />
    </>
  );
}
