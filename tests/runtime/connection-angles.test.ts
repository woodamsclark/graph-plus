import { GraphEngineProviderCoreV1 } from '../../src/graph-engine/service/GraphEngineProviderCore.ts';
import { createShippedGraphModuleRegistryV1 } from '../../src/graph-engine/runtime/modules/shipped/ShippedGraphModules.ts';
import { GRAPH_NODE_ATTACHMENT_CAPABILITY_V1 } from '../../packages/graph-engine-client/src/graph-engine/public.ts';
import { ForceLayoutModule, readForceSettings } from '../../src/graph-engine/runtime/modules/shipped/ForceLayoutModule.ts';
import { connectionAngleErrorsV1 } from '../../src/graph-engine/runtime/modules/shipped/ConnectionAngles.ts';
import { graphAttachmentRotation2DV1, isGraphNodeAttachmentV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import type { GraphNodeAttachmentV1, GraphDimensionsV1, GraphViewStateV1, Vec3 } from '../../src/graph-engine/contracts/v1/index.ts';
import type { GraphModulePipelineStateV1 } from '../../src/graph-engine/runtime/modules/GraphModuleTypes.ts';
import { DEFAULT_GRAPH_RENDER_THEME_V1 } from '../../src/graph-engine/runtime/render/index.ts';
import { GRAPH_PLUS_CONSUMER_REGISTRATION_V1 } from '../../src/graph-plus/consumer/GraphPlusRegistration.ts';
import { runtimeHarness } from '../support/runtimeHarness.ts';
import { graphDocument, graphEdge, graphNode } from '../support/contractFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

const radians = (degrees: number) => degrees * Math.PI / 180;
const near = (a: number, b: number, message: string, tolerance = 1e-8) => assert(Math.abs(a - b) < tolerance, `${message}: ${a} vs ${b}`);
const inert = { repulsionStrength: 0, springStrength: 0, centeringStrength: 0, collisionRadius: 0, alphaDecay: 0, velocityDecay: 0.4 };
const config = (count = 4): GraphNodeAttachmentV1 => ({ count, stiffness: 'firm' });

function fixture(attachment: GraphNodeAttachmentV1 | null = config(), dimensions: GraphDimensionsV1 = '2d', rotation = 0, duplicate = false) {
  const positions: Record<string, Vec3> = { hub: { x: 0, y: 0, z: 0 } };
  for (const [i, angle] of [0, 80, 188, 278].entries()) positions[`n${i}`] = {
    x: 100 * Math.cos(radians(angle) + rotation), y: 100 * Math.sin(radians(angle) + rotation), z: dimensions === '3d' ? 20 : 0,
  };
  const document = graphDocument({ nodes: Object.keys(positions).map(id => graphNode(id, id === 'hub' && attachment ? { attachment } : {})),
    edges: [0, 1, 2, 3].map(i => graphEdge(`e${i}`, 'hub', `n${i}`)).concat(duplicate ? [graphEdge('duplicate', 'hub', 'n1')] : []) });
  const viewState: GraphViewStateV1 = { schemaVersion: 1, documentId: document.documentId, documentRevision: 0,
    consumerId: 'synthetic-consumer', profileId: 'two-dimensional', dimensions, positions, pinnedNodeIds: ['hub'],
    camera: { position: { x: 0, y: 0, z: 1000 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, zoom: 1, projection: 'orthographic' },
    selectedNodeIds: [], activeFilters: {}, moduleState: {},
  };
  const selection = { nodeIds: new Set(Object.keys(positions)), edgeIds: new Set(document.edges.map(edge => edge.id)) };
  const state: GraphModulePipelineStateV1 = { sourceDocument: document, document, viewState, positions,
    projectionSelection: selection, renderSelection: selection, formActive: false, nodeRoles: {}, edgeRoles: {},
    regions: [], regionLayouts: [], nodeContributions: {}, edgeContributions: {}, regionContributions: [], theme: DEFAULT_GRAPH_RENDER_THEME_V1 };
  const force = new ForceLayoutModule(dimensions, readForceSettings(inert));
  return { force, state };
}

function step(value: ReturnType<typeof fixture>, count = 1) {
  for (let i = 0; i < count; i++) {
    const result = value.force.tick(value.state, 1 / 60);
    if (result?.positions) value.state = { ...value.state, positions: result.positions };
  }
  return value.state.positions;
}

function patternError(positions: Readonly<Record<string, Vec3>>, count = 4) {
  const hub = positions.hub;
  return connectionAngleErrorsV1([0, 1, 2, 3].map(i => Math.atan2(positions[`n${i}`].y - hub.y, positions[`n${i}`].x - hub.x)), { count })
    .reduce((sum, error) => sum + error * error, 0);
}

test('angular patterns accept numeric stiffness and presets and reject malformed rules atomically', () => {
  for (const count of [1, 2, 3, 4, 6]) for (const stiffness of ['off', 'soft', 'firm', 'stiff', 0, 0.4, 1]) {
    assert(isGraphNodeAttachmentV1({ count, stiffness }), 'valid node quality');
  }
  for (const pattern of [{ count: 0 }, { count: 2.5 }, { count: null }, { count: 4, stiffness: NaN },
    { count: 4, stiffness: 'rigid' }, { count: 4, stiffness: -1 }, { count: 4, openingDegrees: 91 }]) {
    equal(isGraphNodeAttachmentV1(pattern), false, 'malformed node quality rejected');
  }
});

test('repeated directions rotate freely for two, three, four and sixfold symmetry', () => {
  for (const count of [2, 3, 4, 6]) {
    const angles = Array.from({ length: count }, (_, i) => i * Math.PI * 2 / count + 0.371);
    for (const error of connectionAngleErrorsV1(angles, { count })) near(error, 0, 'equally spaced directions are equilibria');
  }
  for (const angles of [[0, 0.4, 2.1, 4.8], [0, Math.PI / 4], [0, Math.PI]]) {
    const a = connectionAngleErrorsV1(angles, { count: 4, openingDegrees: 12 });
    const b = connectionAngleErrorsV1(angles.map(angle => angle + 1.123), { count: 4, openingDegrees: 12 });
    a.forEach((error, i) => near(error, b[i], 'rotating the whole graph preserves angular error'));
  }
  const angles = [0, 0.02, Math.PI / 2 - 0.02];
  for (const error of connectionAngleErrorsV1(angles, { count: 4, openingDegrees: 10 })) near(error, 0, 'multiple links can share a zone');
  deepEqual(connectionAngleErrorsV1([0, 0.4, 2], { count: 6, openingDegrees: 60 }), [0, 0, 0], 'full width releases every direction');
});

test('angular springs converge, preserve pinned owners, and ignore duplicate edges', () => {
  const value = fixture(), duplicate = fixture(config(), '2d', 0, true);
  const initial = patternError(value.state.positions);
  const first = step(value), second = step(duplicate);
  deepEqual(first, second, 'parallel edges do not multiply angular forces');
  deepEqual(first.hub, { x: 0, y: 0, z: 0 }, 'pinned center stays fixed');
  const positions = step(value, 300);
  assert(patternError(positions) < initial * 1e-5, 'fourfold spring converges to repeated directions');
  for (const position of Object.values(positions)) assert(Object.values(position).every(Number.isFinite), 'finite coordinates');
});

test('angular spring dynamics are equivariant under rotation and respect dragged endpoints', () => {
  const a = fixture(), angle = 0.713, b = fixture(config(), '2d', angle);
  const first = step(a, 80), rotated = step(b, 80);
  for (const id of Object.keys(first)) {
    near(rotated[id].x, first[id].x * Math.cos(angle) - first[id].y * Math.sin(angle), 'rotated x');
    near(rotated[id].y, first[id].x * Math.sin(angle) + first[id].y * Math.cos(angle), 'rotated y');
  }
  const dragged = fixture(); dragged.state = { ...dragged.state, draggedNodeId: 'n1' };
  const original = { ...dragged.state.positions.n1 };
  deepEqual(step(dragged, 10).n1, original, 'drag authority wins over angular spring');
});

test('attachment is off by default and count one is freely attaching', () => {
  for (const value of [fixture(null), fixture({}), fixture(config(1)),
    fixture({ count: 4, stiffness: 'off' })]) {
    const initial = structuredClone(value.state.positions);
    deepEqual(step(value, 5), initial, 'unrestricted nodes preserve existing layout');
  }
  const noQuality = fixture(null);
  noQuality.force.updateSettings({ ...inert, connectionAngles: { default: config() } });
  const initial = structuredClone(noQuality.state.positions);
  deepEqual(step(noQuality, 5), initial, 'legacy graph-wide angular settings cannot enable a node quality');
});

function setAttachment(value: ReturnType<typeof fixture>, attachment: GraphNodeAttachmentV1) {
  const document = { ...value.state.document, revision: value.state.document.revision + 1,
    nodes: value.state.document.nodes.map(node => node.id === 'hub' ? { ...node, attachment } : node) };
  value.state = { ...value.state, document, sourceDocument: document };
}

test('changing node qualities and transient Anima targets wakes settled attachment springs', () => {
  const value = fixture(null);
  step(value, 20);
  const original = structuredClone(value.state.positions);
  setAttachment(value, config());
  step(value, 10);
  assert(patternError(value.state.positions) < patternError(original), 'document node quality activates springs');
  value.state = { ...value.state, motionTargets: { nodeAttachments: { hub: null } } };
  step(value, 100);
  const stopped = structuredClone(value.state.positions);
  deepEqual(step(value, 5), stopped, 'transient null releases that node');
  value.state = { ...value.state, motionTargets: { nodeAttachments: { hub: config(3) } } };
  assert(value.force.preferredTickIntervalMs(value.state) !== null, 'animation wakes sleeping layout');
  step(value, 100);
  equal(value.force.getDiagnostics().attachmentSlots.owners.hub.count, 3, 'animation changes node symmetry live');
  assert(value.force.getDiagnostics().attachmentSlots.owners.hub.bindings.length <= 3, 'animation honors slot capacity');
  deepEqual(value.state.document.nodes.find(node => node.id === 'hub')?.attachment, config(), 'animation leaves saved node quality untouched');
  value.state = { ...value.state, motionTargets: undefined };
  step(value, 150);
  equal(value.force.getDiagnostics().attachmentSlots.owners.hub.count, 4, 'ending animation returns control to the saved node quality');
});

test('leased nodes carry attachment through creation, export, JSON storage, and live patches', async () => {
  const value = runtimeHarness({ consumerId: 'graph-plus', profileId: 'default', registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1 });
  const capabilities = [...new Set(createShippedGraphModuleRegistryV1().descriptors().flatMap(module => module.capabilities))];
  const provider = new GraphEngineProviderCoreV1({ engineVersion: '2.0.5', engineInstanceId: 'angular-test',
    capabilities, profiles: value.profiles, sessions: value.factory });
  const result = provider.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1],
    requestedCapabilities: [GRAPH_NODE_ATTACHMENT_CAPABILITY_V1] });
  assert(result.ok, 'consumer negotiates node attachment capability through the generated client contract');
  const session = await result.lease.createSession({ consumerId: 'graph-plus', profileId: 'default',
    container: value.container, document: graphDocument({ nodes: [graphNode('hub', { attachment: config(6) })], edges: [] }) });
  try {
    const document = await session.exportDocument();
    deepEqual(document.nodes[0].attachment, config(6), 'node export carries attachment without separate settings');
    const stored = JSON.parse(JSON.stringify(document)) as typeof document;
    await session.replaceDocument(stored);
    const restored = await session.exportDocument();
    deepEqual(restored.nodes[0].attachment, config(6), 'saved document restores attachment');
    const patch = await session.applyPatch({ schemaVersion: 1, patchId: 'attachment-update', baseRevision: restored.revision,
      operations: [{ type: 'replace-node', node: { ...restored.nodes[0], attachment: config(3) } }] });
    assert(patch.applied, 'ordinary node patch changes attachment');
    const updated = await session.exportDocument();
    deepEqual(updated.nodes[0].attachment, config(3), 'patched quality is canonical document truth');
    const invalid = await session.applyPatch({ schemaVersion: 1, patchId: 'invalid', baseRevision: updated.revision,
      operations: [{ type: 'replace-node', node: { ...updated.nodes[0], attachment: { count: 2.5 } } }] });
    assert(!invalid.applied, 'invalid attachment patch rejected');
    deepEqual((await session.exportDocument()).nodes[0].attachment, config(3), 'rejected patch leaves saved quality intact');
  } finally { await result.lease.release(); await provider.dispose(); }
});

test('new neighbors overflow full attachment slots and removing neighbors releases occupancy', () => {
  const value = fixture();
  step(value, 200);
  const newPosition = { x: 95, y: 35, z: 0 };
  const document = { ...value.state.document, revision: 1,
    nodes: [...value.state.document.nodes, graphNode('new')],
    edges: [...value.state.document.edges, graphEdge('new-edge', 'hub', 'new')] };
  value.state = { ...value.state, document, sourceDocument: document,
    positions: { ...value.state.positions, new: newPosition } };
  step(value, 100);
  const bindings = value.force.getDiagnostics().attachmentSlots.owners.hub.bindings;
  equal(bindings.length, 4, 'existing four occupants retain the four available slots');
  assert(!bindings.some(binding => binding.neighborId === 'new'), 'overflow neighbor floats freely');
  const removed = { ...document, revision: 2, nodes: document.nodes.filter(node => node.id !== 'new'),
    edges: document.edges.filter(edge => edge.id !== 'new-edge') };
  value.state = { ...value.state, document: removed, sourceDocument: removed };
  assert(!Object.prototype.hasOwnProperty.call(step(value), 'new'), 'removed node is purged from solver buffers');
});


test('force integration enforces locked rays after other forces and retains bindings through snapshots', () => {
  const attachment: GraphNodeAttachmentV1 = { count: 4, rigidity: 'locked',
    orientation: { mode: 'locked', rotation: graphAttachmentRotation2DV1(0) } };
  const value = fixture(attachment);
  step(value);
  const bound = value.force.getDiagnostics().attachmentSlots.owners.hub.bindings;
  equal(bound.length, 4, 'four neighbors acquire the four slots');
  value.force.updateSettings({ ...inert, repulsionStrength: 1000, springStrength: 0.2, springLength: 130, collisionRadius: 10 });
  const positions = step(value, 60);
  for (const binding of bound) {
    const position = positions[binding.neighborId];
    const angle = Math.atan2(position.y, position.x);
    near(Math.atan2(Math.sin(angle - binding.slot * Math.PI / 2), Math.cos(angle - binding.slot * Math.PI / 2)), 0,
      'hard angular projection survives repulsion, collision and length forces', 1e-6);
  }
  const saved = JSON.parse(JSON.stringify(value.force.exportState())) as ReturnType<ForceLayoutModule['exportState']>;
  const restored = fixture(attachment);
  restored.state = { ...restored.state, positions: structuredClone(value.state.positions) };
  restored.force.restoreState(saved);
  step(restored);
  deepEqual(restored.force.getDiagnostics().attachmentSlots.owners.hub.bindings, bound, 'force snapshots preserve occupants');
  const originalSlot = bound.find(binding => binding.neighborId === 'n1')!.slot;
  value.state = { ...value.state, draggedNodeId: 'n1',
    positions: { ...value.state.positions, n1: { x: 80, y: 80, z: 0 } } };
  const attempted = step(value);
  const actual = Math.atan2(attempted.n1.y, attempted.n1.x);
  near(Math.atan2(Math.sin(actual - originalSlot * Math.PI / 2), Math.cos(actual - originalSlot * Math.PI / 2)), 0,
    'dragging cannot eject a locked occupant', 1e-6);
  deepEqual(value.force.getDiagnostics().attachmentSlots.owners.hub.bindings, bound, 'dragging does not reassign locked slots');
});

test('live edge patches can reassign locked connection positions through the document contract', async () => {
  const value = fixture({ count: 8, rigidity: 'locked', orientation: { mode: 'locked', rotation: graphAttachmentRotation2DV1(0) } });
  const install = (slot: number) => {
    const document = { ...value.state.document, revision: value.state.document.revision + 1,
      edges: value.state.document.edges.map(edge => edge.id === 'e1' ? { ...edge, attachment: { sourceSlot: slot } } : edge) };
    value.state = { ...value.state, document, sourceDocument: document };
  };
  install(3); step(value);
  const binding = () => value.force.getDiagnostics().attachmentSlots.owners.hub.bindings.find(binding => binding.edgeIds?.includes('e1'));
  equal(binding()?.slot, 3, 'edge selects a specific locked source position');
  install(2); step(value);
  equal(binding()?.slot, 2, 'explicit edit reconfigures that connection without global reassignment');
  const state = value.force.getDiagnostics().attachmentSlots;
  equal(state.requests?.find(request => request.edgeId === 'e1')?.status, 'bound', 'consumer can inspect effective per-link state');

  const runtime = runtimeHarness({ consumerId: 'graph-plus', profileId: 'default', registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1,
    document: value.state.document });
  const session = await runtime.create();
  try {
    const document = await session.exportDocument();
    const edge = document.edges.find(edge => edge.id === 'e1')!;
    deepEqual(edge.attachment, { sourceSlot: 2 }, 'leased document export carries requested position');
    const result = await session.applyPatch({ schemaVersion: 1, patchId: 'assign-slot', baseRevision: document.revision,
      operations: [{ type: 'replace-edge', edge: { ...edge, attachment: { sourceSlot: 5, targetSlot: null } } }] });
    assert(result.applied, 'downstream consumer assigns both endpoints using a normal edge patch');
    const exported = await session.exportDocument();
    deepEqual(exported.edges.find(edge => edge.id === 'e1')?.attachment, { sourceSlot: 5, targetSlot: null }, 'per-link assignments are canonical saved truth');
  } finally { await session.dispose(); }
});
