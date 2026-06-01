import type { IRGraph, IRNode } from './ir';
import { topoOrderExec } from './topo';

/**
 * Numeric node-label contract:
 * - numbering is scoped to one workflow;
 * - every non Start/End IR node gets one globally unique number;
 * - Start/End never participate and any stale number on them is stripped;
 * - numbers are auto-assigned and recomputed from execution order after graph
 *   structure changes. Dragging nodes only changes layout, not execution order.
 */
export function isNumberedWorkflowNode(
  node: Pick<IRNode, 'type'>,
): boolean {
  return node.type !== 'start' && node.type !== 'end';
}

export function nodeNumberLabelMap(workflow: IRGraph): Map<string, number> {
  const labels = new Map<string, number>();
  let next = 1;
  for (const node of topoOrderExec(workflow)) {
    if (!isNumberedWorkflowNode(node)) continue;
    labels.set(node.id, next);
    next += 1;
  }
  return labels;
}

export function normalizeWorkflowNodeNumbers(workflow: IRGraph): IRGraph {
  const labels = nodeNumberLabelMap(workflow);
  let changed = false;
  const nodes = workflow.nodes.map((node) => {
    const label = labels.get(node.id);
    if (label == null) {
      if (node.numberLabel == null) return node;
      changed = true;
      const nextNode = { ...node };
      delete nextNode.numberLabel;
      return nextNode;
    }
    if (node.numberLabel === label) return node;
    changed = true;
    return { ...node, numberLabel: label };
  });
  return changed ? { ...workflow, nodes } : workflow;
}
