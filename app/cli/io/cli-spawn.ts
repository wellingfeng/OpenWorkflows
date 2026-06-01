/**
 * Node `child_process.spawn` port of the Tauri `ai_cli` command
 * (`src-tauri/src/lib.rs`). It reproduces the exact argv, stdin handling,
 * stream-json parsing, timeout / idle-timeout, and cancellation behaviour so a
 * headless CLI run is observably identical to a desktop run.
 *
 * argv (claude):  -p --output-format stream-json --verbose
 *                 [--strict-mcp-config]
 *                 [--resume <sid> | --session-id <sid>]
 *                 [--model <m>            (filtered by shouldPassModel)]
 *                 [--permission-mode plan | --dangerously-skip-permissions]
 *                 [--add-dir <cwd>]
 * argv (codex):   [-a never|on-request] exec --json --skip-git-repo-check
 *                 [--sandbox read-only|workspace-write | --dangerously-bypass-...]
 *                 [--model <m>] [-C <cwd>] [-o <outfile>] -
 *
 * The prompt is fed via stdin (then closed) so large prompts can't hit the OS
 * command-line length limit. `DISABLE_AUTOUPDATER=1` is layered onto the claude
 * env. On Windows the child is launched with `windowsHide: true` and killed via
 * `taskkill /PID <pid> /T /F`; elsewhere via `kill -TERM`.
 *
 * Pure Node: no react / zustand / tauri. Imports only `which-cli` (sibling) +
 * `node:*`.
 */
import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  adapterProtocol,
  shouldPassModel,
  whichCli,
} from './which-cli';
import {
  codexCompletedItem,
  codexProgressLine,
  codexStatusSuccess,
  codexTurnCompletionStatus,
  summarizeToolUse,
} from './stream';

const IS_WINDOWS = process.platform === 'win32';

/** Default hard timeout (s) before the child is killed (mirrors lib.rs). */
const DEFAULT_TIMEOUT_SECS = 1800;
/** Default "no observable progress" timeout (s) (mirrors lib.rs). */
const DEFAULT_IDLE_TIMEOUT_SECS = 300;

/** Options for {@link spawnCliAgent}. */
export interface SpawnCliAgentOpts {
  /** Adapter id (claude-code / codex / gemini / custom). */
  adapter: string;
  model?: string;
  /** Explicit CLI path / bare name override. */
  cliCommand?: string;
  cwd?: string;
  /** AIDock permission mode: 'full' | 'readonly' | 'ask'. */
  permission?: string;
  /** Per-call env overlay (gateway credentials etc.). */
  env?: Record<string, string>;
  timeoutSeconds?: number;
  idleTimeoutSeconds?: number;
  /** Live progress callback (assistant text + tool breadcrumbs). */
  onProgress?: (text: string) => void;
  /** Claude session continuity. */
  sessionId?: string;
  resume?: boolean;
  /** Cancellation: when it aborts, the child process tree is killed. */
  signal?: AbortSignal;
}

/** Clamp + env-override the hard timeout (mirrors ai_cli_timeout_secs). */
function resolveTimeoutSecs(override?: number): number {
  const configuredRaw = Number(process.env.OPENWORKFLOW_AI_CLI_TIMEOUT_SECS);
  const configured =
    Number.isFinite(configuredRaw) && configuredRaw >= 60
      ? Math.floor(configuredRaw)
      : DEFAULT_TIMEOUT_SECS;
  const dynamic =
    typeof override === 'number' && override >= 60 ? Math.floor(override) : configured;
  return Math.max(configured, dynamic);
}

/** Clamp + env-override the idle timeout (mirrors ai_cli_idle_timeout_secs). 0 disables. */
function resolveIdleTimeoutSecs(override?: number): number {
  const raw = process.env.OPENWORKFLOW_AI_CLI_IDLE_TIMEOUT_SECS;
  let configured = DEFAULT_IDLE_TIMEOUT_SECS;
  if (raw != null && raw.trim() !== '') {
    const n = Number(raw.trim());
    if (Number.isFinite(n) && (n === 0 || n >= 30)) configured = Math.floor(n);
  }
  if (configured === 0) return 0;
  if (typeof override === 'number' && (override === 0 || override >= 30)) {
    if (override === 0) return 0;
    return Math.max(configured, Math.floor(override));
  }
  return configured;
}

function mcpEnabled(): boolean {
  const v = (process.env.OPENWORKFLOW_ENABLE_MCP ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Kill a process tree: Windows `taskkill /PID <pid> /T /F`, *nix `kill -TERM`. */
export function terminateProcessTree(pid: number): void {
  try {
    if (IS_WINDOWS) {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        spawnSync('kill', ['-TERM', String(pid)], { stdio: 'ignore' });
      }
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Decide how to actually launch a binary. On Windows a batch launcher
 * (`.cmd`/`.bat`) cannot be spawned directly (Node raises EINVAL since the
 * CVE-2024-27980 fix), so it is run through `cmd.exe /d /s /c` with a single
 * verbatim command line — mirroring how the Rust `Command` invocation resolves
 * batch shims on Windows. Native executables (and all *nix binaries) spawn
 * directly with the tokenised argv.
 */
function resolveLaunch(
  binary: string,
  args: string[],
): { command: string; args: string[]; verbatim: boolean } {
  if (IS_WINDOWS && /\.(cmd|bat)$/i.test(binary)) {
    const quote = (s: string) => (/[\s"&|<>^()]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const line = [binary, ...args].map(quote).join(' ');
    const comspec = process.env.ComSpec || 'cmd.exe';
    return { command: comspec, args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
  }
  return { command: binary, args, verbatim: false };
}

/** Build the claude / codex argv (mirrors the Rust `args` assembly). */
function buildArgs(
  opts: SpawnCliAgentOpts,
  protocol: string,
  codexOutPath: string | undefined,
): { args: string[]; workdir?: string; disableAutoupdater: boolean } {
  const args: string[] = [];
  let workdir: string | undefined;
  let disableAutoupdater = false;
  const permission = opts.permission ?? 'full';
  const cwd = opts.cwd?.trim();

  if (protocol === 'codex') {
    if (permission === 'readonly') {
      args.push('-a', 'never');
    } else if (permission === 'ask') {
      args.push('-a', 'on-request');
    }
    args.push('exec', '--json', '--skip-git-repo-check');
    if (permission === 'readonly') {
      args.push('--sandbox', 'read-only');
    } else if (permission === 'ask') {
      args.push('--sandbox', 'workspace-write');
    } else {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    }
    if (opts.model && shouldPassModel(opts.adapter, opts.model)) {
      args.push('--model', opts.model);
    }
    if (cwd) {
      workdir = cwd;
      args.push('-C', cwd);
    }
    if (codexOutPath) {
      args.push('-o', codexOutPath);
    }
    args.push('-');
  } else {
    // claude (and any non-codex protocol falls through to the claude shape).
    args.push('-p', '--output-format', 'stream-json', '--verbose');
    disableAutoupdater = true;
    if (!mcpEnabled()) {
      args.push('--strict-mcp-config');
    }
    const sid = opts.sessionId?.trim();
    if (sid) {
      if (opts.resume) {
        args.push('--resume', sid);
      } else {
        args.push('--session-id', sid);
      }
    }
    if (opts.model && shouldPassModel(opts.adapter, opts.model)) {
      args.push('--model', opts.model);
    }
    if (permission === 'readonly') {
      args.push('--permission-mode', 'plan');
    } else if (permission === 'ask') {
      /* default: may print a permission question */
    } else {
      args.push('--dangerously-skip-permissions');
    }
    if (cwd) {
      workdir = cwd;
      args.push('--add-dir', cwd);
    }
  }
  return { args, workdir, disableAutoupdater };
}

/**
 * Spawn a one-shot CLI agent and resolve with its final text. Streams assistant
 * text + tool breadcrumbs through `onProgress`. Rejects with a message that
 * `runtime/failure.ts#parseRunFailure` can classify (same wording as lib.rs):
 * timeout / idle_timeout / interrupted / exit / spawn.
 */
export function spawnCliAgent(prompt: string, opts: SpawnCliAgentOpts): Promise<string> {
  const protocol = adapterProtocol(opts.adapter);
  const isCodex = protocol === 'codex';
  const binary = whichCli(opts.adapter, { cliCommand: opts.cliCommand });

  let codexDir: string | undefined;
  let codexOutPath: string | undefined;
  if (isCodex) {
    codexDir = mkdtempSync(join(tmpdir(), 'openworkflow-codex-'));
    codexOutPath = join(codexDir, 'last-message.txt');
  }
  const cleanupCodex = () => {
    if (codexDir) {
      try {
        rmSync(codexDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  };

  const { args, workdir, disableAutoupdater } = buildArgs(opts, protocol, codexOutPath);

  return new Promise<string>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (opts.env) {
      for (const [k, v] of Object.entries(opts.env)) {
        if (k.trim()) env[k] = v;
      }
    }
    if (disableAutoupdater) env.DISABLE_AUTOUPDATER = '1';

    let child;
    try {
      const launch = resolveLaunch(binary, args);
      child = spawn(launch.command, launch.args, {
        cwd: workdir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments: launch.verbatim,
      });
    } catch (err) {
      cleanupCodex();
      reject(
        new Error(
          `无法启动 CLI "${binary}"：请确认它已安装并在 PATH 中。(${(err as Error).message})`,
        ),
      );
      return;
    }

    const timeoutSecs = resolveTimeoutSecs(opts.timeoutSeconds);
    const idleSecs = resolveIdleTimeoutSecs(opts.idleTimeoutSeconds);

    let acc = ''; // accumulated assistant text
    let result = ''; // terminal `result` value (claude)
    let codexTurnStatus: string | undefined;
    let stderrBuf = '';
    let lastActivity = Date.now();
    const touch = () => {
      lastActivity = Date.now();
    };

    let settled = false;
    let timedOutMessage: string | null = null;
    let cancelled = false;

    const finishReject = (msg: string) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      cleanupCodex();
      reject(new Error(appendErrorContext(msg, result || acc, stderrBuf)));
    };
    const finishResolve = (out: string) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      cleanupCodex();
      resolve(out);
    };

    // --- spawn errors (ENOENT etc.) ---
    child.on('error', (err) => {
      finishReject(
        `无法启动 CLI "${binary}"：请确认它已安装并在 PATH 中。(${err.message})`,
      );
    });

    // --- stdin: write prompt then close (EOF) ---
    if (child.stdin) {
      child.stdin.on('error', () => {
        /* ignore EPIPE if the child exits before reading the full prompt */
      });
      child.stdin.write(prompt);
      child.stdin.end();
    }

    // --- stdout: line-buffered JSONL parse ---
    const rl = child.stdout
      ? createInterface({ input: child.stdout, crlfDelay: Infinity })
      : null;
    rl?.on('line', (line) => {
      touch();
      const trimmed = line.trim();
      if (!trimmed) return;
      let v: Record<string, unknown>;
      try {
        v = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        return;
      }
      if (isCodex) {
        const status = codexTurnCompletionStatus(v);
        if (status != null) {
          codexTurnStatus = status;
          terminateProcessTree(child.pid!);
          return;
        }
        const item = codexCompletedItem(v);
        if (item) {
          const ln = codexProgressLine(item);
          if (ln) {
            acc += ln;
            opts.onProgress?.(ln);
          }
        }
        return;
      }
      // claude stream-json
      const type = v.type;
      if (type === 'assistant') {
        const message = v.message as Record<string, unknown> | undefined;
        const content = message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block !== 'object' || block === null) continue;
            const b = block as Record<string, unknown>;
            if (b.type === 'text' && typeof b.text === 'string') {
              acc += b.text;
              opts.onProgress?.(b.text);
            } else if (b.type === 'tool_use') {
              const name = typeof b.name === 'string' ? b.name : 'tool';
              const ln = `\n${summarizeToolUse(name, b.input)}\n`;
              opts.onProgress?.(ln);
            }
          }
        }
      } else if (type === 'result') {
        if (typeof v.result === 'string') result = v.result;
      }
    });

    // --- stderr: capture for error context ---
    child.stderr?.on('data', (chunk: Buffer) => {
      touch();
      stderrBuf += chunk.toString('utf8');
      if (stderrBuf.length > 64_000) stderrBuf = stderrBuf.slice(-64_000);
    });

    // --- timers: hard timeout + idle timeout + codex sidecar readiness ---
    const startedAt = Date.now();
    const poll = setInterval(() => {
      if (settled) return;
      if (Date.now() - startedAt >= timeoutSecs * 1000) {
        timedOutMessage = `CLI "${binary}" 超时（${timeoutSecs}s）已终止。`;
        terminateProcessTree(child.pid!);
        return;
      }
      if (idleSecs > 0 && Date.now() - lastActivity >= idleSecs * 1000) {
        timedOutMessage = `CLI "${binary}" 空转超过 ${idleSecs}s 未产生输出，已终止。`;
        terminateProcessTree(child.pid!);
        return;
      }
      if (isCodex && codexOutPath) {
        // Sidecar file presence/growth counts as activity.
        const ready = codexLastMessageReady(codexOutPath);
        if (ready) {
          terminateProcessTree(child.pid!);
        }
      }
    }, 100);

    const onAbort = () => {
      cancelled = true;
      if (child.pid != null) terminateProcessTree(child.pid);
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    function cleanupTimers() {
      clearInterval(poll);
      rl?.close();
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
    }

    // --- exit: decide success/failure (mirrors the Rust match) ---
    child.on('close', (code, signal) => {
      // Read codex sidecar final message if present.
      let output = result.trim() ? result : acc;
      if (isCodex && codexOutPath) {
        let final = '';
        try {
          final = readFileSync(codexOutPath, 'utf8');
        } catch {
          /* none */
        }
        if (final.trim()) output = final;
      }

      if (cancelled) {
        finishReject(`CLI "${binary}" 已由用户中断。`);
        return;
      }
      if (timedOutMessage) {
        finishReject(timedOutMessage);
        return;
      }
      if (isCodex && codexTurnStatus != null) {
        if (codexStatusSuccess(codexTurnStatus)) finishResolve(output);
        else {
          const detail = stderrBuf.trim() || output.trim();
          finishReject(`CLI "${binary}" turn status ${codexTurnStatus}: ${detail}`);
        }
        return;
      }
      // codex sidecar-ready (terminated by us) without a turn event → success.
      if (isCodex && (code === null || signal != null) && output.trim()) {
        finishResolve(output);
        return;
      }
      if (code === 0) {
        finishResolve(output);
        return;
      }
      const c = code == null ? -1 : code;
      const detail = stderrBuf.trim() || output.trim();
      finishReject(`CLI "${binary}" 退出码 ${c}: ${detail}`);
    });
  });
}

/** Codex sidecar readiness: non-empty + unmodified for ≥1s (mirrors codex_last_message_ready). */
function codexLastMessageReady(path: string): boolean {
  try {
    const st = statSync(path);
    if (st.size === 0) return false;
    return Date.now() - st.mtimeMs >= 1000;
  } catch {
    return false;
  }
}

const ERROR_CONTEXT_LIMIT = 1200;

/** Append a trimmed tail of recent output/stderr to an error (mirrors append_cli_error_context). */
function appendErrorContext(err: string, output: string, stderr: string): string {
  const context = stderr.trim() ? stderr : output;
  const trimmed = context.trim();
  if (!trimmed) return err;
  let tail = trimmed;
  if (tail.length > ERROR_CONTEXT_LIMIT) {
    tail = `...\n${tail.slice(tail.length - ERROR_CONTEXT_LIMIT)}`;
  }
  return `${err}\n最近输出:\n${tail}`;
}
