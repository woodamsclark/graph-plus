import { graphAttachmentRotation2DV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import { ForceLayoutModule, readForceSettings } from '../../src/graph-engine/runtime/modules/shipped/ForceLayoutModule.ts';
import { GrabController, elasticGrabForce, EXPERIMENTAL_ELASTIC_GRAB, type GrabConstraint, type GrabPolicy } from '../../src/graph-engine/runtime/interaction/GrabConstraint.ts';
import type { SessionInteractionRuntime } from '../../src/graph-engine/runtime/interaction/SessionInteractionRuntime.ts';
import type { GraphModulePipelineStateV1 } from '../../src/graph-engine/runtime/modules/GraphModuleTypes.ts';
import type { GraphViewStateV1, JsonValue, Vec3 } from '../../src/graph-engine/contracts/v1/index.ts';
import { DEFAULT_GRAPH_RENDER_THEME_V1 } from '../../src/graph-engine/runtime/render/index.ts';
import { GraphCameraController } from '../../src/graph-engine/runtime/camera/index.ts';
import { graphDocument, graphEdge, graphNode } from '../support/contractFixtures.ts';
import { GRAPH_PLUS_CONSUMER_REGISTRATION_V1 } from '../../src/graph-plus/consumer/GraphPlusRegistration.ts';
import { runtimeHarness, runtimeCanvas } from '../support/runtimeHarness.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

const zero = { x: 0, y: 0, z: 0 };
const elastic = (overrides: Partial<Extract<GrabConstraint, { mode: 'elastic' }>> = {}): GrabConstraint => ({
  mode: 'elastic', nodeId: 'a', target: { x: 100, y: 0, z: 50 }, stiffness: 0.15, damping: 0.6, maxForce: null, ...overrides,
});
const quietSettings = { repulsionStrength: 0, springStrength: 0, centeringStrength: 0,
  collisionRadius: 0, velocityDecay: 0, alphaDecay: 0.2 };

function fixture(dimensions: '2d' | '3d' = '2d', settings: Record<string, JsonValue> = {}, count = 2) {
  const positions: Record<string, Vec3> = { a: { ...zero }, ...(count > 1 ? { b: { x: 250, y: 0, z: 0 } } : {}) };
  const document = graphDocument({ nodes: Object.keys(positions).map(id => graphNode(id)), edges: count > 1 ? [graphEdge('ab', 'a', 'b')] : [] });
  const viewState: GraphViewStateV1 = { schemaVersion: 1, documentId: document.documentId, documentRevision: 0,
    consumerId: 'synthetic-consumer', profileId: 'two-dimensional', dimensions, positions, pinnedNodeIds: [],
    camera: { position: { x: 0, y: 0, z: 1000 }, target: zero, up: { x: 0, y: 1, z: 0 }, zoom: 1,
      projection: dimensions === '2d' ? 'orthographic' : 'perspective' },
    selectedNodeIds: [], activeFilters: {}, moduleState: {},
  };
  const selection = { nodeIds: new Set(Object.keys(positions)), edgeIds: new Set(['ab']) };
  let state: GraphModulePipelineStateV1 = { sourceDocument: document, document, viewState, positions,
    projectionSelection: selection, renderSelection: selection, formActive: false, nodeRoles: {}, edgeRoles: {},
    regions: [], regionLayouts: [], nodeContributions: {}, edgeContributions: {}, regionContributions: [], theme: DEFAULT_GRAPH_RENDER_THEME_V1 };
  const force = new ForceLayoutModule(dimensions, readForceSettings({ ...quietSettings, ...settings }));
  return {
    force, get state() { return state; }, set state(next: GraphModulePipelineStateV1) { state = next; },
    step(grab?: GrabConstraint, draggedNodeId?: string) {
      const result = force.tick({ ...state, grabConstraint: grab, draggedNodeId }, 1 / 60);
      if (result?.positions) state = { ...state, positions: result.positions };
      return result;
    },
    velocity() { return (force.exportState() as unknown as { velocities: Record<string, Vec3> }).velocities.a; },
  };
}

test('world-space grab lifecycle preserves contact offset and replaces rapid re-grabs', () => {
  const grab = new GrabController();
  grab.begin('a', { x: 10, y: 20, z: 30 }, { x: 8, y: 16, z: 24 }, EXPERIMENTAL_ELASTIC_GRAB);
  deepEqual(grab.current?.target, { x: 10, y: 20, z: 30 }, 'initial capture cannot jump');
  grab.update({ x: 18, y: 26, z: 34 });
  deepEqual(grab.current?.target, { x: 20, y: 30, z: 40 }, 'contact offset follows the target');
  grab.end(); grab.update({ x: 1000, y: 1000, z: 1000 });
  equal(grab.current, undefined, 'late packets cannot revive a released grab');
  grab.begin('b', zero, zero, { mode: 'off' });
  deepEqual(grab.current, { mode: 'off', nodeId: 'b', target: zero }, 'new contact replaces all old state');
});

test('grab force implements independent stiffness, damping and combined magnitude cap in 2D/3D', () => {
  const grab = elastic({ stiffness: 2, damping: 3, maxForce: 5, target: { x: 10, y: 20, z: 30 } });
  const raw = elasticGrabForce({ ...grab, maxForce: null } as GrabConstraint, zero, { x: 1, y: 2, z: 3 }, '3d');
  deepEqual(raw, { x: 17, y: 34, z: 51 }, 'combined force uses pre-step velocity');
  const capped = elasticGrabForce(grab, zero, { x: 1, y: 2, z: 3 }, '3d');
  assert(Math.abs(Math.hypot(capped.x, capped.y, capped.z) - 5) < 1e-10, 'cap applies to combined vector');
  equal(elasticGrabForce(grab, zero, zero, '2d').z, 0, '2D ignores depth');
  deepEqual(elasticGrabForce(elastic({ maxForce: 0 }), zero, zero, '3d'), zero, 'zero cap disables all grab force');
  deepEqual(elasticGrabForce(elastic({ stiffness: 0, damping: 0 }), zero, zero, '3d'), zero, 'zero coefficients add no influence');
  equal(elasticGrabForce(elastic({ stiffness: 0, damping: 2 }), zero, { x: 3, y: 0, z: 0 }, '2d').x, -6,
    'zero stiffness may still brake motion independently');
});

test('invalid grab coefficients are rejected and extreme finite input cannot poison the solver', () => {
  for (const policy of [elastic({ stiffness: -1 }), elastic({ damping: NaN }), elastic({ maxForce: Infinity })]) {
    let rejected = false;
    try { new GrabController().begin('a', zero, zero, policy); } catch { rejected = true; }
    assert(rejected, 'invalid policy rejected at boundary');
  }
  deepEqual(elasticGrabForce(elastic({ stiffness: Number.MAX_VALUE }), zero, zero, '3d'), zero, 'overflow is discarded');
});

test('elastic grip strength and force caps control response without kinematic exclusion', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const displacements = [0, 0.05, 0.15, 0.5].map(stiffness => {
      const f = fixture(dimensions); f.step(elastic({ stiffness, damping: 0 }), 'a');
      const displacement = f.state.positions.a.x; f.force.dispose(); return displacement;
    });
    equal(displacements[0], 0, 'zero stiffness has no attraction');
    assert(displacements.every((value, i) => i === 0 || value > displacements[i - 1]), 'stiffness increases grip');
    for (const maxForce of [0, 2, 10, null]) {
      const f = fixture(dimensions); f.step(elastic({ stiffness: 1, damping: 0, maxForce }));
      const v = f.velocity(); const magnitude = Math.hypot(v.x, v.y, v.z);
      if (maxForce !== null) assert(Math.abs(magnitude - maxForce * 0.6) < 1e-9, 'grab cap precedes integration gain');
      assert(f.state.positions.a.x < 100, 'elastic does not teleport to target');
      equal(f.state.positions.a.z === 0, dimensions === '2d' || maxForce === 0, 'depth participates only in 3D'); f.force.dispose();
    }
  }
});

test('grab damping reduces oscillation while preserving graph spring participation', () => {
  const energies: number[] = [];
  for (const damping of [0, 0.8]) {
    const f = fixture('2d', { alphaDecay: 0 }); let error = 0;
    for (let i = 0; i < 180; i++) {
      f.step(elastic({ target: { x: 100, y: 0, z: 0 }, stiffness: 0.15, damping }));
      if (i > 120) error += Math.abs(f.state.positions.a.x - 100);
    }
    energies.push(error); f.force.dispose();
  }
  assert(energies[1] < energies[0] * 0.01, 'damping settles sustained oscillation');
  const f = fixture('2d', { springStrength: 0.5 });
  f.step(elastic({ target: { x: 100, y: 0, z: 0 } })); f.step(elastic());
  assert(f.state.positions.b.x > 250, 'connected spring responds while a is grabbed'); f.force.dispose();
});

test('release preserves position and physical velocity with no stale pull, pin or impulse', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const f = fixture(dimensions); f.step(elastic({ damping: 0 }));
    const before = { ...f.state.positions.a }; const velocity = { ...f.velocity() };
    const reference = fixture(dimensions); reference.state = { ...reference.state, positions: structuredClone(f.state.positions) };
    reference.force.restoreState(f.force.exportState());
    f.step(); reference.step();
    deepEqual(f.state.positions.a, reference.state.positions.a, 'release matches ordinary solver from the same state');
    deepEqual(f.velocity(), velocity, 'no artificial impulse or velocity reset');
    equal(f.state.positions.a.x, before.x + velocity.x, 'first released step continues actual momentum');
    deepEqual(f.state.viewState.pinnedNodeIds, [], 'elastic never authors a pin');
    assert(!JSON.stringify(f.force.exportState()).includes('grab'), 'constraint is absent from snapshots');
    f.force.dispose(); reference.force.dispose();
  }
});

test('elastic wakes cold simulations and release cools naturally including isolated nodes', () => {
  for (const count of [1, 2]) {
    const f = fixture('2d', { velocityDecay: 0.4 }, count); f.step();
    f.force.restoreState({ schemaVersion: 1, alpha: 0, running: false, velocities: {} });
    const grabbed = { ...f.state, grabConstraint: elastic() };
    assert(f.force.preferredTickIntervalMs(grabbed) !== null, 'settled solver admits a grab');
    f.step(elastic()); equal(f.force.getDiagnostics().alpha, 1, 'grab wakes full integration');
    for (let i = 0; i < 400; i++) f.step();
    equal(f.force.getDiagnostics().running, false, 'release eventually sleeps');
    equal(f.force.preferredTickIntervalMs(f.state), null, 'released solver requests no further ticks'); f.force.dispose();
  }
});

test('exact constraints remain hard, legacy dragging is compatible, off overrides legacy dragging', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const f = fixture(dimensions, { centeringStrength: 0.1 });
    f.step({ mode: 'exact', nodeId: 'a', target: { x: 11, y: 22, z: 33 } });
    deepEqual(f.state.positions.a, { x: 11, y: 22, z: dimensions === '2d' ? 0 : 33 }, 'exact target wins over forces');
    deepEqual(f.velocity(), zero, 'exact has no force-based approximation');
    const fixed = { ...f.state.positions.a }; f.step(undefined, 'a');
    deepEqual(f.state.positions.a, fixed, 'legacy dragged node stays kinematic');
    f.step({ mode: 'off', nodeId: 'a', target: zero }, 'a');
    assert(f.state.positions.a.x !== fixed.x, 'off leaves graph physics active despite legacy drag id'); f.force.dispose();
  }
});

test('pinned, removed, filtered and nonfinite grab targets have no pulling authority', () => {
  for (const kind of ['pinned', 'removed', 'filtered', 'nonfinite']) {
    const f = fixture();
    if (kind === 'pinned') f.state = { ...f.state, viewState: { ...f.state.viewState, pinnedNodeIds: ['a'] } };
    if (kind === 'filtered') f.state = { ...f.state, renderSelection: { ...f.state.renderSelection, nodeIds: new Set(['b']) } };
    const grab = elastic({ ...(kind === 'removed' ? { nodeId: 'missing' } : {}), ...(kind === 'nonfinite' ? { target: { x: NaN, y: 0, z: 0 } } : {}) });
    f.step(grab, 'a'); equal(f.state.positions.a.x, 0, `${kind} cannot pull or fall back to exact drag`); f.force.dispose();
  }
});

test('sustained capped and uncapped grabs remain finite under varied coefficients and normal speed safety', () => {
  for (const dimensions of ['2d', '3d'] as const) for (const maxForce of [null, 12]) {
    const f = fixture(dimensions, { springStrength: 0.5, repulsionStrength: 1000, velocityDecay: 0.4 });
    for (let i = 0; i < 600; i++) {
      f.step(elastic({ stiffness: i % 2 ? 0.15 : 1e6, damping: i % 2 ? 0.6 : 1e6, maxForce,
        target: { x: Math.sin(i / 20) * 500, y: Math.cos(i / 20) * 500, z: 100 } }));
      for (const position of Object.values(f.state.positions)) assert(Object.values(position).every(Number.isFinite), 'coordinates remain finite');
      const v = f.velocity(); assert(Math.hypot(v.x, v.y, v.z) <= 260.000001, 'global speed clamp remains effective');
    }
    f.force.dispose();
  }
});

type InteractionProbe = Pick<SessionInteractionRuntime, 'setExperimentalGrabPolicy' | 'getGrabConstraint' | 'setEnabled' | 'reset'> & {
  beginNodeDrag(nodeId: string, point: { x: number; y: number }, preview: undefined): void;
  updateNodeDrag(nodeId: string, point: { x: number; y: number }): void;
};

async function pointerFixture(dimensions: '2d' | '3d', policy: GrabPolicy) {
  const value = runtimeHarness({ consumerId: 'graph-plus', profileId: 'default', registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1,
    document: graphDocument({ nodes: [graphNode('a'), graphNode('b')], edges: [] }) });
  value.profiles.setUserOverrides('graph-plus', 'default', { dimensions, modules: {
    'force-layout': { enabled: true, settings: { ...quietSettings, velocityDecay: 0.4 } },
    anima: { settings: { cursorGravity: 'off' } },
  } });
  const session = await value.create();
  const initial = await session.exportViewState();
  const camera = new GraphCameraController(initial.camera, dimensions); camera.setViewport(640, 360);
  const depth = camera.worldToScreen(initial.camera.target).depth;
  await session.restoreViewState({ ...initial, dimensions, camera: camera.getState(), positions: {
    a: camera.screenToWorld(120, 120, depth), b: camera.screenToWorld(400, 200, depth),
  } });
  const probe = session as unknown as { interaction: InteractionProbe; moduleView: GraphModulePipelineStateV1;
    moduleHost: { active: { id: string; instance: ForceLayoutModule }[] } };
  probe.interaction.setExperimentalGrabPolicy(policy);
  const force = probe.moduleHost.active.find(module => module.id === 'force-layout')!.instance;
  force.updateSettings({ ...quietSettings, velocityDecay: 0.4 });
  const advance = () => { value.platform.advanceTime(20); value.platform.flushTimer(); value.platform.flushFrame(value.platform.now()); };
  advance(); advance();
  const canvas = runtimeCanvas(value.container);
  const pointer = (type: string, x: number, buttons: number, pointerType = 'mouse') => {
    const fields = { clientX: x, clientY: 120, pointerId: 71, pointerType, button: 0, buttons };
    const event = new value.window.PointerEvent(type, { ...fields, bubbles: true });
    for (const [key, field] of Object.entries(fields)) Object.defineProperty(event, key, { value: field });
    canvas.dispatchEvent(event as unknown as Event);
  };
  return { ...value, session, probe, force, advance, pointer };
}

test('pointer elastic drag uses solver positions and releases without pinning or patching in 2D/3D', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = await pointerFixture(dimensions, EXPERIMENTAL_ELASTIC_GRAB);
    try {
      const before = await value.session.exportViewState(); const patches = value.force.getDiagnostics().nodePositionPatches;
      value.pointer('pointerdown', 120, 1); value.pointer('pointermove', 150, 1); value.advance();
      value.pointer('pointermove', 180, 1); value.advance();
      assert(value.probe.interaction.getGrabConstraint()?.mode === 'elastic', 'real input creates elastic constraint');
      const held = await value.session.exportViewState();
      assert(JSON.stringify(held.positions.a) !== JSON.stringify(before.positions.a), 'solver moves grabbed node');
      equal(value.force.getDiagnostics().nodePositionPatches, patches, 'pointer never writes solver position');
      deepEqual(held.pinnedNodeIds, before.pinnedNodeIds, 'capture leaves pins alone');
      value.pointer('pointerup', 180, 0); value.advance();
      equal(value.probe.interaction.getGrabConstraint(), undefined, 'release removes constraint');
      deepEqual((await value.session.exportViewState()).pinnedNodeIds, before.pinnedNodeIds, 'release leaves pins alone');
    } finally { await value.session.dispose(); }
  }
});

test('pointer cancel, disable, disappearance and rapid grabs clear transient constraints safely', async () => {
  const value = await pointerFixture('2d', EXPERIMENTAL_ELASTIC_GRAB);
  try {
    value.pointer('pointerdown', 120, 1); value.pointer('pointermove', 150, 1); value.advance();
    value.pointer('pointercancel', 150, 0); value.advance();
    equal(value.probe.interaction.getGrabConstraint(), undefined, 'pointer cancellation releases');
    const point = { x: 120, y: 120 };
    value.probe.interaction.beginNodeDrag('a', point, undefined);
    value.probe.interaction.beginNodeDrag('b', { x: 400, y: 200 }, undefined);
    equal(value.probe.interaction.getGrabConstraint()?.nodeId, 'b', 'new capture replaces old constraint');
    value.probe.interaction.setEnabled(false);
    equal(value.probe.interaction.getGrabConstraint(), undefined, 'disabled input clears capture');
    value.probe.interaction.setEnabled(true);
    value.probe.interaction.beginNodeDrag('a', point, undefined);
    await value.session.replaceDocument(graphDocument({ nodes: [graphNode('b')], edges: [] }));
    equal(value.probe.interaction.getGrabConstraint(), undefined, 'removed node cannot retain a grab');
  } finally { await value.session.dispose(); }
});

test('elastic capture respects existing pins and captures policy without changing selection', async () => {
  const value = await pointerFixture('2d', EXPERIMENTAL_ELASTIC_GRAB);
  try {
    const initial = await value.session.exportViewState();
    await value.session.restoreViewState({ ...initial, pinnedNodeIds: ['a'] });
    value.probe.interaction.beginNodeDrag('a', { x: 120, y: 120 }, undefined);
    equal(value.probe.interaction.getGrabConstraint(), undefined, 'pinned node refuses elastic capture');
    deepEqual((await value.session.exportViewState()).pinnedNodeIds, ['a'], 'pin remains authored');
    await value.session.restoreViewState(initial);
    value.probe.interaction.beginNodeDrag('a', { x: 123, y: 120 }, undefined);
    const start = value.probe.interaction.getGrabConstraint();
    deepEqual(start?.target, initial.positions.a, 'off-center contact does not snap');
    value.probe.interaction.setExperimentalGrabPolicy({ mode: 'off' });
    value.probe.interaction.updateNodeDrag('a', { x: 153, y: 120 });
    equal(value.probe.interaction.getGrabConstraint()?.mode, 'elastic', 'changing defaults cannot mutate active capture');
    deepEqual((await value.session.exportViewState()).selectedNodeIds, initial.selectedNodeIds, 'grab has no selection authority');
    value.probe.interaction.reset();
    equal(value.probe.interaction.getGrabConstraint(), undefined, 'reset removes constraint');
    value.probe.interaction.beginNodeDrag('a', { x: 120, y: 120 }, undefined);
    value.probe.interaction.updateNodeDrag('a', { x: 200, y: 120 });
    equal(value.probe.interaction.getGrabConstraint()?.mode, 'off', 'next capture uses new policy');
    deepEqual((await value.session.exportViewState()).positions.a, initial.positions.a, 'off does not patch positions');
  } finally { await value.session.dispose(); }
});

test('camera changes reproject the captured world plane without using the moving node as target', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = await pointerFixture(dimensions, EXPERIMENTAL_ELASTIC_GRAB);
    try {
      const before = await value.session.exportViewState();
      const probe = value.probe as unknown as { vision: {
        worldToScreen(point: Vec3): { x: number; y: number; depth: number };
        screenToWorld(x: number, y: number, depth: number): Vec3;
        panByPixels(x: number, y: number): void;
        orbitByPixels(x: number, y: number, pivot?: Vec3): void;
      } };
      const point = { x: 123, y: 122 }; const anchor = before.positions.a;
      const contact = probe.vision.screenToWorld(point.x, point.y, probe.vision.worldToScreen(anchor).depth);
      value.probe.interaction.beginNodeDrag('a', point, undefined);
      probe.vision.panByPixels(30, 15);
      if (dimensions === '3d') probe.vision.orbitByPixels(20, 10, anchor);
      const mapped = probe.vision.screenToWorld(point.x, point.y, probe.vision.worldToScreen(anchor).depth);
      deepEqual(value.probe.interaction.getGrabConstraint()?.target, {
        x: mapped.x + (anchor.x - contact.x), y: mapped.y + (anchor.y - contact.y), z: mapped.z + (anchor.z - contact.z),
      }, 'target follows camera projection and original contact offset');
      deepEqual((await value.session.exportViewState()).positions.a, anchor, 'camera remapping never moves the node directly');
    } finally { await value.session.dispose(); }
  }
});


test('RC elastic grabs compose with vector gravity for isolated nodes and cool after release', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const f = fixture(dimensions, { gravityEnabled: true, gravityX: 1, gravityY: -2, gravityZ: 3 }, 1);
    f.step(elastic({ damping: 0 }), 'a');
    assert(Math.abs(f.state.positions.a.x - 9.6) < 1e-9, 'gravity and elastic attraction both integrate');
    assert(Math.abs(f.state.positions.a.y + 1.2) < 1e-9, 'gravity acts on elastically grabbed node');
    assert(Math.abs(f.state.positions.a.z - (dimensions === '3d' ? 6.3 : 0)) < 1e-9, 'combined depth contribution');
    for (let i = 0; i < 400; i++) f.step();
    equal(f.force.getDiagnostics().running, false, 'gravity and grab release share eventual settling');
    equal(f.force.preferredTickIntervalMs(f.state), null, 'no stale grab keeps isolated physics alive');
    f.force.dispose();
  }
});

test('RC hard attachment rays retain authority over elastic grabs and gravity', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const f = fixture(dimensions, { gravityEnabled: true, gravityY: 2, gravityZ: 3 });
    const document = graphDocument({ nodes: [graphNode('a', { attachment: {
      enabled: true, count: dimensions === '3d' ? 6 : 4, rigidity: 'locked',
      orientation: { mode: 'locked', rotation: graphAttachmentRotation2DV1(0) },
    } }), graphNode('b')], edges: [graphEdge('ab', 'a', 'b', { attachment: { sourceSlot: 0 } })] });
    f.state = { ...f.state, document, sourceDocument: document,
      viewState: { ...f.state.viewState, pinnedNodeIds: ['a'] } };
    f.step();
    for (let i = 0; i < 50; i++) f.step(elastic({ nodeId: 'b', target: { x: 250, y: 100, z: 100 } }), 'b');
    assert(Math.abs(f.state.positions.b.y) < 1e-8 && Math.abs(f.state.positions.b.z) < 1e-8,
      'elastic force cannot move the node away from its accepted hard ray');
    equal(f.force.getDiagnostics().attachmentSlots.owners.a.bindings.length, 1, 'accepted binding stays intact');
    deepEqual(f.state.positions.a, zero, 'pinned owner remains authoritative');
    f.force.dispose();
  }
});
