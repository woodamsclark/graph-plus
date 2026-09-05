import type {
  ConsumerRegistrationV1,
  GraphSettingsOverridesV1,
  JsonValue,
} from '../../graph-engine/contracts/v1/index.ts';

export const GRAPH_PLUS_CONSUMER_ID_V1 = 'graph-plus';
export const GRAPH_PLUS_PROFILE_ID_V1 = 'default';

export const GRAPH_PLUS_REQUESTED_CAPABILITIES_V1 = [
  'render',
  'camera',
  'input',
  'filter',
  'projection',
  'form',
  'layout',
  'force-layout',
  'node-regions',
  'animation',
] as const;

export const GRAPH_PLUS_CONSUMER_REGISTRATION_V1: ConsumerRegistrationV1 = {
  consumerId: GRAPH_PLUS_CONSUMER_ID_V1,
  displayName: 'Graph+',
  consumerVersion: '1.6.0',
  supportedProtocolVersions: [1],
  profiles: [{
    profileId: GRAPH_PLUS_PROFILE_ID_V1,
    displayName: 'Default',
    descriptorVersion: 6,
    dimensions: '2d',
    allowedDimensions: ['2d', '3d'],
    requestedCapabilities: GRAPH_PLUS_REQUESTED_CAPABILITIES_V1,
    uiDefaults: {
      dimensionControlVisible: true,
      quickSettingsVisibility: 'shown',
      quickSettingsSections: {
        filter: { controls: { 'filter.clear': 'hidden' } },
        form: { visibility: 'shown' },
        display: { visibility: 'shown' },
        camera: { visibility: 'shown' },
        forces: { visibility: 'shown' },
        regions: { visibility: 'shown' },
      },
      contextMenuEnabled: true,
    },
    interaction: {
      activationActionIds: ['open-node'],
      contextActionIds: ['open-node'],
    },
    profileSettings: { focalLengthMm: 50, dragRelease: 'dynamic', graphSystem: 'new' },
    modules: {
      rendering: {
        policy: 'required',
        defaults: {
          newSettings: {
            labelMode: 'adaptive',
            nodeRadiusScale: 1,
            edgeThicknessScale: 1,
            showArrows: false,
            tokenColors: { 'kind:tag': '#a78bfa' },
          },
          legacySettings: {
            labelMode: 'adaptive',
            nodeRadiusScale: 1,
            edgeThicknessScale: 1,
            showArrows: true,
            tokenColors: { 'kind:tag': '#a78bfa' },
          },
        },
        constraints: { labelMode: { type: 'enum', allowed: ['adaptive', 'all', 'off'] } },
      },
      filtering: { policy: 'required' },
      form: {
        policy: 'optional',
        defaultEnabled: false,
        defaults: {
          direction: 'either',
          maxDepth: 3,
          showCrossLinks: false,
          showDisconnected: false,
          colorBranches: true,
        },
      },
      'force-layout': {
        policy: 'optional',
        defaultEnabled: true,
        defaults: {
          settlingSpeed: 2,
          newSettings: {
            forceModel: 'd3-compatible',
            weightingMode: 'topology-weighted',
            repulsionStrength: 1000,
            springStrength: 1,
            springLength: 250,
            centeringStrength: 0.1,
            velocityDecay: 0.4,
            alphaDecay: 0.02276277904418933,
            alphaMin: 0.001,
            settlingSpeed: 1,
            repulsionMinDistance: 30,
            barnesHutTheta: 0.9,
            collisionRadius: 60,
            collisionStrength: 0.5,
          },
          legacySettings: { forceModel: 'legacy', settlingSpeed: 2 },
        },
      },
      'node-regions': {
        policy: 'optional',
        defaultEnabled: true,
        defaults: {
          newSettings: {
            boundariesVisible: false,
            membershipStrength: 0.18,
            membershipDistance: 64,
            boundaryPadding: 28,
          },
          legacySettings: {
            boundariesVisible: true,
            membershipStrength: 0.18,
            membershipDistance: 64,
            boundaryPadding: 28,
          },
        },
        constraints: {
          boundariesVisible: { type: 'enum', allowed: [true, false] },
          membershipStrength: { type: 'number', min: 0, max: 2 },
          membershipDistance: { type: 'number', min: 10, max: 500 },
          boundaryPadding: { type: 'number', min: 8, max: 120 },
        },
      },
      anima: {
        policy: 'required',
        defaults: { labelPosition: 'above' },
        constraints: { labelPosition: { type: 'enum', allowed: ['above', 'below'] } },
      },
    },
  }],
};

/** Explicit, idempotent V1.6 migration: existing tuning becomes legacy-only. */
export function migrateGraphPlusProfileOverridesV16(
  value: GraphSettingsOverridesV1,
): GraphSettingsOverridesV1 {
  if (value.profileSettings?.graphSystemMigrationVersion === 1) return clone(value);
  const modules = { ...(value.modules ?? {}) };
  for (const moduleId of ['rendering', 'force-layout', 'node-regions']) {
    const module = modules[moduleId];
    if (!module?.settings) continue;
    const settings = { ...module.settings };
    const direct: Record<string, JsonValue> = {};
    for (const [key, setting] of Object.entries(settings)) {
      if (key === 'newSettings' || key === 'legacySettings') continue;
      direct[key] = setting;
      delete settings[key];
    }
    const priorLegacy = isRecord(settings.legacySettings) ? settings.legacySettings : {};
    settings.legacySettings = { ...legacyModeDefaults(moduleId), ...direct, ...priorLegacy };
    modules[moduleId] = { ...module, settings: Object.keys(settings).length ? settings : undefined };
  }
  const anima = modules.anima;
  if (anima?.enabled === false) {
    const { enabled: _enabled, ...rest } = anima;
    if (rest.settings) modules.anima = rest;
    else delete modules.anima;
  }
  return {
    ...clone(value),
    profileSettings: {
      ...(value.profileSettings ?? {}),
      graphSystem: 'new',
      graphSystemMigrationVersion: 1,
    },
    modules: Object.keys(modules).length ? modules : undefined,
  };
}

function legacyModeDefaults(moduleId: string): Record<string, JsonValue> {
  if (moduleId === 'rendering') return {
    labelMode: 'adaptive', nodeRadiusScale: 1, edgeThicknessScale: 1,
    showArrows: true, tokenColors: { 'kind:tag': '#a78bfa' },
  };
  if (moduleId === 'force-layout') return {
    forceModel: 'legacy', weightingMode: 'topology-weighted', repulsionStrength: 7000,
    springStrength: 0.25, springLength: 120, centeringStrength: 0.002,
    velocityDecay: 0.4, alphaDecay: 0.035, alphaMin: 0.001, settlingSpeed: 2,
    repulsionMinDistance: 40, barnesHutTheta: 0.8, maxSpeed: 260,
    minimumAffinity: 0.2, maximumAffinity: 2.5, evidenceLogFactor: 0.35,
    reciprocalBoost: 1.25, hubDiscountExponent: 0.25,
    minimumSpringStrengthScale: 0.35, maximumSpringStrengthScale: 2,
    minimumSpringLengthScale: 0.55, maximumSpringLengthScale: 1.85,
    componentPadding: 80, collisionRadius: 60, collisionStrength: 0.5,
  };
  return { boundariesVisible: true, membershipStrength: 0.18, membershipDistance: 64, boundaryPadding: 28 };
}

function isRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
