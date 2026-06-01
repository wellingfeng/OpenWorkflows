import { useEffect, useMemo, useState } from 'react';
import { isWorkflowReadOnly, useStore } from '@/store/useStore';
import AutoTextarea from '@/components/AutoTextarea';
import type {
  ConsensusStrategy,
  GatewaySelection,
  IRAgentSpec,
  IRNode,
  NodeGatewayOverride,
  NodeType,
} from '@/core/ir';
import { assessConsensusFit, defaultConsensusLenses } from '@/core/consensusHeuristic';
import { isNumberedWorkflowNode } from '@/core/nodeNumbers';
import { autoSuggestEnabled } from '@/lib/consensusSettings';
import { readStartUserInputs } from '@/core/startInputs';
import { primeCliRuntime, subscribeCliRuntime } from '@/lib/cliConfig';
import { t, type Locale } from '@/lib/i18n';
import { nodeGatewayOverride } from '@/lib/modelGateway/modelGateway';
import {
  listGatewayRunOptions,
  mergeGatewaySelection,
  selectionFromKey,
  selectionKey,
  workflowDefaultGatewaySelection,
  workflowGatewaySelection,
} from '@/lib/modelGateway/resolver';
import type { GatewayRunOption } from '@/lib/modelGateway/types';

/**
 * CONTRACT: default export, no props. Node-properties editor surfaced by
 * PromptPanel when `selectedNodeId` is non-empty.
 *
 * Edits go directly to the store via `updateNodeLabel` / `updateNodeParams`,
 * so the canvas + emitter pick changes up on the next render. The "删除节点"
 * button calls `removeNode`, which also clears the selection.
 *
 * Per-type field schema (lightweight, matches the params shapes in
 * NODE_DEFAULTS):
 *   agent:     prompt (textarea) · node model/channel override · schema
 *   parallel:  over · prompt
 *   pipeline:  stages (comma list of agent ids — read-only hint)
 *   phase:     title
 *   branch:    condition
 *   loop:      until
 *   workflow:  name
 *   log:       message (msg alias)
 *   variable:  value (json)
 *   codeblock: code (textarea)
 *   start:    user input / requirement history (read-only)
 *   end:      no params
 */

const NODE_TYPE_OPTIONS: { id: NodeType; label: string }[] = [
  { id: 'start', label: 'Start' },
  { id: 'end', label: 'End' },
  { id: 'agent', label: 'Agent' },
  { id: 'parallel', label: 'Parallel' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'consensus', label: 'Consensus' },
  { id: 'phase', label: 'Phase' },
  { id: 'branch', label: 'Branch' },
  { id: 'loop', label: 'Loop' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'log', label: 'Log' },
  { id: 'variable', label: 'Variable' },
  { id: 'codeblock', label: 'CodeBlock' },
];

const fieldLabelClass =
  'mb-1 block text-[10px] font-medium uppercase tracking-wider text-fg-faint';
const textInputClass =
  'w-full rounded-md border border-border bg-panel-2 px-2 py-1.5 text-xs text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-accent disabled:cursor-not-allowed disabled:opacity-60';
/** Class for AutoTextarea — height is managed by the component, not CSS. */
const autoTextareaClass = textInputClass + ' font-mono leading-relaxed';
const selectClass =
  'w-full rounded-md border border-border bg-panel-2 px-2 py-1.5 text-xs text-fg outline-none transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-60';

const INHERIT_WORKFLOW_SELECTION_ID = '';
const INHERIT_GLOBAL_SELECTION_ID = '__inherit_global__';

/** Coerce arbitrary IRNode.params[key] into a string for an <input>/<textarea>. */
function asString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

function gatewayOptionText(option: { label: string; hint?: string }): string {
  return option.hint ? `${option.label} · ${option.hint}` : option.label;
}

function selectableNodeGatewayOptions(
  options: GatewayRunOption[],
  workflowSelection: GatewaySelection,
): GatewayRunOption[] {
  return options.filter(
    (option) => option.selection.adapter === workflowSelection.adapter,
  );
}

function optionMatchesOverride(
  option: GatewayRunOption,
  workflowSelection: GatewaySelection,
  override: NodeGatewayOverride,
): boolean {
  return (
    option.id === selectionKey(mergeGatewaySelection(workflowSelection, override))
  );
}

function currentOverrideOption(
  options: GatewayRunOption[],
  workflowSelection: GatewaySelection,
  override: NodeGatewayOverride,
): GatewayRunOption | undefined {
  return options.find((option) =>
    optionMatchesOverride(option, workflowSelection, override),
  );
}

function fallbackOverrideOption(
  selection: GatewaySelection,
  locale: Locale,
): GatewayRunOption {
  const route = [
    selection.providerId ? `provider=${selection.providerId}` : '',
    selection.channelId ? `channel=${selection.channelId}` : '',
    `model=${selection.modelClass}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    id: selectionKey(selection),
    label: `${t(locale, 'inspector.modelUnavailable')} · ${route}`,
    hint: selection.adapter,
    selection,
    transport: 'simulator',
  };
}

function selectionOptionHint(
  selection: GatewaySelection,
  options: GatewayRunOption[],
  locale: Locale,
): string {
  const option = options.find((candidate) => candidate.id === selectionKey(selection));
  if (option) return gatewayOptionText(option);
  return fallbackOverrideOption(selection, locale).label;
}

function nodeOverrideFromSelection(
  selection: GatewaySelection,
): NodeGatewayOverride {
  return {
    modelClass: selection.modelClass,
    ...(selection.providerId ? { providerId: selection.providerId } : {}),
    ...(selection.channelId ? { channelId: selection.channelId } : {}),
  };
}

function useGatewayRunOptions(): GatewayRunOption[] {
  const [, setGatewayRevision] = useState(0);

  useEffect(() => {
    let mounted = true;
    void primeCliRuntime().finally(() => {
      if (mounted) setGatewayRevision((revision) => revision + 1);
    });
    const unsubscribeCli = subscribeCliRuntime(() =>
      setGatewayRevision((revision) => revision + 1),
    );
    const onGatewayConfigChanged = () =>
      setGatewayRevision((revision) => revision + 1);
    window.addEventListener('owf:gateway-config-changed', onGatewayConfigChanged);
    return () => {
      mounted = false;
      unsubscribeCli();
      window.removeEventListener(
        'owf:gateway-config-changed',
        onGatewayConfigChanged,
      );
    };
  }, []);

  return listGatewayRunOptions();
}

/** Coerce a params value into IRAgentSpec[] (tolerating the legacy string[] form). */
function readSpecs(value: unknown): IRAgentSpec[] {
  if (!Array.isArray(value)) return [];
  return value.map((v): IRAgentSpec =>
    typeof v === 'string' ? { prompt: v } : { prompt: '', ...(v as object) },
  );
}

interface SpecListFieldProps {
  label: string;
  specs: IRAgentSpec[];
  onChange: (specs: IRAgentSpec[]) => void;
  addLabel: string;
  locale: Locale;
  disabled?: boolean;
}

/** Editor for a list of agent specs (parallel branches / pipeline stages). */
function SpecListField({
  label,
  specs,
  onChange,
  addLabel,
  locale,
  disabled = false,
}: SpecListFieldProps) {
  const update = (i: number, patch: Partial<IRAgentSpec>) => {
    const next = specs.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    onChange(next);
  };
  const remove = (i: number) => onChange(specs.filter((_, idx) => idx !== i));
  const add = () => onChange([...specs, { prompt: '' }]);

  return (
    <Field label={label}>
      <div className="flex flex-col gap-2">
        {specs.map((s, i) => (
          <div
            key={i}
            className="flex flex-col gap-1 rounded-md border border-border-soft bg-panel-2 p-2"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] text-fg-faint">#{i + 1}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                disabled={disabled}
                className="text-[11px] text-fg-faint hover:text-accent-4 disabled:cursor-not-allowed disabled:opacity-40"
                title={t(locale, 'inspector.removeSpec')}
              >
                ×
              </button>
            </div>
            <AutoTextarea
              className={autoTextareaClass}
              value={asString(s.prompt)}
              onChange={(v) => update(i, { prompt: v })}
              placeholder={t(locale, 'inspector.subtaskPrompt')}
              disabled={disabled}
              minHeight={56}
            />
            <div className="flex gap-1">
              <input
                className={textInputClass}
                value={asString(s.agentType)}
                onChange={(e) => update(i, { agentType: e.target.value })}
                placeholder="agentType"
                disabled={disabled}
              />
              <input
                className={textInputClass}
                value={asString(s.schema)}
                onChange={(e) => update(i, { schema: e.target.value })}
                placeholder="schema"
                disabled={disabled}
              />
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          disabled={disabled}
          className="rounded-md border border-border bg-panel-2 px-2 py-1 text-[11px] text-fg-dim transition-colors hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
        >
          {addLabel}
        </button>
      </div>
    </Field>
  );
}

function StartInputsDetails({
  inputs,
  locale,
}: {
  inputs: string[];
  locale: Locale;
}) {
  if (inputs.length === 0) {
    return (
      <div className="rounded-md border border-border-soft bg-panel-2 p-2 text-[11px] leading-relaxed text-fg-faint">
        {t(locale, 'inspector.startInputsEmpty')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {inputs.map((input, index) => (
        <div
          key={`${index}-${input.slice(0, 24)}`}
          className="rounded-md border border-border-soft bg-panel-2 p-2"
        >
          <div className="font-mono text-[10px] text-fg-faint">
            #{index + 1}
          </div>
          <div className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-fg-dim">
            {input}
          </div>
        </div>
      ))}
    </div>
  );
}

interface FieldProps {
  label: string;
  children: React.ReactNode;
}

function Field({ label, children }: FieldProps) {
  return (
    <div>
      <label className={fieldLabelClass}>{label}</label>
      {children}
    </div>
  );
}

interface ParamFieldsProps {
  node: IRNode;
  onParam: (patch: Record<string, unknown>) => void;
  onGatewayOverride: (override: NodeGatewayOverride | null) => void;
  workflowSelection: GatewaySelection;
  globalRunSelection: GatewaySelection;
  gatewayOptions: GatewayRunOption[];
  locale: Locale;
  disabled?: boolean;
}

/** Render the type-specific params editor for a single node. */
function ParamFields({
  node,
  onParam,
  onGatewayOverride,
  workflowSelection,
  globalRunSelection,
  gatewayOptions,
  locale,
  disabled = false,
}: ParamFieldsProps) {
  const p = node.params ?? {};
  const override = nodeGatewayOverride(p);
  const workflowSelectionKey = selectionKey(workflowSelection);
  const globalSelectionKey = selectionKey(globalRunSelection);
  const showGlobalInherit = globalSelectionKey !== workflowSelectionKey;
  const selectableGatewayOptions = selectableNodeGatewayOptions(
    gatewayOptions,
    workflowSelection,
  );
  const selectedGatewayOption = override
    ? currentOverrideOption(
        selectableGatewayOptions,
        workflowSelection,
        override,
      )
    : undefined;
  const selectedGatewaySelection =
    selectedGatewayOption?.selection ??
    (override ? mergeGatewaySelection(workflowSelection, override) : null);
  const selectedSelectionKey = selectedGatewaySelection
    ? selectionKey(selectedGatewaySelection)
    : workflowSelectionKey;
  const selectedGatewayValue = !override
    ? INHERIT_WORKFLOW_SELECTION_ID
    : showGlobalInherit && selectedSelectionKey === globalSelectionKey
      ? INHERIT_GLOBAL_SELECTION_ID
      : selectedSelectionKey;
  const actualModelSelectOptions =
    override &&
    selectedGatewaySelection &&
    !selectableGatewayOptions.some((option) => option.id === selectedSelectionKey)
      ? [
          fallbackOverrideOption(selectedGatewaySelection, locale),
          ...selectableGatewayOptions,
        ]
      : selectableGatewayOptions;
  const modelSelectOptions = [
    {
      id: INHERIT_WORKFLOW_SELECTION_ID,
      label: t(locale, 'inspector.modelInheritWorkflow'),
      hint: selectionOptionHint(workflowSelection, gatewayOptions, locale),
    },
    ...(showGlobalInherit
      ? [
          {
            id: INHERIT_GLOBAL_SELECTION_ID,
            label: t(locale, 'inspector.modelInheritGlobal'),
            hint: selectionOptionHint(globalRunSelection, gatewayOptions, locale),
          },
        ]
      : []),
    ...actualModelSelectOptions,
  ];

  switch (node.type) {
    case 'agent':
      return (
        <>
          <Field label="Prompt">
            <AutoTextarea
              className={autoTextareaClass}
              value={asString(p.prompt)}
              onChange={(v) => onParam({ prompt: v })}
              placeholder={t(locale, 'inspector.agentPromptPlaceholder')}
              disabled={disabled}
            />
          </Field>
          <Field label="Agent Type">
            <input
              className={textInputClass}
              value={asString(p.agentType ?? p.agent)}
              onChange={(e) => onParam({ agentType: e.target.value })}
              placeholder={t(locale, 'inspector.agentTypePlaceholder')}
              disabled={disabled}
            />
          </Field>
          <Field label={t(locale, 'inspector.modelField')}>
            <select
              className={selectClass}
              value={selectedGatewayValue}
              onChange={(e) => {
                if (e.target.value === INHERIT_WORKFLOW_SELECTION_ID) {
                  onGatewayOverride(null);
                  return;
                }
                if (e.target.value === INHERIT_GLOBAL_SELECTION_ID) {
                  onGatewayOverride(nodeOverrideFromSelection(globalRunSelection));
                  return;
                }
                const selection = selectionFromKey(e.target.value);
                if (selection) {
                  onGatewayOverride(nodeOverrideFromSelection(selection));
                }
              }}
              disabled={disabled}
            >
              {modelSelectOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {gatewayOptionText(option)}
                </option>
              ))}
            </select>
            <div className="mt-1 text-[10px] leading-relaxed text-fg-faint">
              {t(locale, 'inspector.modelInheritHelp')}
            </div>
          </Field>
          <Field label={t(locale, 'inspector.schemaLabel')}>
            <input
              className={textInputClass}
              value={asString(p.schema)}
              onChange={(e) => onParam({ schema: e.target.value })}
              placeholder={t(locale, 'inspector.schemaPlaceholder')}
              disabled={disabled}
            />
          </Field>
        </>
      );

    case 'parallel':
      return (
        <SpecListField
          label={t(locale, 'inspector.branchesLabel')}
          specs={readSpecs(p.branches)}
          onChange={(branches) => onParam({ branches })}
          addLabel={t(locale, 'inspector.addBranch')}
          locale={locale}
          disabled={disabled}
        />
      );

    case 'pipeline':
      return (
        <>
          <Field label={t(locale, 'inspector.itemsLabel')}>
            <input
              className={textInputClass}
              value={asString(p.items) || 'args'}
              onChange={(e) => onParam({ items: e.target.value })}
              placeholder={t(locale, 'inspector.itemsPlaceholder')}
              disabled={disabled}
            />
          </Field>
          <SpecListField
            label={t(locale, 'inspector.stagesLabel')}
            specs={readSpecs(p.stages)}
            onChange={(stages) => onParam({ stages })}
            addLabel={t(locale, 'inspector.addStage')}
            locale={locale}
            disabled={disabled}
          />
        </>
      );

    case 'consensus': {
      const strategy = (p.strategy as ConsensusStrategy) ?? 'multi-lens';
      return (
        <>
          <Field label={t(locale, 'inspector.strategyLabel')}>
            <select
              className={selectClass}
              value={strategy}
              onChange={(e) => onParam({ strategy: e.target.value })}
              disabled={disabled}
            >
              <option value="multi-lens">
                {t(locale, 'inspector.strategyMultiLens')}
              </option>
              <option value="adversarial">
                {t(locale, 'inspector.strategyAdversarial')}
              </option>
              <option value="tournament">
                {t(locale, 'inspector.strategyTournament')}
              </option>
              <option value="self-consistency">
                {t(locale, 'inspector.strategySelfConsistency')}
              </option>
            </select>
          </Field>
          <SpecListField
            label={t(locale, 'inspector.votersLabel')}
            specs={readSpecs(p.voters)}
            onChange={(voters) => onParam({ voters })}
            addLabel={t(locale, 'inspector.addVoter')}
            locale={locale}
            disabled={disabled}
          />
          {strategy === 'self-consistency' && (
            <Field label={t(locale, 'inspector.samplesLabel')}>
              <input
                type="number"
                min={2}
                max={7}
                className={textInputClass}
                value={asString(p.samples ?? 3)}
                onChange={(e) => onParam({ samples: Number(e.target.value) || 3 })}
                disabled={disabled}
              />
            </Field>
          )}
          <Field label={t(locale, 'inspector.quorumLabel')}>
            <input
              type="number"
              min={1}
              className={textInputClass}
              value={asString(p.quorum ?? '')}
              onChange={(e) =>
                onParam({ quorum: e.target.value ? Number(e.target.value) : undefined })
              }
              disabled={disabled}
            />
          </Field>
          <Field label={t(locale, 'inspector.schemaLabel')}>
            <input
              className={textInputClass}
              value={asString(p.schema)}
              onChange={(e) => onParam({ schema: e.target.value })}
              placeholder={t(locale, 'inspector.schemaPlaceholder')}
              disabled={disabled}
            />
          </Field>
          <div className="text-[11px] leading-relaxed text-fg-faint">
            {t(locale, 'inspector.consensusHint')}
          </div>
        </>
      );
    }

    case 'phase':
      return (
        <Field label="Title">
          <input
            className={textInputClass}
            value={asString(p.title)}
            onChange={(e) => onParam({ title: e.target.value })}
            placeholder={t(locale, 'inspector.phaseName')}
            disabled={disabled}
          />
        </Field>
      );

    case 'branch':
      return (
        <>
          <Field label={t(locale, 'inspector.ifCondition')}>
            <input
              className={textInputClass}
              value={asString(p.condition)}
              onChange={(e) => onParam({ condition: e.target.value })}
              placeholder={t(locale, 'inspector.conditionPlaceholder')}
              disabled={disabled}
            />
          </Field>
          <div className="text-[11px] text-fg-faint">
            {t(locale, 'inspector.branchHelp')}
          </div>
        </>
      );

    case 'loop':
      return (
        <>
          <Field label={t(locale, 'inspector.whileCondition')}>
            <input
              className={textInputClass}
              value={asString(p.condition ?? p.until)}
              onChange={(e) => onParam({ condition: e.target.value })}
              placeholder={t(locale, 'inspector.loopPlaceholder')}
              disabled={disabled}
            />
          </Field>
          <div className="text-[11px] text-fg-faint">
            {t(locale, 'inspector.loopHelp')}
          </div>
        </>
      );

    case 'workflow':
      return (
        <Field label="Name">
          <input
            className={textInputClass}
            value={asString(p.name)}
            onChange={(e) => onParam({ name: e.target.value })}
            placeholder={t(locale, 'inspector.workflowName')}
            disabled={disabled}
          />
        </Field>
      );

    case 'log': {
      // Accept both `message` (NODE_DEFAULTS) and legacy `msg` aliases.
      const key = 'message' in p ? 'message' : 'msg' in p ? 'msg' : 'message';
      return (
        <Field label="Message">
          <input
            className={textInputClass}
            value={asString(p[key])}
            onChange={(e) => onParam({ [key]: e.target.value })}
            placeholder={t(locale, 'inspector.logMessage')}
            disabled={disabled}
          />
        </Field>
      );
    }

    case 'variable':
      return (
        <Field label="Value (JSON)">
          <AutoTextarea
            className={autoTextareaClass}
            value={asString(p.value)}
            onChange={(raw) => {
              // Try to parse JSON; fall back to raw string so the field is
              // always editable even mid-typing.
              try {
                onParam({ value: JSON.parse(raw) });
              } catch {
                onParam({ value: raw });
              }
            }}
            placeholder='"hello" / 42 / { "k": 1 }'
            disabled={disabled}
          />
        </Field>
      );

    case 'codeblock':
      return (
        <Field label="Code">
          <AutoTextarea
            className={autoTextareaClass}
            value={asString(p.code)}
            onChange={(v) => onParam({ code: v })}
            placeholder="// code"
            disabled={disabled}
            maxHeight={360}
          />
        </Field>
      );

    case 'start': {
      const inputs = readStartUserInputs(p);
      const label =
        inputs.length > 0
          ? `${t(locale, 'inspector.startInputsLabel')} (${inputs.length})`
          : t(locale, 'inspector.startInputsLabel');
      return (
        <>
          <Field label={label}>
            <StartInputsDetails inputs={inputs} locale={locale} />
          </Field>
          <div className="text-[11px] text-fg-faint">
            {t(locale, 'inspector.startInputsHelp')}
          </div>
        </>
      );
    }

    case 'end':
    default:
      return (
        <div className="text-[11px] text-fg-faint">
          {t(locale, 'inspector.noParams')}
        </div>
      );
  }
}

export default function NodeInspector() {
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const locale = useStore((s) => s.locale);
  const workflow = useStore((s) => s.workflow);
  const nodes = workflow.nodes;
  const workflowSelection = workflowDefaultGatewaySelection(workflow);
  const globalRunSelection = workflowGatewaySelection(workflow);
  const updateNodeLabel = useStore((s) => s.updateNodeLabel);
  const updateNodeParams = useStore((s) => s.updateNodeParams);
  const updateNodeGatewayOverride = useStore((s) => s.updateNodeGatewayOverride);
  const removeNode = useStore((s) => s.removeNode);
  const addNode = useStore((s) => s.addNode);
  const selectNode = useStore((s) => s.selectNode);
  const readOnly = useStore((s) => isWorkflowReadOnly(s));
  const gatewayOptions = useGatewayRunOptions();

  const node = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  if (!node) {
    return (
      <div className="text-xs text-fg-dim">
        {t(locale, 'inspector.selectedNode')}
        <span className="font-mono text-fg">{selectedNodeId}</span>
        <div className="mt-1 text-fg-faint">
          {t(locale, 'inspector.nodeDeleted')}
        </div>
      </div>
    );
  }

  /**
   * Changing a node's type is destructive (params shape differs per type),
   * so we keep the IRGraph consistent by deleting the current node and
   * adding a fresh one of the new type, preserving the label.
   */
  const handleTypeChange = (nextType: NodeType) => {
    if (readOnly) return;
    if (nextType === node.type) return;
    const label = node.label;
    const parent = node.parent;
    removeNode(node.id);
    const newId = addNode(nextType, undefined, parent);
    if (!newId) return;
    if (label) updateNodeLabel(newId, label);
    selectNode(newId);
  };

  /**
   * Upgrade a plain agent node into a consensus node, seeding differentiated lens
   * voters from its prompt. The free heuristic (assessConsensusFit) only suggests
   * this — the user decides — so consensus stays a visible, first-class node.
   */
  const convertToConsensus = (strategy: ConsensusStrategy) => {
    if (readOnly) return;
    const prompt = String(node.params.prompt ?? node.label ?? '');
    const label = node.label;
    const parent = node.parent;
    removeNode(node.id);
    const newId = addNode(
      'consensus',
      { strategy, voters: defaultConsensusLenses(prompt) },
      parent,
    );
    if (!newId) return;
    if (label) updateNodeLabel(newId, label);
    selectNode(newId);
  };

  const consensusFit =
    node.type === 'agent' && !readOnly && autoSuggestEnabled()
      ? assessConsensusFit(node, workflow)
      : { fit: false as const, strategy: 'multi-lens' as ConsensusStrategy, reason: '' };

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-fg-faint">{node.id}</span>
      </div>

      {isNumberedWorkflowNode(node) && (
        <Field label={t(locale, 'inspector.numberLabel')}>
          <div className="w-full rounded-md border border-border bg-panel-2 px-2 py-1.5 font-mono text-xs text-fg-dim">
            #{node.numberLabel ?? '-'}
          </div>
        </Field>
      )}

      <Field label="Label">
        <input
          className={textInputClass}
          value={node.label ?? ''}
          onChange={(e) => updateNodeLabel(node.id, e.target.value)}
          placeholder={t(locale, 'inspector.nodeLabel')}
          disabled={readOnly}
        />
      </Field>

      <Field label="Type">
        <select
          className={selectClass}
          value={node.type}
          onChange={(e) => handleTypeChange(e.target.value as NodeType)}
          disabled={readOnly}
        >
          {NODE_TYPE_OPTIONS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>

      <div className="my-1 border-t border-border-soft" />

      {consensusFit.fit && (
        <div
          className="rounded-md border px-2 py-2 text-[11px] leading-relaxed"
          style={{
            borderColor: 'var(--accent-2)',
            background: 'var(--bg-alt)',
            color: 'var(--fg-dim)',
          }}
        >
          <div className="mb-1">⚖ {t(locale, 'inspector.consensusSuggest')}</div>
          <button
            type="button"
            onClick={() => convertToConsensus(consensusFit.strategy)}
            className="rounded-md border border-border bg-panel-2 px-2 py-1 text-[11px] text-fg-dim transition-colors hover:border-accent hover:text-fg"
          >
            {t(locale, 'inspector.convertToConsensus')}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <ParamFields
          node={node}
          locale={locale}
          onParam={(patch) => updateNodeParams(node.id, patch)}
          onGatewayOverride={(override) =>
            updateNodeGatewayOverride(node.id, override)
          }
          workflowSelection={workflowSelection}
          globalRunSelection={globalRunSelection}
          gatewayOptions={gatewayOptions}
          disabled={readOnly}
        />
      </div>

      <div className="mt-2 border-t border-border-soft pt-3">
        <button
          type="button"
          onClick={() => removeNode(node.id)}
          disabled={readOnly}
          className="w-full rounded-md border border-border bg-panel-2 px-2 py-1.5 text-xs text-accent-4 transition-colors hover:border-accent-4 hover:bg-border-soft disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t(locale, 'inspector.deleteNode')}
        </button>
      </div>
    </div>
  );
}
