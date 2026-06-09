import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isNotifiableCompletionStatus,
  notifySessionComplete,
  sessionCompletionNotificationText,
  setSessionNotificationClickHandler,
} from './sessionNotification';

const originalNotification = Object.getOwnPropertyDescriptor(globalThis, 'Notification');

afterEach(() => {
  vi.restoreAllMocks();
  if (originalNotification) {
    Object.defineProperty(globalThis, 'Notification', originalNotification);
  } else {
    delete (globalThis as Record<string, unknown>).Notification;
  }
});

describe('sessionCompletionNotificationText', () => {
  it('formats success notifications with the session title', () => {
    expect(
      sessionCompletionNotificationText({
        status: 'success',
        sessionTitle: '周报生成',
      }),
    ).toEqual({
      title: '会话已完成',
      body: '周报生成',
    });
  });

  it('formats error notifications with detail', () => {
    expect(
      sessionCompletionNotificationText({
        status: 'error',
        sessionTitle: '图片生成',
        detail: 'Provider 不可用',
      }),
    ).toEqual({
      title: '会话失败',
      body: '图片生成 · Provider 不可用',
    });
  });
});

describe('isNotifiableCompletionStatus', () => {
  it('only accepts terminal completion statuses', () => {
    expect(isNotifiableCompletionStatus('success')).toBe(true);
    expect(isNotifiableCompletionStatus('error')).toBe(true);
    expect(isNotifiableCompletionStatus('running')).toBe(false);
    expect(isNotifiableCompletionStatus('interrupted')).toBe(false);
  });
});

describe('notifySessionComplete', () => {
  it('is a no-op when notifications are unavailable', async () => {
    await expect(
      notifySessionComplete({ status: 'success', sessionTitle: '测试' }),
    ).resolves.toBeUndefined();
  });

  it('switches to the notification target when a web notification is clicked', async () => {
    const instances: Array<Notification & { onclick: (() => void) | null }> = [];

    class MockNotification {
      static permission: NotificationPermission = 'granted';
      static requestPermission = vi.fn();

      onclick: (() => void) | null = null;
      close = vi.fn();

      constructor(public title: string, public options?: NotificationOptions) {
        instances.push(this as unknown as Notification & { onclick: (() => void) | null });
      }
    }

    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      writable: true,
      value: MockNotification,
    });
    const clicks: unknown[] = [];
    const dispose = setSessionNotificationClickHandler((payload) => {
      clicks.push(payload);
    });
    vi.spyOn(window, 'focus').mockImplementation(() => {});

    await notifySessionComplete({
      status: 'success',
      sessionTitle: '测试',
      workspaceId: 'w_1',
      sessionId: 's_1',
    });
    instances[0]?.onclick?.();

    expect(clicks).toEqual([{ workspaceId: 'w_1', sessionId: 's_1' }]);
    dispose();
  });
});
