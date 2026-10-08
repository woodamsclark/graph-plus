import { prepareSimpleSearch } from 'obsidian';
import type { GraphDocumentV1 } from '../../graph-engine/contracts/v1/index.ts';

export interface GraphNodeSearchEntryV1 {
  readonly text: string;
  readonly tagMemberNodeIds: readonly string[];
}

export type GraphNodeSearchIndexV1 = ReadonlyMap<string, GraphNodeSearchEntryV1>;

const indexes = new WeakMap<GraphDocumentV1, GraphNodeSearchIndexV1>();

/** Immutable graph documents own the index lifetime; searches never consult the vault. */
export function graphNodeSearchIndexV1(document: GraphDocumentV1): GraphNodeSearchIndexV1 {
  const cached = indexes.get(document);
  if (cached) return cached;
  const members = new Map<string, string[]>();
  for (const edge of document.edges) {
    if (!edge.tokens?.includes('relation:tag')) continue;
    const ids = members.get(edge.targetId) ?? [];
    ids.push(edge.sourceId);
    members.set(edge.targetId, ids);
  }
  const index = new Map(document.nodes.map((node) => {
    const tags = Array.isArray(node.attributes?.tags) ? node.attributes.tags : [];
    return [node.id, {
      text: [node.label ?? '', node.attributes?.path ?? '', ...tags.map((tag) => `#${tag}`)].join('\n'),
      tagMemberNodeIds: node.attributes?.kind === 'tag' ? members.get(node.id) ?? [] : [],
    }] as const;
  }));
  indexes.set(document, index);
  return index;
}

export function matchingGraphNodeIdsV1(query: string, index: GraphNodeSearchIndexV1): ReadonlySet<string> | undefined {
  if (!query.trim()) return undefined;
  const matches = prepareSimpleSearch(query);
  const ids = new Set<string>();
  for (const [nodeId, entry] of index) {
    if (matches(entry.text) === null) continue;
    ids.add(nodeId);
    for (const memberId of entry.tagMemberNodeIds) ids.add(memberId);
  }
  return ids;
}
