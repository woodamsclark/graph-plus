import type { ConsumerRegistrationV1 } from '../../graph-engine/contracts/v1/index.ts';

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
  consumerVersion: '1.3.0',
  supportedProtocolVersions: [1],
  profiles: [{
    profileId: GRAPH_PLUS_PROFILE_ID_V1,
    displayName: 'Default',
    descriptorVersion: 4,
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
    profileSettings: { focalLengthMm: 50, dragRelease: 'dynamic' },
    modules: {
      rendering: {
        policy: 'required',
        defaults: { labelMode: 'adaptive', tokenColors: { 'kind:tag': '#a78bfa' } },
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
      'force-layout': { policy: 'optional', defaultEnabled: true, defaults: { settlingSpeed: 2 } },
      'node-regions': {
        policy: 'optional',
        defaultEnabled: true,
        defaults: {
          boundariesVisible: true,
          membershipStrength: 0.18,
          membershipDistance: 64,
          boundaryPadding: 28,
        },
        constraints: {
          boundariesVisible: { type: 'enum', allowed: [true, false] },
          membershipStrength: { type: 'number', min: 0, max: 2 },
          membershipDistance: { type: 'number', min: 10, max: 500 },
          boundaryPadding: { type: 'number', min: 8, max: 120 },
        },
      },
      anima: { policy: 'optional', defaultEnabled: false },
    },
  }],
};
