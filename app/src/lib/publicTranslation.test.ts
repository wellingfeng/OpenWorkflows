import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __publicTranslationForTests,
  translatePublicText,
} from './publicTranslation';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('translatePublicText', () => {
  it('calls the public Google translation endpoint', async () => {
    const fetchMock = vi.fn(async (_input: string) =>
      new Response(JSON.stringify([[['Hello', '你好']]]), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(translatePublicText('你好', 'en-US')).resolves.toBe('Hello');

    const input = fetchMock.mock.calls[0]?.[0];
    if (!input) throw new Error('Missing fetch call');
    const url = new URL(input);
    expect(url.origin + url.pathname).toBe(
      'https://translate.googleapis.com/translate_a/single',
    );
    expect(url.searchParams.get('sl')).toBe('auto');
    expect(url.searchParams.get('tl')).toBe('en');
    expect(url.searchParams.get('q')).toBe('你好');
  });

  it('protects code, urls, and Windows paths before translation', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const q = new URL(input).searchParams.get('q') ?? '';
      expect(q).not.toContain('npm run build');
      expect(q).not.toContain('https://example.com/a');
      expect(q).not.toContain('E:\\OpenWorkflows\\file.ts');
      return new Response(JSON.stringify([[[`Translated ${q}`, q]]]), {
        status: 200,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const translated = await translatePublicText(
      [
        '运行 `npm run build`。',
        '见 https://example.com/a。',
        '路径 E:\\OpenWorkflows\\file.ts。',
      ].join('\n'),
      'en-US',
    );

    expect(translated).toContain('`npm run build`');
    expect(translated).toContain('https://example.com/a');
    expect(translated).toContain('E:\\OpenWorkflows\\file.ts');
  });

  it('falls back to MyMemory when Google translation fails and source is known', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            responseStatus: 200,
            responseData: { translatedText: 'Hello' },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(translatePublicText('你好', 'en-US', 'zh-CN')).resolves.toBe(
      'Hello',
    );

    const fallbackUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(fallbackUrl.origin + fallbackUrl.pathname).toBe(
      'https://api.mymemory.translated.net/get',
    );
    expect(fallbackUrl.searchParams.get('langpair')).toBe('zh-CN|en-US');
  });

  it('parses split Google translation segments', () => {
    expect(
      __publicTranslationForTests.parseGoogleTranslateResponse([
        [
          ['Hello', '你好'],
          [' world', '世界'],
        ],
      ]),
    ).toBe('Hello world');
  });

  it('parses MyMemory translation responses', () => {
    expect(
      __publicTranslationForTests.parseMyMemoryTranslateResponse({
        responseStatus: 200,
        responseData: { translatedText: 'Hello' },
      }),
    ).toBe('Hello');
  });
});
