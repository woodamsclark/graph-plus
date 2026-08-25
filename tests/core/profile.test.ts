import type {
  ConsumerProfileDescriptorV1,
  ConsumerRegistrationV1,
  EngineModuleDescriptorV1,
} from '../../src/graph-engine/contracts/v1/index.ts';
import { ConsumerProfileRegistry } from '../../src/graph-engine/core/profile/index.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

function moduleDescriptor(
  id: string,
  overrides: Partial<EngineModuleDescriptorV1> = {},
): EngineModuleDescriptorV1 {
  return {
    id,
    version: '1.0.0',
    displayName: id,
    capabilities: [id],
    settingsSchemaVersion: 1,
    defaultSettings: { strength: 1, mode: 'base', fixed: 'module' },
    ...overrides,
  };
}

function profile(
  profileId: string,
  overrides: Partial<ConsumerProfileDescriptorV1> = {},
): ConsumerProfileDescriptorV1 {
  return {
    profileId,
    displayName: profileId,
    descriptorVersion: 1,
    dimensions: '2d',
    requestedCapabilities: ['render'],
    modules: {
      render: { policy: 'required' },
      filtering: { policy: 'optional', defaultEnabled: true },
      anima: { policy: 'forbidden' },
    },
    ...overrides,
  };
}

function registration(
  consumerId: string,
  profiles: readonly ConsumerProfileDescriptorV1[] = [profile('default')],
): ConsumerRegistrationV1 {
  return {
    consumerId,
    displayName: consumerId,
    consumerVersion: '1.0.0',
    supportedProtocolVersions: [1],
    profiles,
  };
}

function registry(): ConsumerProfileRegistry {
  const value = new ConsumerProfileRegistry();
  value.registerModule(moduleDescriptor('render'));
  value.registerModule(moduleDescriptor('filtering'));
  value.registerModule(moduleDescriptor('anima'));
  return value;
}

test('C-PROFILE-01 keeps multiple archetypes under one consumer', () => {
  const value = registry();
  value.registerConsumer(registration('pattern-smith', [profile('student'), profile('instructor', { dimensions: '3d' })]));
  deepEqual(value.listProfiles().map((entry) => `${entry.consumerId}/${entry.profileId}`), [
    'pattern-smith/student',
    'pattern-smith/instructor',
  ], 'both archetypes should register independently');
  equal(value.resolve('pattern-smith', 'student').dimensions, '2d', 'student dimensions should remain independent');
  equal(value.resolve('pattern-smith', 'instructor').dimensions, '3d', 'instructor dimensions should remain independent');
});

test('C-PROFILE-02 resolves settings in documented precedence order', () => {
  const value = registry();
  value.registerConsumer(registration('xyz', [profile('default', {
    profileSettings: { layer: 'profile' },
    modules: {
      render: { policy: 'required', defaults: { strength: 3, mode: 'profile' } },
    },
  })]));
  value.setUserOverrides('xyz', 'default', {
    profileSettings: { layer: 'user' },
    modules: { render: { settings: { strength: 4, mode: 'user' } } },
  });
  const effective = value.resolve('xyz', 'default', {
    globalOverrides: {
      profileSettings: { layer: 'global' },
      modules: { render: { settings: { strength: 2, mode: 'global' } } },
    },
    sessionOverrides: {
      profileSettings: { layer: 'session' },
      modules: { render: { settings: { strength: 5, mode: 'session' } } },
    },
  });
  equal(effective.profileSettings.layer, 'session', 'session profile setting should win');
  equal(effective.profileSettingSources.layer, 'session', 'effective profile settings should identify their winning layer');
  equal(effective.modules.render.settings.strength, 5, 'session module setting should win');
  equal(effective.modules.render.settingSources.strength, 'session', 'effective module settings should identify their winning layer');
  equal(effective.modules.render.settings.fixed, 'module', 'untouched module default should survive');
  equal(effective.modules.render.settingSources.fixed, 'engine-default', 'untouched module defaults should retain engine provenance');
  equal(effective.modules.render.enabledSource, 'consumer-profile', 'required policy should own module enablement');
});

test('C-PROFILE-03 enforces required optional and forbidden module policies', () => {
  const value = registry();
  value.registerConsumer(registration('xyz'));
  const effective = value.resolve('xyz', 'default', {
    sessionOverrides: {
      modules: {
        render: { enabled: false },
        filtering: { enabled: false },
        anima: { enabled: true },
      },
    },
  });
  equal(effective.modules.render.enabled, true, 'required module must remain enabled');
  equal(effective.modules.filtering.enabled, false, 'optional module may be disabled');
  equal(effective.modules.anima.enabled, false, 'forbidden module must remain disabled');
  equal(effective.issues.filter((issue) => issue.code === 'invalid-override').length, 2, 'locked policy attempts should be reported');
});

test('C-PROFILE-04 enforces constraints and locked values', () => {
  const value = registry();
  value.registerConsumer(registration('xyz', [profile('default', {
    modules: {
      render: {
        policy: 'required',
        defaults: { strength: 3, mode: 'profile', fixed: 'profile' },
        constraints: {
          strength: { type: 'number', min: 1, max: 5 },
          mode: { type: 'enum', allowed: ['profile', 'allowed'] },
          fixed: { type: 'readonly' },
        },
        lockedValues: { locked: 'author' },
      },
    },
  })]));
  value.setUserOverrides('xyz', 'default', {
    modules: { render: { settings: { strength: 9, mode: 'forbidden', fixed: 'user', locked: 'user' } } },
  });
  const effective = value.resolve('xyz', 'default', {
    sessionOverrides: { modules: { render: { settings: { locked: 'session' } } } },
  });
  equal(effective.modules.render.settings.strength, 3, 'out-of-range override should be rejected');
  equal(effective.modules.render.settings.mode, 'profile', 'invalid enum override should be rejected');
  equal(effective.modules.render.settings.fixed, 'profile', 'read-only override should be rejected');
  equal(effective.modules.render.settings.locked, 'author', 'locked author value should win last');
  equal(effective.issues.filter((issue) => issue.code === 'invalid-override').length, 2, 'invalid constrained values should be reported');
  assert(effective.issues.some((issue) => issue.code === 'locked-setting'), 'read-only attempt should be reported');
});

test('C-PROFILE-05 preserves user overrides across descriptor re-registration', () => {
  const value = registry();
  value.registerConsumer(registration('xyz'));
  value.setUserOverrides('xyz', 'default', { modules: { filtering: { settings: { strength: 4 } } } });
  value.registerConsumer(registration('xyz', [profile('default', {
    descriptorVersion: 2,
    modules: {
      render: { policy: 'required' },
      filtering: { policy: 'optional', constraints: { strength: { type: 'number', max: 3 } } },
      anima: { policy: 'forbidden' },
    },
  })]));
  const effective = value.resolve('xyz', 'default');
  equal(effective.descriptorVersion, 2, 'new descriptor should replace old descriptor');
  equal(effective.modules.filtering.settings.strength, 1, 'newly invalid saved override should be rejected');
  assert(effective.issues.some((issue) => issue.path === 'user.modules.filtering.settings.strength'), 'rejected saved override should be reported');
});

test('C-PROFILE-06 retains inactive consumer profiles until explicit deletion', () => {
  const value = registry();
  value.registerConsumer(registration('xyz'));
  value.markConsumerInactive('xyz');
  equal(value.listProfiles()[0].active, false, 'unregistered consumer should remain visible as inactive');
  value.deleteConsumer('xyz');
  deepEqual(value.listProfiles(), [], 'explicit delete should remove stored profile');
});

test('C-PROFILE-07 isolates identical profile IDs by consumer namespace', () => {
  const value = registry();
  value.registerConsumer(registration('first'));
  value.registerConsumer(registration('second'));
  value.setUserOverrides('first', 'default', { profileSettings: { owner: 'first' } });
  value.setUserOverrides('second', 'default', { profileSettings: { owner: 'second' } });
  equal(value.resolve('first', 'default').profileSettings.owner, 'first', 'first namespace should retain its override');
  equal(value.resolve('second', 'default').profileSettings.owner, 'second', 'second namespace should retain its override');
});

test('C-PROFILE-08 resolves only allowed dimension overrides in normal precedence', () => {
  const value = registry();
  value.registerConsumer(registration('xyz', [profile('default', {
    dimensions: '2d',
    allowedDimensions: ['2d', '3d'],
  })]));
  value.setUserOverrides('xyz', 'default', { dimensions: '3d' });
  let effective = value.resolve('xyz', 'default');
  equal(effective.dimensions, '3d', 'allowed user dimension should override the profile default');
  equal(effective.dimensionsSource, 'user-profile', 'dimension source should identify the user profile');
  effective = value.resolve('xyz', 'default', { sessionOverrides: { dimensions: '2d' } });
  equal(effective.dimensions, '2d', 'allowed session dimension should win last');
  equal(effective.dimensionsSource, 'session', 'dimension source should identify the session');
});

test('C-PROFILE-09 keeps a one-dimension profile locked', () => {
  const value = registry();
  value.registerConsumer(registration('xyz', [profile('default', {
    dimensions: '2d',
    allowedDimensions: ['2d'],
  })]));
  value.setUserOverrides('xyz', 'default', { dimensions: '3d' });
  const effective = value.resolve('xyz', 'default', { sessionOverrides: { dimensions: '3d' } });
  equal(effective.dimensions, '2d', 'disallowed overrides must not change a locked profile');
  equal(effective.dimensionsSource, 'locked', 'one allowed dimension should report locked provenance');
  equal(effective.issues.filter((issue) => issue.path.endsWith('.dimensions')).length, 2, 'each disallowed layer should report locally');
});

test('C-PROFILE-10 clones and isolates UI and interaction policy by profile namespace', () => {
  const value = registry();
  const actionIds = ['open-node'];
  const controls: Record<string, 'shown' | 'hidden'> = { 'filter.clear': 'hidden' };
  value.registerConsumer(registration('first', [profile('default', {
    uiDefaults: {
      quickSettingsVisibility: 'collapsed',
      quickSettingsSections: { filter: { visibility: 'shown', controls } },
      contextMenuEnabled: true,
      dimensionControlVisible: true,
    },
    interaction: { activationActionIds: actionIds },
  })]));
  value.registerConsumer(registration('second', [profile('default', {
    uiDefaults: { quickSettingsVisibility: 'hidden', contextMenuEnabled: false },
    interaction: { activationActionIds: ['start-drill'] },
  })]));
  actionIds.push('caller-mutation');
  controls['form.mind-map'] = 'shown';
  const first = value.resolve('first', 'default');
  const second = value.resolve('second', 'default');
  deepEqual(first.interaction?.activationActionIds, ['open-node'], 'registered action ordering should not share caller arrays');
  deepEqual(first.uiDefaults?.quickSettingsSections?.filter?.controls, { 'filter.clear': 'hidden' }, 'registered UI policy should not share caller records');
  equal(second.uiDefaults?.quickSettingsVisibility, 'hidden', 'another consumer should retain its own UI policy');
  deepEqual(second.interaction?.activationActionIds, ['start-drill'], 'another consumer should retain its own actions');
});

test('dimension and interaction registration rejects invalid policy shapes', () => {
  const value = registry();
  let rejectedDefault = false;
  try {
    value.registerConsumer(registration('bad-default', [profile('default', {
      dimensions: '3d',
      allowedDimensions: ['2d'],
    })]));
  } catch { rejectedDefault = true; }
  equal(rejectedDefault, true, 'profile default must be included in allowed dimensions');

  let rejectedActions = false;
  try {
    value.registerConsumer(registration('bad-actions', [profile('default', {
      interaction: { activationActionIds: ['same', 'same'] },
    })]));
  } catch { rejectedActions = true; }
  equal(rejectedActions, true, 'interaction action IDs must be unique');
});

test('opaque consumer and profile IDs cannot collide through display-key separators', () => {
  const value = registry();
  value.registerConsumer(registration('a/b', [profile('c')]));
  value.registerConsumer(registration('a', [profile('b/c')]));
  value.setUserOverrides('a/b', 'c', { profileSettings: { owner: 'first' } });
  value.setUserOverrides('a', 'b/c', { profileSettings: { owner: 'second' } });
  equal(value.resolve('a/b', 'c').profileSettings.owner, 'first', 'first opaque tuple should retain its override');
  equal(value.resolve('a', 'b/c').profileSettings.owner, 'second', 'second opaque tuple should retain its override');
});

test('module dependency and conflict issues are fatal before session activation', () => {
  const value = registry();
  value.registerModule(moduleDescriptor('base'));
  value.registerModule(moduleDescriptor('dependent', { dependencies: ['base'] }));
  value.registerModule(moduleDescriptor('conflicting', { conflicts: ['dependent'] }));
  value.registerConsumer(registration('xyz', [profile('default', {
    modules: {
      base: { policy: 'optional', defaultEnabled: false },
      dependent: { policy: 'required' },
      conflicting: { policy: 'required' },
    },
  })]));
  const effective = value.resolve('xyz', 'default');
  assert(effective.issues.some((issue) => issue.code === 'missing-dependency' && issue.fatal), 'missing dependency should be fatal');
  assert(effective.issues.some((issue) => issue.code === 'module-conflict' && issue.fatal), 'conflict should be fatal');
});

test('registered module and profile descriptors do not share caller-owned arrays', () => {
  const value = new ConsumerProfileRegistry();
  const defaultValues = ['original'];
  value.registerModule(moduleDescriptor('render', { defaultSettings: { values: defaultValues } }));
  const allowed = ['allowed'];
  const descriptor = profile('default', {
    modules: {
      render: {
        policy: 'required',
        constraints: { mode: { type: 'enum', allowed } },
      },
    },
  });
  value.registerConsumer(registration('xyz', [descriptor]));
  defaultValues.push('caller-mutation');
  allowed.push('later-added');
  value.setUserOverrides('xyz', 'default', { modules: { render: { settings: { mode: 'later-added' } } } });
  const effective = value.resolve('xyz', 'default');
  deepEqual(effective.modules.render.settings.values, ['original'], 'module defaults should be cloned on registration');
  assert(effective.issues.some((issue) => issue.path.endsWith('.mode')), 'constraint allowed values should be cloned on registration');
});
