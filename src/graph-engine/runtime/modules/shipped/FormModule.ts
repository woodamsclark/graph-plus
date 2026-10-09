import type {
  GraphDimensionsV1,
  GraphDocumentV1,
  GraphEdgeV1,
  JsonValue,
  Vec3,
} from '../../../contracts/v1/index.ts';
import type {
  AnimusEdgeRoleV1,
  AnimusNodeRoleV1,
} from '../../animus/index.ts';
import type { GraphModuleInstanceV1, GraphModuleProjectionStateV1 } from '../GraphModuleTypes.ts';

interface FormSettings {
  readonly rootNodeId?: string;
  readonly maxDepth?: number;
  readonly direction: 'incoming' | 'outgoing' | 'either';
  readonly edgeToken?: string;
  readonly showCrossLinks: boolean;
  readonly showDisconnected: boolean;
  readonly ringSpacing: number;
  readonly colorBranches: boolean;
}

export class FormModule implements GraphModuleInstanceV1 {
  private settings: FormSettings;

  constructor(
    private readonly dimensions: GraphDimensionsV1,
    settings: Readonly<Record<string, JsonValue>>,
  ) {
    this.settings = readSettings(settings);
  }

  updateSettings(settings: Readonly<Record<string, JsonValue>>): void {
    this.settings = readSettings(settings);
  }

  projectTopology(state: GraphModuleProjectionStateV1) {
    const source = state.document;
    if (!source.nodes.length) return { formActive: true };
    const edges = this.settings.edgeToken
      ? source.edges.filter((edge) => edge.tokens?.includes(this.settings.edgeToken!))
      : [...source.edges];
    const nodeById = new Map(source.nodes.map((node) => [node.id, node]));
    const degree = weightedDegree(source, edges);
    const rootId = this.settings.rootNodeId && nodeById.has(this.settings.rootNodeId)
      ? this.settings.rootNodeId
      : [...source.nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id.localeCompare(b.id))[0].id;
    const adjacency = adjacencyFor(edges, this.settings.direction);
    const parent = new Map<string, string>();
    const parentEdge = new Map<string, string>();
    const depth = new Map<string, number>([[rootId, 0]]);
    const branch = new Map<string, string>([[rootId, rootId]]);
    const order = [rootId];
    for (let cursor = 0; cursor < order.length; cursor += 1) {
      const current = order[cursor];
      const currentDepth = depth.get(current) ?? 0;
      if (this.settings.maxDepth !== undefined && currentDepth >= this.settings.maxDepth) continue;
      for (const entry of adjacency.get(current) ?? []) {
        if (depth.has(entry.nodeId)) continue;
        parent.set(entry.nodeId, current);
        parentEdge.set(entry.nodeId, entry.edgeId);
        depth.set(entry.nodeId, currentDepth + 1);
        branch.set(entry.nodeId, current === rootId ? entry.nodeId : (branch.get(current) ?? entry.nodeId));
        order.push(entry.nodeId);
      }
    }
    const reachable = new Set(order);
    const nodes = this.settings.showDisconnected ? [...source.nodes] : source.nodes.filter((node) => reachable.has(node.id));
    const topBranches = [...parent.entries()]
      .filter(([, parentId]) => parentId === rootId)
      .map(([nodeId]) => nodeId)
      .sort();
    const positions = radialPositions(
      this.dimensions,
      rootId,
      nodes.map((node) => node.id),
      parent,
      depth,
      branch,
      topBranches,
      this.settings.ringSpacing,
    );
    const treeEdgeIds = new Set(parentEdge.values());
    const visibleIds = new Set(nodes.map((node) => node.id));
    const projectedEdges = edges
      .filter((edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId))
      .filter((edge) => this.settings.showCrossLinks || treeEdgeIds.has(edge.id));
    const branchIndexes = new Map(topBranches.map((id, index) => [id, index]));
    const nodeRoles: Record<string, AnimusNodeRoleV1> = {};
    const childCounts = new Map<string, number>();
    for (const parentId of parent.values()) childCounts.set(parentId, (childCounts.get(parentId) ?? 0) + 1);
    for (const node of nodes) {
      const childCount = childCounts.get(node.id) ?? 0;
      const branchId = branch.get(node.id);
      const nodeDepth = depth.get(node.id);
      nodeRoles[node.id] = { form: {
        kind: node.id === rootId ? 'root' : nodeDepth === undefined ? 'disconnected' : childCount ? 'branch' : 'leaf',
        depth: nodeDepth ?? 0,
        ...(branchId === undefined || branchId === rootId ? {} : { branchId }),
        ...(branchId === undefined || branchId === rootId ? {} : { branchIndex: branchIndexes.get(branchId) }),
        colorBranches: this.settings.colorBranches,
      } };
    }
    const childByEdge = new Map([...parentEdge.entries()].map(([childId, edgeId]) => [edgeId, childId]));
    const edgeRoles: Record<string, AnimusEdgeRoleV1> = {};
    for (const edge of projectedEdges) {
      const tree = treeEdgeIds.has(edge.id);
      const childId = childByEdge.get(edge.id) ?? edge.targetId;
      const branchId = branch.get(childId);
      edgeRoles[edge.id] = { form: {
        kind: tree ? 'tree' : 'cross',
        childDepth: depth.get(childId) ?? 1,
        ...(branchId === undefined || branchId === rootId ? {} : { branchId }),
        ...(branchId === undefined || branchId === rootId ? {} : { branchIndex: branchIndexes.get(branchId) }),
        colorBranches: this.settings.colorBranches,
      } };
    }
    const document = withTopology(source, nodes.map((node) => node.id), projectedEdges.map((edge) => edge.id));
    return {
      document,
      positions,
      projectionSelection: {
        nodeIds: new Set(document.nodes.map((node) => node.id)),
        edgeIds: new Set(document.edges.map((edge) => edge.id)),
      },
      formActive: true,
      nodeRoles,
      edgeRoles,
    };
  }
}

function readSettings(settings: Readonly<Record<string, JsonValue>>): FormSettings {
  const direction = settings.direction;
  return {
    ...(typeof settings.rootNodeId === 'string' && settings.rootNodeId ? { rootNodeId: settings.rootNodeId } : {}),
    ...(typeof settings.maxDepth === 'number' && Number.isSafeInteger(settings.maxDepth) && settings.maxDepth >= 0
      ? { maxDepth: settings.maxDepth }
      : {}),
    direction: direction === 'incoming' || direction === 'outgoing' ? direction : 'either',
    ...(typeof settings.edgeToken === 'string' && settings.edgeToken ? { edgeToken: settings.edgeToken } : {}),
    showCrossLinks: settings.showCrossLinks !== false,
    showDisconnected: settings.showDisconnected === true,
    ringSpacing: finitePositive(settings.ringSpacing, 120),
    colorBranches: settings.colorBranches !== false,
  };
}

function adjacencyFor(edges: readonly GraphEdgeV1[], direction: FormSettings['direction']) {
  const result = new Map<string, Array<{ nodeId: string; edgeId: string; weight: number }>>();
  const add = (from: string, to: string, edge: GraphEdgeV1) => {
    const values = result.get(from) ?? [];
    values.push({ nodeId: to, edgeId: edge.id, weight: Math.abs(edge.weight ?? 1) });
    result.set(from, values);
  };
  for (const edge of edges) {
    if (!edge.directed || direction !== 'incoming') add(edge.sourceId, edge.targetId, edge);
    if (!edge.directed || direction !== 'outgoing') add(edge.targetId, edge.sourceId, edge);
  }
  for (const values of result.values()) values.sort((a, b) => b.weight - a.weight || a.nodeId.localeCompare(b.nodeId));
  return result;
}

function radialPositions(
  dimensions: GraphDimensionsV1,
  rootId: string,
  nodeIds: readonly string[],
  parent: ReadonlyMap<string, string>,
  depth: Map<string, number>,
  branch: ReadonlyMap<string, string>,
  topBranches: readonly string[],
  ringSpacing: number,
): Readonly<Record<string, Vec3>> {
  const children = new Map<string, string[]>();
  for (const [childId, parentId] of parent) {
    const values = children.get(parentId) ?? [];
    values.push(childId);
    children.set(parentId, values);
  }
  for (const values of children.values()) values.sort();
  const subtree = new Map<string, number>();
  const count = (id: string): number => {
    const value = 1 + (children.get(id) ?? []).reduce((sum, child) => sum + count(child), 0);
    subtree.set(id, value);
    return value;
  };
  count(rootId);
  const branchIndex = new Map(topBranches.map((id, index) => [id, index]));
  const positions: Record<string, Vec3> = { [rootId]: { x: 0, y: 0, z: 0 } };
  const place = (id: string, start: number, end: number): void => {
    const values = children.get(id) ?? [];
    const total = values.reduce((sum, child) => sum + (subtree.get(child) ?? 1), 0) || 1;
    let cursor = start;
    for (const child of values) {
      const span = (end - start) * ((subtree.get(child) ?? 1) / total);
      const angle = cursor + span / 2;
      const ring = depth.get(child) ?? 1;
      positions[child] = {
        x: Math.cos(angle) * ringSpacing * ring,
        y: Math.sin(angle) * ringSpacing * ring,
        z: dimensions === '3d'
          ? spatialDepth(child, branch.get(child), branchIndex, topBranches.length, ring, ringSpacing)
          : 0,
      };
      place(child, cursor, cursor + span);
      cursor += span;
    }
  };
  place(rootId, -Math.PI / 2, Math.PI * 1.5);
  const disconnected = nodeIds.filter((id) => positions[id] === undefined).sort();
  const outer = Math.max(2, ...depth.values()) + 1;
  disconnected.forEach((id, index) => {
    const angle = -Math.PI / 2 + Math.PI * 2 * index / Math.max(1, disconnected.length);
    positions[id] = {
      x: Math.cos(angle) * ringSpacing * outer,
      y: Math.sin(angle) * ringSpacing * outer,
      z: dimensions === '3d' ? signedHash(id) * ringSpacing * outer * 0.35 : 0,
    };
    depth.set(id, outer);
  });
  return positions;
}

function spatialDepth(
  nodeId: string,
  branchId: string | undefined,
  branchIndex: ReadonlyMap<string, number>,
  branchCount: number,
  ring: number,
  ringSpacing: number,
): number {
  const index = branchId === undefined ? 0 : branchIndex.get(branchId) ?? 0;
  const branchAxis = branchCount <= 1 ? 0 : index / (branchCount - 1) * 2 - 1;
  const branchSeparation = branchAxis * ringSpacing * ring * 0.55;
  const localSeparation = signedHash(nodeId) * ringSpacing * Math.sqrt(ring) * 0.18;
  return branchSeparation + localSeparation;
}

function signedHash(value: string): number {
  return stableHash(value) / 0xffffffff * 2 - 1;
}

function weightedDegree(document: GraphDocumentV1, edges: readonly GraphEdgeV1[]): Map<string, number> {
  const result = new Map(document.nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    const weight = Math.abs(edge.weight ?? 1);
    result.set(edge.sourceId, (result.get(edge.sourceId) ?? 0) + weight);
    result.set(edge.targetId, (result.get(edge.targetId) ?? 0) + weight);
  }
  return result;
}

function withTopology(document: GraphDocumentV1, nodeIds: readonly string[], edgeIds: readonly string[]): GraphDocumentV1 {
  const nodes = new Set(nodeIds);
  const edges = new Set(edgeIds);
  return {
    schemaVersion: 1,
    documentId: document.documentId,
    revision: document.revision,
    nodes: document.nodes.filter((node) => nodes.has(node.id)),
    edges: document.edges.filter((edge) => edges.has(edge.id)),
  };
}

function finitePositive(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
