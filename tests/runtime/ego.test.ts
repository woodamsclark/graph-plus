import {
  ANIMA_HIGHLIGHT_POLICY_V1,
  adjudicateGraphExperienceCommandV1,
  BufferedQueue,
  compileAnimaSceneV1,
  Consciousness,
  createAnimaConsciousnessPresentationV1,
  createAnimusSnapshotV1,
  createGraphInteractionContextV1,
  DEFAULT_GRAPH_VISUAL_THEME_V2,
  GraphCommander,
  GraphCommandRegistry,
  MemoryV1,
  MAX_CONSCIOUS_MEMORY_BUCKETS_V1,
  ReactionSystemV1,
  resolveConsciousness,
  resolveAnimaHighlightPolicyV1,
  type GraphRuntimeCommandV1,
} from '../../src/graph-engine/runtime/index.ts';
import { previewGraphObjectInteractionV1, type GraphInteractionPreviewV1 } from '../../src/graph-engine/runtime/anima/AnimaInteractionPreview.ts';
import { planGraphViewObjectActivationV1, resolveGraphHoverPathV1 } from '../../src/graph-engine/runtime/interaction/GraphViewObjectActivation.ts';
import { DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1 } from '../../src/graph-engine/contracts/v1/index.ts';
import { graphDocument, graphEdge, graphNode } from '../support/contractFixtures.ts';
import { deepEqual, equal, test } from '../support/harness.ts';

const document = graphDocument({
  nodes: [graphNode('a'), graphNode('b'), graphNode('c'), graphNode('d')],
  edges: [
    graphEdge('a-b', 'a', 'b'),
    graphEdge('b-c', 'b', 'c'),
    graphEdge('c-d', 'c', 'd'),
  ],
});
const positions = {
  a: { x: -10, y: 20, z: 4 },
  b: { x: 0, y: 0, z: 0 },
  c: { x: 30, y: 0, z: -2 },
  d: { x: 40, y: 0, z: 0 },
};
const baseViewState = {
  dimensions: '2d' as const,
  selectedNodeIds: [] as string[],
  pinnedNodeIds: [] as string[],
};

function presentation(options: {
  readonly viewMode?: 'overview' | 'explore' | 'focus';
  readonly draggedNodeId?: string;
  readonly selectedNodeIds?: readonly string[];
  readonly rememberedNodeIds?: readonly string[];
  readonly focusedNodeId?: string;
  readonly hoveredNodeId?: string;
  readonly ctrlHover?: boolean;
  readonly visibleEdgeIds?: ReadonlySet<string>;
  readonly selectionPresentationSuspended?: boolean;
  readonly objectActivationPreview?: GraphInteractionPreviewV1 | null;
}) {
  const viewState = {
    ...baseViewState,
    ...(options.viewMode === undefined ? {} : { viewMode: options.viewMode }),
    selectedNodeIds: [...(options.selectedNodeIds ?? [])],
    ...(options.focusedNodeId === undefined ? {} : { focusedNodeId: options.focusedNodeId }),
  };
  const consciousness = new Consciousness();
  let consciousnessState = consciousness.reconcile({
    attentionNodeIds: viewState.selectedNodeIds,
    availableNodeIds: new Set(Object.keys(positions)),
  });
  if (options.rememberedNodeIds !== undefined) {
    consciousnessState = consciousness.receiveExogenous({
      source: 'exogenous',
      type: 'replace-remembered-subjects',
      nodeIds: options.rememberedNodeIds,
    }, {
      availableNodeIds: new Set(Object.keys(positions)),
    });
  }
  const interaction = createGraphInteractionContextV1({
    viewState,
    draggedNodeId: options.draggedNodeId,
    ...(options.hoveredNodeId === undefined ? {} : { hoveredNodeId: options.hoveredNodeId }),
    selectionPresentationSuspended: options.selectionPresentationSuspended,
  });
  return createAnimaConsciousnessPresentationV1({
    attention: consciousnessState.attention,
    awareness: consciousnessState.awareness,
    consciousField: consciousnessState.consciousField,
    remembered: consciousnessState.remembered,
    interaction,
    ctrlHover: options.ctrlHover,
    objectActivationPreview: options.objectActivationPreview,
    visibleEdgeIds: options.visibleEdgeIds,
    document,
  });
}

test('Consciousness holds geometry-free Attention and Awareness while Ego proposes intent', () => {
  const consciousness = new Consciousness();
  const state = consciousness.reconcile({
    attentionNodeIds: ['a', 'c'],
    availableNodeIds: new Set(Object.keys(positions)),
    peripheralAwarenessNodeIds: ['b', 'missing'],
  });

  deepEqual([...state.attention.nodeIds], ['a', 'c'],
    'compatibility selection should resolve into Attention');
  deepEqual([...state.awareness.nodeIds], ['a', 'c'],
    'Awareness should contain the observable constellation without its periphery');
  deepEqual([...state.consciousField.nodeIds], ['a', 'c', 'b'],
    'the conscious field should contain Awareness plus available peripheral contributions');
  deepEqual(Object.keys(state.awareness), ['nodeIds'],
    'Awareness must not retain centroid or other geometry');
  deepEqual(consciousness.ego.directAttention(['c', 'c', 'a']), {
    source: 'endogenous',
    directive: {
      type: 'direct-attention',
      nodeIds: ['c', 'a'],
    },
  }, 'Ego should produce a deduplicated intent without declaring realized state');
});

test('Consciousness memory compacts old observations logarithmically without losing historical mass', () => {
  const memory = new MemoryV1();
  for (let index = 0; index < 1_024; index += 1) {
    memory.remember({ type: 'node-selected', subjectId: 'a', timestamp: index });
  }
  const snapshot = memory.snapshot();
  equal(snapshot.observationCount, 1_024, 'memory should retain the total historical mass');
  equal(memory.count('node-selected', 'a', 1_024), 1_024,
    'all-time association counts should survive compaction exactly');
  equal(snapshot.buckets.length <= 22, true,
    'exponential compaction should use logarithmic storage for one association key');
  equal(snapshot.buckets.some((bucket) => bucket.count > 1
    && bucket.firstAt < bucket.averageAt && bucket.averageAt < bucket.lastAt), true,
  'aged observations should collapse into ranged weighted-average memory');

  const restored = new MemoryV1(snapshot);
  equal(restored.count('node-selected', 'a', 1_024), 1_024,
    'compacted conscious memory should survive a persistence round trip');

  const broad = new MemoryV1();
  for (let index = 0; index < MAX_CONSCIOUS_MEMORY_BUCKETS_V1 + 100; index += 1) {
    broad.remember({ type: 'node-selected', subjectId: `node-${index}`, timestamp: index });
  }
  const broadSnapshot = broad.snapshot();
  equal(broadSnapshot.buckets.length <= MAX_CONSCIOUS_MEMORY_BUCKETS_V1, true,
    'distinct subjects must not bypass the global conscious-memory bound');
  equal(broadSnapshot.observationCount, MAX_CONSCIOUS_MEMORY_BUCKETS_V1 + 100,
    'global compaction should retain historical mass after old subject identity fades');
  equal(broadSnapshot.buckets.some((bucket) => bucket.subjectId === null), true,
    'old cross-subject evidence should collapse into anonymous historical memory');
});

test('Association produces a Reaction only when memory crosses consumer criteria', () => {
  const system = new ReactionSystemV1();
  const registrations = [{
    id: 'third-selection',
    association: { observation: 'node-selected' as const, occurrences: 3 },
    reaction: { type: 'invoke-node-action' as const, actionId: 'reflect' },
  }];
  equal(system.observe({ type: 'node-selected', subjectId: 'a', timestamp: 1 }, registrations).length, 0,
    'an incomplete association should remain memory without producing action');
  equal(system.observe({ type: 'node-selected', subjectId: 'a', timestamp: 2 }, registrations).length, 0,
    'association should remain specific to its declared threshold');
  deepEqual(system.observe({ type: 'node-selected', subjectId: 'a', timestamp: 3 }, registrations), [{
    registrationId: 'third-selection',
    subjectId: 'a',
    actionId: 'reflect',
    observation: { type: 'node-selected', subjectId: 'a', timestamp: 3 },
  }], 'recognized memory should become a semantic Reaction for Ego');
  equal(system.observe({ type: 'node-selected', subjectId: 'a', timestamp: 4 }, registrations).length, 0,
    'a non-repeating association should not react to every later observation');
});

test('neutral experience policy constrains Attention and expands its conscious field', () => {
  const experience = {
    ...DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1,
    allowedStates: ['focus'] as const,
    attention: { maximumNodeCount: 1, overflow: 'preserve-intent-subject' as const },
    awareness: { attentionNeighborhoodDepth: 1 },
  };
  const consciousness = new Consciousness(experience);
  const relationships = new Map<string, ReadonlySet<string>>([
    ['a', new Set(['b'])],
    ['b', new Set(['a', 'c'])],
    ['c', new Set(['b', 'd'])],
    ['d', new Set(['c'])],
  ]);

  const state = consciousness.reconcile({
    attentionNodeIds: ['a', 'b'],
    availableNodeIds: new Set(['a', 'b', 'c', 'd']),
    relationships,
  });

  deepEqual([...state.attention.nodeIds], ['b'],
    'single-subject policy should reduce Attention before it becomes truth');
  deepEqual([...state.awareness.nodeIds], ['b'],
    'policy should preserve only the realized observable subject in Awareness');
  deepEqual([...state.consciousField.nodeIds], ['b', 'a', 'c'],
    'policy should expand the realized subject into one peripheral conscious neighborhood');
});

test('neutral experience policy adjusts endogenous intent before effectors', () => {
  const experience = {
    ...DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1,
    allowedStates: ['focus'] as const,
    attention: { maximumNodeCount: 1, overflow: 'preserve-intent-subject' as const },
  };
  const command: GraphRuntimeCommandV1 = {
    type: 'direct-attention',
    identity: { documentId: 'graph', documentRevision: 1 },
    timestamp: 1,
    nodeIds: ['a', 'b'],
    subjectNodeId: 'b',
    clearFocus: true,
  };

  deepEqual(adjudicateGraphExperienceCommandV1({
    command,
    experience,
    currentState: 'focus',
    attentionNodeIds: ['a'],
    focusedNodeId: 'a',
  }), {
    status: 'adjusted',
    directive: {
      ...command,
      nodeIds: ['b'],
      clearFocus: false,
      viewMode: 'focus',
      focusNodeId: 'b',
    },
  }, 'Focus-only policy should preserve the intended subject while keeping the transition in Focus');
});

test('Ego adjudicates every interpreted command before GraphCommander reaches effectors', () => {
  const consciousness = new Consciousness();
  const commands = new BufferedQueue<GraphRuntimeCommandV1>();
  const registry = new GraphCommandRegistry();
  const dispatched: GraphRuntimeCommandV1[] = [];
  registry.register('center-camera', (command) => dispatched.push(command));
  const commander = new GraphCommander(commands, registry, (command) => consciousness.ego.consider(
    consciousness.ego.intend(command),
    (intent) => intent.directive.identity.documentRevision === 2
      ? { status: 'accepted', directive: intent.directive }
      : { status: 'rejected', reason: 'stale-document' },
  ));
  commands.push({
    type: 'center-camera',
    identity: { documentId: 'graph', documentRevision: 1 },
    timestamp: 1,
  });
  commands.push({
    type: 'center-camera',
    identity: { documentId: 'graph', documentRevision: 2 },
    timestamp: 2,
  });

  commander.tick();

  deepEqual(dispatched, [{
    type: 'center-camera',
    identity: { documentId: 'graph', documentRevision: 2 },
    timestamp: 2,
  }], 'only an Ego-accepted directive should reach its registered effector');
});

test('Hover awareness lifts nodes and incident links exactly one degree without changing Consciousness', () => {
  const preview: GraphInteractionPreviewV1 = { kind: 'objects', activation: 'primary',
    addedNodeIds: [], removedNodeIds: [], hoverPathNodeIds: [] };
  for (const viewMode of ['overview', 'explore', 'focus'] as const) {
    const options = { viewMode, selectedNodeIds: ['a', 'd'],
      focusedNodeId: viewMode === 'focus' ? 'a' : undefined };
    const baseline = presentation(options);
    const hovered = presentation({ ...options, hoveredNodeId: 'd', objectActivationPreview: preview });
    const expected = { void: 'dimmed', dimmed: 'standard', standard: 'highlighted', highlighted: 'highlighted' } as const;
    for (const id of viewMode === 'overview' ? ['d'] : ['c', 'd']) {
      equal(hovered.highlight.phaseByNodeId[id], expected[baseline.highlight.phaseByNodeId[id]], 'one-hop node receives exactly one degree');
    }
    equal(hovered.highlight.phaseByEdgeId['c-d'], viewMode === 'overview' ? baseline.highlight.phaseByEdgeId['c-d'] : expected[baseline.highlight.phaseByEdgeId['c-d']], 'incident link lift follows the View policy');
    equal(hovered.highlight.phaseByNodeId.b, baseline.highlight.phaseByNodeId.b, 'two-hop context is unchanged');
    equal(hovered.highlight.phaseByEdgeId['b-c'], baseline.highlight.phaseByEdgeId['b-c'], 'nonincident link is unchanged');
    deepEqual(hovered.consciousnessClasses, baseline.consciousnessClasses, 'awareness lift is presentation, not Consciousness mutation');
    deepEqual([...hovered.expressedAttentionNodeIds], ['a', 'd'], 'lift does not imply membership');
    deepEqual(presentation({ ...options, hoveredNodeId: 'd', objectActivationPreview: preview }).highlight.phaseByNodeId,
      hovered.highlight.phaseByNodeId, 'repeated hover cannot accumulate promotion');
    deepEqual(presentation(options).highlight.phaseByNodeId, baseline.highlight.phaseByNodeId, 'leaving restores the baseline');
  }
  const overview = presentation({ viewMode: 'overview', selectedNodeIds: ['a'], hoveredNodeId: 'c', objectActivationPreview: preview });
  equal(overview.highlight.phaseByNodeId.b, 'standard', 'Overview hover cannot raise neighbors');
  equal(overview.highlight.phaseByNodeId.d, 'standard', 'Overview hover is restricted to the hovered node');
  equal(overview.highlight.phaseByEdgeId['b-c'], 'standard', 'Overview hover cannot raise incident links');
  const overviewEntry = presentation({ viewMode: 'overview', selectedNodeIds: ['a'], hoveredNodeId: 'a' });
  equal(overviewEntry.highlight.phaseByNodeId.b, 'dimmed', 'an explicit View preview cannot broaden Overview hover policy');
  equal(overviewEntry.labelRaising.byNodeId.b.disposition, 'suppress', 'Overview preview cannot favor neighbor labels');
  const explore = presentation({ viewMode: 'explore', selectedNodeIds: ['a'], hoveredNodeId: 'c', objectActivationPreview: preview });
  equal(explore.highlight.phaseByNodeId.c, 'standard', 'hovered candidate rises from dimmed to standard without an admission preview');
  deepEqual([...explore.highlight.highlightedNodeIds], ['a'], 'standard neighbors are not classified as highlights');
  const filtered = presentation({ viewMode: 'focus', selectedNodeIds: ['a', 'd'], focusedNodeId: 'a', hoveredNodeId: 'd',
    visibleEdgeIds: new Set(['a-b', 'b-c']), objectActivationPreview: preview });
  equal(filtered.highlight.phaseByNodeId.c, 'void', 'filtered edge cannot supply a hover neighbor');
});

test('Anima scopes Constellation presentation to Consciousness Awareness', () => {
  const value = presentation({ selectedNodeIds: ['b'] });

  equal(value.statePolicy.renderScope, 'graph-with-awareness-emphasis',
    'Anima should resolve Explore presentation independently from Consciousness');
  deepEqual([...value.highlight.highlightedNodeIds].sort(), ['b'],
    'Constellation should highlight only nodes held in Awareness');
  deepEqual([...value.highlight.highlightedEdgeIds].sort(), [],
    'one aware node should have no aware-to-aware link to highlight');
  equal(value.highlight.policy.labels, 'delegate',
    'highlight resolution must leave labels under their independent manager');
  deepEqual(value.consciousnessClasses.byNodeId, {
    a: 'unaware-context', b: 'attended', c: 'unaware-context', d: 'unaware-context',
  }, 'Anima should receive an explicit Consciousness classification for every projected node');
  deepEqual(value.labelRaising.byNodeId.b,
    { disposition: 'force', reason: 'attended', priority: 5 },
    'Anima should always reveal a highlighted attended label');
  deepEqual(value.labelRaising.byNodeId.a,
    { disposition: 'suppress', reason: 'dimmed', priority: 2 },
    'Anima should suppress an unaware neighbor in dim context');
});

test('Anima distinguishes the conscious field from Attention and unaware context', () => {
  const viewState = { ...baseViewState, selectedNodeIds: ['b'] };
  const consciousness = resolveConsciousness({
    attentionNodeIds: ['b'],
    availableNodeIds: new Set(Object.keys(positions)),
    peripheralAwarenessNodeIds: ['a', 'c'],
  });
  const value = createAnimaConsciousnessPresentationV1({
    attention: consciousness.attention,
    awareness: consciousness.awareness,
    consciousField: consciousness.consciousField,
    interaction: createGraphInteractionContextV1({ viewState }),
    document,
  });

  deepEqual([...value.consciousnessClasses.attendedNodeIds], ['b'],
    'Attention should compile only to the attended class');
  deepEqual([...value.consciousnessClasses.consciousContextNodeIds], ['a', 'c'],
    'the conscious field outside Attention should compile to the peripheral class');
  deepEqual([...value.consciousnessClasses.unawareContextNodeIds], ['d'],
    'projected nodes outside Awareness should compile to unaware context');
  deepEqual(value.labelRaising.byNodeId.a,
    { disposition: 'suppress', reason: 'dimmed', priority: 2 },
    'conscious context should remain dimmed and unlabeled without becoming selected');
});

test('Anima View-entry preview uses destination label policy without a hover override', () => {
  const value = presentation({ hoveredNodeId: 'b' });

  deepEqual(value.labelRaising.byNodeId.b,
    { disposition: 'force', reason: 'attended', priority: 5 },
    'the prospective member should use the destination Constellation label policy');
  deepEqual(value.labelRaising.byNodeId.a,
    { disposition: 'suppress', reason: 'dimmed', priority: 2 },
    'the prospective Constellation dims neighboring context');
  deepEqual(value.labelRaising.byNodeId.c,
    { disposition: 'suppress', reason: 'dimmed', priority: 2 },
    'Overview hover does not lift neighbors above the prospective View baseline');
  deepEqual(value.labelRaising.byNodeId.d,
    { disposition: 'suppress', reason: 'dimmed', priority: 2 },
    'unrelated context follows the prospective Constellation');
});

test('Constellation candidate hover previews admission and lights its route without realizing membership', () => {
  const value = presentation({ selectedNodeIds: ['a'], hoveredNodeId: 'c' });
  deepEqual(value.highlight.phaseByNodeId, { a: 'highlighted', b: 'highlighted', c: 'highlighted', d: 'standard' },
    'the candidate and its connecting route are lit while other context stays dimmed');
  equal(value.objectPreview?.focusNodeId, undefined, 'admission does not preview a Focus subject');
  equal(value.interaction.state, 'explore', 'the committed View remains Constellation');
  deepEqual([...value.consciousnessClasses.attendedNodeIds], ['a'], 'hover is not realized Attention');
  deepEqual([...value.highlight.hoverPathNodeIds], ['c', 'b', 'a'], 'hover finds the shortest route to committed membership');
  equal(value.labelRaising.byNodeId.c.disposition, 'force', 'the prospective subject label is readable');
  equal(value.labelRaising.byNodeId.b.reason, 'attended', 'route labels express prospective membership without realizing it');
});

test('Memory constellations remain visible without enlarging active Constellation or Focus membership', () => {
  const build = presentation({ selectedNodeIds: ['a'], rememberedNodeIds: ['c', 'd'] });
  equal(build.highlight.phaseByNodeId.c, 'highlighted', 'Memory is independently visible in Constellation');
  equal(build.constellationKindByNodeId.c, 'memory', 'its visibility retains Memory provenance');
  deepEqual([...build.consciousnessClasses.attendedNodeIds], ['a'], 'Memory does not enlarge active membership');
  const focus = presentation({ selectedNodeIds: ['a', 'c'], rememberedNodeIds: ['d'], focusedNodeId: 'a' });
  equal(focus.highlight.phaseByNodeId.c, 'highlighted', 'distant members remain highlighted');
  equal(focus.highlight.phaseByNodeId.b, 'standard', 'subject neighbors remain standard conscious context');
  equal(focus.labelRaising.byNodeId.b.disposition, 'fallback', 'a standard Focus neighbor inherits dynamic label policy');
  equal(focus.highlight.phaseByNodeId.d, 'highlighted', 'distant Memory remains independently visible');
  equal(focus.constellationKindByNodeId.d, 'memory', 'distant Memory is not an Ego member');
  equal(focus.highlight.phaseByEdgeId['c-d'], 'highlighted', 'a link connects two visible subjects');
  equal(focus.constellationKindByEdgeId['c-d'], undefined, 'a mixed-source link does not imply shared constellation membership');
});

test('Anima resolves remembered subjects after transient interaction and view mode', () => {
  const value = presentation({ rememberedNodeIds: ['a', 'b'] });

  deepEqual([...value.consciousnessClasses.awareNodeIds], ['a', 'b'],
    'remembered subjects should be semantically aware without becoming attended');
  equal(value.highlight.phaseByNodeId.a, 'highlighted',
    'Memory should keep a subject highlighted in Overview without Attention');
  equal(value.highlight.phaseByNodeId.b, 'highlighted',
    'every remembered constellation subject should survive the view-mode baseline');
  equal(value.highlight.phaseByNodeId.c, 'standard',
    'ordinary Overview context should remain standard');
  equal(value.highlight.phaseByEdgeId['a-b'], 'highlighted',
    'Memory should preserve connections internal to the remembered constellation');
  deepEqual(value.labelRaising.byNodeId.a,
    { disposition: 'force', reason: 'remembered', priority: 5 },
    'a remembered highlight should always reveal its label');
});

test('Anima state overrides expire with the graph interaction state', () => {
  const explore = createGraphInteractionContextV1({
    viewState: { ...baseViewState, selectedNodeIds: ['b'] },
  });
  const suspended = createGraphInteractionContextV1({
    viewState: { ...baseViewState, selectedNodeIds: ['b'] },
    selectionPresentationSuspended: true,
  });
  const overview = createGraphInteractionContextV1({ viewState: baseViewState });

  equal(resolveAnimaHighlightPolicyV1(explore).contextRole, 'dimmed',
    'Explore should temporarily dim context');
  equal(resolveAnimaHighlightPolicyV1(suspended).contextRole, 'dimmed',
    'transient interaction cannot override the View scene phase');
  equal(resolveAnimaHighlightPolicyV1(overview).contextRole, ANIMA_HIGHLIGHT_POLICY_V1.contextRole,
    'leaving Explore should restore Anima global truth without cleanup');
});

test('Focus presentation override cannot leak into Explore', () => {
  const focus = presentation({ selectedNodeIds: ['a', 'c'], focusedNodeId: 'c' });
  const explore = presentation({ selectedNodeIds: ['a'] });

  deepEqual([...focus.highlight.highlightedNodeIds].sort(), ['a', 'c'],
    'Focus should highlight the preserved constellation without promoting its frontier');
  deepEqual([...focus.highlight.highlightedEdgeIds], [],
    'Focus should light only links whose endpoints both belong to the constellation');
  deepEqual([...explore.highlight.highlightedNodeIds].sort(), ['a'],
    'returning to Explore should restore Awareness-only presentation');
  equal(explore.highlight.policy.contextRole, 'dimmed',
    'Focus context hiding must expire with Focus');
});

test('Deliberate Focus hopping previews the admitted subject neighborhood without committing it', () => {
  const focusHover = presentation({ selectedNodeIds: ['c'], focusedNodeId: 'c', hoveredNodeId: 'b' });
  const destination = presentation({ selectedNodeIds: ['c', 'b'], focusedNodeId: 'b' });
  deepEqual(focusHover.highlight.phaseByNodeId, { a: 'standard', b: 'highlighted', c: 'highlighted', d: 'void' },
    'explicit Focus hopping previews its resulting neighborhood');
  deepEqual(focusHover.highlight.phaseByNodeId, destination.highlight.phaseByNodeId,
    'the Focus preview phases exactly match the committed destination View');
  deepEqual(focusHover.labelRaising.byNodeId, destination.labelRaising.byNodeId,
    'the Focus preview labels exactly match the committed destination View');
  deepEqual([...focusHover.highlight.highlightedEdgeIds], ['b-c'], 'only prospective member-to-member links are highlighted');
  equal(focusHover.labelRaising.byNodeId.a.disposition, 'fallback', 'a prospective standard neighbor inherits dynamic label policy');
  equal(focusHover.objectPreview?.kind, 'view-transition', 'Focus hopping uses the View-entry avenue');
  equal(focusHover.interaction.focusedNodeId, 'c', 'the scene keeps its committed subject');
  equal(focusHover.objectPreview?.focusNodeId, 'b', 'the candidate receives a local focus cue');
  deepEqual([...focusHover.consciousnessClasses.attendedNodeIds], ['c'], 'the prospective member remains uncommitted');
  const restored = presentation({ selectedNodeIds: ['c'], focusedNodeId: 'c' });
  deepEqual(restored.highlight.phaseByNodeId, { a: 'void', b: 'standard', c: 'highlighted', d: 'standard' },
    'leaving restores the committed subject and neighborhood');
});

test('Final presentation phase determines baseline label eligibility with adaptive Focus Memory', () => {
  const value = presentation({ selectedNodeIds: ['a'], focusedNodeId: 'a' });
  const expected = { highlighted: 'force', standard: 'fallback', dimmed: 'suppress', void: 'suppress' } as const;
  for (const [nodeId, phase] of Object.entries(value.highlight.phaseByNodeId)) {
    equal(value.labelRaising.byNodeId[nodeId].disposition, expected[phase], `${phase} ${nodeId} follows the phase label policy`);
  }
  const rememberedRemoval = presentation({ selectedNodeIds: ['a'], rememberedNodeIds: ['a'],
    focusedNodeId: 'a', hoveredNodeId: 'a', ctrlHover: true });
  equal(rememberedRemoval.highlight.phaseByNodeId.a, 'highlighted', 'independent Memory survives deliberate removal preview');
  equal(rememberedRemoval.labelRaising.byNodeId.a.disposition, 'fallback',
    'highlighted Memory remains eligible without bypassing Focus adaptive layout');
});

test('Hovering a distant Focus member previews its View subject change', () => {
  const value = presentation({ selectedNodeIds: ['a', 'c'], focusedNodeId: 'a', hoveredNodeId: 'c' });
  deepEqual(value.highlight.phaseByNodeId, { a: 'highlighted', b: 'standard', c: 'highlighted', d: 'standard' },
    'explicit View preview supplies the prospective neighborhood');
  equal(value.highlight.phaseByEdgeId['c-d'], 'standard', 'a View-entry preview reveals its prospective context');
  equal(value.interaction.focusedNodeId, 'a', 'the presentation keeps the committed subject');
  equal(value.objectPreview?.focusNodeId, 'c', 'the candidate receives a local focus cue');
});

test('Admission/removal preview matrix preserves context while explicit View previews remain separate', () => {
  for (const viewMode of ['overview', 'explore', 'focus'] as const) {
    for (const hoveredNodeId of ['a', 'b', 'c']) {
      for (const ctrlHover of [false, true]) {
        const options = { viewMode, selectedNodeIds: ['a', 'c'],
          focusedNodeId: viewMode === 'focus' ? 'a' : undefined };
        const baseline = presentation(options);
        const preview = presentation({ ...options, hoveredNodeId, ctrlHover });
        equal(preview.interaction.state, baseline.interaction.state, 'hover cannot choose a View');
        equal(preview.interaction.focusedNodeId, baseline.interaction.focusedNodeId, 'hover cannot choose the scene subject');
        deepEqual([...preview.interaction.selectedNodeIds], options.selectedNodeIds, 'the interaction keeps committed membership');
        deepEqual(preview.consciousnessClasses.byNodeId, baseline.consciousnessClasses.byNodeId, 'classification stays authoritative');
        if (preview.objectPreview?.kind === 'view-transition') {
          equal(ctrlHover, false, 'Ctrl removal never borrows a resulting View');
          continue;
        }
        equal(preview.statePolicy, baseline.statePolicy, 'object preview retains committed scene policy');
        const affected = new Set([...preview.objectPreview?.addedNodeIds ?? [],
          ...preview.objectPreview?.removedNodeIds ?? [], ...preview.objectPreview?.hoverPathNodeIds ?? [],
          hoveredNodeId, ...preview.objectPreview?.focusNodeId ? [preview.objectPreview.focusNodeId] : []]);
        if (!ctrlHover) {
          for (const edge of document.edges) {
            if (edge.sourceId === hoveredNodeId) affected.add(edge.targetId);
            if (edge.targetId === hoveredNodeId) affected.add(edge.sourceId);
          }
        }
        for (const id of Object.keys(positions)) {
          if (affected.has(id)) continue;
          equal(preview.highlight.phaseByNodeId[id], baseline.highlight.phaseByNodeId[id], 'unaffected node phase is unchanged');
          deepEqual(preview.labelRaising.byNodeId[id], baseline.labelRaising.byNodeId[id], 'unaffected label policy is unchanged');
          equal(preview.constellationKindByNodeId[id], baseline.constellationKindByNodeId[id], 'unaffected node source is unchanged');
          equal(preview.focusEmphasisNodeIds.has(id), baseline.focusEmphasisNodeIds.has(id), 'unaffected focus emphasis is unchanged');
        }
        for (const edge of document.edges) {
          if (affected.has(edge.sourceId) || affected.has(edge.targetId)) continue;
          equal(preview.highlight.phaseByEdgeId[edge.id], baseline.highlight.phaseByEdgeId[edge.id], 'unaffected edge phase is unchanged');
          equal(preview.constellationKindByEdgeId[edge.id], baseline.constellationKindByEdgeId[edge.id], 'unaffected edge source is unchanged');
        }
      }
    }
  }
});

test('Animus carries compatibility interaction facts without assigning them to Consciousness', () => {
  const viewState = {
    schemaVersion: 1 as const,
    documentId: document.documentId,
    documentRevision: document.revision,
    consumerId: 'ego-test',
    profileId: 'two-dimensional',
    dimensions: '2d' as const,
    positions,
    pinnedNodeIds: [],
    camera: {
      position: { x: 0, y: 0, z: 10 }, target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 }, zoom: 1, projection: 'orthographic' as const,
    },
    selectedNodeIds: ['b'],
    activeFilters: {},
    moduleState: {},
  };
  const snapshot = createAnimusSnapshotV1({
    document,
    viewState,
    displaySelection: {
      nodeIds: new Set(document.nodes.map((node) => node.id)),
      edgeIds: new Set(document.edges.map((edge) => edge.id)),
    },
    positions,
  });

  deepEqual([...snapshot.interaction.selectedNodeIds], ['b'],
    'Animus should hand ordinary interaction facts to Anima');
  equal('consciousness' in snapshot, false,
    'the Animus handoff must not disguise compatibility interaction facts as Consciousness');
});

test('Anima scene compilation derives selection expression only from explicit Attention', () => {
  const viewState = {
    schemaVersion: 1 as const,
    documentId: document.documentId,
    documentRevision: document.revision,
    consumerId: 'ego-test',
    profileId: 'two-dimensional',
    dimensions: '2d' as const,
    positions,
    pinnedNodeIds: [],
    camera: {
      position: { x: 0, y: 0, z: 10 }, target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 }, zoom: 1, projection: 'orthographic' as const,
    },
    selectedNodeIds: ['b'],
    activeFilters: {},
    moduleState: {},
  };
  const displaySelection = {
    nodeIds: new Set(document.nodes.map((node) => node.id)),
    edgeIds: new Set(document.edges.map((edge) => edge.id)),
  };
  const snapshot = createAnimusSnapshotV1({
    document, viewState, displaySelection, positions,
  });
  const consciousness = resolveConsciousness({
    attentionNodeIds: ['a'],
    availableNodeIds: displaySelection.nodeIds,
  });
  const frame = compileAnimaSceneV1({ snapshot, consciousness });
  const byNodeId = Object.fromEntries(frame.nodes.map((node) => [node.id, node]));

  deepEqual(byNodeId.a.finalColor, DEFAULT_GRAPH_VISUAL_THEME_V2.colors.selectedNode,
    'the attended node should receive the selection expression');
  deepEqual(byNodeId.b.finalColor, DEFAULT_GRAPH_VISUAL_THEME_V2.colors.node,
    'a stale compatibility selection must not be interpreted as Attention');
  equal(byNodeId.a.strokeWidth, 1, 'attended presentation should receive an outline');
  equal(byNodeId.b.strokeWidth, undefined, 'compatibility selection should not produce an outline');
});


test('Overview constellation resolution stores connected highlighted groups without crossing unlit bridges', () => {
  const consciousness = new Consciousness();
  const available = new Set(['a', 'b', 'c', 'd', 'e']);
  const relationships = new Map([
    ['a', new Set(['b'])], ['b', new Set(['a', 'c'])],
    ['c', new Set(['b', 'd'])], ['d', new Set(['c', 'e'])], ['e', new Set(['d'])],
  ]);
  consciousness.receiveExogenous({ source: 'exogenous', type: 'replace-remembered-subjects', nodeIds: ['a', 'b', 'd', 'e'] }, { availableNodeIds: available });
  const first = consciousness.resolveOverviewConstellation('a', available, relationships, 'rev1');
  deepEqual(first?.nodeIds, ['a', 'b'], 'unlit c separates two highlighted constellations');
  equal(first, consciousness.resolveOverviewConstellation('b', available, relationships, 'rev1'), 'every member looks up the stored group object');
  deepEqual(consciousness.resolveOverviewConstellation('c', available, relationships, 'rev1')?.nodeIds,
    ['a', 'b', 'c', 'd', 'e'], 'an unlit clicked seed explicitly admits itself and both adjacent highlighted groups');
  const filtered = new Set(['a', 'd', 'e']);
  deepEqual(consciousness.resolveOverviewConstellation('a', filtered, relationships, 'rev2')?.nodeIds, ['a'],
    'unavailable members cannot be traversed');
  deepEqual([...consciousness.attention.nodeIds], [], 'resolving a group must not itself mutate composition');
});

test('Overview constellations retain Memory or Ego provenance without merging adjacent sources', () => {
  const consciousness = new Consciousness();
  const available = new Set(['a', 'b', 'c', 'd']);
  const relationships = new Map([
    ['a', new Set(['b'])], ['b', new Set(['a', 'c'])],
    ['c', new Set(['b', 'd'])], ['d', new Set(['c'])],
  ]);
  consciousness.receiveExogenous({ source: 'exogenous', type: 'replace-remembered-subjects',
    nodeIds: ['a', 'b', 'c'] }, { availableNodeIds: available });
  consciousness.reconcile({ attentionNodeIds: ['c', 'd'], availableNodeIds: available });
  const memory = consciousness.resolveOverviewConstellation('a', available, relationships, 'one');
  equal(memory?.kind, 'memory', 'remembered groups have their own semantic type');
  deepEqual(memory?.nodeIds, ['a', 'b', 'c'], 'a shared remembered subject cannot admit unrelated Ego members');
  const ego = consciousness.resolveOverviewConstellation('c', available, relationships, 'one');
  equal(ego?.kind, 'ego', 'deliberate membership wins on overlap, including cached lookups');
  deepEqual(ego?.nodeIds, ['c', 'd'], 'Ego grouping cannot absorb adjacent Memory');
  equal(ego, consciousness.resolveOverviewConstellation('d', available, relationships, 'one'), 'Ego members share one immutable group');
  equal(memory, consciousness.resolveOverviewConstellation('b', available, relationships, 'one'), 'Memory members share their own group');
  const filtered = new Set(['a', 'c', 'd']);
  deepEqual(consciousness.resolveOverviewConstellation('a', filtered, relationships, 'two')?.nodeIds, ['a'],
    'filtering a remembered bridge splits the Memory constellation');
  consciousness.receiveExogenous({ source: 'exogenous', type: 'replace-remembered-subjects', nodeIds: ['a'] },
    { availableNodeIds: available });
  deepEqual(consciousness.resolveOverviewConstellation('a', available, relationships, 'two')?.nodeIds, ['a'],
    'recency changes invalidate cached Memory membership');
  deepEqual([...consciousness.attention.nodeIds], ['c', 'd'], 'group lookup never commits Attention');
});


test('Scene compilation enforces View phases even without Anima styling or with conflicting module contributions', () => {
  const viewState = {
    schemaVersion: 1 as const, documentId: document.documentId, documentRevision: document.revision,
    consumerId: 'views', profileId: 'two-dimensional', dimensions: '2d' as const,
    positions, pinnedNodeIds: [], selectedNodeIds: ['a'], focusedNodeId: 'a', viewMode: 'focus' as const,
    camera: { position: { x: 0, y: 0, z: 10 }, target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 }, zoom: 1, projection: 'orthographic' as const },
    activeFilters: {}, moduleState: {},
  };
  const displaySelection = { nodeIds: new Set(Object.keys(positions)), edgeIds: new Set(document.edges.map((edge) => edge.id)) };
  const consciousness = resolveConsciousness({ attentionNodeIds: ['a'], availableNodeIds: displaySelection.nodeIds });
  const snapshot = createAnimusSnapshotV1({ document, viewState, displaySelection, positions, hoveredNodeId: 'b' });
  const frame = compileAnimaSceneV1({ snapshot, consciousness,
    nodeContributions: { b: { opacity: 1 }, d: { opacity: 1, showLabel: true, labelForceVisible: true, labelOpacity: 1 } },
    edgeContributions: { 'c-d': { opacity: 1, arrowOpacity: 1 } },
  });
  const nodes = Object.fromEntries(frame.nodes.map((node) => [node.id, node]));
  equal(nodes.a.opacity, 1, 'member stays highlighted');
  equal(nodes.b.opacity, 1, 'the prospective subject is highlighted');
  equal(nodes.c.opacity, 1, 'an admitted Focus-hop preview reveals its neighbor without Anima styling');
  equal(nodes.b.labelForceVisible, true, 'the prospective subject label is readable');
  equal(nodes.d.opacity, 0, 'unrelated context is void without requiring the styling module');
  equal(nodes.d.showLabel, false, 'a module cannot reveal a void label');
  equal(nodes.d.labelOpacity, 0, 'a void label is transparent');
  equal(frame.edges.find((edge) => edge.id === 'c-d')?.opacity, 0, 'an edge cannot expose a void endpoint');
  equal(frame.edges.find((edge) => edge.id === 'c-d')?.arrowOpacity, 0, 'arrows share the edge visibility contract');
});


test('View descent cannot bypass Experience focus capability through composition admission', () => {
  const command: GraphRuntimeCommandV1 = {
    type: 'direct-attention', nodeIds: ['a', 'b'], subjectNodeId: 'b', focusNodeId: 'b',
    identity: { documentId: document.documentId, documentRevision: document.revision }, timestamp: 0,
  };
  const outcome = adjudicateGraphExperienceCommandV1({ command,
    experience: { ...DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1,
      permittedInteractions: DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1.permittedInteractions.filter((value) => value !== 'direct-focus') },
    currentState: 'explore', attentionNodeIds: ['a'],
  });
  deepEqual(outcome, { status: 'rejected', reason: 'interaction-not-permitted:direct-focus' },
    'the atomic membership-and-subject operation must validate Focus permission before either effect');
});


test('Object previews share group activation and Experience admission without realizing Attention', () => {
  const options = {
    viewId: 'overview' as const, nodeId: 'b', attentionNodeIds: [] as string[],
    getConstellation: () => ['a', 'b'],
    identity: { documentId: document.documentId, documentRevision: document.revision },
  };
  const plan = planGraphViewObjectActivationV1(options)!;
  const preview = previewGraphObjectInteractionV1(options)!;
  deepEqual(preview.addedNodeIds, plan.nodeIds, 'Overview previews the complete looked-up group as object additions');
  equal(preview.kind, 'view-transition', 'Overview hover previews the exact destination View and admission');
  equal(preview.kind === 'view-transition' && preview.resultingState.viewId, 'explore', 'click commits the previewed Constellation');
  const local = { ...DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1,
    allowedStates: ['focus'] as const,
    attention: { maximumNodeCount: 1, overflow: 'preserve-intent-subject' as const },
  };
  deepEqual(previewGraphObjectInteractionV1({ ...options, experience: local }), {
    kind: 'view-transition', resultingState: { viewId: 'focus', attentionNodeIds: ['b'], focusedNodeId: 'b' },
    activation: 'primary', addedNodeIds: ['b'], removedNodeIds: [], focusNodeId: 'b', hoverPathNodeIds: [],
  }, 'preview honors Focus-only admission and single-subject cardinality');
  const noFocus = { ...DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1,
    permittedInteractions: DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1.permittedInteractions.filter((id) => id !== 'direct-focus'),
  };
  equal(previewGraphObjectInteractionV1({ ...options, nodeId: 'a', viewId: 'explore', attentionNodeIds: ['a'], experience: noFocus }),
    undefined, 'a rejected Focus click has no hypothetical Focus preview');
  equal(previewGraphObjectInteractionV1({ ...options, experience: { ...local, permittedInteractions: noFocus.permittedInteractions } }),
    undefined, 'a Focus-only adjustment cannot bypass the Focus capability');
});

test('Overview hover previews its admitted constellation View without committing it', () => {
  const value = presentation({ rememberedNodeIds: ['b', 'c'], hoveredNodeId: 'a' });
  deepEqual(value.objectPreview?.addedNodeIds, ['a'], 'the unlit seed previews its own addition without adopting Memory');
  deepEqual(value.objectPreview?.hoverPathNodeIds, [], 'passive Memory cannot become the target of a prospective route');
  deepEqual(value.highlight.phaseByNodeId, { a: 'highlighted', b: 'highlighted', c: 'highlighted', d: 'dimmed' },
    'the prospective Constellation supplies its destination context');
  deepEqual([...value.consciousnessClasses.attendedNodeIds], [], 'preview highlights are not Attention');
  const restored = presentation({ rememberedNodeIds: ['b', 'c'] });
  equal(restored.highlight.phaseByNodeId.a, 'standard', 'uncommitted seed highlighting expires on leave');
  equal(restored.highlight.phaseByNodeId.b, 'highlighted', 'remembered highlighting survives leave');
});


test('Hover routes choose the nearest selected constellation member with stable ties and projected topology', () => {
  const edges = [graphEdge('xb', 'x', 'b'), graphEdge('xa', 'x', 'a'),
    graphEdge('ac', 'a', 'c'), graphEdge('bd', 'b', 'd'), graphEdge('de', 'd', 'e')];
  const options = { edges, visibleNodeIds: new Set(['x', 'a', 'b', 'c', 'd', 'e', 'z']),
    visibleEdgeIds: new Set(edges.map((edge) => edge.id)), targetNodeIds: new Set(['c', 'd', 'e']) };
  deepEqual(resolveGraphHoverPathV1('x', options), ['x', 'a', 'c'], 'equal shortest routes use stable node-ID ordering');
  deepEqual(resolveGraphHoverPathV1('x', { ...options, edges: [...edges].reverse() }), ['x', 'a', 'c'],
    'canonical edge order cannot change the chosen route');
  deepEqual(resolveGraphHoverPathV1('x', { ...options, visibleEdgeIds: new Set(['xb', 'bd', 'de']) }), ['x', 'b', 'd'],
    'filtered edges cannot bridge to a hidden route; nearest wins over a farther target');
  deepEqual(resolveGraphHoverPathV1('x', { ...options, visibleNodeIds: new Set(['x', 'b', 'd', 'e']) }), ['x', 'b', 'd'],
    'filtered nodes cannot participate');
  deepEqual(resolveGraphHoverPathV1('z', options), [], 'disconnected hover has no fabricated path');
  deepEqual(resolveGraphHoverPathV1('x', { ...options, targetNodeIds: new Set() }), [], 'no constellation means no route');
  deepEqual(resolveGraphHoverPathV1('c', options), [], 'a member already reaches its constellation');
});

test('Hover paths can reveal Focus context beyond the prospective neighborhood and expire on leave', () => {
  const value = presentation({ selectedNodeIds: ['a'], focusedNodeId: 'a', hoveredNodeId: 'd' });
  deepEqual(value.objectPreview?.addedNodeIds, ['d', 'c', 'b'], 'the complete previewed route is admitted into Attention');
  deepEqual([...value.highlight.hoverPathNodeIds], ['d', 'c', 'b', 'a'], 'the route is computed against committed membership');
  deepEqual(value.highlight.phaseByNodeId, { a: 'highlighted', b: 'highlighted', c: 'highlighted', d: 'highlighted' },
    'intermediate route nodes are visible even beyond the hovered subject immediate neighborhood');
  deepEqual([...value.consciousnessClasses.attendedNodeIds], ['a'], 'the route remains presentation only');
  const restored = presentation({ selectedNodeIds: ['a'], focusedNodeId: 'a' });
  deepEqual(restored.highlight.phaseByNodeId, { a: 'highlighted', b: 'standard', c: 'void', d: 'void' }, 'all provisional route emphasis expires');
  deepEqual([...restored.highlight.hoverPathNodeIds], [], 'the path does not latch');
});


test('View label policy suppresses Ctrl-removal before hovered-label forcing', () => {
  for (const viewMode of ['overview', 'explore', 'focus'] as const) {
    const value = presentation({ viewMode, selectedNodeIds: ['a', 'c'], hoveredNodeId: 'c',
      focusedNodeId: viewMode === 'focus' ? 'a' : undefined, ctrlHover: true });
    equal(value.labelRaising.byNodeId.c.disposition, 'suppress', 'a removal preview cannot retain the hovered label');
  }
  equal(presentation({ selectedNodeIds: ['a'], hoveredNodeId: 'b' }).labelRaising.byNodeId.b.disposition,
    'force', 'ordinary candidate hover remains readable');
});

test('Overview node dragging preserves scene highlights without lighting neighbors or labels', () => {
  const value = presentation({ viewMode: 'overview', draggedNodeId: 'b' });
  deepEqual(value.highlight.phaseByNodeId, { a: 'standard', b: 'standard', c: 'standard', d: 'standard' },
    'drag activity cannot expand into an Overview constellation');
  for (const id of ['a', 'c']) equal(value.labelRaising.byNodeId[id].disposition, 'fallback',
    'dragging cannot force neighbor labels');
});

test('Ctrl-hover previews removal and leaves nonmembers unchanged across Views', () => {
  const build = presentation({ selectedNodeIds: ['a', 'c'], hoveredNodeId: 'c', ctrlHover: true });
  deepEqual(build.objectPreview?.removedNodeIds, ['c'], 'the target has an explicit removal cue');
  equal(build.interaction.state, 'explore', 'the scene stays in committed Constellation');
  equal(build.highlight.phaseByNodeId.c, 'dimmed', 'the removed member shows nonmember presentation');
  deepEqual([...build.highlight.hoverPathNodeIds], [], 'removal preview cannot relight its own target through a route');
  deepEqual([...build.consciousnessClasses.attendedNodeIds], ['a', 'c'], 'actual Attention stays intact');
  const releaseFocus = presentation({ selectedNodeIds: ['a', 'c'], focusedNodeId: 'a', hoveredNodeId: 'a', ctrlHover: true });
  equal(releaseFocus.interaction.state, 'focus', 'subject removal cannot preview a View exit');
  equal(releaseFocus.interaction.focusedNodeId, 'a', 'subject removal retains committed Focus context');
  equal(releaseFocus.highlight.phaseByNodeId.a, 'dimmed', 'removed subject receives the dimmed removal phase');
  const last = presentation({ selectedNodeIds: ['a'], focusedNodeId: 'a', hoveredNodeId: 'a', ctrlHover: true });
  equal(last.interaction.state, 'focus', 'last-member removal cannot preview Overview');
  deepEqual(last.highlight.phaseByNodeId, { a: 'dimmed', b: 'standard', c: 'void', d: 'void' },
    'last-member removal changes its object without revealing the Overview field');
  const otherMember = presentation({ selectedNodeIds: ['a', 'c'], focusedNodeId: 'a', hoveredNodeId: 'c', ctrlHover: true });
  equal(otherMember.highlight.phaseByNodeId.c, 'dimmed', 'removing a distant member retains a dim removal cue');
  equal(otherMember.interaction.focusedNodeId, 'a', 'removing another member retains Focus');
  for (const viewMode of ['overview', 'explore', 'focus'] as const) {
    const options = { viewMode, selectedNodeIds: ['a'], focusedNodeId: viewMode === 'focus' ? 'a' : undefined };
    const committed = presentation(options);
    const unchanged = presentation({ ...options, hoveredNodeId: 'b', ctrlHover: true });
    deepEqual(unchanged.objectPreview?.addedNodeIds, [], 'Ctrl cannot provisionally add a nonmember');
    deepEqual(unchanged.objectPreview?.removedNodeIds, [], 'Ctrl on a nonmember has no object changes');
    equal(unchanged.interaction.state, viewMode, 'Ctrl over a nonmember preserves the View');
    equal(unchanged.interaction.focusedNodeId, options.focusedNodeId, 'Ctrl preserves the subject');
    deepEqual(unchanged.highlight.phaseByNodeId, committed.highlight.phaseByNodeId, 'nonmember phases stay committed');
    deepEqual(unchanged.highlight.phaseByEdgeId, committed.highlight.phaseByEdgeId, 'nonmember edges stay committed');
    deepEqual(unchanged.labelRaising.byNodeId.b, committed.labelRaising.byNodeId.b, 'Ctrl does not force the nonmember label');
    deepEqual([...unchanged.highlight.hoverPathNodeIds], [], 'Ctrl cannot add a prospective route');
    const rememberedOptions = { ...options, rememberedNodeIds: ['b'] };
    const remembered = presentation(rememberedOptions);
    const rememberedHover = presentation({ ...rememberedOptions, hoveredNodeId: 'b', ctrlHover: true });
    deepEqual(rememberedHover.highlight.phaseByNodeId, remembered.highlight.phaseByNodeId,
      'no-change preserves independent Memory highlighting');
    deepEqual(rememberedHover.labelRaising.byNodeId.b, remembered.labelRaising.byNodeId.b,
      'no-change retains the Memory label policy without giving it a hover reason');
  }
});

 test('Hover neighbor reveal respects projected edges and expires without admitting neighbors', () => {
  for (const viewMode of ['explore', 'focus'] as const) {
    const options = { viewMode, selectedNodeIds: ['a'],
      focusedNodeId: viewMode === 'focus' ? 'a' : undefined,
      visibleEdgeIds: new Set(['a-b', 'b-c']) };
    const hovered = presentation({ ...options, hoveredNodeId: 'b' });
    equal(hovered.highlight.phaseByNodeId.c, 'standard', 'hover raises its immediate neighbor one step');
    equal(hovered.highlight.phaseByNodeId.d, viewMode === 'focus' ? 'void' : 'dimmed', 'filtered edge cannot expand hover');
    deepEqual([...hovered.consciousnessClasses.attendedNodeIds], ['a'], 'neighbors never become members');
    const left = presentation(options);
    equal(left.highlight.phaseByNodeId.c, viewMode === 'focus' ? 'void' : 'dimmed', 'leaving removes transient neighbor reveal');
  }
});
