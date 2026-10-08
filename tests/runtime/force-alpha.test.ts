import { ForceLayoutModule, readForceSettings } from '../../src/graph-engine/runtime/modules/shipped/ForceLayoutModule.ts';
import type { GraphModulePipelineStateV1 } from '../../src/graph-engine/runtime/modules/GraphModuleTypes.ts';
import type { GraphViewStateV1, JsonValue, Vec3 } from '../../src/graph-engine/contracts/v1/index.ts';
import { DEFAULT_GRAPH_RENDER_THEME_V1 } from '../../src/graph-engine/runtime/render/index.ts';
import { graphDocument, graphEdge, graphNode } from '../support/contractFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

function alphaFixture(dimensions: '2d' | '3d') {
  const positions = { a: { x: -200, y: 0, z: dimensions === '3d' ? -100 : 0 },
    b: { x: 200, y: 0, z: dimensions === '3d' ? 100 : 0 } };
  const document = graphDocument({ nodes: [graphNode('a'), graphNode('b')], edges: [graphEdge('ab', 'a', 'b')] });
  const viewState: GraphViewStateV1 = { schemaVersion: 1, documentId: document.documentId, documentRevision: 0,
    consumerId: 'synthetic-consumer', profileId: 'two-dimensional', dimensions, positions, pinnedNodeIds: [],
    camera: { position: { x: 0, y: 0, z: 1000 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 },
      zoom: 1, projection: dimensions === '2d' ? 'orthographic' : 'perspective' },
    selectedNodeIds: [], activeFilters: {}, moduleState: {},
  };
  const selection = { nodeIds: new Set(['a', 'b']), edgeIds: new Set(['ab']) };
  const state: GraphModulePipelineStateV1 = { sourceDocument: document, document, viewState, positions,
    projectionSelection: selection, renderSelection: selection, formActive: false, nodeRoles: {}, edgeRoles: {},
    regions: [], regionLayouts: [], nodeContributions: {}, edgeContributions: {}, regionContributions: [],
    theme: DEFAULT_GRAPH_RENDER_THEME_V1 };
  const force = new ForceLayoutModule(dimensions, readForceSettings({ repulsionStrength: 0, centeringStrength: 0,
    collisionRadius: 0, springStrength: 1, springLength: 250, alphaDecay: 0, velocityDecay: 0.4 }));
  return { force, state };
}

type Snapshot = { alpha: number; alphaTarget: number; running: boolean; velocities: Record<string, Vec3> };
function restore(force: ForceLayoutModule, alpha: number, alphaTarget: JsonValue = 0, running = true): void {
  force.restoreState({ schemaVersion: 1, alpha, alphaTarget, running, velocities: {} });
}

test('force coefficient changes reuse topology and match freshly derived spring behavior', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const fixture = alphaFixture(dimensions);
    const force = fixture.force;
    let state = fixture.state;
    let settings: Record<string, JsonValue> = { repulsionStrength: 0, centeringStrength: 0,
      collisionRadius: 0, springStrength: 1, springLength: 250, alphaDecay: 0, velocityDecay: 0.4 };
    try {
      const first = force.tick(state, 1 / 60);
      assert(first?.positions, 'the fixture should build its initial force topology');
      state = { ...state, positions: structuredClone(first.positions) };
      const analyses = force.getDiagnostics().topologyAnalysisCount;
      for (const [key, value] of [
        ['springStrength', 0.2], ['springLength', 100], ['springStrength', 0.6],
        ['repulsionStrength', 1500], ['centeringStrength', 0.25], ['collisionRadius', 20],
        ['componentPadding', 150], ['collisionStrength', 0.4], ['axialSpringAxis', 'x'],
        ['axialSpringStiffness', 0.4],
      ] as const) {
        settings = { ...settings, [key]: value };
        force.updateSettings(settings);
        const reference = new ForceLayoutModule(dimensions, readForceSettings(settings));
        try {
          reference.restoreState(force.exportState());
          const expected = reference.tick({ ...state, positions: structuredClone(state.positions) }, 1 / 60);
          const actual = force.tick(state, 1 / 60);
          assert(actual?.positions && expected?.positions, 'both settings paths should produce live positions');
          for (const id of ['a', 'b']) for (const axis of ['x', 'y', 'z'] as const) {
            assert(Math.abs(actual.positions[id][axis] - expected.positions[id][axis]) < 1e-8,
              `${key} must use fresh coefficients with cached topology in ${dimensions}`);
          }
          equal(force.getDiagnostics().topologyAnalysisCount, analyses, `${key} must not rerun topology analysis`);
          state = { ...state, positions: structuredClone(actual.positions) };
        } finally { reference.dispose(); }
      }
      const policy = readForceSettings(settings).topologyLayoutPolicy;
      force.updateSettings({ ...settings, topologyLayoutPolicy: JSON.parse(JSON.stringify({ ...policy,
        defaultPairPolicy: { ...policy.defaultPairPolicy, spring: { ...policy.defaultPairPolicy.spring, strengthExponent: 2 } },
      })) });
      force.tick(state, 1 / 60);
      equal(force.getDiagnostics().topologyAnalysisCount, analyses + 1, 'a topology policy change must still invalidate analysis');
      force.onDocumentChanged(); force.tick(state, 1 / 60);
      equal(force.getDiagnostics().topologyAnalysisCount, analyses + 2, 'a document change must still invalidate topology');
    } finally { force.dispose(); }
  }
});

test('unchanged force coefficients and damping-only edits retain cooled physics and topology', () => {
  const { force, state } = alphaFixture('2d');
  const settings = { repulsionStrength: 0, centeringStrength: 0, collisionRadius: 0,
    springStrength: 1, springLength: 250, alphaDecay: 0, velocityDecay: 0.4 };
  try {
    force.tick(state, 1 / 60);
    restore(force, 0.25, 0, false);
    const analyses = force.getDiagnostics().topologyAnalysisCount;
    force.updateSettings(settings);
    equal(force.getDiagnostics().alpha, 0.25, 'an identical profile refresh should not reheat');
    equal(force.getDiagnostics().running, false, 'identical settings should not wake settled physics');
    force.updateSettings({ ...settings, velocityDecay: 0.7 });
    equal(force.getDiagnostics().alpha, 0.25, 'damping should retain the existing alpha');
    force.tick(state, 1 / 60);
    equal(force.getDiagnostics().topologyAnalysisCount, analyses, 'damping must not rerun topology analysis');
  } finally { force.dispose(); }
});

test('alpha diagnostics derive simulation rate from cadence without changing tick frequency', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const { force } = alphaFixture(dimensions);
    try {
      for (const alpha of [0, 0.25, 0.5, 1]) {
        restore(force, alpha);
        const diagnostics = force.getDiagnostics();
        equal(diagnostics.targetStepRateHz, 60, 'active callback cadence stays at 60 Hz at every alpha');
        equal(diagnostics.effectiveSimulationRateHz, 60 * alpha, 'simulation rate is cadence times transition fraction');
        equal('effectiveStepRateHz' in diagnostics, false, 'the misleading internal diagnostic name is retired');
      }
      restore(force, 0.5, 1, false);
      equal(force.getDiagnostics().targetStepRateHz, 0, 'stopped physics requests no ticks');
      equal(force.getDiagnostics().effectiveSimulationRateHz, 0, 'stopped physics advances no simulation regardless of saved alpha');
    } finally { force.dispose(); }
  }
});

test('legacy alphaTarget remains compatible metadata and cannot attract or reheat alpha', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const left = alphaFixture(dimensions); const right = alphaFixture(dimensions);
    try {
      restore(left.force, 0.5, 0); restore(right.force, 0.5, 1);
      equal((right.force.exportState() as unknown as Snapshot).alphaTarget, 1, 'V1 metadata survives initial round-trip');
      for (let i = 0; i < 20; i++) {
        const a = left.force.tick(left.state, 1 / 60); const b = right.force.tick(right.state, 1 / 60);
        assert(a?.positions && b?.positions, 'both fixtures apply the same ordinary force transition');
        deepEqual(a.positions, b.positions, 'different legacy targets produce identical geometry');
        deepEqual(left.force.exportState(), right.force.exportState(), 'legacy targets do not alter velocities, activity or cooling');
        left.state = { ...left.state, positions: a.positions };
        right.state = { ...right.state, positions: b.positions };
      }
      for (const [saved, expected] of [[-1, 0], [4, 1], [0.375, 0.375], ['unused', 0]] as const) {
        restore(left.force, 0.5, saved);
        equal((left.force.exportState() as unknown as Snapshot).alphaTarget, expected, 'legacy metadata keeps its old normalization');
      }
      left.force.restoreState({ schemaVersion: 1, alpha: 0.5, running: true, velocities: {} });
      equal((left.force.exportState() as unknown as Snapshot).alphaTarget, 0, 'snapshots with no legacy field still restore');
    } finally { left.force.dispose(); right.force.dispose(); }
  }
});

test('alpha applies the same fraction to ordinary position and velocity transitions in both dimensions', () => {
  for (const dimensions of ['2d', '3d'] as const) for (const moving of [false, true]) {
    const hot = alphaFixture(dimensions); const cool = alphaFixture(dimensions);
    try {
      const velocities = { a: { x: moving ? 3 : 0, y: moving ? 2 : 0, z: moving && dimensions === '3d' ? 1 : 0 },
        b: { x: moving ? -2 : 0, y: moving ? -1 : 0, z: moving && dimensions === '3d' ? -1 : 0 } };
      hot.force.restoreState({ schemaVersion: 1, alpha: 1, alphaTarget: 0, running: true, velocities });
      cool.force.restoreState({ schemaVersion: 1, alpha: 0.5, alphaTarget: 0, running: true, velocities });
      const a = hot.force.tick(hot.state, 1 / 60); const b = cool.force.tick(cool.state, 1 / 60);
      assert(a?.positions && b?.positions, 'both activity levels advance their ordinary transition');
      const hotSaved = hot.force.exportState() as unknown as Snapshot;
      const coolSaved = cool.force.exportState() as unknown as Snapshot;
      for (const id of ['a', 'b'] as const) for (const axis of ['x', 'y', 'z'] as const) {
        const full = a.positions[id][axis] - hot.state.positions[id][axis];
        const half = b.positions[id][axis] - cool.state.positions[id][axis];
        assert(Math.abs(half - full * 0.5) < 1e-10, 'half alpha applies half the position transition');
        const fullVelocityChange = hotSaved.velocities[id][axis] - velocities[id][axis];
        const halfVelocityChange = coolSaved.velocities[id][axis] - velocities[id][axis];
        assert(Math.abs(halfVelocityChange - fullVelocityChange * 0.5) < 1e-10,
          'half alpha applies half the velocity transition from the existing velocity');
      }
    } finally { hot.force.dispose(); cool.force.dispose(); }
  }
});

test('drag and Space diagnostics reflect full alpha while override release restores prior compatible state', () => {
  const { force, state } = alphaFixture('2d');
  try {
    restore(force, 0.25, 0.375);
    const before = force.exportState();
    force.preferredTickIntervalMs({ ...state, physicsOverrideHeld: true });
    equal(force.getDiagnostics().effectiveSimulationRateHz, 60, 'Space temporarily applies an ordinary full transition');
    equal((force.exportState() as unknown as Snapshot).alphaTarget, 1, 'Space keeps compatible V1 activity metadata');
    force.preferredTickIntervalMs(state);
    deepEqual(force.exportState(), before, 'override release restores prior alpha, running state and legacy metadata');
    force.tick({ ...state, draggedNodeId: 'a' }, 1 / 60);
    equal(force.getDiagnostics().alpha, 1, 'drag retains its existing full-alpha behavior');
    equal(force.getDiagnostics().effectiveSimulationRateHz, 60, 'drag simulation rate agrees with the active cadence');
    equal((force.exportState() as unknown as Snapshot).alphaTarget, 1, 'drag export keeps the V1 activity marker');
    force.tick(state, 1 / 60);
    equal((force.exportState() as unknown as Snapshot).alphaTarget, 0, 'release clears the legacy activity marker');
  } finally { force.dispose(); }
});
