import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, DownloadCloud, SquareTerminal, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  loadShortcutSettings,
  matchesShortcut,
  subscribeShortcutSettings,
} from '@/lib/keyboardShortcuts';
import {
  isTauri,
  localModelHardware,
  openExternal,
  setupLocalModel,
  type LocalModelHardware,
} from '@/lib/tauri';
import { t, type Locale, type TranslationKey } from '@/lib/i18n';

interface LocalModelProfile {
  id: string;
  label: string;
  minRamGb: number;
  noteKey: TranslationKey;
}

const LOCAL_MODEL_PROFILES: LocalModelProfile[] = [
  {
    id: 'llama3.2:3b',
    label: 'Light 3B',
    minRamGb: 8,
    noteKey: 'settings.localModel.option3b',
  },
  {
    id: 'qwen2.5-coder:7b',
    label: 'Coder 7B',
    minRamGb: 16,
    noteKey: 'settings.localModel.option7b',
  },
  {
    id: 'qwen2.5-coder:14b',
    label: 'Coder 14B',
    minRamGb: 32,
    noteKey: 'settings.localModel.option14b',
  },
  {
    id: 'qwen2.5-coder:32b',
    label: 'Coder 32B',
    minRamGb: 64,
    noteKey: 'settings.localModel.option32b',
  },
];

function recommendedLocalModelId(hardware: LocalModelHardware): string {
  const ram = Number(hardware.ramGb ?? 0);
  const cores = Number(hardware.cpuThreads ?? 0);
  const vram = Number(hardware.gpuVramGb ?? 0);
  if (vram >= 24 || (ram >= 64 && cores >= 16)) return 'qwen2.5-coder:32b';
  if (vram >= 12 || (ram >= 32 && cores >= 8)) return 'qwen2.5-coder:14b';
  if (vram >= 6 || (ram >= 16 && cores >= 4)) return 'qwen2.5-coder:7b';
  return 'llama3.2:3b';
}

function fallbackLocalHardware(): LocalModelHardware {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const memory =
    nav && typeof (nav as Navigator & { deviceMemory?: unknown }).deviceMemory === 'number'
      ? (nav as Navigator & { deviceMemory: number }).deviceMemory
      : null;
  return {
    ramGb: memory,
    cpuThreads: nav?.hardwareConcurrency ?? null,
    gpuVramGb: null,
  };
}

function formatHardwareValue(value: number | null | undefined, suffix: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '-';
  }
  return `${value}${suffix}`;
}

export default function LocalModelSetupDialog({
  locale,
  downloadUrl,
  statusMessage,
  onClose,
  onModelSelected,
}: {
  locale: Locale;
  downloadUrl?: string;
  statusMessage?: string | null;
  onClose: () => void;
  onModelSelected: (model: string) => void;
}) {
  const initialHardware = useMemo(() => fallbackLocalHardware(), []);
  const [hardware, setHardware] = useState<LocalModelHardware>(initialHardware);
  const [selectedModel, setSelectedModel] = useState(() =>
    recommendedLocalModelId(initialHardware),
  );
  const [loadingHardware, setLoadingHardware] = useState(true);
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shortcutSettings, setShortcutSettingsState] = useState(
    loadShortcutSettings,
  );
  const userPickedRef = useRef(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, shortcutSettings['modal-close'])) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, shortcutSettings]);

  useEffect(
    () => subscribeShortcutSettings(setShortcutSettingsState),
    [],
  );

  useEffect(() => {
    let disposed = false;
    setLoadingHardware(true);
    void localModelHardware()
      .then((info) => {
        if (disposed) return;
        setHardware(info);
        if (!userPickedRef.current) {
          setSelectedModel(recommendedLocalModelId(info));
        }
      })
      .catch(() => {
        if (!disposed) setHardware(initialHardware);
      })
      .finally(() => {
        if (!disposed) setLoadingHardware(false);
      });
    return () => {
      disposed = true;
    };
  }, [initialHardware]);

  const recommendedModel = recommendedLocalModelId(hardware);
  const hardwareSummary = [
    `${t(locale, 'settings.localModel.ram')}: ${formatHardwareValue(hardware.ramGb, 'GB')}`,
    `${t(locale, 'settings.localModel.cpu')}: ${formatHardwareValue(hardware.cpuThreads, '')}`,
    `${t(locale, 'settings.localModel.vram')}: ${formatHardwareValue(hardware.gpuVramGb, 'GB')}`,
  ].join(' · ');

  const selectModel = (model: string) => {
    userPickedRef.current = true;
    setSelectedModel(model);
    setStarted(false);
    setError(null);
  };

  const runSetup = async () => {
    if (!isTauri()) {
      setError(t(locale, 'settings.localModel.desktopOnly'));
      return;
    }
    setStarting(true);
    setError(null);
    try {
      await setupLocalModel(selectedModel);
      setStarted(true);
      onModelSelected(selectedModel);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t(locale, 'settings.localModel.setupFailed'),
      );
    } finally {
      setStarting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/60 sm:flex sm:items-center sm:justify-center sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-model-setup-title"
        data-settings-child-modal="true"
        className="fixed inset-x-0 bottom-0 flex max-h-[calc(100vh-1rem)] flex-col overflow-hidden rounded-t-lg border border-border bg-panel shadow-2xl sm:relative sm:inset-auto sm:max-h-[calc(100vh-3rem)] sm:w-[min(760px,calc(100vw-2rem))] sm:rounded-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-border-soft bg-bg-alt px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <SquareTerminal size={18} strokeWidth={2.2} />
            </span>
            <div className="min-w-0 flex-1">
              <h3
                id="local-model-setup-title"
                className="text-base font-semibold text-fg"
              >
                {t(locale, 'settings.localModel.title')}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-fg-faint">
                {t(locale, 'settings.localModel.description')}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              title={t(locale, 'common.close')}
              aria-label={t(locale, 'common.close')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-panel-2 text-fg-faint transition-colors hover:border-accent hover:text-fg"
            >
              <X size={15} strokeWidth={2.2} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-3 rounded-md border border-border-soft bg-bg-alt px-3 py-2 text-[11px] leading-relaxed text-fg-faint">
            {loadingHardware
              ? t(locale, 'settings.localModel.detecting')
              : hardwareSummary}
          </div>
          {statusMessage && (
            <p className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
              {statusMessage}
            </p>
          )}
          <div className="grid gap-2">
            {LOCAL_MODEL_PROFILES.map((profile) => {
              const active = selectedModel === profile.id;
              const recommended = profile.id === recommendedModel;
              return (
                <button
                  key={profile.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => selectModel(profile.id)}
                  className={cn(
                    'w-full rounded-lg border p-3 text-left transition-colors',
                    active
                      ? 'border-accent bg-accent/10 text-fg'
                      : 'border-border bg-bg-alt text-fg-dim hover:border-accent/50 hover:text-fg',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                        active
                          ? 'border-accent bg-accent text-bg'
                          : 'border-border bg-panel text-transparent',
                      )}
                    >
                      <Check size={12} strokeWidth={2.6} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-fg">
                          {profile.id}
                        </span>
                        <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-fg-faint">
                          {profile.label}
                        </span>
                        {recommended && (
                          <span className="rounded border border-emerald-500/40 px-1.5 py-0.5 text-[10px] text-emerald-300">
                            {t(locale, 'settings.localModel.recommended')}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-fg-faint">
                        {t(locale, profile.noteKey)}
                      </p>
                    </div>
                    <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-fg-faint">
                      {profile.minRamGb}GB+
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-fg-faint">
            {t(locale, 'settings.localModel.setupHint')}
          </p>
          {started && (
            <p className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] leading-relaxed text-emerald-200">
              {t(locale, 'settings.localModel.setupStarted')}
            </p>
          )}
          {error && (
            <p className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-200">
              {error}
            </p>
          )}
        </div>

        <div className="shrink-0 border-t border-border-soft bg-bg-alt px-5 py-3">
          <div className="flex items-center justify-end gap-2">
            {downloadUrl && (
              <button
                type="button"
                onClick={() => void openExternal(downloadUrl)}
                className="rounded border border-border bg-panel px-3 py-1.5 text-xs text-fg-dim transition-colors hover:border-accent hover:text-fg"
              >
                {t(locale, 'dock.localModelDownload')}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-border bg-panel px-3 py-1.5 text-xs text-fg-dim transition-colors hover:border-accent hover:text-fg"
            >
              {t(locale, 'common.close')}
            </button>
            <button
              type="button"
              onClick={() => void runSetup()}
              disabled={starting}
              className="inline-flex items-center gap-1.5 rounded border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-bg transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <DownloadCloud
                size={14}
                strokeWidth={2.2}
                className={starting ? 'animate-pulse' : undefined}
              />
              {starting
                ? t(locale, 'settings.localModel.starting')
                : t(locale, 'settings.localModel.startSetup')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
