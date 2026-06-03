import { afterEach, describe, expect, it } from 'vitest';
import {
  FREE_CHANNELS,
  FREE_CHANNEL_PROVIDER_PREFIX,
  freeChannelGatewayProviders,
  freeChannelReady,
  freeChannelSelection,
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
  it('treats local channels as ready without a key', () => {
    const local = FREE_CHANNELS.find((c) => c.local);
    expect(local).toBeDefined();
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
