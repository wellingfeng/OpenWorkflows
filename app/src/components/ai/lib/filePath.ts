/**
 * CONTRACT: pure helpers that detect/parse local file references in AI prose.
 *
 *   parseFileRef(s)  -> { path, basename, startLine?, endLine?, col? } | null
 *   looksLikePath(s) -> boolean   (cheap pre-filter before parseFileRef)
 *
 * Recognises the canonical `path:line:column` form plus `#L` anchors and line
 * ranges (`file.ts:10-20`, `file.ts#L10-L20`), and is Windows-drive aware so a
 * leading `C:\...` drive colon is not mistaken for the `:line` delimiter.
 *
 * Heuristics (load-bearing — keep false positives near zero so ordinary prose
 * like "version 2.0" or ratios like "16:9" never render as file chips):
 *   - the path part must contain a path separator OR end in a real-looking
 *     extension (1-8 word chars),
 *   - the whole token must match start-to-end (no partial matches inside words),
 *   - line/column, when present, are pure digits.
 */

export interface FileRef {
  /** The path portion, verbatim (may be relative, absolute, or Windows-style). */
  path: string;
  /** Last path segment, used as the chip label. */
  basename: string;
  /** 1-based start line, when the token carried `:line` / `#Lline`. */
  startLine?: number;
  /** End of a line range, when the token carried `:a-b` / `#La-Lb`. */
  endLine?: number;
  /** 1-based column, when the token carried `:line:col`. */
  col?: number;
}

// path  :  (windows drive prefix | anything not : or #)   then optional :line[:col] or -range or #Lline
const FILE_REF =
  /^([A-Za-z]:[^:#\r\n]*|[^:#\r\n]+?)(?:[:#]L?(\d+)(?:[-:]L?(\d+))?)?$/;

/**
 * Known source/code/config file extensions. A token WITHOUT a path separator
 * must end in one of these to count as a file (so prose like `2.0`, `1.5.0`, or
 * `react.useState` is never mistaken for a path). Tokens WITH a separator are
 * accepted regardless — a slash is itself strong evidence of a path.
 */
const KNOWN_EXT = new Set([
  // web / js / ts
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc', 'html', 'htm',
  'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'astro',
  // backend / systems
  'rs', 'go', 'py', 'rb', 'java', 'kt', 'kts', 'c', 'h', 'cc', 'cpp', 'cxx',
  'hpp', 'cs', 'php', 'swift', 'scala', 'clj', 'ex', 'exs', 'erl', 'dart',
  'lua', 'r', 'sql', 'graphql', 'proto',
  // shell / config / data
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'toml', 'yaml', 'yml',
  'ini', 'cfg', 'conf', 'env', 'lock', 'xml', 'svg', 'csv', 'tsv',
  // docs / misc
  'md', 'mdx', 'txt', 'rst', 'tex', 'log', 'gitignore', 'dockerfile',
  'makefile', 'gradle', 'pen',
]);

function extensionOf(token: string): string | null {
  const noLine = token.split(/[:#]/, 1)[0]; // drop any :line / #L suffix
  const base = noLine.replace(/[\\/]+$/, '');
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

function pathFromFileUrl(raw: string): string | null {
  if (!/^file:\/\//i.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'file:') return null;
    let path = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
    if (url.hostname) path = `//${url.hostname}${path}`;
    if (/^#L?\d/i.test(url.hash)) path += url.hash;
    return path;
  } catch {
    return null;
  }
}

/** Cheap pre-filter: reject obvious non-paths before the precise regex. */
export function looksLikePath(raw: string): boolean {
  const s = raw.trim();
  if (!s || s.length > 240) return false;
  if (/\s/.test(s)) return false; // file refs never contain whitespace
  const fileUrlPath = pathFromFileUrl(s);
  if (fileUrlPath) return looksLikePath(fileUrlPath);
  if (/^[a-z]+:\/\//i.test(s)) return false; // url scheme -> not a file chip
  if (/[\\/]/.test(s)) return true; // a path separator is strong evidence
  // No separator: require a recognised file extension so `2.0` / `react.foo`
  // are not mistaken for files.
  const ext = extensionOf(s);
  return ext != null && KNOWN_EXT.has(ext);
}

function basenameOf(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, '');
  const idx = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'));
  return idx === -1 ? cleaned : cleaned.slice(idx + 1);
}

/**
 * Parse a candidate token into a {@link FileRef}, or return null when it is not
 * a plausible local file reference. The path part must look like a file (see
 * {@link looksLikePath}); a bare word such as `config` is rejected, while
 * `config.ts`, `./config`, or `src/store/useStore.ts:42` are accepted.
 */
export function parseFileRef(raw: string): FileRef | null {
  const s = pathFromFileUrl(raw.trim()) ?? raw.trim();
  if (!looksLikePath(s)) return null;

  const m = FILE_REF.exec(s);
  if (!m) return null;

  const path = m[1];
  // The path on its own must still look like a file (the line/col may have
  // consumed a trailing number, so re-check the captured path part): a
  // separator, or a recognised file extension.
  const hasSep = /[\\/]/.test(path);
  if (!hasSep && !KNOWN_EXT.has(extensionOf(path) ?? '')) return null;

  const basename = basenameOf(path);
  if (!basename) return null; // e.g. "C:\" — nothing to label the chip with

  const startLine = m[2] ? Number(m[2]) : undefined;
  const second = m[3] ? Number(m[3]) : undefined;

  // `a:b:c` => line:col ; `a:b-c` / `a#La-Lb` => line range. We disambiguate by
  // the separator the regex matched: `-` means range, `:`/`#` second means col.
  // The regex collapses both into group 3, so decide from the raw string.
  let endLine: number | undefined;
  let col: number | undefined;
  if (second !== undefined) {
    const tail = s.slice(path.length);
    if (/-/.test(tail)) endLine = second;
    else col = second;
  }

  return {
    path,
    basename,
    startLine,
    endLine,
    col,
  };
}
