import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ChevronDown, ChevronUp, Plus, Search, X } from 'lucide-react';
import Select from '@/components/Select';
import WorkspaceSelect from '@/components/WorkspaceSelect';
import { summarizeAnswer, type InteractionAnswer } from '@/core/interaction';
import {
  bestAvailableSelection,
  listGatewayRunOptions,
  selectionFromKey,
  selectionKey,
  workflowGatewaySelection,
} from '@/lib/modelGateway/resolver';
import type { GatewayRunOption } from '@/lib/modelGateway/types';
import {
  RUNTIME_ADAPTERS,
  runtimeAdapterLabel,
  type RuntimeAdapterId,
} from '@/lib/adapters';
import { hasExplicitGatewayPin } from '@/lib/gatewayConfig';
import type { ModelStrategy, SelectOption } from '@/store/types';
import { localizeSelectOption, t, type Locale } from '@/lib/i18n';
import type { Message } from '@/store/types';
import {
  loadDockHeight,
  loadPaneWidth,
  saveDockHeight,
  savePaneWidth,
} from '@/lib/composerStorage';
import { shouldRefocusComposerAfterAppend } from '@/lib/composerEntryPolicy';
import { tauriAvailable } from '@/lib/tauri';
import { useStore } from '@/store/useStore';
import { primeCliRuntime, subscribeCliRuntime } from '@/lib/cliConfig';

const DEFAULT_DOCK_HEIGHT = 208; // matches the former h-52
const MIN_DOCK_HEIGHT = 120;

/**
 * Order in which the model dropdown groups channels by runtime adapter. Each
 * group gets a divider + header (Claude Code / Codex / Gemini) in the menu.
 */
const ADAPTER_GROUP_ORDER: RuntimeAdapterId[] = RUNTIME_ADAPTERS.map(
  (adapter) => adapter.id,
);

function adapterGroupRank(adapter: string): number {
  const index = ADAPTER_GROUP_ORDER.indexOf(adapter as RuntimeAdapterId);
  return index === -1 ? ADAPTER_GROUP_ORDER.length : index;
}

/** Sentinel id for the "inherit global selection" option in the model dropdown. */
const INHERIT_SELECTION_ID = '__inherit__';

/** localStorage key + bounds for the AI-input pane width (right column). */
const INPUT_WIDTH_KEY = 'openworkflow.aiInputWidth.v1';
const DEFAULT_INPUT_WIDTH = 384; // matches the former w-96
const MIN_INPUT_WIDTH = 280;
const MIN_RETURN_WIDTH = 240; // keep the AI-return pane usable
const NARROW_INPUT_MIN_WIDTH = 120;
const NARROW_INPUT_WIDTH_RATIO = 0.4;

function clampHeight(h: number): number {
  const max =
    typeof window !== 'undefined' ? window.innerHeight * 0.75 : 600;
  return Math.min(Math.max(h, MIN_DOCK_HEIGHT), max);
}

function formatMessageTime(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(ts));
}

type SearchMatchSource = 'text' | 'interaction';

interface SearchMatch {
  id: string;
  messageId: string;
  source: SearchMatchSource;
}

function normalizeSearchQuery(value: string): string {
  return value.trim().toLowerCase();
}

function interactionSearchText(message: Message): string {
  if (!message.interaction) return '';
  const parts = [message.interaction.prompt];
  if (message.interaction.options?.length) {
    parts.push(message.interaction.options.join(' '));
  }
  if (message.interactionAnswer) {
    parts.push(summarizeAnswer(message.interaction, message.interactionAnswer));
  }
  return parts.filter(Boolean).join('\n');
}

function buildSearchMatches(messages: Message[], query: string): SearchMatch[] {
  if (!query) return [];

  const out: SearchMatch[] = [];
  const lowerQuery = query.toLowerCase();

  for (const message of messages) {
    const segments: Array<{ source: SearchMatchSource; text: string }> = [];
    if (message.text.trim()) {
      segments.push({ source: 'text', text: message.text });
    }
    const interactionText = interactionSearchText(message);
    if (interactionText) {
      segments.push({ source: 'interaction', text: interactionText });
    }

    for (const segment of segments) {
      const lowerText = segment.text.toLowerCase();
      let start = 0;
      let hitIndex = 0;

      while (start <= lowerText.length) {
        const found = lowerText.indexOf(lowerQuery, start);
        if (found === -1) break;
        out.push({
          id: `${message.id}:${segment.source}:${hitIndex}`,
          messageId: message.id,
          source: segment.source,
        });
        hitIndex += 1;
        start = found + Math.max(lowerQuery.length, 1);
      }
    }
  }

  return out;
}

function renderHighlightedText(
  text: string,
  messageId: string,
  query: string,
  activeMatchId: string | null,
  onActiveMatchNode: (node: HTMLElement | null) => void,
): ReactNode {
  if (!query) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  if (!lowerQuery) return text;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  let hitIndex = 0;

  while (cursor <= lowerText.length) {
    const found = lowerText.indexOf(lowerQuery, cursor);
    if (found === -1) break;
    if (found > cursor) nodes.push(text.slice(cursor, found));

    const matchId = `${messageId}:text:${hitIndex}`;
    const isActive = matchId === activeMatchId;
    nodes.push(
      <mark
        key={matchId}
        data-search-match-id={matchId}
        ref={
          isActive
            ? (node) => {
                onActiveMatchNode(node);
              }
            : undefined
        }
        className={
          'rounded-sm px-0.5 text-fg transition-colors ' +
          (isActive
            ? 'bg-accent-3/35 ring-1 ring-inset ring-accent-3/55'
            : 'bg-accent/20')
        }
      >
        {text.slice(found, found + lowerQuery.length)}
      </mark>,
    );

    hitIndex += 1;
    cursor = found + Math.max(lowerQuery.length, 1);
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes.length > 0 ? nodes : text;
}

interface TextSelection {
  start: number;
  end: number;
}

function clampSelection(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

function formatFilePathInsertion(paths: string[]): string {
  return paths.map((path) => path.trim()).filter(Boolean).join('\n');
}

function pointInsideElement(
  point: { x: number; y: number },
  el: HTMLElement,
): boolean {
  const scale = window.devicePixelRatio || 1;
  const x = point.x / scale;
  const y = point.y / scale;
  const rect = el.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

async function pickComposerFiles(title: string): Promise<string[] | null> {
  if (!tauriAvailable()) return null;

  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({
    title,
    directory: false,
    multiple: true,
  });
  if (!picked) return null;
  return Array.isArray(picked) ? picked.map(String) : [String(picked)];
}

function pathsFromDataTransfer(dataTransfer: DataTransfer): string[] {
  return Array.from(dataTransfer.files)
    .map((file) => {
      const withPath = file as File & { path?: string };
      return withPath.path || file.webkitRelativePath || file.name;
    })
    .filter(Boolean);
}

/**
 * Renders a node's interaction request (select / input / confirm) inside the
 * AI-return stream. States:
 *   - pending + active : interactive controls; submitting resolves the waiting
 *                        run node via onAnswer → store.answerInteraction.
 *   - answered         : compact "你的回答: …" summary.
 *   - cancelled / stale: read-only note (the run ended before it was answered).
 * See core/interaction.ts for the protocol and the run-loop side.
 */
function InteractionWidget({
  message,
  locale,
  active,
  onAnswer,
  onDismiss,
}: {
  message: Message;
  locale: Locale;
  active: boolean;
  onAnswer: (answer: InteractionAnswer) => void;
  onDismiss: () => void;
}) {
  const req = message.interaction;
  const status = message.interactionStatus ?? 'pending';
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState('');

  if (!req) return null;

  if (status === 'answered' && message.interactionAnswer) {
    return (
      <div className="rounded-md border border-accent-2/40 bg-accent-2/5 px-2.5 py-1.5 text-xs text-fg-dim">
        <span className="font-mono text-[10px] uppercase tracking-wider text-accent-2">
          ✓ {t(locale, 'interaction.youAnswered')}
        </span>{' '}
        {summarizeAnswer(req, message.interactionAnswer)}
      </div>
    );
  }
  if (status === 'cancelled') {
    return (
      <div className="rounded-md border border-border bg-panel-2 px-2.5 py-1.5 text-xs text-fg-faint">
        ✖ {t(locale, 'interaction.cancelled')}
      </div>
    );
  }

  const disabled = !active;
  const toggle = (opt: string) =>
    setSelected((cur) =>
      cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt],
    );

  return (
    <div className="flex flex-col gap-2 rounded-md border border-accent/40 bg-accent/5 px-2.5 py-2">
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-fg-dim">
        {req.prompt}
      </div>

      {req.type === 'select' && !req.multi && (
        <div className="flex flex-wrap gap-1.5">
          {req.options?.map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={disabled}
              onClick={() => onAnswer({ kind: 'select', values: [opt] })}
              className="rounded border border-border bg-bg px-2 py-1 text-xs text-fg transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {req.type === 'select' && req.multi && (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-faint">
            {t(locale, 'interaction.multiHint')}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {req.options?.map((opt) => {
              const on = selected.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggle(opt)}
                  className={
                    'rounded border px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ' +
                    (on
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border bg-bg text-fg hover:border-accent/50')
                  }
                >
                  {on ? '☑' : '☐'} {opt}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            disabled={disabled || selected.length === 0}
            onClick={() => onAnswer({ kind: 'select', values: selected })}
            className="self-start rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t(locale, 'interaction.submit')}
          </button>
        </div>
      )}

      {req.type === 'input' && (
        <div className="flex flex-col gap-2">
          {req.multiline ? (
            <textarea
              value={text}
              disabled={disabled}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                req.placeholder ?? t(locale, 'interaction.inputPlaceholder')
              }
              rows={3}
              className="resize-none rounded border border-border bg-bg p-2 text-sm text-fg outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-50"
            />
          ) : (
            <input
              value={text}
              disabled={disabled}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && text.trim()) {
                  e.preventDefault();
                  onAnswer({ kind: 'input', text: text.trim() });
                }
              }}
              placeholder={
                req.placeholder ?? t(locale, 'interaction.inputPlaceholder')
              }
              className="rounded border border-border bg-bg px-2 py-1.5 text-sm text-fg outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-50"
            />
          )}
          <button
            type="button"
            disabled={disabled || !text.trim()}
            onClick={() => onAnswer({ kind: 'input', text: text.trim() })}
            className="self-start rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t(locale, 'interaction.submit')}
          </button>
        </div>
      )}

      {req.type === 'confirm' && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onAnswer({ kind: 'confirm', confirmed: true })}
            className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {req.confirmLabel ?? t(locale, 'interaction.confirm')}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onAnswer({ kind: 'confirm', confirmed: false })}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-fg-dim transition-colors hover:border-accent-3/60 hover:text-accent-3 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {req.cancelLabel ?? t(locale, 'common.cancel')}
          </button>
        </div>
      )}

      {disabled ? (
        <span className="font-mono text-[10px] text-fg-faint">
          {t(locale, 'interaction.ended')}
        </span>
      ) : (
        <button
          type="button"
          onClick={onDismiss}
          className="self-start font-mono text-[10px] text-fg-faint underline-offset-2 transition-colors hover:text-accent-3 hover:underline"
          title={t(locale, 'interaction.skipTitle')}
        >
          {t(locale, 'interaction.skip')}
        </button>
      )}
    </div>
  );
}

/**
 * CONTRACT: default export, no props. Bottom-center AI interaction dock.
 *
 * Left : AI return stream (messages from the store).
 * Right: AI input box. Enter inserts a newline; Ctrl+Enter calls
 *        store.sendPrompt.
 *
 * The whole dock is vertically resizable: drag the handle on its top edge
 * (cursor becomes row-resize) to change its height; the value is persisted.
 *
 * The split between the two panes is horizontally resizable: drag the vertical
 * divider between them (cursor becomes col-resize) to change the AI-input pane
 * width; the AI-return pane fills the rest. The width is persisted and clamped
 * so neither pane collapses.
 *
 * Mirrors design.html §06 "中 · 主工作区" bottom row (AI 返回 / AI 输入).
 */
export default function AIDock() {
  const messages = useStore((s) => s.messages);
  const sendPrompt = useStore((s) => s.sendPrompt);
  const runSelection = useStore((s) => workflowGatewaySelection(s.workflow));
  const setGlobalRunSelection = useStore((s) => s.setGlobalRunSelection);
  const clearGlobalRunSelection = useStore((s) => s.clearGlobalRunSelection);
  const composer = useStore((s) => s.composer);
  const draft = useStore((s) => s.composerDraft);
  const composerFocusVersion = useStore((s) => s.composerFocusVersion);
  const locale = useStore((s) => s.locale);
  const setComposer = useStore((s) => s.setComposer);
  const setComposerDraft = useStore((s) => s.setComposerDraft);
  const setWorkspace = useStore((s) => s.setWorkspace);
  const permissionOptions = useStore((s) => s.permissionOptions);
  const workspaceHistory = useStore((s) => s.workspaceHistory);
  const mode = useStore((s) => s.mode);
  const aiStreaming = useStore((s) => s.aiStreaming);
  const answerInteraction = useStore((s) => s.answerInteraction);
  const dismissInteraction = useStore((s) => s.dismissInteraction);
  const streamRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(draft);
  const selectionRef = useRef<TextSelection>({ start: 0, end: 0 });
  const lastComposerFocusVersion = useRef(composerFocusVersion);
  const messageRefs = useRef(new Map<string, HTMLLIElement>());
  const activeSearchMatchNodeRef = useRef<HTMLElement | null>(null);
  const searchScrollTopRef = useRef<number | null>(null);
  const lastSearchActiveRef = useRef(false);

  const isReadOnly = mode === 'running';
  const [dropActive, setDropActive] = useState(false);
  const [returnSearch, setReturnSearch] = useState('');
  const [activeSearchMatchIndex, setActiveSearchMatchIndex] = useState(0);
  const [gatewayRevision, setGatewayRevision] = useState(0);
  const availableGatewayOptions = useMemo(() => {
    void gatewayRevision;
    return listGatewayRunOptions();
  }, [gatewayRevision]);
  const noGatewayOptions = availableGatewayOptions.length === 0;
  const gatewayOptions = useMemo<GatewayRunOption[]>(
    () =>
      noGatewayOptions
        ? [
            {
              id: selectionKey(runSelection),
              label: t(locale, 'settings.models.noRuntimeTitle'),
              hint: t(locale, 'settings.tabs.models'),
              selection: runSelection,
              transport: 'simulator' as const,
            },
          ]
        : availableGatewayOptions,
    [noGatewayOptions, availableGatewayOptions, runSelection, locale],
  );
  const displayedRunSelection = bestAvailableSelection(
    runSelection,
    gatewayOptions,
  );
  const normalizedSearch = useMemo(
    () => normalizeSearchQuery(returnSearch),
    [returnSearch],
  );
  const searchMatches = useMemo(
    () => buildSearchMatches(messages, normalizedSearch),
    [messages, normalizedSearch],
  );
  const activeSearchMatch = searchMatches[activeSearchMatchIndex] ?? null;
  const activeSearchMatchId = activeSearchMatch?.id ?? null;
  const activeSearchMatchMessageId = activeSearchMatch?.messageId ?? null;
  const activeSearchMatchSource = activeSearchMatch?.source ?? null;
  const searchMatchMessageIds = useMemo(
    () => new Set(searchMatches.map((match) => match.messageId)),
    [searchMatches],
  );

  // Split the flat channel list into the three runtime categories (Claude Code
  // / Codex / Gemini) so the dropdown renders a divider + header per group. The
  // synthetic "no runtime" fallback stays ungrouped.
  const groupedGatewayOptions = useMemo(() => {
    if (noGatewayOptions) return gatewayOptions;
    return [...gatewayOptions]
      .sort(
        (a, b) =>
          adapterGroupRank(a.selection.adapter) -
          adapterGroupRank(b.selection.adapter),
      )
      .map((option) => ({
        ...option,
        group: runtimeAdapterLabel(option.selection.adapter),
      }));
  }, [gatewayOptions, noGatewayOptions]);

  // "Inherit global selection": when no explicit pin is stored, the composer
  // follows the Settings-active provider. A sentinel option at the top of the
  // dropdown represents this default state; picking a concrete channel pins it.
  const isInheriting = useMemo(() => {
    void gatewayRevision;
    return !hasExplicitGatewayPin();
  }, [gatewayRevision]);

  const modelSelectOptions = useMemo<SelectOption[]>(() => {
    if (noGatewayOptions) return groupedGatewayOptions;
    const resolvedLabel = groupedGatewayOptions.find(
      (option) => option.id === selectionKey(displayedRunSelection),
    )?.label;
    const inheritOption: SelectOption = {
      id: INHERIT_SELECTION_ID,
      label: t(locale, 'dock.inheritGlobal'),
      hint: resolvedLabel,
    };
    return [inheritOption, ...groupedGatewayOptions];
  }, [groupedGatewayOptions, noGatewayOptions, displayedRunSelection, locale]);

  const modelSelectValue =
    isInheriting && !noGatewayOptions
      ? INHERIT_SELECTION_ID
      : selectionKey(displayedRunSelection);

  const modelStrategyOptions = useMemo<SelectOption[]>(
    () => [
      { id: 'inherit', label: t(locale, 'dock.modelStrategy.inherit') },
      { id: 'smart', label: t(locale, 'dock.modelStrategy.smart') },
      { id: 'prefer-better', label: t(locale, 'dock.modelStrategy.better') },
      { id: 'prefer-cheaper', label: t(locale, 'dock.modelStrategy.cheaper') },
    ],
    [locale],
  );

  const [height, setHeight] = useState<number>(
    () => loadDockHeight() ?? DEFAULT_DOCK_HEIGHT,
  );

  // Width (px) of the right-hand AI-input pane. The left AI-return pane fills
  // the remaining space, so dragging the divider re-splits the dock.
  const [inputWidth, setInputWidth] = useState<number>(
    () => loadPaneWidth(INPUT_WIDTH_KEY) ?? DEFAULT_INPUT_WIDTH,
  );
  const [renderedInputWidth, setRenderedInputWidth] = useState(inputWidth);
  const dockRef = useRef<HTMLDivElement>(null);

  const setActiveSearchMatchNode = useCallback((node: HTMLElement | null) => {
    activeSearchMatchNodeRef.current = node;
  }, []);

  const focusSearchInput = useCallback(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);

  const clearReturnSearch = useCallback(() => {
    setReturnSearch('');
    setActiveSearchMatchIndex(0);
    focusSearchInput();
  }, [focusSearchInput]);

  const moveSearchMatch = useCallback(
    (step: number) => {
      if (searchMatches.length === 0) return;
      setActiveSearchMatchIndex((current) => {
        const next = (current + step + searchMatches.length) % searchMatches.length;
        return next;
      });
    },
    [searchMatches.length],
  );

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    void primeCliRuntime().finally(() =>
      setGatewayRevision((revision) => revision + 1),
    );
    const unsubscribeCli = subscribeCliRuntime(() =>
      setGatewayRevision((revision) => revision + 1),
    );
    const onGatewayConfigChanged = () =>
      setGatewayRevision((revision) => revision + 1);
    window.addEventListener('owf:gateway-config-changed', onGatewayConfigChanged);
    return () =>
      {
        unsubscribeCli();
        window.removeEventListener(
        'owf:gateway-config-changed',
        onGatewayConfigChanged,
        );
      };
  }, []);

  const rememberSelection = useCallback(
    (target: HTMLTextAreaElement | null = inputRef.current) => {
      if (!target) return;
      const max = draftRef.current.length;
      selectionRef.current = {
        start: clampSelection(target.selectionStart, max),
        end: clampSelection(target.selectionEnd, max),
      };
    },
    [],
  );

  const insertComposerText = useCallback(
    (text: string, selection = selectionRef.current) => {
      if (isReadOnly || !text) return;

      const current = draftRef.current;
      const start = clampSelection(selection.start, current.length);
      const end = clampSelection(selection.end, current.length);
      const next = current.slice(0, start) + text + current.slice(end);
      const caret = start + text.length;

      draftRef.current = next;
      selectionRef.current = { start: caret, end: caret };
      setComposerDraft(next);

      window.requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(caret, caret);
      });
    },
    [isReadOnly, setComposerDraft],
  );

  const insertFilePaths = useCallback(
    (paths: string[], selection = selectionRef.current) => {
      insertComposerText(formatFilePathInsertion(paths), selection);
    },
    [insertComposerText],
  );

  /** Clamp the input width to keep both panes usable within the dock. */
  const clampInputWidth = useCallback((w: number): number => {
    const total = Math.max(0, dockRef.current?.clientWidth ?? window.innerWidth);
    const constrained = total < MIN_INPUT_WIDTH + MIN_RETURN_WIDTH;
    const minInput = constrained
      ? Math.min(
          MIN_INPUT_WIDTH,
          Math.max(
            NARROW_INPUT_MIN_WIDTH,
            Math.floor(total * NARROW_INPUT_WIDTH_RATIO),
          ),
        )
      : MIN_INPUT_WIDTH;
    const minReturn = constrained
      ? Math.max(NARROW_INPUT_MIN_WIDTH, total - minInput)
      : MIN_RETURN_WIDTH;
    const max = Math.max(minInput, total - minReturn);
    return Math.min(Math.max(w, minInput), max);
  }, []);

  useEffect(() => {
    setActiveSearchMatchIndex(0);
  }, [normalizedSearch]);

  useEffect(() => {
    if (searchMatches.length === 0) {
      setActiveSearchMatchIndex(0);
      return;
    }
    setActiveSearchMatchIndex((current) =>
      Math.min(current, searchMatches.length - 1),
    );
  }, [searchMatches.length]);

  useEffect(() => {
    const wasActive = lastSearchActiveRef.current;
    lastSearchActiveRef.current = normalizedSearch.length > 0;
    if (normalizedSearch) {
      searchScrollTopRef.current = null;
    }
    if (wasActive && !normalizedSearch) {
      const el = streamRef.current;
      searchScrollTopRef.current = el?.scrollTop ?? null;
      window.requestAnimationFrame(() => {
        if (lastSearchActiveRef.current) return;
        const stream = streamRef.current;
        const top = searchScrollTopRef.current;
        if (!stream || top === null) return;
        stream.scrollTop = top;
        searchScrollTopRef.current = null;
      });
    }
  }, [normalizedSearch]);

  // Keep the latest message in view unless return search is active.
  useEffect(() => {
    if (normalizedSearch) return;
    if (searchScrollTopRef.current !== null) return;
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, normalizedSearch]);

  useEffect(() => {
    if (!normalizedSearch || !activeSearchMatchId || !activeSearchMatchMessageId) {
      return;
    }
    const target =
      activeSearchMatchSource === 'text'
        ? activeSearchMatchNodeRef.current
        : null;
    const messageEl = messageRefs.current.get(activeSearchMatchMessageId);
    const scrollTarget =
      target && target.dataset.searchMatchId === activeSearchMatchId
        ? target
        : messageEl;
    scrollTarget?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  }, [
    activeSearchMatchId,
    activeSearchMatchMessageId,
    activeSearchMatchSource,
    normalizedSearch,
  ]);

  // PromptPanel can append text into this composer. When it does, move focus to
  // the AI input and place the caret at the end so the user can continue typing.
  useEffect(() => {
    if (composerFocusVersion === lastComposerFocusVersion.current) return;
    lastComposerFocusVersion.current = composerFocusVersion;
    const el = inputRef.current;
    if (!el || !shouldRefocusComposerAfterAppend(mode)) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    selectionRef.current = { start: end, end };
  }, [composerFocusVersion, mode]);

  useEffect(() => {
    if (!tauriAvailable()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      const dispose = await getCurrentWebview().onDragDropEvent((event) => {
        if (disposed) return;
        const payload = event.payload;
        const el = inputRef.current;

        if (payload.type === 'leave') {
          setDropActive(false);
          return;
        }
        if (!el || isReadOnly) {
          setDropActive(false);
          return;
        }
        if (payload.type === 'enter') {
          setDropActive(pointInsideElement(payload.position, el));
          return;
        }
        if (payload.type === 'over') {
          setDropActive(pointInsideElement(payload.position, el));
          return;
        }
        if (payload.type === 'drop') {
          const inside = pointInsideElement(payload.position, el);
          setDropActive(false);
          if (inside) insertFilePaths(payload.paths);
        }
      });
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
    };

    void setup().catch(() => {
      if (!disposed) setDropActive(false);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [insertFilePaths, isReadOnly]);

  // Re-clamp the input width when the window (and thus the dock) resizes so
  // neither pane collapses below its minimum.
  useLayoutEffect(() => {
    const onResize = () => setRenderedInputWidth(clampInputWidth(inputWidth));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampInputWidth, inputWidth]);

  // Drag the top edge to resize. The panel is anchored to the bottom, so
  // dragging up (smaller clientY) increases height.
  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = height;
      const prevUserSelect = document.body.style.userSelect;
      const prevCursor = document.body.style.cursor;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';

      const onMove = (ev: MouseEvent) => {
        setHeight(clampHeight(startHeight - (ev.clientY - startY)));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = prevUserSelect;
        document.body.style.cursor = prevCursor;
        setHeight((h) => {
          saveDockHeight(h);
          return h;
        });
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [height],
  );

  // Drag the vertical divider between the AI-return (left) and AI-input
  // (right) panes. Dragging left (smaller clientX) widens the input pane.
  const onSplitStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = renderedInputWidth;
      const prevUserSelect = document.body.style.userSelect;
      const prevCursor = document.body.style.cursor;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      const onMove = (ev: MouseEvent) => {
        const next = clampInputWidth(startWidth - (ev.clientX - startX));
        setInputWidth(next);
        setRenderedInputWidth(next);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = prevUserSelect;
        document.body.style.cursor = prevCursor;
        setInputWidth((w) => {
          savePaneWidth(INPUT_WIDTH_KEY, w);
          return w;
        });
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [renderedInputWidth, clampInputWidth],
  );

  const submit = () => {
    if (isReadOnly || aiStreaming) return;
    const text = draft.trim();
    if (!text) return;
    sendPrompt(text);
    setComposerDraft('');
    draftRef.current = '';
    selectionRef.current = { start: 0, end: 0 };
  };

  const addFiles = async () => {
    if (isReadOnly) return;
    rememberSelection();
    const paths = await pickComposerFiles(t(locale, 'dock.addFileDialogTitle'));
    if (paths?.length) insertFilePaths(paths);
  };

  return (
    <div
      ref={dockRef}
      className="relative flex shrink-0 border-t border-border bg-panel"
      style={{ height }}
    >
      {/* Resize handle — sits on the top edge, cursor becomes row-resize. */}
      <div
        onMouseDown={onResizeStart}
        title={t(locale, 'common.resizeHeight')}
        className="group absolute -top-1 left-0 right-0 z-20 flex h-2 cursor-row-resize items-center justify-center"
      >
        <div className="h-0.5 w-full bg-transparent transition-colors group-hover:bg-accent/40" />
      </div>
      {/* AI return stream */}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-border-soft px-3 py-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
            {t(locale, 'dock.aiReturn')}
          </span>
          {aiStreaming && (
            <span className="flex items-center gap-1 font-mono text-[10px] text-accent-2">
              <span className="omc-pulse-dot" />
              {t(locale, 'dock.generating')}
            </span>
          )}
          <div className="flex min-w-0 flex-1 basis-full flex-wrap items-center justify-end gap-1 sm:ml-auto sm:basis-0 sm:flex-nowrap">
            <div className="flex min-w-0 flex-1 basis-full items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 transition-colors focus-within:border-accent sm:basis-auto">
              <Search size={13} className="shrink-0 text-fg-faint" />
              <input
                ref={searchInputRef}
                value={returnSearch}
                onChange={(e) => setReturnSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    moveSearchMatch(e.shiftKey ? -1 : 1);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    if (returnSearch) clearReturnSearch();
                    else searchInputRef.current?.blur();
                  }
                }}
                placeholder={t(locale, 'dock.searchPlaceholder')}
                aria-label={t(locale, 'dock.searchAria')}
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-faint"
              />
              {returnSearch ? (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={clearReturnSearch}
                  title={t(locale, 'dock.searchClear')}
                  aria-label={t(locale, 'dock.searchClear')}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-faint transition-colors hover:text-fg"
                >
                  <X size={12} />
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => moveSearchMatch(-1)}
              disabled={searchMatches.length === 0}
              title={t(locale, 'dock.searchPrevious')}
              aria-label={t(locale, 'dock.searchPrevious')}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-panel-2 text-fg-dim transition-colors hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronUp size={14} />
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => moveSearchMatch(1)}
              disabled={searchMatches.length === 0}
              title={t(locale, 'dock.searchNext')}
              aria-label={t(locale, 'dock.searchNext')}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-panel-2 text-fg-dim transition-colors hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronDown size={14} />
            </button>
            <span
              aria-live="polite"
              className={
                'min-w-[3.75rem] whitespace-nowrap text-right font-mono text-[10px] ' +
                (normalizedSearch && searchMatches.length === 0
                  ? 'text-accent-3'
                  : 'text-fg-faint')
              }
            >
              {normalizedSearch
                ? searchMatches.length === 0
                  ? t(locale, 'dock.searchNoMatch')
                  : `${activeSearchMatchIndex + 1}/${searchMatches.length}`
                : ''}
            </span>
          </div>
        </header>
        <div ref={streamRef} className="min-h-0 flex-1 overflow-y-auto p-3">
          {messages.length === 0 ? (
            <div className="text-xs text-fg-faint">
              {t(locale, 'dock.empty')}
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {messages.map((m) => {
                const isUser = m.role === 'user';
                const isSystem = m.role === 'system';
                const isSearchHit = searchMatchMessageIds.has(m.id);
                const isCurrentSearchHit = activeSearchMatchMessageId === m.id;
                const roleLabel = isUser
                  ? '› you'
                  : isSystem
                    ? '• system'
                    : '⟳ assistant';
                const roleClass = isUser
                  ? 'text-accent'
                  : isSystem
                    ? 'text-accent-3'
                    : 'text-accent-2';
                return (
                  <li
                    key={m.id}
                    ref={(node) => {
                      if (node) messageRefs.current.set(m.id, node);
                      else messageRefs.current.delete(m.id);
                    }}
                    className={
                      'flex flex-col gap-1 rounded-md px-1 py-0.5 transition-colors ' +
                      (isCurrentSearchHit
                        ? 'bg-accent/5 ring-1 ring-inset ring-accent-3/40'
                        : isSearchHit
                          ? 'ring-1 ring-inset ring-accent/20'
                          : '')
                    }
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          'font-mono text-[10px] uppercase tracking-wider ' + roleClass
                        }
                      >
                        {roleLabel}
                      </span>
                      <span
                        className="font-mono text-[10px] text-fg-faint"
                        title={new Date(m.createdAt).toLocaleString()}
                      >
                        {formatMessageTime(m.createdAt)}
                      </span>
                    </div>
                    {m.interaction ? (
                      <InteractionWidget
                        message={m}
                        locale={locale}
                        active={
                          (m.interactionStatus ?? 'pending') === 'pending' &&
                          (mode === 'running' || aiStreaming)
                        }
                        onAnswer={(answer) => answerInteraction(m.id, answer)}
                        onDismiss={() => dismissInteraction(m.id)}
                      />
                    ) : (
                      <span className="whitespace-pre-wrap text-sm leading-relaxed text-fg-dim">
                        {renderHighlightedText(
                          m.text,
                          m.id,
                          normalizedSearch,
                          activeSearchMatchId,
                          setActiveSearchMatchNode,
                        )}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Vertical divider — drag to re-split AI 返回 / AI 输入. */}
      <div
        onMouseDown={onSplitStart}
        title={t(locale, 'common.resizeSplit')}
        className="group relative z-20 flex w-1.5 shrink-0 cursor-col-resize items-stretch justify-center border-l border-border-soft"
      >
        <div className="h-full w-0.5 bg-transparent transition-colors group-hover:bg-accent/40" />
      </div>

      {/* AI input box */}
      <section
        className="relative flex shrink-0 flex-col"
        style={{ width: renderedInputWidth }}
      >
        <header className="flex items-center justify-between gap-2 border-b border-border-soft px-3 py-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-faint">
            {t(locale, 'dock.aiInput')}
            {isReadOnly ? t(locale, 'dock.readonlySuffix') : ''}
          </span>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              draftRef.current = e.target.value;
              setComposerDraft(e.target.value);
              rememberSelection(e.currentTarget);
            }}
            onClick={(e) => rememberSelection(e.currentTarget)}
            onKeyUp={(e) => rememberSelection(e.currentTarget)}
            onSelect={(e) => rememberSelection(e.currentTarget)}
            onFocus={(e) => rememberSelection(e.currentTarget)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                submit();
              }
            }}
            onDragOver={(e) => {
              if (isReadOnly || tauriAvailable()) return;
              e.preventDefault();
              setDropActive(true);
            }}
            onDragLeave={() => setDropActive(false)}
            onDrop={(e) => {
              if (isReadOnly || tauriAvailable()) return;
              e.preventDefault();
              setDropActive(false);
              rememberSelection(e.currentTarget);
              insertFilePaths(pathsFromDataTransfer(e.dataTransfer));
            }}
            readOnly={isReadOnly}
            disabled={isReadOnly}
            placeholder={
              isReadOnly
                ? t(locale, 'dock.runningPlaceholder')
                : t(locale, 'dock.placeholder')
            }
            className={
              'min-h-0 flex-1 resize-none rounded-md border p-2.5 text-sm leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-accent ' +
              (dropActive ? 'border-accent bg-accent/5 ' : 'border-border bg-bg ') +
              (isReadOnly ? 'cursor-not-allowed opacity-60' : '')
            }
          />

          {/* Tool row: add file · permission · global run selection · send */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                void addFiles();
              }}
              disabled={isReadOnly}
              title={
                isReadOnly
                  ? t(locale, 'dock.inputLockedTitle')
                  : t(locale, 'dock.addFileTitle')
              }
              aria-label={t(locale, 'dock.addFileTitle')}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-panel-2 text-fg-dim transition-colors hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus size={15} strokeWidth={2} />
            </button>
            <Select
              title={t(locale, 'dock.permissionTitle')}
              options={permissionOptions.map((opt) => localizeSelectOption(opt, locale))}
              value={composer.permission}
              onChange={(id) => setComposer({ permission: id })}
              disabled={isReadOnly}
              icon="⚠"
            />
            <Select
              title={t(locale, 'dock.modelTitle')}
              options={modelSelectOptions}
              value={modelSelectValue}
              onChange={(id) => {
                if (id === INHERIT_SELECTION_ID) {
                  clearGlobalRunSelection();
                  return;
                }
                const selection = selectionFromKey(id);
                if (selection) setGlobalRunSelection(selection);
              }}
              disabled={isReadOnly || noGatewayOptions}
              className="min-w-0"
              icon="▣"
            />
            <Select
              title={t(locale, 'dock.modelStrategyTitle')}
              options={modelStrategyOptions}
              value={composer.modelStrategy}
              onChange={(id) => setComposer({ modelStrategy: id as ModelStrategy })}
              disabled={isReadOnly}
              className="min-w-0"
              icon="🧠"
            />
            <div className="min-w-0 flex-1" />
            <button
              type="button"
              onClick={submit}
              disabled={!draft.trim() || isReadOnly || aiStreaming}
              title={
                isReadOnly
                  ? t(locale, 'dock.inputLockedTitle')
                  : aiStreaming
                    ? t(locale, 'dock.aiGeneratingTitle')
                    : t(locale, 'dock.sendShortcut')
              }
              className="rounded-md bg-accent px-2.5 py-1.5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {aiStreaming ? '…' : '↑'}
            </button>
          </div>

          {/* Context row: workspace */}
          <div className="flex items-center gap-2">
            <WorkspaceSelect
              value={composer.workspace}
              history={workspaceHistory}
              onSelect={setWorkspace}
              disabled={aiStreaming}
            />
            <span className="font-mono text-[10px] text-fg-faint">
              {isReadOnly
                ? t(locale, 'dock.runningReadonly')
                : t(locale, 'dock.sendShortcut')}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
