/**
 * Authoritative intermediate representation (IR) for OpenWorkflows.
 *
 * The IRGraph is the single source of truth for the entire system. The canvas
 * (React Flow), the script emitter/parser, and AI-driven mutations all operate
 * on this model-agnostic representation.
 *
 * CONTRACT: The exported types and the EXEC/DATA constants below are consumed
 * directly by App.tsx and every downstream module. Do not change their shapes.
 */

/** Pin / edge kinds. `▶ exec` is execution flow, `● data` is data flow. */
export const EXEC = 'exec' as const;
export const DATA = 'data' as const;

/** Kind of a pin or an edge: execution flow or data flow. */
export type PinKind = typeof EXEC | typeof DATA;

/**
 * All node categories supported by the blueprint canvas. Mirrors the node
 * catalogue described in the design doc (section 5).
 */
export type NodeType =
  | 'start'
  | 'end'
  | 'agent'
  | 'parallel'
  | 'pipeline'
  | 'phase'
  | 'branch'
  | 'loop'
  | 'workflow'
  | 'log'
  | 'variable'
  | 'codeblock'
  | 'consensus';

/** A single pin (input/output port) on a node. */
export interface IRPort {
  /** Stable id, unique within the node. */
  id: string;
  /** Whether this is an input or output pin. */
  direction: 'in' | 'out';
  /** Execution flow or data flow. */
  kind: PinKind;
  /** Human-readable label. */
  label?: string;
}

/**
 * A spec for a single `agent()` call used inside a `parallel` branch or a
 * `pipeline` stage. Emitted as `agent('<prompt>', { … })`; `schema` is an
 * identifier name (e.g. "REVIEW") emitted bare, never quoted.
 */
export interface IRAgentSpec {
  prompt: string;
  label?: string;
  /** Custom sub-agent type, emitted as the real `agentType:` option. */
  agentType?: string;
  model?: string;
  gateway?: NodeGatewayOverride;
  /** Schema identifier name (bare), e.g. "REVIEW". */
  schema?: string;
  isolation?: 'worktree';
  phase?: string;
  /**
   * Upstream-context convergence policy applied when building this node's data
   * block (see runtime/context.ts). 'full' (default) concatenates upstream
   * outputs verbatim; 'tail' head/tail-truncates over-long inputs. Omitted ⇒
   * 'full', so this is opt-in and never changes existing output.
   */
  contextPolicy?: 'full' | 'tail';
}

/**
 * Consensus strategies — the four reusable "quality patterns" Claude Code
 * Dynamic Workflows use to win by adversarial verification rather than scale:
 *   - 'adversarial'      一批出结论 → 一批专门反驳,扛住反驳才保留
 *   - 'multi-lens'       多个角度审同一目标 → 多数票通过
 *   - 'tournament'       各出方案 → 打分选胜 + 嫁接亮点
 *   - 'self-consistency' 同一提示跑 N 次 → 结构化多数票
 */
export type ConsensusStrategy =
  | 'adversarial'
  | 'multi-lens'
  | 'tournament'
  | 'self-consistency';

/**
 * Options for a `consensus` node, shared by the emitter, parser and run engine.
 * Emitted as the trailing `{ … }` of a `consensus([…voters], { … })` call with a
 * fixed key order so emit→parse→emit stays byte-stable.
 */
export interface ConsensusOpts {
  strategy: ConsensusStrategy;
  /** self-consistency only: run voters[0] this many times. Default 3, clamp 2..7. */
  samples?: number;
  /** Votes required to pass. Default ceil(N/2). */
  quorum?: number;
  /** Structured-verdict schema identifier (bare), e.g. "VERDICT". */
  schema?: string;
}

export type ModelClass = 'haiku' | 'sonnet' | 'opus' | string;

export interface GatewaySelection {
  adapter: 'claude-code' | 'codex' | 'gemini' | string;
  modelClass: ModelClass;
  /** Use the selected runtime CLI exactly as configured on the machine. */
  systemDefault?: boolean;
  providerId?: string;
  channelId?: string;
}

export interface NodeGatewayOverride {
  modelClass?: ModelClass;
  providerId?: string;
  channelId?: string;
}

/** A node in the workflow graph. */
export interface IRNode {
  /** Globally unique node id. */
  id: string;
  /** Node category. */
  type: NodeType;
  /**
   * Id of the containing `branch`/`loop` node, or undefined for the top scope.
   * Children of a container are emitted inside its `if`/`while` block; the
   * canvas renders them as independent nodes connected to the control node.
   */
  parent?: string;
  /** Display label. */
  label?: string;
  /**
   * Auto-assigned numeric tag shown on ordinary workflow nodes. Scoped to this
   * IRGraph, contiguous, and never set for Start/End.
   */
  numberLabel?: number;
  /**
   * JS variable name this node binds to in the emitted script (e.g. `scan` in
   * `const scan = await agent(...)`). Recovered on parse and reused on re-emit so
   * var names — and the `${var}` data-flow references that depend on them — stay
   * stable across emit→parse→emit. Optional; the emitter derives one from the
   * label when absent.
   */
  binding?: string;
  /**
   * Arbitrary, type-specific parameters. Notable shapes:
   *   start:    { userInputs?: string[] }        — source requirements shown on the Start node
   *   agent:    { prompt, label?, agentType?, model?, gateway?, schema?, isolation?, phase?, contextPolicy? }
   *   parallel: { branches: IRAgentSpec[] }       — emitted as a thunk array
   *   pipeline: { items: string, stages: IRAgentSpec[] } — items is an expr ref
   *   branch:   { condition: string }             — children carry parent=this.id
   *   loop:     { condition: string }             — while-continue condition
   *   consensus:{ voters: IRAgentSpec[], strategy, samples?, quorum?, schema? }
   *             — fan out voters, cross-validate, then vote (see ConsensusStrategy /
   *               ConsensusOpts). voters mirror parallel.branches (each carries its
   *               own full prompt); emitted as `consensus([…thunks], { … })`.
   */
  params: Record<string, unknown>;
  /** Optional explicit pin definitions; otherwise derived from the registry. */
  ports?: IRPort[];
}

/** An endpoint of an edge: a specific port on a specific node. */
export interface IREndpoint {
  node: string;
  port: string;
}

/** A directed edge connecting two ports. */
export interface IREdge {
  /** Globally unique edge id. */
  id: string;
  from: IREndpoint;
  to: IREndpoint;
  /** Execution flow or data flow. */
  kind: PinKind;
}

/** Optional per-node layout coordinates. */
export type IRLayout = Record<string, { x: number; y: number }>;

/** Persistable execution status for a workflow run or an individual node. */
export type IRRunStatus =
  | 'idle'
  | 'running'
  | 'success'
  | 'error'
  | 'interrupted';

/** Runtime snapshot persisted with the workflow so reopen/resume can recover. */
export interface IRRunSnapshot {
  status: IRRunStatus;
  nodeStates?: Record<string, IRRunStatus>;
  outputs?: Record<string, string>;
  failedNodeId?: string | null;
  error?: Record<string, unknown> | null;
  route?: GatewaySelection;
  usage?: Record<string, unknown> | null;
  updatedAt?: number;
}

/** Graph metadata. */
export interface IRMeta {
  name?: string;
  description?: string;
  /** Target adapter id, e.g. "claude-code". */
  adapter?: string;
  gateway?: {
    defaults?: GatewaySelection;
  };
  /** Last known runtime progress; ignored by emit/parse. */
  run?: IRRunSnapshot;
  /**
   * Definitions for schema identifiers referenced by agent/branch/stage specs,
   * keyed by identifier name. Emitted as a `const <name> = <body> // @schema`
   * preamble so the generated script is genuinely runnable. Recovered on parse
   * from `// @schema` annotations rather than becoming nodes.
   */
  schemaDefs?: Record<string, string>;
}

/** The complete workflow graph — the single source of truth. */
export interface IRGraph {
  version: number;
  meta: IRMeta;
  nodes: IRNode[];
  edges: IREdge[];
  layout?: IRLayout;
}
