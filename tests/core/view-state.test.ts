import type { GraphViewStateV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import {
  InvalidGraphViewStateErrorV1,
  cloneGraphViewStateV1,
  reconcileGraphViewStateV1,
  validateGraphViewStateV1,
} from '../../src/graph-engine/core/state/index.ts';
import { graphDocument, graphNode } from '../support/contractFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

function viewState(overrides: Partial<GraphViewStateV1> = {}): GraphViewStateV1 {
  return {
    schemaVersion: 1,
    documentId: 'fixture',
    documentRevision: 0,
    consumerId: 'xyz',
    profileId: 'default',
    dimensions: '2d',
    positions: { a: { x: 1, y: 2, z: 0 }, b: { x: 3, y: 4, z: 0 } },
    pinnedNodeIds: ['a'],
    camera: {
      position: { x: 0, y: 0, z: 10 },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      zoom: 1,
      projection: 'orthographic',
    },
    selectedNodeIds: ['b'],
    focusedNodeId: 'a',
    activeFilters: {
      render: { schemaVersion: 1, scope: 'render', node: { op: 'has-token', token: 'visible' } },
    },
    moduleState: { filtering: { open: true }, anima: null },
    ...overrides,
  };
}

test('C-VIEW-02 clones complete compatible view state without sharing containers', () => {
  const source = viewState();
  const clone = cloneGraphViewStateV1(source);
  deepEqual(clone, source, 'all supported view state should round-trip');
  assert(clone !== source && clone.positions !== source.positions && clone.camera !== source.camera, 'round-trip should clone containers');
  (source.positions.a as { x: number }).x = 99;
  equal(clone.positions.a.x, 1, 'position objects should not be shared');
});

test('C-VIEW-03 reconciles older state by stable node IDs', () => {
  const state = viewState({
    documentRevision: 2,
    positions: { a: { x: 1, y: 2, z: 0 }, removed: { x: 8, y: 8, z: 0 } },
    pinnedNodeIds: ['a', 'removed'],
    selectedNodeIds: ['removed'],
    focusedNodeId: 'removed',
  });
  const document = graphDocument({ revision: 5, nodes: [graphNode('a'), graphNode('new')], edges: [] });
  const reconciled = reconcileGraphViewStateV1(state, {
    document,
    consumerId: 'xyz',
    profileId: 'default',
    dimensions: '2d',
  });
  equal(reconciled.documentRevision, 5, 'active document revision should replace saved revision');
  deepEqual(reconciled.positions, { a: { x: 1, y: 2, z: 0 } }, 'unknown positions should be dropped');
  deepEqual(reconciled.pinnedNodeIds, ['a'], 'unknown pins should be dropped');
  deepEqual(reconciled.selectedNodeIds, [], 'unknown selections should be dropped');
  equal(reconciled.focusedNodeId, undefined, 'unknown focus should be dropped');
});

test('C-VIEW-04 rejects incompatible identity without mutating current state', () => {
  const source = viewState();
  const document = graphDocument();
  for (const context of [
    { document: graphDocument({ documentId: 'other' }), consumerId: 'xyz', profileId: 'default', dimensions: '2d' as const },
    { document, consumerId: 'other', profileId: 'default', dimensions: '2d' as const },
    { document, consumerId: 'xyz', profileId: 'other', dimensions: '2d' as const },
    { document, consumerId: 'xyz', profileId: 'default', dimensions: '3d' as const },
  ]) {
    let threw = false;
    try {
      reconcileGraphViewStateV1(source, context);
    } catch (error) {
      threw = error instanceof InvalidGraphViewStateErrorV1;
    }
    equal(threw, true, 'incompatible identity should fail structurally');
  }
  equal(source.focusedNodeId, 'a', 'failed reconciliation should not mutate source state');
});

test('C-VIEW-07 supports a generic consumer persistence round-trip', () => {
  const persisted = JSON.parse(JSON.stringify(viewState())) as unknown;
  deepEqual(validateGraphViewStateV1(persisted), [], 'JSON-persisted view state should validate on reload');
  const restored = reconcileGraphViewStateV1(persisted as GraphViewStateV1, {
    document: graphDocument(),
    consumerId: 'xyz',
    profileId: 'default',
    dimensions: '2d',
  });
  const nextExport = cloneGraphViewStateV1({ ...restored, selectedNodeIds: ['a'] });
  deepEqual(nextExport.selectedNodeIds, ['a'], 'consumer should be able to export updated state for its own storage');
});

test('view-state validation rejects schemas, non-finite values, mismatched filters, and runtime fields', () => {
  const invalid = viewState() as any;
  invalid.schemaVersion = 2;
  invalid.camera.zoom = Number.NaN;
  invalid.activeFilters.render.scope = 'projection';
  invalid.positions.a.velocity = { x: 1, y: 1, z: 1 };
  invalid.moduleState.bad = { value: Number.POSITIVE_INFINITY };
  const errors = validateGraphViewStateV1(invalid);
  equal(errors.length >= 5, true, 'each invalid persisted value should be reported');
});
