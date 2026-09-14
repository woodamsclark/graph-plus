import { ConsumerProfileRegistry } from '../../src/graph-engine/core/profile/index.ts';
import type { GraphDocumentV1, GraphViewStateV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import {
  GraphPlusCheckpointFileStoreV1,
  type GraphPlusCheckpointFileAdapterV1,
} from '../../src/obsidian/settings/GraphPlusCheckpointFileStore.ts';
import {
  migrateGraphPlusPluginDataV1,
  readGraphPlusCheckpointV1,
  withEngineSettingsV1,
  withGraphPlusCheckpointV1,
  withGraphPlusGenericLensMigratedV1,
} from '../../src/obsidian/settings/GraphPlusPluginDataStore.ts';
import { createDefaultGraphPlusLensV1 } from '../../src/graph-plus/query/index.ts';
import { graphDocument, graphNode } from '../support/contractFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';
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
  equal(migrated.data.consumers.graphPlus.consumerSettings.showTags, false, 'legacy consumer setting should migrate');
  deepEqual(migrated.data.unrelated, { keep: true }, 'unknown root data should survive migration');
  equal(migrated.data.engine.settingsSchemaVersion, 1, 'engine namespace should initialize independently');
});

test('Graph+ color overrides migrate additively and discard invalid values', () => {
  const migrated = migrateGraphPlusPluginDataV1({
    consumers: {
      graphPlus: {
        dataSchemaVersion: 1,
        consumerSettings: {
          colors: { background: '#123ABC', noteNode: 'invalid', tagNode: '#fedcba' },
        },
      },
    },
  });
  deepEqual(migrated.data.consumers.graphPlus.consumerSettings.colors, {
    background: '#123abc',
    tagNode: '#fedcba',
  }, 'valid color overrides should normalize while invalid saved values return to theme ownership');
});

test('engine corruption recovers without replacing readable Graph+ consumer data', () => {
  const first = migrateGraphPlusPluginDataV1({ base: { showTags: false } });
  const namespaced = withEngineSettingsV1(first.data, { profileSettings: { theme: 'quiet' } }, {
    schemaVersion: 1,
    consumers: [],
  });
  const corrupt = { ...namespaced, engine: { settingsSchemaVersion: 99, globalSettings: 'bad', profileOverrides: null } };
  const recovered = migrateGraphPlusPluginDataV1(corrupt);
  equal(recovered.data.consumers.graphPlus.consumerSettings.showTags, false, 'consumer namespace should remain readable');
  deepEqual(recovered.data.engine.globalSettings, {}, 'only corrupt engine namespace should reset');
});

test('V1.1 profile dimension overrides round-trip through the existing additive snapshot', () => {
  const profiles = new ConsumerProfileRegistry();
  profiles.registerConsumer(runtimeRegistration());
  profiles.setUserOverrides('synthetic-consumer', 'two-dimensional', { dimensions: '3d' });
  const initial = migrateGraphPlusPluginDataV1({}).data;
  const stored = withEngineSettingsV1(initial, {}, profiles.exportSnapshot());
  const migrated = migrateGraphPlusPluginDataV1(stored);
  const restored = new ConsumerProfileRegistry();
  restored.restoreSnapshot(migrated.data.engine.profileOverrides);
  equal(restored.resolve('synthetic-consumer', 'two-dimensional').dimensions, '3d', 'additive V1.1 dimension field should survive storage');
  equal(migrated.data.engine.settingsSchemaVersion, 1, 'additive storage should retain the independent V1 settings schema');
});

test('Graph+ checkpoint lens and one-time generic migration marker round-trip additively', () => {
  const initial = migrateGraphPlusPluginDataV1({ unrelated: { retained: true } }).data;
  const lens = { ...createDefaultGraphPlusLensV1(), query: 'tag:course', showTags: false };
  const stored = withGraphPlusCheckpointV1(initial, 'Vault', {
    document: graphDocument({ nodes: [graphNode('a')], edges: [] }),
    lens,
    savedAt: 10,
  });
  const marked = withGraphPlusGenericLensMigratedV1(stored);
  const restored = migrateGraphPlusPluginDataV1(marked).data;
  equal(readGraphPlusCheckpointV1(restored, 'Vault')?.lens?.query, 'tag:course', 'consumer lens should survive plugin-data validation');
  equal(readGraphPlusCheckpointV1(restored, 'Vault')?.lens?.showTags, false, 'consumer lens toggles should survive storage');
  equal(restored.consumers.graphPlus.genericLensMigrated, true, 'generic lens copy-forward should be marked once');
  deepEqual(restored.unrelated, { retained: true }, 'additive consumer migration should preserve unrelated data');
});

test('V1.2 canonical checkpoint retires the saved vault legacy duplicates', () => {
  const document = graphDocument({ nodes: [graphNode('a')], edges: [] });
  const initial = migrateGraphPlusPluginDataV1({
    consumers: {
      graphPlus: {
        dataSchemaVersion: 1,
        consumerSettings: {},
        graphDocuments: { Vault: document, Other: document },
        viewStates: { Vault: { legacy: true }, Other: { retained: true } },
      },
    },
  }).data;
  const stored = withGraphPlusCheckpointV1(initial, 'Vault', { document, savedAt: 10 });
  equal(stored.consumers.graphPlus.graphDocuments?.Vault, undefined, 'canonical save should remove the saved vault legacy document');
  equal(stored.consumers.graphPlus.viewStates?.Vault, undefined, 'canonical save should remove the saved vault legacy view');
  assert(stored.consumers.graphPlus.graphDocuments?.Other !== undefined, 'other vault migration data should remain until that vault saves');
  assert(stored.consumers.graphPlus.viewStates?.Other !== undefined, 'other vault view data should remain until that vault saves');
  equal(readGraphPlusCheckpointV1(stored, 'Vault')?.document.documentId, document.documentId, 'canonical checkpoint should remain readable');
});

test('V1.2 camera-only persistence writes lightweight metadata without reserializing the graph', async () => {
  const document = graphDocument({ nodes: [graphNode('a')], edges: [] });
  let data = withGraphPlusCheckpointV1(migrateGraphPlusPluginDataV1({}).data, 'Vault', {
    document,
    viewState: viewState(document, 0),
    savedAt: 1,
  });
  const adapter = new MemoryCheckpointAdapter();
  const serializedPluginData: string[] = [];
  let nonce = 0;
  let failPersistence = false;
  const store = new GraphPlusCheckpointFileStoreV1({
    adapter,
    directory: '.obsidian/plugins/graph-plus/graph-plus-checkpoints',
    getData: () => data,
    setData: (next) => { data = next; },
    persistData: async () => {
      if (failPersistence) throw new Error('test plugin-data failure');
      serializedPluginData.push(JSON.stringify(data));
    },
    createNonce: () => `test-${nonce += 1}`,
  });

  await store.save('Vault', {
    document,
    viewState: viewState(document, 10),
    savedAt: 2,
  }, { documentChanged: false });
  equal(adapter.writes, 1, 'the first split checkpoint should migrate the legacy document into its own file');
  assert(!serializedPluginData[0].includes('"nodes"'), 'migrated plugin data must not retain the canonical graph document');

  await store.save('Vault', {
    document,
    viewState: viewState(document, 20),
    savedAt: 3,
  }, { documentChanged: false });
  equal(adapter.writes, 1, 'a camera-only checkpoint must not rewrite the unchanged document file');
  assert(!serializedPluginData[1].includes('"nodes"'), 'a camera-only plugin-data save must serialize only lightweight metadata');
  equal((await store.load('Vault'))?.viewState?.camera.target.x, 20, 'the lightweight camera checkpoint should restore with its external document');

  const changed = graphDocument({ revision: 1, nodes: [graphNode('a'), graphNode('b')], edges: [] });
  await store.save('Vault', {
    document: changed,
    viewState: viewState(changed, 30),
    savedAt: 4,
  }, { documentChanged: true });
  equal(adapter.writes, 2, 'a graph change should write one new canonical document file');
  equal(adapter.removes, 1, 'the superseded generated document should be removed after the new reference commits');
  equal((await store.load('Vault'))?.document.nodes.length, 2, 'the new canonical document should load through the committed reference');

  failPersistence = true;
  const rejected = graphDocument({ revision: 2, nodes: [graphNode('a'), graphNode('b'), graphNode('c')], edges: [] });
  let failed = false;
  try {
    await store.save('Vault', { document: rejected, viewState: viewState(rejected, 40), savedAt: 5 }, { documentChanged: true });
  } catch {
    failed = true;
  }
  equal(failed, true, 'a failed metadata commit should reject the checkpoint');
  equal((await store.load('Vault'))?.document.revision, 1, 'a failed metadata commit should retain the last referenced document');
  equal(adapter.removes, 1, 'a failed metadata commit must not delete the last valid document');
});

class MemoryCheckpointAdapter implements GraphPlusCheckpointFileAdapterV1 {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();
  writes = 0;
  removes = 0;

  async exists(path: string): Promise<boolean> { return this.files.has(path) || this.directories.has(path); }
  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`Missing test checkpoint ${path}`);
    return value;
  }
  async write(path: string, value: string): Promise<void> { this.files.set(path, value); this.writes += 1; }
  async mkdir(path: string): Promise<void> { this.directories.add(path); }
  async remove(path: string): Promise<void> { this.files.delete(path); this.removes += 1; }
}

function viewState(document: GraphDocumentV1, cameraTargetX: number): GraphViewStateV1 {
  return {
    schemaVersion: 1,
    documentId: document.documentId,
    documentRevision: document.revision,
    consumerId: 'graph-plus',
    profileId: 'default',
    dimensions: '3d',
    positions: Object.fromEntries(document.nodes.map((node, index) => [node.id, { x: index, y: 0, z: 0 }])),
    pinnedNodeIds: [],
    camera: {
      position: { x: 0, y: 0, z: 100 },
      target: { x: cameraTargetX, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      zoom: 1,
      projection: 'perspective',
    },
    selectedNodeIds: [],
    activeFilters: {},
    moduleState: {},
  };
}
