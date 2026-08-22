import type {
  GraphDocumentV1,
  GraphEdgeV1,
  GraphNodeV1,
} from '../../src/graph-engine/contracts/v1/index.ts';

export function graphNode(id: string, overrides: Partial<GraphNodeV1> = {}): GraphNodeV1 {
  return { id, label: id, ...overrides };
}

export function graphEdge(
  id: string,
  sourceId: string,
  targetId: string,
  overrides: Partial<GraphEdgeV1> = {},
): GraphEdgeV1 {
  return { id, sourceId, targetId, ...overrides };
}

export function graphDocument(overrides: Partial<GraphDocumentV1> = {}): GraphDocumentV1 {
  const nodes = overrides.nodes ?? [graphNode('a'), graphNode('b')];
  return {
    schemaVersion: 1,
    documentId: 'fixture',
    revision: 0,
    nodes,
    edges: overrides.edges ?? [graphEdge('a-b', 'a', 'b')],
    ...overrides,
  };
}
