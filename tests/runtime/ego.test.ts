import {
  ANIMA_HIGHLIGHT_POLICY_V1,
  createAnimaAwarenessPresentationV1,
  createAnimusSnapshotV1,
  createEgo,
  createGraphInteractionContextV1,
  resolveAnimaHighlightPolicyV1,
} from '../../src/graph-engine/runtime/index.ts';
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
  const ego = createEgo({ viewState, positions });
  const interaction = createGraphInteractionContextV1({
    viewState,
    ...(options.hoveredNodeId === undefined ? {} : { hoveredNodeId: options.hoveredNodeId }),
    selectionPresentationSuspended: options.selectionPresentationSuspended,
  });
  return createAnimaAwarenessPresentationV1({
    awareness: ego.awareness,
    interaction,
    document,
  });
}

test('Ego owns only the nodes held in Awareness and their centroid', () => {
  const ego = createEgo({
    viewState: { ...baseViewState, selectedNodeIds: ['a', 'c'] },
    positions,
  });

  deepEqual([...ego.awareness.nodeIds], ['a', 'c'], 'Awareness should retain its selected graph subjects');
  deepEqual(ego.awareness.centroid, { x: 10, y: 10, z: 1 }, 'Awareness should derive their centroid for Vision');
  deepEqual(Object.keys(ego), ['awareness'], 'Ego must not own interaction or presentation decisions');
});

test('Anima scopes Constellation presentation to Ego Awareness', () => {
  const value = presentation({ selectedNodeIds: ['b'] });

  equal(value.statePolicy.renderScope, 'graph-with-awareness-emphasis',
    'Anima should resolve Explore presentation independently from Ego');
  deepEqual([...value.highlight.highlightedNodeIds].sort(), ['b'],
    'Constellation should highlight only nodes held in Awareness');
  deepEqual([...value.highlight.highlightedEdgeIds].sort(), [],
    'one aware node should have no aware-to-aware link to highlight');
  equal(value.highlight.policy.labels, 'delegate',
    'highlight resolution must leave labels under their independent manager');
  deepEqual(value.labelRaising.byNodeId.b,
    { disposition: 'raise', reason: 'aware', priority: 3 },
    'Anima should raise an aware label above dim context');
  deepEqual(value.labelRaising.byNodeId.a,
    { disposition: 'suppress', reason: 'dimmed', priority: 2 },
    'Anima should suppress an unaware neighbor in dim context');
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

test('Animus carries interaction facts without assigning them to Ego', () => {
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
  equal('ego' in snapshot, false, 'the Animus handoff must not disguise interaction facts as Ego');
});
