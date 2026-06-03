import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AIDock from './AIDock';
import PromptPanel from './PromptPanel';
import { defaultBlueprint, simpleBlueprint } from '@/core/defaultBlueprint';
import { defaultComposer, samplePromptGroups } from '@/store/sampleSessions';
import type { Message } from '@/store/types';
import { useStore } from '@/store/useStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function resetStoreForPromptLock(
  mode: 'design' | 'running',
  composerDraft = '',
  composerFocusVersion = 0,
): void {
  useStore.setState({
    mode,
    workflow: defaultBlueprint('Prompt lock workflow'),
    selectedNodeId: null,
    aiStreaming: false,
    aiEditingSessions: [],
    chattingSessions: [],
    locale: 'zh-CN',
    promptAutoTranslate: false,
    promptGroups: samplePromptGroups,
    composer: defaultComposer,
    composerDraft,
    composerDrafts: {},
    composerFocusVersion,
    messages: [],
    activeWorkspaceId: null,
    activeSessionId: 's_prompt',
    workspaceHistory: [],
    runningSessionProgress: {},
  });
}

async function renderPanels(): Promise<{
  container: HTMLDivElement;
  cleanup: () => Promise<void>;
}> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  await act(async () => {
    root.render(
      <>
        <AIDock />
        <PromptPanel />
      </>,
    );
  });

  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function renderChatDock(): Promise<{
  container: HTMLDivElement;
  cleanup: () => Promise<void>;
}> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  await act(async () => {
    root.render(<AIDock layout="chat" />);
  });

  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((item) =>
    item.textContent?.includes(text),
  );
  if (!button) throw new Error(`Missing button containing text: ${text}`);
  return button;
}

function aiInput(container: HTMLElement): HTMLTextAreaElement {
  const input = container.querySelector('textarea');
  if (!input) throw new Error('Missing AI input textarea');
  return input;
}

function optionalSearchInput(container: HTMLElement): HTMLInputElement | null {
  return container.querySelector('input[aria-label="搜索 AI 返回内容"]');
}

function searchInput(container: HTMLElement): HTMLInputElement {
  const input = optionalSearchInput(container);
  if (!input) throw new Error('Missing AI return search input');
  return input;
}

function buttonByAriaLabel(
  container: HTMLElement,
  ariaLabel: string,
): HTMLButtonElement {
  const button = container.querySelector(`button[aria-label="${ariaLabel}"]`);
  if (!button) throw new Error(`Missing button with aria-label: ${ariaLabel}`);
  return button as HTMLButtonElement;
}

function sendButton(container: HTMLElement): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((item) =>
    ['↑', '…'].includes(item.textContent?.trim() ?? ''),
  );
  if (!button) throw new Error('Missing AI send button');
  return button;
}

function modelStrategyButton(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector(
    'button[title="模型策略 · AI 自动为每个节点选模型"]',
  );
}

function typeIntoInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '';
});

describe('PromptPanel running lock', () => {
  it('ignores direct append requests while the workflow is running', () => {
    resetStoreForPromptLock('running', 'existing draft', 7);

    useStore.getState().appendComposerDraft('grill-me');

    expect(useStore.getState().composerDraft).toBe('existing draft');
    expect(useStore.getState().composerFocusVersion).toBe(7);
  });

  it('disables prompt entries while keeping other panel controls usable', async () => {
    resetStoreForPromptLock('running', 'existing draft', 7);
    const view = await renderPanels();

    try {
      const editButton = buttonByText(view.container, '编辑');
      const groupToggle = buttonByText(view.container, '互动澄清');
      const promptEntry = buttonByText(view.container, '拷问我');

      expect(editButton.disabled).toBe(false);
      expect(groupToggle.disabled).toBe(false);
      expect(promptEntry.disabled).toBe(true);

      editButton.focus();
      expect(document.activeElement).toBe(editButton);

      await act(async () => {
        promptEntry.click();
      });

      expect(useStore.getState().composerDraft).toBe('existing draft');
      expect(useStore.getState().composerFocusVersion).toBe(7);
      expect(document.activeElement).toBe(editButton);
    } finally {
      await view.cleanup();
    }
  });

  it('keeps design-mode prompt insertion and input focus working', async () => {
    resetStoreForPromptLock('design', 'existing draft', 7);
    const view = await renderPanels();

    try {
      const promptEntry = buttonByText(view.container, '拷问我');
      const input = aiInput(view.container);

      expect(promptEntry.disabled).toBe(false);
      expect(input.disabled).toBe(false);

      await act(async () => {
        promptEntry.click();
      });

      expect(useStore.getState().composerDraft).toBe(
        'existing draft\ngrill-me',
      );
      expect(useStore.getState().composerFocusVersion).toBe(8);
      expect(input.value).toBe('existing draft\ngrill-me');
      expect(document.activeElement).toBe(input);
    } finally {
      await view.cleanup();
    }
  });

  it('shows the model strategy selector for workflow mode', async () => {
    resetStoreForPromptLock('design');
    const view = await renderPanels();

    try {
      expect(modelStrategyButton(view.container)).toBeInstanceOf(
        HTMLButtonElement,
      );
    } finally {
      await view.cleanup();
    }
  });

  it('hides the model strategy selector for simple chat mode', async () => {
    resetStoreForPromptLock('design');
    useStore.setState({
      workflow: simpleBlueprint('Simple chat'),
    });
    const view = await renderPanels();

    try {
      expect(modelStrategyButton(view.container)).toBeNull();
      expect(view.container.textContent).not.toContain('尽量用更好的大模型');
    } finally {
      await view.cleanup();
    }
  });

  it('shows the chat run button in simple chat mode', async () => {
    resetStoreForPromptLock('design', 'hello');
    useStore.setState({
      workflow: simpleBlueprint('Simple chat'),
    });
    const view = await renderChatDock();

    try {
      const runButton = buttonByAriaLabel(view.container, '运行当前会话输入');

      expect(runButton.disabled).toBe(false);
      expect(runButton.textContent).toContain('运行');
    } finally {
      await view.cleanup();
    }
  });

  it('reruns a favorited chat from its first user message', async () => {
    resetStoreForPromptLock('design');
    const originalSendPrompt = useStore.getState().sendPrompt;
    const sendPrompt = vi.fn();
    useStore.setState({
      workflow: simpleBlueprint('Reusable chat'),
      composerDraft: '',
      sendPrompt,
      sessions: [
        {
          id: 's_prompt',
          title: 'Reusable chat',
          createdAt: 1,
          updatedAt: 1,
          isWorkflow: false,
          favorite: true,
        },
      ],
      messages: [
        { id: 'm_user', role: 'user', text: 'repeat this task', createdAt: 1 },
        { id: 'm_ai', role: 'assistant', text: 'done', createdAt: 2 },
      ],
    });
    const view = await renderChatDock();

    try {
      const runButton = buttonByAriaLabel(view.container, '运行当前会话输入');

      expect(runButton.disabled).toBe(false);

      await act(async () => {
        runButton.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(sendPrompt).toHaveBeenCalledWith('repeat this task');
      expect(useStore.getState().composerDraft).toBe('');
    } finally {
      await view.cleanup();
      useStore.setState({ sendPrompt: originalSendPrompt });
    }
  });

  it('keeps empty unfavorited chat runs disabled', async () => {
    resetStoreForPromptLock('design');
    useStore.setState({
      workflow: simpleBlueprint('Plain chat'),
      composerDraft: '',
      sessions: [
        {
          id: 's_prompt',
          title: 'Plain chat',
          createdAt: 1,
          updatedAt: 1,
          isWorkflow: false,
        },
      ],
      messages: [
        { id: 'm_user', role: 'user', text: 'repeat this task', createdAt: 1 },
      ],
    });
    const view = await renderChatDock();

    try {
      const runButton = buttonByAriaLabel(view.container, '运行当前会话输入');

      expect(runButton.disabled).toBe(true);
    } finally {
      await view.cleanup();
    }
  });

  it('flips the simple chat top action to stop while chatting', async () => {
    resetStoreForPromptLock('design', 'hello');
    useStore.setState({
      workflow: simpleBlueprint('Simple chat'),
      chattingSessions: [{ workspaceId: null, sessionId: 's_prompt' }],
    });
    const view = await renderChatDock();

    try {
      const stopButton = buttonByAriaLabel(view.container, '停止当前会话生成');

      expect(stopButton.disabled).toBe(false);
      expect(stopButton.textContent).toContain('停止');
    } finally {
      await view.cleanup();
    }
  });

  it('hides the model strategy selector for non-workflow sessions', async () => {
    resetStoreForPromptLock('design');
    useStore.setState({
      activeSessionId: 's_chat',
      sessions: [
        {
          id: 's_chat',
          title: '未命名会话',
          createdAt: 1,
          updatedAt: 1,
          isWorkflow: false,
        },
      ],
    });
    const view = await renderPanels();

    try {
      expect(modelStrategyButton(view.container)).toBeNull();
    } finally {
      await view.cleanup();
    }
  });

  it('keeps the send action enabled while another workflow is AI editing', async () => {
    resetStoreForPromptLock('design', 'optimize this workflow');
    useStore.setState({
      aiStreaming: true,
      aiEditingSessions: [{ workspaceId: null, sessionId: 's_other' }],
    });
    const view = await renderPanels();

    try {
      const button = sendButton(view.container);

      expect(button.disabled).toBe(false);
      expect(button.textContent?.trim()).toBe('↑');
    } finally {
      await view.cleanup();
    }
  });

  it('searches and locates AI output matches in real time', async () => {
    resetStoreForPromptLock('design');
    useStore.setState({
      messages: [
        {
          id: 'm_a',
          role: 'assistant',
          text: 'alpha beta\nalpha',
          createdAt: 1,
        },
        {
          id: 'm_b',
          role: 'system',
          text: 'gamma alpha',
          createdAt: 2,
        },
      ] as Message[],
    });

    const view = await renderPanels();

    try {
      expect(optionalSearchInput(view.container)).toBeNull();

      await act(async () => {
        buttonByAriaLabel(view.container, '搜索 AI 返回内容').click();
      });

      const input = searchInput(view.container);

      await act(async () => {
        input.focus();
        typeIntoInput(input, 'alpha');
      });

      expect(view.container.textContent).toContain('1/3');
      expect(view.container.querySelectorAll('mark[data-search-match-id]')).toHaveLength(3);

      const nextButton = buttonByAriaLabel(view.container, '下一个匹配');
      await act(async () => {
        nextButton.click();
      });

      expect(view.container.textContent).toContain('2/3');

      const clearButton = buttonByAriaLabel(view.container, '清空搜索');
      await act(async () => {
        clearButton.click();
      });

      expect(searchInput(view.container).value).toBe('');
      expect(view.container.querySelectorAll('mark[data-search-match-id]')).toHaveLength(0);
      expect(document.activeElement).toBe(searchInput(view.container));
    } finally {
      await view.cleanup();
    }
  });

  it('opens chat search with Ctrl+F and closes it with Escape', async () => {
    resetStoreForPromptLock('design');
    useStore.setState({
      workflow: simpleBlueprint('Plain chat'),
      messages: [
        { id: 'm_user', role: 'user', text: 'find needle', createdAt: 1 },
        { id: 'm_ai', role: 'assistant', text: 'needle response', createdAt: 2 },
      ] as Message[],
    });
    const view = await renderChatDock();

    try {
      expect(optionalSearchInput(view.container)).toBeNull();

      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'f',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      });

      const input = searchInput(view.container);

      await act(async () => {
        typeIntoInput(input, 'needle');
      });

      expect(view.container.textContent).toContain('1/2');
      expect(view.container.querySelectorAll('mark[data-search-match-id]')).toHaveLength(2);

      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
          }),
        );
      });

      expect(optionalSearchInput(view.container)).toBeNull();
      expect(view.container.querySelectorAll('mark[data-search-match-id]')).toHaveLength(0);
      expect(view.container.textContent).not.toContain('1/2');
    } finally {
      await view.cleanup();
    }
  });
});
