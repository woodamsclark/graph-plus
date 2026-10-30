import { AttachmentSlots } from '../../src/graph-engine/runtime/modules/shipped/AttachmentSlots.ts';
import { AttachmentSlots2D } from '../../src/graph-engine/runtime/modules/shipped/AttachmentSlots2D.ts';
import { attachmentSlotDirection3D, attachmentCandidateSlots3D, rotate3, angle3, normalize3, scale3,
  subtract3, cross3, identityRotation3D, fitAttachmentRotation3D } from '../../src/graph-engine/runtime/modules/shipped/AttachmentGeometry3D.ts';
import { ForceLayoutModule, readForceSettings } from '../../src/graph-engine/runtime/modules/shipped/ForceLayoutModule.ts';
import { createShippedGraphModuleRegistryV1 } from '../../src/graph-engine/runtime/modules/shipped/ShippedGraphModules.ts';
import { GraphEngineProviderCoreV1 } from '../../src/graph-engine/service/GraphEngineProviderCore.ts';
import { GRAPH_PLUS_CONSUMER_REGISTRATION_V1 } from '../../src/graph-plus/consumer/GraphPlusRegistration.ts';
import { graphAttachmentSlotDirection3DV1, GRAPH_NODE_ATTACHMENT_SLOTS_3D_CAPABILITY_V1,
  GRAPH_EDGE_ATTACHMENT_ASSIGNMENTS_3D_CAPABILITY_V1, GRAPH_ATTACHMENT_ASSIGNMENT_POLICY_CAPABILITY_V1, GRAPH_UPDATE_API_CAPABILITY_V1 } from '../../packages/graph-engine-client/src/graph-engine/public.ts';
import type { GraphAttachmentRotationV1, GraphAttachmentSlotsStateV1, GraphNodeAttachmentV1, GraphViewStateV1, JsonValue, Vec3 } from '../../src/graph-engine/contracts/v1/index.ts';
import type { GraphModulePipelineStateV1 } from '../../src/graph-engine/runtime/modules/GraphModuleTypes.ts';
import { DEFAULT_GRAPH_RENDER_THEME_V1 } from '../../src/graph-engine/runtime/render/index.ts';
import { graphDocument, graphEdge, graphNode } from '../support/contractFixtures.ts';
import { runtimeHarness } from '../support/runtimeHarness.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

type Point = { x: number; y: number; z: number };
const origin: Vec3 = { x: 0, y: 0, z: 0 };
const qx: GraphAttachmentRotationV1 = { x: Math.sin(0.37), y: 0, z: 0, w: Math.cos(0.37) };
const fixed = (rotation = identityRotation3D) => ({ mode: 'locked' as const, rotation });
const near = (a: number, b: number, message: string, tolerance = 1e-6) => assert(Math.abs(a - b) <= tolerance, `${message}: ${a} vs ${b}`);
const length = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const inert = { repulsionStrength: 0, springStrength: 0, centeringStrength: 0, collisionRadius: 0, alphaDecay: 0, velocityDecay: 0.4 };

function slotsFixture(pattern: GraphNodeAttachmentV1 = { count: 6, rigidity: 'locked', orientation: fixed() }, count = 6) {
  const positions: Record<string, Point> = { hub: { ...origin } };
  const neighbors = Array.from({ length: count }, (_, i) => `n${i}`);
  neighbors.forEach((id, i) => { positions[id] = { ...scale3(attachmentSlotDirection3D(pattern.count ?? 6, i % (pattern.count ?? 6)), 100 + i) }; });
  const patterns = new Map<string, GraphNodeAttachmentV1>([['hub', pattern]]);
  const connected = new Map([['hub', neighbors]]);
  const slots = new AttachmentSlots('3d');
  const endpoints = neighbors.map((neighborId, i) => ({ edgeId: `e${i}`, ownerId: 'hub', neighborId, endpoint: 'source' as const, slot: i % (pattern.count ?? 6) as number | null | undefined }));
  const step = (mobile = (id: string) => id !== 'hub') => slots.prepare(patterns, connected, positions, mobile, endpoints.map(endpoint => ({ ...endpoint })));
  return { slots, positions, patterns, connected, endpoints, step };
}

function solverFixture(pattern: GraphNodeAttachmentV1 | null = { count: 6, stiffness: 'firm', orientation: fixed() }, rotation = identityRotation3D) {
  const positions: Record<string, Vec3> = { hub: { ...origin } };
  for (let i = 0; i < 6; i++) {
    const v = attachmentSlotDirection3D(6, i);
    positions[`n${i}`] = rotate3(rotation, scale3(normalize3({ x: v.x + 0.04, y: v.y + 0.07, z: v.z + 0.09 }), 100));
  }
  const document = graphDocument({ nodes: Object.keys(positions).map(id => graphNode(id, id === 'hub' && pattern ? { attachment: { enabled: true, ...pattern } } : {})),
    edges: Array.from({ length: 6 }, (_, i) => graphEdge(`e${i}`, 'hub', `n${i}`, { attachment: { sourceSlot: i } })) });
  const viewState: GraphViewStateV1 = { schemaVersion: 1, documentId: document.documentId, documentRevision: 0,
    consumerId: 'graph-plus', profileId: 'default', dimensions: '3d', positions, pinnedNodeIds: ['hub'],
    camera: { position: { x: 0, y: 0, z: 1000 }, target: origin, up: { x: 0, y: 1, z: 0 }, zoom: 1, projection: 'perspective' },
    selectedNodeIds: [], activeFilters: {}, moduleState: {},
  };
  const selection = { nodeIds: new Set(Object.keys(positions)), edgeIds: new Set(document.edges.map(edge => edge.id)) };
  const state: GraphModulePipelineStateV1 = { sourceDocument: document, document, viewState, positions,
    projectionSelection: selection, renderSelection: selection, formActive: false, nodeRoles: {}, edgeRoles: {},
    regions: [], regionLayouts: [], nodeContributions: {}, edgeContributions: {}, regionContributions: [], theme: DEFAULT_GRAPH_RENDER_THEME_V1 };
  const force = new ForceLayoutModule('3d', readForceSettings(inert));
  return { force, state };
}
function steps(f: ReturnType<typeof solverFixture>, count = 1) {
  for (let i = 0; i < count; i++) { const result = f.force.tick(f.state, 1 / 60); if (result?.positions) f.state = { ...f.state, positions: result.positions }; }
  return f.state.positions;
}

function compareSpatialSnapshots(actual: GraphAttachmentSlotsStateV1, expected: GraphAttachmentSlotsStateV1): void {
  const stripPose = (snapshot: GraphAttachmentSlotsStateV1) => ({ ...snapshot, owners: Object.fromEntries(Object.entries(snapshot.owners).map(([id, owner]) => [id, { ...owner, rotation: undefined }])) });
  deepEqual(stripPose(actual), stripPose(expected), 'slot identities and assignment controllers survive restore');
  for (const id of Object.keys(expected.owners)) for (const axis of [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }]) {
    near(angle3(rotate3(actual.owners[id].rotation!, axis), rotate3(expected.owners[id].rotation!, axis)), 0, 'spatial pose survives restore', 1e-9);
  }
}

test('3D slot patterns are deterministic, normalized, unique and spatial for common counts', () => {
  for (const count of [2, 3, 4, 5, 6, 8, 12, 16, 128]) {
    const directions = Array.from({ length: count }, (_, i) => graphAttachmentSlotDirection3DV1(count, i));
    equal(new Set(directions.map(v => JSON.stringify(v))).size, count, 'each index identifies a distinct slot');
    for (let i = 0; i < count; i++) { near(length(directions[i]), 1, 'unit direction'); deepEqual(directions[i], attachmentSlotDirection3D(count, i), 'client and solver agree'); }
    if (count >= 4) assert(directions.some(v => v.z > 0) && directions.some(v => v.z < 0), 'pattern covers both depth directions');
  }
  for (const [count, slot] of [[0, 0], [6, -1], [6, 6], [2.5, 0]]) {
    let failed = false; try { graphAttachmentSlotDirection3DV1(count, slot); } catch { failed = true; } assert(failed, 'invalid slot is rejected');
  }
  const candidates = attachmentCandidateSlots3D(Number.MAX_SAFE_INTEGER, { x: 0, y: 0, z: 1 });
  assert(candidates.length <= 1024, 'huge declarations cannot allocate a count-sized array');
});

test('3D quaternion fitting handles full spatial rotations, half turns and underdetermined twist', () => {
  const locals = Array.from({ length: 4 }, (_, i) => attachmentSlotDirection3D(4, i));
  for (const q of [qx, { x: 0, y: 1, z: 0, w: 0 }, { x: 0.5, y: 0.5, z: 0.5, w: 0.5 }]) {
    const fitted = fitAttachmentRotation3D(locals.map(local => ({ local, world: rotate3(q, local) })), identityRotation3D);
    for (const local of locals) near(angle3(rotate3(fitted, local), rotate3(q, local)), 0, 'fit retains all three axes', 1e-7);
  }
  const local = { x: 1, y: 0, z: 0 };
  const fitted = fitAttachmentRotation3D([{ local, world: local }], qx);
  near(angle3(rotate3(fitted, { x: 0, y: 1, z: 0 }), rotate3(qx, { x: 0, y: 1, z: 0 })), 0, 'one-axis fit retains prior twist', 1e-6);
});

test('3D locked bindings retain indexed rays, preserve radius and reject incompatible pinned moves', () => {
  const f = slotsFixture(); f.step();
  const original = f.slots.snapshot().owners.hub.bindings;
  equal(original.length, 6, 'all octahedral slots bind');
  f.positions.n0 = { x: 0, y: 70, z: 80 }; f.step();
  near(f.positions.n0.y, 0, 'locked ray removes y displacement'); near(f.positions.n0.z, 0, 'locked ray removes depth displacement');
  near(length(f.positions.n0), Math.hypot(70, 80), 'radius remains free');
  const feasible = structuredClone(f.positions);
  f.positions.n0 = { x: 20, y: 10, z: 30 }; f.step(() => false);
  deepEqual(f.positions.n0, feasible.n0, 'incompatible pinned move returns to feasible geometry');
  deepEqual(f.slots.snapshot().owners.hub.bindings, original, 'movement never ejects locked occupants');
  assert(f.slots.blockedMoves > 0, 'blocked movement is observable');
});

test('3D free locked patterns rotate collectively while fixed quaternion orientation anchors them', () => {
  for (const anchored of [false, true]) {
    const f = slotsFixture({ count: 6, rigidity: 'locked', ...(anchored ? { orientation: fixed() } : {}) }); f.step();
    for (const id of f.connected.get('hub')!) f.positions[id] = { ...rotate3(qx, f.positions[id]) };
    const proposed = structuredClone(f.positions); f.step();
    for (const [neighborId, slot] of f.slots.snapshot().owners.hub.bindings.map(binding => [binding.neighborId, binding.slot] as const)) {
      const target = anchored ? attachmentSlotDirection3D(6, slot) : normalize3(proposed[neighborId]);
      near(angle3(normalize3(f.positions[neighborId]), target), 0, 'collective rotation policy is respected', 1e-6);
    }
  }
});

test('3D slot occupancy, explicit requests, reservations and parallel link control share 2D semantics', () => {
  const f = slotsFixture({ count: 6, rigidity: 'locked', orientation: fixed() }, 7);
  f.endpoints[6].slot = undefined; f.positions.n6 = { x: 90, y: 1, z: 1 }; f.step();
  equal(f.slots.snapshot().owners.hub.bindings.length, 6, 'capacity is finite');
  assert(!f.slots.snapshot().owners.hub.bindings.some(binding => binding.neighborId === 'n6'), 'overflow stays free');
  f.endpoints[0].slot = null; f.step();
  assert(!f.slots.snapshot().owners.hub.bindings.some(binding => binding.neighborId === 'n0'), 'null releases and prevents recapture');
  f.endpoints[6].slot = 0; f.step();
  equal(f.slots.snapshot().requests?.find(request => request.edgeId === 'e6')?.status, 'bound', 'vacant requested slot is used');
  f.endpoints[0].slot = 0; f.step();
  equal(f.slots.snapshot().requests?.find(request => request.edgeId === 'e0')?.status, 'occupied', 'occupied request cannot steal');
  f.endpoints[0].slot = 99; f.step();
  equal(f.slots.snapshot().requests?.find(request => request.edgeId === 'e0')?.status, 'out-of-range', 'invalid request is not wrapped');
  f.endpoints.push({ ...f.endpoints[6], edgeId: 'a-new-conflict', slot: 2 }); f.step();
  equal(f.slots.snapshot().requests?.find(request => request.edgeId === 'a-new-conflict')?.status, 'conflicting', 'parallel request retains original controller');
});

test('3D incompatible endpoint locks stay unbound rather than breaking accepted locks', () => {
  const slots = new AttachmentSlots('3d');
  const positions = { a: { ...origin }, b: { x: 100, y: 0, z: 0 } };
  const patterns = new Map<string, GraphNodeAttachmentV1>(['a', 'b'].map(id => [id, { count: 6, rigidity: 'locked', orientation: fixed() }]));
  slots.prepare(patterns, new Map([['a', ['b']], ['b', ['a']]]), positions, () => false, [
    { edgeId: 'ab', ownerId: 'a', neighborId: 'b', endpoint: 'source', slot: 0 },
    { edgeId: 'ab', ownerId: 'b', neighborId: 'a', endpoint: 'target', slot: 0 },
  ]);
  equal(slots.snapshot().requests?.[0].status, 'bound', 'compatible endpoint binds');
  equal(slots.snapshot().requests?.[1].status, 'unbound', 'incompatible endpoint cannot override first');
  assert(slots.rejectedBindings > 0, 'failed admission is observable');
});

test('3D spring stiffness controls release/recapture and explicit assignments retain slot identity', () => {
  for (const stiffness of [0.08, 0.8]) {
    const f = slotsFixture({ count: 6, stiffness, orientation: fixed() }, 1); f.endpoints[0].slot = undefined; f.step();
    const angle = 30 * Math.PI / 180; f.positions.n0 = { x: 100 * Math.cos(angle), y: 0, z: 100 * Math.sin(angle) }; f.step();
    equal(f.slots.snapshot().owners.hub.bindings.length, stiffness === 0.08 ? 0 : 1, 'firmer spring tolerates greater displacement');
    if (stiffness === 0.08) { f.positions.n0 = { x: 0, y: 0, z: 100 }; f.step(); equal(f.slots.snapshot().owners.hub.bindings[0].slot, 2, 'released connection captures another direction'); }
    f.endpoints[0].slot = 0; f.step(); f.positions.n0 = { x: -100, y: 0, z: 0 }; f.step();
    equal(f.slots.snapshot().owners.hub.bindings[0].slot, 0, 'explicit spring assignment stretches without switching slots');
  }
});

test('3D snapshots retain full quaternion pose and controller identity and reject cross-dimension state', () => {
  const f = slotsFixture({ count: 6, rigidity: 'locked' }); f.step();
  for (const id of f.connected.get('hub')!) f.positions[id] = { ...rotate3(qx, f.positions[id]) }; f.step();
  const saved = JSON.parse(JSON.stringify(f.slots.snapshot()));
  const restored = new AttachmentSlots('3d'); restored.restore(saved);
  restored.prepare(f.patterns, f.connected, f.positions, id => id !== 'hub', f.endpoints);
  compareSpatialSnapshots(restored.snapshot(), f.slots.snapshot());
  const planar = new AttachmentSlots2D(); planar.restore(saved); equal(Object.keys(planar.snapshot().owners).length, 0, 'spatial indices do not load into planar pattern');
  restored.restore({ ...saved, dimensions: undefined }); equal(Object.keys(restored.snapshot().owners).length, 0, 'legacy planar snapshot does not become spatial');
  saved.owners.hub.rotation.w = 8; restored.restore(saved); equal(Object.keys(restored.snapshot().owners).length, 0, 'malformed quaternion is rejected');
});

test('3D hard velocity constraints keep radial motion and free collective angular motion', () => {
  const anchored = slotsFixture(); anchored.step();
  const velocities = new Map(Object.keys(anchored.positions).map(id => [id, { x: 0, y: 0, z: 0 }]));
  velocities.set('n0', { x: 5, y: 7, z: 9 });
  anchored.slots.constrainVelocities(anchored.positions, velocities, id => id !== 'hub');
  deepEqual(velocities.get('n0'), { x: 5, y: 0, z: 0 }, 'fixed ray only removes tangential velocity');
  const free = slotsFixture({ count: 6, rigidity: 'locked' }); free.step();
  const omega = { x: 0.01, y: 0.02, z: 0.03 };
  const moving = new Map(Object.entries(free.positions).map(([id, point]) => [id, { ...cross3(omega, point) }]));
  const before = structuredClone(moving);
  free.slots.constrainVelocities(free.positions, moving, id => id !== 'hub');
  for (const id of moving.keys()) near(length(subtract3(moving.get(id)!, before.get(id)!)), 0, 'collective rotation is retained', 1e-7);
});

test('3D angular springs converge in all axes and respect pinned owners', () => {
  const f = solverFixture(); const before = structuredClone(f.state.positions);
  steps(f, 500);
  for (let i = 0; i < 6; i++) near(angle3(normalize3(f.state.positions[`n${i}`]), attachmentSlotDirection3D(6, i)), 0, 'spring converges to indexed spatial direction within solver settling tolerance', 2e-4);
  deepEqual(f.state.positions.hub, origin, 'pinned hub remains fixed');
  assert(before.n0.z !== f.state.positions.n0.z, 'depth is integrated'); f.force.dispose();
});

test('3D force results rotate with quaternion-defined patterns rather than camera/world axes', () => {
  const a = solverFixture(), b = solverFixture({ count: 6, stiffness: 'firm', orientation: fixed(qx) }, qx);
  steps(a, 100); steps(b, 100);
  for (const id of Object.keys(a.state.positions)) near(length(subtract3(rotate3(qx, a.state.positions[id]), b.state.positions[id])), 0, 'rotated scene follows the same dynamics', 1e-6);
  a.force.dispose(); b.force.dispose();
});

test('3D hard angular projection survives normal forces, dragging and position patches', () => {
  const f = solverFixture({ count: 6, rigidity: 'locked', orientation: fixed() }); steps(f);
  f.force.updateSettings({ ...inert, repulsionStrength: 1000, springStrength: 0.5, springLength: 130, collisionRadius: 20 }); steps(f, 60);
  for (let i = 0; i < 6; i++) near(angle3(normalize3(f.state.positions[`n${i}`]), attachmentSlotDirection3D(6, i)), 0, 'other forces cannot break hard locks');
  f.force.onNodePositionChanged('n0', { x: 40, y: 50, z: 60 }, f.state.positions);
  f.state = { ...f.state, draggedNodeId: 'n0' }; steps(f);
  near(angle3(normalize3(f.state.positions.n0), attachmentSlotDirection3D(6, 0)), 0, 'incompatible drag returns to feasible pose');
  equal(f.force.getDiagnostics().attachmentSlots.owners.hub.bindings.length, 6, 'all occupants remain'); f.force.dispose();
});

test('3D attachment is opt-in and disabled/count-one qualities preserve existing layouts', () => {
  for (const pattern of [null, {}, { count: 1 }, { count: 6, stiffness: 'off' as const }]) {
    const f = solverFixture(pattern); const before = structuredClone(f.state.positions); deepEqual(steps(f, 20), before, 'unconfigured nodes have no new force'); f.force.dispose();
  }
});

test('disabled attachments discard restored occupancy even when the restored solver is cold', () => {
  const active = solverFixture({ count: 6, rigidity: 'locked', orientation: fixed() }); steps(active);
  const saved = JSON.parse(JSON.stringify(active.force.exportState()));
  const disabled = solverFixture({ enabled: false, count: 6, rigidity: 'locked', orientation: fixed() });
  disabled.force.restoreState({ ...saved, alpha: 0, running: false });
  equal(disabled.force.preferredTickIntervalMs(disabled.state), null, 'disabled restored attachments do not wake physics');
  equal(Object.keys(disabled.force.getDiagnostics().attachmentSlots.owners).length, 0, 'disabled node does not retain stale saved occupants');
  active.force.dispose(); disabled.force.dispose();
});

test('3D full force snapshots preserve assignments and spatial pose', () => {
  const f = solverFixture({ count: 6, rigidity: 'locked' }); steps(f, 10);
  const restored = solverFixture({ count: 6, rigidity: 'locked' });
  restored.state = { ...restored.state, positions: structuredClone(f.state.positions) };
  restored.force.restoreState(JSON.parse(JSON.stringify(f.force.exportState())) as JsonValue); steps(restored);
  compareSpatialSnapshots(restored.force.getDiagnostics().attachmentSlots, f.force.getDiagnostics().attachmentSlots);
  f.force.dispose(); restored.force.dispose();
});

test('3D orientation springs turn around spatial axes while stiffness zero preserves pose', () => {
  const turn = (stiffness: number) => {
    const f = slotsFixture({ count: 6, rigidity: 'locked', orientation: { mode: 'spring', rotation: qx, stiffness } });
    f.step(); return f.slots.snapshot().owners.hub.rotation!;
  };
  const axis = { x: 0, y: 0, z: 1 };
  const zero = turn(0), soft = turn(0.1), firm = turn(0.8);
  near(angle3(rotate3(zero, axis), axis), 0, 'zero orientation stiffness leaves spatial heading alone');
  assert(angle3(rotate3(firm, axis), rotate3(qx, axis)) < angle3(rotate3(soft, axis), rotate3(qx, axis)), 'higher orientation stiffness turns farther toward declared quaternion');
});

test('3D lock lifecycle handles reconfiguration, removed nodes and overlapping endpoints', () => {
  const f = slotsFixture(); f.step();
  const feasible = { ...f.positions.n0 }; f.positions.n0 = { ...f.positions.hub }; f.step();
  deepEqual(f.positions.n0, feasible, 'collapse returns to previous feasible geometry');
  f.connected.set('hub', f.connected.get('hub')!.filter(id => id !== 'n0')); delete f.positions.n0;
  f.endpoints.splice(0, 1); f.step();
  assert(!f.slots.snapshot().owners.hub.bindings.some(binding => binding.neighborId === 'n0'), 'deleted node releases occupancy');
  f.patterns.set('hub', { count: 4, rigidity: 'locked', orientation: fixed() }); f.step();
  assert(f.slots.snapshot().owners.hub.bindings.every(binding => binding.slot < 4), 'count change reconfigures spatial indices');
  f.patterns.clear(); f.step(); equal(Object.keys(f.slots.snapshot().owners).length, 0, 'removing quality clears owners');
});

test('3D explicit source and target indices select independent rotated patterns', () => {
  const slots = new AttachmentSlots('3d');
  const positions = { a: { ...origin }, b: { x: 100, y: 0, z: 0 } };
  const halfTurn = { x: 0, y: 0, z: 1, w: 0 };
  const patterns = new Map<string, GraphNodeAttachmentV1>([
    ['a', { count: 6, rigidity: 'locked', orientation: fixed() }],
    ['b', { count: 4, rigidity: 'spring', orientation: fixed(halfTurn) }],
  ]);
  const endpoints = [
    { edgeId: 'ab', ownerId: 'a', neighborId: 'b', endpoint: 'source' as const, slot: 0 as number | null },
    { edgeId: 'ab', ownerId: 'b', neighborId: 'a', endpoint: 'target' as const, slot: 2 as number | null },
  ];
  slots.prepare(patterns, new Map([['a', ['b']], ['b', ['a']]]), positions, id => id === 'b', endpoints);
  equal(slots.snapshot().owners.a.bindings[0].slot, 0, 'source addresses a pattern');
  equal(slots.snapshot().owners.b.bindings[0].slot, 2, 'target addresses b pattern independently');
  endpoints[1].slot = null;
  slots.prepare(patterns, new Map([['a', ['b']], ['b', ['a']]]), positions, id => id === 'b', endpoints);
  equal(slots.snapshot().owners.a.bindings[0].slot, 0, 'freeing target leaves source alone');
  equal(slots.snapshot().owners.b.bindings.length, 0, 'null releases only target');
});

test('3D many-hub lock stress keeps all indexed directions finite under repeated disturbances', () => {
  const slots = new AttachmentSlots('3d');
  const positions: Record<string, Point> = {};
  const patterns = new Map<string, GraphNodeAttachmentV1>(), connected = new Map<string, string[]>();
  const endpoints: { edgeId: string; ownerId: string; neighborId: string; endpoint: 'source'; slot: number }[] = [];
  for (let i = 0; i < 24; i++) {
    const hub = `h${i}`; positions[hub] = { x: i * 500, y: 0, z: 0 }; patterns.set(hub, { count: 6, rigidity: 'locked', orientation: fixed(qx) });
    const neighbors: string[] = [];
    for (let j = 0; j < 6; j++) {
      const neighbor = `${hub}-n${j}`, delta = scale3(rotate3(qx, attachmentSlotDirection3D(6, j)), 100);
      neighbors.push(neighbor); positions[neighbor] = { x: positions[hub].x + delta.x, y: delta.y, z: delta.z };
      endpoints.push({ edgeId: neighbor, ownerId: hub, neighborId: neighbor, endpoint: 'source', slot: j });
    }
    connected.set(hub, neighbors);
  }
  slots.prepare(patterns, connected, positions, id => id.includes('-n'), endpoints);
  for (let tick = 0; tick < 30; tick++) {
    for (const [id, p] of Object.entries(positions)) if (id.includes('-n')) { p.y += Math.sin(tick) * 2; p.z += Math.cos(tick) * 2; }
    slots.prepare(patterns, connected, positions, id => id.includes('-n'), endpoints);
    for (const [hub, owner] of Object.entries(slots.snapshot().owners)) {
      equal(owner.bindings.length, 6, 'every hub retains its complete pattern');
      for (const binding of owner.bindings) near(angle3(normalize3(subtract3(positions[binding.neighborId], positions[hub])), rotate3(qx, attachmentSlotDirection3D(6, binding.slot))), 0, 'all accepted locks remain spatially valid');
    }
    assert(Object.values(positions).every(point => [point.x, point.y, point.z].every(Number.isFinite)), 'stress coordinates remain finite');
  }
});

test('3D node edits and transient attachment animation wake settled layouts and leave declarations intact', () => {
  const f = solverFixture(null); steps(f, 20);
  f.state = { ...f.state, motionTargets: { nodeAttachments: { hub: { enabled: true, count: 6, stiffness: 'firm', orientation: fixed() } } } };
  assert(f.force.preferredTickIntervalMs(f.state) !== null, 'spatial animation wakes a settled solver'); steps(f, 30);
  equal(f.force.getDiagnostics().attachmentSlots.owners.hub.count, 6, 'spatial pattern is active');
  equal(f.state.document.nodes[0].attachment, undefined, 'animation leaves document untouched');
  f.state = { ...f.state, motionTargets: { nodeAttachments: { hub: null } } }; steps(f, 60);
  equal(Object.keys(f.force.getDiagnostics().attachmentSlots.owners).length, 0, 'null animation releases spatial bindings'); f.force.dispose();
});

test('3D attachment capabilities are available to leased consumers with client contracts and edge patches', async () => {
  const f = solverFixture({ count: 6, rigidity: 'locked', orientation: fixed(qx) });
  const value = runtimeHarness({ consumerId: 'graph-plus', profileId: 'default', registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1 });
  value.profiles.setUserOverrides('graph-plus', 'default', { dimensions: '3d' });
  const capabilities = [...new Set(createShippedGraphModuleRegistryV1().descriptors().flatMap(module => module.capabilities))];
  const provider = new GraphEngineProviderCoreV1({ engineVersion: '2.0.5', engineInstanceId: 'spatial-rc-test', capabilities, profiles: value.profiles, sessions: value.factory });
  const result = provider.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: [GRAPH_NODE_ATTACHMENT_SLOTS_3D_CAPABILITY_V1, GRAPH_EDGE_ATTACHMENT_ASSIGNMENTS_3D_CAPABILITY_V1, GRAPH_ATTACHMENT_ASSIGNMENT_POLICY_CAPABILITY_V1, GRAPH_UPDATE_API_CAPABILITY_V1] });
  assert(result.ok, 'client negotiates spatial capabilities');
  const session = await result.lease.createSession({ consumerId: 'graph-plus', profileId: 'default', container: value.container, document: f.state.document });
  try {
    const document = await session.exportDocument();
    assert((await session.setGraph(document)).applied, 'leased setGraph accepts complete graph data');
    const edge = document.edges[0];
    const applied = await session.patchGraph({ schemaVersion: 1, patchId: 'spatial-slot', baseRevision: document.revision, operations: [{ type: 'replace-edge', edge: { ...edge, attachment: { sourceSlot: 2, targetSlot: null } } }] });
    assert(applied.applied, 'consumer can reassign spatial edge endpoints');
    const exported = JSON.parse(JSON.stringify(await session.exportDocument()));
    deepEqual(exported.edges[0].attachment, { sourceSlot: 2, targetSlot: null }, 'saved edge retains explicit assignment');
    deepEqual(exported.nodes[0].attachment.orientation, fixed(qx), 'saved node retains full quaternion');
    const state = await session.exportViewState(); equal(state.dimensions, '3d', 'lease uses spatial runtime');
  } finally { f.force.dispose(); await result.lease.release(); await provider.dispose(); }
});
