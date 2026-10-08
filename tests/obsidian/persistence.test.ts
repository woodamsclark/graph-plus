import { ConsumerProfileRegistry } from '../../src/graph-engine/core/profile/index.ts';
import type { GraphDocumentV1, GraphViewStateV1, GraphSessionV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import { GraphPlusCheckpointControllerV1 } from '../../src/graph-plus/persistence/index.ts';
import {
  GraphPlusCheckpointFileStoreV1,
  GraphPlusCheckpointRecoveryErrorV1,
  type GraphPlusCheckpointFileAdapterV1,
} from '../../src/obsidian/settings/GraphPlusCheckpointFileStore.ts';
import {
  migrateGraphPlusPluginDataV1,
  readGraphPlusCheckpointV1,
  withEngineSettingsV1,
  withGraphPlusCheckpointV1,
  withGraphPlusGenericLensMigratedV1,
  readGraphPlusCheckpointReferenceV1,
  withGraphPlusSettingsV1,
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

test('Frank mode is opt-in and survives Graph+ settings migration', () => {
  equal(migrateGraphPlusPluginDataV1({}).data.consumers.graphPlus.consumerSettings.frankMode, false,
    'Frank mode should stay out of serious graphs unless someone finds and enables it');
  const migrated = migrateGraphPlusPluginDataV1({
    consumers: {
      graphPlus: {
        dataSchemaVersion: 1,
        consumerSettings: { frankMode: true },
      },
    },
  });
  equal(migrated.data.consumers.graphPlus.consumerSettings.frankMode, true,
    'an enabled prank should persist across reloads');
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
  equal(adapter.removes, 0, 'the previous document generation remains available for recovery');
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
  equal(adapter.removes, 0, 'a failed metadata commit must not delete either recoverable document');
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

function checkpointFixture() {
  let data = migrateGraphPlusPluginDataV1({ unrelated: { retained: true } }).data;
  const adapter = new MemoryCheckpointAdapter();
  let nonce = 0;
  const store = new GraphPlusCheckpointFileStoreV1({
    adapter, directory: 'graph-plus-checkpoints', getData: () => data,
    setData: next => { data = next; }, persistData: async () => undefined,
    createNonce: () => String(++nonce),
  });
  const document = graphDocument({ nodes: [graphNode('a')], edges: [] });
  return { store, adapter, document, getData: () => data, setData: (next: typeof data) => { data = next; } };
}

async function recoveryFailure(operation: () => Promise<unknown>, reason: string) {
  let failure: unknown;
  try { await operation(); } catch (error) { failure = error; }
  assert(failure instanceof GraphPlusCheckpointRecoveryErrorV1, 'failed recovery is explicit');
  equal(failure.reason, reason, 'recovery failure is classified');
}

test('checkpoint recovery distinguishes first use from missing, inaccessible, corrupt, and invalid saves', async () => {
  for (const fault of ['missing-file', 'inaccessible-file', 'corrupt-json', 'invalid-checkpoint'] as const) {
    const fixture = checkpointFixture();
    equal(await fixture.store.load('Vault'), undefined, 'only first use returns no checkpoint');
    await fixture.store.save('Vault', { document: fixture.document, viewState: viewState(fixture.document, 10), savedAt: 1 });
    const reference = readGraphPlusCheckpointReferenceV1(fixture.getData(), 'Vault')!;
    if (fault === 'missing-file') fixture.adapter.files.delete(reference.documentPath);
    if (fault === 'inaccessible-file') fixture.adapter.read = async () => { throw new Error('temporarily unavailable'); };
    if (fault === 'corrupt-json') fixture.adapter.files.set(reference.documentPath, '{broken');
    if (fault === 'invalid-checkpoint') fixture.adapter.files.set(reference.documentPath, '{"schemaVersion":99}');
    const metadata = fixture.getData(); const writes = fixture.adapter.writes;
    await recoveryFailure(() => fixture.store.load('Vault'), fault);
    await recoveryFailure(() => fixture.store.save('Vault', { document: fixture.document, savedAt: 2 }), fault);
    equal(fixture.getData(), metadata, 'failed recovery cannot replace metadata');
    equal(fixture.adapter.writes, writes, 'automatic saving cannot replace failed recovery');
    equal(fixture.adapter.removes, 0, 'failed recovery never removes documents');
  }
});

test('invalid checkpoint metadata and invalid view state cannot silently become a fresh layout', async () => {
  for (const corrupt of ['metadata', 'view-state', 'identity', 'legacy'] as const) {
    const fixture = checkpointFixture();
    await fixture.store.save('Vault', { document: fixture.document, viewState: viewState(fixture.document, 20), savedAt: 1 });
    const data = fixture.getData();
    const reference = readGraphPlusCheckpointReferenceV1(data, 'Vault')!;
    const broken = corrupt === 'metadata' ? { ...reference, documentRevision: 'invalid' }
      : corrupt === 'view-state' ? { ...reference, viewState: { broken: true } }
      : corrupt === 'identity' ? { ...reference, documentId: 'wrong-document' }
      : { document: fixture.document, viewState: { broken: true }, savedAt: 1 };
    fixture.setData({ ...data, consumers: { ...data.consumers,
      graphPlus: { ...data.consumers.graphPlus, checkpoints: { Vault: broken } },
    } });
    await recoveryFailure(() => fixture.store.load('Vault'), 'invalid-checkpoint');
    deepEqual(fixture.getData().consumers.graphPlus.checkpoints?.Vault, broken, 'invalid state stays intact for recovery');
  }
});

test('a recovered transient read failure can be retried without resetting the saved layout', async () => {
  const fixture = checkpointFixture();
  await fixture.store.save('Vault', { document: fixture.document, viewState: viewState(fixture.document, 42), savedAt: 1 });
  const read = fixture.adapter.read.bind(fixture.adapter);
  fixture.adapter.read = async () => { throw new Error('temporary read failure'); };
  await recoveryFailure(() => fixture.store.load('Vault'), 'inaccessible-file');
  fixture.adapter.read = read;
  equal((await fixture.store.load('Vault'))?.viewState?.camera.target.x, 42, 'retry restores the original framing');
  await fixture.store.save('Vault', { document: fixture.document, viewState: viewState(fixture.document, 43), savedAt: 2 }, { documentChanged: false });
  equal(fixture.adapter.writes, 1, 'retry does not rewrite the document');
});

test('checkpoint generations retain one previous document and restore it while archiving failed recovery', async () => {
  const fixture = checkpointFixture();
  const second = graphDocument({ revision: 1, nodes: [graphNode('a'), graphNode('b')], edges: [] });
  const third = graphDocument({ revision: 2, nodes: [graphNode('a'), graphNode('b'), graphNode('c')], edges: [] });
  for (const document of [fixture.document, second, third]) {
    await fixture.store.save('Vault', { document, viewState: viewState(document, document.revision + 10), savedAt: document.revision });
  }
  equal(fixture.adapter.files.size, 2, 'only the current and previous document generations remain');
  equal(fixture.adapter.removes, 1, 'the obsolete third generation is pruned');
  const corruptReference = readGraphPlusCheckpointReferenceV1(fixture.getData(), 'Vault')!;
  fixture.adapter.files.set(corruptReference.documentPath, '{corrupt');
  await recoveryFailure(() => fixture.store.load('Vault'), 'corrupt-json');
  equal(fixture.store.hasPrevious('Vault'), true, 'previous-generation recovery is available');
  await fixture.store.recover('Vault', 'previous');
  const restored = await fixture.store.load('Vault');
  equal(restored?.document.revision, 1, 'previous document revision is restored');
  equal(restored?.viewState?.camera.target.x, 11, 'its matching layout metadata is restored');
  equal(fixture.adapter.files.get(corruptReference.documentPath), '{corrupt', 'the failed file is preserved');
  const archive = [...fixture.adapter.files.entries()].find(([path]) => path.includes('-recovery-'));
  assert(archive !== undefined && JSON.parse(archive[1]).checkpoint.documentPath === corruptReference.documentPath,
    'the failed reference is archived before switching to the previous generation');
});

test('explicit recovery reset archives saved state and preserves other vaults and settings', async () => {
  const fixture = checkpointFixture();
  await fixture.store.save('Vault', { document: fixture.document, savedAt: 1 });
  await fixture.store.save('Other', { document: fixture.document, savedAt: 1 });
  const reference = readGraphPlusCheckpointReferenceV1(fixture.getData(), 'Vault')!;
  fixture.adapter.files.set(reference.documentPath, '{corrupt');
  await recoveryFailure(() => fixture.store.load('Vault'), 'corrupt-json');
  await fixture.store.recover('Vault', 'reset');
  equal(await fixture.store.load('Vault'), undefined, 'an explicit reset permits a fresh graph');
  assert(await fixture.store.load('Other') !== undefined, 'other vault checkpoints survive');
  deepEqual(fixture.getData().unrelated, { retained: true }, 'unrelated plugin data survives');
  equal(fixture.adapter.files.get(reference.documentPath), '{corrupt', 'the original unreadable file survives');
  await fixture.store.save('Vault', { document: fixture.document, savedAt: 2 });
  assert(await fixture.store.load('Vault') !== undefined, 'fresh saving works after explicit reset');
});

test('checkpoint reset cannot replace the old reference when its archive write fails', async () => {
  const fixture = checkpointFixture();
  await fixture.store.save('Vault', { document: fixture.document, savedAt: 1 });
  const original = fixture.getData();
  fixture.adapter.write = async () => { throw new Error('archive storage unavailable'); };
  let failed = false;
  try { await fixture.store.recover('Vault', 'reset'); } catch { failed = true; }
  assert(failed, 'archive failure rejects reset');
  equal(fixture.getData(), original, 'no recovery data is discarded without its archive');
});

test('checkpoint saves serialize and do not overwrite settings changed during a document write', async () => {
  const fixture = checkpointFixture();
  let resume!: () => void;
  const blocked = new Promise<void>(resolve => { resume = resolve; });
  let started!: () => void;
  const writing = new Promise<void>(resolve => { started = resolve; });
  const write = fixture.adapter.write.bind(fixture.adapter);
  fixture.adapter.write = async (path, content) => { started(); await blocked; await write(path, content); };
  const save = fixture.store.save('Vault', { document: fixture.document, savedAt: 1 });
  await writing;
  fixture.setData(withGraphPlusSettingsV1(fixture.getData(), {
    ...fixture.getData().consumers.graphPlus.consumerSettings, enabled: false,
  }));
  const second = fixture.store.save('Vault', { document: fixture.document, savedAt: 2 }, { documentChanged: false });
  resume(); await save; await second; await fixture.store.drain();
  equal(fixture.getData().consumers.graphPlus.consumerSettings.enabled, false, 'concurrent settings are preserved');
  equal((await fixture.store.load('Vault'))?.savedAt, 2, 'queued saves commit in order');
  equal(fixture.adapter.writes, 1, 'second metadata-only save does not write another document');
});

test('timer checkpoint failures are reported and final close retries safely with one completion', async () => {
  const document = graphDocument({ nodes: [graphNode('a')], edges: [] });
  let timeout: (() => void) | undefined;
  let subscriptions = 0; let disposed = 0; let rejectSave = true; let writes = 0;
  let reported: Error | undefined;
  const subscribe = () => { subscriptions += 1; return { dispose: () => { subscriptions -= 1; } }; };
  const session = {
    onGraphChanged: subscribe, onIntent: subscribe, onWorldChanged: subscribe,
    exportDocument: async () => document, exportViewState: async () => viewState(document, 37),
    dispose: async () => { disposed += 1; },
  } as unknown as GraphSessionV1;
  const controller = new GraphPlusCheckpointControllerV1('Vault', {
    load: async () => undefined,
    save: async () => { writes += 1; if (rejectSave) throw new Error('disk unavailable'); },
  }, {
    now: () => 1, setTimeout: callback => { timeout = callback; return 1; }, clearTimeout: () => { timeout = undefined; },
  }, 500, undefined, undefined, error => { reported = error; });
  controller.attach(session, document);
  controller.schedule();
  assert(timeout !== undefined, 'autosave is scheduled');
  timeout(); for (let i = 0; i < 15; i++) await Promise.resolve();
  equal(reported?.message, 'disk unavailable', 'timer rejection is handled and reported');
  rejectSave = false;
  const close = controller.closeAndDispose();
  equal(controller.closeAndDispose(), close, 'duplicate close shares completion');
  equal(subscriptions, 0, 'closing stops observing before the final save');
  await close;
  equal(writes, 2, 'final close retries the rejected autosave once');
  equal(disposed, 1, 'session is disposed exactly once after saving');
});

test('failed checkpoint metadata commit rolls back its reference without rolling back concurrent settings', async () => {
  const document = graphDocument({ nodes: [graphNode('a')], edges: [] });
  let data = migrateGraphPlusPluginDataV1({}).data;
  const adapter = new MemoryCheckpointAdapter();
  let fail = false; let repaired = false;
  const store = new GraphPlusCheckpointFileStoreV1({
    adapter, directory: 'graph-plus-checkpoints', getData: () => data, setData: next => { data = next; },
    persistData: async () => {
      if (fail) {
        fail = false;
        data = withGraphPlusSettingsV1(data, { ...data.consumers.graphPlus.consumerSettings, enabled: false });
        throw new Error('metadata commit failed');
      }
      repaired = true;
    },
  });
  await store.save('Vault', { document, savedAt: 1 });
  const original = readGraphPlusCheckpointReferenceV1(data, 'Vault')!;
  const changed = graphDocument({ revision: 1, nodes: [graphNode('a'), graphNode('b')], edges: [] });
  fail = true; repaired = false;
  let rejected = false;
  try { await store.save('Vault', { document: changed, savedAt: 2 }); } catch { rejected = true; }
  assert(rejected, 'failed metadata commit is reported');
  equal(readGraphPlusCheckpointReferenceV1(data, 'Vault')?.documentPath, original.documentPath, 'the old document reference is restored');
  equal(data.consumers.graphPlus.consumerSettings.enabled, false, 'concurrent settings remain committed in memory');
  equal(repaired, true, 'corrected metadata is queued after any concurrent settings writes');
  equal(adapter.removes, 0, 'no recovery document is pruned on failure');
});
