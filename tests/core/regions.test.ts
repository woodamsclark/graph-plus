import { GraphNodeRegionIndexV1 } from '../../src/graph-engine/core/regions/index.ts';
import { graphDocument, graphNode } from '../support/contractFixtures.ts';
import { deepEqual, equal, test } from '../support/harness.ts';

const document = graphDocument({
  nodes: ['quotes', 'jung', 'watts', 'jung-note', 'watts-note', 'shared']
    .map((id) => graphNode(id)),
  edges: [],
  nodeRegions: {
    version: 1,
    definitions: [
      { regionNodeId: 'quotes', directMemberNodeIds: ['jung', 'watts'] },
      { regionNodeId: 'jung', directMemberNodeIds: ['jung-note', 'shared'] },
      { regionNodeId: 'watts', directMemberNodeIds: ['watts-note', 'shared'] },
    ],
  },
});

test('C-REGION-04 recursive closure traverses tag regions and stops at first non-region nodes', () => {
  const index = new GraphNodeRegionIndexV1(document);
  equal(index.isRegionNode('quotes'), true, 'a defined owner should be a region node');
  equal(index.isRegionNode('shared'), false, 'a leaf member should not become a region node');
  deepEqual(index.recursiveMembers('quotes'), [
    'jung', 'jung-note', 'shared', 'watts', 'watts-note',
  ], 'recursive closure should include child tags and stop each branch at its first ordinary node');
});

test('C-REGION-05 visible projection preserves overlap without duplicating canonical members', () => {
  const index = new GraphNodeRegionIndexV1(document);
  const visible = new Set(['quotes', 'jung', 'watts', 'jung-note', 'shared']);
  const projected = index.project(visible);
  deepEqual(projected.map((region) => ({
    id: region.regionNodeId,
    members: region.memberNodeIds,
  })), [
    { id: 'jung', members: ['jung-note', 'shared'] },
    { id: 'quotes', members: ['jung', 'jung-note', 'shared', 'watts'] },
    { id: 'watts', members: ['shared'] },
  ], 'regions should wrap only visible nodes while the shared ID remains canonical');
  equal(projected.flatMap((region) => region.memberNodeIds).filter((id) => id === 'shared').length, 3, 'one canonical node may contribute to every containing region');
});
