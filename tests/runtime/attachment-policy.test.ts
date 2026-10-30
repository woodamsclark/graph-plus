import type { GraphDocumentV1, GraphNodeAttachmentV1, GraphPatchOperationV1, GraphDimensionsV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import { GraphAttachmentAssignmentErrorV1, graphAttachmentRotation2DV1, isGraphNodeAttachmentV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import { GRAPH_PLUS_CONSUMER_REGISTRATION_V1 } from '../../src/graph-plus/consumer/GraphPlusRegistration.ts';
import { graphDocument, graphNode, graphEdge } from '../support/contractFixtures.ts';
import { runtimeHarness } from '../support/runtimeHarness.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

const inert = { repulsionStrength: 0, springStrength: 0, centeringStrength: 0, collisionRadius: 0, alphaDecay: 0, velocityDecay: 0.4 };
const enabled = (assignment: 'loose' | 'strict' = 'loose', count = 6): GraphNodeAttachmentV1 => ({
  enabled: true, assignment, count, rigidity: 'locked', orientation: { mode: 'locked', rotation: graphAttachmentRotation2DV1(0) },
});

function graph(pattern: GraphNodeAttachmentV1, requests: readonly (number | null | undefined)[] = [0, 2, 5]): GraphDocumentV1 {
  return graphDocument({ documentId: 'policy-graph', nodes: [graphNode('hub', { attachment: pattern, positionHint: { x: 0, y: 0, z: 0 } }),
    ...requests.map((_, i) => graphNode(`n${i}`, { positionHint: { x: 100 + i * 20, y: i * 20, z: i * 10 } }))],
    edges: requests.map((slot, i) => graphEdge(`e${i}`, 'hub', `n${i}`, slot === undefined ? {} : { attachment: { sourceSlot: slot } })),
  });
}

async function setup(dimensions: GraphDimensionsV1, forceEnabled = true, document = graph(enabled())) {
  const value = runtimeHarness({ consumerId: 'graph-plus', profileId: 'default', registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1, document });
  value.profiles.setUserOverrides('graph-plus', 'default', { dimensions,
    profileSettings: { initialPositionStrategy: 'source-hints' },
    modules: { 'force-layout': { enabled: forceEnabled, settings: inert }, anima: { settings: { cursorGravity: 'off' } } },
  });
  const session = await value.create();
  const advance = () => { value.platform.advanceTime(20); value.platform.flushTimer(); value.platform.flushFrame(value.platform.now()); };
  advance(); advance();
  const patch = async (operations: GraphPatchOperationV1[]) => {
    const current = await session.exportDocument();
    return session.patchGraph({ schemaVersion: 1, patchId: `edit-${current.revision}`, baseRevision: current.revision, operations });
  };
  return { ...value, session, advance, patch };
}

test('attachment flags validate, default to disabled and retain authored policy by value', async () => {
  for (const pattern of [{}, { enabled: true }, { enabled: false, assignment: 'strict' }, { enabled: true, assignment: 'loose' }]) assert(isGraphNodeAttachmentV1(pattern), 'valid enable/policy options');
  for (const pattern of [{ enabled: 'yes' }, { enabled: null }, { assignment: 'best-effort' }, { assignment: null }]) equal(isGraphNodeAttachmentV1(pattern), false, 'invalid policy is rejected');
  for (const dimensions of ['2d', '3d'] as const) {
    const disabled = { ...enabled('strict'), enabled: undefined };
    const value = await setup(dimensions, true, graph(disabled));
    try {
      const before = await value.session.exportWorldState();
      value.advance(); value.advance();
      deepEqual((await value.session.exportWorldState()).positions, before.positions, 'count and locks alone do not enable attachments');
      const exported = await value.session.exportDocument();
      deepEqual(exported.nodes[0].attachment, disabled, 'export does not inject enabled defaults');
      assert(!JSON.stringify(before.layoutModuleState).includes('"owners"'), 'disabled node allocates no slot state');
    } finally { await value.session.dispose(); }
  }
});

test('loose is the enabled default and accepts overflow and invalid-index connections', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = await setup(dimensions);
    try {
      const pattern = { ...enabled(), count: 2, assignment: undefined };
      const result = await value.session.setGraph(graph(pattern, [0, 0, 9]));
      assert(result.applied, 'loose fallback accepts a graph even when no point is available');
      value.advance(); value.advance();
      equal((await value.session.exportDocument()).edges.length, 3, 'connections remain in graph');
      const state = await value.session.exportWorldState();
      const serialized = JSON.stringify(state.layoutModuleState);
      assert(serialized.includes('occupied') && serialized.includes('out-of-range'), 'fallback assignments remain inspectable');
    } finally { await value.session.dispose(); }
  }
});

test('strict graph replacement returns detailed failure and leaves graph, world and revisions untouched', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = await setup(dimensions);
    try {
      const before = await value.session.exportDocument(), world = await value.session.exportWorldState();
      let graphEvents = 0, worldEvents = 0;
      value.session.onGraphChanged(() => graphEvents++); value.session.onWorldChanged(() => worldEvents++);
      const result = await value.session.setGraph(graph(enabled('strict'), [0, 0]));
      assert(!result.applied && result.error.code === 'attachment-assignment', 'strict failure is returned, not silently saved');
      const failure = result.error.attachmentFailures?.[0];
      equal(failure?.edgeId, 'e1', 'failure identifies edge'); equal(failure?.ownerId, 'hub', 'failure identifies owner');
      equal(failure?.endpoint, 'source', 'failure identifies endpoint'); equal(failure?.requestedSlot, 0, 'failure identifies requested point'); equal(failure?.reason, 'occupied', 'failure identifies conflict');
      deepEqual(await value.session.exportDocument(), before, 'document is unchanged');
      deepEqual(await value.session.exportWorldState(), world, 'physics and pins are unchanged');
      equal(graphEvents, 0, 'rejected update emits no graph commit'); equal(worldEvents, 0, 'rejected update emits no world commit');
    } finally { await value.session.dispose(); }
  }
});

test('strict capacity shrink fails atomically while loose shrink retains an unbound connection', async () => {
  for (const dimensions of ['2d', '3d'] as const) for (const assignment of ['strict', 'loose'] as const) {
    const value = await setup(dimensions, true, graph(enabled(assignment)));
    try {
      const before = await value.session.exportDocument(); const hub = before.nodes[0];
      const result = await value.patch([{ type: 'replace-node', node: { ...hub, attachment: { ...hub.attachment, count: 4 } } }]);
      equal(result.applied, assignment === 'loose', 'node policy determines shrink outcome');
      const after = await value.session.exportDocument();
      if (!result.applied) {
        equal(result.error.code, 'attachment-assignment', 'shrink returns attachment failure');
        equal(result.error.attachmentFailures?.find(f => f.edgeId === 'e2')?.reason, 'out-of-range', 'invalidated slot is reported');
        deepEqual(after, before, 'failed shrink preserves complete graph');
      } else {
        equal(after.nodes[0].attachment?.count, 4, 'loose shrink changes capacity'); equal(after.edges.length, 3, 'loose shrink keeps connections');
      }
    } finally { await value.session.dispose(); }
  }
});

test('strict shrink and edge reassignment succeed together as one atomic graph patch', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = await setup(dimensions, true, graph(enabled('strict')));
    try {
      const document = await value.session.exportDocument(), hub = document.nodes[0], edge = document.edges[2];
      const result = await value.patch([
        { type: 'replace-node', node: { ...hub, attachment: { ...hub.attachment, count: 4 } } },
        { type: 'replace-edge', edge: { ...edge, attachment: { sourceSlot: 3 } } },
      ]);
      assert(result.applied, 'entire candidate graph is checked rather than transient intermediate operations');
      value.advance(); value.advance();
      const after = await value.session.exportDocument();
      equal(after.nodes[0].attachment?.count, 4, 'smaller capacity commits'); equal(after.edges[2].attachment?.sourceSlot, 3, 'new valid index commits');
    } finally { await value.session.dispose(); }
  }
});

test('strict automatic allocation checks capacity; parallel links share compatible physical occupancy', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = await setup(dimensions);
    try {
      const overflow = await value.session.setGraph(graph(enabled('strict', 2), [undefined, undefined, undefined]));
      assert(!overflow.applied && overflow.error.attachmentFailures?.some(f => f.reason === 'occupied'), 'automatic overflow returns failure');
      const document = graph(enabled('strict'), [0]);
      const parallel = { ...document, edges: [...document.edges, { ...document.edges[0], id: 'parallel' }] };
      assert((await value.session.setGraph(parallel)).applied, 'compatible parallel links share one point');
      const conflict = await value.patch([{ type: 'replace-edge', edge: { ...parallel.edges[1], attachment: { sourceSlot: 1 } } }]);
      assert(!conflict.applied && conflict.error.attachmentFailures?.some(f => f.reason === 'conflicting'), 'parallel conflict is explicit');
    } finally { await value.session.dispose(); }
  }
});

test('strict null, inactive patterns and missing layout return clear assignment failures', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = await setup(dimensions);
    try {
      for (const [pattern, request, reason] of [
        [enabled('strict'), null, 'free'], [enabled('strict', 1), 0, 'inactive'],
        [{ ...enabled('strict'), rigidity: 'spring' as const, stiffness: 'off' as const }, 0, 'inactive'],
      ] as const) {
        const result = await value.session.setGraph(graph(pattern, [request]));
        assert(!result.applied && result.error.attachmentFailures?.[0].reason === reason, `${reason} is reported`);
      }
      assert((await value.session.setGraph(graph({ ...enabled('strict'), enabled: false }, [null]))).applied, 'disabled feature ignores strict policy');
    } finally { await value.session.dispose(); }
    const unavailable = await setup(dimensions, false, graph({ enabled: false }));
    try {
      const result = await unavailable.session.setGraph(graph(enabled('strict'), [0]));
      assert(!result.applied && result.error.attachmentFailures?.[0].reason === 'layout-unavailable', 'missing force module is explicit');
    } finally { await unavailable.session.dispose(); }
  }
});

test('strict geometry conflict returns failure and cannot move pinned nodes during validation', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = await setup(dimensions);
    try {
      await value.session.setNodePinned('hub', true); await value.session.setNodePinned('n0', true);
      const before = await value.session.exportWorldState(), document = await value.session.exportDocument();
      const result = await value.patch([
        { type: 'replace-node', node: { ...document.nodes[0], attachment: enabled('strict') } },
        { type: 'replace-node', node: { ...document.nodes[1], attachment: enabled('strict') } },
        { type: 'replace-edge', edge: { ...document.edges[0], attachment: { sourceSlot: 0, targetSlot: 0 } } },
      ]);
      assert(!result.applied && result.error.attachmentFailures?.some(f => f.reason === 'unbound'), 'incompatible fixed endpoints fail');
      deepEqual(await value.session.exportWorldState(), before, 'validation does not patch solver coordinates or pins');
    } finally { await value.session.dispose(); }
  }
});

test('strict policy is per endpoint owner and disabling it restores loose acceptance', async () => {
  const value = await setup('3d', true, graph(enabled('strict'), [0]));
  try {
    const document = await value.session.exportDocument();
    const result = await value.patch([{ type: 'replace-node', node: { ...document.nodes[0], attachment: { ...document.nodes[0].attachment, enabled: false } } },
      { type: 'add-edge', edge: graphEdge('free-duplicate', 'hub', 'n0', { attachment: { sourceSlot: 99 } }) }]);
    assert(result.applied, 'disabled owner does not demand a slot');
    value.advance(); value.advance();
    const state = await value.session.exportWorldState();
    assert(!JSON.stringify(state.layoutModuleState).includes('"owners"'), 'disabling releases old bindings');
  } finally { await value.session.dispose(); }
});

test('setGraph and patchGraph retain existing validation and compatibility methods', async () => {
  const value = await setup('2d');
  try {
    const before = await value.session.exportDocument();
    const invalid = await value.session.setGraph({ ...before, nodes: [graphNode('hub', { attachment: { enabled: 'yes' } as unknown as GraphNodeAttachmentV1 })] });
    assert(!invalid.applied && invalid.error.code === 'invalid-document', 'setGraph returns schema failure');
    deepEqual(await value.session.exportDocument(), before, 'invalid replacement is atomic');
    const stale = await value.session.patchGraph({ schemaVersion: 1, patchId: 'stale', baseRevision: 9999, operations: [{ type: 'add-node', node: graphNode('stale-node') }] });
    assert(!stale.applied && stale.error.code === 'stale-revision', 'patchGraph retains revision safety');
    assert((await value.patch([{ type: 'add-node', node: graphNode('extra') }])).applied, 'patchGraph updates real graph');
    await value.session.replaceDocument(before);
    const legacy = await value.session.applyPatch({ schemaVersion: 1, patchId: 'old-name', baseRevision: before.revision, operations: [{ type: 'add-node', node: graphNode('legacy') }] });
    assert(legacy.applied, 'old names remain operational');
    let caught: unknown;
    try { await value.session.replaceDocument(graph(enabled('strict'), [0, 0])); } catch (error) { caught = error; }
    assert(caught instanceof GraphAttachmentAssignmentErrorV1, 'legacy replacement throws typed strict failure');
  } finally { await value.session.dispose(); }
});

test('initial strict session admission fails without registering a partial session', async () => {
  const value = runtimeHarness({ consumerId: 'graph-plus', profileId: 'default', registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1, document: graph(enabled('strict'), [0, 0]) });
  let caught: unknown;
  try { await value.create(); } catch (error) { caught = error; }
  assert(caught instanceof GraphAttachmentAssignmentErrorV1, 'initial graph receives same strict admission');
  equal(value.factory.getDiagnostics().activeSessionCount, 0, 'failed creation leaves no active session');
});

test('strict runtime loss reports a recoverable failure once instead of silently falling back', async () => {
  const pattern = { ...enabled('strict'), rigidity: 'spring' as const };
  const value = await setup('3d', true, graph(pattern, [undefined]));
  try {
    const failures: { code: string; edgeId?: string; recoverable: boolean }[] = [];
    value.session.onError(error => failures.push({ code: error.code, edgeId: error.attachmentFailures?.[0].edgeId, recoverable: error.recoverable }));
    const before = await value.session.exportViewState();
    await value.session.restoreViewState({ ...before, positions: { ...before.positions, n0: { x: 70, y: 0, z: 70 } } });
    for (let i = 0; i < 6; i++) value.advance();
    equal(failures.filter(error => error.code === 'attachment-assignment').length, 1, 'unchanged conflict is not emitted every frame');
    equal(failures[0]?.edgeId, 'e0', 'runtime failure identifies endpoint'); equal(failures[0]?.recoverable, true, 'consumer may resolve conflict');
    await value.session.restoreViewState(before); value.advance(); value.advance();
    await value.session.restoreViewState({ ...before, positions: { ...before.positions, n0: { x: 70, y: 0, z: 70 } } });
    value.advance(); value.advance();
    equal(failures.filter(error => error.code === 'attachment-assignment').length, 2, 'recovery rearms a later identical conflict');
  } finally { await value.session.dispose(); }
});

test('concurrent graph replacements report the revision of their own successful update', async () => {
  const value = await setup('3d');
  try {
    const [first, second] = await Promise.all([
      value.session.setGraph({ ...graph(enabled()), revision: 7 }),
      value.session.setGraph({ ...graph(enabled()), revision: 9 }),
    ]);
    assert(first.applied && second.applied, 'both complete replacements succeed');
    equal(first.revision, 7, 'first result identifies its own graph revision');
    equal(second.revision, 9, 'second result identifies its own graph revision');
  } finally { await value.session.dispose(); }
});
