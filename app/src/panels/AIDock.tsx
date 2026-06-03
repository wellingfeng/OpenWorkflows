import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ChevronDown,
  ChevronUp,
  Play,
  Plus,
  Search,
  Square,
  X,
} from 'lucide-react';
import Select from '@/components/Select';
import WorkspaceSelect from '@/components/WorkspaceSelect';
import { summarizeAnswer, type InteractionAnswer } from '@/core/interaction';
import {
  systemDefaultGatewaySelection,
  workflowDefaultGatewaySelection,
} from '@/lib/modelGateway/resolver';
import { RUNTIME_ADAPTERS } from '@/lib/adapters';
import {
  FREE_CHANNELS,
  ensureFreeProxy,
  freeChannelById,
  freeChannelReady,
  freeChannelSelection,
  getFreeChannelKey,
  getFreeChannelModelOverride,
  isFreeChannelSelection,
  loadFreeChannelKeyFromAutoConfig,
  setFreeChannelKey,
  setFreeChannelModel,
  type FreeChannel,
} from '@/lib/freeChannels';
import LocalModelSetupDialog from '@/components/LocalModelSetupDialog';
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
import {
  tauriAvailable,
  localModelStatus,
  openExternal,
  type LocalModelRuntimeStatus,
} from '@/lib/tauri';
import MessageContent from '@/components/ai/MessageContent';
import FilePreviewDrawer from '@/components/ai/FilePreviewDrawer';
import type { FileRef } from '@/components/ai/lib/filePath';
import {
  extractToolSentinels,
  hasToolSentinel,
} from '@/components/ai/lib/toolEvent';
import { shallow } from 'zustand/shallow';
import { isActiveAiEditingSession, useStore } from '@/store/useStore';

const DEFAULT_DOCK_HEIGHT = 208; // matches the former h-52
const MIN_DOCK_HEIGHT = 120;
/** Fixed height of the bottom input area in 'chat' layout (return fills the rest). */
const CHAT_INPUT_HEIGHT = 232;

/** localStorage key + bounds for the AI-input pane width (right column). */
const INPUT_WIDTH_KEY = 'openworkflow.aiInputWidth.v1';
const DEFAULT_INPUT_WIDTH = 384; // matches the former w-96
const MIN_INPUT_WIDTH = 280;
const MIN_RETURN_WIDTH = 240; // keep the AI-return pane usable
const NARROW_INPUT_MIN_WIDTH = 120;
const NARROW_INPUT_WIDTH_RATIO = 0.4;

/** localStorage key + bounds for the bottom input area height in 'chat' layout. */
const CHAT_INPUT_HEIGHT_KEY = 'openworkflow.chatInputHeight.v1';
const MIN_CHAT_INPUT_HEIGHT = 140;
const MIN_CHAT_RETURN_HEIGHT = 160; // keep the chat return area usable

/** Clamp the chat input-area height so neither it nor the return area collapses. */
function clampChatInputHeight(h: number): number {
  const max =
    typeof window !== 'undefined'
      ? Math.max(MIN_CHAT_INPUT_HEIGHT, window.innerHeight - MIN_CHAT_RETURN_HEIGHT)
      : 480;
  return Math.min(Math.max(h, MIN_CHAT_INPUT_HEIGHT), max);
}

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

/**
 * Strip inline tool sentinels (`<<OWF_TOOL>>…`) from a message's text so the
 * search index and the search-active plain-text fallback never see/show raw
 * protocol JSON that the rich renderer would otherwise turn into tool cards.
 */
function cleanMessageText(text: string): string {
  return hasToolSentinel(text) ? extractToolSentinels(text).text : text;
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
    const cleaned = cleanMessageText(message.text);
    if (cleaned.trim()) {
      segments.push({ source: 'text', text: cleaned });
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

function describeLocalModelStatus(
  locale: Locale,
  channel: FreeChannel,
  status: LocalModelRuntimeStatus,
): string {
  const suffix = status.message ? ` ${status.message}` : '';
  if (status.state === 'missing_model') {
    return `${channel.label}: ${t(locale, 'settings.freeChannels.localMissingModel')}。`;
  }
  if (status.state === 'service_unavailable') {
    return `${channel.label}: ${t(locale, 'settings.freeChannels.localServiceDown')}。${suffix}`;
  }
  if (status.state === 'model_missing') {
    return `${channel.label}: ${t(locale, 'settings.freeChannels.localModelMissing')} (${status.configuredModel})。${suffix}`;
  }
  if (status.state === 'desktop_unavailable') {
    return `${channel.label}: ${t(locale, 'settings.freeChannels.localDesktopOnly')}。`;
  }
  if (status.state === 'unsupported') {
    return `${channel.label}: ${t(locale, 'settings.freeChannels.localUnsupported')}。${suffix}`;
  }
  return `${channel.label}: ${t(locale, 'settings.freeChannels.localServiceError')}。${suffix}`;
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
 *
 * `layout`:
 *   - 'dock' (default): the bottom dock described above — horizontal split,
 *     top-edge height resize, vertical width-resize divider.
 *   - 'chat': a full-height vertical chat surface used by simple workflows —
 *     AI return on top (fills the height), AI input pinned below. No canvas,
 *     no resize handles; reuses the exact same return/input JSX.
 */
export default function AIDock({
  layout = 'dock',
}: {
  layout?: 'dock' | 'chat';
} = {}) {
  const isChat = layout === 'chat';
  const messages = useStore((s) => s.messages);
  const sendPrompt = useStore((s) => s.sendPrompt);
  const stopChat = useStore((s) => s.stopChat);
  const chatTitle = useStore((s) => s.workflow.meta?.name ?? '');
  const simpleMode = useStore((s) => s.workflow.meta?.simple === true);
  const activeSessionIsWorkflow = useStore((s) => {
    if (!s.activeSessionId) return true;
    const active =
      s.sessions.find((session) => session.id === s.activeSessionId) ??
      (s.activeWorkspaceId
        ? s.sessionTree[s.activeWorkspaceId]?.find(
            (session) => session.id === s.activeSessionId,
          )
        : undefined);
    return active?.isWorkflow ?? true;
  });
  const activeSessionFavorite = useStore((s) => {
    if (!s.activeSessionId) return false;
    const active =
      s.sessions.find((session) => session.id === s.activeSessionId) ??
      (s.activeWorkspaceId
        ? s.sessionTree[s.activeWorkspaceId]?.find(
            (session) => session.id === s.activeSessionId,
          )
        : undefined);
    return active?.favorite === true;
  });
  const runSelection = useStore((s) => workflowDefaultGatewaySelection(s.workflow), shallow);
  const setGlobalRunSelection = useStore((s) => s.setGlobalRunSelection);
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
  const activeAiEditing = useStore((s) => isActiveAiEditingSession(s));
  const activeChatting = useStore((s) =>
    s.chattingSessions.some(
      (session) =>
        session.workspaceId === (s.activeWorkspaceId ?? null) &&
        session.sessionId === (s.activeSessionId ?? null),
    ),
  );
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
  const [filePreviewRef, setFilePreviewRef] = useState<FileRef | null>(null);
  const [returnSearchOpen, setReturnSearchOpen] = useState(false);
  const [returnSearch, setReturnSearch] = useState('');
  const [activeSearchMatchIndex, setActiveSearchMatchIndex] = useState(0);
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
  const reusableFavoritePrompt = useMemo(() => {
    if (!isChat || !activeSessionFavorite) return '';
    return messages.find((message) => message.role === 'user')?.text.trim() ?? '';
  }, [activeSessionFavorite, isChat, messages]);
  const runtimeSelectOptions = useMemo<SelectOption[]>(
    () =>
      RUNTIME_ADAPTERS.map((adapter) => ({
        id: adapter.id,
        label: adapter.label,
      })),
    [],
  );
  const runtimeSelectValue =
    RUNTIME_ADAPTERS.find((adapter) => adapter.id === runSelection.adapter)?.id ??
    RUNTIME_ADAPTERS[0].id;

  // "Channel" select — only shown when the selected runtime is claude-code.
  // Option 1 = system default (no proxy), options 2..n = the free channels
  // routed through the built-in local proxy. See lib/freeChannels.ts.
  const isClaudeCodeRuntime = runtimeSelectValue === 'claude-code';
  const [freeChannelRevision, setFreeChannelRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setFreeChannelRevision((n) => n + 1);
    window.addEventListener('owf:gateway-config-changed', refresh);
    return () => window.removeEventListener('owf:gateway-config-changed', refresh);
  }, []);
  const [localRuntimeStatuses, setLocalRuntimeStatuses] = useState<
    Record<string, LocalModelRuntimeStatus | undefined>
  >({});
  const channelSelectOptions = useMemo<SelectOption[]>(
    () => [
      { id: '__system__', label: t(locale, 'dock.channelSystemDefault') },
      ...FREE_CHANNELS.map((c) => {
        const localStatus = c.local ? localRuntimeStatuses[c.id] : undefined;
        const needsAttention =
          !freeChannelReady(c.id) || (c.local && localStatus && !localStatus.ready);
        return {
          id: c.id,
          label: 'Free · ' + c.label + (needsAttention ? ' ⚠' : ''),
        };
      }),
    ],
    [locale, freeChannelRevision, localRuntimeStatuses],
  );
  const channelSelectValue =
    isFreeChannelSelection(runSelection) ?? '__system__';
  const [keyModalChannel, setKeyModalChannel] = useState<FreeChannel | null>(null);
  const [keyModalValue, setKeyModalValue] = useState('');
  const [localSetupChannel, setLocalSetupChannel] =
    useState<FreeChannel | null>(null);
  const [localModelValue, setLocalModelValue] = useState('');
  const [localSetupMessage, setLocalSetupMessage] = useState<string | null>(null);
  const [checkingLocalModel, setCheckingLocalModel] = useState(false);

  useEffect(() => {
    if (!isClaudeCodeRuntime || !tauriAvailable()) return;
    let disposed = false;
    const localChannels = FREE_CHANNELS.filter((channel) => {
      if (!channel.local) return false;
      return getFreeChannelModelOverride(channel.id).length > 0;
    });
    if (localChannels.length === 0) {
      setLocalRuntimeStatuses({});
      return;
    }
    void Promise.all(
      localChannels.map(async (channel) => {
        const model = getFreeChannelModelOverride(channel.id);
        try {
          return [channel.id, await localModelStatus(channel.id, model)] as const;
        } catch {
          return [channel.id, undefined] as const;
        }
      }),
    ).then((entries) => {
      if (disposed) return;
      setLocalRuntimeStatuses(Object.fromEntries(entries));
    });
    return () => {
      disposed = true;
    };
  }, [isClaudeCodeRuntime, freeChannelRevision]);
  const useFreeChannel = useCallback(
    (channel: FreeChannel) => {
      void ensureFreeProxy();
      setGlobalRunSelection(
        freeChannelSelection(channel.id, runSelection.modelClass),
      );
      setKeyModalChannel(null);
      setKeyModalValue('');
      setLocalSetupChannel(null);
      setLocalModelValue('');
      setLocalSetupMessage(null);
    },
    [runSelection.modelClass, setGlobalRunSelection],
  );
  const onChannelChange = useCallback(
    (id: string) => {
      void (async () => {
        if (id === '__system__') {
          setGlobalRunSelection(systemDefaultGatewaySelection('claude-code'));
          return;
        }
        const channel = freeChannelById(id);
        if (!channel) return;
        if (channel.local) {
          const model = getFreeChannelModelOverride(id);
          if (!model.trim()) {
            setLocalSetupChannel(channel);
            setLocalModelValue(model);
            setLocalSetupMessage(null);
            return;
          }
          if (tauriAvailable()) {
            setCheckingLocalModel(true);
            try {
              const status = await localModelStatus(id, model);
              setLocalRuntimeStatuses((prev) => ({ ...prev, [id]: status }));
              if (!status.ready) {
                setLocalSetupChannel(channel);
                setLocalModelValue(model);
                setLocalSetupMessage(
                  describeLocalModelStatus(locale, channel, status),
                );
                return;
              }
            } catch (err) {
              const status: LocalModelRuntimeStatus = {
                channelId: id,
                configuredModel: model,
                reachable: false,
                ready: false,
                state: 'service_unavailable',
                models: [],
                message: err instanceof Error ? err.message : String(err),
              };
              setLocalRuntimeStatuses((prev) => ({ ...prev, [id]: status }));
              setLocalSetupChannel(channel);
              setLocalModelValue(model);
              setLocalSetupMessage(
                describeLocalModelStatus(locale, channel, status),
              );
              return;
            } finally {
              setCheckingLocalModel(false);
            }
          }
          useFreeChannel(channel);
          return;
        }
        const key =
          channel.needsKey && !getFreeChannelKey(id)
            ? await loadFreeChannelKeyFromAutoConfig(id)
            : getFreeChannelKey(id);
        if (channel.needsKey && !key) {
          setKeyModalChannel(channel);
          setKeyModalValue('');
          return;
        }
        useFreeChannel(channel);
      })();
    },
    [locale, setGlobalRunSelection, useFreeChannel],
  );
  const saveKeyModal = useCallback(() => {
    if (!keyModalChannel) return;
    const key = keyModalValue.trim();
    if (!key) return;
    setFreeChannelKey(keyModalChannel.id, key);
    useFreeChannel(keyModalChannel);
  }, [keyModalChannel, keyModalValue, useFreeChannel]);
  const saveLocalModelModal = useCallback(() => {
    if (!localSetupChannel) return;
    const model = localModelValue.trim();
    if (!model) return;
    void (async () => {
      setCheckingLocalModel(true);
      setFreeChannelModel(localSetupChannel.id, model);
      try {
        if (tauriAvailable()) {
          const status = await localModelStatus(localSetupChannel.id, model);
          setLocalRuntimeStatuses((prev) => ({
            ...prev,
            [localSetupChannel.id]: status,
          }));
          if (!status.ready) {
            setLocalSetupMessage(
              describeLocalModelStatus(locale, localSetupChannel, status),
            );
            return;
          }
        }
        useFreeChannel(localSetupChannel);
      } catch (err) {
        const status: LocalModelRuntimeStatus = {
          channelId: localSetupChannel.id,
          configuredModel: model,
          reachable: false,
          ready: false,
          state: 'service_unavailable',
          models: [],
          message: err instanceof Error ? err.message : String(err),
        };
        setLocalRuntimeStatuses((prev) => ({
          ...prev,
          [localSetupChannel.id]: status,
        }));
        setLocalSetupMessage(
          describeLocalModelStatus(locale, localSetupChannel, status),
        );
      } finally {
        setCheckingLocalModel(false);
      }
    })();
  }, [localModelValue, localSetupChannel, locale, useFreeChannel]);

  const ensureSelectedLocalChannelReady = useCallback(async (): Promise<boolean> => {
    const id = isFreeChannelSelection(runSelection);
    if (!id) return true;
    const channel = freeChannelById(id);
    if (!channel?.local) return true;
    const model = getFreeChannelModelOverride(id);
    if (!model.trim()) {
      setLocalSetupChannel(channel);
      setLocalModelValue(model);
      setLocalSetupMessage(null);
      return false;
    }
    if (!tauriAvailable()) return true;
    setCheckingLocalModel(true);
    try {
      const status = await localModelStatus(id, model);
      setLocalRuntimeStatuses((prev) => ({ ...prev, [id]: status }));
      if (status.ready) return true;
      setLocalSetupChannel(channel);
      setLocalModelValue(model);
      setLocalSetupMessage(describeLocalModelStatus(locale, channel, status));
      return false;
    } catch (err) {
      const status: LocalModelRuntimeStatus = {
        channelId: id,
        configuredModel: model,
        reachable: false,
        ready: false,
        state: 'service_unavailable',
        models: [],
        message: err instanceof Error ? err.message : String(err),
      };
      setLocalRuntimeStatuses((prev) => ({ ...prev, [id]: status }));
      setLocalSetupChannel(channel);
      setLocalModelValue(model);
      setLocalSetupMessage(describeLocalModelStatus(locale, channel, status));
      return false;
    } finally {
      setCheckingLocalModel(false);
    }
  }, [locale, runSelection]);

  // Open a local file referenced by an AI-message chip in the right preview pane.
  // Paths resolve against the active workspace folder in the Tauri command.
  const workspaceCwd = composer.workspace;
  const onOpenFile = useCallback(
    (ref: FileRef) => {
      setFilePreviewRef(ref);
    },
    [],
  );

  // Heuristic "live bubble": the last assistant message is streaming while the
  // AI is editing or a run is in flight. Drives streaming-safe markdown repair
  // and in-progress reasoning rendering.
  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id;
    }
    return null;
  }, [messages]);
  const aiBusy = mode === 'running' || activeAiEditing || activeChatting;

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
  // Height (px) of the bottom AI-input area in 'chat' layout. The AI-return area
  // above fills the remaining space, so dragging the divider re-splits the chat.
  const [chatInputHeight, setChatInputHeight] = useState<number>(
    () => loadPaneWidth(CHAT_INPUT_HEIGHT_KEY) ?? CHAT_INPUT_HEIGHT,
  );
  const dockRef = useRef<HTMLDivElement>(null);

  const setActiveSearchMatchNode = useCallback((node: HTMLElement | null) => {
    activeSearchMatchNodeRef.current = node;
  }, []);

  const focusSearchInput = useCallback(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);

  const openReturnSearch = useCallback(() => {
    setReturnSearchOpen(true);
  }, []);

  const closeReturnSearch = useCallback(() => {
    setReturnSearchOpen(false);
    setReturnSearch('');
    setActiveSearchMatchIndex(0);
    activeSearchMatchNodeRef.current = null;
  }, []);

  const clearReturnSearch = useCallback(() => {
    setReturnSearch('');
    setActiveSearchMatchIndex(0);
    if (returnSearchOpen) focusSearchInput();
  }, [focusSearchInput, returnSearchOpen]);

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
    if (returnSearchOpen) focusSearchInput();
  }, [focusSearchInput, returnSearchOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (keyModalChannel || localSetupChannel) return;
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === 'f'
      ) {
        event.preventDefault();
        openReturnSearch();
        return;
      }
      if (event.key === 'Escape' && returnSearchOpen) {
        event.preventDefault();
        closeReturnSearch();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    closeReturnSearch,
    keyModalChannel,
    localSetupChannel,
    openReturnSearch,
    returnSearchOpen,
  ]);

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

  // Drag the horizontal divider between the AI-return (top) and AI-input
  // (bottom) areas in 'chat' layout. Dragging down (larger clientY) shrinks the
  // input area; dragging up grows it.
  const onChatSplitStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = chatInputHeight;
      const prevUserSelect = document.body.style.userSelect;
      const prevCursor = document.body.style.cursor;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';

      const onMove = (ev: MouseEvent) => {
        setChatInputHeight(clampChatInputHeight(startHeight - (ev.clientY - startY)));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = prevUserSelect;
        document.body.style.cursor = prevCursor;
        setChatInputHeight((h) => {
          savePaneWidth(CHAT_INPUT_HEIGHT_KEY, h);
          return h;
        });
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [chatInputHeight],
  );

  const submit = (overrideText?: string) => {
    if (isReadOnly || activeAiEditing) return;
    const text = (overrideText ?? draft).trim();
    if (!text) return;
    void (async () => {
      if (!(await ensureSelectedLocalChannelReady())) return;
      sendPrompt(text);
      if (overrideText === undefined) {
        setComposerDraft('');
        draftRef.current = '';
        selectionRef.current = { start: 0, end: 0 };
      }
    })();
  };

  const chatRunText = draft.trim() || reusableFavoritePrompt;
  const runChat = () => {
    if (draft.trim()) submit();
    else submit(reusableFavoritePrompt);
  };

  const addFiles = async () => {
    if (isReadOnly) return;
    rememberSelection();
    const paths = await pickComposerFiles(t(locale, 'dock.addFileDialogTitle'));
    if (paths?.length) insertFilePaths(paths);
  };

  const searchStatus = normalizedSearch
    ? searchMatches.length === 0
      ? t(locale, 'dock.searchNoMatch')
      : `${activeSearchMatchIndex + 1}/${searchMatches.length}`
    : '';

  return (
    <div
      ref={dockRef}
      className={
        'relative ' +
        (isChat
          ? 'flex h-full min-h-0 flex-col bg-bg'
          : 'flex shrink-0 border-t border-border bg-panel')
      }
      style={isChat ? undefined : { height }}
    >
      {/* Resize handle — sits on the top edge, cursor becomes row-resize.
          Hidden in chat layout (the surface fills its parent). */}
      {!isChat && (
        <div
          onMouseDown={onResizeStart}
          title={t(locale, 'common.resizeHeight')}
          className="group absolute -top-1 left-0 right-0 z-20 flex h-2 cursor-row-resize items-center justify-center"
        >
          <div className="h-0.5 w-full bg-transparent transition-colors group-hover:bg-accent/40" />
        </div>
      )}
      {/* AI return stream */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="relative flex flex-wrap items-center gap-2 border-b border-border-soft px-3 py-2">
          {isChat ? (
            <span
              className="min-w-0 flex-1 truncate text-sm font-medium text-fg"
              title={chatTitle}
            >
              {chatTitle || t(locale, 'dock.aiReturn')}
            </span>
          ) : (
            <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
              {t(locale, 'dock.aiReturn')}
            </span>
          )}
          {activeAiEditing && (
            <span className="flex items-center gap-1 font-mono text-[10px] text-accent-2">
              <span className="omc-pulse-dot" />
              {t(locale, 'dock.generating')}
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {isChat &&
              (activeChatting ? (
                <button
                  type="button"
                  onClick={stopChat}
                  title={t(locale, 'dock.stopChatTitle')}
                  aria-label={t(locale, 'dock.stopChatTitle')}
                  className="flex shrink-0 items-center gap-1.5 rounded-md border border-status-error/40 bg-status-error/15 px-3 py-1.5 text-xs font-semibold text-status-error transition-opacity hover:opacity-90"
                >
                  <Square size={12} fill="currentColor" strokeWidth={2.2} />
                  <span>{t(locale, 'dock.runningStop')}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={runChat}
                  disabled={!chatRunText || isReadOnly || activeAiEditing}
                  title={t(locale, 'dock.runChatTitle')}
                  aria-label={t(locale, 'dock.runChatTitle')}
                  className="flex shrink-0 items-center gap-1.5 rounded-md bg-status-success px-3 py-1.5 text-xs font-semibold text-status-success-contrast transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play size={13} fill="currentColor" strokeWidth={2.2} />
                  <span>{t(locale, 'canvas.run')}</span>
                </button>
              ))}
            <button
              type="button"
              onClick={() => {
                if (returnSearchOpen) closeReturnSearch();
                else openReturnSearch();
              }}
              title={t(locale, 'dock.searchAria')}
              aria-label={t(locale, 'dock.searchAria')}
              aria-expanded={returnSearchOpen}
              aria-controls="ai-return-search"
              className={
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors ' +
                (returnSearchOpen
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border bg-panel-2 text-fg-dim hover:border-accent hover:text-fg')
              }
            >
              <Search size={14} />
            </button>
          </div>
          {returnSearchOpen && (
            <div className="absolute left-3 right-3 top-full z-30 mt-2 flex items-center gap-1 rounded-lg border border-border bg-panel/95 p-1.5 shadow-2xl backdrop-blur sm:left-auto sm:w-96">
              <div className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 transition-colors focus-within:border-accent">
                <Search size={13} className="shrink-0 text-fg-faint" />
                <input
                  id="ai-return-search"
                  type="search"
                  ref={searchInputRef}
                  value={returnSearch}
                  onChange={(e) => setReturnSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      moveSearchMatch(e.shiftKey ? -1 : 1);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      closeReturnSearch();
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
                {searchStatus}
              </span>
            </div>
          )}
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
                const isChatUser = isChat && isUser;
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
                      (isChatUser ? 'items-end ' : '') +
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
                          (mode === 'running' || activeAiEditing)
                        }
                        onAnswer={(answer) => answerInteraction(m.id, answer)}
                        onDismiss={() => dismissInteraction(m.id)}
                      />
                    ) : isUser || normalizedSearch ? (
                      // User turns stay plain text; while a return search is
                      // active we fall back to the plain highlighter for every
                      // message so match marks land on real text nodes.
                      <span
                        className={
                          'whitespace-pre-wrap break-words text-sm leading-relaxed ' +
                          (isChatUser
                            ? 'max-w-[min(78%,42rem)] rounded-md border border-accent/20 bg-accent/10 px-3 py-2 text-left text-fg'
                            : 'text-fg-dim')
                        }
                      >
                        {renderHighlightedText(
                          isUser ? m.text : cleanMessageText(m.text),
                          m.id,
                          normalizedSearch,
                          activeSearchMatchId,
                          setActiveSearchMatchNode,
                        )}
                      </span>
                    ) : (
                      // Assistant / system: rich markdown, code, tables, file
                      // chips, links, and collapsible reasoning blocks.
                      <MessageContent
                        text={m.text}
                        streaming={aiBusy && m.id === lastAssistantId}
                        showActions={!isSystem}
                        onOpenFile={onOpenFile}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Vertical divider — drag to re-split AI 返回 / AI 输入.
          Hidden in chat layout (input is stacked below, full width). */}
      {!isChat && (
        <div
          onMouseDown={onSplitStart}
          title={t(locale, 'common.resizeSplit')}
          className="group relative z-20 flex w-1.5 shrink-0 cursor-col-resize items-stretch justify-center border-l border-border-soft"
        >
          <div className="h-full w-0.5 bg-transparent transition-colors group-hover:bg-accent/40" />
        </div>
      )}

      {/* Horizontal divider (chat layout only) — drag to re-split AI 返回 (top) /
          AI 输入 (bottom). */}
      {isChat && (
        <div
          onMouseDown={onChatSplitStart}
          title={t(locale, 'common.resizeHeight')}
          className="group relative z-20 flex h-1.5 shrink-0 cursor-row-resize items-stretch justify-center border-t border-border-soft"
        >
          <div className="h-0.5 w-full bg-transparent transition-colors group-hover:bg-accent/40" />
        </div>
      )}

      {/* AI input box. Dock: right column (resizable width). Chat: full-width
          row pinned below the return stream (resizable height). */}
      <section
        className="relative flex shrink-0 flex-col bg-panel"
        style={isChat ? { height: chatInputHeight } : { width: renderedInputWidth }}
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
              'owf-ai-input min-h-0 flex-1 resize-none rounded-md border bg-bg p-2.5 text-sm leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-accent ' +
              (dropActive
                ? 'owf-ai-input--drop border-accent '
                : isChat
                  ? 'owf-ai-input--chat border-border '
                  : 'border-border ') +
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
              options={runtimeSelectOptions}
              value={runtimeSelectValue}
              onChange={(id) => {
                setGlobalRunSelection(systemDefaultGatewaySelection(id));
              }}
              disabled={isReadOnly}
              className="min-w-0"
              icon="▣"
            />
            {isClaudeCodeRuntime && (
              <Select
                title={t(locale, 'dock.channelTitle')}
                options={channelSelectOptions}
                value={channelSelectValue}
                onChange={onChannelChange}
                disabled={isReadOnly}
                className="min-w-0"
                icon="✦"
              />
            )}
            {activeSessionIsWorkflow && !simpleMode && (
              <Select
                title={t(locale, 'dock.modelStrategyTitle')}
                options={modelStrategyOptions}
                value={composer.modelStrategy}
                onChange={(id) =>
                  setComposer({ modelStrategy: id as ModelStrategy })
                }
                disabled={isReadOnly}
                className="min-w-0"
                icon="🧠"
              />
            )}
            <WorkspaceSelect
              value={composer.workspace}
              history={workspaceHistory}
              onSelect={setWorkspace}
              disabled={activeAiEditing}
              className="min-w-0"
            />
            <span className="min-w-fit font-mono text-[10px] text-fg-faint">
              {isReadOnly
                ? t(locale, 'dock.runningReadonly')
                : t(locale, 'dock.sendShortcut')}
            </span>
            <div className="min-w-0 flex-1" />
            <button
              type="button"
              onClick={() => submit()}
              disabled={!draft.trim() || isReadOnly || activeAiEditing}
              title={
                isReadOnly
                  ? t(locale, 'dock.inputLockedTitle')
                  : activeAiEditing
                    ? t(locale, 'dock.aiGeneratingTitle')
                    : t(locale, 'dock.sendShortcut')
              }
              className="rounded-md bg-accent px-2.5 py-1.5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {activeAiEditing ? '…' : '↑'}
            </button>
          </div>
        </div>
      </section>
      <FilePreviewDrawer
        refData={filePreviewRef}
        cwd={workspaceCwd || undefined}
        onClose={() => setFilePreviewRef(null)}
      />
      {keyModalChannel && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-bg/75 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-border bg-panel p-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-accent/40 bg-accent/10 text-accent">
                ✦
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-fg">
                  {t(locale, 'dock.freeKeyTitle')} · {keyModalChannel.label}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-fg-faint">
                  {t(locale, 'dock.freeKeyDescription')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setKeyModalChannel(null);
                  setKeyModalValue('');
                }}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-border-soft hover:text-fg"
                title={t(locale, 'common.close')}
              >
                <X size={15} strokeWidth={2} />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <input
                type="password"
                value={keyModalValue}
                onChange={(event) => setKeyModalValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') saveKeyModal();
                  if (event.key === 'Escape') {
                    setKeyModalChannel(null);
                    setKeyModalValue('');
                  }
                }}
                autoFocus
                placeholder={t(locale, 'dock.freeKeyPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg outline-none transition-colors focus:border-accent"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                {keyModalChannel.credentialUrl ? (
                  <button
                    type="button"
                    onClick={() =>
                      void openExternal(keyModalChannel.credentialUrl as string)
                    }
                    className="rounded-md border border-border bg-panel-2 px-3 py-1.5 text-xs text-fg-dim transition-colors hover:border-accent hover:text-fg"
                  >
                    {t(locale, 'dock.freeKeyGet')}
                  </button>
                ) : (
                  <span className="text-xs text-fg-faint">
                    {t(locale, 'dock.freeKeyNoUrl')}
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setKeyModalChannel(null);
                      setKeyModalValue('');
                    }}
                    className="rounded-md border border-border bg-panel-2 px-3 py-1.5 text-xs text-fg-dim transition-colors hover:border-accent hover:text-fg"
                  >
                    {t(locale, 'dock.freeKeyCancel')}
                  </button>
                  <button
                    type="button"
                    onClick={saveKeyModal}
                    disabled={!keyModalValue.trim()}
                    className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t(locale, 'dock.freeKeySave')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {localSetupChannel?.id === 'ollama' && (
        <LocalModelSetupDialog
          locale={locale}
          downloadUrl={localSetupChannel.setupUrl}
          statusMessage={localSetupMessage}
          onClose={() => {
            setLocalSetupChannel(null);
            setLocalModelValue('');
            setLocalSetupMessage(null);
          }}
          onModelSelected={(model) => {
            setFreeChannelModel(localSetupChannel.id, model);
            setLocalModelValue(model);
            setLocalSetupMessage(t(locale, 'settings.localModel.setupStarted'));
          }}
        />
      )}
      {localSetupChannel && localSetupChannel.id !== 'ollama' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-bg/75 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-border bg-panel p-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-accent/40 bg-accent/10 text-accent">
                ▣
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-fg">
                  {t(locale, 'dock.localModelTitle')} · {localSetupChannel.label}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-fg-faint">
                  {t(locale, 'dock.localModelDescription')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setLocalSetupChannel(null);
                  setLocalModelValue('');
                  setLocalSetupMessage(null);
                }}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-border-soft hover:text-fg"
                title={t(locale, 'common.close')}
              >
                <X size={15} strokeWidth={2} />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {localSetupMessage && (
                <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
                  {localSetupMessage}
                </p>
              )}
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-fg-dim">
                  {t(locale, 'settings.freeChannels.modelLabel')}
                </span>
                <input
                  type="text"
                  value={localModelValue}
                  onChange={(event) => setLocalModelValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') saveLocalModelModal();
                    if (event.key === 'Escape') {
                      setLocalSetupChannel(null);
                      setLocalModelValue('');
                      setLocalSetupMessage(null);
                    }
                  }}
                  autoFocus
                  placeholder={t(locale, 'dock.localModelPlaceholder')}
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg outline-none transition-colors focus:border-accent"
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-2">
                {localSetupChannel.setupUrl ? (
                  <button
                    type="button"
                    onClick={() =>
                      void openExternal(localSetupChannel.setupUrl as string)
                    }
                    className="rounded-md border border-border bg-panel-2 px-3 py-1.5 text-xs text-fg-dim transition-colors hover:border-accent hover:text-fg"
                  >
                    {t(locale, 'dock.localModelDownload')}
                  </button>
                ) : (
                  <span className="text-xs text-fg-faint">
                    {t(locale, 'dock.localModelNoUrl')}
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setLocalSetupChannel(null);
                      setLocalModelValue('');
                      setLocalSetupMessage(null);
                    }}
                    className="rounded-md border border-border bg-panel-2 px-3 py-1.5 text-xs text-fg-dim transition-colors hover:border-accent hover:text-fg"
                  >
                    {t(locale, 'dock.freeKeyCancel')}
                  </button>
                  <button
                    type="button"
                    onClick={saveLocalModelModal}
                    disabled={!localModelValue.trim() || checkingLocalModel}
                    className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {checkingLocalModel
                      ? t(locale, 'settings.freeChannels.localChecking')
                      : t(locale, 'dock.localModelSave')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
