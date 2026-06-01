/**
 * Terminal-driven implementation of the node "ask the user" protocol
 * (`core/interaction.ts`). The run engine hands a parsed {@link InteractionRequest}
 * to `RunCallbacks.promptInteraction`; this module renders it with `node:readline`
 * and resolves the user's {@link InteractionAnswer}.
 *
 * `parseInteraction` / `formatAnswerForPrompt` themselves live in
 * `core/interaction.ts` (pure, shared with the GUI); this file only owns the
 * terminal rendering + answer collection. `--non-interactive` auto-skips
 * (resolves null) so CI / scripted runs never block on a prompt.
 *
 * Pure Node: `node:readline` + `core/interaction.ts` only.
 */
import { createInterface, type Interface } from 'node:readline';
import type {
  InteractionAnswer,
  InteractionRequest,
} from '../../src/core/interaction';

export interface TerminalInteractionOptions {
  /** When true, every request resolves null without prompting (CI mode). */
  nonInteractive?: boolean;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

/** Build a `RunCallbacks.promptInteraction` driven by the terminal. */
export function createTerminalInteraction(
  options: TerminalInteractionOptions = {},
): (req: InteractionRequest) => Promise<InteractionAnswer | null> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stderr;
  const nonInteractive = options.nonInteractive ?? false;

  return async (req: InteractionRequest): Promise<InteractionAnswer | null> => {
    if (nonInteractive) {
      output.write(
        `\n[non-interactive] 跳过交互请求：${req.prompt}\n`,
      );
      return null;
    }
    const rl = createInterface({ input, output });
    try {
      switch (req.type) {
        case 'select':
          return await promptSelect(rl, output, req);
        case 'input':
          return await promptInput(rl, output, req);
        case 'confirm':
          return await promptConfirm(rl, output, req);
      }
    } finally {
      rl.close();
    }
  };
}

function ask(rl: Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function promptSelect(
  rl: Interface,
  output: NodeJS.WritableStream,
  req: InteractionRequest,
): Promise<InteractionAnswer> {
  const options = req.options ?? [];
  output.write(`\n? ${req.prompt}\n`);
  options.forEach((opt, i) => output.write(`  ${i + 1}) ${opt}\n`));
  const hint = req.multi
    ? '输入序号（多选用逗号分隔，如 1,3）：'
    : '输入序号：';
  for (;;) {
    const raw = (await ask(rl, hint)).trim();
    const picks = raw
      .split(/[\s,，]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= options.length);
    if (picks.length === 0) {
      output.write('  无效选择，请重新输入。\n');
      continue;
    }
    const chosen = req.multi
      ? Array.from(new Set(picks)).map((n) => options[n - 1])
      : [options[picks[0] - 1]];
    return { kind: 'select', values: chosen };
  }
}

async function promptInput(
  rl: Interface,
  output: NodeJS.WritableStream,
  req: InteractionRequest,
): Promise<InteractionAnswer> {
  output.write(`\n? ${req.prompt}\n`);
  if (req.placeholder) output.write(`  (${req.placeholder})\n`);
  if (req.multiline) {
    output.write('  多行输入，单独一行输入 "." 结束：\n');
    const lines: string[] = [];
    for (;;) {
      const line = await ask(rl, '');
      if (line.trim() === '.') break;
      lines.push(line);
    }
    return { kind: 'input', text: lines.join('\n') };
  }
  const text = await ask(rl, '> ');
  return { kind: 'input', text };
}

async function promptConfirm(
  rl: Interface,
  output: NodeJS.WritableStream,
  req: InteractionRequest,
): Promise<InteractionAnswer> {
  const yes = req.confirmLabel ?? '确定';
  const no = req.cancelLabel ?? '取消';
  output.write(`\n? ${req.prompt}\n`);
  const raw = (await ask(rl, `  [y=${yes} / n=${no}] (y/n): `)).trim().toLowerCase();
  const confirmed = raw === 'y' || raw === 'yes' || raw === '是';
  return { kind: 'confirm', confirmed };
}
