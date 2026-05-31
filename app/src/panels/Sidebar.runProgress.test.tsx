import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type SessionKey = {
  workspaceId: string | null;
  sessionId: string | null;
};

type MockSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt?: number;
  preview?: string;
  isWorkflow: boolean;
  runStatus?: 'success' | 'error' | 'interrupted';
};

type MockWorkspace = {
  id: string;
  path: string;
  name: string;
  updatedAt: number;
  sessionCount: number;
  lastActiveSessionId: string | null;
};

type MockStoreState = {
  locale: 'zh-CN' | 'en-US';
  mode: 'design' | 'running';
  sessions: MockSession[];
  workspaces: MockWorkspace[];
  sessionTree: Record<string, MockSession[]>;
  activeWorkspaceId: string | null;
  activeSessionId: string | null;
  runningSessions: SessionKey[];
  runningSessionProgress: Record<
    string,
    { completed: number; incomplete: number; percent: number | null }
  >;
  aiEditingSessions: SessionKey[];
  newWorkflow: () => void;
  selectSession: (sessionId: string, workspaceId?: string) => void;
  setWorkflow: () => void;
  markSaved: () => void;
};

let mockState: MockStoreState;

vi.mock('@/store/useStore', () => {
  const useStore = vi.fn((selector: (state: MockStoreState) => unknown) =>
    selector(mockState),
  );

  return {
    isActiveAiEditingSession: (
      state: Pick<
        MockStoreState,
        'activeWorkspaceId' | 'activeSessionId' | 'aiEditingSessions'
      >,
    ) =>
      state.aiEditingSessions.some(
        (item) =>
          item.workspaceId === state.activeWorkspaceId &&
          item.sessionId === state.activeSessionId,
      ),
    isWorkflowReadOnly: (state: Pick<MockStoreState, 'mode'>) =>
      state.mode === 'running',
    sessionLiveStatus: (
      sessionKey: SessionKey,
      liveState: Pick<
        MockStoreState,
        'runningSessions' | 'aiEditingSessions'
      >,
    ) => {
      const isMatch = (item: SessionKey) =>
        item.workspaceId === sessionKey.workspaceId &&
        item.sessionId === sessionKey.sessionId;
      if (liveState.runningSessions.some(isMatch)) return 'running';
      if (liveState.aiEditingSessions.some(isMatch)) return 'aiEditing';
      return null;
    },
    useStore,
    workflowSessionKeyId: (sessionKey: SessionKey) =>
      `${sessionKey.workspaceId ?? ''}::${sessionKey.sessionId ?? ''}`,
  };
});

vi.mock('@/lib/useResizableWidth', () => ({
  useResizableWidth: () => ({
    width: 240,
    onResizeStart: vi.fn(),
  }),
}));

vi.mock('@/lib/persist', () => ({
  openWorkflow: vi.fn(async () => null),
}));

vi.mock('./SettingsModal', () => ({
  default: () => null,
}));

import Sidebar from './Sidebar';

const WORKSPACE: MockWorkspace = {
  id: 'ws_test',
  path: 'E:\\OpenWorkflow',
  name: 'OpenWorkflow',
  updatedAt: 1_700_000_000_000,
  sessionCount: 1,
  lastActiveSessionId: 's_workflow',
};

const SESSION: MockSession = {
  id: 's_workflow',
  title: 'Workflow run',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  preview: 'preview',
  isWorkflow: true,
};

const SESSION_KEY: SessionKey = {
  workspaceId: WORKSPACE.id,
  sessionId: SESSION.id,
};

function resetSidebarStore(): void {
  mockState = {
    locale: 'zh-CN',
    mode: 'design',
    sessions: [SESSION],
    workspaces: [WORKSPACE],
    sessionTree: { [WORKSPACE.id]: [SESSION] },
    activeWorkspaceId: WORKSPACE.id,
    activeSessionId: SESSION.id,
    runningSessions: [],
    runningSessionProgress: {},
    aiEditingSessions: [],
    newWorkflow: vi.fn(),
    selectSession: vi.fn(),
    setWorkflow: vi.fn(),
    markSaved: vi.fn(),
  };
}

async function renderSidebar(): Promise<{
  container: HTMLDivElement;
  rerender: () => Promise<void>;
  cleanup: () => Promise<void>;
}> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  const rerender = async () => {
    await act(async () => {
      root.render(<Sidebar />);
    });
  };

  await rerender();

  return {
    container,
    rerender,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function runningDot(
  container: HTMLElement,
  percent: number,
): HTMLElement | null {
  return container.querySelector(
    `[data-status="running"][title="正在运行，进度 ${percent}%"]`,
  );
}

function statusDot(
  container: HTMLElement,
  status: 'none' | 'running' | 'aiEditing' | 'success' | 'error' | 'interrupted',
): HTMLElement | null {
  return container.querySelector(`[data-status="${status}"]`);
}

function statusIndicator(dot: HTMLElement | null): HTMLElement | null {
  return dot?.querySelector<HTMLElement>('.owf-status-indicator') ?? null;
}

function newWorkflowButton(container: HTMLElement): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((item) =>
    item.textContent?.includes('新建 Workflow'),
  );
  expect(button).toBeInstanceOf(HTMLButtonElement);
  return button as HTMLButtonElement;
}

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '';
  resetSidebarStore();
});

describe('Sidebar running progress dot', () => {
  it('keeps the running indicator green and spinning while progress changes', async () => {
    resetSidebarStore();
    mockState.runningSessions = [SESSION_KEY];
    mockState.runningSessionProgress = {
      [WORKSPACE.id + '::' + SESSION.id]: {
        completed: 0,
        incomplete: 2,
        percent: 0,
      },
    };

    const view = await renderSidebar();

    try {
      const zeroDot = runningDot(view.container, 0);
      expect(zeroDot).not.toBeNull();
      const zeroSpinner = statusIndicator(zeroDot);
      expect(zeroSpinner).not.toBeNull();
      expect(zeroSpinner?.classList.contains('owf-status-spinner')).toBe(true);

      mockState.runningSessionProgress = {
        [WORKSPACE.id + '::' + SESSION.id]: {
          completed: 2,
          incomplete: 0,
          percent: 100,
        },
      };
      await view.rerender();

      const completeDot = runningDot(view.container, 100);
      expect(completeDot).not.toBeNull();
      expect(completeDot?.getAttribute('title')).toBe('正在运行，进度 100%');
      const completeSpinner = statusIndicator(completeDot);
      expect(completeSpinner).not.toBeNull();
      expect(completeSpinner?.classList.contains('owf-status-spinner')).toBe(true);
      expect(statusDot(view.container, 'success')).toBeNull();
    } finally {
      await view.cleanup();
    }
  });

  it('reserves a fixed status slot when a session has no status', async () => {
    resetSidebarStore();
    const view = await renderSidebar();

    try {
      const button = Array.from(view.container.querySelectorAll('button')).find(
        (item) => item.textContent?.includes(SESSION.title),
      );
      expect(button).toBeInstanceOf(HTMLButtonElement);
      const emptySlot = (button as HTMLButtonElement).querySelector(
        '[data-status="none"]',
      );
      expect(emptySlot).not.toBeNull();
      expect(emptySlot?.classList.contains('owf-status-slot')).toBe(true);
      expect(statusIndicator(emptySlot as HTMLElement)).toBeNull();
    } finally {
      await view.cleanup();
    }
  });

  it.each([
    ['success', '已完成', 'var(--status-success)'],
    ['error', '已失败', 'var(--status-error)'],
    ['interrupted', '已中断', 'var(--status-interrupted)'],
  ] as const)('renders the %s terminal status indicator', async (status, label, color) => {
    resetSidebarStore();
    mockState.sessionTree = {
      [WORKSPACE.id]: [{ ...SESSION, runStatus: status }],
    };
    mockState.sessions = [{ ...SESSION, runStatus: status }];

    const view = await renderSidebar();

    try {
      const dot = statusDot(view.container, status);
      expect(dot).not.toBeNull();
      expect(dot?.getAttribute('title')).toBe(label);
      const indicator = statusIndicator(dot);
      expect(indicator).not.toBeNull();
      expect(indicator?.classList.contains('owf-status-spinner')).toBe(false);
      expect(indicator?.style.getPropertyValue('--owf-status-color')).toBe(
        color,
      );
    } finally {
      await view.cleanup();
    }
  });

  it('keeps the new workflow action enabled while the active workflow is running', async () => {
    resetSidebarStore();
    mockState.mode = 'running';
    mockState.runningSessions = [SESSION_KEY];

    const view = await renderSidebar();

    try {
      const button = newWorkflowButton(view.container);
      expect(button.disabled).toBe(false);

      await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(mockState.newWorkflow).toHaveBeenCalledTimes(1);
    } finally {
      await view.cleanup();
    }
  });

  it('keeps the new workflow action enabled during an active AI blueprint edit', async () => {
    resetSidebarStore();
    mockState.aiEditingSessions = [SESSION_KEY];

    const view = await renderSidebar();

    try {
      const button = newWorkflowButton(view.container);
      expect(button.disabled).toBe(false);

      await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(mockState.newWorkflow).toHaveBeenCalledTimes(1);
    } finally {
      await view.cleanup();
    }
  });
});
