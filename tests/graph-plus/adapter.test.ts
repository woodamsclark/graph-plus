import type { ConsumerRegistrationV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import { ConsumerProfileRegistry } from '../../src/graph-engine/core/profile/index.ts';
import { GraphCameraController, SessionFactory } from '../../src/graph-engine/runtime/index.ts';
import { GraphEngineProviderCoreV1 } from '../../src/graph-engine/service/index.ts';
import {
  ObsidianVaultGraphSourceV1,
  VaultGraphAdapterV1,
  noteNodeId,
  tagNodeId,
} from '../../src/graph-plus/adapter/index.ts';
import { GraphPlusConsumerV1, LocalGraphPlusConsumerV1 } from '../../src/graph-plus/consumer/index.ts';
import { neighborhoodNodeIds } from '../../src/graph-plus/consumer/GraphPlusNeighborhoodFramer.ts';
import {
  GraphPlusCheckpointControllerV1,
  type GraphPlusCheckpointStoreV1,
  type GraphPlusCheckpointV1,
} from '../../src/graph-plus/persistence/index.ts';
import { compileGraphPlusFilterV1, createDefaultGraphPlusLensV1, graphPlusSessionOverridesV1 } from '../../src/graph-plus/query/index.ts';
import { graphNode } from '../support/contractFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';
import { runtimeCanvas, runtimeHarness, runtimeFixture, runtimeRegistration } from '../support/runtimeHarness.ts';

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
    interaction: { activationActionIds: ['open-node'], contextActionIds: ['open-node'] },
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
          content: 'Faith is an unreserved opening of the mind to the truth.',
          tags: ['course/greek'],
          properties: { status: ['Due'] },
        },
        {
          file: alpha,
          path: alpha.path,
          basename: 'Alpha',
          extension: 'md',
          content: 'A journal entry about faith and hope.',
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
  deepEqual(projection.document.nodeRegions?.definitions, [
    {
      regionNodeId: tagNodeId('course'),
      directMemberNodeIds: [noteNodeId('Alpha.md'), tagNodeId('course/greek')],
    },
    {
      regionNodeId: tagNodeId('course/greek'),
      directMemberNodeIds: [noteNodeId('folder/Beta.md')],
    },
  ], 'tag regions should encode exact note membership and one-level tag hierarchy');
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

test('V1.7.3 focus framing includes only the focused node and its visible direct neighbors', () => {
  const fixture = snapshot();
  const document = new VaultGraphAdapterV1<FakeFile>({ countDuplicateLinks: true }).build(fixture.value).document;
  const alphaId = noteNodeId('Alpha.md');
  const betaId = noteNodeId('folder/Beta.md');
  const courseId = tagNodeId('course');
  deepEqual(neighborhoodNodeIds(document, alphaId), [alphaId, betaId, courseId],
    'focus framing should use graph adjacency rather than the entire document');
  deepEqual(neighborhoodNodeIds(document, alphaId, new Set([alphaId])), [alphaId],
    'focus framing should not pull filtered neighbors back into view');
});

test('Graph+ query translation selects IDs before invoking the generic AST filter', () => {
  const projection = new VaultGraphAdapterV1<FakeFile>({ countDuplicateLinks: true }).build(snapshot().value);
  const lens = createDefaultGraphPlusLensV1();
  const compiled = compileGraphPlusFilterV1(projection.document, {
    ...lens,
    query: 'tag:course/greek [status:due] -file:alpha',
    showTags: false,
  }, projection.searchIndex);
  equal(compiled.error, undefined, 'consumer query should parse');
  deepEqual((compiled.request.node as { ids: readonly string[] }).ids, [noteNodeId('folder/Beta.md')], 'consumer should translate its vocabulary to opaque node IDs');
});

test('Graph+ compatibility search matches note bodies with Obsidian boolean and exclusion syntax', () => {
  const projection = new VaultGraphAdapterV1<FakeFile>({ countDuplicateLinks: true }).build(snapshot().value);
  const lens = createDefaultGraphPlusLensV1();
  const bodySearch = compileGraphPlusFilterV1(projection.document, {
    ...lens,
    query: '-journal faith',
    showTags: false,
  }, projection.searchIndex);
  deepEqual(
    bodySearch.visibleNodeIds,
    [noteNodeId('folder/Beta.md')],
    'bare search terms should include note content while exclusions apply to the same searchable note',
  );

  const phraseSearch = compileGraphPlusFilterV1(projection.document, {
    ...lens,
    query: 'content:"unreserved opening"',
    showTags: false,
  }, projection.searchIndex);
  deepEqual(phraseSearch.visibleNodeIds, [noteNodeId('folder/Beta.md')], 'content phrases should match note bodies');

  const groupedSearch = compileGraphPlusFilterV1(projection.document, {
    ...lens,
    query: '(file:alpha OR file:beta) -[status:due]',
    showTags: false,
  }, projection.searchIndex);
  deepEqual(groupedSearch.visibleNodeIds, [noteNodeId('Alpha.md')], 'groups, OR, and property exclusions should compose');
});

test('Graph+ keeps note content transient and refreshes search without revising an unchanged graph', () => {
  const fixture = snapshot();
  const adapter = new VaultGraphAdapterV1<FakeFile>({ countDuplicateLinks: true });
  const first = adapter.build(fixture.value, 7);
  assert(!JSON.stringify(first.document).includes('unreserved opening'), 'note bodies must stay out of graph documents and checkpoints');
  const changedContent = adapter.reconcile(first.document, {
    ...fixture.value,
    notes: fixture.value.notes.map((note) => note.path === 'Alpha.md'
      ? { ...note, content: 'A private reflection with no matching keyword.' }
      : note),
  });
  equal(changedContent.document, first.document, 'content-only changes should not revise canonical graph topology');
  equal(changedContent.searchIndex.get(noteNodeId('Alpha.md'))?.content.includes('private reflection'), true, 'content-only changes should refresh the transient search index');
});

test('Graph+ reads note bodies through the supported Obsidian vault API and caches unchanged files', async () => {
  const file = {
    path: 'Faith.md',
    basename: 'Faith',
    extension: 'md',
    stat: { mtime: 10 },
  };
  let reads = 0;
  const source = new ObsidianVaultGraphSourceV1({
    vault: {
      getMarkdownFiles: () => [file],
      getName: () => 'Test Vault',
      cachedRead: async () => {
        reads += 1;
        return 'Faith comes by hearing.';
      },
    },
    metadataCache: {
      resolvedLinks: {},
      getFileCache: () => undefined,
      getFirstLinkpathDest: () => null,
    },
  } as never);
  const first = await source.read();
  const second = await source.read();
  equal(first.notes[0]?.content, 'Faith comes by hearing.', 'supported cachedRead content should populate the search snapshot');
  equal(second.notes[0]?.content, 'Faith comes by hearing.', 'cached content should remain available on later snapshots');
  equal(reads, 1, 'unchanged file mtimes should not trigger duplicate content reads');
});

test('Graph+ leaves generic display and force settings in its engine profile namespace', () => {
  const lens = createDefaultGraphPlusLensV1();
  const overrides = graphPlusSessionOverridesV1({
    ...lens,
    display: { labelMode: 'all', nodeRadiusScale: 2 },
    force: { repulsionStrength: 1234 },
  });
  deepEqual(overrides.modules?.rendering?.settings, { backgroundColor: 'transparent' },
    'Graph+ should expose the native host surface without restoring legacy display controls');
  equal(overrides.modules?.['force-layout'], undefined, 'legacy force lens values should no longer shadow stock profile controls');
  equal(overrides.modules?.form?.enabled, false, 'transient Form ownership should remain in Graph+ session state');
});

class MemoryStore implements GraphPlusCheckpointStoreV1 {
  value?: GraphPlusCheckpointV1;
  saves = 0;
  async load(): Promise<GraphPlusCheckpointV1 | undefined> { return this.value; }
  async save(_vaultId: string, checkpoint: GraphPlusCheckpointV1): Promise<void> { this.value = checkpoint; this.saves += 1; }
}

test('V1.2 Graph+ checkpoints export graph data only after graph changes', async () => {
  const runtime = runtimeHarness();
  const document = runtimeFixture();
  const session = await runtime.factory.createSession({
    consumerId: 'synthetic-consumer',
    profileId: 'two-dimensional',
    container: runtime.container,
    document,
  });
  const store = new MemoryStore();
  const checkpoint = new GraphPlusCheckpointControllerV1('Test Vault', store, runtime.platform);
  checkpoint.attach(session, document);
  await session.resetPerformanceMeasurements();

  await checkpoint.flush();
  let performance = await session.exportPerformanceSnapshot();
  equal(performance.counters?.documentExports, 0, 'view-only checkpointing should reuse the cached canonical document');
  equal(performance.counters?.viewExports, 1, 'view-only checkpointing should export only view state');

  await session.applyPatch({
    schemaVersion: 1,
    patchId: 'checkpoint-graph-change',
    baseRevision: 0,
    operations: [{ type: 'add-node', node: graphNode('checkpoint-added') }],
  });
  await checkpoint.flush();
  performance = await session.exportPerformanceSnapshot();
  equal(performance.counters?.documentExports, 1, 'one graph change should produce one fresh canonical document export');
  equal(store.value?.document.revision, 1, 'the change-aware checkpoint should contain the changed graph');
  checkpoint.detach();
  await session.dispose();
});

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
  store.value = {
    document: saved,
    lens: { ...createDefaultGraphPlusLensV1(), query: 'file:beta', showTags: false },
    savedAt: 1,
  };
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
  equal(consumer.getLens().query, 'file:beta', 'Graph+ should restore its consumer-owned lens from the checkpoint');
  equal(consumer.getLens().showTags, false, 'restored lens toggles should remain consumer-owned');
  await consumer.close();
  assert(store.saves > 0, 'controlled close should checkpoint before session disposal');
  equal(store.value?.lens?.query, 'file:beta', 'controlled close should persist the active lens with the graph');
  equal(runtime.container.querySelector('[data-graph-engine-session]'), null, 'close should dispose the mounted session');
});

test('V1.7 layout reset replaces the live session while preserving document and lens', async () => {
  const fixture = snapshot();
  const runtime = runtimeHarness({ registration: graphPlusRegistration });
  const core = new GraphEngineProviderCoreV1({
    engineVersion: '1.7.1', engineInstanceId: 'graph-plus-reset-test', capabilities: ['render'],
    profiles: runtime.profiles, sessions: runtime.factory,
  });
  const lease = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
  assert(lease.ok, 'Graph+ should obtain a lease for layout reset');
  const store = new MemoryStore();
  const consumer = new GraphPlusConsumerV1({
    lease: lease.lease,
    container: runtime.container,
    vaultId: fixture.value.vaultId,
    source: { read: () => fixture.value },
    checkpointStore: store,
    navigator: { openNote: async () => undefined, openTag: async () => undefined },
    countDuplicateLinks: true,
  });
  await consumer.open();
  await consumer.setLens({ ...consumer.getLens(), query: 'file:beta' });
  const oldSession = consumer.getSession();
  assert(oldSession, 'the initial live session should exist');
  const alphaId = noteNodeId('Alpha.md');
  equal(await consumer.revealAndFocusNode(alphaId), true,
    'a filtered note should receive a transient reveal through the ordinary focus path');
  equal((await oldSession.exportViewState()).focusedNodeId, alphaId,
    'transient reveal should focus the stable note node');
  equal(consumer.getLens().query, 'file:beta', 'transient reveal must not rewrite the saved Filter query');
  await oldSession.setNodePinned(alphaId, true);
  await oldSession.setSelection([alphaId]);
  const documentBefore = consumer.getDocument();

  equal(await consumer.resetLayoutData(), true, 'reset should complete against the live vault session');
  const freshSession = consumer.getSession();
  assert(freshSession && freshSession !== oldSession, 'reset should replace rather than reuse the discarded session');
  const freshState = await freshSession.exportViewState();
  deepEqual(freshState.pinnedNodeIds, [], 'reset should discard saved pins');
  deepEqual(freshState.selectedNodeIds, [], 'reset should discard selection');
  equal(freshState.focusedNodeId, undefined, 'reset should discard focus');
  deepEqual(consumer.getDocument(), documentBefore, 'reset should preserve the canonical graph document');
  equal(consumer.getLens().query, 'file:beta', 'reset should preserve the active Filter query');
  equal(store.value?.lens?.query, 'file:beta', 'fresh checkpoint should preserve consumer lens state');
  deepEqual(store.value?.viewState?.pinnedNodeIds, [], 'fresh checkpoint should replace discarded layout state');
  await consumer.close();
  await core.dispose();
});

test('V1.7.1 global active-note following focuses without changing the full projection', async () => {
  const fixture = snapshot();
  const runtime = runtimeHarness({ registration: graphPlusRegistration });
  const core = new GraphEngineProviderCoreV1({
    engineVersion: '1.7.1', engineInstanceId: 'graph-plus-active-note-test', capabilities: ['render'],
    profiles: runtime.profiles, sessions: runtime.factory,
  });
  const lease = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
  assert(lease.ok, 'Graph+ should obtain a lease for active-note following');
  const store = new MemoryStore();
  const consumer = new GraphPlusConsumerV1({
    lease: lease.lease,
    container: runtime.container,
    vaultId: fixture.value.vaultId,
    source: { read: () => fixture.value },
    checkpointStore: store,
    navigator: { openNote: async () => undefined, openTag: async () => undefined },
    countDuplicateLinks: true,
  });
  await consumer.open();
  const alphaId = noteNodeId('Alpha.md');
  const betaId = noteNodeId('folder/Beta.md');
  const courseId = tagNodeId('course');
  const session = consumer.getSession();
  assert(session, 'the followed graph should expose its engine session');
  const fitRequests: Array<{ nodeIds?: readonly string[]; centerNodeId?: string }> = [];
  const fitNodes = session.fitNodes.bind(session);
  session.fitNodes = async (nodeIds, options) => {
    fitRequests.push({ nodeIds, centerNodeId: options?.centerNodeId });
    await fitNodes(nodeIds, options);
  };
  const surface = runtime.container.querySelector<HTMLElement>('[data-graph-engine-session]');
  assert(surface, 'the followed graph should expose its mounted session surface');

  equal(await consumer.followActiveNode(alphaId), true, 'a main-split graph should follow the active note');
  equal((await consumer.getSession()?.exportViewState())?.focusedNodeId, alphaId,
    'active-note following should use ordinary graph focus state');
  deepEqual(fitRequests[0], { nodeIds: [alphaId, betaId, courseId], centerNodeId: alphaId },
    'every programmatic focus should frame the focused node with its visible direct neighbors');
  await session.focusNode(null);
  fitRequests.length = 0;
  const state = await session.exportViewState();
  const camera = new GraphCameraController(state.camera, state.dimensions);
  camera.setViewport(640, 360);
  const point = camera.worldToScreen(state.positions[alphaId]);
  dispatchGraphClick(runtime.window, runtimeCanvas(runtime.container), point.x, point.y, 731);
  runtime.platform.flushFrame();
  await Promise.resolve();
  deepEqual(fitRequests[0], { nodeIds: [alphaId, betaId, courseId], centerNodeId: alphaId },
    'refocusing a node through graph input should use the same neighborhood framing path');
  fitRequests.length = 0;
  await session.resetCamera();
  await Promise.resolve();
  deepEqual(fitRequests[0], { nodeIds: [alphaId, betaId, courseId], centerNodeId: alphaId },
    'resetting a focused global graph should reuse its neighbor-aware focus framing');
  equal((await session.exportViewState()).focusedNodeId, alphaId,
    'resetting the camera should preserve global graph focus');
  equal(surface.dataset.renderedNodeCount, String(consumer.getDocument()?.nodes.length),
    'a normal split should retain the complete saved projection');

  await consumer.close();
  equal(store.value?.viewState?.activeFilters.projection, undefined,
    'transient active-note reveal should not enter the durable checkpoint');
  await core.dispose();
});

function dispatchGraphClick(
  window: ReturnType<typeof runtimeHarness>['window'],
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  pointerId: number,
): void {
  for (const type of ['pointerdown', 'pointerup'] as const) {
    const event = new window.PointerEvent(type, {
      clientX: x,
      clientY: y,
      pointerId,
      pointerType: 'mouse',
      button: 0,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'clientX', { value: x });
    Object.defineProperty(event, 'clientY', { value: y });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    Object.defineProperty(event, 'button', { value: 0 });
    canvas.dispatchEvent(event as unknown as Event);
  }
}

test('V1.7.1 Local Graph+ owns an ephemeral rooted document, layout, and depth', async () => {
  const fixture = snapshot();
  const runtime = runtimeHarness({ registration: graphPlusRegistration });
  const core = new GraphEngineProviderCoreV1({
    engineVersion: '1.7.1', engineInstanceId: 'local-graph-plus-test', capabilities: ['render'],
    profiles: runtime.profiles, sessions: runtime.factory,
  });
  const lease = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
  assert(lease.ok, 'Local Graph+ should obtain an independent session lease');
  const alphaId = noteNodeId('Alpha.md');
  const betaId = noteNodeId('folder/Beta.md');
  const consumer = new LocalGraphPlusConsumerV1({
    lease: lease.lease,
    container: runtime.container,
    source: { read: () => fixture.value },
    navigator: { openNote: async () => undefined, openTag: async () => undefined },
    countDuplicateLinks: true,
    initialRootNodeId: alphaId,
  });
  await consumer.open();
  let local = consumer.getLocalDocument();
  assert(local, 'Local Graph+ should mount a derived local document');
  equal(local.nodes[0]?.id, alphaId, 'the active root should seed the local origin');
  equal(local.nodes.length, 3, 'depth one should contain the root and its direct eligible neighbors');
  let state = await consumer.getSession()?.exportViewState();
  equal(state?.focusedNodeId, alphaId, 'the local root should own ordinary focus state');
  equal(state?.pinnedNodeIds.includes(alphaId), true, 'the local root should remain anchored while neighbors settle');
  deepEqual(state?.camera.target, state?.positions[alphaId],
    'the camera should center on the root while retaining a fit sized for its neighborhood');

  await consumer.setLocalDepth(2);
  local = consumer.getLocalDocument();
  equal(local?.nodes.length, 4, 'depth two should reveal the next connected layer');

  const session = consumer.getSession();
  assert(session, 'the local graph should retain its engine session');
  const fitRequests: Array<{ minimumRadius?: number; centerNodeId?: string }> = [];
  const fitNodes = session.fitNodes.bind(session);
  session.fitNodes = async (nodeIds, options) => {
    fitRequests.push({ minimumRadius: options?.minimumRadius, centerNodeId: options?.centerNodeId });
    await fitNodes(nodeIds, options);
  };
  equal(await consumer.followActiveNode(betaId), true, 'the local view should follow a newly active note');
  local = consumer.getLocalDocument();
  state = await consumer.getSession()?.exportViewState();
  equal(local?.nodes[0]?.id, betaId, 'a new root should receive a fresh local document identity and origin');
  equal(state?.focusedNodeId, betaId, 'focus should transfer with the active note');
  equal(state?.pinnedNodeIds.includes(alphaId), false, 'the prior local root anchor must not leak across documents');
  deepEqual(state?.camera.target, state?.positions[betaId], 'camera centering should follow the new local root');
  deepEqual(fitRequests[0], { minimumRadius: 462.5, centerNodeId: betaId },
    'local focus should reserve the configured maximum spring radius in one predictive camera fit');
  fitRequests.length = 0;
  await session.resetCamera();
  await Promise.resolve();
  deepEqual(fitRequests[0], { minimumRadius: 462.5, centerNodeId: betaId },
    'resetting a focused local graph should reuse its predictive neighbor-aware framing');
  equal((await session.exportViewState()).focusedNodeId, betaId,
    'resetting the camera should preserve local graph focus');
  await consumer.close();
  await core.dispose();
});

test('G-PARITY engine host resolves Graph+ open-node once and hands transient Form state back', async () => {
  const fixture = snapshot();
  const runtime = runtimeHarness({ registration: graphPlusRegistration });
  let actionLabel = '';
  let actionInvoked = false;
  let bridgeDisposals = 0;
  const core = new GraphEngineProviderCoreV1({
    engineVersion: '1.1.0',
    engineInstanceId: 'graph-plus-ui-test',
    capabilities: ['render'],
    profiles: runtime.profiles,
    sessions: runtime.factory,
    sessionUiHost: {
      mount: async (context) => {
        const nodeId = noteNodeId('Alpha.md');
        actionLabel = context.controls.resolveNodeActions(['open-node'], nodeId)[0]?.label ?? '';
        actionInvoked = context.controls.invokeNodeAction('open-node', nodeId);
        const bridge = context.controls.onSessionOverridesChanged((overrides) => {
          void context.sessionOptions.onSessionOverridesChanged?.(overrides);
        });
        await context.controls.setModuleSetting('form', 'rootNodeId', nodeId);
        await context.controls.setModuleSetting('form', 'direction', 'outgoing');
        await context.controls.setModuleEnabled('form', true);
        return { dispose: () => { bridge.dispose(); bridgeDisposals += 1; } };
      },
    },
  });
  const lease = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
  assert(lease.ok, 'Graph+ should obtain its ordinary consumer lease');
  let openedNotes = 0;
  const store = new MemoryStore();
  const consumer = new GraphPlusConsumerV1({
    lease: lease.lease,
    container: runtime.container,
    vaultId: fixture.value.vaultId,
    source: { read: () => fixture.value },
    checkpointStore: store,
    navigator: { openNote: async () => { openedNotes += 1; }, openTag: async () => undefined },
    countDuplicateLinks: true,
  });
  await consumer.open();
  await Promise.resolve();
  equal(actionLabel, 'Open note', 'the registered primary action should use Graph+ domain language');
  equal(actionInvoked, true, 'the engine resolver should invoke the Graph+ action');
  equal(openedNotes, 1, 'one resolved action should open exactly once without an intent fallback duplicate');
  equal(consumer.getLens().form.enabled, true, 'engine transient Form enable should be handed back to Graph+');
  equal(consumer.getLens().form.rootNodeId, noteNodeId('Alpha.md'), 'engine Form root should be handed back by stable node ID');
  equal(consumer.getLens().form.direction, 'outgoing', 'engine Form configuration should be handed back');
  await consumer.close();
  equal(store.value?.lens?.form.rootNodeId, noteNodeId('Alpha.md'), 'Graph+ should persist handed-back Form state in its own checkpoint');
  equal(bridgeDisposals, 1, 'the engine UI bridge should dispose with the consumer session');
  await core.dispose();
});

test('G-PARITY-09 Graph+ persists Form while its profile switches and restores dimensions', async () => {
  const fixture = snapshot();
  const store = new MemoryStore();
  const first = runtimeHarness({ registration: graphPlusRegistration });
  first.profiles.setUserOverrides('graph-plus', 'default', { dimensions: '2d' });
  const firstCore = new GraphEngineProviderCoreV1({
    engineVersion: '1.1.0', engineInstanceId: 'graph-plus-dim-first', capabilities: ['render'],
    profiles: first.profiles, sessions: first.factory,
  });
  const firstLease = firstCore.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
  assert(firstLease.ok, 'Graph+ should connect in its 2d profile override');
  const firstConsumer = new GraphPlusConsumerV1({
    lease: firstLease.lease,
    container: first.container,
    vaultId: fixture.value.vaultId,
    source: { read: () => fixture.value },
    checkpointStore: store,
    navigator: { openNote: async () => undefined, openTag: async () => undefined },
    countDuplicateLinks: true,
  });
  await firstConsumer.open();
  const session = firstConsumer.getSession();
  assert(session, 'Graph+ should expose its leased session');
  equal((await session.exportViewState()).dimensions, '2d', 'Graph+ should honor its persistent profile dimension');
  const rootId = noteNodeId('Alpha.md');
  await firstConsumer.mindMapFromNode(rootId);
  first.profiles.setUserOverrides('graph-plus', 'default', { dimensions: '3d' });
  first.factory.refreshActiveProfiles();
  equal(firstConsumer.getSession(), session, 'live dimension switching should retain the Graph+ session handle');
  equal((await session.exportViewState()).dimensions, '3d', 'Graph+ should switch its existing graph to 3d');
  equal(firstConsumer.getLens().form.rootNodeId, rootId, 'Graph+ should retain the Form root through the switch');
  await firstConsumer.close();
  await firstCore.dispose();
  equal(store.value?.viewState?.dimensions, '3d', 'Graph+ should checkpoint the active destination dimension');
  equal(store.value?.lens?.form.rootNodeId, rootId, 'Graph+ should checkpoint its consumer-owned Form root');

  const second = runtimeHarness({ registration: graphPlusRegistration });
  second.profiles.setUserOverrides('graph-plus', 'default', { dimensions: '2d' });
  const secondCore = new GraphEngineProviderCoreV1({
    engineVersion: '1.1.0', engineInstanceId: 'graph-plus-dim-second', capabilities: ['render'],
    profiles: second.profiles, sessions: second.factory,
  });
  const secondLease = secondCore.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
  assert(secondLease.ok, 'Graph+ should reconnect with the saved checkpoint');
  const restored = new GraphPlusConsumerV1({
    lease: secondLease.lease,
    container: second.container,
    vaultId: fixture.value.vaultId,
    source: { read: () => fixture.value },
    checkpointStore: store,
    navigator: { openNote: async () => undefined, openTag: async () => undefined },
    countDuplicateLinks: true,
  });
  await restored.open();
  equal((await restored.getSession()?.exportViewState())?.dimensions, '2d', 'runtime restore should convert the permitted saved dimension');
  equal(restored.getLens().form.enabled, true, 'restored Graph+ should retain active Form');
  equal(restored.getLens().form.rootNodeId, rootId, 'restored Graph+ should retain the same root');
  await restored.close();
  await secondCore.dispose();
});

test('Graph+ Mind Map snapshots selection as its root and pauses when filtering hides that root', async () => {
  const fixture = snapshot();
  const runtime = runtimeHarness({ registration: graphPlusRegistration });
  const core = new GraphEngineProviderCoreV1({
    engineVersion: '1.0.0', engineInstanceId: 'mind-map-test', capabilities: ['render'],
    profiles: runtime.profiles, sessions: runtime.factory,
  });
  const leaseResult = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
  assert(leaseResult.ok, 'Graph+ should obtain a local lease');
  const errors: string[] = [];
  const consumer = new GraphPlusConsumerV1({
    lease: leaseResult.lease,
    container: runtime.container,
    vaultId: fixture.value.vaultId,
    source: { read: () => fixture.value },
    checkpointStore: new MemoryStore(),
    navigator: { openNote: async () => undefined, openTag: async () => undefined },
    countDuplicateLinks: true,
    onError: (error) => errors.push(error.message),
  });
  await consumer.open();
  const rootId = noteNodeId('folder/Beta.md');
  const otherId = noteNodeId('Alpha.md');
  await consumer.mindMapFromNode(rootId);
  equal(consumer.getLens().form.enabled, true, 'Mind Map should enable from the chosen node');
  equal(consumer.getLens().form.rootNodeId, rootId, 'Mind Map should snapshot the chosen node as its root');
  deepEqual((await consumer.getSession()?.exportViewState())?.selectedNodeIds, [rootId], 'starting Mind Map should select its root');

  await consumer.getSession()?.setSelection([otherId]);
  equal(consumer.getLens().form.rootNodeId, rootId, 'later selection should not silently re-root the active Mind Map');
  await consumer.setLens({ ...consumer.getLens(), query: 'file:alpha' });
  equal(consumer.getLens().form.enabled, false, 'hiding the root should pause Mind Map instead of inventing a replacement root');
  assert(errors.some((message) => message.includes('selected root is hidden')), 'root removal should report an explicit recoverable explanation');
  await consumer.close();
  await core.dispose();
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
