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
import {
  GraphPlusApplicationV1,
  GraphPlusSessionV1,
  GraphPlusVaultModelV1,
  graphPlusEngineExperienceContractV1,
  graphPlusExperiencePolicyV1,
  projectGraphPlusExperienceDocumentV1,
} from '../../src/graph-plus/application/index.ts';
import { GRAPH_PLUS_CONSUMER_REGISTRATION_V1, GraphPlusConsumerV1, LocalGraphPlusConsumerV1 } from '../../src/graph-plus/consumer/index.ts';
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

test('workspace session Memory retains three prior notes and excludes the active note', () => {
  const session = new GraphPlusSessionV1();
  for (let index = 0; index < 6; index += 1) {
    session.experienceFileActivation(`note:${index}`, index);
  }
  equal(session.snapshot().activeNodeId, 'note:5', 'the current note should remain the active subject');
  deepEqual(session.snapshot().nodeIds, ['note:2', 'note:3', 'note:4'],
    'working Memory should retain only the three prior distinct notes');
  session.experienceFileActivation('note:3', 7);
  equal(session.snapshot().activeNodeId, 'note:3', 'the revisited note should become active rather than remembered');
  deepEqual(session.snapshot().nodeIds, ['note:2', 'note:4', 'note:5'],
    'revisiting a remembered note should exclude it and retain the three prior notes in recency order');
  equal(session.memory.count('file-activated', 'note:3', 7), 2,
    'associative Memory should retain both activations behind the bounded working trail');

  const impaired = new GraphPlusSessionV1({
    experiencePolicy: () => ({ status: 'forgotten', reason: 'impaired-memory' }),
  });
  impaired.experienceFileActivation('note:forgotten', 1);
  deepEqual(impaired.snapshot().nodeIds, [],
    'an impaired Ego should be able to prevent perceived activity from entering session Memory');
  equal(impaired.memory.count('file-activated', 'note:forgotten', 1), 0,
    'forgotten activity must not leak into associative Memory');
});

test('Graph+ modes share one canonical vault read and reconciliation', async () => {
  const fixture = snapshot();
  let reads = 0;
  const model = new GraphPlusVaultModelV1({
    read: async () => {
      reads += 1;
      await Promise.resolve();
      return fixture.value;
    },
  }, { countDuplicateLinks: true });

  const [global, local] = await Promise.all([model.open(), model.open()]);
  equal(reads, 1, 'simultaneous Graph+ modes should share the initial vault adaptation');
  equal(global.document, local.document, 'both modes should observe one canonical document instance');

  const [globalNext, localNext] = await Promise.all([model.reconcile(), model.reconcile()]);
  equal(reads, 2, 'simultaneous mode reconciliation should perform one additional vault read');
  equal(globalNext.document, localNext.document, 'both modes should receive the same reconciled revision');
});

test('Graph+ release policy keeps Memory constellations out of every presentation mode', () => {
  equal(graphPlusExperiencePolicyV1('global').memoryConstellations, 'disabled',
    'Global should not present workspace history as Memory constellations');
  equal(graphPlusExperiencePolicyV1('local').memoryConstellations, 'disabled',
    'Local should not present workspace history as Memory constellations');
});

test('Graph+ vault model coalesces initial open and saved-checkpoint reconciliation', async () => {
  const fixture = snapshot();
  let reads = 0;
  let releaseRead!: () => void;
  const readReleased = new Promise<void>((resolve) => { releaseRead = resolve; });
  const model = new GraphPlusVaultModelV1({
    read: async () => {
      reads += 1;
      await readReleased;
      return fixture.value;
    },
  }, { countDuplicateLinks: true });

  const localOpen = model.open();
  const globalSavedReconcile = model.reconcile();
  releaseRead();
  const [local, global] = await Promise.all([localOpen, globalSavedReconcile]);
  equal(reads, 1, 'initial Global and Local startup should share one vault read across operation names');
  equal(local.document, global.document, 'both startup paths should receive the same canonical snapshot');
});

test('Graph+ application shares one graph world across viewport-independent presentations', async () => {
  const fixture = snapshot();
  let current: any = fixture.value;
  let reads = 0;
  const model = new GraphPlusVaultModelV1({
    read: () => {
      reads += 1;
      return current;
    },
  }, { countDuplicateLinks: true });
  const runtime = runtimeHarness({ registration: graphPlusRegistration });
  const core = new GraphEngineProviderCoreV1({
    engineVersion: '2.0.0', engineInstanceId: 'shared-graph-plus-application-test',
    capabilities: ['render'], profiles: runtime.profiles, sessions: runtime.factory,
  });
  const globalLease = core.connectLocal({
    consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'],
  });
  const localLease = core.connectLocal({
    consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'],
  });
  const secondLocalLease = core.connectLocal({
    consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'],
  });
  assert(globalLease.ok && localLease.ok && secondLocalLease.ok,
    'all presentations should obtain independent engine leases');
  let openedNotes = 0;
  const application = new GraphPlusApplicationV1({
    model,
    reconcileDelayMs: 0,
    navigator: {
      openNote: async () => { openedNotes += 1; },
      openTag: async () => undefined,
    },
  });
  const global = application.createPresentation({
    mode: 'global', lease: globalLease.lease, container: runtime.container,
    vaultId: 'Test Vault', checkpointStore: {
      load: async () => undefined,
      save: async () => undefined,
    },
  });
  const local = application.createPresentation({
    mode: 'local', lease: localLease.lease, container: runtime.container,
    initialRootNodeId: noteNodeId('Alpha.md'),
  });
  const secondLocal = application.createPresentation({
    mode: 'local', lease: secondLocalLease.lease, container: runtime.container,
    initialRootNodeId: noteNodeId('Alpha.md'),
  });
  await Promise.all([global.open(), local.open()]);
  equal(reads, 1, 'concurrent presentation opens should read canonical vault truth once');

  current = {
    ...fixture.value,
    notes: [...fixture.value.notes, {
      file: { path: 'Gamma.md' }, path: 'Gamma.md', basename: 'Gamma', extension: 'md',
      content: '', tags: [], properties: {},
    }],
  };
  application.receiveHostEvent({ type: 'canonical-vault-invalidated' });
  equal(reads, 1, 'vault invalidation should debounce rather than scan synchronously');
  for (let index = 0; index < 40 && reads < 2; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  equal(reads, 2, 'an open Graph+ application should reconcile a debounced vault invalidation');
  await secondLocal.open();
  equal(reads, 2, 'opening another presentation should reuse already synchronized canonical truth');
  equal(global.getDocument()?.nodes.some((node) => node.id === noteNodeId('Gamma.md')), true,
    'Global should receive the reconciled canonical revision');
  equal(local.getDocument()?.nodes.some((node) => node.id === noteNodeId('Gamma.md')), true,
    'Local should receive the same canonical graph revision');
  equal(secondLocal.getDocument()?.nodes.some((node) => node.id === noteNodeId('Gamma.md')), true,
    'every Local presentation should receive the same canonical revision');
  deepEqual(
    (await local.getSession()?.exportViewState())?.positions,
    (await global.getSession()?.exportViewState())?.positions,
    'Global and Local should expose the same node coordinates',
  );
  equal(runtime.factory.getDiagnostics().sessions.filter((session) => session.layoutAuthority).length, 1,
    'one presentation should advance the shared layout');

  await local.setLens({ ...local.getLens(), query: 'Alpha' });
  equal(global.getLens().query, '',
    'filter changes should stay local to the presentation viewport');
  equal(secondLocal.getLens().query, '',
    'a sibling presentation should retain its own filter state');
  await local.setLens({ ...local.getLens(), query: '' });

  const alphaId = noteNodeId('Alpha.md');
  const betaId = noteNodeId('folder/Beta.md');
  await local.setNodePinned(alphaId, true);
  for (let index = 0; index < 40
    && !(await global.getSession()?.exportViewState())?.pinnedNodeIds.includes(alphaId); index += 1) {
    await Promise.resolve();
  }
  equal((await global.getSession()?.exportViewState())?.pinnedNodeIds.includes(alphaId), true,
    'pinning in Local should update the shared graph state');
  equal((await secondLocal.getSession()?.exportViewState())?.pinnedNodeIds.includes(alphaId), true,
    'shared pins should reach every presentation');
  const globalCameraBeforeLocalFocus = (await global.getSession()?.exportViewState())?.camera;
  await local.revealAndFocusNode(betaId);
  equal((await local.getSession()?.exportViewState())?.focusedNodeId, betaId,
    'one Local presentation may consciously direct its own focal subject');
  equal((await secondLocal.getSession()?.exportViewState())?.focusedNodeId, alphaId,
    'a sibling Local presentation should retain its own Focus until canonical note activity changes');
  equal((await global.getSession()?.exportViewState())?.focusedNodeId, undefined,
    'Global should retain its independent Overview state');
  deepEqual((await global.getSession()?.exportViewState())?.camera, globalCameraBeforeLocalFocus,
    'sharing Local graph state must not move the Global camera');
  await local.followActiveNode(alphaId);

  const firstSession = local.getSession();
  const secondSession = secondLocal.getSession();
  const globalSession = global.getSession();
  assert(firstSession && secondSession && globalSession, 'all presentation sessions should be mounted');
  await globalSession.setSelection([alphaId]);
  let firstCanonicalReplacements = 0;
  let secondCanonicalReplacements = 0;
  let firstRememberedNodeIds: readonly string[] | undefined;
  let secondRememberedNodeIds: readonly string[] | undefined;
  const firstApplyExternalInfluence = firstSession.applyExternalInfluence.bind(firstSession);
  const secondApplyExternalInfluence = secondSession.applyExternalInfluence.bind(secondSession);
  firstSession.applyExternalInfluence = async (influence) => {
    if (influence.type === 'replace-remembered-subjects') {
      firstCanonicalReplacements += 1;
      firstRememberedNodeIds = influence.nodeIds;
    }
    return firstApplyExternalInfluence(influence);
  };
  secondSession.applyExternalInfluence = async (influence) => {
    if (influence.type === 'replace-remembered-subjects') {
      secondCanonicalReplacements += 1;
      secondRememberedNodeIds = influence.nodeIds;
    }
    return secondApplyExternalInfluence(influence);
  };

  await local.openNode(betaId);
  equal(openedNotes, 1, 'one outbound reveal should invoke the bridge operation exactly once');
  equal((await firstSession.exportViewState()).focusedNodeId, alphaId,
    'outbound completion must not optimistically mutate the originating Local presentation');
  equal((await secondSession.exportViewState()).focusedNodeId, alphaId,
    'outbound completion must not masquerade as canonical truth in sibling presentations');

  application.receiveHostEvent({ type: 'active-note-changed', nodeId: betaId });
  for (let index = 0; index < 40 && (
    (await firstSession.exportViewState()).focusedNodeId !== betaId
    || (await secondSession.exportViewState()).focusedNodeId !== betaId
    || firstCanonicalReplacements !== 1
    || secondCanonicalReplacements !== 1
  ); index += 1) await Promise.resolve();
  equal((await firstSession.exportViewState()).focusedNodeId, betaId,
    'canonical active-note truth should fan out to the originating Local policy');
  equal((await secondSession.exportViewState()).focusedNodeId, betaId,
    'canonical active-note truth should fan out to every Local presentation');
  deepEqual((await firstSession.exportViewState()).selectedNodeIds, [alphaId, betaId],
    'canonical fan-out retains the previous root as a constellation member');
  deepEqual((await secondSession.exportViewState()).selectedNodeIds, [alphaId, betaId],
    'each Local constellation retains active-note arrivals independently of Memory');
  equal(firstCanonicalReplacements, 1,
    'the originating Local presentation should apply the received canonical event once');
  equal(secondCanonicalReplacements, 1,
    'a sibling Local presentation should apply the received canonical event once');
  deepEqual(firstRememberedNodeIds, [],
    'the release profile should not project recent notes as Memory constellations');
  deepEqual(secondRememberedNodeIds, [],
    'the release profile should suppress Memory constellations in every Local pane');
  equal(global.getProjectedDocument()?.nodes.length, global.getDocument()?.nodes.length,
    'active-note truth should not alter the Global presentation');
  deepEqual((await globalSession.exportViewState()).selectedNodeIds, [alphaId, betaId],
    'active-note arrival extends Global Attention without replacing it');

  application.receiveHostEvent({ type: 'active-note-changed' });
  for (let index = 0; index < 40 && (
    (await firstSession.exportViewState()).focusedNodeId !== undefined
    || (await secondSession.exportViewState()).focusedNodeId !== undefined
    || firstCanonicalReplacements !== 2
    || secondCanonicalReplacements !== 2
  ); index += 1) await Promise.resolve();
  assert((local.getLocalDocument()?.nodes.length ?? 0) > 0,
    'dropping out of a note should retain the full graph in the originating Local pane');
  assert((secondLocal.getLocalDocument()?.nodes.length ?? 0) > 0,
    'dropping out of a note should retain the full graph in the sibling Local pane');
  deepEqual((await firstSession.exportViewState()).selectedNodeIds, [alphaId, betaId],
    'absence of an active note retains the working constellation');
  deepEqual((await secondSession.exportViewState()).selectedNodeIds, [alphaId, betaId],
    'each rootless Local presentation retains its working constellation');
  deepEqual((await globalSession.exportViewState()).selectedNodeIds, [alphaId, betaId],
    'rootless Local state should not overwrite Global Attention');
  equal(firstCanonicalReplacements, 2,
    'canonical absence should be applied once rather than duplicated with outbound state');
  equal(secondCanonicalReplacements, 2,
    'canonical absence should be applied once to each sibling presentation');

  await application.dispose();
  application.receiveHostEvent({ type: 'canonical-vault-invalidated' });
  application.receiveHostEvent({ type: 'active-note-changed', nodeId: alphaId });
  await application.reconcile();
  equal(reads, 2, 'disposed applications should ignore late host activity and explicit reconciliation');
  await core.dispose();
});

test('Graph+ experience policy gives Global and Local the same canonical document', async () => {
  const fixture = snapshot();
  const model = new GraphPlusVaultModelV1({ read: () => fixture.value }, { countDuplicateLinks: true });
  const canonical = await model.open();
  const globalPolicy = graphPlusExperiencePolicyV1('global');
  const localPolicy = graphPlusExperiencePolicyV1('local');
  const global = projectGraphPlusExperienceDocumentV1({
    policy: globalPolicy,
    canonicalDocument: canonical.document,
  });
  const local = projectGraphPlusExperienceDocumentV1({
    policy: localPolicy,
    canonicalDocument: canonical.document,
  });

  equal(global, canonical.document, 'Global policy should present the canonical vault document directly');
  equal(local, canonical.document,
    'Local should present the exact same canonical graph rather than deriving a neighborhood document');
  deepEqual(local.nodes.map((node) => node.id), canonical.document.nodes.map((node) => node.id),
    'Local should retain canonical node identity and order');
  deepEqual(localPolicy.allowedInteractionStates, ['focus'],
    'Local remains locked in Focus');
  equal(localPolicy.persistence, 'ephemeral', 'Local policy must not inherit the Global checkpoint');
  const globalExperience = graphPlusEngineExperienceContractV1(globalPolicy);
  const localExperience = graphPlusEngineExperienceContractV1(localPolicy);
  equal(globalExperience.attention.maximumNodeCount, undefined,
    'Global should translate to unrestricted constellation Attention');
  equal(localExperience.attention.maximumNodeCount, undefined,
    'Local should permit the shared constellation to remain in Attention');
  equal(localExperience.awareness.attentionNeighborhoodDepth, 0,
    'Local should not manufacture a second neighborhood projection around Attention');
  deepEqual(localExperience.allowedStates, ['focus'],
    'Local allows only the Focus engine View');
  equal(localExperience.permittedInteractions.includes('move-subject'), true,
    'Local Focus policy should retain host-neutral node dragging');
});

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

test('G-ADAPTER engine-owned tag projection preserves ordinary graph structure', () => {
  const fixture = snapshot();
  const adapter = new VaultGraphAdapterV1<FakeFile>({ countDuplicateLinks: true });
  const tagged = adapter.build(fixture.value).document;
  deepEqual(
    tagged.nodes.filter((node) => node.attributes?.kind === 'note'),
    [
      {
        id: noteNodeId('Alpha.md'), label: 'Alpha', tokens: ['kind:note', 'tag:course'],
        attributes: { kind: 'note', path: 'Alpha.md', extension: 'md', tags: ['course'] },
        positionHint: tagged.nodes[0].positionHint,
      },
      {
        id: noteNodeId('folder/Beta.md'), label: 'Beta',
        tokens: ['kind:note', 'tag:course/greek', 'property:status:due'],
        attributes: {
          kind: 'note', path: 'folder/Beta.md', extension: 'md', tags: ['course/greek'],
          'property:status': ['due'],
        },
        positionHint: tagged.nodes[1].positionHint,
      },
    ],
    'moving tag construction into the engine must preserve ordinary note nodes',
  );
  const ordinary = tagged.edges.find((edge) => edge.tokens?.includes('relation:link'))!;
  deepEqual(ordinary, {
    id: `edge:${encodeURIComponent(noteNodeId('Alpha.md'))}:${encodeURIComponent(noteNodeId('folder/Beta.md'))}`,
    sourceId: noteNodeId('Alpha.md'), targetId: noteNodeId('folder/Beta.md'), directed: true, weight: 3,
    tokens: ['relation:link', 'relation:teacher'], attributes: { relations: ['link', 'teacher'] },
  }, 'moving tag construction into the engine must preserve ordinary note links');
});

test('G-ADAPTER deep tag hierarchy emits each structural edge once', () => {
  const fixture = snapshot();
  const document = new VaultGraphAdapterV1<FakeFile>({ countDuplicateLinks: true }).build({
    ...fixture.value,
    notes: fixture.value.notes.map((note, index) => ({
      ...note,
      tags: [index === 0 ? 'quote/1/2/1' : 'quote/1/2/2'],
    })),
  }).document;
  const parentEdges = document.edges.filter((edge) => edge.tokens?.includes('relation:tag-parent'));
  deepEqual(parentEdges.map((edge) => [edge.sourceId, edge.targetId, edge.weight]), [
    ['tag:quote', 'tag:quote/1', 1],
    ['tag:quote/1', 'tag:quote/1/2', 1],
    ['tag:quote/1/2', 'tag:quote/1/2/1', 1],
    ['tag:quote/1/2', 'tag:quote/1/2/2', 1],
  ], 'shared path prefixes should be structure rather than accumulated evidence weight');
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
  equal(compiled.request.scope, 'render', 'Graph+ filtering should affect only this presentation viewport');
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
  equal(overrides.modules?.rendering, undefined,
    'Graph+ should leave background and node colors to the resolved theme palette');
  equal(overrides.modules?.['force-layout'], undefined, 'legacy force lens values should no longer shadow stock profile controls');
  equal(overrides.modules?.form?.enabled, false, 'transient Form ownership should remain in Graph+ session state');
});

class MemoryStore implements GraphPlusCheckpointStoreV1 {
  value?: GraphPlusCheckpointV1;
  saves = 0;
  async load(): Promise<GraphPlusCheckpointV1 | undefined> { return this.value; }
  async save(_vaultId: string, checkpoint: GraphPlusCheckpointV1): Promise<void> { this.value = checkpoint; this.saves += 1; }
}

test('Active notes build a clearable constellation without moving Global framing or changing Views', async () => {
  const fixture = snapshot(); let current: any = fixture.value;
  const runtime = runtimeHarness({ registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1 });
  runtime.profiles.setUserOverrides('graph-plus', 'default', { modules: { 'force-layout': { enabled: false } } });
  const core = new GraphEngineProviderCoreV1({ engineVersion: '2.0.0', engineInstanceId: 'active-constellation-test',
    capabilities: ['render'], profiles: runtime.profiles, sessions: runtime.factory });
  const lease = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
  assert(lease.ok, 'Graph+ obtains an independent presentation lease');
  const application = new GraphPlusApplicationV1({ model: new GraphPlusVaultModelV1({ read: () => current }, { countDuplicateLinks: true }),
    navigator: { openNote: async () => undefined, openTag: async () => undefined } });
  const alpha = noteNodeId('Alpha.md'); const beta = noteNodeId('folder/Beta.md'); const gamma = noteNodeId('Gamma.md');
  application.receiveHostEvent({ type: 'active-note-changed', nodeId: alpha });
  const graph = application.createPresentation({ mode: 'global', lease: lease.lease, container: runtime.container,
    vaultId: fixture.value.vaultId, checkpointStore: new MemoryStore() });
  await graph.open(); const session = graph.getSession()!;
  const settle = async () => { for (let i = 0; i < 100; i += 1) await Promise.resolve(); };
  const initial = await session.exportViewState();
  equal(initial.viewMode, 'overview', 'startup stays in Overview');
  deepEqual(initial.selectedNodeIds, [alpha], 'the active startup note seeds the constellation');
  equal((await session.exportEffectiveSettings()).modules.rendering.settings.labelMode, 'proximity', 'Cursor proximity is the default label mode');
  application.receiveHostEvent({ type: 'active-note-changed', nodeId: beta }); await settle();
  deepEqual((await session.exportViewState()).selectedNodeIds, [alpha, beta], 'note arrival adds without replacing prior members');
  deepEqual((await session.exportViewState()).camera, initial.camera, 'Global note arrival preserves the camera');
  equal((await session.exportViewState()).viewMode, 'overview', 'Global note arrival preserves the View');
  await session.setView('explore'); await session.focusNode(beta);
  const focused = await session.exportViewState();
  application.receiveHostEvent({ type: 'active-note-changed', nodeId: gamma }); await settle();
  current = { ...current, notes: [...current.notes, { file: { path: 'Gamma.md' }, path: 'Gamma.md', basename: 'Gamma',
    extension: 'md', content: '', tags: [], properties: {} }] };
  application.receiveHostEvent({ type: 'canonical-vault-invalidated' }); await application.reconcile(); await settle();
  deepEqual((await session.exportViewState()).selectedNodeIds, [alpha, beta, gamma], 'new-note arrival is admitted after canonical topology catches up');
  equal((await session.exportViewState()).focusedNodeId, beta, 'Global note activity cannot change the Focus subject');
  deepEqual((await session.exportViewState()).camera, focused.camera, 'Global note activity cannot move Focus framing');
  await session.setView('explore');
  deepEqual((await session.exportViewState()).selectedNodeIds, [alpha, beta, gamma], 'Focus back retains the working constellation');
  await session.setView('overview');
  deepEqual((await session.exportViewState()).selectedNodeIds, [], 'Constellation exit clears the working group');
  application.receiveHostEvent({ type: 'active-note-changed', nodeId: gamma }); await settle();
  deepEqual((await session.exportViewState()).selectedNodeIds, [], 'duplicate host activity cannot resurrect a cleared constellation');
  application.receiveHostEvent({ type: 'active-note-changed', nodeId: alpha });
  application.receiveHostEvent({ type: 'active-note-changed', nodeId: beta }); await settle();
  deepEqual((await session.exportViewState()).selectedNodeIds, [alpha, beta], 'rapid note switches retain every activation even when the queue coalesces');
  equal((await session.exportViewState()).viewMode, 'overview', 'rebuilding after a clear keeps Overview');
  await application.dispose(); await core.dispose();
});

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

test('V1.7.1 explicit global reveal enters Focus without changing the full projection', async () => {
  const fixture = snapshot();
  const runtime = runtimeHarness({ registration: graphPlusRegistration });
  const core = new GraphEngineProviderCoreV1({
    engineVersion: '1.7.1', engineInstanceId: 'graph-plus-explicit-reveal-test', capabilities: ['render'],
    profiles: runtime.profiles, sessions: runtime.factory,
  });
  const lease = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
  assert(lease.ok, 'Graph+ should obtain a lease for explicit reveal');
  const store = new MemoryStore();
  let releaseLoad!: () => void;
  const loadReleased = new Promise<void>((resolve) => { releaseLoad = resolve; });
  const load = store.load.bind(store);
  store.load = async () => {
    await loadReleased;
    return load();
  };
  const consumer = new GraphPlusConsumerV1({
    lease: lease.lease,
    container: runtime.container,
    vaultId: fixture.value.vaultId,
    source: { read: () => fixture.value },
    checkpointStore: store,
    navigator: { openNote: async () => undefined, openTag: async () => undefined },
    countDuplicateLinks: true,
  });
  const opening = consumer.open();
  const navigationWait = consumer.open();
  releaseLoad();
  await Promise.all([opening, navigationWait]);
  const alphaId = noteNodeId('Alpha.md');
  const session = consumer.getSession();
  assert(session, 'the global graph should expose its engine session');
  const cameraBeforeReveal = (await session.exportViewState()).camera;
  const surface = runtime.container.querySelector<HTMLElement>('[data-graph-engine-session]');
  assert(surface, 'the global graph should expose its mounted session surface');
  equal(runtime.container.querySelectorAll('[data-graph-engine-session]').length, 1,
    'navigation waiting on startup should share the in-flight consumer mount');

  const receivedInputs: Array<Parameters<typeof session.applyExternalInfluence>[0]> = [];
  const receive = session.applyExternalInfluence.bind(session);
  session.applyExternalInfluence = async (input) => { receivedInputs.push(input); return receive(input); };
  const endogenousEvents: string[] = [];
  const arrivalSubscription = session.onIntent((intent) => endogenousEvents.push(intent.type));

  equal(await consumer.revealAndFocusNode(alphaId), true, 'explicit global navigation should reveal and focus the requested note');
  deepEqual(receivedInputs, [{ schemaVersion: 1, type: 'replace-attention', nodeIds: [alphaId], focusNodeId: alphaId, framing: 'preserve' }],
    'Show in Graph+ enters through the application external-input boundary');
  deepEqual(endogenousEvents, [], 'external reveal never impersonates a conscious user action');
  arrivalSubscription.dispose();
  equal((await consumer.getSession()?.exportViewState())?.focusedNodeId, alphaId,
    'explicit global navigation should use ordinary graph focus state');
  const revealed = await session.exportViewState();
  deepEqual(revealed.camera.target, revealed.positions[alphaId],
    'programmatic Focus should center the active note');
  assert(JSON.stringify(revealed.camera) !== JSON.stringify(cameraBeforeReveal),
    'programmatic Focus should fit the active note neighborhood');
  await session.focusNode(null);
  const state = await session.exportViewState();
  deepEqual(state.selectedNodeIds, [alphaId],
    'exiting a one-node Focus retains its constellation');
  equal(state.viewMode, 'explore', 'a singleton follows the same View hierarchy');
  await session.setView('overview');
  const cameraBeforeClick = state.camera;
  const camera = new GraphCameraController(state.camera, state.dimensions);
  camera.setViewport(640, 360);
  const point = camera.worldToScreen(state.positions[alphaId]);
  dispatchGraphClick(runtime.window, runtimeCanvas(runtime.container), point.x, point.y, 731);
  runtime.platform.flushFrame();
  await Promise.resolve();
  const selected = await session.exportViewState();
  deepEqual(selected.selectedNodeIds, [alphaId], 'graph input should create an initial selection');
  equal(selected.focusedNodeId, undefined,
    'an initial one-node selection should enter Constellation');
  deepEqual(selected.camera, cameraBeforeClick,
    'entering Constellation should preserve the current camera framing');
  await session.resetCamera();
  await Promise.resolve();
  deepEqual((await session.exportViewState()).selectedNodeIds, [alphaId],
    'resetting the camera should preserve global graph selection');
  equal(surface.dataset.renderedNodeCount, String(consumer.getDocument()?.nodes.length),
    'a normal split should retain the complete saved projection');

  await consumer.close();
  equal(store.value?.viewState?.activeFilters.projection, undefined,
    'transient explicit reveal should not enter the durable checkpoint');
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

test('Local Graph+ reuses the full graph while active-note Focus changes', async () => {
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
  let openedPath: string | undefined;
  const consumer = new LocalGraphPlusConsumerV1({
    lease: lease.lease,
    container: runtime.container,
    source: { read: () => fixture.value },
    navigator: {
      openNote: async (file) => { openedPath = file.path; },
      openTag: async () => undefined,
    },
    countDuplicateLinks: true,
    initialRootNodeId: alphaId,
  });
  await consumer.open();
  let local = consumer.getLocalDocument();
  assert(local, 'Local Graph+ should mount the canonical graph document');
  assert(local.nodes.some((node) => node.id === alphaId), 'the shared graph should contain the active subject');
  equal(local.nodes.length, 4, 'Local should load the full canonical graph');
  let state = await consumer.getSession()?.exportViewState();
  equal(state?.focusedNodeId, alphaId, 'the local root should own ordinary focus state');
  equal(state?.pinnedNodeIds.includes(alphaId), false,
    'following an active note should not turn Focus into a layout constraint');

  const session = consumer.getSession();
  assert(session, 'the local graph should retain its engine session');
  let frameTime = 0;
  for (let index = 0; index < 360
    && (runtime.platform.pendingFrames > 0 || runtime.platform.pendingTimers > 0); index += 1) {
    runtime.platform.advanceTime(1_000 / 30);
    runtime.platform.flushTimer();
    frameTime += 1_000 / 30;
    runtime.platform.flushFrame(frameTime);
  }
  const activeNoteIntents: string[] = [];
  session.onIntent((intent) => activeNoteIntents.push(intent.type));
  let documentReplacements = 0;
  const replaceDocument = session.replaceDocument.bind(session);
  session.replaceDocument = async (document) => {
    documentReplacements += 1;
    await replaceDocument(document);
  };
  const beforeFollow = await session.exportViewState();
  const documentIdBeforeFollow = local?.documentId;
  equal(await consumer.followActiveNode(betaId), true, 'the local view should follow a newly active note');
  local = consumer.getLocalDocument();
  state = await consumer.getSession()?.exportViewState();
  assert(state, 'Local Graph+ should export its followed Focus state');
  equal(local?.documentId, documentIdBeforeFollow,
    'an active-note hop should preserve the canonical graph identity');
  equal(documentReplacements, 0,
    'an active-note hop across existing members should not replace the document');
  equal(state.focusedNodeId, betaId, 'focus should transfer with the active note');
  deepEqual(state.positions, beforeFollow.positions,
    'an active-note hop across existing local members should preserve every node position');
  equal(state.camera.zoom, beforeFollow.camera.zoom,
    'an active-note hop should preserve camera scale instead of fitting again');
  equal(vectorDistance(state.camera.position, state.camera.target),
    vectorDistance(beforeFollow.camera.position, beforeFollow.camera.target),
    'an active-note hop should preserve perspective distance');
  assert(vectorDistance(state.camera.target, state.positions[betaId]) < 1e-9, 'local active-note following recenters on the new root');
  deepEqual(activeNoteIntents, [],
    'canonical active-note truth should bypass the endogenous intent stream');

  const positionsBeforeFocusHop = state.positions;
  const zoomBeforeFocusHop = state.camera.zoom;
  await consumer.focusNode(alphaId);
  const consciouslyFocused = await session.exportViewState();
  equal(consumer.getLocalDocument()?.documentId, documentIdBeforeFollow,
    'a Local Focus hop should preserve canonical graph identity');
  deepEqual(consciouslyFocused.positions, positionsBeforeFocusHop,
    'a Local Focus hop should preserve existing node positions');
  equal(consciouslyFocused.camera.zoom, zoomBeforeFocusHop,
    'a Local Focus hop should preserve camera scale');
  deepEqual(consciouslyFocused.selectedNodeIds, [alphaId, betaId],
    'application-directed Local Focus retains the prior root in its constellation');
  equal(consciouslyFocused.focusedNodeId, alphaId,
    'Local Attention should move to the requested Focus subject');
  assert(vectorDistance(consciouslyFocused.camera.target, consciouslyFocused.positions[alphaId]) < 1e-9, 'Local Focus hopping recenters on the requested root');
  await consumer.openNode(alphaId);
  equal(openedPath, 'Alpha.md', 'the explicit outbound action should reveal the focused note');
  equal(consumer.getLocalDocument()?.documentId, documentIdBeforeFollow,
    'outbound reveal completion must not independently mutate canonical Local truth');

  const beforeReturnToAlpha = await session.exportViewState();
  equal(await consumer.followActiveNode(alphaId), true,
    'the later canonical active-note push should move Focus within the shared graph');
  equal(consumer.getLocalDocument()?.documentId, documentIdBeforeFollow,
    'received canonical truth should not recreate the Local document');
  equal(documentReplacements, 0,
    'revisiting a remembered subject should not replace the Local document');
  deepEqual((await session.exportViewState()).positions, beforeReturnToAlpha.positions,
    'revisiting a remembered subject should preserve the settled layout');
  await session.resetCamera();
  await Promise.resolve();
  equal((await session.exportViewState()).focusedNodeId, alphaId,
    'resetting the camera should preserve local graph focus');

  equal(await consumer.followActiveNode(undefined), true,
    'absence of an active Markdown note should be accepted as canonical truth');
  assert((consumer.getLocalDocument()?.nodes.length ?? 0) > 0,
    'dropping out of a note should retain the full Local graph document');
  const blank = await session.exportViewState();
  deepEqual(blank.selectedNodeIds, [alphaId, betaId],
    'a rootless Local presentation retains its working constellation');
  equal(blank.focusedNodeId, alphaId, 'absence of an active note retains the last Local Focus root');
  await consumer.close();
  await core.dispose();
});

test('Local Graph+ ignores content-only vault reconciliation but receives changed canonical topology', async () => {
  const fixture = snapshot();
  let current: any = fixture.value;
  const runtime = runtimeHarness({ registration: graphPlusRegistration });
  const core = new GraphEngineProviderCoreV1({
    engineVersion: '2.0.0', engineInstanceId: 'local-stable-reconcile-test', capabilities: ['render'],
    profiles: runtime.profiles, sessions: runtime.factory,
  });
  const lease = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
  assert(lease.ok, 'Local Graph+ should obtain a session lease');
  const consumer = new LocalGraphPlusConsumerV1({
    lease: lease.lease,
    container: runtime.container,
    source: { read: () => current },
    navigator: { openNote: async () => undefined, openTag: async () => undefined },
    countDuplicateLinks: true,
    initialRootNodeId: noteNodeId('Alpha.md'),
  });
  await consumer.open();
  const session = consumer.getSession();
  assert(session, 'Local Graph+ should expose its mounted session');
  let replacements = 0;
  const replaceDocument = session.replaceDocument.bind(session);
  session.replaceDocument = async (document) => {
    replacements += 1;
    await replaceDocument(document);
  };

  current = {
    ...fixture.value,
    notes: fixture.value.notes.map((note) => note.path === 'Alpha.md'
      ? { ...note, content: `${note.content} One more typed character.` }
      : note),
  };
  await consumer.reconcile();
  equal(replacements, 0, 'typing without changing local graph membership or links must not replace the session document');

  const gamma = { path: 'Gamma.md' };
  current = {
    ...current,
    notes: [...current.notes, {
      file: gamma, path: gamma.path, basename: 'Gamma', extension: 'md', content: '', tags: [], properties: {},
    }],
    resolvedLinks: { ...current.resolvedLinks, 'Alpha.md': { ...current.resolvedLinks['Alpha.md'], 'Gamma.md': 1 } },
  };
  await consumer.reconcile();
  equal(replacements, 1, 'a canonical topology change should replace the session document once');
  assert(consumer.getLocalDocument()?.nodes.some((node) => node.id === noteNodeId('Gamma.md')),
    'the changed topology should appear in the local graph');

  await consumer.close();
  await core.dispose();
});

test('Local Graph+ admits saved full-graph coordinates without force settling and fits once', async () => {
  const fixture = snapshot();
  const canonical = new VaultGraphAdapterV1<FakeFile>({ countDuplicateLinks: true }).build(fixture.value).document;
  const savedPositions = Object.fromEntries(canonical.nodes.map((node, index) => [node.id, {
    x: index * 240 - 360,
    y: index % 2 === 0 ? -120 : 120,
    z: 0,
  }]));
  const store = new MemoryStore();
  store.value = {
    document: canonical,
    viewState: {
      schemaVersion: 1,
      documentId: canonical.documentId,
      documentRevision: canonical.revision,
      consumerId: 'graph-plus',
      profileId: 'default',
      dimensions: '2d',
      positions: savedPositions,
      pinnedNodeIds: [],
      camera: {
        position: { x: 0, y: 0, z: 10 }, target: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 }, zoom: 1, projection: 'orthographic',
      },
      selectedNodeIds: [],
      viewMode: 'overview',
      activeFilters: {},
      moduleState: {},
    },
    savedAt: 1,
  };
  const runtime = runtimeHarness({ registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1 });
  const core = new GraphEngineProviderCoreV1({
    engineVersion: '2.0.0', engineInstanceId: 'local-reference-layout-test', capabilities: ['render'],
    profiles: runtime.profiles, sessions: runtime.factory,
  });
  const lease = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
  assert(lease.ok, 'Local Graph+ should obtain a session lease');
  const alphaId = noteNodeId('Alpha.md');
  const betaId = noteNodeId('folder/Beta.md');
  const consumer = new LocalGraphPlusConsumerV1({
    lease: lease.lease,
    container: runtime.container,
    vaultId: fixture.value.vaultId,
    checkpointStore: store,
    source: { read: () => fixture.value },
    navigator: { openNote: async () => undefined, openTag: async () => undefined },
    countDuplicateLinks: true,
    initialRootNodeId: alphaId,
  });
  await consumer.open();
  const session = consumer.getSession();
  assert(session, 'Local Graph+ should expose its mounted session');
  let state = await session.exportViewState();
  for (const node of consumer.getLocalDocument()?.nodes ?? []) {
    deepEqual(state.positions[node.id], savedPositions[node.id],
      'initial Local members should use their saved full-graph coordinates');
  }
  equal((runtime.factory.getDiagnostics().sessions[0]?.modules['force-layout'] as { targetStepRateHz?: number })?.targetStepRateHz, 0,
    'restoring known coordinates should start Local physics settled');

  const cameraBeforeFollow = state.camera;
  equal(await consumer.followActiveNode(betaId), true,
    'following a new subject should reuse the loaded full graph');
  state = await session.exportViewState();
  for (const node of consumer.getLocalDocument()?.nodes ?? []) {
    deepEqual(state.positions[node.id], savedPositions[node.id],
      'every Local node should retain its saved full-graph coordinates');
  }
  assert(vectorDistance(state.camera.target, state.positions[betaId]) < 1e-9, 'a later active note recenters without refitting');
  equal(state.camera.zoom, cameraBeforeFollow.zoom, 'active note changes preserve the initialized scale');
  const settledPositions = state.positions;
  for (let index = 1; index <= 60; index += 1) {
    runtime.platform.advanceTime(1_000 / 30);
    runtime.platform.flushTimer();
    runtime.platform.flushFrame(index * (1_000 / 30));
  }
  deepEqual((await session.exportViewState()).positions, settledPositions,
    'known Local coordinates should remain static after the camera fit');

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

test('G-PARITY-09 Graph+ retains dormant Form data while its profile switches and restores dimensions', async () => {
  const fixture = snapshot();
  const store = new MemoryStore();
  const first = runtimeHarness({ registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1 });
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
  // Seed an older saved Mind Map configuration; it must stay dormant.
  await firstConsumer.setLens({ ...firstConsumer.getLens(), form: { ...firstConsumer.getLens().form, enabled: true, rootNodeId: rootId } });
  equal((await session.exportEffectiveSettings()).modules.form.enabled, false, 'the Graph+ profile keeps legacy Mind Map disabled');
  first.profiles.setUserOverrides('graph-plus', 'default', { dimensions: '3d' });
  first.factory.refreshActiveProfiles();
  equal(firstConsumer.getSession(), session, 'live dimension switching should retain the Graph+ session handle');
  equal((await session.exportViewState()).dimensions, '3d', 'Graph+ should switch its existing graph to 3d');
  equal(firstConsumer.getLens().form.rootNodeId, rootId, 'Graph+ should retain the Form root through the switch');
  await firstConsumer.close();
  await firstCore.dispose();
  equal(store.value?.viewState?.dimensions, '3d', 'Graph+ should checkpoint the active destination dimension');
  equal(store.value?.lens?.form.rootNodeId, rootId, 'Graph+ should checkpoint its consumer-owned Form root');

  const second = runtimeHarness({ registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1 });
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
  equal(restored.getLens().form.enabled, true, 'restored Graph+ should preserve dormant Form configuration');
  equal(restored.getLens().form.rootNodeId, rootId, 'restored Graph+ should retain the same root');
  equal((await restored.getSession()?.exportEffectiveSettings())?.modules.form.enabled, false, 'restoration cannot reactivate Mind Map');
  await restored.close();
  await secondCore.dispose();
});

/* Mind Map deferred: retain this acceptance test with the feature.
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

*/

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

function vectorDistance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
