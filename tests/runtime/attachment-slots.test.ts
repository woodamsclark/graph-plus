import { AttachmentSlots2D } from '../../src/graph-engine/runtime/modules/shipped/AttachmentSlots2D.ts';
import { graphAttachmentRotation2DV1, isGraphNodeAttachmentV1, cloneGraphDocumentV1, type GraphNodeAttachmentV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import { graphDocument, graphNode } from '../support/contractFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

const point = (angle: number, radius = 100) => ({ x: radius * Math.cos(angle * Math.PI / 180), y: radius * Math.sin(angle * Math.PI / 180), z: 0 });
const fixed = (degrees = 0) => ({ mode: 'locked' as const, rotation: graphAttachmentRotation2DV1(degrees) });
const near = (a: number, b: number, message: string, tolerance = 1e-5) => assert(Math.abs(a - b) < tolerance, `${message}: ${a} vs ${b}`);
const angularError = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

test('finite slot capacity retains occupants and lets extra connections float', () => {
  const slots = new AttachmentSlots2D();
  const positions = { hub: point(0, 0), a: point(0), b: point(90), c: point(180), d: point(270), extra: point(12) };
  const patterns = new Map<string, GraphNodeAttachmentV1>([['hub', { count: 4, rigidity: 'locked', orientation: fixed() }]]);
  const neighbors = new Map([['hub', ['a', 'b', 'c', 'd', 'extra']]]);
  slots.prepare(patterns, neighbors, positions, id => id !== 'hub');
  const original = slots.snapshot().owners.hub.bindings;
  equal(original.length, 4, 'only four occupants bind');
  assert(!original.some(binding => binding.neighborId === 'extra'), 'overflow remains unbound');
  const free = { ...positions.extra };
  slots.prepare(patterns, new Map([['hub', ['extra', 'd', 'c', 'b', 'a']]]), positions, id => id !== 'hub');
  deepEqual(slots.snapshot().owners.hub.bindings, original, 'neighbor iteration order cannot swap existing occupants');
  deepEqual(positions.extra, free, 'locked projection leaves overflow untouched');
  neighbors.set('hub', ['extra', 'b', 'c', 'd']);
  slots.prepare(patterns, neighbors, positions, id => id !== 'hub');
  assert(slots.snapshot().owners.hub.bindings.some(binding => binding.neighborId === 'extra'), 'vacancy accepts an available neighbor');
});

test('firmer bindings resist greater disturbances; released neighbors can capture another slot', () => {
  const create = (stiffness: number) => {
    const slots = new AttachmentSlots2D(), positions = { hub: point(0, 0), a: point(0) };
    const patterns = new Map<string, GraphNodeAttachmentV1>([['hub', { count: 4, stiffness, orientation: fixed() }]]);
    const neighbors = new Map([['hub', ['a']]]);
    const step = () => slots.prepare(patterns, neighbors, positions, id => id !== 'hub');
    step(); return { slots, positions, step };
  };
  const soft = create(0.08), firm = create(0.8);
  soft.positions.a = point(30); firm.positions.a = point(30);
  soft.step(); firm.step();
  equal(soft.slots.snapshot().owners.hub.bindings.length, 0, 'soft binding releases after a smaller displacement');
  equal(firm.slots.snapshot().owners.hub.bindings[0].slot, 0, 'firm binding retains its original point');
  soft.positions.a = point(90); soft.step();
  equal(soft.slots.snapshot().owners.hub.bindings[0].slot, 1, 'released neighbor captures a different vacant point');
  firm.positions.a = point(65); firm.step();
  equal(firm.slots.snapshot().owners.hub.bindings.length, 0, 'firm binding can still break under a larger disturbance');
});

test('locked bindings cannot escape or jump slots and still permit radial movement', () => {
  const slots = new AttachmentSlots2D(), positions = { hub: point(0, 0), a: point(0) };
  const patterns = new Map<string, GraphNodeAttachmentV1>([['hub', { count: 4, rigidity: 'locked', orientation: fixed() }]]);
  const neighbors = new Map([['hub', ['a']]]);
  const step = () => slots.prepare(patterns, neighbors, positions, id => id !== 'hub');
  step(); positions.a = point(90, 170); step();
  equal(slots.snapshot().owners.hub.bindings[0].slot, 0, 'occupant keeps its slot');
  near(Math.atan2(positions.a.y, positions.a.x), 0, 'angle is geometrically locked');
  near(Math.hypot(positions.a.x, positions.a.y), 170, 'distance is not locked');
  positions.a = point(0, 0); step();
  equal(slots.snapshot().owners.hub.bindings[0].slot, 0, 'collapsing an endpoint onto its owner cannot erase a lock');
  near(Math.hypot(positions.a.x, positions.a.y), 170, 'degenerate locked movement returns to feasible geometry');
  patterns.set('hub', { count: 4, stiffness: 0.08, orientation: fixed() });
  step(); positions.a = point(70); step();
  equal(slots.snapshot().owners.hub.bindings.length, 0, 'explicitly unlocking permits release');
});

test('binding locks and pattern orientation are independent', () => {
  for (const anchored of [false, true]) {
    const slots = new AttachmentSlots2D(), positions = { hub: point(0, 0), a: point(0), b: point(90) };
    const patterns = new Map<string, GraphNodeAttachmentV1>([['hub', { count: 4, rigidity: 'locked', ...(anchored ? { orientation: fixed() } : {}) }]]);
    const neighbors = new Map([['hub', ['a', 'b']]]);
    const step = () => slots.prepare(patterns, neighbors, positions, id => id !== 'hub');
    step(); positions.a = point(25); positions.b = point(115); step();
    const a = Math.atan2(positions.a.y, positions.a.x), b = Math.atan2(positions.b.y, positions.b.x);
    near(angularError(b, a), Math.PI / 2, 'exact relative spacing');
    near(a, anchored ? 0 : 25 * Math.PI / 180, 'free pattern rotates collectively; fixed pattern does not');
  }
});

test('incompatible new locks remain unbound and incompatible moves cannot break accepted locks', () => {
  const slots = new AttachmentSlots2D(), positions = { a: point(0, 0), b: point(0) };
  const patterns = new Map<string, GraphNodeAttachmentV1>([
    ['a', { count: 4, rigidity: 'locked', orientation: fixed() }],
    ['b', { count: 3, rigidity: 'locked', orientation: fixed(90) }],
  ]);
  const neighbors = new Map([['a', ['b']], ['b', ['a']]]);
  slots.prepare(patterns, neighbors, positions, () => false);
  equal(slots.snapshot().owners.a.bindings.length, 1, 'compatible first endpoint binds');
  equal(slots.snapshot().owners.b.bindings.length, 0, 'incompatible endpoint stays free');
  assert(slots.rejectedBindings > 0, 'admission rejection is observable');
  positions.b = point(45);
  slots.prepare(patterns, neighbors, positions, () => false);
  near(positions.b.y, 0, 'incompatible pinned movement is vetoed');
  equal(slots.snapshot().owners.a.bindings.length, 1, 'accepted lock never silently releases');
});

test('binding occupants and phase survive save/restore and malformed occupancy is ignored', () => {
  const first = new AttachmentSlots2D(), positions = { hub: point(0, 0), a: point(17), b: point(107) };
  const patterns = new Map<string, GraphNodeAttachmentV1>([['hub', { count: 4, rigidity: 'locked' }]]);
  const neighbors = new Map([['hub', ['a', 'b']]]);
  first.prepare(patterns, neighbors, positions, id => id !== 'hub');
  const snapshot = first.snapshot(), restored = new AttachmentSlots2D();
  restored.restore(JSON.parse(JSON.stringify(snapshot)));
  restored.prepare(patterns, neighbors, positions, id => id !== 'hub');
  deepEqual(restored.snapshot(), snapshot, 'binding identities and freely rotating phase persist');
  restored.restore({ version: 1, owners: { hub: { count: 4, phaseRadians: 0, bindings: [{ neighborId: 'a', slot: 0 }, { neighborId: 'b', slot: 0 }] } } });
  equal(Object.keys(restored.snapshot().owners).length, 0, 'duplicate occupants cannot be restored into one slot');
});

test('orientation spring rigidity is independent and quaternion definitions are validated and cloned', () => {
  const make = (stiffness: number) => {
    const slots = new AttachmentSlots2D(), positions = { hub: point(0, 0), a: point(0) };
    slots.prepare(new Map([['hub', { count: 4, orientation: { mode: 'spring', rotation: graphAttachmentRotation2DV1(45), stiffness } }]]),
      new Map([['hub', ['a']]]), positions, id => id !== 'hub');
    return slots.snapshot().owners.hub.phaseRadians;
  };
  assert(make(0.8) > make(0.1), 'firmer orientation spring turns the pattern more strongly');
  const attachment = { count: 4, rigidity: 'locked' as const, orientation: { mode: 'locked' as const, rotation: { ...graphAttachmentRotation2DV1(35) } } };
  assert(isGraphNodeAttachmentV1(attachment), 'generic quaternion orientation accepted');
  const document = graphDocument({ nodes: [graphNode('a', { attachment })], edges: [] });
  const clone = cloneGraphDocumentV1(document);
  attachment.orientation.rotation.z = 0;
  assert(clone.nodes[0].attachment?.orientation?.mode === 'locked', 'orientation preserved');
  assert(clone.nodes[0].attachment.orientation.rotation.z !== 0, 'nested quaternion copied by value');
  for (const orientation of [{ mode: 'locked' }, { mode: 'free', rotation: graphAttachmentRotation2DV1(0) },
    { mode: 'locked', rotation: { x: 0, y: 0, z: 0, w: 2 } }, { mode: 'spring', rotation: graphAttachmentRotation2DV1(0), stiffness: NaN }]) {
    assert(!isGraphNodeAttachmentV1({ count: 4, orientation }), 'invalid orientation rejected');
  }
});

test('explicit edge assignments persist until edited and clearing them restores automatic jumping', () => {
  const slots = new AttachmentSlots2D(), positions = { hub: point(0, 0), a: point(0) };
  const patterns = new Map<string, GraphNodeAttachmentV1>([['hub', { count: 4, stiffness: 'soft', orientation: fixed() }]]);
  const neighbors = new Map([['hub', ['a']]]);
  const endpoint = (slot?: number | null) => [{ edgeId: 'ha', ownerId: 'hub', neighborId: 'a', endpoint: 'source' as const, slot }];
  const run = (slot?: number | null) => slots.prepare(patterns, neighbors, positions, id => id !== 'hub', endpoint(slot));
  const springs = run(1);
  equal(slots.snapshot().owners.hub.bindings[0].slot, 1, 'plugin can assign a slot beyond the automatic capture threshold');
  assert(springs.length === 1 && springs[0].error !== 0, 'spring drives the explicitly assigned target');
  positions.a = point(270);
  for (let i = 0; i < 10; i++) run(1);
  equal(slots.snapshot().owners.hub.bindings[0].slot, 1, 'disturbance cannot reassign an explicit reservation');
  equal(slots.snapshot().requests?.[0].status, 'bound', 'effective assignment is queryable by link endpoint');
  run(0);
  equal(slots.snapshot().owners.hub.bindings[0].slot, 0, 'explicit request can reassign the occupant');
  positions.a = point(70); run();
  equal(slots.snapshot().owners.hub.bindings.length, 0, 'clearing assignment restores release behavior');
  positions.a = point(90); run();
  equal(slots.snapshot().owners.hub.bindings[0].slot, 1, 'automatic link can acquire another slot');
  run(null);
  equal(slots.snapshot().owners.hub.bindings.length, 0, 'null explicitly unbinds this endpoint');
  equal(slots.snapshot().requests?.[0].status, 'free', 'explicit free status is observable');
});

test('source and target assignments address different node patterns independently', () => {
  const slots = new AttachmentSlots2D(), positions = { hub: point(0, 0), leaf: point(0) };
  const pattern: GraphNodeAttachmentV1 = { count: 4, rigidity: 'locked', orientation: fixed() };
  const patterns = new Map([['hub', pattern], ['leaf', pattern]]);
  const neighbors = new Map([['hub', ['leaf']], ['leaf', ['hub']]]);
  const endpoints = [
    { edgeId: 'link', ownerId: 'hub', neighborId: 'leaf', endpoint: 'source' as const, slot: 1 },
    { edgeId: 'link', ownerId: 'leaf', neighborId: 'hub', endpoint: 'target' as const, slot: 3 },
  ];
  slots.prepare(patterns, neighbors, positions, id => id !== 'hub', endpoints);
  equal(slots.snapshot().owners.hub.bindings[0].slot, 1, 'source slot belongs to hub');
  equal(slots.snapshot().owners.leaf.bindings[0].slot, 3, 'target slot belongs to leaf');
  assert(slots.snapshot().requests?.every(request => request.status === 'bound'), 'both endpoint assignments satisfied');
  near(positions.leaf.x, 0, 'geometry follows the requested source direction');
  assert(positions.leaf.y > 0, 'source slot one points along world +Y');
});

test('occupied and out-of-range explicit requests stay unbound instead of using another slot', () => {
  const slots = new AttachmentSlots2D();
  const positions = { hub: point(0, 0), a: point(0), b: point(90), c: point(180), d: point(270), extra: point(12) };
  const pattern: GraphNodeAttachmentV1 = { count: 4, rigidity: 'locked', orientation: fixed() };
  const patterns = new Map([['hub', pattern]]);
  const neighbors = new Map([['hub', ['a', 'b', 'c', 'd']]]);
  slots.prepare(patterns, neighbors, positions, id => id !== 'hub');
  neighbors.set('hub', ['a', 'b', 'c', 'd', 'extra']);
  const requests = [
    { edgeId: 'new-link', ownerId: 'hub', neighborId: 'extra', endpoint: 'source' as const, slot: 3 as number | null },
    { edgeId: 'old-link', ownerId: 'hub', neighborId: 'd', endpoint: 'source' as const, slot: undefined as number | null | undefined },
  ];
  const run = () => slots.prepare(patterns, neighbors, positions, id => id !== 'hub', requests.map(request => ({ ...request })));
  run();
  equal(slots.snapshot().requests?.[0].status, 'occupied', 'occupied target is reported');
  assert(!slots.snapshot().owners.hub.bindings.some(binding => binding.neighborId === 'extra'), 'no fallback into another slot');
  requests[1].slot = null; run();
  assert(slots.snapshot().owners.hub.bindings.some(binding => binding.neighborId === 'extra' && binding.slot === 3), 'requested link acquires the vacated position');
  requests[0].slot = 7; run();
  equal(slots.snapshot().requests?.[0].status, 'out-of-range', 'out-of-range request remains explicit');
  assert(!slots.snapshot().owners.hub.bindings.some(binding => binding.neighborId === 'extra'), 'invalid index is not clamped or wrapped');
  patterns.set('hub', { ...pattern, count: 8 }); run();
  assert(slots.snapshot().owners.hub.bindings.some(binding => binding.neighborId === 'extra' && binding.slot === 7), 'request activates when the node later offers that position');
});

test('parallel links share geometry and retain a stable controlling assignment through restore', () => {
  const slots = new AttachmentSlots2D(), positions = { hub: point(0, 0), a: point(0) };
  const patterns = new Map<string, GraphNodeAttachmentV1>([['hub', { count: 4, rigidity: 'locked', orientation: fixed() }]]);
  const neighbors = new Map([['hub', ['a']]]);
  const original = { edgeId: 'z-first', ownerId: 'hub', neighborId: 'a', endpoint: 'source' as const, slot: 0 };
  const later = { ...original, edgeId: 'a-later', slot: 1 };
  slots.prepare(patterns, neighbors, positions, id => id !== 'hub', [original]);
  slots.prepare(patterns, neighbors, positions, id => id !== 'hub', [later, original]);
  const snapshot = slots.snapshot();
  equal(snapshot.owners.hub.bindings[0].slot, 0, 'new parallel claim cannot steal control');
  deepEqual(snapshot.owners.hub.bindings[0].edgeIds, ['a-later', 'z-first'], 'effective binding identifies every parallel link');
  equal(snapshot.requests?.find(request => request.edgeId === 'a-later')?.status, 'conflicting', 'incompatible parallel claim is reported');
  const restored = new AttachmentSlots2D();
  restored.restore(JSON.parse(JSON.stringify(snapshot)));
  restored.prepare(patterns, neighbors, positions, id => id !== 'hub', [later, original]);
  deepEqual(restored.snapshot(), snapshot, 'per-link control and occupancy survive saving');
  restored.prepare(new Map(), neighbors, positions, id => id !== 'hub', [original]);
  equal(restored.snapshot().requests?.[0].status, 'inactive', 'a slot request does not enable a node attachment quality');
});
