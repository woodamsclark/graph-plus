import {
  GRAPH_LINEAR_BUILD_DIRECTIONS_V1,
  type GraphDimensionsV1,
  type GraphDocumentV1,
  type GraphEdgeV1,
  type GraphLinearBuildDirectionV1,
  type JsonValue,
  type Vec3,
} from '../../../contracts/v1/index.ts';
import type { GraphModuleInstanceV1, GraphModulePipelineStateV1 } from '../GraphModuleTypes.ts';

export interface LinearBuildOutLayoutSettingsV1 {
  readonly buildDirection: GraphLinearBuildDirectionV1;
  readonly layerSpacing: number;
  readonly branchSpacing: number;
  readonly componentSpacing: number;
}

interface LayoutComponent {
  readonly nodeIds: readonly string[];
  readonly depthByNodeId: ReadonlyMap<string, number>;
}

export class LinearBuildOutLayoutModule implements GraphModuleInstanceV1 {
  private settings: LinearBuildOutLayoutSettingsV1;

  constructor(
    private readonly dimensions: GraphDimensionsV1,
    settings: Readonly<Record<string, JsonValue>>,
  ) {
    this.settings = readLinearBuildOutLayoutSettingsV1(dimensions, settings);
  }

  updateSettings(settings: Readonly<Record<string, JsonValue>>): void {
    this.settings = readLinearBuildOutLayoutSettingsV1(this.dimensions, settings);
  }

  projectTopology(state: GraphModulePipelineStateV1) {
    return {
      positions: buildLinearBuildOutPositionsV1(
        state.document,
        this.dimensions,
        this.settings,
      ),
    };
  }
}

export function readLinearBuildOutLayoutSettingsV1(
  dimensions: GraphDimensionsV1,
  settings: Readonly<Record<string, JsonValue>>,
): LinearBuildOutLayoutSettingsV1 {
  const buildDirection = GRAPH_LINEAR_BUILD_DIRECTIONS_V1.includes(
    settings.buildDirection as GraphLinearBuildDirectionV1,
  )
    ? settings.buildDirection as GraphLinearBuildDirectionV1
    : 'right';
  if (dimensions === '2d' && (buildDirection === 'in' || buildDirection === 'out')) {
    throw new Error(`Linear build direction "${buildDirection}" requires a 3D profile.`);
  }
  return {
    buildDirection,
    layerSpacing: finitePositive(settings.layerSpacing, 180),
    branchSpacing: finitePositive(settings.branchSpacing, 160),
    componentSpacing: finitePositive(settings.componentSpacing, 320),
  };
}

export function buildLinearBuildOutPositionsV1(
  document: GraphDocumentV1,
  dimensions: GraphDimensionsV1,
  settings: LinearBuildOutLayoutSettingsV1,
): Readonly<Record<string, Vec3>> {
  if (!document.nodes.length) return {};
  const orderByNodeId = new Map(document.nodes.map((node, index) => [node.id, index]));
  const components = resolveComponents(document, orderByNodeId);
  const positions: Record<string, Vec3> = {};

  components.forEach((component, componentIndex) => {
    const nodeIdsByDepth = new Map<number, string[]>();
    for (const nodeId of component.nodeIds) {
      const depth = component.depthByNodeId.get(nodeId) ?? 0;
      const values = nodeIdsByDepth.get(depth) ?? [];
      values.push(nodeId);
      nodeIdsByDepth.set(depth, values);
    }
    for (const values of nodeIdsByDepth.values()) {
      values.sort((left, right) => (orderByNodeId.get(left) ?? 0) - (orderByNodeId.get(right) ?? 0));
    }

    for (const [depth, nodeIds] of [...nodeIdsByDepth.entries()].sort(([left], [right]) => left - right)) {
      nodeIds.forEach((nodeId, siblingIndex) => {
        const componentOffset = componentIndex * settings.componentSpacing;
        const siblingOffset = (siblingIndex - (nodeIds.length - 1) / 2) * settings.branchSpacing;
        positions[nodeId] = positionFor(
          dimensions,
          settings.buildDirection,
          depth * settings.layerSpacing,
          componentOffset + (settings.buildDirection === 'in' || settings.buildDirection === 'out'
            ? 0
            : siblingOffset),
          siblingIndex,
          nodeIds.length,
          settings.branchSpacing,
        );
      });
    }
  });

  return positions;
}

function resolveComponents(
  document: GraphDocumentV1,
  orderByNodeId: ReadonlyMap<string, number>,
): LayoutComponent[] {
  const weakAdjacency = adjacency(document.nodes.map((node) => node.id));
  const outwardAdjacency = adjacency(document.nodes.map((node) => node.id));
  for (const edge of document.edges) {
    addNeighbor(weakAdjacency, edge.sourceId, edge.targetId);
    addNeighbor(weakAdjacency, edge.targetId, edge.sourceId);
    addNeighbor(outwardAdjacency, edge.sourceId, edge.targetId);
    if (!edge.directed) addNeighbor(outwardAdjacency, edge.targetId, edge.sourceId);
  }
  sortAdjacency(weakAdjacency, orderByNodeId);
  sortAdjacency(outwardAdjacency, orderByNodeId);

  const remaining = new Set(document.nodes.map((node) => node.id));
  const components: LayoutComponent[] = [];
  for (const root of document.nodes.map((node) => node.id)) {
    if (!remaining.has(root)) continue;
    const nodeIds = traverse(root, weakAdjacency).filter((nodeId) => remaining.has(nodeId));
    nodeIds.forEach((nodeId) => remaining.delete(nodeId));
    nodeIds.sort((left, right) => (orderByNodeId.get(left) ?? 0) - (orderByNodeId.get(right) ?? 0));
    const depthByNodeId = resolveDepths(root, nodeIds, document.edges, outwardAdjacency, orderByNodeId);
    components.push({ nodeIds, depthByNodeId });
  }
  return components;
}

function resolveDepths(
  rootId: string,
  nodeIds: readonly string[],
  edges: readonly GraphEdgeV1[],
  outwardAdjacency: ReadonlyMap<string, readonly string[]>,
  orderByNodeId: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
  const nodeSet = new Set(nodeIds);
  const outwardDepths = breadthFirstDepths(rootId, outwardAdjacency, nodeSet);
  const componentEdges = edges.filter((edge) => nodeSet.has(edge.sourceId) && nodeSet.has(edge.targetId));
  const allReachable = outwardDepths.size === nodeIds.length;
  const allDirected = componentEdges.every((edge) => edge.directed === true);
  if (allReachable && allDirected) {
    const topological = topologicalDepths(rootId, nodeIds, componentEdges, orderByNodeId);
    if (topological) return topological;
  }

  const weak = adjacency(nodeIds);
  componentEdges.forEach((edge) => {
    addNeighbor(weak, edge.sourceId, edge.targetId);
    addNeighbor(weak, edge.targetId, edge.sourceId);
  });
  sortAdjacency(weak, orderByNodeId);
  return breadthFirstDepths(rootId, weak, nodeSet);
}

function topologicalDepths(
  rootId: string,
  nodeIds: readonly string[],
  edges: readonly GraphEdgeV1[],
  orderByNodeId: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> | undefined {
  const indegree = new Map(nodeIds.map((nodeId) => [nodeId, 0]));
  const outgoing = adjacency(nodeIds);
  for (const edge of edges) {
    addNeighbor(outgoing, edge.sourceId, edge.targetId);
    indegree.set(edge.targetId, (indegree.get(edge.targetId) ?? 0) + 1);
  }
  if ((indegree.get(rootId) ?? 0) !== 0) return undefined;
  sortAdjacency(outgoing, orderByNodeId);
  const ready = nodeIds
    .filter((nodeId) => (indegree.get(nodeId) ?? 0) === 0)
    .sort((left, right) => (orderByNodeId.get(left) ?? 0) - (orderByNodeId.get(right) ?? 0));
  const ordered: string[] = [];
  while (ready.length) {
    const nodeId = ready.shift()!;
    ordered.push(nodeId);
    for (const targetId of outgoing.get(nodeId) ?? []) {
      const next = (indegree.get(targetId) ?? 0) - 1;
      indegree.set(targetId, next);
      if (next === 0) {
        ready.push(targetId);
        ready.sort((left, right) => (orderByNodeId.get(left) ?? 0) - (orderByNodeId.get(right) ?? 0));
      }
    }
  }
  if (ordered.length !== nodeIds.length) return undefined;
  const depths = new Map<string, number>([[rootId, 0]]);
  for (const nodeId of ordered) {
    const depth = depths.get(nodeId);
    if (depth === undefined) continue;
    for (const targetId of outgoing.get(nodeId) ?? []) {
      depths.set(targetId, Math.max(depths.get(targetId) ?? 0, depth + 1));
    }
  }
  return depths.size === nodeIds.length ? depths : undefined;
}

function breadthFirstDepths(
  rootId: string,
  graph: ReadonlyMap<string, readonly string[]>,
  allowed: ReadonlySet<string>,
): Map<string, number> {
  const depths = new Map<string, number>([[rootId, 0]]);
  const queue = [rootId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const nodeId = queue[cursor];
    const depth = depths.get(nodeId) ?? 0;
    for (const neighbor of graph.get(nodeId) ?? []) {
      if (!allowed.has(neighbor) || depths.has(neighbor)) continue;
      depths.set(neighbor, depth + 1);
      queue.push(neighbor);
    }
  }
  return depths;
}

function positionFor(
  dimensions: GraphDimensionsV1,
  direction: GraphLinearBuildDirectionV1,
  main: number,
  cross: number,
  siblingIndex: number,
  siblingCount: number,
  branchSpacing: number,
): Vec3 {
  switch (direction) {
    case 'up': return { x: cross, y: -main, z: 0 };
    case 'down': return { x: cross, y: main, z: 0 };
    case 'left': return { x: -main, y: cross, z: 0 };
    case 'right': return { x: main, y: cross, z: 0 };
    case 'in':
    case 'out': {
      if (dimensions !== '3d') throw new Error(`Linear build direction "${direction}" requires 3D.`);
      const columns = Math.max(1, Math.ceil(Math.sqrt(siblingCount)));
      const rows = Math.max(1, Math.ceil(siblingCount / columns));
      const column = siblingIndex % columns;
      const row = Math.floor(siblingIndex / columns);
      return {
        x: cross + (column - (columns - 1) / 2) * branchSpacing,
        y: (row - (rows - 1) / 2) * branchSpacing,
        z: direction === 'out' ? main : -main,
      };
    }
  }
}

function adjacency(nodeIds: readonly string[]): Map<string, string[]> {
  return new Map(nodeIds.map((nodeId) => [nodeId, []]));
}

function addNeighbor(graph: Map<string, string[]>, sourceId: string, targetId: string): void {
  const values = graph.get(sourceId);
  if (!values || values.includes(targetId)) return;
  values.push(targetId);
}

function sortAdjacency(
  graph: Map<string, string[]>,
  orderByNodeId: ReadonlyMap<string, number>,
): void {
  for (const values of graph.values()) {
    values.sort((left, right) => (orderByNodeId.get(left) ?? 0) - (orderByNodeId.get(right) ?? 0));
  }
}

function traverse(rootId: string, graph: ReadonlyMap<string, readonly string[]>): string[] {
  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const neighbor of graph.get(queue[cursor]) ?? []) {
      if (seen.has(neighbor)) continue;
      seen.add(neighbor);
      queue.push(neighbor);
    }
  }
  return queue;
}

function finitePositive(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
