import { GraphModuleRegistry } from '../GraphModuleRegistry.ts';
import { AnimaModule } from './AnimaModule.ts';
import { FilteringModule } from './FilteringModule.ts';
import { ForceLayoutModule, readForceSettings } from './ForceLayoutModule.ts';
import { FormModule } from './FormModule.ts';
import { LinearBuildOutLayoutModule } from './LinearBuildOutLayoutModule.ts';
import { RenderingModule } from './RenderingModule.ts';
import { NodeRegionsModule } from './NodeRegionsModule.ts';

export const SHIPPED_GRAPH_MODULE_IDS_V1 = {
  rendering: 'rendering',
  filtering: 'filtering',
  form: 'form',
  linearLayout: 'linear-layout',
  forceLayout: 'force-layout',
  nodeRegions: 'node-regions',
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
        renderQuality: 'automatic',
        labelMode: 'adaptive',
        nodeRadiusScale: 1,
        edgeThicknessScale: 1,
        showArrows: false,
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
    create: ({ dimensions, settings }) => new FormModule(dimensions, settings),
  });
  registry.register({
    order: 350,
    descriptor: {
      id: SHIPPED_GRAPH_MODULE_IDS_V1.nodeRegions,
      version: '1.0.0',
      displayName: 'Node regions',
      capabilities: ['node-regions'],
      dependencies: ['rendering'],
      settingsSchemaVersion: 1,
      defaultSettings: {
        boundariesVisible: false,
        membershipStrength: 0.18,
        membershipDistance: 64,
        boundaryPadding: 28,
      },
    },
    create: ({ dimensions, settings }) => new NodeRegionsModule(dimensions, settings),
  });
  registry.register({
    order: 375,
    descriptor: {
      id: SHIPPED_GRAPH_MODULE_IDS_V1.linearLayout,
      version: '1.0.0',
      displayName: 'Linear build-out',
      capabilities: ['layout', 'linear-layout'],
      conflicts: ['form', 'force-layout'],
      settingsSchemaVersion: 1,
      defaultSettings: {
        buildDirection: 'right',
        layerSpacing: 180,
        branchSpacing: 160,
        componentSpacing: 320,
      },
    },
    create: ({ dimensions, settings }) => new LinearBuildOutLayoutModule(dimensions, settings),
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
        repulsionStrength: 1000,
        springStrength: 1,
        springLength: 250,
        centeringStrength: 0.1,
        velocityDecay: 0.4,
        alphaDecay: 0.02276277904418933,
        alphaMin: 0.001,
        repulsionMinDistance: 30,
        barnesHutTheta: 0.9,
        maxSpeed: 260,
        minimumAffinity: 0.2,
        maximumAffinity: 2.5,
        evidenceLogFactor: 0.35,
        reciprocalBoost: 1.25,
        hubDiscountExponent: 0.25,
        minimumSpringStrengthScale: 0.35,
        maximumSpringStrengthScale: 2,
        minimumSpringLengthScale: 0.55,
        maximumSpringLengthScale: 1.85,
        componentPadding: 80,
        collisionRadius: 60,
        collisionStrength: 0.5,
        axialSpringAxis: 'off',
        axialSpringStiffness: 0,
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
      defaultSettings: {
        labelPosition: 'above',
        adaptiveLabelThreshold2d: 65,
        adaptiveLabelThreshold3d: 50,
      },
    },
    create: ({ themePalette, settings }) => new AnimaModule(themePalette, settings),
  });
  return registry;
}
