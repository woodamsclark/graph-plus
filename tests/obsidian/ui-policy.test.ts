import {
  GRAPH_QUICK_SETTINGS_CONTROL_IDS_V1 as CONTROLS,
  GRAPH_QUICK_SETTINGS_SECTION_IDS_V1 as SECTIONS,
  type ConsumerProfileDescriptorV1,
} from '../../src/graph-engine/contracts/v1/index.ts';
import {
  graphUiControlIsShownV1,
  graphUiSectionIsShownV1,
  resolveGraphSessionUiPolicyV1,
} from '../../src/obsidian/graph-engine-ui/GraphEngineUiPolicy.ts';
import { GraphEngineQuickSettingsDisclosureStateV1 } from '../../src/obsidian/graph-engine-ui/GraphEngineQuickSettingsDisclosureState.ts';
import { isQuickSettingsToggleKeyV1 } from '../../src/obsidian/graph-engine-ui/GraphEngineQuickSettingsShortcut.ts';
import { equal, test } from '../support/harness.ts';

function descriptor(): ConsumerProfileDescriptorV1 {
  return {
    profileId: 'default',
    displayName: 'Default',
    descriptorVersion: 1,
    dimensions: '3d',
    requestedCapabilities: ['render'],
    modules: {},
    uiDefaults: {
      quickSettingsVisibility: 'collapsed',
      quickSettingsSections: {
        [SECTIONS.filter]: {
          visibility: 'shown',
          controls: { [CONTROLS.clearFilter]: 'shown' },
        },
        [SECTIONS.forces]: { visibility: 'hidden' },
      },
      contextMenuEnabled: true,
    },
  };
}

test('R-UI-01 session UI options specialize profile defaults without changing undeclared policy', () => {
  const contribution = { id: 'consumer.due', sectionId: 'consumer-review', mount: () => undefined };
  const policy = resolveGraphSessionUiPolicyV1(descriptor(), {
    quickSettings: {
      visibility: 'shown',
      sections: {
        [SECTIONS.filter]: { controls: { [CONTROLS.clearFilter]: 'hidden' } },
        [SECTIONS.display]: { visibility: 'hidden' },
      },
      contributions: [contribution],
    },
    contextMenu: { enabled: false },
    hostOcclusions: [{ x: 1, y: 2, width: 3, height: 4 }],
  });
  equal(policy.quickSettings.visibility, 'shown', 'session visibility should override the profile default');
  equal(graphUiSectionIsShownV1(policy, SECTIONS.filter), true, 'an inherited visible section should remain visible');
  equal(graphUiControlIsShownV1(policy, SECTIONS.filter, CONTROLS.clearFilter), false, 'session control policy should override the profile default');
  equal(graphUiSectionIsShownV1(policy, SECTIONS.forces), false, 'an inherited hidden section should remain hidden');
  equal(graphUiSectionIsShownV1(policy, SECTIONS.display), false, 'a session may hide another stock section');
  equal(policy.quickSettings.contributions[0], contribution, 'consumer contributions should survive policy resolution');
  equal(policy.contextMenu.enabled, false, 'session context-menu policy should override the profile default');
  equal(policy.hostOcclusions.length, 1, 'session host occlusions should be retained');
});

test('R-UI-02 hiding UI controls is independent of engine module policy', () => {
  const value = descriptor();
  const policy = resolveGraphSessionUiPolicyV1(value, {
    quickSettings: { sections: { [SECTIONS.form]: { visibility: 'hidden' } } },
  });
  equal(graphUiSectionIsShownV1(policy, SECTIONS.form), false, 'the Form UI section should be hidden');
  equal(value.modules.form, undefined, 'resolving visibility must not synthesize or mutate module policy');
});

test('R-UI-04 quick-setting disclosures retain their user state across panel renders', () => {
  const disclosures = new GraphEngineQuickSettingsDisclosureStateV1();
  equal(disclosures.resolve(SECTIONS.forces, false), false, 'a section should begin at its declared default');
  disclosures.remember(SECTIONS.forces, true);
  equal(disclosures.resolve(SECTIONS.forces, false), true, 'an opened section should remain open after controls rerender');
  disclosures.remember(SECTIONS.filter, false);
  equal(disclosures.resolve(SECTIONS.filter, true), false, 'a closed default-open section should remain closed after controls rerender');
});

test('Tab toggles Quick Settings from the graph without consuming control navigation', () => {
  const event = (overrides: Partial<KeyboardEvent> = {}) => ({
    key: 'Tab', defaultPrevented: false, repeat: false, isComposing: false,
    ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    target: { closest: () => null },
    ...overrides,
  }) as KeyboardEvent;
  equal(isQuickSettingsToggleKeyV1(event()), true, 'plain Tab on the graph should toggle Quick Settings');
  equal(isQuickSettingsToggleKeyV1(event({ shiftKey: true })), false,
    'Shift-Tab should retain normal reverse focus navigation');
  equal(isQuickSettingsToggleKeyV1(event({ repeat: true })), false,
    'holding Tab should not repeatedly flicker the panel');
  equal(isQuickSettingsToggleKeyV1(event({
    target: { closest: () => ({}) } as unknown as EventTarget,
  })), false, 'Tab on an interactive Quick Settings control should retain normal focus navigation');
});
