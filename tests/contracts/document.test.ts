import {
  InvalidGraphDocumentErrorV1,
  assertGraphDocumentV1,
  cloneGraphDocumentV1,
  createGraphDocumentBuilderV1,
  validateGraphDocumentV1,
  type GraphDocumentV1,
} from '../../src/graph-engine/contracts/v1/index.ts';
import { graphDocument, graphEdge, graphNode } from '../support/contractFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

test('C-DOC-01 validates a minimal host-neutral document', () => {
  const document: GraphDocumentV1 = {
    schemaVersion: 1,
    documentId: 'minimal',
    revision: 0,
    nodes: [graphNode('only')],
    edges: [],
  };
  deepEqual(validateGraphDocumentV1(document), { valid: true }, 'minimal document should validate');
  equal(JSON.stringify(document).includes('TFile'), false, 'document should contain no Obsidian reference');
});

test('C-DOC-02 round-trips opaque rich values without interpretation', () => {
  const document = graphDocument({
    nodes: [
      graphNode('a', {
        tokens: ['consumer:opaque', 'due'],
        attributes: {
          text: 'value',
          count: 3,
          enabled: true,
          absent: null,
          mixed: ['x', 2, false, null],
        },
        positionHint: { x: 1, y: -2, z: 3 },
      }),
      graphNode('b'),
    ],
    edges: [
      graphEdge('first', 'a', 'b', { directed: true, weight: -2, tokens: ['relation:x'] }),
      graphEdge('parallel', 'a', 'b', { weight: 4 }),
    ],
  });
  const clone = cloneGraphDocumentV1(document);
  deepEqual(clone, document, 'rich values should round-trip exactly');
  assert(clone !== document && clone.nodes !== document.nodes, 'round-trip should clone public containers');
});

test('C-DOC-03 rejects empty and duplicate IDs', () => {
  const result = validateGraphDocumentV1(graphDocument({
    documentId: ' ',
    nodes: [graphNode('same'), graphNode('same'), graphNode('')],
    edges: [graphEdge('edge', 'same', 'same'), graphEdge('edge', 'same', 'same')],
  }));
  assert(!result.valid, 'invalid IDs should fail');
  const codes = new Set(result.errors.map((entry) => entry.code));
  assert(codes.has('invalid-document-id'), 'empty document ID should be identified');
  assert(codes.has('duplicate-node-id'), 'duplicate node ID should be identified');
  assert(codes.has('duplicate-edge-id'), 'duplicate edge ID should be identified');
  assert(codes.has('invalid-node'), 'empty node ID should be identified');
});

test('C-DOC-04 rejects dangling edge endpoints', () => {
  const result = validateGraphDocumentV1(graphDocument({
    nodes: [graphNode('a')],
    edges: [graphEdge('dangling', 'a', 'missing')],
  }));
  assert(!result.valid, 'dangling endpoint should fail');
  assert(result.errors.some((entry) => entry.code === 'dangling-edge' && entry.path.endsWith('.targetId')), 'target path should be reported');
});

test('C-DOC-05 rejects non-finite and nested attribute values', () => {
  const value = graphDocument() as any;
  value.nodes[0] = {
    ...value.nodes[0],
    positionHint: { x: Number.NaN, y: 0, z: 0 },
    attributes: { nested: { forbidden: true }, infinity: Number.POSITIVE_INFINITY },
  };
  value.edges[0] = { ...value.edges[0], weight: Number.NEGATIVE_INFINITY };
  const result = validateGraphDocumentV1(value);
  assert(!result.valid, 'invalid numeric and nested values should fail');
  equal(result.errors.filter((entry) => entry.code === 'invalid-value').length >= 4, true, 'each invalid value should be identified');
});

test('public documents reject legacy runtime and Obsidian fields', () => {
  const value = graphDocument() as any;
  value.nodes[0] = {
    ...value.nodes[0],
    file: { path: 'A.md' },
    anima: { level: 2 },
    location: { x: 1, y: 2, z: 3 },
  };
  value.edges[0] = { ...value.edges[0], gate: { state: 'closed' } };
  const result = validateGraphDocumentV1(value);
  assert(!result.valid, 'private legacy fields should fail at the public boundary');
  const paths = result.errors.map((entry) => entry.path);
  assert(paths.includes('$.nodes[0].file'), 'Obsidian file reference should be rejected');
  assert(paths.includes('$.nodes[0].anima'), 'Anima state should be rejected');
  assert(paths.includes('$.nodes[0].location'), 'runtime position should be rejected');
  assert(paths.includes('$.edges[0].gate'), 'gate state should be rejected');
});

test('C-DOC-06 builder and direct input share validation and output semantics', () => {
  const direct = graphDocument({
    documentId: 'builder',
    revision: 7,
    nodes: [graphNode('a'), graphNode('b')],
    edges: [graphEdge('a-b', 'a', 'b')],
  });
  const built = createGraphDocumentBuilderV1()
    .addNode(graphNode('a'))
    .addNode(graphNode('b'))
    .addEdge(graphEdge('a-b', 'a', 'b'))
    .build({ documentId: 'builder', revision: 7 });
  deepEqual(built, direct, 'builder should produce equivalent structure');

  let thrown: unknown;
  try {
    createGraphDocumentBuilderV1()
      .addEdge(graphEdge('bad', 'missing', 'also-missing'))
      .build({ documentId: 'invalid' });
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof InvalidGraphDocumentErrorV1, 'builder should enforce the same validation rules');
});

test('C-DOC-07 cloned documents do not share mutable public containers', () => {
  const source = graphDocument({
    nodes: [graphNode('a', { tokens: ['original'], attributes: { values: ['one'] } }), graphNode('b')],
  });
  const clone = cloneGraphDocumentV1(source);
  (source.nodes[0].tokens as string[]).push('mutated');
  (source.nodes[0].attributes!.values as string[]).push('two');
  deepEqual(clone.nodes[0].tokens, ['original'], 'token array should not be shared');
  deepEqual(clone.nodes[0].attributes!.values, ['one'], 'attribute array should not be shared');
});

test('C-REGION-01 validates, builds, and clones nested and overlapping node regions', () => {
  const nodes = ['quotes', 'quotes/jung', 'quotes/watts', 'shared', 'jung-note', 'watts-note']
    .map((id) => graphNode(id));
  const nodeRegions = {
    version: 1 as const,
    definitions: [
      { regionNodeId: 'quotes', directMemberNodeIds: ['quotes/jung', 'quotes/watts', 'shared'] },
      { regionNodeId: 'quotes/jung', directMemberNodeIds: ['jung-note', 'shared'] },
      { regionNodeId: 'quotes/watts', directMemberNodeIds: ['watts-note', 'shared'] },
    ],
  };
  const document = graphDocument({ nodes, edges: [], nodeRegions });
  deepEqual(validateGraphDocumentV1(document), { valid: true }, 'nested and overlapping membership should validate');
  const built = createGraphDocumentBuilderV1();
  for (const node of nodes) built.addNode(node);
  const output = built.setNodeRegions(nodeRegions).build({ documentId: 'regions' });
  deepEqual(output.nodeRegions, nodeRegions, 'the builder should retain explicit direct membership');
  const clone = cloneGraphDocumentV1(document);
  assert(clone.nodeRegions !== document.nodeRegions, 'region containers should be defensively cloned');
  assert(clone.nodeRegions?.definitions[0].directMemberNodeIds !== nodeRegions.definitions[0].directMemberNodeIds, 'member arrays should not be shared');
});

test('C-REGION-02 rejects duplicate, dangling, self, and recursive region membership', () => {
  const result = validateGraphDocumentV1(graphDocument({
    nodes: ['a', 'b', 'leaf'].map((id) => graphNode(id)),
    edges: [],
    nodeRegions: {
      version: 1,
      definitions: [
        { regionNodeId: 'a', directMemberNodeIds: ['b', 'b', 'missing'] },
        { regionNodeId: 'b', directMemberNodeIds: ['a'] },
        { regionNodeId: 'a', directMemberNodeIds: ['a', 'leaf'] },
      ],
    },
  }));
  assert(!result.valid, 'invalid region membership should fail');
  const codes = new Set(result.errors.map((entry) => entry.code));
  assert(codes.has('duplicate-region-node-id'), 'duplicate definitions should be identified');
  assert(codes.has('duplicate-region-member'), 'duplicate direct members should be identified');
  assert(codes.has('dangling-region-node'), 'missing member nodes should be identified');
  assert(codes.has('region-membership-cycle'), 'membership cycles should be identified');
});

test('C-VERSION-01 rejects unsupported document schemas independently', () => {
  const unsupported = { ...graphDocument(), schemaVersion: 2 };
  const result = validateGraphDocumentV1(unsupported);
  assert(!result.valid, 'unsupported schema should fail');
  assert(result.errors.some((entry) => entry.code === 'invalid-schema-version'), 'schema error should be explicit');

  let thrown = false;
  try {
    assertGraphDocumentV1(unsupported);
  } catch (error) {
    thrown = error instanceof InvalidGraphDocumentErrorV1;
  }
  equal(thrown, true, 'assertion helper should throw the structural validation error');
});
