import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SHORTCUT_SETTINGS,
  SHORTCUT_SETTINGS_STORAGE_KEY,
  loadShortcutSettings,
  matchesShortcut,
  normalizeShortcutBinding,
  saveShortcutSettings,
  shortcutConflict,
  shortcutFromKeyboardEvent,
  setShortcutBinding,
} from './keyboardShortcuts';

describe('keyboard shortcuts', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('loads default settings when no persisted settings exist', () => {
    expect(loadShortcutSettings()).toEqual(DEFAULT_SHORTCUT_SETTINGS);
  });

  it('normalizes saved key names and preserves modifier state', () => {
    const next = setShortcutBinding(
      DEFAULT_SHORTCUT_SETTINGS,
      'composer-send',
      {
        key: 'k',
        ctrlKey: true,
        altKey: true,
        shiftKey: false,
        metaKey: false,
      },
    );

    saveShortcutSettings(next);

    expect(loadShortcutSettings()['composer-send']).toEqual({
      key: 'K',
      ctrlKey: true,
      altKey: true,
      shiftKey: false,
      metaKey: false,
    });
  });

  it('falls back to defaults for invalid persisted bindings', () => {
    window.localStorage.setItem(
      SHORTCUT_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        'composer-send': { key: 'Control', ctrlKey: true },
        'modal-close': { key: 'Esc' },
      }),
    );

    const settings = loadShortcutSettings();

    expect(settings['composer-send']).toEqual(
      DEFAULT_SHORTCUT_SETTINGS['composer-send'],
    );
    expect(settings['modal-close']).toEqual({
      key: 'Escape',
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    });
  });

  it('matches keyboard events exactly', () => {
    expect(
      matchesShortcut(
        {
          key: 'Enter',
          ctrlKey: true,
          altKey: false,
          shiftKey: false,
          metaKey: false,
        } as KeyboardEvent,
        DEFAULT_SHORTCUT_SETTINGS['composer-send'],
      ),
    ).toBe(true);
    expect(
      matchesShortcut(
        {
          key: 'Enter',
          ctrlKey: true,
          altKey: false,
          shiftKey: true,
          metaKey: false,
        } as KeyboardEvent,
        DEFAULT_SHORTCUT_SETTINGS['composer-send'],
      ),
    ).toBe(false);
  });

  it('detects conflicts between actions', () => {
    expect(
      shortcutConflict(
        DEFAULT_SHORTCUT_SETTINGS,
        'composer-send',
        DEFAULT_SHORTCUT_SETTINGS['composer-newline'],
      ),
    ).toBe('composer-newline');
  });

  it('ignores pure modifier key presses while recording', () => {
    expect(
      shortcutFromKeyboardEvent({
        key: 'Shift',
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
        metaKey: false,
      } as KeyboardEvent),
    ).toBeNull();
    expect(
      normalizeShortcutBinding({
        key: ' ',
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
      }),
    ).toEqual({
      key: 'Space',
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    });
  });
});
