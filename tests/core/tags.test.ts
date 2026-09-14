import { InvalidGraphTagProjectionErrorV1, projectGraphTagsV1 } from '../../src/graph-engine/public.ts';
import { graphDocument, graphEdge, graphNode } from '../support/contractFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

test('T-PROJECT-01 projects generic many-to-many tags as a deterministic DAG', () => {
  const base = graphDocument({
    nodes: [graphNode('note:a'), graphNode('note:b')],
    edges: [graphEdge('ordinary', 'note:a', 'note:b', { directed: true, tokens: ['relation:link'] })],
  });
  const projected = projectGraphTagsV1(base, {
    version: 1,
    tags: [
      { nodeId: 'tag:child', label: '#child', parentTagNodeIds: ['tag:left', 'tag:right'] },
      { nodeId: 'tag:right', label: '#right' },
      { nodeId: 'tag:left', label: '#left' },
    ],
    memberships: [
      { tagNodeId: 'tag:child', memberNodeId: 'note:a' },
      { tagNodeId: 'tag:right', memberNodeId: 'note:a' },
    ],
  });
  deepEqual(projected.nodes.slice(0, 2), base.nodes, 'base node values and ordering should remain untouched');
  deepEqual(projected.edges.find((edge) => edge.id === 'ordinary'), base.edges[0], 'ordinary edges should remain untouched');
  deepEqual(projected.nodes.slice(2).map((node) => node.id), ['tag:child', 'tag:left', 'tag:right'], 'tag nodes should be deterministic');
  deepEqual(projected.nodeRegions?.definitions, [
    { regionNodeId: 'tag:child', directMemberNodeIds: ['note:a'] },
    { regionNodeId: 'tag:left', directMemberNodeIds: ['tag:child'] },
    { regionNodeId: 'tag:right', directMemberNodeIds: ['note:a', 'tag:child'] },
  ], 'regions should preserve overlapping membership and multiple parents');
});

test('T-PROJECT-02 rejects cyclic tag parents atomically', () => {
  const base = graphDocument({ nodes: [graphNode('note:a')], edges: [] });
  let error: unknown;
  try {
    projectGraphTagsV1(base, {
      version: 1,
      tags: [
        { nodeId: 'tag:a', parentTagNodeIds: ['tag:b'] },
        { nodeId: 'tag:b', parentTagNodeIds: ['tag:a'] },
      ],
      memberships: [],
    });
  } catch (caught) { error = caught; }
  assert(error instanceof InvalidGraphTagProjectionErrorV1,
    `cycles should fail with the public projection error, got ${String(error)} (${error instanceof Error ? error.name : typeof error})`);
  equal(base.nodes.length, 1, 'a failed projection must not mutate the base document');
});
