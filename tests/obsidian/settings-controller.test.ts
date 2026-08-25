import type { ConsumerRegistrationV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import { ConsumerProfileRegistry } from '../../src/graph-engine/core/profile/index.ts';
import { GRAPH_PLUS_CONSUMER_REGISTRATION_V1 } from '../../src/graph-plus/consumer/index.ts';
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
  equal(controller.getEffectiveProfile('graph-plus', 'default').dimensions, '3d', 'reset should reveal the consumer default');
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
