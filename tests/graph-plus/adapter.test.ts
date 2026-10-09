import { resolveClearConstellationActionV1 } from '../../src/obsidian/graph-engine-ui/GraphEngineClearConstellationAction.ts';
import type { GraphSessionControlPortV1 } from '../../src/graph-engine/runtime/host/GraphSessionControlPort.ts';
import type { ConsumerRegistrationV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import { ConsumerProfileRegistry } from '../../src/graph-engine/core/profile/index.ts';
import { GraphCameraController, SessionFactory } from '../../src/graph-engine/runtime/index.ts';
import { GraphEngineProviderCoreV1 } from '../../src/graph-engine/service/index.ts';
import {
  ObsidianVaultGraphSourceV1,
  VaultGraphAdapterV1,
  noteNodeId,
  tagNodeId,
  type VaultGraphSnapshotV1,
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
import { compileGraphPlusFilterV1, createDefaultGraphPlusLensV1, graphPlusSessionOverridesV1, graphNodeSearchIndexV1 } from '../../src/graph-plus/query/index.ts';
import { lastSimpleSearchQuery, simpleSearchPreparations } from '../support/obsidianSearch.ts';
import { graphNode } from '../support/contractFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';
import { runtimeCanvas, runtimeHarness, runtimeFixture, runtimeRegistration, InstrumentedPlatform } from '../support/runtimeHarness.ts';
import { Window } from 'happy-dom';

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

test('duplicate-link settings reconcile reversibly without replacing the vault model', async () => {
  const model = new GraphPlusVaultModelV1({ read: () => snapshot().value }, { countDuplicateLinks: true });
  const first = await model.open();
  const weight = (value: typeof first) => value.document.edges.find(edge => edge.sourceId === noteNodeId('Alpha.md') && edge.targetId === noteNodeId('folder/Beta.md'))?.weight;
  equal(weight(first), 3, 'initial repeated-link weight');
  equal(model.setCountDuplicateLinks(false), true, 'changed option invalidates interpretation');
  const unweighted = await model.reconcile();
  equal(weight(unweighted), 1, 'disabled option removes repeat weighting');
  equal(unweighted.document.documentId, first.document.documentId, 'document identity stays stable');
  equal(unweighted.document.revision, first.document.revision + 1, 'changed edge advances revision');
  equal(model.setCountDuplicateLinks(false), false, 'same option is a no-op');
  equal((await model.reconcile()).document, unweighted.document, 'unchanged interpretation retains revision');
  model.setCountDuplicateLinks(true);
  const weighted = await model.reconcile();
  equal(weight(weighted), 3, 're-enabling restores canonical repeated-link weight');
  equal(weighted.document.revision, unweighted.document.revision + 1, 'reverse change also advances revision');
});

test('duplicate-link changes during a vault read use the latest configuration', async () => {
  let finishRead!: () => void;
  const gate = new Promise<void>(resolve => { finishRead = resolve; });
  const model = new GraphPlusVaultModelV1({ read: async () => { await gate; return snapshot().value; } },
    { countDuplicateLinks: true });
  const opening = model.open();
  await Promise.resolve();
  model.setCountDuplicateLinks(false);
  finishRead();
  const result = await opening;
  equal(result.document.edges.find(edge => edge.sourceId === noteNodeId('Alpha.md')
    && edge.targetId === noteNodeId('folder/Beta.md'))?.weight, 1,
    'in-flight adaptation should apply the latest option');
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

  const globalBeforeWeightChange = await global.getSession()!.exportViewState();
  const localBeforeWeightChange = await local.getSession()!.exportViewState();
  const globalSessionBeforeWeightChange = global.getSession();
  await application.setCountDuplicateLinks(false);
  for (const pane of [global, local]) {
    equal(pane.getDocument()?.edges.find(edge => edge.sourceId === noteNodeId('Alpha.md') && edge.targetId === noteNodeId('folder/Beta.md'))?.weight, 1,
      'open Global and Local panes should immediately see unweighted links');
  }
  equal(global.getSession(), globalSessionBeforeWeightChange, 'toggle must preserve the mounted session');
  deepEqual((await global.getSession()!.exportViewState()).camera, globalBeforeWeightChange.camera,
    'toggle must preserve Global framing');
  deepEqual((await local.getSession()!.exportViewState()).camera, localBeforeWeightChange.camera,
    'toggle must preserve Local framing');
  await application.setCountDuplicateLinks(true);
  equal(global.getDocument()?.edges.find(edge => edge.sourceId === noteNodeId('Alpha.md') && edge.targetId === noteNodeId('folder/Beta.md'))?.weight, 3,
    'open panes should support toggling back');
  const readsBeforeInvalidation = reads;

  current = {
    ...fixture.value,
    notes: [...fixture.value.notes, {
      file: { path: 'Gamma.md' }, path: 'Gamma.md', basename: 'Gamma', extension: 'md',
      tags: [], properties: {},
    }],
  };
  application.receiveHostEvent({ type: 'canonical-vault-invalidated' });
  equal(reads, readsBeforeInvalidation, 'vault invalidation should debounce rather than scan synchronously');
  for (let index = 0; index < 40 && reads === readsBeforeInvalidation; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  equal(reads, readsBeforeInvalidation + 1, 'an open Graph+ application should reconcile a debounced vault invalidation');
  await secondLocal.open();
  equal(reads, readsBeforeInvalidation + 1, 'opening another presentation should reuse already synchronized canonical truth');
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
  let firstMemoryReplacements = 0;
  let secondMemoryReplacements = 0;
  let firstRememberedNodeIds: readonly string[] | undefined;
  let secondRememberedNodeIds: readonly string[] | undefined;
  const firstApplyExternalInfluence = firstSession.applyExternalInfluence.bind(firstSession);
  const secondApplyExternalInfluence = secondSession.applyExternalInfluence.bind(secondSession);
  firstSession.applyExternalInfluence = async (influence) => {
    if (influence.type === 'replace-remembered-subjects') {
      firstMemoryReplacements += 1;
      firstRememberedNodeIds = influence.nodeIds;
    }
    return firstApplyExternalInfluence(influence);
  };
  secondSession.applyExternalInfluence = async (influence) => {
    if (influence.type === 'replace-remembered-subjects') {
      secondMemoryReplacements += 1;
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
    || !(await globalSession.exportViewState()).selectedNodeIds.includes(betaId)
  ); index += 1) await Promise.resolve();
  equal((await firstSession.exportViewState()).focusedNodeId, betaId,
    'canonical active-note truth should fan out to the originating Local policy');
  equal((await secondSession.exportViewState()).focusedNodeId, betaId,
    'canonical active-note truth should fan out to every Local presentation');
  deepEqual((await firstSession.exportViewState()).selectedNodeIds, [alphaId, betaId],
    'canonical fan-out retains the previous root as a constellation member');
  deepEqual((await secondSession.exportViewState()).selectedNodeIds, [alphaId, betaId],
    'each Local constellation retains active-note arrivals independently of Memory');
  equal(firstMemoryReplacements, 0,
    'active-note changes must not reinstall unchanged empty visual Memory');
  equal(secondMemoryReplacements, 0,
    'sibling Local panes must also skip unchanged empty visual Memory');
  equal(firstRememberedNodeIds, undefined,
    'no replacement influence should be emitted for the disabled Memory projection');
  equal(secondRememberedNodeIds, undefined,
    'disabled Memory projection must not emit a sibling replacement either');
  equal(global.getProjectedDocument()?.nodes.length, global.getDocument()?.nodes.length,
    'active-note truth should not alter the Global presentation');
  deepEqual((await globalSession.exportViewState()).selectedNodeIds, [alphaId, betaId],
    'active-note arrival extends Global Attention without replacing it');

  application.receiveHostEvent({ type: 'active-note-changed' });
  for (let index = 0; index < 40 && (
    (await firstSession.exportViewState()).focusedNodeId !== undefined
    || (await secondSession.exportViewState()).focusedNodeId !== undefined
    || firstMemoryReplacements !== 0
    || secondMemoryReplacements !== 0
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
  equal(firstMemoryReplacements, 0,
    'canonical absence must not reinstall unchanged empty visual Memory');
  equal(secondMemoryReplacements, 0,
    'canonical absence also skips unchanged sibling visual Memory');

  await application.dispose();
  application.receiveHostEvent({ type: 'canonical-vault-invalidated' });
  application.receiveHostEvent({ type: 'active-note-changed', nodeId: alphaId });
  await application.reconcile();
  equal(reads, readsBeforeInvalidation + 1, 'disposed applications should ignore late host activity and explicit reconciliation');
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

test('Graph+ simple search discovers names, tags, and relative paths through the ID filter', () => {
  const projection = new VaultGraphAdapterV1<FakeFile>({ countDuplicateLinks: true }).build(snapshot().value);
  const search = (query: string, showTags = true) => compileGraphPlusFilterV1(projection.document, {
    ...createDefaultGraphPlusLensV1(), query, showTags,
  }, projection.searchIndex);
  deepEqual(search('ALPHA').visibleNodeIds, [noteNodeId('Alpha.md')], 'node names should match through the host matcher');
  deepEqual(search('folder/Beta.md').visibleNodeIds, [noteNodeId('folder/Beta.md')], 'vault-relative paths should be searchable');
  deepEqual(search('#course/greek').visibleNodeIds, [noteNodeId('folder/Beta.md'), tagNodeId('course/greek')],
    'a matching tag should include its tag node and associated note');
  deepEqual(search('course').visibleNodeIds, [noteNodeId('Alpha.md'), noteNodeId('folder/Beta.md'), tagNodeId('course'), tagNodeId('course/greek')],
    'parent tags should discover matching descendant tags and their notes');
  deepEqual(search('course/greek', false).visibleNodeIds, [noteNodeId('folder/Beta.md')],
    'hiding tag nodes must retain matching associated notes');
  deepEqual(search('due').visibleNodeIds, [], 'frontmatter properties should stay outside searchable text');
  deepEqual(search('   ').visibleNodeIds, projection.document.nodes.map((node) => node.id), 'blank search should clear the text filter');
  equal(search('beta').request.scope, 'render', 'search should affect only this viewport');
  deepEqual(search('beta').request.node, { op: 'id-in', ids: [noteNodeId('folder/Beta.md')] }, 'search should feed the existing opaque ID filter');
});

test('Graph+ delegates each query unchanged to one public simple-search callback', () => {
  const projection = new VaultGraphAdapterV1<FakeFile>({ countDuplicateLinks: true }).build(snapshot().value);
  for (const query of ['alpha OR beta', 'file:alpha', '/Alpha/', '(alpha', '-alpha', '"alpha']) {
    const before = simpleSearchPreparations;
    compileGraphPlusFilterV1(projection.document, { ...createDefaultGraphPlusLensV1(), query }, projection.searchIndex);
    equal(lastSimpleSearchQuery, query, 'Graph+ must not interpret or rewrite search language');
    equal(simpleSearchPreparations - before, 1, 'each query should prepare one matcher for all nodes');
  }
  const before = simpleSearchPreparations;
  compileGraphPlusFilterV1(projection.document, createDefaultGraphPlusLensV1(), projection.searchIndex);
  equal(simpleSearchPreparations, before, 'empty input should skip matcher preparation');
});

test('Graph+ matching tag labels expand metadata membership before visibility controls', () => {
  const document = {
    schemaVersion: 1 as const, documentId: 'tag-membership', revision: 0,
    nodes: [
      graphNode('note', { label: 'Unrelated name', attributes: { kind: 'note', path: 'folder/note.md' } }),
      graphNode('tag', { label: '#Discovery', attributes: { kind: 'tag' } }),
      graphNode('orphan', { label: 'Discovery orphan', attributes: { kind: 'note' } }),
    ],
    edges: [{ id: 'membership', sourceId: 'note', targetId: 'tag', tokens: ['relation:tag'] }],
  };
  const result = compileGraphPlusFilterV1(document, {
    ...createDefaultGraphPlusLensV1(), query: 'Discovery', showTags: false, showOrphans: false,
  });
  deepEqual(result.visibleNodeIds, ['note'], 'membership should expand a tag name match even without duplicated note tags, while respecting visibility');
});

test('Graph+ search index follows metadata revisions and reuses unchanged documents', () => {
  const fixture = snapshot();
  const adapter = new VaultGraphAdapterV1<FakeFile>({ countDuplicateLinks: true });
  const first = adapter.build(fixture.value, 7);
  equal(graphNodeSearchIndexV1(first.document), first.searchIndex, 'filter fallback should reuse the existing index');
  const unchanged = adapter.reconcile(first.document, fixture.value);
  equal(unchanged.searchIndex, first.searchIndex, 'unchanged metadata should reuse the searchable index');
  const renamed = adapter.reconcile(first.document, {
    ...fixture.value,
    notes: fixture.value.notes.map((note) => note.path === 'Alpha.md'
      ? { ...note, path: 'new/Renamed.md', basename: 'Renamed', tags: ['fresh'] }
      : note),
  });
  assert(renamed.searchIndex !== first.searchIndex, 'metadata changes should produce a fresh index');
  const search = (query: string) => compileGraphPlusFilterV1(renamed.document, {
    ...createDefaultGraphPlusLensV1(), query,
  }, renamed.searchIndex).visibleNodeIds;
  deepEqual(search('Alpha'), [], 'renames should remove old names and paths');
  deepEqual(search('new/Renamed.md'), [noteNodeId('new/Renamed.md')], 'renames should index the new path');
  deepEqual(search('#fresh'), [noteNodeId('new/Renamed.md'), tagNodeId('fresh')], 'tag changes should update membership search');
  const removed = adapter.reconcile(renamed.document, { ...fixture.value, notes: [], resolvedLinks: {} });
  equal(removed.searchIndex.size, 0, 'deletions should remove stale entries');
});

test('Graph+ source uses cached metadata without reading note bodies', async () => {
  const file = { path: 'Faith.md', basename: 'Faith', extension: 'md', stat: { mtime: 10 } };
  let bodyReads = 0;
  let tags = ['#course'];
  const source = new ObsidianVaultGraphSourceV1({
    vault: {
      getMarkdownFiles: () => [file], getName: () => 'Test Vault',
      cachedRead: () => { bodyReads += 1; throw new Error('Note contents must not be read.'); },
      read: () => { bodyReads += 1; throw new Error('Note contents must not be read.'); },
    },
    metadataCache: {
      resolvedLinks: {}, getFileCache: () => ({ tags: tags.map((tag) => ({ tag })) }),
      getFirstLinkpathDest: () => null,
    },
  } as never);
  const first = await source.read();
  deepEqual(first.notes[0]?.tags, ['course'], 'cached tags should populate graph metadata');
  tags = ['#updated'];
  file.stat.mtime += 1;
  const second = await source.read();
  deepEqual(second.notes[0]?.tags, ['updated'], 'later snapshots should refresh metadata');
  equal(bodyReads, 0, 'initial and subsequent metadata snapshots must never read note bodies');
  assert(!('content' in second.notes[0]), 'snapshots should not retain content');
});

test('Graph+ simple search preserves constellation reconciliation and uses the mounted metadata index', async () => {
  const fixture = snapshot();
  let current: VaultGraphSnapshotV1<FakeFile> = fixture.value;
  let sourceReads = 0;
  const runtime = runtimeHarness({ registration: graphPlusRegistration });
  const core = new GraphEngineProviderCoreV1({
    engineVersion: '2.0.0', engineInstanceId: 'simple-search-constellation', capabilities: ['render'],
    profiles: runtime.profiles, sessions: runtime.factory,
  });
  const lease = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
  assert(lease.ok, 'Graph+ should obtain its session lease');
  const consumer = new GraphPlusConsumerV1({
    lease: lease.lease, container: runtime.container,
    vaultId: fixture.value.vaultId, checkpointStore: new MemoryStore(),
    source: { read: () => { sourceReads += 1; return current; } },
    navigator: { openNote: async () => undefined, openTag: async () => undefined },
    countDuplicateLinks: true,
  });
  try {
    await consumer.open();
    const session = consumer.getSession();
    assert(session, 'Graph+ should expose its mounted session');
    let appliedIds: readonly string[] = [];
    const applyFilter = session.applyFilter.bind(session);
    session.applyFilter = async (request) => {
      appliedIds = (request.node as { ids: readonly string[] }).ids;
      await applyFilter(request);
    };
    const alphaId = noteNodeId('Alpha.md');
    const betaId = noteNodeId('folder/Beta.md');
    await session.setSelection([alphaId, betaId]);
    await session.setView('explore');
    const before = await session.exportViewState();
    const readsBeforeSearch = sourceReads;
    await consumer.setLens({ ...consumer.getLens(), query: '#course/greek', showTags: false });
    const filtered = await session.exportViewState();
    deepEqual(filtered.selectedNodeIds, [betaId], 'search should reconcile unavailable constellation members through the existing filter');
    equal(filtered.viewMode, before.viewMode, 'the remaining constellation should preserve its View');
    deepEqual(filtered.camera, before.camera, 'search should preserve constellation framing');
    await consumer.setLens({ ...consumer.getLens(), query: '' });
    deepEqual((await session.exportViewState()).selectedNodeIds, [betaId], 'clearing search should not automatically add nodes to the constellation');
    equal(sourceReads, readsBeforeSearch, 'changing search must not trigger vault scans');
    await consumer.setLens({ ...consumer.getLens(), query: '#course/greek' });
    current = { ...fixture.value, notes: [fixture.value.notes[0], { ...fixture.value.notes[1], tags: ['course/greek'] }] };
    await consumer.reconcile();
    deepEqual(appliedIds, [alphaId, betaId], 'an active query should discover changed graph metadata');
  } finally {
    await consumer.close();
    await core.dispose();
  }
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

test('Global and Local retain bounded note history without repeated empty Memory influences', async () => {
  const notes = Array.from({ length: 12 }, (_, index) => ({
    file: { path: `note-${index}.md` }, path: `note-${index}.md`, basename: `note-${index}`,
    extension: 'md', tags: [], properties: {},
  }));
  const runtime = runtimeHarness({ registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1 });
  runtime.profiles.setUserOverrides('graph-plus', 'default', { modules: { 'force-layout': { enabled: false } } });
  const memoryInstalls = new Map<object, number>();
  const core = new GraphEngineProviderCoreV1({ engineVersion: '2.0.0', engineInstanceId: 'memory-change-detection',
    capabilities: ['render'], profiles: runtime.profiles, sessions: runtime.factory, sessionUiHost: {
      mount: ({ session }) => {
        memoryInstalls.set(session, 0);
        const apply = session.applyExternalInfluence.bind(session);
        session.applyExternalInfluence = influence => {
          if (influence.type === 'replace-remembered-subjects') memoryInstalls.set(session, memoryInstalls.get(session)! + 1);
          return apply(influence);
        };
        return { dispose: () => undefined };
      },
    } });
  const application = new GraphPlusApplicationV1({
    model: new GraphPlusVaultModelV1({ read: () => ({ vaultId: 'Memory test', notes, resolvedLinks: {} }) },
      { countDuplicateLinks: true }),
    navigator: { openNote: async () => undefined, openTag: async () => undefined },
  });
  application.receiveHostEvent({ type: 'active-note-changed', nodeId: noteNodeId(notes[0].path) });
  const panes = [];
  for (const mode of ['global', 'local'] as const) {
    const lease = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
    assert(lease.ok, 'each pane obtains its own lease');
    const pane = application.createPresentation({ mode, lease: lease.lease, container: runtime.container,
      vaultId: 'Memory test', checkpointStore: new MemoryStore(), initialRootNodeId: noteNodeId(notes[0].path) });
    await pane.open(); panes.push(pane);
    equal(memoryInstalls.get(pane.getSession()!), 1, 'each engine session receives one initial empty projection');
  }
  for (let index = 1; index < 12; index++) {
    application.receiveHostEvent({ type: 'active-note-changed', nodeId: noteNodeId(notes[index].path) });
    for (let i = 0; i < 100; i++) await Promise.resolve();
  }
  deepEqual(application.getSessionSnapshot().nodeIds, [8, 9, 10].map(index => noteNodeId(notes[index].path)),
    'workspace note history still remembers three prior subjects');
  for (const pane of panes) {
    await Promise.all(Array.from({ length: 10 }, () => pane.applySessionSnapshot(application.getSessionSnapshot())));
    equal(memoryInstalls.get(pane.getSession()!), 1, 'changed history and duplicate snapshots must not reinstall empty visual Memory');
    equal((await pane.getSession()!.exportViewState()).selectedNodeIds.length, 12,
      'working constellation admissions remain independent of visual Memory');
  }
  equal((await panes[1].getSession()!.exportViewState()).focusedNodeId, noteNodeId(notes[11].path),
    'Local still follows the latest active note');
  await application.dispose(); await core.dispose();
});

test('Memory projections share in-flight completion, retry rejection, and reset for a new engine session', async () => {
  const fixture = snapshot();
  const runtime = runtimeHarness({ registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1 });
  runtime.profiles.setUserOverrides('graph-plus', 'default', { modules: { 'force-layout': { enabled: false } } });
  const installs = new Map<object, number>();
  let rejectFirst = true;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const core = new GraphEngineProviderCoreV1({ engineVersion: '2.0.0', engineInstanceId: 'memory-projection-retry',
    capabilities: ['render'], profiles: runtime.profiles, sessions: runtime.factory, sessionUiHost: {
      mount: ({ session }) => {
        installs.set(session, 0);
        const apply = session.applyExternalInfluence.bind(session);
        session.applyExternalInfluence = async influence => {
          if (influence.type === 'replace-remembered-subjects') {
            installs.set(session, installs.get(session)! + 1);
            if (rejectFirst) { rejectFirst = false; await gate; return { status: 'rejected', reason: 'test-rejection' }; }
          }
          return apply(influence);
        };
        return { dispose: () => undefined };
      },
    } });
  const lease = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
  assert(lease.ok, 'Global obtains a lease');
  const pane = new GraphPlusConsumerV1({ lease: lease.lease, container: runtime.container,
    vaultId: fixture.value.vaultId, checkpointStore: new MemoryStore(), source: { read: () => fixture.value },
    navigator: { openNote: async () => undefined, openTag: async () => undefined } });
  await pane.open(); const firstSession = pane.getSession()!;
  const history = { activeNodeId: noteNodeId('Alpha.md'), nodeIds: [noteNodeId('folder/Beta.md')], revision: 1 };
  const first = pane.applySessionSnapshot(history);
  const duplicate = pane.applySessionSnapshot(history);
  equal(installs.get(firstSession), 1, 'simultaneous identical snapshots share a single pending engine install');
  const outcomes = Promise.allSettled([first, duplicate]);
  release();
  deepEqual((await outcomes).map(outcome => outcome.status), ['rejected', 'rejected'], 'both callers observe failed completion');
  await pane.applySessionSnapshot(history);
  equal(installs.get(firstSession), 2, 'failed projection must remain retryable');
  await pane.applySessionSnapshot({ ...history, revision: 2, nodeIds: [] });
  equal(installs.get(firstSession), 2, 'changed history still has the same disabled projection');
  equal(await pane.resetLayoutData(), true, 'layout reset mounts a fresh engine session');
  const nextSession = pane.getSession()!;
  assert(nextSession !== firstSession, 'reset creates a new engine session');
  await pane.applySessionSnapshot(history);
  equal(installs.get(nextSession), 1, 'new session must receive its own initial projection');
  await pane.close(); await core.dispose();
});

test('closed Graph+ keeps bounded Memory without pending admissions or stale reopening members', async () => {
  const notes = Array.from({ length: 12 }, (_, index) => ({
    file: { path: `note-${index}.md` }, path: `note-${index}.md`, basename: `note-${index}`,
    extension: 'md', tags: [], properties: {},
  }));
  const runtime = runtimeHarness({ registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1 });
  runtime.profiles.setUserOverrides('graph-plus', 'default', { modules: { 'force-layout': { enabled: false } } });
  const core = new GraphEngineProviderCoreV1({ engineVersion: '2.0.0', engineInstanceId: 'closed-constellation',
    capabilities: ['render'], profiles: runtime.profiles, sessions: runtime.factory });
  const application = new GraphPlusApplicationV1({
    model: new GraphPlusVaultModelV1({ read: () => ({ vaultId: 'Closed test', notes, resolvedLinks: {} }) },
      { countDuplicateLinks: true }),
    navigator: { openNote: async () => undefined, openTag: async () => undefined },
  });
  const activate = (index: number) => application.receiveHostEvent({ type: 'active-note-changed', nodeId: noteNodeId(notes[index].path) });
  const pending = () => (application as unknown as { pendingConstellationNodeIds: Set<string> }).pendingConstellationNodeIds.size;
  for (let index = 0; index < 10; index++) activate(index);
  equal(pending(), 0, 'closed-note activity must not accumulate pending constellation entries');
  deepEqual(application.getSessionSnapshot().nodeIds, [6, 7, 8].map(index => noteNodeId(notes[index].path)),
    'closed-note activity still retains three bounded prior Memory subjects');
  const open = async () => {
    const lease = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
    assert(lease.ok, 'test pane obtains its own lease');
    const graph = application.createPresentation({ mode: 'global', lease: lease.lease, container: runtime.container,
      vaultId: 'Closed test', checkpointStore: new MemoryStore() });
    await graph.open();
    return graph;
  };
  const graph = await open();
  deepEqual((await graph.getSession()!.exportViewState()).selectedNodeIds, [noteNodeId(notes[9].path)],
    'opening seeds only the latest active note, not closed history');
  activate(10);
  for (let i = 0; i < 100; i++) await Promise.resolve();
  deepEqual((await graph.getSession()!.exportViewState()).selectedNodeIds, [9, 10].map(index => noteNodeId(notes[index].path)),
    'next activation must not admit stale closed notes');
  const closing = application.closePresentation(graph);
  for (let index = 0; index < 6; index++) activate(index);
  equal(pending(), 0, 'last-pane close immediately ends admissions, even before its checkpoint finishes');
  await closing;
  const reopened = await open();
  activate(11);
  for (let i = 0; i < 100; i++) await Promise.resolve();
  deepEqual((await reopened.getSession()!.exportViewState()).selectedNodeIds, [5, 11].map(index => noteNodeId(notes[index].path)),
    'a new opening must not replay the previous closed interval');
  await application.dispose(); await core.dispose();
});

test('an in-flight note follow cannot admit its old constellation into a reopened pane', async () => {
  const fixture = snapshot();
  const gamma = { file: { path: 'Gamma.md' }, path: 'Gamma.md', basename: 'Gamma', extension: 'md', tags: [], properties: {} };
  const runtime = runtimeHarness({ registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1 });
  runtime.profiles.setUserOverrides('graph-plus', 'default', { modules: { 'force-layout': { enabled: false } } });
  const core = new GraphEngineProviderCoreV1({ engineVersion: '2.0.0', engineInstanceId: 'reopen-in-flight',
    capabilities: ['render'], profiles: runtime.profiles, sessions: runtime.factory });
  const application = new GraphPlusApplicationV1({
    model: new GraphPlusVaultModelV1({ read: () => ({ ...fixture.value, notes: [...fixture.value.notes, gamma] }) },
      { countDuplicateLinks: true }),
    navigator: { openNote: async () => undefined, openTag: async () => undefined },
  });
  const open = async (root: string) => {
    const lease = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
    assert(lease.ok, 'Local pane obtains its own lease');
    const pane = application.createPresentation({ mode: 'local', lease: lease.lease, container: runtime.container, initialRootNodeId: root });
    await pane.open(); return pane;
  };
  const alpha = noteNodeId('Alpha.md'); const beta = noteNodeId('folder/Beta.md'); const gammaId = noteNodeId('Gamma.md');
  const old = await open(alpha);
  let releaseFollow!: () => void;
  const gate = new Promise<void>(resolve => { releaseFollow = resolve; });
  old.followActiveNode = async () => { await gate; return true; };
  application.receiveHostEvent({ type: 'active-note-changed', nodeId: beta });
  const closing = application.closePresentation(old);
  application.receiveHostEvent({ type: 'active-note-changed', nodeId: gammaId });
  const reopened = await open(gammaId);
  releaseFollow(); await closing;
  for (let i = 0; i < 100; i++) await Promise.resolve();
  deepEqual((await reopened.getSession()!.exportViewState()).selectedNodeIds, [gammaId],
    'an earlier in-flight drain must not add beta to the reopened Local pane');
  await application.dispose(); await core.dispose();
});

test('Local Quick Settings clear invokes the presentation action and preserves its focused root', async () => {
  const fixture = snapshot();
  const gamma = { file: { path: 'Gamma.md' }, path: 'Gamma.md', basename: 'Gamma', extension: 'md', tags: [], properties: {} };
  let current: any = fixture.value;
  const runtime = runtimeHarness({ registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1 });
  runtime.profiles.setUserOverrides('graph-plus', 'default', { modules: { 'force-layout': { enabled: false } } });
  let controls: GraphSessionControlPortV1 | undefined;
  const core = new GraphEngineProviderCoreV1({ engineVersion: '2.0.0', engineInstanceId: 'local-clear-controls',
    capabilities: ['render'], profiles: runtime.profiles, sessions: runtime.factory, sessionUiHost: {
      mount: context => { controls = context.controls; return { dispose: () => undefined }; },
    } });
  const lease = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
  assert(lease.ok, 'Local obtains its own action registration lease');
  const pane = new LocalGraphPlusConsumerV1({ lease: lease.lease, container: runtime.container,
    source: { read: () => current },
    navigator: { openNote: async () => undefined, openTag: async () => undefined },
    initialRootNodeId: noteNodeId('Alpha.md') });
  await pane.open(); const session = pane.getSession()!;
  const alpha = noteNodeId('Alpha.md'); const beta = noteNodeId('folder/Beta.md');
  await pane.addActiveNodesToConstellation([beta, noteNodeId('Gamma.md')]);
  await session.setNodePinned(beta, true);
  const before = await session.exportViewState();
  deepEqual(session.getAvailableViews(), ['focus'], 'exercise the actual Focus-only Local experience contract');
  assert(controls, 'Quick Settings receives real engine controls and registered presentation actions');
  const clear = resolveClearConstellationActionV1(session.getAvailableViews(), before.selectedNodeIds, controls);
  assert(clear, 'Local offers an effective clear action');
  clear(); for (let i = 0; i < 100; i++) await Promise.resolve();
  const after = await session.exportViewState();
  deepEqual(after.selectedNodeIds, [alpha], 'clearing removes extra members while retaining the root');
  equal(after.focusedNodeId, alpha, 'clearing retains Focus on the root');
  equal(after.viewMode, 'focus', 'clearing cannot request Overview from Local');
  deepEqual(after.camera, before.camera, 'clearing preserves Local camera framing');
  deepEqual(after.positions, before.positions, 'clearing does not move nodes');
  deepEqual(after.pinnedNodeIds, before.pinnedNodeIds, 'clearing preserves pins');
  clear(); for (let i = 0; i < 100; i++) await Promise.resolve();
  deepEqual((await session.exportViewState()).selectedNodeIds, [alpha], 'repeated clearing is harmless');
  current = { ...fixture.value, notes: [...fixture.value.notes, gamma] };
  await pane.reconcile();
  deepEqual((await session.exportViewState()).selectedNodeIds, [alpha],
    'clearing also discards pending members whose canonical nodes arrive later');
  await pane.close(); await core.dispose();
});

test('Active notes build a clearable constellation without moving Global framing or changing Views', async () => {
  const fixture = snapshot(); let current: any = fixture.value;
  const runtime = runtimeHarness({ registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1 });
  runtime.profiles.setUserOverrides('graph-plus', 'default', { modules: { 'force-layout': { enabled: false } } });
  let controls: GraphSessionControlPortV1 | undefined;
  const core = new GraphEngineProviderCoreV1({ engineVersion: '2.0.0', engineInstanceId: 'active-constellation-test',
    capabilities: ['render'], profiles: runtime.profiles, sessions: runtime.factory, sessionUiHost: { mount: async context => {
      controls = context.controls; return { dispose: () => undefined };
    } } });
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
  assert(controls, 'context-menu action controls are mounted');
  equal(controls.resolveNodeActions(['clear-constellation'], alpha).length, 1, 'a member offers Clear constellation');
  equal(controls.resolveNodeActions(['clear-constellation'], beta).length, 0, 'a non-member does not offer Clear constellation');
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
    extension: 'md', tags: [], properties: {} }] };
  application.receiveHostEvent({ type: 'canonical-vault-invalidated' }); await application.reconcile(); await settle();
  deepEqual((await session.exportViewState()).selectedNodeIds, [alpha, beta, gamma], 'new-note arrival is admitted after canonical topology catches up');
  equal((await session.exportViewState()).focusedNodeId, beta, 'Global note activity cannot change the Focus subject');
  deepEqual((await session.exportViewState()).camera, focused.camera, 'Global note activity cannot move Focus framing');
  await session.setView('explore');
  deepEqual((await session.exportViewState()).selectedNodeIds, [alpha, beta, gamma], 'Focus back retains the working constellation');
  await session.setView('overview');
  deepEqual((await session.exportViewState()).selectedNodeIds, [alpha, beta, gamma], 'Constellation exit preserves the working group');
  equal(controls.invokeNodeAction('clear-constellation', alpha), true, 'member menu can invoke clear');
  await settle();
  equal(controls.resolveNodeActions(['clear-constellation'], alpha).length, 0, 'cleared nodes no longer offer the menu item');
  deepEqual((await session.exportViewState()).selectedNodeIds, [], 'explicit clearing removes the working group');
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
    lens: { ...createDefaultGraphPlusLensV1(), query: 'beta', showTags: false },
    savedAt: 1,
  };
  let sawMountedBeforeScan = false;
  const consumer = new GraphPlusConsumerV1({
    lease: leaseResult.lease,
    container: runtime.container,
    vaultId: fixture.value.vaultId,
    source: { read: async () => {
      sawMountedBeforeScan = runtime.container.querySelector('[data-graph-engine-session]') !== null;
      const restored = await consumer.getSession()?.exportViewState();
      deepEqual(restored?.activeFilters.render?.node, { op: 'id-in', ids: [noteNodeId('folder/Beta.md')] },
        'saved graph metadata must be searchable before the authoritative vault snapshot arrives');
      return fixture.value;
    } },
    checkpointStore: store,
    navigator: { openNote: async () => undefined, openTag: async () => undefined },
    countDuplicateLinks: true,
  });
  await consumer.open();
  equal(sawMountedBeforeScan, true, 'saved document should mount before authoritative scan starts');
  equal(consumer.getLens().query, 'beta', 'Graph+ should restore its consumer-owned lens from the checkpoint');
  equal(consumer.getLens().showTags, false, 'restored lens toggles should remain consumer-owned');
  await consumer.close();
  assert(store.saves > 0, 'controlled close should checkpoint before session disposal');
  equal(store.value?.lens?.query, 'beta', 'controlled close should persist the active lens with the graph');
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
  await consumer.setLens({ ...consumer.getLens(), query: 'beta' });
  const oldSession = consumer.getSession();
  assert(oldSession, 'the initial live session should exist');
  const alphaId = noteNodeId('Alpha.md');
  equal(await consumer.revealAndFocusNode(alphaId), true,
    'a filtered note should receive a transient reveal through the ordinary focus path');
  equal((await oldSession.exportViewState()).focusedNodeId, alphaId,
    'transient reveal should focus the stable note node');
  equal(consumer.getLens().query, 'beta', 'transient reveal must not rewrite the saved Filter query');
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
  equal(consumer.getLens().query, 'beta', 'reset should preserve the active Filter query');
  equal(store.value?.lens?.query, 'beta', 'fresh checkpoint should preserve consumer lens state');
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
  const beforeReopen = await session.exportViewState();
  await session.restoreViewState({ ...beforeReopen, camera: { ...beforeReopen.camera,
    position: { ...beforeReopen.camera.position, x: beforeReopen.camera.position.x + 75 },
    target: { ...beforeReopen.camera.target, x: beforeReopen.camera.target.x + 75 },
  } });
  await consumer.recenterFocusedNode();
  const recentered = await session.exportViewState();
  assert(vectorDistance(recentered.camera.target, recentered.positions[alphaId]) < 1e-9,
    'reopening a Local pane recenters its focused root');
  equal(recentered.camera.zoom, beforeReopen.camera.zoom, 'pane reveal preserves camera zoom');
  deepEqual(recentered.positions, beforeReopen.positions, 'pane reveal does not change node positions');
  deepEqual(recentered.selectedNodeIds, beforeReopen.selectedNodeIds, 'pane reveal preserves constellation');


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

test('Local Graph+ ignores unchanged vault metadata but receives changed canonical topology', async () => {
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

  current = { ...fixture.value, notes: fixture.value.notes.map((note) => ({ ...note })) };
  await consumer.reconcile();
  equal(replacements, 0, 'typing without changing local graph membership or links must not replace the session document');

  const gamma = { path: 'Gamma.md' };
  current = {
    ...current,
    notes: [...current.notes, {
      file: gamma, path: gamma.path, basename: 'Gamma', extension: 'md', tags: [], properties: {},
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
  await consumer.setLens({ ...consumer.getLens(), query: 'alpha' });
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

test('application shutdown includes an already-closing presentation and waits for its pending checkpoint once', async () => {
  const runtime = runtimeHarness({ registration: graphPlusRegistration });
  const core = new GraphEngineProviderCoreV1({
    engineVersion: '2.0.0', engineInstanceId: 'pending-checkpoint-unload-test',
    capabilities: ['render'], profiles: runtime.profiles, sessions: runtime.factory,
  });
  const connection = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
  assert(connection.ok, 'Graph+ lease is available');
  let resume!: () => void; let saving!: () => void;
  const blocked = new Promise<void>(resolve => { resume = resolve; });
  const saveStarted = new Promise<void>(resolve => { saving = resolve; });
  let saved: GraphPlusCheckpointV1 | undefined; let writes = 0;
  const application = new GraphPlusApplicationV1({
    model: new GraphPlusVaultModelV1({ read: () => snapshot().value }, { countDuplicateLinks: true }),
    navigator: { openNote: async () => undefined, openTag: async () => undefined },
  });
  const presentation = application.createPresentation({
    mode: 'global', lease: connection.lease, container: runtime.container, vaultId: 'Test Vault', clock: runtime.platform,
    checkpointStore: { load: async () => undefined, save: async (_vault, checkpoint) => {
      writes += 1; saving(); await blocked; saved = checkpoint;
    } },
  });
  await presentation.open();
  const closing = application.closePresentation(presentation);
  await saveStarted;
  equal(application.closePresentation(presentation), closing, 'concurrent host close shares the in-flight operation');
  const shutdown = application.dispose();
  equal(application.dispose(), shutdown, 'concurrent application dispose shares completion');
  let stopped = false;
  const providerStop = shutdown.then(async () => { stopped = true; await core.dispose(); });
  await Promise.resolve();
  equal(stopped, false, 'provider is not stopped while closing checkpoint is pending');
  assert(presentation.getSession() !== undefined, 'session remains available for pending exports');
  resume(); await closing; await providerStop;
  equal(writes, 1, 'the pending presentation is saved exactly once');
  assert(saved !== undefined && saved.document.nodes.length > 0, 'layout checkpoint completes before provider teardown');
  equal(runtime.factory.getDiagnostics().sessions.length, 0, 'all sessions are released');
});

test('application shutdown waits for every presentation even when one final checkpoint fails', async () => {
  const runtime = runtimeHarness({ registration: graphPlusRegistration });
  const core = new GraphEngineProviderCoreV1({
    engineVersion: '2.0.0', engineInstanceId: 'failed-checkpoint-unload-test',
    capabilities: ['render'], profiles: runtime.profiles, sessions: runtime.factory,
  });
  const application = new GraphPlusApplicationV1({
    model: new GraphPlusVaultModelV1({ read: () => snapshot().value }, { countDuplicateLinks: true }),
    navigator: { openNote: async () => undefined, openTag: async () => undefined },
  });
  for (const mode of ['global', 'local'] as const) {
    const connection = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
    assert(connection.ok, 'Graph+ lease is available');
    const presentation = application.createPresentation({
      mode, lease: connection.lease, container: runtime.container, vaultId: 'Test Vault', clock: runtime.platform,
      initialRootNodeId: noteNodeId('Alpha.md'),
      checkpointStore: { load: async () => undefined, save: async () => { throw new Error('failed final checkpoint'); } },
    });
    await presentation.open();
  }
  let failure: unknown;
  await application.dispose().catch(error => { failure = error; });
  assert(failure instanceof Error && failure.message.includes('failed final checkpoint'), 'save failure is preserved for reporting');
  equal(runtime.factory.getDiagnostics().sessions.length, 0, 'all presentations release their sessions before failure returns');
  await core.dispose();
});

test('unchanged canonical reconciliation and equivalent lenses skip projections, exports and checkpoint writes', async () => {
  const fixture = snapshot();
  const model = new GraphPlusVaultModelV1({ read: () => fixture.value }, { countDuplicateLinks: true });
  const runtime = runtimeHarness({ registration: graphPlusRegistration });
  const core = new GraphEngineProviderCoreV1({ engineVersion: '2.0.0', engineInstanceId: 'no-op-vault', capabilities: ['render'], profiles: runtime.profiles, sessions: runtime.factory });
  const lease = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
  assert(lease.ok, 'lease opens');
  let writes = 0;
  const app = new GraphPlusApplicationV1({ model, navigator: { openNote: async () => {}, openTag: async () => {} } });
  const presentation = app.createPresentation({ lease: lease.lease, container: runtime.container, vaultId: 'Test Vault', checkpointStore: { load: async () => undefined, save: async () => { writes++; } } });
  try {
    await presentation.open();
    const session = presentation.getSession()!;
    const checkpoint = (presentation as any).checkpoint as GraphPlusCheckpointControllerV1;
    await checkpoint.flush();
    const before = runtime.factory.getDiagnostics().sessions[0].counters!;
    const index = model.read()!.searchIndex;
    await app.reconcile();
    await presentation.setLens(presentation.getLens());
    equal(model.read()!.searchIndex, index, 'unchanged canonical truth retains its derived search index');
    const after = runtime.factory.getDiagnostics().sessions[0].counters!;
    equal(after.projectionPasses, before.projectionPasses, 'no-op canonical and lens updates do not project');
    equal(after.documentExports, before.documentExports, 'no-op updates never clone documents');
    equal(after.viewExports, before.viewExports, 'no-op updates never clone view state');
    await checkpoint.flush();
    equal(writes, 1, 'explicit flush does not write an unchanged checkpoint');
    await presentation.clearConstellation();
    equal(runtime.factory.getDiagnostics().sessions[0].counters!.viewExports, after.viewExports + 1, 'clear uses the lightweight selector; only the explicit checkpoint flush exports a view');
    equal(session.getDocumentStats!().nodes, model.read()!.document.nodes.length, 'counts retain the canonical tag graph');
  } finally { await app.dispose(); await core.dispose(); }
  equal(writes, 1, 'closing an unchanged presentation does not rewrite its checkpoint');
});

test('single-pane physics stays snapshot-free and multi-pane positions coalesce with safe authority handoff', async () => {
  const model = new GraphPlusVaultModelV1({ read: () => snapshot().value }, { countDuplicateLinks: true });
  const runtime = runtimeHarness({ registration: graphPlusRegistration });
  runtime.profiles.setUserOverrides('graph-plus', 'default', { modules: { 'force-layout': { enabled: true } } });
  const clock = new InstrumentedPlatform(new Window());
  const core = new GraphEngineProviderCoreV1({ engineVersion: '2.0.0', engineInstanceId: 'coalesced-world', capabilities: ['render'], profiles: runtime.profiles, sessions: runtime.factory });
  const app = new GraphPlusApplicationV1({ model, worldSyncClock: clock, navigator: { openNote: async () => {}, openTag: async () => {} } });
  const open = async () => {
    const lease = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
    assert(lease.ok, 'lease opens');
    const p = app.createPresentation({ lease: lease.lease, container: runtime.container, vaultId: 'Test Vault', checkpointStore: { load: async () => undefined, save: async () => {} } });
    await p.open(); return p;
  };
  const settle = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
  try {
    const first = await open();
    const authority = first.getSession()!;
    const probe = authority as any;
    let layoutExports = 0; let positionExports = 0;
    const original = probe.moduleHost.exportCapabilityState.bind(probe.moduleHost);
    probe.moduleHost.exportCapabilityState = (...args: any[]) => { layoutExports++; return original(...args); };
    const positions = authority.exportWorldPositions!.bind(authority);
    authority.exportWorldPositions = async () => { positionExports++; return positions(); };
    for (let i = 0; i < 20; i++) probe.emitWorldChanged('layout');
    await settle();
    equal(layoutExports, 0, 'checkpoint/application observers do not snapshot physics for a single pane');
    equal(positionExports, 0, 'a single pane does not synchronize itself');
    const second = await open();
    const follower = second.getSession()!;
    const camera = (await follower.exportViewState()).camera;
    layoutExports = 0;
    const id = noteNodeId('Alpha.md');
    for (let i = 1; i <= 20; i++) {
      probe.viewState = { ...probe.viewState, positions: { ...probe.viewState.positions, [id]: { x: i, y: 25, z: 0 } } };
      probe.emitWorldChanged('layout');
    }
    equal(clock.pendingFrames, 1, 'rapid physics updates own one transfer frame');
    clock.flushFrame(); await settle();
    equal(positionExports, 1, 'one transfer exports the latest positions once');
    equal(layoutExports, 0, 'steady-state multi-pane physics does not serialize force state');
    equal((await follower.exportViewState()).positions[id].x, 20, 'the follower receives the final geometry');
    deepEqual((await follower.exportViewState()).camera, camera, 'world transfer keeps free cameras independent');
    await authority.setNodePinned(id, true); await settle();
    equal((await follower.exportViewState()).pinnedNodeIds.includes(id), true, 'pin edits still synchronize');
    equal(layoutExports, 0, 'pin edits transfer geometry without serializing force state');
    let release!: () => void;
    let blocked = true;
    authority.exportWorldPositions = async () => {
      positionExports++;
      const current = await positions();
      if (blocked) { blocked = false; await new Promise<void>(resolve => { release = resolve; }); }
      return current;
    };
    const beforeBurst = positionExports;
    probe.emitWorldChanged('layout'); clock.flushFrame(); await settle();
    for (let x = 21; x <= 24; x++) {
      probe.viewState = { ...probe.viewState, positions: { ...probe.viewState.positions, [id]: { x, y: 25, z: 0 } } };
      probe.emitWorldChanged('layout'); clock.flushFrame(); await settle();
    }
    equal(positionExports, beforeBurst + 1, 'slow transfers cannot create a per-frame export backlog');
    release(); await settle(); clock.flushFrame(); await settle();
    equal(positionExports, beforeBurst + 2, 'only one trailing transfer captures all intervening frames');
    equal((await follower.exportViewState()).positions[id].x, 24, 'the trailing transfer contains the latest positions');
    probe.viewState = { ...probe.viewState, positions: { ...probe.viewState.positions, [id]: { x: 30, y: 25, z: 0 } } };
    probe.emitWorldChanged('layout');
    const finalWorld = await authority.exportWorldState();
    await app.closePresentation(first);
    deepEqual((await follower.exportWorldState()).layoutModuleState, finalWorld.layoutModuleState,
      'authority handoff transfers force coefficients, alpha and velocities in one full snapshot');
    equal(clock.pendingFrames, 0, 'closing authority cancels its pending transfer');
    equal((await follower.exportViewState()).positions[id].x, 30, 'handoff installs fresh world state before electing the follower');
    equal(runtime.factory.getDiagnostics().sessions[0].layoutAuthority, true, 'exactly the surviving pane advances physics');
    const third = await open();
    deepEqual((await third.getSession()!.exportViewState()).positions, (await follower.exportViewState()).positions, 'new panes initialize from live authority geometry');
  } finally { await app.dispose(); await core.dispose(); }
});

test('ordinary Graph+ filtering avoids edge traversal when orphans remain visible', () => {
  const document = runtimeFixture();
  const untouched = { ...document };
  Object.defineProperty(untouched, 'edges', { get: () => { throw new Error('unnecessary orphan scan'); } });
  equal(compileGraphPlusFilterV1(untouched, createDefaultGraphPlusLensV1()).visibleNodeIds.length, 3,
    'the default lens needs only nodes');
});

test('failed final world synchronization still checkpoints and disposes every presentation', async () => {
  const runtime = runtimeHarness({ registration: graphPlusRegistration });
  const core = new GraphEngineProviderCoreV1({ engineVersion: '2.0.0', engineInstanceId: 'failed-world-shutdown', capabilities: ['render'], profiles: runtime.profiles, sessions: runtime.factory });
  let saves = 0;
  const app = new GraphPlusApplicationV1({ model: new GraphPlusVaultModelV1({ read: () => snapshot().value }, { countDuplicateLinks: true }), navigator: { openNote: async () => {}, openTag: async () => {} } });
  const panes = [];
  for (let i = 0; i < 2; i++) {
    const lease = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
    assert(lease.ok, 'lease opens');
    const pane = app.createPresentation({ lease: lease.lease, container: runtime.container, vaultId: 'Test Vault', checkpointStore: { load: async () => undefined, save: async () => { saves++; } } });
    await pane.open(); panes.push(pane);
  }
  panes[0].getSession()!.exportWorldState = async () => { throw new Error('world export failed'); };
  const result = await Promise.allSettled([app.dispose()]);
  equal(result[0].status, 'rejected', 'handoff failure remains visible to the host');
  equal(saves, 2, 'both panes attempt their final checkpoint');
  equal(runtime.factory.getDiagnostics().sessions.length, 0, 'failed synchronization cannot leak engine sessions');
  await core.dispose();
});

test('batched lenses still pause a newly enabled Form when its root is hidden', async () => {
  const runtime = runtimeHarness({ registration: graphPlusRegistration });
  const core = new GraphEngineProviderCoreV1({ engineVersion: '2.0.0', engineInstanceId: 'hidden-form-batch', capabilities: ['render'], profiles: runtime.profiles, sessions: runtime.factory });
  const lease = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
  assert(lease.ok, 'lease opens');
  const errors: Error[] = [];
  const pane = new GraphPlusConsumerV1({ lease: lease.lease, container: runtime.container,
    source: { read: () => snapshot().value }, navigator: { openNote: async () => {}, openTag: async () => {} },
    vaultId: 'Test Vault', checkpointStore: new MemoryStore(), onError: error => { if (error instanceof Error) errors.push(error); } });
  try {
    await pane.open();
    const before = runtime.factory.getDiagnostics().sessions[0].counters!.projectionPasses;
    const lens = pane.getLens();
    await pane.setLens({ ...lens, query: 'Beta', form: { ...lens.form, enabled: true, rootNodeId: noteNodeId('Alpha.md') } });
    equal(pane.getLens().form.enabled, false, 'a hidden root cannot enable Form in a batched install');
    equal((await pane.getSession()!.exportEffectiveSettings()).modules.form.enabled, false, 'the engine receives the paused Form state');
    equal(errors.length, 1, 'the existing pause explanation remains visible');
    equal(runtime.factory.getDiagnostics().sessions[0].counters!.projectionPasses, before + 1, 'the filter and automatic pause share one projection');
  } finally { await pane.close(); await core.dispose(); }
});

test('Local physics follows visible pane activity and Space wakes its shared settled world', async () => {
  const runtime = runtimeHarness({ registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1 });
  runtime.profiles.setUserOverrides('graph-plus', 'default', { modules: {
    anima: { settings: { cursorGravity: 'off' } },
  } });
  const core = new GraphEngineProviderCoreV1({ engineVersion: '2.0.0', engineInstanceId: 'local-physics-handoff',
    capabilities: ['render'], profiles: runtime.profiles, sessions: runtime.factory });
  const localRuntime = runtimeHarness({ registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1 });
  localRuntime.profiles.setUserOverrides('graph-plus', 'default', { modules: { anima: { settings: { cursorGravity: 'off' } } } });
  const localCore = new GraphEngineProviderCoreV1({ engineVersion: '2.0.0', engineInstanceId: 'local-physics-follower',
    capabilities: ['render'], profiles: localRuntime.profiles, sessions: localRuntime.factory });
  const application = new GraphPlusApplicationV1({
    model: new GraphPlusVaultModelV1({ read: () => snapshot().value }, { countDuplicateLinks: true }),
    navigator: { openNote: async () => {}, openTag: async () => {} },
  });
  const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
  const open = async (mode: 'global' | 'local') => {
    const paneRuntime = mode === 'local' ? localRuntime : runtime;
    const paneCore = mode === 'local' ? localCore : core;
    const connection = paneCore.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
    assert(connection.ok, 'lease opens');
    const container = paneRuntime.container;
    const pane = application.createPresentation({ mode, container, lease: connection.lease, initialRootNodeId: noteNodeId('Alpha.md'),
      vaultId: 'Test Vault', checkpointStore: { load: async () => undefined, save: async () => {} } });
    await pane.open();
    return { pane, container, session: pane.getSession()! };
  };
  try {
    const global = await open('global');
    const local = await open('local');
    const authorities = () => [...runtime.factory.getDiagnostics().sessions, ...localRuntime.factory.getDiagnostics().sessions].filter(s => s.layoutAuthority);
    equal(runtime.factory.getDiagnostics().sessions[0].layoutAuthority, true, 'the first pane initially owns layout');
    const saved = await global.session.exportViewState();
    await global.session.restoreViewState({ ...saved, moduleState: { ...saved.moduleState,
      'force-layout': { schemaVersion: 1, alpha: 0, alphaTarget: 0, running: false, velocities: {} },
    } });
    await settle();
    runtimeCanvas(local.container).dispatchEvent(new localRuntime.window.KeyboardEvent('keydown', { key: ' ', bubbles: true }) as unknown as Event);
    await settle();
    equal(authorities().length, 1, 'interaction never starts a second solver');
    equal(localRuntime.factory.getDiagnostics().sessions[0].layoutAuthority, true, 'Space transfers physics ownership to Local');
    const before = await local.session.exportViewState();
    for (let i = 0; i < 6; i++) localRuntime.platform.flushFrame();
    const held = await local.session.exportViewState();
    equal((held.moduleState['force-layout'] as { alpha: number }).alpha, 1, 'Local Space reaches maximum alpha');
    assert(JSON.stringify(held.positions) !== JSON.stringify(before.positions), 'Local Space moves shared geometry');
    deepEqual(held.selectedNodeIds, before.selectedNodeIds, 'physics ownership preserves Local Attention');
    localRuntime.window.dispatchEvent(new localRuntime.window.KeyboardEvent('keyup', { key: ' ' }));
    for (let i = 0; i < 6; i++) localRuntime.platform.flushFrame();
    await settle();
    const released = await local.session.exportViewState();
    equal((released.moduleState['force-layout'] as { alpha: number }).alpha, 0, 'Space release restores the settled activity');
    local.pane.setSuspended(true);
    await settle();
    equal(runtime.factory.getDiagnostics().sessions[0].layoutAuthority, true, 'hiding Local hands layout to visible Global');
    global.pane.setSuspended(true);
    await settle();
    equal(authorities().length, 0, 'all hidden panes stop advancing layout');
    local.pane.setSuspended(false);
    await settle();
    equal(localRuntime.factory.getDiagnostics().sessions[0].layoutAuthority, true, 'revealing Local resumes its layout authority');
    runtimeCanvas(global.container).dispatchEvent(new runtime.window.Event('pointermove', { bubbles: true }) as unknown as Event);
    await settle();
    equal(localRuntime.factory.getDiagnostics().sessions[0].layoutAuthority, true, 'hidden pane activity cannot take authority');
  } finally { await application.dispose(); await core.dispose(); await localCore.dispose(); }
});
