import type { TranslationKey } from '@/lib/i18n';

export const DEFAULT_STYLE_PRESET_ID = 'pencil' as const;
export const BUILTIN_STYLE_PRESETS = [
  DEFAULT_STYLE_PRESET_ID,
  'midnight',
  'aurora',
  'daylight',
  'ember',
] as const;

export type BuiltinStylePresetId = (typeof BUILTIN_STYLE_PRESETS)[number];
export type StylePresetId =
  | BuiltinStylePresetId
  | (string & { readonly __stylePresetIdBrand?: never });

export interface AppearanceSettings {
  stylePresetId: StylePresetId;
}

export interface StylePresetDefinition {
  id: BuiltinStylePresetId;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  colorScheme: 'dark' | 'light';
  swatches: readonly [string, string, string, string, string];
}

export const STYLE_PRESETS: Record<BuiltinStylePresetId, StylePresetDefinition> =
  {
    pencil: {
      id: 'pencil',
      labelKey: 'settings.appearancePresetPencil',
      descriptionKey: 'settings.appearancePresetPencilDescription',
      colorScheme: 'dark',
      swatches: [
        '#0d1117',
        '#161b22',
        '#1c2128',
        '#7c8cff',
        '#37c2a8',
      ],
    },
    midnight: {
      id: 'midnight',
      labelKey: 'settings.appearancePresetMidnight',
      descriptionKey: 'settings.appearancePresetMidnightDescription',
      colorScheme: 'dark',
      swatches: [
        '#0b0e1a',
        '#11152a',
        '#171c38',
        '#7c6cff',
        '#2dd4d4',
      ],
    },
    aurora: {
      id: 'aurora',
      labelKey: 'settings.appearancePresetAurora',
      descriptionKey: 'settings.appearancePresetAuroraDescription',
      colorScheme: 'dark',
      swatches: [
        '#2e3440',
        '#3b4252',
        '#434c5e',
        '#88c0d0',
        '#a3be8c',
      ],
    },
    daylight: {
      id: 'daylight',
      labelKey: 'settings.appearancePresetDaylight',
      descriptionKey: 'settings.appearancePresetDaylightDescription',
      colorScheme: 'light',
      swatches: [
        '#f6f7f9',
        '#eceef2',
        '#ffffff',
        '#2f6fed',
        '#13a07a',
      ],
    },
    ember: {
      id: 'ember',
      labelKey: 'settings.appearancePresetEmber',
      descriptionKey: 'settings.appearancePresetEmberDescription',
      colorScheme: 'dark',
      swatches: [
        '#1a1411',
        '#221a15',
        '#2b211a',
        '#ff8c42',
        '#3fb8a8',
      ],
    },
  };

export const STYLE_PRESET_LIST = BUILTIN_STYLE_PRESETS.map(
  (id) => STYLE_PRESETS[id],
);

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  stylePresetId: DEFAULT_STYLE_PRESET_ID,
};

export function isBuiltinStylePresetId(
  value: string | null | undefined,
): value is BuiltinStylePresetId {
  return !!value && BUILTIN_STYLE_PRESETS.includes(value as BuiltinStylePresetId);
}

export function resolveStylePresetId(
  value: StylePresetId | string | null | undefined,
): BuiltinStylePresetId {
  return isBuiltinStylePresetId(value) ? value : DEFAULT_STYLE_PRESET_ID;
}

export function normalizeAppearanceSettings(
  value: unknown,
): AppearanceSettings {
  if (!value || typeof value !== 'object') {
    return DEFAULT_APPEARANCE_SETTINGS;
  }
  const stylePresetId = (value as { stylePresetId?: unknown }).stylePresetId;
  if (typeof stylePresetId !== 'string' || !stylePresetId.trim()) {
    return DEFAULT_APPEARANCE_SETTINGS;
  }
  return { stylePresetId: stylePresetId as StylePresetId };
}

export function isUnsupportedStylePreset(
  value: string | null | undefined,
): boolean {
  return !isBuiltinStylePresetId(value);
}

export function applyAppearance(settings: AppearanceSettings): void {
  if (typeof document === 'undefined') return;

  const stylePresetId = resolveStylePresetId(settings.stylePresetId);
  const root = document.documentElement;

  root.dataset.owfStyle = stylePresetId;
  for (const presetId of BUILTIN_STYLE_PRESETS) {
    root.classList.toggle(`owf-style-${presetId}`, presetId === stylePresetId);
  }
}
