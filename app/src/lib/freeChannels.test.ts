import { afterEach, describe, expect, it } from 'vitest';
import {
  FREE_CHANNELS,
  FREE_CHANNEL_PROVIDER_PREFIX,
  applyFreeChannelEnvKeys,
  freeChannelGatewayProviders,
  freeChannelReady,
  freeChannelSelection,
  getFreeChannelFallbackModels,
  getFreeChannelKey,
  getFreeChannelModel,
  getFreeChannelModelOverride,
  isFreeChannelSelection,
  setFreeChannelKey,
  setFreeChannelModel,
} from '@/lib/freeChannels';

afterEach(() => {
  window.localStorage.clear();
});

describe('free channel selection encoding', () => {
  it('round-trips a selection through isFreeChannelSelection', () => {
    const sel = freeChannelSelection('groq', 'opus');
    expect(sel.adapter).toBe('claude-code');
    expect(sel.modelClass).toBe('opus');
    expect(sel.providerId).toBe(`${FREE_CHANNEL_PROVIDER_PREFIX}groq`);
    expect(isFreeChannelSelection(sel)).toBe('groq');
  });

  it('returns null for non-free and unknown selections', () => {
    expect(isFreeChannelSelection({ adapter: 'claude-code', modelClass: 'sonnet' })).toBeNull();
    expect(
      isFreeChannelSelection({
        adapter: 'claude-code',
        modelClass: 'sonnet',
        providerId: `${FREE_CHANNEL_PROVIDER_PREFIX}does_not_exist`,
      }),
    ).toBeNull();
    expect(isFreeChannelSelection(undefined)).toBeNull();
  });
});

describe('freeChannelReady', () => {
  it('requires an explicit model for local channels', () => {
    const local = FREE_CHANNELS.find((c) => c.local);
    expect(local).toBeDefined();
    expect(freeChannelReady(local!.id)).toBe(false);
    setFreeChannelModel(local!.id, 'local-model');
    expect(freeChannelReady(local!.id)).toBe(true);
  });

  it('requires a key for non-local channels', () => {
    const remote = FREE_CHANNELS.find((c) => !c.local && c.needsKey)!;
    expect(freeChannelReady(remote.id)).toBe(false);
    setFreeChannelKey(remote.id, 'sk-test-123');
    expect(freeChannelReady(remote.id)).toBe(true);
    setFreeChannelKey(remote.id, '');
    expect(freeChannelReady(remote.id)).toBe(false);
  });
});

describe('applyFreeChannelEnvKeys', () => {
  it('imports known remote-channel keys without overwriting saved values', () => {
    setFreeChannelKey('groq', 'saved-groq');
    const imported = applyFreeChannelEnvKeys({
      groq: 'env-groq',
      open_router: 'env-openrouter',
      ollama: 'ignored-local',
      unknown: 'ignored',
    });

    expect(imported).toEqual(['open_router']);
    expect(getFreeChannelKey('groq')).toBe('saved-groq');
    expect(getFreeChannelKey('open_router')).toBe('env-openrouter');
    expect(getFreeChannelKey('ollama')).toBe('');
  });
});

describe('model override', () => {
  it('exposes the raw override separately from the resolved default', () => {
    const channel = FREE_CHANNELS.find((c) => c.defaultModel)!;
    expect(getFreeChannelModelOverride(channel.id)).toBe('');
    // With no override, getFreeChannelModel falls back to the default.
    expect(getFreeChannelModel(channel.id)).toBe(channel.defaultModel);
    setFreeChannelModel(channel.id, 'custom-model-x');
    expect(getFreeChannelModelOverride(channel.id)).toBe('custom-model-x');
    expect(getFreeChannelModel(channel.id)).toBe('custom-model-x');
  });

  it('normalizes bare OpenRouter GLM model overrides to provider-qualified lowercase ids', () => {
    setFreeChannelModel('open_router', 'GLM-4.6');
    expect(getFreeChannelModelOverride('open_router')).toBe('GLM-4.6');
    expect(getFreeChannelModel('open_router')).toBe('z-ai/glm-4.6');
  });

  it('normalizes known provider-specific bare model aliases', () => {
    setFreeChannelModel('nvidia_nim', 'nemotron-3-super-120b-a12b');
    expect(getFreeChannelModel('nvidia_nim')).toBe(
      'nvidia/nemotron-3-super-120b-a12b',
    );

    setFreeChannelModel('fireworks', 'llama-v3p3-70b-instruct');
    expect(getFreeChannelModel('fireworks')).toBe(
      'accounts/fireworks/models/llama-v3p3-70b-instruct',
    );
  });

  it('returns de-duplicated fallback models after the active model', () => {
    expect(getFreeChannelFallbackModels('open_router')).toEqual([
      'z-ai/glm-5.1',
      'z-ai/glm-4.7',
      'z-ai/glm-4.5-air:free',
    ]);
    setFreeChannelModel('open_router', 'glm-5.1');
    expect(getFreeChannelModel('open_router')).toBe('z-ai/glm-5.1');
    expect(getFreeChannelFallbackModels('open_router')).toContain('z-ai/glm-4.6');
    expect(getFreeChannelFallbackModels('open_router')).not.toContain(
      'z-ai/glm-5.1',
    );
  });
});

describe('channel catalog', () => {
  it('routes OpenRouter through the OpenAI-compatible endpoint', () => {
    const channel = FREE_CHANNELS.find((c) => c.id === 'open_router');
    expect(channel).toMatchObject({
      transport: 'openai',
      upstreamBaseUrl: 'https://openrouter.ai/api/v1',
      defaultModel: 'z-ai/glm-4.6',
    });
  });
});

describe('freeChannelGatewayProviders', () => {
  it('builds a CLI claude-code provider per channel pointed at the local proxy', () => {
    const providers = freeChannelGatewayProviders();
    expect(providers).toHaveLength(FREE_CHANNELS.length);
    for (const provider of providers) {
      expect(provider.id.startsWith(FREE_CHANNEL_PROVIDER_PREFIX)).toBe(true);
      expect(provider.adapter).toBe('claude-code');
      const channel = provider.channels[0];
      expect(channel.route.transport).toBe('cli');
      const id = provider.id.slice(FREE_CHANNEL_PROVIDER_PREFIX.length);
      expect(channel.route.baseUrl).toContain(`/ch/${id}`);
      expect(channel.route.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/ch\//);
    }
  });
});
