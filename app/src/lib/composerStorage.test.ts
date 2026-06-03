import { afterEach, describe, expect, it } from 'vitest';
import { defaultComposer } from '@/store/sampleSessions';
import { loadComposer, saveComposer } from '@/lib/composerStorage';

const COMPOSER_KEY = 'openworkflow.composer.v1';

afterEach(() => {
  window.localStorage.clear();
});

describe('composer workspace history persistence', () => {
  it('deduplicates persisted workspace paths by normalized path', () => {
    window.localStorage.setItem(
      COMPOSER_KEY,
      JSON.stringify({
        composer: defaultComposer,
        workspaceHistory: [
          'E:\\Game',
          'e:/Game/',
          'E:\\OpenWorkflows',
          'E:\\Game\\',
        ],
      }),
    );

    expect(loadComposer()?.workspaceHistory).toEqual([
      'E:\\Game',
      'E:\\OpenWorkflows',
    ]);
  });

  it('saves workspace history without normalized duplicates', () => {
    saveComposer({
      composer: defaultComposer,
      composerBySession: {},
      workspaceHistory: ['E:\\Game', 'e:/Game/', 'E:\\OpenWorkflows'],
    });

    const raw = window.localStorage.getItem(COMPOSER_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).workspaceHistory).toEqual([
      'E:\\Game',
      'E:\\OpenWorkflows',
    ]);
  });
});
