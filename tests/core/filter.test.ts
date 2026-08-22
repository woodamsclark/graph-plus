import type { GraphFilterAstV1, GraphFilterRequestV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import {
  InvalidGraphFilterErrorV1,
  evaluateGraphFilterV1,
  validateGraphFilterRequestV1,
} from '../../src/graph-engine/core/filter/index.ts';
import { graphDocument, graphEdge, graphNode } from '../support/contractFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

const document = graphDocument({
  nodes: [
    graphNode('a', { tokens: ['due', 'pattern'], attributes: { status: 'due', score: 5, aliases: ['alpha', 1] } }),
    graphNode('b', { tokens: ['locked'], attributes: { status: 'locked', score: 10, aliases: ['beta'] } }),
    graphNode('c', { tokens: ['due'], attributes: { status: 'due', score: 15, aliases: ['gamma'] } }),
    graphNode('d', { attributes: { score: 20 } }),
  ],
  edges: [
    graphEdge('a-b', 'a', 'b', { directed: true, tokens: ['parent'], attributes: { strength: 1 } }),
    graphEdge('b-c', 'b', 'c', { directed: true, tokens: ['parent'], attributes: { strength: 2 } }),
    graphEdge('c-d', 'c', 'd', { directed: false, tokens: ['reference'], attributes: { strength: 3 } }),
  ],
});

function request(node?: GraphFilterAstV1, edge?: GraphFilterAstV1): GraphFilterRequestV1 {
  return { schemaVersion: 1, scope: 'projection', node, edge };
}

function selected(ast?: GraphFilterAstV1): string[] {
  return [...evaluateGraphFilterV1(document, request(ast)).nodeIds];
}

test('C-FILTER-01 evaluates boolean AST operations', () => {
  deepEqual(selected({ op: 'all' }), ['a', 'b', 'c', 'd'], 'all should match every node');
  deepEqual(selected({ op: 'none' }), [], 'none should match no node');
  deepEqual(selected({
    op: 'and',
    operands: [
      { op: 'has-token', token: 'due' },
      { op: 'not', operand: { op: 'id-in', ids: ['c'] } },
    ],
  }), ['a'], 'and and not should compose');
  deepEqual(selected({
    op: 'or',
    operands: [{ op: 'id-in', ids: ['b'] }, { op: 'id-in', ids: ['d'] }],
  }), ['b', 'd'], 'or should union matches');
  deepEqual(selected({ op: 'and', operands: [] }), ['a', 'b', 'c', 'd'], 'empty and should be true');
  deepEqual(selected({ op: 'or', operands: [] }), [], 'empty or should be false');
});

test('C-FILTER-02 evaluates exact membership and attribute predicates', () => {
  deepEqual(selected({ op: 'id-in', ids: ['c', 'missing'] }), ['c'], 'ID membership should be exact');
  deepEqual(selected({ op: 'has-token', token: 'Due' }), [], 'token matching should be case-sensitive');
  deepEqual(selected({ op: 'attribute-equals', attribute: 'status', value: 'due' }), ['a', 'c'], 'scalar equality should match');
  deepEqual(selected({ op: 'attribute-equals', attribute: 'aliases', value: 'alpha' }), [], 'scalar equality should not inspect arrays');
  deepEqual(selected({ op: 'attribute-contains', attribute: 'aliases', value: 'alpha' }), ['a'], 'contains should use exact array membership');
  deepEqual(selected({ op: 'attribute-number-range', attribute: 'score', min: 10, max: 15 }), ['b', 'c'], 'numeric range should be inclusive');
});

test('C-FILTER-03 traverses topology from roots with directed and undirected edges', () => {
  deepEqual(selected({ op: 'connected-to', nodeIds: ['a'], direction: 'outgoing' }), ['b'], 'outgoing should select direct targets');
  deepEqual(selected({ op: 'connected-to', nodeIds: ['b'], direction: 'incoming' }), ['a'], 'incoming should select direct sources');
  deepEqual(selected({ op: 'within-depth', rootNodeIds: ['a'], maxDepth: 2, direction: 'outgoing' }), ['a', 'b', 'c'], 'depth should include root and descendants');
  deepEqual(selected({ op: 'within-depth', rootNodeIds: ['d'], maxDepth: 1, direction: 'incoming' }), ['c', 'd'], 'undirected edge should traverse both ways');
});

test('C-FILTER-04 rejects topology predicates in edge ASTs', () => {
  const invalid = request(undefined, { op: 'connected-to', nodeIds: ['a'] });
  const errors = validateGraphFilterRequestV1(invalid);
  assert(errors.some((entry) => entry.path === '$.edge'), 'edge topology violation should identify edge AST');
  let threw = false;
  try {
    evaluateGraphFilterV1(document, invalid);
  } catch (error) {
    threw = error instanceof InvalidGraphFilterErrorV1;
  }
  equal(threw, true, 'evaluation should reject invalid edge AST');
});

test('C-FILTER-05 combines independent node and edge selection with endpoint integrity', () => {
  const selection = evaluateGraphFilterV1(document, request(
    { op: 'not', operand: { op: 'id-in', ids: ['d'] } },
    { op: 'has-token', token: 'parent' },
  ));
  deepEqual([...selection.nodeIds], ['a', 'b', 'c'], 'node AST should select nodes independently');
  deepEqual([...selection.edgeIds], ['a-b', 'b-c'], 'edge AST should match and require visible endpoints');

  const hiddenEndpoint = evaluateGraphFilterV1(document, request(
    { op: 'id-in', ids: ['a', 'b'] },
    { op: 'all' },
  ));
  deepEqual([...hiddenEndpoint.edgeIds], ['a-b'], 'edge with hidden endpoint should be removed');
});

test('filter validation rejects unknown operations, invalid ranges, and schemas', () => {
  const malformed = {
    schemaVersion: 2,
    scope: 'projection',
    node: { op: 'attribute-number-range', attribute: 'score', min: 10, max: 1 },
    edge: { op: 'mystery' },
  };
  const errors = validateGraphFilterRequestV1(malformed);
  equal(errors.length >= 3, true, 'each structural violation should be reported');
});

test('filter AST rejects presentation instructions outside domain selection', () => {
  const errors = validateGraphFilterRequestV1({
    schemaVersion: 1,
    scope: 'render',
    node: { op: 'has-token', token: 'due', dimUnmatched: true },
  });
  assert(errors.some((entry) => entry.path === '$.node.dimUnmatched'), 'presentation field should be rejected');
});
