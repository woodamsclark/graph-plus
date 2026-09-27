import type { Vision } from '../vision/index.ts';
import type { GraphFrameStore } from '../render/index.ts';
import type { GraphHitV1, GraphScreenPointV1 } from './GraphInteractionTypes.ts';

export class GraphHitTester {
  constructor(
    private readonly vision: Vision,
    private readonly frames: GraphFrameStore,
  ) {}

  hit(point: GraphScreenPointV1): GraphHitV1 | null {
    const frame = this.frames.get();
    if (!frame) return null;
    let best: GraphHitV1 | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const node of frame.nodes) {
      const projected = this.vision.worldToScreen(node.position);
      if (projected.depth <= 0) continue;
      const radius = node.radius * projected.scale;
      const distance = (point.x - projected.x) ** 2 + (point.y - projected.y) ** 2;
      if (distance > radius ** 2) continue;
      if (!best || projected.depth < best.depth || (projected.depth === best.depth && distance < bestDistance)) {
        best = { nodeId: node.id, position: { ...node.position }, depth: projected.depth };
        bestDistance = distance;
      }
    }
    return best;
  }
}
