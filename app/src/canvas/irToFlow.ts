import type { Edge, Node } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';
import { DATA, EXEC, type IRGraph, type NodeType } from '@/core/ir';
import { nodeNumberLabelMap } from '@/core/nodeNumbers';
import type { NodeRunState } from '@/store/types';
import type { Locale } from '@/lib/i18n';

/**
 * Adapter that projects the authoritative {@link IRGraph} onto the
 * nodes/edges shape consumed by React Flow.
 *
 * The IR parent relation is semantic, not a React Flow sub-flow. `branch` and
 * `loop` render as compact control nodes; their child nodes stay independent on
 * the canvas and are connected by exec edges. This keeps nested bodies visible
 * without clipping or constraining drag movement inside a parent rectangle.
 */

/** Extra payload carried on each React Flow node's `data` field. */
export interface FlowNodeData extends Record<string, unknown> {
  label: string;
  numberLabel?: number;
  irType: NodeType;
  params: Record<string, unknown>;
  /** Current UI locale for i18n lookups. */
  locale: Locale;
  /** Semantic branch/loop parent from the IR, if any. */
  scopeParentId?: string;
  /** Live execution state — only set while a workflow is running. */
  runState?: NodeRunState;
}

export type FlowNode = Node<FlowNodeData>;
export type FlowEdge = Edge;

/** Default spacing used when a node has no recorded layout. */
const DEFAULT_DX = 240;
const DEFAULT_Y = 160;

const CONTROL_W = 240;
const CONTROL_H = 92;

/** Map an IR node type to the registered custom React Flow node component. */
function flowNodeType(type: NodeType): string {
  switch (type) {
    case 'agent':
      return 'agent';
    case 'parallel':
      return 'parallel';
    case 'pipeline':
      return 'pipeline';
    case 'consensus':
      return 'consensus';
    case 'branch':
    case 'loop':
      return 'container';
    case 'start':
    case 'end':
      return 'control';
    default:
      return 'agent';
  }
}

function isControlContainer(type: NodeType): boolean {
  return type === 'branch' || type === 'loop';
}

/** Human-readable fallback label for a node missing an explicit one. */
function nodeLabel(node: IRGraph['nodes'][number]): string {
  if (node.label && node.label.trim()) return node.label;
  return node.id;
}

function toFlowNode(
  node: IRGraph['nodes'][number],
  index: number,
  graph: IRGraph,
  numberLabels: Map<string, number>,
  runState: Record<string, NodeRunState> | undefined,
  locale: Locale,
): FlowNode {
  const state = runState?.[node.id];
  const result: FlowNode = {
    id: node.id,
    type: flowNodeType(node.type),
    position: graph.layout?.[node.id] ?? { x: index * DEFAULT_DX, y: DEFAULT_Y },
    data: {
      label: nodeLabel(node),
      ...(numberLabels.has(node.id)
        ? { numberLabel: numberLabels.get(node.id) }
        : null),
      irType: node.type,
      params: node.params,
      locale,
      ...(node.parent ? { scopeParentId: node.parent } : null),
      ...(state ? { runState: state } : null),
    },
    ...(isControlContainer(node.type)
      ? { style: { width: CONTROL_W, height: CONTROL_H } }
      : null),
  };

  // Rough initial size for start nodes so edges are close to correct
  // before React Flow 12's ResizeObserver measures the real DOM size.
  if (node.type === 'start') {
    const inputs = (node.params.userInputs as string[] | undefined) ?? [];
    if (inputs.length > 0) {
      const avgChars = inputs.reduce((s, t) => s + t.length, 0) / inputs.length;
      const estWidth = Math.min(420, Math.max(220, avgChars * 7 + 24));
      const estHeight = 28 + inputs.length * 20 + 16;
      result.style = { width: estWidth, height: estHeight };
    }
  }

  return result;
}

function hasReachedRunState(
  runState: Record<string, NodeRunState> | undefined,
  nodeId: string,
): boolean {
  const state = runState?.[nodeId];
  return state != null && state !== 'idle';
}

function shouldAnimateEdge(
  edge: IREdgeLike,
  runState: Record<string, NodeRunState> | undefined,
): boolean {
  if (edge.kind !== EXEC) return false;
  return (
    hasReachedRunState(runState, edge.from.node) &&
    hasReachedRunState(runState, edge.to.node)
  );
}

/** Convert a single IR edge into a React Flow edge. */
function toFlowEdge(
  edge: IREdgeLike,
  runState: Record<string, NodeRunState> | undefined,
): FlowEdge {
  const isData = edge.kind === DATA;
  const color = isData ? 'var(--accent-2)' : 'var(--accent)';
  return {
    id: edge.id,
    source: edge.from.node,
    target: edge.to.node,
    sourceHandle: edge.from.port,
    targetHandle: edge.to.port,
    type: 'smoothstep',
    animated: shouldAnimateEdge(edge, runState),
    style: {
      stroke: color,
      strokeWidth: 1.5,
      strokeDasharray: isData ? '4 4' : undefined,
    },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    data: { kind: edge.kind },
  };
}

type IREdgeLike = IRGraph['edges'][number];

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/**
 * Project an {@link IRGraph} into React Flow `nodes` and `edges`.
 *
 * Pure function: same input always yields an equivalent output. Semantic
 * children are ordinary React Flow nodes, so the user can drag them freely while
 * the emitter still uses `node.parent` to produce nested script blocks.
 */
export function irToFlow(
  graph: IRGraph,
  runState?: Record<string, NodeRunState>,
  locale?: Locale,
): FlowGraph {
  const numberLabels = nodeNumberLabelMap(graph);
  const nodes = graph.nodes.map((node, i) =>
    toFlowNode(node, i, graph, numberLabels, runState, locale ?? 'en-US'),
  );
  const edges = graph.edges.map((edge) => toFlowEdge(edge, runState));
  return { nodes, edges };
}
