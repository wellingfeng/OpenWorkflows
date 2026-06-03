/**
 * Compact tool-call subjects for collapsed rows while keeping raw details for
 * expanded panels/copy. Main case: Windows shell wrappers around the real cmd.
 */

const POWERSHELL_FLAGS = new Set(['-command', '-c']);
const CMD_FLAGS = new Set(['/c', '/k']);

type ShellKind = 'powershell' | 'cmd' | 'posix';

export function toolSubjectAllowsFileRefs(name: string): boolean {
  return !/^(bash|shell|command_?execution|exec|run|terminal|powershell)$/i.test(
    name.trim(),
  );
}

export function compactToolSubject(_name: string, subject: string): string {
  const oneLine = subject.replace(/[\r\n]+/g, ' ').trim();
  if (!oneLine) return '';
  return unwrapShellCommand(oneLine) ?? oneLine;
}

function unwrapShellCommand(command: string): string | null {
  const tokens = tokenizeCommand(command);
  if (tokens.length < 2) return null;

  const shell = shellKind(tokens[0]);
  if (!shell) return null;

  if (shell === 'powershell') {
    for (let i = 1; i < tokens.length; i++) {
      if (POWERSHELL_FLAGS.has(tokens[i].toLowerCase())) {
        return cleanInnerCommand(tokens.slice(i + 1).join(' ')) || null;
      }
    }
    return null;
  }

  if (shell === 'cmd') {
    for (let i = 1; i < tokens.length; i++) {
      if (CMD_FLAGS.has(tokens[i].toLowerCase())) {
        return cleanInnerCommand(tokens.slice(i + 1).join(' ')) || null;
      }
    }
    return null;
  }

  for (let i = 1; i < tokens.length; i++) {
    const flag = tokens[i];
    if (flag.startsWith('-') && flag.includes('c')) {
      let start = i + 1;
      if (tokens[start] === '--') start++;
      return cleanInnerCommand(tokens[start] ?? '') || null;
    }
  }

  return null;
}

function shellKind(exe: string): ShellKind | null {
  const base = exe.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
  if (
    base === 'pwsh' ||
    base.endsWith('pwsh.exe') ||
    base === 'powershell' ||
    base.endsWith('powershell.exe')
  ) {
    return 'powershell';
  }
  if (base === 'cmd' || base.endsWith('cmd.exe')) return 'cmd';
  if (
    base === 'bash' ||
    base.endsWith('bash.exe') ||
    base === 'sh' ||
    base.endsWith('sh.exe') ||
    base === 'zsh' ||
    base.endsWith('zsh.exe') ||
    base === 'fish' ||
    base.endsWith('fish.exe')
  ) {
    return 'posix';
  }
  return null;
}

function cleanInnerCommand(command: string): string {
  let out = command.trim();
  out = out.replace(/^&\s+/, '').trim();
  const block = out.match(/^\{\s*([\s\S]*?)\s*\}$/);
  if (block) out = block[1].trim();
  return out;
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  const push = () => {
    if (current) {
      tokens.push(current);
      current = '';
    }
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      if (
        quote === '"' &&
        ch === '\\' &&
        i + 1 < command.length &&
        (command[i + 1] === '"' || command[i + 1] === '\\')
      ) {
        current += command[i + 1];
        i++;
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      push();
      continue;
    }
    current += ch;
  }

  push();
  return tokens;
}
