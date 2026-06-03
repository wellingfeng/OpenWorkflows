/**
 * CONTRACT: segmentMessage(text) -> Segment[]
 *
 * Splits one assistant message's plain text into ordered segments so the
 * renderer can show collapsible reasoning blocks and structured tool cards
 * separately from the answer prose.
 *
 * Many models (DeepSeek-R1 raw, local/CLI models, some proxies) inline their
 * chain-of-thought as `<think>…</think>` / `<thinking>…</thinking>` right in the
 * text stream. We pull those spans out into `reasoning` segments and leave the
 * rest as `answer` segments, preserving stream order so think → answer → think →
 * answer interleaving renders correctly.
 *
 * This is a pure, whole-string segmenter (re-run on the full message text each
 * render) rather than an incremental push-parser: the AI dock already keeps the
 * full accumulated `message.text`, and re-segmenting a few KB per keystroke is
 * cheap. To stay flicker-free while streaming, an *unclosed* trailing `<think>`
 * is treated as reasoning that is still in progress (`done: false`), and a
 * trailing partial tag (e.g. `…</thin`) is held back rather than leaked into the
 * answer text.
 */

export type Segment =
  | { type: 'reasoning'; text: string; done: boolean }
  | { type: 'answer'; text: string }
  | { type: 'tools'; events: ToolEvent[] };

import {
  extractToolSentinels,
  mergeToolPatches,
  hasToolSentinel,
  type ToolEvent,
  type ToolEventPatch,
} from './toolEvent';
import { parseToolLine } from './toolLine';

const OPEN = /<think(?:ing)?>/i;
const CLOSE = /<\/think(?:ing)?>/i;

const PARTIAL_TAG_CANDIDATES = [
  '<think>',
  '<thinking>',
  '</think>',
  '</thinking>',
];

/**
 * If the tail of `s` could be the prefix of a think tag (split across a chunk
 * boundary), return the index where the partial tag starts; else -1.
 */
function partialTagStart(s: string): number {
  const lt = s.lastIndexOf('<');
  if (lt === -1) return -1;
  const tail = s.slice(lt).toLowerCase();
  // A complete tag is handled elsewhere; only hold back a strict prefix.
  if (PARTIAL_TAG_CANDIDATES.some((t) => t !== tail && t.startsWith(tail))) {
    return lt;
  }
  return -1;
}

/** Does the text contain any think tag at all? Fast path for plain answers. */
export function hasReasoning(text: string): boolean {
  return OPEN.test(text);
}

/**
 * Segment a full message into ordered reasoning/answer chunks. `streaming`
 * controls whether a dangling open `<think>` (no close yet) is reported as
 * in-progress reasoning (true) or simply closed off (false, final render).
 */
export function segmentMessage(text: string, streaming = false): Segment[] {
  if (!hasReasoning(text)) {
    return expandTools(text ? [{ type: 'answer', text }] : []);
  }

  const segments: Segment[] = [];
  let rest = text;
  let mode: 'answer' | 'reasoning' = 'answer';

  const pushAnswer = (chunk: string) => {
    if (!chunk) return;
    const last = segments[segments.length - 1];
    if (last && last.type === 'answer') last.text += chunk;
    else segments.push({ type: 'answer', text: chunk });
  };
  const pushReasoning = (chunk: string, done: boolean) => {
    const last = segments[segments.length - 1];
    if (last && last.type === 'reasoning') {
      last.text += chunk;
      last.done = done;
    } else {
      segments.push({ type: 'reasoning', text: chunk, done });
    }
  };

  for (;;) {
    const re = mode === 'answer' ? OPEN : CLOSE;
    const m = re.exec(rest);

    if (!m) {
      // No more complete tags. Emit remainder, holding back a partial tag tail
      // only while streaming (a final render has no more chunks coming).
      let chunk = rest;
      if (streaming) {
        const p = partialTagStart(rest);
        if (p !== -1) chunk = rest.slice(0, p);
      }
      if (mode === 'answer') pushAnswer(chunk);
      else pushReasoning(chunk, !streaming); // unclosed think: done iff not streaming
      break;
    }

    const before = rest.slice(0, m.index);
    if (mode === 'answer') {
      pushAnswer(before);
      mode = 'reasoning';
      // Seed an empty reasoning segment so an immediately-closing tag still
      // produces a (possibly empty) block in order.
      pushReasoning('', false);
    } else {
      pushReasoning(before, true);
      mode = 'answer';
    }
    rest = rest.slice(m.index + m[0].length);
    // Tolerate a stray, unmatched close tag from sloppy/nested output so we
    // never leak a literal `</think>` into the rendered answer.
    if (mode === 'answer') rest = rest.replace(/^<\/think(?:ing)?>/i, '');
  }

  // Drop empty answer segments (produced by adjacent tags), and drop reasoning
  // blocks that ended up empty once finalized — but keep an empty reasoning
  // block while it is still streaming so the "思考中…" header can show.
  const cleaned = segments.filter((s) => {
    if (s.type === 'reasoning') return s.text.length > 0 || !s.done;
    if (s.type === 'answer') return s.text.length > 0;
    return true;
  });
  return expandTools(cleaned);
}

/**
 * Second pass: split each answer segment on inline tool sentinels
 * (`<<OWF_TOOL>>…`), turning them into ordered answer/tools segments. Adjacent
 * tool events across the whole message are merged by id so a `running` event
 * and its later `done` patch collapse into one card. The merge is global (not
 * per answer-segment) so a tool that starts before a reasoning block and
 * finishes after it still resolves to a single event.
 */
function expandTools(segments: Segment[]): Segment[] {
  const anySentinels = segments.some(
    (s) => s.type === 'answer' && hasToolSentinel(s.text),
  );
  const anyLegacyToolLines = segments.some(
    (s) => s.type === 'answer' && hasLegacyToolMarker(s.text),
  );
  if (!anySentinels && !anyLegacyToolLines) return segments;

  // Decode every patch first (in stream order) so we can merge globally by id.
  const allPatches: ToolEventPatch[] = [];
  for (const s of segments) {
    if (s.type === 'answer' && hasToolSentinel(s.text)) {
      allPatches.push(...extractToolSentinels(s.text).patches);
    }
  }
  const merged = mergeToolPatches(allPatches);
  const byId = new Map(merged.map((e) => [e.id, e]));

  const out: Segment[] = [];
  const emitted = new Set<string>();
  let legacyId = 0;
  const pushAnswerText = (text: string) => {
    const trimmed = text.replace(/^\n+|\n+$/g, '');
    if (trimmed.length === 0) return;
    out.push({ type: 'answer', text: trimmed });
  };
  const pushToolEvent = (event: ToolEvent) => {
    const last = out[out.length - 1];
    if (last && last.type === 'tools') last.events.push(event);
    else out.push({ type: 'tools', events: [event] });
  };
  const pushTool = (id: string) => {
    // Global dedup: a tool's `running` and later `done` patch resolve to one
    // card, placed at the FIRST (running) position — even when prose or a
    // reasoning block streams between the two patches.
    if (emitted.has(id)) return;
    const event = byId.get(id);
    if (!event) return;
    emitted.add(id);
    pushToolEvent(event);
  };
  const pushTextWithLegacyTools = (text: string) => {
    for (const part of splitLegacyTools(text)) {
      if ('text' in part) pushAnswerText(part.text);
      else {
        pushToolEvent({
          id: `legacy-${legacyId++}`,
          name: part.tool.name,
          subject: part.tool.detail,
          status: 'done',
        });
      }
    }
  };

  for (const s of segments) {
    if (s.type !== 'answer') {
      out.push(s);
      continue;
    }
    if (!hasToolSentinel(s.text)) {
      pushTextWithLegacyTools(s.text);
      continue;
    }
    // Walk the ordered parts so tool cards land exactly between prose runs.
    for (const part of extractToolSentinels(s.text).parts) {
      if ('text' in part) pushTextWithLegacyTools(part.text);
      else pushTool(part.patch.id);
    }
  }

  return out;
}

const LEGACY_TOOL_MARKER = /🔧\s*([A-Za-z][A-Za-z0-9_.-]{0,80})\s*:\s*/gu;

function hasLegacyToolMarker(text: string): boolean {
  LEGACY_TOOL_MARKER.lastIndex = 0;
  for (let m = LEGACY_TOOL_MARKER.exec(text); m; m = LEGACY_TOOL_MARKER.exec(text)) {
    if (parseToolLine(`🔧 ${m[1].trim()}: detail`)) return true;
  }
  return false;
}

function splitLegacyTools(
  text: string,
): Array<{ text: string } | { tool: { name: string; detail: string } }> {
  const matches: Array<{
    emojiStart: number;
    detailStart: number;
    name: string;
  }> = [];

  LEGACY_TOOL_MARKER.lastIndex = 0;
  for (let m = LEGACY_TOOL_MARKER.exec(text); m; m = LEGACY_TOOL_MARKER.exec(text)) {
    const name = m[1].trim();
    if (!parseToolLine(`🔧 ${name}: detail`)) continue;
    matches.push({
      emojiStart: m.index,
      detailStart: m.index + m[0].length,
      name,
    });
  }

  if (matches.length === 0) return text ? [{ text }] : [];

  const out: Array<{ text: string } | { tool: { name: string; detail: string } }> = [];
  let cursor = 0;
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];
    const detailEnd = next ? next.emojiStart : legacyDetailEnd(text, current.detailStart);
    const before = text.slice(cursor, current.emojiStart);
    if (before) out.push({ text: before });
    out.push({
      tool: {
        name: current.name,
        detail: text.slice(current.detailStart, detailEnd).trim(),
      },
    });
    cursor = detailEnd;
  }
  const tail = text.slice(cursor);
  if (tail) out.push({ text: tail });
  return out;
}

function legacyDetailEnd(text: string, detailStart: number): number {
  const newline = text.indexOf('\n', detailStart);
  if (newline !== -1) return newline;
  return text.length;
}

