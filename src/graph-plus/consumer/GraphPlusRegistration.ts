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
  'animation',
] as const;

export const GRAPH_PLUS_CONSUMER_REGISTRATION_V1: ConsumerRegistrationV1 = {
  consumerId: GRAPH_PLUS_CONSUMER_ID_V1,
  displayName: 'Graph+',
  consumerVersion: '1.0.0',
  supportedProtocolVersions: [1],
  profiles: [{
    profileId: GRAPH_PLUS_PROFILE_ID_V1,
    displayName: 'Default',
    descriptorVersion: 1,
    dimensions: '3d',
    requestedCapabilities: GRAPH_PLUS_REQUESTED_CAPABILITIES_V1,
    profileSettings: { focalLengthMm: 50, dragRelease: 'pin' },
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
      'force-layout': { policy: 'optional', defaultEnabled: true },
      anima: { policy: 'optional', defaultEnabled: false },
    },
  }],
};
