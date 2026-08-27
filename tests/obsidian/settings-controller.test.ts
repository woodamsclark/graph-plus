import type { ConsumerRegistrationV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import { ConsumerProfileRegistry } from '../../src/graph-engine/core/profile/index.ts';
import { GRAPH_PLUS_CONSUMER_REGISTRATION_V1 } from '../../src/graph-plus/consumer/index.ts';
import { createShippedGraphModuleRegistryV1 } from '../../src/graph-engine/runtime/index.ts';
import { GraphEngineSettingsControllerV1 } from '../../src/obsidian/settings/GraphEngineSettingsController.ts';
import { assert, equal, test } from '../support/harness.ts';

test('R-DIM-01 profile dimension edits persist in one namespace and reset independently', async () => {
  const profiles = new ConsumerProfileRegistry();
  profiles.registerConsumer(GRAPH_PLUS_CONSUMER_REGISTRATION_V1);
  profiles.setUserOverrides('graph-plus', 'default', { profileSettings: { retained: true } });
  let saves = 0;
  const controller = new GraphEngineSettingsControllerV1(profiles, {}, () => { saves += 1; }, true);

  equal(controller.canEditProfileDimensions('graph-plus', 'default'), true, 'Graph+ should expose its permitted persistent selector when runtime support is enabled');
  await controller.setProfileDimensions('graph-plus', 'default', '2d');
  equal(controller.getProfileOverrides('graph-plus', 'default').dimensions, '2d', 'dimension override should persist in the active profile namespace');
  equal(controller.getEffectiveProfile('graph-plus', 'default').dimensionsSource, 'user-profile', 'effective settings should expose user provenance');
  await controller.setProfileDimensions('graph-plus', 'default', undefined);
  equal(controller.getProfileOverrides('graph-plus', 'default').dimensions, undefined, 'reset should remove the dimension override');
  equal(controller.getProfileOverrides('graph-plus', 'default').profileSettings?.retained, true, 'dimension reset should preserve sibling overrides');
  equal(controller.getEffectiveProfile('graph-plus', 'default').dimensions, '2d', 'reset should reveal the consumer default');
  equal(saves, 2, 'each user edit should request one persistence cycle');
});

test('R-DIM-01 hidden or locked dimension policy exposes no editable settings control', async () => {
  const lockedRegistration: ConsumerRegistrationV1 = {
    ...GRAPH_PLUS_CONSUMER_REGISTRATION_V1,
    consumerId: 'locked-consumer',
    profiles: GRAPH_PLUS_CONSUMER_REGISTRATION_V1.profiles.map((profile) => ({
      ...profile,
      profileId: 'locked',
      dimensions: '2d',
      allowedDimensions: ['2d'],
      uiDefaults: { ...profile.uiDefaults, dimensionControlVisible: true },
    })),
  };
  const profiles = new ConsumerProfileRegistry();
  profiles.registerConsumer(lockedRegistration);
  const controller = new GraphEngineSettingsControllerV1(profiles, {}, () => undefined, true);
  equal(controller.canEditProfileDimensions('locked-consumer', 'locked'), false, 'one allowed dimension should never render an editable selector');
  let rejected = false;
  try { await controller.setProfileDimensions('locked-consumer', 'locked', '3d'); } catch { rejected = true; }
  assert(rejected, 'programmatic settings writes must honor the same allowed set');

  const stagedController = new GraphEngineSettingsControllerV1(profiles, {}, () => undefined);
  equal(stagedController.canEditProfileDimensions('locked-consumer', 'locked'), false, 'settings selector should remain staged until live runtime switching is enabled');
});

test('R-DIM-04 failed live activation rolls the persistent dimension override back', async () => {
  const profiles = new ConsumerProfileRegistry();
  profiles.registerConsumer(GRAPH_PLUS_CONSUMER_REGISTRATION_V1);
  let attempts = 0;
  const controller = new GraphEngineSettingsControllerV1(profiles, {}, () => {
    attempts += 1;
    if (attempts === 1) throw new Error('runtime rejected dimension');
  }, true);
  let rejected = false;
  try { await controller.setProfileDimensions('graph-plus', 'default', '2d'); } catch { rejected = true; }
  equal(rejected, true, 'the failed live activation should reach the settings caller');
  equal(controller.getProfileOverrides('graph-plus', 'default').dimensions, undefined, 'failed activation should not remain persisted in the profile namespace');
  equal(controller.getEffectiveProfile('graph-plus', 'default').dimensions, '2d', 'rollback should restore the prior effective dimension');
  equal(attempts, 2, 'rollback should run the change hook again to restore any sessions switched before the failure');
});

test('I-UI-02 region-boundary preference persists per consumer profile and resets to its default', async () => {
  const profiles = new ConsumerProfileRegistry();
  for (const descriptor of createShippedGraphModuleRegistryV1().descriptors()) profiles.registerModule(descriptor);
  profiles.registerConsumer(GRAPH_PLUS_CONSUMER_REGISTRATION_V1);
  profiles.registerConsumer({
    ...GRAPH_PLUS_CONSUMER_REGISTRATION_V1,
    consumerId: 'other-consumer',
    displayName: 'Other consumer',
  });
  const controller = new GraphEngineSettingsControllerV1(profiles, {}, () => undefined, true);
  await controller.setProfileModuleSetting('graph-plus', 'default', 'node-regions', 'boundariesVisible', false);
  await controller.setProfileModuleSetting('other-consumer', 'default', 'node-regions', 'boundariesVisible', true);
  equal(controller.getEffectiveProfile('graph-plus', 'default').modules['node-regions']?.settings.boundariesVisible, false, 'Graph+ should retain its own hidden-boundary choice');
  equal(controller.getEffectiveProfile('other-consumer', 'default').modules['node-regions']?.settings.boundariesVisible, true, 'another consumer should retain an independent choice');
  await controller.setProfileModuleSetting('graph-plus', 'default', 'node-regions', 'boundariesVisible', undefined);
  equal(controller.getEffectiveProfile('graph-plus', 'default').modules['node-regions']?.settings.boundariesVisible, true, 'reset should reveal the Graph+ profile default');
  equal(controller.getProfileOverrides('other-consumer', 'default').modules?.['node-regions']?.settings?.boundariesVisible, true, 'resetting Graph+ should not change another consumer namespace');
});

test('C-SETTING-01 topology weighting is an engine-owned profile setting', async () => {
  const profiles = new ConsumerProfileRegistry();
  for (const descriptor of createShippedGraphModuleRegistryV1().descriptors()) profiles.registerModule(descriptor);
  profiles.registerConsumer(GRAPH_PLUS_CONSUMER_REGISTRATION_V1);
  profiles.registerConsumer({
    ...GRAPH_PLUS_CONSUMER_REGISTRATION_V1,
    consumerId: 'other-consumer',
    displayName: 'Other consumer',
  });
  const controller = new GraphEngineSettingsControllerV1(profiles, {}, () => undefined, true);
  equal(controller.getEffectiveProfile('graph-plus', 'default').modules['force-layout']?.settings.weightingMode, 'topology-weighted', 'the shipped free-layout default should be topology weighted');
  await controller.setProfileModuleSetting('graph-plus', 'default', 'force-layout', 'weightingMode', 'uniform');
  equal(controller.getEffectiveProfile('graph-plus', 'default').modules['force-layout']?.settings.weightingMode, 'uniform', 'Graph+ should persist the engine mode through its profile namespace');
  equal(controller.getEffectiveProfile('other-consumer', 'default').modules['force-layout']?.settings.weightingMode, 'topology-weighted', 'another consumer should retain an independent engine default');
  await controller.setProfileModuleSetting('graph-plus', 'default', 'force-layout', 'weightingMode', undefined);
  equal(controller.getEffectiveProfile('graph-plus', 'default').modules['force-layout']?.settings.weightingMode, 'topology-weighted', 'reset should reveal the engine-backed profile default');
});
