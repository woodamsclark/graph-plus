import { ConsumerProfileRegistry } from '../../src/graph-engine/core/profile/index.ts';
import {
  migrateGraphPlusPluginDataV1,
  withEngineSettingsV1,
} from '../../src/obsidian/settings/GraphPlusPluginDataStore.ts';
import { deepEqual, equal, test } from '../support/harness.ts';
import { runtimeRegistration } from '../support/runtimeHarness.ts';

test('profile snapshots restore registrations inactive and retain overrides through re-registration', () => {
  const first = new ConsumerProfileRegistry();
  first.registerConsumer(runtimeRegistration());
  first.setUserOverrides('synthetic-consumer', 'two-dimensional', { profileSettings: { role: 'student' } });
  const snapshot = first.exportSnapshot();
  const second = new ConsumerProfileRegistry();
  second.restoreSnapshot(snapshot);
  equal(second.listProfiles()[0].active, false, 'restored profile should be visible but inactive');
  equal(second.resolve('synthetic-consumer', 'two-dimensional').profileSettings.role, 'student', 'saved override should restore');
  second.registerConsumer(runtimeRegistration());
  equal(second.listProfiles()[0].active, true, 'registration should reactivate a restored consumer');
  equal(second.resolve('synthetic-consumer', 'two-dimensional').profileSettings.role, 'student', 're-registration should preserve override');
});

test('legacy flat settings copy forward into the Graph+ consumer namespace', () => {
  const migrated = migrateGraphPlusPluginDataV1({ base: { showTags: false }, unrelated: { keep: true } });
  equal(migrated.data.consumers.graphPlus.consumerSettings.base.showTags, false, 'legacy consumer setting should migrate');
  deepEqual(migrated.data.unrelated, { keep: true }, 'unknown root data should survive migration');
  equal(migrated.data.engine.settingsSchemaVersion, 1, 'engine namespace should initialize independently');
});

test('engine corruption recovers without replacing readable Graph+ consumer data', () => {
  const first = migrateGraphPlusPluginDataV1({ base: { showTags: false } });
  const namespaced = withEngineSettingsV1(first.data, { profileSettings: { theme: 'quiet' } }, {
    schemaVersion: 1,
    consumers: [],
  });
  const corrupt = { ...namespaced, engine: { settingsSchemaVersion: 99, globalSettings: 'bad', profileOverrides: null } };
  const recovered = migrateGraphPlusPluginDataV1(corrupt);
  equal(recovered.data.consumers.graphPlus.consumerSettings.base.showTags, false, 'consumer namespace should remain readable');
  deepEqual(recovered.data.engine.globalSettings, {}, 'only corrupt engine namespace should reset');
});
