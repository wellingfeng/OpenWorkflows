/**
 * CONTRACT: build the upstream data-context block fed into a node's prompt.
 * Pure functions over the IRGraph + completed-node outputs, moved verbatim from
 * store/useStore.ts (`dataInputsFor` / `dataContextString`).
 */
import { DATA, type IRGraph, type IRNode } from '../core/ir';

/** Collect outputs of nodes that feed `node` via data edges (producer → node). */
export function getDataInputs(
  node: IRNode,
  workflow: IRGraph,
  results: Map<string, string>,
): { label: string; text: string }[] {
  const byId = new Map(workflow.nodes.map((n) => [n.id, n]));
  const inputs: { label: string; text: string }[] = [];
  for (const e of workflow.edges) {
    if (e.kind !== DATA || e.to.node !== node.id) continue;
    const out = results.get(e.from.node);
    if (out == null) continue;
    inputs.push({ label: byId.get(e.from.node)?.label ?? e.from.node, text: out });
  }
  return inputs;
}

/**
 * Convergence policy for the upstream data-context block.
 *   - 'full'    逐字节拼接全部上游输出（默认，与历史行为完全一致）。
 *   - 'tail'    超过单段/累计上限时按 head/tail 截断并插入省略标注。
 * 'summary' 需要调模型，纯内核无法实现；在 gateway 层做，这里把它当 'tail' 处理。
 */
export type ContextPolicy = 'full' | 'tail';

/** Truncation caps for {@link buildDataContextString}, only used when policy !== 'full'. */
export interface ContextCaps {
  /** Max chars kept for a single upstream output before head/tail truncation. */
  maxCharsPerInput?: number;
  /** Max chars for the whole assembled context block before a final cutoff. */
  maxTotalChars?: number;
  /** Convergence strategy; defaults to 'full' (byte-identical legacy output). */
  policy?: ContextPolicy | 'summary';
}

const DEFAULT_MAX_CHARS_PER_INPUT = 4000;
const DEFAULT_MAX_TOTAL_CHARS = 12000;

/**
 * Keep the head and tail of an over-long text, dropping the middle and inserting
 * an elision marker recording how many characters were removed.
 */
function clipHeadTail(text: string, max: number): string {
  if (text.length <= max) return text;
  const omitted = text.length - max;
  const head = Math.ceil(max / 2);
  const tail = max - head;
  const tailPart = tail > 0 ? text.slice(text.length - tail) : '';
  return `${text.slice(0, head)}\n…（已省略 ${omitted} 字符）…\n${tailPart}`;
}

/** The "上游输出" context block for a node, or '' when it has no data inputs. */
export function buildDataContextString(
  node: IRNode,
  workflow: IRGraph,
  results: Map<string, string>,
  caps?: ContextCaps,
): string {
  const inputs = getDataInputs(node, workflow, results);
  if (inputs.length === 0) return '';

  // 'summary' is not implementable in this pure module (no model access); treat
  // it as 'tail' here and leave the real summarisation to the gateway layer.
  // TODO(gateway): perform genuine model-side summarisation when policy === 'summary'.
  const policy = caps?.policy === 'summary' ? 'tail' : caps?.policy ?? 'full';

  // Default path: byte-for-byte identical to the legacy behaviour. Anything that
  // depends on round-trip / existing tests stays here untouched.
  if (policy === 'full') {
    const ctx = inputs
      .map((i) => `### 来自「${i.label}」的输出\n${i.text}`)
      .join('\n\n');
    return `\n\n---\n以下是上游步骤的输出，供你参考：\n\n${ctx}`;
  }

  // 'tail': clip each input, then clip the assembled block.
  const maxPerInput = caps?.maxCharsPerInput ?? DEFAULT_MAX_CHARS_PER_INPUT;
  const maxTotal = caps?.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;
  const ctx = inputs
    .map((i) => `### 来自「${i.label}」的输出\n${clipHeadTail(i.text, maxPerInput)}`)
    .join('\n\n');
  const block = `\n\n---\n以下是上游步骤的输出，供你参考：\n\n${ctx}`;
  if (block.length <= maxTotal) return block;
  const omitted = block.length - maxTotal;
  return `${block.slice(0, maxTotal)}\n…（上下文整体截断，已省略 ${omitted} 字符）…`;
}
