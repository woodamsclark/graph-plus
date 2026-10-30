import { ForceLayoutModule, readForceSettings } from '../../src/graph-engine/runtime/modules/shipped/ForceLayoutModule.ts';
import type { GraphModulePipelineStateV1 } from '../../src/graph-engine/runtime/modules/GraphModuleTypes.ts';
import type { GraphDimensionsV1, GraphViewStateV1, JsonValue, Vec3 } from '../../src/graph-engine/contracts/v1/index.ts';
import { graphAttachmentRotation2DV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import { DEFAULT_GRAPH_RENDER_THEME_V1 } from '../../src/graph-engine/runtime/render/index.ts';
import { graphDocument, graphEdge, graphNode } from '../support/contractFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

const inert = { repulsionStrength: 0, springStrength: 0, centeringStrength: 0, collisionRadius: 0, velocityDecay: 0.4, alphaDecay: 0.2 };
const gravity = { gravityEnabled: true, gravityX: 1, gravityY: -2, gravityZ: 3 };
const near = (a: number, b: number, message: string) => assert(Math.abs(a - b) < 1e-9, `${message}: ${a} vs ${b}`);

function fixture(dimensions: GraphDimensionsV1, settings: Record<string, JsonValue> = {}, count = 2) {
  const nodes = Array.from({ length: count }, (_, i) => graphNode(i === 0 ? 'a' : 'b'));
  const positions = Object.fromEntries(nodes.map((node, i) => [node.id, { x: i * 250, y: 0, z: 0 }]));
  const document = graphDocument({ nodes, edges: [] });
  const viewState: GraphViewStateV1 = { schemaVersion: 1, documentId: document.documentId, documentRevision: 0,
    consumerId: 'graph-plus', profileId: 'default', dimensions, positions, pinnedNodeIds: [],
    camera: { position: { x: 0, y: 0, z: 1000 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, zoom: 1, projection: dimensions === '2d' ? 'orthographic' : 'perspective' },
    selectedNodeIds: [], activeFilters: {}, moduleState: {},
  };
  const selection = { nodeIds: new Set(nodes.map(n => n.id)), edgeIds: new Set<string>() };
  let state: GraphModulePipelineStateV1 = { sourceDocument: document, document, viewState, positions,
    projectionSelection: selection, renderSelection: selection, formActive: false, nodeRoles: {}, edgeRoles: {},
    regions: [], regionLayouts: [], nodeContributions: {}, edgeContributions: {}, regionContributions: [], theme: DEFAULT_GRAPH_RENDER_THEME_V1 };
  let current = { ...inert, ...settings };
  const force = new ForceLayoutModule(dimensions, readForceSettings(current));
  return { force, get state() { return state; }, set state(value: GraphModulePipelineStateV1) { state = value; },
    step() { const result = force.tick(state, 1 / 60); if (result?.positions) state = { ...state, positions: result.positions }; return result; },
    update(changes: Record<string, JsonValue>) { current = { ...current, ...changes }; force.updateSettings(current); },
    velocity() { return (force.exportState() as unknown as { velocities: Record<string, Vec3> }).velocities.a; },
  };
}

test('uniform gravity is disabled by default and validates signed finite components', () => {
  const settings = readForceSettings({ gravityX: -Infinity, gravityY: 200, gravityZ: -200, gravityEnabled: 'yes' });
  equal(settings.gravityEnabled, false, 'only an explicit boolean enables gravity');
  equal(settings.gravityX, 0, 'nonfinite input falls back to zero'); equal(settings.gravityY, 100, 'upper limit'); equal(settings.gravityZ, -100, 'lower limit');
  for (const dimensions of ['2d', '3d'] as const) {
    const a = fixture(dimensions), b = fixture(dimensions, { ...gravity, gravityEnabled: false });
    for (let i = 0; i < 20; i++) { a.step(); b.step(); }
    deepEqual(a.state.positions, b.state.positions, 'stored disabled values have no physical influence');
    deepEqual(a.force.exportState(), b.force.exportState(), 'disabled values preserve ordinary cooling'); a.force.dispose(); b.force.dispose();
  }
});

test('uniform force applies combined signed directions and ignores depth in 2D', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const f = fixture(dimensions, gravity); f.step();
    near(f.state.positions.a.x, 0.36, 'X receives integration gain and ordinary velocity decay');
    near(f.state.positions.a.y, -0.72, 'Y can reverse'); near(f.state.positions.a.z, dimensions === '3d' ? 1.08 : 0, 'Z is spatial only');
    f.force.dispose();
  }
});

test('uniform force is modulated by alpha exactly once through existing integration', () => {
  for (const dimensions of ['2d', '3d'] as const) for (const alpha of [1, 0.5, 0.1]) {
    const f = fixture(dimensions, { ...gravity, velocityDecay: 0, alphaDecay: 0 });
    f.force.restoreState({ schemaVersion: 1, alpha, running: true, velocities: {} }); f.step();
    near(f.state.positions.a.x, 0.6 * alpha, 'force displacement scales linearly with alpha');
    near(f.velocity().x, 0.6 * alpha, 'velocity transition uses the same alpha');
    near(f.state.positions.a.y, -1.2 * alpha, 'all vector components share alpha'); f.force.dispose();
  }
});

test('enabled gravity cools to sleep and a live vector edit reheats without rebuilding topology', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const f = fixture(dimensions, gravity); f.step(); const analyses = f.force.getDiagnostics().topologyAnalysisCount;
    for (let i = 0; i < 400; i++) f.step();
    equal(f.force.getDiagnostics().running, false, 'configured force does not prevent cooling');
    equal(f.force.getDiagnostics().alpha, 0, 'simulation activity decays fully');
    equal(f.force.preferredTickIntervalMs(f.state), null, 'cooled graph requests no continuous frames');
    const before = { ...f.state.positions.a }; f.update({ gravityX: -1 }); f.step();
    assert(f.state.positions.a.x < before.x, 'new direction takes effect after live reheat');
    equal(f.force.getDiagnostics().topologyAnalysisCount, analyses, 'coefficient edits reuse topology'); f.force.dispose();
  }
});

test('gravity supports isolated nodes and lets momentum settle after disabling', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const f = fixture(dimensions, gravity, 1); f.step();
    assert(f.state.positions.a.x > 0, 'single-node physics responds to uniform force');
    const velocity = { ...f.velocity() }, before = { ...f.state.positions.a };
    f.update({ gravityEnabled: false }); deepEqual(f.velocity(), velocity, 'disabling adds no impulse and does not reset velocity');
    f.step(); assert(f.state.positions.a.x > before.x, 'remaining momentum continues naturally');
    for (let i = 0; i < 400; i++) f.step();
    equal(f.force.getDiagnostics().running, false, 'isolated node finishes cooling');
    equal(f.force.preferredTickIntervalMs(f.state), null, 'released force leaves no awake single-node loop'); f.force.dispose();
    const enabled = fixture(dimensions, gravity, 1); for (let i = 0; i < 400; i++) enabled.step();
    equal(enabled.force.getDiagnostics().running, false, 'nonzero isolated force also cools'); enabled.force.dispose();
  }
});

test('zero force and irrelevant disabled/depth edits do not wake cold simulations', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const f = fixture(dimensions); f.step(); f.force.restoreState({ schemaVersion: 1, alpha: 0, running: false, velocities: {} });
    f.update({ gravityX: 20, gravityY: -10, gravityZ: 5 });
    equal(f.force.getDiagnostics().running, false, 'editing disabled values has no wake effect');
    f.update({ gravityX: 0, gravityY: 0, gravityZ: dimensions === '2d' ? 5 : 0, gravityEnabled: true });
    equal(f.force.getDiagnostics().running, false, 'effective zero vector remains idle');
    equal(f.force.preferredTickIntervalMs(f.state), null, 'idle force requests no frames');
    f.update({ gravityY: -1 }); equal(f.force.getDiagnostics().running, true, 'effective vector edit wakes physics'); f.force.dispose();
  }
});

test('pins and exact dragging retain authority over gravity and resume normally when released', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const f = fixture(dimensions, gravity);
    f.state = { ...f.state, draggedNodeId: 'b', viewState: { ...f.state.viewState, pinnedNodeIds: ['a'] } };
    const before = structuredClone(f.state.positions); for (let i = 0; i < 5; i++) f.step();
    deepEqual(f.state.positions, before, 'kinematic nodes ignore uniform force');
    f.state = { ...f.state, draggedNodeId: undefined, viewState: { ...f.state.viewState, pinnedNodeIds: [] } }; f.step();
    assert(f.state.positions.a.x > before.a.x && f.state.positions.b.x > before.b.x, 'released nodes receive force'); f.force.dispose();
  }
});

test('hard attachment constraints remain authoritative under arbitrary gravity', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const f = fixture(dimensions, { ...gravity, gravityX: 0 });
    const document = graphDocument({ nodes: [graphNode('a', { attachment: { enabled: true, count: dimensions === '3d' ? 6 : 4, rigidity: 'locked', orientation: { mode: 'locked', rotation: graphAttachmentRotation2DV1(0) } } }), graphNode('b')],
      edges: [graphEdge('ab', 'a', 'b', { attachment: { sourceSlot: 0 } })] });
    f.state = { ...f.state, document, sourceDocument: document, viewState: { ...f.state.viewState, pinnedNodeIds: ['a'] } };
    for (let i = 0; i < 100; i++) f.step();
    near(f.state.positions.b.y, 0, 'hard ray rejects lateral force'); near(f.state.positions.b.z, 0, 'hard ray rejects depth force');
    equal(f.force.getDiagnostics().attachmentSlots.owners.a.bindings.length, 1, 'force cannot eject an accepted hard binding'); f.force.dispose();
  }
});

test('uniform force updates replace coefficients without accumulating stale contributions', () => {
  const f = fixture('3d', { ...gravity, velocityDecay: 0, alphaDecay: 0 }); f.step();
  const first = { ...f.velocity() }; f.update({ gravityX: -4, gravityY: 5, gravityZ: 0 }); f.step();
  near(f.velocity().x - first.x, -4 * 0.6, 'new X replaces old X'); near(f.velocity().y - first.y, 5 * 0.6, 'new Y replaces old Y'); near(f.velocity().z, first.z, 'zero Z removes its contribution');
  f.update({ gravityEnabled: false }); f.step(); near(f.velocity().x, first.x - 4 * 0.6, 'disabled force contributes nothing further'); f.force.dispose();
});

test('uniform force respects suspension, Form layouts, speed safety and finite positions', () => {
  const f = fixture('3d', { ...gravity, gravityX: 100, gravityY: 100, gravityZ: 100, velocityDecay: 0, alphaDecay: 0 });
  f.force.setSuspended(true); equal(f.force.preferredTickIntervalMs(f.state), null, 'suspension suppresses physics'); equal(f.step(), undefined, 'suspended force does no work');
  f.force.setSuspended(false); f.state = { ...f.state, formActive: true }; equal(f.step(), undefined, 'Form retains layout authority');
  f.state = { ...f.state, formActive: false };
  for (let i = 0; i < 300; i++) { f.step(); assert(Math.hypot(f.velocity().x, f.velocity().y, f.velocity().z) <= 260.00001, 'speed remains bounded'); }
  assert(Object.values(f.state.positions).every(p => [p.x, p.y, p.z].every(Number.isFinite)), 'extreme supported force stays finite'); f.force.dispose();
});
