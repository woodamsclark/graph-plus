import type { GraphDocumentV1, GraphEdgeV1 } from '../../contracts/v1/index.ts';

export type GraphTraversalDirection = 'incoming' | 'outgoing' | 'either';

export interface GraphTopologySelectionV1 {
  readonly nodeIds?: ReadonlySet<string>;
  readonly edgeIds?: ReadonlySet<string>;
}

export class GraphTopologyIndex {
  private readonly indexedNodeIds = new Set<string>();
  private readonly outgoing = new Map<string, Set<string>>();
  private readonly incoming = new Map<string, Set<string>>();
  private readonly either = new Map<string, Set<string>>();
  private readonly ordered = new Map<GraphTraversalDirection, ReadonlyMap<string, readonly string[]>>();

  constructor(document: GraphDocumentV1, selection: GraphTopologySelectionV1 = {}) {
    for (const node of document.nodes) {
      if (selection.nodeIds && !selection.nodeIds.has(node.id)) continue;
      this.indexedNodeIds.add(node.id);
      this.outgoing.set(node.id, new Set());
      this.incoming.set(node.id, new Set());
      this.either.set(node.id, new Set());
    }
    for (const edge of document.edges) {
      if (selection.edgeIds && !selection.edgeIds.has(edge.id)) continue;
      if (!this.either.has(edge.sourceId) || !this.either.has(edge.targetId)) continue;
      this.add(this.outgoing, edge.sourceId, edge.targetId);
      this.add(this.incoming, edge.targetId, edge.sourceId);
      this.addEither(edge);
      if (!edge.directed) {
        this.add(this.outgoing, edge.targetId, edge.sourceId);
        this.add(this.incoming, edge.sourceId, edge.targetId);
      }
    }
    this.ordered.set('outgoing', this.order(this.outgoing));
    this.ordered.set('incoming', this.order(this.incoming));
    this.ordered.set('either', this.order(this.either));
  }

  get nodeIds(): ReadonlySet<string> { return this.indexedNodeIds; }

  neighbors(nodeId: string, direction: GraphTraversalDirection): ReadonlySet<string> {
    if (direction === 'outgoing') return this.outgoing.get(nodeId) ?? EMPTY_SET;
    if (direction === 'incoming') return this.incoming.get(nodeId) ?? EMPTY_SET;
    return this.either.get(nodeId) ?? EMPTY_SET;
  }

  relationships(direction: GraphTraversalDirection): ReadonlyMap<string, ReadonlySet<string>> {
    if (direction === 'outgoing') return this.outgoing;
    if (direction === 'incoming') return this.incoming;
    return this.either;
  }

  shortestPathToAny(
    startId: string,
    targetIds: ReadonlySet<string>,
    direction: GraphTraversalDirection = 'either',
  ): readonly string[] | undefined {
    if (!this.either.has(startId)) return undefined;
    if (targetIds.has(startId)) return [startId];
    const previous = new Map<string, string | undefined>([[startId, undefined]]);
    const queue = [startId];
    const ordered = this.ordered.get(direction)!;
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      for (const neighbor of ordered.get(current) ?? []) {
        if (previous.has(neighbor)) continue;
        previous.set(neighbor, current);
        if (targetIds.has(neighbor)) return this.reconstructPath(neighbor, previous);
        queue.push(neighbor);
      }
    }
    return undefined;
  }

  connected(rootIds: readonly string[], direction: GraphTraversalDirection): ReadonlySet<string> {
    const result = new Set<string>();
    for (const rootId of rootIds) {
      for (const nodeId of this.neighbors(rootId, direction)) result.add(nodeId);
    }
    return result;
  }

  withinDepth(
    rootIds: readonly string[],
    maxDepth: number,
    direction: GraphTraversalDirection,
  ): ReadonlySet<string> {
    const result = new Set(rootIds);
    const queue = rootIds.map((id) => ({ id, depth: 0 }));
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      if (current.depth >= maxDepth) continue;
      for (const nodeId of this.neighbors(current.id, direction)) {
        if (result.has(nodeId)) continue;
        result.add(nodeId);
        queue.push({ id: nodeId, depth: current.depth + 1 });
      }
    }
    return result;
  }

  private add(map: Map<string, Set<string>>, from: string, to: string): void {
    const values = map.get(from) ?? new Set<string>();
    values.add(to);
    map.set(from, values);
  }

  private addEither(edge: GraphEdgeV1): void {
    this.add(this.either, edge.sourceId, edge.targetId);
    this.add(this.either, edge.targetId, edge.sourceId);
  }

  private order(source: ReadonlyMap<string, ReadonlySet<string>>): ReadonlyMap<string, readonly string[]> {
    return new Map([...source].map(([nodeId, neighbors]) => [nodeId, Object.freeze([...neighbors].sort())]));
  }

  private reconstructPath(
    targetId: string,
    previous: ReadonlyMap<string, string | undefined>,
  ): readonly string[] {
    const path: string[] = [];
    let current: string | undefined = targetId;
    while (current !== undefined) {
      path.push(current);
      current = previous.get(current);
    }
    return path.reverse();
  }
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();
