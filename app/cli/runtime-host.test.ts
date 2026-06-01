/**
 * Headless e2e of the shared run kernel through the Node host: inject a FAKE
 * gateway (no real spawn / HTTP), run the canonical sampleWorkflow via
 * runBlueprint, and assert every node succeeds, the output map is complete,
 * concurrency is exercised, and the data context is propagated.
 */
import { describe, expect, it } from 'vitest';
import { sampleWorkflow } from '../src/core/sample';
import type { RunGateway } from '../src/runtime';
import { runBlueprint, type RunEvent } from './runtime-host';

describe('runBlueprint (shared-kernel headless e2e)', () => {
  it('runs sampleWorkflow to completion with a fake gateway', async () => {
    const prompts: string[] = [];
    let active = 0;
    let maxConcurrent = 0;
    const gateway: RunGateway = {
      resolveDirectRoute: () => null,
      resolveCliRoute: async (selection) => ({
        adapter: selection.adapter,
        model: undefined,
        cliCommand: 'fake',
        env: undefined,
      }),
      completeText: async () => {
        throw new Error('direct path not used');
      },
      spawnCliAgent: async (prompt, _adapter, opts) => {
        active += 1;
        maxConcurrent = Math.max(maxConcurrent, active);
        prompts.push(prompt);
        await new Promise((r) => setTimeout(r, 15));
        opts.onProgress?.('chunk');
        active -= 1;
        return `OUT(${prompt.slice(0, 40)})`;
      },
      applyOverride: (selection, override) =>
        override
          ? { ...selection, modelClass: override.modelClass ?? selection.modelClass }
          : { ...selection },
      nodeGatewayOverride: () => undefined,
      modelClassFromModelId: () => 'sonnet',
      recordCall: () => {},
      timeoutPolicy: () => ({ timeoutSeconds: 1800, idleTimeoutSeconds: 300 }),
      effectiveConcurrency: (configured) => Math.max(1, configured),
      effectiveConsensusSamples: (configured) => Math.min(7, Math.max(2, configured)),
    };

    const events: RunEvent[] = [];
    const result = await runBlueprint(sampleWorkflow, {
      gateway,
      nonInteractive: true,
      concurrency: 4,
      onEvent: (e) => events.push(e),
    });

    // Whole run succeeds.
    expect(result.success).toBe(true);
    expect(result.failedNodeId).toBeUndefined();

    // Every runnable node reached success (start/scan/review/verify/end).
    const runnableIds = ['n_start', 'n_scan', 'n_review', 'n_verify', 'n_end'];
    for (const id of runnableIds) {
      expect(result.nodeResults[id]?.status).toBe('success');
    }

    // Output map carries the agent/parallel/verify outputs.
    expect(result.outputs.n_scan).toContain('OUT(');
    expect(result.outputs.n_review).toBeTruthy();
    expect(result.outputs.n_verify).toContain('OUT(');

    // The parallel node ran its 3 branches concurrently.
    expect(maxConcurrent).toBeGreaterThanOrEqual(2);

    // Data context: the scan output flows into verify via the data edge, so the
    // verify prompt must embed the scan result + the "上游步骤的输出" header.
    const verifyPrompt = prompts.find((p) => p.includes('Verify review findings'));
    expect(verifyPrompt).toBeTruthy();
    expect(verifyPrompt).toContain('上游步骤的输出');
    expect(verifyPrompt).toContain(result.outputs.n_scan);

    // Structured events were emitted (node lifecycle + streaming).
    expect(events.some((e) => e.kind === 'node_start' && e.nodeId === 'n_scan')).toBe(true);
    expect(events.some((e) => e.kind === 'node_success' && e.nodeId === 'n_verify')).toBe(true);
    expect(events.some((e) => e.kind === 'stream_begin')).toBe(true);
  });
});
