import type { GatewaySelection } from '@/core/ir';
import type { GatewayProvider } from '@/lib/modelGateway/types';
import { freeProxyEnsure, isTauri } from '@/lib/tauri';

/**
 * CONTRACT: catalog + helpers for the built-in "free channels" feature.
 *
 * When the user picks the `claude-code` runtime, a second "Channel" dropdown
 * lets them route the claude CLI through one of the 17 free upstreams below
 * (translated/reverse-proxied by the built-in local Rust proxy at
 * 127.0.0.1:<port>/ch/<id>). A free-channel selection is encoded as a normal
 * GatewaySelection whose providerId is `freecc:<id>`; `loadGatewayConfig()`
 * merges synthetic CLI providers so the existing resolver/launcher pathway
 * (gatewayRouteEnv -> ANTHROPIC_BASE_URL/...) lights up unchanged.
 *
 * Storage keys (localStorage):
 *   owf_free_channel_keys_v1   -> { [id]: apiKey }
 *   owf_free_channel_models_v1 -> { [id]: modelOverride }
 *   owf_free_proxy_port_v1     -> number (default 8765)
 *
 * Exports the UI phase relies on:
 *   FREE_CHANNELS, FREE_CHANNEL_PROVIDER_PREFIX, freeChannelById,
 *   getFreeChannelKey, setFreeChannelKey, getFreeChannelModel,
 *   setFreeChannelModel, freeChannelReady, getCachedFreeProxyPort,
 *   freeChannelSelection, isFreeChannelSelection, ensureFreeProxy,
 *   freeChannelGatewayProviders.
 */

export type FreeChannelTransport = 'openai' | 'anthropic';

export interface FreeChannel {
  /** Stable id, e.g. 'groq'. */
  id: string;
  /** Display label, e.g. 'Groq'. */
  label: string;
  /** Upstream wire protocol the proxy speaks. */
  transport: FreeChannelTransport;
  /** Upstream base url (proxy appends /v1/messages or /chat/completions). */
  upstreamBaseUrl: string;
  /** Default model id sent upstream. */
  defaultModel: string;
  /** Where to obtain an API key (shown in UI). */
  credentialUrl?: string;
  /** Local runtime (ollama/lmstudio/llamacpp) — no key needed. */
  local: boolean;
  /** Whether an API key is required. */
  needsKey: boolean;
  note?: string;
}

export const FREE_CHANNEL_PROVIDER_PREFIX = 'freecc:';

const DEFAULT_FREE_PROXY_PORT = 8765;

const KEYS_STORAGE = 'owf_free_channel_keys_v1';
const MODELS_STORAGE = 'owf_free_channel_models_v1';
const PORT_STORAGE = 'owf_free_proxy_port_v1';

export const FREE_CHANNELS: FreeChannel[] = [
  {
    id: 'nvidia_nim',
    label: 'NVIDIA NIM',
    transport: 'openai',
    upstreamBaseUrl: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'nvidia/nemotron-3-super-120b-a12b',
    credentialUrl: 'https://build.nvidia.com/settings/api-keys',
    local: false,
    needsKey: true,
  },
  {
    id: 'open_router',
    label: 'OpenRouter',
    transport: 'anthropic',
    upstreamBaseUrl: 'https://openrouter.ai/api',
    defaultModel: 'z-ai/glm-4.6',
    credentialUrl: 'https://openrouter.ai/keys',
    local: false,
    needsKey: true,
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    transport: 'openai',
    upstreamBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    credentialUrl: 'https://aistudio.google.com/apikey',
    local: false,
    needsKey: true,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    transport: 'anthropic',
    upstreamBaseUrl: 'https://api.deepseek.com/anthropic',
    defaultModel: 'deepseek-chat',
    credentialUrl: 'https://platform.deepseek.com/api_keys',
    local: false,
    needsKey: true,
  },
  {
    id: 'mistral',
    label: 'Mistral',
    transport: 'openai',
    upstreamBaseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    credentialUrl: 'https://console.mistral.ai/',
    local: false,
    needsKey: true,
  },
  {
    id: 'mistral_codestral',
    label: 'Mistral Codestral',
    transport: 'openai',
    upstreamBaseUrl: 'https://codestral.mistral.ai/v1',
    defaultModel: 'codestral-latest',
    credentialUrl: 'https://console.mistral.ai/',
    local: false,
    needsKey: true,
  },
  {
    id: 'opencode',
    label: 'OpenCode Zen',
    transport: 'openai',
    upstreamBaseUrl: 'https://opencode.ai/zen/v1',
    defaultModel: 'glm-5.1',
    credentialUrl: 'https://opencode.ai/auth',
    local: false,
    needsKey: true,
  },
  {
    id: 'opencode_go',
    label: 'OpenCode Go',
    transport: 'openai',
    upstreamBaseUrl: 'https://opencode.ai/zen/go/v1',
    defaultModel: 'glm-5.1',
    credentialUrl: 'https://opencode.ai/auth',
    local: false,
    needsKey: true,
  },
  {
    id: 'wafer',
    label: 'Wafer',
    transport: 'anthropic',
    upstreamBaseUrl: 'https://pass.wafer.ai',
    defaultModel: 'GLM-5.1',
    credentialUrl: 'https://www.wafer.ai/pass',
    local: false,
    needsKey: true,
  },
  {
    id: 'kimi',
    label: 'Kimi (Moonshot)',
    transport: 'anthropic',
    upstreamBaseUrl: 'https://api.moonshot.ai/anthropic',
    defaultModel: 'kimi-k2.5',
    credentialUrl: 'https://platform.moonshot.cn/console/api-keys',
    local: false,
    needsKey: true,
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    transport: 'openai',
    upstreamBaseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'llama-3.3-70b',
    credentialUrl: 'https://cloud.cerebras.ai',
    local: false,
    needsKey: true,
  },
  {
    id: 'groq',
    label: 'Groq',
    transport: 'openai',
    upstreamBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    credentialUrl: 'https://console.groq.com/keys',
    local: false,
    needsKey: true,
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    transport: 'anthropic',
    upstreamBaseUrl: 'https://api.fireworks.ai/inference',
    defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    credentialUrl: 'https://fireworks.ai/account/api-keys',
    local: false,
    needsKey: true,
  },
  {
    id: 'zai',
    label: 'Z.ai GLM',
    transport: 'anthropic',
    upstreamBaseUrl: 'https://api.z.ai/api/anthropic',
    defaultModel: 'glm-5.1',
    credentialUrl: 'https://z.ai/manage-apikey/apikey-list',
    local: false,
    needsKey: true,
  },
  {
    // LM Studio's local server is OpenAI-compatible only (it serves
    // /v1/chat/completions, not Anthropic /v1/messages), so route via the
    // 'openai' translator. Leave the model empty: the user must pick whichever
    // model they have loaded (settings → free channels → model override).
    id: 'lmstudio',
    label: 'LM Studio (local)',
    transport: 'openai',
    upstreamBaseUrl: 'http://localhost:1234/v1',
    defaultModel: '',
    local: true,
    needsKey: false,
    note: 'Set a model override to the id you loaded in LM Studio.',
  },
  {
    // llama.cpp's server exposes an OpenAI-compatible endpoint at /v1; it does
    // not natively speak the Anthropic Messages protocol.
    id: 'llamacpp',
    label: 'llama.cpp (local)',
    transport: 'openai',
    upstreamBaseUrl: 'http://localhost:8080/v1',
    defaultModel: '',
    local: true,
    needsKey: false,
    note: 'Set a model override to the model your llama.cpp server is hosting.',
  },
  {
    // Ollama's native API is /api/chat; its OpenAI-compatible shim lives at
    // /v1/chat/completions. It has no Anthropic /v1/messages endpoint.
    id: 'ollama',
    label: 'Ollama (local)',
    transport: 'openai',
    upstreamBaseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
    local: true,
    needsKey: false,
    note: 'Override the model to match a tag you have pulled (e.g. llama3.3).',
  },
];

const FREE_CHANNEL_BY_ID = new Map(FREE_CHANNELS.map((c) => [c.id, c]));

export function freeChannelById(id: string): FreeChannel | undefined {
  return FREE_CHANNEL_BY_ID.get(id);
}

const hasWindow = (): boolean => typeof window !== 'undefined';

function readRecord(key: string): Record<string, string> {
  try {
    if (!hasWindow()) return {};
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeRecord(key: string, value: Record<string, string>): void {
  try {
    if (!hasWindow()) return;
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event('owf:gateway-config-changed'));
  } catch {
    /* ignore */
  }
}

export function getFreeChannelKey(id: string): string {
  return readRecord(KEYS_STORAGE)[id] ?? '';
}

export function setFreeChannelKey(id: string, key: string): void {
  const next = readRecord(KEYS_STORAGE);
  const trimmed = key.trim();
  if (trimmed) next[id] = trimmed;
  else delete next[id];
  writeRecord(KEYS_STORAGE, next);
}

export function getFreeChannelModel(id: string): string {
  const override = (readRecord(MODELS_STORAGE)[id] ?? '').trim();
  if (override) return override;
  return freeChannelById(id)?.defaultModel ?? '';
}

/**
 * The user's raw model override for a channel (empty when none is set). Unlike
 * getFreeChannelModel this does NOT fall back to the channel default, so a
 * settings input can show an empty field with the default as placeholder.
 */
export function getFreeChannelModelOverride(id: string): string {
  return (readRecord(MODELS_STORAGE)[id] ?? '').trim();
}

export function setFreeChannelModel(id: string, model: string): void {
  const next = readRecord(MODELS_STORAGE);
  const trimmed = model.trim();
  if (trimmed) next[id] = trimmed;
  else delete next[id];
  writeRecord(MODELS_STORAGE, next);
}

export function freeChannelReady(id: string): boolean {
  const channel = freeChannelById(id);
  if (!channel) return false;
  if (channel.local || !channel.needsKey) return true;
  return getFreeChannelKey(id).length > 0;
}

export function getCachedFreeProxyPort(): number {
  try {
    if (!hasWindow()) return DEFAULT_FREE_PROXY_PORT;
    const raw = window.localStorage.getItem(PORT_STORAGE);
    if (!raw) return DEFAULT_FREE_PROXY_PORT;
    const port = Number.parseInt(raw, 10);
    return Number.isFinite(port) && port > 0 ? port : DEFAULT_FREE_PROXY_PORT;
  } catch {
    return DEFAULT_FREE_PROXY_PORT;
  }
}

function setCachedFreeProxyPort(port: number): void {
  try {
    if (!hasWindow()) return;
    const prev = window.localStorage.getItem(PORT_STORAGE);
    const next = String(port);
    window.localStorage.setItem(PORT_STORAGE, next);
    // The cached port is baked into every freecc:* provider baseUrl
    // (http://127.0.0.1:<port>/ch/<id>). If the proxy rebinds to a different
    // port, subscribers (NodeInspector run options / gateway hints) must
    // re-read; mirror writeRecord's dispatch so they refresh. Only fire when
    // the value actually changed to avoid redundant refreshes.
    if (prev !== next) {
      window.dispatchEvent(new Event('owf:gateway-config-changed'));
    }
  } catch {
    /* ignore */
  }
}

export function freeChannelSelection(
  id: string,
  modelClass?: string,
): GatewaySelection {
  return {
    adapter: 'claude-code',
    modelClass: modelClass || 'sonnet',
    providerId: FREE_CHANNEL_PROVIDER_PREFIX + id,
    channelId: 'default',
  };
}

/**
 * Returns the free channel id when the selection points at one (providerId
 * `freecc:<id>`), otherwise null.
 */
export function isFreeChannelSelection(
  sel: GatewaySelection | undefined | null,
): string | null {
  const providerId = sel?.providerId;
  if (typeof providerId !== 'string') return null;
  if (!providerId.startsWith(FREE_CHANNEL_PROVIDER_PREFIX)) return null;
  const id = providerId.slice(FREE_CHANNEL_PROVIDER_PREFIX.length);
  return FREE_CHANNEL_BY_ID.has(id) ? id : null;
}

/**
 * Build synthetic CLI gateway providers (one per free channel), pointed at the
 * local proxy. Merged into loadGatewayConfig() so resolveGatewayRoute() resolves
 * a free channel to a claude-code CLI route whose env exports
 * ANTHROPIC_BASE_URL=http://127.0.0.1:<port>/ch/<id>.
 */
export function freeChannelGatewayProviders(): GatewayProvider[] {
  const port = getCachedFreeProxyPort();
  return FREE_CHANNELS.map((c) => {
    const baseUrl = `http://127.0.0.1:${port}/ch/${c.id}`;
    const model = getFreeChannelModel(c.id);
    return {
      id: FREE_CHANNEL_PROVIDER_PREFIX + c.id,
      kind: 'anthropic',
      name: 'Free · ' + c.label,
      adapter: 'claude-code',
      channels: [
        {
          id: 'default',
          name: c.label,
          apiKey: 'freecc',
          baseUrl,
          model,
          models: undefined,
          route: {
            transport: 'cli',
            baseUrl,
            model,
            models: undefined,
          },
        },
      ],
    } satisfies GatewayProvider;
  });
}

/**
 * Ensure the local proxy is running with the latest channel config (idempotent).
 * Gathers every ready channel, calls the Rust IPC, and caches the chosen port.
 * No-op (returns the cached port) outside the desktop shell.
 */
export async function ensureFreeProxy(): Promise<number> {
  if (!isTauri()) return getCachedFreeProxyPort();
  const channels = FREE_CHANNELS.filter((c) => freeChannelReady(c.id)).map(
    (c) => ({
      id: c.id,
      transport: c.transport,
      baseUrl: c.upstreamBaseUrl,
      apiKey: c.local ? '' : getFreeChannelKey(c.id),
      model: getFreeChannelModel(c.id),
    }),
  );
  try {
    const info = await freeProxyEnsure(channels);
    if (info && Number.isFinite(info.port) && info.port > 0) {
      setCachedFreeProxyPort(info.port);
      return info.port;
    }
  } catch (err) {
    // Don't fail silently: the caller will route the claude CLI at the cached
    // port and, if the proxy never actually came up, the launch surfaces an
    // opaque ECONNREFUSED. Surfacing the underlying error here at least leaves
    // a breadcrumb in the console for diagnosis.
    console.warn('[freeChannels] ensureFreeProxy failed; using cached port', err);
  }
  return getCachedFreeProxyPort();
}
