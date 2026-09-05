import { analyzeGraphTopologyV1 } from '../../src/graph-engine/core/topology/index.ts';
import {
  buildComponentPackingTargetsV1,
  coordinateWeightedSpringStrengthV1,
  deriveWeightedSpringParametersV1,
  ForceLayoutModule,
  readForceSettings,
} from '../../src/graph-engine/runtime/modules/shipped/ForceLayoutModule.ts';
import { DEFAULT_GRAPH_RENDER_THEME_V1 } from '../../src/graph-engine/runtime/render/index.ts';
import type { GraphModulePipelineStateV1 } from '../../src/graph-engine/runtime/modules/GraphModuleTypes.ts';
import { graphDocument, graphEdge, graphNode } from '../support/contractFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

test('A-PAIR-01 aggregates physical endpoint pairs without changing canonical edges', () => {
  const document = graphDocument({
    nodes: ['a', 'b', 'isolated'].map((id) => graphNode(id)),
    edges: [
      graphEdge('forward', 'a', 'b', { directed: true, weight: 1, tokens: ['relation:x'] }),
      graphEdge('reverse', 'b', 'a', { directed: true, weight: 1, tokens: ['relation:x'] }),
      graphEdge('parallel', 'a', 'b', { directed: true, weight: 3, tokens: ['relation:y'] }),
      graphEdge('self', 'a', 'a', { directed: true, weight: 10 }),
    ],
  });
  const analysis = analyzeGraphTopologyV1(document);
  equal(analysis.pairs.length, 1, 'self edges should not produce positional pairs');
  const pair = analysis.pairs[0];
  equal(pair.evidenceMass, 5, 'parallel evidence should accumulate by magnitude');
  equal(pair.multiplicity, 3, 'canonical multiplicity should remain observable');
  equal(pair.reciprocal, true, 'opposite directed evidence should be reciprocal');
  deepEqual(pair.edgeIds, ['forward', 'parallel', 'reverse'], 'pair aggregation should preserve every canonical edge ID');
  deepEqual(pair.relationChannels, ['relation:x', 'relation:y'], 'opaque relation channels should be retained');
  deepEqual(analysis.components.map((component) => component.nodeIds), [['a', 'b'], ['isolated']], 'isolated nodes should remain one-node components');
  equal(document.edges.length, 4, 'analysis must not alter canonical edges');
});

test('A-PAIR-02 treats parallel and consolidated evidence equivalently', () => {
  const document = graphDocument({
    nodes: ['a', 'b', 'c', 'd'].map((id) => graphNode(id)),
    edges: [
      ...Array.from({ length: 5 }, (_, index) => graphEdge(`parallel-${index}`, 'a', 'b', { directed: true })),
      graphEdge('consolidated', 'c', 'd', { directed: true, weight: 5 }),
    ],
  });
  const analysis = analyzeGraphTopologyV1(document);
  equal(analysis.pairs[0].evidenceMass, analysis.pairs[1].evidenceMass, 'both representations should carry the same evidence mass');
  equal(analysis.pairs[0].affinity, analysis.pairs[1].affinity, 'both representations should derive the same affinity');
});

test('A-DIRECTION-01 detects only directed reciprocity', () => {
  const document = graphDocument({
    nodes: ['a', 'b', 'c', 'd'].map((id) => graphNode(id)),
    edges: [
      graphEdge('a-b', 'a', 'b', { directed: true, weight: 1 }),
      graphEdge('b-a', 'b', 'a', { directed: true, weight: 1 }),
      graphEdge('c-d', 'c', 'd', { weight: 2 }),
    ],
  });
  const analysis = analyzeGraphTopologyV1(document);
  const reciprocal = analysis.pairs.find((pair) => pair.sourceId === 'a')!;
  const undirected = analysis.pairs.find((pair) => pair.sourceId === 'c')!;
  equal(reciprocal.reciprocal, true, 'directed evidence in both directions should be reciprocal');
  equal(undirected.reciprocal, false, 'an undirected edge should not claim directed reciprocity');
  equal(undirected.undirected, true, 'an omitted directed flag should retain symmetric topology');
  assert(reciprocal.affinity > undirected.affinity, 'equal-mass reciprocal evidence should receive a bounded boost');
});

test('A-AFFINITY-04 discounts hubs relative to specific endpoint pairs', () => {
  const document = graphDocument({
    nodes: ['a', 'b', 'hub', 'x', 'y', 'z', 'w'].map((id) => graphNode(id)),
    edges: [
      graphEdge('specific', 'a', 'b'),
      graphEdge('hub-x', 'hub', 'x'),
      graphEdge('hub-y', 'hub', 'y'),
      graphEdge('hub-z', 'hub', 'z'),
      graphEdge('hub-w', 'hub', 'w'),
    ],
  });
  const analysis = analyzeGraphTopologyV1(document);
  const specific = analysis.pairs.find((pair) => pair.edgeIds.includes('specific'))!;
  const hubEdge = analysis.pairs.find((pair) => pair.edgeIds.includes('hub-x'))!;
  assert(specific.affinity > hubEdge.affinity, 'equal evidence between low-degree endpoints should outrank a hub-mediated edge');
});

test('A-RELATION-01 uses opaque relation-channel specificity without semantic ranking', () => {
  const makeDocument = (rare: string, common: string) => graphDocument({
    nodes: ['hub', 'a', 'b', 'c', 'rare'].map((id) => graphNode(id)),
    edges: [
      graphEdge('common-a', 'hub', 'a', { tokens: [`relation:${common}`] }),
      graphEdge('common-b', 'hub', 'b', { tokens: [`relation:${common}`] }),
      graphEdge('common-c', 'hub', 'c', { tokens: [`relation:${common}`] }),
      graphEdge('rare', 'hub', 'rare', { tokens: [`relation:${rare}`] }),
    ],
  });
  const first = analyzeGraphTopologyV1(makeDocument('b', 'a'));
  const renamed = analyzeGraphTopologyV1(makeDocument('arbitrary', 'renamed'));
  const firstRare = first.pairs.find((pair) => pair.edgeIds.includes('rare'))!;
  const firstCommon = first.pairs.find((pair) => pair.edgeIds.includes('common-a'))!;
  const renamedRare = renamed.pairs.find((pair) => pair.edgeIds.includes('rare'))!;
  assert(firstRare.affinity > firstCommon.affinity, 'a structurally rare channel should survive high total degree');
  equal(firstRare.affinity, renamedRare.affinity, 'renaming opaque channels should not change affinity');
});

test('A-AFFINITY-02 bounds repeated, zero, negative, and extreme evidence', () => {
  const document = graphDocument({
    nodes: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => graphNode(id)),
    edges: [
      graphEdge('one', 'a', 'b', { weight: 1 }),
      graphEdge('negative', 'c', 'd', { weight: -5 }),
      graphEdge('extreme', 'e', 'f', { weight: 100 }),
      graphEdge('zero', 'a', 'c', { weight: 0 }),
    ],
  });
  const analysis = analyzeGraphTopologyV1(document);
  const one = analysis.pairs.find((pair) => pair.edgeIds.includes('one'))!;
  const negative = analysis.pairs.find((pair) => pair.edgeIds.includes('negative'))!;
  const extreme = analysis.pairs.find((pair) => pair.edgeIds.includes('extreme'))!;
  const zero = analysis.pairs.find((pair) => pair.edgeIds.includes('zero'))!;
  equal(negative.evidenceMass, 5, 'physical evidence should use supplied weight magnitude');
  equal(zero.affinity, 0, 'zero evidence should create no physical affinity');
  assert(negative.affinity >= one.affinity, 'greater evidence should not lower affinity in otherwise sparse pairs');
  assert(extreme.affinity <= 2.5, 'extreme evidence should remain within the published maximum');
  assert(extreme.affinity < one.affinity * 100, 'raw weight must not become a linear spring multiplier');
});

test('A-COMPONENT-01 includes generic region connections and packs deterministically', () => {
  const document = graphDocument({
    nodes: ['a', 'b', 'c', 'd'].map((id) => graphNode(id)),
    edges: [graphEdge('a-b', 'a', 'b')],
  });
  const analysis = analyzeGraphTopologyV1(document, [{ sourceId: 'c', targetId: 'd' }]);
  deepEqual(analysis.components.map((component) => component.nodeIds), [['a', 'b'], ['c', 'd']], 'active region relationships should join force components generically');
  const targets = buildComponentPackingTargetsV1(analysis.components, 120, 80, '2d');
  deepEqual(targets.get('a'), { x: 0, y: 0, z: 0 }, 'the largest deterministic component should anchor the collection');
  assert(Math.hypot(targets.get('c')!.x, targets.get('c')!.y) > 0, 'another component should receive a separate packing target');
  deepEqual([...targets], [...buildComponentPackingTargetsV1(analysis.components, 120, 80, '2d')], 'packing targets should be deterministic');
});

test('R-REGION-01 shares one bounded pair-level attraction budget', () => {
  assert(Math.abs(coordinateWeightedSpringStrengthV1(0.25, 0.18) - 0.07) < 1e-12, 'membership attraction should consume the ordinary pair budget');
  equal(coordinateWeightedSpringStrengthV1(0.1, 0.18), 0, 'membership attraction should be able to consume the complete weaker ordinary budget');
  equal(coordinateWeightedSpringStrengthV1(0.25, 0), 0.25, 'unrelated ordinary pairs should retain their complete strength');
});

test('L-SPRING-01 maps affinity to bounded length and stiffness', () => {
  const settings = readForceSettings({});
  const weak = deriveWeightedSpringParametersV1({ affinity: 0.2 }, settings);
  const ordinary = deriveWeightedSpringParametersV1({ affinity: 1 }, settings);
  const strong = deriveWeightedSpringParametersV1({ affinity: 2.5 }, settings);
  assert(weak.strength < ordinary.strength && ordinary.strength < strong.strength, 'stronger affinity should create a stiffer spring');
  assert(weak.targetLength > ordinary.targetLength && ordinary.targetLength > strong.targetLength, 'stronger affinity should create a shorter spring');
  equal(ordinary.targetLength, 250, 'ordinary affinity should retain the native-motion baseline');
  assert(strong.targetLength >= 137.5 && weak.targetLength <= 462.5, 'default length mapping should remain in its characterized bounds');
});

test('S-ANALYSIS-01 topology analysis is event-driven rather than frame-driven', () => {
  const document = graphDocument({
    nodes: [graphNode('a'), graphNode('b')],
    edges: [graphEdge('a-b', 'a', 'b')],
  });
  const positions = { a: { x: -100, y: 0, z: 0 }, b: { x: 100, y: 0, z: 0 } };
  const selection = { nodeIds: new Set(['a', 'b']), edgeIds: new Set(['a-b']) };
  const viewState = {
    schemaVersion: 1 as const,
    documentId: document.documentId,
    documentRevision: document.revision,
    consumerId: 'neutral',
    profileId: 'default',
    dimensions: '2d' as const,
    positions,
    pinnedNodeIds: [],
    camera: {
      position: { x: 0, y: 0, z: 10 },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      zoom: 1,
      projection: 'orthographic' as const,
    },
    selectedNodeIds: [],
    activeFilters: {},
    moduleState: {},
  };
  let state: GraphModulePipelineStateV1 = {
    sourceDocument: document,
    document,
    viewState,
    positions,
    projectionSelection: selection,
    renderSelection: selection,
    formActive: false,
    nodeContributions: {},
    edgeContributions: {},
    regionLayouts: [],
    regionContributions: [],
    theme: DEFAULT_GRAPH_RENDER_THEME_V1,
  };
  const force = new ForceLayoutModule('2d', readForceSettings({ repulsionStrength: 0, centeringStrength: 0 }));
  const first = force.tick(state, 1 / 60);
  if (first?.positions) state = { ...state, positions: first.positions };
  for (let frame = 0; frame < 20; frame += 1) {
    const next = force.tick(state, 1 / 60);
    if (next?.positions) state = { ...state, positions: next.positions };
  }
  equal(force.getDiagnostics().topologyAnalysisCount, 1, 'unchanged frames should reuse the private topology index');
  equal(force.getDiagnostics().physicalSpringCount, 1, 'diagnostics should report aggregated physical pairs rather than canonical-edge loops');
  const replacement = { ...document, nodes: [...document.nodes], edges: [...document.edges] };
  force.tick({ ...state, sourceDocument: replacement, document: replacement }, 1 / 60);
  equal(force.getDiagnostics().topologyAnalysisCount, 2, 'a new accepted projection object should invalidate analysis once even at the same revision');
  force.dispose();
});

test('R-DRAG-01 active node drag keeps the force layout responsive until release', () => {
  const document = graphDocument({
    nodes: [graphNode('a'), graphNode('b')],
    edges: [graphEdge('a-b', 'a', 'b')],
  });
  const positions = { a: { x: -60, y: 0, z: 0 }, b: { x: 60, y: 0, z: 0 } };
  const selection = { nodeIds: new Set(['a', 'b']), edgeIds: new Set(['a-b']) };
  const viewState = {
    schemaVersion: 1 as const,
    documentId: document.documentId,
    documentRevision: document.revision,
    consumerId: 'neutral',
    profileId: 'default',
    dimensions: '2d' as const,
    positions,
    pinnedNodeIds: ['a'],
    camera: {
      position: { x: 0, y: 0, z: 10 },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      zoom: 1,
      projection: 'orthographic' as const,
    },
    selectedNodeIds: [],
    activeFilters: {},
    moduleState: {},
  };
  let state: GraphModulePipelineStateV1 = {
    sourceDocument: document,
    document,
    viewState,
    positions,
    projectionSelection: selection,
    renderSelection: selection,
    formActive: false,
    draggedNodeId: 'a',
    nodeContributions: {},
    edgeContributions: {},
    regionLayouts: [],
    regionContributions: [],
    theme: DEFAULT_GRAPH_RENDER_THEME_V1,
  };
  const force = new ForceLayoutModule('2d', readForceSettings({
    repulsionStrength: 0,
    centeringStrength: 0,
    alphaDecay: 0.5,
  }));
  for (let frame = 0; frame < 100; frame += 1) {
    const next = force.tick(state, 1 / 60);
    if (next?.positions) state = { ...state, positions: next.positions };
  }
  const held = force.getDiagnostics();
  equal(held.running, true, 'a held drag should prevent force settlement');
  assert(held.alpha >= 0.3, 'a held drag should retain the native interaction heat floor');

  force.tick({ ...state, draggedNodeId: undefined }, 1 / 60);
  const released = force.getDiagnostics();
  equal(released.running, true, 'release should begin the ordinary native cooling lifecycle');
  assert(released.alpha < held.alpha, 'a released layout should immediately begin cooling');
  force.dispose();
});
