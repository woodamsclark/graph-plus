import { GraphCameraController } from '../../src/graph-engine/runtime/camera/index.ts';
import { ForceLayoutModule, readForceSettings } from '../../src/graph-engine/runtime/modules/shipped/ForceLayoutModule.ts';
import type { GraphModulePipelineStateV1 } from '../../src/graph-engine/runtime/modules/GraphModuleTypes.ts';
import type { GraphViewStateV1, Vec3 } from '../../src/graph-engine/contracts/v1/index.ts';
import { GRAPH_PLUS_CONSUMER_REGISTRATION_V1 } from '../../src/graph-plus/consumer/GraphPlusRegistration.ts';
import { graphDocument, graphNode } from '../support/contractFixtures.ts';
import { runtimeHarness, runtimeCanvas } from '../support/runtimeHarness.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

type DragProbe = {
  viewState: GraphViewStateV1;
  moduleView: GraphModulePipelineStateV1;
  projectionView: { positions: Readonly<Record<string, Vec3>> };
  moduleHost: { active: { id: string; instance: ForceLayoutModule }[] };
  interaction: {
    beginNodeDrag(nodeId: string, point: { x: number; y: number }, preview: undefined): void;
    updateNodeDrag(nodeId: string, point: { x: number; y: number }): void;
  };
};

async function dragHarness(dimensions: '2d' | '3d', count = 1200, physics = true) {
  const value = runtimeHarness({ consumerId: 'graph-plus', profileId: 'default',
    registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1,
    document: graphDocument({ nodes: Array.from({ length: count }, (_, i) => graphNode(`n${i}`)), edges: [] }),
  });
  value.profiles.setUserOverrides('graph-plus', 'default', { dimensions, modules: {
    'force-layout': { enabled: physics, settings: { repulsionStrength: 0, springStrength: 0,
      centeringStrength: 0, collisionRadius: 0, alphaDecay: 0 } },
    anima: { settings: { cursorGravity: 'off' } },
  } });
  const session = await value.create();
  const initial = await session.exportViewState();
  const camera = new GraphCameraController(initial.camera, dimensions); camera.setViewport(640, 360);
  const depth = camera.worldToScreen(initial.camera.target).depth;
  await session.restoreViewState({ ...initial, positions: Object.fromEntries(Array.from({ length: count }, (_, i) =>
    [`n${i}`, camera.screenToWorld(120 + i % 30 * 40, 120 + Math.floor(i / 30) * 40, depth)])) });
  const advance = () => { value.platform.advanceTime(20); value.platform.flushTimer(); value.platform.flushFrame(value.platform.now()); };
  advance(); advance();
  const probe = session as unknown as DragProbe;
  const force = probe.moduleHost.active.find(module => module.id === 'force-layout')?.instance;
  return { ...value, session, probe, force, advance };
}

test('1,200-node drags retain working maps and patch one solver coordinate per update in both dimensions', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = await dragHarness(dimensions);
    try {
      const snapshot = await value.session.exportViewState();
      const snapshotJson = JSON.stringify(snapshot.positions);
      const positions = value.probe.moduleView.positions;
      const savedPositions = value.probe.viewState.positions;
      const before = value.force!.getDiagnostics();
      value.probe.interaction.beginNodeDrag('n0', { x: 120, y: 120 }, undefined);
      for (let i = 1; i <= 20; i += 1) {
        value.probe.interaction.updateNodeDrag('n0', { x: 120 + i, y: 120 });
        value.advance();
        equal(value.probe.moduleView.positions, positions, 'one-node edits keep the projection position-source identity');
        equal(value.probe.viewState.positions, savedPositions, 'one-node edits keep the private editable map');
      }
      const after = value.force!.getDiagnostics();
      equal(after.nodePositionPatches - before.nodePositionPatches, 20, 'each packet patches its solver coordinate');
      equal(after.positionBufferSynchronizations, before.positionBufferSynchronizations, 'drag edits do not resynchronize all buffers');
      equal(after.positionBufferNodeVisits, before.positionBufferNodeVisits, 'drag edits visit no unrelated solver coordinates');
      const state = await value.session.exportViewState();
      assert(JSON.stringify(state.positions.n0) !== JSON.stringify(snapshot.positions.n0), 'the dragged node actually moves');
      deepEqual(state.positions.n1199, snapshot.positions.n1199, 'an unrelated node remains unchanged');
      equal(JSON.stringify(snapshot.positions), snapshotJson, 'earlier exports retain every original coordinate');
      const original = JSON.stringify(state.positions.n0);
      (state.positions.n0 as { x: number }).x += 100;
      equal(JSON.stringify((await value.session.exportViewState()).positions.n0), original, 'editing an export cannot alter the working map');
    } finally { await value.session.dispose(); }
  }
});

test('solver position patches support borrowed and solver-owned sources while replacements still resynchronize', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = await dragHarness(dimensions, 3);
    try {
      const force = value.force!;
      const state = value.probe.moduleView;
      const borrowed = state.positions;
      const before = force.getDiagnostics();
      force.onNodePositionChanged('n0', { x: 10, y: 20, z: 30 }, borrowed);
      force.tick({ ...state, draggedNodeId: 'n0' }, 1 / 60);
      equal(force.getDiagnostics().positionBufferSynchronizations, before.positionBufferSynchronizations, 'borrowed warm sources patch directly');
      const solver = (force as unknown as { positions: Record<string, Vec3> }).positions;
      deepEqual(solver.n0, { x: 10, y: 20, z: dimensions === '2d' ? 0 : 30 }, 'patching keeps the dimensional constraint');
      const other = solver.n1;
      force.onNodePositionChanged('n0', { x: 40, y: 50, z: 60 }, solver);
      equal(solver.n1, other, 'solver-owned edits preserve unrelated buffer objects');
      const replacement = { ...borrowed, n0: { x: 70, y: 80, z: 0 } };
      force.onNodePositionChanged('n0', replacement.n0, replacement);
      equal(solver.n0.x, 40, 'a foreign source cannot prematurely patch warm buffers');
      force.tick({ ...state, positions: replacement, draggedNodeId: 'n0' }, 1 / 60);
      equal(force.getDiagnostics().positionBufferSynchronizations, before.positionBufferSynchronizations + 1, 'a replacement source performs one full synchronization');
      deepEqual(solver.n0, replacement.n0, 'restore-like replacements remain authoritative');
      const cold = new ForceLayoutModule(dimensions, readForceSettings({ repulsionStrength: 0, springStrength: 0,
        centeringStrength: 0, collisionRadius: 0, alphaDecay: 0 }));
      try {
        cold.onNodePositionChanged('n0', replacement.n0, replacement);
        equal(cold.getDiagnostics().nodePositionPatches, 0, 'an edit before the first tick waits for source initialization');
        cold.tick({ ...state, positions: replacement, draggedNodeId: 'n0' }, 1 / 60);
        deepEqual((cold as unknown as { positions: Record<string, Vec3> }).positions.n0, replacement.n0,
          'cold initialization retains the latest dragged coordinate');
      } finally { cold.dispose(); }
    } finally { await value.session.dispose(); }
  }
});

test('real pointer drag retains public snapshots, emits final positions and restores correctly with physics off', async () => {
  const value = await dragHarness('2d', 3, false);
  try {
    const canvas = runtimeCanvas(value.container);
    const before = await value.session.exportViewState();
    const beforeJson = JSON.stringify(before.positions);
    const intents: { type: string; position?: Vec3 }[] = [];
    value.session.onIntent(intent => intents.push(intent));
    const pointer = (type: string, x: number, buttons: number) => {
      const fields = { clientX: x, clientY: 120, pointerId: 711, pointerType: 'mouse', button: 0, buttons };
      const event = new value.window.PointerEvent(type, { ...fields, bubbles: true });
      for (const [key, field] of Object.entries(fields)) Object.defineProperty(event, key, { value: field });
      canvas.dispatchEvent(event as unknown as Event);
    };
    pointer('pointerdown', 120, 1); pointer('pointermove', 150, 1); value.advance();
    pointer('pointermove', 170, 1); value.advance(); pointer('pointerup', 170, 0); value.advance();
    const dragged = await value.session.exportViewState();
    equal(JSON.stringify(before.positions), beforeJson, 'earlier exported snapshots remain immutable across drag frames');
    assert(JSON.stringify(dragged.positions.n0) !== JSON.stringify(before.positions.n0), 'pointer input moves the node with no solver');
    deepEqual(dragged.positions.n1, before.positions.n1, 'drag updates preserve all other editable positions');
    deepEqual(dragged.camera, before.camera, 'Overview drag preserves the camera');
    deepEqual(dragged.pinnedNodeIds, [], 'transient drag does not persist pins');
    const ended = intents.filter(intent => intent.type === 'node-drag-ended');
    equal(ended.length, 1, 'release emits one final drag intent');
    deepEqual(ended[0].position, dragged.positions.n0, 'release reports the final position');
    await value.session.restoreViewState(before); value.advance();
    deepEqual((await value.session.exportViewState()).positions, before.positions, 'restoring an older snapshot replaces the working coordinates');
    await value.session.restoreViewState(dragged); value.advance();
    deepEqual((await value.session.exportViewState()).positions, dragged.positions, 'the persisted drag snapshot restores its final coordinates');
  } finally { await value.session.dispose(); }
});
