/**
 * Tiny IRGraph shape assertion, factored out so both `format.ts` and `yaml.ts`
 * can use it without a circular import. Pure Node.
 */
import type { IRGraph } from '../../src/core/ir';
import { CliError } from './fs';

/** Assert a value has the minimal IRGraph shape (exit code 3 on failure). */
export function assertGraphShapeLite(g: unknown): asserts g is IRGraph {
  const obj = g as Partial<IRGraph> | null;
  if (!obj || typeof obj !== 'object') {
    throw new CliError('Invalid IRGraph: not an object', 3);
  }
  if (typeof obj.version !== 'number') {
    throw new CliError("Invalid IRGraph: missing 'version'", 3);
  }
  if (!obj.meta || typeof obj.meta !== 'object') {
    throw new CliError("Invalid IRGraph: missing 'meta'", 3);
  }
  if (!Array.isArray(obj.nodes)) {
    throw new CliError("Invalid IRGraph: 'nodes' must be an array", 3);
  }
  if (!Array.isArray(obj.edges)) {
    throw new CliError("Invalid IRGraph: 'edges' must be an array", 3);
  }
}
