import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUILTIN_STYLE_PRESETS,
  DEFAULT_STYLE_PRESET_ID,
  STYLE_PRESET_LIST,
  applyAppearance,
  isUnsupportedStylePreset,
  resolveStylePresetId,
} from './appearance';
import { SUPPORTED_LOCALES, t } from './i18n';

const NEW_PRESETS = ['midnight', 'aurora', 'daylight', 'ember'] as const;

// Vitest runs with cwd at the app/ root.
const globalCss = readFileSync('src/styles/global.css', 'utf8');

// The full primitive-token contract each preset CSS block must define.
const REQUIRED_TOKENS = [
  '--owf-color-bg',
  '--owf-color-bg-alt',
  '--owf-color-panel',
  '--owf-color-panel-2',
  '--owf-color-border',
  '--owf-color-border-soft',
  '--owf-color-text',
  '--owf-color-text-muted',
  '--owf-color-text-faint',
  '--owf-color-accent',
  '--owf-color-accent-2',
  '--owf-color-accent-3',
  '--owf-color-accent-4',
  '--owf-status-ai-edit',
  '--owf-status-ai-edit-contrast',
  '--owf-status-running',
  '--owf-status-running-contrast',
  '--owf-status-success',
  '--owf-status-success-contrast',
  '--owf-status-error',
  '--owf-status-error-contrast',
  '--owf-status-interrupted',
  '--owf-status-interrupted-contrast',
] as const;

/** Extract the body of `html.owf-style-<id> { ... }` from global.css. */
function presetCssBlock(id: string): string {
  const marker = `html.owf-style-${id} {`;
  const start = globalCss.indexOf(marker);
  if (start === -1) return '';
  const open = globalCss.indexOf('{', start);
  const close = globalCss.indexOf('}', open);
  return globalCss.slice(open + 1, close);
}

afterEach(() => {
  document.documentElement.className = '';
  delete document.documentElement.dataset.owfStyle;
});

describe('appearance presets', () => {
  it('registers Pencil plus the four new presets', () => {
    expect(BUILTIN_STYLE_PRESETS).toEqual([
      'pencil',
      'midnight',
      'aurora',
      'daylight',
      'ember',
    ]);
    expect(STYLE_PRESET_LIST).toHaveLength(5);
  });

  it('each preset has five hex swatches and matching id', () => {
    for (const preset of STYLE_PRESET_LIST) {
      expect(preset.swatches).toHaveLength(5);
      for (const swatch of preset.swatches) {
        expect(swatch).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
      expect(preset.id).toBe(preset.id);
    }
  });

  it('daylight is the light scheme; the rest are dark', () => {
    const byId = Object.fromEntries(
      STYLE_PRESET_LIST.map((p) => [p.id, p.colorScheme]),
    );
    expect(byId.daylight).toBe('light');
    expect(byId.pencil).toBe('dark');
    expect(byId.midnight).toBe('dark');
    expect(byId.aurora).toBe('dark');
    expect(byId.ember).toBe('dark');
  });

  it.each(NEW_PRESETS)(
    'global.css defines the full token contract for "%s"',
    (id) => {
      const block = presetCssBlock(id);
      expect(block, `missing CSS block for ${id}`).not.toBe('');
      for (const token of REQUIRED_TOKENS) {
        expect(block, `${id} missing ${token}`).toContain(`${token}:`);
      }
    },
  );

  it('daylight opts into the light color-scheme', () => {
    expect(presetCssBlock('daylight')).toContain('color-scheme: light');
  });

  it.each(NEW_PRESETS)(
    'both locales provide label + description for "%s"',
    (id) => {
      const preset = STYLE_PRESET_LIST.find((p) => p.id === id);
      expect(preset).toBeDefined();
      for (const locale of SUPPORTED_LOCALES) {
        const label = t(locale, preset!.labelKey);
        const desc = t(locale, preset!.descriptionKey);
        expect(label.length).toBeGreaterThan(0);
        expect(label).not.toBe(preset!.labelKey);
        expect(desc.length).toBeGreaterThan(0);
        expect(desc).not.toBe(preset!.descriptionKey);
      }
    },
  );

  it.each([...BUILTIN_STYLE_PRESETS])(
    'applyAppearance wires data-attr + class for "%s"',
    (id) => {
      applyAppearance({ stylePresetId: id });
      const root = document.documentElement;
      expect(root.dataset.owfStyle).toBe(id);
      expect(root.classList.contains(`owf-style-${id}`)).toBe(true);
      // Only the active preset class is present.
      for (const other of BUILTIN_STYLE_PRESETS) {
        if (other === id) continue;
        expect(root.classList.contains(`owf-style-${other}`)).toBe(false);
      }
    },
  );

  it('treats the new presets as supported and falls back otherwise', () => {
    for (const id of NEW_PRESETS) {
      expect(isUnsupportedStylePreset(id)).toBe(false);
      expect(resolveStylePresetId(id)).toBe(id);
    }
    expect(isUnsupportedStylePreset('not-a-theme')).toBe(true);
    expect(resolveStylePresetId('not-a-theme')).toBe(DEFAULT_STYLE_PRESET_ID);
  });
});
