import type { GatewayTextRequest } from '../types';
import {
  mergeUsageReports,
  usageReportFromOpenAI,
  type ModelUsageReport,
} from '@/lib/usageMeter';

export async function completeOpenAICompatible(
  request: GatewayTextRequest,
): Promise<string> {
  const apiKey = request.route.apiKey?.trim();
  if (!apiKey) throw new Error('NO_API_KEY');
  const model = request.route.model?.trim();
  if (!model) throw new Error('NO_MODEL');

  const endpoint = resolveChatCompletionsEndpoint(request.route.baseUrl);
  let res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(openAICompatibleBody(request, model, true)),
    signal: request.signal,
  });

  if (!res.ok || !res.body) {
    const detail = await safeText(res);
    if (shouldRetryWithoutStreamUsage(res.status, detail)) {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(openAICompatibleBody(request, model, false)),
        signal: request.signal,
      });
      if (res.ok && res.body) {
        return readOpenAICompatibleStream(res, request);
      }
      const retryDetail = await safeText(res);
      throw new Error(`HTTP ${res.status}: ${retryDetail}`);
    }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }

  return readOpenAICompatibleStream(res, request);
}

function openAICompatibleBody(
  request: GatewayTextRequest,
  model: string,
  includeUsage: boolean,
) {
  return {
    model,
    stream: true,
    ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
    max_tokens: request.maxTokens ?? 4096,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.userContent },
    ],
  };
}

async function readOpenAICompatibleStream(
  res: Response,
  request: GatewayTextRequest,
): Promise<string> {
  if (!res.body) throw new Error('EMPTY_STREAM_BODY');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let usage: ModelUsageReport | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const evt = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
          usage?: unknown;
        };
        usage = mergeUsageReports(usage, usageReportFromOpenAI(evt.usage));
        const chunk = evt.choices?.[0]?.delta?.content;
        if (chunk) {
          full += chunk;
          request.onDelta?.(chunk);
        }
      } catch {
        /* ignore malformed keep-alive lines */
      }
    }
  }
  if (usage) request.onUsage?.(usage);

  return full;
}

function shouldRetryWithoutStreamUsage(status: number, detail: string): boolean {
  if (status !== 400 && status !== 422) return false;
  return /stream_options|include_usage|unknown parameter|unrecognized request argument|extra fields/i.test(
    detail,
  );
}

function resolveChatCompletionsEndpoint(baseUrl?: string): string {
  const raw = baseUrl?.trim().replace(/\/+$/, '');
  if (!raw) return 'https://api.openai.com/v1/chat/completions';
  if (raw.endsWith('/chat/completions')) return raw;
  if (raw.endsWith('/v1')) return `${raw}/chat/completions`;
  return `${raw}/v1/chat/completions`;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '<no body>';
  }
}
