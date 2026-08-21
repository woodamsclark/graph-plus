import type { GraphData, Link, Node } from '../types/domain/graph.ts';
import type { GraphLensState } from '../types/domain/lens.ts';
import { compileGraphQuery } from './GraphQuery.ts';

const BRANCH_COLORS = [
  '#e57373', '#ffb74d', '#ffd54f', '#81c784', '#4db6ac', '#4fc3f7',
  '#64b5f6', '#7986cb', '#9575cd', '#ba68c8', '#f06292', '#a1887f',
];

export function projectGraph(
  source: GraphData,
  lens: GraphLensState,
  options: { ringSpacing: number },
): GraphData {
  const compiled = compileGraphQuery(lens.filter.query);
  const groupMatchers = lens.groups.map((group) => ({ group, query: compileGraphQuery(group.query) }));

  let nodes = source.nodes
    .filter((node) => typeIsVisible(node, lens))
    .filter((node) => compiled.matches(node));
  let visibleIds = new Set(nodes.map((node) => node.id));
  let links = source.links.filter((link) => visibleIds.has(link.sourceId) && visibleIds.has(link.targetId));

  if (!lens.filter.showOrphans) {
    const connected = new Set<string>();
    for (const link of links) {
      connected.add(link.sourceId);
      connected.add(link.targetId);
    }
    nodes = nodes.filter((node) => connected.has(node.id));
    visibleIds = new Set(nodes.map((node) => node.id));
    links = links.filter((link) => visibleIds.has(link.sourceId) && visibleIds.has(link.targetId));
  }

  const groupColor = (node: Node): string | undefined => {
    for (const { group, query } of groupMatchers) {
      if (group.query.trim() && !query.error && query.matches(node)) return group.color;
    }
    return undefined;
  };

  if (lens.form.mode === 'mind-map') {
    return projectMindMap(source, nodes, links, lens, options, compiled.error, groupColor);
  }

  const projectedNodes = nodes.map((node) => ({
    ...node,
    location: node.location,
    velocity: node.velocity,
    view: groupColor(node) ? { color: groupColor(node) } : undefined,
  }));
  const projectedLinks = links.map((link) => ({ ...link, relations: [...link.relations], view: undefined }));
  return assemble(projectedNodes, projectedLinks, {
    mode: 'free',
    sourceNodeCount: source.nodes.length,
    sourceLinkCount: source.links.length,
    queryError: compiled.error,
  });
}

function projectMindMap(
  source: GraphData,
  candidates: Node[],
  candidateLinks: Link[],
  lens: GraphLensState,
  options: { ringSpacing: number },
  queryError: string | undefined,
  groupColor: (node: Node) => string | undefined,
): GraphData {
  if (!candidates.length) {
    return assemble([], [], {
      mode: 'mind-map',
      sourceNodeCount: source.nodes.length,
      sourceLinkCount: source.links.length,
      queryError,
    });
  }

  const nodeById = new Map(candidates.map((node) => [node.id, node] as const));
  const filteredLinks = candidateLinks.filter((link) =>
    !lens.form.relation.trim() || link.relations.some((relation) => relation === lens.form.relation.trim().toLowerCase()),
  );
  const degree = weightedDegree(candidates, filteredLinks);
  const requestedRoot = lens.form.rootId && nodeById.has(lens.form.rootId) ? lens.form.rootId : null;
  const rootId = requestedRoot ?? [...candidates]
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id.localeCompare(b.id))[0].id;

  const adjacency = new Map<string, Array<{ nodeId: string; link: Link }>>();
  const add = (from: string, to: string, link: Link) => {
    const entries = adjacency.get(from) ?? [];
    entries.push({ nodeId: to, link });
    adjacency.set(from, entries);
  };
  for (const link of filteredLinks) {
    if (lens.form.direction !== 'incoming') add(link.sourceId, link.targetId, link);
    if (lens.form.direction !== 'outgoing') add(link.targetId, link.sourceId, link);
  }
  for (const entries of adjacency.values()) {
    entries.sort((a, b) =>
      b.link.weight - a.link.weight ||
      (degree.get(b.nodeId) ?? 0) - (degree.get(a.nodeId) ?? 0) ||
      a.nodeId.localeCompare(b.nodeId),
    );
  }

  const parent = new Map<string, string>();
  const parentLink = new Map<string, string>();
  const depth: Map<string, number> = new Map([[rootId, 0]]);
  const branch = new Map<string, string>([[rootId, rootId]]);
  const order = [rootId];
  for (let cursor = 0; cursor < order.length; cursor++) {
    const current = order[cursor];
    const currentDepth = depth.get(current) ?? 0;
    if (lens.form.maxDepth !== null && currentDepth >= lens.form.maxDepth) continue;
    for (const edge of adjacency.get(current) ?? []) {
      if (depth.has(edge.nodeId)) continue;
      parent.set(edge.nodeId, current);
      parentLink.set(edge.nodeId, edge.link.id);
      depth.set(edge.nodeId, currentDepth + 1);
      branch.set(edge.nodeId, current === rootId ? edge.nodeId : (branch.get(current) ?? edge.nodeId));
      order.push(edge.nodeId);
    }
  }

  const reachable = new Set(order);
  const visibleNodes = lens.form.showDisconnected
    ? candidates
    : candidates.filter((node) => reachable.has(node.id));
  const children = new Map<string, string[]>();
  for (const [child, parentId] of parent) {
    const values = children.get(parentId) ?? [];
    values.push(child);
    children.set(parentId, values);
  }
  for (const values of children.values()) values.sort((a, b) => a.localeCompare(b));

  const subtreeSize = new Map<string, number>();
  const countSubtree = (id: string): number => {
    let count = 1;
    for (const child of children.get(id) ?? []) count += countSubtree(child);
    subtreeSize.set(id, count);
    return count;
  };
  countSubtree(rootId);

  const positions = new Map<string, { x: number; y: number; z: number }>();
  positions.set(rootId, { x: 0, y: 0, z: 0 });
  const placeChildren = (id: string, startAngle: number, endAngle: number): void => {
    const values = children.get(id) ?? [];
    const total = values.reduce((sum, child) => sum + (subtreeSize.get(child) ?? 1), 0) || 1;
    let cursor = startAngle;
    for (const child of values) {
      const span = (endAngle - startAngle) * ((subtreeSize.get(child) ?? 1) / total);
      const angle = cursor + span / 2;
      const ring = depth.get(child) ?? 1;
      positions.set(child, {
        x: Math.cos(angle) * options.ringSpacing * ring,
        y: Math.sin(angle) * options.ringSpacing * ring,
        z: 0,
      });
      placeChildren(child, cursor, cursor + span);
      cursor += span;
    }
  };
  placeChildren(rootId, -Math.PI / 2, Math.PI * 1.5);

  if (lens.form.showDisconnected) {
    const disconnected = visibleNodes.filter((node) => !reachable.has(node.id)).sort((a, b) => a.id.localeCompare(b.id));
    const outerDepth = Math.max(2, ...depth.values()) + 1;
    disconnected.forEach((node, index) => {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(1, disconnected.length);
      positions.set(node.id, {
        x: Math.cos(angle) * options.ringSpacing * outerDepth,
        y: Math.sin(angle) * options.ringSpacing * outerDepth,
        z: 0,
      });
      depth.set(node.id, outerDepth);
      branch.set(node.id, node.id);
    });
  }

  const colorByBranch = new Map<string, string>();
  const topBranches = children.get(rootId) ?? [];
  topBranches.forEach((id, index) => colorByBranch.set(id, BRANCH_COLORS[index % BRANCH_COLORS.length]));
  const branchColor = (id: string): string | undefined => {
    const branchId = branch.get(id);
    if (!branchId || branchId === rootId) return undefined;
    return colorByBranch.get(branchId) ?? BRANCH_COLORS[stableHash(branchId) % BRANCH_COLORS.length];
  };

  const projectedNodes = visibleNodes.map((node) => {
    const nodeDepth = depth.get(node.id) ?? 0;
    const isReachable = reachable.has(node.id);
    const childCount = (children.get(node.id) ?? []).length;
    const role = node.id === rootId ? 'root' : !isReachable ? 'disconnected' : childCount ? 'branch' : 'leaf';
    const color = lens.form.colorBranches ? branchColor(node.id) : groupColor(node);
    return {
      ...node,
      location: positions.get(node.id) ?? { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      radius: node.radius * (role === 'root' ? 1.35 : role === 'branch' ? 1.12 : 1),
      view: {
        color: color ?? groupColor(node),
        branchId: branch.get(node.id),
        depth: nodeDepth,
        role,
      },
    } satisfies Node;
  });
  const projectedIds = new Set(projectedNodes.map((node) => node.id));
  const treeLinkIds = new Set(parentLink.values());
  const childByTreeLink = new Map<string, string>();
  for (const [childId, linkId] of parentLink) childByTreeLink.set(linkId, childId);
  const projectedLinks = filteredLinks
    .filter((link) => projectedIds.has(link.sourceId) && projectedIds.has(link.targetId))
    .filter((link) => lens.form.showCrossLinks || treeLinkIds.has(link.id))
    .map((link) => {
      const tree = treeLinkIds.has(link.id);
      const childId = childByTreeLink.get(link.id) ?? link.targetId;
      const color = lens.form.colorBranches ? branchColor(childId) : undefined;
      return {
        ...link,
        relations: [...link.relations],
        thickness: tree ? link.thickness * Math.max(1.15, 2.4 - (depth.get(childId) ?? 1) * 0.22) : link.thickness * 0.65,
        view: { color, role: tree ? 'tree' : 'cross' },
      } satisfies Link;
    });

  return assemble(projectedNodes, projectedLinks, {
    mode: 'mind-map',
    sourceNodeCount: source.nodes.length,
    sourceLinkCount: source.links.length,
    rootId,
    queryError,
  });
}

function typeIsVisible(node: Node, lens: GraphLensState): boolean {
  if (node.type === 'tag') return lens.filter.showTags;
  if (node.type === 'unresolved') return lens.filter.showUnresolved;
  if (node.type === 'attachment' || node.type === 'canvas') return lens.filter.showAttachments;
  return true;
}

function weightedDegree(nodes: Node[], links: Link[]): Map<string, number> {
  const values: Map<string, number> = new Map(nodes.map((node) => [node.id, 0]));
  for (const link of links) {
    values.set(link.sourceId, (values.get(link.sourceId) ?? 0) + link.weight);
    values.set(link.targetId, (values.get(link.targetId) ?? 0) + link.weight);
  }
  return values;
}

function assemble(nodes: Node[], links: Link[], projection: GraphData['projection']): GraphData {
  const linksOut: GraphData['linksOut'] = {};
  const linksIn: GraphData['linksIn'] = {};
  for (const link of links) {
    const weight = link.weight;
    (linksOut[link.sourceId] ??= {})[link.targetId] = ((linksOut[link.sourceId] ?? {})[link.targetId] ?? 0) + weight;
    (linksIn[link.targetId] ??= {})[link.sourceId] = ((linksIn[link.targetId] ?? {})[link.sourceId] ?? 0) + weight;
  }
  return { nodes, links, linksOut, linksIn, projection };
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
