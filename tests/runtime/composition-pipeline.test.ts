import { SessionProjectionCoordinatorV1 } from '../../src/graph-engine/runtime/session/SessionProjectionCoordinator.ts';
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
  const coordinator = new SessionProjectionCoordinatorV1(() => {}, () => { compositions += 1; });
  const options: Parameters<SessionProjectionCoordinatorV1['compose']>[0] = { host, consciousness: new Consciousness(), viewState,
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
    equal(value.coordinator.frames.get(), value.coordinator.committedFrames.get(), 'visible and committed frames share the ordinary baseline');
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
    deepEqual(value.coordinator.committedFrames.get()!.nodes.find(node => node.id === 'a')!.position, positions.a, 'committed fallback follows live geometry');
    equal(value.coordinator.frames.get()!.geometryRevision, value.coordinator.committedFrames.get()!.geometryRevision, 'blended and committed frames use the same geometry revision');
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
    assert(value.coordinator.frames.get() !== value.coordinator.committedFrames.get(), 'the immediate presentation keeps its committed fallback');
    equal(value.coordinator.nextPreviewFrameDelayMs(460), undefined, 'immediate preview cancels old fade work');
    value.coordinator.clear();
    equal(value.coordinator.frames.get(), null, 'clear releases the visible frame');
    equal(value.coordinator.committedFrames.get(), null, 'clear releases the committed frame');
  }
});
