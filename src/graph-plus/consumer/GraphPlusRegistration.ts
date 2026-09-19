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
  displayName: 'graph+',
  consumerVersion: '2.0.0',
  supportedProtocolVersions: [1],
  profiles: [{
    profileId: GRAPH_PLUS_PROFILE_ID_V1,
    displayName: 'Default',
    descriptorVersion: 9,
    dimensions: '2d',
    allowedDimensions: ['2d', '3d'],
    requestedCapabilities: GRAPH_PLUS_REQUESTED_CAPABILITIES_V1,
    uiDefaults: {
      dimensionControlVisible: true,
      quickSettingsVisibility: 'collapsed',
      quickSettingsSections: {
        filter: { controls: { 'filter.clear': 'hidden' } },
        form: { visibility: 'shown' },
        display: { visibility: 'shown' },
        camera: { visibility: 'hidden' },
        forces: { visibility: 'shown' },
        regions: { visibility: 'shown' },
      },
      contextMenuEnabled: true,
    },
    interaction: {
      activationActionIds: ['open-node'],
      contextActionIds: ['open-node'],
    },
    profileSettings: {
      focalLengthMm: 50,
      dragRelease: 'dynamic',
      dragConstraint: 'transient',
      initialPositionStrategy: 'generated',
    },
    modules: {
      rendering: {
        policy: 'required',
        constraints: {
          renderQuality: { type: 'enum', allowed: ['automatic', 'high-fidelity', 'energy-saver'] },
          labelMode: { type: 'enum', allowed: ['adaptive', 'all', 'off'] },
        },
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
        constraints: {
          axialSpringAxis: { type: 'enum', allowed: ['off', 'x', 'y', 'z'] },
          axialSpringStiffness: { type: 'number', min: 0, max: 0.9 },
        },
      },
      'node-regions': {
        policy: 'optional',
        defaultEnabled: true,
        constraints: {
          boundariesVisible: { type: 'enum', allowed: [true, false] },
          membershipStrength: { type: 'number', min: 0, max: 2 },
          membershipDistance: { type: 'number', min: 10, max: 500 },
          boundaryPadding: { type: 'number', min: 8, max: 120 },
        },
      },
      anima: {
        policy: 'required',
        constraints: {
          labelPosition: { type: 'enum', allowed: ['above', 'below'] },
          adaptiveLabelThreshold2d: { type: 'number', min: 0, max: 100 },
          adaptiveLabelThreshold3d: { type: 'number', min: 0, max: 100 },
        },
      },
    },
  }],
};

/**
 * Cumulative, idempotent V1.7 migration. It retires V1.6's temporary dual
 * setting banks and removes the obsolete homogeneous-layout selector.
 */
export function migrateGraphPlusProfileOverridesV17(
  value: GraphSettingsOverridesV1,
): GraphSettingsOverridesV1 {
  const cloned = clone(value);
  const modules = { ...(value.modules ?? {}) };
  for (const moduleId of ['rendering', 'force-layout', 'node-regions']) {
    const module = modules[moduleId];
    if (!module?.settings) continue;
    const settings = { ...module.settings };
    const accepted = isRecord(settings.newSettings) ? settings.newSettings : {};
    delete settings.newSettings;
    delete settings.legacySettings;
    modules[moduleId] = { ...module, settings: { ...settings, ...accepted } };
  }
  if (modules['force-layout']?.settings) {
    const settings = { ...modules['force-layout'].settings };
    delete settings.weightingMode;
    modules['force-layout'] = { ...modules['force-layout'], settings: Object.keys(settings).length ? settings : undefined };
  }
  const anima = modules.anima;
  if (anima?.enabled === false) {
    const { enabled: _enabled, ...rest } = anima;
    if (rest.settings) modules.anima = rest;
    else delete modules.anima;
  }
  const profileSettings = { ...(value.profileSettings ?? {}) };
  delete profileSettings.graphSystem;
  delete profileSettings.graphSystemMigrationVersion;
  return {
    ...cloned,
    profileSettings: Object.keys(profileSettings).length ? profileSettings : undefined,
    modules: Object.keys(modules).length ? modules : undefined,
  };
}

/** @deprecated Use the cumulative V1.7 migration. */
export const migrateGraphPlusProfileOverridesV16 = migrateGraphPlusProfileOverridesV17;

function isRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
