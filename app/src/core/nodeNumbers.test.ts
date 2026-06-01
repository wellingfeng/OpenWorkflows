import { describe, expect, it } from 'vitest';
import { EXEC, type IRGraph } from './ir';
import {
  nodeNumberLabelMap,
  normalizeWorkflowNodeNumbers,
} from './nodeNumbers';

function graph(nodeIds: string[], edges: [string, string][]): IRGraph {
  return {
    version: 1,
    meta: { name: 'numbers' },
    nodes: nodeIds.map((id) => ({
      id,
      type: id === 'n_start' ? 'start' : id === 'n_end' ? 'end' : 'agent',
      label: id,
      numberLabel: 99,
      params: {},
    })),
    edges: edges.map(([from, to], i) => ({
      id: `e${i}`,
      from: { node: from, port: 'exec_out' },
      to: { node: to, port: 'exec_in' },
      kind: EXEC,
    })),
  };
}

describe('node numeric labels', () => {
  it('backfills contiguous labels for ordinary nodes and strips Start/End', () => {
    const workflow = normalizeWorkflowNodeNumbers(
      graph(
        ['n_start', 'n_a', 'n_b', 'n_end'],
        [
          ['n_start', 'n_a'],
          ['n_a', 'n_b'],
          ['n_b', 'n_end'],
        ],
      ),
    );

    expect(workflow.nodes.map((n) => [n.id, n.numberLabel])).toEqual([
      ['n_start', undefined],
      ['n_a', 1],
      ['n_b', 2],
      ['n_end', undefined],
    ]);
  });

  it('recomputes after execution order changes', () => {
    const workflow = graph(
      ['n_start', 'n_a', 'n_b', 'n_end'],
      [
        ['n_start', 'n_b'],
        ['n_b', 'n_a'],
        ['n_a', 'n_end'],
      ],
    );

    expect([...nodeNumberLabelMap(workflow)]).toEqual([
      ['n_b', 1],
      ['n_a', 2],
    ]);
  });

  it('compacts numbers after deletion and appends copied nodes by their order', () => {
    const workflow = normalizeWorkflowNodeNumbers(
      graph(
        ['n_start', 'n_a', 'n_a_copy', 'n_b', 'n_end'],
        [
          ['n_start', 'n_a'],
          ['n_a', 'n_a_copy'],
          ['n_a_copy', 'n_b'],
          ['n_b', 'n_end'],
        ],
      ),
    );
    const deletedCopy = normalizeWorkflowNodeNumbers({
      ...workflow,
      nodes: workflow.nodes.filter((n) => n.id !== 'n_a'),
      edges: workflow.edges.filter(
        (e) => e.from.node !== 'n_a' && e.to.node !== 'n_a',
      ),
    });

    expect(workflow.nodes.map((n) => [n.id, n.numberLabel])).toEqual([
      ['n_start', undefined],
      ['n_a', 1],
      ['n_a_copy', 2],
      ['n_b', 3],
      ['n_end', undefined],
    ]);
    expect(deletedCopy.nodes.map((n) => [n.id, n.numberLabel])).toEqual([
      ['n_start', undefined],
      ['n_a_copy', 1],
      ['n_b', 2],
      ['n_end', undefined],
    ]);
  });
});
