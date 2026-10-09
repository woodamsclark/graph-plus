import { compileAnimaPickFrame } from '../../src/graph-engine/runtime/anima/AnimaSceneCompiler.ts';
import { SessionProjectionCoordinator } from '../../src/graph-engine/runtime/session/SessionProjectionCoordinator.ts';
import { Consciousness } from '../../src/graph-engine/runtime/consciousness/index.ts';
import type { GraphModuleHost, GraphModulePresentationStateV1 } from '../../src/graph-engine/runtime/modules/index.ts';
import type { GraphInteractionPreviewV1 } from '../../src/graph-engine/runtime/anima/AnimaInteractionPreview.ts';
import type { GraphViewStateV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import { DEFAULT_GRAPH_RENDER_THEME_V1, DEFAULT_GRAPH_PRESENTATION_POLICY_V2 } from '../../src/graph-engine/runtime/render/index.ts';
import { graphDocument, graphNode, graphEdge } from '../support/contractFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

function pipelineFixture(dimensions: '2d' | '3d', animated = true) {
  const document = graphDocument({ nodes: ['a', 'b', 'outside'].map(id => graphNode(id)), edges: [graphEdge('ab', 'a', 'b')] });
  const viewState: GraphViewStateV1 = { schemaVersion: 1, documentId: document.documentId, documentRevision: 0,
    consumerId: 'synthetic-consumer', profileId: 'two-dimensional', dimensions,
    positions: { a: { x: 0, y: 0, z: 0 }, b: { x: 100, y: 0, z: dimensions === '3d' ? 40 : 0 }, outside: { x: 500, y: 0, z: 0 } },
    pinnedNodeIds: [], selectedNodeIds: [], viewMode: 'overview', activeFilters: {}, moduleState: {},
    camera: { position: { x: 0, y: 0, z: 1000 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 },
      zoom: 1, projection: dimensions === '2d' ? 'orthographic' : 'perspective' } };
  const selection = { nodeIds: new Set(['a', 'b', 'outside']), edgeIds: new Set(['ab']) };
  const calls: { preview: GraphInteractionPreviewV1 | null | undefined; hoveredNodeId: string | undefined }[] = [];
  const host = { has: () => animated, contribute: (state: GraphModulePresentationStateV1) => {
    calls.push({ preview: state.objectActivationPreview, hoveredNodeId: state.hoveredNodeId });
    return { ...state, nodeContributions: { b: { labelFontSize: state.objectActivationPreview ? 32 : 8 }, outside: { opacity: 0.1 } } };
  } } as unknown as GraphModuleHost;
  let compositions = 0;
  const coordinator = new SessionProjectionCoordinator(() => {}, () => { compositions += 1; });
  const options: Parameters<SessionProjectionCoordinator['compose']>[0] = { host, consciousness: new Consciousness(), viewState,
    projectionView: { sourceDocument: document, document, viewState, positions: viewState.positions,
      projectionSelection: selection, renderSelection: selection, formActive: false,
      nodeRoles: {}, edgeRoles: {}, regions: [], regionLayouts: [] },
    theme: DEFAULT_GRAPH_RENDER_THEME_V1, presentationPolicy: DEFAULT_GRAPH_PRESENTATION_POLICY_V2,
    now: 0, invalidation: 'presentation' };
  return { coordinator, options, calls, compositions: () => compositions };
}

function primary(nodeId: string): GraphInteractionPreviewV1 {
  return { kind: 'objects', activation: 'primary', addedNodeIds: [nodeId], removedNodeIds: [], hoverPathNodeIds: [] };
}

test('composition reconciles Attention before preview planning and compiles contributed visuals without a preview', () => {
  for (const dimensions of ['2d', '3d'] as const) for (const animated of [false, true]) {
    const value = pipelineFixture(dimensions, animated);
    const options = { ...value.options, viewState: { ...value.options.viewState, selectedNodeIds: ['a'], viewMode: 'explore' as const },
      resolveObjectActivationPreview: () => {
        deepEqual([...value.options.consciousness.attention.nodeIds], ['a'], 'preview planning sees reconciled committed Attention');
        return null;
      } };
    const result = value.coordinator.compose(options);
    equal(value.calls.length, 1, 'no-preview composition contributes one baseline');
    equal(value.compositions(), 1, 'one outer composition is recorded');
    equal(value.coordinator.frames.get()!.nodes.length, value.coordinator.committedPickState.get()!.nodes.length, 'ordinary picking retains the baseline membership');
    equal(result.nodeContributions.outside.opacity, 0.1, 'the returned module presentation retains contributed values');
    equal(value.coordinator.frames.get()!.nodes.find(node => node.id === 'outside')!.opacity, 0.1, 'scene compilation consumes module opacity');
  }
});

test('composition crossfades reuse target presentation while visible and committed geometry stay live', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = pipelineFixture(dimensions);
    let options = { ...value.options, hoveredNodeId: 'a', resolveObjectActivationPreview: () => primary('a') };
    value.coordinator.compose(options);
    equal(value.calls.length, 1, 'entry delay compiles only the baseline');
    value.coordinator.compose({ ...options, now: 450 });
    equal(value.calls.length, 3, 'partial fade compiles one baseline and one target');
    options = { ...options, hoveredNodeId: 'b', resolveObjectActivationPreview: () => primary('b') };
    value.coordinator.compose({ ...options, now: 460 });
    equal(value.calls.length, 4, 'leaving target is cached while the new visit waits');
    const positions = { ...options.viewState.positions, a: { x: 20, y: 30, z: dimensions === '3d' ? 60 : 0 } };
    const moving = { ...options, now: 710, invalidation: 'geometry' as const,
      viewState: { ...options.viewState, positions }, projectionView: { ...options.projectionView, positions } };
    value.coordinator.compose(moving);
    equal(value.calls.length, 6, 'crossfade compiles the new target once alongside a baseline');
    value.coordinator.compose({ ...moving, now: 1160 });
    equal(value.calls.length, 7, 'terminal fade reuses its target');
    deepEqual(value.coordinator.frames.get()!.nodes.find(node => node.id === 'a')!.position, positions.a, 'cached targets never replace live visible positions');
    deepEqual(value.coordinator.committedPickState.get()!.nodes.find(node => node.id === 'a')!.position, positions.a, 'committed fallback follows live geometry');
    equal(value.coordinator.frames.get()!.geometryRevision, value.coordinator.committedPickState.get()!.geometryRevision, 'blended and committed frames use the same geometry revision');
    equal(value.coordinator.nextPreviewFrameDelayMs(1160), undefined, 'terminal preview leaves no animation wake');
    deepEqual(options.viewState.selectedNodeIds, [], 'composition never commits preview membership');
  }
});

test('Focus hover reveals its label immediately while committed fallback keeps baseline hover semantics', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = pipelineFixture(dimensions);
    const options = { ...value.options, viewState: { ...value.options.viewState, viewMode: 'focus' as const, focusedNodeId: 'a', selectedNodeIds: ['a'] },
      hoveredNodeId: 'b', resolveObjectActivationPreview: () => primary('b') };
    value.coordinator.compose(options);
    equal(value.calls[0].hoveredNodeId, undefined, 'Focus baseline excludes the prospective hovered root');
    const visible = value.coordinator.frames.get()!.nodes.find(node => node.id === 'b')!;
    equal(visible.showLabel, true, 'Focus label reveal precedes target compilation');
    equal(visible.labelAlwaysVisible, true, 'the immediate label is explicitly admitted');
    assert(visible.labelFontSize >= 12, 'immediate label remains readable');
    value.coordinator.compose({ ...options, now: 700, previewCommitted: true });
    equal(value.calls.length, 3, 'committed preview samples one baseline and one terminal target');
    equal(value.calls[1].hoveredNodeId, undefined, 'committed fallback retains baseline hover semantics');
    equal(value.calls[2].hoveredNodeId, 'b', 'target compilation retains its own hovered subject');
    equal(value.coordinator.nextPreviewFrameDelayMs(700), undefined, 'committed terminal presentation sleeps');
    deepEqual(options.viewState.selectedNodeIds, ['a'], 'rendering a committed presentation flag does not mutate View');
  }
});

test('removal and toggle previews compile immediately and reset prior animation while retaining a separate committed frame', () => {
  for (const activation of ['remove-membership', 'toggle-membership'] as const) {
    const value = pipelineFixture('2d');
    const options = { ...value.options, hoveredNodeId: 'a', resolveObjectActivationPreview: () => primary('a') };
    value.coordinator.compose(options); value.coordinator.compose({ ...options, now: 450 });
    const before = value.calls.length;
    const preview: GraphInteractionPreviewV1 = { kind: 'objects', activation, addedNodeIds: [], removedNodeIds: ['a'], hoverPathNodeIds: [] };
    value.coordinator.compose({ ...options, now: 460, resolveObjectActivationPreview: () => preview });
    equal(value.calls.length - before, 2, 'immediate preview compiles visible and committed inputs separately');
    equal(value.calls[before].preview, preview, 'the visible compile uses the immediate preview');
    equal(value.calls[before + 1].preview, null, 'fallback compile uses committed presentation');
    assert(value.coordinator.frames.get() !== value.coordinator.committedPickState.get(), 'the immediate presentation keeps its committed fallback');
    equal(value.coordinator.nextPreviewFrameDelayMs(460), undefined, 'immediate preview cancels old fade work');
    value.coordinator.clear();
    equal(value.coordinator.frames.get(), null, 'clear releases the visible frame');
    equal(value.coordinator.committedPickState.get(), null, 'clear releases the committed frame');
  }
});


test('geometry-only composition reuses dressing, Consciousness and compilation for stable shipped semantics', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = pipelineFixture(dimensions);
    value.options.host.canReuseGeometryPresentation = () => true;
    const nodes = Array.from({ length: 1200 }, (_, i) => graphNode(`n${i}`));
    const document = graphDocument({ nodes, edges: [] });
    const positions = Object.fromEntries(nodes.map((node, i) => [node.id, { x: i, y: 0, z: 0 }]));
    const selection = { nodeIds: new Set(nodes.map(node => node.id)), edgeIds: new Set<string>() };
    const initial = { ...value.options, projectionView: { ...value.options.projectionView, document, positions, renderSelection: selection } };
    value.coordinator.compose(initial);
    const before = value.coordinator.getDiagnostics();
    for (let i = 0; i < 20; i++) {
      positions.n0 = { x: i + 1, y: i, z: dimensions === '3d' ? i : 0 };
      value.coordinator.compose({ ...initial, invalidation: 'geometry', now: i * 20 });
    }
    const after = value.coordinator.getDiagnostics();
    equal(after.geometryRefreshes - before.geometryRefreshes, 20, 'all moving frames refresh only geometry');
    for (const field of ['modulePresentationContributions', 'consciousnessReconciliations', 'animaSemanticResolves', 'animusSnapshots', 'fullSceneCompiles'] as const) {
      equal(after[field], before[field], `${field} remains unchanged through 20 moving frames`);
    }
    deepEqual(value.coordinator.frames.get()!.nodes[0].position, positions.n0, 'visible geometry tracks replacement position entries');
    deepEqual(value.coordinator.committedPickState.get()!.nodes[0].position, positions.n0, 'fallback geometry tracks replacement position entries');
    const reused = value.coordinator.frames.get();
    value.coordinator.compose({ ...initial, invalidation: 'presentation', now: 400 });
    deepEqual(value.coordinator.frames.get(), reused, 'fresh compilation matches the reused frame exactly');
  }
});

test('geometry reuse expires for changed hover, pins, Memory and content; unknown module dressing remains conservative', () => {
  const value = pipelineFixture('2d');
  value.options.host.canReuseGeometryPresentation = () => true;
  value.coordinator.compose(value.options);
  let options: Parameters<SessionProjectionCoordinator['compose']>[0] = { ...value.options, invalidation: 'geometry' };
  value.coordinator.compose(options);
  equal(value.calls.length, 1, 'stable geometry reuses the baseline');
  options = { ...options, hoveredNodeId: 'b' };
  value.coordinator.compose(options);
  equal(value.calls.length, 2, 'hover changes redress the baseline');
  options = { ...options, viewState: { ...options.viewState, pinnedNodeIds: ['a'] } };
  value.coordinator.compose(options);
  equal(value.calls.length, 3, 'pin changes redress the baseline');
  options.consciousness.receiveExogenous({ source: 'exogenous', type: 'replace-remembered-subjects', nodeIds: ['a'] },
    { availableNodeIds: options.projectionView.renderSelection.nodeIds });
  value.coordinator.compose(options);
  equal(value.calls.length, 4, 'Memory changes redress the baseline');
  value.coordinator.compose({ ...options, invalidation: 'content' });
  equal(value.calls.length, 5, 'content always rebuilds');
  options.host.canReuseGeometryPresentation = () => false;
  value.coordinator.compose(options);
  equal(value.calls.length, 6, 'unclassified module contributions run on geometry');
});


test('committed fallback retains only picking fields and compiles no extra drawing scene for immediate previews', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = pipelineFixture(dimensions);
    const baseline = value.coordinator.compose(value.options);
    const visible = value.coordinator.frames.get()!;
    const minimal = compileAnimaPickFrame(baseline, visible.geometryRevision!);
    deepEqual(minimal.nodes, visible.nodes.map(({ id, position, radius, opacity, nodeScaleExponent }) =>
      ({ id, position, radius, opacity, nodeScaleExponent })), 'compact compilation preserves every hit-shape field');
    const before = value.coordinator.getDiagnostics();
    value.coordinator.compose({ ...value.options, resolveObjectActivationPreview: () => ({
      kind: 'objects', activation: 'remove-membership', addedNodeIds: [], removedNodeIds: ['a'], hoverPathNodeIds: [] }) });
    const after = value.coordinator.getDiagnostics();
    equal(after.fullSceneCompiles - before.fullSceneCompiles, 1, 'only the visible scene compiles drawing records');
    equal(after.pickGeometryCompiles - before.pickGeometryCompiles, 1, 'fallback compiles only hit shapes');
    const committed = value.coordinator.committedPickState.get()!;
    assert(!('edges' in committed) && !('regions' in committed) && !('labelFont' in committed), 'fallback retains no drawing collections');
    assert(committed.nodes.every(node => !('label' in node) && !('finalColor' in node)), 'fallback nodes retain no labels or colors');
  }
});
