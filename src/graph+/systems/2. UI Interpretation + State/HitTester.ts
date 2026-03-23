import type { GraphData, Node } from "../../grammar/interfaces.ts";
import type { Camera } from "../5. Render/Camera.ts";

export class HitTester {
  public getNodeAtScreenPoint(
    graph: GraphData | null,
    camera: Camera | null,
    screenX: number,
    screenY: number
  ): Node | null {
    if (!graph || !camera) return null;

    let best: Node | null = null;
    let bestDistSq = Infinity;

    for (const node of graph.nodes) {
      const p = camera.worldToScreen(node.location);

      const dx = screenX - p.x;
      const dy = screenY - p.y;
      const d2 = dx * dx + dy * dy;

      const rPx = node.radius * p.scale;

      if (d2 <= rPx * rPx && d2 < bestDistSq) {
        bestDistSq = d2;
        best = node;
      }
    }

    return best;
  }

  public getNodeIdLabelAtScreenPoint(
    graph: GraphData | null,
    camera: Camera | null,
    screenX: number,
    screenY: number
  ): { id: string; label: string } | null {
    const node = this.getNodeAtScreenPoint(graph, camera, screenX, screenY);
    if (!node) return null;
    return { id: node.id, label: node.label };
  }
}