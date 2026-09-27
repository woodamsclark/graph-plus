import {
  EGO_HIGHLIGHT_POLICY_V1,
  createAnimusSnapshotV1,
  createEgo,
  createEgoAwarenessV1,
  createEgoUiContextV1,
  resolveEgoHighlightPolicyV1,
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
const baseViewState = {
  dimensions: '2d' as const,
  selectedNodeIds: [] as string[],
  pinnedNodeIds: [] as string[],
};

test('Ego owns selection attention while Vision remains outside the semantic model', () => {
  const ego = createEgo({
    viewState: { ...baseViewState, selectedNodeIds: ['a', 'c'] },
    positions: {
      a: { x: -10, y: 20, z: 4 },
      c: { x: 30, y: 0, z: -2 },
    },
    document,
  });

  deepEqual([...ego.attention.nodeIds], ['a', 'c'], 'attention should retain its semantic node subjects');
  deepEqual(ego.attention.point, { x: 10, y: 10, z: 1 }, 'attention should resolve the selected centroid');
});

test('Ego scopes Constellation highlighting to selected nodes', () => {
  const viewState = {
    ...baseViewState,
    selectedNodeIds: ['b'],
  };
  const ego = createEgoAwarenessV1({ viewState, document });

  equal(ego.context.state, 'explore', 'selection should make Ego aware of Explore');
  equal(ego.contract.renderScope, 'graph-with-selection-emphasis',
    'the context and active contract should be resolved together');
  deepEqual([...ego.highlight.seedNodeIds].sort(), ['b'], 'the selected node should seed highlight');
  deepEqual([...ego.highlight.highlightedNodeIds].sort(), ['b'],
    'Constellation should override global expansion and highlight only selected nodes');
  deepEqual([...ego.highlight.highlightedEdgeIds].sort(), [],
    'a one-node Constellation should have no selected-to-selected link to highlight');
  equal(ego.highlight.policy.labels, 'delegate',
    'highlight resolution must leave labels under their independent manager');
  deepEqual(ego.labelRaising.byNodeId.b,
    { disposition: 'raise', reason: 'selected', priority: 3 },
    'Ego should raise a selected label above dim context and slider fallback');
  deepEqual(ego.labelRaising.byNodeId.a,
    { disposition: 'suppress', reason: 'dimmed', priority: 2 },
    'an unselected selection neighbor should remain dim and suppress its label');
  deepEqual(ego.labelRaising.byNodeId.d,
    { disposition: 'suppress', reason: 'dimmed', priority: 2 },
    'Ego should suppress an unrelated dim context label before the slider runs');
});

test('Ego forces hover while giving hover neighbors a 50% Saliency boost', () => {
  const ego = createEgoAwarenessV1({
    viewState: baseViewState,
    document,
    hoveredNodeId: 'b',
  });

  deepEqual(ego.labelRaising.byNodeId.b,
    { disposition: 'force', reason: 'hover', priority: 5 },
    'the hovered node should always reveal its label');
  deepEqual(ego.labelRaising.byNodeId.a,
    { disposition: 'favor', reason: 'hover-neighbor', priority: 4, saliencyBoost: 0.5 },
    'a direct hover neighbor should halve its effective Saliency threshold');
  deepEqual(ego.labelRaising.byNodeId.c,
    { disposition: 'favor', reason: 'hover-neighbor', priority: 4, saliencyBoost: 0.5 },
    'every direct hover neighbor should receive the same Saliency boost');
  deepEqual(ego.labelRaising.byNodeId.d,
    { disposition: 'fallback', reason: 'slider', priority: 1 },
    'unrelated normal context should fall back to the zoom-dependent slider');
});

test('Ego state overrides are derived contracts and expire when their requesting state expires', () => {
  const base = baseViewState;
  const explore = createEgoUiContextV1({
    viewState: { ...base, selectedNodeIds: ['b'] },
  });
  const suspended = createEgoUiContextV1({
    viewState: { ...base, selectedNodeIds: ['b'] },
    selectionPresentationSuspended: true,
  });
  const overview = createEgoUiContextV1({ viewState: base });

  equal(resolveEgoHighlightPolicyV1(explore).contextRole, 'dimmed',
    'Explore should temporarily override global context presentation');
  equal(resolveEgoHighlightPolicyV1(suspended).contextRole, 'normal',
    'a transient Ego condition may temporarily supersede the active state contract');
  equal(resolveEgoHighlightPolicyV1(overview).contextRole, EGO_HIGHLIGHT_POLICY_V1.contextRole,
    'leaving Explore should automatically restore external global truth without cleanup');
});

test('Focus override cannot leak into the next Ego state', () => {
  const base = baseViewState;
  const focus = createEgoAwarenessV1({
    viewState: { ...base, selectedNodeIds: ['a', 'c'], focusedNodeId: 'c' },
    document,
  });
  const explore = createEgoAwarenessV1({
    viewState: { ...base, selectedNodeIds: ['a'] },
    document,
  });

  deepEqual([...focus.highlight.highlightedNodeIds].sort(), ['a', 'b', 'c', 'd'],
    'Focus should combine its selected seeds with the focused one-hop neighborhood');
  deepEqual([...focus.highlight.highlightedEdgeIds].sort(), ['b-c', 'c-d'],
    'Focus should scope links to focused incidents plus links between selected seeds');
  deepEqual([...explore.highlight.highlightedNodeIds].sort(), ['a'],
    'returning to Explore should restore selection-only Constellation policy');
  equal(explore.highlight.policy.contextRole, 'dimmed',
    'Focus context hiding must expire with Focus');
});

test('one Ego context object crosses the Animus to Anima handoff', () => {
  const viewState = {
    schemaVersion: 1 as const,
    documentId: document.documentId,
    documentRevision: document.revision,
    consumerId: 'ego-test',
    profileId: 'two-dimensional',
    dimensions: '2d' as const,
    positions: Object.fromEntries(document.nodes.map((node, index) => [node.id, { x: index, y: 0, z: 0 }])),
    pinnedNodeIds: [],
    camera: {
      position: { x: 0, y: 0, z: 10 },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      zoom: 1,
      projection: 'orthographic' as const,
    },
    selectedNodeIds: ['b'],
    activeFilters: {},
    moduleState: {},
  };
  const ego = createEgoAwarenessV1({ viewState, document });
  const snapshot = createAnimusSnapshotV1({
    document,
    viewState,
    displaySelection: {
      nodeIds: new Set(document.nodes.map((node) => node.id)),
      edgeIds: new Set(document.edges.map((edge) => edge.id)),
    },
    positions: viewState.positions,
    egoContext: ego.context,
  });

  equal(snapshot.ego, ego.context, 'Animus must carry the exact Ego context installed by composition');
  equal(snapshot.interaction, snapshot.ego,
    'the legacy interaction surface must alias Ego instead of creating a sibling state object');
});
