import type { GraphDocumentV1 } from '../../graph-engine/contracts/v1/index.ts';
import { compileGraphPlusFilterV1, type GraphPlusLensStateV1, type ObsidianSearchIndexV1 } from '../query/index.ts';
import type { GraphPlusExperiencePolicyV1 } from './GraphPlusExperiencePolicy.ts';

export interface GraphPlusExperienceProjectionOptionsV1 {
  readonly policy: GraphPlusExperiencePolicyV1;
  readonly canonicalDocument?: GraphDocumentV1;
  readonly rootNodeId?: string;
  readonly depth: number;
  readonly lens: GraphPlusLensStateV1;
  readonly searchIndex: ObsidianSearchIndexV1;
  readonly onError?: (error: Error) => void;
}

/** Derive the document seen by one Graph+ experience from the canonical vault model. */
export function projectGraphPlusExperienceDocumentV1(
  options: GraphPlusExperienceProjectionOptionsV1,
): GraphDocumentV1 {
  const canonical = options.canonicalDocument;
  if (options.policy.documentScope === 'vault') {
    return canonical ?? emptyDocument('graph-plus:vault:unavailable');
  }
  const root = options.rootNodeId;
  if (!canonical || !root || !canonical.nodes.some((node) => node.id === root)) {
    return emptyDocument(
      `${canonical?.documentId ?? 'graph-plus:vault:unavailable'}:local:empty`,
      canonical?.revision,
    );
  }

  const compiled = compileGraphPlusFilterV1(canonical, options.lens, options.searchIndex);
  if (compiled.error) options.onError?.(new Error(compiled.error));
  const eligible = new Set(compiled.visibleNodeIds);
  eligible.add(root);
  const included = withinDepth(canonical, root, options.depth, eligible);
  const nodesById = new Map(canonical.nodes.map((node) => [node.id, node]));
  const nodes = [root, ...[...included].filter((nodeId) => nodeId !== root).sort()]
    .map((nodeId) => nodesById.get(nodeId))
    .filter((node): node is GraphDocumentV1['nodes'][number] => node !== undefined);
  const edges = canonical.edges.filter((edge) => included.has(edge.sourceId) && included.has(edge.targetId));
  const nodeRegions = canonical.nodeRegions ? {
    version: 1 as const,
    definitions: canonical.nodeRegions.definitions
      .filter((definition) => included.has(definition.regionNodeId))
      .map((definition) => ({
        regionNodeId: definition.regionNodeId,
        directMemberNodeIds: definition.directMemberNodeIds.filter((nodeId) => included.has(nodeId)),
      })),
  } : undefined;
  return {
    schemaVersion: 1,
    documentId: `${canonical.documentId}:local:${encodeURIComponent(root)}`,
    revision: canonical.revision,
    nodes,
    edges,
    ...(nodeRegions ? { nodeRegions } : {}),
  };
}

export function sameGraphPlusExperienceDocumentV1(
  left: GraphDocumentV1 | undefined,
  right: GraphDocumentV1,
): boolean {
  if (!left || left.documentId !== right.documentId || left.revision !== right.revision) return false;
  return JSON.stringify({ nodes: left.nodes, edges: left.edges, nodeRegions: left.nodeRegions })
    === JSON.stringify({ nodes: right.nodes, edges: right.edges, nodeRegions: right.nodeRegions });
}

function withinDepth(
  document: GraphDocumentV1,
  rootNodeId: string,
  maxDepth: number,
  eligible: ReadonlySet<string>,
): ReadonlySet<string> {
  const included = new Set([rootNodeId]);
  const adjacency = new Map<string, Set<string>>();
  for (const edge of document.edges) {
    if (!eligible.has(edge.sourceId) || !eligible.has(edge.targetId)) continue;
    const source = adjacency.get(edge.sourceId) ?? new Set<string>();
    source.add(edge.targetId);
    adjacency.set(edge.sourceId, source);
    const target = adjacency.get(edge.targetId) ?? new Set<string>();
    target.add(edge.sourceId);
    adjacency.set(edge.targetId, target);
  }
  const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: rootNodeId, depth: 0 }];
  while (queue.length) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;
    for (const neighbor of adjacency.get(current.nodeId) ?? []) {
      if (included.has(neighbor)) continue;
      included.add(neighbor);
      queue.push({ nodeId: neighbor, depth: current.depth + 1 });
    }
  }
  return included;
}

function emptyDocument(documentId: string, revision = 0): GraphDocumentV1 {
  return { schemaVersion: 1, documentId, revision, nodes: [], edges: [] };
}
