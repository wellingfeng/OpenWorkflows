import { afterEach, describe, expect, it } from 'vitest';
import { defaultBlueprint } from '@/core/defaultBlueprint';
import { EXEC, type IRGraph } from '@/core/ir';
import {
  isWorkflowReadOnly,
  sessionLiveStatus,
  useStore,
  workflowReadOnlyReason,
  type WorkflowSessionKey,
} from './useStore';

const ACTIVE_SESSION_KEY: WorkflowSessionKey = {
  workspaceId: null,
  sessionId: 's_test',
};

function cloneGraph(graph: IRGraph): IRGraph {
  return JSON.parse(JSON.stringify(graph)) as IRGraph;
}

function resetStore(
  mode: 'design' | 'running',
  aiEditing: boolean,
): IRGraph {
  const workflow = defaultBlueprint('Locked workflow');
  useStore.setState({
    workflow: cloneGraph(workflow),
    selectedNodeId: 'n_step1',
    mode,
    aiStreaming: false,
    aiEditingSessions: aiEditing ? [ACTIVE_SESSION_KEY] : [],
    dirty: false,
    currentFilePath: null,
    runState: {},
    runOutputs: {},
    lastRunFailedNodeId: null,
    runningSessionProgress: {},
    composerDraft: '',
    composerDrafts: {},
    activeSessionId: ACTIVE_SESSION_KEY.sessionId,
    activeWorkspaceId: ACTIVE_SESSION_KEY.workspaceId,
    historyReady: false,
  });
  return workflow;
}

function readOnlyState(
  mode: 'design' | 'running',
  aiEditingSessions: WorkflowSessionKey[] = [],
) {
  return {
    mode,
    activeWorkspaceId: ACTIVE_SESSION_KEY.workspaceId,
    activeSessionId: ACTIVE_SESSION_KEY.sessionId,
    aiEditingSessions,
  };
}

function workflowSnapshot(): string {
  return JSON.stringify(useStore.getState().workflow);
}

function tryEveryPublicWorkflowWrite(): void {
  const store = useStore.getState();
  const replacement = defaultBlueprint('Replacement workflow');

  expect(store.addNode('log')).toBe('');
  store.updateNodeLabel('n_step1', 'Changed label');
  store.updateNodeParams('n_step1', { prompt: 'Changed prompt' });
  store.removeNode('n_step1');
  expect(
    store.addEdge(
      { node: 'n_start', port: 'exec_out' },
      { node: 'n_end', port: 'exec_in' },
      EXEC,
    ),
  ).toBe('');
  store.removeEdge('e_start_step1');
  store.setNodePosition('n_step1', 999, 999);
  store.setAdapter('gemini');
  store.applyGraphEdit(replacement);
  store.setWorkflow(replacement);
  store.runWorkflow();
}

afterEach(() => {
  resetStore('design', false);
  window.localStorage.clear();
});

describe('workflow read-only guard', () => {
  it('reports running before AI editing when both flags are present', () => {
    expect(workflowReadOnlyReason(readOnlyState('design'))).toBeNull();
    expect(
      workflowReadOnlyReason(readOnlyState('design', [ACTIVE_SESSION_KEY])),
    ).toBe('aiEditing');
    expect(
      workflowReadOnlyReason(
        readOnlyState('design', [{ workspaceId: null, sessionId: 's_other' }]),
      ),
    ).toBeNull();
    expect(workflowReadOnlyReason(readOnlyState('running'))).toBe('running');
    expect(
      workflowReadOnlyReason(readOnlyState('running', [ACTIVE_SESSION_KEY])),
    ).toBe('running');
  });

  it('derives history live status with running priority', () => {
    expect(
      sessionLiveStatus(ACTIVE_SESSION_KEY, {
        runningSessions: [],
        aiEditingSessions: [],
      }),
    ).toBeNull();
    expect(
      sessionLiveStatus(ACTIVE_SESSION_KEY, {
        runningSessions: [],
        aiEditingSessions: [ACTIVE_SESSION_KEY],
      }),
    ).toBe('aiEditing');
    expect(
      sessionLiveStatus(ACTIVE_SESSION_KEY, {
        runningSessions: [ACTIVE_SESSION_KEY],
        aiEditingSessions: [ACTIVE_SESSION_KEY],
      }),
    ).toBe('running');
  });

  it('keeps composer drafts scoped to each workflow session', () => {
    resetStore('design', false);
    useStore.setState({
      activeWorkspaceId: null,
      activeSessionId: 's_a',
      composerDraft: '',
      composerDrafts: {},
    });

    useStore.getState().setComposerDraft('draft for A');
    useStore.getState().selectSession('s_b');

    expect(useStore.getState().composerDraft).toBe('');

    useStore.getState().setComposerDraft('draft for B');
    useStore.getState().selectSession('s_a');

    expect(useStore.getState().composerDraft).toBe('draft for A');

    useStore.getState().selectSession('s_b');

    expect(useStore.getState().composerDraft).toBe('draft for B');
  });

  it.each([
    ['running workflow', 'running', false],
    ['AI blueprint edit', 'design', true],
  ] as const)(
    'blocks public workflow writes during %s',
    (_label, mode, aiEditing) => {
      resetStore(mode, aiEditing);
      const before = workflowSnapshot();

      expect(isWorkflowReadOnly(useStore.getState())).toBe(true);
      tryEveryPublicWorkflowWrite();

      expect(workflowSnapshot()).toBe(before);
      expect(useStore.getState().dirty).toBe(false);
    },
  );

  it('allows creating a new workflow while the current workflow is running', () => {
    resetStore('running', false);

    useStore.getState().newWorkflow();

    const state = useStore.getState();
    const expectedName =
      state.locale === 'en-US' ? 'Untitled Workflow' : '未命名工作流';
    expect(state.mode).toBe('design');
    expect(state.workflow.meta.name).toBe(expectedName);
    expect(state.activeSessionId).not.toBe(ACTIVE_SESSION_KEY.sessionId);
    expect(state.sessions[0]?.id).toBe(state.activeSessionId);
    expect(state.sessions[0]?.title).toBe(expectedName);
    expect(state.selectedNodeId).toBeNull();
    expect(state.runState).toEqual({});
    expect(state.runOutputs).toEqual({});
    expect(state.lastRunFailedNodeId).toBeNull();
    expect(state.dirty).toBe(false);
  });

  it('allows creating a new workflow during an active AI blueprint edit', () => {
    resetStore('design', true);

    useStore.getState().newWorkflow();

    const state = useStore.getState();
    const expectedName =
      state.locale === 'en-US' ? 'Untitled Workflow' : '未命名工作流';
    expect(state.workflow.meta.name).toBe(expectedName);
    expect(state.activeSessionId).not.toBe(ACTIVE_SESSION_KEY.sessionId);
    expect(isWorkflowReadOnly(state)).toBe(false);
    expect(state.sessions[0]?.id).toBe(state.activeSessionId);
    expect(state.sessions[0]?.title).toBe(expectedName);
    expect(state.dirty).toBe(false);
    expect(
      sessionLiveStatus(ACTIVE_SESSION_KEY, {
        runningSessions: [],
        aiEditingSessions: state.aiEditingSessions,
      }),
    ).toBe('aiEditing');
  });
});
