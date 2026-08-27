import type { GraphPatchV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import { GraphDocumentStore } from '../../src/graph-engine/core/document/index.ts';
import { graphDocument, graphEdge, graphNode } from '../support/contractFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

test('C-PATCH-01 applies a valid multi-operation patch atomically with one revision', () => {
  const store = new GraphDocumentStore(graphDocument({
    revision: 4,
    nodes: [graphNode('a'), graphNode('b'), graphNode('c')],
    edges: [graphEdge('a-b', 'a', 'b'), graphEdge('b-c', 'b', 'c')],
  }));
  const result = store.applyPatch({
    schemaVersion: 1,
    patchId: 'multi',
    baseRevision: 4,
    operations: [
      { type: 'replace-node', node: graphNode('a', { label: 'updated' }) },
      { type: 'remove-edge', edgeId: 'a-b' },
      { type: 'add-node', node: graphNode('d') },
      { type: 'add-edge', edge: graphEdge('a-d', 'a', 'd') },
      { type: 'replace-edge', edge: graphEdge('b-c', 'b', 'c', { weight: 3 }) },
      { type: 'remove-node', nodeId: 'c', removeIncidentEdges: true },
    ],
  });
  deepEqual(result, { applied: true, previousRevision: 4, revision: 5, patchId: 'multi' }, 'patch result should report one revision');
  const document = store.exportDocument();
  deepEqual(document.nodes.map((node) => node.id), ['a', 'b', 'd'], 'all node operations should commit');
  deepEqual(document.edges.map((edge) => edge.id), ['a-d'], 'all edge operations should commit');
  equal(document.nodes[0].label, 'updated', 'replacement should commit');
});

test('C-PATCH-02 rejects the entire patch when a later operation fails', () => {
  const store = new GraphDocumentStore(graphDocument());
  const before = store.exportDocument();
  const result = store.applyPatch({
    schemaVersion: 1,
    patchId: 'atomic-failure',
    baseRevision: 0,
    operations: [
      { type: 'replace-node', node: graphNode('a', { label: 'must-not-stick' }) },
      { type: 'add-node', node: graphNode('temporary') },
      { type: 'add-edge', edge: graphEdge('bad', 'temporary', 'missing') },
    ],
  });
  assert(!result.applied, 'invalid patch should fail');
  equal(result.error.operationIndex, 2, 'failing operation should be identified');
  deepEqual(store.exportDocument(), before, 'failed patch should leave no partial changes');
});

test('C-PATCH-03 rejects stale revisions without mutation', () => {
  const store = new GraphDocumentStore(graphDocument({ revision: 5 }));
  const result = store.applyPatch({
    schemaVersion: 1,
    patchId: 'stale',
    baseRevision: 4,
    operations: [{ type: 'add-node', node: graphNode('c') }],
  });
  assert(!result.applied, 'stale patch should fail');
  equal(result.error.code, 'stale-revision', 'stale code should be explicit');
  equal(store.revision, 5, 'revision should remain unchanged');
});

test('C-PATCH-04 requires explicit incident-edge removal authorization', () => {
  const source = graphDocument();
  const rejecting = new GraphDocumentStore(source);
  const rejected = rejecting.applyPatch({
    schemaVersion: 1,
    patchId: 'keep-edge',
    baseRevision: 0,
    operations: [{ type: 'remove-node', nodeId: 'a', removeIncidentEdges: false }],
  });
  assert(!rejected.applied && rejected.error.code === 'dangling-edge', 'implicit edge removal should be rejected');

  const accepting = new GraphDocumentStore(source);
  const accepted = accepting.applyPatch({
    schemaVersion: 1,
    patchId: 'remove-edge',
    baseRevision: 0,
    operations: [{ type: 'remove-node', nodeId: 'a', removeIncidentEdges: true }],
  });
  assert(accepted.applied, 'explicit edge removal should succeed');
  deepEqual(accepting.exportDocument().edges, [], 'incident edge should be removed');
});

test('C-PATCH-05 emits stable cloned patch metadata without forcing export', () => {
  const store = new GraphDocumentStore(graphDocument());
  const events: any[] = [];
  const subscription = store.onChanged((event) => events.push(event));
  const mutableNode = graphNode('c', { tokens: ['original'] });
  const patch: GraphPatchV1 = {
    schemaVersion: 1,
    patchId: 'event',
    baseRevision: 0,
    operations: [{ type: 'add-node', node: mutableNode }],
  };
  store.applyPatch(patch);
  (mutableNode.tokens as string[]).push('caller-mutation');
  equal(events.length, 1, 'one change event should be emitted');
  equal(events[0].previousRevision, 0, 'event should identify previous revision');
  equal(events[0].revision, 1, 'event should identify new revision');
  deepEqual(events[0].patch.operations[0].node.tokens, ['original'], 'event patch should not share caller arrays');
  subscription.dispose();
  store.applyPatch({
    schemaVersion: 1,
    patchId: 'after-dispose',
    baseRevision: 1,
    operations: [{ type: 'remove-node', nodeId: 'c', removeIncidentEdges: true }],
  });
  equal(events.length, 1, 'disposed listener should receive nothing further');
});

test('C-PATCH-06 replaces valid documents and preserves the prior document on rejection', () => {
  const store = new GraphDocumentStore(graphDocument());
  const events: any[] = [];
  store.onChanged((event) => events.push(event));
  store.replaceDocument(graphDocument({ documentId: 'replacement', revision: 9, nodes: [graphNode('x')], edges: [] }));
  equal(store.documentId, 'replacement', 'document identity should replace');
  equal(store.revision, 9, 'replacement revision should become active');
  equal(events[0].cause, 'replace-document', 'replacement event should identify cause');

  let threw = false;
  try {
    store.replaceDocument(graphDocument({ documentId: '', nodes: [], edges: [] }));
  } catch {
    threw = true;
  }
  equal(threw, true, 'invalid replacement should throw before commit');
  equal(store.documentId, 'replacement', 'failed replacement should preserve active document');
  equal(store.revision, 9, 'failed replacement should preserve active revision');
});

test('invalid patch shapes reject structurally instead of throwing', () => {
  const store = new GraphDocumentStore(graphDocument());
  const malformed = {
    schemaVersion: 1,
    patchId: 'malformed',
    baseRevision: 0,
    operations: [{ type: 'add-edge' }],
  } as unknown as GraphPatchV1;
  const result = store.applyPatch(malformed);
  assert(!result.applied, 'malformed operation should reject');
  equal(result.error.operationIndex, 0, 'malformed operation index should be included');
  equal(store.revision, 0, 'malformed operation should not advance revision');
});

test('C-REGION-03 replaces node regions atomically and preserves them across unrelated patches', () => {
  const source = graphDocument({
    nodes: [graphNode('tag'), graphNode('note'), graphNode('other')],
    edges: [],
  });
  const store = new GraphDocumentStore(source);
  const added = store.applyPatch({
    schemaVersion: 1,
    patchId: 'add-regions',
    baseRevision: 0,
    operations: [{
      type: 'replace-node-regions',
      nodeRegions: { version: 1, definitions: [{ regionNodeId: 'tag', directMemberNodeIds: ['note'] }] },
    }],
  });
  assert(added.applied, 'valid node regions should patch in');
  const unrelated = store.applyPatch({
    schemaVersion: 1,
    patchId: 'unrelated',
    baseRevision: 1,
    operations: [{ type: 'replace-node', node: graphNode('other', { label: 'updated' }) }],
  });
  assert(unrelated.applied, 'unrelated patch should apply');
  deepEqual(store.exportDocument().nodeRegions?.definitions, [
    { regionNodeId: 'tag', directMemberNodeIds: ['note'] },
  ], 'unrelated changes should preserve node regions');

  const before = store.exportDocument();
  const rejected = store.applyPatch({
    schemaVersion: 1,
    patchId: 'invalid-regions',
    baseRevision: 2,
    operations: [{
      type: 'replace-node-regions',
      nodeRegions: { version: 1, definitions: [{ regionNodeId: 'tag', directMemberNodeIds: ['missing'] }] },
    }],
  });
  assert(!rejected.applied, 'dangling region membership should reject the whole patch');
  deepEqual(store.exportDocument(), before, 'rejected region patch should leave the canonical document unchanged');
});
