import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  DownloadCloud,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe,
  Info,
  Keyboard,
  KeyRound,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Sparkles,
  SquareTerminal,
  Trash2,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  RUNTIME_ADAPTERS,
  runtimeAdapterLabel,
  type RuntimeAdapterId,
} from '@/lib/adapters';
import { DEFAULT_MODEL } from '@/lib/anthropic';
import {
  addProvider,
  deleteProvider,
  getActiveProviderIds,
  getProviderRuntimeInfo,
  isProviderBaseUrlValid,
  listProviders,
  providerMetadataSignature,
  setActiveProviderId,
  updateProvider,
  type Provider,
  type ProviderRuntimeStatus,
} from '@/lib/apiConfig';
import { importCcSwitchProviders } from '@/lib/ccSwitchAutoImport';
import {
  isTauri,
  openExternal,
  validateCliPath,
  validateShellPath,
} from '@/lib/tauri';
import {
  APP_VERSION,
  REPO_URL,
  RELEASES_URL,
  checkForUpdate,
  openDownload,
  type UpdateStatus,
} from '@/lib/updateCheck';
import {
  getRunShell,
  setRunShell,
  type RunShellConfig,
  type RunShellKind,
} from '@/lib/shellConfig';
import {
  getCliRuntimeSnapshot,
  isCliAdapterAvailable,
  primeCliRuntime,
  saveCliCandidateSelection,
  saveCustomCliPathSelection,
  selectedCliCandidateId,
  subscribeCliRuntime,
  type CliCandidate,
  type CliRuntimeSnapshot,
} from '@/lib/cliConfig';
import { basename, pickFile } from '@/lib/folderPicker';
import {
  LANGUAGE_SELECT_OPTIONS,
  localizeSelectOption,
  t,
  type Locale,
  type TranslationKey,
} from '@/lib/i18n';
import {
  DEFAULT_STYLE_PRESET_ID,
  STYLE_PRESET_LIST,
  isUnsupportedStylePreset,
  resolveStylePresetId,
  type StylePresetDefinition,
} from '@/lib/appearance';
import { useStore } from '@/store/useStore';

type SettingsTab =
  | 'general'
  | 'models'
  | 'shortcuts'
  | 'runtime'
  | 'appearance'
  | 'advanced'
  | 'about';
type LanguageOption = (typeof LANGUAGE_SELECT_OPTIONS)[number];
type PlaceholderTabId = Exclude<
  SettingsTab,
  'general' | 'models' | 'shortcuts' | 'appearance' | 'about'
>;

const tabs: { id: SettingsTab; labelKey: TranslationKey; Icon: LucideIcon }[] = [
  { id: 'general', labelKey: 'settings.tabs.general', Icon: SlidersHorizontal },
  { id: 'models', labelKey: 'settings.tabs.models', Icon: KeyRound },
  { id: 'shortcuts', labelKey: 'settings.tabs.shortcuts', Icon: Keyboard },
  { id: 'runtime', labelKey: 'settings.tabs.runtime', Icon: SquareTerminal },
  { id: 'appearance', labelKey: 'settings.tabs.appearance', Icon: Palette },
  { id: 'advanced', labelKey: 'settings.tabs.advanced', Icon: Wrench },
  { id: 'about', labelKey: 'settings.tabs.about', Icon: Info },
];

const placeholderCopy: Record<
  PlaceholderTabId,
  { titleKey: TranslationKey; descriptionKey: TranslationKey }
> = {
  runtime: {
    titleKey: 'settings.runtimeTitle',
    descriptionKey: 'settings.runtimeDescription',
  },
  advanced: {
    titleKey: 'settings.advancedTitle',
    descriptionKey: 'settings.advancedDescription',
  },
};

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<SettingsTab>('general');
  const cliRuntime = useCliRuntimeState();
  const locale = useStore((s) => s.locale);
  const setLocale = useStore((s) => s.setLocale);
  const promptAutoTranslate = useStore((s) => s.promptAutoTranslate);
  const setPromptAutoTranslate = useStore((s) => s.setPromptAutoTranslate);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('[data-provider-editor="true"]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const languageOptions = LANGUAGE_SELECT_OPTIONS.map((option) =>
    localizeSelectOption(option, locale),
  );
  const targetLanguages = languageOptions.filter(
    (option) => option.id !== locale,
  );
  const panelId = `settings-panel-${tab}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="flex h-[86vh] w-[calc(100vw-2rem)] max-w-[980px] max-h-[660px] flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl sm:w-[calc(100vw-3rem)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-border-soft bg-bg-alt px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-bg">
              <SettingsIcon size={18} strokeWidth={2.2} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="settings-title" className="text-base font-semibold text-fg">
                {t(locale, 'settings.title')}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-fg-faint">
                {t(locale, 'settings.subtitle')}
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

        <div className="min-h-0 flex flex-1 flex-col bg-border-soft sm:flex-row">
          <nav
            aria-label={t(locale, 'settings.title')}
            className="w-full shrink-0 overflow-y-auto border-b border-border-soft bg-bg-alt p-3 sm:w-52 sm:border-b-0 sm:border-r"
          >
            <div
              role="tablist"
              aria-orientation="vertical"
              className="flex flex-col gap-1"
            >
              {tabs.map((item) => {
                const active = item.id === tab;
                const Icon = item.Icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    id={`settings-tab-${item.id}`}
                    role="tab"
                    aria-selected={active}
                    aria-controls={`settings-panel-${item.id}`}
                    onClick={() => setTab(item.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-sm font-medium transition-colors',
                      active
                        ? 'border border-accent bg-accent/15 text-fg'
                        : 'border border-transparent text-fg-dim hover:bg-border-soft hover:text-fg',
                    )}
                  >
                    <Icon
                      size={15}
                      strokeWidth={2}
                      className={active ? 'text-accent' : 'text-fg-faint'}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {t(locale, item.labelKey)}
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>

          <section
            id={panelId}
            role="tabpanel"
            aria-labelledby={`settings-tab-${tab}`}
            className="min-w-0 flex-1 overflow-y-auto bg-panel px-6 py-5 md:px-7 md:py-6"
          >
            <div className="mx-auto max-w-3xl">
              {tab === 'general' ? (
                <GeneralSettings
                  locale={locale}
                  cliRuntime={cliRuntime}
                  languageOptions={languageOptions}
                  targetLanguages={targetLanguages}
                  promptAutoTranslate={promptAutoTranslate}
                  setLocale={setLocale}
                  setPromptAutoTranslate={setPromptAutoTranslate}
                />
              ) : tab === 'models' ? (
                <ModelsSettings locale={locale} cliRuntime={cliRuntime} />
              ) : tab === 'shortcuts' ? (
                <ShortcutsSettings locale={locale} />
              ) : tab === 'appearance' ? (
                <AppearanceSettings locale={locale} />
              ) : tab === 'about' ? (
                <AboutSettings locale={locale} />
              ) : (
                <PlaceholderTab tab={tab} locale={locale} />
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function useCliRuntimeState(): CliRuntimeSnapshot {
  const [state, setState] = useState<CliRuntimeSnapshot>(() =>
    getCliRuntimeSnapshot(),
  );

  useEffect(() => {
    setState(getCliRuntimeSnapshot());
    const unsubscribe = subscribeCliRuntime(setState);
    void primeCliRuntime();
    return unsubscribe;
  }, []);

  return state;
}

function GeneralSettings({
  locale,
  cliRuntime,
  languageOptions,
  targetLanguages,
  promptAutoTranslate,
  setLocale,
  setPromptAutoTranslate,
}: {
  locale: Locale;
  cliRuntime: CliRuntimeSnapshot;
  languageOptions: LanguageOption[];
  targetLanguages: LanguageOption[];
  promptAutoTranslate: boolean;
  setLocale: (locale: Locale) => void;
  setPromptAutoTranslate: (enabled: boolean) => void;
}) {
  const selectedAdapter = useStore((s) =>
    normalizeRuntimeAdapter(s.workflow.meta.adapter),
  );
  const [cliError, setCliError] = useState<string | null>(null);
  const [pickingCli, setPickingCli] = useState(false);
  const cliOptions = useMemo(
    () =>
      cliRuntime.candidates.filter(
        (candidate) =>
          candidate.status === 'available' || candidate.source === 'custom',
      ),
    [cliRuntime.candidates],
  );
  const activeCliId = selectedCliCandidateId(cliRuntime);
  const activeCli =
    cliOptions.find((candidate) => candidate.id === activeCliId) ??
    cliRuntime.candidates.find((candidate) => candidate.id === activeCliId);
  const trigger = cliTriggerLabel(cliRuntime, activeCli, selectedAdapter, locale);
  const cliHelp = cliHelpText(cliRuntime, cliOptions, locale);
  const cliMigrationNotice = cliMigrationNoticeText(
    cliRuntime.config.migrationNotice,
    locale,
  );
  const cliBusy = cliRuntime.status === 'loading' || pickingCli;

  const selectCliCandidate = async (candidateId: string) => {
    const candidate = cliOptions.find((item) => item.id === candidateId);
    if (!candidate || candidate.status !== 'available') return;
    try {
      await saveCliCandidateSelection(candidate);
      setCliError(null);
    } catch (err) {
      setCliError(cliErrorText(err, locale, 'save'));
    }
  };

  const selectCustomCli = async () => {
    if (!isTauri()) {
      setCliError(t(locale, 'settings.cliDesktopOnly'));
      return;
    }
    setPickingCli(true);
    try {
      const path = await pickFile(t(locale, 'settings.cliPickTitle'));
      if (!path) return;
      const validation = await validateCliPath(path);
      await saveCustomCliPathSelection(selectedAdapter, validation);
      setCliError(null);
    } catch (err) {
      setCliError(cliErrorText(err, locale, 'path'));
    } finally {
      setPickingCli(false);
    }
  };

  // Launch shell that wraps AI CLI invocations (independent of the model CLI).
  const [runShell, setRunShellState] = useState<RunShellConfig>(() =>
    getRunShell(),
  );
  const [shellError, setShellError] = useState<string | null>(null);

  const applyShell = (config: RunShellConfig) => {
    setRunShell(config);
    setRunShellState(config);
  };

  const selectShellKind = async (kind: RunShellKind) => {
    setShellError(null);
    if (kind !== 'custom') {
      applyShell({ kind });
      return;
    }
    if (!isTauri()) {
      setShellError(t(locale, 'settings.cliDesktopOnly'));
      return;
    }
    try {
      const path = await pickFile(t(locale, 'settings.shellPickTitle'));
      if (!path) return;
      const normalized = await validateShellPath(path);
      applyShell({ kind: 'custom', path: normalized });
    } catch (err) {
      setShellError(stripCliErrorPrefix(err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-fg">
          {t(locale, 'settings.generalTitle')}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-fg-faint">
          {t(locale, 'settings.generalDescription')}
        </p>
      </div>

      <SettingRow
        title={t(locale, 'settings.languageLabel')}
        description={t(locale, 'settings.languageDescription')}
      >
        <div className="flex flex-wrap gap-2">
          {languageOptions.map((option) => {
            const active = option.id === locale;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                onClick={() => setLocale(option.id)}
                className={cn(
                  'flex min-w-[9.5rem] items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                  active
                    ? 'border-accent bg-accent/15 text-fg'
                    : 'border-border bg-panel text-fg-dim hover:border-accent hover:text-fg',
                )}
              >
                <span className="truncate">{option.label}</span>
                {option.hint && (
                  <span className="rounded bg-border-soft px-1.5 py-0.5 font-mono text-[10px] text-fg-faint">
                    {option.hint}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </SettingRow>

      <SettingRow
        title={t(locale, 'settings.autoTranslateLabel')}
        description={t(locale, 'settings.autoTranslateDescription')}
      >
        <button
          type="button"
          role="switch"
          aria-checked={promptAutoTranslate}
          onClick={() => setPromptAutoTranslate(!promptAutoTranslate)}
          className={cn(
            'relative h-6 w-11 rounded-full border transition-colors',
            promptAutoTranslate
              ? 'border-accent bg-accent/25'
              : 'border-border bg-panel-2',
          )}
        >
          <span
            className={cn(
              'absolute left-0.5 top-0.5 h-5 w-5 rounded-full transition-transform',
              promptAutoTranslate
                ? 'translate-x-5 bg-accent'
                : 'translate-x-0 bg-fg-faint',
            )}
          />
        </button>
      </SettingRow>

      <SettingRow
        title={t(locale, 'settings.cliLabel')}
        description={t(locale, 'settings.cliDescription')}
      >
        <div className="w-full max-w-[24rem] space-y-2">
          <CliSelectControl
            activeId={activeCliId}
            customLabel={t(locale, 'settings.cliCustom')}
            disabled={false}
            emptyLabel={t(locale, 'settings.cliEmpty')}
            loading={cliBusy}
            loadingLabel={t(locale, 'settings.cliLoading')}
            options={cliOptions.map((candidate) =>
              cliCandidateOption(candidate, locale),
            )}
            triggerHint={trigger.hint}
            triggerLabel={trigger.label}
            onCustom={selectCustomCli}
            onSelect={selectCliCandidate}
          />
          {cliHelp && (
            <p className="text-xs leading-relaxed text-fg-faint">{cliHelp}</p>
          )}
          {cliMigrationNotice && (
            <p className="text-xs leading-relaxed text-amber-300">
              {cliMigrationNotice}
            </p>
          )}
          {cliError && (
            <p className="text-xs leading-relaxed text-[#f78b8b]">
              {cliError}
            </p>
          )}
        </div>
      </SettingRow>

      <SettingRow
        title={t(locale, 'settings.shellLabel')}
        description={t(locale, 'settings.shellDescription')}
      >
        <div className="w-full max-w-[24rem] space-y-2">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['direct', 'settings.shellDirect'],
                ['cmd', 'settings.shellCmd'],
                ['powershell', 'settings.shellPowershell'],
                ['custom', 'settings.shellCustom'],
              ] as Array<[RunShellKind, TranslationKey]>
            ).map(([kind, labelKey]) => {
              const active = runShell.kind === kind;
              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    void selectShellKind(kind);
                  }}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs transition-colors',
                    active
                      ? 'border-accent bg-accent/15 text-fg'
                      : 'border-border bg-panel text-fg-dim hover:border-accent hover:text-fg',
                  )}
                >
                  {t(locale, labelKey)}
                </button>
              );
            })}
          </div>
          {runShell.kind === 'custom' && runShell.path && (
            <p className="truncate font-mono text-[11px] text-fg-faint" title={runShell.path}>
              {runShell.path}
            </p>
          )}
          <p className="text-xs leading-relaxed text-fg-faint">
            {t(locale, 'settings.shellHint')}
          </p>
          {shellError && (
            <p className="text-xs leading-relaxed text-[#f78b8b]">{shellError}</p>
          )}
        </div>
      </SettingRow>

      <SettingRow title={t(locale, 'settings.targetLanguages')}>
        <div className="flex flex-wrap gap-2">
          {targetLanguages.map((option) => (
            <span
              key={option.id}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
                promptAutoTranslate
                  ? 'border-accent/40 bg-accent/10 text-fg'
                  : 'border-border bg-panel text-fg-faint',
              )}
            >
              <span>{option.label}</span>
              {option.hint && (
                <span className="font-mono text-[10px] text-fg-faint">
                  {option.hint}
                </span>
              )}
            </span>
          ))}
        </div>
      </SettingRow>
    </div>
  );
}

interface CliSelectOption {
  id: string;
  label: string;
  hint?: string;
  note?: string;
  disabled?: boolean;
}

function CliSelectControl({
  activeId,
  customLabel,
  disabled,
  emptyLabel,
  loading,
  loadingLabel,
  options,
  triggerHint,
  triggerLabel,
  onCustom,
  onSelect,
}: {
  activeId: string | null;
  customLabel: string;
  disabled?: boolean;
  emptyLabel: string;
  loading: boolean;
  loadingLabel: string;
  options: CliSelectOption[];
  triggerHint?: string;
  triggerLabel: string;
  onCustom: () => void;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex min-h-9 w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
          open
            ? 'border-accent bg-border-soft text-fg'
            : 'border-border bg-panel text-fg-dim hover:border-accent hover:text-fg',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <SquareTerminal size={15} strokeWidth={2.1} className="shrink-0 text-fg-faint" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-fg">{triggerLabel}</span>
          {triggerHint && (
            <span className="mt-0.5 block truncate font-mono text-[10px] text-fg-faint">
              {triggerHint}
            </span>
          )}
        </span>
        <ChevronDown
          size={15}
          strokeWidth={2.1}
          className={cn('shrink-0 text-fg-faint transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-full min-w-[18rem] max-w-[24rem] overflow-hidden rounded-md border border-border bg-panel py-1 shadow-xl">
          {loading ? (
            <div className="px-3 py-2 text-xs text-fg-faint">{loadingLabel}</div>
          ) : options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-fg-faint">{emptyLabel}</div>
          ) : (
            <ul role="listbox">
              {options.map((option) => {
                const active = option.id === activeId;
                return (
                  <li key={option.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      disabled={option.disabled}
                      onClick={() => {
                        if (option.disabled) return;
                        onSelect(option.id);
                        setOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors',
                        option.disabled
                          ? 'cursor-not-allowed text-fg-faint opacity-70'
                          : active
                            ? 'bg-border-soft text-fg'
                            : 'text-fg-dim hover:bg-border-soft hover:text-fg',
                      )}
                    >
                      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                        {active && <Check size={12} strokeWidth={2.4} className="text-accent" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{option.label}</span>
                        {(option.hint || option.note) && (
                          <span className="mt-0.5 block truncate text-[10px] text-fg-faint">
                            {option.note ?? option.hint}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="my-1 border-t border-border-soft" />
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setOpen(false);
              onCustom();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-fg transition-colors hover:bg-border-soft disabled:cursor-wait disabled:text-fg-faint"
          >
            <FolderOpen size={13} strokeWidth={2.1} className="text-fg-faint" />
            <span>{customLabel}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function cliCandidateOption(
  candidate: CliCandidate,
  locale: Locale,
): CliSelectOption {
  const path = candidate.path ?? candidate.command;
  const name = candidate.source === 'custom' ? basename(path) : candidate.command;
  const label =
    candidate.source === 'custom'
      ? `${runtimeAdapterLabel(candidate.adapter)} · ${name}`
      : runtimeAdapterLabel(candidate.adapter);
  const note =
    candidate.status === 'available'
      ? undefined
      : cliCandidateStatusText(candidate, locale);
  return {
    id: candidate.id,
    label,
    hint: candidate.source === 'custom' ? path : candidate.path ?? candidate.command,
    note,
    disabled: candidate.status !== 'available',
  };
}

function cliTriggerLabel(
  runtime: CliRuntimeSnapshot,
  active: CliCandidate | undefined,
  selectedAdapter: RuntimeAdapterId,
  locale: Locale,
): { label: string; hint?: string } {
  const selected = runtime.config.selected;
  if (active) {
    const option = cliCandidateOption(active, locale);
    return { label: option.label, hint: option.hint };
  }
  if (selected.kind === 'known') {
    return {
      label: runtimeAdapterLabel(selected.adapter),
      hint: selected.pathHint ?? selected.command,
    };
  }
  if (selected.kind === 'path') {
    return {
      label: `${runtimeAdapterLabel(selected.adapter)} · ${basename(selected.path)}`,
      hint: selected.path,
    };
  }
  const adapterCandidate = runtime.candidates.find(
    (candidate) =>
      candidate.adapter === selectedAdapter && candidate.status === 'available',
  );
  if (adapterCandidate) {
    return {
      label: t(locale, 'settings.cliAuto'),
      hint: `${runtimeAdapterLabel(selectedAdapter)} · ${
        adapterCandidate.path ?? adapterCandidate.command
      }`,
    };
  }
  return { label: t(locale, 'settings.cliNone') };
}

function cliHelpText(
  runtime: CliRuntimeSnapshot,
  options: CliCandidate[],
  locale: Locale,
): string {
  if (runtime.status === 'loading') return t(locale, 'settings.cliLoading');
  if (runtime.status === 'error') return t(locale, 'settings.cliScanFailed');
  const selected = runtime.config.selected;
  const activeId = selectedCliCandidateId(runtime);
  const active = runtime.candidates.find((candidate) => candidate.id === activeId);
  if (active && active.status !== 'available') {
    return cliCandidateStatusText(active, locale);
  }
  if (options.length === 0) return t(locale, 'settings.cliEmptyHint');
  if (selected.kind === 'path') return t(locale, 'settings.cliCustomHint');
  return t(locale, 'settings.cliAutoHint');
}

function cliMigrationNoticeText(
  notice: CliRuntimeSnapshot['config']['migrationNotice'],
  locale: Locale,
): string {
  if (!notice) return '';
  const value = compactCliNoticeValue(notice.raw);
  const suffix = value ? ` (${value})` : '';
  if (notice.code === 'legacy-shell-wrapper') {
    return t(locale, 'settings.cliLegacyShellWrapper').replace(
      '{value}',
      suffix,
    );
  }
  if (notice.code === 'legacy-path-unavailable') {
    return t(locale, 'settings.cliLegacyPathUnavailable').replace(
      '{value}',
      suffix,
    );
  }
  return t(locale, 'settings.cliLegacyUnrecognized').replace('{value}', suffix);
}

function compactCliNoticeValue(value: string): string {
  const compact = value.trim().replace(/\s+/g, ' ');
  return compact.length > 72 ? `${compact.slice(0, 69)}...` : compact;
}

function cliCandidateStatusText(
  candidate: CliCandidate,
  locale: Locale,
): string {
  if (candidate.status === 'not-executable' && candidate.error) {
    return stripCliErrorPrefix(candidate.error);
  }
  if (candidate.status === 'unsupported' && candidate.error) {
    return stripCliErrorPrefix(candidate.error);
  }
  if (candidate.status === 'permission-denied') {
    return candidate.error
      ? stripCliErrorPrefix(candidate.error)
      : t(locale, 'settings.cliPathUnavailable');
  }
  if (candidate.status === 'invalid') return t(locale, 'settings.cliInvalidFile');
  return t(locale, 'settings.cliPathUnavailable');
}

function cliErrorText(
  err: unknown,
  locale: Locale,
  kind: 'path' | 'save',
): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw === 'NO_BACKEND') return t(locale, 'settings.cliDesktopOnly');
  if (raw.includes('INVALID_CLI_PATH') || raw.includes('NOT_FILE')) {
    return t(locale, 'settings.cliInvalidFile');
  }
  if (
    raw.includes('UNSUPPORTED_CLI_TYPE') ||
    raw.includes('NOT_EXECUTABLE') ||
    raw.includes('PERMISSION_DENIED')
  ) {
    return stripCliErrorPrefix(raw);
  }
  if (kind === 'save') return t(locale, 'settings.cliSaveFailed');
  return raw ? stripCliErrorPrefix(raw) : t(locale, 'settings.cliPathUnavailable');
}

function stripCliErrorPrefix(raw: string): string {
  return raw.replace(/^[A-Z_]+:\s*/u, '').trim();
}

function normalizeRuntimeAdapter(adapter: string | undefined): RuntimeAdapterId {
  if (adapter === 'codex' || adapter === 'gemini') return adapter;
  return 'claude-code';
}

/** Map a stored provider kind to its runtime adapter id. */
function providerKindToAdapter(kind: Provider['kind']): RuntimeAdapterId {
  if (kind === 'codex') return 'codex';
  if (kind === 'gemini') return 'gemini';
  return 'claude-code';
}

/** Map a runtime adapter id back to the stored provider kind. */
function adapterToProviderKind(adapter: RuntimeAdapterId): Provider['kind'] {
  if (adapter === 'codex') return 'codex';
  if (adapter === 'gemini') return 'gemini';
  return 'anthropic';
}

/** Order + dot color for the three provider categories in the Models tab. */
const PROVIDER_ADAPTER_SECTIONS: ReadonlyArray<{
  adapter: RuntimeAdapterId;
  dotClassName: string;
}> = [
  { adapter: 'claude-code', dotClassName: 'bg-amber-400' },
  { adapter: 'codex', dotClassName: 'bg-fg-faint' },
  { adapter: 'gemini', dotClassName: 'bg-sky-400' },
];

type BadgeState = 'current' | 'direct' | 'cli' | 'unavailable';
type ProviderDraft = Omit<Provider, 'id'>;
type ProviderEditorMode = 'add' | 'edit';

const CLI_RUNTIME_CARDS = [
  {
    adapterId: 'codex',
    nameKey: 'settings.models.codex',
    dotClassName: 'bg-fg-faint',
    detailKey: 'settings.models.detailCodex',
  },
  {
    adapterId: 'gemini',
    nameKey: 'settings.models.gemini',
    dotClassName: 'bg-sky-400',
    detailKey: 'settings.models.detailGemini',
  },
] satisfies Array<{
  adapterId: RuntimeAdapterId;
  nameKey: TranslationKey;
  dotClassName: string;
  detailKey: TranslationKey;
}>;

function ModelsSettings({
  locale,
  cliRuntime,
}: {
  locale: Locale;
  cliRuntime: CliRuntimeSnapshot;
}) {
  const [providers, setProviders] = useState<Provider[]>(() => listProviders());
  // Active/default provider id per category (Claude Code / CodeX / Gemini).
  const [activeIds, setActiveIds] = useState<Record<Provider['kind'], string>>(
    () => getActiveProviderIds(),
  );
  const [editor, setEditor] = useState<{
    mode: ProviderEditorMode;
    providerId?: string;
    draft: ProviderDraft;
    initial: ProviderDraft;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'err'; msg: string } | null>(
    null,
  );
  const desktop = isTauri();

  const refresh = () => {
    setProviders(listProviders());
    setActiveIds(getActiveProviderIds());
  };

  const handleAdd = (kind: Provider['kind'] = 'anthropic') => {
    const draft = providerDraft({
      kind,
      name: t(locale, 'settings.models.newProviderName'),
      apiKey: '',
      baseUrl: '',
    });
    setStatus(null);
    setEditor({ mode: 'add', draft, initial: draft });
  };

  const handleEdit = (provider: Provider) => {
    const draft = providerDraft(provider);
    setStatus(null);
    setEditor({
      mode: 'edit',
      providerId: provider.id,
      draft,
      initial: draft,
    });
  };

  const handleDelete = (id: string) => {
    if (!window.confirm(t(locale, 'settings.models.confirmDelete'))) return;
    deleteProvider(id);
    refresh();
  };

  const handleEditorDelete = (id: string) => {
    if (!window.confirm(t(locale, 'settings.models.confirmDelete'))) return;
    deleteProvider(id);
    setEditor(null);
    refresh();
  };

  const handleSelect = (id: string) => {
    setActiveProviderId(id);
    refresh();
  };

  const handleImport = async () => {
    setImporting(true);
    setStatus(null);
    try {
      const result = await importCcSwitchProviders({
        promoteActiveAnthropic: true,
      });
      if (result.status === 'empty') {
        setStatus({ tone: 'err', msg: t(locale, 'settings.models.importEmpty') });
        return;
      }
      if (result.status === 'no-source') {
        const msg =
          result.reason === 'NO_BACKEND'
            ? t(locale, 'settings.models.importDesktopOnly')
            : t(locale, 'settings.models.importNoDb');
        setStatus({ tone: 'err', msg });
        return;
      }
      if (result.status === 'failed') {
        const reason = result.reason ?? 'Unknown error';
        setStatus({
          tone: 'err',
          msg: `${t(locale, 'settings.models.importError')}: ${reason}`,
        });
        return;
      }

      refresh();
      const msg =
        result.skippedCount > 0
          ? t(locale, 'settings.models.importSkipped')
              .replace('{n}', String(result.importedCount))
              .replace('{m}', String(result.skippedCount))
          : t(locale, 'settings.models.importSuccess').replace(
              '{n}',
              String(result.importedCount),
            );
      setStatus({ tone: 'ok', msg });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      let msg = `${t(locale, 'settings.models.importError')}: ${raw}`;
      if (raw === 'NO_BACKEND') msg = t(locale, 'settings.models.importDesktopOnly');
      else if (raw.includes('未找到 cc-switch') || raw.includes('not found'))
        msg = t(locale, 'settings.models.importNoDb');
      setStatus({ tone: 'err', msg });
    } finally {
      setImporting(false);
    }
  };

  const providerCards = useMemo(
    () =>
      providers
        .map((provider) => {
          const adapter = providerKindToAdapter(provider.kind);
          const canUseCliFallback =
            desktop && isCliAdapterAvailable(adapter, cliRuntime);
          return {
            provider,
            adapter,
            runtime: getProviderRuntimeInfo(provider, { canUseCliFallback }),
          };
        })
        .sort((a, b) => {
          const rankA = providerSortRank(
            a.provider,
            a.runtime.status,
            activeIds[a.provider.kind] ?? '',
          );
          const rankB = providerSortRank(
            b.provider,
            b.runtime.status,
            activeIds[b.provider.kind] ?? '',
          );
          if (rankA !== rankB) return rankA - rankB;
          return a.provider.name.localeCompare(b.provider.name);
        }),
    [activeIds, providers, desktop, cliRuntime],
  );
  // One default per category → count the providers that are their category's default.
  const currentCount = providerCards.filter(
    ({ provider }) => activeIds[provider.kind] === provider.id,
  ).length;
  const directCount = providerCards.filter(
    ({ runtime }) => runtime.status === 'direct',
  ).length;
  const providerCliCount = providerCards.filter(
    ({ runtime }) => runtime.status === 'cli',
  ).length;
  const systemCliCount = CLI_RUNTIME_CARDS.filter(
    (card) => desktop && isCliAdapterAvailable(card.adapterId, cliRuntime),
  ).length;
  const cliCount = providerCliCount + systemCliCount;
  const unavailableCount =
    providerCards.filter(({ runtime }) => runtime.status === 'unavailable')
      .length +
    CLI_RUNTIME_CARDS.filter(
      (card) => !desktop || !isCliAdapterAvailable(card.adapterId, cliRuntime),
    ).length;
  const hasAvailableRuntime = directCount > 0 || cliCount > 0;
  const showNoRuntime = !hasAvailableRuntime;
  const showEmptyProviders = providerCards.length === 0 && !showNoRuntime;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-fg">
            {t(locale, 'settings.modelsTitle')}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-fg-faint">
            {t(locale, 'settings.modelsDescription')}
          </p>
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
          <SummaryChip
            tone="current"
            label={t(locale, 'settings.models.summaryCurrent').replace(
              '{n}',
              String(currentCount),
            )}
          />
          <SummaryChip
            tone="direct"
            label={t(locale, 'settings.models.summaryDirect').replace(
              '{n}',
              String(directCount),
            )}
          />
          <SummaryChip
            tone="cli"
            label={t(locale, 'settings.models.summaryCli').replace(
              '{n}',
              String(cliCount),
            )}
          />
          <SummaryChip
            tone="unavailable"
            label={t(locale, 'settings.models.summaryUnavailable').replace(
              '{n}',
              String(unavailableCount),
            )}
          />
          <button
            type="button"
            onClick={() => handleAdd()}
            className="inline-flex items-center gap-1.5 rounded border border-border bg-panel px-2.5 py-1 text-xs text-fg-dim transition-colors hover:border-accent hover:text-fg"
          >
            <Plus size={13} strokeWidth={2.2} />
            {t(locale, 'settings.models.add')}
          </button>
          {desktop && (
            <button
              type="button"
              onClick={handleImport}
              disabled={importing}
              className="inline-flex items-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-60"
            >
              <DownloadCloud size={13} strokeWidth={2.2} />
              {importing
                ? t(locale, 'settings.models.importing')
                : t(locale, 'settings.models.importCcSwitch')}
            </button>
          )}
        </div>
      </div>

      {status && (
        <p
          className={cn(
            'text-[11px] leading-relaxed',
            status.tone === 'ok' ? 'text-emerald-300' : 'text-rose-300',
          )}
        >
          {status.msg}
        </p>
      )}

      {showNoRuntime && (
        <EmptyProviderState
          title={t(locale, 'settings.models.noRuntimeTitle')}
          body={t(locale, 'settings.models.noRuntimeBody')}
          action={t(locale, 'settings.models.add')}
          onAction={() => handleAdd()}
        />
      )}

      {showEmptyProviders && (
        <EmptyProviderState
          title={t(locale, 'settings.models.emptyTitle')}
          body={t(locale, 'settings.models.emptyBody')}
          action={t(locale, 'settings.models.add')}
          onAction={() => handleAdd()}
        />
      )}

      {PROVIDER_ADAPTER_SECTIONS.map(({ adapter, dotClassName }) => {
        const sectionCards = providerCards.filter(
          (card) => card.adapter === adapter,
        );
        const cliCard = CLI_RUNTIME_CARDS.find(
          (card) => card.adapterId === adapter,
        );
        return (
          <div key={adapter} className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <ProviderGroupHeader
                title={runtimeAdapterLabel(adapter)}
                count={sectionCards.length}
                dotClassName={dotClassName}
                locale={locale}
              />
              <button
                type="button"
                onClick={() => handleAdd(adapterToProviderKind(adapter))}
                className="inline-flex items-center gap-1 rounded border border-border bg-panel px-2 py-0.5 text-[11px] text-fg-dim transition-colors hover:border-accent hover:text-fg"
              >
                <Plus size={12} strokeWidth={2.2} />
                {t(locale, 'settings.models.add')}
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {sectionCards.map(({ provider, runtime }) => {
                const active = activeIds[provider.kind] === provider.id;
                return (
                  <ProviderCard
                    key={provider.id}
                    name={provider.name || runtimeAdapterLabel(adapter)}
                    dotClassName={dotClassName}
                    sourceSummary={providerSourceSummary(runtime, locale)}
                    modelChips={providerModelChips(provider, locale)}
                    modelLabel={t(locale, 'settings.models.modelSavedPreference')}
                    badgeState={active ? 'current' : runtime.status}
                    badgeLabel={
                      active
                        ? t(locale, 'settings.models.statusCurrent')
                        : providerStatusLabel(runtime.status, locale)
                    }
                    detailState={runtime.status}
                    detail={providerDetail(runtime.status, locale)}
                    active={active}
                    onSelect={
                      active ? undefined : () => handleSelect(provider.id)
                    }
                    onEdit={() => handleEdit(provider)}
                    onDelete={() => handleDelete(provider.id)}
                    selectLabel={t(locale, 'settings.models.activate')}
                    editLabel={t(locale, 'settings.models.edit')}
                    deleteLabel={t(locale, 'settings.models.delete')}
                  />
                );
              })}
              {cliCard &&
                (() => {
                  const adapterCliAvailable =
                    desktop && isCliAdapterAvailable(cliCard.adapterId, cliRuntime);
                  const statusState: ProviderRuntimeStatus = adapterCliAvailable
                    ? 'cli'
                    : 'unavailable';
                  return (
                    <ProviderCard
                      key={`${cliCard.adapterId}-system-cli`}
                      name={t(locale, 'settings.models.sourceSystemCli')}
                      dotClassName={dotClassName}
                      sourceSummary={t(locale, 'settings.models.sourceSystemCli')}
                      modelChips={[
                        t(locale, 'settings.models.modelComposerSelected'),
                      ]}
                      modelLabel={t(locale, 'settings.models.modelRuntimeLabel')}
                      badgeState={statusState}
                      badgeLabel={providerStatusLabel(statusState, locale)}
                      detailState={statusState}
                      detail={
                        adapterCliAvailable
                          ? t(locale, cliCard.detailKey)
                          : desktop
                            ? t(locale, 'settings.models.detailCliMissing')
                            : t(locale, 'settings.models.detailCliDesktopOnly')
                      }
                      active={false}
                    />
                  );
                })()}
            </div>
          </div>
        );
      })}

      {editor && (
        <ProviderEditor
          locale={locale}
          editor={editor}
          providers={providers}
          cliRuntime={cliRuntime}
          onChange={(draft) =>
            setEditor((prev) => (prev ? { ...prev, draft } : prev))
          }
          onClose={() =>
            setEditor((prev) => {
              if (!prev) return prev;
              if (
                providerDraftChanged(prev.draft, prev.initial) &&
                !window.confirm(t(locale, 'settings.models.discardConfirm'))
              ) {
                return prev;
              }
              return null;
            })
          }
          onDelete={
            editor.mode === 'edit' && editor.providerId
              ? () => handleEditorDelete(editor.providerId!)
              : undefined
          }
          onSaved={() => {
            setEditor(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function ProviderCard({
  name,
  dotClassName,
  sourceSummary,
  modelChips,
  modelLabel,
  badgeState,
  badgeLabel,
  detailState,
  detail,
  active,
  onSelect,
  onEdit,
  onDelete,
  selectLabel,
  editLabel,
  deleteLabel,
}: {
  name: string;
  dotClassName: string;
  sourceSummary: string;
  modelChips: string[];
  modelLabel: string;
  badgeState: BadgeState;
  badgeLabel: string;
  detailState: BadgeState;
  detail: string;
  active: boolean;
  onSelect?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  selectLabel?: string;
  editLabel?: string;
  deleteLabel?: string;
}) {
  const detailColor =
    detailState === 'direct'
      ? 'text-emerald-300'
      : detailState === 'unavailable'
        ? 'text-rose-300'
        : 'text-fg-faint';

  const visibleChips = modelChips.slice(0, 2);
  const extraCount = Math.max(modelChips.length - visibleChips.length, 0);

  return (
    <article
      className={cn(
        'relative flex min-h-[146px] flex-col overflow-hidden rounded-lg border border-border bg-bg-alt p-4',
        onSelect && 'transition-colors hover:border-accent/60',
      )}
    >
      {onSelect && (
        <button
          type="button"
          aria-label={`${selectLabel ?? ''} ${name}`.trim()}
          onClick={onSelect}
          className="absolute inset-0 z-0 cursor-pointer rounded-lg focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent"
        />
      )}
      {active && (
        <span className="absolute left-0 top-0 z-10 h-full w-[3px] bg-accent" />
      )}

      <div
        className={cn(
          'relative z-10 flex flex-1 flex-col',
          onSelect && 'pointer-events-none',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <GroupDot className={dotClassName} />
            <span className="truncate text-sm font-medium text-fg">{name}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge state={badgeState} label={badgeLabel} />
            <div className="pointer-events-auto flex items-center gap-1.5">
              {onSelect && selectLabel && (
                <button
                  type="button"
                  onClick={onSelect}
                  className="rounded border border-border bg-panel px-2 py-1 text-[11px] text-fg-dim transition-colors hover:border-accent hover:text-fg"
                >
                  {selectLabel}
                </button>
              )}
              {onEdit && editLabel && (
                <button
                  type="button"
                  title={editLabel}
                  aria-label={editLabel}
                  onClick={onEdit}
                  className="flex h-6 w-6 items-center justify-center rounded border border-border bg-panel text-fg-faint transition-colors hover:border-accent hover:text-fg"
                >
                  <Pencil size={13} strokeWidth={2} />
                </button>
              )}
              {onDelete && (
              <button
                type="button"
                title={deleteLabel}
                aria-label={deleteLabel}
                onClick={onDelete}
                className="flex h-6 w-6 items-center justify-center rounded border border-border bg-panel text-fg-faint transition-colors hover:border-rose-500/50 hover:text-rose-400"
              >
                <Trash2 size={13} strokeWidth={2} />
              </button>
              )}
            </div>
          </div>
        </div>

        <p className="mt-1.5 truncate text-[11px] text-fg-faint">
          {sourceSummary}
        </p>

        <div className="mt-3 min-w-0">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-fg-faint">
            {modelLabel}
          </div>
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {visibleChips.map((model) => (
              <span
                key={model}
                className="max-w-full truncate rounded border border-border bg-panel px-2 py-0.5 font-mono text-[11px] text-fg-dim"
              >
                {model}
              </span>
            ))}
            {extraCount > 0 && (
              <span className="rounded border border-border bg-panel px-2 py-0.5 font-mono text-[11px] text-fg-faint">
                +{extraCount}
              </span>
            )}
          </div>
        </div>

        <div className="mt-auto pt-3">
          <div className="border-t border-border-soft pt-2">
            <p className={cn('text-[11px]', detailColor)}>{detail}</p>
          </div>
        </div>
      </div>
    </article>
  );
}

function SummaryChip({
  tone,
  label,
}: {
  tone: BadgeState;
  label: string;
}) {
  const toneClass =
    tone === 'current'
      ? {
          pill: 'border-accent/50 bg-accent/15 text-accent',
          dot: 'bg-accent',
        }
      : tone === 'direct'
        ? {
            pill: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
            dot: 'bg-emerald-400',
          }
        : tone === 'unavailable'
          ? {
              pill: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
              dot: 'bg-rose-400',
            }
          : {
              pill: 'border-border bg-panel text-fg-faint',
              dot: 'bg-fg-faint',
            };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]',
        toneClass.pill,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', toneClass.dot)} />
      {label}
    </span>
  );
}

function ProviderGroupHeader({
  title,
  count,
  dotClassName,
  locale,
}: {
  title: string;
  count: number;
  dotClassName: string;
  locale: Locale;
}) {
  return (
    <div className="flex items-center gap-2">
      <GroupDot className={dotClassName} />
      <span className="text-sm font-medium text-fg">{title}</span>
      <span className="font-mono text-[11px] text-fg-faint">
        {t(locale, 'settings.models.headingCount').replace('{n}', String(count))}
      </span>
    </div>
  );
}

function EmptyProviderState({
  title,
  body,
  action,
  onAction,
}: {
  title: string;
  body: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border-soft bg-bg-alt/60 p-4">
      <div className="text-sm font-medium text-fg">{title}</div>
      <p className="mt-1 text-xs leading-relaxed text-fg-faint">{body}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-3 inline-flex items-center gap-1.5 rounded border border-border bg-panel px-2.5 py-1 text-xs text-fg-dim transition-colors hover:border-accent hover:text-fg"
      >
        <Plus size={13} strokeWidth={2.2} />
        {action}
      </button>
    </div>
  );
}

function GroupDot({ className }: { className: string }) {
  return <span className={cn('h-2 w-2 shrink-0 rounded-full', className)} />;
}

function StatusBadge({ state, label }: { state: BadgeState; label: string }) {
  const styles =
    state === 'current'
      ? {
          pill: 'border-accent/50 bg-accent/15 text-accent',
          dot: 'bg-accent',
        }
      : state === 'direct'
      ? {
          pill: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
          dot: 'bg-emerald-400',
        }
      : state === 'unavailable'
        ? {
            pill: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
            dot: 'bg-rose-400',
          }
        : {
            pill: 'border-border bg-panel text-fg-faint',
            dot: 'bg-fg-faint',
          };

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px]',
        styles.pill,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', styles.dot)} />
      {label}
    </span>
  );
}

function ProviderEditor({
  locale,
  editor,
  providers,
  cliRuntime,
  onChange,
  onClose,
  onDelete,
  onSaved,
}: {
  locale: Locale;
  editor: {
    mode: ProviderEditorMode;
    providerId?: string;
    draft: ProviderDraft;
    initial: ProviderDraft;
  };
  providers: Provider[];
  cliRuntime: CliRuntimeSnapshot;
  onChange: (draft: ProviderDraft) => void;
  onClose: () => void;
  onDelete?: () => void;
  onSaved: () => void;
}) {
  const [keyVisible, setKeyVisible] = useState(false);
  const [errors, setErrors] = useState<{
    name?: string;
    baseUrl?: string;
    duplicate?: string;
  }>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  // CLI fallback availability depends on the selected adapter, which the user
  // can change mid-edit — recompute from the draft kind each render.
  const draftAdapter = providerKindToAdapter(editor.draft.kind);
  const canUseCliFallback =
    isTauri() && isCliAdapterAvailable(draftAdapter, cliRuntime);
  const runtime = getProviderRuntimeInfo(editor.draft, { canUseCliFallback });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const patchDraft = (patch: Partial<ProviderDraft>) => {
    setSaveError(null);
    setErrors((prev) => ({ ...prev, ...clearErrorsForPatch(patch) }));
    onChange({ ...editor.draft, ...patch });
  };

  const handleSave = () => {
    const next = trimProviderDraft(editor.draft);
    const nextErrors: typeof errors = {};
    if (!next.name) {
      nextErrors.name = t(locale, 'settings.models.validationNameRequired');
    }
    if (!isProviderBaseUrlValid(next.baseUrl)) {
      nextErrors.baseUrl = t(locale, 'settings.models.validationBaseUrl');
    }
    const duplicate = providers.some((provider) => {
      if (editor.mode === 'edit' && provider.id === editor.providerId) {
        return false;
      }
      return (
        providerMetadataSignature(provider) === providerMetadataSignature(next)
      );
    });
    if (duplicate) {
      nextErrors.duplicate = t(locale, 'settings.models.validationDuplicate');
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    try {
      if (editor.mode === 'edit' && editor.providerId) {
        updateProvider(editor.providerId, next);
      } else {
        addProvider(next);
      }
      onSaved();
    } catch {
      setSaveError(t(locale, 'settings.models.saveError'));
    }
  };

  const title =
    editor.mode === 'add'
      ? t(locale, 'settings.models.addTitle')
      : t(locale, 'settings.models.editTitle');
  const keyToggleLabel = keyVisible
    ? t(locale, 'settings.models.hideKey')
    : t(locale, 'settings.models.showKey');
  const KeyIcon = keyVisible ? EyeOff : Eye;

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 sm:flex sm:items-center sm:justify-center sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-editor-title"
        data-provider-editor="true"
        className="fixed inset-x-0 bottom-0 flex max-h-[calc(100vh-1rem)] flex-col overflow-hidden rounded-t-lg border border-border bg-panel shadow-2xl sm:relative sm:inset-auto sm:max-h-[calc(100vh-3rem)] sm:w-[min(720px,calc(100vw-2rem))] sm:rounded-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-border-soft bg-bg-alt px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <h3
                id="provider-editor-title"
                className="text-base font-semibold text-fg"
              >
                {title}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-fg-faint">
                {t(locale, 'settings.modelsDescription')}
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
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t(locale, 'settings.models.providerName')}
              value={editor.draft.name}
              onChange={(value) => patchDraft({ name: value })}
              placeholder={t(locale, 'settings.models.newProviderName')}
              error={errors.name}
            />
            <div className="block space-y-1">
              <span className="text-[11px] font-medium text-fg-dim">
                {t(locale, 'settings.models.sourceType')}
              </span>
              <div className="flex gap-1">
                {RUNTIME_ADAPTERS.map((adapter) => {
                  const active = draftAdapter === adapter.id;
                  return (
                    <button
                      key={adapter.id}
                      type="button"
                      onClick={() =>
                        patchDraft({ kind: adapterToProviderKind(adapter.id) })
                      }
                      className={cn(
                        'flex-1 rounded border px-2 py-1.5 text-[11px] transition-colors',
                        active
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border bg-bg text-fg-dim hover:border-accent/50 hover:text-fg',
                      )}
                    >
                      {adapter.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <ReadonlyField
              label={t(locale, 'settings.models.authState')}
              value={
                runtime.hasApiKey
                  ? t(locale, 'settings.models.authConfigured')
                  : t(locale, 'settings.models.authMissing')
              }
            />
            <ReadonlyField
              label={t(locale, 'settings.models.availability')}
              value={
                <StatusBadge
                  state={runtime.status}
                  label={providerStatusLabel(runtime.status, locale)}
                />
              }
            />
            <TextField
              label={t(locale, 'settings.models.baseUrl')}
              value={editor.draft.baseUrl}
              onChange={(value) => patchDraft({ baseUrl: value })}
              placeholder="https://api.anthropic.com"
              error={errors.baseUrl}
              mono
              fullWidth
            />
            <TextField
              label={t(locale, 'settings.models.defaultModel')}
              value={editor.draft.model ?? ''}
              onChange={(value) => patchDraft({ model: value })}
              placeholder={DEFAULT_MODEL}
              description={t(locale, 'settings.models.modelMetadataHelp')}
              mono
              fullWidth
            />
            <div className="block space-y-1 sm:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="provider-api-key"
                  className="text-[11px] font-medium text-fg-dim"
                >
                  {t(locale, 'settings.models.apiKey')}
                </label>
                <button
                  type="button"
                  aria-label={keyToggleLabel}
                  title={keyToggleLabel}
                  onClick={() => setKeyVisible((visible) => !visible)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-fg-faint transition-colors hover:bg-panel-2 hover:text-fg"
                >
                  <KeyIcon size={15} strokeWidth={2.1} />
                </button>
              </div>
              <input
                id="provider-api-key"
                type={keyVisible ? 'text' : 'password'}
                value={editor.draft.apiKey}
                onChange={(event) => patchDraft({ apiKey: event.target.value })}
                placeholder="sk-ant-..."
                autoComplete="off"
                spellCheck={false}
                aria-describedby="provider-api-key-help"
                className="w-full rounded border border-border bg-bg py-1.5 pl-2 pr-10 font-mono text-xs text-fg outline-none transition-colors focus:border-accent"
              />
            </div>
          </div>

          {errors.duplicate && (
            <p className="mt-3 text-[11px] leading-relaxed text-rose-300">
              {errors.duplicate}
            </p>
          )}

          <p
            id="provider-api-key-help"
            className="mt-4 rounded border border-border-soft bg-bg-alt px-3 py-2 text-[11px] leading-relaxed text-fg-faint"
          >
            {t(locale, 'settings.models.localHint')}
          </p>
        </div>

        <div className="shrink-0 border-t border-border-soft bg-bg-alt px-5 py-3">
          {saveError && (
            <p className="mb-2 text-[11px] leading-relaxed text-rose-300">
              {saveError}
            </p>
          )}
          <div className="flex items-center gap-2">
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex items-center gap-1.5 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 transition-colors hover:bg-rose-500/20"
              >
                <Trash2 size={13} strokeWidth={2.2} />
                {t(locale, 'settings.models.delete')}
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-border bg-panel px-3 py-1.5 text-xs text-fg-dim transition-colors hover:border-accent hover:text-fg"
              >
                {t(locale, 'common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="rounded border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-bg transition-colors hover:bg-accent/90"
              >
                {t(locale, 'settings.models.save')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function providerDraft(provider: ProviderDraft): ProviderDraft {
  return {
    kind: provider.kind,
    name: provider.name,
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    model: provider.model ?? '',
  };
}

function trimProviderDraft(draft: ProviderDraft): ProviderDraft {
  const model = draft.model?.trim();
  return {
    kind: draft.kind,
    name: draft.name.trim(),
    apiKey: draft.apiKey.trim(),
    baseUrl: draft.baseUrl.trim(),
    ...(model ? { model } : {}),
  };
}

function providerDraftChanged(a: ProviderDraft, b: ProviderDraft): boolean {
  return (
    a.kind !== b.kind ||
    a.name !== b.name ||
    a.apiKey !== b.apiKey ||
    a.baseUrl !== b.baseUrl ||
    (a.model ?? '') !== (b.model ?? '')
  );
}

function providerSortRank(
  provider: Provider,
  status: ProviderRuntimeStatus,
  activeId: string,
): number {
  if (provider.id === activeId) return 0;
  if (status === 'direct') return 1;
  if (status === 'cli') return 2;
  return 3;
}

function providerStatusLabel(
  status: ProviderRuntimeStatus,
  locale: Locale,
): string {
  if (status === 'direct') return t(locale, 'settings.models.statusDirect');
  if (status === 'cli') return t(locale, 'settings.models.statusCli');
  return t(locale, 'settings.models.statusUnavailable');
}

function providerDetail(status: ProviderRuntimeStatus, locale: Locale): string {
  if (status === 'direct') return t(locale, 'settings.models.detailDirect');
  if (status === 'cli') return t(locale, 'settings.models.detailCli');
  return t(locale, 'settings.models.detailUnavailable');
}

function providerSourceSummary(
  runtime: ReturnType<typeof getProviderRuntimeInfo>,
  locale: Locale,
): string {
  if (runtime.status === 'cli') {
    return t(locale, 'settings.models.sourceSystemCli');
  }
  return runtime.baseUrlHost;
}

function providerModelChips(provider: Provider, locale: Locale): string[] {
  const saved = provider.model?.trim();
  return saved ? [saved] : [t(locale, 'settings.models.modelComposerSelected')];
}

function clearErrorsForPatch(
  patch: Partial<ProviderDraft>,
): { name?: undefined; baseUrl?: undefined; duplicate?: undefined } {
  return {
    ...(patch.name !== undefined ? { name: undefined, duplicate: undefined } : {}),
    ...(patch.baseUrl !== undefined
      ? { baseUrl: undefined, duplicate: undefined }
      : {}),
    ...(patch.kind !== undefined ? { duplicate: undefined } : {}),
    ...(patch.model !== undefined ? { duplicate: undefined } : {}),
  };
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  description,
  error,
  mono,
  fullWidth,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  description?: string;
  error?: string;
  mono?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <label className={cn('block space-y-1', fullWidth && 'sm:col-span-2')}>
      <span className="text-[11px] font-medium text-fg-dim">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={cn(
          'w-full rounded border border-border bg-bg px-2 py-1.5 text-xs text-fg outline-none transition-colors focus:border-accent',
          mono && 'font-mono',
          error && 'border-rose-500/60',
        )}
      />
      {description && (
        <p className="text-[11px] leading-relaxed text-fg-faint">{description}</p>
      )}
      {error && (
        <p className="text-[11px] leading-relaxed text-rose-300">{error}</p>
      )}
    </label>
  );
}

function ReadonlyField({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="block space-y-1">
      <span className="text-[11px] font-medium text-fg-dim">{label}</span>
      <div className="min-h-[31px] rounded border border-border bg-bg px-2 py-1.5 text-xs text-fg-dim">
        {value}
      </div>
    </div>
  );
}

function ShortcutsSettings({ locale }: { locale: Locale }) {
  const shortcuts: {
    id: string;
    keys: string[];
    titleKey: TranslationKey;
    descriptionKey: TranslationKey;
  }[] = [
    {
      id: 'composer-send',
      keys: ['Ctrl', 'Enter'],
      titleKey: 'settings.shortcutsComposerSendTitle',
      descriptionKey: 'settings.shortcutsComposerSendDescription',
    },
    {
      id: 'composer-newline',
      keys: ['Enter'],
      titleKey: 'settings.shortcutsComposerNewlineTitle',
      descriptionKey: 'settings.shortcutsComposerNewlineDescription',
    },
    {
      id: 'modal-close',
      keys: ['Esc'],
      titleKey: 'settings.shortcutsCloseModalTitle',
      descriptionKey: 'settings.shortcutsCloseModalDescription',
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-fg">
          {t(locale, 'settings.shortcutsTitle')}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-fg-faint">
          {t(locale, 'settings.shortcutsDescription')}
        </p>
      </div>

      <div className="space-y-2">
        {shortcuts.map((shortcut) => (
          <div
            key={shortcut.id}
            className="grid gap-3 rounded-lg border border-border bg-bg-alt px-4 py-3 md:grid-cols-[minmax(9rem,14rem)_minmax(0,1fr)] md:items-center"
          >
            <ShortcutKeys keys={shortcut.keys} />
            <div className="min-w-0">
              <div className="text-sm font-medium text-fg">
                {t(locale, shortcut.titleKey)}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-fg-faint">
                {t(locale, shortcut.descriptionKey)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShortcutKeys({ keys }: { keys: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {keys.map((key, index) => (
        <span key={`${key}-${index}`} className="contents">
          {index > 0 && (
            <span className="font-mono text-[10px] text-fg-faint">+</span>
          )}
          <kbd className="min-w-8 rounded border border-border-soft bg-bg px-2 py-1 text-center font-mono text-[11px] text-fg">
            {key}
          </kbd>
        </span>
      ))}
    </div>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-4 rounded-lg border border-border bg-bg-alt p-4 md:grid-cols-[minmax(0,1fr)_minmax(12rem,24rem)] md:items-center">
      <div className="space-y-1">
        <div className="text-sm font-medium text-fg">{title}</div>
        {description && (
          <p className="text-xs leading-relaxed text-fg-faint">{description}</p>
        )}
      </div>
      <div className="md:justify-self-end">{children}</div>
    </div>
  );
}

function PlaceholderTab({
  tab,
  locale,
}: {
  tab: PlaceholderTabId;
  locale: Locale;
}) {
  const copy = placeholderCopy[tab];
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-fg">
          {t(locale, copy.titleKey)}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-fg-faint">
          {t(locale, copy.descriptionKey)}
        </p>
      </div>
      <div className="space-y-2">
        <div className="h-12 rounded-lg border border-dashed border-border-soft bg-bg-alt/70" />
        <div className="h-12 rounded-lg border border-dashed border-border-soft bg-bg-alt/50" />
        <div className="h-12 rounded-lg border border-dashed border-border-soft bg-bg-alt/30" />
      </div>
    </div>
  );
}

function AppearanceSettings({ locale }: { locale: Locale }) {
  const appearance = useStore((s) => s.appearance);
  const setStylePresetId = useStore((s) => s.setStylePresetId);
  const activePresetId = resolveStylePresetId(appearance.stylePresetId);
  const hasUnsupportedStyle = isUnsupportedStylePreset(appearance.stylePresetId);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h3 className="text-lg font-semibold text-fg">
          {t(locale, 'settings.appearanceTitle')}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-fg-faint">
          {t(locale, 'settings.appearanceDescription')}
        </p>
      </header>

      {hasUnsupportedStyle && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-200">
          <p>{t(locale, 'settings.appearanceUnsupportedStyle')}</p>
          <button
            type="button"
            onClick={() => setStylePresetId(DEFAULT_STYLE_PRESET_ID)}
            className="rounded-md border border-accent/40 bg-accent/15 px-2.5 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20"
          >
            {t(locale, 'settings.appearanceUsePencil')}
          </button>
        </div>
      )}

      <SettingRow
        title={t(locale, 'settings.appearanceStyleLabel')}
        description={t(locale, 'settings.appearanceStyleDescription')}
      >
        <div className="w-full max-w-[34rem]">
          <div className="grid gap-3">
            {STYLE_PRESET_LIST.map((preset) => (
              <StylePresetCard
                key={preset.id}
                preset={preset}
                active={preset.id === activePresetId}
                locale={locale}
                onSelect={() => setStylePresetId(preset.id)}
              />
            ))}
          </div>
        </div>
      </SettingRow>
    </div>
  );
}

function StylePresetCard({
  preset,
  active,
  locale,
  onSelect,
}: {
  preset: StylePresetDefinition;
  active: boolean;
  locale: Locale;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        'group w-full rounded-lg border p-4 text-left transition-colors',
        active
          ? 'border-accent bg-accent/10'
          : 'border-border bg-panel hover:border-accent/50 hover:bg-bg',
      )}
    >
      <div className="flex items-start gap-4">
        <div className="grid h-10 w-16 shrink-0 grid-cols-5 overflow-hidden rounded-md border border-border-soft bg-bg-alt">
          {preset.swatches.map((color, index) => (
            <span
              key={`${preset.id}-${index}`}
              className="h-full"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-fg">
              {t(locale, preset.labelKey)}
            </span>
            {active && (
              <Check size={12} strokeWidth={2.4} className="text-accent" />
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-fg-faint">
            {t(locale, preset.descriptionKey)}
          </p>
        </div>

        <span
          className={cn(
            'shrink-0 rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider',
            active
              ? 'border-accent/40 bg-accent/10 text-accent'
              : 'border-border bg-bg-alt text-fg-faint',
          )}
        >
          {preset.colorScheme}
        </span>
      </div>
    </button>
  );
}

function AboutSettings({ locale }: { locale: Locale }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const runCheck = async () => {
    setChecking(true);
    try { setStatus(await checkForUpdate()); } finally { setChecking(false); }
  };
  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h3 className="text-base font-semibold text-fg">{t(locale, 'settings.aboutTitle')}</h3>
        <p className="text-xs leading-relaxed text-fg-faint">{t(locale, 'settings.aboutDescription')}</p>
      </header>
      <div className="rounded-lg border border-border bg-bg-alt p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <Sparkles size={20} strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-fg">OpenWorkflow</div>
            <span className="mt-1 inline-block rounded-md border border-border bg-panel-2 px-2 py-0.5 font-mono text-[11px] text-fg-dim">
              {t(locale, 'settings.aboutVersion')} v{APP_VERSION}
            </span>
          </div>
          <div className="flex-1" />
          <div className="flex flex-wrap items-center gap-2">
            <AboutLink label={t(locale, 'settings.aboutWebsite')} icon={<Globe size={14} />} onClick={() => void openExternal(REPO_URL)} />
            <AboutLink label="GitHub" icon={<ExternalLink size={14} />} onClick={() => void openExternal(REPO_URL)} />
            <AboutLink label={t(locale, 'settings.aboutChangelog')} icon={<FileText size={14} />} onClick={() => void openExternal(RELEASES_URL)} />
            <button type="button" onClick={() => void runCheck()} disabled={checking}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50">
              <RefreshCw size={14} className={checking ? "animate-spin" : undefined} />
              {checking ? t(locale, 'settings.aboutChecking') : t(locale, 'settings.aboutCheckUpdate')}
            </button>
          </div>
        </div>
        {status && !checking && (
          <div className="mt-4 border-t border-border-soft pt-3 text-xs">
            {status.error ? (
              <span className="text-[#f78b8b]">{t(locale, 'settings.aboutCheckFailed')}</span>
            ) : status.updateAvailable && status.manifest ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-accent-2">{t(locale, 'settings.aboutUpdateFound')} v{status.latest}</span>
                <button type="button" onClick={() => void openDownload(status.manifest!.url)}
                  className="flex items-center gap-1.5 rounded-md border border-accent-2/50 bg-accent-2/15 px-2.5 py-1 font-semibold text-accent-2 transition-opacity hover:opacity-90">
                  <DownloadCloud size={14} />{t(locale, 'settings.aboutDownload')}
                </button>
              </div>
            ) : (
              <span className="text-fg-dim">{t(locale, 'settings.aboutUpToDate')}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AboutLink({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-1.5 rounded-md border border-border bg-panel-2 px-2.5 py-1.5 text-xs text-fg-dim transition-colors hover:border-accent hover:text-fg">
      {icon}<span>{label}</span>
    </button>
  );
}
