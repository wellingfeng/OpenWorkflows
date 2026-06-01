import { EXEC, type IRGraph } from './ir';
import { normalizeWorkflowNodeNumbers } from './nodeNumbers';
import {
  DEFAULT_LOCALE,
  type Locale,
  t,
} from '@/lib/i18n';

/**
 * Placeholder prompt(s) used by the fresh starter agent. `isEmptyWorkflow`
 * treats a graph carrying one of these (or a blank prompt) as "new/empty" so
 * the AI input box frames the instruction as a create rather than an edit.
 *
 * Collected from all supported locales so a default blueprint created in any
 * language is recognised as empty.
 */
export const PLACEHOLDER_PROMPTS: readonly string[] = (() => {
  const prompts = new Set<string>();
  for (const locale of [
    'zh-CN',
    'en-US',
    'fr-FR',
    'ru-RU',
    'es-ES',
    'hi-IN',
    'ar-SA',
    'pt-BR',
    'ja-JP',
    'de-DE',
    'ko-KR',
  ] as const) {
    prompts.add(t(locale as Locale, 'defaultBlueprint.agentPlaceholder'));
    prompts.add(t(locale as Locale, 'defaultBlueprint.agentStep'));
  }
  return [...prompts];
})();

/**
 * CONTRACT: defaultBlueprint(name?, locale?) returns the canonical starter
 * graph used by newWorkflow(). It is a minimal, ready-to-edit spine:
 *
 *   start → agent(placeholder) → end
 *
 * The agent's label and prompt are localised to `locale` (defaults to zh-CN).
 * Two execution edges wire the spine; layout coordinates are pre-placed so the
 * canvas paints a clean left-to-right row. Downstream code relies on the node
 * ids (n_start / n_step1 / n_end), the exec port names (exec_out / exec_in),
 * and the IRGraph shape — keep them stable.
 */
export function defaultBlueprint(
  name?: string,
  locale?: Locale,
): IRGraph {
  const localeCode: Locale = locale ?? DEFAULT_LOCALE;
  const placeholder = t(localeCode, 'defaultBlueprint.agentPlaceholder');
  const workflowName =
    name ?? t(localeCode, 'defaultBlueprint.untitledWorkflow');
  return normalizeWorkflowNodeNumbers({
    version: 1,
    meta: {
      name: workflowName,
      adapter: 'claude-code',
      gateway: { defaults: { adapter: 'claude-code', modelClass: 'sonnet' } },
    },
    nodes: [
      {
        id: 'n_start',
        type: 'start',
        label: 'Start',
        params: { userInputs: [] },
      },
      {
        id: 'n_step1',
        type: 'agent',
        label: placeholder,
        params: {
          prompt: placeholder,
        },
      },
      {
        id: 'n_end',
        type: 'end',
        label: 'End',
        params: {},
      },
    ],
    edges: [
      {
        id: 'e_start_step1',
        from: { node: 'n_start', port: 'exec_out' },
        to: { node: 'n_step1', port: 'exec_in' },
        kind: EXEC,
      },
      {
        id: 'e_step1_end',
        from: { node: 'n_step1', port: 'exec_out' },
        to: { node: 'n_end', port: 'exec_in' },
        kind: EXEC,
      },
    ],
    layout: {
      n_start: { x: 0, y: 160 },
      n_step1: { x: 240, y: 160 },
      n_end: { x: 480, y: 160 },
    },
  });
}
