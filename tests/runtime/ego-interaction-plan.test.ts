import { DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1, type GraphSessionV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import { Ego } from '../../src/graph-engine/runtime/consciousness/Consciousness.ts';
import {
  isEgoInteractionPlanCurrentV1, resolveEgoInteractionPlanV1,
  type EgoInteractionContextV1, type EgoInteractionInputV1, type EgoInteractionPlanV1,
} from '../../src/graph-engine/runtime/consciousness/EgoInteractionPlan.ts';
import { presentEgoInteractionPlanV1 } from '../../src/graph-engine/runtime/anima/AnimaInteractionPreview.ts';
import { GraphCameraController } from '../../src/graph-engine/runtime/camera/index.ts';
import { graphEdge } from '../support/contractFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';
import { runtimeCanvas, runtimeHarness } from '../support/runtimeHarness.ts';

const node = (nodeId: string, ctrl = false): EgoInteractionInputV1 => ({
  phase: 'hover', target: { kind: 'node', nodeId }, modality: 'mouse',
  modifiers: { ctrl, meta: false, shift: false, alt: false },
});
const context = (): EgoInteractionContextV1 => ({
  identity: { documentId: 'intent-fixture', documentRevision: 1 },
  state: { viewId: 'explore', attentionNodeIds: ['a', 'b'] },
  experience: DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1,
  availableNodeIds: new Set(['a', 'b', 'c']), visibleNodeIds: new Set(['a', 'b', 'c']),
  visibleEdgeIds: new Set(['ab', 'bc']), awarenessNodeIds: new Set(['a', 'b']),
  getConstellation: () => ['a', 'b'],
});

test('Ego additions capture the nearest visible route for primary and Ctrl activation, without expanding removals', () => {
  const edges = [graphEdge('xy', 'x', 'y'), graphEdge('ya', 'y', 'a'),
    graphEdge('xz', 'x', 'z'), graphEdge('zb', 'z', 'b')];
  const basis: EgoInteractionContextV1 = { ...context(), edges,
    availableNodeIds: new Set(['a', 'b', 'x', 'y', 'z', 'isolated']),
    visibleNodeIds: new Set(['a', 'b', 'x', 'y', 'z', 'isolated']),
    visibleEdgeIds: new Set(edges.map((edge) => edge.id)),
  };
  for (const viewId of ['overview', 'explore', 'focus'] as const) {
    for (const ctrl of [false, true]) {
      if (viewId === 'overview' && !ctrl) continue; // Overview primary chooses a whole group instead of extending it.
      const current = { ...basis, state: { viewId, attentionNodeIds: ['a', 'b'],
        focusedNodeId: viewId === 'focus' ? 'a' : undefined } };
      const plan = resolveEgoInteractionPlanV1(node('x', ctrl), current);
      deepEqual(plan.resultingState.attentionNodeIds, ['a', 'b', 'x', 'y'], 'stable nearest route is added with the candidate');
      deepEqual(plan.constellationPathNodeIds, ['x', 'y', 'a'], 'will captures the route once');
      deepEqual(presentEgoInteractionPlanV1(plan)?.hoverPathNodeIds, ['x', 'y', 'a'], 'Ctrl and primary hover show the committed route');
      deepEqual(current.state.attentionNodeIds, ['a', 'b'], 'hover planning is noncommitting');
      equal(plan.resultingState.viewId, viewId, 'adding in Constellation stays there; Ctrl preserves its View');
      equal(plan.resultingState.focusedNodeId, viewId === 'focus' ? ctrl ? 'a' : 'x' : undefined,
        'primary Focus hops but Ctrl additions preserve the subject');
    }
  }
  const rerouted = resolveEgoInteractionPlanV1(node('x'), { ...basis, visibleEdgeIds: new Set(['xz', 'zb']) });
  deepEqual(rerouted.resultingState.attentionNodeIds, ['a', 'b', 'x', 'z'], 'filtered edges cannot be admitted through a stale path');
  const disconnected = resolveEgoInteractionPlanV1(node('isolated'), basis);
  deepEqual(disconnected.resultingState.attentionNodeIds, ['a', 'b', 'isolated'], 'disconnected additions add only the candidate');
  const remove = resolveEgoInteractionPlanV1(node('x', true), { ...basis,
    state: { viewId: 'explore', attentionNodeIds: ['a', 'b', 'x', 'y'] } });
  deepEqual(remove.resultingState.attentionNodeIds, ['a', 'b', 'y'], 'removing a node leaves its previously admitted route members');
  deepEqual(remove.constellationPathNodeIds, [], 'removal never adds a route');
});

test('Ego retains immutable will and reuses the admitted hover result for activation', () => {
  const ego = new Ego();
  const basis = context();
  const input = node('b');
  const plan = ego.resolveWill(input, basis);
  equal(ego.will, plan, 'Ego owns the current proposal');
  equal(plan.outcome, 'accepted', 'committed members can be presented');
  deepEqual(plan.resultingState, { viewId: 'focus', attentionNodeIds: ['a', 'b'], focusedNodeId: 'b' },
    'will predicts the complete resulting engagement');
  deepEqual(plan.effects, [{ type: 'clear-presentation' }, { type: 'recenter-focus', nodeId: 'b' }],
    'camera and presentation effects are described without executing');
  deepEqual(basis.state, { viewId: 'explore', attentionNodeIds: ['a', 'b'] }, 'planning does not realize state');
  assert(Object.isFrozen(plan) && Object.isFrozen(plan.input) && Object.isFrozen(plan.input.modifiers)
    && Object.isFrozen(plan.input.target) && Object.isFrozen(plan.before) && Object.isFrozen(plan.identity)
    && Object.isFrozen(plan.resultingState.attentionNodeIds) && Object.isFrozen(plan.effects)
    && plan.outcome !== 'rejected' && plan.directive.type === 'direct-attention' && Object.isFrozen(plan.directive.nodeIds), 'the retained outcome is deeply immutable');
  equal(ego.resolveWill(input, basis), plan, 'unchanged input reuses the entire plan');
  const activated = ego.resolveWill({ ...input, phase: 'activate' }, basis);
  equal(activated.input.phase, 'activate', 'the current phase reflects actual input');
  equal(activated.resultingState, plan.resultingState, 'activation consumes the same prospective result');
  equal(activated.effects, plan.effects, 'activation consumes the same prospective effects');
  deepEqual(presentEgoInteractionPlanV1(activated), {
    activation: 'primary', viewId: 'focus', attentionNodeIds: ['a', 'b'], focusedNodeId: 'b', hoverPathNodeIds: [],
  }, 'Anima expresses the admitted state');
  ego.clearWill();
  equal(ego.will, undefined, 'canceling will does not undo committed state');
});

test('Ego captures modifier intent and changes the preview without changing membership', () => {
  const ego = new Ego();
  const basis: EgoInteractionContextV1 = { ...context(), state: {
    viewId: 'focus', attentionNodeIds: ['a', 'b'], focusedNodeId: 'a',
  } };
  const primary = ego.resolveWill(node('a'), basis);
  const remove = ego.resolveWill(node('a', true), basis);
  equal(remove.action, 'remove-member', 'Ctrl proposes withdrawing Attention');
  deepEqual(remove.resultingState, { viewId: 'explore', attentionNodeIds: ['b'], focusedNodeId: undefined },
    'removing the focused subject backs out to its remaining composition');
  deepEqual(remove.effects, [{ type: 'clear-presentation' }], 'removal never recenters on a replacement');
  deepEqual(basis.state.attentionNodeIds, ['a', 'b'], 'modifier previews do not mutate Attention');
  const release = ego.resolveWill(node('a'), basis);
  deepEqual(release.resultingState, primary.resultingState, 'releasing Ctrl restores the ordinary proposal');
  const fullModifiers = { ...node('a', true), modifiers: { ctrl: true, meta: true, shift: true, alt: true } };
  equal(ego.resolveWill(fullModifiers, basis).input.modifiers.meta, true, 'all modifier facts remain captured independently');
  const dim = resolveEgoInteractionPlanV1(node('c'), context());
  deepEqual(dim.resultingState, { viewId: 'explore', attentionNodeIds: ['a', 'b', 'c'], focusedNodeId: undefined },
    'a dim candidate proposes admission rather than Focus');
  deepEqual(dim.effects, [], 'membership admission leaves framing alone');
});

test('Ego preserves rejected will and exposes adjusted results before presentation', () => {
  const ego = new Ego();
  const forbidden: EgoInteractionContextV1 = { ...context(), experience: {
    ...DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1,
    permittedInteractions: DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1.permittedInteractions.filter((id) => id !== 'direct-focus'),
  } };
  const denied = ego.resolveWill(node('b'), forbidden);
  assert(denied.outcome === 'rejected', 'Focus capability is admitted atomically');
  equal(denied.reason, 'interaction-not-permitted:direct-focus', 'rejection is inspectable');
  equal(ego.will, denied, 'rejected intent is still Ego will');
  deepEqual(denied.resultingState, denied.before, 'rejection leaves realized truth alone');
  deepEqual(denied.effects, [], 'rejection cannot perform effects');
  equal(presentEgoInteractionPlanV1(denied), undefined, 'Anima does not show an impossible outcome');
  const local = resolveEgoInteractionPlanV1(node('b'), { ...context(), state: { viewId: 'overview', attentionNodeIds: [] },
    experience: { ...DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1, allowedStates: ['focus'],
      attention: { maximumNodeCount: 1, overflow: 'preserve-intent-subject' } },
  });
  equal(local.outcome, 'adjusted', 'Focus-only experiences adjust group entry');
  deepEqual(local.resultingState, { viewId: 'focus', attentionNodeIds: ['b'], focusedNodeId: 'b' },
    'the predicted result already honors cardinality and allowed Views');
});

test('Ego plans expire with semantic context and re-evaluate the same input', () => {
  const ego = new Ego();
  const basis = context();
  const plan = ego.resolveWill(node('b'), basis);
  const changes: EgoInteractionContextV1[] = [
    { ...basis, identity: { ...basis.identity, documentRevision: 2 } },
    { ...basis, identity: { ...basis.identity, documentId: 'another-document' } },
    { ...basis, state: { ...basis.state, attentionNodeIds: ['a'] } },
    { ...basis, state: { ...basis.state, viewId: 'overview' } },
    { ...basis, state: { ...basis.state, viewId: 'focus', focusedNodeId: 'a' } },
    { ...basis, availableNodeIds: new Set(['a', 'b']) },
    { ...basis, visibleNodeIds: new Set(['a', 'b']) },
    { ...basis, visibleEdgeIds: new Set(['ab']) },
    { ...basis, awarenessNodeIds: new Set(['a']) },
    { ...basis, experience: { ...basis.experience, allowedStates: ['overview', 'explore'] } },
  ];
  for (const changed of changes) assert(!isEgoInteractionPlanCurrentV1(plan, changed), 'every semantic dependency invalidates a plan');
  assert(isEgoInteractionPlanCurrentV1(plan, { ...basis, visibleNodeIds: new Set(['c', 'b', 'a']) }),
    'set identity/order are not semantic changes');
  const changed = ego.resolveWill(node('b'), changes[2]);
  deepEqual(changed.resultingState, { viewId: 'explore', attentionNodeIds: ['a', 'b'], focusedNodeId: undefined },
    'a stale member proposal becomes admission when membership changes');
  const invisible = ego.resolveWill(node('b'), { ...basis, visibleNodeIds: new Set(['a']) });
  assert(invisible.outcome === 'rejected', 'filtered targets cannot commit stale intent');
  equal(invisible.reason, 'target-not-visible', 'projection exclusion is explicit');
});

test('Background will predicts one View back while retaining composition and framing', () => {
  const input: EgoInteractionInputV1 = { ...node('a'), target: { kind: 'background' }, modality: 'keyboard', phase: 'activate' };
  const basis = context();
  for (const [viewId, expected] of [['focus', 'explore'], ['explore', 'overview'], ['overview', 'overview']] as const) {
    const plan = resolveEgoInteractionPlanV1(input, { ...basis, state: {
      ...basis.state, viewId, focusedNodeId: viewId === 'focus' ? 'a' : undefined,
    } });
    equal(plan.action, 'back', 'background input is a back proposal');
    equal(plan.resultingState.viewId, expected, 'back crosses one seam');
    deepEqual(plan.resultingState.attentionNodeIds, ['a', 'b'], 'back retains composition');
    deepEqual(plan.effects, [{ type: 'clear-presentation' }], 'back has no camera fitting or recentering effect');
    equal(presentEgoInteractionPlanV1(plan), undefined, 'background hover does not preview stepping back');
  }
});

test('Live input previews and commits Ego will, refreshes stale membership, and clears canceled will', async () => {
  const original = Ego.prototype.resolveWill;
  let observed: Ego | undefined;
  let lastActivation: EgoInteractionPlanV1 | undefined;
  Ego.prototype.resolveWill = function (input, basis) {
    observed = this;
    const plan = original.call(this, input, basis);
    if (input.phase === 'activate') lastActivation = plan;
    return plan;
  };
  const value = runtimeHarness();
  let session: GraphSessionV1 | undefined;
  try {
    session = await value.create();
    const canvas = runtimeCanvas(value.container);
    await session.setSelection(['a', 'b']);
    const initial = await session.exportViewState();
    await session.restoreViewState({ ...initial, viewMode: 'explore',
      positions: { a: { x: -100, y: 0, z: 0 }, b: { x: 0, y: 0, z: 0 }, c: { x: 100, y: 0, z: 0 } } });
    await session.fitNodes();
    const point = async (id: string) => {
      const state = await session!.exportViewState();
      const camera = new GraphCameraController(state.camera, state.dimensions);
      camera.setViewport(640, 360);
      return camera.worldToScreen(state.positions[id]);
    };
    let at = await point('b');
    const pointer = (type: string, extra: Record<string, unknown> = {}) => {
      const fields = { clientX: at.x, clientY: at.y, pointerId: 701, pointerType: 'mouse', button: 0,
        ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra };
      const event = new value.window.PointerEvent(type, { ...fields, bubbles: true, cancelable: true });
      for (const [key, field] of Object.entries(fields)) Object.defineProperty(event, key, { value: field });
      canvas.dispatchEvent(event as unknown as Event);
      value.platform.flushFrame();
    };
    pointer('pointermove');
    const hover = observed?.will;
    assert(hover !== undefined, 'live hover captures Ego will');
    equal(hover.input.phase, 'hover', 'the proposal captures hover phase');
    equal(hover.resultingState.viewId, 'focus', 'hover predicts member Focus');
    equal((await session.exportViewState()).focusedNodeId, undefined, 'hover has no subject effect');
    pointer('pointerdown'); pointer('pointerup');
    assert(lastActivation !== undefined, 'tap resolves through the same Ego');
    equal(lastActivation.resultingState, hover.resultingState, 'tap consumes the admitted hover outcome rather than reducing state again');
    const committed = await session.exportViewState();
    deepEqual(committed.selectedNodeIds, hover.resultingState.attentionNodeIds, 'committed membership equals will');
    equal(committed.focusedNodeId, hover.resultingState.focusedNodeId, 'committed subject equals will');
    equal(session.getActiveView().id, hover.resultingState.viewId, 'committed View equals will');
    for (let i = 0; i < 12; i += 1) value.platform.flushTimer();
    value.platform.advanceTime(400);
    at = await point('b'); pointer('pointermove');
    assert(observed?.will !== undefined, 'hover after commit creates a new proposal');
    pointer('pointerleave'); equal(observed?.will, undefined, 'leave clears will');
    pointer('pointermove'); pointer('pointerdown'); pointer('pointercancel');
    equal(observed?.will, undefined, 'cancellation clears will');
    pointer('pointermove');
    session.setSuspended(true); equal(observed?.will, undefined, 'suspension clears will');
    session.setSuspended(false);
    pointer('pointermove');
    await session.setSelection(['a']);
    await session.restoreViewState({ ...(await session.exportViewState()), viewMode: 'explore', focusedNodeId: undefined });
    at = await point('b');
    pointer('pointerdown'); pointer('pointerup');
    equal(lastActivation?.action, 'admit-member', 'changed membership invalidates the previous Focus proposal');
    equal((await session.exportViewState()).focusedNodeId, undefined, 'stale hover cannot focus a newly dim candidate');
    deepEqual((await session.exportViewState()).selectedNodeIds, ['a', 'b'], 'fresh intent admits the candidate');
    pointer('pointermove'); await session.dispose(); session = undefined;
    equal(observed?.will, undefined, 'disposal clears will');
  } finally {
    await session?.dispose();
    Ego.prototype.resolveWill = original;
  }
});
