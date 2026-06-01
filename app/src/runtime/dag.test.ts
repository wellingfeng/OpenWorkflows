/**
 * Headless run-engine tests. These import ONLY `@/runtime` (no store / React /
 * Tauri), proving the engine runs against injected callbacks + a mock gateway —
 * exactly what the future Node CLI will provide. Covers exec/data ordering,
 * data-context threading, parallel fan-out, auto-retry of transient failures,
 * terminal failure recording, and cancellation.
 */
import { describe, expect, it } from 'vitest';
import { EXEC, DATA, type IRGraph, type PinKind } from '@/core/ir';
import {
  executeWorkflowDag,
  type RunCallbacks,
  type RunContext,
  type RunGateway,
  type SpawnCliAgentOpts,
} from '@/runtime';

function edge(id: string, from: string, to: string, kind: PinKind = EXEC) {
  return { id, from: { node: from, port: 'o' }, to: { node: to, port: 'i' }, kind };
}

/** A linear agent chain: start → a → b → end, with a data edge a → b. */
function chainGraph(): IRGraph {
  return {
    version: 1,
    meta: { name: 't', adapter: 'claude-code' },
    nodes: [
      { id: 'start', type: 'start', params: {} },
      { id: 'a', type: 'agent', label: 'A', params: { prompt: 'do A' } },
      { id: 'b', type: 'agent', label: 'B', params: { prompt: 'do B' } },
      { id: 'end', type: 'end', params: {} },
    ],
    edges: [
      edge('e1', 'start', 'a'),
      edge('e2', 'a', 'b'),
      edge('e3', 'b', 'end'),
      edge('e4', 'a', 'b', DATA),
    ],
    layout: {},
  };
}

/** A mock gateway that always spawns the CLI (no direct route) and runs `respond`. */
function mockGateway(
  respond: (prompt: string, opts: SpawnCliAgentOpts) => Promise<string>,
): RunGateway {
  return {
    resolveDirectRoute: () => null,
    resolveCliRoute: async () => ({ adapter: 'claude-code', cliCommand: 'claude' }),
    completeText: async () => ({ text: '', adapter: 'claude-code' }),
    spawnCliAgent: (prompt, _adapter, opts) => respond(prompt, opts),
    applyOverride: (s) => s,
    recordCall: () => {},
    timeoutPolicy: () => ({ timeoutSeconds: 600, idleTimeoutSeconds: 180 }),
    effectiveConcurrency: (n) => n,
    effectiveConsensusSamples: (n) => n,
    nodeGatewayOverride: () => undefined,
    modelClassFromModelId: () => 'sonnet',
  };
}

function collectingCallbacks(log: string[]): RunCallbacks {
  return {
    onNodeStart: (n) => log.push(`start:${n.id}`),
    onNodeSuccess: (n) => log.push(`ok:${n.id}`),
    onNodeFailure: (n, _f, state) => log.push(`fail:${n.id}:${state}`),
    onLog: () => {},
    beginStream: () => ({ append: () => {}, finalize: () => {}, fail: () => {} }),
    isCancelled: () => false,
    promptInteraction: async () => null,
  };
}

function ctx(gateway: RunGateway, overrides: Partial<RunContext> = {}): RunContext {
  return {
    selection: { adapter: 'claude-code', modelClass: 'sonnet' },
    concurrency: 4,
    maxRetries: 2,
    consensusSamples: 3,
    gateway,
    ...overrides,
  };
}

describe('executeWorkflowDag', () => {
  it('runs an exec chain in order and threads data context downstream', async () => {
    const seen: string[] = [];
    const gw = mockGateway(async (prompt) => {
      if (prompt.includes('do A')) return 'A-OUTPUT';
      // B must receive A's output via the data edge.
      seen.push(prompt.includes('A-OUTPUT') ? 'B-got-A' : 'B-missing-A');
      return 'B-OUTPUT';
    });
    const log: string[] = [];
    const result = await executeWorkflowDag(chainGraph(), collectingCallbacks(log), ctx(gw));

    expect(result.success).toBe(true);
    expect(seen).toEqual(['B-got-A']);
    expect(result.outputs.a).toBe('A-OUTPUT');
    expect(result.outputs.b).toBe('B-OUTPUT');
    // start before a before b before end.
    expect(log.indexOf('ok:a')).toBeLessThan(log.indexOf('start:b'));
    expect(log.indexOf('ok:b')).toBeLessThan(log.indexOf('ok:end'));
  });

  it('auto-retries a transient failure then succeeds', async () => {
    let attempts = 0;
    const gw = mockGateway(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('CLI "claude" 退出码 1: boom');
      return 'recovered';
    });
    const log: string[] = [];
    const g: IRGraph = {
      version: 1,
      meta: { name: 't', adapter: 'claude-code' },
      nodes: [
        { id: 'start', type: 'start', params: {} },
        { id: 'a', type: 'agent', label: 'A', params: { prompt: 'go' } },
        { id: 'end', type: 'end', params: {} },
      ],
      edges: [edge('e1', 'start', 'a'), edge('e2', 'a', 'end')],
      layout: {},
    };
    const result = await executeWorkflowDag(g, collectingCallbacks(log), ctx(gw));
    expect(attempts).toBe(2);
    expect(result.success).toBe(true);
    expect(result.nodeResults.a.retryCount).toBe(1);
  });

  it('records the first failure as the resume point and reports failure', async () => {
    const gw = mockGateway(async () => {
      throw new Error('启动 CLI "claude" 失败: not found'); // spawn = non-retryable
    });
    const log: string[] = [];
    const g: IRGraph = {
      version: 1,
      meta: { name: 't', adapter: 'claude-code' },
      nodes: [
        { id: 'start', type: 'start', params: {} },
        { id: 'a', type: 'agent', label: 'A', params: { prompt: 'go' } },
        { id: 'end', type: 'end', params: {} },
      ],
      edges: [edge('e1', 'start', 'a'), edge('e2', 'a', 'end')],
      layout: {},
    };
    const result = await executeWorkflowDag(g, collectingCallbacks(log), ctx(gw));
    expect(result.success).toBe(false);
    expect(result.failedNodeId).toBe('a');
    expect(result.error?.code).toBe('spawn');
    expect(log).toContain('fail:a:error');
  });

  it('fans out a parallel node across branches', async () => {
    let maxConcurrent = 0;
    let active = 0;
    const gw = mockGateway(async () => {
      active += 1;
      maxConcurrent = Math.max(maxConcurrent, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return 'branch-out';
    });
    const g: IRGraph = {
      version: 1,
      meta: { name: 't', adapter: 'claude-code' },
      nodes: [
        { id: 'start', type: 'start', params: {} },
        {
          id: 'p',
          type: 'parallel',
          label: 'P',
          params: { branches: [{ prompt: 'x' }, { prompt: 'y' }, { prompt: 'z' }] },
        },
        { id: 'end', type: 'end', params: {} },
      ],
      edges: [edge('e1', 'start', 'p'), edge('e2', 'p', 'end')],
      layout: {},
    };
    const result = await executeWorkflowDag(g, collectingCallbacks([]), ctx(gw));
    expect(result.success).toBe(true);
    expect(maxConcurrent).toBeGreaterThan(1); // genuine fan-out
    expect(result.outputs.p).toContain('branch-out');
  });

  it('stops scheduling once cancelled', async () => {
    let cancelled = false;
    const log: string[] = [];
    const gw = mockGateway(async () => {
      cancelled = true; // cancel after the first node runs
      return 'first';
    });
    const callbacks: RunCallbacks = {
      ...collectingCallbacks(log),
      isCancelled: () => cancelled,
    };
    const result = await executeWorkflowDag(chainGraph(), callbacks, ctx(gw));
    expect(result.success).toBe(false); // cancelled mid-run
  });
});
