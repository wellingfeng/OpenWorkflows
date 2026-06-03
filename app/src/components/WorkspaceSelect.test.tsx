import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkspaceSelect from '@/components/WorkspaceSelect';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

async function renderWorkspaceSelect(props: {
  value: string;
  history: string[];
}): Promise<{ container: HTMLDivElement; cleanup: () => Promise<void> }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  await act(async () => {
    root.render(<WorkspaceSelect {...props} onSelect={vi.fn()} />);
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

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '';
});

describe('WorkspaceSelect', () => {
  it('renders normalized duplicate workspace history entries once', async () => {
    const view = await renderWorkspaceSelect({
      value: 'E:\\Game',
      history: [
        'E:\\Game',
        'e:/Game/',
        'E:\\OpenWorkflows',
        'E:\\Game\\',
      ],
    });

    try {
      const trigger = view.container.querySelector('button');
      expect(trigger).toBeInstanceOf(HTMLButtonElement);

      await act(async () => {
        trigger?.click();
      });

      const options = Array.from(
        view.container.querySelectorAll('[role="option"]'),
      );
      expect(options).toHaveLength(2);
      expect(options.map((item) => item.textContent?.trim())).toEqual([
        '●Game',
        '●OpenWorkflows',
      ]);
    } finally {
      await view.cleanup();
    }
  });
});
