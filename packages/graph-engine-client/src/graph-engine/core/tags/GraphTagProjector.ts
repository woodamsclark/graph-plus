import {
  assertGraphDocumentV1,
  InvalidGraphTagProjectionErrorV1,
  type GraphDocumentV1,
  type GraphEdgeV1,
  type GraphNodeRegionDefinitionV1,
  type GraphNodeV1,
  type GraphTagProjectionInputV1,
} from '../../contracts/v1/index.ts';

/** Adds consumer-declared tags without interpreting consumer data or tag syntax. */
export function projectGraphTagsV1(
  baseDocument: GraphDocumentV1,
  input: GraphTagProjectionInputV1,
): GraphDocumentV1 {
  assertGraphDocumentV1(baseDocument);
  if (!input || input.version !== 1 || !isUnknownArray(input.tags) || !isUnknownArray(input.memberships)) {
    fail('Tag projection must contain version 1 tag and membership arrays.');
  }

  const baseNodeIds = new Set(baseDocument.nodes.map((node) => node.id));
  const tagIds = new Set<string>();
  const sourceTags = [...input.tags];
  for (const tag of sourceTags) {
    if (!tag || typeof tag.nodeId !== 'string' || !tag.nodeId || tagIds.has(tag.nodeId)) {
      fail(`Duplicate, missing, or invalid tag node ID.`);
    }
    if (tag.parentTagNodeIds !== undefined && !isUnknownArray(tag.parentTagNodeIds)) {
      fail(`Tag "${tag.nodeId}" parentTagNodeIds must be an array.`);
    }
    if (baseNodeIds.has(tag.nodeId)) fail(`Tag node ID "${tag.nodeId}" collides with a base node.`);
    tagIds.add(tag.nodeId);
  }
  const tags = sourceTags.sort((left, right) => left.nodeId.localeCompare(right.nodeId));

  const parentPairs = new Set<string>();
  const children = new Map([...tagIds].map((id) => [id, new Set<string>()]));
  const indegrees = new Map([...tagIds].map((id) => [id, 0]));
  for (const tag of tags) for (const parentId of tag.parentTagNodeIds ?? []) {
    if (!tagIds.has(parentId)) fail(`Tag "${tag.nodeId}" has unknown parent "${parentId}".`);
    if (parentId === tag.nodeId) fail(`Tag "${tag.nodeId}" cannot parent itself.`);
    const key = pairKey(parentId, tag.nodeId);
    if (parentPairs.has(key)) fail(`Duplicate tag parent relationship "${parentId}" -> "${tag.nodeId}".`);
    parentPairs.add(key);
    children.get(parentId)!.add(tag.nodeId);
    indegrees.set(tag.nodeId, indegrees.get(tag.nodeId)! + 1);
  }
  assertAcyclic(children, indegrees);

  const membershipPairs = new Set<string>();
  const regionMembers = new Map([...tagIds].map((id) => [id, new Set<string>()]));
  const generatedEdges: GraphEdgeV1[] = [];
  for (const membership of input.memberships) {
    if (!membership || typeof membership.tagNodeId !== 'string' || typeof membership.memberNodeId !== 'string') {
      fail('Tag memberships require string tagNodeId and memberNodeId values.');
    }
    if (!tagIds.has(membership.tagNodeId)) fail(`Membership has unknown tag "${membership.tagNodeId}".`);
    if (!baseNodeIds.has(membership.memberNodeId)) fail(`Membership has unknown base member "${membership.memberNodeId}".`);
    const key = pairKey(membership.memberNodeId, membership.tagNodeId);
    if (membershipPairs.has(key)) fail(`Duplicate tag membership "${membership.memberNodeId}" -> "${membership.tagNodeId}".`);
    membershipPairs.add(key);
    regionMembers.get(membership.tagNodeId)!.add(membership.memberNodeId);
    generatedEdges.push(tagEdge(membership.memberNodeId, membership.tagNodeId, 'tag', membership.weight));
  }
  for (const key of parentPairs) {
    const [parentId, childId] = splitPairKey(key);
    regionMembers.get(parentId)!.add(childId);
    generatedEdges.push(tagEdge(parentId, childId, 'tag-parent', 1));
  }

  const baseEdgeIds = new Set(baseDocument.edges.map((edge) => edge.id));
  for (const edge of generatedEdges) if (baseEdgeIds.has(edge.id)) fail(`Generated tag edge ID "${edge.id}" collides with a base edge.`);
  const generatedEdgeIds = new Set<string>();
  for (const edge of generatedEdges) {
    if (generatedEdgeIds.has(edge.id)) fail(`Generated tag edge ID "${edge.id}" is ambiguous.`);
    generatedEdgeIds.add(edge.id);
  }

  const tagNodes: GraphNodeV1[] = tags.map((tag) => ({
    id: tag.nodeId,
    ...(tag.label === undefined ? {} : { label: tag.label }),
    tokens: [...new Set(['kind:tag', ...(tag.tokens ?? [])])].sort(),
    attributes: { ...(tag.attributes ?? {}), kind: 'tag' },
    ...(tag.positionHint === undefined ? {} : { positionHint: { ...tag.positionHint } }),
  }));
  const definitions: GraphNodeRegionDefinitionV1[] = [
    ...(baseDocument.nodeRegions?.definitions ?? []).map((definition) => ({
      regionNodeId: definition.regionNodeId,
      directMemberNodeIds: [...definition.directMemberNodeIds],
    })),
    ...[...regionMembers].sort(([left], [right]) => left.localeCompare(right)).map(([regionNodeId, members]) => ({
      regionNodeId,
      directMemberNodeIds: [...members].sort(),
    })),
  ];
  const result: GraphDocumentV1 = {
    ...baseDocument,
    nodes: [...baseDocument.nodes, ...tagNodes],
    edges: [...baseDocument.edges, ...generatedEdges].sort((left, right) => left.id.localeCompare(right.id)),
    nodeRegions: { version: 1, definitions },
  };
  assertGraphDocumentV1(result);
  return result;
}

function tagEdge(sourceId: string, targetId: string, relation: 'tag' | 'tag-parent', weight = 1): GraphEdgeV1 {
  if (!Number.isFinite(weight) || weight < 0) fail(`Tag edge weight must be a finite non-negative number.`);
  return {
    id: `edge:${encodeURIComponent(sourceId)}:${encodeURIComponent(targetId)}`,
    sourceId,
    targetId,
    directed: true,
    weight,
    tokens: [`relation:${relation}`],
    attributes: { relations: [relation] },
  };
}

function assertAcyclic(children: ReadonlyMap<string, ReadonlySet<string>>, sourceIndegrees: ReadonlyMap<string, number>): void {
  const indegrees = new Map(sourceIndegrees);
  const queue = [...indegrees].filter(([, degree]) => degree === 0).map(([id]) => id).sort();
  let visited = 0;
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index]; visited += 1;
    for (const child of [...(children.get(id) ?? [])].sort()) {
      const degree = indegrees.get(child)! - 1;
      indegrees.set(child, degree);
      if (degree === 0) queue.push(child);
    }
  }
  if (visited !== indegrees.size) fail('Tag parent relationships contain a cycle.');
}

function pairKey(left: string, right: string): string { return `${left}\u0000${right}`; }
function splitPairKey(value: string): readonly [string, string] { const at = value.indexOf('\u0000'); return [value.slice(0, at), value.slice(at + 1)]; }
function fail(message: string): never { throw new InvalidGraphTagProjectionErrorV1(message); }

/** Preserve unknown element types instead of the built-in any[] narrowing. */
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}
