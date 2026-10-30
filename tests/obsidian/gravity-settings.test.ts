import { ConsumerProfileRegistry } from '../../src/graph-engine/core/profile/index.ts';
import { createShippedGraphModuleRegistryV1 } from '../../src/graph-engine/runtime/modules/shipped/ShippedGraphModules.ts';
import { GraphEngineProviderCoreV1, type GraphEngineSessionUiMountContextV1 } from '../../src/graph-engine/service/index.ts';
import { GRAPH_UNIFORM_FORCE_CAPABILITY_V1, GRAPH_QUICK_SETTINGS_CONTROL_IDS_V1 } from '../../packages/graph-engine-client/src/graph-engine/public.ts';
import type { GraphDimensionsV1, GraphEffectiveSettingsV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import { GRAPH_PLUS_CONSUMER_REGISTRATION_V1 } from '../../src/graph-plus/consumer/GraphPlusRegistration.ts';
import { GraphEngineQuickSettingsPanelV1 } from '../../src/obsidian/graph-engine-ui/GraphEngineQuickSettingsPanel.ts';
import type { EffectiveGraphSessionUiPolicyV1 } from '../../src/obsidian/graph-engine-ui/GraphEngineUiPolicy.ts';
import { GraphEngineSettingsControllerV1 } from '../../src/obsidian/settings/GraphEngineSettingsController.ts';
import { GraphEngineSettingsPanelV1 } from '../../src/obsidian/settings/GraphEngineSettingsPanel.ts';
import { GraphEngineSettingsUpdatesV1 } from '../../src/obsidian/settings/GraphEngineSettingsUpdates.ts';
import { GRAPH_SETTING_PRESENTATIONS_V1 } from '../../src/obsidian/settings/GraphEngineSettingsCatalog.ts';
import { InstrumentedPlatform, runtimeFixture, runtimeHarness } from '../support/runtimeHarness.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('gravity settings share signed controls across global, profile and quick scopes', () => {
  const toggle = GRAPH_SETTING_PRESENTATIONS_V1.find(p => p.id === 'force-layout.gravityEnabled');
  equal(toggle?.control.type, 'toggle', 'enable control is semantic');
  for (const axis of ['X', 'Y', 'Z']) {
    const entry = GRAPH_SETTING_PRESENTATIONS_V1.find(p => p.id === `force-layout.gravity${axis}`);
    assert(entry?.control.type === 'slider', 'each axis has a numeric control');
    deepEqual(entry.scopes, ['global', 'profile', 'quick'], 'same values are configurable in every scope');
    equal(entry.control.min, -100, 'axis can point backward'); equal(entry.control.max, 100, 'axis can point forward');
    equal(entry.control.step, 0.1, 'small coefficients are editable');
  }
});

test('global gravity settings render off by default and persist signed vector edits', async () => {
  const runtime = runtimeHarness();
  const profiles = new ConsumerProfileRegistry();
  for (const descriptor of createShippedGraphModuleRegistryV1().descriptors()) profiles.registerModule(descriptor);
  profiles.registerConsumer(GRAPH_PLUS_CONSUMER_REGISTRATION_V1);
  let saves = 0;
  const controller = new GraphEngineSettingsControllerV1(profiles, {}, () => { saves++; });
  const host = runtime.document.createElement('div');
  Object.defineProperty(host, 'createEl', { value: (tag: string, options?: { text?: string }) => {
    const node = runtime.document.createElement(tag); node.textContent = options?.text ?? ''; host.append(node); return node;
  } });
  new GraphEngineSettingsPanelV1(controller).renderGlobal(host, () => {});
  const toggle = host.querySelector<HTMLInputElement>('[data-name="Gravity"] input[type=checkbox]')!;
  equal(toggle.checked, false, 'full settings starts off');
  toggle.checked = true; toggle.dispatchEvent(new runtime.window.Event('change') as unknown as Event); await settle();
  const x = host.querySelector<HTMLInputElement>('[data-name="Gravity X"] input[type=range]')!;
  x.value = '-1.5'; x.dispatchEvent(new runtime.window.Event('change') as unknown as Event); await settle();
  equal(controller.getGlobalOverrides().modules?.['force-layout']?.settings?.gravityEnabled, true, 'global enable is saved');
  equal(controller.getGlobalOverrides().modules?.['force-layout']?.settings?.gravityX, -1.5, 'negative component is saved');
  equal(controller.getEffectiveProfile('graph-plus', 'default').modules['force-layout'].settings.gravityX, -1.5, 'consumer inherits global direction');
  assert(saves >= 2, 'user edits request persistence');
  const restored = new GraphEngineSettingsControllerV1(profiles, JSON.parse(JSON.stringify(controller.getGlobalOverrides())), () => {});
  equal(restored.getEffectiveProfile('graph-plus', 'default').modules['force-layout'].settings.gravityEnabled, true, 'JSON reload preserves enable');
  await controller.setProfileModuleSetting('graph-plus', 'default', 'force-layout', 'gravityX', 2);
  equal(controller.getEffectiveProfile('graph-plus', 'default').modules['force-layout'].settings.gravityX, 2, 'profile can override global force');
  await controller.setProfileModuleSetting('graph-plus', 'default', 'force-layout', 'gravityX', undefined);
  equal(controller.getEffectiveProfile('graph-plus', 'default').modules['force-layout'].settings.gravityX, -1.5, 'profile reset reveals global force');
});

async function quickFixture(dimensions: GraphDimensionsV1, hideY = false) {
  const runtime = runtimeHarness({ consumerId: 'graph-plus', profileId: 'default', registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1 });
  runtime.profiles.setUserOverrides('graph-plus', 'default', { dimensions });
  const clock = new InstrumentedPlatform(runtime.window);
  let context!: GraphEngineSessionUiMountContextV1;
  const saved: unknown[] = [];
  const updates = new GraphEngineSettingsUpdatesV1(clock, () => runtime.factory.refreshActiveProfiles(), async () => { saved.push(runtime.profiles.getUserOverrides('graph-plus', 'default')); }, error => { throw error; });
  const capabilities = [...new Set(createShippedGraphModuleRegistryV1().descriptors().flatMap(module => module.capabilities))];
  const provider = new GraphEngineProviderCoreV1({ engineVersion: '2.0.5', engineInstanceId: 'gravity-ui-test', capabilities,
    profiles: runtime.profiles, sessions: runtime.factory, onProfilesChanged: mode => updates.update(mode),
    sessionUiHost: { mount: value => { context = value; return { dispose() {} }; } },
  });
  const connected = provider.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: [GRAPH_UNIFORM_FORCE_CAPABILITY_V1] });
  assert(connected.ok, 'consumer negotiates gravity support from client capability');
  const session = await connected.lease.createSession({ consumerId: 'graph-plus', profileId: 'default', container: runtime.container, document: runtimeFixture() });
  const policy = { quickSettings: { visibility: 'shown', sections: hideY ? { forces: { controls: { [GRAPH_QUICK_SETTINGS_CONTROL_IDS_V1.gravityY]: 'hidden' } } } : {}, contributions: [] }, contextMenu: { enabled: false, coreActions: {} }, hostOcclusions: [] } as EffectiveGraphSessionUiPolicyV1;
  const panel = new GraphEngineQuickSettingsPanelV1(context, policy);
  const host = runtime.document.createElement('div'); runtime.container.append(host);
  const probe = panel as unknown as { renderForces(parent: HTMLElement, effective: GraphEffectiveSettingsV1, contributions: []): void };
  probe.renderForces(host, await session.exportEffectiveSettings(), []);
  return { ...runtime, session, context, host, clock, saved,
    async close() { panel.dispose(); await updates.close(); await provider.dispose(); },
  };
}

test('Quick Settings gravity toggle and signed sliders update real profiles and live sessions', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = await quickFixture(dimensions);
    try {
      const row = value.host.querySelector<HTMLElement>('[data-name="Gravity"]')!;
      const toggle = row.querySelector<HTMLInputElement>('input[type=checkbox]')!;
      const axes = value.host.querySelector<HTMLElement>('.graph-engine-conditional-control')!;
      equal(toggle.checked, false, 'Quick Settings starts off'); equal(axes.hidden, true, 'axes start collapsed');
      toggle.checked = true; toggle.dispatchEvent(new value.window.Event('change') as unknown as Event); await settle();
      equal(axes.hidden, false, 'toggle immediately exposes axes');
      equal((await value.session.exportEffectiveSettings()).modules['force-layout'].settings.gravityEnabled, true, 'toggle reaches running session');
      const x = value.host.querySelector<HTMLInputElement>('[aria-label="Gravity X value"]')!;
      for (const next of ['-0.5', '-1.5', '2.5']) { x.value = next; x.dispatchEvent(new value.window.Event('input') as unknown as Event); }
      equal(value.context.profileSettings.getUserOverrides().modules?.['force-layout']?.settings?.gravityX, 2.5, 'typing updates profile immediately');
      value.clock.flushFrame();
      equal((await value.session.exportEffectiveSettings()).modules['force-layout'].settings.gravityX, 2.5, 'latest vector reaches physics before release');
      equal(value.host.querySelector('[aria-label="Gravity X value"]'), x, 'live edits retain the active input');
      x.dispatchEvent(new value.window.Event('blur') as unknown as Event); await settle();
      assert(value.saved.length > 0, 'completed edits are persisted');
      const z = value.host.querySelector<HTMLInputElement>('[aria-label="Gravity Z value"]');
      equal(z !== null, dimensions === '3d', 'Z is available only in spatial Quick Settings');
      toggle.checked = false; toggle.dispatchEvent(new value.window.Event('change') as unknown as Event); await settle();
      equal(axes.hidden, true, 'toggle collapses axes');
      const effective = (await value.session.exportEffectiveSettings()).modules['force-layout'].settings;
      equal(effective.gravityEnabled, false, 'off reaches session'); equal(effective.gravityX, 2.5, 'off preserves configured direction and strength');
    } finally { await value.close(); }
  }
});

test('consumer Quick Settings policy can hide individual gravity components', async () => {
  const value = await quickFixture('3d', true);
  try {
    equal(value.host.querySelector('[aria-label="Gravity Y value"]'), null, 'consumer hides Y without replacing gravity implementation');
    assert(value.host.querySelector('[aria-label="Gravity X value"]'), 'X remains available');
    assert(value.host.querySelector('[aria-label="Gravity Z value"]'), 'Z remains available');
  } finally { await value.close(); }
});
