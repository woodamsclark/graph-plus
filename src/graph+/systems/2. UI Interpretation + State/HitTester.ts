import type { GraphData, Node } from "../../types/domain/graph.ts";
import type { CameraAccessor }  from "../../types/domain/camera.ts";

export class HitTester {
  public getNodeAtScreenPoint(
    graph: GraphData | null,
    camera: CameraAccessor | null,
    screenX: number,
    screenY: number
  ): Node | null {
    if (!graph || !camera) return null;

    let bestNode: Node | null = null;
    let bestDepth = Infinity;
    let bestDistSq = Infinity;
    const depthEpsilon = 0.0001;

    for (const node of graph.nodes) {
      const p = camera.worldToScreen(node.location);
      if (p.depth < 0) continue;

      const dx = screenX - p.x;
      const dy = screenY - p.y;
      const d2 = dx * dx + dy * dy;
      const rPx = node.radius * p.scale;
      if (d2 > rPx * rPx) continue;

      const isNearer = p.depth + depthEpsilon < bestDepth;
      const isSameDepth = Math.abs(p.depth - bestDepth) <= depthEpsilon;
      if (isNearer || (isSameDepth && d2 < bestDistSq)) {
        bestDepth = p.depth;
        bestDistSq = d2;
        bestNode = node;
      }
    }

    return bestNode;
  }

  public getNodeIdLabelAtScreenPoint(
    graph:    GraphData | null,
    camera:   CameraAccessor | null,
    screenX:  number,
    screenY:  number
  ): { id: string; label: string } | null {
    const node = this.getNodeAtScreenPoint(graph, camera, screenX, screenY);
    if (!node) return null;
    return { id: node.id, label: node.label };
  }
}
