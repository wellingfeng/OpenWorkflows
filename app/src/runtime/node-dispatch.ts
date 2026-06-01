/**
 * CONTRACT: per-node dispatch — agent/workflow/parallel/pipeline/consensus/log.
 *
 * Moved from store/useStore.ts (`runNode` / `runParallel` / `runPipeline` /
 * `runConsensus` / `resolveConsensus`). `ch: RunChannel` is replaced by
 * `context: RunContext` + `callbacks: RunCallbacks`; selection resolution and
 * speed clamps go through the injected gateway. Behaviour is identical to the
 * GUI's original implementation.
 */
import type { ConsensusStrategy, GatewaySelection, IRGraph, IRNode } from '../core/ir';
import { runWithConcurrency } from './concurrency';
import { buildDataContextString, type ContextCaps, type ContextPolicy } from './context';
import { parseRunFailure } from './failure';
import { newSessionId, runAgentWithInteraction } from './gateway';
import {
  clampSamples,
  consensusStrategy,
  runSpecGatewayOverride,
  specList,
} from './spec';
import type { RunCallbacks, RunContext, RunFailure, RunSpec } from './types';

/** The run's default gateway selection (already resolved in the context). */
function globalSelection(context: RunContext): GatewaySelection {
  return context.selection;
}

/**
 * Upstream-context caps for a node. Reads the optional `contextPolicy` param and
 * defaults to 'full' (byte-identical legacy output → zero behaviour change unless
 * the user explicitly opts into truncation). Truncation only engages for 'tail'.
 */
function contextCaps(node: IRNode): ContextCaps {
  const policy: ContextPolicy =
    node.params.contextPolicy === 'tail' ? 'tail' : 'full';
  return { policy };
}

/** Per-node selection: global selection + the node's own gateway override. */
function nodeSelection(
  context: RunContext,
  node: IRNode,
): GatewaySelection {
  return context.gateway.applyOverride(
    globalSelection(context),
    context.gateway.nodeGatewayOverride(node.params) ?? undefined,
  );
}

/**
 * Run a `parallel` node: each branch is its own concurrent agent call (real
 * fan-out). All branches share the node's upstream data context. Throws only if
 * every branch fails.
 */
export async function runParallel(
  context: RunContext,
  callbacks: RunCallbacks,
  node: IRNode,
  workflow: IRGraph,
  results: Map<string, string>,
): Promise<string> {
  const branches = specList(node.params.branches, context.gateway);
  if (branches.length === 0) return '';
  const upstream = buildDataContextString(node, workflow, results, contextCaps(node));
  const baseSelection = nodeSelection(context, node);

  const settled = await runWithConcurrency(
    branches,
    Math.min(
      branches.length,
      context.gateway.effectiveConcurrency(context.concurrency, baseSelection),
    ),
    async (b, i) => {
      const label = b.label || b.agentType || b.prompt.slice(0, 16) || `分支${i + 1}`;
      const stepLabel = `并行分支 ${i + 1}/${branches.length} · ${label}`;
      const branchSelection = context.gateway.applyOverride(
        baseSelection,
        runSpecGatewayOverride(b, context.gateway),
      );
      try {
        const out = (
          await runAgentWithInteraction({
            context,
            callbacks,
            head: `【${stepLabel}】\n`,
            label: stepLabel,
            basePrompt: b.prompt + upstream,
            selection: branchSelection,
            cli: { cwd: context.cwd, permission: context.permission },
          })
        ).trim();
        return { ok: true as const, label, out };
      } catch (err) {
        const failure = parseRunFailure(err);
        return { ok: false as const, label, out: '', failure };
      }
    },
  );

  if (settled.every((s) => !s.ok)) {
    const detail = settled
      .map((s) => (s.ok ? '' : `${s.label}: ${s.failure.message}`))
      .filter(Boolean)
      .join('；');
    throw new Error(detail ? `所有并行分支均失败：${detail}` : '所有并行分支均失败');
  }
  return settled
    .map((s) =>
      s.ok ? `【${s.label}】\n${s.out}` : `【${s.label}】\n(失败：${s.failure.message})`,
    )
    .join('\n\n');
}

/**
 * Run a `pipeline` node: stages execute sequentially, each receiving the
 * previous stage's output. Returns the final stage's output.
 */
export async function runPipeline(
  context: RunContext,
  callbacks: RunCallbacks,
  node: IRNode,
  workflow: IRGraph,
  results: Map<string, string>,
): Promise<string> {
  const stages = specList(node.params.stages, context.gateway);
  if (stages.length === 0) return '';
  const items = String(node.params.items ?? '').trim();
  let prev = '';
  const baseSelection = nodeSelection(context, node);

  // A pipeline shares a single warm session across stages (claude adapter only)
  // so each stage continues the previous context instead of cold-starting.
  const isClaude =
    baseSelection.adapter === 'claude-code' || baseSelection.adapter === 'claude';
  const sessionId = isClaude ? newSessionId() : undefined;

  for (let i = 0; i < stages.length; i += 1) {
    if (callbacks.isCancelled()) break;
    const s = stages[i];
    const label = s.label || s.prompt.slice(0, 16) || `阶段${i + 1}`;
    const stepLabel = `流水线阶段 ${i + 1}/${stages.length} · ${label}`;
    const feed =
      i === 0
        ? buildDataContextString(node, workflow, results, contextCaps(node)) +
          (items ? `\n\n输入数据: ${items}` : '')
        : `\n\n---\n上一步输出：\n${prev}`;
    const stageSelection = context.gateway.applyOverride(
      baseSelection,
      runSpecGatewayOverride(s, context.gateway),
    );
    prev = (
      await runAgentWithInteraction({
        context,
        callbacks,
        head: `【${stepLabel}】\n`,
        label: stepLabel,
        basePrompt: s.prompt + feed,
        selection: stageSelection,
        cli: {
          omitModel: !!(sessionId && i > 0),
          cwd: context.cwd,
          permission: context.permission,
        },
        session: sessionId ? { id: sessionId, resume: i > 0 } : undefined,
      })
    ).trim();
  }
  return prev;
}

type ConsensusSample =
  | { ok: true; label: string; out: string }
  | { ok: false; label: string; out: ''; failure?: RunFailure };

/**
 * Run a `consensus` node: fan out N voters over the SAME target, then
 * cross-validate + vote per strategy. Throws only when too few samples succeed
 * to vote, so node-level auto-retry keeps working.
 */
export async function runConsensus(
  context: RunContext,
  callbacks: RunCallbacks,
  node: IRNode,
  workflow: IRGraph,
  results: Map<string, string>,
): Promise<string> {
  const voters = specList(node.params.voters, context.gateway);
  if (voters.length === 0) return '';
  const strategy = consensusStrategy(node.params.strategy);
  const upstream = buildDataContextString(node, workflow, results, contextCaps(node));
  const baseSelection = nodeSelection(context, node);

  const samples =
    strategy === 'self-consistency'
      ? Array.from(
          {
            length: context.gateway.effectiveConsensusSamples(
              clampSamples(node.params.samples, context.consensusSamples),
              baseSelection,
            ),
          },
          () => voters[0],
        )
      : voters;
  const total = samples.length;
  const quorum =
    typeof node.params.quorum === 'number' && node.params.quorum > 0
      ? node.params.quorum
      : Math.ceil(total / 2);

  const settled = await runWithConcurrency<RunSpec, ConsensusSample>(
    samples,
    Math.min(
      total,
      context.gateway.effectiveConcurrency(context.concurrency, baseSelection),
    ),
    async (s, i) => {
      if (callbacks.isCancelled()) return { ok: false, label: `样本${i + 1}`, out: '' };
      const label = s.label || s.agentType || s.prompt.slice(0, 16) || `样本${i + 1}`;
      const stepLabel = `共识样本 ${i + 1}/${total} · ${label}`;
      const sampleSelection = context.gateway.applyOverride(
        baseSelection,
        runSpecGatewayOverride(s, context.gateway),
      );
      try {
        const out = (
          await runAgentWithInteraction({
            context,
            callbacks,
            head: `【${stepLabel}】\n`,
            label: stepLabel,
            basePrompt: s.prompt + upstream,
            selection: sampleSelection,
            cli: { cwd: context.cwd, permission: context.permission },
          })
        ).trim();
        return { ok: true, label, out };
      } catch (err) {
        return { ok: false, label, out: '', failure: parseRunFailure(err) };
      }
    },
  );

  const oks = settled.filter(
    (s): s is { ok: true; label: string; out: string } => s.ok && !!s.out,
  );
  if (oks.length < 2) {
    if (oks.length === 1) return oks[0].out;
    const detail = settled
      .map((s) => (s.ok ? '' : `${s.label}: ${s.failure?.message ?? '无输出'}`))
      .filter(Boolean)
      .join('；');
    throw new Error(
      detail ? `共识失败：可用样本不足以投票（${detail}）` : '共识失败：可用样本不足以投票',
    );
  }
  if (callbacks.isCancelled()) return oks[0].out;

  return resolveConsensus(
    context,
    callbacks,
    node,
    oks.map((s) => s.out),
    strategy,
    quorum,
    baseSelection,
  );
}

/** Cross-validate the candidate outputs and return the consensus answer. */
export async function resolveConsensus(
  context: RunContext,
  callbacks: RunCallbacks,
  node: IRNode,
  candidates: string[],
  strategy: ConsensusStrategy,
  quorum: number,
  baseSelection: GatewaySelection,
): Promise<string> {
  if (strategy === 'self-consistency') {
    const buckets = new Map<string, { rep: string; n: number }>();
    for (const c of candidates) {
      const key = c.trim().toLowerCase().replace(/\s+/g, ' ');
      const b = buckets.get(key);
      if (b) b.n += 1;
      else buckets.set(key, { rep: c, n: 1 });
    }
    let best = { rep: candidates[0], n: 0 };
    for (const b of buckets.values()) if (b.n > best.n) best = b;
    callbacks.onLog(
      `共识(自一致投票)：最高一致 ${best.n}/${candidates.length}`,
      'system',
    );
    if (best.n >= quorum) return best.rep;
  }

  const instruction =
    strategy === 'adversarial'
      ? '下面是多个独立得出的结论。请逐条尝试证伪，丢弃站不住脚的，只综合那些扛住反驳的结论，给出最终答案。'
      : strategy === 'tournament'
        ? '下面是多个独立方案。请按质量择优选出最佳方案，并把其它方案中值得借鉴的亮点合并进去，输出最终方案。'
        : '下面是多个独立角度对同一目标的判定。请按多数意见综合，给出最可信的最终结论，并简述理由。';
  const block = candidates.map((c, i) => `【候选 ${i + 1}】\n${c}`).join('\n\n');
  const label = `${node.label ?? '共识'} · 评审/投票`;
  return (
    await runAgentWithInteraction({
      context,
      callbacks,
      head: `【${label}】\n`,
      label,
      basePrompt: `${instruction}\n\n${block}`,
      selection: baseSelection,
      cli: { cwd: context.cwd, permission: context.permission },
    })
  ).trim();
}

/**
 * Execute one node, returning its result string (stored for downstream data
 * edges), or null when there is nothing to run (control / log / variable /
 * codeblock). Throws on hard error.
 */
export async function dispatchNode(
  context: RunContext,
  callbacks: RunCallbacks,
  node: IRNode,
  workflow: IRGraph,
  results: Map<string, string>,
): Promise<string | null> {
  const label = node.label ?? node.type;
  const selection = nodeSelection(context, node);
  switch (node.type) {
    case 'agent': {
      const base = String(node.params.prompt ?? node.label ?? '').trim();
      if (!base) return '';
      // If this node belongs to a linear claude agent chain (Fix 1), reuse the
      // chain's warm session — exactly mirroring runPipeline's stage handling.
      const chain = context.agentChains?.get(node.id);
      return runAgentWithInteraction({
        context,
        callbacks,
        head: `【${label}】\n`,
        label,
        basePrompt: base + buildDataContextString(node, workflow, results, contextCaps(node)),
        selection,
        cli: {
          omitModel: chain ? !chain.isFirst : undefined,
          cwd: context.cwd,
          permission: context.permission,
        },
        session: chain ? { id: chain.sessionId, resume: !chain.isFirst } : undefined,
      });
    }
    case 'workflow': {
      const base = `运行子工作流 "${String(node.params.name ?? node.label ?? 'sub')}" 并返回结果。`;
      const chain = context.agentChains?.get(node.id);
      return runAgentWithInteraction({
        context,
        callbacks,
        head: `【${label}】\n`,
        label,
        basePrompt: base + buildDataContextString(node, workflow, results, contextCaps(node)),
        selection,
        cli: {
          omitModel: chain ? !chain.isFirst : undefined,
          cwd: context.cwd,
          permission: context.permission,
        },
        session: chain ? { id: chain.sessionId, resume: !chain.isFirst } : undefined,
      });
    }
    case 'parallel':
      return runParallel(context, callbacks, node, workflow, results);
    case 'pipeline':
      return runPipeline(context, callbacks, node, workflow, results);
    case 'consensus':
      return runConsensus(context, callbacks, node, workflow, results);
    case 'log': {
      const msg = String(node.params.message ?? node.params.msg ?? '').trim();
      if (msg) callbacks.onLog(msg, 'system');
      return null;
    }
    default:
      return null; // start/end/branch/loop/variable/codeblock
  }
}
