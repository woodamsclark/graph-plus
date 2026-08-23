import type { GraphDocumentV1 } from '../../contracts/v1/index.ts';

export type GraphTraversalDirection = 'incoming' | 'outgoing' | 'either';

export class GraphTopologyIndex {
  private readonly outgoing = new Map<string, Set<string>>();
  private readonly incoming = new Map<string, Set<string>>();

  constructor(document: GraphDocumentV1) {
    for (const node of document.nodes) {
      this.outgoing.set(node.id, new Set());
      this.incoming.set(node.id, new Set());
    }
    for (const edge of document.edges) {
      this.add(this.outgoing, edge.sourceId, edge.targetId);
      this.add(this.incoming, edge.targetId, edge.sourceId);
      if (!edge.directed) {
        this.add(this.outgoing, edge.targetId, edge.sourceId);
        this.add(this.incoming, edge.sourceId, edge.targetId);
      }
    }
  }

  neighbors(nodeId: string, direction: GraphTraversalDirection): ReadonlySet<string> {
    if (direction === 'outgoing') return this.outgoing.get(nodeId) ?? EMPTY_SET;
    if (direction === 'incoming') return this.incoming.get(nodeId) ?? EMPTY_SET;
    return new Set([
      ...(this.outgoing.get(nodeId) ?? EMPTY_SET),
      ...(this.incoming.get(nodeId) ?? EMPTY_SET),
    ]);
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
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();
