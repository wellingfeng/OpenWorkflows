/**
 * CONTRACT: headless run-engine interfaces shared by the desktop GUI and the
 * future Node CLI.
 *
 * The run engine lives in `runtime/` and is *pure* with respect to its host: it
 * never imports React / Zustand / Tauri and never touches `window`,
 * `document`, or `localStorage`. Every UI side effect (node colouring, message
 * stream, streaming progress, interaction, cancellation) is delegated to an
 * injected {@link RunCallbacks}. Every host capability the engine needs to reach
 * a model (direct HTTP completion, CLI subprocess spawn, gateway-route
 * resolution, speed/timeout heuristics) is injected through {@link RunGateway}
 * inside {@link RunContext}.
 *
 * The desktop GUI implements these against Zustand state + the Tauri spawn
 * seam (`aiEditViaCli`); the Node CLI will implement them against stdout/stderr
 * + `child_process`. Both consume the SAME `runtime/` code, so the observable
 * run behaviour is identical.
 */
import type {
  GatewaySelection,
  IRNode,
  IRRunStatus,
  NodeGatewayOverride,
} from '../core/ir';
import type {
  InteractionAnswer,
  InteractionRequest,
} from '../core/interaction';

/** Classified, host-agnostic node-execution failure. */
export type RunFailureCode =
  | 'timeout'
  | 'idle_timeout'
  | 'interrupted'
  | 'exit'
  | 'spawn'
  | 'backend'
  | 'wait'
  | 'unknown';

export interface RunFailure {
  code: RunFailureCode;
  message: string;
  raw: string;
  cli?: string;
  exitCode?: number;
  timeoutSeconds?: number;
  idleTimeoutSeconds?: number;
}

/** An agent spec for a parallel branch / pipeline stage (tolerates legacy strings). */
export interface RunSpec {
  prompt: string;
  label?: string;
  agentType?: string;
  model?: string;
  gateway?: NodeGatewayOverride;
}

/** Per-node terminal result captured by {@link executeWorkflowDag}. */
export interface NodeRunResult {
  status: IRRunStatus;
  output?: string;
  durationMs?: number;
  failure?: RunFailure;
  retryCount?: number;
}

/** Aggregate outcome of a full DAG run. */
export interface RunResult {
  success: boolean;
  durationMs: number;
  nodeResults: Record<string, NodeRunResult>;
  outputs: Record<string, string>;
  failedNodeId?: string;
  error?: Record<string, unknown> | null;
}

/**
 * Host side effects the run engine drives. The GUI maps these onto Zustand
 * setState / channel commits; the CLI maps them onto stdout/stderr + readline.
 */
export interface RunCallbacks {
  /** A runnable node transitioned to `running`. */
  onNodeStart(node: IRNode): void;
  /** A runnable node finished successfully (output is the downstream payload). */
  onNodeSuccess(node: IRNode, output: string | null): void;
  /** A runnable node failed (terminal — after retries are exhausted). */
  onNodeFailure(node: IRNode, failure: RunFailure, state: IRRunStatus): void;
  /** A node failed transiently and is about to auto-retry. */
  onNodeRetry?(
    node: IRNode,
    failure: RunFailure,
    attempt: number,
    maxRetries: number,
    backoffMs: number,
  ): void;
  /** General log line (system/assistant/node). */
  onLog(text: string, role?: 'system' | 'assistant' | 'node' | 'error'): void;

  /**
   * Begin a streaming message for a step and return handles to grow it live or
   * finalize/fail it. Mirrors the GUI's `createStreamMessage`. The CLI can stub
   * `append` to write chunks to stderr and `finalize`/`fail` to flush.
   */
  beginStream(header: string): RunStreamHandle;

  /** True once the run was cancelled (stop button / SIGINT). */
  isCancelled(): boolean;

  /**
   * Render an interaction request and resolve with the user's answer, or null
   * if dismissed / the run was stopped first.
   */
  promptInteraction(req: InteractionRequest): Promise<InteractionAnswer | null>;
}

/** Live handle to a single streaming step message. */
export interface RunStreamHandle {
  append(chunk: string): void;
  finalize(text: string): void;
  fail(text: string): void;
}

/** Options passed to {@link RunGateway.spawnCliAgent}. */
export interface SpawnCliAgentOpts {
  model?: string;
  cliCommand?: string;
  cwd?: string;
  permission?: string;
  env?: Record<string, string>;
  timeoutSeconds?: number;
  idleTimeoutSeconds?: number;
  onProgress?: (text: string) => void;
  sessionId?: string;
  resume?: boolean;
}

/** A resolved CLI route: the adapter + executable + per-call env. */
export interface ResolvedCliRoute {
  adapter: string;
  model?: string;
  cliCommand: string;
  env?: Record<string, string>;
}

/**
 * A resolved direct-HTTP route. The adapter is exposed for telemetry; any
 * provider credentials (apiKey/baseUrl/transport) stay opaque on the host side
 * and are consumed by {@link RunGateway.completeText}.
 */
export interface ResolvedDirectRoute {
  adapter: string;
  model?: string;
}

/** Timeout policy for a single CLI/HTTP call. */
export interface RunTimeoutPolicy {
  timeoutSeconds: number;
  idleTimeoutSeconds: number;
}

/** Telemetry recorded after each model call (drives speed tiers). */
export interface RunModelCallTiming {
  elapsedMs: number;
  firstProgressMs?: number;
  ok: boolean;
  failureCode?: RunFailureCode;
  timeoutSeconds?: number;
  idleTimeoutSeconds?: number;
}

/**
 * Injected host capabilities for reaching a model. The "direct HTTP" path
 * (`completeText`) stays a pure fetch in both hosts; only the CLI subprocess
 * call is the spawn seam (`spawnCliAgent`). Selection resolution + speed
 * heuristics are injected because they read host config (localStorage in the
 * GUI, files/env in the CLI) which the pure engine must not touch directly.
 */
export interface RunGateway {
  /** Resolve a direct provider-API route, or null when none is configured. */
  resolveDirectRoute(selection: GatewaySelection): ResolvedDirectRoute | null;
  /** Resolve a CLI route (executable + env). Throws when no CLI is usable. */
  resolveCliRoute(selection: GatewaySelection): Promise<ResolvedCliRoute>;

  /**
   * Direct HTTP completion (provider API). The host re-resolves the full route
   * (apiKey/baseUrl/transport) from `selection`; `model`/`omitModel` mirror the
   * CLI-spawn model handling. Streams chunks via onDelta.
   */
  completeText(opts: {
    selection: GatewaySelection;
    model?: string;
    omitModel?: boolean;
    prompt: string;
    onDelta?: (chunk: string) => void;
  }): Promise<{ text: string; adapter: string }>;

  /** Spawn a one-shot CLI agent (`claude -p` / `codex exec` / `gemini`). */
  spawnCliAgent(prompt: string, adapter: string, opts: SpawnCliAgentOpts): Promise<string>;

  /** Merge a per-node/spec override onto a selection. */
  applyOverride(
    selection: GatewaySelection,
    override?: NodeGatewayOverride,
  ): GatewaySelection;

  /** Extract a node/spec's gateway override (pure shape reader). */
  nodeGatewayOverride(
    nodeOrParams: { params?: Record<string, unknown> } | Record<string, unknown>,
  ): NodeGatewayOverride | undefined;

  /** Map a model id/label to its coarse model class (pure). */
  modelClassFromModelId(model: unknown): string;

  /** Record call telemetry (best-effort; no-op acceptable). */
  recordCall(selection: GatewaySelection, timing: RunModelCallTiming): void;

  /** Per-call timeout policy for a selection + prompt. */
  timeoutPolicy(selection: GatewaySelection, prompt?: string): RunTimeoutPolicy;

  /** Clamp configured concurrency by the selection's speed tier. */
  effectiveConcurrency(configured: number, selection: GatewaySelection): number;

  /** Clamp configured consensus samples by the selection's speed tier. */
  effectiveConsensusSamples(
    configured: number,
    selection: GatewaySelection,
  ): number;
}

/**
 * Per-run configuration + injected host ports. Everything the engine needs to
 * make decisions without reaching into host globals.
 */
export interface RunContext {
  /** The run's default gateway selection (adapter / model / provider). */
  selection: GatewaySelection;
  cwd?: string;
  permission?: string;
  /** Bounded-concurrency cap for independent nodes (already host-configured). */
  concurrency: number;
  /** Auto-retry budget for transient node failures (0 disables). */
  maxRetries: number;
  /** Default consensus fan-out samples (clamped 2..7 by the engine). */
  consensusSamples: number;
  /** Injected host gateway capabilities. */
  gateway: RunGateway;
  /** Per-spawn CLI command override (set once a CLI route is resolved). */
  cliCommand?: string;
  /**
   * Warm-session memberships for *linear claude agent chains*, keyed by node id.
   * Computed by the DAG at run start (see `detectAgentChains` in dag.ts): a run
   * of adjacent single-in/single-out `agent`/`workflow` nodes that all resolve to
   * a claude(-code) adapter shares one minted `sessionId`, so each successor
   * continues the predecessor's warm context (via `--resume`) instead of
   * cold-starting a fresh `claude -p`. The first node in a chain has
   * `isFirst=true`; the rest resume. Optional — when absent (headless callers,
   * non-claude runs, or fan-in/fan-out shapes) every node cold-starts exactly as
   * before.
   */
  agentChains?: Map<string, { sessionId: string; isFirst: boolean }>;
}

export type {
  GatewaySelection,
  NodeGatewayOverride,
} from '../core/ir';
