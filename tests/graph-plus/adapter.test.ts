import type { ConsumerRegistrationV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import { ConsumerProfileRegistry } from '../../src/graph-engine/core/profile/index.ts';
import { SessionFactory } from '../../src/graph-engine/runtime/index.ts';
import { GraphEngineProviderCoreV1 } from '../../src/graph-engine/service/index.ts';
import { VaultGraphAdapterV1, noteNodeId, tagNodeId } from '../../src/graph-plus/adapter/index.ts';
import { GraphPlusConsumerV1 } from '../../src/graph-plus/consumer/index.ts';
import type { GraphPlusCheckpointStoreV1, GraphPlusCheckpointV1 } from '../../src/graph-plus/persistence/index.ts';
import { compileGraphPlusFilterV1, createDefaultGraphPlusLensV1 } from '../../src/graph-plus/query/index.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';
import { runtimeHarness, runtimeFixture, runtimeRegistration } from '../support/runtimeHarness.ts';

interface FakeFile { readonly path: string }

const graphPlusRegistration: ConsumerRegistrationV1 = {
  consumerId: 'graph-plus',
  displayName: 'Graph+',
  consumerVersion: '1.0.0',
  supportedProtocolVersions: [1],
  profiles: [{
    profileId: 'default',
    displayName: 'Default',
    descriptorVersion: 1,
    dimensions: '3d',
    requestedCapabilities: ['render'],
    modules: {
      rendering: { policy: 'required' },
      filtering: { policy: 'required' },
      form: { policy: 'optional', defaultEnabled: false },
      'force-layout': { policy: 'optional', defaultEnabled: false },
      anima: { policy: 'optional', defaultEnabled: false },
    },
  }],
};

function snapshot() {
  const alpha = { path: 'Alpha.md' };
  const beta = { path: 'folder/Beta.md' };
  return {
    alpha,
    beta,
    value: {
      vaultId: 'Test Vault',
      notes: [
        {
          file: beta,
          path: beta.path,
          basename: 'Beta',
          extension: 'md',
          tags: ['course/greek'],
          properties: { status: ['Due'] },
        },
        {
          file: alpha,
          path: alpha.path,
          basename: 'Alpha',
          extension: 'md',
          tags: ['course'],
          properties: {},
          frontmatterLinks: [{ relation: 'teacher', targetPath: beta.path }],
        },
      ],
      resolvedLinks: {
        'Alpha.md': { 'folder/Beta.md': 3, 'image.png': 1 },
      },
    },
  } as const;
}

test('G-ADAPTER projects only notes and tags with stable IDs and private file lookup', () => {
  const fixture = snapshot();
  const adapter = new VaultGraphAdapterV1<FakeFile>({ countDuplicateLinks: true });
  const projection = adapter.build(fixture.value);
  deepEqual(projection.document.nodes.map((node) => node.id), [
    noteNodeId('Alpha.md'),
    noteNodeId('folder/Beta.md'),
    tagNodeId('course'),
    tagNodeId('course/greek'),
  ], 'projection should sort notes and include the tag hierarchy only');
  assert(!JSON.stringify(projection.document).includes('image.png'), 'attachments and dangling resolved links should be omitted');
  equal(projection.lookup.get(noteNodeId('Alpha.md'))?.kind, 'note', 'note lookup should remain outside the public document');
  equal((projection.lookup.get(noteNodeId('Alpha.md')) as { file: FakeFile }).file, fixture.alpha, 'lookup should retain original file identity');
  const noteLink = projection.document.edges.find((edge) => edge.sourceId === noteNodeId('Alpha.md') && edge.targetId === noteNodeId('folder/Beta.md'));
  equal(noteLink?.weight, 3, 'duplicate link count should become neutral edge weight');
  assert(noteLink?.tokens?.includes('relation:teacher'), 'frontmatter relation should annotate the supported resolved edge');
});

test('G-ADAPTER reconciliation is stable and increments only changed documents', () => {
  const fixture = snapshot();
  const adapter = new VaultGraphAdapterV1<FakeFile>({ countDuplicateLinks: false });
  const first = adapter.build(fixture.value, 4);
  const same = adapter.reconcile(first.document, fixture.value);
  equal(same.document, first.document, 'unchanged vault snapshot should retain canonical document identity and revision');
  const changed = adapter.reconcile(first.document, {
    ...fixture.value,
    notes: fixture.value.notes.slice(0, 1),
    resolvedLinks: {},
  });
  equal(changed.document.revision, 5, 'changed vault snapshot should advance once');
  equal(changed.document.nodes.some((node) => node.id === noteNodeId('Alpha.md')), false, 'removed notes should reconcile away');
});

test('Graph+ query translation selects IDs before invoking the generic AST filter', () => {
  const projection = new VaultGraphAdapterV1<FakeFile>({ countDuplicateLinks: true }).build(snapshot().value);
  const lens = createDefaultGraphPlusLensV1();
  const compiled = compileGraphPlusFilterV1(projection.document, {
    ...lens,
    query: 'tag:course [status:due] -file:alpha',
    showTags: false,
  });
  equal(compiled.error, undefined, 'consumer query should parse');
  deepEqual((compiled.request.node as { ids: readonly string[] }).ids, [noteNodeId('folder/Beta.md')], 'consumer should translate its vocabulary to opaque node IDs');
});

class MemoryStore implements GraphPlusCheckpointStoreV1 {
  value?: GraphPlusCheckpointV1;
  saves = 0;
  async load(): Promise<GraphPlusCheckpointV1 | undefined> { return this.value; }
  async save(_vaultId: string, checkpoint: GraphPlusCheckpointV1): Promise<void> { this.value = checkpoint; this.saves += 1; }
}

test('G-LAZY consumer mounts saved graph before vault reconciliation and flushes before release', async () => {
  const fixture = snapshot();
  const registration = graphPlusRegistration;
  const runtime = runtimeHarness({ registration });
  const profiles = runtime.profiles;
  const factory = runtime.factory;
  const core = new GraphEngineProviderCoreV1({
    engineVersion: '1.0.0',
    engineInstanceId: 'graph-plus-test',
    capabilities: ['render'],
    profiles,
    sessions: factory,
  });
  const leaseResult = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
  assert(leaseResult.ok, 'test consumer should obtain local lease');
  await leaseResult.lease.registerConsumer(registration);
  const saved = new VaultGraphAdapterV1<FakeFile>({ countDuplicateLinks: true }).build(fixture.value).document;
  const store = new MemoryStore();
  store.value = { document: saved, savedAt: 1 };
  let sawMountedBeforeScan = false;
  const consumer = new GraphPlusConsumerV1({
    lease: leaseResult.lease,
    container: runtime.container,
    vaultId: fixture.value.vaultId,
    source: { read: () => {
      sawMountedBeforeScan = runtime.container.querySelector('[data-graph-engine-session]') !== null;
      return fixture.value;
    } },
    checkpointStore: store,
    navigator: { openNote: async () => undefined, openTag: async () => undefined },
    countDuplicateLinks: true,
  });
  await consumer.open();
  equal(sawMountedBeforeScan, true, 'saved document should mount before authoritative scan starts');
  await consumer.close();
  assert(store.saves > 0, 'controlled close should checkpoint before session disposal');
  equal(runtime.container.querySelector('[data-graph-engine-session]'), null, 'close should dispose the mounted session');
});

test('Graph+ source failure and close failure do not interrupt an external lease', async () => {
  const runtime = runtimeHarness({ registration: graphPlusRegistration });
  const core = new GraphEngineProviderCoreV1({
    engineVersion: '1.0.0',
    engineInstanceId: 'shared-engine',
    capabilities: ['render'],
    profiles: runtime.profiles,
    sessions: runtime.factory,
  });
  const external = core.connectLocal({
    consumerId: 'synthetic-consumer', supportedProtocolVersions: [1], requestedCapabilities: ['render'],
  });
  const graphPlus = core.connectLocal({
    consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'],
  });
  assert(external.ok && graphPlus.ok, 'both consumers should lease the same provider');
  await external.lease.registerConsumer(runtimeRegistration());
  const failingConsumer = new GraphPlusConsumerV1({
    lease: graphPlus.lease,
    container: runtime.container,
    vaultId: 'Test Vault',
    source: { read: () => { throw new Error('vault adapter failed'); } },
    checkpointStore: { load: async () => undefined, save: async () => { throw new Error('checkpoint failed'); } },
    navigator: { openNote: async () => undefined, openTag: async () => undefined },
    countDuplicateLinks: true,
  });
  let graphPlusFailed = false;
  try { await failingConsumer.open(); } catch { graphPlusFailed = true; }
  equal(graphPlusFailed, true, 'Graph+ adapter failure should remain on the Graph+ surface');
  await failingConsumer.close();
  const externalSession = await external.lease.createSession({
    consumerId: 'synthetic-consumer',
    profileId: 'two-dimensional',
    container: runtime.container,
    document: runtimeFixture(),
  });
  equal(runtime.container.querySelectorAll('[data-graph-engine-session]').length, 1, 'external lease should still mount after Graph+ failure');
  await externalSession.dispose();
  await external.lease.release();
  await core.dispose();
});

test('simultaneous Graph+ and external sessions dispose independently', async () => {
  const fixture = snapshot();
  const runtime = runtimeHarness({ registration: graphPlusRegistration });
  const core = new GraphEngineProviderCoreV1({
    engineVersion: '1.0.0', engineInstanceId: 'multi', capabilities: ['render'],
    profiles: runtime.profiles, sessions: runtime.factory,
  });
  const graphPlus = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
  const external = core.connectLocal({ consumerId: 'synthetic-consumer', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
  assert(graphPlus.ok && external.ok, 'both leases should connect');
  await external.lease.registerConsumer(runtimeRegistration());
  const consumer = new GraphPlusConsumerV1({
    lease: graphPlus.lease,
    container: runtime.container,
    vaultId: fixture.value.vaultId,
    source: { read: () => fixture.value },
    checkpointStore: new MemoryStore(),
    navigator: { openNote: async () => undefined, openTag: async () => undefined },
    countDuplicateLinks: true,
  });
  await consumer.open();
  const externalSession = await external.lease.createSession({
    consumerId: 'synthetic-consumer', profileId: 'two-dimensional', container: runtime.container, document: runtimeFixture(),
  });
  equal(runtime.container.querySelectorAll('[data-graph-engine-session]').length, 2, 'both consumer surfaces should coexist');
  await consumer.close();
  equal(runtime.container.querySelectorAll('[data-graph-engine-session]').length, 1, 'Graph+ close should leave the external surface');
  await externalSession.dispose();
  await external.lease.release();
  await core.dispose();
});
