import { describe, expect, it } from 'vitest';
import {
  emptyProjectSettings,
  gameFeatureDefaultsForEngine,
  projectSettingsFromMetadata,
  settingsWithDetectedGameFeatures,
} from './projectSettings';
import type { ProjectEngineKind, ProjectEnvironmentScan } from './tauri';

function scanForEngine(
  engine: ProjectEngineKind,
): Pick<ProjectEnvironmentScan, 'engine'> {
  return {
    engine: {
      engine,
      label:
        engine === 'unity'
          ? 'Unity'
          : engine === 'unreal'
            ? 'Unreal Engine'
            : engine === 'godot'
              ? 'Godot'
              : '未识别',
      confidence: engine === 'unknown' ? 0 : 0.95,
      markers: [],
    },
  };
}

describe('project settings game features', () => {
  it('keeps game-related features off by default', () => {
    expect(emptyProjectSettings().gameFeatures).toEqual({
      meshGeneration: false,
      rigging: false,
      gameExperts: false,
      gameExpertEngine: 'auto',
    });
    expect(gameFeatureDefaultsForEngine('unknown')).toEqual(
      emptyProjectSettings().gameFeatures,
    );
  });

  it('turns on Mesh, rigging, and game experts for detected game engines', () => {
    const settings = settingsWithDetectedGameFeatures(
      emptyProjectSettings(),
      scanForEngine('unity'),
    );

    expect(settings.engine).toBe('unity');
    expect(settings.gameFeatures).toEqual({
      meshGeneration: true,
      rigging: true,
      gameExperts: true,
      gameExpertEngine: 'unity',
    });
  });

  it('turns game-related features off for non-game projects', () => {
    const current = {
      ...emptyProjectSettings(),
      gameFeatures: gameFeatureDefaultsForEngine('unreal'),
    };

    const settings = settingsWithDetectedGameFeatures(
      current,
      scanForEngine('unknown'),
    );

    expect(settings.engine).toBe('unknown');
    expect(settings.gameFeatures).toEqual(emptyProjectSettings().gameFeatures);
  });

  it('preserves manual project settings when auto detection is disabled', () => {
    const current = {
      ...emptyProjectSettings(),
      automation: {
        ...emptyProjectSettings().automation,
        autoDetect: false,
      },
      gameFeatures: {
        meshGeneration: true,
        rigging: false,
        gameExperts: true,
        gameExpertEngine: 'godot' as const,
      },
    };

    const settings = settingsWithDetectedGameFeatures(
      current,
      scanForEngine('unknown'),
    );

    expect(settings).toEqual(current);
  });

  it('normalizes persisted game feature settings', () => {
    const settings = projectSettingsFromMetadata({
      projectSettings: {
        gameFeatures: {
          meshGeneration: true,
          rigging: true,
          gameExperts: true,
          gameExpertEngine: 'unreal',
        },
      },
    });

    expect(settings.gameFeatures).toEqual({
      meshGeneration: true,
      rigging: true,
      gameExperts: true,
      gameExpertEngine: 'unreal',
    });
  });
});
