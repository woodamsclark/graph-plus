import type { ConsumerRegistrationV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import { ConsumerProfileRegistry } from '../../src/graph-engine/core/profile/index.ts';
import {
  GRAPH_PLUS_CONSUMER_REGISTRATION_V1,
  migrateGraphPlusProfileOverridesV17,
} from '../../src/graph-plus/consumer/index.ts';
import { createShippedGraphModuleRegistryV1 } from '../../src/graph-engine/runtime/index.ts';
import { GraphEngineSettingsControllerV1 } from '../../src/obsidian/settings/GraphEngineSettingsController.ts';
import { GRAPH_SETTING_PRESENTATIONS_V1 } from '../../src/obsidian/settings/GraphEngineSettingsCatalog.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

test('Graph+ releases dragged nodes while retaining explicit context-menu pinning', () => {
  const profile = GRAPH_PLUS_CONSUMER_REGISTRATION_V1.profiles[0];
  equal(GRAPH_PLUS_CONSUMER_REGISTRATION_V1.displayName, 'graph+', 'bundled product name should use lowercase branding');
  equal(GRAPH_PLUS_CONSUMER_REGISTRATION_V1.consumerVersion, '2.0.0', 'bundled Graph+ should match the feature release');
  equal(profile?.uiDefaults?.quickSettingsVisibility, 'collapsed', 'Graph+ controls should begin as the minimized launcher');
  equal(profile?.uiDefaults?.quickSettingsSections?.camera?.visibility, 'hidden',
    'Graph+ quick settings should not expose a redundant Camera section');
  deepEqual(GRAPH_PLUS_CONSUMER_REGISTRATION_V1.profiles[0]?.interaction?.contextActionIds,
    ['open-node'], 'Graph+ should keep note preview as a transient hover interaction');
  equal(createShippedGraphModuleRegistryV1().get('rendering')?.descriptor.defaultSettings.nodeRadiusScale, 2,
    'the shipped Graph Engine node-size default should be 2.0');
  equal(createShippedGraphModuleRegistryV1().get('rendering')?.descriptor.defaultSettings.edgeThicknessScale, 0.1,
    'the shipped Graph Engine link-thickness default should be 0.10');
  equal(createShippedGraphModuleRegistryV1().get('anima')?.descriptor.defaultSettings.nodeWorldScaleBlend, 0,
    'the shipped Graph Engine zoomed node size should default to its calmest response');
  equal(profile?.profileSettings?.dragRelease, 'dynamic', 'drag release should return an unpinned node to the active layout');
  equal(profile?.uiDefaults?.contextMenuEnabled, true, 'the right-click menu should remain available for explicit pinning');
  equal(profile?.uiDefaults?.coreContextActions?.['toggle-pin'], undefined, 'the core Pin node action should remain visible by default');
  equal(profile?.profileSettings?.dragConstraint, 'transient', 'Graph+ should use a temporary drag constraint instead of implicit pinning');
});

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

test('V1.9 failed global and profile settings transactions restore their prior values', async () => {
  const profiles = new ConsumerProfileRegistry();
  for (const descriptor of createShippedGraphModuleRegistryV1().descriptors()) profiles.registerModule(descriptor);
  profiles.registerConsumer(GRAPH_PLUS_CONSUMER_REGISTRATION_V1);
  let attempts = 0;
  let failNext = true;
  const controller = new GraphEngineSettingsControllerV1(profiles, {}, () => {
    attempts += 1;
    if (failNext) {
      failNext = false;
      throw new Error('persistence failed');
    }
  }, true);

  let globalRejected = false;
  try { await controller.setGlobalModuleSetting('rendering', 'nodeRadiusScale', 3); } catch { globalRejected = true; }
  equal(globalRejected, true, 'the persistence error should reach the global settings caller');
  equal(controller.getGlobalOverrides().modules?.rendering, undefined,
    'a failed global write should restore the previous override graph');
  equal(attempts, 2, 'global rollback should reapply the previous live state');

  failNext = true;
  let profileRejected = false;
  try {
    await controller.setProfileModuleSetting('graph-plus', 'default', 'rendering', 'nodeRadiusScale', 4);
  } catch {
    profileRejected = true;
  }
  equal(profileRejected, true, 'the persistence error should reach the profile settings caller');
  equal(controller.getProfileOverrides('graph-plus', 'default').modules?.rendering, undefined,
    'a failed profile write should restore the previous override graph');
  equal(attempts, 4, 'profile rollback should use the same transaction semantics as global settings');
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
  equal(controller.getEffectiveProfile('graph-plus', 'default').modules['node-regions']?.settings.boundariesVisible, false, 'reset should reveal the Graph+ hidden-boundary default');
  equal(controller.getProfileOverrides('other-consumer', 'default').modules?.['node-regions']?.settings?.boundariesVisible, true, 'resetting Graph+ should not change another consumer namespace');
});

test('C-SETTING-01 migration retires the topology mode selector', () => {
  const profiles = new ConsumerProfileRegistry();
  for (const descriptor of createShippedGraphModuleRegistryV1().descriptors()) profiles.registerModule(descriptor);
  profiles.registerConsumer(GRAPH_PLUS_CONSUMER_REGISTRATION_V1);
  profiles.registerConsumer({
    ...GRAPH_PLUS_CONSUMER_REGISTRATION_V1,
    consumerId: 'other-consumer',
    displayName: 'Other consumer',
  });
  const migrated = migrateGraphPlusProfileOverridesV17({
    modules: { 'force-layout': { settings: { weightingMode: 'uniform', springLength: 180 } } },
  });
  equal(migrated.modules?.['force-layout']?.settings?.weightingMode, undefined,
    'retired uniform selections should be discarded');
  equal(migrated.modules?.['force-layout']?.settings?.springLength, 180,
    'migration should preserve supported sibling settings');
});

test('V1.7 settings catalog exposes only curated typed controls', () => {
  const ids = GRAPH_SETTING_PRESENTATIONS_V1.map((value) => value.id);
  equal(new Set(ids).size, ids.length, 'catalog IDs should be unique across full and quick settings');
  equal(ids.some((id) => /weighting|settling|alpha|barnes|affinity|maxSpeed/i.test(id)), false,
    'ordinary settings must not expose retired modes or solver internals');
  equal(GRAPH_SETTING_PRESENTATIONS_V1.every((value) =>
    value.control.type === 'toggle' || value.control.type === 'select' || value.control.type === 'slider'), true,
  'every curated setting should have a semantic non-text control');
  const stiffness = GRAPH_SETTING_PRESENTATIONS_V1.find((value) => value.id === 'force-layout.axialSpringStiffness');
  equal(stiffness?.control.type === 'slider' ? stiffness.control.max : undefined, 90,
    'axial stiffness should share the contracted 90 percent ceiling');
  const quality = GRAPH_SETTING_PRESENTATIONS_V1.find((value) => value.id === 'rendering.renderQuality');
  deepEqual(quality?.scopes, ['global', 'profile'], 'render quality should live in full settings without crowding quick settings');
  equal(quality?.control.type, 'select', 'render quality should use named choices rather than free-form text');
  const nodeZoomResponse = GRAPH_SETTING_PRESENTATIONS_V1.find((value) => value.id === 'anima.nodeWorldScaleBlend');
  equal(nodeZoomResponse?.name, 'Node zoom response', 'the scaling control should describe its camera response');
  equal(nodeZoomResponse?.control.type === 'slider' ? nodeZoomResponse.control.storageScale : undefined, 0.01,
    'node zoom response should display as a percentage while storing a normalized response');
});

test('V1.7 global catalog values flow into Graph+ until its profile overrides them', async () => {
  const profiles = new ConsumerProfileRegistry();
  for (const descriptor of createShippedGraphModuleRegistryV1().descriptors()) profiles.registerModule(descriptor);
  profiles.registerConsumer(GRAPH_PLUS_CONSUMER_REGISTRATION_V1);
  const controller = new GraphEngineSettingsControllerV1(profiles, {}, () => undefined, true);
  await controller.setGlobalModuleSetting('rendering', 'nodeRadiusScale', 2);
  equal(controller.getEffectiveProfile('graph-plus', 'default').modules.rendering?.settings.nodeRadiusScale, 2,
    'main-page global values should not be shadowed by duplicate Graph+ defaults');
  await controller.setProfileModuleSetting('graph-plus', 'default', 'rendering', 'nodeRadiusScale', 3);
  equal(controller.getEffectiveProfile('graph-plus', 'default').modules.rendering?.settings.nodeRadiusScale, 3,
    'profile customization should remain the intentional stronger override');
  await controller.setProfileModuleSetting('graph-plus', 'default', 'rendering', 'nodeRadiusScale', undefined);
  equal(controller.getEffectiveProfile('graph-plus', 'default').modules.rendering?.settings.nodeRadiusScale, 2,
    'resetting one profile value should reveal Global again');
});
