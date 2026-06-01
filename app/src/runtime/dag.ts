/**
 * CONTRACT: the headless DAG run engine.
 *
 * `getRunnableNodes` / `buildDependencyGraph` are the pure graph helpers (moved
 * from store/useStore.ts `runnableOrder` / `buildRunDependencies`).
 * `executeWorkflowDag` is the bounded-concurrency pump + per-node auto-retry
 * loop (moved from `executeViaCliInterpreter`), with every UI/Tauri side effect
 * routed through the injected {@link RunCallbacks}. The pump/pickReady algorithm
 * and the retry/back-off policy are unchanged from the GUI implementation, so a
 * run's observable order, retries, and terminal state match exactly.
 */
import { EXEC, type IRGraph, type IRNode, type IRRunStatus } from '../core/ir';
import { isRunnable, topoOrderExec } from '../core/topo';
import { delay } from './concurrency';
import { failureTitle, isRetryable, parseRunFailure, runFailureMeta } from './failure';
import { formatClock, formatDuration } from './format';
import { newSessionId } from './gateway';
import { dispatchNode } from './node-dispatch';
import type { NodeRunResult, RunCallbacks, RunContext, RunResult } from './types';

/** Runnable nodes in exec-topological order (drops structural `phase` markers). */
export function getRunnableNodes(workflow: IRGraph): IRNode[] {
  return topoOrderExec(workflow).filter(isRunnable);
}

/**
 * Build the runtime dependency map: a node depends on every other *runnable*
 * node that feeds it via an exec OR data edge. Connected nodes never reorder;
 * independent nodes have disjoint dependency sets and run concurrently.
 */
export function buildDependencyGraph(
  order: IRNode[],
  workflow: IRGraph,
): Map<string, Set<string>> {
  const idSet = new Set(order.map((n) => n.id));
  const deps = new Map<string, Set<string>>();
  for (const n of order) deps.set(n.id, new Set());
  for (const e of workflow.edges) {
    if (!idSet.has(e.from.node) || !idSet.has(e.to.node)) continue;
    if (e.from.node === e.to.node) continue;
    deps.get(e.to.node)!.add(e.from.node);
  }
  return deps;
}

/** True when a selection's adapter is part of the claude family. */
function isClaudeAdapter(adapter: string): boolean {
  return adapter === 'claude' || adapter === 'claude-code';
}

/**
 * Detect *linear claude agent chains* and assign each a shared warm session.
 *
 * A chain is a maximal run of adjacent nodes joined by EXEC edges where, for
 * every joining edge `from → to`, ALL of the following hold:
 *   - both `from` and `to` are runnable `agent`/`workflow` nodes;
 *   - both resolve (selection + per-node gateway override) to a claude(-code)
 *     adapter, and to the SAME adapter;
 *   - the edge is the only EXEC edge leaving `from` AND the only EXEC edge
 *     entering `to` (single-out / single-in — excludes fan-in / fan-out);
 *   - the two endpoints' resolved selections are identical (no override clash).
 *
 * Chains of a single node are not minted a session (nothing to resume). Every
 * node in a multi-node chain shares one `newSessionId()`; the chain's first node
 * is `isFirst=true`, the rest resume the warm context. DATA edges are ignored —
 * they don't affect chaining (the explicit upstream block is still injected by
 * the dispatcher). Returns a map keyed by node id; nodes not in any multi-node
 * chain are absent (and therefore cold-start unchanged).
 *
 * The EXEC dependency built by {@link buildDependencyGraph} guarantees a chain's
 * nodes run strictly sequentially, so the shared session id is never used
 * concurrently.
 */
export function detectAgentChains(
  order: IRNode[],
  workflow: IRGraph,
  context: RunContext,
): Map<string, { sessionId: string; isFirst: boolean }> {
  const chains = new Map<string, { sessionId: string; isFirst: boolean }>();
  const runnableIds = new Set(order.map((n) => n.id));
  const byId = new Map(order.map((n) => [n.id, n]));

  const isChainable = (node: IRNode | undefined): node is IRNode =>
    !!node && (node.type === 'agent' || node.type === 'workflow');

  // EXEC in/out degree (counted only over runnable endpoints).
  const outDeg = new Map<string, number>();
  const inDeg = new Map<string, number>();
  for (const n of order) {
    outDeg.set(n.id, 0);
    inDeg.set(n.id, 0);
  }
  for (const e of workflow.edges) {
    if (e.kind !== EXEC) continue;
    if (!runnableIds.has(e.from.node) || !runnableIds.has(e.to.node)) continue;
    if (e.from.node === e.to.node) continue;
    outDeg.set(e.from.node, (outDeg.get(e.from.node) ?? 0) + 1);
    inDeg.set(e.to.node, (inDeg.get(e.to.node) ?? 0) + 1);
  }

  // Per-node resolved selection (selection + node gateway override).
  const selectionOf = (node: IRNode) =>
    context.gateway.applyOverride(
      context.selection,
      context.gateway.nodeGatewayOverride(node.params) ?? undefined,
    );

  // `next[fromId] = toId` for every EXEC edge eligible to join a chain.
  const next = new Map<string, string>();
  for (const e of workflow.edges) {
    if (e.kind !== EXEC) continue;
    if (e.from.node === e.to.node) continue;
    const from = byId.get(e.from.node);
    const to = byId.get(e.to.node);
    if (!isChainable(from) || !isChainable(to)) continue;
    // Single-out from `from`, single-in to `to` — excludes fan-in / fan-out.
    if ((outDeg.get(from.id) ?? 0) !== 1 || (inDeg.get(to.id) ?? 0) !== 1) continue;
    const sf = selectionOf(from);
    const st = selectionOf(to);
    if (!isClaudeAdapter(sf.adapter) || !isClaudeAdapter(st.adapter)) continue;
    // Both endpoints must resolve to the SAME selection (adapter + overrides).
    if (
      sf.adapter !== st.adapter ||
      sf.modelClass !== st.modelClass ||
      sf.providerId !== st.providerId ||
      sf.channelId !== st.channelId ||
      !!sf.systemDefault !== !!st.systemDefault
    ) {
      continue;
    }
    next.set(from.id, to.id);
  }

  // Walk from each chain head (a chainable node with no chainable predecessor)
  // and assign one session id per multi-node chain.
  const hasPred = new Set(next.values());
  for (const node of order) {
    if (!isChainable(node)) continue;
    if (hasPred.has(node.id)) continue; // not a head — visited from its predecessor
    if (!next.has(node.id)) continue; // singleton chain — nothing to resume
    const sessionId = newSessionId();
    let cursor: string | undefined = node.id;
    let isFirst = true;
    while (cursor) {
      chains.set(cursor, { sessionId, isFirst });
      isFirst = false;
      cursor = next.get(cursor);
    }
  }

  return chains;
}

export interface ExecuteWorkflowOptions {
  resumeFromNodeId?: string | null;
  /** Outputs of nodes already known-complete (resume seed). */
  seedOutputs?: Record<string, string>;
  /** Run states already known (resume seed); used to mark nodes done. */
  seedRunState?: Record<string, IRRunStatus>;
}

/**
 * Interpret the IR as a dependency DAG and execute it through the injected
 * gateway. Independent nodes run concurrently (bounded by `context.concurrency`,
 * itself clamped by the gateway's speed tier). Returns the aggregate
 * {@link RunResult}; per-node transitions and logs stream through `callbacks`.
 */
export async function executeWorkflowDag(
  workflow: IRGraph,
  callbacks: RunCallbacks,
  context: RunContext,
  options: ExecuteWorkflowOptions = {},
): Promise<RunResult> {
  const runStartedAt = Date.now();
  const adapter = context.selection.adapter;
  const stillRunning = () => !callbacks.isCancelled();

  const order = getRunnableNodes(workflow);
  const resumeFromNodeId =
    options.resumeFromNodeId &&
    order.some((node) => node.id === options.resumeFromNodeId)
      ? options.resumeFromNodeId
      : null;
  const results = new Map<string, string>(Object.entries(options.seedOutputs ?? {}));
  const deps = buildDependencyGraph(order, workflow);
  const seedRunState = options.seedRunState ?? {};

  // Share a warm claude session across linear agent chains so successors
  // continue the predecessor's context instead of cold-starting (Fix 1). The
  // chain's EXEC dependency keeps its nodes strictly sequential, so the shared
  // session id is never used concurrently.
  context.agentChains = detectAgentChains(order, workflow, context);

  const resumeIdx = resumeFromNodeId
    ? order.findIndex((n) => n.id === resumeFromNodeId)
    : -1;
  const done = new Set<string>();
  order.forEach((node, i) => {
    if (results.has(node.id) || seedRunState[node.id] === 'success') {
      done.add(node.id);
    } else if (resumeIdx >= 0 && i < resumeIdx) {
      done.add(node.id);
    }
  });
  if (resumeFromNodeId) done.delete(resumeFromNodeId);

  const nodeResults: Record<string, NodeRunResult> = {};
  let errored = false;
  let failedNodeId: string | null = null;
  let runError: Record<string, unknown> | null = null;

  const processNode = async (node: IRNode): Promise<boolean> => {
    if (node.type === 'start' || node.type === 'end') {
      callbacks.onNodeSuccess(node, null);
      nodeResults[node.id] = { status: 'success' };
      return true;
    }

    const nodeStartedAt = Date.now();
    callbacks.onNodeStart(node);
    callbacks.onLog(
      `▸ ${node.label ?? node.type} · 开始 ${formatClock(nodeStartedAt)}`,
      'system',
    );

    const maxRetries = context.maxRetries;
    let attempt = 0;

    for (;;) {
      try {
        const out = await dispatchNode(context, callbacks, node, workflow, results);
        if (!stillRunning()) return false;
        if (out !== null) {
          results.set(node.id, out);
        }
        callbacks.onNodeSuccess(node, out);
        nodeResults[node.id] = {
          status: 'success',
          output: out ?? undefined,
          durationMs: Date.now() - nodeStartedAt,
          retryCount: attempt,
        };
        const nodeFinishedAt = Date.now();
        callbacks.onLog(
          `✓ ${node.label ?? node.type} · 完成 ${formatClock(nodeFinishedAt)} · 耗时 ${formatDuration(
            nodeFinishedAt - nodeStartedAt,
          )}${attempt > 0 ? ` · 重试 ${attempt} 次后成功` : ''}`,
          'assistant',
        );
        return true;
      } catch (err) {
        const failure = parseRunFailure(err);
        if (!stillRunning()) return false;

        if (attempt < maxRetries && isRetryable(failure)) {
          attempt += 1;
          const backoffMs = Math.min(15000, 1500 * attempt);
          callbacks.onLog(
            `⟳ ${node.label ?? node.type} · ${failureTitle(
              failure,
            )}，正在自动重试（第 ${attempt}/${maxRetries} 次，${Math.round(
              backoffMs / 1000,
            )}s 后重试）：${failure.message}`,
            'assistant',
          );
          callbacks.onNodeRetry?.(node, failure, attempt, maxRetries, backoffMs);
          await delay(backoffMs);
          if (!stillRunning()) return false;
          continue;
        }

        const nodeFinishedAt = Date.now();
        const retriedNote = attempt > 0 ? `（已自动重试 ${attempt} 次仍失败）` : '';
        callbacks.onLog(
          `✗ ${node.label ?? node.type} · 失败 ${formatClock(nodeFinishedAt)} · 耗时 ${formatDuration(
            nodeFinishedAt - nodeStartedAt,
          )}${retriedNote}: ${failure.message}`,
          'assistant',
        );
        const state: IRRunStatus =
          failure.code === 'interrupted' ? 'interrupted' : 'error';
        nodeResults[node.id] = {
          status: state,
          durationMs: nodeFinishedAt - nodeStartedAt,
          failure,
          retryCount: attempt,
        };
        // Only the first failure becomes the run's recorded error / resume point.
        if (!errored) {
          errored = true;
          failedNodeId = node.id;
          runError = runFailureMeta(node, adapter, failure);
        }
        callbacks.onNodeFailure(node, failure, state);
        return false;
      }
    }
  };

  const concurrency = context.gateway.effectiveConcurrency(
    context.concurrency,
    context.selection,
  );
  const claimed = new Set<string>(done);

  await new Promise<void>((resolve) => {
    let active = 0;
    let finished = false;
    const finish = () => {
      if (!finished) {
        finished = true;
        resolve();
      }
    };

    const pickReady = (): IRNode | null => {
      for (const node of order) {
        if (claimed.has(node.id)) continue;
        let ready = true;
        for (const dep of deps.get(node.id)!) {
          if (!done.has(dep)) {
            ready = false;
            break;
          }
        }
        if (ready) return node;
      }
      if (active === 0) {
        for (const node of order) if (!claimed.has(node.id)) return node;
      }
      return null;
    };

    const pump = (): void => {
      if (finished) return;
      if (!stillRunning()) {
        if (active === 0) finish();
        return;
      }
      while (active < concurrency && !errored && stillRunning()) {
        const next = pickReady();
        if (!next) break;
        claimed.add(next.id);
        active += 1;
        void processNode(next).then((ok) => {
          active -= 1;
          if (ok) done.add(next.id);
          pump();
        });
      }
      if (active === 0 && (errored || !stillRunning() || !pickReady())) {
        finish();
      }
    };

    pump();
  });

  const outputs = Object.fromEntries(results);
  return {
    success: !errored && stillRunning(),
    durationMs: Date.now() - runStartedAt,
    nodeResults,
    outputs,
    failedNodeId: failedNodeId ?? undefined,
    error: runError,
  };
}
