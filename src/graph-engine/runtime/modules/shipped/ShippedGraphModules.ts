import { GraphModuleRegistry } from '../GraphModuleRegistry.ts';
import { AnimaModule } from './AnimaModule.ts';
import { FilteringModule } from './FilteringModule.ts';
import { ForceLayoutModule, readForceSettings } from './ForceLayoutModule.ts';
import { FormModule } from './FormModule.ts';
import { RenderingModule } from './RenderingModule.ts';

export const SHIPPED_GRAPH_MODULE_IDS_V1 = {
  rendering: 'rendering',
  filtering: 'filtering',
  form: 'form',
  forceLayout: 'force-layout',
  anima: 'anima',
} as const;

export function createShippedGraphModuleRegistryV1(): GraphModuleRegistry {
  const registry = new GraphModuleRegistry();
  registry.register({
    order: 100,
    descriptor: {
      id: SHIPPED_GRAPH_MODULE_IDS_V1.rendering,
      version: '1.0.0',
      displayName: 'Rendering',
      capabilities: ['render', 'camera', 'input'],
      settingsSchemaVersion: 1,
      defaultSettings: {
        labelMode: 'adaptive',
        nodeRadiusScale: 1,
        edgeThicknessScale: 1,
        tokenColors: {},
      },
    },
    create: ({ themePalette, settings }) => new RenderingModule(themePalette, settings),
  });
  registry.register({
    order: 200,
    descriptor: {
      id: SHIPPED_GRAPH_MODULE_IDS_V1.filtering,
      version: '1.0.0',
      displayName: 'Filtering',
      capabilities: ['filter'],
      settingsSchemaVersion: 1,
      defaultSettings: {},
    },
    create: () => new FilteringModule(),
  });
  registry.register({
    order: 300,
    descriptor: {
      id: SHIPPED_GRAPH_MODULE_IDS_V1.form,
      version: '1.0.0',
      displayName: 'Form',
      capabilities: ['projection', 'form'],
      settingsSchemaVersion: 1,
      defaultSettings: {
        direction: 'either',
        showCrossLinks: true,
        showDisconnected: false,
        ringSpacing: 120,
        colorBranches: true,
      },
    },
    create: ({ settings }) => new FormModule(settings),
  });
  registry.register({
    order: 400,
    descriptor: {
      id: SHIPPED_GRAPH_MODULE_IDS_V1.forceLayout,
      version: '1.0.0',
      displayName: 'Force layout',
      capabilities: ['layout', 'force-layout'],
      settingsSchemaVersion: 1,
      defaultSettings: {
        repulsionStrength: 7000,
        springStrength: 0.25,
        springLength: 100,
        centeringStrength: 0.002,
        velocityDecay: 0.4,
        alphaDecay: 0.035,
        alphaMin: 0.001,
        repulsionMinDistance: 40,
        barnesHutTheta: 0.8,
        maxSpeed: 260,
      },
    },
    create: ({ dimensions, settings }) => new ForceLayoutModule(dimensions, readForceSettings(settings)),
  });
  registry.register({
    order: 500,
    descriptor: {
      id: SHIPPED_GRAPH_MODULE_IDS_V1.anima,
      version: '1.0.0',
      displayName: 'Anima',
      capabilities: ['animation'],
      settingsSchemaVersion: 1,
      defaultSettings: {},
    },
    create: () => new AnimaModule(),
  });
  return registry;
}
