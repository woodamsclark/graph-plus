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
  resolveConsciousness,
  resolveAnimaHighlightPolicyV1,
  type GraphRuntimeCommandV1,
} from '../../src/graph-engine/runtime/index.ts';
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
  readonly selectedNodeIds?: readonly string[];
  readonly focusedNodeId?: string;
  readonly hoveredNodeId?: string;
  readonly selectionPresentationSuspended?: boolean;
}) {
  const viewState = {
    ...baseViewState,
    selectedNodeIds: [...(options.selectedNodeIds ?? [])],
    ...(options.focusedNodeId === undefined ? {} : { focusedNodeId: options.focusedNodeId }),
  };
  const consciousness = resolveConsciousness({
    attentionNodeIds: viewState.selectedNodeIds,
    availableNodeIds: new Set(Object.keys(positions)),
  });
  const interaction = createGraphInteractionContextV1({
    viewState,
    ...(options.hoveredNodeId === undefined ? {} : { hoveredNodeId: options.hoveredNodeId }),
    selectionPresentationSuspended: options.selectionPresentationSuspended,
  });
  return createAnimaConsciousnessPresentationV1({
    attention: consciousness.attention,
    awareness: consciousness.awareness,
    interaction,
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
  deepEqual([...state.awareness.nodeIds], ['a', 'c', 'b'],
    'Awareness should contain Attention plus available peripheral contributions');
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

test('neutral experience policy constrains Attention and expands it into Awareness', () => {
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
  deepEqual([...state.awareness.nodeIds], ['b', 'a', 'c'],
    'policy should expand the realized subject into one peripheral neighborhood');
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
    { disposition: 'raise', reason: 'attended', priority: 3 },
    'Anima should raise an attended label above dim context');
  deepEqual(value.labelRaising.byNodeId.a,
    { disposition: 'suppress', reason: 'dimmed', priority: 2 },
    'Anima should suppress an unaware neighbor in dim context');
});

test('Anima distinguishes peripheral Awareness from Attention and unaware context', () => {
  const viewState = { ...baseViewState, selectedNodeIds: ['b'] };
  const consciousness = resolveConsciousness({
    attentionNodeIds: ['b'],
    availableNodeIds: new Set(Object.keys(positions)),
    peripheralAwarenessNodeIds: ['a', 'c'],
  });
  const value = createAnimaConsciousnessPresentationV1({
    attention: consciousness.attention,
    awareness: consciousness.awareness,
    interaction: createGraphInteractionContextV1({ viewState }),
    document,
  });

  deepEqual([...value.consciousnessClasses.attendedNodeIds], ['b'],
    'Attention should compile only to the attended class');
  deepEqual([...value.consciousnessClasses.peripherallyAwareNodeIds], ['a', 'c'],
    'Awareness outside Attention should compile to the peripheral class');
  deepEqual([...value.consciousnessClasses.unawareContextNodeIds], ['d'],
    'projected nodes outside Awareness should compile to unaware context');
  deepEqual(value.labelRaising.byNodeId.a,
    { disposition: 'raise', reason: 'aware', priority: 3 },
    'peripheral Awareness should remain visually resolvable without becoming selected');
});

test('Anima forces hover while giving hover neighbors a 50% Saliency boost', () => {
  const value = presentation({ hoveredNodeId: 'b' });

  deepEqual(value.labelRaising.byNodeId.b,
    { disposition: 'force', reason: 'hover', priority: 5 },
    'the hovered node should always reveal its label');
  deepEqual(value.labelRaising.byNodeId.a,
    { disposition: 'favor', reason: 'hover-neighbor', priority: 4, saliencyBoost: 0.5 },
    'a direct hover neighbor should halve its effective Saliency threshold');
  deepEqual(value.labelRaising.byNodeId.c,
    { disposition: 'favor', reason: 'hover-neighbor', priority: 4, saliencyBoost: 0.5 },
    'every direct hover neighbor should receive the same Saliency boost');
  deepEqual(value.labelRaising.byNodeId.d,
    { disposition: 'fallback', reason: 'slider', priority: 1 },
    'unrelated normal context should fall back to the zoom-dependent slider');
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
  equal(resolveAnimaHighlightPolicyV1(suspended).contextRole, 'normal',
    'a transient interaction condition may temporarily suspend dimming');
  equal(resolveAnimaHighlightPolicyV1(overview).contextRole, ANIMA_HIGHLIGHT_POLICY_V1.contextRole,
    'leaving Explore should restore Anima global truth without cleanup');
});

test('Focus presentation override cannot leak into Explore', () => {
  const focus = presentation({ selectedNodeIds: ['a', 'c'], focusedNodeId: 'c' });
  const explore = presentation({ selectedNodeIds: ['a'] });

  deepEqual([...focus.highlight.highlightedNodeIds].sort(), ['a', 'b', 'c', 'd'],
    'Focus should combine aware seeds with the focused one-hop neighborhood');
  deepEqual([...focus.highlight.highlightedEdgeIds].sort(), ['b-c', 'c-d'],
    'Focus should scope links to focused incidents plus links between aware seeds');
  deepEqual([...explore.highlight.highlightedNodeIds].sort(), ['a'],
    'returning to Explore should restore Awareness-only presentation');
  equal(explore.highlight.policy.contextRole, 'dimmed',
    'Focus context hiding must expire with Focus');
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
