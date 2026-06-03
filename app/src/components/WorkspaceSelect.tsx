import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { basename, pickFolder } from '@/lib/folderPicker';
import { t } from '@/lib/i18n';
import {
  uniqueWorkspaceHistory,
  workspacePathKey,
} from '@/lib/workspaceHistory';
import { useStore } from '@/store/useStore';

/**
 * Workspace selector for the AI-input composer.
 *
 * Unlike the generic Select, this has no default option list: the menu offers a
 * "选择文件夹…" action that opens the native folder dialog (Tauri) or the
 * browser fallback, and lists the user's previously-selected folders. Pops
 * upward (the composer sits at the bottom of the screen) and closes on an
 * outside click.
 */
export interface WorkspaceSelectProps {
  /** Current workspace path ('' = none chosen). */
  value: string;
  /** Previously-selected folders, most-recent-first. */
  history: string[];
  /** Commit a chosen path (sets current + records in history). */
  onSelect: (path: string) => void;
  disabled?: boolean;
  className?: string;
}

export default function WorkspaceSelect({
  value,
  history,
  onSelect,
  disabled = false,
  className,
}: WorkspaceSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const locale = useStore((s) => s.locale);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
      return;
    }
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [disabled, open]);

  const browse = async () => {
    if (disabled) return;
    const path = await pickFolder(t(locale, 'workspace.chooseFolder'));
    setOpen(false);
    if (path) onSelect(path);
  };

  const label = value ? basename(value) : t(locale, 'workspace.choose');
  const historyOptions = uniqueWorkspaceHistory(history);
  const valueKey = value ? workspacePathKey(value) : '';

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        title={value || t(locale, 'workspace.chooseFolder')}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
          open
            ? 'border-accent bg-border-soft text-fg'
            : 'border-border bg-panel-2 text-fg-dim hover:border-accent hover:text-fg',
          'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-fg-dim',
        )}
      >
        <span className="text-fg-faint">🗂</span>
        <span className="max-w-[10rem] truncate">{label}</span>
        <span className="text-[9px] text-fg-faint">▾</span>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-10 mb-1 min-w-[14rem] overflow-hidden rounded-md border border-border bg-panel py-1 shadow-lg">
          <button
            type="button"
            onClick={browse}
            className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-xs text-fg transition-colors hover:bg-border-soft"
          >
            <span className="text-[11px]">📁</span>
            <span>{t(locale, 'workspace.pickFolder')}</span>
          </button>

          <div className="my-1 border-t border-border-soft" />

          <div className="px-3 pb-0.5 text-[10px] uppercase tracking-wider text-fg-faint">
            {t(locale, 'sidebar.history')}
          </div>
          {historyOptions.length === 0 ? (
            <div className="px-3 py-1.5 text-xs text-fg-faint">
              {t(locale, 'workspace.noHistory')}
            </div>
          ) : (
            <ul role="listbox">
              {historyOptions.map((path) => {
                const active =
                  valueKey !== '' && workspacePathKey(path) === valueKey;
                return (
                  <li key={workspacePathKey(path)}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      title={path}
                      onClick={() => {
                        if (disabled) return;
                        onSelect(path);
                        setOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-xs transition-colors',
                        active
                          ? 'bg-border-soft text-fg'
                          : 'text-fg-dim hover:bg-border-soft hover:text-fg',
                      )}
                    >
                      <span
                        className={cn(
                          'text-[10px] leading-none',
                          active ? 'text-accent' : 'text-transparent',
                        )}
                      >
                        ●
                      </span>
                      <span className="max-w-[16rem] truncate">
                        {basename(path)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
