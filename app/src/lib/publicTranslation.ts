import type { Locale } from '@/lib/i18n';

const GOOGLE_TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single';
const MYMEMORY_TRANSLATE_URL = 'https://api.mymemory.translated.net/get';
const TRANSLATE_TIMEOUT_MS = 15_000;
const MAX_QUERY_CHARS = 4_500;
const TOKEN_PREFIX = 'FUCXLT';

const GOOGLE_LANG_BY_LOCALE: Record<Locale, string> = {
  'zh-CN': 'zh-CN',
  'en-US': 'en',
  'fr-FR': 'fr',
  'ru-RU': 'ru',
  'es-ES': 'es',
  'hi-IN': 'hi',
  'ar-SA': 'ar',
  'pt-BR': 'pt',
  'ja-JP': 'ja',
  'de-DE': 'de',
  'ko-KR': 'ko',
};

const MYMEMORY_LANG_BY_LOCALE: Record<Locale, string> = {
  'zh-CN': 'zh-CN',
  'en-US': 'en-US',
  'fr-FR': 'fr-FR',
  'ru-RU': 'ru-RU',
  'es-ES': 'es-ES',
  'hi-IN': 'hi-IN',
  'ar-SA': 'ar-SA',
  'pt-BR': 'pt-BR',
  'ja-JP': 'ja-JP',
  'de-DE': 'de-DE',
  'ko-KR': 'ko-KR',
};

const PROTECTED_MARKDOWN =
  /```[\s\S]*?```|`[^`\n]*`|https?:\/\/[^\s)]+|(?:[A-Za-z]:\\|\\\\)[^\s"'`<>|?*\r\n]*/g;

interface ProtectedText {
  text: string;
  values: string[];
}

export async function translatePublicText(
  text: string,
  target: Locale,
  sourceLocale?: Locale,
): Promise<string> {
  const source = text.trim();
  if (!source) return '';

  const protectedText = protectUntranslatedMarkdown(source);
  const chunks = splitForTranslate(protectedText.text, MAX_QUERY_CHARS);
  const translatedChunks = await Promise.all(
    chunks.map((chunk) => translatePublicChunk(chunk, target, sourceLocale)),
  );

  return restoreProtectedMarkdown(
    translatedChunks.join(''),
    protectedText.values,
  ).trim();
}

async function translatePublicChunk(
  text: string,
  target: Locale,
  source?: Locale,
): Promise<string> {
  try {
    return await translateGoogleChunk(text, target);
  } catch (primaryErr) {
    if (!source || source === target) throw primaryErr;
    try {
      return await translateMyMemoryChunk(text, source, target);
    } catch {
      throw primaryErr;
    }
  }
}

function protectUntranslatedMarkdown(text: string): ProtectedText {
  const values: string[] = [];
  const masked = text.replace(PROTECTED_MARKDOWN, (value) => {
    const index = values.push(value) - 1;
    return `${TOKEN_PREFIX}${index}X`;
  });
  return { text: masked, values };
}

function restoreProtectedMarkdown(text: string, values: string[]): string {
  return text.replace(
    new RegExp(`${TOKEN_PREFIX}(\\d+)X`, 'g'),
    (match, index: string) => values[Number(index)] ?? match,
  );
}

function splitForTranslate(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  const parts = text.split(/(\n{2,})/);
  let current = '';

  for (const part of parts) {
    if (!part) continue;
    if (current && current.length + part.length > maxChars) {
      chunks.push(current);
      current = '';
    }

    if (part.length <= maxChars) {
      current += part;
      continue;
    }

    for (let start = 0; start < part.length; start += maxChars) {
      const slice = part.slice(start, start + maxChars);
      if (current) {
        chunks.push(current);
        current = '';
      }
      chunks.push(slice);
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

async function translateGoogleChunk(
  text: string,
  target: Locale,
): Promise<string> {
  const url = new URL(GOOGLE_TRANSLATE_URL);
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', 'auto');
  url.searchParams.set('tl', GOOGLE_LANG_BY_LOCALE[target]);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', text);

  return parseGoogleTranslateResponse(await fetchJsonWithTimeout(url));
}

async function translateMyMemoryChunk(
  text: string,
  source: Locale,
  target: Locale,
): Promise<string> {
  const url = new URL(MYMEMORY_TRANSLATE_URL);
  url.searchParams.set('q', text);
  url.searchParams.set(
    'langpair',
    `${MYMEMORY_LANG_BY_LOCALE[source]}|${MYMEMORY_LANG_BY_LOCALE[target]}`,
  );

  return parseMyMemoryTranslateResponse(await fetchJsonWithTimeout(url));
}

async function fetchJsonWithTimeout(url: URL): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

function parseGoogleTranslateResponse(body: unknown): string {
  if (!Array.isArray(body) || !Array.isArray(body[0])) {
    throw new Error('公共翻译返回格式异常');
  }

  const translated = body[0]
    .map((segment) => {
      if (!Array.isArray(segment)) return '';
      return typeof segment[0] === 'string' ? segment[0] : '';
    })
    .join('');

  if (!translated.trim()) {
    throw new Error('公共翻译返回空结果');
  }
  return translated;
}

function parseMyMemoryTranslateResponse(body: unknown): string {
  if (!body || typeof body !== 'object') {
    throw new Error('公共翻译返回格式异常');
  }
  const record = body as {
    responseStatus?: number | string;
    responseDetails?: string;
    responseData?: { translatedText?: unknown };
  };
  if (Number(record.responseStatus) !== 200) {
    throw new Error(record.responseDetails || '公共翻译请求失败');
  }
  const translated = record.responseData?.translatedText;
  if (typeof translated !== 'string' || !translated.trim()) {
    throw new Error('公共翻译返回空结果');
  }
  return translated;
}

export const __publicTranslationForTests = {
  protectUntranslatedMarkdown,
  restoreProtectedMarkdown,
  splitForTranslate,
  parseGoogleTranslateResponse,
  parseMyMemoryTranslateResponse,
};
