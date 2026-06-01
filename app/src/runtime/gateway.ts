/**
 * CONTRACT: host-agnostic agent invocation.
 *
 * `invokeAgent` dispatches one model call along the injected gateway — direct
 * HTTP when a provider key resolves, else a spawned CLI agent — and records
 * timing telemetry. `runAgentWithInteraction` wraps it in the bounded
 * "node may ask the user" loop (see core/interaction.ts), streaming each attempt
 * through `callbacks.beginStream` and blocking on `callbacks.promptInteraction`.
 *
 * Moved from store/useStore.ts (`invokeGatewayAgent` / `invokeAgentCli` /
 * `runCliWithInteraction`). The Tauri spawn seam and React streaming/interaction
 * are replaced by the injected {@link RunGateway} + {@link RunCallbacks}.
 */
import {
  INTERACTION_PROTOCOL,
  formatAnswerForPrompt,
  parseInteraction,
  stripInteraction,
} from '../core/interaction';
import type { GatewaySelection } from '../core/ir';
import { appendExecutionContract } from './contract';
import { parseRunFailure } from './failure';
import { formatFailureLine } from './failure';
import type { RunCallbacks, RunContext } from './types';

/** Max times a single node may ask the user before we stop re-invoking it. */
export const MAX_INTERACTION_ROUNDS = 6;

/** A fresh session id (uuid) for chaining warm context across steps. */
export function newSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Run one model call: direct HTTP when a provider key resolves, otherwise a
 * spawned CLI agent. Records timing telemetry on success and failure.
 */
export async function invokeAgent(
  context: RunContext,
  prompt: string,
  selection: GatewaySelection,
  opts: {
    model?: string;
    omitModel?: boolean;
    cliCommand?: string;
    cwd?: string;
    permission?: string;
    timeoutSeconds?: number;
    idleTimeoutSeconds?: number;
    onProgress?: (text: string) => void;
    sessionId?: string;
    resume?: boolean;
  } = {},
): Promise<{ text: string; adapter: string }> {
  const { gateway } = context;
  const direct = gateway.resolveDirectRoute(selection);
  if (direct) {
    const startedAt = Date.now();
    let firstProgressAt: number | undefined;
    try {
      const result = await gateway.completeText({
        selection,
        model: opts.model ?? direct.model,
        omitModel: opts.omitModel,
        prompt,
        onDelta: (chunk) => {
          firstProgressAt ??= Date.now();
          opts.onProgress?.(chunk);
        },
      });
      gateway.recordCall(selection, {
        elapsedMs: Date.now() - startedAt,
        firstProgressMs: firstProgressAt ? firstProgressAt - startedAt : undefined,
        ok: true,
      });
      return { text: result.text, adapter: result.adapter };
    } catch (err) {
      const failure = parseRunFailure(err);
      gateway.recordCall(selection, {
        elapsedMs: Date.now() - startedAt,
        firstProgressMs: firstProgressAt ? firstProgressAt - startedAt : undefined,
        ok: false,
        failureCode: failure.code,
        timeoutSeconds: failure.timeoutSeconds,
        idleTimeoutSeconds: failure.idleTimeoutSeconds,
      });
      throw err;
    }
  }

  const cli = await gateway.resolveCliRoute(selection);
  const startedAt = Date.now();
  let firstProgressAt: number | undefined;
  try {
    const text = await gateway.spawnCliAgent(prompt, cli.adapter, {
      model: opts.omitModel ? undefined : opts.model ?? cli.model,
      env: cli.env,
      cwd: opts.cwd,
      permission: opts.permission,
      timeoutSeconds: opts.timeoutSeconds,
      idleTimeoutSeconds: opts.idleTimeoutSeconds,
      cliCommand: opts.cliCommand ?? cli.cliCommand ?? context.cliCommand,
      onProgress: (chunk) => {
        firstProgressAt ??= Date.now();
        opts.onProgress?.(chunk);
      },
      sessionId: opts.sessionId,
      resume: opts.resume,
    });
    gateway.recordCall(selection, {
      elapsedMs: Date.now() - startedAt,
      firstProgressMs: firstProgressAt ? firstProgressAt - startedAt : undefined,
      ok: true,
    });
    return { text, adapter: cli.adapter };
  } catch (err) {
    const failure = parseRunFailure(err);
    gateway.recordCall(selection, {
      elapsedMs: Date.now() - startedAt,
      firstProgressMs: firstProgressAt ? firstProgressAt - startedAt : undefined,
      ok: false,
      failureCode: failure.code,
      timeoutSeconds: failure.timeoutSeconds,
      idleTimeoutSeconds: failure.idleTimeoutSeconds,
    });
    throw err;
  }
}

/**
 * Run one CLI step that may ask the user to choose/type before producing its
 * final result. Streams each attempt into its own message via
 * `callbacks.beginStream`. If the model emits an interaction block it renders a
 * widget (`callbacks.promptInteraction`), waits for the answer, appends it to
 * the prompt, and re-invokes — bounded by MAX_INTERACTION_ROUNDS. Returns the
 * final (interaction-stripped) output; throws on CLI failure.
 */
export async function runAgentWithInteraction(opts: {
  context: RunContext;
  callbacks: RunCallbacks;
  /** Streaming header, e.g. `【label】\n`. */
  head: string;
  /** Bracket label for the streamed finalize/failure line (no ✓ prefix). */
  label: string;
  /** Prompt base — already includes upstream data context / stage feed. */
  basePrompt: string;
  selection: GatewaySelection;
  cli: {
    model?: string;
    omitModel?: boolean;
    cliCommand?: string;
    cwd?: string;
    permission?: string;
    timeoutSeconds?: number;
    idleTimeoutSeconds?: number;
  };
  /** Optional session continuity (shared id; resume marks continuation). */
  session?: { id: string; resume: boolean };
}): Promise<string> {
  const { context, callbacks } = opts;
  const stillRunning = () => !callbacks.isCancelled();
  let appendix = '';
  let lastClean = '';
  for (let round = 0; round < MAX_INTERACTION_ROUNDS; round += 1) {
    if (!stillRunning()) return lastClean;
    const sm = callbacks.beginStream(
      round === 0 ? opts.head : `${opts.head}（已根据你的回答继续）\n`,
    );
    const prompt = `${appendExecutionContract(opts.basePrompt)}\n\n${INTERACTION_PROTOCOL}${appendix}`;
    const timeoutPolicy = context.gateway.timeoutPolicy(opts.selection, prompt);

    let raw: string;
    try {
      raw = (
        await invokeAgent(context, prompt, opts.selection, {
          model: opts.cli.model,
          omitModel: opts.cli.omitModel,
          cliCommand: opts.cli.cliCommand,
          cwd: opts.cli.cwd,
          permission: opts.cli.permission,
          timeoutSeconds: opts.cli.timeoutSeconds ?? timeoutPolicy.timeoutSeconds,
          idleTimeoutSeconds:
            opts.cli.idleTimeoutSeconds ?? timeoutPolicy.idleTimeoutSeconds,
          onProgress: sm.append,
          sessionId: opts.session?.id,
          resume: opts.session ? opts.session.resume || round > 0 : undefined,
        })
      ).text.trim();
    } catch (err) {
      const failure = parseRunFailure(err);
      if (stillRunning()) sm.fail(formatFailureLine(opts.label, failure));
      throw err;
    }

    const clean = stripInteraction(raw);
    lastClean = clean;

    const req = stillRunning() ? parseInteraction(raw) : null;
    if (!req) {
      if (!stillRunning()) return clean;
      sm.finalize(`【✓ ${opts.label}】\n${clean || '(无输出)'}`);
      return clean;
    }

    sm.finalize(
      clean
        ? `【${opts.label}】\n${clean}`
        : `【${opts.label}】\n（已向你提出一个问题，请在下方作答）`,
    );
    const answer = await callbacks.promptInteraction(req);
    if (!answer || !stillRunning()) return clean;
    appendix += `\n\n${formatAnswerForPrompt(req, answer)}`;
  }

  callbacks.onLog(
    `⚠ ${opts.label}：交互轮数已达上限（${MAX_INTERACTION_ROUNDS}），停止追问。`,
    'system',
  );
  return lastClean;
}
